---
version: 1.0
updatedAt: 2026-08-20
title: "Tipos de Dados Principais do Redis: Strings, Lists e Hashes"
summary: Strings, Lists e Hashes do Redis são três estruturas distintas, não variações de chave-valor; Strings guardam bytes/inteiros/floats com SET/GET/INCR atômicos e um teto de 512 MB; Lists são listas encadeadas de verdade dando push/pop O(1) em qualquer ponta via LPUSH/RPUSH/LPOP/RPOP/LRANGE (O(N) para qualquer outra coisa) e alimentam filas via BRPOP/RPOPLPUSH; Hashes mapeiam campos String para valores String via HSET/HGET/HGETALL/HINCRBY, consolidando campos relacionados (um case study da Instagram cortou 21 GB para aproximadamente 5 GB migrando de chaves String por campo para Hashes); e desde o Redis 7.0 a codificação interna compacta que os dois livros chamam de ziplist é renomeada para listpack.
---
## Objective

Entender os três tipos de dado mais comuns do Redis (**Strings**, **Lists** e **Hashes**) não como três sabores da mesma ideia de chave-valor, mas como três estruturas distintas com sua própria superfície de comando, seu próprio comportamento de Big-O, e sua própria codificação interna. *Redis in Action* enquadra o motivo inteiro de existir mais de um tipo logo de cara: "O Redis nos permite armazenar chaves que mapeiam para qualquer um de cinco tipos diferentes de estrutura de dados." *Redis Essentials* coloca a mesma ideia de forma mais direta: "A principal razão para o Redis ter muitos tipos de dado é bem simples: um tamanho não serve para tudo, e problemas diferentes exigem soluções diferentes." Este conceito é sobre escolher o certo e conhecer os comandos que o fazem funcionar.

## Use Cases

- **Cachear um fragmento de página, uma resposta de API, ou um valor renderizado**: `SET`/`GET` simples, opcionalmente com `SETEX`/`EXPIRE` para que o cache se autoexpira: "Strings combinadas com expiração automática de chave conseguem fazer um sistema de cache robusto... muito útil quando consultas de banco de dados demoram para rodar e podem ser cacheadas por um dado período de tempo."
- **Um contador de visualização, de curtida, de rate limit**: `INCR`/`INCRBY` em uma String, atomicamente, sem corrida de leitura-modificação-escrita: "Bons exemplos de contadores são visualizações de página, visualizações de vídeo e curtidas."
- **Uma fila de trabalho entre um processo produtor e um consumidor**: `LPUSH` em uma ponta, um `BRPOP` bloqueante na outra, exatamente o padrão que *Redis Essentials* constrói como uma classe `Queue` em Node.js com métodos `push`/`pop` apoiados em `LPUSH`/`BRPOP`.
- **Uma lista limitada de itens recentes**: os N tweets mais recentes, os N produtos vistos mais recentes, empurrados com `LPUSH`/`RPUSH` e aparados com `LTRIM`, contando com push/pop O(1) em qualquer ponta.
- **Um objeto com vários campos nomeados que pertencem juntos**: o título, autor e contagem de votos de um artigo, ou o próprio exemplo de *Redis Essentials*, o título/ano/nota/contagem de espectadores de um filme, armazenados como um Hash em vez de várias chaves String separadas, porque "é mais semântico usar um Hash nesse caso, já que os dois campos pertencem ao mesmo objeto."
- **Armazenamento eficiente em memória de milhões de objetos pequenos**: o case study da Instagram que *Redis Essentials* cita diretamente: referenciar de volta 300 milhões de IDs de mídia para IDs de usuário "usava uma chave por ID de mídia e cerca de 21 GB de memória" como Strings, contra "cerca de 5 GB com alguns ajustes de configuração" uma vez trocado para Hashes.

## Deep Dive

### Strings: a primitiva versátil

