---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Describe Chain Replication's head, tail, and middle-node arrangement, and state precisely which node handles writes and which node handles reads.
- Explain why every read reflects every prior committed write under Chain Replication, the same strong consistency guarantee primary-backup replication provides, and identify exactly which node's state a read consults to get it.
- Explain the throughput advantage Chain Replication has over a traditional primary-backup design where a single primary must both apply every write and forward it to every backup.
- Trace what happens to reads and writes when a middle node in the chain fails, and explain why this requires only a local repair (removing one node) rather than the more complex reconfiguration a quorum-based system would need.

## Context & Motivation

The previous concept developed two-phase commit and its blocking weakness for coordinating a transaction across multiple partitions. This concept steps back to a narrower but still fundamental question already touched on in this discipline's opening concept and developed formally in Distributed Systems I: given a single piece of replicated data (not a multi-partition transaction, just one key's replica set), how should reads and writes be routed among the replicas to get both strong consistency and good throughput at the same time? Distributed Systems I develops two classic answers, primary-backup replication (a single primary orders writes and forwards them to backups, and typically also serves reads) and quorum-based replication (writes and reads must each reach some quorum of replicas). Chain Replication, published at OSDI in 2004 by van Renesse and Schneider, is a third, deliberately different answer, and studying it here matters specifically because of what it reveals about a throughput bottleneck the standard primary-backup design has that is easy to overlook: a single primary in that design must personally handle the full write traffic twice over, once to apply each write locally, and once again to forward that same write to every backup, meaning the primary's own capacity, not the total capacity of the whole replica set, caps the system's write throughput.

## Core Theory

### The head, tail, and middle arrangement

Chain Replication arranges a chunk of replicas in a linear chain, rather than a hub arrangement with one central primary talking to every backup independently. The first node in the chain is the **head**, the last node is the **tail**, and every node in between is a **middle node**. The roles are strict and simple: every write is sent to the head, and only the head; every read is sent to the tail, and only the tail.

```mermaid
graph LR
    Client["Client write"] --> Head["Head"]
    Head --> M1["Middle node"]
    M1 --> Tail["Tail"]
    Tail --> ClientRead["Client read<br/>(reads ONLY go here)"]
```

A write arriving at the head is applied there, then forwarded to the next node in the chain, which applies it and forwards it onward, and so on, one hop at a time, until it reaches the tail, which applies it and, critically, is the point at which the write is considered fully committed, the tail sends the acknowledgment back (either directly to the client, or propagated backward through the chain, depending on the specific variant) only after it has itself applied the write.

### Why this gives the same strong consistency as primary-backup, using only the tail

Because every read goes exclusively to the tail, and the tail is, by construction, the very last node to apply any given write (it sits at the end of the chain every write must fully traverse before being acknowledged as committed), a read at the tail is guaranteed to reflect every write that has already been acknowledged as committed, and cannot possibly see a write that has not yet finished propagating all the way through the chain, since such a write would not yet have reached, and been applied by, the tail at all. This is precisely the strong consistency guarantee (every read sees every prior committed write) that primary-backup replication provides, but achieved through a structurally different mechanism, a strict, ordered pipeline through every replica, rather than a single primary independently pushing writes out to backups in parallel and only afterward being confident enough of their receipt to serve a consistent read itself.

### The throughput advantage over primary-backup

In the standard primary-backup design (developed in Distributed Systems I), a single primary must, for every write, apply the write to its own local state, and separately send that same write to every one of its backups, meaning the primary's own outbound bandwidth and processing capacity are consumed once per write times the number of backups, in addition to applying the write itself. As the number of backups grows (to tolerate more simultaneous failures), the primary's per-write workload grows right along with it, the primary is doing strictly more work than any single backup.

Chain Replication's pipeline structure spreads this same total forwarding work across every node in the chain instead of concentrating it at one node: the head forwards to exactly one neighbor (the next node in the chain), that node forwards to exactly one neighbor, and so on, every node in the chain (except the tail, which does not need to forward at all) does the same, small, constant amount of forwarding work, one send to one neighbor, regardless of how long the chain is. This means adding more replicas (to tolerate more failures) does not increase any individual node's per-write forwarding burden the way it would for a primary in the standard design, and the overall write-processing capacity of the system scales more favorably as replicas are added, exactly matching the throughput half of this discipline's opening "throughput versus latency" framing, though not without a real cost: an individual write's end-to-end latency grows with the chain's length, since a write must now hop through every node sequentially before being acknowledged, rather than being sent to every backup in parallel the way primary-backup replication does. Chain Replication is therefore a deliberate trade of somewhat higher per-write latency for substantially higher aggregate write throughput, exactly the kind of explicit, named trade-off this discipline's opening concept argues every system studied here makes on purpose.

### Handling a middle-node failure with only a local repair

