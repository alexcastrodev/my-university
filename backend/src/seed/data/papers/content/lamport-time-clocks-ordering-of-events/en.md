---
title: "Time, Clocks, and the Ordering of Events in a Distributed System"
summary: Lamport's founding paper on distributed time, which defines the "happened before" partial order from messages alone, adds logical clocks that extend it to a total order, uses that order to build a distributed mutual exclusion algorithm and the state machine approach, and then bounds how far synchronized physical clocks can drift apart.
researchArea: Distributed Systems
keywords: logical clocks, happened-before, partial order, total order, state machine replication, mutual exclusion, clock synchronization
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A distributed system consists of a collection of distinct processes which are spatially separated, and which communicate with one another by exchanging messages. A network of interconnected computers, such as the ARPA net, is a distributed system. A single computer can also be viewed as a distributed system in which the central control unit, the memory units, and the input-output channels are separate processes. A system is distributed if the message transmission delay is not negligible compared to the time between events in a single process. We will concern ourselves primarily with systems of spatially separated computers. However, many of our remarks will apply more generally. In particular, a multiprocessing system on a single computer involves problems similar to those of a distributed system because of the unpredictable order in which certain events can occur.

The concept of one event happening before another in a distributed system is examined, and is shown to define a partial ordering of the events. A distributed algorithm is given for synchronizing a system of logical clocks which can be used to totally order the events. The use of the total ordering is illustrated with a method for solving synchronization problems. The algorithm is then specialized for synchronizing physical clocks, and a bound is derived on how far out of synchrony the clocks can become.

## Overview

This paper, published in Communications of the ACM in July 1978, is one of the founding texts of distributed computing. It was written when networks such as the ARPA net were new, and it starts from an observation that sounds obvious today: in a system where messages take time, there is often no meaningful answer to "which of these two events happened first?". Everything else in the paper follows from taking that seriously. Lamport would later build on the same ideas in [The Part-Time Parliament](/papers/paxos-part-time-parliament) and [Paxos Made Simple](/papers/paxos-made-simple), which agree on a single ordering of commands across servers.

The core idea is to define time without any physical clock. Events inside one process are ordered by the process itself, a message send comes before its receipt, and the relation is closed under transitivity. What cannot be connected this way is called concurrent. The rest of the paper asks what can be done with that relation: number events consistently, order them totally, and finally compare the result with real, imperfect physical clocks.

Worth knowing first: what a process and a message are in a message-passing system, what partial and total orders are, and what a mutual exclusion problem asks for. The paper uses a space-time diagram borrowed from special relativity, and the text explains it, so no physics is needed.

## Contribution

- **The "happened before" relation.** Written "->", it is the smallest relation where (1) events of one process are ordered by that process, (2) the send of a message precedes its receipt, and (3) the relation is transitive. Two events are concurrent if neither precedes the other. The paper reads "a -> b" as "a can causally affect b".
- **The Clock Condition and logical clocks.** A clock only assigns numbers to events, with no relation to physical time. It is correct if a -> b implies C(a) < C(b). Two implementation rules give it: IR1, each process increments its clock between any two successive events, and IR2, every message carries the sender's timestamp and the receiver sets its clock beyond that value.
- **A total order from the partial one.** Ordering events by timestamp and breaking ties with an arbitrary fixed order of the processes extends "->" to a total order. The paper notes this order is not unique and that only the partial order is determined by the events.
- **Distributed mutual exclusion.** A five-rule algorithm built on timestamped request, acknowledgment and release messages, with no central coordinator.
- **The state machine approach.** Each process simulates the same state machine and applies commands in timestamp order, which generalizes the mutual exclusion example to any synchronization.
- **Anomalous behavior and physical clocks.** The paper names the case where the system order disagrees with the order users perceive, and gives a clock synchronization rule plus a theorem that bounds the skew.

## Methodology

