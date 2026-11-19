---
version: 1.0
updatedAt: 2026-11-19
title: "Redis com StackExchange.Redis: estruturas, pub/sub e locks"
summary: Redis medido a partir de C# em Docker: multiplexador único contra um por chamada, queda do servidor, transação sem rollback, Pub/Sub contra Streams, rate limiter com sorted set, eviction apagando lock, lock distribuído com pausa além do TTL e fencing token, o debate do Redlock, stampede, licenças (Redis, Valkey, Garnet).
---
## Objective

Num serviço .NET o Redis costuma entrar como backend do `IDistributedCache`, mas ele é um servidor de estruturas de dados e um ponto de coordenação, e a maioria dos bugs de produção vem de esquecer isso. Esta lição roda o StackExchange.Redis contra servidores reais e mede o que acontece: um multiplexador contra um por chamada, um servidor que morre no meio do tráfego, uma "transação" sem rollback, Pub/Sub contra Streams quando o consumidor está fora, um rate limiter com sorted set, a eviction apagando a chave de um lock e o centro de tudo: um lock distribuído cujo dono pausa além do TTL, a escrita atrasada que isso causa e o fencing token que a impede. Depois vêm o debate do Redlock (Kleppmann contra Sanfilippo), o stampede de cache e o cenário de licenças (Redis, Valkey, Garnet). Versões: `StackExchange.Redis` 3.4.35, `Microsoft.Extensions.Caching.StackExchangeRedis` 10.0.15, `Microsoft.Extensions.Caching.Hybrid` 10.11.0, `RedLock.net` 2.3.2, `System.Threading.RateLimiting` 10.0.15, `net10.0`, SDK 10.0.100. Servidores em Docker num notebook, por loopback: `redis:8.8.4-alpine`, `valkey/valkey:9.1.4-alpine`, `ghcr.io/microsoft/garnet` 2.2.13. Fontes consultadas em 2026-11-19. A documentação do cliente mudou de endereço: `stackexchange.github.io/StackExchange.Redis` agora responde 404 e o README aponta para `seredis.dev`.

## Use Cases

- Compartilhar contadores, rankings, limites de taxa e filas de trabalho entre várias instâncias de um serviço.
- Garantir que só uma instância da frota rode o job noturno (lock por eficiência).
- Trocar um Pub/Sub que perde mensagens, ou um `Channel<T>` em memória, por um consumer group durável.
- Decidir se um lock pode proteger dinheiro ou apenas evitar trabalho duplicado, e escolher Redis, Valkey ou Garnet sabendo a licença.

## Deep Dive

### Um multiplexador por processo

O `ConnectionMultiplexer` é dono dos sockets e multiplexa todos os chamadores neles; `IDatabase` é um handle barato. Registre um único `IConnectionMultiplexer` como singleton. Criando um por chamada, 300 PINGs:

```text
new multiplexer per call: 1.42 ms/call (300 calls)
shared multiplexer, sequential PING: 191 us/call
shared multiplexer, 20000 concurrent PINGs (implicit pipelining): total 12 ms
```

Cerca de 7 vezes mais lento por chamada, fora um socket e um handshake a cada vez. Os 191 us são loopback do Docker; a linha concorrente mostra o pipelining: chamadas feitas enquanto outras estão em voo dividem a conexão, então `await Task.WhenAll(...)` sobre muitos comandos custa bem menos que aguardar um por um. Defaults impressos por `ConfigurationOptions.Parse`: `AbortOnConnectFail=True ConnectTimeout=5000 SyncTimeout=5000 AsyncTimeout=5000 ConnectRetry=3`. Sem nada escutando, `ConnectAsync` lança `RedisConnectionException`; com `abortConnect=false` ele retorna depois do timeout de conexão com `IsConnected=False`, e um comando falha com `The message timed out in the backlog attempting to send because no connection became available (5000ms)`. Uma aplicação web deve usar `abortConnect=false` para que um Redis fora do ar na partida não derrube o host.

### Quando o Redis morre no meio do tráfego

Um laço fazendo `INCR` a cada 250 ms, `docker stop` em 1 s, `docker start` depois, timeouts de 2 s:

```text
default policy:   INCR failed after 2828 ms: RedisConnectionException: The message timed out in the backlog ... (2000ms)
                  (every call hangs until the timeout, restored about 3 s after the container came back)
BacklogPolicy.FailFast:  INCR failed after 0 ms: RedisConnectionException: No connection is active/available ...
                  INCR ok again 851 ms after docker start; the multiplexer reconnected by itself
```

