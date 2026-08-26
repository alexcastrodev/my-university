---
title: "Back-of-the-Envelope Capacity Estimation"
description: How to turn "design a system for a billion users" into concrete numbers for QPS, storage, and bandwidth in a few minutes of arithmetic — powers-of-two shortcuts, the latency numbers every engineer should have memorized, and why the actual point isn't precision, it's catching a design that's wrong by three orders of magnitude before you build it.
difficulty: Intermediate
readingTime: 12
tags:
  - System Design
  - Performance
  - Scalability
  - Distributed Systems
  - Estimation
prerequisites:
  - label: "Describing Performance: Latency, Response Time, and Percentiles"
    slug: describing-performance-latency-and-percentiles
  - label: "Horizontal vs. Vertical Scaling"
    slug: horizontal-vs-vertical-scaling
related:
  - label: "Designing a URL Shortener"
    slug: url-shortener
  - label: "Scalability and Maintainability: Load Parameters and the Operability-Simplicity-Evolvability Triad"
    slug: scalability-and-maintainability-principles
  - label: "Object Storage and the Direct-Upload Pattern"
    slug: object-storage-and-direct-upload
  - label: "Designing a Distributed Key-Value Store"
    slug: key-value-store-design
---

## Overview

Before choosing a database, a caching strategy, or a sharding scheme, a senior engineer should be able to sanity-check the actual scale of the problem in a few minutes of arithmetic. Back-of-the-envelope estimation turns a vague prompt — "design a system for a billion users" — into concrete figures for queries per second, storage growth, and bandwidth, using nothing more than a handful of stated assumptions, powers-of-two shortcuts, and a short list of latency numbers worth memorizing. The goal is never precision: nobody expects the third significant figure to be right, and a number computed to five decimal places from three guessed inputs is false confidence dressed up as rigor. The actual point is catching an assumption that's wrong by one or more orders of magnitude — a workload that's actually 200,000 QPS, not 200 — before it drives an expensive design decision. The gap between "a single Postgres instance with a read replica" and "a globally sharded key-value store with async replication" is visible in the very first pass of arithmetic, not six months later in a load test that fails in production.

## Powers of Two and Round Numbers

Estimation collapses if every step carries its own units. The fix, used throughout Alex Xu and Sahn Lam's *System Design Interview* (ByteByteGo, 2020), Chapter 2, is to memorize the correspondence between powers of two and powers of ten and use it as a mental lookup table instead of a calculator:

| Power of 2 | Exact value | Approximation | Common unit |
|---|---|---|---|
| 2^10 | 1,024 | ~1 thousand | KB |
| 2^20 | 1,048,576 | ~1 million | MB |
| 2^30 | 1,073,741,824 | ~1 billion | GB |
| 2^40 | 1,099,511,627,776 | ~1 trillion | TB |
| 2^50 | 1,125,899,906,842,624 | ~1 quadrillion | PB |

The error introduced by this approximation is under 12% even at 2^50, and it never compounds across a calculation the way a wrong *input assumption* does — a storage estimate off by 12% and a storage estimate off by 100x require completely different reactions, and this shortcut only ever risks the former. What it buys you is speed: you can convert "3 billion rows" almost instantly into "a bit under 2^32" without touching a calculator, which matters when the actual exercise is running five or six such conversions in sequence — DAU to QPS, QPS to daily requests, requests to storage, storage to bandwidth — without losing the thread. It's a mental caching layer for units, not a source of precision, and it should never be the excuse for skipping the harder step: stating your assumptions explicitly so someone else can challenge the one that's actually wrong.

## Latency Numbers Every Engineer Should Know

Some estimates aren't about volume at all — they're about whether an architecture is even physically plausible. A design that does a synchronous cross-region call inside a request that's supposed to complete in 10 ms is dead on arrival regardless of how the QPS math works out, and the only way to catch that in a few seconds is having rough orders of magnitude for fundamental operations already memorized. The canonical reference is the "Latency Numbers Every Programmer Should Know" table, popularized from an internal Google talk by Jeff Dean, later built into an interactive comparison by Peter Norvig, Colin Scott, and Jonas Bonér that tracks how these numbers shift across hardware generations:

| Operation | Approximate latency |
|---|---|
| L1 cache reference | ~1 ns |
| Main memory reference | ~100 ns |
| Read 1 MB sequentially from memory | ~10 μs |
| SSD random read | ~150 μs |
| Round trip within same datacenter | ~500 μs |
| Read 1 MB sequentially from SSD | ~1 ms |
| Disk seek | ~10 ms |
| Send packet CA → Netherlands → CA | ~150 ms |

