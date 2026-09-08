---
version: 1.0
updatedAt: 2026-08-20
title: "ACLs e TLS Nativo no Redis: De requirepass a Controle de Acesso de Verdade"
summary: As únicas ferramentas de segurança do Redis antes de 2020 eram uma única senha compartilhada via requirepass, obscuridade via rename-command, firewall em nível de rede, e TLS envolto em stunnel já que o Redis não tinha nenhum nativamente; este conceito cobre por que isso era inadequado e percorre o conserto de verdade: o sistema de ACL do Redis 6.0 (usuários nomeados, regras por comando/categoria, acesso por padrão de chave e por canal, seletores) e TLS embutido (tls-port, mutual TLS por padrão, criptografia de cluster/replicação) que substituíram as duas lacunas.
---
## Objective

Entender como o Redis foi de uma única senha compartilhada e um punhado de workarounds em nível de rede para um sistema de controle de acesso de verdade: usuários nomeados com permissões por comando, por categoria e por padrão de chave (ACLs, Redis 6.0, 2020), e criptografia embutida diretamente no `redis-server` em vez de parafusada por fora com um proxy externo (TLS nativo, também Redis 6.0). Este conceito é explicitamente "livro vs. hoje": a única fonte de livro disponível (*Redis Essentials*, Da Silva et al., 2015) antecede completamente os dois mecanismos, porque o Redis genuinamente ainda não os tinha. O que o livro ensina (`requirepass`, `rename-command`, firewalling e `stunnel`) era o estado da arte real em 2015, e entender por que era inadequado é o que faz o design de ACL/TLS fazer sentido.

## Use Cases

- Dar a um scraper de métricas ou dashboard acesso somente leitura a um prefixo de chave específico (`~metrics:*` com `+@read`) para que um scraper comprometido ou mal configurado não consiga emitir `FLUSHALL`, `CONFIG SET`, ou escrever em chaves não relacionadas: impossível sob uma única senha compartilhada, onde todo cliente autenticado é igualmente poderoso.
- Rodar uma instância Redis multi-tenant onde o processo worker de cada tenant fica restrito ao seu próprio prefixo de chave (`~tenant42:*`) e proibido dos comandos de todo o keyspace (`FLUSHALL`, `FLUSHDB`, `SWAPDB`) que ignoram padrões de chave por completo: exatamente a lacuna que a própria documentação do Redis aponta e conserta com regras explícitas `-flushall -flushdb -swapdb`.
- Uma oferta de Redis gerenciado/em nuvem restringindo conexões de cliente de `CONFIG`, `DEBUG`, `SHUTDOWN`, e outros comandos `@admin`/`@dangerous`, mas ainda deixando-os rodar todo comando de dado que precisam: o cenário que a própria documentação de ACL do Redis nomeia como motivação principal.
- Criar usuários dedicados e com privilégio mínimo para conexões de Sentinel e réplica em vez de confiar neles com acesso completo: a documentação do Redis publica os conjuntos de regras `ACL SETUSER` exatos para os dois (o Sentinel precisa de `+multi +slaveof +ping +exec +subscribe ...`; uma réplica precisa só de `+psync +replconf +ping`).
- Criptografar tráfego cliente-para-servidor em uma instância Redis que vive em uma nuvem pública ou atravessa uma fronteira de rede, usando diretivas `tls-port` e de certificado embutidas no `redis-server`, em vez de subir e operar um par separado de processos `stunnel` como workaround para o Redis não ter TLS próprio.
- Separar as permissões de um worker de job em segundo plano para só os comandos que o job realmente precisa (`+@list +@connection`, nada mais) para que um bug ou comando injetado nesse worker não consiga tocar chaves não relacionadas ou emitir comandos de admin: a metade de segurança operacional das ACLs, não só a metade de segurança.

## Deep Dive

### A era pré-ACL: o que o livro ensina (2015)

*Redis Essentials* é explícito sobre o teto sob o qual está trabalhando: "O Redis foi projetado para ser usado em uma rede privada confiável. Ele suporta um sistema de segurança muito básico para proteger a conexão entre o cliente e o servidor via uma senha em texto plano... O Redis não implementa Access Control List (ACL). Portanto, não é possível ter usuários com níveis de permissão diferentes." Tudo no capítulo é um workaround para esse único fato.

