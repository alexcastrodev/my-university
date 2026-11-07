---
title: "Running Consistent Applications Closer to Users with Radical for Lower Latency"
summary: Radical runs strongly consistent applications at locations near users by executing them speculatively against an eventually consistent cache while one LVI request to the primary datacenter locks, validates and records write intents, and the speculative result is released only when it is linearizable.
researchArea: Distributed Systems
keywords: linearizability, speculative execution, serverless, near-user caching, static analysis, deterministic re-execution, webassembly
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Social networks, booking sites and forums need strong consistency, so they usually run in a primary datacenter next to their storage. New datacenters, edge points of presence and on-premises clusters could bring them closer to users, but the authors argue that this does not help on its own. A location without a storage replica pays the distance on every storage access. With geo-replicated storage, every access coordinates with distant replicas, and the PRAM result they cite bounds the sum of read and write latency below by the distance between replicas. In their own experiment with DynamoDB global tables, geo-replication was in most cases worse than a centralized deployment.

This SOSP 2025 paper (Seoul) is by Nicolaas Kaashoek, Amit Levy and Wyatt Lloyd (Princeton University), Oleg A. Golev (Sentient Foundation) and Austin T. Li (Cornell University), the last two having done the work at Princeton. Radical keeps the primary copy of the data in one **near-storage** location and adds eventually consistent caches in every **near-user** location. A function runs speculatively against the local cache while the **LVI** (LockValidate-WriteIntent) protocol makes a single request to the primary. Two more terms matter: the **read/write set**, which static analysis derives before the function runs, and the **write intent**, a record that lets the primary finish a write if the near-user location disappears.

Worth knowing first: linearizability, read/write locks, serverless functions, [Spanner](/papers/spanner-globally-distributed-database), the geo-replicated storage the paper positions itself against, and [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases), which also needs a transaction's read/write set in advance but asks users to supply it.

## Contribution

- **Architecture.** Each near-user location has a runtime and a storage library in front of a cache that need not be durable or consistent. The near-storage location has primary storage that is linearizable and durable (the paper names DynamoDB, BigTable and CosmosDB), an LVI server, backup copies of the functions, a version number stored with every item and a table of write intents.
- **One LVI request, overlapped with execution.** The runtime first runs a derived function that returns the read/write set, then runs the real function against the cache while sending the cached versions to the primary. There the server takes a read or write lock per item (sorted lexicographically to avoid deadlock), compares versions, and, if they match and the function writes, stores a write intent and starts a timer. The client gets the speculative answer once the function finishes and the request returns.
- **Failed validation.** The backup copy runs at the primary under the locks already held, and the reply carries the result plus fresh values and versions for stale items. This is also how caches fill and heal, so they never need durability. A cache miss is sent with version -1 and skips speculation.
- **Writes through a followup.** The near-user location sends its writes after answering the client. If the followup never arrives, the timer fires and the primary re-executes the function, which is safe because the read locks froze its inputs. The intent is then marked handled, so a late followup is discarded.
- **Static analysis.** Symbolic execution and dependency analysis, built on Eunomia, turn each function into a read/write-set function at registration. Dependent reads run inside that function against the cache, since a stale first read is caught by validation. If the analyzer fails or times out, the function runs near storage.
- **Requirements on applications.** Handlers must be serverless functions compiled to a deterministic subset of WebAssembly with no timers or randomness. External services must offer at-most-once semantics, as Stripe does with idempotency keys. A handler must also run long enough to hide the request, which the authors put at about 20 ms.
- **Correctness.** The paper argues linearizability for the three execution paths (success, failed validation, late followup). The formal proof is in a separate Zenodo record.

## Methodology

The prototype runs on AWS Lambda, with an EC2 LVI server and DynamoDB as storage. It has about 1000 lines of Rust for the runtime, about 2000 lines of Go for the LVI server (a singleton, with about 500 more lines for a replicated variant), and about 2000 added or changed lines in the roughly 8000 lines of Python of Eunomia. Functions are written in Rust and run on WasmTime.

The authors ported Diaspora, Discourse, Danbooru, Lobsters and the hotel benchmark of DeathStarBench into 27 functions. They evaluate social media, forum and hotel reservation (16 functions in Table 1). Deployments are in five AWS locations: Virginia (primary), California, Ireland, Frankfurt and Tokyo, with round trips to Virginia of 7, 74, 70, 93 and 146 ms. Clients sit in the same locations (50 client processes on one EC2 instance). Workloads are skewed (Zipf 0.99) for social media and forum and uniform for hotel. Latencies are medians over 10,000 requests.

