---
title: "Zanzibar: Google's Consistent, Global Authorization System"
summary: Zanzibar stores access control lists as relation tuples in Spanner and answers authorization checks for Google services with external consistency, using a client-held consistency token (the zookie) so most checks run on locally replicated data.
researchArea: Distributed Systems
keywords: authorization, access control lists, relation tuples, external consistency, zookie, new enemy problem, Spanner
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Determining whether online users are authorized to access digital objects is central to preserving privacy. This paper presents the design, implementation, and deployment of Zanzibar, a global system for storing and evaluating access control lists. Zanzibar provides a uniform data model and configuration language for expressing a wide range of access control policies from hundreds of client services at Google, including Calendar, Cloud, Drive, Maps, Photos, and YouTube. Its authorization decisions respect causal ordering of user actions and thus provide external consistency amid changes to access control lists and object contents. Zanzibar scales to trillions of access control lists and millions of authorization requests per second to support services used by billions of people. It has maintained 95th-percentile latency of less than 10 milliseconds and availability of greater than 99.999% over 3 years of production use.

## Overview

Every service that shares objects needs to answer "may user U do R on object O?" before it responds. This ATC 2019 paper, by authors at Google (two later at Humu and Carbon, work done while at Google), argues for answering it once, in a shared system, instead of in each application. The paper gives four reasons: consistent semantics, interoperability when one application embeds another's objects, shared infrastructure such as an access-aware search index, and the fact that consistency and scale are hard enough to solve only once.

The hard part is not the lookup but the ordering. If a user is removed from a folder and new documents are added afterwards, a check that sees an old copy of the ACL can expose them. Zanzibar therefore builds on [Spanner](/papers/spanner-globally-distributed-database) and its TrueTime-based external consistency, which yields [linearizable](/papers/linearizability-correctness-condition-concurrent-objects) commit timestamps. The related-work section explains why it does not use [Lamport clocks](/papers/lamport-time-clocks-ordering-of-events): they need every "process" to participate, and here some are external clients or even human users. It also contrasts it with [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems), and with TAO, Facebook's social-graph store.

Worth knowing first: what an ACL is, what a snapshot read at a timestamp means in a multi-version database, and why tail latency matters when one search result page needs tens to hundreds of checks.

## Contribution

The authors say most of the design has roots in earlier research; the contribution is a record of the techniques combined to meet five goals (correctness, flexibility, low latency, high availability, large scale).

- **Data model.** ACLs are relation tuples in the text form `object#relation@user`, where an object is `namespace:object id` and the user is either a user id or a userset `object#relation`. A userset lets a tuple point at another ACL, so groups are just ACLs whose relation means member, and nesting is natural. The primary key is namespace, object id, relation and user.
- **Namespace configuration.** Each namespace declares its relations and storage parameters. A relation may carry a userset rewrite rule, an expression tree whose leaves are `this`, `computed_userset` (for example viewer includes editor) and `tuple_to_userset` (for example inherit the viewers of the parent folder), combined with union, intersection and exclusion.
- **API.** Read returns stored tuples only, without applying rewrite rules. Write modifies tuples, with an optimistic-concurrency recipe built on a client-visible "lock" tuple. Watch streams tuple changes in timestamp order. Check evaluates a userset against a user, and Expand returns the effective userset as a tree.
- **Consistency protocol.** Every ACL write gets a Spanner timestamp. When content is about to change, a content-change check is evaluated at the latest snapshot and returns a zookie, an opaque token encoding a timestamp. The client stores it with the content and sends it on later checks, which are evaluated at a snapshot at least that fresh. This blocks the "new enemy" problem (two examples: ignoring the order of ACL updates, and applying an old ACL to new content).
- **Serving techniques.** Default staleness chosen from measured out-of-zone reads, timestamp quantization to one or ten seconds so caches can share results, a distributed cache with consistent hashing and a lock table against cache stampedes, request hedging toward Spanner and Leopard, per-client isolation, and Leopard, a set index for deeply nested groups.

## Methodology

This is an experience paper, not a controlled experiment. The numbers come from Google's production traffic. Latency is measured server-side on live traffic, because the authors say caching and de-duplication make it realistic only that way. Availability is measured with probers that replay sampled live requests (3 per cluster), counting only "qualified" RPCs (well-formed, deadline above the threshold, client within quota) answered within 5 seconds for Safe and 15 seconds for Recent requests, aggregated over 90-day windows. The load, latency and cache figures cover a 7-day sample in December 2018. Requests are split by zookie age: Safe zookies are more than 10 seconds old (storage replicates with 8-second heartbeats), Recent ones are newer.

