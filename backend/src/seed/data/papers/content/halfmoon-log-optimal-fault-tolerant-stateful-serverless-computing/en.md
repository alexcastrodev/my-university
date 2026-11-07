---
title: "Halfmoon: Log-Optimal Fault-Tolerant Stateful Serverless Computing"
summary: Halfmoon makes exactly-once stateful serverless functions cheaper by logging only reads or only writes instead of both, with one protocol for read-heavy and one for write-heavy workloads, a worst-case argument that neither can log less, and a way to switch between them while running.
researchArea: Distributed Systems
keywords: serverless, exactly-once semantics, shared log, idempotence, asymmetric logging, fault tolerance, sequential consistency
version: 1.0
updatedAt: 2026-11-07
---

## Overview

In serverless computing the function logic is stateless and shared state lives in an external store. A stateful serverless function (SSF) that writes to that store and then crashes gets retried by the runtime, and the retry repeats a write that already took effect. The goal is exactly-once semantics: however often an SSF crashes and re-executes, the effect on the external state must equal one run without a crash. Existing systems get there by attaching a log record to every read and write, so that a re-execution replays read results and skips finished writes. The authors call this symmetric logging.

This SOSP 2023 paper (Koblenz), by Sheng Qi, Xuanzhe Liu and Xin Jin at Peking University, argues that logging is not free. Measured on Boki with DynamoDB as the store, a log operation takes 1.18 ms at the median and 1.91 ms at p99, against 1.88 ms and 4.60 ms for a read and 2.47 ms and 5.86 ms for a write. Halfmoon is their answer: a runtime that logs only one of the two operation types.

Five terms carry the paper. Idempotence is treated as **timestamp stability**: every read and write is parameterized by a position (a seqnum) in the event stream, a write must always take effect at the same position, and a read must always seek backward from the same one. **cursorTS** is a per-SSF variable holding the seqnum of its latest logged operation, used to derive timestamps for operations that are not logged. **Halfmoon-read** logs writes only and **Halfmoon-write** logs reads only. **Log-optimal** means no protocol has a lower worst-case count of logging operations.

Worth knowing first: the shared log abstraction, in [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) (the baseline and the code base of the prototype), [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) and [CORFU](/papers/corfu-shared-log-design-for-flash-clusters), which the paper cites, plus at-least-once versus exactly-once delivery and sequential consistency versus linearizability. One pairing of mine, not cited by the paper: [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) also persists a small skeleton (the ordered inputs) and recovers the rest by deterministic re-execution.

## Contribution

- **Timestamps instead of logs.** A logged event is persistent by itself, but an unlogged one must be recoverable from others. The authors give unlogged operations logical timestamps computed from cursorTS, because real time cannot be recovered after a crash. This costs the real-time guarantee of linearizability, which they argue many serverless applications do not need (they cite repeatable reads and causal consistency in Cloudburst, and read atomicity in AFT).
- **Halfmoon-read, log-free reads.** Each SSF appends an init record whose seqnum becomes its cursorTS. A write derives a deterministic version number, writes a new version of the object (multi-versioning over a plain key-value API) and then logs the version number under two tags, the SSF id and the object key. That record is both a checkpoint and the commit point other SSFs see. A read does `logReadPrev` on the key's write log from its cursorTS and fetches that version, so it needs a log lookup but no append. The prototype logs twice per write, as Boki does, so gains come only from reads.
- **Halfmoon-write, log-free writes.** Reads are logged with their results. A write is a conditional update on a single-version object, with version number (cursorTS, counter of consecutive writes), applied only if the stored version is smaller. A re-executed write therefore lands at the same point or is dropped.
- **Log optimality.** Lemma 4.5 says that if a protocol allows log-free writes with visible effects, reads cannot be log-free, because a crash followed by such a write can make the old read result unrecoverable. It rests on two assumptions, memoryless log-free writes and SSF logic unknown to other SSFs. Theorem 4.6 follows: in the worst case a protocol logs all reads or all visible writes, for a single object.
- **Consistency.** Halfmoon-read gives sequential consistency. Halfmoon-write is equivalent to it as long as consecutive log-free writes to different objects commute, since the effective order may swap them between two logged events. Init advances cursorTS, so an SSF started after an operation finishes sees its effects, and a `sync` log gives linearizable access on request.
- **Choosing and switching.** Protocols can differ per object. Storage favors Halfmoon-read when the read probability exceeds the write probability. Runtime favors it when reads are twice as likely as writes, because the extra cost of a write is about twice that of a read in the prototype. A transition log with BEGIN and END records drives switching. SSFs that start during a switch use a transitional protocol that logs everything until all SSFs started under the old protocol finish.
- **Other mechanics.** `logCondAppend` works like compare-and-swap so only one of several peer instances of the same invocation logs a step, and garbage collection deletes write log records and object versions once no running SSF can still read them. The paper cites [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) and [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log) for the tagged sub-streams.

## Methodology

The prototype modifies about 2300 lines of C++ in Boki's logging layer and adds a 1700-line Go client library. Experiments run on AWS EC2 c5d.2xlarge instances (8 vCPUs, 16 GiB, NVMe) with eight function nodes, one gateway, three storage nodes and one sequencer, using DynamoDB as the external store. Baselines are Boki and an unsafe variant with no logging.

