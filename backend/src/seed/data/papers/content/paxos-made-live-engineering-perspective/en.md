---
title: "Paxos Made Live: An Engineering Perspective"
summary: Chandra, Griesemer and Redstone report what it took to turn Paxos into the replicated log under Google's Chubby, covering disk corruption, master leases, group membership, snapshots, a testing strategy built on injected random failures, and the surprises that appeared in production.
researchArea: Distributed Systems
keywords: paxos, multi-paxos, replicated log, chubby, snapshots, group membership, fault injection testing
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We describe our experience building a fault-tolerant data-base using the Paxos consensus algorithm. Despite the existing literature in the field, building such a database proved to be non-trivial. We describe selected algorithmic and engineering problems encountered, and the solutions we found for them. Our measurements indicate that we have built a competitive system.

## Overview

[Paxos Made Simple](/papers/paxos-made-simple) and [The Part-Time Parliament](/papers/paxos-part-time-parliament) describe the algorithm in a page or so. This paper, published at PODC 2007 by three Google engineers, describes the other end of the road: replacing the commercial replicated database ("3DB") under [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), Google's lock service, with a fault-tolerant log built on Paxos. The authors say the algorithm fits in a page of pseudo-code, while their implementation is several thousand lines of C++.

The setting is the [state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial): a replicated log feeds a local database at each replica, and Chubby sits on top. Chubby cells have five replicas, one of which is the master, and systems such as the [Google File System](/papers/google-file-system) and Bigtable depend on it.

Worth knowing first: single-decree Paxos, Multi-Paxos (a stable coordinator, called the master, skips the propose phase for later instances), and the idea of a log plus snapshot as the persistent form of a replicated data structure.

## Contribution

- **A list of gaps between Paxos and a real system.** The paper does not propose a new consensus algorithm. It documents mechanisms the authors had to add, some from the literature and some not.
- **Disk corruption handling.** A replica that loses its disk could renege on earlier promises, so it is detected (checksums, plus a marker left in GFS) and rebuilt as a non-voting member.
- **Master leases and epoch numbers.** Leases let the master serve reads locally, and a global epoch number lets Chubby abort requests when mastership was lost or regained.
- **Snapshots with a snapshot handle.** The application takes snapshots, the framework truncates the log, and the handle ties the two together.
- **MultiOp.** One atomic primitive (a guard, a list of operations if true, a list if false) that implements all database operations except iteration.
- **Engineering practice.** The core algorithm is written in a state machine specification language compiled to C++, with runtime consistency checks and randomized, repeatable failure tests.

## Methodology

The paper is an experience report, not a controlled study. It describes the architecture (Paxos log, replicated database, Chubby), then walks through problems in three groups: algorithmic gaps, software engineering, and unexpected failures in production. Evidence comes from the authors' own implementation, including three database inconsistency incidents and a list of production failures over "well over 100 machine years of execution".

The only quantitative evaluation compares a Paxos-based Chubby with an identical Chubby on 3DB, both run on the same five Pentium-class servers, with clients on workstations. Each worker repeatedly creates a file and waits for the reply. The tests are deliberately write-intensive, since reads are served at the master and do not exercise Paxos.

## Findings

What the paper reports about the topics that matter most:

- **Disk failures.** A corrupted or erased disk can break the promise assumption of Paxos. A new replica leaves a marker in GFS, so an empty disk with a marker is recognized as corruption. The replica rejoins as non-voting and waits until it observes one complete Paxos instance that started after it began rebuilding. The authors note this might allow skipping immediate disk flushes, but they had not implemented that. Files that roll back to an old state are not caught by the per-file checksums (the distributed checksum described later may catch them).
- **Snapshots.** Without them the log grows without bound and recovery time is unbounded. Snapshots are not synchronized across replicas, and each replica decides when to take one. Taking one has three steps (request a handle, snapshot, tell the framework), and the log is truncated only after the framework is told, so a failed snapshot can be discarded. A lagging replica that cannot find old log entries is told to fetch a snapshot from another replica, and may need a newer one if the provider moved on.
- **Group membership.** The paper says it is straightforward for core Paxos but subtle with Multi-Paxos and disk corruption, that the literature has no proof for it, and that the details are "beyond the scope of this paper". Late in development a rule where a replica that left the group could never rejoin was replaced by a two-state in/out model, because intermittent failures were more common than expected. The change took about one hour, and three days to adjust the tests.
- **Master leases.** Masters keep leases for several days at a time. The master uses a shorter lease timeout than replicas to guard against clock drift. It periodically runs a full Paxos round to boost its sequence number, which stops an old master with a higher number from displacing the new one; in a loaded system under one percent of instances run the full algorithm.
- **Testing.** Two randomized tests run in safety mode (consistency only) and then liveness mode (progress required after failures stop). The log test is repeatable by seeding a random number generator and running single-threaded, which works because the log creates no threads. It found protocol errors in group membership and disk corruption handling, and some bugs took weeks of simulated execution at extreme failure rates on a farm of several hundred machines. The second test injects crashes, disconnections and fake master loss, and found five Chubby bugs in two weeks. A five-replica cell with a misspelled replica name ran as if healthy but tolerated one fault instead of two.
- **Production surprises.** One rollback used an old snapshot and lost 15 hours of data; a later upgrade failure lost about 30 minutes. A Linux 2.4 flush could stall for seconds after a snapshot write, so large files are written in small chunks. Replica checksums caught three database inconsistencies.
- **Performance.** With one worker: 91 against 75 ops/sec (1.2x). With 10 workers: 490 against 134 (3.7x). With 20 workers: 640 against 178 (3.6x). With 8 KB files: 345 against 172 KB/s (2x) for one worker and 777 to 949 against 217 KB/s for four. The Paxos system held a 100 MB database, 3DB a small one, and snapshots were taken roughly every 100 seconds in the last two tests.

## Critical Analysis

- **Honest about its limits.** The authors admit the final system "will be based on an unproven protocol" and that they had to fill gaps in the literature, so correctness rests on testing, review and runtime checks, not proof.
- **Thin on the hardest part.** Group membership is declared subtle and then omitted, so a reader cannot reproduce it from this paper.
- **The benchmark is limited.** It is a single comparison against one product, write-heavy, with the two databases at different sizes. The authors themselves say it underestimates the database and that the system is not optimized.
- **Leases and reads.** The paper explains why a master with a lease can read locally and how clock drift is handled by a shorter master timeout. It does not use the word linearizability; for the formal property behind this, see [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects). It also does not mention FLP, although its liveness mode, which requires failures to stop before progress is checked, matches what [FLP](/papers/flp-impossibility-of-distributed-consensus) implies about asynchronous consensus.
- **Later literature, not in this paper.** [Raft](/papers/raft-understandable-consensus-algorithm) later specified leader election, log replication, snapshots and membership changes together as one algorithm, which addresses the gap this paper complains about. Formal Multi-Paxos specifications and machine-checked proofs also came afterward.

## Further Research

- Complete, proven protocols for Multi-Paxos with group membership, disk corruption and snapshots (the gap the authors name).
- Replica leases so any replica can serve reads locally, which the authors examined but did not implement.
- Tools for building fault-tolerant systems, comparable to parser generators for compilers.
- Systematic testing of masked failures and misconfigurations, for which the authors say they have no systematic solution.
- Writing flushes without immediate disk sync when failures are independent, given the corruption handling above.
