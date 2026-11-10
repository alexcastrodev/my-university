---
title: "Access Path Selection in a Relational Database Management System"
summary: How System R's optimizer turns a declarative SQL query into a plan, by estimating the cost of each access path and join order and searching the combinations with dynamic programming.
researchArea: Databases
keywords: query optimization, cost-based optimizer, join ordering, system r, sql, selectivity estimation
version: 1.0
updatedAt: 2026-11-01
---

## Overview

SQL lets a user ask for data without saying how to get it: which index to use, in which order to join the tables, whether to sort first. Someone has to choose, and the choice can change the running time by orders of magnitude. This 1979 SIGMOD paper from the IBM San Jose research laboratory describes how System R, one of the first relational database systems, makes that choice automatically.

It is the origin of the cost-based query optimizer, the design that the optimizers of most relational databases still follow in outline. Reading it is a good way to see why a database may run a slow plan for a query that looks simple.

Worth knowing first: the relational model and SQL joins, what an index is (and a clustered index in particular), and the difference between reading a table in order and reading it by random access.

## Contribution

- **A cost formula.** Each candidate plan gets a cost that is the number of page fetches plus a weight times the number of calls to the storage layer, which stands in for CPU work. Minimizing it means minimizing total resources, not response time of the first row.
- **Selectivity factors.** For each predicate the optimizer estimates the fraction of rows that pass, using statistics kept in the catalog, such as the number of distinct keys of an index.
- **Interesting orders.** A plan that produces rows in an order useful later (for ORDER BY, GROUP BY, or a merge join) is kept even if it is not the cheapest, because it may save a sort.
- **Two join methods** (nested loops and merging scans) and a way to choose the join order.
- **A search that does not enumerate all orders.** The best way of joining the first k relations does not depend on the order in which they were joined, so the best plan can be found for successively larger subsets of tables.
- Treatment of nested queries, correlated or not.

## Methodology

The optimizer works on one query block at a time. For each table it lists the access paths (an index scan or a full scan) and the predicates they can apply, and estimates their cost with the formula above. For single-table queries it keeps the cheapest path for each interesting order, plus the cheapest unordered one.

For joins it builds the search tree bottom up: solutions for single relations, then pairs, then triples, keeping for each subset only the cheapest plan per interesting order. A heuristic shrinks the space, by joining a relation only when it has a join predicate with the ones already joined, so Cartesian products happen as late as possible. Nested subqueries that do not refer to outer tables are evaluated once and first. Correlated ones are re-evaluated per candidate row, with a shortcut when the referenced value has not changed since the previous row.

## Findings

These are the authors' reported results, and they are brief.

- The paper is mostly a description of a design. In its conclusion the evaluation is still in progress and promised for a later paper.
- The preliminary results are that the predicted costs are often not accurate in absolute terms, but the optimizer picks the optimal path in a large majority of cases. In many cases the order of the estimated costs for all paths is the same as the order of the measured costs.

## Critical Analysis

The importance of the paper lies in the structure of the solution, and it is a good example of an idea that has lasted. The details show their age.

- **Almost no empirical evidence.** There is no benchmark, only a statement of preliminary agreement between estimated and real cost orderings. The claim that the method finds good plans is, in this paper, an expectation.
- **Fragile estimates.** Selectivity assumes uniform value distributions and independent predicates, and uses arbitrary defaults when statistics are missing (for example one tenth for an equality without an index). Errors multiply through a chain of joins. Later work on histograms and on correlated columns takes these issues on, and the paper does not.
- **A narrow plan space.** The search joins one more relation at a time and prunes join orders by heuristic, so it can miss plans that a wider search would find. The authors accept this to keep optimization time low.
- **A dated cost model.** The weights for I/O and CPU, a single machine and a buffer pool shared by users are assumptions of 1979 hardware. Parallelism, memory-resident data and distributed execution are not covered.
- **The objective is total resource use,** not latency to the first row or fairness between users.

## Further Research

- Better cardinality estimation: histograms, sampling, and models of correlation between columns.
- Choosing plans that adapt while they run when the estimates prove wrong.
- Wider plan spaces, such as plans that join two intermediate results, with search that stays affordable.
- Cost models for parallel, distributed and in-memory systems.
- Measuring how often optimizers pick a bad plan on realistic workloads, which the paper only promises to do.