**Uma única senha compartilhada.** `requirepass` no `redis.conf` define uma senha para o servidor inteiro; `AUTH <senha>` autentica uma conexão contra ela. O próprio conselho de segurança do livro para essa senha é revelador: "escolha uma senha complexa de pelo menos 64 caracteres", porque "o Redis é superrápido, [então] um usuário malicioso poderia potencialmente adivinhar milhares de senhas por segundo." Uma vez autenticado, um cliente pode rodar *qualquer* comando contra *qualquer* chave; não há como distribuir uma credencial mais fraca a um cliente que só precisa de acesso de leitura.

**Ofuscando comandos renomeando-os.** Para amenizar o risco de um cliente (ou atacante) chamar `FLUSHALL`, `CONFIG`, `KEYS`, `DEBUG`, ou `SAVE`, o livro te faz renomeá-los para strings aleatórias via `rename-command` em um arquivo de include do `redis.conf`:

```
rename-command FLUSHDB e0cc96ad2eab73c2c347011806a76b73
rename-command FLUSHALL a31907b21c437f46808ea49322c91d23a
rename-command CONFIG ""
rename-command KEYS ""
```

O livro sinaliza seus próprios limites com honestidade: "Renomear um comando não garante segurança, porque um atacante malicioso ainda pode usar força bruta para encontrar o nome do comando." É obscuridade, não controle de acesso: qualquer um autenticado com a única senha compartilhada ainda consegue eventualmente encontrar e rodar o comando renomeado.

**Contenção em nível de rede.** O resto do capítulo é defesa de perímetro em vez de qualquer coisa que o próprio Redis aplica: regras de firewall `iptables` restringindo quais blocos CIDR podem alcançar o servidor, associar o `redis-server` a `127.0.0.1` (a interface loopback) quando cliente e servidor compartilham uma máquina, e rodar dentro da VPC de um provedor de nuvem para que só máquinas colocalizadas consigam alcançá-lo de jeito nenhum.

**TLS via `stunnel`, porque o Redis não tinha nenhum.** "Por padrão, o Redis não suporta nenhuma criptografia... A ferramenta que vamos usar para criptografar a comunicação do Redis se chama `stunnel`. É um wrapper de criptografia SSL entre um cliente local e um servidor local ou remoto." O livro percorre a geração de um par de chaves SSL com `openssl`, e então ou roda o `stunnel` como um par correspondente de processos nas máquinas cliente e servidor (o `stunnel` do servidor aceitando em `0.0.0.0:6666` e encaminhando para `127.0.0.1:6379`; o `stunnel` do cliente aceitando localmente em `127.0.0.1:5555` e fazendo túnel para o `stunnel` do servidor), ou roda o `stunnel` só no servidor e aponta uma biblioteca de cliente capaz de SSL (o livro usa o `SSLConnection` do `redis-py`) diretamente para ele. De qualquer jeito, o TLS é um processo inteiramente separado do `redis-server`, com seu próprio arquivo de configuração, sua própria porta e seus próprios modos de falha; o próprio Redis nunca vê a camada de criptografia.

Cada uma dessas técnicas era um conselho genuinamente razoável em 2015. O problema que o livro nunca resolve (porque a ferramenta para resolvê-lo ainda não existia) é granularidade: uma senha significa um nível de confiança para todo cliente, `rename-command` é obscuridade em vez de aplicação, e firewalls/VPCs protegem o caminho de rede mas não dizem nada sobre o que um cliente já conectado tem permissão para fazer uma vez que está dentro.

### ACLs desde o Redis 6.0: usuários nomeados com fronteiras de permissão de verdade

O Redis 6.0 (2020) adicionou um sistema de Access Control List de verdade. Toda conexão se autentica como um usuário específico (um usuário `default` existe automaticamente), e cada usuário carrega suas próprias regras para quais comandos, padrões de chave e canais Pub/Sub pode tocar. `AUTH` foi estendido para uma forma de dois argumentos, `AUTH <usuário> <senha>`, com a antiga forma de um argumento `AUTH <senha>` ainda funcionando exatamente como antes ao mirar implicitamente no `default`, então `requirepass` não sumiu, ele só agora define a senha *especificamente para o usuário default*, o que é o que torna as ACLs retrocompatíveis com clientes e configurações pré-6.0.

Uma instância nova se parece com isto:

```
> ACL LIST
1) "user default on nopass ~* &* +@all"
```

`on` (habilitado), `nopass` (nenhuma senha exigida, então uma conexão não autenticada é automaticamente o usuário default), `~*` (toda chave), `&*` (todo canal Pub/Sub), `+@all` (todo comando). Esse é o mundo de "todo cliente é igualmente poderoso" em que o livro vivia, mantido como padrão por compatibilidade.

