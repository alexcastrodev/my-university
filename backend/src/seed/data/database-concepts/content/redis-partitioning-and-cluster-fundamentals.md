---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Trace the path the book walks from "Redis was never designed to be distributed" to a production cluster: first the client-side partitioning schemes people bolted on before Redis had any native answer — range, hash, presharding, consistent hashing, and tagging — then the two purpose-built systems that replaced all of them. Understand what each one actually solves: Redis Cluster's 16384 hash slots distribute data with automatic routing and failover, while Redis Sentinel handles quorum-based failover for a plain master/replica pair without sharding anything. And understand the specific mechanism — CRC16(key) mod 16384, with an optional `{tag}` — that decides, for any key, which of those 16384 slots it lands in, and how hash tags force two different keys into the same slot on purpose.

## Use Cases

- Explaining to a team why a Redis cache outgrew a single instance's memory or network bandwidth, and choosing between application-level partitioning and Redis Cluster before writing any sharding code.
- Designing key names for a multi-key Redis Cluster operation (`SUNION`, `MSET`, a Lua script touching several keys) so the keys are guaranteed to land in the same slot — the book's `{user123}` tagging convention, still the only mechanism Redis Cluster offers for this.
- Standing up a basic three-master cluster by hand with `CLUSTER ADDSLOTS`, `CLUSTER MEET`, and `CLUSTER REPLICATE` to understand what `redis-cli --cluster create` automates underneath.
- Debugging a `CLUSTERDOWN` error or an unexpected `MOVED`/`ASK` redirect by reasoning about which node owns which hash slot range.
- Deciding whether a given deployment needs Sentinel (automatic failover, no sharding), Cluster (sharding plus failover), or both layered — Sentinel is not a lesser version of Cluster, it solves a narrower problem on purpose.
- Reviewing a cluster's resilience by checking `cluster-migration-barrier` and replica counts per master — the book's warning that "a master without at least one replica cannot fail" without losing data.
- Migrating hash slots between nodes during a resize, using the four-step `CLUSTER SETSLOT` dance (`IMPORTING` / `MIGRATING` / `MIGRATE` / `NODE`) that both `redis-trib.rb` historically and `redis-cli --cluster reshard` today perform on your behalf.

## Deep Dive

### Before Redis Cluster: partitioning by hand

"When Redis was initially designed, it had no intention to be a distributed data store; thus, it cannot natively distribute its data among different instances. It was designed to work well on a single server." Everything in this section is what people did about that before Redis Cluster existed — client-level logic for **horizontal partitioning** (sharding): "distributing keys across different Redis instances."

**Range partitioning** is the simplest scheme: pick a range of key values — numeric ID ranges like `user:1`-`user:1000`, or the first letter of the key — and route each range to a fixed instance. The book is upfront about both failure modes: distribution is often uneven ("most of your keys are in the same range or some ranges have very few keys"), and the scheme doesn't tolerate resizing — "if the number of Redis instances changes, the range distribution needs to change accordingly... it is likely that adding or removing a host will invalidate a good portion of data."

**Hash partitioning** fixes the unevenness: `index = hashFunction(redisKey) % redisHosts.length`. "The efficiency of this method varies with the hash function you choose" — the book's reference implementation uses MD5 — and it recommends "a prime number as the total number of Redis instances... in order to minimize collisions." But modulo-by-host-count has its own failure mode: changing the host list remaps almost everything. The book measured it directly: "In a small test, using hash partitioning, 75 percent of our dataset was invalidated by adding two more servers to the list."

**Presharding** works around that by fixing the array size instead of the host count: launch far more Redis instances than you need — "some people have over 100 instances per server," since "Redis is single threaded and does not use all the resources available in the machine" — and hash-partition across that fixed, oversized list. Scaling means swapping a weaker instance for a stronger one (replicate, promote, retire), never resizing the array. The trade-off is operational: "significantly more instances to manage and monitor," and a bad fit for disaster recovery, since a damaged block of instances can only be repaired by bringing back the same number of replacements — "by definition, the size of the cluster cannot vary."

**Consistent hashing** solves the resize problem directly. Both servers and keys are hashed onto points on a circle (a "hash ring"); a key belongs to the first server at or after its point, moving clockwise, wrapping to the first server if none is found. Adding or removing a server "remaps only a small portion of the data... only K/n keys are remapped, where K is the number of keys and n is the number of servers" — the book's example: a 100-key, 4-server ring loses only ~25 keys to a 5th node, not 75. Real implementations place many points per server ("virtual nodes" — "as few as three points per server, while others use as many as 500") to keep the ring balanced. This is the scheme the book actually recommends: "we recommend consistent hashing as the best partition mechanism, because it gives us the ability to add and remove Redis instances without remapping most of the keys."

