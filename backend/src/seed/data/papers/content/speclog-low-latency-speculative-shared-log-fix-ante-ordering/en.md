---
title: "Low End-to-End Latency atop a Speculative Shared Log with Fix-Ante Ordering"
summary: SpecLog delivers shared log records before global ordering finishes, using predetermined cuts that let shards predict positions accurately, and its implementation Belfast overlaps ordering with downstream computation to lower end-to-end latency.
researchArea: Distributed Systems
keywords: shared log, speculation, fix-ante ordering, end-to-end latency, total order, durability-first
version: 1.0
updatedAt: 2026-11-03
---

## Overview

In a durability-first shared log such as [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order), clients write to shards of their choice, and shards periodically report their durable records to a sequencing layer, which computes a global cut. This design gives elasticity, flexible placement and scalability, but a record reaches consumers only after the cut comes back. Delivery latency, the time until a downstream task can have a record, is therefore high, and application end-to-end (e2e) latency adds processing on top.

This OSDI 2025 paper, from the University of Illinois Urbana-Champaign, targets applications that consume records as soon as they arrive, such as fraud detection and high-frequency trading. Its idea is to deliver records before their order is known, compute on a predicted order and confirm later, so that ordering and computation run side by side.

Three names are worth keeping apart: SpecLog is the abstraction, fix-ante ordering is the mechanism that makes predictions accurate, and Belfast is the system that implements both.

Worth knowing first: Scalog's global cuts, speculative execution, and [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications), a sibling paper with overlapping authors that targets ingestion latency instead.

## Contribution

- **The SpecLog interface.** It resembles today's logs, except that `deliver` carries a bit saying whether the position is speculative, and `confirm_spec(k)` or `fail_spec(k)` follows. Applications hold external outputs until confirmation and roll back state on failure.
- **Fix-ante ordering.** In Scalog a shard may report as many records as it likes, so no other shard can tell where its own records will land. Fix-ante ordering replaces this free will with predetermined cuts that give each shard a quota. With quotas of 2, 3 and 2, the first cut covers positions 1 to 7, so S2 knows its next record takes position 10, since 8 and 9 belong to S1. A shard short of records adds no-ops, and a shard with extra records delays them to the next report.
- **Order still follows durability.** The sequencing layer still produces actual cuts, and appends are acknowledged only after them, because acknowledging earlier would break linearizability.
- **Belfast's mechanisms.** Quotas follow ingestion rates. Lag fix asks shards that fall behind for extra reports during bursts. Speculation lease windows of W cuts confine quota and membership changes to window boundaries, so all shards switch together. Stragglers get a zero quota, and with many shards staggered cuts wait only for a subset.
- **Failure handling.** When a whole shard fails, a view change fails every position after the last confirmed cut, and a live shard fills the failed shard's slots with no-ops until the window ends.

## Methodology

Belfast modifies the open-source Scalog code, with a window of 100 cuts and an ordering interval of 1 ms. Experiments ran on CloudLab with a primary and a backup per shard and 4KB records. The baseline is Scalog, changed so that only the primary reports, which isolates fix-ante reporting from free-will reporting. The authors varied compute time, shard count, bursts, rates and window size, injected a straggler, and killed a replica and a whole shard. Real runs reach 10 shards, and an emulation reaches 40. Three applications were built: IoT intrusion detection, fraud monitoring and high-frequency trading.

## Findings

These are the authors' reported results, comparing Belfast with Scalog.

- **Delivery and e2e latency.** With 1.5 ms of compute, Belfast delivers 3.2× to 3.5× earlier and cuts average e2e latency by 1.6×. At p99 the gain is 1.4× with 2 shards and 1.17× with 4.
- **Compute time sets the gain.** It is 1.17× at 0.5 ms, peaks at 1.63× at 1.5 ms, falls to 1.3× at 4 ms and approaches 1 at 50 ms. With short compute, tasks wait for confirmation; with long compute, ordering is a small share of the total.
- **Costs.** Append overhead is 5.8% with 10 shards, and no-ops stay under 5% of records.
- **Bursts and rate changes.** With lag fix, e2e latency stays below Scalog's through a burst. Without quota changes, sequencer load is about 2× higher.
- **Elasticity and scale.** Shards join and leave with no downtime, and a new shard's throughput arrives less than 100 ms late. Belfast scales like Scalog, with 1.66× and 1.4× lower e2e latency at 2 and 10 shards (1.2 ms compute), and an emulation keeps a benefit at 40 shards.
- **Applications.** Intrusion detection gains 1.60× (1.4 ms compute), fraud monitoring 1.40× (2.2 ms) and high-frequency trading 1.42× (800 µs).
- **Failures.** A replica failure leaves latency and throughput unaffected. A whole-shard failure causes rollbacks, with detection taking most of the time and rollback a marginal part of it.

## Critical Analysis

The idea is elegant, and Figure 8 explains its gain well. The paper concedes two costs.

- **Confirmation bounds what users see.** Outputs must wait for it, so speculation hides ordering rather than removing it. The headline 1.6× sits at the peak of the compute curve.
- **Fix-ante adds waiting.** The sequencer holds a cut until every shard with a quota reports, a delay Scalog does not have. The paper warns that repeated bursts could cause many lag fixes and more sequencer load, and leaves its high-burstiness mode and fallback to Scalog as future work.

The following points are a reading of the evidence, not claims of the paper.

- **Misspeculation is measured once.** The only forced case is a single whole-shard failure in fraud monitoring, where the undo state is a few database rows per transaction. "Marginal" rollback may not hold for applications with costly state, and whole-shard failure being "very rare" is asserted, not quantified.
- **Porting effort has no numbers.** The paper calls the changes minimal without measuring them. Its rule covers external outputs, yet all three applications write speculative values to a database, so anything else reading that database needs its own guard.
- **Numbers are relative to one code base.** Belfast and its baseline both descend from the Scalog artifact, which keeps the ratios fair. Absolute values need more care: the [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications) paper says a better implementation of that Scalog would have lower absolute latencies. The 40-shard result, with emulated shards, is an estimate.
- **The demand evidence is shared.** The roughly 35% naming delivery as the most critical latency comes from the same Redpanda report LazyLog cites for a third of 300 practitioners naming ingestion. Neither is a majority.
- **The comparison with LazyLog depends on the application.** The paper says LazyLog "does not fundamentally help reduce e2e latencies". That is fair for records consumed at once. On appends the balance reverses: Belfast's sit near 3 ms in Figure 9, about where Scalog's are, and ingestion is the metric LazyLog targets.

## Further Research

- The high-burstiness mode and the fallback to Scalog, which the paper leaves as future work.
- Speculation on order-first logs, which the paper sketches as reading ordered but non-durable records from a shard primary.
- How expensive rollback can get before speculation stops paying, with failures injected across applications with different state sizes.
- Whether a single log can offer both speculative delivery and lazy 1 RTT ingestion.
