---
title: "Pesto: Cooking up High Performance BFT Queries"
summary: Pesto is a Byzantine fault tolerant SQL database that never totally orders requests, so replicas run queries on possibly different states, clients synchronize them on a per-query snapshot only when answers disagree, and a predicate-aware concurrency check aborts a transaction only when a concurrent write changes a query's result.
researchArea: Distributed Systems
keywords: bft database, sql, byzantine independence, optimistic concurrency control, snapshot synchronization, inconsistent replication, serializability
version: 1.0
updatedAt: 2026-11-07
---

## Overview

The usual way to build a Byzantine fault tolerant (BFT) database is to order every operation with a BFT consensus protocol such as PBFT or HotStuff and feed the log to a database engine. That design gives up the parallelism of the workload, needs several round trips for each request of an interactive transaction, and, once sharded, layers two-phase commit over consensus. Basil, a recent BFT key-value store, avoids total ordering by integrating replication, optimistic concurrency control and two-phase commit in one layer, but it only offers GET and PUT. The authors give an example: a join of two tables with a million rows each, overlapping in one key, takes a million reads on each table at the client to return a single row.

This SOSP 2025 paper (Seoul), by Florian Suri-Payer, Neil Giridharan, Liam Arzola, Shir Cohen, Lorenzo Alvisi and Natacha Crooks, from Cornell University, UC Berkeley and UC San Diego, extends Basil into Pesto, which offers interactive SQL transactions with no total order. Two problems have to be solved. A query now runs on the server, so its result must be trustworthy even though replicas are deliberately not kept identical, and optimistic concurrency control normally behaves badly on range queries.

Five terms carry the paper. **Byz-serializability** means all correct participants observe a state consistent with a sequential execution of the transactions, and **Byzantine independence** means no group of faulty participants can decide the outcome of an operation alone. **Inconsistent replication** means replicas process requests in any order. A **range read** is any query that is not a single-row primary key lookup, and **SemanticCC** is the concurrency check that uses query predicates.

