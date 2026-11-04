---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define an unreliable failure detector as Chandra and Toueg do, by completeness and accuracy, and name the eight classes.
- Explain why the eight classes collapse to four, and what each of the four can solve and at what failure bound.
- Trace how consensus with ◇S keeps its safety under wrong suspicions, using the actual quorums.
- State the weakest-detector result of Chandra, Hadzilacos, and Toueg, and relate Ω to leader election.
- Compute φ from a window of heartbeats and explain why the accrual approach separates monitoring from decisions.

## Context & Motivation

`why-distributed-systems-are-hard-partial-failure-and-no-shared-state` showed that silence cannot separate a crashed machine from a slow one, and `the-flp-impossibility-result` turned that ambiguity into a theorem. Timeouts were the practical escape, but they were treated as a departure from the model and left unanalyzed. Chandra and Toueg asked a sharper question: what can be solved with an oracle about failures that makes mistakes, even infinitely many? Their answer treats the failure detector as an abstract module with stated properties, separate from any timeout. `reconfiguration-changing-membership-in-paxos-and-raft` assumed someone asks for a change, and detection is one input to that request.

## Core Theory

### An oracle that may be wrong

Each process has a local module that outputs the set of processes it currently suspects. A module may add a process, later remove it, and repeat this forever, and modules at different processes may disagree at any moment. The asynchronous model is otherwise unchanged. The paper insists on this abstraction, telling readers to "refrain from thinking of failure detectors in terms of specific time-out mechanisms": algorithms and proofs rely on the properties alone.

### Completeness and accuracy

Completeness restricts missed crashes, and accuracy restricts false suspicions. Neither alone is useful: a detector that suspects everyone forever is trivially complete and tells nothing.

```text
Strong completeness: eventually every crashed process is permanently
                     suspected by EVERY correct process.
Weak completeness:   ... by SOME correct process.

Strong accuracy:          no process is suspected before it crashes.
Weak accuracy:            some correct process is never suspected.
Eventual strong accuracy: after some time, no correct process is
                          suspected by any correct process.
Eventual weak accuracy:   after some time, some correct process is
                          never suspected by any correct process.
```

Two completeness properties times four accuracy properties give eight classes:

| | Strong acc. | Weak acc. | Eventual strong | Eventual weak |
|---|---|---|---|---|
| **Strong compl.** | P (Perfect) | S (Strong) | ◇P | ◇S |
| **Weak compl.** | Q | W (Weak) | ◇Q | ◇W |

### From eight classes to four

A simple reduction turns weak completeness into strong completeness while preserving accuracy. Every process repeatedly sends its suspects to all. On receiving `(q, suspects)`, a process adds `suspects` to its output and removes `q`, since `q` has just been heard from (Example 1). Each class in the bottom row is therefore equivalent to the one above it, leaving P, S, ◇P, and ◇S.

### What each class buys

With `f` the maximum number of crashes among `n` processes:

- **S (and so P)** solves consensus for any `f < n`.
- **◇S (and so ◇P)** solves consensus only if `f < ⌈n/2⌉`, that is, with a majority of correct processes.
- That bound is tight. Even ◇P cannot solve consensus with `f ≥ ⌈n/2⌉`. Split the processes in two, and delay all messages between the halves until both have decided, with each half suspecting the other until then: each half must decide as if the other had crashed, and the two can decide differently.

The ◇S algorithm uses a rotating coordinator: in round `r` the coordinator is `(r mod n) + 1`. It gathers `⌈(n+1)/2⌉` estimates with timestamps, picks one with the largest timestamp, and sends it out. Each process either adopts it and acks, or suspects the coordinator and nacks. If all of the `⌈(n+1)/2⌉` replies are acks, the value is locked and the coordinator reliably broadcasts the decision.

In this ◇S algorithm the detector affects only liveness. If it misbehaves forever, processes may never decide, but they never decide differently. Mistakes cost rounds, not safety (Example 2).

### Why this does not contradict FLP

No algorithm can implement ◇W in a purely asynchronous system, since that would solve consensus and contradict FLP. The detector is an added assumption, and it says precisely what must be added. It can be built where partial synchrony holds. In a model where unknown bounds hold after an unknown global stabilization time, Chandra and Toueg's Figure 10 implements ◇P: send "alive" periodically, suspect on timeout, and on hearing from a suspected process, remove it and increase its timeout. After stabilization, the timeout eventually exceeds the real bound. The properties need not hold forever in practice, only long enough for the algorithm to finish.

### The weakest detector for consensus

