---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define Chord's identifier ring, the successor of a key, and a finger table, and build one by hand.
- Trace `find_successor` through a real ring and explain each forwarding decision.
- Prove the logarithmic bound from the halving argument, and explain why the observed mean is about half of `log2 N`.
- Walk through a join with `stabilize` and `notify`, and say what is wrong at each intermediate step.
- Explain what successor lists protect against, and what Zave's analysis established about Chord's claimed correctness.

## Context & Motivation

`consistent-hashing-for-data-partitioning` placed nodes and keys on one ring, so a key's owner is the first node clockwise. It left a question open: how does a node find that owner? The Chord paper points out that previous consistent hashing work assumes each node knows most of the others, which does not scale to a large, changing peer-to-peer population.

`unstructured-p2p-flooding-super-peers-and-bittorrent` showed the other extreme, where nobody knows anything and queries are flooded. Chord, from Stoica and colleagues, sits between the two. Its entire interface is one operation: given a key, map it to a node. In an `N`-node system each node keeps information about `O(log N)` others, and a lookup takes `O(log N)` messages. Storage, replication, and naming belong to the layer above.

Variant note: this lesson follows the 2003 IEEE/ACM Transactions on Networking paper (Figures 5 and 6). The 2001 SIGCOMM paper first presents an aggressive join that updates other nodes' finger tables, then replaces it with stabilization for concurrent joins, and refreshes a random finger rather than cycling through them.

## Core Theory

### The ring and the finger table

Identifiers have `m` bits, from SHA-1 of a node's IP address or of a key, ordered on a circle modulo `2^m`. Key `k` belongs to `successor(k)`, the first node whose identifier equals or follows `k`.

Successor pointers alone give correct lookups in `O(N)` hops. Fingers make them fast:

```text
n.finger[i] = successor((n + 2^(i-1)) mod 2^m),  1 <= i <= m
```

Finger 1 is the successor. A node knows nearby nodes densely and distant ones sparsely, and usually cannot name the owner of an arbitrary key from its own table. It only knows someone closer. Fingers are not needed for correctness, which requires only that each node knows its correct successor.

### Lookup

```text
n.find_successor(id):
  if id in (n, successor]:  return successor
  n' = closest_preceding_node(id)     // highest finger in (n, id)
  return n'.find_successor(id)
```

Each node forwards to the finger that most immediately precedes `id`, because the closer a node is to `id`, the more it knows about that region. The paper's simulator resolves lookups iteratively, with the initiator asking each node in turn, but the path is the same when each node forwards recursively.

### Why it is logarithmic

Let `p` be the node immediately preceding `k`, and suppose the query is at `n`. Take the `i` with `p` in `[n + 2^(i-1), n + 2^i)`. The interval is not empty, so finger `i` is some `f` in it. Now `f` is at least `2^(i-1)` from `n`, and `f` and `p` share an interval of width `2^(i-1)`, so `f` is no farther from `p` than from `n`. The remaining distance at least halves on each hop, giving at most `m` hops. With random identifiers it is better: after `2 log N` hops the distance is at most `2^m / N^2`, an interval unlikely to hold another node, so the bound becomes `O(log N)` with high probability.

The observed mean is about `(1/2) log2 N`. Read the distance to the target in binary. Each hop clears a 1 bit, and only about half of the top `log N` bits are 1.

### Joining: stabilization

Chord adds nodes without touching other nodes' tables at join time:

```text
n.join(n'):     predecessor = nil; successor = n'.find_successor(n)
n.stabilize():  x = successor.predecessor
                if x in (n, successor): successor = x
                successor.notify(n)
n.notify(n'):   if predecessor is nil or n' in (predecessor, n):
                    predecessor = n'
n.fix_fingers():      refresh the next finger with find_successor
n.check_predecessor(): clear predecessor if it has failed
```

All of these except `join` run periodically. The paper's Theorem IV.3 says that if joins interleave with stabilizations, then at some time after the last join the successor pointers form a cycle on all nodes. Stale fingers only cost speed, because lookups undershoot and then walk successors. Correctness depends on successors, and the hard case is wrong successors or keys not yet moved, where a lookup may fail and the application retries. Under churn with up to 12 joins and 12 leaves per stabilization period on about 1,000 nodes, Table III shows at most 16 failed lookups per 10,000.

### Failures: successor lists

