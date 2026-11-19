---
title: "Distributed Snapshots: Determining Global States of Distributed Systems"
summary: Chandy and Lamport show how processes with no shared clock can record their own states and their channels' states, using marker messages, so that the recorded global state is meaningful, and use it to detect stable properties such as termination and deadlock.
researchArea: Distributed Systems
keywords: distributed snapshots, global state, markers, stable property detection, termination detection, deadlock detection, checkpointing
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper presents an algorithm by which a process in a distributed system determines a global state of the system during a computation. Many problems in distributed systems can be cast in terms of the problem of detecting global states. For instance, the global state detection algorithm helps to solve an important class of problems: stable property detection. A stable property is one that persists: once a stable property becomes true it remains true thereafter. Examples of stable properties are "computation has terminated," "the system is deadlocked" and "all tokens in a token ring have disappeared." The stable property detection problem is that of devising algorithms to detect a given stable property. Global state detection can also be used for checkpointing.

## Overview

In 1985 the question "what is the state of a distributed system right now?" had no clean answer, because no process can see the others and there is no common clock. The paper notes that Gligor and Shattuck had stated that many published deadlock and termination detection algorithms were incorrect and impractical, and suggests the cause is that the relationships among local process states, global system states and points in a computation were not well understood. Defining those relationships is one of its stated contributions.

It builds on [Time, Clocks, and the Ordering of Events](/papers/lamport-time-clocks-ordering-of-events), which the paper cites for the partially ordered view of computations, but it does not use logical clocks: the algorithm needs only message order on each channel. Leslie Lamport's own publications page calls the algorithm a straightforward application of the basic ideas from that earlier paper.

The paper's picture is a group of photographers photographing a sky full of migrating birds. The snapshots cannot be taken at the same instant and must not disturb the scene, yet the composite must be "meaningful". The paper's task is to define "meaningful" and to say how to take the photographs.

Worth knowing first: the idea of an event, the happened-before view of concurrency, and the difference between a property of one process and a property of the whole system.

## Contribution

- **A model.** A finite set of processes and channels, described as a directed graph. Channels have infinite buffers, are error-free and deliver messages in the order sent, with arbitrary but finite delay. A process is a set of states, an initial state and atomic events, each of which changes the process and at most one channel. A global state is the set of all process states and channel states.
- **A requirement.** The snapshot algorithm runs on top of the underlying computation and must not alter it. A process can record only its own state and the messages it sends and receives.
- **The marker algorithm.** Marker-sending rule: after recording its state, and before sending further messages on a channel, a process sends one marker on each outgoing channel. Marker-receiving rule: on receiving a marker on a channel, if the process has not recorded its state it records it and records that channel as empty; otherwise it records that channel as the messages received on it after its own recording and before the marker.
- **A correctness theorem.** The recorded state S* can be reached from the global state where the algorithm started, and the state where it ended can be reached from S*.
- **An application.** Detecting stable properties, with termination and deadlock detection as special cases.

## Methodology

The paper is a derivation and a proof, with no implementation or measurement. Example 3.1 uses a "single-token conservation" system with two processes and two channels. If the state of process p is recorded before p sends the token, but the channel is recorded after the send, the composite state shows two tokens, which is unreachable. Recording the channel before the send and p after it shows none. The paper turns this into counting conditions: with n and n' the messages sent on a channel before the sender and the channel are recorded, and m and m' the messages received before the receiver and the channel are recorded, consistency needs n = n' and m = m'. Since n' >= m', it follows that n >= m. The recorded channel state is therefore the messages sent before the sender's recording minus those received before the receiver's recording, and the marker is the device that lets the receiver find that boundary.

Theorem 1 is proved by rearranging the real computation. An event is prerecording if its process has not yet recorded its state, and postrecording otherwise. If a postrecording event immediately precedes a prerecording event, they are on different processes, the second cannot receive what the first sent (the marker, and FIFO delivery, would make it postrecording too), and so the two can be swapped without changing the states. Repeated swaps give a computation in which all prerecording events come first, and the global state between the two groups is S*. Example 4.1 does this swap on a concrete trace.

