---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain why Multi-Paxos is a family of practices, and attribute each detail to the source that gives it.
- Explain why phase 1 can be run once for many slots, and what a stable leader saves.
- Trace a new leader's recovery of a log with gaps, including the choice of values and the no-op filler.
- Describe the liveness mechanisms that single-decree Paxos leaves open, from a distinguished proposer to growing timeouts and sequence-number boosting.
- Contrast the slot-by-slot Paxos log with Raft's log.

## Context & Motivation

`paxos-the-original-consensus-protocol` covered the safety of one decision and named dueling proposers without resolving them. `total-order-broadcast-built-on-consensus` showed that a replicated service needs a sequence of decisions and left the cost per decision open. Multi-Paxos is the answer to both, but it is not one protocol. Ongaro and Ousterhout, the authors of [Raft](/papers/raft-understandable-consensus-algorithm), put it bluntly: "there is no widely agreed-upon algorithm for multi-Paxos." [Paxos Made Simple](/papers/paxos-made-simple) sketches the idea without using the name, Google's Paxos Made Live names it and reports what production required, and van Renesse and Altinbuken's Paxos Made Moderately Complex (PMMC below) gives full pseudocode. This lesson keeps those sources apart.

## Core Theory

### One instance per slot, one distinguished proposer

Lamport implements a state machine with "a sequence of separate instances of the Paxos consensus algorithm", where the value chosen by instance i is command i. A single elected leader acts as the distinguished proposer in all instances. Clients send commands to it, and it decides where each one goes.

PMMC calls the positions slots and adds a warning worth keeping: ballot numbers and slot numbers are orthogonal. One ballot can decide many slots, and one slot can be attempted by many ballots.

### Why phase 1 can be skipped

Lamport's key observation is that "the value to be proposed is not chosen until phase 2". Phase 1 reserves a proposal number and collects history, and neither depends on the next command. So a new leader runs phase 1 for all unresolved instances at once, with the same proposal number and "a single reasonably short message". An acceptor replies with more than an OK only for instances where it has already accepted something.

After that, each new command needs only phase 2. Paxos Made Live gives the production form: "Propose messages may be omitted if the coordinator identity does not change between instances." Safety is untouched, because any replica can still broadcast a propose message with a higher number at any time. Skipping phase 1 is an optimization for the case in which nobody does.

Unique numbers come from disjoint sets. Paxos Made Live's scheme: in a system of n replicas, replica r with id i_r picks the smallest sequence number above any it has seen such that s mod n = i_r. PMMC uses ordered pairs of a round number and a leader id.

### Recovery, gaps, and no-ops

Slots are decided independently, so the log can have holes. Lamport's leader may propose command 142 before it learns that 141 was chosen. If a leader can get α commands ahead, a gap of up to α - 1 commands can arise when it fails.

A new leader runs phase 1 for every slot it does not know. PMMC states the per-slot rule: if no acceptor in the majority reports a value for a slot, nothing was chosen there and the leader may propose anything; otherwise it must take the value with the highest ballot. Remaining holes below the highest known slot block execution, so Lamport's leader fills them at once with a no-op command that leaves the state unchanged. He notes the alternative of using the next client commands. The filler is therefore a choice about latency, not a safety requirement.

### The liveness that single-decree Paxos leaves open

PMMC is explicit that the Synod protocol does not guarantee progress, "even in the absence of any failure whatsoever". Lamport's fix is a distinguished proposer, with the caveat from `leader-based-consensus-in-the-synchronous-model`: electing one reliably needs randomness or real time. Safety does not depend on it. Two self-appointed leaders can stall a slot, but they cannot cause a disagreement. Sources differ on the mechanism from there.

