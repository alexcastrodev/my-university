---
version: 1.0
updatedAt: 2026-08-20
title: "Redis Functions: Substituindo Scripting Lua Ad Hoc"
summary: Os dois livros-fonte ensinam scripting Lua ad hoc via EVAL/EVALSHA e um wrapper feito à mão de cache-miss de SCRIPT LOAD porque isso era todo o scripting que o Redis tinha em 2013-2015; o Redis Functions (Redis 7.0, 2022) substitui isso por bibliotecas nomeadas e versionadas carregadas via FUNCTION LOAD e invocadas com FCALL/FCALL_RO, que o próprio Redis persiste no AOF e replica em vez de deixar a durabilidade do script para cada aplicação cliente.
---
## Objective

Entender como o Redis moveu scripting do lado do servidor de uma convenção ad hoc, de propriedade do cliente (enviar uma string Lua bruta via `EVAL`, ou cacheá-la do lado do servidor sob um hash SHA1 opaco via `SCRIPT LOAD`/`EVALSHA`) para um artefato de verdade, gerenciado pelo banco de dados: bibliotecas nomeadas carregadas com `FUNCTION LOAD`, feitas de uma ou mais funções registradas com `redis.register_function()`, invocadas por nome com `FCALL`. Os dois livros-fonte (*Redis Essentials*, Da Silva et al., 2015, e *Redis in Action*, Carlson, 2013) ensinam exatamente o mundo `EVAL`/`EVALSHA`, porque esse era o único scripting que o Redis tinha; o Redis Functions não existia até o Redis 7.0 em 2022, anos depois de os dois livros terem sido escritos. Este conceito é explicitamente "livro vs. hoje": os capítulos de scripting dos livros não estão errados, são a explicação completa de um problema que o Functions foi construído especificamente para consertar.

## Use Cases

- Transformar uma operação repetida entre serviços (o próprio exemplo dos livros é uma atualização estilo `HSET` que também carimba um campo `_last_modified_`) em uma função de servidor nomeada e listável (`my_hset`) em vez de uma string Lua que todo serviço precisa embutir, distribuir, e manter em sincronia independentemente.
- Expor funções auxiliares somente leitura (um `HGETALL` filtrado que remove campos internos de contabilidade, uma busca de "última modificação") marcadas com a flag `no-writes` para que possam rodar via `FCALL_RO` contra uma réplica somente leitura: algo para o qual um script `EVALSHA` cacheado à mão não tem equivalente limpo, já que o Redis não tem como saber o comportamento de leitura/escrita de um script cacheado sem ser informado.
- Reimplementar a própria substituição do livro para locking otimista (um script atômico de "pop do elemento com menor score" via `ZRANGE`-depois-`ZREM`, usado em vez de retentar uma transação `WATCH`/`MULTI`/`EXEC` sob contenção) como uma função de biblioteca durável que todo cliente chama por nome, em vez de reenviar a mesma string Lua a cada conexão.
- Auditar exatamente qual lógica de servidor está rodando em produção com `FUNCTION LIST`, em vez de fazer grep em repositórios de aplicação procurando strings Lua embutidas ou tentando fazer engenharia reversa de comportamento a partir de um hash SHA1 opaco visto em uma sessão `MONITOR`.
- Pré-carregar uma instância Redis nova e efêmera de camada de cache com seu conjunto completo de funções de lógica de negócio via `redis-cli --functions-rdb` antes de ela aceitar tráfego de cliente: um problema de bootstrap que scripts `EVAL` brutos não conseguem resolver de jeito nenhum, já que nunca foram persistidos para começar.

## Deep Dive

### A era de scripting ad hoc: o que os livros ensinam (2012-2015)

O Redis 2.6 (2012) introduziu scripting, e os dois livros o ensinam como a única forma de estender o Redis sem tocar em seu código-fonte C. *Redis in Action* enquadra a motivação diretamente: "Antes do Redis 2.6 (e do branch de scripting não suportado do Redis 2.4), se quiséssemos funcionalidade de nível mais alto que ainda não existisse no Redis, ou teríamos que escrever código do lado do cliente... ou teríamos que editar o código-fonte C do próprio Redis. Embora editar o código-fonte do Redis não seja muito difícil, suportar esse código em um ambiente de negócio... poderia ser desafiador." *Redis Essentials* adiciona por que Lua especificamente: "Lua foi escolhida porque é muito pequena e simples, e sua API C é muito fácil de integrar com outras bibliotecas."