O padrão enfileira comandos enquanto está desconectado, então cada chamador espera o timeout inteiro (threads de requisição se acumulam); `FailFast` responde na hora e deixa um circuit breaker agir. Nos dois casos o multiplexador reconecta sozinho e os eventos `ConnectionFailed`/`ConnectionRestored` disparam. Trate o Redis como dependência pouco confiável: envolva as chamadas com as políticas de [resiliência](resilience-retries-timeouts-and-circuit-breakers) e decida por uso o que uma falha significa (cache: vá à fonte; lock: não execute).

### "Transações" não têm rollback

`CreateTransaction()` envia `MULTI`/`EXEC`; `AddCondition` usa `WATCH`. Uma condição falsa aborta, mas um comando que dá erro dentro do `EXEC` não desfaz os vizinhos:

```text
condition true: committed=True a=70 b=30
condition false: committed=False a=70
exec=True   cmd1=True cmd3=True
  cmd2 failed: RedisServerException: ERR value is not an integer or out of range
  ok=written ok2=written too (no rollback)
```

Comandos enfileirados numa transação não leem, então "ler, decidir, escrever" exige condições ou um script Lua. `CreateBatch()` serve só para enviar junto, não para atomicidade.

### Estruturas e suas armadilhas

```csharp
await db.StringIncrementAsync("ctr");                          // atomic on the server
await db.StringSetAsync("lock", token, TimeSpan.FromSeconds(10), When.NotExists); // SET NX EX
```

```text
INCR 100 tasks x 1000 concurrent => 100000
GET then SET 100 tasks x 100 concurrent => 197 (expected 10000)
SET NX first=True second=False; LPOP => job1; worker crashes; job1 is gone for good
HyperLogLog 1,000,000 distinct: 999,674 (error 0.03%); MEMORY USAGE 14,360 bytes vs 45,277,578 for a SET
```

`INCR` é atômico; ler-modificar-escrever no cliente é a mesma atualização perdida de quando se faz em memória. Uma lista como fila perde o job retirado por um worker que cai (use um stream ou `LMOVE` para uma lista de processamento). Um sorted set (`SortedSetAddAsync`, `SortedSetRangeByRankWithScoresAsync`) dá rankings; empates ordenam pelo membro. O HyperLogLog conta únicos em até 12 KB com erro padrão de 0,81% (docs do Redis); esta execução ficou em 0,03%.

### Pub/Sub perde mensagens, Streams não

Um publicador envia 100 números para um canal e para um stream; o assinante e o consumidor caem na mensagem 31 e voltam na 61:

```text
Pub/Sub: published 100, received 70, missing 30 (31..60: 30 of 30 lost)
Stream : added 100, read 100, distinct 100, missing 0
```

Pub/Sub é at-most-once para quem está conectado agora: sem persistência, sem replay. Use para dicas de invalidação de cache e fan-out ao vivo. Um stream com consumer group guarda as entradas até serem aparadas. Um consumidor lê 20, confirma 12 e morre:

```text
XPENDING summary: 8 pending, consumers: c1=8
XAUTOCLAIM min-idle 60s right away: claimed 0
XAUTOCLAIM min-idle 1s after 1.5s: claimed 8; delivery count 2
handled 100 deliveries, 100 distinct ids, none lost; stream length after all acks: 100
```

`StreamReadGroupAsync(">")` entrega entradas novas; as não confirmadas ficam pendentes até o `StreamAutoClaimAsync` passá-las a outro consumidor depois do tempo ocioso. Isso é at-least-once: um consumidor que morre depois do trabalho e antes do `XACK` processa duas vezes, então os handlers precisam ser idempotentes (veja [o concept do outbox](transactional-outbox-inbox-and-idempotent-consumers)). `XACK` não apaga; apare com `MAXLEN`. Keyspace notifications (docs only) usam o Pub/Sub, que a documentação chama de fire and forget, então herdam a perda.

### Um rate limiter com sorted set e por que ele difere do embutido

Uma entrada por requisição pontuada pelo tempo, e um script Lua que apara e conta atomicamente (o script lê `TIME` no servidor, então os relógios das instâncias não importam):

```text
Redis sorted-set window, limit 10/s, 2 instances x 15 requests: admitted 5 + 5 = 10
In-process SlidingWindowRateLimiter, same limit, 2 instances x 15: admitted 10 + 10 = 20
Redis limiter cost: 225 us per decision; in-process: 0.02 us
```

Os limiters de `Microsoft.AspNetCore.RateLimiting` são por processo: com N instâncias o limite real é N vezes maior. O Redis dá um limite compartilhado ao preço de um round trip por requisição e de uma dependência. Veja [rate limiting](rate-limiting-and-request-timeouts); use Redis só quando o limite precisa ser global.

