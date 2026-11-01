---
title: "A Critique of ANSI SQL Isolation Levels"
summary: The paper shows that the SQL-92 definitions of isolation levels, written as lists of forbidden anomalies, are ambiguous and incomplete, adds new anomalies such as lost update and write skew, and defines snapshot isolation.
researchArea: Databases
keywords: transactions, isolation levels, snapshot isolation, write skew, serializability, concurrency control
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Databases let many transactions run at once, and isolation levels are the setting that decides how much one transaction can see of the others. A lower level is faster and allows odd results, and the highest, serializable, behaves as if transactions ran one after another. Applications choose a level with a name from the SQL standard, such as READ COMMITTED or REPEATABLE READ.

This SIGMOD 1995 paper, by researchers from Microsoft, Sybase, Berkeley and UMass Boston, asks whether those names mean what the standard says they mean. Its answer is that they do not, and that the way the standard defines them is part of the reason.

Worth knowing first: what a transaction is, serializability, and basic lock-based concurrency control (read and write locks, two-phase locking). The paper uses a notation for histories such as `r1[x]` (transaction 1 reads x) and `w2[x]` (transaction 2 writes x).

## Contribution

- **A critique of the anomaly-based definition.** SQL-92 defines each level by forbidding three phenomena: Dirty Read, Non-repeatable Read and Phantom. The authors show that the English definitions are ambiguous, that even their broadest reading does not exclude all anomalous behavior, and that lock-based levels in real products behave differently from the ANSI levels of the same name.
- **New phenomena.** Dirty Write (P0), Lost Update (P4), Read Skew (A5A) and Write Skew (A5B), among others, give a finer scale.
- **Clearer definitions.** A broad reading of the ANSI phenomena that matches the locking levels of the earlier "degrees of consistency" work.
- **Snapshot isolation.** A multiversion level in which each transaction reads from a snapshot taken at its start and a first-committer-wins rule prevents lost updates. The paper places it in the hierarchy.
- A table that characterizes the levels used by commercial systems, such as Cursor Stability and Oracle's Read Consistency, by the anomalies they allow.

## Methodology

This is an analytical paper, with no experiments. The authors define phenomena as patterns in a history of reads and writes and test each ANSI level against concrete histories, showing examples that the strict definitions allow but that clearly break integrity. They then compare locking implementations at each level (the length of read and write locks) with the anomaly definitions, and place each level in a hierarchy by which anomalies it permits.

For snapshot isolation they argue by mapping multiversion histories to single-version ones with the same data flow, and give a constraint-based example with two accounts to show that it is not serializable.

## Findings

These are the authors' claims.

- The ANSI definitions do not forbid dirty writes, and the three phenomena of the standard are not enough to describe even locking REPEATABLE READ. A broad reading is needed for the levels to match the locking definitions.
- Snapshot isolation prevents dirty reads, lost updates and fuzzy reads, so it avoids many common anomalies, but it still allows write skew. In their bank example, two transactions each read two balances, each withdraws from a different account, and together they break the constraint that the sum stays non-negative, while neither one ever sees the other's write.
- Because of this, snapshot isolation is not serializable, and it is not strictly stronger or weaker than the ANSI REPEATABLE READ.
- The name "Repeatable Read" is unfortunate in the authors' view: it does not give repeatable results as defined by ANSI, and some products used the term for serializable.

## Critical Analysis

The paper changed how practitioners and implementers talk about isolation, and its examples are still used in teaching. Points to weigh:

- **It argues about definitions, not about prevalence.** The paper does not measure how often write skew or other anomalies happen in real applications, so it says the anomalies are possible, not that they are common.
- **The authors have a position.** Some of them work for database vendors (Microsoft and Sybase), and the paper recommends a specific way to read the standard and to name the levels. It is an argument for that reading, even if a convincing one.
- **Scope of the argument.** It treats single-statement histories over data items, and phantoms over predicates are covered in a lighter way. Distributed and replicated databases, which now matter a lot, are not discussed.
- **The map is not final.** The authors say the hierarchy of the new levels is characterized by the anomalies they know, and later work added more anomalies and levels.

## Further Research

- Studies of which anomalies actually appear in production applications and what they cost.
- Efficient ways to make snapshot isolation serializable, or to detect the dangerous patterns at run time.
- Formal specifications of isolation that cover multiversion, distributed and replicated systems.
- Tools that tell an application developer which anomalies their transactions can hit at the isolation level in use.