**Tagging** solves a different problem: `SDIFF`, `SINTER`, `SUNION`, and any other multi-key command require every key involved to live on the same instance. The convention — a tag in curly braces, `key_name:{tag}` — lets the hash function ignore everything except the tag substring, so `user:1{users}`, `user:2{users}`, and `user:3{users}` all hash identically and land on the same node regardless of partitioning scheme. This convention is exactly what Redis Cluster later standardized as hash tags.

Partitioning logic can live in three layers, per the book: the **client** (the application code above), a **proxy** (an intermediary that shards transparently — the book walks through **twemproxy**, Twitter's Apache-licensed proxy, configured with a YAML pool of backend servers and a `distribution: ketama` — its name for consistent hashing), or a **query router** — "the data store itself... Redis Cluster behaves like a query router." Whichever layer you choose, the book flags the same constraint: "not all Redis commands are going to be available; some commands do not make sense in a partitioned system," particularly ones that take multiple keys that might live on different hosts.

The book's closing recommendation before Redis Cluster is introduced: use consistent hashing for a **cache** (misses are recoverable, so minimizing remaps is enough), but for a **data store** "consider Redis Cluster or a solution that ensures that data is replicated across nodes and that every instance... knows how to route the query to the right instance" — because for a store, "the keys must always map to the same Redis instances," which none of the client-side schemes guarantee once the host list changes.

### Two purpose-built systems, two different jobs

"In 2011, Salvatore Sanfilippo started working on a project that would solve these problems, but Redis was still underdeveloped... he decided to tackle only automatic failover and created a project called Redis Sentinel." The full distributed-data-store project became Redis Cluster, finished later. The book is explicit that these are not the same tool at different maturity levels — they solve different problems on purpose: "Sentinel's goal is to provide reliable automatic failover in a master/slave topology without sharding data. Cluster's goal is to distribute data across different Redis instances and perform automatic failover if any problem happens to any master instance." Sentinel reached stability in Redis 2.8 (2013); Cluster in Redis 3.0 (2015).

### The CAP theorem framing

The book measures both systems against CAP: "a distributed system cannot ensure all of the following: **Consistency** — a read is guaranteed to return the most recent write; **Availability** — every operation gets a response saying whether it succeeded or failed; **Partition tolerance** — the system keeps operating through a network partition." Since partitions are unavoidable in a real deployment, a system has to give something up, and the book's verdict for both Sentinel and Cluster is blunt: "theoretically, Redis Sentinel and Redis Cluster are neither consistent nor available under network partitions" in the strict sense — though specific configurations minimize the damage in each direction.

Concretely: neither can guarantee **availability**, "because there is a quorum that needs to agree on a master election, and depending on the quorum's decision, part of the system may become unavailable." Neither can guarantee **consistency**, because "two or more partitions [can] accept writes at the same time," and "when the network heals... some of those writes will be lost (conflicts are not automatically solved, nor are they exposed for clients)." Redis Cluster leans toward availability over strict consistency where it can — accepting writes on whichever partition still has quorum — which is the book's practical AP-leaning read of the system, even though it is not cleanly AP either.

### Redis Sentinel: quorum-based failover, no sharding

Before Sentinel, promoting a replica after a master failure was manual: `SLAVEOF NO ONE` on the chosen replica, then repointing every other replica and every client by hand. Sentinel automates exactly that, and nothing about data placement — "Sentinel does not distribute data across nodes since the master node has all of the data and the slaves have a copy of the data — Sentinel is not a distributed data store."

A Sentinel deployment typically runs one Sentinel process per Redis instance, communicating with each other over Pub/Sub on a channel called `__sentinel__:hello`. The core configuration is four directives:

```
sentinel monitor mymaster 127.0.0.1 6379 2
sentinel down-after-milliseconds mymaster 30000
sentinel failover-timeout mymaster 180000
sentinel parallel-syncs mymaster 1
```

- `sentinel monitor <name> <ip> <port> <quorum>` — names the master and sets the **quorum**: "the fewest number of sentinels that need to agree that the current master is down before starting a new master election." Note precisely what quorum governs — current Redis documentation is sharper on this than the book: quorum is only used to *detect* the failure; actually *performing* the failover requires a separate step where one Sentinel is elected leader and gets **authorized by a majority of all Sentinel processes**, not just the quorum count. A quorum of 1 with only two Sentinels can technically authorize a failover but is a broken setup for reasons the book gets to next (split-brain).
- `down-after-milliseconds` — how long a master must fail to answer `PING` before a Sentinel calls it down.
- `failover-timeout` — guards against flapping: a master that failed over recently is excluded from being re-elected if another failover is needed before the timeout passes.
- `parallel-syncs` — how many replicas get reconfigured to the new master simultaneously; low values keep more replicas available to clients during the cutover.

A client using Sentinel doesn't connect straight to a Redis instance — it asks a Sentinel which instance currently holds the `master` or `slave` role for a named group, then connects there. This is the "major difference" the book flags: it requires a Sentinel-aware client library.

**Split-brain.** The book demonstrates data loss concretely: a network partition isolates the master from its replicas; the replicas (which can still talk to each other) elect a new master; the client, still connected to the *old*, isolated master, keeps writing. When the partition heals, "the majority of sentinels will agree that the old master... should become a slave of the new master... all writes sent by the client are lost, because there is no data synchronization in this process." Sentinel's failover is real and automatic, but it is not a substitute for a consistency guarantee.

### Redis Cluster: hash slots and the CRC16 rule

Redis Cluster's partitioning method is hash partitioning applied to a fixed constant: **16384** slots, always. "Each master in a cluster owns a portion of the 16,384 slots." The rule for which slot a key belongs to:

```
HASH_SLOT = CRC16(key) mod 16384
```

The book's own worked example, from a running cluster: `CRC16("hello") % 16384 = 866` and `CRC16("foo") % 16384 = 12182` — routing `SET foo bar` from a node that doesn't own slot 12182 produces `-> Redirected to slot [12182] located at 127.0.0.1:30003`.

Rules that follow directly from the fixed slot count: a master with zero slots stores nothing and redirects every query; every master needs at least one slot to be useful; **all 16384 slots must be assigned across all masters for the cluster to be healthy**; and there is no automatic rebalancing — "you need to manually assign x number of slots to each master" (or delegate that to `redis-cli --cluster` / `redis-trib.rb`, both of which are still just issuing `CLUSTER ADDSLOTS`/`SETSLOT` underneath).

Unlike Sentinel, "Redis Cluster only requires a single process to run" per node, but each node opens two ports: the normal client port, and a second one — client port **plus 10000** — used purely for the binary node-to-node gossip bus (failure detection, failover coordination, slot migration messages). Nodes form a full mesh over that bus. A healthy cluster needs at least three masters, and it is strongly recommended that every master have at least one replica — "if any master node without at least one replica fails, the data will be lost," because there is nothing to promote.

### Hash tags: forcing keys into the same slot

Any command touching multiple keys at once — `MSET`, `SUNION`, a Lua script — requires all of those keys to live in the same slot, because Redis Cluster has no cross-slot transaction mechanism. Hash tags are Redis Cluster's built-in version of the book's earlier client-side tagging convention: wrap the part of the key you want hashed in `{curly braces}`, and only that substring is fed to CRC16.

```
SADD {user123}:friends:usa "John" "Bob"
SADD {user123}:friends:brazil "Max" "Hugo"
SUNION {user123}:all_friends {user123}:friends:usa {user123}:friends:brazil
```

All three keys hash on `user123` alone and are guaranteed to sit in the same slot, so the `SUNION` above is a valid, single-node Redis Cluster operation even though the three key names are otherwise unrelated strings.

The trace below runs the project's `redisClusterSlot()` — a real, hand-verified implementation of the exact algorithm above (`crc16(key) & 16383`, honoring a `{tag}` when one is present) — over six representative keys, against the real 16384-slot space:

```viz
type: formula
capacity = 16384
slot = redisClusterSlot(item)
---
session:alice
{user1000}.profile
{user1000}.orders
cart:9981
foo
leaderboard:global
```

Run through the real engine, this trace produces:

| Key | Slot |
|---|---|
| `session:alice` | 15036 |
| `{user1000}.profile` | 3443 |
| `{user1000}.orders` | 3443 |
| `cart:9981` | 7185 |
| `foo` | 12182 |
| `leaderboard:global` | 5355 |

Two things are worth reading off that table directly. First, `foo` lands at slot 12182 — the exact number from the book's own `redis-cli` session above, because this is not an approximation of Redis's algorithm, it *is* Redis's algorithm (CRC16/XMODEM, hand-verified against the standard test vector `crc16('123456789') === 0x31c3`). Second, and more importantly: `{user1000}.profile` and `{user1000}.orders` are different keys with nothing textually in common outside the tag, and they land in the identical slot, 3443 — the whole point of hash tags, proven by running the real function rather than asserted.

### Cluster topology, failover, and administration

The book walks cluster administration at the command level before introducing any wrapper tool, which is worth knowing because it's what every wrapper does underneath: `CLUSTER ADDSLOTS` assigns a range of slots to the connected node; `CLUSTER SET-CONFIG-EPOCH` seeds each master with a distinct epoch number so conflicting slot claims resolve deterministically (highest epoch wins); `CLUSTER MEET <ip> <port>` introduces one node to another, after which the gossip protocol propagates full membership to every node in the mesh without needing an all-pairs `MEET`. A cluster whose slots aren't all covered reports `cluster_state:fail` from `CLUSTER INFO` and refuses every query with `CLUSTERDOWN`.

**Replicas** are added by starting a fresh cluster-mode instance, `CLUSTER MEET`-ing it in, reading the target master's node ID from `CLUSTER NODES`, then running `CLUSTER REPLICATE <master-node-id>` on the new node. **Resharding** one slot at a time is a four-step handshake: `CLUSTER SETSLOT <slot> IMPORTING <source-id>` on the destination, `CLUSTER SETSLOT <slot> MIGRATING <dest-id>` on the source, then `MIGRATE` (or `CLUSTER GETKEYSINSLOT`/`COUNTKEYSINSLOT` plus per-key `MIGRATE`) to move any existing keys, and finally `CLUSTER SETSLOT <slot> NODE <dest-id>` broadcast to every master so the new ownership is agreed everywhere. Removing a node requires resharding away all of its slots first, then `CLUSTER FORGET <node-id>` on every remaining master within 60 seconds (Redis holds a short-lived ban list to stop the forgotten node from being re-gossiped back in).

**Replica placement matters for resilience.** One replica per master tolerates a master failing once — the promoted replica now has zero replicas of its own, so a second failure on that shard loses data outright (or, if `cluster-require-full-coverage yes`, takes the whole cluster down). The book's recommended pattern is **spare replicas**: give one master extra replicas rather than one each uniformly, and let `cluster-migration-barrier` control how a spare gets reassigned to cover whichever master just lost its only replica.

Reads can be scaled by connecting directly to a replica and issuing `READONLY` — the replica then serves reads for slots it holds instead of always redirecting to its master (reversed by `READWRITE`), at the cost of potentially stale data.

### Book vs today

> **`redis-trib.rb` is gone; its functionality moved into `redis-cli --cluster`.** The book teaches `redis-trib.rb create --replicas 1 ...`, `redis-trib.rb reshard`, `redis-trib.rb add-node`, calling it "the official cluster management tool" while noting it was "still very immature." As of Redis 5.0, `redis-trib.rb` is no longer shipped or supported — its logic was ported from Ruby into C, directly inside `redis-cli`, as the `--cluster` subcommand family. Current Redis documentation confirms the same command surface the book describes still exists, just renamed: `redis-cli --cluster create`, `--cluster reshard --cluster-from --cluster-to --cluster-slots --cluster-yes`, `--cluster add-node`, `--cluster del-node`, `--cluster check`, `--cluster fix`, `--cluster call`, `--cluster import`. Anyone typing the book's exact `redis-trib.rb` commands into a current Redis install needs the `--cluster` translation, not a different mental model.
>
> **Sentinel's quorum semantics are the same, described more precisely today.** `sentinel monitor <name> <ip> <port> <quorum>` and the `down-after-milliseconds`/`failover-timeout`/`parallel-syncs` directives are unchanged in current Redis documentation. The current docs are explicit about a nuance the book states more loosely: quorum is used only to *detect* that the master is down; actually authorizing a failover additionally requires a **majority vote among all Sentinel processes**, not just quorum-many. Worth knowing when sizing a Sentinel deployment — an even number of Sentinels, or a quorum set without regard to the total Sentinel count, is a common way to end up with a technically-quorate but practically-broken setup.
>
> **Hash slots, CRC16, and hash tags are unchanged.** 16384 slots, `CRC16(key) mod 16384`, and `{tag}` hash-tag syntax are exactly as the book describes and exactly as this concept's viz proves — nothing here has moved.

## Trade-offs

- **Client-side partitioning schemes trade complexity for control, and every one of them loses that trade to Redis Cluster once you don't need the control.** Range partitioning is trivial to implement and reliably uneven. Hash partitioning is even but breaks on resize — the book's own test lost 75% of a dataset to adding two servers. Presharding fixes resize by fixing the array size up front, at the cost of "significantly more instances to manage" with "no great set of tools for doing this" (written before Redis Cluster existed to be that tool). Consistent hashing is the best of the client-side options — remapping only K/n keys on resize — but it is still a library you own, tune (virtual node count), and keep correct across every client. Redis Cluster is what all four converge toward: fixed-size, resize-tolerant, tool-supported partitioning, but as infrastructure you deploy rather than code you write. The book's own recommendation is proportionate to this: use consistent hashing when data loss on remap is cheap (a cache), reach for Cluster when it isn't (a store).
- **Redis Cluster and Sentinel solve different problems, and using the wrong one costs you the guarantee you actually needed.** Sentinel gives automatic failover on an unsharded master/replica pair — no data distribution at all. Cluster gives sharding plus failover, but at real operational cost: a full mesh of nodes, a gossip bus on a second port per node, manual slot assignment with no automatic rebalancing, and a client that must understand `MOVED`/`ASK` redirects. Reaching for Cluster because "it's the newer one" when the actual requirement is just automatic failover on a dataset that fits one instance buys sharding complexity for nothing. Reaching for Sentinel when the dataset has outgrown one instance doesn't buy sharding at all — Sentinel "is not a distributed data store."
- **Hash tags solve multi-key operations by concentrating load, which is exactly the trade-off the book's own tagging technique already had.** Every key sharing a tag lands in one slot on one master — necessary for `SUNION`/`SINTER`/`MSET` across those keys, but it also means that tag's traffic and memory cannot be spread across the cluster. A tag scoped to `{user123}` — a handful of keys per user — spreads fine because there are many distinct tags. A tag scoped to `{global}` used across a huge key population defeats the entire point of clustering for that data: one master carries all of it. Hash tags are a scalpel for specific multi-key operations, not a general key-naming convention.
- **No automatic slot rebalancing means the cluster's evenness is only as good as whoever last ran a reshard.** Unlike a consistent-hash ring, which self-corrects as members are added, Redis Cluster's slot ownership is a manual assignment that persists until someone (or a script, or `redis-cli --cluster rebalance`) moves it. Add a fourth master to a three-master cluster and it owns zero slots — and therefore serves zero traffic — until slots are explicitly reassigned to it. This is more predictable than automatic rebalancing (no surprise migrations under load) and more work (nothing happens until you make it happen).
- **`cluster-require-full-coverage` is a direct CAP-theorem dial, and the book shows both settings' failure mode.** Set to `yes` (the default), a single master's slots becoming unreachable takes the *entire cluster* down — full consistency of coverage, zero availability for slots that were perfectly healthy. Set to `no`, the cluster stays up and serves everything except the unreachable slots, which error individually — availability for most keys, at the cost of a cluster that is "up" while silently failing a defined subset of its keyspace. Neither setting is more correct; they are the same trade-off CAP names, expressed as one boolean.
- **Sentinel's quorum protects against false failovers, not against data loss during a real partition.** The book's split-brain walkthrough is the sharp version of this: quorum correctly detects the master is unreachable and correctly promotes a replica — the mechanism works exactly as designed — and the client's writes to the old, isolated master are still lost when the partition heals, because "there is no data synchronization in this process." Sentinel's job was never to prevent that; it was only ever to make failover automatic instead of manual. Treating automatic failover as a consistency guarantee is the gap the book spends an entire section closing.
- **Manual replica placement (spare replicas, `cluster-migration-barrier`) is available and, like manual chunk placement in other systems, is easy to get wrong by omission.** A uniform one-replica-per-master cluster looks resilient and has a real gap: the first failover on any shard leaves that shard with zero replicas until an operator or a spare-replica policy fixes it. The fix costs one design decision (which masters get spares, and how many) made once, at cluster-creation time — cheap before there's data, a live reconfiguration after.

## Documentation Links

- [Vinicius Da Silva, Henrique Cassela, Adhitya Rachman Nugraha, Naga Venkata Sudheer Yaramada, "Redis Essentials" (Packt Publishing, 2015) — Chapter 8, "Scaling Redis (Beyond a Single Instance)", Partitioning through Automatic sharding with twemproxy, p. 148-168; Chapter 9, "Redis Cluster and Redis Sentinel", full chapter, p. 169-196](https://www.packtpub.com/product/redis-essentials/9781784392503) — doc
- [Redis Documentation — Scale with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/) — doc
- [Redis Documentation — Redis Cluster specification (hash slots, hash tags, CRC16)](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) — doc
- [Redis Documentation — High availability with Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/) — doc
- [Redis Documentation — `redis-cli` cluster management mode](https://redis.io/docs/latest/operate/oss_and_stack/reference/cli-tools/) — doc