### Expiração, eviction e persistência

20.000 chaves gravadas com `PX 100`: 50 ms depois o `DBSIZE` ainda era 20000, após 1 s era 0 e `expired_keys_active:20009` as contou: ninguém tocou nelas, a expiração ativa do servidor as removeu (preguiçosa no acesso mais uma amostragem periódica). Com `--maxmemory 8mb` e escritas de 1 KB:

```text
noeviction:   OOM command not allowed when used memory > 'maxmemory'. after 6231 keys; reads still work
allkeys-lru:  20000 writes, no error, DBSIZE=6204, lock key still there=False
volatile-lru: OOM after 6233 keys, lock key still there=False
```

Um cache quer `allkeys-lru`; a mesma política evicta a chave de um lock ou um stream, então mantenha locks e dados numa instância diferente da do cache. Persistência, matando o contêiner logo depois do `SET` e reiniciando:

```text
default (RDB save 3600 1 ...), docker kill:   GET order:1 -> ''   (lost)
default, docker stop (SIGTERM):               GET order:1 -> 'paid' (shutdown snapshot)
--save "" --appendonly no, stop or kill:      lost
--appendonly yes (everysec), kill:            'paid'
--appendonly yes --appendfsync always, kill:  'paid'
```

Redis não é banco de dados a menos que você ligue o AOF e aceite o custo; `docker kill` mata só o processo, então não mostra a diferença entre `everysec` e `always`, que só aparece numa falha do SO ou de energia (docs only: até cerca de um segundo de escritas com `everysec`).

### Locks distribuídos: o centro

O lock é um comando, `SET key token NX PX ttl`: grava só se não existir, com expiração para que um dono que caiu não bloqueie para sempre. O token precisa ser único por aquisição, e a liberação só pode apagar a chave se ela ainda tiver esse token. `LockTakeAsync`/`LockReleaseAsync` fazem os dois; o `MONITOR` mostrou a diferença por versão do servidor:

```text
Redis 8.8.4:  SET lock:r A PX 300 NX ... DELEX lock:r IFEQ A
Redis 7.4 and Valkey 9.1.4:  ... WATCH lock:r / GET lock:r / then a delete
```

Não é script Lua: `DELEX ... IFEQ` é um compare-and-delete nativo (Redis 8.4+, segundo a documentação); servidores antigos usam `WATCH`. Por que o token importa:

```text
A LockRelease (token check): False; lock holder is still B
A naive KeyDelete: True; lock holder now: (nobody)
```

Por eficiência, 10 workers disputando `lock:nightly` rodaram o job uma vez. Agora a falha que importa. A pega um lock de 1 s, lê o saldo (100) e pausa 2,5 s (`Thread.Sleep`, no lugar de uma pausa de GC, um travamento de VM ou uma rede lenta); B pega o lock depois do TTL, deposita 5, e então A acorda e deposita 10 sobre a leitura velha:

```text
   A holds the lock, read balance 100, pauses 2.5 s
   B took the lock after A's TTL expired, read balance 100
   ledger: B wrote 105
   A wakes up; lock query says holder is 'B'. A still writes
   ledger: A wrote 110
balance = 110; two deposits (+10 and +5) from 100 should give 115
```

A não tem como saber que perdeu o lock: qualquer checagem antes da escrita tem a mesma janela. A defesa é o fencing token: um número que cresce a cada aquisição, enviado com toda escrita e conferido pelo recurso. Adquira-o atomicamente com um script (`SET ... NX PX` e depois `INCR fence:key`) e deixe o recurso recusar os mais antigos:

```text
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return redis.call('INCR', KEYS[2]) end return 0   -- returns the fencing token

bool Write(int value, long token) { lock (_gate) { if (token < _maxToken) return false; _maxToken = token; Balance = value; return true; } }
// in a database (SQL): UPDATE ledger SET balance=@v, fence=@t WHERE id=@id AND fence <= @t
```

```text
   A got fencing token 1
   B got fencing token 2
   ledger: B wrote 105 (token 2)
   ledger: REJECTED A (token 1 < 2)
balance = 105 (B's deposit survived, A's stale write was refused and A must retry)
```

A checagem e a escrita precisam ser um passo só no recurso. Onde o recurso não consegue comparar tokens, o lock não dá correção.

### Redlock e o debate público