The paper is a sequence of definitions, rules and informal proofs, with no implementation or measurements. It first fixes the model: processes are sequences of events, and sending or receiving a message is an event. It then states a correctness condition for clocks, shows that two simple rules imply it, and shows how a total order follows.

To show the order is useful, it takes a concrete problem, a shared resource that must be granted in request order, and argues that a central scheduler does not solve it. Then it gives the five-rule algorithm and checks its three required conditions one by one. For anomalous behavior, it introduces a larger set of events that includes external ones, and defines a Strong Clock Condition over them. The last part moves to physical clocks, with two assumptions (a bound on the clock rate error and a bound on how different two clocks may read) and proves a theorem about them in the Appendix.

## Findings

- **Events often have no order.** A process cannot know what another process did at an event until it receives a message that depends on it, even if a diagram suggests the other event came earlier in physical time. Concurrent events are simply unordered.
- **Logical clocks satisfy the Clock Condition, but not its converse.** The converse would force all concurrent events to carry the same time, which contradicts the condition itself, so a smaller timestamp does not mean the event happened before.
- **A central server that grants requests in arrival order is not correct.** If P1 sends a request to the scheduler P0 and then a message to P2, which sends its own request, P2's request can reach P0 first, and the order requirement is violated.
- **The mutual exclusion algorithm meets all three conditions.** A process holds the resource when its request is first in its local queue under the total order and it has received a message from every other process timestamped later than the request. The paper also notes that the whole scheme stops if one process fails, because every process must know all commands.
- **Failure needs physical time.** Without it, a failed process cannot be told apart from one that is just pausing between events.
- **Anomalous behavior is real.** If a user issues request A on one machine and then phones a friend who issues request B on another, B can get the lower timestamp. The paper offers two fixes: the user passes the timestamp along, or the clocks are physical and satisfy the Strong Clock Condition.
- **A bound for synchronized physical clocks.** For typical crystal-controlled clocks the paper gives a drift rate of at most 10^-6, and requires that clocks are never set backward. For a strongly connected graph of diameter d, with a message sent over every arc every tau seconds and unpredictable delay below xi, the clocks stay within roughly d(2 kappa tau + xi) of each other once enough time has passed, where kappa is the drift bound. The paper calls the proof surprisingly difficult and believes the theorem to be a new result.

## Critical Analysis

The paper is short and its central idea has aged very well, but a reader should keep some limits in mind.

- **The total order is arbitrary.** It respects causality, but concurrent events are ordered by clock values that carry no real meaning, with ties broken by process identity, and a process learns the order only after hearing from every other process.
- **Scalar timestamps lose information.** A smaller timestamp does not tell you whether two events are causally related. The paper does not address this, and it is why later work introduced vector clocks.
- **The algorithms assume reliable channels.** Messages are received in order and always arrive, and the paper says these assumptions can be dropped with message numbers and acknowledgments. The resulting algorithm still needs every process to take part, so one failure stops the system.
- **The physical clock part is idealized.** It assumes a Newtonian space-time, continuous clocks and a known minimum message delay, which real networks only approximate.
- **The generalization is only promised.** The conclusion promises a later paper on extending the method to any synchronization problem, so the generalization here is sketched, not worked out.

Book versus today: the paper's treatment of failure is brief on purpose, and later consensus work such as [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) handles crashes without needing every process to answer. Modern systems also use physical time more directly than the paper suggests, for example in [Spanner](/papers/spanner-globally-distributed-database) and [Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks). A total order from a log, as in [CORFU](/papers/corfu-shared-log-design-for-flash-clusters), plays the role of the timestamp order.

## Further Research

- Vector clocks and related structures that capture causality exactly, and hybrid logical clocks that combine logical and physical time.
- Causal consistency in real services, for example [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) and [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications).
- Fault-tolerant versions of the state machine approach, based on consensus.
- Clock synchronization with bounded error, and the systems that rely on it, as in [Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks).
- Ordering provided by the network itself, as in [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering).
