---
title: "Spanner: Google's Globally-Distributed Database"
summary: Spanner shards a multi-version, semi-relational database over Paxos groups in datacenters around the world and uses an API that exposes clock uncertainty, TrueTime, to give externally consistent distributed transactions.
researchArea: Distributed Systems
keywords: spanner, truetime, external consistency, distributed transactions, paxos, geo-replication
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Large services want two things that pull apart: a database that spans datacenters on several continents, and transactions that behave as if there were one machine. Systems before Spanner at Google gave up one of them. Bigtable scaled but was hard to use for applications with evolving schemas or that needed strong consistency across wide-area replicas, and Megastore had a friendlier model but low write throughput.

This OSDI 2012 paper describes Spanner, the database Google built to offer both. Its first customer was F1, the rewrite of the advertising backend that had been a manually sharded MySQL database.

Worth knowing first: Paxos-based replication (see the Raft paper in Papers for a gentler account), two-phase commit, multi-version concurrency control, and what linearizability (also called external consistency) promises: if one transaction finishes before another starts, the second sees it.

## Contribution

- **A database over global replication.** Data is stored in schematized semi-relational tables, versioned and timestamped with commit time, sharded across many Paxos state machines. Applications control how many replicas, where they sit and how far they are from users.
- **TrueTime.** A clock API that returns not a time but an interval, `[earliest, latest]`, that is guaranteed to contain the real time. It is built from GPS receivers and atomic clocks in every datacenter.
- **External consistency at global scale.** Using TrueTime, every transaction gets a commit timestamp that reflects the order in which transactions really happened, which enables consistent backups, atomic schema changes and lock-free read-only transactions.
- **Resharding and migration** of data between machines and datacenters, done automatically.

## Methodology

The core idea is the commit-wait rule. The coordinator leader of a write picks a commit timestamp no smaller than `TT.now().latest`, and then holds the result back until `TT.after` of that timestamp is true, that is, until it is certain that the timestamp is in the past. Since a later transaction starts after the earlier one's timestamp has passed, its own timestamp must be larger. The paper gives a short proof of this ordering.

Read-only transactions and reads at a timestamp take no locks. Each replica tracks a safe time up to which it is up to date and can serve any read at or below it.

TrueTime itself comes from a set of time masters per datacenter, most with GPS receivers and some with atomic clocks (so that the two kinds of failure are not correlated), and a daemon on each machine that polls them and widens its uncertainty between polls. The evaluation uses microbenchmarks on a test universe, availability experiments in which whole zones are killed, TrueTime measurements on production machines, and the case of F1.

## Findings

These are the authors' reported results.

- In a one-replica setup commit wait takes about 5 ms and Paxos about 9 ms. Latency stays roughly constant when replicas are added, because Paxos runs in parallel across them.
- Two-phase commit across many participants scales: mean and 99th percentile latency are acceptable up to 50 participants and start to rise noticeably at 100.
- Killing a non-leader zone has no effect on read throughput. Killing the leaders' zone with a warning costs 3 to 4%, and without a warning throughput falls to almost zero and recovers in about 10 seconds, the length of the Paxos leader lease.
- The uncertainty ε of TrueTime follows a sawtooth between 0 and 6 ms between polls, plus about 1 ms of communication delay. The authors report that bad CPUs are 6 times more likely than bad clocks on their machines, and that ε spiked when two time masters were shut down for maintenance.
- F1 moved off a manually sharded MySQL database whose last resharding had taken over two years of effort, and gained synchronous replication, automatic failover and transactions across all its data.

## Critical Analysis

Spanner is an important systems paper because it shows a way to make a weak assumption explicit (clocks are uncertain) and then build strong guarantees on top of it. Several limits are worth keeping in mind.

- **Dependence on special infrastructure.** The guarantee holds as long as the real clock stays inside the interval. The paper states that clock drift above 200 µs per second would break TrueTime's assumptions, and it relies on GPS and atomic clock hardware that many deployments do not have.
- **Latency is paid at commit.** Commit wait grows with ε. The authors expect most applications to replicate across nearby datacenters and think ε below 1 ms is reachable, but that is a projection.
- **A young system, one main user.** Evaluation is dominated by F1 and by microbenchmarks with machines less than 1 ms apart. Automatic secondary indexes, load-based resharding and a full schema language were still in progress, and TrueTime details are deferred to another paper.
- **No head-to-head comparison.** Related work is discussed in words. Results come from the authors' own system and workload.
- **Complex SQL was weak.** The paper itself says the node-local data structures were designed for key-value access and perform poorly on complex queries.

## Further Research

- Cheaper or software-only ways to bound clock uncertainty, so that the design can be used outside Google's datacenters.
- Reducing ε and the commit-wait cost, and measuring the effect on workloads with mostly short transactions.
- Optimistic parallel reads, which the authors found to need a non-trivial implementation, and direct reconfiguration of Paxos groups.
- Better single-node query execution, borrowing from the database literature.
- Automatic movement of data (and, harder, of application processes) between datacenters as load changes.
