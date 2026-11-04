---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the synchronous round model and the crash assumption, and say what a missing message proves in that model.
- Trace a rotating-coordinator consensus protocol and prove that one correct coordinator is enough for Agreement.
- State the f + 1 rounds lower bound with its condition n >= f + 2, and follow the indistinguishability chain behind it.
- Explain what a crash costs, and why this world is the baseline asynchronous protocols are measured against.

## Context & Motivation

`the-consensus-problem-agreement-validity-and-termination` defined consensus, and `the-flp-impossibility-result` showed what happens when all timing bounds are removed: no deterministic protocol can guarantee Termination. This lesson goes to the opposite end. If delays are bounded and the bound is known, a leader can be chosen without any election. Two questions remain: how many rounds does consensus still take, and how much of this simplicity depends on the timing assumption being true?

## Core Theory

### The synchronous round model

Dwork, Lynch, and Stockmeyer define a synchronous system by two known bounds: one on message delivery time and one on relative processor speed. Those bounds let an algorithm run in lock-step rounds: in each round every live process sends, receives what was sent to it, and computes.

Up to f of the n processes may crash. Aspnes states the failure precisely: in some round, some or all of a process's messages are not delivered, and in later rounds none are. A process can therefore die halfway through a broadcast, so that some peers hear it and others do not.

The important consequence is that silence carries information. Example 1 of `the-flp-impossibility-result` showed that an asynchronous process cannot tell a crash from a slow network. Here, a message that was due in round r and did not arrive proves that the sender crashed.

### Electing a leader by schedule

Because of that, a leader does not need to be elected. The schedule names it: round r belongs to process p_r.

```text
est[i] := input of p_i
for r = 1 to f + 1:
    if i == r: broadcast est[i]
    if a value v arrives from p_r in round r: est[i] := v
at the end of round f + 1: decide est[i]
```

Chandra and Toueg call this structure the rotating coordinator paradigm and use it for asynchronous consensus, where it needs a failure detector and a majority. They point to earlier uses by Reischuk, Chang and Maxemchuk, Dwork et al., and Berman et al. The crash-only form above is the simplest instance of that idea, without estimate timestamps or acknowledgements, because synchrony makes them unnecessary.

The comparison point is flooding, which Aspnes attributes to Dolev and Strong: every process broadcasts the set of values it knows, in every one of f + 1 rounds, and then applies a fixed rule to the set. Both take f + 1 rounds. The difference is the number of senders per round: one coordinator instead of all n. For n = 5 and f = 2, that is at most 12 messages against 60, in the same 3 rounds.

### Why one correct coordinator is enough

There are f + 1 distinct coordinators and at most f crashes, so some coordinator p_c never crashes. (This needs n >= f + 1.)

```text
Round c: p_c reaches every live process, so all of them
         now hold the same value v.
After c: any later coordinator holds v and rebroadcasts v.
         No other value exists among live processes.
```

Agreement follows, and it is uniform: every process that reaches the end of round f + 1 decides v, and a process that crashed earlier decided nothing. Validity holds because an estimate is only ever a copy of some input. Termination is the loop bound.

### What a crash costs

A coordinator that crashes mid-broadcast splits the estimates, and the next coordinator repairs the split. That is the real cost of a crash: one round of repair. A crash of any process that is not currently coordinating costs nothing.

The protocol as written, however, pays f + 1 rounds with no crash at all: with a 50 ms round and f = 2, it takes 150 ms every time. If p_1 is correct, the value is fixed after round 1, but no process can know that p_1 reached everyone. Dolev, Reischuk, and Strong separate two cases. Agreement that must happen in the same round needs t + 1 rounds in some fault-free execution, and this protocol is of that kind. Without the simultaneity requirement, and with t < n - 1, the lower bound is min(t + 1, f + 2) rounds, where t is the tolerated number of faults and f the actual number. Their paper studies Byzantine agreement; Wang, Teo, and Cao later prove the same min(t + 1, f + 2) bound for orderly crash failures.

### The f + 1 lower bound