O Redlock (o algoritmo da documentação do Redis) toma o lock em N masters independentes (em geral 5): anota o horário, faz `SET NX PX` em cada um com timeout curto, considera adquirido se a maioria aceitou e o tempo gasto é menor que a validade; a validade é o TTL menos o tempo gasto menos uma folga de drift; se falhar, libera em todos; tenta de novo depois de um atraso aleatório. O `RedLock.net` o implementa. Contra três contêineres:

```text
3 of 3 instances up: IsAcquired=True [Acquired: 3, Conflicted: 0, Error: 0] in 14 ms
1 instance down:     IsAcquired=True [Acquired: 2, Conflicted: 0, Error: 1] in 5533 ms
2 instances down:    IsAcquired=False Status=NoQuorum [Acquired: 1, Conflicted: 0, Error: 2] in 32525 ms
```

A maioria tolera uma instância morta, mas a decisão levou 5,5 s com os timeouts padrão, e 32,5 s para desistir com duas fora: configure timeouts curtos. O debate:

- Kleppmann (2016): o lock é por eficiência ou por correção? Por eficiência um Redis basta e o Redlock é custo inútil. Por correção, o Redlock não tem fencing token (o valor aleatório não é monotônico) e a segurança depende de suposições de tempo: atrasos limitados, pausas e erro de relógio, e o Redis expira pelo relógio de parede, não por um monotônico.
- Sanfilippo (a resposta, `antirez.com/news/101`): concorda que o Redis deveria usar o relógio monotônico; argumenta que o token único permite um check-and-set no recurso e que o Redlock reconfere o tempo gasto depois de adquirir, então atrasos antes dessa checagem são cobertos, enquanto uma pausa depois dela atinge qualquer lock com expiração. Ele não aceita a conclusão de que o Redlock é inseguro.

A página do Redis cita os dois e, sobre consistência e correção, diz "You should implement fencing tokens". Conclusão prática: por eficiência (deduplicar um job, evitar um stampede) um Redis e `LockTake` bastam; por correção use fencing e um armazenamento que ordene escritas (revisões do ZooKeeper ou do etcd, um banco com unique constraint ou `WHERE fence <= @t`), ou `SELECT ... FOR UPDATE` e advisory locks do PostgreSQL, ou uma linha de lease. Uma réplica piora: a replicação é assíncrona, então um failover pode perder a chave e surge um segundo dono (a página do Redis diz isso). A trilha de system design cobre os mesmos limites: [falhas parciais e pausas](/system-design/system-design-concepts/distributed-systems-partial-failures), [consenso e fencing](/system-design/system-design-concepts/consensus-and-coordination-services) e [locks baseados em lease](/system-design/system-design-concepts/application-level-locks-for-external-io-critical-sections).

### Cache-aside e o stampede

O `IDistributedCache` sobre Redis (`AddStackExchangeRedisCache`) guarda cada entrada como um hash do Redis (`type=Hash`), então um `GET` cru nessa chave falha com `WRONGTYPE`. 200 chamadas concorrentes numa chave fria, cada carga levando 200 ms:

```text
cache-aside by hand:                       factory ran 200 times
same with ConcurrentDictionary<key, Lazy<Task>>: 1 time
HybridCache (Redis as L2), 200 calls:      1 time
two HybridCache instances x 100 calls:     2 times (one per process)
two instances + Redis lock around the load: 1 time
```

O `HybridCache` coalesce dentro de um processo; entre servidores cada um roda a fábrica uma vez. Um lock Redis com nova leitura do cache depois de tomá-lo deixa uma só no total (quem perde faz polling no cache). Some jitter aleatório aos TTLs para que chaves gravadas juntas não expirem juntas. Detalhes em [o concept de cache](caching-imemorycache-hybridcache-and-distributed); filas em processo estão em [Channels](in-memory-queues-with-channels).

### Alta disponibilidade e segurança

Docs only. A replicação é assíncrona; o Sentinel monitora e promove uma réplica (um failover pode perder escritas já confirmadas); o Cluster divide as chaves em 16384 hash slots, comandos de várias chaves exigem um só slot (use uma hash tag como `{user:1}:cart`) e os clientes seguem `MOVED`/`ASK`. Segurança medida: sem senha dá `RedisConnectionException ... NOAUTH`; um usuário ACL `app` limitado a `~app:*` e `+get +set +incr`:

```text
GET other:x: NOPERM No permissions to access a key
FLUSHALL: NOPERM User app has no permissions to run the 'flushall' command
DEL app:x: NOPERM User app has no permissions to run the 'unlink' command
```

(`KeyDelete` envia `UNLINK`.) Use ACLs, TLS (`ssl=true`, docs only) e nunca publique a porta 6379: a imagem oficial roda aqui com `protected-mode no`.

### Redis, Valkey e Garnet

