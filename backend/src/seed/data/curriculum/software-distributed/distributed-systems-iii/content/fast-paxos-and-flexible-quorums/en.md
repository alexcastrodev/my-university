---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain how a Fast Paxos fast round saves one message delay, and why votes can then split.
- State the Fast Paxos Quorum Requirement, derive quorum sizes from N > 2F and N > 2E + F, and apply the coordinator's value-picking rule after a collision.
- State the Flexible Paxos observation that only quorums from different phases must intersect, and explain why quorums within a phase need not.
- Compute the availability trade-offs of simple and grid quorums.
- Relate both ideas through Fast Flexible Paxos.

## Context & Motivation

`multi-paxos-from-one-decision-to-a-replicated-log` left a leader in the normal-case path of every command and a majority in both phases. This lesson questions both defaults. Fast Paxos (Lamport, 2006) removes the leader from the common path and pays with larger quorums. Flexible Paxos (Howard, Malkhi, and Spiegelman, 2016) shows that majorities were stronger than necessary. Both are arguments about the overlap reasoning of `primary-backup-vs-quorum-based-replication`: what exactly must intersect, and why?

## Core Theory

### The fast path

Lamport counts delays between a client's proposal and learning. With proposers separate from acceptors, the classic pattern takes three:

```text
classic:  proposer -> leader -> acceptors -> learners
fast:     proposer -> acceptors -> learners
```

To open the shortcut, rounds are partitioned into fast and classic. In a fast round whose coordinator is free to pick any value, it sends a special "any" message instead of a value, normally when it becomes leader and before any proposal exists. An acceptor then treats the first proposal it receives as if it came from the coordinator. The saved delay is the hop through the leader.

### What breaks

In a classic round, one coordinator picks one value, so all votes in a round agree. Fast rounds lose this guarantee: two proposals sent at about the same time can reach acceptors in different orders, and votes split. Lamport calls this a collision. The old rule in phase 2a, take the value from the highest-numbered round, stops working because that round may now hold several values.

The coordinator of the next round must then decide from a quorum Q of reports. Let k be the highest round reported and V the values voted in round k. Lamport's Observation 4 gives the test: a value v can have been chosen in round k only if O4(v) holds, meaning some k-quorum R exists whose members in Q all voted v in round k.

```text
if no acceptor in Q has voted:  pick any proposed value
else if V has one value:        pick it
else if some w in V has O4(w):  pick w  (it is unique)
else:                           pick any proposed value
```

Uniqueness is not automatic. If O4(v) and O4(w) both held, the coordinator would be stuck, unable to rule out either. The Quorum Requirement makes this impossible:

```text
(a) any two quorums intersect
(b) any two fast quorums and any classic or fast quorum
    have a non-empty intersection
```

### Choosing sizes

When quorums depend only on size, let any N - F acceptors form a classic quorum and any N - E a fast quorum. For E <= F, the requirement reduces to:

```text
N > 2F    and    N > 2E + F
```

Lamport gives two natural choices. Maximizing E yields E = F = ceil(N/3) - 1. Maximizing F yields F = ceil(N/2) - 1 and E = floor(N/4), which is the usual three-quarters fast quorum. This is not an artifact of one algorithm. Lamport's Fast-Accepting Lemma shows that a general fast-learning algorithm must meet the same intersection condition, and his lower-bound paper states the bound as n > 2e + f.

Fast Paxos still has a coordinator. It sends the "any" message, and with E < F it decides whether fast rounds are worthwhile. Each coordinator also owns infinitely many classic rounds, because classic rounds are how progress is guaranteed.

### Paying for collisions

Lamport gives three ways out. A completely new round costs both phases. Coordinated recovery treats round i phase 2b messages as phase 1b messages for classic round i + 1 and adds two message delays. Uncoordinated recovery has acceptors send phase 2b messages to each other and vote in fast round i + 1, adding one delay, which gives the three-delay bound under collision. If collisions are too frequent, he notes, classic Paxos might be better. A collision needs proposals received in different orders, so on a single Ethernet he expects it to be extremely rare.