Two things matter more than the exact figures. First, memory is roughly 100,000x faster than a disk seek and roughly 1,000x faster than an SSD random read — the specific numbers drift with hardware, but that ratio has held for over a decade and is the entire justification for caching as an architectural pattern rather than a performance afterthought. Second, a same-datacenter round trip (~500 μs) versus a cross-continent one (~150 ms) is a 300x gap — which is why "just add a synchronous call to another region" is a red flag in any design that has a latency budget under a second. These figures are illustrative and approximate; treat them as the right order of magnitude to reason with, not a benchmark to cite in a postmortem.

## Estimating QPS from Daily Active Users

Most estimation problems start from a single given number — daily active users (DAU) — and a small set of assumed behaviors, then derive everything else:

1. **Daily requests** = DAU × requests per user per day for the operation in question.
2. **Average QPS** = daily requests / 86,400 (seconds in a day; round to 100,000 for speed).
3. **Peak QPS** = average QPS × a peak factor, typically 2–3x for consumer traffic with a diurnal pattern, higher for anything with a flash-crowd risk (ticket sales, breaking news).

The peak factor is the step people skip and shouldn't: provisioning for average QPS on a system with a strong daily cycle guarantees it falls over during business hours in its own busiest timezone. When a prompt gives ambiguous inputs, state the assumption out loud (e.g., "I'll assume 10% of registered users are daily-active, and each performs 20 read operations for every write") — the number matters less than making the reasoning inspectable so a reviewer can challenge the one assumption that's actually off.

## Estimating Storage

Storage estimates chain three quantities: how many records get written per unit time, how big each record is, and how long they're retained.

`total storage ≈ records per day × average record size × retention period`

The record size is the assumption most often gotten wrong, because it's tempting to size only the primary payload and forget metadata, indexes, and replication. A "small" row with a timestamp, a few foreign keys, and a status enum is rarely under 100 bytes once overhead is included; a JSON blob or an embedded object can be an order of magnitude larger. Multiply the raw data volume by the replication factor (commonly 3x for durability) and by an index overhead factor (commonly 1.1–1.5x) before calling a number final — skipping this step is how "36 TB" quietly becomes "150 TB" of actual disk footprint.

## Estimating Bandwidth

Bandwidth estimation is the same shape as QPS estimation, just multiplied by payload size instead of divided by seconds:

`bandwidth ≈ requests per second × average payload size`

Compute it separately for ingress (what the service receives — uploads, writes) and egress (what it sends — responses, downloads, static assets), because the two are frequently asymmetric by an order of magnitude or more: a photo-sharing service ingests a full-resolution upload once and serves a compressed thumbnail thousands of times, so egress dominates and is where CDN offload (see [Object Storage and the Direct-Upload Pattern](object-storage-and-direct-upload)) earns its keep. A metadata-heavy service — a URL shortener, a social graph query — will often show bandwidth numbers so small they're not the bottleneck at all, and the estimate's real value is confirming that and redirecting attention to QPS or storage instead.

## A Worked Example: Estimating a URL Shortener

Take the classic prompt: size a TinyURL-style service. Assume 100 million new short links created per day, a 10:1 read:write ratio (redirects vastly outnumber creations), an average long URL of 500 bytes, a 100-byte stored row (code, hash, timestamp, metadata), and a 10-year retention requirement.

| Step | Calculation | Result |
|---|---|---|
| Write QPS (avg) | 100,000,000 / 86,400 | ≈ 1,160 writes/sec |
| Write QPS (peak, ×2) | 1,160 × 2 | ≈ 2,320 writes/sec |
| Daily redirects | 100,000,000 × 10 | 1,000,000,000 /day |
| Read QPS (avg) | 1,000,000,000 / 86,400 | ≈ 11,600 reads/sec |
| Read QPS (peak, ×2) | 11,600 × 2 | ≈ 23,200 reads/sec |
| Rows over 10 years | 100,000,000 × 365 × 10 | 365,000,000,000 rows (≈ 2^38.4, so a bit under 2^40) |
| Raw storage | 365,000,000,000 × 100 bytes | ≈ 36.5 TB |
| Storage with 3x replication | 36.5 TB × 3 | ≈ 110 TB |
| Write bandwidth (ingress) | 1,160/sec × 500 bytes | ≈ 580 KB/s |
| Read bandwidth (egress) | 11,600/sec × ~300 bytes (redirect response) | ≈ 3.5 MB/s |

