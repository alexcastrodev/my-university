---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Compute the reach of a TTL-limited flood, and explain where the tree-shaped estimate stops matching a real graph.
- Explain why TTL is hard to choose, and how expanding ring and multiple random walkers each attack one of flooding's two wastes.
- Describe a super-peer network and state the tradeoff between aggregate and individual load.
- Explain how BitTorrent stops being a search system, and what rarest first and choking each contribute.
- Say what the tit-for-tat result does and does not prove about free riding.

## Context & Motivation

`the-client-server-and-p2p-architectures` noted that discovery and bulk transfer are different sub-problems. `gossip-and-epidemic-dissemination` showed what random contacts do when every replica wants every update. Here peers join and leave at will, nobody controls the overlay or where data sits, and a peer wants one particular thing.

Lv and colleagues call such systems decentralized and unstructured: no central directory, and no precise control over topology or file placement. Gnutella was the famous example. Three responses follow: search with less traffic, give capable peers more of the work, and for bulk distribution drop search altogether.

## Core Theory

### Flooding and the TTL dilemma

A Gnutella node sends its query to all neighbors. Each receiver checks its local files, decrements a time-to-live, and forwards to its other neighbors while the TTL lasts. Duplicate detection stops a node from forwarding a query twice, but the duplicate has already cost its receiver an interrupt.

Jordan Ritter, a founding Napster developer writing in 2001, bounded this in an ideally balanced network where every node holds `N` connections:

```text
reach(N, T) = sum for t = 1..T of N * (N-1)^(t-1)
```

With the original client's `N = 4` and `T = 5` that is 484 users, however many are online. Raising `N` or `T` buys reach geometrically, and traffic grows with it. Lv et al. name the resulting dilemma: too high a TTL burdens the network, too low misses objects that exist, and the right value depends on a replication ratio the user cannot know.

### Two wastes, two fixes

**Expanding ring** attacks the TTL problem: flood with a small TTL, and retry with a larger one until the object appears. Popular objects stop early, but duplicates remain.

**Random walks** are Lv et al.'s answer to duplication. A walker forwards the query to one random neighbor at a time. One walker cuts messages but raises delay by an order of magnitude, so the requester launches `k` walkers, with `k` walkers after `T` steps reaching roughly as many nodes as one walker after `kT` steps. Walkers end by **checking** back with the requester, and the paper found every fourth step a good balance, with 16 to 64 walkers usually good. Its 32-walker result cut message overhead by roughly two orders of magnitude, with hops rising from 2-6 to 4-15. That saving is in the number of messages, so the absolute count of duplicates falls with it, but the duplicate fraction barely moves: Table 2's figures imply about 51% for 32 walkers against 63% for flooding. The same paper finds uniform random graphs better than power-law ones, because high-degree nodes concentrate load and multiply duplicates.

### Super-peers

Yang and Garcia-Molina start from a different observation: peers differ enormously, yet Gnutella gives them equal duties. When its network surged in August 2000, a study they cite found modem peers saturating, dying, and fragmenting the network. A **super-peer** serves a cluster of clients, keeps an index over their data, and answers queries on their behalf, while super-peers connect to each other like peers in a pure network. Clients send queries, joins, and updates only to their super-peer. A pure network is the degenerate case of cluster size 1.

Their rules of thumb, from a cost model using Gnutella message sizes and measured statistics, are:

1. **Increasing cluster size decreases aggregate load but increases individual load.** In their strongly connected case, a super-peer with 100 clients has almost twice the load of one with 50.
2. **Super-peer redundancy is good.** With 2-redundancy at cluster size 100 (strongly connected), aggregate bandwidth rose about 2.5% and each partner's individual bandwidth load fell 48%, though aggregate processing rose about 17%.
3. **Maximize outdegree of super-peers.** Raising average outdegree from 3.1 to 10 cut expected response path length from 5.4 to 3 hops, provided all super-peers do so.
4. **Minimize TTL.** Once a query reaches everyone, extra TTL only adds duplicates: outdegree 20 at TTL 3 used 19% less aggregate incoming bandwidth than TTL 4 for the same full reach.

The cost is that a super-peer becomes a single point of failure and a possible bottleneck for its cluster.

### BitTorrent changes the question

Cohen's BitTorrent does not search. A publisher posts a `.torrent` file with the file's name, length, piece hashes, and a tracker URL. The tracker returns a random list of peers on the same file, and its role is strictly limited to helping peers find each other. What remains is a dissemination problem, closer to the previous lesson than to Gnutella: spread a known file through a random graph of peers who all want all of it.