A failed successor can break the ring, so each node keeps its first `r` successors, and `closest_preceding_node` searches this list too. If each node fails independently with probability `p`, all `r` fail with probability `p^r`. Theorem IV.5: with `r = Omega(log N)` in an initially stable network, if every node fails with probability 1/2, then with high probability `find_successor` still returns the closest living successor. The same list tells the layer above where to keep replicas, on the `k` nodes after a key.

### What "provably correct" turned out to mean

The Chord papers name provable correctness as a distinguishing feature. Pamela Zave modeled the ring-maintenance protocol in Alloy, taking correctness to mean eventual reachability: given ample time and no further disruptions, the protocol repairs the ring. Her 2012 result: "Under the same assumptions about failure behavior as made in the Chord papers, no published version of Chord is correct." None of the seven properties claimed as invariants in the PODC paper holds for the SIGCOMM version, and the PODC version satisfies one but is still not correct. The joins-only protocol is correct. Trouble enters with failures, which can leave a broken ring, two rings, or a disordered ring.

Her 2015 paper gives a corrected specification with an inductive invariant and proof. Stabilization and successor-list reconciliation are combined, and a member checks that a node is alive before adopting a pointer to it. Initialization also changes: a network must start with at least `r + 1` members, and the proof assumes a **stable base** of `r + 1` members that never leave. Zave explains that the remaining anomalies occur only in small rings, so implementers can stop preserving the base once the network has grown to a safe size, provided that the network does not shrink drastically.

## Worked Examples

Everything below is output from a Python implementation of the ToN pseudocode. The first three examples use the paper's Figure 2 ring: `m = 6`, nodes 1, 8, 14, 21, 32, 38, 42, 48, 51, 56.

### Example 1: finger tables and real lookup paths

```text
          start -> finger for i = 1..6
N8    9->14  10->14  12->14  16->21  24->32  40->42
N42  43->48  44->48  46->48  50->51  58->1   10->14
N51  52->56  53->56  55->56  59->1    3->8   19->21

lookup(54) from N8:  N8 -> N42 -> N51, answer N56
lookup(34) from N8:  N8 -> N32,        answer N38
lookup(10) from N51: N51 -> N8,        answer N14   (wraps past 0)
lookup(63) from N1:  N1 -> N38 -> N56, answer N1    (wraps past 0)
```

For `lookup(54)`, the highest finger of N8 inside (8, 54) is N42. N42's fingers 58->1 and 10->14 overshoot, so 50->51 wins. At N51, 54 lies in (51, 56], so N51 returns N56. This matches the paper's Figure 4(b). Note `lookup(34)`: N8 cannot answer alone, since N38 is not in its table. Over all 640 node and key pairs in this ring, fingers average 1.50 forwards (worst 3), and successor pointers alone average 4.50 (worst 9).

### Example 2: N26 joins between N21 and N32

Each line is the state after the step, with `lookup(24)` run from N8. Before the join its answer is correctly N32.

```text
step               21.succ  26.succ  26.pred  32.pred  lookup(24) from N8
26.join(8)         32       32       nil      21       N8->N21, answer N32
26.stabilize       32       32       nil      26       N8->N21, answer N32
21.stabilize       26       32       21       26       N8->N21, answer N26
```

N26 finds its successor with an ordinary lookup, and nobody else changes. Then N26's `notify` moves N32's predecessor. Only N21's own stabilization switches the ring over, and at that moment the lookup answer changes. In the first two rows, key 24 already belongs to N26 but is still reported at N32. In the paper's Figure 7, N26 copies keys below 26 from N32, so N32 can still serve it.

After the third row the successors are right, and five fingers across the ring are stale: (N8, start 24), (N14, 22), (N21, 23 and 25), and (N56, 24). The lookup was already correct without them. `fix_fingers` then repairs them.

As a stress test, the ring was built from one node, with the other nine joining through N1 before any stabilization. Ten rounds of `stabilize` in random order made all successors correct. Six more rounds of `stabilize` plus `fix_fingers` made all fingers correct, and `lookup(54)` from N8 took the same path as in Example 1.

### Example 3: the failure the paper warns about

Nodes 14, 21, and 32 fail at once, and stabilization has not run. The paper's case is key 30 from N8, whose correct successor is now N38.

```text
r   N8's successor list   lookup(30) from N8
1   [14]                  answer N42  WRONG
3   [14, 21, 32]          answer N42  WRONG
4   [14, 21, 32, 38]      answer N38  correct
```