Uma String do Redis não é "só texto." *Redis Essentials* é explícito que "uma String pode se comportar como um inteiro, float, string de texto, ou bitmap dependendo de seu valor e dos comandos usados. Ela pode armazenar qualquer tipo de dado: texto (XML, JSON, HTML, ou texto bruto), inteiros, floats, ou dados binários (vídeos, imagens, ou arquivos de áudio)." O capítulo focado em comandos de *Redis in Action* é mais preciso sobre a mesma ideia: "No Redis, STRINGs são usadas para armazenar três tipos de valor: valores de byte string, valores inteiros, valores de ponto flutuante." O tipo que o Redis atribui internamente depende do que você coloca dentro, não de um schema que você declarou. Um limite que a era dos dois livros compartilha com hoje: **"um valor não pode ser maior do que 512 MB."**

Os comandos principais:

| Comando | O que faz |
|---|---|
| `SET` / `GET` | "Conseguimos dar GET em valores, SET em valores e DEL em valores": a leitura/escrita base. |
| `MSET` / `MGET` | Define ou busca várias chaves em uma ida e volta: "os argumentos são pares chave-valor separados por espaços" para `MSET`; `MGET` retorna `nil` "para toda chave que não guarda um valor String ou não existe." |
| `SETEX` / `EXPIRE` / `TTL` | Anexa uma expiração; `TTL` retorna os segundos restantes, `-1` se a chave não tem expiração, `-2` se ela se foi. |
| `INCR` / `INCRBY` / `DECR` / `DECRBY` / `INCRBYFLOAT` | Mutação numérica atômica: "incrementa uma chave em 1 e retorna o valor incrementado": com `INCRBY`/`DECRBY`/`INCRBYFLOAT` recebendo uma quantidade explícita. |
| `APPEND` / `GETRANGE` / `SETRANGE` | Manipulação em nível de byte da string sem uma ida e volta completa de leitura-modificação-escrita. |
| `GETBIT` / `SETBIT` / `BITCOUNT` / `BITOP` | Trata a mesma String como um array de bits para problemas estilo bitmap. |

A atomicidade do `INCR` é o detalhe que torna contadores seguros sem nenhum lock em nível de aplicação: "esses comandos são atômicos, o que significa que incrementam/decrementam e retornam o novo valor como uma única operação. Não é possível dois clientes diferentes executarem o mesmo comando ao mesmo tempo e obterem o mesmo resultado; nenhuma condição de corrida acontece com esses comandos." *Redis Essentials* rastreia o mecanismo até o modelo de execução do Redis: "o Redis é single-threaded, o que significa que ele sempre executa um comando por vez... uma condição de corrida nunca vai acontecer quando vários clientes tentam realizar operações na mesma chave ao mesmo tempo." Dois `INCR`s concorrentes em um contador começando em 1 produzem deterministicamente 2 e 3, nunca uma atualização perdida.

### Lists: listas encadeadas com push/pop atômicos

*Redis in Action* aponta o que torna o Redis incomum entre armazenamentos chave-valor: "no mundo dos armazenamentos chave-valor, o Redis é único no sentido de que suporta uma estrutura de lista encadeada." *Redis Essentials* nomeia três formatos que uma List pode assumir: "Lists são um tipo de dado muito flexível no Redis porque conseguem agir como uma coleção simples, pilha, ou fila." Essa flexibilidade vem de onde uma List deixa você tocá-la: as duas pontas, em tempo constante: "as Lists do Redis são listas encadeadas, portanto inserções e exclusões do início ou do fim de uma List rodam em O(1), tempo constante. A tarefa de acessar um elemento em uma List roda em O(N), tempo linear, mas acessar o primeiro ou o último elemento sempre roda em tempo constante." Uma List não é uma boa opção para "me dê o item #500.000"; é uma opção excelente para "me dê o item mais novo" ou "me dê o item mais antigo."

Os comandos principais:

| Comando | O que faz |
|---|---|
| `LPUSH` / `RPUSH` | Empurra valor(es) para a ponta esquerda (cabeça) ou direita (cauda). `LPUSH` "insere dados no início de uma List (push pela esquerda)", `RPUSH` "no final (push pela direita)." |
| `LPOP` / `RPOP` | Remove e retorna o elemento mais à esquerda ou mais à direita: as operações que de fato modificam a lista, diferente de `LINDEX`. |
| `LRANGE` | "Retorna um array com todos os elementos de uma dada faixa de índice, incluindo os elementos tanto no índice inicial quanto no final", baseado em zero, índices negativos contando a partir da cauda (`-1` é o último elemento). |
| `LINDEX` | Busca um elemento em uma dada posição sem modificar a lista: O(N) para percorrer até esse offset. |
| `LTRIM` | Apara a lista para só os elementos entre dois índices, descartando o resto: o bloco de construção para uma lista limitada de "N mais recentes." |
| `BLPOP` / `BRPOP` | Pop bloqueante: "quando um cliente executa um comando bloqueante em uma List vazia, o cliente vai esperar por um novo item ser adicionado." |
| `RPOPLPUSH` / `BRPOPLPUSH` | Faz pop de uma lista e push em outra atomicamente em um único passo: "faz um RPOP em uma fila, depois faz um LPUSH em uma fila diferente, e finalmente retorna o elemento, tudo em um único passo." |