## Findings

- **The recorded state need not have occurred.** In Example 2.2 the algorithm starts in global state S0 and ends in S3. The recorded S* has p in state A, q in state D, channel c empty and channel c' holding the message M'. It equals none of S0, S1, S2 or S3. The paper asks "of what use is the algorithm if the recorded global state never occurred?" and answers with Theorem 1.
- **Theorem 1.** If the algorithm starts in global state S_a and ends in S_b during a computation, there is another computation that permutes only the events between those two points, agrees with the original outside them, and passes through S* somewhere between them. So S* is reachable from S_a, and S_b is reachable from S*. The paper does not claim the real system passed through S*.
- **Termination.** The algorithm finishes in finite time if no marker stays forever in a channel and every process records its state in finite time. In a strongly connected graph, one spontaneous initiator is enough. Collecting the recorded pieces is left to other algorithms, with a simple flooding scheme sketched for strongly connected systems.
- **Stability detection.** A property is stable if, whenever it holds in a global state, it holds in every state reachable from it. The algorithm records S* and sets definite := γ(S*), where γ is the property. The output satisfies: if γ holds when the algorithm starts, then definite is true; if definite is true, then γ holds when the algorithm ends. So definite = true is a statement about the end, and definite = false only says the property did not hold at the start, not that it is false at the end. Correctness uses reachability both ways plus the definition of stability.
- **Phases.** The paper notes that "the system is deadlocked" is not strictly stable if the deadlock is broken and computation restarts, and handles that by treating "the kth phase has terminated" as the stable property.

## Critical Analysis

The paper is short and precise about what it proves. The points below are limits of the text, followed by later literature, marked as such.

- **The model excludes failures.** Channels are error-free and FIFO, and processes do not fail. The paper does not discuss crashed processes, lost or reordered messages, or what a snapshot means if a process stops before recording. Its keywords mention checkpoint/restart and fault tolerance, but the text develops only stable property detection.
- **Initiation and collection are left open.** What makes a process record spontaneously is postponed and not taken up again, and collection of the recorded pieces relies on cited work.
- **Infinite buffers and a fixed topology.** The paper calls infinite buffers a convenience, allowing bounded buffers if no process can overfill one. It does not treat membership changes.
- **Unstable properties get no guarantee.** For a property that can become false again, a snapshot says nothing reliable about the present.
- **Cost is not analysed.** There is no count of markers beyond one per channel, no study of how often to snapshot, and no performance evaluation.

Later literature (not part of the 1985 paper). Lamport's publications page adds that the algorithm arose in a conversation with Chandy, and that he regards it as a straightforward application of ideas from the clocks paper. The same page records that neither author remembers the unpublished "On Partially-Ordered Event Models of Distributed Computations" cited here. A checkpointing use in stream processing appears in Carbone et al., "Lightweight Asynchronous Snapshots for Distributed Dataflows" (arXiv 1506.08603). I read only its abstract: it says that existing periodic global-snapshot approaches can stall the computation and persist all records in transit, and proposes Asynchronous Barrier Snapshotting, which persists only operator states on acyclic topologies and keeps a minimal record log on cyclic dataflows, implemented on Apache Flink. How it positions itself relative to this paper is not covered here.

## Further Research

- Snapshots when processes or channels can fail, and checkpointing built on recorded global states.
- Stable property detection beyond termination and deadlock, and cheaper detection for specific properties.
- Related problems of ordering and consistency: [State Machine Approach](/papers/state-machine-approach-fault-tolerant-services-tutorial) for replicated services, and [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects) for the correctness of operations on shared objects, a different question from observing a global state.
- Stream processing systems that need consistent state recovery, such as the one in [The Dataflow Model](/papers/dataflow-model-unbounded-out-of-order-data).
- Recording snapshots without stopping computation when channel state is large.