### Flexible Paxos: only across phases

Howard, Malkhi, and Spiegelman separate Paxos's quorums into Q1 for phase 1 and Q2 for phase 2, and observe that only Q1 and Q2 must intersect. No Q1 needs to meet another Q1, and no Q2 another Q2.

The proof shows why. Suppose v is decided in ballot p with quorum Q2, and take the smallest later ballot p' that proposes something else, with phase 1 quorum Q1. Some acceptor is in both. If it saw prepare(p') first, it would refuse propose(p, v), contradicting that it accepted; so it accepted first, and it reports v to ballot p'. Only one intersection is used. Two phase 2 quorums need no overlap because a classic ballot has one coordinator and one value, so conflicting acceptances within a ballot cannot arise, and different ballots are handled by Q1.

This also explains Fast Paxos in one sentence: a fast round gives up that single value, so fast quorums must overlap each other, and they must do so inside every quorum that later reads them.

Since replication happens far more often than leader changes, shrinking Q2 helps the common case. With simple quorums the rule is |Q1| + |Q2| > N, and the smallest valid Q1 is N - |Q2| + 1. FPaxos always tolerates |Q2| - 1 failures, and with between |Q2| and N - |Q2| failures it can continue replicating until a new leader is required. The system does not lose safety when a Q1 is unavailable; it loses the ability to change leaders.

The prototype modified LibPaxos3 inside a single VM with a simulated 10 Mbps, 20 ms network. With 8 replicas and |Q2| = 4, latency fell from 42 ms to 37 ms and throughput rose from 198 to 264 requests per second. The authors warn that this is not the complete picture: part of the gain exists even at identical quorum sizes, because their version sends messages only to a quorum.

Section 7 of the paper adds that safety needs Q1 to intersect only the Q2s used with lower ballots, so a leader could announce its Q2. The paper leaves that mechanism's details out of scope.

### Combining them

Fast Flexible Paxos (Howard, Charapko, and Mortier, 2021) applies the same reasoning to Fast Paxos. The only requirements are between phase 1 and classic phase 2 quorums, and between phase 1 and any pair of fast phase 2 quorums:

```text
q1 + q2c > n        q1 + 2 * q2f > 2n
```

Their example: with 11 acceptors, q1 = 9, q2f = 7, and q2c = 3. Fast Paxos's three-quarters choice at n = 11 uses 9 for fast rounds and 6 for classic ones.

## Worked Examples

### Example 1: Fast Paxos sizes, checked by brute force

All subsets of each size were intersected for N up to 9, and N > 2F with N > 2E + F matched the set condition in every case with E <= F.

```text
        E = F maximized        F maximized
N       classic = fast         classic   fast
5       4                      3         4
7       5                      4         6
9       7                      5         7
```

At N = 7 with E = F, Lamport's formulas give 35 unicast messages against 28 for classic Paxos under his stated assumptions: one delay saved, 25 percent more messages.

### Example 2: the picking rule after a collision

Take N = 5 with classic quorum 3 and fast quorum 4. Votes in fast round k are a, a, a, b, b for A1 to A5, and the coordinator hears from Q = {A1, A2, A4}.

```text
V = {a, b}
O4(a): R = {A1, A2, A3, A5}, and R ∩ Q = {A1, A2}, all a: true
O4(b): any 4-set contains A1 or A2, who voted a:         false
pick a
```

If votes were a, a, b, b with A5 silent, and Q = {A1, A3, A5}, neither test passes. No value can have been chosen, because a has at most 3 possible votes and so does b, so the coordinator may pick either.

Over all 2430 combinations of vote pattern and Q, at most one value ever passes O4, and a value actually voted by four acceptors always passes.

Now shrink the fast quorum to 3, violating N > 2E + F. With A1 voting a, A2 voting b, the others silent, and Q = {A1, A2, A3}, both tests pass: R = {A1, A4, A5} for a and R = {A2, A4, A5} for b. The coordinator cannot rule out either. That dead end occurs in 1080 of the 2430 combinations.

### Example 3: two quorums that do not intersect

