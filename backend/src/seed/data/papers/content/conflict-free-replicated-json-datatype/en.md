---
title: "A Conflict-Free Replicated JSON Datatype"
summary: Kleppmann and Beresford define a CRDT with the full JSON data model (arbitrarily nested maps and lists, with registers at the leaves), give it formal operational semantics in which concurrent edits are merged without losing any update, and prove in an appendix that replicas that processed the same operations are in the same state.
researchArea: Distributed Systems
keywords: CRDT, JSON, collaborative editing, optimistic replication, multi-value register, Lamport timestamps, strong eventual consistency
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Many applications model their data in a general-purpose storage format such as JSON. This data structure is modified by the application as a result of user input. Such modifications are well understood if performed sequentially on a single copy of the data, but if the data is replicated and modified concurrently on multiple devices, it is unclear what the semantics should be. In this paper we present an algorithm and formal semantics for a JSON data structure that automatically resolves concurrent modifications such that no updates are lost, and such that all replicas converge towards the same state (a conflict-free replicated datatype or CRDT). It supports arbitrarily nested list and map types, which can be modified by insertion, deletion and assignment. The algorithm performs all merging client-side and does not depend on ordering guarantees from the network, making it suitable for deployment on mobile devices with poor network connectivity, in peer-to-peer networks, and in messaging systems with end-to-end encryption.

## Overview

Calendars, to-do lists, note-taking tools and shared documents keep a full copy of their state on several devices, each of which can be edited offline. Serializability would make such an application unusable when the network is poor, so the authors assume every device edits its own copy and the copies are reconciled later. The usual escape hatches lose something: "last writer wins" (used by Apache Cassandra, the paper notes) silently discards one of two concurrent writes, and asking the user to resolve every conflict is tedious. Dynamo and CouchDB keep all concurrent values for a key and leave resolution to the application, which in the paper's words amounts to supporting only a multi-value register, and naive merge functions show anomalies such as deleted items reappearing (see [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store)).

Operational transformation (OT), the technique behind collaborative editors, mostly treats a document as one flat list, and the deployed systems named in the paper (Google Docs, Etherpad, Apache Wave) rely on a single server to order operations. Atomic broadcast would remove the server, but it is equivalent to consensus and needs a quorum, which a set of phones will often lack. The paper stays below that: the only network assumption is that every message is eventually delivered to every replica, possibly late, reordered or duplicated. This is the setting of [Conflict-free Replicated Data Types](/papers/conflict-free-replicated-data-types), from which the paper takes strong eventual consistency. Individual CRDTs for registers, maps, counters and lists existed; nesting them was the open piece.

Worth knowing first: Lamport timestamps (see [Time, Clocks, and the Ordering of Events](/papers/lamport-time-clocks-ordering-of-events)), the happened-before relation, and the idea of an operation-based CRDT whose concurrent operations commute.

## Contribution

- **One datatype for the whole JSON tree.** A document is a tree of maps (string keys, no order) and lists (application-defined order), with leaves that are registers holding primitive values. Maps and lists nest arbitrarily. The paper says it knows of no earlier work that composes registers, maps and ordered lists into one such CRDT.
- **A multi-value register as the single conflict mechanism.** Two concurrent assignments to the same leaf keep both values, and the application (or the user) can resolve them later.
- **A cursor and a small command language.** `doc`, `.get(key)`, `.idx(i)`, `:=`, `insertAfter`, `delete`, `let`, `yield`. A cursor is a path of typed keys plus a final key, and it names a list element by the identifier of the operation that inserted it, not by its index.
- **Formal operational semantics.** Rules for evaluating expressions, generating operations, applying them and clearing prior state, with the structure of an operation: `op(id, deps, cur, mut)`.
- **A convergence theorem** with a proof in the appendix.

## Methodology

This is a formal paper, not an experimental one. Each replica holds a local state and only its own commands change it, producing operations that are applied locally at once and queued for broadcast. The `yield` command nondeterministically sends, receives or applies operations, which models an asynchronous network with no ordering guarantee. A remote operation is applied only if it is new and all its causal dependencies (`deps`) were already applied.