- **Failure detection (PMMC).** A leader preempted by a higher ballot does not retry at once. It pings the winner and waits, starting a scout only when pings stop.
- **Growing timeouts (PMMC).** The timeout rises with the competing ballot, so some correct leader eventually has enough time. This assumes bounds on clock drift and message handling exist, without assuming they are known. PMMC suggests a TCP-like scheme: multiply the timeout on preemption, decrease it linearly per chosen proposal.
- **Boosting (Paxos Made Live).** A disconnected old master can raise its sequence number by contacting another replica, and on return displace the new master, which keeps a fixed number. Repeated, this gives rapid master changes. Their fix has the master periodically run a full Paxos round to raise its own number. A footnote reports that under one percent of instances in a loaded system run the full algorithm.

### What a log needs beyond consensus

None of the following is in Paxos Made Simple. Each is one team's answer.

```text
Master leases, PML 5.2      While the lease is held, no other
                            replica can get a value through
                            Paxos, so the master reads locally.
Leases on reads, PMMC 4.5   A majority of acceptors grants a
                            lease; assumes bounded clock drift.
Epoch numbers, PML 5.3      Aborts a request if mastership
                            changed during its handling.
Disk corruption, PML 5.1    A replica that lost state joins as a
                            non-voter so it cannot renege on a
                            promise.
Snapshots, PML 5.5          The application snapshots; the
                            framework truncates the log.
Batching, PML 4.2           Many values in one instance.
Duplicates, PMMC 2.1        A command may be decided in two slots;
                            the replica applies it once.
Garbage collection,         Once f + 1 replicas learned a slot,
PMMC 4.2                    acceptors may drop its state.
```

(PML is Paxos Made Live.) Changing the server set is the largest such topic, and it has its own lesson: `reconfiguration-changing-membership-in-paxos-and-raft`.

### Contrast with Raft

The difference from Raft is structural. In Multi-Paxos, as Lamport describes it, slot 142 can be chosen while 141 is open. In `raft-log-replication-and-commitment`, a follower rejects an entry unless it matches the one before it, so logs have no holes and committing index N covers everything before N. Raft's new leader needs no per-slot recovery either: `raft-safety-the-election-restriction-and-log-completeness` restricts votes to candidates whose logs are up to date. Ongaro and Ousterhout argue that there is "little benefit to choosing a collection of log entries independently and then melding them into a sequential log". That is their judgment. The price Raft pays is that followers cannot accept out of order.

## Worked Examples

### Example 1: a new leader recovers Lamport's log

Lamport's scenario: the new leader knows commands 1 to 134, 138, and 139. The acceptor reports below are constructed for this trace. Three acceptors, new ballot 7, and a majority {A, B} answers phase 1.

```text
slot   A reports       B reports       leader proposes
135    (ballot 4, x)   nothing         x   (forced)
136    nothing         nothing         no-op
137    nothing         nothing         no-op
138    known chosen                    (no action)
139    known chosen                    (no action)
140    nothing         (ballot 5, w)   w   (forced)
141+   nothing         nothing         free for clients
```

C may hold (ballot 3, old) for slot 135, outside the majority, and that does not matter. If "old" had been chosen at ballot 3, ballot 4 would have been forced to carry it, so A could not hold x. After phase 2 of ballot 7, commands 135 to 140 are all chosen and the leader can execute through 140. Without the no-ops it could execute only through 135, and 138 to 140 would wait for clients to supply two more commands. Slot 141 goes to the next client request, and phase 1 is not repeated.

### Example 2: overwritten history is still safe

PMMC reduces acceptor state to the latest pvalue per slot, which looks dangerous. With acceptors a1, a2, a3:

```text
1. a1, a2 accept <ballot L, slot 1, c>   -> c is chosen; L crashes
2. L' gets a2, a3 to adopt a higher ballot
3. a2 reports c, so L' must propose c
4. a2 accepts <ballot L', slot 1, c>

State now: a1 holds (L, c), a2 holds (L', c), a3 holds nothing.
```

No majority now stores the same pvalue, so the evidence that ballot L chose c has been overwritten. It is still safe. Every majority of the three acceptors contains a1 or a2, and both hold c, so any later leader must propose c.