The f + 1 rounds are not a weakness of the coordinator design. With n >= f + 2, every algorithm that satisfies Agreement, Termination, and a non-triviality condition needs at least f + 1 rounds in some execution. Aspnes credits the original result, stated for Byzantine failures, to Dolev and Strong, building on a more complicated proof by Fischer and Lynch.

The proof style is an indistinguishability chain. If two executions look identical to some non-faulty process, that process decides the same in both, and Agreement then forces every non-faulty process in both executions to that same decision. Suppose a protocol stops after f rounds. Start from a failure-free run with all inputs 0 and change inputs one process at a time, using crashes to hide each change from enough witnesses. Every link preserves the decision, so all-0 and all-1 inputs must decide alike, which contradicts Validity.

A second proof runs forward. Abraham's presentation follows Aguilera and Toueg and keeps a configuration uncommitted (the bivalent configurations of `the-flp-impossibility-result`) for one round per crash.

The condition n >= f + 2 matters. Aspnes notes that with n = f + 1, flooding solves agreement in f rounds: either at most f - 1 processes crash and flooding works, or exactly f crash and the one survivor agrees with itself.

### Why this is the baseline

Table I of Dwork, Lynch, and Stockmeyer gives the smallest system that tolerates t fail-stop processors under each timing assumption:

```text
synchronous                          t
partially synchronous communication  2t + 1
asynchronous                         no finite number
```

The table's entry is t; the coordinator protocol above uses t + 1 processes so that one coordinator survives. Tolerating two crashes, it therefore runs on 3 processes, while a protocol for partial synchrony needs 5. That gap is the price of ambiguous silence: when a timeout proves nothing, a decision must rest on a majority so that two sides of a false suspicion cannot both act. In return, safety stops depending on timing. In [Paxos Made Simple](/papers/paxos-made-simple), Lamport writes that "safety is ensured regardless of the success or failure of the election", and that a reliable election "must use either randomness or real time". The synchronous protocol gets a free leader and a fixed finish line, and pays by being wrong if the timing bound is ever violated.

## Worked Examples

### Example 1: a split that the next coordinator repairs

Take n = 4 and f = 2, with inputs a, b, c, d. Both failures are coordinators crashing mid-broadcast, the worst placement.

```text
          p1  p2  p3  p4
start     a   b   c   d
round 1   X   a   c   d    p1 reaches only p2, then crashes
round 2   X   X   a   d    p2 reaches only p3, then crashes
round 3   X   X   a   a    p3 is correct and reaches p4
```

Stopping after round 2 would leave p3 with a and p4 with d, both alive and correct. An exhaustive enumeration of crash patterns, including every recipient subset of a crashing coordinator, gives:

```text
rounds = 2:  180 executions, 42 with disagreement
rounds = 3:  424 executions,  0 with disagreement
```

### Example 2: the chain, with n = 3, f = 1, one round

The argument can be run mechanically. A deterministic protocol's decision is a function of what a process has seen, so link two views whenever non-faulty processes hold them in the same execution. Linked views must decide alike. For a one-round protocol there are 104 executions, and this chain connects the all-0 run to the all-1 run. Each row shares one view with the next. The inputs are listed in the order p1, p2, p3, and "only pX hears it" means the crashing process delivered its last message to pX and no one else.

```text
    inputs  crash                   shared with next row
1   000     none                    p2 sees p1=0, p3=0
2   000     p1, only p2 hears it    p3 sees p1 absent, p2=0
3   100     p1, only p2 hears it    p2 sees p1=1, p3=0
4   100     p3, p1 and p2 hear it   p1 sees p2=0, p3=0
5   100     p2, only p1 hears it    p3 sees p1=1, p2 absent
6   110     p2, only p1 hears it    p1 sees p2=1, p3=0
7   110     p3, only p1 hears it    p2 sees p1=1, p3 absent
8   111     p3, only p1 hears it    p1 sees p2=1, p3=1
9   111     none (failure-free)
```

