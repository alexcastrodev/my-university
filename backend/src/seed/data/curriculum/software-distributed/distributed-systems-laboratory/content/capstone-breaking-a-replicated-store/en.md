---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Combine every failure mode built across this discipline, partition, crash and restart, packet loss, and clock skew, into a single, simultaneous chaos scenario run against the finished replicated store.
- Predict, from `distributed-systems-i`'s CAP theorem and `distributed-systems-ii`'s PACELC, what the minority partition side should do under this combined scenario, and verify the implementation actually does it.
- Produce a written report of what was actually observed under chaos, distinguishing confirmed theoretical predictions from any genuine, unexpected implementation bug the scenario surfaces.
- Explain why this final, combined test is a stronger correctness bar than running each individual failure mode separately, as every earlier lab did.

## Context & Motivation

Every earlier lab in this discipline tested one failure mode in relative isolation: `raft-persistence-and-crash-recovery` tested crashes, `clock-skew-and-spurious-elections` tested timing skew, `a-linearizable-replicated-kv-store-on-raft` tested partition and unreliability, but never quite all four failure modes stacked on top of each other in one run, which is exactly the harder, more realistic condition MIT 6.5840's own hardest Lab 4 tests actually run under. This capstone is where "quebrá-lo" (breaking it), the second half of this whole discipline's tasks.md description, gets applied in full, to a system that is otherwise finished, not still being built.

## Core Theory

This capstone does not introduce new protocol logic; it is where `distributed-systems-i`'s **The CAP Theorem: A Precise Statement** and `distributed-systems-ii`'s **PACELC** stop being predictions read from a diagram and become claims this capstone's own experiment has to confirm or refute against a real, running system. CAP's own precise statement says a partitioned system must choose between consistency and availability for requests that touch the partition; this lab's `a-linearizable-replicated-kv-store-on-raft` chose consistency, correctly, per its own linearizability guarantee, which means this capstone's specific, falsifiable prediction is that the minority partition side must become unavailable for writes, not silently serve stale or conflicting ones.

## Worked Examples

### The combined scenario

```go
func TestChaosCapstone(t *testing.T) {
    cfg := MakeConfig(t, 5, net)
    cfg.net.SetUnreliable(0.1)               // packet loss, every message
    cfg.net.SetClockSkew(cfg.servers, randomSkewPerNode(0, 80*time.Millisecond))

    majority, minority := cfg.partition(3, 2) // 3-2 split
    go cfg.crashAndRestartRandomly(minority, 500*time.Millisecond) // ongoing chaos
                                                                     // on the minority side

    majorityResults := runClients(cfg, majority, 20*time.Second)
    minorityResults := runClientsExpectingFailure(cfg, minority, 20*time.Second)

    cfg.healPartition()
    finalCheck := runClients(cfg, cfg.allServers, 5*time.Second)

    verify(majorityResults, minorityResults, finalCheck)
}
```

### What `verify` actually has to confirm

```text
1. Every operation the MAJORITY side reports as successful is later
   visible, correctly, once the partition heals — no majority-side
   write is silently lost.

2. Every operation attempted against the MINORITY side either times
   out or is explicitly rejected — NONE of them silently succeeds
   against stale, un-replicated local state. This is the direct,
   falsifiable CAP/PACELC prediction this capstone tests.

3. The FULL recorded operation history, majority and minority
   attempts together, still passes a linearizability checker once
   the partition heals, exactly as in a-linearizable-replicated-
   kv-store-on-raft, but now under packet loss AND clock skew AND
   crashes on top of the partition, not any one of those alone.
```

### A genuine finding this combined scenario can surface that isolated tests miss

```text
Isolated crash test (raft-persistence-and-crash-recovery):  passes
Isolated clock-skew test (clock-skew-and-spurious-elections): passes
Isolated partition test (a-linearizable-replicated-kv-store-on-raft): passes

Combined: a minority-side server, restarting from a crash WHILE also
experiencing injected clock skew, briefly starts an election before
its persisted state has fully loaded from disk, momentarily voting
with a stale votedFor value from before the crash.
```

This is exactly the kind of interaction effect a well designed combined test can catch and three separate, individually passing tests cannot: each earlier lab's test isolated one variable specifically to make that variable's effect legible, which is valuable for building and debugging incrementally, but is not, on its own, a claim that the implementation is correct once every failure mode is present at once, which is the real, harder condition this capstone actually checks.

### The written report

The lab's deliverable is not only passing code but a short, specific report covering: whether the CAP/PACELC prediction (Point 2 above) held, with the actual observed behavior of minority-side requests quoted directly from logs; whether the linearizability checker passed on the full combined history; and, if the combined scenario surfaced any genuine bug an isolated test had missed (as in the example above), a precise account of the interaction that caused it and the fix applied, connecting the observed failure back to the specific theoretical concept, from `distributed-systems-i` or `distributed-systems-ii`, that predicted or explains it.

## Common Misconceptions & Pitfalls

- **"If every individual failure mode passed its own dedicated test, the system is fully correct."** This capstone's own worked example shows a real class of bug, an interaction between two failure modes each individually handled correctly, that only a combined scenario surfaces; passing every isolated test is necessary but not sufficient.
- **"The minority partition should still try to serve reads, since reads don't modify anything."** A stale read from an isolated minority server can return data already superseded by writes committed on the majority side, which is exactly the availability-for-consistency tradeoff CAP describes; a linearizable store's own guarantee, already committed to in `a-linearizable-replicated-kv-store-on-raft`, requires rejecting these too, not just writes.
- **"The report is a formality; the passing test is what actually matters."** The report is what connects an observed, measured result back to a specific theoretical claim, CAP's availability-consistency tradeoff, PACELC's latency-consistency tradeoff, turning a passing test into confirmed understanding rather than a green checkmark whose connection to the underlying theory was never actually articulated.

## Summary

This capstone combines every failure mode this discipline built separately, network partition, packet loss, node crashes and restarts, and clock skew, into one simultaneous chaos scenario run against the finished, linearizable replicated store from `a-linearizable-replicated-kv-store-on-raft`, matching the harder, combined test conditions MIT 6.5840's own hardest Lab 4 tests actually run under. The scenario's central, falsifiable prediction, drawn directly from `distributed-systems-i`'s CAP theorem and `distributed-systems-ii`'s PACELC, is that the minority partition side must become unavailable rather than silently serve stale data, and running every failure mode together, rather than each in isolation as every earlier lab did, is what can surface real interaction bugs, like a crash-recovery race against injected clock skew, that no single isolated test would ever catch.

## Documentation Links

- [MIT 6.5840 — Lab 4: KV Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-kvraft1.html): the real course's own combined-failure test conditions this capstone's chaos scenario is modeled on.
- [Gilbert & Lynch — Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services (2002)](https://groups.csail.mit.edu/tds/papers/Gilbert/Brewer2.pdf): the formal statement of the consistency-availability tradeoff this capstone's central prediction, and verification, is built directly on.
