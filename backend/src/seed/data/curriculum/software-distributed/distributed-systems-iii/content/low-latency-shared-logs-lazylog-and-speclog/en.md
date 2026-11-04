---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Separate three moments that an eager shared log's interface presents as one (the record is durable, it has a position, a consumer may use it), and say which moment LazyLog and SpecLog each move.
- Explain why uncoordinated writes to every sequencing replica still contain a linearizable order, and why the `stable-gp` rule keeps that order from changing after a crash.
- Keep three names apart (SpecLog the abstraction, fix-ante ordering the mechanism, Belfast the system) and compute a shard's predicted positions from predetermined cuts.
- State what each design costs, and the conditions behind its reported numbers.

## Context & Motivation

`scaling-shared-logs-fuzzylog-and-scalog` showed how shards that report in batches let a log scale, and `stateful-serverless-on-shared-logs-boki-and-flexlog` built applications on that design. The price is waiting: a record sits through replication, a batch, and a global cut before anything happens to it.

Two later papers with overlapping authors attack that wait from opposite ends. [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications) (SOSP 2024) serves writers that want a fast acknowledgment. [SpecLog](/papers/speclog-low-latency-speculative-shared-log-fix-ante-ordering) (OSDI 2025) serves consumers that want records early. Neither removes ordering. Each moves it to where one kind of application does not have to wait for it.

## Core Theory

### Three moments, and who moves what

```text
              ack to writer     consumer gets record    consumer may act
Scalog        after global cut  after global cut        after compute
LazyLog       before any order  after order is stable   after compute
SpecLog       after global cut  once durable, predicted after confirmation
```

### LazyLog: acknowledge before the position exists

In LazyLog, `append` makes a record durable and promises it will later be bound to its linearizable position. It returns a success flag, not a position. Binding is enforced before a position can be read, so readers still see one linearizable sequence. The paper's bet is that applications such as databases with decoupled readers, journals and activity logging need the order when they consume, and that their readers run behind their writers. It argues this from how those applications work, not from measured read lag.

Clients write in parallel to all sequencing replicas (usually f + 1 to tolerate f failures), with no coordination among them, and the append completes in one round trip. The order survives because of `linearizability-a-rigorous-definition`'s real-time condition: if `b` starts after `a` completes, `a` is already on every replica, so `b` lands after `a` in every log. Only concurrent appends can differ, and any order among them is legal. Any single replica's log is therefore a valid order. The leader's is used normally, and a survivor's after a crash.

In the background, the leader assigns positions from `last-ordered-gp + 1` and pushes records to shards. Once shards hold them, every sequencing replica garbage collects them and advances `last-ordered-gp`. Only then does `stable-gp` advance. Shards serve reads only up to `stable-gp`, and a read beyond it waits, which the paper calls the slow path.

Two systems implement it. Erwin-■ treats shards as black boxes, so all data passes through the sequencing layer: about 1M appends/s with 100-byte records, flattening with larger ones. Erwin-st sends only metadata there and writes data directly to modified shards: about 700K appends/s with 4KB records on 10 shards.

### What LazyLog costs

- **Writing to all replicas.** Any sequencing replica failure forces a reconfiguration, and stragglers raise tail latency.
- **Scale.** Erwin-st scales like Corfu, not like Scalog.
- **Reading right behind writing.** Replicated state machines over a log, the pattern from `the-shared-log-abstraction-corfu-tango-and-vcorfu`, read to the tail just after appending, so they pay on the read path.

The append gain, up to 3.8× below Corfu at equal throughput with 4KB records, fits the round-trip count: 1 against Corfu's 4 with three replicas. Reads lagging by 3 ms stay close to Corfu. With no lag, 45K operations/s still gives batches large enough to keep reads only slightly slower, but at 5K almost all reads take the slow path, above Corfu's 70 µs append cost. The authors attribute that excess to tuning for large batches. The two orders of magnitude over Scalog compare against its public artifact, which uses gRPC where Erwin uses eRPC, and the authors accept that a better Scalog would have lower absolute latencies.

### SpecLog, fix-ante ordering, Belfast

**SpecLog is the abstraction.** `deliver(r, pos, is_spec)` hands a record over with a flag saying its position is a prediction, and `confirm_spec(k)` or `fail_spec(k)` follows. Consumers compute at once, hold external outputs until confirmation, and roll back on failure, so computation overlaps coordination. Appends are still acknowledged only after the actual cut. Acknowledging earlier would break linearizability, because a later append on another shard could take a lower position.

**Fix-ante ordering is the mechanism.** In Scalog a shard may report as many records as it likes, so no other shard can know where its own records will land. Fix-ante ordering replaces this free will with predetermined cuts, which give each shard a quota per cut. A shard short of records adds no-ops, and a shard with extra records delays them. Actual cuts still follow durability. They match the predictions as long as quotas are met.

**Belfast is the system.** It sets quotas from ingestion rates. Its lag fix asks lagging shards for extra reports during a burst. Speculation lease windows of W cuts confine quota and membership changes to window boundaries, so all shards predict from the same cuts. Fix-ante ordering also has a cost that Scalog does not: the sequencer holds a cut until every shard with a quota reports, so Belfast gives stragglers a zero quota. When a whole shard fails, the speculation fails and consumers recompute.