Row 1 must decide 0 and row 9 must decide 1, yet every link forces equality, so no one-round protocol exists. The same check on other sizes matches the theorem, including its exception:

```text
n=4, f=2, 2 rounds: chain exists, no protocol
n=4, f=2, 3 rounds: no chain (the coordinator protocol exists)
n=3, f=2, 2 rounds: no chain (n = f + 1, so f rounds suffice)
```

### Example 3: the same protocol when the timing bound breaks

Run n = 3, f = 1, so two rounds, on a real network, and let nobody crash.

```text
start     p1=a  p2=b  p3=c
round 1   p1's broadcast arrives after the round closes: ignored
round 2   p2 broadcasts b; p3 adopts it; p1's copy is late
decide    p1=a  p2=b  p3=b
```

All three processes are alive and they disagree. In the model, p1's silence would have meant p1 had crashed, so its value would not count. Outside the model, the same silence means nothing. Paxos in the same scenario would stall, not diverge.

## Common Misconceptions & Pitfalls

- **"The f + 1 rounds come from the coordinator design."** The bound applies to every algorithm when n >= f + 2. Flooding pays the same rounds with more messages.
- **"A leader in the synchronous model has to be elected."** The schedule assigns it. Election exists to solve a problem that this model does not have: telling whether the current leader is alive.
- **"Every crash adds a round."** The round count is fixed at f + 1. Only a coordinator crashing during its own round disturbs anything, and the worst-case budget already includes it.
- **"The bound holds for all n."** With n = f + 1, f rounds are enough, as Example 2 confirms for n = 3 and f = 2.
- **"Tolerating f crashes with f + 1 processes makes this better than Paxos."** That number holds only while the timing bound holds. Example 3 shows a safety violation with zero crashes.

## Summary

With known delay bounds, a missing message proves a crash, so a leader can be assigned by schedule. A rotating coordinator runs f + 1 rounds, and the one coordinator that never crashes leaves all live processes with one value, which later coordinators can only repeat. Every algorithm needs f + 1 rounds in some execution when n >= f + 2, as an indistinguishability chain shows. The synchronous model needs no majority to tolerate t crashes, while partial synchrony needs 2t + 1 processes and asynchrony has no deterministic solution. That gap measures what timing certainty is worth, and asynchronous protocols pay it with quorums in exchange for safety that survives any delay.

## Documentation Links

- [Dwork, Lynch & Stockmeyer: Consensus in the Presence of Partial Synchrony (JACM 1988)](https://groups.csail.mit.edu/tds/papers/Lynch/jacm88.pdf): the definition of synchronous and partially synchronous systems, and Table I of minimum processors per fault type.
- [Aspnes: Notes on Theory of Distributed Systems](https://arxiv.org/abs/2001.04235): the free textbook whose synchronous agreement chapter gives flooding, the f + 1 lower bound by chain of executions, the n >= f + 2 condition, and the history of the result.
- [Chandra & Toueg: Unreliable Failure Detectors for Reliable Distributed Systems (JACM 1996)](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/p225-chandra.pdf): the rotating coordinator paradigm and its earlier uses.
- [Dolev, Reischuk & Strong: Early Stopping in Byzantine Agreement (JACM 1990)](https://cris.huji.ac.il/en/publications/early-stopping-in-byzantine-agreement/): the abstract states the min(t + 1, f + 2) bound and the t + 1 bound for simultaneous agreement.
- [Wang, Teo & Cao: Lower Bounds for Achieving Synchronous Early Stopping Consensus with Orderly Crash Failures (2005)](https://dspace.mit.edu/handle/1721.1/7425): the min(t + 1, f + 2) bound for orderly crash failures.
- [Abraham: Synchronous Consensus Lower Bound via Uncommitted Configurations (2019)](https://decentralizedthoughts.github.io/2019-12-15-synchrony-uncommitted-lower-bound): the forward proof of the bound, following Aguilera and Toueg.
- [Lamport: Paxos Made Simple (2001)](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf): the statements on election and safety quoted in the baseline comparison.