### Example 3: what skipping phase 1 saves

This accounting is constructed from the message kinds in Paxos Made Live, with 5 replicas, one coordinator, no batching, and no piggybacking. Each kind costs 4 messages.

```text
full instance:     propose, promise, accept, ack, commit
                   5 kinds * 4 = 20 messages, 5 disk writes in sequence
chained instance:  accept, ack, commit
                   3 kinds * 4 = 12 messages, 1 write per replica in parallel
```

Over 1000 commands, with 10 of them (1 percent, the boosting footnote's order of magnitude) running the full algorithm:

```text
no chaining:  1000 * 20                 = 20000 messages
chaining:     10 * 20 + 990 * 12        = 12080 messages
```

Message count improves by about 40 percent. The latency effect is larger: at an assumed 10 ms per disk flush, the critical path drops from 50 ms of sequential writes to about 10 ms.

### Example 4: choosing a sequence number, and backing off

Paxos Made Live's numbering, with 5 replicas and 13 as the highest number seen: replica 2 picks 17, the smallest number above 13 with 17 mod 5 = 2. Replica 4 picks 14.

For timeouts, assume a leader needs 350 ms for its phases, and use PMMC's scheme with a starting timeout of 100 ms, doubled on preemption, reduced by 10 ms per chosen proposal (all three numbers are illustrative). Preemptions happen at 100 and 200 ms, which wastes 300 ms, and the 400 ms timeout succeeds. After 6 chosen proposals the timeout is 340 ms, too short again, and a healthy leader can be replaced. PMMC says this eventually happens, and accepts it: the goal is a timeout long enough for a leader to succeed and short enough to replace a faulty one quickly.

## Common Misconceptions & Pitfalls

- **"Multi-Paxos is a precise protocol with one specification."** It is a family. Lamport's sketch, Chubby's system, and PMMC differ in roles, numbering, leases, and recovery, so a claim about Multi-Paxos needs a source.
- **"Skipping phase 1 weakens safety."** Any replica can still run phase 1 with a higher number at any moment. The optimization assumes only that this is rare.
- **"A stable leader can answer reads from local state."** Paxos Made Live explains why not: another master may have been elected without notifying the old one. Local reads need leases, and leases need timing assumptions.
- **"No-ops are needed for safety."** They avoid waiting. Lamport names the alternative of assigning the next client commands to the gaps.
- **"Accepted by a majority means the same pvalue is stored by a majority."** Example 2 shows a chosen value with no majority holding the same pvalue.

## Summary

Multi-Paxos runs one Paxos instance per log slot under one leader. Because phase 1 does not depend on the value, a new leader runs it once across all open slots and then pays only phase 2 per command. Recovery picks the highest-ballot value per slot and fills holes with no-ops. Progress requires a single active proposer, which needs timing or randomness, and sources handle this differently: PMMC with pings and growing timeouts, Paxos Made Live with boosting. Leases, snapshots, and corruption handling come from engineering practice rather than from the algorithm. Raft reaches a similar log by forbidding holes.

## Documentation Links

- [Lamport: Paxos Made Simple (2001)](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf): instances, distinguished proposer, the 135 to 140 recovery scenario, no-ops, and the α window.
- [Chandra, Griesemer & Redstone: Paxos Made Live, An Engineering Perspective (2007)](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/paper2-1.pdf): the Multi-Paxos optimization, the write counts, master leases, boosting, epoch numbers, corruption, and snapshots in Chubby.
- [van Renesse & Altinbuken: Paxos Made Moderately Complex (ACM Computing Surveys 2015)](https://www.cs.cornell.edu/courses/cs7412/2011sp/paxos.pdf): slots, ballots, per-slot recovery, the liveness scenario, timeouts, state reduction, garbage collection, and read leases.
- [Ongaro & Ousterhout: In Search of an Understandable Consensus Algorithm (2014)](https://raft.github.io/raft.pdf): the critique of the single-decree decomposition quoted in this lesson.