Is ◇W necessary, or merely sufficient? Chandra, Hadzilacos, and Toueg proved in 1996 that any failure detector usable for consensus, whatever its output format, can be transformed into ◇W. It is therefore the weakest for consensus when `n > 2f`. If `n ≤ 2f`, any detector that solves consensus must be strictly stronger. (Strictly, the result concerns the weakest detector in the class ◇W, which Chandra and Toueg write ◇W0.)

The proof goes through a detector called Ω. It outputs one trusted process, and there is a time after which all correct processes trust the same correct process. Any detector that solves consensus can be transformed into Ω, and Ω into ◇W by suspecting everyone except the trusted process. Ω reads like the abstract form of a stable leader. Lamport, Malkhi, and Zhou note that Paxos guarantees progress only when there is a unique leader, while safety survives several, which is the same split between liveness and safety. A follower's election timeout in `raft-leader-election` is a concrete suspicion of the leader, though that link is an analogy here, not a theorem.

### Heartbeats in practice

Hayashibara et al. use two of the quality-of-service metrics of Chen, Toueg, and Aguilera: detection time `T_D`, from crash to permanent suspicion, and average mistake rate `λ_M`. A monitored process sends a heartbeat every `Δi`, and the monitor suspects it after a timeout `Δto`. A short timeout detects quickly and errs often, and a long one does the opposite. Adaptive detectors estimate the next arrival from recent samples.

### The φ accrual detector

Hayashibara, Défago, Yared, and Katayama (2004) argue that a boolean output makes it hard to serve several applications with different requirements at once. An accrual detector outputs a suspicion level on a continuous scale instead, and each application picks its own threshold, or several: their example master stops sending new jobs at a low level, resubmits at a moderate one, and frees resources at a high one. Monitoring is separated from interpretation.

The φ detector keeps a sampling window of heartbeat inter-arrival times, assumes a normal distribution with the window's mean µ and variance σ², and computes:

```text
P_later(t) = probability that the next heartbeat arrives more than
             t after the previous one = 1 - F(t)
φ(t_now)   = -log10( P_later(t_now - T_last) )
```

Suspecting at `φ ≥ Φ` means a mistake likelihood of about 10% at Φ = 1, 1% at Φ = 2, and 0.1% at Φ = 3. Accrual is an interface, not an escape from FLP: the paper shows how to build ◇P on top with moving thresholds, and it stresses that neither can be implemented deterministically in all asynchronous systems.

The paper's main finding is that this flexibility costs nothing significant: replayed on the same trace, φ performed equally well as the Chen detector, a little better in the aggressive range and a little worse in the conservative range, and better than the Bertier detector, which was designed for LANs. The authors warn against overreading the gap with Chen. The trace came from one week between Japan and Switzerland, with 5,845,712 heartbeats sent over UDP and 5,822,521 received (about 0.4% loss). The mistake rate improved in two steps: from Φ = 0.5 to 2, as late heartbeats stop triggering suspicions, and for Φ in [8; 12], as isolated lost heartbeats do.

**Book vs today:** Akka's current cluster documentation still computes φ from a normal distribution, uses a default threshold of 8, and suggests 12 for cloud environments such as Amazon EC2. It adds a margin, `acceptable-heartbeat-pause`, for garbage collection pauses and transient network failures, and says tuning that margin is typically enough.

## Worked Examples

### Example 1: weak completeness becomes strong

Four processes run the reduction. p4 crashes in round 2. The local detector of p1 alone suspects p4, from round 3 on. The local detector of p3 wrongly suspects p2 in round 3 only.

```text
round  output at p1     output at p2     output at p3
  2    {}               {}               {}
  3    {p2,p4}          {p2,p4}          {p2,p4}
  4    {p4}             {p4}             {p4}
  5    {p4}             {p4}             {p4}
```

Everyone adopts p1's suspicion of p4, so completeness is now strong. The false suspicion of p2 spreads in round 3, then disappears in round 4, because each message from p2 removes p2. p4 sends nothing, so it stays. (The schedule is invented for this example.)

### Example 2: wrong suspicions cost rounds, not safety

The ◇S algorithm with `n = 5`, so `f ≤ 2` and the quorum is 3. Initial values are a, b, c, d, e for p1 to p5. The schedule is invented for this example; the rules are those of the paper's Figure 6.