Two baselines are used: all requests sent to the application in Virginia, and an inconsistent lower bound, where each region runs against its own local copy. DynamoDB also serves as the cache, to isolate the protocol from storage speed. DynamoDB global tables are not run, because the feature is not available in every region, and the authors reason from their earlier experiment instead. The replicated LVI server keeps its locks in a three-node etcd cluster, which runs [Raft](/papers/raft-understandable-consensus-algorithm).

## Findings

These are the authors' reported results.

- **End to end.** Compared with the primary-datacenter baseline, Radical lowers latency by 28% to 35% across the applications. It reaches 89% of the best possible improvement for hotel, 88% for social media and 84% for forum, with strong consistency and durability.
- **Validation holds up under skew.** The success rate stays around 95% for all applications, so the second execution at the primary is needed for about 5% of requests.
- **Distance drives the gain.** Locations with larger round trips benefit more, and Virginia is slightly worse than the baseline because of Radical's overhead. Social media in Japan is the exception: its round trip exceeds the execution time of 4 functions, so results wait for the request.
- **Function length matters.** Functions longer than the round trip gain most. Short ones (forum-interact, forum-post, hotel-review) end within a few ms of running near storage, so Radical is at worst similar to it.
- **Replicated server.** A lock costs 2.3 ms and the idempotency key 3 ms, so a request adds 3 + 2.3 × L ms for L locks, and the minimum useful execution time becomes 16 + 2.3 × L ms. With batching, the authors treat 20 ms as reasonable.
- **Cost.** For an assumed workload of 50,000 reads and 500 writes per second, Radical costs $1413.36 per month (DynamoDB, ScyllaDB caches and the LVI server), 31% above the baseline. At 100 million invocations a month the baseline costs $1364.36 and Radical $1714.71.
- **Throughput.** Not measured. The authors say it matches the baseline because the only added bottleneck is the singleton server, which sufficed.

## Critical Analysis

The idea is clean: pay one round trip, but hide it under work the function was doing anyway. The paper concedes several limits.

- **Not every application benefits.** Some read/write sets cannot be derived cheaply, and then the derived function runs in series with the real one. Not every application is deterministic, and some need significant refactoring.
- **Locks limit parallelism.** Writers to the same key wait for the lock holder's followup, and the authors lean on read locks and low skew to soften this.
- **Trust and deployment.** Both locations must be trusted and run the same serverless runtime. The evaluated LVI server is a singleton, and connecting the derived function to the code needs manual work.

The following points are a reading of the evidence, not claims of the paper.

- **Failures are not exercised.** If a near-user location dies, its locks stay held until the timer fires and the primary re-executes. The paper gives no timer value, lock-hold time or latency seen by waiting writers. The replicated server is measured only as cost per lock, not end to end.
- **Contention is argued, not measured.** Write locks last for the execution plus the followup trip, so far-away writers to a hot key queue behind that time. Adding Table 1 shares gives writes of about 1% for social media and hotel and 10% for forum, and no experiment varies write ratio, skew or client count.
- **The evaluation is regional.** The motivation lists edge points of presence and on-premises clusters, yet all five locations are AWS regions, with clients beside the application. The authors explain that Cloudflare Workers differed too much from Lambda. Locations with round trips between 7 and 70 ms to the primary are not sampled.
- **The ceiling and baseline are narrow.** The 84% to 89% is relative to an inconsistent run with no overhead. The only consistent baseline is Virginia, and the case against global tables rests on the earlier experiment. No repeated runs or intervals are described.
- **Small inconsistencies.** The introduction says 15 functions where Table 1 lists 16, and 84% to 88% where the abstract, body and conclusion say 84% to 89%. The cost section calls the 5% a validation success rate, though elsewhere it is the failure rate. The threshold appears as 20 ms, as 13 ms ("can benefit") and as 16 + 2.3 × L ms. The body figures are used here.
- **Cost mixes deployments.** Latency uses DynamoDB caches, while cost assumes ScyllaDB caches. The 2 GB memory needed for two vCPUs is raised after the totals, without a figure.
- **Generality is cited.** That any microservice application works rests on prior work, while the evaluation ports small handlers by hand. The 27 of 27 analyzable functions are encouraging but cover few patterns.

## Further Research

- Custom serverless platforms that internalize the protocol, and faster near-user caches, which the authors expect to improve performance.
- Serverless workflows with chained functions, which the authors say would perform poorly if Radical were applied naively, and stateful serverless storage such as [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) in place of DynamoDB, as they suggest.
- Batching or parallelizing lock acquisition in the replicated server, to lower the minimum useful execution time.
- Failure injection, write-heavy and hot-key workloads, and real edge or on-premises locations, to test the availability and contention claims directly.
