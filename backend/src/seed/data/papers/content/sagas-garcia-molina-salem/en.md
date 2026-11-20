---
title: "Sagas"
summary: Garcia-Molina and Salem propose breaking a long-lived transaction into a sequence of ordinary transactions, each with a compensating transaction, so that locks are released early and a failed run is either completed or semantically undone in reverse order, at the price of full atomicity and isolation.
researchArea: Databases
keywords: sagas, long-lived transactions, compensating transactions, recovery, save-points, relaxed atomicity, transaction processing
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Long lived transactions (LLTs) hold on to database resources for relatively long periods of time, significantly delaying the termination of shorter and more common transactions. To alleviate these problems the authors propose the notion of a saga. An LLT is a saga if it can be written as a sequence of transactions that can be interleaved with other transactions. The database management system guarantees that either all the transactions in a saga are successfully completed or compensating transactions are run to amend a partial execution. Both the concept of saga and its implementation are relatively simple, but they have the potential to improve performance significantly. The paper analyzes the implementation issues related to sagas, including how they can be run on an existing system that does not directly support them, and discusses techniques for database and LLT design that make it feasible to break up LLTs into sagas.

## Overview

This is a 1987 SIGMOD paper (San Francisco, 27 to 29 May; 11 pages, 249 to 259) from the Department of Computer Science at Princeton. It comes from the era of centralized relational DBMSs with lock-based concurrency control, where a transaction is atomic because it keeps locks on everything it touched until it commits. That is fine for short transactions. The paper's examples of LLTs are monthly account statements at a bank, claim processing at an insurance company and statistics over a whole database. Such a transaction holds its locks for hours or days, so other transactions wait a long time. The authors add that deadlock frequency grows with the fourth power of transaction size (citing an analysis by Gray and colleagues), and that long transactions are more likely to meet a crash and be aborted. They argue that no mechanism fixes this while the LLT stays atomic: whatever the concurrency control, a transaction that needs an object the LLT touched cannot commit before the LLT does.

The paper's way out is to relax atomicity for the transactions where the application allows it. Later papers in the catalogue attack the same cost from the opposite side, keeping atomic, isolated transactions and making them scale: [Percolator](/papers/percolator-large-scale-incremental-processing), [Spanner](/papers/spanner-globally-distributed-database) and [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases). [Life Beyond Distributed Transactions](/papers/life-beyond-distributed-transactions-an-apostates-opinion) instead limits atomic transactions to a single entity and handles agreement across entities in the application. For the anomalies that interleaving allows, see [A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels).

Worth knowing first: ACID transactions, two-phase locking, write-ahead logging and undo, and what a crash recovery procedure does.

## Contribution

- **The saga.** An LLT that can be written as sub-transactions T1, ..., Tn that may be interleaved in any way with other transactions. Each Ti is a real transaction that preserves database consistency, but the Ti are related and should run as a (non-atomic) unit.
- **Compensating transactions.** Each Ti (except the last) comes with a Ci that undoes the effects of Ti from a semantic point of view, without necessarily restoring the state before Ti. In the paper's airline example, canceling a reservation does not store the old seat count, because other transactions may have changed it in the meantime.
- **The guarantee.** Either T1, T2, ..., Tn runs (the preferable outcome) or T1, ..., Tj, Cj, ..., C1 runs for some j before the end. The paper states plainly that other transactions may see the effects of a partial saga, and that no effort is made to notify or abort transactions that saw Ti before Ci ran.
- **A relationship to nested transactions.** A saga is like a nested transaction, except that it has only two levels (the saga and simple transactions) and does not provide full atomicity at the outer level.
- **Commands and a recovery component.** begin-saga, begin-transaction, end-transaction (carrying the identity of the compensating transaction), abort-transaction, abort-saga, end-saga and an optional save-point, handled by a Saga Execution Component (SEC) on top of the ordinary Transaction Execution Component (TEC).
- **Design guidance** for turning LLTs into sagas (Section 9) and a way to run sagas on an existing DBMS (Section 7).

## Methodology