```text
Round 1, coordinator p2. Gathers p1, p2, p3 (all timestamp 0), picks b.
  p1, p2, p3 ack, adopting b with timestamp 1: b is LOCKED.
  p2 crashes before broadcasting the decision. Nobody has decided.

Round 2, coordinator p3. The 3-subsets of the survivors:
  {p1,p3,p4}  {p1,p3,p5}  {p1,p4,p5}  {p3,p4,p5}
  Each one meets the ack set {p1,p2,p3}. In fact all 10 3-subsets of the
  5 processes do, since only {p4,p5} lies outside it.
  p3 gathers {p3,p4,p5}: (b,ts 1), (d,ts 0), (e,ts 0). Picks b, forced.
  p5 falsely suspects p3 and nacks. Replies: ack, ack, nack. No decision.

Round 3, coordinator p4. Gathers p3 (b,2), p4 (b,2), p5 (e,0). Picks b.
  p3, p4, p5 ack. p4 broadcasts the decision: every correct process decides b.
```

The wrong suspicion wasted round 2 and changed nothing about the value. The overlap of 3-subsets did the protecting.

### Example 3: the same φ on two networks

Two invented windows of inter-arrival times, both with mean 100 ms:

```text
steady:  100 105 95 102 98 100 110 90 103 97    σ = 5.25 ms
jittery: 100 160 40 130 70 150 50 120 80 100    σ = 38.5 ms
```

```text
Elapsed since last heartbeat   120 ms   150 ms   200 ms   300 ms
φ on the steady link             4.2     21.1     80.4    316.7
φ on the jittery link            0.5      1.0      2.3      7.0

Timeout equivalent to Φ            1        3        8
steady link (ms)                 106.7    116.2    129.5
jittery link (ms)                149.3    218.9    315.9
```

The same Φ = 8 means 130 ms on one link and 316 ms on the other, which is the dynamic scale the paper describes. Now take a window of nineteen 100 ms gaps and one 200 ms gap (one lost heartbeat): µ = 105, σ = 21.8. A 200 ms silence now gives φ = 5.2 instead of 80.4. Memory of one past loss changes the verdict, and a window with no losses at all reacts to a single lost heartbeat as if the process were certainly dead.

## Common Misconceptions & Pitfalls

- **"An unreliable detector means an unsafe protocol."** Not in the ◇S algorithm: there the detector only affects termination, Example 2 shows a wrong suspicion costing a round, and safety comes from quorum overlap. The S algorithm is different. It has no quorums, and its agreement depends on a correct process that is really never suspected. With `n = 2` and each process suspecting the other from the start, neither waits, and they decide their own values.
- **"◇P is stronger, so it tolerates more failures than ◇S."** Both need a majority of correct processes. Perpetual accuracy, not stronger eventual accuracy, is what removes the majority requirement.
- **"Chandra and Toueg prove that heartbeats implement ◇P."** Only under partial synchrony. In a purely asynchronous system, premature timeouts can recur forever.
- **"Φ = 8 means one mistake in 10^8."** That reading assumes the normal model fits. The paper's own trace had loss bursts of up to 1,093 heartbeats, and Example 3 shows how sharply φ depends on what the window has seen.

## Summary

Chandra and Toueg replace timeouts with an abstract oracle defined by completeness and accuracy, giving eight classes that reduce to four. S solves consensus for any number of crashes, and ◇S solves it with a correct majority, a bound that holds even for ◇P. In the ◇S algorithm the detector influences only liveness, since quorum overlap keeps decisions safe. Chandra, Hadzilacos, and Toueg show that ◇W, equivalently the eventual leader Ω, is the weakest detector for consensus when `n > 2f`. Heartbeats with growing timeouts implement ◇P under partial synchrony. The φ accrual detector turns the heartbeat history into a continuous suspicion level, leaving the choice of threshold to each application.

## Documentation Links

- [Chandra and Toueg (1996): Unreliable Failure Detectors for Reliable Distributed Systems](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/p225-chandra.pdf): the eight classes, the reductions, the consensus algorithms for S and ◇S, the lower bound, and the partial synchrony implementation.
- [Chandra, Hadzilacos, and Toueg (1996): The Weakest Failure Detector for Solving Consensus](https://courses.csail.mit.edu/6.895/fall02/papers/Chandra/jacm96.pdf): the definition of Ω and the proof that ◇W is necessary.
- [Hayashibara, Défago, Yared, and Katayama (2004): The φ Accrual Failure Detector](https://dspace.jaist.ac.jp/dspace/bitstream/10119/4784/1/IS-RR-2004-010.pdf): the technical report with the accrual abstraction, the φ computation, and the Japan to Switzerland experiment.
- [Lamport, Malkhi, and Zhou (2010): Reconfiguring a State Machine](https://lamport.azurewebsites.net/pubs/reconfiguration-tutorial.pdf): section 3.1.3, on Paxos needing a unique leader for progress but not for safety.
- [Akka documentation: Phi Accrual Failure Detector](https://doc.akka.io/libraries/akka-core/current/typed/failure-detector.html): a current implementation, with its threshold and margin settings.
