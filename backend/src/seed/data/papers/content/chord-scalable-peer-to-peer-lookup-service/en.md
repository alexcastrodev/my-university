---
title: "Chord: A Scalable Peer-to-peer Lookup Service for Internet Applications"
summary: Stoica and colleagues present Chord, a protocol that maps any key onto a node of a peer-to-peer network with consistent hashing and a per-node table of O(log N) "fingers", so that lookups cost O(log N) messages while nodes join and leave continuously.
researchArea: Distributed Systems
keywords: chord, distributed hash table, consistent hashing, peer-to-peer, finger table, stabilization
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A fundamental problem that confronts peer-to-peer applications is to efficiently locate the node that stores a particular data item. This paper presents Chord, a distributed lookup protocol that addresses this problem. Chord provides support for just one operation: given a key, it maps the key onto a node. Data location can be easily implemented on top of Chord by associating a key with each data item, and storing the key/data item pair at the node to which the key maps. Chord adapts efficiently as nodes join and leave the system, and can answer queries even if the system is continuously changing. Results from theoretical analysis, simulations, and experiments show that Chord is scalable, with communication cost and the state maintained by each node scaling logarithmically with the number of Chord nodes.

## Overview

In 2001 the peer-to-peer systems the paper compares itself with each had a weak spot in finding data. Napster relied on a central server, Gnutella flooded queries by broadcast and did not scale, and Freenet searched for cached copies, which gave some anonymity but no guarantee of finding an existing document or a bound on the cost. Chord, published at ACM SIGCOMM 2001 by researchers from MIT and UC Berkeley, argues that the core operation under all of these systems is one function: given a key, find the node responsible for it. It then builds a protocol that does only that, with provable cost.

Chord leaves everything else to the application: replication, caching, authentication and naming sit in a higher layer, and the library only tells the application when the set of keys a node owns changes. Hash rings also appear in [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), which cites Chord and takes a different route: its authors avoid multi-hop routing for latency reasons (see Critical Analysis).

Worth knowing first: what a hash function does, why a plain `hash(key) mod N` forces most keys to move when N changes, and the basics of the logarithm (doubling the nodes adds one step).

## Contribution

