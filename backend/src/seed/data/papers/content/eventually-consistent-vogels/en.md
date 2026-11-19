---
title: "Eventually Consistent"
summary: Werner Vogels, then Amazon's CTO, writes a short essay on the trade-off between consistency and availability in replicated storage. It lays out the client-side consistency models (causal, read-your-writes, session, monotonic reads and writes), the N, W, R replica configuration with its W+R > N rule, and the inconsistency window, using Dynamo as the system that exposes these knobs to applications.
researchArea: Distributed Systems
keywords: eventual consistency, CAP theorem, quorums, replication, session consistency, inconsistency window, availability
version: 1.0
updatedAt: 2026-11-19
---

## Overview

This is a five-page practice article in Communications of the ACM (volume 52, issue 1, January 2009, pages 40 to 44), by a single author. It is a revised version of a 2007 blog post, also published in ACM Queue in October 2008. It is an essay, not a research paper: there is no experiment, no system evaluation and no proof. Its standfirst states the thesis: building reliable distributed systems at a worldwide scale demands trade-offs between consistency and availability.

The article starts from Amazon's infrastructure services (S3, SimpleDB and EC2 are named, only as the foundation of its cloud computing) and from one observation: with trillions of requests, rare events are guaranteed to happen, so replication is used everywhere and cannot be perfectly transparent. The historical section cites Lindsay's "Notes on Distributed Databases" for the late 1970s, when systems preferred to fail entirely rather than break distribution transparency, and Brewer's PODC 2000 keynote for the CAP theorem. A formal confirmation is credited to Gilbert and Lynch, covered in [Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services](/papers/brewers-conjecture-cap-feasibility-web-services).

Worth knowing first: replication, quorums, and the difference between the C of CAP and the C of ACID, which the article itself separates in one paragraph. The system it ends on is described in [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store).

## Contribution

- **CAP as motivation.** Of data consistency, availability and partition tolerance, only two can be had at once. Since partitions are a given in large systems, the choice is between relaxing consistency to stay available and prioritizing consistency and accepting unavailability.
- **Client-side consistency models.** With a storage system and processes A, B and C, the article defines strong, weak and eventual consistency, and five variations of the eventual model: causal, read-your-writes, session, monotonic read and monotonic write.
- **The inconsistency window.** The period between an update and the moment every observer is guaranteed to see it. If no failures occur, its maximum size depends on communication delays, system load and the number of replicas.
- **Server-side terminology.** N is the number of replicas, W the number that must acknowledge a write, and R the number contacted by a read. If W+R > N, the read and write sets overlap and strong consistency can be guaranteed. If W+R <= N, consistency is weak or eventual.
- **A tuning guide.** R=1 with N=W optimizes reads, W=1 with R=N optimizes writes, and N=3 with W=2 and R=2 is the fault-tolerance-only configuration.

## Methodology

There is no method in the empirical sense. The article is a guided tour in three steps: history and CAP, the client's view of consistency, and the server's view through quorum configurations. It works by definitions and small examples. The examples given are DNS as the most popular eventually consistent system, a primary-backup RDBMS in synchronous mode (N=2, W=2, R=1) and in asynchronous mode with reads from the backup (N=2, W=1, R=1, where consistency cannot be guaranteed), and Amazon's shopping cart, which keeps accepting writes during a partition and merges carts afterwards with help from the application.

## Findings

These are claims the article makes, not measured results.

- **Eventual consistency is not exotic.** Asynchronous log shipping in common relational databases already gives it, with an inconsistency window set by how often logs are shipped.
- **Stickiness matters.** Read-your-writes and monotonic reads are relatively easy if a client always talks to the same server, at some cost to load balancing and fault tolerance. Sessions make that stickiness explicit. A client can also enforce both itself by tagging writes with versions and discarding reads older than the last version seen.
- **Strict quorums trade availability for consistency.** With N=3 and W=3 and only two nodes up, writes fail. If W < (N+1)/2, non-overlapping write sets can produce conflicting writes.
- **Partitions favor the majority side.** In a classic majority quorum only the partition holding W nodes keeps taking updates. Applications that cannot accept that let both sides write to new storage nodes and merge when the partition heals.
- **Two reasons to tolerate inconsistency.** Better read and write performance under high concurrency, and keeping the system available under partitions. For websites, the article suggests aiming for an inconsistency window shorter than the time before the customer's next page load.
- **Dynamo is the example of explicit control.** The article says Dynamo lets a service owner choose the trade-off between consistency, durability, availability and performance at a given cost point. It gives no Dynamo numbers.

## Critical Analysis

- **One voice, no evaluation.** The text is the view of Amazon's CTO. There is no measurement, no data on inconsistency windows or failure rates, and no independent assessment. Statements such as "N can be tens or even hundreds of nodes" are assertions.
- **Nothing is proved.** The CAP statement is attributed to Brewer and Gilbert and Lynch, not shown here. Model definitions are informal. For example, the claim that read-your-writes is a special case of causal consistency is stated, not argued.
- **Only two examples of Amazon systems are really used.** S3 and SimpleDB appear in the first sentence, but the article never says which consistency model they offer. Only the shopping cart and Dynamo are connected to the ideas.
- **Reading CAP as "pick two" is a simplification.** The article itself notes that partitions are a given, which turns the choice into one between C and A during a partition. The later formal treatment in the Gilbert and Lynch entry of this catalog goes further, but that is later literature and the comparison here relies on the catalog entry, not on a new reading of that paper.
- **Later literature (not re-read for this entry; based on the catalog analyses).** [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) classifies read-your-writes and causal consistency as only "sticky available", which fits the article's remark about stickiness, and classifies monotonic reads and monotonic writes as highly available. [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) asks when coordination is needed at all, and [CRDTs](/papers/conflict-free-replicated-data-types) and the [JSON CRDT](/papers/conflict-free-replicated-json-datatype) give merge functions with a convergence guarantee, where the article leaves merging to the application.
- **The blog version differs only in wording.** The author's revised HTML text, which I compared with the CACM PDF, has the same structure, definitions, N, W, R examples and conclusions. Differences are editorial: the blog dates the earlier post as December 2007 and lists all Dynamo authors, while the PDF says "et al." and adds that a version appeared in the October 2008 issue of ACM Queue. I found no technical difference.

## Further Research

- Quantifying the inconsistency window in real deployments, which the article only describes qualitatively.
- Formal definitions of the session and causal models and their relation to isolation levels.
- Data types and merge functions that make convergence a property of the data, not of application code.
- Practical ways to expose these guarantees to developers, since the article's closing point is that they must be aware of them.