## Findings

These are the figures the paper reports.

- **Scale.** More than 1,500 namespaces from hundreds of client applications, with config files from tens of lines to thousands (median near 500). More than 2 trillion tuples in close to 100 TB, median 15,000 tuples per namespace, replicated in more than 30 locations, served by more than 10,000 servers in several dozen clusters. The 5 voting replicas are in the eastern and central United States, within 25 ms of each other.
- **Load.** More than 10 million client queries per second. Peaks in the sample week: Check about 4.2M QPS, Read 8.2M, Expand 760K, Write 25K, so reads outnumber writes by two orders of magnitude. Safe checks are about two orders of magnitude more frequent than Recent ones.
- **Latency (Table 2, median / 95th / 99th, ms).** Check Safe 3.0 / 9.46 / 15.0; Read Safe 2.18 / 3.71 / 8.03; Expand Safe 4.27 / 8.84 / 34.1. Check Recent 2.86 / 60.0 / 76.3; Read Recent 2.21 / 40.1 / 86.2; Expand Recent 5.79 / 45.6 / 121.0. Write 127 / 233 / 401. For Check Safe over the week the 99.9th percentile peaks at roughly 93 ms.
- **Availability.** Above 99.999% over 3 years: under 2 minutes of global downtime per quarter and under 13 minutes with the global error ratio above 10%.
- **Hot spots.** The paper calls them the most critical frontier for latency and availability. At peak there are 22 million delegated internal RPCs per second and about 200 million cache lookups per second (150M from checks, 50M from reads). Check hit rates look low (10% plus 12% from the lock table on the callee, 2% plus 3% on the caller) yet prevent 500K internal RPCs per second from creating hot spots. Spanner receives 20 million read RPCs per second, and 1% of Spanner reads (200K per second) benefit from hedging.
- **Leopard.** 1.56M QPS at the median and 2.22M at the 99th percentile, answering in under 150 microseconds at the median and under 1 ms at the 99th. Its incremental layer absorbs about 500 updates per second at the median and 1.5K at the 99th.

## Critical Analysis

What the paper itself states: the design is mostly a combination of known ideas, hedging is deliberately not used between Zanzibar servers (it would duplicate the most expensive checks), and Leopard denormalizes only for selected namespaces, since the system otherwise keeps normalized data for consistency.

What the paper does not say or measure, as a reading of the evidence:

- **No quantified benefit of the protocol.** There is no count of how often the "new enemy" would occur without zookies, and no baseline system or ablation (no run without caches, hedging, Leopard or quantization). The reader gets operating statistics, not causal evidence for each mechanism.
- **Client discipline is part of the guarantee.** The protection holds only if every client asks for a content-change check, stores the zookie atomically with its content and sends it back. Zanzibar cannot enforce this, and the paper does not say how many clients get it wrong.
- **Recent requests are costly.** Their 95th percentile is 40 to 60 ms against under 10 ms for Safe, and writes take 127 ms at the median. The design pays off because most traffic is Safe, which is a workload property.
- **Hard to reproduce.** It depends on Google's internal Spanner (the authors note it is not Cloud Spanner), TrueTime, Slicer and Google-scale operations. Availability is also measured by replaying sampled requests and excluding unqualified RPCs, which is a defensible definition but not end-user availability.
- **Scope.** The paper never mentions ABAC or ReBAC. It cites RBAC and says several clients implement RBAC policies on its namespace configuration, and it describes no attribute or condition language. Authentication is left out: the user in a check is "often represented by an authentication token". It describes no code release.

## Further Research

- In this app, the lesson [Authorization Models: RBAC, ABAC, ReBAC and Policy Engines](/identity-concepts/authorization-models-rbac-abac-rebac-and-policy-engines) places relationship-based authorization among the other models. Zanzibar is the reference design for the relationship-based family.
- Later literature, not part of the paper. Open-source systems describe themselves as following it: [SpiceDB](https://authzed.com/docs/spicedb/concepts/zanzibar) says it is "based on Google Zanzibar", the [OpenFGA README](https://github.com/openfga/openfga) says it is "inspired by Google Zanzibar", and the [Ory Keto documentation](https://www.ory.sh/docs/keto) calls Keto the first open-source implementation of its design principles. These are the projects' own claims, and the paper makes no statement about any of them, so check each project's own consistency and caching behavior before assuming the zookie guarantees carry over.
- Which parts need Spanner? An open question is how much of the "new enemy" protection survives on databases without TrueTime-style external consistency.
- How should conditions on tuples (attributes, expiry) combine with the tuple model without breaking snapshot-consistent caching, since the paper has no such feature?