O padrão de fila vale a pena nomear explicitamente porque recorre em todo lugar onde Lists são usadas para distribuição de trabalho: push com `LPUSH`, pop bloqueante com `BRPOP`, e você tem ordenação FIFO: "itens são inseridos na frente da fila e removidos do final da fila... FIFO (First In, First Out), fomos da esquerda para a direita." *Redis Essentials* constrói exatamente isso como uma pequena classe `Queue` em torno de `LLEN`/`LPUSH`/`BRPOP`, e sinaliza sua própria limitação: um consumidor de `BRPOP` puro "não é confiável o bastante para colocar em produção... se algo der errado com os callbacks que fazem pop da fila, itens podem ser removidos mas não tratados adequadamente." O conserto que ele aponta é `RPOPLPUSH` para uma segunda lista de "processamento" da qual você só remove uma vez que o trabalho de fato termina: um padrão depois formalizado como o idioma de fila confiável (e eventualmente substituído por Streams, fora do escopo deste conceito).

### Hashes: mapas de campo-valor

Um Hash é onde o formato "uma chave, vários campos relacionados" de fato ganha uma estrutura de primeira classe em vez de uma convenção de nomenclatura. *Redis in Action* traça o contraste diretamente: "enquanto LISTs e SETs no Redis guardam sequências de itens, os HASHes do Redis armazenam um mapeamento de chaves para valores." *Redis Essentials* é preciso sobre os tipos envolvidos: "em um Hash, tanto o nome do campo quanto o valor são Strings. Portanto, um Hash é um mapeamento de uma String para uma String." Os dois livros usam o mesmo exemplo de antes/depois para motivar recorrer a um Hash: em vez de duas chaves String separadas (`article:<id>:headline`, `article:<id>:votes`) você tem uma chave Hash (`article:<id>`) com dois campos: "é mais semântico usar um Hash nesse caso, já que os dois campos pertencem ao mesmo objeto."

Os comandos principais:

| Comando | O que faz |
|---|---|
| `HSET` / `HMSET` | Define um campo, ou vários de uma vez. "Tanto HSET quanto HMSET criam um campo se ele não existir, ou sobrescrevem seu valor se já existir." |
| `HGET` / `HMGET` | Busca um campo, ou vários de uma vez, por nome. |
| `HGETALL` | "Busca o hash inteiro": todo par campo/valor como um único array/dict. |
| `HDEL` | Remove um campo: "retorna se o item estava lá antes de tentarmos removê-lo." |
| `HKEYS` / `HVALS` | Busca só os nomes de campo ou só os valores, útil "quando você espera que seus valores sejam grandes" e não quer o payload completo do `HGETALL`. |
| `HEXISTS` / `HLEN` | Checa se um campo existe, ou conta quantos campos um Hash tem, sem transferir nenhum valor. |
| `HINCRBY` / `HINCRBYFLOAT` | O equivalente de `INCR`/`INCRBY` para campo de Hash: "não existe um comando HDECRBY em Hash. A única forma de decrementar um campo de Hash é usando HINCRBY com um número negativo." |
| `HSCAN` | Itera os campos de um Hash em pedaços baseados em cursor em vez de puxar tudo com `HGETALL`: o conserto documentado para "um Hash [que] tem muitos campos e usa muita memória", onde `HGETALL` "pode deixar o Redis mais lento porque precisa transferir todo esse dado pela rede." |