Take N = 4 with |Q1| = 3 and |Q2| = 2, the even-size improvement from the paper. Enumerating every phase 2 quorum for ballot 1, phase 1 quorum for ballot 2, and phase 2 quorum for ballot 2 gives 144 combinations and 0 in which ballot 2 can miss ballot 1's value. With |Q1| = 2, the count is 36 of 216.

```text
|Q1| = 2, |Q2| = 2, unsafe:
ballot 1: A1, A2 accept a             -> a decided
ballot 2: phase 1 reaches A3, A4      -> no value reported
          A3, A4 accept b             -> b decided
```

At |Q1| = 3, any phase 1 quorum contains A1 or A2, and two disjoint phase 2 quorums, {A1, A2} and {A3, A4}, remain safe.

### Example 4: simple and grid quorums

```text
N = 10, |Q2| = 3, |Q1| = 8 (majority would be 6 and 6)
  up to 2 failures:   everything works
  3 to 7 failures:    replication continues, no leader change
N = 8, |Q2| = 4, |Q1| = 5 (majority would be 5 and 5)
  up to 3 failures:   everything works
  exactly 4 failures: replication continues
```

The paper's 20-acceptor grid has N1 = 5 columns and N2 = 4 rows. FPaxos uses one row as Q1 (5 acceptors) and one column as Q2 (4), against 11 for a majority and 8 for the all-intersecting Paxos grid of one row plus one column. Every row meets every column in exactly one acceptor, and rows are mutually disjoint. Which acceptors fail now matters:

```text
one whole column down:  phase 2 works, phase 1 does not
                        (keeps replicating, no new leader)
one whole row down:     phase 1 works, phase 2 does not
                        (a leader can recover and reconfigure)
```

## Common Misconceptions & Pitfalls

- **"Fast Paxos is leaderless."** Proposals skip the leader, but a coordinator still starts rounds, and classic rounds provide progress.
- **"Fast Paxos is always faster."** It saves one delay without collision. Lamport himself says classic Paxos may be better if collisions are too frequent.
- **"Flexible Paxos is free."** Reducing Q2 raises Q1. In Example 4, the 10-node system cannot change leaders after 3 failures, where a majority system could.
- **"Q2 quorums must overlap so that two leaders cannot both decide."** Example 3 shows disjoint Q2s are safe. The phase 1 of the higher ballot is what stops the conflict.
- **"Three-quarters is the only fast quorum."** It is one choice for maximum F. Fast Flexible Paxos shows smaller trade-offs are possible by enlarging phase 1.

## Summary

Fast Paxos lets proposers reach acceptors directly, saving one delay, but acceptors in a fast round can vote differently. A later coordinator must identify the only value that could have been chosen, which requires any two fast quorums to intersect within every quorum: N > 2F and N > 2E + F. Collisions cost extra delays and can make classic Paxos preferable. Flexible Paxos works the other way, showing that classic Paxos needs intersection only between phases, so frequent phase 2 quorums can shrink while rare phase 1 quorums grow. The two meet in one idea: count what must overlap, because a single value per ballot is what lets phase 2 quorums stay disjoint, and a fast round no longer has it.

## Documentation Links

- [Lamport: Fast Paxos (Distributed Computing 2006, MSR-TR-2005-112)](https://ilyasergey.net/CS6213/_static/papers/fast-paxos.pdf): fast rounds, the "any" message, Observation 4, the Quorum Requirement, recovery, and costs.
- [Lamport: Lower Bounds for Asynchronous Consensus (MSR-TR-2004-72)](https://lamport.azurewebsites.net/pubs/lower-bound.pdf): the Fast-Accepting Lemma and the n > 2e + f bound.
- [Howard, Malkhi & Spiegelman: Flexible Paxos, Quorum Intersection Revisited (2016)](https://arxiv.org/abs/1608.06696): the Q1 and Q2 observation, simple and grid quorums, the safety proof, and the prototype.
- [Howard, Charapko & Mortier: Fast Flexible Paxos (ICDCN 2021)](https://arxiv.org/abs/2008.02671): the relaxed intersection requirements for Fast Paxos.