With `r = 3` every entry is dead, and N8's nearest live contact is finger 40->42, so it treats N42 as its successor. The wrong answer is not a crash, and nothing reports it. A fourth entry fixes it, since the list only has to reach one survivor.

### Example 4: measuring the bound

Random rings, `m = 32`, ideal pointers, 20,000 lookups, counting forwards:

```text
N          16    64    256   1024  4096  16384
mean       1.88  2.92  3.92  4.85  5.86  6.87
(1/2)log2N 2     3     4     5     6     7
worst      4     6     9     10    12    14
```

Halving was checked directly on a 1,024-node ring. Across 97,495 forwards, the largest ratio of new distance to old distance from the key's predecessor was 0.4996, under the 0.5 the proof promises. One real path had distances 2,293,836,370, then 121,043,922, 49,700,333, 15,208,025, 4,324,995, and 0.

Reproducing the paper's Table II with `N = 1000` and `r = 20` gives a mean path of 3.76 (paper: 3.84, formula: 3.82). With half of the nodes failing at once and no repair, it gives 4.96 (paper: 5.09), and none of 20,000 lookups returned a wrong node. The paper likewise reports every lookup resolved.

### Example 5: Zave's small-ring counterexample

With `r = 2`, starting the original way from one node, which is the scenario of her 2015 Figure 3:

```text
48 creates the ring       48: [48, 48]
62 and 37 join            62: [48, 48]   37: [48, 48]
62 notifies 48            48.pred = 62
48 stabilizes             48: [62, 48]   62.pred = 48
48 fails                  62: [48, 48]   37: [48, 48]    no live successor
```

Both survivors hold a list of length 2 with one distinct entry, and they have no way to find each other. Starting instead from an ideal three-node ring (`r + 1`), the lists are 37: [48, 62] and 62: [37, 48], and after 48 fails each still has a live successor. The list was long enough but not diverse enough: its entries must be distinct nodes.

## Common Misconceptions & Pitfalls

- **"Fingers make Chord correct."** Fingers make it fast. Example 2 returned the right answer with five stale fingers, and Example 3 went wrong because of successors.
- **"A lookup takes `log2 N` hops."** That is the order of the bound. The mean is about half of it, as Example 4 shows.
- **"Each hop halves the number of nodes left."** It halves identifier distance. Node counts follow only because identifiers are random.
- **"A join is finished when the node has its successor."** Example 2 shows the ring still ignoring N26 at that point.
- **"Chord was proven correct."** The original proofs did not survive Zave's analysis under the papers' own assumptions. Her corrected version is proved, with changed operations, initialization, and a stable base assumption.
- **"Those flaws are only theoretical."** Zave reports hearing that view, and answers that the probability of subtle bugs cannot be known without implementation-specific assumptions, and that Chord-based research needs a sound foundation.

## Summary

Chord assigns keys by consistent hashing and adds routing state of `O(log N)` fingers at power-of-two distances. Forwarding to the closest preceding finger at least halves the identifier distance each hop, giving `O(log N)` hops with high probability and about `(1/2) log2 N` in practice. Joins are lazy: `stabilize` and `notify` repair successors, `fix_fingers` repairs fingers, and only successors matter for correctness. Successor lists survive massive simultaneous failure, as long as one listed node lives. Zave showed that the original protocol does not guarantee eventual reachability under its stated assumptions, and gave a corrected version whose difficulties are concentrated in small rings. `kademlia-and-pastry` continues with DHTs that route by shared digits or XOR distance rather than clockwise distance.

## Documentation Links

- [Stoica et al.: Chord: A Scalable Peer-to-peer Lookup Protocol for Internet Applications (IEEE/ACM ToN, 2003)](https://pdos.csail.mit.edu/papers/ton:chord/paper-ton.pdf): the version this lesson follows, with lookup and stabilization pseudocode, theorems, and simulations.
- [Stoica et al.: Chord: A Scalable Peer-to-peer Lookup Service for Internet Applications (SIGCOMM 2001)](https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf): the original conference paper and its earlier join and stabilization presentation.
- [Zave: Using Lightweight Modeling to Understand Chord (ACM CCR, 2012)](https://www.cs.princeton.edu/courses/archive/fall14/cos561/papers/ChordModel12.pdf): the Alloy analysis showing that the published versions lack eventual reachability, with counterexamples to the claimed invariants.
- [Zave: How to Make Chord Correct (arXiv, 2015)](https://arxiv.org/pdf/1502.06461): corrected operations, the inductive invariant, the stable base, and the proof.
