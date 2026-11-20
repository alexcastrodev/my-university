---
title: "How Amazon Web Services Uses Formal Methods"
summary: Six AWS engineers report that since 2011 they have written TLA+ and PlusCal specifications of the core algorithms of S3, DynamoDB, EBS and an internal lock manager, model checked them with TLC, and found subtle design bugs, one needing a 35-step trace, that reviews and testing had missed.
researchArea: Distributed Systems
keywords: TLA+, PlusCal, TLC model checker, formal specification, design verification, model checking, AWS, DynamoDB
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

The article has no separate abstract. It opens with this paragraph: since 2011, engineers at Amazon Web Services (AWS) have used formal specification and model checking to help solve difficult design problems in critical systems. The authors describe their motivation and experience, what has worked well in their problem domain, and what has not. When discussing personal experience they refer to the authors by their initials. The standfirst adds: engineers use TLA+ to prevent serious but subtle bugs from reaching production.

## Overview

AWS services look simple from outside and rest on complex distributed systems. The article gives S3 as the example: one trillion objects six years after the 2006 launch, two trillion less than a year later, and 1.1 million requests per second. Each service relies on fault-tolerant algorithms for replication, consistency, concurrency control, auto-scaling and load balancing, which must be modified to work together, and sometimes invented. The authors already use design reviews, code reviews, static analysis, stress testing and fault-injection testing, and still find that subtle bugs hide in such systems. Their diagnosis is that human intuition misjudges "extremely rare" event combinations at millions of requests per second, and that testing code cannot find subtle design errors because its reachable states are astronomical.

This is a CACM article (April 2015, volume 58, number 4, pp. 66-73), an experience report from a company, not a research evaluation. Several catalog papers speak to the same problem from other angles: [Paxos Made Live](/papers/paxos-made-live-engineering-perspective) tests a Paxos implementation with random fault injection, [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) studies implementation failures, and [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) is the system whose protocol Zave analyzed with Alloy, the evidence that first convinced the author C.N. to try formal methods. [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) is a different, earlier Amazon system: the article's DynamoDB is the service launched in January 2012, which promises strong consistency, and the article does not cite the 2007 paper.

Worth knowing first: safety (what the system may do) versus liveness (what it must eventually do), and the idea that a model checker explores every interleaving of a small instance of a design.

## Contribution

- **A precise design language that engineers adopt.** TLA+ is based on basic set theory and predicates and describes all legal behaviors of a system. Correctness properties and designs are steps on one "ladder of abstraction". PlusCal, which translates to TLA+ with one key press, is meant as a replacement for pseudo-code, and several engineers found it more productive.
- **A different design question.** Instead of "what might go wrong", specify "what needs to go right": the correctness properties, plus every property the environment must provide and every event it can throw (network errors, disk errors, crashes, data-center failures, operator actions), and let the checker try all interleavings.
- **Evidence from 10 real systems.** The article lists what was specified and found (next list).
- **A practical stance on limits.** It says openly that the code is not verified against the design, and which problem classes the method does not address.

The article's table of systems, as reported:

- **S3, fault-tolerant low-level network algorithm** (804 lines of PlusCal): two bugs, then others in proposed optimizations.
- **S3, background redistribution of data** (645 PlusCal): one bug, then another in the first proposed fix.
- **DynamoDB, replication and group-membership system** (939 TLA+): three bugs requiring traces of up to 35 steps.
- **EBS, volume management** (102 PlusCal): three bugs.
- **Internal lock manager, lock-free data structure** (223 PlusCal): improved confidence, but missed a liveness bug because liveness was not checked.
- **Internal lock manager, fault-tolerant replication and reconfiguration algorithm** (318 TLA+): one bug, and verified an aggressive optimization.

## Methodology

There is no experimental design. The authors narrate how formal methods entered AWS and what happened in each project, using the initials of the engineers involved. C.N. compared Alloy and TLA+ on the same non-trivial concurrent algorithm and found Alloy not expressive enough, for example for dynamic sequences of nested records. T.R. then specified DynamoDB's replication and fault-tolerance in about two weeks and model checked it with the distributed TLC on 10 cc1.4xlarge EC2 instances (eight cores plus hyperthreads, 23 GB of RAM each). A talk called "Debugging Designs" and the pitch "exhaustively testable pseudo-code" brought in S3 teams (F.Z., B.M.), and M.B. and M.D. taught themselves from internal talks. Engineers adopted the practice of writing a conventional prose design first and refining parts of it into PlusCal or TLA+.

