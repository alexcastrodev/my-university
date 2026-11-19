---
title: "Life beyond Distributed Transactions: an Apostate's Opinion"
summary: Helland argues, as a position paper, that very large applications are built around uniquely keyed entities that fit on one machine, with atomic transactions only inside an entity and at-least-once messages between entities, so that agreement across entities is handled as fine-grained workflow in the business logic.
researchArea: Distributed Systems
keywords: entities, scale-agnostic applications, almost-infinite scaling, distributed transactions, idempotence, activities, tentative operations
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Many decades of work have been invested in the area of distributed transactions including protocols such as 2PC, Paxos, and various approaches to quorum. These protocols provide the application programmer a facade of global serializability. Personally, I have invested a nontrivial portion of my career as a strong advocate for the implementation and use of platforms providing guarantees of global serializability. My experience over the last decade has led me to liken these platforms to the Maginot Line. In general, application developers simply do not implement large scalable applications assuming distributed transactions. When they attempt to use distributed transactions, the projects founder because the performance costs and fragility make them impractical. Natural selection kicks in... Instead, applications are built using different techniques which do not provide the same transactional guarantees but still meet the needs of their businesses.

This paper explores and names some of the practical approaches used in the implementations of large-scale mission-critical applications in a world which rejects distributed transactions. We discuss the management of fine-grained pieces of application data which may be repartitioned over time as the application grows. We also discuss the design patterns used in sending messages between these repartitionable pieces of data.

The reason for starting this discussion is to raise awareness of new patterns for two reasons. First, it is my belief that this awareness can ease the challenges of people hand-crafting very large scalable applications. Second, by observing the patterns, hopefully the industry can work towards the creation of platforms that make it easier to build these very large applications.

## Overview

Pat Helland wrote this for CIDR 2007 (Asilomar, January 7 to 10) and labels it a position paper whose views are his own, not those of his employer, Amazon. The setting is the mid-2000s, when a growing number of applications no longer fit on one machine or one tightly coupled cluster. The paper deliberately sets high availability aside and looks at scalability only, taking as given that large-scale distributed transactions cannot be used.

The protocols it argues against are the ones this catalog covers on the theory side, such as [Paxos Made Simple](/papers/paxos-made-simple). Its practical neighbors are other large-scale systems of the same period: [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), whose catalog entry describes atomicity only per row, and [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), which the catalog entry describes as giving up strong consistency to stay available. The paper cites Google's [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) in a footnote as an example of a scale-agnostic programming abstraction. It sets availability aside, which is the other side of the trade-off formalized in [Brewer's conjecture](/papers/brewers-conjecture-cap-feasibility-web-services).

Worth knowing first: two-phase commit (2PC) and why it can block when a node is down, the meaning of serializability, and the difference between at-most-once, at-least-once and exactly-once message delivery.

## Contribution

- **The entity.** A collection of data with a unique key that lives within a single scope of serializability (one machine or one small cluster). Each datum belongs to exactly one entity, and atomic transactions never span entities, whether in the same application or in different ones.
- **Scale-agnostic and scale-aware layers.** The upper layer of an application is written against a scale-agnostic abstraction and never assumes where an entity lives. The lower layer is scale-aware: it maps entity keys to machines and may repartition them over time.
- **Messages between entities.** Messages are addressed to an entity key, are enqueued transactionally with the sender's transaction, and are delivered at-least-once, so they may be repeated or arrive out of order.
- **The activity.** The state an entity keeps about one partner entity, covering both received messages and the status of shared work. An entity has one activity per partner.
- **Tentative operations.** Agreement across entities is reached by asking a partner to accept uncertainty, with a later confirmation or cancellation. The paper presents this as fine-grained workflow, not as a new protocol.

## Methodology

There is no experiment, implementation or measurement. The method is a thought experiment the author calls almost-infinite scaling: the number of customers, orders, accounts and similar business objects grows without bound while each individual object stays small. Footnote 2 spells out what this means, tens or hundreds of thousands of machines, too many to behave like one big machine. The paper then follows the consequences of three assumptions it states as asserted and not justified: that the application has a scale-agnostic upper layer, that disjoint scopes of serializability are the norm, and that most applications get at-least-once messaging.

