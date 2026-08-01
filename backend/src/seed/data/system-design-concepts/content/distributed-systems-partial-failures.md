---
title: "The Trouble with Distributed Systems: Partial Failures, Clocks, and Pauses"
description: Why a node in a distributed system can never fully trust its own judgment about the current time or its own liveness — unreliable networks, unreliable clocks, and process pauses, and why they all point to the same underlying problem.
difficulty: Intermediate
readingTime: 10
tags:
  - Distributed Systems
  - Fundamentals
  - Fault Tolerance
  - Consistency Models
prerequisites:
  - Basic client-server networking
  - What a network partition is
  - Garbage collection basics
related:
  - CAP Theorem
  - Consensus and Coordination Services
  - Distributed ID Generation
---

## Overview

A program running on a single machine either works or it doesn't — if it crashes, everything stops, and there's no ambiguity about its state. A distributed system doesn't get that luxury: parts of it can fail while other parts keep running, messages can be delayed for an unknown amount of time or lost outright, and a node's own clock and even its own thread scheduler can lie to it about how much time has passed. This is called a *partial failure*, and it's the root cause of almost every distributed-systems bug that doesn't show up in single-node testing.

## Unreliable Networks: You Can't Tell "Slow" from "Dead"

If node A sends a request to node B and gets no response, A cannot tell which of these happened: the request was lost in transit, B is down, B is up but overloaded and hasn't processed it yet, B processed it and its *response* was lost, or B processed it and the response is just slow. TCP guarantees ordered, reliable delivery over one connection, but it does nothing to bound *how long* delivery takes — a switch can silently drop packets, a queue can back up, a firewall can hold a connection open with no traffic on it. The only tool available is a timeout, and every timeout is a guess: too short, and a merely slow node gets declared dead and its work gets duplicated elsewhere; too long, and a genuinely dead node's failure takes that much longer to detect.

## Unreliable Clocks: Two Different Clocks, Two Different Failure Modes

Every machine has (at least) two kinds of clock, and conflating them is a common source of bugs:

- A **time-of-day clock** (`System.currentTimeMillis()`-style) returns wall-clock time synced to NTP — and NTP sync can make it **jump backward** when it corrects for drift. Never use it to measure a duration or order events across machines.
- A **monotonic clock** only ever moves forward, and is safe for measuring elapsed time on one machine — but two different machines' monotonic clocks aren't comparable to each other at all.

Synchronized clocks still drift between sync intervals — commodity NTP over the public internet can be off by tens of milliseconds even when working correctly, and far worse if a sync fails silently. Google's Spanner sidesteps this by not trying to get a single, exact time at all: it uses the **TrueTime API**, which reports a *confidence interval* (`[earliest, latest]`) backed by GPS and atomic clocks in every datacenter, keeping that interval to about 7ms. Two events can be safely ordered only when their intervals don't overlap — and Spanner deliberately waits out the length of the interval before committing a transaction, trading a small amount of latency for a real correctness guarantee instead of hoping a synchronized clock is accurate enough. Other systems have since adopted a similar idea without needing Google's own hardware — YugabyteDB, for instance, can use AWS's open-source ClockBound daemon (paired with EC2's enhanced Amazon Time Sync Service) to get a bounded confidence interval on commodity AWS instances instead of dedicated atomic/GPS clocks.

## Process Pauses: The Lease-Renewal Bug

Say a system elects one leader per shard, and that leader must hold a time-based *lease* to keep accepting writes — it renews the lease before it expires, and stops being leader if the lease lapses. A naive implementation checks "is my lease still valid?" right before processing each request:

```java
while (true) {
    request = getIncomingRequest();
    if (lease.expiryTimeMillis - System.currentTimeMillis() < 10000) {
        lease = lease.renew();
    }
    if (lease.isValid()) {
        process(request);   // <-- what if the thread pauses right here?
    }
}
```

This looks safe — a 10-second buffer should be more than enough time to notice the lease is close to expiring. But it assumes almost no time passes between the check and `process(request)` actually running. If the thread is paused for, say, 15 seconds right at that line — a GC stop-the-world pause, a VM live-migration pause, an OS context switch under load, a page fault triggering swap-to-disk, or even someone's `SIGSTOP`/`Ctrl-Z` — the lease can expire *during* the pause. Another node, seeing no heartbeat, takes over as leader. The original thread wakes up with no idea any time passed at all, and proceeds to process the request as if it were still leader — two nodes now believe they're the leader for the same shard at the same time.

The fix isn't a clever code change; it's accepting that a thread can be preempted for an unbounded, unpredictable amount of time, and building the protocol (fencing tokens that increment on every lease acquisition, checked by anything the leader writes to) so that a "zombie" leader's writes are rejected even if it never notices it stopped being leader.

## Trade-offs

- **A longer timeout reduces false failure detection but slows down genuine failure recovery — there's no value that's simply "correct."**
  ```
  timeout=1s:  a GC pause or slow GC easily triggers a false failover
  timeout=30s: a genuinely dead node's traffic keeps failing for 30s before anyone reacts
  ```
- **Modern GC algorithms (G1, ZGC, Shenandoah) have shrunk typical pause times from "stop-the-world for minutes" (historically) to low milliseconds — but they haven't eliminated the possibility of a long pause**, and a distributed protocol that assumes pauses can't happen will eventually be wrong regardless of how rare the pause is.
- **Fencing tokens fix the specific "zombie leader" bug, but only if every downstream system that accepts the leader's writes actually checks the token** — a lease-based protocol without enforced fencing is not actually safe, it just fails rarely enough that the bug hides during normal testing.

## Interview Questions

- Why can't a node reliably tell the difference between "the network is slow" and "the other node is dead"?
- What's the difference between a monotonic clock and a time-of-day clock, and why does that difference matter for measuring elapsed time?
- Walk through how a GC pause could cause two nodes to both believe they're the leader at the same time.
- What is a fencing token, and what specific failure mode does it prevent that a lease/heartbeat alone doesn't?
- Why does Spanner use a confidence *interval* instead of trying to get an exact synchronized timestamp?

## References

- Martin Kleppmann, [*Designing Data-Intensive Applications*](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/), 2nd Edition (O'Reilly, 2024) — Chapter 9, "The Trouble with Distributed Systems"
- Google Research, ["Spanner: Google's Globally-Distributed Database"](https://research.google/pubs/spanner-googles-globally-distributed-database/) (OSDI 2012) — the TrueTime API
- [AWS — Amazon Time Sync Service](https://docs.aws.amazon.com/AmazonElasticComputeCloud/latest/UserGuide/set-time.html) — current cloud-provider clock-sync guidance
- [Java Platform — Understanding G1 GC pause times](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html)