Criar um usuário restrito se parece com isto:

```
> ACL SETUSER alice on >p1pp0 ~cached:* +get
OK
> AUTH alice p1pp0
OK
> GET foo
(error) NOPERM this user has no permissions to access one of the keys used as arguments
> GET cached:1234
(nil)
> SET cached:1234 zap
(error) NOPERM this user has no permissions to run the 'set' command
```

O vocabulário de regra, todo composto em uma única chamada `ACL SETUSER <usuário> ...`:

- **Habilitar/desabilitar**: `on` / `off`: um usuário recém-criado tem como padrão `off`, `-@all`, sem padrões de chave ou canal; ACLs falham fechadas, não abertas.
- **Comandos**: `+<comando>` / `-<comando>` permitem ou removem um único comando (`+config|get` / `-config|set` miram em subcomandos especificamente, Redis 7.0+); `+@<categoria>` / `-@<categoria>` operam em uma categoria inteira de comando de uma vez: `@admin`, `@dangerous`, `@read`, `@write`, `@fast`, `@slow`, e cerca de duas dúzias de outras, enumeráveis com `ACL CAT`. `allcommands`/`nocommands` são apelidos para `+@all`/`-@all`.
- **Chaves**: `~<padrão>` é um padrão glob (estilo `KEYS`) de nomes de chave acessíveis; múltiplos padrões podem ser adicionados; `allkeys` apelida `~*`; `resetkeys` limpa a lista. O Redis 7.0 adicionou padrões com escopo de leitura/escrita, `%R~<padrão>` e `%W~<padrão>`, então um usuário pode receber acesso só leitura a um prefixo e acesso de escrita a outro sem conceder leitura-escrita completa em nenhum dos dois.
- **Canais Pub/Sub**: `&<padrão>` (Redis 6.2+), `allchannels`, `resetchannels`.
- **Senhas**: `><senha>` adiciona uma senha válida (um usuário pode ter várias); `<<senha>` remove uma; `nopass` aceita qualquer senha; `resetpass` limpa todas as senhas e a flag `nopass`. `ACL GENPASS` gera uma senha aleatória forte para que ninguém precise inventar uma.
- **Seletores** (Redis 7.0+): `(<lista de regras>)` anexa um conjunto de regras independente e alternativo ao usuário: um comando é permitido se corresponder *ou* às regras raiz *ou* a qualquer seletor. É assim que um usuário ganha dois conjuntos de capacidade não relacionados ao mesmo tempo, por exemplo `+GET ~key1 (+SET ~key2)` deixa esse usuário dar `GET key1` ou `SET key2 ...` mas não `GET key2` nem `SET key1 ...`.
- **`reset`**: retorna o usuário a seu estado recém-criado (off, sem senha, sem chaves, sem canais, sem comandos).

Inspecionando um usuário: `ACL LIST` imprime todo usuário em sintaxe compatível com `redis.conf`; `ACL GETUSER <usuário>` retorna um detalhamento estruturado (campo/valor) mais adequado para ferramentas; `ACL WHOAMI` reporta o usuário atualmente autenticado; `ACL CAT [categoria]` lista categorias, ou os comandos dentro de uma.

Uma aresta afiada que a documentação aponta diretamente: padrões de chave só restringem comandos que nomeiam chaves específicas como argumentos. Comandos de banco de dados inteiro como `FLUSHALL`, `FLUSHDB` e `SWAPDB` não recebem argumentos de chave, então um usuário restrito a `~tenant1:* +@all` ainda consegue dar `FLUSHALL` na instância inteira; o padrão nunca se aplica. Esses comandos precisam ser negados explicitamente (`-flushall -flushdb -swapdb`) independentemente de quão apertado o padrão de chave pareça.

Usuários podem ser definidos diretamente em `redis.conf` (`user <usuário> ... regras ...`) ou, para qualquer coisa além de um punhado de usuários, em um `aclfile` separado referenciado pela diretiva `aclfile`: os dois são mutuamente exclusivos. Um arquivo de ACL externo suporta `ACL LOAD` (recarregar do disco depois de uma edição manual) e `ACL SAVE` (persistir o estado de ACL ao vivo na memória de volta para o arquivo), independentemente de `CONFIG REWRITE`.

### TLS nativo desde o Redis 6.0: chega de `stunnel`

