---
title: "Session Guarantees for Weakly Consistent Replicated Data"
summary: Terry and colleagues at Xerox PARC propose four per-session guarantees (Read Your Writes, Monotonic Reads, Writes Follow Reads, Monotonic Writes) that give an application a view of a read-any/write-any replicated database consistent with its own actions, and show how to enforce them with a session manager and version vectors.
researchArea: Distributed Systems
keywords: session guarantees, weak consistency, eventual consistency, read your writes, monotonic reads, version vectors, Bayou
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Four per-session guarantees are proposed to aid users and applications of weakly consistent replicated data: Read Your Writes, Monotonic Reads, Writes Follow Reads, and Monotonic Writes. The intent is to present individual applications with a view of the database that is consistent with their own actions, even if they read and write from various, potentially inconsistent servers. The guarantees can be layered on existing systems that employ a read-any/write-any replication scheme while retaining the principal benefits of such a scheme, namely high-availability, simplicity, scalability, and support for disconnected operation. These session guarantees were developed in the context of the Bayou project at Xerox PARC in which we are designing and building a replicated storage system to support the needs of mobile computing users who may be only intermittently connected.

## Overview

This 1994 paper (PDIS, pages 140 to 149 per Crossref; the open copy has 10 pages) comes from the design of Bayou, a replicated store for mobile and intermittently connected users. In a weakly consistent system, updates spread lazily and a client may read from any server. The paper's key observation is that inconsistency shows up even when a single client is the only writer: write at one server, read at another that has not yet heard of the write, and your own update seems to be missing. The paper cites Grapevine, where a user could change a password and then be told it was invalid.

The fix keeps the weak-consistency architecture. Strong consistency would need coordination that disconnected or distant replicas cannot offer, which is the availability side of the trade-off later formalized as [CAP](/papers/brewers-conjecture-cap-feasibility-web-services). The paper instead restricts, per session, which servers an operation may use. The target semantics are those of a single centralized server (the strong end that [linearizability](/papers/linearizability-correctness-condition-concurrent-objects) formalizes), but only as seen by one application.

Worth knowing first: eventual consistency, anti-entropy (pairwise exchange of writes between servers), logical clocks as in [Lamport's paper](/papers/lamport-time-clocks-ordering-of-events), and the read-any/write-any scheme that [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) later made familiar.

## Contribution

- **The session abstraction.** A session is the sequence of reads and writes of an application. It is not a transaction and gives no atomicity or serializability. Each guarantee can be requested independently per session.
- **Four guarantees**, defined over DB(S,t), the ordered sequence of writes server S has received by time t, and over a predicate WriteOrder(W1,W2) that orders writes the same way at every server.
  - Read Your Writes: if read R follows write W in a session and R runs at server S at time t, then W is in DB(S,t).
  - Monotonic Reads: if R1 precedes R2, then RelevantWrites(S1,t1,R1) is a subset of DB(S2,t2). RelevantWrites is the smallest set of writes that determines the result of a read.
  - Writes Follow Reads: if R1 precedes W2 and W2 is in DB(S2), then every relevant write of R1 is also in DB(S2) and ordered before W2.
  - Monotonic Writes: if W1 precedes W2 and W2 is in DB(S2), then W1 is in DB(S2) and ordered before W2.
- **Relaxed variants** of Writes Follow Reads, WFRO (only order) and WFRP (only propagation), for applications that need just one half.
- **An implementation** with a client-side session manager and version vectors, plus a sketch of adding the guarantees to Coda.

## Methodology

This is a design paper with definitions, examples and an argument, not an experimental one. Section 2 states the model: full copies at servers, globally unique write identifiers (WIDs), anti-entropy, and a consistent write order, without fixing how conflicts are resolved. Section 3 defines each guarantee and gives nine examples (passwords, mail, calendars, a bibliography database, a bulletin board, a text editor, source code). Sections 4 and 5 give the enforcement algorithm, first with sets of WIDs and then with version vectors. Section 6 examines Coda, and Section 7 compares related work.

The session manager keeps two sets: the WIDs of the session's writes (write-set) and of the writes relevant to its reads (read-set). Before an operation, it finds a server whose database contains the needed set, or reports that the guarantee cannot be met. Table 1 gives which operation updates and which checks the state: RYW updates on write and checks on read, MR updates and checks on read, WFR updates on read and checks on write, MW updates and checks on write.

## Findings

These are the claims the paper makes; there are no measurements.

- **Version vectors make the state small.** A version vector is a list of server and clock pairs, and a pair serves as a WID. A set of WIDs becomes a vector, union becomes per-server maximum, and the subset test becomes dominance. The state of a whole session compacts to two vectors, and Figure 1 shows the Read and Write procedures in a few lines.
- **Two server constraints are needed for the write-side guarantees.** C1: a new write is ordered after writes the server already knows. C2: anti-entropy that propagates W2 also propagates every write ordered before it. The paper says Coda meets C2 and Grapevine does not, because it propagates updates by mail that can be reordered.
- **Vector checks can be cheap.** Checks can be skipped while the session stays on one server, and cached server vectors are safe lower bounds. A server may return its whole current vector as a coarse estimate of relevant writes, which is correct but conservative.
- **Monotonic Writes is not implied by the others.** In a session W1 R W2, a foreign write Wx can overwrite W1, so W1 is missing from the relevant writes of R and the ordering is lost.
- **Coda needs only client changes** for Read Your Writes and Monotonic Reads, since its servers already export version vectors.
- **Availability is the stated cost.** The paper expects the impact to be small, especially with local caching, but gives no data.

## Critical Analysis

The definitions are precise and the examples are well chosen, and they name anomalies that engineers still meet. The limits are the paper's own.

- **No evaluation.** There are no benchmarks, simulations or traces. The Bayou implementation is described as "currently underway", and the effect on availability is an expectation.
- **Per session, not global.** The guarantees constrain one application's view. They do not give atomic multi-write updates, serializability or isolation between concurrent applications, which the paper calls orthogonal. Conflict handling is also left open.
- **Costs the paper itself names.** A guarantee can make some servers unusable, so an operation may fail; an application with no guarantees can fill a shared client cache with old data that a stricter application then cannot read. Sessions that must outlive logouts need durable session state.
- **The set is not claimed complete,** and RelevantWrites is hard to compute for rich queries, hence the coarse vector fallback.
- **Later literature (not read for this entry; based on the catalog analyses).** [Vogels's essay](/papers/eventually-consistent-vogels) lists read-your-writes, session, monotonic reads and monotonic writes as client-side consistency models. The analysis of [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) classifies Writes Follow Reads, Monotonic Reads and Monotonic Writes as highly available and Read Your Writes as only sticky available. The [COPS](/papers/dont-settle-for-eventual-scalable-causal-consistency-cops) analysis notes that earlier systems such as Bayou were in fact causal+ but not scalable. I did not check how closely these papers rely on this one.

## Further Research

- Measuring the availability cost under partitions, server churn and realistic session lengths, which the paper leaves open.
- Cheaper ways to name the relevant writes of complex queries than returning the whole vector.
- Session guarantees combined with convergent data types such as [CRDTs](/papers/conflict-free-replicated-data-types), where conflict resolution is part of the object.
- Trade-off framings, such as [PACELC](/papers/consistency-tradeoffs-in-modern-distributed-database-system-design), that put the latency and availability price of each guarantee on one scale.
- Guarantees across several services rather than one store, as in [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications) (a later work whose catalog entry says its wait operation must offer at least monotonic reads).