Reading the results, not just producing them, is the actual skill. The read:write ratio of 10:1 means the redirect path is the one that needs a cache and the creation path doesn't — that single number decides where engineering effort goes. 365 billion rows land just under 2^40, which immediately tells you the keyspace needs to support at least that many distinct codes: Base62 over 7 characters gives 62^7 ≈ 3.5 trillion, comfortably above it, while 6 characters (56 billion) would not be, and you learn that from the estimate before writing a line of the ID generator (see [Distributed ID Generation](distributed-id-generation) for how that space gets allocated collision-free). The bandwidth numbers, by contrast, are unremarkable in either direction — single-digit megabytes per second is not a number anyone needs to architect around — and that null result is itself useful: it tells you not to spend the interview, or the design doc, defending a CDN strategy for a service where bandwidth was never going to be the constraint. Compare that to a service serving 500 KB video thumbnails at the same 23,200 peak QPS: egress alone would be over 11 GB/s, an entirely different conversation that this same arithmetic would have surfaced in the same few minutes.

## Trade-offs

- **Estimation catches magnitude errors, not correctness or performance under load** — knowing you need to handle roughly 20,000 QPS says nothing about whether your actual implementation, network topology, or lock contention can sustain it; back-of-envelope math is a design-time sanity check, not a substitute for load testing.
- **Averages hide the peak that actually breaks you** — average QPS provisioning fails exactly when it matters, because real traffic has diurnal cycles and occasional flash crowds; every average-based estimate needs an explicit peak multiplier or it's silently wrong for the case that counts.
- **The estimate is only as good as its stated assumptions, and those are usually guesses** — a "500-byte average payload" or "10% DAU-to-registered ratio" is asserted, not measured; the value of the exercise is making the assumption visible and challengeable, not treating the resulting number as fact.
- **Powers-of-two shortcuts trade a small, bounded error for speed** — up to roughly 12% at 2^50 — which is acceptable because the exercise is already tolerant of order-of-magnitude error; it would not be acceptable in a context where that 12% is the actual question.
- **It says nothing about tail behavior or failure modes** — an estimate that a system needs to sustain 11,600 reads/sec on average tells you nothing about what happens to the slowest 1% of those reads, which is a separate discipline (see [Describing Performance: Latency, Response Time, and Percentiles](describing-performance-latency-and-percentiles)).
- **It's a communication tool as much as a computation** — in an interview or a design review, showing the arithmetic step by step is what demonstrates judgment; a correct final number with no visible reasoning is much less convincing than an approximate number arrived at transparently.

## Interview Questions

- A candidate estimates a system needs 50,000 QPS but never states a peak multiplier. What's wrong with taking that number at face value, and what follow-up question exposes the gap?
- You're told a service has 500 million DAU. Walk through converting that into read QPS and write QPS given a stated read:write ratio, and explain why you'd sanity-check the ratio itself before trusting the output.
- Why does a difference between a 500 μs same-datacenter round trip and a 150 ms cross-continent one matter more for architecture decisions than it does for raw throughput math?
- A storage estimate comes out to 40 TB before accounting for replication and index overhead. What multiplier would you apply, and why does skipping it lead to under-provisioning?
- For which of these two systems would bandwidth estimation actually change the design: a URL shortener, or a service serving user-uploaded video thumbnails? Justify the difference using the shape of the payload, not just the QPS.
- If two different reasonable assumptions for "requests per user per day" lead to estimates that differ by 3x, does that invalidate the exercise? What should you do with that spread instead of picking one number and moving on?

## References

- [Alex Xu and Sahn Lam, "System Design Interview – An Insider's Guide, Volume 1" (ByteByteGo, 2020) — Chapter 2, "Back-of-the-Envelope Estimation"](https://bytebytego.com)
- [Colin Scott — "Latency Numbers Every Programmer Should Know" (interactive visualization, based on Peter Norvig's and Jeff Dean's figures)](https://colin-scott.github.io/personal_website/research/interactive_latency.html)
- [Jonas Bonér et al. — "Latency Numbers Every Programmer Should Know" (GitHub Gist)](https://gist.github.com/jboner/2841832)
- [Google SRE Book — Chapter 4: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)
