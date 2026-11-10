---
title: "Antipode: Enforcing Cross-Service Causal Consistency in Distributed Applications"
summary: Antipode tracks the datastore writes that one user request causes across services, as a lineage, and lets developers place barrier calls that wait until those writes are visible, so a reader in another region cannot see a notification before the post it points to.
researchArea: Distributed Systems
keywords: cross-service consistency, causal consistency, lineage, microservices, bolt-on, barrier, geo-replication
version: 1.0
updatedAt: 2026-11-07
---

## Overview

In a microservice application one user request writes to several datastores, for example a post store and a notification queue. Each datastore is correct on its own and replicates on its own schedule. The request implies a visibility order (the post should be readable once its notification is), but the datastores are mutually oblivious, so nothing enforces it. A follower in another region can be notified of a post that has not arrived there yet and read "object not found". The authors call this a cross-service inconsistency and point to a Facebook account of the same problem.

This SOSP 2023 paper (Koblenz) comes from INESC-ID, Instituto Superior Técnico, Universidade de Lisboa, plus Jonathan Mace of the Max Planck Institute for Software Systems and Microsoft Research. To show the setting is common, the authors analyze a public Alibaba trace and report more than 17k microservices, over 80% of them stateful, with more than half of requests calling five or more distinct stateful services.

Four terms carry the paper. **XCY** is a cross-service causal consistency model. A **lineage** is the set of dependent operations that stem from one request. A **barrier** is the call that blocks until a lineage's writes are visible. A **shim layer** wraps a datastore so lineages travel with the data. Antipode is the library built from them.

Worth knowing first: Lamport's happened-before and causal memory, distributed tracing with context propagation (OpenTelemetry), and eventual consistency in geo-replicated stores. The paper cites [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) among causal consistency systems that shrink metadata and enforce visibility at reads or writes. For the strongly consistent coordination the authors argue against, [Spanner](/papers/spanner-globally-distributed-database) is a useful contrast (the paper does not cite it).

## Contribution

- **XCY.** An operation a precedes b if a happened before b, if b reads a value written by an operation of the same lineage as a, or by transitivity. The second rule makes XCY stronger than Lamport's causality: reading a write creates a dependency on the whole lineage of that write, not only on the write.
- **Lineages as write identifiers.** A lineage is a set of identifiers, each naming a write to a datastore. It travels with requests by piggybacking on existing context propagation (OpenTelemetry baggage), and inside datastores because the shim stores it next to the value. The datastore must expose versioned keys, which the authors say many already do or can be extended to do.
- **Explicit enforcement with `barrier`.** Instead of checking dependencies on every read or write, the developer places `barrier(L)`, which asks each datastore's `wait` to block until the write is visible. The placement decides who pays for the delay. Variants add a timeout and an asynchronous callback, and an optimization waits only for replicas near the caller.
- **Limiting dependency growth.** A lineage is dropped when the request ends. The developer can `append` or `remove` dependencies, and `transfer` carries one lineage's set into another, as when blocking a user in an access control list must precede that user's notification. The authors admit this weakens XCY's transitivity rule by design.
- **Bolt-on deployment.** Antipode is an application-level library plus shims. It needs no datastore changes and works with any consistency level as long as `wait` offers at least monotonic reads. A dry-run mode shows which lineages a barrier would have had to wait for.

## Methodology

Three benchmarks, each with one inconsistency the authors identified. Post-Notification is a serverless application on AWS Lambda over off-the-shelf geo-replicated stores (MySQL, DynamoDB, Redis, S3 for posts, and SNS, AMQ, DynamoDB for notifications), with 1000 posts written in Frankfurt and notifications read in the US. DeathStarBench (social network, more than 30 microservices) was extended by the authors with geo-replication logic and runs on Google Cloud replicating from East US to Frankfurt or Singapore. TrainTicket (more than 40 Java services, no replication) is checked for a ticket cancellation whose refund can lag.

For DeathStarBench and TrainTicket, clients ran 5 minutes in open loop (50 to 150 requests per second for DeathStarBench), and each experiment was repeated 15 times and averaged. The authors measure violations, throughput and latency, and a consistency window, the time between a write and the read that must see it. Shims exist for eight datastores: MySQL, DynamoDB, Redis, S3, SNS, AMQ, MongoDB and RabbitMQ.

