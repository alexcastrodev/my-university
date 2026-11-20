---
title: "Epidemic Algorithms for Replicated Database Maintenance"
summary: Demers and colleagues at Xerox PARC show how to keep hundreds of database replicas converging without a coordinator, using three randomized methods (direct mail, anti-entropy and rumor mongering) analyzed with epidemiology and tuned on the Clearinghouse servers of the Xerox Corporate Internet.
researchArea: Distributed Systems
keywords: epidemic algorithms, replicated database, anti-entropy, rumor mongering, death certificates, spatial distribution, eventual consistency, Clearinghouse
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

When a database is replicated at many sites, maintaining mutual consistency among the sites in the face of updates is a significant problem. This paper describes several randomized algorithms for distributing updates and driving the replicas toward consistency. The algorithms are very simple and require few guarantees from the underlying communication system, yet they ensure that the effect of every update is eventually reflected in all replicas. The cost and performance of the algorithms are tuned by choosing appropriate distributions in the randomization step. The algorithms are closely analogous to epidemics, and the epidemiology literature aids in understanding their behavior. One of the algorithms has been implemented in the Clearinghouse servers of the Xerox Corporate Internet, solving long-standing problems of high traffic and database inconsistency.

## Overview

The paper (PODC 1987) starts from the Clearinghouse name service of the Xerox Corporate Internet (CIN), several hundred Ethernets with several hundred servers. Some domains were stored at every server. In early 1986 many observable network performance problems traced back to the traffic spent keeping those domains consistent. Anti-entropy was supposed to run once a night, and servers often did not finish. It was followed by a remailing step: for a domain stored at 300 sites, 90,000 mail messages could be introduced in a night. The authors disabled it, found that key links would still be overloaded, and that led to the rest of the paper.

The goal is not one-copy serializability but eventual agreement: every update is injected at one site and must reach all others or be superseded by a later update. A pair with a larger timestamp always supersedes one with a smaller timestamp. The alternative the authors reject is a primary site that distributes updates, which "suffers from centralized control", and the guaranteed-delivery or ring-based schemes of earlier work. They ask only for eventual delivery of repeated messages.

Worth knowing first: timestamps as a total order on updates, and the susceptible, infective and removed states of a simple epidemic model. The paper itself speaks of epidemics and never uses the word gossip, which later systems adopted for this style. [Session Guarantees](/papers/session-guarantees-for-weakly-consistent-replicated-data), by an overlapping group at Xerox PARC, uses anti-entropy between replicas and adds guarantees on what one client sees. [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), [Cassandra](/papers/cassandra-decentralized-structured-storage-system) and [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol) are later systems that use gossip or anti-entropy ideas (see Critical Analysis). Vogels' essay [Eventually Consistent](/papers/eventually-consistent-vogels) gives the vocabulary for the consistency model.

## Contribution

- **Three methods.** Direct mail: each new update is immediately mailed from its entry site to all other sites, timely but not entirely reliable since sites do not always know all other sites and mail is sometimes lost. Anti-entropy: every site regularly chooses another site at random and resolves any differences by exchanging database contents, extremely reliable but costly. Rumor mongering: a site holding a "hot rumor" periodically shares it with random sites, and stops treating it as hot after trying too many sites that already knew it, so it can fail.
- **Epidemic vocabulary.** A site is infective (willing to share the update), susceptible (has not received it) or removed (has it but no longer shares it). Anti-entropy is a "simple epidemic" (sites are only susceptible or infective), rumor mongering a "complex" one.
- **Design axes for rumor mongering.** Blind or feedback, counter or coin, push or pull, plus minimization, connection limits and hunting. Anti-entropy has push, pull and push-pull.
- **Death certificates** to spread deletions, and **dormant death certificates** to keep them cheaply for a long time, with a second activation timestamp.
- **Spatial distributions** for choosing partners, with a distribution that depends on the cumulative number of sites at distance d or less, Q(d).

## Methodology

The paper mixes analysis, simulation and a deployment. The analysis uses deterministic models from epidemiology (the book by Bailey is the cited source): recurrences for anti-entropy and a pair of differential equations for rumors. The simulations run 1000 sites for the uniform-choice tables, and 250 runs (anti-entropy) or 200 trials (rumor mongering) on the real CIN topology, each propagating a single update from a random site. Quantities are the residue s (susceptibles left when the epidemic ends), the traffic m (updates sent divided by sites), and two delays: t_ave (average over sites) and t_last (last site reached). Link traffic is measured as comparisons or updates per link per cycle, with the transatlantic link to Bushey, England, tracked separately. Anti-entropy with a 1/Q(d)^2 distribution was then implemented and installed on the CIN; the paper tabulates no measurements from the deployment itself, only calling the improvement "dramatic" and restating the simulated factors (more than 4 on average link traffic, 30 on critical links) in its conclusion.