The argument proceeds by examples. Hashing or key-range partitioning explains why two entities cannot be assumed to share a machine. A key-range scheme that happens to keep neighbors together will pass a test that relies on atomicity and then break after redeployment. Alternate indices (a customer found by social security number, credit card or street address) show why different keys cannot be updated atomically. An order that reserves inventory item by item, and a house purchase through an escrow company, illustrate activities and tentative operations. The author treats these as patterns already used in practice, not as inventions.

## Findings

The paper reports arguments and the author's experience, not results, and it names no system and gives no figure other than the scale in footnote 2. What it claims:

- **Distributed transactions do not carry large systems.** The abstract says developers "simply do not implement large scalable applications assuming distributed transactions" and that such projects founder on performance cost and fragility. This is stated from the author's experience over the last decade, with no data.
- **Entity as the unit of atomicity.** A scale-agnostic programmer must treat the entity as the boundary of serializability, because assuming more breaks when the deployment changes.
- **Alternate indices cannot be kept atomic with the entity.** Updates to them are asynchronous workflow, and reads of them may be out of sync with the entity found by its primary key. The paper calls this harder than before, but unavoidable.
- **Messages must tolerate retries and reordering.** A message that does not substantively change the entity is naturally idempotent. Otherwise the entity must remember, durably and per partner, that the message was processed, and return the same reply to a repeated request. The paper adds that duplicate elimination is usually done on coarser queues, not per entity, and that moving that knowledge along with a repartitioned entity is not commonly available.
- **Uncertainty moves from locks to business semantics.** Where distributed transactions would hold locks, the business logic holds reserved inventory or allocations against credit lines. Every tentative operation eventually confirms or cancels.
- **A prediction, not a result.** The author expects new middleware to emerge for this style, as TP monitors emerged in the 1970s for terminal handling.

## Critical Analysis

- **No evidence beyond opinion.** The paper is explicit that it is a position paper. Its central claims about what developers do and why projects founder have no data, no named systems and no bibliography, so they cannot be checked from the text.
- **Availability and replication are out of scope.** The introduction ignores availability and a footnote excludes replication for high availability, so the paper says nothing about how disjoint scopes behave under failure.
- **Not in this paper.** Reference data and time, immutable versions, dated snapshots and any ticket-like state are not discussed, and the paper has no section that treats queues as a design form beyond the messaging and duplicate-elimination remarks above. The only vocabulary it adds to workflow is entity, activity and tentative operation.
- **Later systems revisit the premise.** Catalog entries such as [Spanner](/papers/spanner-globally-distributed-database) (externally consistent distributed transactions), [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) and [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store) (ACID transactions across arbitrary keys) offer multi-partition transactions at scale. This is a comparison made here, not something the paper says. The paper's claim is about hand-built applications and the fragility of 2PC-style protocols in 2007.

Later literature, not part of the 2007 paper. Helland republished this work as "Life Beyond Distributed Transactions" in ACM Queue (vol. 14, issue 5, 2016, DOI 10.1145/3012426.3025012) and in Communications of the ACM (2017, DOI 10.1145/3009826). I did not read those versions, so I cannot say what changed, and Crossref's abstract for the Queue version matches this paper's themes. Two other Helland pieces appear in Crossref: "Immutability Changes Everything" (Queue, 2015), whose abstract argues for storing and sending immutable data in order to coordinate at a distance, and "Standing on Distributed Shoulders of Giants" (Queue, 2016), whose abstract draws parallels with physics. I read only those abstracts. Links to Sagas, domain-driven design aggregates or actors are common in practice but are not made in this paper, and I did not check a source for them here.

## Further Research

- Platforms that give the scale-agnostic abstraction directly, including routing by entity key, repartitioning and per-entity duplicate elimination.
- How much of tentative-operation workflow can be provided by a library or middleware instead of hand-written business logic.
- Where multi-partition transactions are cheap enough that the entity boundary can be widened, and where it still pays to keep it narrow.
- Detecting, in tests, code that depends on two entities being on the same machine.
- Combining this style with the availability and replication concerns the paper sets aside.