Belfast's headline result is measured against a Scalog changed so that only the primary reports, with 4KB records and 1.5 ms of compute, on 2 and 4 shards: delivery 3.2× to 3.5× earlier, and average end-to-end latency 1.6× lower. At p99 the gain is 1.4× and 1.17×. Append overhead is 5.8% with 10 shards.

## Worked Examples

### Example 1: a linearizable order inside three disagreeing logs

These times are invented, not from the paper, and chosen to produce the disagreement in its Figure 4.

```text
Append  start  done   (client waits for all 3 replicas, in µs)
a       0      24
b       40     72
c       41     69

Arrival order with per-replica network delays:
L  (leader) a c b
F1          a b c
F2          a b c

a completes (24) before b and c start: a precedes both in all logs.
b and c overlap: L disagrees with F1 and F2, which is legal.
```

Every log respects the only real-time constraints there are, so each is a valid order.

### Example 2: why `stable-gp` waits for garbage collection

Positions 1 to 3 are stable. The leader pushes `4:a, 5:c, 6:b` to shards, then crashes, and F1 flushes its own log from position 4.

```text
Broken rule, stable-gp = 6 before followers GC:
  reader saw   4:a 5:c 6:b
  after F1     4:a 5:b 6:c   conflict at positions 5 and 6
Correct rule, stable-gp stays 3 until followers GC:
  reader saw   nothing above 3 (it waits)
  after F1     4:a 5:b 6:c   overwrite is safe
```

An order must be permanent before it is exposed.

### Example 3: fix-ante positions

Quotas are 2, 3 and 2, so the predetermined cuts are ⟨2,3,2⟩, ⟨4,6,4⟩, ⟨6,9,6⟩. Positions run lexicographically by shard.

```text
Cut 1:  S1 [1,2]    S2 [3,4,5]     S3 [6,7]
Cut 2:  S1 [8,9]    S2 [10,11,12]  S3 [13,14]

Free will: S2 expects 8,9 for S1 and predicts 10.
           S1 reports 3 records. S2's record lands at 11. Wrong.

Fix-ante, second report, with 3, 2, 1 records received:
  S1 sends 2, delays 1     S2 sends 2, needs 1 more
  S3 sends 1, adds 1 no-op
```

S2's next record is at 10 regardless of what S1 received. If nothing arrives for its third slot, S2 also fills it with a no-op.

### Example 4: why the gain has a peak

A simple model, not from the paper, with invented latencies: durable at 0.6 ms, actual cut 1.5 ms later. Scalog finishes at `0.6 + 1.5 + c`. A speculative consumer finishes at `max(0.6 + c, 2.1)`, because it must wait for confirmation.

```text
compute c (ms)   0.5   1.0   1.5   2.0   4.0   50
Scalog           2.6   3.1   3.6   4.1   6.1   52.1
speculative      2.1   2.1   2.1   2.6   4.6   50.6
gain             1.24  1.48  1.71  1.58  1.33  1.03
```

The peak sits where compute equals the ordering delay. Below it, the consumer waits for confirmation. Above it, ordering is a small share of the total. Belfast's measured curve has the same shape: 1.17× at 0.5 ms, 1.63× at 1.5 ms, 1.3× at 4 ms, approaching 1 at 50 ms.

## Common Misconceptions & Pitfalls

- **"LazyLog orders records at read time."** Ordering runs in the background, so that it is usually done before a read arrives. A read waits only if it overtakes `stable-gp`.
- **"LazyLog weakens the shared log."** Readers get the same linearizable total order. What changes is that `append` no longer returns a position.
- **"SpecLog consumers act on a speculative order."** They compute on it. Anything visible outside must wait for `confirm_spec`, so speculation hides ordering rather than removing it.
- **"Fix-ante means order comes before durability."** Shards predict, and the sequencing layer still decides after durability.
- **"SpecLog is 1.6× faster."** That number belongs to Belfast, at one compute time near the peak of the curve.

## Summary

An eager shared log holds a record back until it is durable and positioned: the append then returns its position, and consumers can get it. LazyLog separates acknowledgment from position, relying on the fact that real-time order is already implied by writes to all replicas, and it uses `stable-gp` so that no reader sees an order that could change. It pays when readers catch up with writers. SpecLog separates consumption from confirmation: fix-ante ordering makes positions predictable, and Belfast keeps predictions right under bursts and membership changes. It pays with quota waiting, and its gain is bounded by the moment confirmation arrives. In both, the ordering work still happens, and only its place on the timeline changes.

## Documentation Links

- [Luo et al.: LazyLog: A New Shared Log Abstraction for Low-Latency Applications (SOSP 2024)](https://dassl-uiuc.github.io/pdfs/papers/lazylog.pdf): the abstraction, Erwin-■ and Erwin-st, `stable-gp`, and the evaluation against Corfu and Scalog.
- [Bhat et al.: Low End-to-End Latency atop a Speculative Shared Log with Fix-Ante Ordering (OSDI 2025)](https://dassl-uiuc.github.io/pdfs/papers/speclog.pdf): the SpecLog interface, fix-ante ordering, and Belfast's design and evaluation.
- [Ding et al.: Scalog: Seamless Reconfiguration and Total Order in a Scalable Shared Log (NSDI 2020)](https://www.usenix.org/system/files/nsdi20-paper-ding.pdf): the durability-first design both papers react to.