## Findings

These are the authors' reported results.

- **Violations are real.** In Post-Notification (Table 1) with SNS as notifier, the authors observed inconsistencies in 88% to 100% of cases. With AMQ it was 7% to 13%, except 100% with S3. With DynamoDB as notifier it was 0%, except 13% with S3. DeathStarBench showed 0.1% for East US to Frankfurt and 34% to Singapore (standard deviation 42%). TrainTicket showed 0.57%.
- **Antipode removed them.** In every benchmark the inconsistency was always corrected.
- **Low effort.** Post-Notification changed under 20 lines, DeathStarBench under 350 and TrainTicket 10. No shim exceeded 50 lines, and the core API is 250 lines of C++, 175 of Java and 40 of Python.
- **Small metadata.** Lineages stayed under 200 bytes in all experiments. A worst-case estimate from the Alibaba dataset gives under 1 KB for 99% of requests and about 200 bytes on average. Object size grew by under 200 bytes in most stores, and by 14 kB (1.5%) in MySQL, which the authors attribute to the new column and index (Table 3 also lists 320 bytes for S3).
- **DeathStarBench cost.** At most 2% throughput penalty. The barrier sat on the reader side, off the writer's path, and stretched the consistency window by up to 2 ms (Frankfurt) and 6 ms (Singapore) at peak throughput.
- **TrainTicket cost.** The barrier had to sit on the critical path, costing just over 15% throughput and 17% latency (about 4 ms).
- **Post-Notification cost.** The window grows by replication delay. After a 50 s artificial delay S3 still showed 20% violations, and the barrier waited about 18 s on average for S3.

## Critical Analysis

The idea is a good compromise between full causal tracking and hand-written checks. The paper concedes several limits.

- **Prevention depends on developers.** Barriers are placed by hand, so unplaced ones leave violations. The authors suggest foreign-key-like links between schemas as hints and the dry-run mode as a testing aid.
- **Truncation is a trade.** By default dependency chains stop at the lineage end, so only `transfer` restores full XCY.
- **Waiting is user-visible when placed on the critical path.** TrainTicket pays 17% latency, and the developer decides whether to expose it.

The following points are a reading of the evidence, not claims of the paper.

- **The abstract's cost claim does not match the body.** The abstract says less than 2% impact on latency and throughput, but only DeathStarBench stays at 2%. TrainTicket shows 15% and 17%. Likewise the introduction says "merely tens of LoC", while DeathStarBench took under 350 (shims for two datastores included). The body figures are the ones to use.
- **Correctness is shown on three known cases.** The authors chose both the violation and the barrier location, and success means the "not found" error disappears. Whether Antipode helps find unknown violations is not evaluated, nor is the dry-run mode. The appendix gives the system model and lineage definition, with no proof that the library enforces XCY.
- **Failures and scale are untested.** Fault tolerance is delegated to the datastore, and no run injects a failure or a partitioned replica, tests the timeout variant, or reports barrier cost as a lineage touches more datastores. Metadata size at Alibaba scale is a trace computation, not a deployment.
- **Rates depend on the setup.** Posts of 400 KB to 1 MB against 120 byte notifications favor a race, and the authors wrote DeathStarBench's replication logic. The 34% Singapore figure comes with a "likely" explanation about MongoDB, not a test.
- **No quantitative comparison.** Related work (FlightTracker, sagas, coordination) is discussed in prose only. A hand-written check in the notifier, which the paper dismisses as a straw man, is not measured.

## Further Research

- Placing barriers automatically or semi-automatically, using schema relationships and the dry-run mode, and checking how well that finds violations developers have not noticed.
- Behavior under failures: timeouts, lagging or partitioned replicas, and what a barrier should do then.
- Measuring what default truncation gives up, by comparing the dependencies kept with the full XCY set on traces such as Alibaba's.
- Inconsistencies like TrainTicket's, caused by unordered asynchronous tasks and not by replication races, as a separate class that barriers handle only on the critical path.