## Findings

- **Anti-entropy converges quickly.** Starting from one infected site, a simple epidemic reaches everyone in expected time proportional to the log of the population size. For push the exact formula is log2(n) + ln(n) + O(1), citing Pittel. As a backup after direct mail, with few susceptibles left, pull follows p(i+1) = p(i)^2, while push follows p(i+1) = p(i) (1 - 1/n)^(n(1-p(i))), about p(i) e^-1, so the authors expect pull or push-pull to be much better than push there.
- **Rumor residue.** The model ds/dt = -si, di/dt = si - (1/k)(1-s)i gives i(s) = ((k+1)/k)(1-s) + (1/k) log s and a residue s = e^(-(k+1)(1-s)): about 20% miss the rumor at k = 1 and 6% at k = 2. For the push variants the paper states s = e^(-m) and says it checked this empirically, without a proof.
- **Simulated rumors (1000 sites).** Push with feedback and counters: k = 1 gives residue 0.176 at m = 1.74, k = 5 gives 0.0012 at m = 6.68 (t_last about 17). Blind and probabilistic (coin): k = 1 leaves 0.960, k = 5 leaves 0.008. Pull with feedback and counters: k = 3 gives residue 4.0 x 10^-6 at m = 6.09, and the paper reports s = e^(-Theta(m^3)) for its recurrence.
- **Connection limits.** The paper finds that push gets better and pull gets worse with a connection limit, and that hunting for another site helps.
- **Deletion.** Dormant death certificates allow an O(n) improvement in retained history for the same space (from 30 days to several years in their system), but the retention threshold tau1 must grow as O(log n) with the network, or reactivations cascade.
- **Spatial distributions.** On a line, a probability proportional to d^-a gives link traffic O(log n) at a = 2, and d^-2 is suggested. On the CIN with push-pull anti-entropy (Table 4), going from uniform to a = 2.0 raises t_last from 7.81 to 13.32 cycles, cuts average compare traffic from 5.87 to 1.36, and cuts the Bushey link from 75.74 to 2.38 (more than 30 times). With connection limit 1 (Table 5) the Bushey figure goes from 47.54 to 0.94.
- **Rumors on the CIN.** Push-pull rumor mongering matches those results once k is raised (k = 6 at a = 2.0, Table 6). Push-only needed k = 36 at a = 1.2, and larger a did not finish overnight.

## Critical Analysis

The paper is candid about its limits. The randomized design means no claim like "converges in time proportional to the diameter": the best claim is that the probability of not having converged decays exponentially. The s = e^(-m) law is empirical for varying traffic, the pull result comes from a recurrence, and spatial convergence times are inferred from "informal equations and simulations". The epidemic models assume homogeneous mixing, and the simulations cover the Clearinghouse and the CIN topology. The authors say pathological topologies cause problems and give two small examples where rumor mongering fails with spatial distributions, which is why they back it with anti-entropy.

Other limits. Failures are of the stopping kind: lost mail, sites that are down for hours or days, permanent site loss; nothing arbitrary or malicious. Conflicts are resolved by larger timestamp, which assumes clocks near Greenwich Mean Time (otherwise the algorithms "work formally but not practically"), so concurrent writes are resolved by the larger timestamp alone. A longer version (28 pages) exists as Xerox report CSL-89-1 and as ACM SIGOPS Operating Systems Review 22(1), 1988; this analysis follows the PODC scan, and the report was used only for cross-checking.

Later literature, not part of the paper. The catalog's own pages say that Dynamo uses Merkle-tree anti-entropy and gossip, that Cassandra uses Scuttlebutt, an anti-entropy gossip mechanism, for membership, and that SWIM spreads membership changes by piggybacking on its probes. I know those only through those pages, not by re-reading the originals. [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) mentions tombstones and their lazy reclamation, the same bookkeeping problem that death certificates address, and [CRDTs](/papers/conflict-free-replicated-data-types) offer merge rules instead of timestamp-wins.

## Further Research

- The authors list the study of pathological topologies, the analysis and design of epidemics, and a dynamic hierarchy of servers (the hard part being its upkeep).
- A proof of the s = e^(-m) relationship, and of the behavior with a connection limit.
- Later analyses of rumor spreading, for example Karp, Schindelhauer, Shenker and Vocking, "Randomized rumor spreading" (FOCS 2000); I checked only its metadata, not its content.
- Replacing wall-clock timestamps with logical clocks, as in [Lamport's paper](/papers/lamport-time-clocks-ordering-of-events), is a design question the paper does not take up.