When a middle node fails, the chain is repaired by simply splicing it out: the middle node's predecessor in the chain is reconnected directly to the middle node's successor, and forwarding resumes along this now-slightly-shorter chain. Because every node before the failed one has already applied every write it has ever forwarded (a node only forwards a write after applying it locally), and the successor of the failed node is guaranteed to already have every write the failed node had applied and successfully forwarded before failing, this splice does not lose any already-committed data, and does not require anything resembling a full quorum reconfiguration or an explicit new round of agreement about which replicas now constitute the valid set, the fix is entirely local to the two neighbors immediately surrounding the failure. (A head or tail failure requires a small amount of additional handling, promoting the next node in the chain to take over that specific role, but this is still a comparatively simple, local adjustment rather than a full reconfiguration.)

## Worked Examples

### Example 1: tracing a write through a four-node chain

**Problem:** A chain consists of Head, M1, M2, and Tail, in that order. A client writes value `v` for key `k`. Trace every step, and identify the exact moment the write becomes committed.

**Trace:** The client sends the write for `k = v` to Head. Head applies it locally (its own copy of `k` is now `v`) and forwards the write to M1. M1 applies it locally and forwards it to M2. M2 applies it locally and forwards it to Tail. Tail applies it locally, and it is precisely at this moment, once Tail has applied the write, that the write is considered committed; Tail then sends an acknowledgment (directly to the client, or backward through the chain, depending on the implementation) confirming the write is durable. Notice that Head, M1, and M2 all held a version of `k = v` locally before Tail did, but none of those earlier applications is what makes the write committed, only Tail's application is, which is exactly why every future read (always directed to Tail) is guaranteed to see this write once it has been acknowledged.

### Example 2: tracing a read racing a not-yet-fully-propagated write

**Problem:** Using the same chain as Example 1, suppose a write for `k = v2` has been applied by Head and M1, and is in flight toward M2, but has not yet reached Tail, when a client issues a read for `k`. What does the read return, and why is this the correct, consistent answer rather than a stale one?

**Resolution:** Because reads are directed exclusively to Tail, and Tail has not yet received or applied the `k = v2` write (it is still in flight through M2), the read returns Tail's current value for `k`, whatever the previously committed value was, call it `v1`, not the newer, not-yet-committed `v2`. This is the correct, consistent answer, not a stale one, precisely because `v2` has not yet actually been committed (commitment only happens once Tail applies it, per Example 1), so a client reading before that point is not supposed to see it, seeing `v1` here is exactly analogous to a read racing an uncommitted write in any strongly consistent system, the read simply happens before the write's commit point, and correctly reflects the state as of that moment, not a future state that has not yet actually taken effect.

## Common Misconceptions & Pitfalls

- **"Since the head applies a write first, the head is where a write actually becomes committed."** Commitment happens specifically at the tail, the last node in the chain to apply the write, not at the head. A client reading from the tail before a write has propagated all the way there correctly does not see it yet, exactly as Example 2 develops, even though the head (and possibly several middle nodes) may have already applied it locally.
- **"Chain Replication is simply a special case of primary-backup replication, just visualized as a line instead of a star."** The read path is the key structural difference: in primary-backup replication, the primary itself typically serves reads directly from its own state; in Chain Replication, reads are served exclusively by the tail, a different, dedicated node from the one (the head) that receives writes, and it is specifically this separation, plus the pipelined, one-neighbor-at-a-time forwarding, that produces Chain Replication's throughput advantage over a primary that must personally forward every write to every backup.
- **"A longer chain (more replicas) always makes the system strictly better, since it tolerates more failures with no real downside."** A longer chain does tolerate more simultaneous failures, but at the direct cost of higher per-write latency, since a write must now traverse more sequential hops before reaching the tail and being acknowledged as committed; this is the concrete instance, named explicitly in the Core Theory section, of the throughput-versus-latency trade-off this discipline's opening concept identifies as a choice every system here makes deliberately, not a free improvement with no corresponding cost.

## Summary

Chain Replication arranges replicas in a strict linear chain: writes enter only at the head and are applied and forwarded, one node at a time, until reaching the tail, which is the sole point of commitment and the sole node reads are ever directed to. This gives the same strong consistency guarantee as primary-backup replication (every read reflects every prior committed write), because the tail, by construction, is always the last node any write reaches, but it spreads the per-write forwarding workload evenly across every node in the chain rather than concentrating it entirely at a single primary, giving substantially better aggregate write throughput as more replicas are added, at the direct cost of higher per-write latency from the sequential, hop-by-hop propagation. A middle node's failure requires only a small, local splice, reconnecting its immediate neighbors, rather than a full quorum reconfiguration, since every node before the failure point has already durably applied and forwarded every write it will ever be asked about. The next concept studies Spanner, which builds cross-shard transactions directly on top of the two-phase-commit structure from the previous concept, while replicating each shard's own coordinator using a Paxos-based group specifically to address that protocol's blocking weakness.

## Documentation Links

- [van Renesse, Schneider: Chain Replication for Supporting High Throughput and Availability (OSDI 2004)](https://www.usenix.org/legacy/event/osdi04/tech/full_papers/renesse/renesse.pdf): doc