**`EVAL`, `KEYS`/`ARGV`, e atomicidade.** A sintaxe do comando principal, segundo *Redis Essentials*: `EVAL script numkeys key [key ...] arg [arg ...]`: o script como uma string, uma contagem de quantos dos argumentos seguintes são nomes de chave, depois as chaves e quaisquer argumentos extras. Dentro do script, esses se tornam as tabelas `KEYS` e `ARGV`, e `redis.call`/`redis.pcall` executam comandos Redis de dentro do Lua (`pcall` retorna erros como uma tabela Lua em vez de abortar o script). O próprio aviso do livro: "Evite usar nomes de chave fixos dentro de um script Lua; passe todo nome de chave como parâmetro para os comandos EVAL/EVALSHA": precisamente para que o Redis Cluster consiga verificar que todas as chaves tocadas moram no mesmo shard antes de rodar o script. A execução é totalmente atômica: "scripts Lua são executados atomicamente, o que significa que o servidor Redis fica bloqueado durante a execução do script", com um teto padrão de 5 segundos (`lua-time-limit`) depois do qual o Redis começa a responder `BUSY` a todo comando até que o script seja morto com `SCRIPT KILL` (seguro só se o script ainda não escreveu) ou o próprio servidor seja reiniciado com `SHUTDOWN NOSAVE`.

*Redis in Action* mostra exatamente por que isso importava além da conveniência: o mesmo loop de retentativa de "locking otimista" via `WATCH`/`MULTI`/`EXEC` usado antes no livro para fazer pop do elemento com menor score de um sorted set poderia em vez disso ser escrito como um único script Lua atômico: nenhuma retentativa necessária, porque "o Redis sempre vai garantir que não há mudanças paralelas ao Sorted Set durante a execução do script."

**`SCRIPT LOAD`/`EVALSHA`, e o problema de cache que os livros constroem à mão.** Reenviar uma string de script completa a cada chamada desperdiça banda e força o Redis a recompilá-la toda vez, então os dois livros ensinam a otimização em dois passos: `SCRIPT LOAD` cacheia um script do lado do servidor e retorna seu digest SHA1; `EVALSHA` então o roda de novo só por esse digest. *Redis in Action* implementa isso como um pequeno wrapper do lado do cliente: um closure `script_load()` que chama `SCRIPT LOAD` uma vez, cacheia o SHA1 retornado localmente, e chama `EVALSHA` em toda invocação subsequente. Mas o wrapper precisa capturar uma falha específica: "se descobrirmos que o script está faltando" (porque o servidor reiniciou, alguém rodou `SCRIPT FLUSH`, ou um servidor diferente e não aquecido recebeu essa conexão), "executamos o script diretamente com `EVAL`, que cacheia o script além de executá-lo." Todo cliente, em toda linguagem, era esperado a reimplementar esse fallback exato de cache-miss à mão, porque o cache nunca tinha garantia de sobreviver.

### Por que isso ficou desajeitado quando uma aplicação se apoiava fortemente nele

A própria documentação atual do Redis é direta sobre o teto que essa abordagem atinge em escala, em termos que ecoam precisamente o que o wrapper `EVALSHA` feito à mão dos livros estava contornando:

> "Toda instância de aplicação cliente precisa manter uma cópia de todos os scripts. Isso significa ter algum mecanismo que aplica atualizações de script a todas as instâncias da aplicação."
> "Chamar scripts cacheados dentro do contexto de uma transação aumenta a probabilidade de a transação falhar por causa de um script faltando."
> "Digests SHA1 não têm significado, tornando a depuração do sistema extremamente difícil (por exemplo, em uma sessão `MONITOR`)."
> "Como são efêmeros, um script não consegue chamar outro script. Isso torna compartilhar e reutilizar código entre scripts quase impossível, a não ser por pré-processamento do lado do cliente."

Nada disso é um bug em `EVAL`/`EVALSHA`; é a consequência direta de um design onde, nas palavras da própria documentação do Redis, "scripts são parte da aplicação e não mantidos pelo servidor Redis." O tratamento cuidadoso de cache-miss dos livros e seu conselho de manter scripts pequenos e de propósito único são a resposta de engenharia correta a esse design, não workarounds para uma falha.

### Redis Functions (Redis 7.0, 2022): scripts se tornam artefatos gerenciados pelo banco de dados

O Redis Functions inverte a posse: "Functions fornecem a mesma funcionalidade central que scripts mas são artefatos de software de primeira classe do banco de dados. O Redis gerencia funções como parte integral do banco de dados e garante sua disponibilidade via persistência de dados e replicação." Carregar uma se parece com isto:

```
FUNCTION LOAD "#!lua name=mylib
local function my_hset(keys, args)
  local hash = keys[1]
  local time = redis.call('TIME')[1]
  return redis.call('HSET', hash, '_last_modified_', time, unpack(args))
end
redis.register_function('my_hset', my_hset)"
```

A linha de shebang obrigatória (`#!lua name=mylib`) nomeia a biblioteca e seu motor de execução (só Lua vem hoje, deixado deliberadamente aberto para outros depois); toda função dentro dela é registrada por nome via `redis.register_function()`. Chamá-la usa `FCALL` em vez de `EVAL`/`EVALSHA`, com a mesma convenção de chamada `numkeys key [key...] arg [arg...]` que scripts já usavam:

```
FCALL my_hset 1 myhash myfield "some value"
```

Essa única mudança remove a classe de problema inteira que o wrapper `EVALSHA` dos livros existia para consertar:

- **Persistência e replicação são automáticas, não trabalho da aplicação.** "Functions também são persistidas no arquivo AOF e replicadas do master para réplicas, então são tão duráveis quanto o próprio dado": o exato fallback `NOSCRIPT`/cache-miss que o wrapper `script_load()` de *Redis in Action* precisava implementar à mão para todo cliente, em toda linguagem, simplesmente não tem modo de falha equivalente para `FCALL`. Não há cache para se perder; a função é parte do estado do banco de dados.
- **Uma API nomeada e descritível em vez de um hash opaco.** `FUNCTION LIST` retorna toda função de toda biblioteca por nome, com descrições e flags: uma resposta direta à própria reclamação da documentação de que "digests SHA1 não têm significado... em uma sessão `MONITOR`."
- **Reuso de código de verdade.** Funções na mesma biblioteca conseguem se chamar mutuamente e compartilhar funções auxiliares privadas (um validador `check_keys()` chamado de três funções registradas diferentes, por exemplo): resolvendo a lacuna de "um script não consegue chamar outro script" que o modelo ad hoc nunca fechou.
- **Uma biblioteca se atualiza como uma única unidade atômica.** `FUNCTION LOAD REPLACE` troca o código da biblioteca inteira em uma operação; não há caminho de atualização parcial, o que troca hot-patching granular fino pela garantia de que uma biblioteca nunca é observada meio-atualizada.
- **Flags declaram comportamento em vez de deixar o Redis presumir o pior.** Por padrão o Redis presume que qualquer função pode escrever, então `FCALL_RO` contra uma réplica somente leitura é recusado; adicionar a flag `no-writes` no momento do registro (via a forma de argumentos nomeados do `redis.register_function`) é o que faz `FCALL_RO myfunc ...` funcionar contra réplicas de jeito nenhum.
- **Propagação de cluster ainda é manual, igual ao próprio problema de distribuição de script dos livros.** O Redis replica funções automaticamente de um master para suas próprias réplicas, mas entre masters independentes de um Redis Cluster, carregar uma biblioteca ainda é um passo administrativo explícito (`redis-cli --cluster-only-masters --cluster call host:port FUNCTION LOAD ...`): o Functions resolve a metade de sincronia-com-réplica do problema de "todo cliente precisa manter uma cópia" dos livros, não a metade entre shards.

### Livro vs. hoje

> **`EVAL` não está obsoleto; o Functions é o que você usa quando um script deixa de ser algo único.** O material `EVAL`/`EVALSHA` dos dois livros ainda roda sem modificação no Redis atual; nada nele foi removido ou está errado. O que mudou é o caminho recomendado quando lógica de scripting se torna algo do qual uma aplicação de fato depende: a própria documentação de functions do Redis declara claramente que o Functions "substitui o uso de `EVAL`... em versões anteriores do Redis" para esse papel, enquanto `EVAL` continua bom para scripts genuinamente efêmeros e de disparo único que um cliente renderiza e descarta.
>
> **O wrapper de cache-miss de `EVALSHA` feito à mão pelos livros é exatamente o problema em torno do qual o Functions foi projetado.** O closure `script_load()` de *Redis in Action* (cachear um SHA1, capturar `NOSCRIPT`, recorrer a `EVAL`) é um padrão correto e necessário para a ferramenta a que se destina, e a própria documentação do Redis enquadra o recurso Functions inteiro como uma resposta a exatamente essa classe de fragilidade: um cache que "pode se perder a qualquer momento", com a aplicação responsável por perceber e se recuperar. Uma função carregada via `FUNCTION LOAD` não tem cache análogo para perder; persistência e replicação são trabalho do servidor, não da biblioteca cliente.
>
> **O modelo de execução bloqueante e single-threaded não mudou nada.** Toda restrição que os livros ensinam sobre scripts (atômico, bloqueia o servidor inteiro pela duração, mantenha rápido, um script descontrolado precisa de `SCRIPT KILL` ou `SHUTDOWN NOSAVE`) se aplica identicamente ao Functions. O Functions mudou como a lógica é *distribuída e gerenciada*, não como ela *executa*; uma função lenta é exatamente tão perigosa quanto um script lento.