*Redis in Action* estende a analogia para leitores vindos de outros bancos de dados: "podemos considerar um HASH do Redis como parecido com um documento em um armazenamento de documentos, ou uma linha em um banco de dados relacional, no sentido de que conseguimos acessar ou mudar campos individuais ou múltiplos de uma vez." Essa é a razão prática para preferir um Hash em vez de N chaves String separadas para o mesmo objeto lógico: uma chave para expirar, uma chave para apagar, uma chave cujos campos você consegue atualizar independentemente sem nunca tocar nos outros.

### Escolhendo entre eles

Os três tipos respondem a perguntas diferentes sobre o mesmo pedaço de dado:

- **Isso é um valor só, ou um valor com subpartes nas quais preciso de operações atômicas individualmente?** Um contador de visualização de página é um valor só → String + `INCR`. O título/ano/nota/contagem de espectadores de um filme são quatro subpartes relacionadas de um objeto → Hash, para que `HINCRBY` consiga incrementar `watchers` sem tocar em `title`.
- **A ordem importa, e eu só toco nas pontas?** Uma fila, uma pilha, ou um feed de "N mais recentes" → List, porque push/pop em qualquer ponta é O(1) e `LTRIM` limita o tamanho de graça.
- **Estou prestes a armazenar os mesmos campos lógicos sob várias chaves separadas?** Esse é o sinal da Instagram: uma chave String por ID de mídia custava 21 GB; consolidar campos relacionados em Hashes cortou para aproximadamente 5 GB. Sempre que uma convenção de nomenclatura como `entity:<id>:field1`, `entity:<id>:field2` aparece em chaves String, geralmente isso é um Hash tentando acontecer.

### Livro vs. hoje

> Os dois livros descrevem a codificação interna otimizada em memória de um Hash como uma **ziplist**: "internamente, um Hash pode ser uma ziplist ou uma tabela hash... Embora uma ziplist tenha otimizações de memória, buscas não são realizadas em tempo constante." Esse nome só é atual até o Redis 6.2. **O Redis 7.0 renomeou a codificação compacta de `ziplist` para `listpack`** tanto para Hashes quanto para Lists e Sorted Sets: `OBJECT ENCODING` em um Hash pequeno hoje reporta `listpack`, não `ziplist`, e as chaves de ajuste que os livros mencionam como `hash-max-ziplist-entries`/`hash-max-ziplist-value` e `list-max-ziplist-size` agora são `hash-max-listpack-entries`/`hash-max-listpack-value` e `list-max-listpack-size` (as antigas configurações com nome ziplist ainda funcionam como aliases por retrocompatibilidade). O mecanismo que os livros descrevem (coleções pequenas armazenadas compactamente, promovidas para uma tabela hash completa ou estrutura encadeada uma vez que ultrapassam um limiar de tamanho) é inalterado; só o nome mudou. Tudo mais neste conceito (`SET`/`GET`/`INCR`, `LPUSH`/`RPUSH`/`LPOP`/`RPOP`/`LRANGE`, `HSET`/`HGET`/`HGETALL`, e suas garantias de atomicidade) ainda é exatamente como o Redis atual se comporta; este é um dos cantos mais duráveis dos dois livros.

## Trade-offs

