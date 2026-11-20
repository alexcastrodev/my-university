---
title: "Logical Physical Clocks"
summary: Kulkarni, Demirbas and colleagues propose the hybrid logical clock (HLC), a pair (l, c) that keeps Lamport's causality guarantee while staying within the clock synchronization uncertainty of the NTP clock and fitting in 64 bits. Note that this analysis is based on the University at Buffalo technical report version, not on the OPODIS 2014 proceedings text.
researchArea: Distributed Systems
keywords: hybrid logical clocks, logical clocks, physical clocks, NTP, causality, consistent snapshots, multiversion databases
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Abstract of the technical report version that was read (the proceedings chapter may word it differently):

There is a gap between the theory and practice of distributed systems in terms of the use of time. The theory of distributed systems shunned the notion of time, and introduced "causality tracking" as a clean abstraction to reason about concurrency. The practical systems employed physical time (NTP) information but in a best effort manner due to the difficulty of achieving tight clock synchronization. In an effort to bridge this gap and reconcile the theory and practice of distributed systems on the topic of time, we propose a hybrid logical clock, HLC, that combines the best of logical clocks and physical clocks. HLC captures the causality relationship like logical clocks, and enables easy identification of consistent snapshots in distributed systems. Dually, HLC can be used in lieu of physical/NTP clocks since it maintains its logical clock to be always close to the NTP clock. Moreover HLC fits in to 64 bits NTP timestamp format, and is masking tolerant to NTP kinks and uncertainties. We show that HLC has many benefits for wait-free transaction ordering and performing snapshot reads in multiversion globally distributed databases.

## Overview

The paper appeared at OPODIS 2014 (Lecture Notes in Computer Science 8878, pp. 17-32; Crossref lists Kulkarni, Demirbas, Madappa, Avva and Leone). **Important caveat:** the open copy that was read is the University at Buffalo technical report (cse.buffalo.edu/tech-reports/2014-04.pdf, 13 pages). Its title is "Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases" and it spells one author "Madeppa". The proceedings chapter was not read and may differ from it in text, results and numbering.