## Trade-offs

- **Functions exige Redis 7.0+ (2022).** Qualquer coisa rodando um Redis mais antigo, incluindo boa parte da base de instalação que os dois livros visavam na publicação, precisa continuar usando `EVAL`/`EVALSHA`. O Functions é aditivo, não uma substituição que quebra compatibilidade, mas é genuinamente indisponível abaixo da 7.0.
- **Uma biblioteca é imutável exceto como um todo.** `FUNCTION LOAD REPLACE` troca toda função da biblioteca junto; não há como fazer patch em uma função isoladamente do jeito que uma aplicação da era dos livros poderia dar `SCRIPT LOAD` em um único script revisado independentemente de todo outro script que usava. Essa garantia de consistência também é uma restrição real de deployment: um conserto de uma linha em uma função ainda significa recarregar a biblioteca inteira.
- **Flags de função são opt-in, e o padrão seguro é o restritivo.** Uma função precisa ser explicitamente registrada com `no-writes` (via a forma de argumentos nomeados) antes de `FCALL_RO` rodá-la contra uma réplica; esquecer a flag não permite escritas silenciosamente em uma réplica, mas bloqueia silenciosamente uma função somente leitura de rodar onde deveria: uma surpresa fácil de primeiro deploy ao migrar de scripts ad hoc, que não tinham essa distinção para esquecer.
- **Propagação de cluster ainda é um passo manual e fora de banda.** O Functions resolve durabilidade de master-para-réplica automaticamente, mas carregar uma biblioteca em todo master de um deployment de Redis Cluster explicitamente não é automático: a própria documentação do Redis atribui isso ao administrador do cluster, a mesma categoria de trabalho manual de sincronização que o problema de "todo cliente precisa manter uma cópia" dos livros representava, só movido de instâncias de aplicação para nós de cluster.
- **Ainda é Lua, ainda é atômico, ainda é bloqueante.** O Functions não relaxa nenhuma das restrições de execução que os livros gastam espaço real explicando: uma função que roda por muito tempo bloqueia todo outro cliente exatamente como um script faria, e a única linguagem disponível hoje é o mesmo dialeto Lua 5.1 que os livros ensinam. O debugger disponível para scripts ad hoc (o debugger de scripts Lua) explicitamente não se estende ao Functions, segundo a própria documentação do Redis: uma capacidade que o fluxo de trabalho `EVAL` dos livros tem e o Functions atualmente não.
- **Para um script genuinamente de uso único, o Functions é mais cerimônia do que o trabalho precisa.** Um script de manutenção de disparo único rodado uma vez durante um incidente não se beneficia de uma linha de shebang, uma biblioteca nomeada, e persistência no AOF: `EVAL` (ou até só `redis-cli --eval` contra um arquivo `.lua`) ainda é a ferramenta do tamanho certo para lógica que ninguém precisa que o Redis lembre depois de rodar.

## Documentation Links

- [Maxwell Dayvson Da Silva et al., "Redis Essentials" (Packt, 2015), Chapter 4, "Commands (Where the Wild Things Are)," "Scripting" and "Redis meets Lua," p. 86-90] - doc
- [Josiah Carlson, "Redis in Action" (Manning, 2013), Chapter 11, "Scripting Redis with Lua," section 11.1 "Adding functionality without writing C," p. 250-254] - doc
- [Redis Documentation: Introduction to Redis Functions (motivation, libraries, FUNCTION LOAD, flags, cluster propagation)](https://redis.io/docs/latest/develop/programmability/functions-intro/) - doc
- [Redis Documentation: FUNCTION LOAD command](https://redis.io/docs/latest/commands/function-load/) - doc
- [Redis Documentation: FCALL command](https://redis.io/docs/latest/commands/fcall/) - doc
- [Redis Documentation: FCALL_RO command](https://redis.io/docs/latest/commands/fcall_ro/) - doc
- [Redis Documentation: Introduction to Eval Scripts (EVAL, EVALSHA, SCRIPT LOAD)](https://redis.io/docs/latest/develop/programmability/eval-intro/) - doc