Worth knowing first: consensus and state machine replication ([Paxos Made Simple](/papers/paxos-made-simple) covers the crash-fault version; the paper's own BFT references are PBFT and HotStuff, not Paxos), phantom reads and serializability ([A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels), which the paper cites for phantoms), and [Spanner](/papers/spanner-globally-distributed-database), which the paper cites as an example of a crash-fault-tolerant store built on replicated state machines.

## Contribution

- **No ordering, client-driven execution.** Replicas process requests in any order and in parallel, and clients orchestrate execution and commit. The model is partial synchrony with n = 5f+1 replicas, of which f may be faulty, and any number of faulty clients. The authors need 5f+1 for Byzantine independence, because in a 3f+1 leader-based protocol a Byzantine client and leader could collude to front-run transactions.
- **Two kinds of reads.** A point read (one row by primary key) uses Basil's GET: ask at least 2f+1 replicas, wait for f+1 replies and keep the freshest valid version, where a committed version carries a commit certificate and a prepared one must come from f+1 replicas. Every other query is a range read sent to at least 3f+1 replicas. Writes are buffered at the client, and a conditional write first runs a reconnaissance read to find the rows to change. Calvin uses the same term for a preliminary read that discovers read and write sets, but the paper does not cite [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases).
- **Snapshot synchronization.** If replies do not match, the client collects snapshot votes: the ids of the transactions behind the rows each replica read. It keeps the ids that appear in f+1 votes and proposes that snapshot. Replicas fetch missing transactions from the voters, with a certificate, and re-execute. Agreement is needed only on the active rows, those that satisfy the query predicate. A snapshot can contain only transactions some correct replica holds, so a faulty client can stall only its own query. Replicas may read a fresher committed version than the snapshot holds, favoring freshness over consistency.
- **SemanticCC.** A query becomes an operator tree whose scans carry filter predicates, and replicas return those predicates with the result. The validation check aborts a transaction only if a concurrent write satisfies one of its predicates or makes an active version stale. This avoids the logical table lock that plain optimistic validation would need to prevent phantoms, and is inspired by precision locks.
- **Write monotonicity.** Re-checking every past write to a table would be impractical, so each predicate carries a table version, the timestamp of the latest write when it ran, and a writer whose timestamp is below a threshold aborts, with a grace period for late writers. This forces range read quorums to intersect commit quorums, so clients take the smallest table version from at least 3f+1 replicas. Snapshots lower it to just below the oldest skipped version.
- **Commit from Basil.** Timestamp-ordered validation, with prepared writes visible optimistically and read dependencies tracked. A commit needs 3f+1 commit votes and an abort needs f+1 abort votes. With 5f+1 commit votes the transaction finishes in one round trip, otherwise a second stage logs the decision on one shard. Recovery of failed clients is inherited from Basil.

## Methodology

Pesto is a C/C++ prototype that starts from Basil's open-source code, with Protobuf over TCP, ed25519 signatures, HMAC-SHA256 and Blake3 hashing. Its query layer adapts Peloton. The baselines are unreplicated Peloton, Peloton layered over HotStuff (Peloton-HS) and over BFT-SMaRt (Peloton-Smart), Postgres alone and with one synchronous backup (Postgres-PB), and CockroachDB, unreplicated and in memory. The two SMR baselines are relaxed on purpose: replicas execute in parallel without determinism and one primary answers, which the authors say is not fault tolerant but an upper bound.

Everything runs in memory at serializable isolation on CloudLab m510 machines (8 cores, 64 GB, 0.15 ms ping), with closed-loop clients, f = 1 and runs of 60 seconds including 15 seconds of warm-up and cool-down. Workloads are TPC-C with 20 warehouses, AuctionMark, SEATS and a YCSB-based microbenchmark of 10 tables of 1M keys, uniform or Zipfian with coefficient 1.1. The experiments cover overall performance, comparison with Basil and sharding, forced failures of the eager path, and replica failure.

## Findings

These are the authors' reported results.

- **TPC-C.** Pesto reaches 1784 tx/s, against 1777 for Peloton, 1781 for Postgres, 758 for Peloton-HS, 785 for Peloton-Smart and 1257 for Postgres-PB. Latency is under 1.5× that of Peloton and Postgres (equal at high load) and 3.9× and 2.7× lower than Peloton-HS and Peloton-Smart. Point reads take one round trip, as do 99.9% of range reads, and 97% of commits take the fast path.
- **Why it matches unreplicated.** Reads go only to a quorum, so on the point-read-heavy TPC-C Pesto spreads load and can exceed its own unreplicated variant, which hits a CPU bottleneck at 1379 tx/s.
- **AuctionMark and SEATS.** Pesto comes within 1.36× and 1.22× of unreplicated Peloton and within 1.94× of Postgres. Latency is 5× and 3× lower than Peloton-HS and Peloton-Smart on AuctionMark, and 4.6× and 3.4× on SEATS, with throughput gains of 1.1× and 1.2× because everything is CPU bound.
- **Versus Basil's point reads.** TPC-C's scan-heavy Stock-level transaction is over 11× faster. In a scan microbenchmark the gain is 16.6× for 10k rows, and 110× when the predicate matches 1 row in 100.
- **Sharding.** TPC-C scales 1.64× on two shards and 2.21× on three, within 1.23× of Basil's reported 4862 tx/s despite a full SQL stack. CockroachDB has 4.46× less throughput on one shard, and its peak, with up to 9 shards, is 2.91× below Pesto's.
- **Stress.** On the uniform workload, failing the eager path for every transaction costs about 9% of throughput and raises latency 1.38×, and simulated inconsistency (writes omitted or delayed at a third of replicas) costs about 5%. On Zipfian they cost 32% and 48%, since slower reads widen conflict windows.
- **Replica failure.** No progress interruption, because coordination is client-driven, but the fast path is lost. On uniform, throughput falls 14% with the fast path disabled and 24% with a roughly 4 ms timeout, and latency rises 1.59× and 2.7×. On Zipfian the cost is 5% and 1.25× without the fast path and 36% and 2.5× with the timeout.

## Critical Analysis

The idea is well argued: consistency is needed only for the rows a query touches, and the TPC-C numbers suggest replicas usually already agree. The paper and its appendix concede several limits.

- **Range reads can fail and retry.** Success is not deterministic, since fresher commits at some replicas or patchy snapshots make replies differ. Termination is argued only after a contention-free point, and the paper says no interactive system can promise commits under contention.
- **Contention is the weak spot.** The Zipfian stress runs lose 32% and 48% of throughput, which the authors tie to wider conflict windows.
- **Scope of the prototype.** The main text assumes each query hits one shard. The appendix leaves cross-shard queries outside the prototype, assumes every replica has a counterpart run by the same trust authority in the other shards, and leaves trust-free execution open. Nested queries may need rewriting or coarser snapshots. Authenticated Byzantine clients can still corrupt data through legitimate transactions, and the proofs sit in a supplement labeled not peer-reviewed.

The following points are a reading of the evidence, not claims of the paper.

- **"Matches unreplicated" is a TPC-C result.** On AuctionMark and SEATS Pesto is below Peloton and Postgres, and on TPC-C it matches partly by load balancing reads across six replicas per shard, against one machine for the unreplicated systems. Throughput per machine is not reported. CockroachDB is unreplicated, so it shows scaling, not a fault-tolerance comparison.
- **The SMR baselines are a relaxed strawman.** Removing determinism and fault tolerance flatters them, which is fair as an upper bound, but a real deterministic parallel engine is not evaluated. The 2.3× and 2.7× to 3.9× gains are mostly consensus round trips on a LAN with 0.15 ms ping, and wide-area deployments are not measured.
- **Failures are only crashes, and no baseline is shown.** Replicas are crashed or made inconsistent by omission. Active Byzantine behavior such as forged votes or stale proposals is argued in proofs, not measured. Figure 9 shows only Pesto variants, so the advantage over a leader-based view change is asserted, not compared.
- **No ablation of SemanticCC.** The paper says filter predicates only rarely abort needlessly, but no experiment compares it with table-level validation, or varies the grace periods, whose values the text does not give.
- **The quorum size is easy to misread.** Section 5.5 describes f+1 matching replies for range reads, while Section 6.1.3 raises it to 3f+1 once write monotonicity is added, and the evaluation and appendix use 3f+1. The final protocol is the 3f+1 one.
- **"Full SQL" rests on Peloton.** The paper reports no conformance test or list of unsupported features, and only TPC-C is sharded.

## Further Research

- Cross-shard queries without same-authority counterpart replicas, and nested queries across shards, which the appendix leaves open.
- Cheaper and fresher snapshots: gossiping prepared transactions, tuning how many versions votes carry, collecting 4f+1 votes, and compressing transaction ids from 256-bit hashes toward timestamps, as the appendix sketches.
- Comparing against leader-based BFT under failures and slowdowns, where [Ambulance](/papers/ambulance-saving-bft-through-racing), a later paper by overlapping authors that Pesto does not cite, studies slow leaders in BFT state machine replication.
- Ablations of SemanticCC and grace tiers, wide-area runs, and measurements with actively Byzantine replicas and clients.
