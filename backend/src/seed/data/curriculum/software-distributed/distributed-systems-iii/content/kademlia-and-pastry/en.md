---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Compute Kademlia's XOR distance between two identifiers and place a contact in the correct k-bucket.
- Trace a Kademlia lookup with parameters `k` and `α`, and state when it terminates.
- Route a Pastry message by hand with the leaf set, the routing table, and the rare-case rule.
- Explain why Kademlia's single metric and Pastry's two metrics can name different closest nodes for the same key.
- Say what parallel lookups and proximity-aware tables buy in practice, and what they do not guarantee.

## Context & Motivation

`chord-a-ring-dht-with-logarithmic-lookup` showed that logarithmic state gives logarithmic lookups. That bound says nothing about which route is fast, or what a lookup does when a contact has silently died. Kademlia's authors put the complaint in terms of Chord: its asymmetric metric means nodes learn no useful routing information from the queries they receive, and each finger must store one precise node, which leaves no freedom to pick by latency.

Pastry (Rowstron and Druschel, Middleware 2001) and Kademlia (Maymounkov and Mazières, IPTPS 2002) both route by identifier prefix, and both replace "the one correct entry" with a choice among several valid ones. They spend that freedom differently: Pastry on network proximity, Kademlia on parallel queries. Placement stays the idea of `consistent-hashing-for-data-partitioning`, with nodes and keys hashed into one space, but the rule for "closest" changes.

## Core Theory

### Kademlia: distance is XOR

Node IDs and keys are 160-bit. The distance is `d(x, y) = x XOR y`, read as an integer. It is a true metric, though not a Euclidean one. Two properties do the work:

- **Symmetric:** `d(x, y) = d(y, x)`. The nodes that query you are distributed like the nodes your table wants, and since every message carries the sender's ID, ordinary traffic maintains the table.
- **Unidirectional:** for a point `x` and distance `Δ > 0`, exactly one `y` satisfies `d(x, y) = Δ`. Lookups for one key from anywhere converge along the same path, which is why caching along that path relieves hot spots.

The leading zeros of `x XOR y` count the prefix `x` and `y` share, so a node can picture itself as a leaf of a binary tree. The protocol guarantees it a contact in every subtree it does not belong to, if that subtree holds a node.

### k-buckets

For each `0 <= i < 160`, a node keeps up to `k` contacts at distance in `[2^i, 2^(i+1))`. The paper's example is `k = 20`, chosen so that any `k` nodes are very unlikely to fail within an hour of each other. A bucket is ordered by time last seen, oldest at the head. When a message arrives:

```text
sender already in bucket   -> move it to the tail
bucket has room            -> insert sender at the tail
bucket full                -> ping the head (least recently seen)
    head silent            -> evict it, insert sender at the tail
    head answers           -> move head to the tail, DISCARD sender
```

Live contacts are never evicted. The paper gives two reasons: Gnutella traces showed that the longer a node has been up, the likelier it stays up another hour, and flooding the system with new nodes cannot flush existing routing state.

The proceedings version also grows the table as a tree: one bucket covers the whole space, and a full bucket splits when its range holds the node's own ID. That is not the only trigger: the paper also splits other buckets to keep all valid contacts in a subtree of at least `k` nodes, and to route `b > 1` bits per hop.

### The lookup: k, α, and who does the work

A node lookup finds the `k` closest nodes to an ID. The initiator picks `α` nodes (`α` is a system-wide concurrency parameter, such as 3) from its closest non-empty bucket and sends them parallel, asynchronous `FIND_NODE` RPCs. Each recipient returns the `k` closest contacts it knows. The initiator then queries `α` not-yet-asked nodes from the `k` closest it has heard of, without waiting for every earlier reply. If a round finds nothing closer than the best seen, it asks all of the `k` closest it has not asked. It stops once the `k` closest it has seen have all answered.

The paper calls this algorithm "recursive", yet the initiator sends every RPC; no node forwards anything. Storing a pair means `STORE` at those `k` nodes, repeated hourly. `FIND_VALUE` stops at the first node holding the value, and the requester then caches the pair at the closest node it saw that lacked it.

Expected hops are `log2 n`. Looking at `b` bits per hop raises the table to an expected `2^b log_(2^b) n` buckets and drops hops to `log_(2^b) n`. The implementation described in the paper uses `b = 5`.

### Pastry: digits, then numbers

Pastry's nodeIds are 128-bit points on a circle, read as digits in base `2^b` (typical `b = 4`). A message goes to the live node numerically closest to its key. Each node keeps:

```text
routing table R  ceil(log_(2^b) N) rows of 2^b - 1 entries. Row l holds nodes
                 sharing l digits with this node and differing in digit l.
leaf set L       the |L|/2 numerically closest smaller and larger nodeIds.
neighborhood M   the closest nodes by proximity; not normally used for routing.
```

At node `A`, with key `D` and `shl` the shared prefix length in digits, the procedure is:

```text
1. D within the range of L  -> forward to the member of L closest to D (or stop at A)
2. l = shl(D, A); R[l][digit l of D] exists  -> forward there
3. rare case -> forward to any T in L, R or M with shl(T, D) >= l and |T - D| < |A - D|
```

A route has three kinds of step. A table step lengthens the shared prefix, a rare-case step keeps at least the same prefix and gets numerically closer, and a leaf-set hop goes straight to the numerically closest node, even if that shortens the prefix, as in Example 3. With accurate state, this progress makes routing converge. With `b = 4` and `10^6` nodes, a table averages 75 entries and a route takes 5 expected hops; at `10^9` nodes the figures are 105 and 7. Case 3 arises on less than 2% of routes with `|L| = 2^b` and 0.6% with `|L| = 2 × 2^b`. Delivery is guaranteed unless `|L|/2` adjacent nodes fail at once.

### Locality and parallelism spend the same freedom

Many nodes can fill any given entry. Pastry picks the closest under a scalar proximity metric such as IP hops, and a joining node inherits and then refines rows from the nodes on its join route. Because each row chooses from an exponentially smaller set, hops grow longer as a route proceeds. In emulation with up to 100,000 nodes, Pastry routes were roughly 30% to 40% longer than a fictitious scheme with complete tables, for about 75 entries instead of 99,999.

A Kademlia initiator can query any of the `k` nodes in a bucket, can use round-trip estimates to pick the `α`, and tolerates dead contacts without waiting for them. Example 4 puts rough numbers on both ideas.

### Where the two designs part

Kademlia's authors describe Pastry as two phases: a first that halves XOR distance, and a second on numeric difference. Nodes close by the second metric can be far by the first, which they say creates discontinuities and complicates formal analysis. Kademlia uses one algorithm and one metric from start to finish. Pastry's paper came first and does not address this criticism. Its failure experiment measures something else, route quality under failure and repair: at 5,000 nodes with 500 failing, average hops rose from 2.73 to 2.96 before repair and returned to 2.74 after.

**Paper vs. today:** the Gnutella traces and `b = 5` belong to 2002. BitTorrent's Mainline DHT (BEP 5) is a deployed descendant: 160-bit IDs, XOR distance, and buckets of eight (`K`, "currently eight"), splitting only when the bucket's range holds the node's own ID. It stores peer contacts, not files, and requires a token from a recent `get_peers` before accepting `announce_peer`, which stops hosts from signing up others.

## Worked Examples

All four run in a simulator. The first three share one network: 64 nodes `node-00` to `node-63`, each ID being the first 16 bits of the SHA-1 of the name (real systems use 160 and 128 bits). Kademlia tables come from running the join protocol with `k = 3`, `α = 2`. Pastry tables are built from global knowledge with `b = 2`, `|L| = 4`, and each entry picks the closest candidate in a 1000 by 1000 plane, the same kind of space Pastry's emulator used.

### Example 1: XOR distances and bucket assignment

`SHA-1("node-01")` starts `f20a49fc...`, so the node is `f20a = 1111 0010 0000 1010`. For a contact `839c`:

```text
f20a  1111 0010 0000 1010
839c  1000 0011 1001 1100
XOR   0111 0001 1001 0110 = 7196   highest set bit is 14, so bucket 14
```

Its real table after all 64 joins:

```text
 i  distance range  nodes in range  contacts held (head first)
15  8000-ffff       25              280d 5953 0385
14  4000-7fff       19              839c 9a90 ad9f
13  2000-3fff       13              d1df dda9 ccba
12  1000-1fff        2              e072 e668
11  0800-0fff        2              fbcf fe0d
10  0400-07ff        1              f753
 9  0200-03ff        1              f10c
```

The node holds 15 of the other 63, thick near itself and thin far away. A new contact for bucket 15 triggers a ping to `280d`, and if `280d` answers, the newcomer is dropped.

### Example 2: a Kademlia lookup

`SHA-1("ubuntu.iso")` starts `8b2c`. From `f20a`, `d = f20a XOR 8b2c = 7926`, so the closest non-empty bucket is 14. Distances to the key are in parentheses:

```text
candidates: 839c (08b0), 9a90 (11bc), ad9f (26b3)
round 1, ask 839c, 9a90 -> learn 88cd (03e1), 8f40 (046c), 8d2e (0602)
round 2, ask 88cd, 8f40 -> nothing closer than 03e1
round 3, ask 8d2e (the last unasked of the k closest) -> nothing closer
result: 88cd, 8f40, 8d2e
```

Five RPCs, and the result matches the true three closest in the network.

### Example 3: a Pastry route for the same key

The key is `20230230` in base 4. From the same node:

```text
hop  node (base 4)     hex  shl  rule            numeric dist  XOR dist
 0   33020022         f20a   0   R[0][2]         66de          7926
 1   23203130         b8dc   1   R[1][0]         2db0          33f0
 2   20203031         88cd   3   leaf set        025f          03e1
 3   20310232         8d2e   2   delivered       0202          0602
```

Hop 1 had 19 eligible nodes and took the nearest, at plane distance 188. Hop 2 had 4 and took `88cd` at 107, against 468 or more for the others. The last hop came from the leaf set, which ignores proximity: it costs 584, and the route totals 879 against 412 direct.

Moving to `8d2e` lowers the numeric distance from `025f` to `0202`, shortens the shared prefix from 3 to 2, and raises the XOR distance. So Pastry's owner is `8d2e` while Kademlia's closest is `88cd`. In this network the two rules name different nodes for 16,831 of the 65,536 keys (25.7%). That is the discontinuity Kademlia's authors describe, visible in one hop.

### Example 4: what proximity and parallelism buy

These are small simulations, not results from either paper. Pastry with 2,000 nodes, `b = 4`, `|L| = 16`, in the same plane, over 20,000 random routes:

```text
entry choice   avg hops   route length / direct distance
closest         2.69      1.32
random          2.69      2.70
```

Proximity leaves the hops unchanged and halves the route length. The 32% overhead over the direct distance falls in the paper's 30% to 40% range.

Kademlia with 2,000 nodes, `k = 8`, round trips of 0.2 ms per plane unit, and a 1000 ms timeout, over 4,000 lookups. Times are until the initiator hears from the closest live node:

```text
dead nodes   α   median ms   p90 ms   RPCs per lookup
    0%       1      263        425         9.0
    0%       3      221        348        11.5
   10%       1      303       1356        10.1
   10%       3      234        377        12.3
```

With no failures `α = 3` buys little. With 10% dead, sequential lookups pay a full timeout on each dead contact in their way, and the tail shows it: 1356 ms against 377 ms, for about 22% more RPCs.

## Common Misconceptions & Pitfalls

- **"XOR distance is just numeric distance in disguise."** In Example 3, `8d2e` is numerically closer to `8b2c` than `88cd`, while `88cd` is closer by XOR.
- **"Kademlia's lookup is recursive, so nodes forward the query."** The word is the paper's, but the initiator sends every RPC. Pastry is the design that forwards hop by hop.
- **"A full bucket makes room by evicting its oldest contact."** The oldest contact is pinged, and if alive it stays while the newcomer is dropped.
- **"`α` makes lookups faster."** Mostly it makes them less fragile. Example 4 shows a small gain with no failures and a large one in the tail with failures.
- **"Proximity-chosen tables give shortest paths."** Pastry's paper says the procedure does not guarantee the shortest route, since each decision is local. Numerically adjacent nodes are scattered by design, as Example 3's 584-unit final hop shows.

## Summary

Kademlia measures distance by XOR, so one symmetric, unidirectional metric drives routing and table maintenance. Its k-buckets keep up to `k` contacts per distance range and prefer old live contacts, and its lookups query `α` nodes at a time until the `k` closest have answered. Pastry routes hop by hop on base `2^b` digits, finishes numerically through a leaf set, and fills each table entry with a nearby node. Both reach logarithmic hops. They differ in what "closest" means, in who sends the messages, and in how they spend the freedom of having many valid next hops. `publish-subscribe-over-a-dht` builds on Pastry's routes next.

## Documentation Links

- [Maymounkov and Mazières (2002): Kademlia, a peer-to-peer information system based on the XOR metric](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf): the XOR metric, k-buckets, the lookup procedure, table splitting, and the comparison with Pastry.
- [Rowstron and Druschel (2001): Pastry, scalable, decentralized object location and routing for large-scale peer-to-peer systems](https://people.mpi-sws.org/~druschel/publications/Pastry.pdf): node state, the routing procedure, locality, and the emulation results.
- [BEP 5: DHT Protocol](https://www.bittorrent.org/beps/bep_0005.html): the Kademlia-based DHT deployed in BitTorrent, with its bucket rules, node status, and `get_peers` and `announce_peer` messages.