```text
Pieces:       file cut into pieces (typically a quarter megabyte), each with a
              SHA1 hash in the .torrent; a peer announces a piece only after
              checking it.
Selection:    finish a started piece first (strict priority);
              random until the first complete piece, since a peer has nothing
              to trade yet;
              then RAREST FIRST among the peer's own neighbors;
              near the end, request remaining sub-pieces from all (endgame).
Choking:      unchoke a fixed number of peers (default four), chosen by
              download rate from them (rolling 20 s), recalculated every 10 s.
Optimistic:   one of those four is unchoked regardless of rate, rotated
              every 30 s (BEP 3 counts it among the four).
```

Choking is a variant of tit-for-tat: peers reciprocate to those who upload to them. The optimistic unchoke finds better partners. Rarest first keeps every peer holding something others want, and it replicates scarce pieces before the seed or the only holder leaves.

**Paper vs today:** Cohen's 2003 deployment relied on trackers as the only way for peers to find each other. BEP 5 later added a Kademlia-based DHT for trackerless torrents, and `kademlia-and-pastry` covers that family. Piatek et al. (2007) tested the incentive claim against real swarms and found the mechanism "is not robust to strategic clients": their BitTyrant client gained a median 70% for a 1 Mbit client on live swarms, building on the finding that all peers contribute resources that do not directly improve their performance.

## Worked Examples

All models below are this lesson's own, run in simulation. Sizes and parameters are borrowed from the papers where stated, and the results are not the papers' data unless labeled.

### Example 1: where Ritter's tree stops being true

Floods on a random 4-regular graph of 10,000 nodes, 200 sources per TTL, against the bound `reach(4, T)`:

```text
 T | bound    | reached | messages | duplicates
 5 |     484  |   473.6 |    480.7 |   1.5%
 7 |   4,372  | 3,547   |  4,072   |  12.9%
 8 |  13,120  | 7,298   | 10,603   |  31.2%
 9 |  39,364  | 9,806   | 21,943   |  55.3%
10 | 118,096  | 9,999   | 29,409   |  66.0%
```

Up to `T = 5` the tree is nearly exact, and the default reaches under 5% of this network. Past `T = 7` the bound exceeds the population and it stops predicting anything, while messages keep climbing. The last two TTL steps add 2,700 nodes for 18,800 messages, which is the dilemma in numbers.

### Example 2: checking the search comparison against Table 2

A random graph with Lv et al.'s size (9,836 nodes, 20,099 links), objects at 1% of nodes, comparison against their Table 2 (uniform query and replication, Random graph):

```text
method             messages per node    nodes visited
                   sim       Table 2    sim      Table 2
flood, TTL = 8     2.60      2.509      9,162    9,220
expanding ring     0.066     0.062        570      536
32 walkers         0.028     0.031        135      149
```

Flooding visits nearly everything to find an object held by 1 node in 100, when about 100 visits would suffice on average. The ring saves a factor of about 40, the walkers about 90.

The match has limits. The walker row counts walker steps only. If each check is a request and a reply, as Lv's "message exchange" suggests, checking adds about 0.014 messages per node, and Lv does not say whether Table 2's 0.031 includes checking, so that row's agreement is not established. Hops do not reproduce and are left out of the table: 32 walkers took 7.2 hops to the first hit here against 10.30 in Table 2, and the ring 3.3 against 5.77.

### Example 3: the super-peer tradeoff in query traffic

10,000 peers, a random overlay of average degree 3.1, TTL 7, and Yang and Garcia-Molina's default of 0.00926 queries per user per second with 94-byte queries. Only query messages are counted. Responses, joins, and updates are ignored, so this shows the shape of rule 1 rather than their cost model.

```text
cluster | overlay | peers   | messages  | messages per | arrivals at one
size    | nodes   | covered | per query | peer covered | overlay node
    1   | 10,000  |  3,094  |   3,813   |    1.23      |  35/s,  27 kbps
   10   |  1,000  |  7,946  |   1,572   |    0.20      | 146/s, 110 kbps
  100   |    100  |  9,627  |     212   |    0.02      | 196/s, 147 kbps
```

Moving to cluster size 10 covers 2.6 times the peers with 0.4 times the messages. Each super-peer's arrival rate rises about 4 times, because all 10,000 users' queries now land on 1,000 nodes, and clients see none of it. In the pure network, every peer spends 27 kbps on query arrivals alone, about half a 56 kbps modem before any response.

### Example 4: rarest first against random selection

200 pieces, 50 leechers, one seed, at least 8 neighbors each, every peer uploading one piece per round, 60 runs:

```text
policy    rounds to finish   seed uploads   repeated by seed   complete if seed leaves
                                                               after 220 uploads
random    238                230            30                  3 of 60 runs
rarest    228                214            14                 60 of 60 runs
```

Finish time barely moves, because aggregate upload capacity is the same under both policies. What changes is the seed's scarce upload: rarest first wastes half as many seed uploads on pieces already in the swarm. That decides survival: rarest-first swarms always held the whole file when the seed left at 220 uploads, while random ones almost never did. This fits Cohen's claim that rarest first "does a good job of only downloading new pieces from the seed", though not a perfect one.

### Example 5: what choking does to a free rider

20 peers always holding something the others want: 5 with upload 4, 14 with upload 1, one with upload 0. Each peer has four equal slots: 3 regular by recent rate, plus 1 optimistic drawn from peers outside those three (Piatek et al. describe optimistic targets as peers who have not earned that status). A regular slot with no reciprocating peer is filled at random. 4000 runs:

```text
class              upload   mean download
fast (5 peers)     4        3.45
slow (14 peers)    1        1.16
free rider (1)     0        0.55
```

Totals match, 34 up and 34 down, as Cohen notes they must. Download tracks upload, but not exactly: fast peers subsidize slow ones through optimistic slots. The free rider lives on optimistic capacity: one quarter of 34, shared among the 16 peers outside each uploader's regular set, predicts 0.531. The rest of the measured 0.55 comes from the 2.2% of regular slots filled at random: closing those to the free rider gives 0.53. Drawing the optimistic peer from all 19 other peers instead gives 0.47, or 0.44 without the fill (prediction 0.447). Tit-for-tat here punishes free riding without eliminating it.

## Common Misconceptions & Pitfalls

- **"Flooding traffic is exponential forever."** It is exponential until reach saturates. Example 1 shows messages levelling toward about three per node, and the waste then becomes duplicates.
- **"Super-peers lighten the load on everyone."** Aggregate load falls, and clients are relieved, but the super-peer carries more. Rule 1 exists because the two curves move in opposite directions.
- **"BitTorrent is a better Gnutella."** It answers a different question. It finds no file by keyword, since the `.torrent` must already be in hand.
- **"Tit-for-tat makes contribution mandatory."** Example 5 and Piatek et al. both show otherwise: optimistic slots feed free riders, and strategic clients can gain by contributing less per peer.

## Summary

Flooding spreads a query to `N(N-1)^(t-1)` new nodes per hop until the graph saturates, and its TTL must be set without knowing how rare the object is. Expanding ring removes the TTL guess, and random walkers cut traffic by up to two orders of magnitude, which lowers the absolute count of duplicates even though about half of their messages still are duplicates. Super-peers exploit heterogeneity, trading lower aggregate load for heavier individual load and a failure point per cluster. BitTorrent sidesteps search entirely: a tracker supplies random neighbors, rarest first keeps pieces available, and choking ties download to upload, imperfectly. `chord-a-ring-dht-with-logarithmic-lookup` takes the other path: impose structure, and locate a key in a logarithmic number of hops.

## Documentation Links

- [Ritter: Why Gnutella Can't Scale. No, Really. (2001)](http://www.darkridge.com/~jpr5/doc/gnutella.html): reach and bandwidth bounds for a balanced Gnutella network.
- [Lv et al.: Search and Replication in Unstructured Peer-to-Peer Networks (ICS 2002)](https://www.cse.uoi.gr/~pitoura/courses/p2p05/papers/searchp2p.pdf): limits of flooding, expanding ring, k-walker random walks, and topology comparison.
- [Yang and Garcia-Molina: Designing a Super-Peer Network (ICDE 2003)](https://kldp.org/files/superpeer_296.pdf): the super-peer model, cost analysis, and rules of thumb.
- [Cohen: Incentives Build Robustness in BitTorrent (2003)](https://www.bittorrent.org/bittorrentecon.pdf): trackers, pieces, piece selection, and the choking algorithms.
- [Piatek et al.: Do Incentives Build Robustness in BitTorrent? (NSDI 2007)](https://www.cs.princeton.edu/courses/archive/fall14/cos561/papers/BitTyrant07.pdf): measurement of altruism in real swarms and the BitTyrant strategic client.
- [BEP 3: The BitTorrent Protocol Specification](https://www.bittorrent.org/beps/bep_0003.html): the choking algorithm and the optimistic unchoke.
- [BEP 5: DHT Protocol](https://www.bittorrent.org/beps/bep_0005.html): the Kademlia-based DHT used for trackerless torrents.