The paper is a design and argument paper. It defines the programmer interface, then walks through the mechanism: reliable storage of application code (Section 3), backward recovery (4), forward recovery (5), errors inside compensating transactions (6), running on an existing DBMS (7), parallel sagas (8) and design advice (9). The scope is a centralized database; the authors say they leave distributed systems out for lack of space. Examples (airline reservations, bank interest, purchase orders, a university graduation check, adding tracing to an operating system's source) illustrate the ideas.

The SEC logs every saga command before acting, and uses the TEC for the individual transactions. It needs no concurrency control of its own, because the transactions it runs may interleave with others. The log is assumed merged with the TEC's log and duplexed. After a crash, the TEC cleans up pending transactions first; then the SEC looks at each saga, and a saga with a begin-saga but no end-saga entry is treated as aborted. Backward recovery runs the compensating transactions for the last executed transaction and all earlier ones, in reverse order. Forward recovery needs reliable copies of the code of the missing transactions plus a save-point. Combining both gives backward/forward recovery: compensate back to the save-point, then restart.

## Findings

The paper reports no measurements, so these are claims of design, not results.

- **Pure forward recovery needs no compensation.** If save-points are taken automatically at the start of every transaction and abort-saga is prohibited, backward recovery is never needed, assuming each sub-transaction eventually succeeds if retried enough. The paper suggests the bank's interest computation as a candidate.
- **A failed compensating transaction is a real problem.** If a compensating transaction hits a bug, it cannot be aborted usefully nor completed. The proposed answers are recovery blocks (an alternate block of code) or manual repair. During manual repair the saga holds no locks, so it does not hurt other transactions.
- **Sagas can run without changing the DBMS.** Saga commands become subroutines that store their state in database tables, and a "saga daemon" does the SEC's recovery work. This requires the DBMS to store large unstructured objects (code and save-points), gives the programmer more responsibilities and may hurt performance.
- **Parallel sagas are possible but harder.** With fork and join routed through the SEC, a child's compensations must precede compensations of earlier transactions of its parent. Forward recovery can hit inconsistent save-points (cascading roll-backs).
- **Compensation is not always possible.** Designing compensating transactions is called "a difficult problem in general" (firing a missile cannot be undone). Many real actions can be compensated, for example reserving a rental car, sending a corrective letter or sending a stop-payment message for a check.
- **Design matters.** If an LLT keeps money in a local variable between T1 and T3, other transactions see inconsistent data, so the temporary state should live in the database (for example a funds-in-transit relation). The authors recommend designing the database with LLTs in mind.
- **The performance claim is a belief.** The conclusion says sagas "can be implemented with relatively little effort" and improve performance significantly. Neither is measured.

## Critical Analysis

The idea is simple and the paper is candid about its edges, but it leaves things open.

- **No evaluation.** There is no implementation, benchmark or simulation. The benefit comes from the argument that locks are held for a shorter time, with only the deadlock and blocking arguments of the introduction behind it.
- **Isolation is given up, not repaired.** The paper says other transactions can see partial results and are not told when compensation happens. It does not define which anomalies this allows. Section 9 gives a design technique (keep intermediate state in the database, make the audit transaction aware of it) but no general method.
- **Compensation is semantic and application-specific.** The programmer must write each Ci, and the paper accepts that some actions (the missile, to some extent the letter and the check) can only be compensated by a further real-world action. Whether a given LLT is safe to split is left to the programmer's judgment.
- **Centralized only,** and the recovery sections sometimes lean on the programmer for correctness (code that survives crashes, no direct system calls when run over an existing DBMS).
- **Later literature (not part of the 1987 paper).** The term is now widely used for multi-service business operations without a distributed transaction. The microservices.io pattern page by Chris Richardson (which I read) defines a saga as "a reliably coordinated sequence of local transactions" with compensating transactions, and lists lack of automatic rollback and lack of isolation as drawbacks needing "countermeasures". That page does not cite the 1987 paper, and I did not verify how the modern pattern, with its orchestration and choreography styles, differs in detail from this paper's single-DBMS setting.

## Further Research

- A precise model of what interleaving with partial sagas allows, and which isolation anomalies result.
- Methods to decide whether an LLT can be split, and to derive or verify compensating transactions.
- Sagas in distributed systems, which the paper explicitly leaves out.
- Compensation for actions with external effects, and what to do when a compensating transaction itself fails.
- Measurements of the blocking and deadlock reduction that the paper only argues for.
