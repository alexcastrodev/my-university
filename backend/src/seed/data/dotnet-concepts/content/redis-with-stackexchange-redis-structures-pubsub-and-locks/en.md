---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

In a .NET service Redis usually enters as the backend of `IDistributedCache`, but it is a data-structure server and a coordination point, and most production bugs come from forgetting that. This concept runs StackExchange.Redis against real servers and measures what happens: one multiplexer against one per call, a server that dies mid-traffic, a "transaction" that does not roll back, Pub/Sub against Streams when the consumer is down, a sorted-set rate limiter, eviction deleting a lock key, and the centre of it: a distributed lock whose holder pauses past the TTL, the stale write it causes, and the fencing token that stops it. Then the Redlock debate (Kleppmann against Sanfilippo), cache stampede, and the licence landscape (Redis, Valkey, Garnet). Versions: `StackExchange.Redis` 3.4.35, `Microsoft.Extensions.Caching.StackExchangeRedis` 10.0.15, `Microsoft.Extensions.Caching.Hybrid` 10.11.0, `RedLock.net` 2.3.2, `System.Threading.RateLimiting` 10.0.15, `net10.0`, SDK 10.0.100. Servers in Docker on one laptop over loopback: `redis:8.8.4-alpine`, `valkey/valkey:9.1.4-alpine`, `ghcr.io/microsoft/garnet` 2.2.13. Sources consulted 2026-11-19. The client docs moved: `stackexchange.github.io/StackExchange.Redis` now answers 404 and the README points to `seredis.dev`.

## Use Cases

- Sharing counters, leaderboards, rate limits and work queues between several instances of one service.
- Making sure one instance of a fleet runs a nightly job (a lock for efficiency).
- Replacing a lost-message Pub/Sub or an in-memory `Channel<T>` with a durable consumer group.
- Deciding whether a lock may protect money or only avoid duplicated work, and picking Redis, Valkey or Garnet knowing the licence.

## Deep Dive

### One multiplexer per process

`ConnectionMultiplexer` owns the sockets and multiplexes every caller over them; `IDatabase` is a cheap handle. Register one `IConnectionMultiplexer` as a singleton. Creating one per call, 300 PINGs:

```text
new multiplexer per call: 1.42 ms/call (300 calls)
shared multiplexer, sequential PING: 191 us/call
shared multiplexer, 20000 concurrent PINGs (implicit pipelining): total 12 ms
```

Roughly 7 times slower per call, plus a socket and a handshake each time. The 191 us is Docker loopback; the concurrent line shows pipelining: calls issued while others are in flight share the wire, so `await Task.WhenAll(...)` over many commands costs far less than awaiting each. Defaults printed by `ConfigurationOptions.Parse`: `AbortOnConnectFail=True ConnectTimeout=5000 SyncTimeout=5000 AsyncTimeout=5000 ConnectRetry=3`. With nothing listening, `ConnectAsync` throws `RedisConnectionException`; with `abortConnect=false` it returns after the connect timeout with `IsConnected=False`, and a command then fails with `The message timed out in the backlog attempting to send because no connection became available (5000ms)`. A web app should use `abortConnect=false` so a Redis outage at start does not stop the host.

### When Redis dies mid-traffic

A loop doing `INCR` every 250 ms, `docker stop` at 1 s, `docker start` later, timeouts set to 2 s:

```text
default policy:   INCR failed after 2828 ms: RedisConnectionException: The message timed out in the backlog ... (2000ms)
                  (every call hangs until the timeout, restored about 3 s after the container came back)
BacklogPolicy.FailFast:  INCR failed after 0 ms: RedisConnectionException: No connection is active/available ...
                  INCR ok again 851 ms after docker start; the multiplexer reconnected by itself
```

The default queues commands while disconnected, so each caller waits the full timeout (request threads pile up); `FailFast` answers immediately so a circuit breaker can act. Either way the multiplexer reconnects on its own, and `ConnectionFailed`/`ConnectionRestored` events fire. Treat Redis as an unreliable dependency: wrap calls with the policies from [resilience](resilience-retries-timeouts-and-circuit-breakers), and decide per use what a failure means (cache: go to the source; lock: do not run).

### "Transactions" are not rollback

`CreateTransaction()` sends `MULTI`/`EXEC`; `AddCondition` uses `WATCH`. A failed condition aborts, but a command that errors inside `EXEC` does not undo its neighbours:

```text
condition true: committed=True a=70 b=30
condition false: committed=False a=70
exec=True   cmd1=True cmd3=True
  cmd2 failed: RedisServerException: ERR value is not an integer or out of range
  ok=written ok2=written too (no rollback)
```

Commands queued in a transaction cannot read, so "read, decide, write" needs conditions or a Lua script. `CreateBatch()` is only about sending together, not atomicity.

### Structures and their traps

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

`INCR` is atomic; read-modify-write from the client is the same lost update as in memory. A list as a queue loses the job popped by a worker that crashes (use a stream or `LMOVE` to a processing list). A sorted set (`SortedSetAddAsync`, `SortedSetRangeByRankWithScoresAsync`) gives leaderboards; ties order by member. HyperLogLog counts uniques in up to 12 KB with a 0.81% standard error (Redis docs); this run landed at 0.03%.

### Pub/Sub loses messages, Streams do not

One publisher sends 100 numbers to a channel and to a stream; the subscriber and the consumer go down at message 31 and return at 61:

```text
Pub/Sub: published 100, received 70, missing 30 (31..60: 30 of 30 lost)
Stream : added 100, read 100, distinct 100, missing 0
```

Pub/Sub is at-most-once to whoever is connected now: no persistence, no replay. Use it for cache-invalidation hints and live fan-out. A stream with a consumer group keeps entries until trimmed. A consumer reads 20, acknowledges 12 and dies:

```text
XPENDING summary: 8 pending, consumers: c1=8
XAUTOCLAIM min-idle 60s right away: claimed 0
XAUTOCLAIM min-idle 1s after 1.5s: claimed 8; delivery count 2
handled 100 deliveries, 100 distinct ids, none lost; stream length after all acks: 100
```

`StreamReadGroupAsync(">")` delivers new entries; unacknowledged ones stay pending until `StreamAutoClaimAsync` hands them to another consumer after the idle time. That is at-least-once: a consumer that dies after the work but before `XACK` processes twice, so handlers must be idempotent (see [the outbox concept](transactional-outbox-inbox-and-idempotent-consumers)). `XACK` does not delete; trim with `MAXLEN`. Keyspace notifications (docs only) ride on Pub/Sub, which the docs call fire and forget, so they inherit the loss.

### A sorted-set rate limiter, and why it differs from the built-in one

One entry per request scored by time, a Lua script trimming and counting atomically (the script reads `TIME` on the server, so instance clocks do not matter):

```text
Redis sorted-set window, limit 10/s, 2 instances x 15 requests: admitted 5 + 5 = 10
In-process SlidingWindowRateLimiter, same limit, 2 instances x 15: admitted 10 + 10 = 20
Redis limiter cost: 225 us per decision; in-process: 0.02 us
```

`Microsoft.AspNetCore.RateLimiting` limiters are per process: with N instances the real limit is N times larger. Redis gives one shared limit at the price of a round trip per request and a dependency. See [rate limiting](rate-limiting-and-request-timeouts); use Redis only when the limit must be global.

### Expiration, eviction and persistence

20,000 keys set with `PX 100`: 50 ms later `DBSIZE` was still 20000, after 1 s it was 0 and `expired_keys_active:20009` counted them: nobody touched them, the server's active expiry removed them (lazy on access plus a periodic sample). With `--maxmemory 8mb` and 1 KB writes:

```text
noeviction:   OOM command not allowed when used memory > 'maxmemory'. after 6231 keys; reads still work
allkeys-lru:  20000 writes, no error, DBSIZE=6204, lock key still there=False
volatile-lru: OOM after 6233 keys, lock key still there=False
```

A cache wants `allkeys-lru`; the same policy evicts a lock key or a stream, so keep locks and data on a different instance from the cache. Persistence, killing the container right after `SET` and restarting it:

```text
default (RDB save 3600 1 ...), docker kill:   GET order:1 -> ''   (lost)
default, docker stop (SIGTERM):               GET order:1 -> 'paid' (shutdown snapshot)
--save "" --appendonly no, stop or kill:      lost
--appendonly yes (everysec), kill:            'paid'
--appendonly yes --appendfsync always, kill:  'paid'
```

Redis is not a database unless you turn AOF on and accept the cost; `docker kill` kills the process only, so it does not show the difference between `everysec` and `always`, which appears only on an OS or power failure (docs only: up to about one second of writes with `everysec`).