## Findings

All of these are the authors' own reports.

- **Bugs found.** On DynamoDB, TLC found a data-loss bug when a particular sequence of failures and recovery steps interleaved with other processing. The shortest error trace had 35 high-level steps. It passed extensive design reviews, code reviews and testing, and T.R. is convinced more of those would not have found it. Two more serious bugs followed in other algorithms. The table says "up to 35 steps" for three bugs, while the text gives 35 as the shortest trace of one bug.
- **S3.** F.Z.'s spec of a new network algorithm found two subtle bugs and later showed that some proposed optimizations would introduce bugs. B.M.'s first spec found, in seconds, a bug that had surfaced only after months of testing; the first proposed fix still failed through a different trace, and a second fix was verified. His second spec found no bugs but resolved documentation ambiguities. M.D. found a critical bug in one of the most important new algorithms with TLA+, and C.N.'s independently written spec found the same bug.
- **Cost and learning.** Engineers from entry level to principal learned TLA+ from scratch and got useful results in two to three weeks. T.R. wrote the DynamoDB spec in a couple of weeks, F.Z. two versions in a couple of weeks, B.M. spent two weeks. T.R. believes TLA+ was more reliable and less time consuming than his informal proofs.
- **Confidence for optimization.** Specs let the teams make changes such as narrowing locks or weakening message ordering "we would not have dared" to make otherwise. C.N.'s refinement of a replication design led to an optimization that radically reduced write latency.
- **Adoption.** Seven teams used TLA+ on 10 real systems, executive management encouraged specs for new features, and managers allocate engineering time in annual planning.
- **Limits stated.** Formal specification does not help with sustained emergent performance degradation, such as retry storms after a slowdown, and the lock-manager spec missed a liveness bug because liveness was not checked.

## Critical Analysis

The article's own caveats are clear. Methods deal with models, not the system ("All models are wrong, some are useful"), the authors asked only about practical benefit in their domain, and they "have not attempted a comprehensive survey", so mileage may vary. They also answer the most frequent question, whether the code implements the verified design, with "we do not know".

The following points are a reading of the evidence, not claims of the paper.

- **Evidence is testimony.** The authors built the specs, reported the results and work at the company, with no comparison group or independent assessment. Bug counts are given per project, with no count of bugs that specs missed beyond the liveness case. Claims like "bugs we would not have found through any other technique" are convictions of the engineers.
- **Cost is mostly learning time.** The weeks reported are for writing and learning, and the article gives no figures for model-checking effort beyond the DynamoDB cluster, nor for keeping specs in sync with changing code.
- **Design, not implementation.** The article verifies designs. Later catalog work verifies implementations instead, for example [IronFleet](/papers/ironfleet-proving-practical-distributed-systems-correct), which proves a Paxos-based replicated state machine library and a sharded key-value store correct in code, liveness included, and [Verdi](/papers/verdi-framework-for-implementing-and-formally-verifying-distributed-systems), a Coq framework that verifies systems first under an idealized network and then transforms them to harsher fault models. [Grove](/papers/grove-separation-logic-library-for-verifying-distributed-systems) and [seL4](/papers/sel4-formal-verification-of-an-os-kernel) also verify implementations. This is parallel or later literature that this review knows only from catalog summaries, and the AWS article does not cite IronFleet or Verdi.
- **The emergent-performance gap is a research topic of its own.** The class of failures the article says it cannot model is close to what [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) studies later, using public postmortems of incidents at many organizations. Again later work, known here only through its catalog summary.

## Further Research

- Linking designs to code: the article knows of no tool that verifies compliance of code with a high-level spec for systems as large as AWS's, and mentions using TLC to find edge cases for testing code, tried only on hardware by Tasiran et al.
- Checking liveness routinely, since the lock-manager case missed a liveness bug.
- A feasible way to model emergent performance degradation, which the authors say they do not yet know.
- How much of the benefit survives with other tools or in other domains, which the authors explicitly leave open.
