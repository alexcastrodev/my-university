---
title: "Implementing Remote Procedure Calls"
summary: Birrell and Nelson describe the RPC facility built for Cedar at Xerox PARC, where a remote call looks like a local procedure call through generated stubs, binds through the Grapevine database, and runs over a purpose-built packet protocol with implicit acknowledgments and almost no connection state.
researchArea: Distributed Systems
keywords: remote procedure call, stubs, binding, transport protocol, call semantics, performance
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Remote procedure calls (RPC) appear to be a useful paradigm for providing communication across a network between programs written in a high-level language. This paper describes a package providing a remote procedure call facility, the options that face the designer of such a package, and the decisions we made. We describe the overall structure of our RPC mechanism, our facilities for binding RPC clients, the transport level communication protocol, and some performance measurements. We include descriptions of some optimizations used to achieve high performance and to minimize the load on server machines that have many clients.

## Overview

The paper appeared in ACM Transactions on Computer Systems in February 1984 (an earlier Xerox PARC report, CSL-83-7, is dated December 1983). It comes from the Cedar project, a programming environment on single-user Dorado workstations, written in Mesa and connected by 3 Mbps Ethernets inside the Xerox research internetwork. The authors observed that building communicating programs was hard and left to a small group of communication experts. Their aim was to make distributed computation easy, by giving communication "almost as much ease as local procedure calls", while keeping it fast and secure.

The idea of RPC was not new; the paper cites a 1976 discussion and Nelson's doctoral dissertation, and says full implementations were rarer than paper designs. The contribution here is a complete, working design, and its hardest question is what a call means when machines or the network fail. It is the ancestor of the RPC layers behind later systems; compare how a consensus group such as [Raft](/papers/raft-understandable-consensus-algorithm) is specified in terms of RPCs between servers. Worth knowing first: what a transport protocol and an acknowledgment are.

## Contribution

- **Procedure calls as the abstraction.** The authors chose it because procedure calls were the main control and data transfer mechanism in Mesa. They state a principle: remote call semantics should be as close as possible to local call semantics. For example, there is no time-out limiting a remote call when no failure occurs.
- **Stubs and RPCRuntime.** Five pieces take part in a call: the user, the user-stub, the RPCRuntime, the server-stub and the server. The stubs are generated automatically by a program called Lupine from a Mesa interface module. RPCRuntime handles retransmission, acknowledgments, packet routing and encryption.
- **Binding through Grapevine.** An interface name has a type and an instance. Both are Grapevine names, so an importer finds an exporter through a replicated database instead of a hard-wired address.
- **A transport protocol made for RPC.** Instead of byte streams, a protocol where the result acknowledges the call, the next call acknowledges the previous result, and idle connections cost one table entry on the server.
- **Defined call semantics.** The guarantee when the call returns and the guarantee when it raises an exception (see Findings).

## Methodology

The paper is a design and experience report. It explains the options for each decision (message passing or remote fork versus procedure calls, shared address space versus none, time-outs, binding time, transport protocol) and says which was chosen and why. Binding is described step by step, with an export and import sequence in Figure 2. The protocol is described through figures of a simple call (Figure 3) and a complicated call (Figure 4).

Performance was measured between two Dorados on an Ethernet with a raw rate of 2.94 megabits per second, shared but lightly loaded (five to ten percent of capacity). Times were obtained by counting Dorado microprocessor cycles, accurate to about ten percent, for 12,000 calls on each test procedure, with no encryption. Each call is timed from the user program invoking the user-stub until the stub returns.

## Findings

**Call semantics.** If the call returns, the server procedure has been invoked precisely once. Otherwise an exception is reported and the procedure ran once or not at all, and the user is not told which nor whether the server crashed or the network failed. While the server's RPCRuntime keeps answering probes there is no upper bound on the wait, so a deadlocked or looping server is not detected. This is described as identical to local calls.

**Protocol.**
- A simple call is two packets: the result acknowledges the call, and the next call acknowledges the result. The call identifier is a machine identifier, a process identifier and a sequence number, and the callee keeps the last sequence number per activity to discard duplicates.
- There is no connection set-up or tear-down. An idle connection leaves one table entry, which the server may discard after about five minutes.
- A caller waiting for a long call sends probes, the first after slightly more than the round-trip time, spaced further apart until, after about 10 minutes, one every five minutes.
- Calls whose arguments or results span several packets acknowledge each packet but the last, so only one buffer is used at each end, at the cost of up to twice the packets of a bulk transfer protocol.

**Measurements (Table I, microseconds, minimum, median, transmission, local-only).**
- No arguments or results: 1059, 1097, 131, 9.
- A 100 word array argument and result: 2915, 2926, 1219, 98.
- Exception resumed by the caller: 2555, 2637, 284, 134. Exception unwound: 3374, 3467, 284, 196.
- With parallel calls from several processes the authors reached 2 megabits per second between Dorado main memories, equal to their best byte stream implementation, written in BCPL.
- The RPCRuntime is four Cedar modules of about 2,200 lines. Users included the Alpine file server, an Ethernet telephone and audio project and two network games.

## Critical Analysis

The paper is candid that it presents early experience: it says it needs more use "in earnest" before it can judge its design, and it did not measure the cost of exporting or importing an interface.

- **Performance goal.** The stated secondary aim was to stay within a factor of five of the network transmission time. By my arithmetic from Table I, the null call's median is about 8.4 times its transmission time, and the 100 word array call about 2.4 times; the paper does not claim to meet the target in every case. The null call costs about 120 times the local call (1097 against 9).
- **Failure model.** The paper treats machine crashes and communication breakdowns, and offers one visible difference from local calls, a call failed exception. It does not say how a program should recover after an ambiguous failure, for example whether to retry, and it does not use the word idempotent. Parameter passing without shared addresses and the stub generator are deferred to later papers, as is security.
- **Specialization.** Bypassing the protocol layers is called "cheating" by the authors, since it only pays because RPC is the one special case.
- **Later literature (not part of this paper).** Waldo, Wyant, Wollrath and Kendall, "A Note on Distributed Computing" (Sun Microsystems Laboratories report SMLI TR-94-29, 1994; I read a book-chapter reprint), argue that hiding the difference between local and remote calls fails, with partial failure and concurrency as the differences that cannot be masked. They cite this paper only in a list of RPC work of the 1980s, not as a target of the critique. Birrell and Nelson's own text keeps the difference visible, in the call failed exception and in the "once or not at all" guarantee.

## Further Research

- Retry and idempotence: how applications should use a call that may or may not have run (the paper leaves it to the user).
- Argument passing, stub generation and encryption-based security, which the authors announced as future papers.
- Whether a general purpose transport protocol can reach RPC performance; the authors say they were undecided.
- Cases where RPC is the wrong paradigm, which they associate with multicast and broadcast solutions.
- Tracing and diagnosing latency across many nested calls in large systems, as in [Dapper](/papers/dapper-large-scale-distributed-systems-tracing-infrastructure).