O mesmo release 6.0 que introduziu ACLs também deu ao `redis-server` suporte a TLS embutido opcional (compilado com `make BUILD_TLS=yes`, exigindo OpenSSL). Onde o livro precisava rodar um par de processos `stunnel` inteiramente separado com suas próprias portas e arquivos de configuração, o TLS hoje é um punhado de diretivas de `redis.conf` no próprio processo Redis do servidor:

```
tls-port 6379
tls-cert-file /path/to/redis.crt
tls-key-file /path/to/redis.key
tls-ca-cert-file /path/to/ca.crt
tls-dh-params-file /path/to/redis.dh
```

`tls-port` é *aditiva* à `port` em texto plano: um servidor pode aceitar conexões TLS e não TLS em portas diferentes simultaneamente, ou o texto plano pode ser desabilitado por completo com `port 0` para forçar somente TLS:

```
port 0
tls-port 6379
```

Por padrão o Redis usa **TLS mútuo**: clientes precisam apresentar um certificado que valida contra a CA configurada, não só verificar o certificado do servidor. Isso é um padrão significativamente mais forte do que a configuração `stunnel` do livro, que só exigia um arquivo de chave privada compartilhado. A autenticação de cliente pode ser desabilitada com `tls-auth-clients no` se só criptografia do lado do servidor for desejada. `tls-replication yes` estende o TLS a links master-réplica, e `tls-cluster yes` o estende ao bus do Redis Cluster e tráfego entre nós, nenhum dos quais o `stunnel` conseguia alcançar facilmente, já que ele envolve uma conexão cliente-servidor por vez em vez dos próprios protocolos internos do Redis.

Conectando com `redis-cli` via TLS:

```
./redis-cli --tls --cert ./redis.crt --key ./redis.key --cacert ./ca.crt
```

versus a abordagem do livro de apontar um `redis-cli` simples (não TLS) para uma porta local do `stunnel` que fazia a criptografia em seu nome.

### Livro vs. hoje

> **O capítulo de `stunnel` do livro não está errado, está datado.** Tudo que o livro diz sobre o `stunnel` era preciso e razoável para uma instância Redis de 2015, porque o `stunnel` genuinamente era a única forma de colocar TLS na frente do Redis na época. O que mudou não é que a técnica do livro parou de funcionar (o `stunnel` ainda funciona como um wrapper TLS genérico para qualquer serviço TCP); é que o Redis absorveu a capacidade diretamente, removendo um processo extra inteiro, um arquivo de configuração extra, uma porta extra para colocar no firewall, e uma coisa a mais que pode travar ou ser mal configurada independentemente do próprio `redis-server`. `tls-cluster` e `tls-replication` também alcançam tráfego interno do Redis que um wrapper `stunnel` em volta da porta voltada para o cliente nunca tocava de jeito nenhum.
>
> **`rename-command` não tanto foi substituído, mas se tornou desnecessário para seu propósito declarado.** O livro usa renomeação como substituto de controle de acesso de verdade: esconda `FLUSHALL` sob uma string aleatória porque não há como dizer "esse cliente não pode chamar `FLUSHALL`". ACLs dizem isso diretamente: `-flushall` na lista de regras de um usuário é aplicado, não obscurecido. `rename-command` ainda existe no Redis moderno como uma diretiva legítima de defesa em profundidade (ainda literalmente funciona, e combina bem com ACLs), mas a justificativa específica do livro para ela ("não temos outra forma de restringir esse comando por cliente") se foi.
>
> **`requirepass` não está obsoleto, está absorvido.** Uma instância Redis moderna usando só `requirepass` e nenhuma outra configuração de ACL se comporta exatamente como o livro descreve: uma senha, acesso completo uma vez autenticado. Isso não é um fallback legado parafusado por compatibilidade; é `requirepass` definindo a senha no usuário `default`, que é só um usuário de ACL com `+@all ~* &*` embutido. O modelo de segurança inteiro do livro ainda é totalmente expressável como uma configuração de ACL específica (muito permissiva); só não é mais a única opção, e não é o padrão seguro para um usuário novo e restrito (que começa `off`, `-@all`, sem chaves).

## Trade-offs