Microbenchmarks run a synthetic SSF with one read and one write per request over 10K objects (8B keys, 256B values) for 10 minutes. Applications are travel reservation (10 SSFs, read-intensive) and movie review (13 SSFs, slightly write-skewed) from DeathStarBench, and Retwis (read-intensive), each under both protocols. Overhead experiments use a 10-operation SSF with varying read ratio, object sizes of 256B and 1KB, GC intervals of 10 s and 60 s, and rates from 100 to 400 requests per second. Switching uses two alternating five-second phases at 300 and 600 requests per second. The extended version adds measurements under failure rates and TLA+ specifications of the protocols.

## Findings

These are the authors' reported results.

- **Microbenchmarks.** Halfmoon-read has about 30% lower read latency than Boki and similar write latency, and its reads cost about 15% over unsafe raw reads, which the authors put at 4× to 5× lower overhead than Boki. Halfmoon-write has about 30% lower write latency, and its overhead is 2× to 6× lower than Boki. Log-free writes still cost more than raw writes because conditional updates are slower.
- **Applications.** With the right protocol, median latency is 20% to 40% lower on the three workloads, and the overhead above the unsafe baseline is 1.5× to 4.0× lower. Halfmoon-read wins on travel and Retwis, and Halfmoon-write on movie review. Boki saturates at about the same load, since logging is not its bottleneck, and Halfmoon beats it even with the wrong protocol.
- **Storage.** Halfmoon needs 1.2× to 3.4× less storage than Boki on average, but Halfmoon-read uses more than Boki at low read ratios. The predicted crossover is a read ratio of 0.5, and the measured one is slightly higher, moving toward 0.5 as objects grow.
- **Runtime.** Both protocols improve median latency by 1.2× to 1.5×. The predicted crossover is a read ratio of 2/3, the measured one is slightly higher, and the request rate barely moves it.
- **Switching.** It takes under 100 ms at 300 requests per second. At 600 (saturation is near 800) it is slower from Halfmoon-write to Halfmoon-read than back, because write-heavy SSFs last longer and the old protocol must drain.
- **Failures.** Re-execution replays log-free operations, where Boki can skip logged ones. The extended version finds Halfmoon ahead of Boki below failure probabilities of 30% (read-only) and 40% (write-only). At 10% its p99 is 62.69 ms against 52.06 ms (read-only) and 103.79 ms against 92.97 ms (write-only), which the authors call 10% to 20% higher.

## Critical Analysis

The idea is simple and the duality is elegant. The paper concedes several limits.

- **Weaker consistency.** The guarantee is sequential consistency, not linearizability, and Halfmoon-write may reorder consecutive writes to different objects unless dependencies are made explicit through invocations or extra logging.
- **Coverage.** Halfmoon-read does not support scans, joins or aggregations over mutable tables, transactions reuse existing APIs, and the write log of Halfmoon-read is visible to other SSFs, so private fields need access control or encryption. The design assumes deterministic SSFs, a runtime that re-executes crashes, and treats every external operation as non-idempotent.
- **Failure-free bias.** The protocols are tuned for the common case, and recovery replays more than a symmetric protocol would.

The following points are a reading of the evidence, not claims of the paper.

- **"Log-optimal" is narrow.** It means worst case, one object, a count of abstract logging operations, two stated assumptions, and a guarantee that already gave up real-time order. The authors note that actual cost is implementation-specific. The main text proves Lemma 4.5 in one paragraph, and the TLA+ appendix lists invariants but reports no model-checking run (bounds, states, time).
- **The prototype is not at the bound for writes.** It keeps Boki's double logging on writes and logs at init. That is conservative, but the measured systems show the read side of the bound only.
- **One baseline, one environment.** Boki is the only symmetric competitor, its code base hosts the prototype, and every run uses one AWS setup with DynamoDB. The per-workload split behind "20% to 40%" and "1.5× to 4.0×" is only in Figure 11, and the abstract's "logging overhead" is the overhead above the unsafe baseline in the body.
- **The motivation numbers do not line up.** The introduction says logging costs 30% to 50% over raw operations, while Table 1 gives 33% to 63%. Dividing the table's log latency by the operation latency gives exactly those percentages (1.18 over 1.88 is 63%), so they read as a share of the operation, and no raw latencies are tabulated.
- **Failure evidence is late and partial.** The conference text has no failure-injection run, "far exceeds the actual failure rate" is asserted, and the extended results use only read-only and write-only extremes. Tail latency under failures is worse than Boki's.
- **Choice and switching are lightly tested.** The criterion is per object, but experiments pick one protocol per workload, and the overhead runs target random objects. The two crossovers (0.5 and 2/3) leave a band that needs a weighted cost, which the paper suggests but does not apply, and it describes no policy for deciding when to switch.
- **Garbage collection follows the slowest SSF.** Condition (b) keeps a version until every SSF started before its successor finishes, while the storage model assumes an average lifetime.

## Further Research

- Combining Halfmoon with program analysis and idempotence verification to skip logging for operations that are already safe, which the authors name, such as reads of read-only objects.
- Table-level queries over mutable tables for Halfmoon-read, for example by caching the database index in the logging layer, plus asynchronous checkpointing to speed up replay.
- Automatic per-object protocol selection and switching under real skewed workloads, with failures injected into the end-to-end applications.
- Running it on top of an orchestrator that supplies the retry layer. [Dirigent](/papers/dirigent-lightweight-serverless-orchestration) offers at-least-once only for asynchronous invocations, a pairing of mine that the paper does not make.