Every operation gets a Lamport timestamp `(c, p)`: a counter plus a replica id, ordered by counter and then by replica id. List order follows the RGA algorithm: each element has a `next` pointer, and `INSERT2` skips over elements with a greater timestamp so that concurrent insertions at the same position land in an order fixed by the timestamps. Deleted elements stay as tombstones with an empty presence set `pres(k)`, and map keys carry a type tag (`mapT`, `listT`, `regT`) so that values of different types under one key coexist. Deleting or overwriting "clears" only what the operation causally depends on, which leaves concurrent edits alone.

## Findings

Six worked examples (Figures 1 to 6) show the intended behavior, and the appendix proves the formal claim.

- **Concurrent assignment.** Replicas p and q set the same key to "B" and "C": both end with the register `{"B", "C"}`.
- **Edit versus removal of a subtree.** p adds "red" to a map of colors while q blanks the map and adds "green": the result keeps "red" and "green" and drops the old "blue". Edits at a lower level are not overridden by a concurrent removal above them.
- **Concurrent list creation and insertion.** Two lists created under the same key are merged, and each replica's adjacent items stay adjacent ("eggs, ham" and "milk, flour"). Which block comes first is arbitrary but identical on all replicas. A list of characters gives a text document (Figure 4).
- **Different types under one key.** A map and a list assigned concurrently to key "a" are both kept.
- **Resurrection.** If one replica deletes a to-do item while another sets its "done" field, the merged item exists with `done: true` and no title. The authors call this a limitation of the no-lost-input principle.
- **Theorem.** If two replicas that took part in a valid execution have processed the same set of operations, they have the same document state. The proof is by induction on the history length and shows that a new operation commutes with every concurrent one (insertions, deletions, assignments). Liveness (every replica eventually sees every operation) is asserted but not formalized.

## Critical Analysis

What the paper does not claim is as important as what it proves.

- **There is no implementation or measurement in this text.** The conclusion says the authors are "working on a practical implementation" and will report performance in follow-on work. The version read describes no JavaScript library, no benchmark and no application. Performance at scale, latency and memory are unexamined.
- **State grows without bound.** Tombstones are never removed, presence sets and register entries accumulate, and `deps` is defined as a full set of operation ids that the paper itself calls impractical in a real system (it suggests version vectors or dotted version vectors). Garbage collection is listed as required future work.
- **No move and no undo.** The conclusion calls a move operation (reordering list items or moving a subtree) and undo useful and leaves both to future work, so neither has defined merge semantics here.
- **Text editing is only a use of lists.** One list element per character is shown in Figure 4, but the paper does not compare it with collaborative editors in memory, speed or the quality of merged text.
- **Correctness depends on the model.** The proof covers safety on the paper's rules, with no machine-checked proof mentioned. Uniqueness constraints and other global invariants cannot be expressed by a CRDT, as the paper concedes when contrasting Bayou. The [CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) line of work (an editorial connection, not cited by this paper) frames why such invariants need coordination.
- **Preserving all input can surprise** programmers, as the to-do example shows. A schema language is suggested but not designed.

Later literature, not part of the paper and not read in full here: the Automerge project describes itself in its README as a library with CRDT implementations and a sync protocol for local-first apps, with a JavaScript package; and Crossref lists "A Highly-Available Move Operation for Replicated Trees" (Kleppmann, Mulligan, Gomes and Beresford, IEEE TPDS, 2022), whose title addresses the move gap, but only its metadata was checked.

## Further Research

- Garbage collection of tombstones and compact causal metadata, which the paper leaves open.
- Move and undo operations for lists and trees.
- Schema languages and semantic annotations (a number that is a counter rather than a register) to avoid surprising merges.
- Measured implementations: memory, merge cost and network size, and comparison with OT and list CRDTs on text editing.
- Studying what application programmers expect from merged states under concurrency.
