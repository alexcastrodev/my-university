---
title: "Impossibility of Distributed Consensus with One Faulty Process"
summary: The FLP result, which proves that no deterministic protocol can guarantee agreement in a fully asynchronous system if even one process may crash, and which fixed the limits within which every later consensus algorithm has to work.
researchArea: Distributed Systems
keywords: consensus, impossibility result, asynchronous systems, fault tolerance, bivalence, commit protocols
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

The consensus problem involves an asynchronous system of processes, some of which may be unreliable. The problem is for the reliable processes to agree on a binary value. In this paper, it is shown that every protocol for this problem has the possibility of nontermination, even with only one faulty process. By way of contrast, solutions are known for the synchronous case, the "Byzantine Generals" problem.

## Overview

The paper by Fischer, Lynch and Paterson (known as FLP) appeared in the Journal of the ACM in April 1985, after a first presentation at the ACM Symposium on Principles of Database Systems in 1983. The motivation came from databases: in the transaction commit problem, every data manager that took part in a transaction must decide together whether to install its results or discard them, even though real systems suffer crashes, partitions and lost messages. The authors ask how reliable such an agreement can be, and answer with a surprise: in a completely asynchronous system no protocol can tolerate even a single unannounced process death.

The result is a negative one, and it is the reason later consensus work looks the way it does. [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) both keep safety unconditional but give up guaranteed progress when the network is badly behaved, and [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus) escapes the limit with randomization. [The Part-Time Parliament](/papers/paxos-part-time-parliament) is the algorithm that, in practice, lives with this result.

Worth knowing first: the idea of a process as a deterministic state machine, the difference between a safety property (nothing bad happens) and a liveness property (something good eventually happens), and the commit problem. The paper assumes no Byzantine behavior and a reliable message system, so the impossibility holds even in the friendliest fault model.

## Contribution

- **A very weak consensus problem.** Each process starts with a bit, nonfaulty processes that decide must pick the same value, both 0 and 1 must be possible outcomes, and for the proof it is enough that some process eventually decides. Impossibility for this weak problem carries over to every stronger one.
- **A deliberately strong system model.** Processes are automata, possibly with infinitely many states, with no bound on relative speed, no bound on message delay, no synchronized clocks and no way to detect a death. A slow process and a dead one look the same.
- **The main theorem.** No consensus protocol is totally correct in spite of one fault: every partially correct protocol has some admissible run in which no process ever decides.
- **The bivalence argument.** A configuration is bivalent if both decisions are still reachable from it, and the proof shows that a protocol can always be kept in such a configuration. The technique became a standard tool for later impossibility proofs.
- **A positive counterpart.** Theorem 2 gives a protocol that works when no process dies during the run and a strict majority is alive from the start, marking how narrow the impossibility is.

## Methodology

The paper is a pure proof, with no implementation or measurement. A consensus protocol is a set of N deterministic processes (N at least 2) that communicate through a message buffer offering send and receive. A step is an event (p, m): process p receives a message m or the null marker, changes state and sends a finite set of messages. A run is admissible if at most one process is faulty, meaning it takes only finitely many steps, and every message sent to a nonfaulty process is eventually received. A protocol is partially correct if no accessible configuration has two decision values and both values occur in some configuration. It is totally correct in spite of one fault if every admissible run also reaches a decision.

The proof is by contradiction and has three steps. Lemma 1 says that schedules of events by disjoint sets of processes commute. Lemma 2 shows that some initial configuration is bivalent: otherwise a 0-valent and a 1-valent initial configuration that differ in one process's input exist side by side, and a run in which that process takes no steps decides the same in both. Lemma 3 shows that for any bivalent configuration C and any event e applicable to it, there is a bivalent configuration reachable from C in which e was the last event applied. The final construction runs in stages, always giving the next step to the process at the head of a queue and delivering its oldest message, and ends every stage in a bivalent configuration. The run is admissible and never decides.

## Findings

These are the results the paper proves.

- **Theorem 1.** No consensus protocol is totally correct in spite of one fault. The failure needs only one process stopping at an inopportune time, with a reliable message system and no Byzantine behavior.
- **Every commit protocol has a window of vulnerability.** The paper notes that the asynchronous commit protocols then in use all have an interval in which the delay of a single process can make the whole algorithm wait forever, and that the result confirms this as a widely believed tenet of the folklore.
- **Theorem 2 (initially dead processes).** A partially correct protocol exists in which all nonfaulty processes always decide, provided no process dies during execution and a strict majority is alive initially. It runs in two stages over a graph in which each process hears from L - 1 others, with L the ceiling of (N + 1) / 2. The processes then compute the transitive closure, find the unique initial clique and decide by an agreed rule on the clique's inputs.
- **The contrast with the synchronous case.** The Byzantine Generals problem has known solutions when timing assumptions hold, so the obstacle is asynchrony and not faults alone.

## Critical Analysis

The proof is short, elegant and has stood for decades, but its reach is easy to overstate.

- **It is about guarantees, not probabilities.** The paper shows that a nondeciding admissible run exists, not that it is likely. Real systems almost always decide, and the authors say the results do not show that such problems cannot be solved in practice.
- **It depends on determinism and full asynchrony.** Randomized protocols and models with some timing assumptions fall outside it, and the paper itself points to both directions of escape: more refined models and weaker termination requirements, such as termination with probability 1.
- **The model is demanding in one way and generous in another.** Message delivery is perfect and failures are only crashes, but the system is assumed to be completely free of timing information, which no real network is.
- **The unsolvable problem is liveness, not safety.** The paper stays at this level and does not discuss how a protocol should behave while it waits.
- **Book vs today.** In practice the lesson is applied as partial synchrony: protocols such as Paxos and Raft never decide wrongly, and make progress when the network is stable enough, usually detected with timeouts. The paper itself cites work on consensus under partial synchrony and on randomized agreement, which developed into the failure detector line of research and into randomized asynchronous protocols.

## Further Research

- Models between full asynchrony and full synchrony, such as partial synchrony, and the weakest failure detector that makes consensus solvable.
- Randomized asynchronous consensus, which gives up guaranteed termination in exchange for termination with probability 1.
- Impossibility and tradeoff results in the same spirit, such as the CAP theorem, which uses a similar asynchronous argument.
- Practical designs that keep safety unconditional and treat timeouts only as a liveness hint, as in [Raft](/papers/raft-understandable-consensus-algorithm).
- Transferring the result to other problems equivalent to consensus, such as atomic broadcast.