- **A one-operation service.** `lookup(key)` returns the IP address of the node responsible for the key. The key space is flat, so applications choose their own naming.
- **Consistent hashing on an identifier circle.** Nodes and keys get m-bit identifiers from a base hash such as SHA-1 (a node's identifier is the hash of its IP address). A key belongs to its successor, the first node whose identifier is equal to or follows it on the circle modulo 2^m.
- **Finger tables.** Node n keeps m entries, and entry i points to the first node that succeeds n by at least 2^(i-1). A node knows many nodes close to it and few far away, and a lookup forwards to the finger that most closely precedes the key, which halves the remaining distance each hop.
- **Join, leave and stabilization.** The base join keeps fingers exact when one node arrives. For concurrent joins and failures, a periodic `stabilize` keeps successor pointers correct, which alone guarantees correctness, and `fix_fingers` repairs the table for speed. A list of r successors handles failures.
- **Separating correctness from performance.** Only the successor pointers must be right for lookups to be correct, though possibly slow.

## Methodology

The paper combines analysis, simulation and a prototype. Section 4 gives the algorithms in pseudocode and proves bounds. The proofs of several theorems (3, 4, 5, 7 and 8) are in the companion technical report, not in the paper. A worked example uses m = 3 and the nodes 0, 1 and 3: key 1 lives at node 1, key 2 at node 3 and key 6 at node 0, and a node with identifier 7 joining would take key 6 from node 0.

The simulator runs the lookup algorithm of the paper and a slightly older version of the stabilization routines, in the iterative style, where the querying node contacts each hop itself. Experiments cover load balance, path length, simultaneous failures and lookups during stabilization. The prototype runs on UNIX, uses 160-bit SHA-1 keys and TCP, and was measured by Frank Dabek on ten sites of the RON testbed, with more than ten nodes obtained by running several independent copies per site. Each physical site issued 16 lookups per node count.

## Findings

Theorems first, then the measurements. The bounds hold with high probability or under standard hardness assumptions about SHA-1.

- **Cost.** Each node keeps information about O(log N) others, and a lookup contacts O(log N) nodes (Theorem 2). A join or leave takes O(log² N) messages (Theorem 3), and only O(K/N) of K keys change hands.
- **Concurrent joins.** After the last join all successor pointers are correct (Theorem 5), and a node that could resolve a query can always do so later (Theorem 4). With N nodes in a stable network, up to N more joining without fingers still leaves lookups at O(log N) (Theorem 6).
- **Failures.** With a successor list of logarithmic length, even if every node fails with probability 1/2, a lookup still finds the closest living successor in expected O(log N) time (Theorems 7 and 8).
- **Load balance.** With 10,000 nodes and 5 x 10^5 keys, the most loaded node held 457 keys, 9.1 times the mean, and the 99th percentile was 4.6 times the mean. Some nodes held no keys. With 10^6 keys, raising virtual nodes per real node from 1 to 20 cut the 99th percentile from 4.8 to 1.6 times the mean.
- **Path length.** Simulating N = 2^k nodes for k from 3 to 14, the mean path length was about (1/2) log2 N, because on average half the bits of the distance are ones and only those need a finger.
- **Simultaneous failures.** With 10,000 nodes and 10^6 keys, the lookup failure rate was almost exactly the fraction p of failed nodes, which is the share of keys that lived on failed nodes.
- **Churn.** With 500 nodes and stabilization every 30 seconds, failures during lookups grew with the join and leave rate. The authors estimate about 3% for three failures between stabilizations, and note that the simulator does not retry.
- **Prototype.** Median latency was 180 to 285 ms. At 180 nodes a lookup needs five round trips, and with roughly 60 ms between sites the expected 300 ms is close to the measured median of 285.

## Critical Analysis

The paper is unusually clear about what it does not solve, and many of the limits below are stated by the authors.

- **Partitions.** Stabilization cannot repair a ring that has split into several cycles or one that loops around the space more than once. The authors say these cases cannot come from ordinary joins, but it is unclear whether partitions and recoveries could produce them.
- **Security.** Chord does not provide anonymity. An attacker could insert a node with an identifier right after a key's and return errors for it. The paper suggests deriving identifiers from the SHA-1 hash of the IP address and checking them, and lists a malicious ring participant as a threat.
- **Network distance.** Chord ignores topology: a hop may cross an ocean. The authors concede it exploits locality less well than Plaxton's protocol and Globe, and propose finger choices by measured delay as future work.
- **Evaluation scale.** The churn simulation has 500 nodes, and the prototype is "preliminary", with fewer than 200 nodes, mostly copies sharing ten sites.

Later literature, not claimed by the paper:

- **Dynamo.** The [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) paper cites Chord and says multi-hop routing "increases variability in response times" at high percentiles. Dynamo instead gives every node enough routing information to reach any other in one hop, which it calls a zero-hop DHT.
- **Correctness.** Pamela Zave modeled the ring-maintenance protocol in Alloy and reported in ACM SIGCOMM CCR (2012) that, under the failure assumptions of the Chord papers, no published version of Chord is correct, and that a corrected version may exist.
- **Production DHTs.** BitTorrent's trackerless DHT (BEP 5) is described as based on Kademlia, with an XOR distance metric, not on Chord.

## Further Research

- Healing partitioned rings, by sampling the ring or by keeping long-term memory of past neighbors (the authors' ideas).
- Choosing fingers or successors by network proximity to cut lookup latency, and alternative finger spacing such as distances that are powers of 1 + 1/d.
- Resisting malicious or buggy participants that present a wrong view of the ring.
- The journal version, *Chord: a scalable peer-to-peer lookup protocol for internet applications* (IEEE/ACM Transactions on Networking, 2003), and its relation to this paper.
- Formal specification and machine-checked proofs of ring maintenance, such as Zave's work.