- **Strings são o tipo mais flexível e o mais fácil de usar errado como substituto de estrutura.** Uma String pode guardar qualquer coisa, mas no momento em que você está armazenando `article:<id>:headline` e `article:<id>:votes` como duas chaves para um objeto lógico, você reinventou um Hash com ergonomia pior: duas idas e voltas para buscar os dois campos, duas chaves para expirar em sincronia, e nenhuma forma de atualizar um campo atomicamente em relação ao outro exceto por truques de `INCR`. Os números da Instagram no Deep Dive não são um caso de borda; overhead por chave em milhões de Strings pequenas é um custo de memória real e às vezes dominante.
- **A garantia O(1) de uma List só vale nas pontas.** `LPUSH`/`RPUSH`/`LPOP`/`RPOP`/`BLPOP`/`BRPOP` são todos O(1); `LINDEX` e qualquer acesso baseado em offset são O(N), porque é uma estrutura encadeada de verdade, não um array. Uma List é a ferramenta certa para uma fila ou um feed de itens recentes limitado e a ferramenta errada para "me dê o elemento 40.000 de 100.000"; esse padrão de acesso quer uma estrutura diferente (ou um Sorted Set, que troca custo de inserção por acesso de faixa ordenado por score).
- **Comandos de pop bloqueante (`BLPOP`/`BRPOP`) mantêm uma conexão de cliente aberta enquanto esperam.** Esse é o comportamento certo para um worker dedicado a consumir uma fila, e o comportamento errado para um pool de conexão de tratamento de requisição, onde uma chamada bloqueante travada pode silenciosamente esgotar conexões disponíveis sob carga.
- **Uma fila `LPUSH`/`BRPOP` pura não é segura contra perda de entrega por si só.** O livro é explícito sobre isso: um item pode ser removido por `BRPOP` e depois perdido se o consumidor travar ou seu callback lançar um erro antes de terminar o trabalho. `RPOPLPUSH`/`BRPOPLPUSH` para uma lista de processamento é a mitigação que o livro mostra (pop-e-estacionar atômico para que os itens de um consumidor que travou ainda sejam encontráveis), mas isso ainda exige que o consumidor explicitamente remova da lista de processamento em caso de sucesso; nada faz isso automaticamente.
- **`HGETALL` em um Hash grande é um risco de banda e latência, não só uma escolha de estilo.** Todo campo e valor cruza a rede em uma única resposta. A iteração baseada em cursor do `HSCAN`, ou `HKEYS` seguido de chamadas `HGET`/`HMGET` direcionadas, trocam uma ida e volta por várias, mas evitam bloquear a thread única de processamento de comando do Redis transferindo um payload grande e evitam puxar dados que quem chamou pode ainda não precisar.
- **A ausência de `HDECRBY` do `HINCRBY` é uma assimetria de API real (ainda que menor).** Não há um comando dedicado de decremento para campos de Hash; `HINCRBY key field -N` é a única forma, o que é fácil de errar uma vez (uma quantidade positiva onde uma negativa era pretendida) comparado com Strings, que têm comandos dedicados `DECR`/`DECRBY`.
- **Escolher um tipo é uma decisão de design por chave feita uma vez, e é caro de mudar depois.** Diferente de um tipo de coluna relacional, o tipo de uma chave do Redis é fixo por qualquer comando de escrita que a criou; não existe um "converta essa String em um Hash" no lugar. Migrar de Strings `article:<id>:votes` para um Hash `article:<id>` depois significa uma migração de dado de verdade, não uma alteração de schema. O custo que o livro sinaliza para escolher errado é medido em gigabytes de RAM e uma reescrita de aplicação, não latência de consulta.

## Documentation Links

- [Carlos Da Silva, Marc Bächinger, "Redis Essentials" (Packt Publishing, 2015), Chapter 1, "Getting Started" ("Redis data types": Strings, Lists, Hashes), p. 9-26](https://www.packtpub.com/en-us/product/redis-essentials-9781784392451) - doc
- [Josiah L. Carlson, "Redis in Action" (Manning Publications, 2013), Section 1.2, "What Redis data structures look like", p. 7-15](https://www.manning.com/books/redis-in-action) - doc
- [Josiah L. Carlson, "Redis in Action" (Manning Publications, 2013), Chapter 3, "Commands in Redis", Sections 3.1 Strings, 3.2 Lists, 3.4 Hashes, p. 40-51](https://www.manning.com/books/redis-in-action) - doc
- [Redis Documentation: Strings](https://redis.io/docs/latest/develop/data-types/strings/) - doc
- [Redis Documentation: Lists](https://redis.io/docs/latest/develop/data-types/lists/) - doc
- [Redis Documentation: Hashes](https://redis.io/docs/latest/develop/data-types/hashes/) - doc
- [Redis Documentation: OBJECT ENCODING (ziplist to listpack rename, Redis 7.0)](https://redis.io/docs/latest/commands/object-encoding/) - doc
- [Redis Documentation: SET / GET / INCR / INCRBY](https://redis.io/docs/latest/commands/set/) - doc
- [Redis Documentation: LPUSH / RPUSH / LPOP / RPOP / LRANGE](https://redis.io/docs/latest/commands/lrange/) - doc
- [Redis Documentation: HSET / HGET / HGETALL](https://redis.io/docs/latest/commands/hgetall/) - doc