### Distributed locks: the centre

The lock is one command, `SET key token NX PX ttl`: set only if absent, with an expiry so a crashed holder cannot block forever. The token must be unique per acquisition, and release must delete the key only if it still holds that token. `LockTakeAsync`/`LockReleaseAsync` do both; the `MONITOR` output showed the difference by server version:

```text
Redis 8.8.4:  SET lock:r A PX 300 NX ... DELEX lock:r IFEQ A
Redis 7.4 and Valkey 9.1.4:  ... WATCH lock:r / GET lock:r / then a delete
```

Not a Lua script: `DELEX ... IFEQ` is a native compare-and-delete (Redis 8.4+, per the docs), older servers use `WATCH`. Why the token matters:

```text
A LockRelease (token check): False; lock holder is still B
A naive KeyDelete: True; lock holder now: (nobody)
```

For efficiency, 10 workers racing for `lock:nightly` ran the job once. Now the failure that matters. A takes a 1 s lock, reads the balance (100), then pauses 2.5 s (`Thread.Sleep`, standing in for a GC pause, a VM stall or a slow network); B takes the lock after the TTL, deposits 5, then A wakes and deposits 10 over its stale read:

```text
   A holds the lock, read balance 100, pauses 2.5 s
   B took the lock after A's TTL expired, read balance 100
   ledger: B wrote 105
   A wakes up; lock query says holder is 'B'. A still writes
   ledger: A wrote 110
balance = 110; two deposits (+10 and +5) from 100 should give 115
```

A cannot know it lost the lock: any check before the write has the same window. The defence is a fencing token: a number that grows with each acquisition, sent with every write, and checked by the resource. Acquire it atomically with a script (`SET ... NX PX` then `INCR fence:key`), and let the resource refuse older ones:

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

The check and the write must be one step in the resource. Where the resource cannot compare tokens, the lock cannot give correctness.

### Redlock and the public debate

Redlock (the Redis docs algorithm) takes the lock on N independent masters (usually 5): note the time, `SET NX PX` on each with a short timeout, count it acquired if a majority accepted and the elapsed time is below the validity, then the validity is TTL minus elapsed minus a drift allowance; on failure release everywhere; retry after a random delay. `RedLock.net` implements it. Against three containers:

```text
3 of 3 instances up: IsAcquired=True [Acquired: 3, Conflicted: 0, Error: 0] in 14 ms
1 instance down:     IsAcquired=True [Acquired: 2, Conflicted: 0, Error: 1] in 5533 ms
2 instances down:    IsAcquired=False Status=NoQuorum [Acquired: 1, Conflicted: 0, Error: 2] in 32525 ms
```

Majority tolerates one dead instance but the decision took 5.5 s with default timeouts, and 32.5 s to give up with two down: set short timeouts. The debate:

- Kleppmann (2016): lock for efficiency or for correctness? For efficiency one Redis is enough and Redlock is needless cost. For correctness, Redlock has no fencing token (its random value is not monotonic), and its safety depends on timing assumptions: bounded delays, pauses and clock error, and Redis expires with the wall clock, not a monotonic one.
- Sanfilippo (the reply, `antirez.com/news/101`): agrees Redis should use the monotonic clock; argues the unique token can implement check-and-set on the resource, and that Redlock re-checks the elapsed time after acquiring, so delays before that check are covered, while a pause after it hits every expiring lock. He does not accept the conclusion that Redlock is unsafe.

The Redis page lists both and, for consistency and correctness, says "You should implement fencing tokens". Practical conclusion: for efficiency (dedupe a job, avoid a stampede) one Redis and `LockTake` are fine; for correctness use fencing and a store that orders writes (ZooKeeper or etcd revisions, a database with a unique constraint or `WHERE fence <= @t`), or `SELECT ... FOR UPDATE` and PostgreSQL advisory locks, or a lease row. A replica makes it worse: replication is asynchronous, so a failover can lose the key and a second holder appears (the Redis page says so). The system design track covers the same limits: [partial failures and pauses](/system-design/system-design-concepts/distributed-systems-partial-failures), [consensus and fencing](/system-design/system-design-concepts/consensus-and-coordination-services) and [lease-based locks](/system-design/system-design-concepts/application-level-locks-for-external-io-critical-sections).

### Cache-aside and the stampede