The starting point is the gap between theory and practice of time. [Lamport's logical clocks](/papers/lamport-time-clocks-ordering-of-events) capture happened-before but are unrelated to wall-clock time, so a system cannot ask for "the state at 10:00". Physical clocks synchronized by NTP do relate to wall time, but their uncertainty intervals overlap and the paper notes NTP kinks such as leap seconds and non-monotonic updates. TrueTime, used by [Spanner](/papers/spanner-globally-distributed-database), needs GPS and atomic clocks and makes transactions wait out the uncertainty. The paper also discusses vector clocks, whose size grows with the number of nodes, and [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store)-style version vectors. A reader should know Lamport clocks and what NTP offers before starting.

## Contribution

- **The hybrid logical clock.** Each node keeps a pair (l, c). The value l tracks the maximum physical time seen so far, and c is a bounded counter used only to order events that share the same l. Timestamps compare lexicographically.
- **A diagnosis of the naive design.** Merging the two in one value (on receive, l = max(l + 1, message l + 1, pt)) lets |l - pt| grow without bound in a message loop among three nodes (the paper's Figure 4).
- **Proved properties.** One-way causality (e hb f implies hlc.e < hlc.f), l never below pt, |l - pt| bounded by the synchronization uncertainty epsilon, and a bound on c.
- **A compact encoding.** The timestamp fits in 64 bits, as NTP timestamps do, and HLC only reads the physical clock, never changes it.
- **Resilience mechanisms.** Self-stabilization by resetting to (pt, 0) when bounds break, and rules to ignore out-of-bounds messages.
- **Snapshot reads without waiting.** A read at (l = t, c = 0) gives a consistent snapshot, using virtual dummy events.

## Methodology

The paper states four requirements for a timestamp l.e: causality, O(1) integers, bounded space, and closeness to pt.e. It gives the naive algorithm, a counterexample, then the HLC algorithm (Figure 5): on a send or local event, l becomes max(old l, pt) and c is incremented if l did not change, else reset to 0. On receive, l becomes max(old l, message l, pt) and c is set from the cases where l equals the old value, the message value, both or neither.

Correctness is by proof (Theorems 1 to 4 and Corollaries 1 to 4), with epsilon as the assumed bound on clock synchronization uncertainty. The evaluation has two parts. First, a real deployment on Amazon AWS m1.xlarge instances (Ubuntu 14.04, synchronized to the stratum 2 server 0.ubuntu.pool.ntp.org) where all nodes send TCP messages to each other continuously, with 75,000 to 425,000 messages in total, in 4, 8 and 16 node runs in one region and a 4 node WAN run across Ireland, US East, US West and Tokyo. Second, simulations with one event per millisecond, drift epsilon from 10 ms to 100 ms, and added stragglers (clocks behind) and rushers (clocks ahead).

## Findings

- **Theorem 1:** e hb f implies (l.e, c.e) < (l.f, c.f). **Theorem 2:** l.f is at least pt.f. **Theorem 3:** if l.f > pt.f, some event g with g hb f has pt.g = l.f. **Corollary 1:** |l.f - pt.f| is at most epsilon.
- **Bounds on c.** Corollary 3 gives c.f at most N * (epsilon + 1), assuming the physical clock advances by at least one between two events on a node. If message transmission is long enough that clocks advance by at least d, Corollary 4 gives c.f at most epsilon / d + 1.
- **Size.** l keeps the 48 most significant bits of pt (rounded up, microsecond granularity) and c gets 16 bits, so it can reach 65536.
- **4 nodes:** c never exceeded 3 (offset 5 ms: c = 0 in 83.90% of events, c = 1 in 12.12%). Max l - pt was 21.7 ms at 5 ms offset and 20.3 ms at 1.5 ms.
- **8 nodes:** at 9 ms offset c reached 9 (0.03%) and max l - pt was 107.9 ms; at 3 ms offset c was only 0 (91.18%) or 1 (8.82%) and max l - pt was 7.4 ms.
- **16 nodes:** at 16 ms offset c reached 7 (0.02%), max l - pt was 90.5 ms (90th percentile 25.2 ms); at 6 ms offset the max was 46.8 ms.
- **WAN:** with 3 ms offset c = 0 in about 95% of events and max l - pt about 0.02 ms, because message delays exceed epsilon.
- **Simulation:** c was fairly independent of epsilon and was 4 or less for more than 99% of events. A straggler at the edge of the permitted drift reached c = 97, and one up to 5 epsilon behind reached 514, both only at the straggler node. Rushers gave a maximum c of 8.

## Critical Analysis

- **Technical report, not proceedings.** Every number above comes from the report. The proceedings version may have revised experiments or claims.
- **The bounds depend on assumptions.** The epsilon bound relies on the clock synchronization constraint holding. The paper handles violations with resets and ignored messages, which are design measures rather than proved guarantees. The tighter bound on c needs an assumption about message delay relative to clock advance.
- **No end-to-end database evaluation.** The experiments measure c and l - pt only. Nothing measures transaction throughput, read latency or a Spanner-like system, so the "no waiting" benefit is argued, not measured.
- **It does not replace TrueTime.** The paper observes that Spanner's commit-wait gives external consistency (strict serializability). HLC itself provides causality in one direction only; the paper says external consistency could be obtained with a "client-notification-wait" after a transaction ends, in one paragraph with no evaluation. The paper uses "equal HLC values imply concurrent events" for snapshots, but claims causality in one direction only (the converse does not hold, as for Lamport clocks).
- **Setup.** The deployments use a single cloud provider, and the worst case with a straggler (c = 514) is much larger than the typical case.
- **Later literature (marked as such).** CockroachDB's documentation (read on 2026-11-20) says it uses hybrid logical clocks, with timestamps updated from the HLC time carried by requests, and links this very report as "the HLC paper". It also states that skew beyond the configured bound can violate single-key linearizability between causally dependent transactions, which fits the limits above. I did not verify claims about MongoDB or other systems.

## Further Research

- Compare HLC with [TrueTime in Spanner](/papers/spanner-globally-distributed-database) on real workloads, including the cost of commit-wait.
- Systems that exploit synchronized clocks for ordering, such as [Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks).
- Causal consistency in geo-replicated services, for example [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) and [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications).
- Read the proceedings version and compare it with the report.
- Return to [Lamport's clocks](/papers/lamport-time-clocks-ordering-of-events) as the baseline that HLC extends.