- **ACLs trocam uma senha de uma linha por uma superfície administrativa de verdade.** `requirepass` é uma única linha de configuração; um deployment de ACL multiusuário significa manter um `aclfile` (ou blocos de usuário em `redis.conf`), decidir o que cada papel de fato precisa, e mantê-lo em sincronia conforme comandos e categorias mudam entre versões do Redis. Para um único serviço interno confiável batendo em uma instância Redis, o modelo `requirepass` do livro ainda é uma escolha defensável e de baixo overhead; ACLs recompensam seu custo quando vários clientes distintos precisam de níveis de confiança distintos.
- **Padrões de chave não cobrem comandos de banco de dados inteiro, e essa lacuna é fácil de perder de vista.** `FLUSHALL`, `FLUSHDB` e `SWAPDB` não recebem argumentos de chave, então nenhum `~padrão` os restringe; a própria documentação do Redis dá o caso de falha exato: um usuário restrito a `~tenant1:*` ainda consegue detonar o keyspace inteiro a menos que esses comandos sejam negados explicitamente. Um padrão de chave bem restrito pode criar falsa confiança se as negações em nível de comando não forem escritas com a mesma explicitude.
- **Seletores adicionam poder real ao custo de legibilidade.** `+GET ~key1 (+SET ~key2)` é preciso, mas um usuário com vários seletores exige ler as regras raiz *e* todo seletor para saber o que de fato pode fazer, já que um comando é permitido se corresponder a *qualquer um* deles. É a ferramenta certa para "esse usuário genuinamente precisa de dois conjuntos de capacidade não relacionados", e overkill para qualquer coisa mais simples do que isso.
- **`rename-command` ainda é segurança por obscuridade, mesmo pós-ACL.** É uma camada legítima de defesa em profundidade junto com ACLs (elevando a barra para quem já comprometeu uma conexão de baixo privilégio e está tentando adivinhar nomes de comando de admin), mas nunca foi controle de acesso de verdade e ainda não é: um atacante determinado com uma conexão autenticada e tentativas suficientes ainda consegue encontrar um comando renomeado. Regras de ACL `-comando`/`-@categoria` são a aplicação de fato; renomear é um passo secundário de hardening, não um substituto.
- **TLS nativo é um custo real de throughput, agora pago diretamente pelo `redis-server` em vez de por um processo separado.** A própria documentação do Redis é explícita que TLS "resulta em uma diminuição do throughput alcançável por instância Redis" devido ao overhead de criptografia, descriptografia e checagem de integridade em toda conexão. Com `stunnel`, esse custo ficava em um processo separado que podia ser escalado ou movido independentemente; com TLS nativo ele está inline no mesmo processo servindo comandos, embora o Redis 8.0 tenha adicionado suporte a I/O threading especificamente para TLS para recuperar parte disso.
- **Suporte a TLS precisa ser compilado, não está automaticamente presente.** `BUILD_TLS=yes` no momento da compilação (mais bibliotecas de desenvolvimento do OpenSSL) é um pré-requisito; um binário padrão construído sem essa flag não tem nenhum `tls-port` para configurar de jeito nenhum. Confirmar que TLS de fato está disponível antes de projetar em torno dele é um primeiro passo real, diferente da abordagem `stunnel` do livro, que se sobrepõe a *qualquer* build do Redis já que nunca toca o próprio binário do Redis.
- **TLS mútuo é o padrão, o que é mais rígido do que a maioria das equipes espera na primeira configuração.** O Redis exige certificados de cliente por padrão uma vez que `tls-port` está configurado, não só um certificado de servidor confiável: um modo de falha significativamente diferente da configuração `stunnel` de chave compartilhada do livro ou de uma senha `requirepass` simples. Desligar isso (`tls-auth-clients no`) é uma diretiva, mas é fácil bater nisso como uma falha de conexão surpreendente na primeira vez que o TLS é habilitado sem um certificado de cliente provisionado.

## Documentation Links

- [Maxwell Dayvson Da Silva et al., "Redis Essentials" (Packt, 2015), Chapter 7, "Security Techniques (Guard Your Data)," p. 131-140] - doc
- [Redis Documentation: ACL (rules, categories, selectors, external ACL files, Sentinel/replica user examples)](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/) - doc
- [Redis Documentation: TLS (build flags, tls-port, certificate directives, mutual TLS, cluster/replication TLS)](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/) - doc
- [Redis Documentation: ACL SETUSER command](https://redis.io/commands/acl-setuser/) - doc
- [Redis Documentation: AUTH command (username/password form)](https://redis.io/commands/auth/) - doc
- [Redis Documentation: ACL CAT command](https://redis.io/commands/acl-cat/) - doc