`IDistributedCache` over Redis (`AddStackExchangeRedisCache`) stores each entry as a Redis hash (`type=Hash`), so raw `GET` on that key fails with `WRONGTYPE`. 200 concurrent calls on a cold key, each load taking 200 ms:

```text
cache-aside by hand:                       factory ran 200 times
same with ConcurrentDictionary<key, Lazy<Task>>: 1 time
HybridCache (Redis as L2), 200 calls:      1 time
two HybridCache instances x 100 calls:     2 times (one per process)
two instances + Redis lock around the load: 1 time
```

`HybridCache` coalesces inside a process; across servers each runs the factory once. A Redis lock with a re-check of the cache after taking it makes it one overall (losers poll the cache). Add random jitter to TTLs so keys written together do not expire together. Details in [the caching concept](caching-imemorycache-hybridcache-and-distributed); in-process queues are in [Channels](in-memory-queues-with-channels).

### High availability and security

Docs only. Replication is asynchronous; Sentinel monitors and promotes a replica (a failover can lose acknowledged writes); Cluster splits keys into 16384 hash slots, multi-key commands need one slot (use a hash tag like `{user:1}:cart`), and clients follow `MOVED`/`ASK`. Measured security: no password gives `RedisConnectionException ... NOAUTH`; an ACL user `app` limited to `~app:*` and `+get +set +incr`:

```text
GET other:x: NOPERM No permissions to access a key
FLUSHALL: NOPERM User app has no permissions to run the 'flushall' command
DEL app:x: NOPERM User app has no permissions to run the 'unlink' command
```

(`KeyDelete` sends `UNLINK`.) Use ACLs, TLS (`ssl=true`, docs only) and never publish port 6379: the official image runs with `protected-mode no` here.

### Redis, Valkey and Garnet

Licences, from the Redis repository README, 2026-11-19: 7.2.x and earlier BSDv3; 7.4 to 7.8 RSALv2 or SSPLv1; 8.0 and later RSALv2, SSPLv1 or AGPLv3 at your option. Valkey (Linux Foundation fork) is BSD and its 9.1.4 passed every scenario here unchanged (`INFO` still reports `redis_version=7.2.4`). Garnet (Microsoft, MIT, written in C#) speaks RESP, so StackExchange.Redis connects, but 2.2.13 by default failed with `ERR unknown command 'XGROUP'` (its compatibility page lists no Streams) and `ERR This instance has Lua scripting support disabled` until started with `--lua`; with it the rate limiter and fencing scripts passed. Its HyperLogLog was off by 1.31% against 0.03%. One run of 200k pipelined SETs: 146 ms Redis, 128 ms Valkey, 131 ms Garnet: noise on a laptop, not a benchmark. Managed offerings (Azure Managed Redis, ElastiCache) are docs only.

| Need | Tool | Guarantee | Trap |
| --- | --- | --- | --- |
| Shared counter | `INCR` | atomic | client read-modify-write loses updates |
| Cache | `SET EX`, `allkeys-lru` | none | eviction also removes locks and queues |
| Live fan-out | Pub/Sub | at-most-once, connected only | 30 of 100 lost while down |
| Work queue | Stream + group | at-least-once | idempotent handlers, `XAUTOCLAIM`, trim |
| Global rate limit | sorted set + Lua | shared window | one round trip per request |
| Skip duplicate job | `LockTake` | best effort | pause past TTL |
| Protect a resource | lock + fencing token | resource refuses stale writes | needs a resource that compares tokens |
| Count uniques | HyperLogLog | about 0.8% error | no membership test |

## Trade-offs

- **Redis lock vs database lock.** A lock row, advisory lock or `FOR UPDATE` costs one dependency fewer when the data is already in PostgreSQL and is ordered by the database; Redis is faster to take and worse at correctness.
- **Streams vs a broker.** A stream is cheap and good inside one system; ordering across consumers, retries with dead-letter and operations tooling are better in a broker (see [message brokers](message-brokers-masstransit-azure-service-bus-and-rabbitmq)).
- **Shared Redis for everything.** One instance for cache, locks and queues is simple, until `allkeys-lru` evicts a lock. Separate roles, or use `noeviction` for the stateful one.
- **Redis vs Valkey vs Garnet.** Licence (AGPLv3 or source-available for Redis 8, BSD for Valkey, MIT for Garnet) decides first; then check each command you use, because Garnet lacks Streams by default.

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
- [Rate limiting middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit) (doc)
