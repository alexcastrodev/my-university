---
title: "DuckDB: an Embeddable Analytical Database"
summary: A four-page demonstration paper that introduces DuckDB, an in-process SQL database built for analytics, which combines a vectorized engine, columnar storage and MVCC in a library with no server and no dependencies.
researchArea: Databases
keywords: duckdb, embedded database, olap, vectorized execution, columnar storage, mvcc
version: 1.0
updatedAt: 2026-11-01
---

## Overview

SQLite showed that many programs want a database that is just a library, with no server to install, and it became the most widely deployed SQL engine. But SQLite is built for transactional (OLTP) work, with a row-oriented engine over B-trees, and its performance on analytical queries (OLAP) is poor. People who analyse data in R or Python use data-frame libraries that look like relational operators but lack a query optimizer and transactional storage.

This paper, a SIGMOD 2019 demonstration from CWI in Amsterdam, introduces DuckDB as the missing piece: an analytical database that runs inside the host process. It is a short paper (four pages) and it describes a system and a demo, not a set of experiments, so read it as a design statement.

Worth knowing first: the difference between OLTP and OLAP, row-oriented and column-oriented storage, and the idea of an embedded database that is linked into an application instead of a server that is called over a network.

## Contribution

- **A statement of requirements** for embedded analytics, drawn from the authors' earlier system MonetDBLite: efficiency on OLAP without giving up OLTP, stability (a crash or an out-of-memory in the database must not take the host down), cheap transfer of tables between the application and the database in the same address space, and easy embedding without external dependencies.
- **A purpose-built system** that follows the textbook structure (parser, planner, optimizer, execution engine) with known techniques chosen for these needs, such as a parser derived from PostgreSQL's, a cost-based optimizer with dynamic programming for join order, a vectorized interpreted execution engine, serializable MVCC from HyPer, and compressed columnar blocks with min/max indexes.
- **A SQLite-compatible API** layer, so applications can switch by re-linking.
- Open source under the MIT license.

## Methodology

The paper presents the design component by component. It chooses vectorized interpretation over JIT compilation for portability, because JIT engines depend on large compiler libraries such as LLVM. Vectors hold up to 1,024 values, with a separate NULL bit vector and selection vectors to avoid moving data after a filter, and queries run in a "Vector Volcano" model that pulls chunks from the root of the plan.

For concurrency, DuckDB updates data in place and keeps older versions in an undo buffer, an MVCC variant chosen because modifying tables in parallel was a frequent request even for analytics users.

The evaluation is a planned demonstration: four identical computers running SQLite, MonetDBLite, HyPer and DuckDB on TPC-H data, with a physical dial that changes the amount of data read and a screen with live queries per second and memory pressure. In a second scenario the audience proposes the query, so that the authors cannot pick queries where their system excels.

## Findings

These are the authors' reported results, and there are few of them because this is a demo paper.

- At the time of writing, DuckDB ran all TPC-H queries and all but two TPC-DS queries, and passed most of SQLite's logic test suite of millions of queries.
- The authors predict, and do not yet measure, that all systems will behave alike on small data, and that only DuckDB will keep working on larger data on a small device: SQLite is limited by row-at-a-time execution, MonetDBLite by materializing intermediate results, and HyPer by its socket protocol for transferring results.
- Work still ahead included the new storage layout, a buffer manager, parallelism inside a query and a scheduler that balances DuckDB's resources with the host application's.

## Critical Analysis

DuckDB has since been widely adopted, but this paper is an early snapshot, and that matters for how to read it.

- **No numbers.** The paper contains no performance measurements, so its main claim, that DuckDB is better than the alternatives for embedded analytics, is a prediction for the demo. Later publications and independent benchmarks are the place to look for evidence.
- **A system paper without novelty claims.** The authors say none of the components is revolutionary and that the contribution is the combination chosen for the use case. That is fair, but it makes the paper a good guide to current techniques and less a source of new ideas.
- **The comparison is set by the authors.** The choice of baselines and the TPC-H schema favour their story, though the audience-chosen query scenario is a thoughtful counter.
- **Open problems were listed as future work.** Intra-query parallelism, the buffer manager and resource sharing with the host were not there yet, and those decide whether it works as a good citizen in a larger program.

## Further Research

- Independent, reproducible benchmarks of embedded analytical engines on realistic data sizes and queries.
- Resource governance between an embedded database and its host, for memory and threads.
- Efficient interfaces between data frames and the engine that avoid copies.
- Handling data larger than memory in a library that has no server to manage the buffer pool.