Licenças, do README do repositório do Redis, em 2026-11-19: 7.2.x e anteriores BSDv3; 7.4 a 7.8 RSALv2 ou SSPLv1; 8.0 em diante RSALv2, SSPLv1 ou AGPLv3 à sua escolha. O Valkey (fork da Linux Foundation) é BSD e o 9.1.4 passou em todos os cenários daqui sem mudança (o `INFO` ainda informa `redis_version=7.2.4`). O Garnet (Microsoft, MIT, escrito em C#) fala RESP, então o StackExchange.Redis conecta, mas o 2.2.13 por padrão falhou com `ERR unknown command 'XGROUP'` (a página de compatibilidade não lista Streams) e com `ERR This instance has Lua scripting support disabled` até ser iniciado com `--lua`; com isso o rate limiter e os scripts de fencing passaram. O HyperLogLog dele errou 1,31% contra 0,03%. Uma execução de 200 mil SETs em pipeline: 146 ms Redis, 128 ms Valkey, 131 ms Garnet: ruído de notebook, não benchmark. Ofertas gerenciadas (Azure Managed Redis, ElastiCache) são docs only.

| Necessidade | Ferramenta | Garantia | Armadilha |
| --- | --- | --- | --- |
| Contador compartilhado | `INCR` | atômico | ler-modificar-escrever no cliente perde atualizações |
| Cache | `SET EX`, `allkeys-lru` | nenhuma | a eviction também remove locks e filas |
| Fan-out ao vivo | Pub/Sub | at-most-once, só conectados | 30 de 100 perdidas durante a queda |
| Fila de trabalho | Stream + group | at-least-once | handlers idempotentes, `XAUTOCLAIM`, trim |
| Rate limit global | sorted set + Lua | janela compartilhada | um round trip por requisição |
| Evitar job duplicado | `LockTake` | melhor esforço | pausa além do TTL |
| Proteger um recurso | lock + fencing token | o recurso recusa escrita velha | exige recurso que compare tokens |
| Contar únicos | HyperLogLog | cerca de 0,8% de erro | sem teste de pertinência |

## Trade-offs

- **Lock Redis vs lock no banco.** Uma linha de lock, um advisory lock ou `FOR UPDATE` custa uma dependência a menos quando os dados já estão no PostgreSQL e é ordenado pelo banco; o Redis é mais rápido de tomar e pior em correção.
- **Streams vs broker.** Um stream é barato e bom dentro de um sistema; ordenação entre consumidores, retentativas com dead-letter e ferramentas de operação ficam melhores num broker (veja [message brokers](message-brokers-masstransit-azure-service-bus-and-rabbitmq)).
- **Um Redis para tudo.** Uma instância para cache, locks e filas é simples, até o `allkeys-lru` evictar um lock. Separe os papéis, ou use `noeviction` na que guarda estado.
- **Redis vs Valkey vs Garnet.** A licença (AGPLv3 ou source-available no Redis 8, BSD no Valkey, MIT no Garnet) decide primeiro; depois confira cada comando que você usa, porque o Garnet não tem Streams por padrão.

## Documentation Links

- [StackExchange.Redis documentation, seredis.dev](https://seredis.dev/) (doc)
- [Transactions in Redis, StackExchange.Redis](https://seredis.dev/Transactions) (doc)
- [Distributed locks with Redis, redis.io](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) (doc)
- [How to do distributed locking, Martin Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (article)
- [Is Redlock safe?, Salvatore Sanfilippo](https://antirez.com/news/101) (article)
- [Redis Streams, redis.io](https://redis.io/docs/latest/develop/data-types/streams/) (doc)
- [Redis Pub/Sub and keyspace notifications, redis.io](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/) (doc)
- [Key eviction, redis.io](https://redis.io/docs/latest/develop/reference/eviction/) (doc)
- [Persistence, redis.io](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) (doc)
- [DELEX command, redis.io](https://redis.io/docs/latest/commands/delex/) (doc)
- [Cluster specification, redis.io](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) (doc)
- [High availability with Redis Sentinel, redis.io](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/) (doc)
- [Redis is now available under the AGPLv3 license, redis.io](https://redis.io/blog/agplv3/) (article)
- [Redis repository and licence notes, GitHub](https://github.com/redis/redis) (doc)
- [Valkey, valkey.io](https://valkey.io/) (doc)
- [Garnet, Microsoft](https://microsoft.github.io/garnet/) (doc)
- [Garnet API compatibility, Microsoft](https://microsoft.github.io/garnet/docs/commands/api-compatibility) (doc)
- [HybridCache library in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid) (doc)
