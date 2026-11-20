---
title: "On the Duality of Operating System Structures"
summary: Lauer and Needham argue that the 1970s "message-oriented" and "procedure-oriented" operating system designs are duals, mapping construct by construct onto each other with the same program logic and, they claim, the same performance, so the choice between them should follow the machine architecture, not the application.
researchArea: Operating Systems
keywords: duality, message-oriented systems, procedure-oriented systems, monitors, Mesa, process synchronization, CAP computer, kernel design
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Many operating system designs can be placed into one of two very rough categories, depending upon how they implement and use the notions of process and synchronization. One category, the "Message-oriented System," is characterized by a relatively small, static number of processes with an explicit message system for communicating among them. The other category, the "Procedure-oriented System," is characterized by a large, rapidly changing number of small processes and a process synchronization mechanism based on shared data. In this paper, it is demonstrated that these two categories are duals of each other and that a system which is constructed according to one model has a direct counterpart in the other. The principal conclusion is that neither model is inherently preferable, and the main consideration for choosing between them is the nature of the machine architecture upon which the system is being built, not the application which the system will ultimately support.

## Overview

The paper was presented at the Second International Symposium on Operating Systems (IRIA, October 1978) and reprinted in ACM SIGOPS Operating Systems Review 13(2), April 1979, pp. 3-19. Hugh Lauer was at Xerox PARC and Roger Needham at Cambridge (the work was done during a summer 1977 sabbatical at PARC). The context is an argument the authors say raged in design teams: should an operating system be built from a few processes that exchange messages, or from many light processes that call procedures and synchronize on shared data? They state that the debates over the process mechanism of the Mesa language and system, at PARC and at the System Development Division, are what made them write the analysis.

The paper is a position paper built on two idealized models and informal argument. It calls itself "an empirical paper, in the sense of empirical studies in the natural sciences", yet it also says its observations rest on informal arguments, not formal proofs.

Worth knowing first: processes and semaphores or locks, Hoare's monitors (a lock plus condition variables attached to a module), and what a context switch costs.

Related catalog papers, as pairings of mine (the 1978 paper cannot cite them): [Implementing Remote Procedure Calls](/papers/implementing-remote-procedure-calls) builds a procedure-call interface on top of packets, in the same Xerox Mesa environment; [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) structures an OS as cores exchanging explicit messages, a choice its authors tie to hardware; [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems) is the general protection background for the capability systems the paper cites (CAP, Hydra, Plessey System 250).

## Contribution

- **Two canonical models.** The message-oriented model has a small, static number of big processes, explicit message channels, little shared memory, and an address space tied to each process. The procedure-oriented model has many very small processes, rapid creation and deletion, communication through shared data guarded by locks, and a context tied to the function being executed instead of the process.
- **Primitives.** Message side: `SendMessage`, `AwaitReply`, `WaitForMessage`, `SendReply`, message channels, message ports, `CreateProcess` (no delete, "messy and not important"). Procedure side, as hypothetical extensions to Mesa: procedures, `FORK` and `JOIN`, monitors and `ENTRY` procedures, `NEW` and `START`, condition variables with `WAIT` and `SIGNAL`.
- **A standard resource manager in each style.** In the message model, one process with a loop that waits for a message on a set of ports and a `case` over the port. In the procedure model, a monitor with global state and one `ENTRY` procedure per service.
- **The duality mapping.** Processes and `CreateProcess` correspond to monitors and `NEW`/`START`; message channels to external procedure identifiers; message ports to `ENTRY` procedure identifiers; `SendMessage` plus immediate `AwaitReply` to a simple procedure call; delayed `AwaitReply` to `FORK` and `JOIN`; `SendReply` to `RETURN`; the main loop with `WaitForMessage` and `case` to the monitor lock and `ENTRY` attribute; the case arms to `ENTRY` declarations; selective waiting for messages to condition variables.
- **Three observations.** The programs are logically identical and textually very similar, their performance (queue lengths, waiting times, service rates) is identical under identical scheduling, and the primitives of each model can be made as efficient as the other's.

## Methodology

There is no experiment and no formalism. The authors define the two models in informal English, give the resource manager skeletons, and argue by transformation: replace each construct by its counterpart (each monitor becomes a process with a main loop, calls become `SendMessage` plus `AwaitReply`, returns become `SendReply`, condition variables become selective waiting) and check that no algorithm, data structure or interface strategy changes. The performance argument splits run time into three components (the programs' own execution, the overhead of the primitives, and queuing and waiting) and argues each is preserved. Empirical support is one case study, the Cambridge CAP computer, plus two machines cited for fast microcoded primitives.

## Findings

All claims below are the paper's own.

- **The mapping is a direct program transformation, not a simulation.** The authors stress that it is not the naive technique of simulating one set of primitives with the other. Initialization code is the only thing that moves (it comes after the procedures in a monitor, before the main loop in a process).
- **Textual identity.** If the message-oriented kernel is embedded in a strongly typed language, with the process body absorbed into the language unit and message sends typed like calls or `FORK`s, the dual system is "textually identical except for the spelling of certain keywords".
- **Performance by argument.** The primitives are said to have the same complexity (send versus call or `FORK` to an `ENTRY` procedure, leaving a monitor versus waiting for new messages, process switching, scheduling, virtual memory). This is explicitly "assert[ed] without proof". Evidence cited: the GEC 4080, with message queuing, process switching and dispatching in microcode, and a Mesa implementation with the dual operations in microcode at similar speed.
- **Where it showed up in practice: CAP.** In the Cambridge CAP computer, a process that managed system internal names (a central directory with reference counts) was found too expensive because of the message system, and was incorporated in each process as a protected procedure. The text "hardly had to be changed at all". The authors note the rest of the CAP operating system was then written in a style that "turned out to be strikingly similar to the abstract models of this paper".
- **The choice is second-order.** The two styles lead to similar program structure and performance (zeroth order) and similar implementation complexity (first order), so the basis for choosing is the substrate: virtual memory organization, state size on a context switch, ease of scheduling and dispatch, devices and interrupts, instruction set and registers. Example: where the process is tied to virtual memory and message blocks are easy to queue but a protected call is hard, use messages; on a system with an Algol-like stack and block-structured allocation, procedures.
- **A sociological claim.** The authors say that corridor arguments over processes and synchronization are about issues "this analysis suggests are irrelevant", and that the word "process" means very different things in the two worlds.
- **Classification of real systems.** Message-oriented: IBM OS/360 and the GEC 4080. Procedure-oriented: HYDRA and the Plessey System 250 (the canonical procedure model is written as hypothetical Mesa extensions). They also say attempts to combine fundamental characteristics of the two categories "met with failure or have been abandoned".

## Critical Analysis

- **Not a proof and not a measurement.** The paper says its arguments are informal, the performance equality is asserted without proof, and no system is measured. The authors concede the conclusion "defies belief" among colleagues and that "time will tell".
- **Conditions for the equivalence.** It assumes programs written strictly in the canonical resource manager style, similar processors and devices, "due care" in the kernels, and identical scheduling and queuing disciplines. The authors say the mapping fails or becomes contrived when a system's process facilities, or its resource managers, differ much from the canonical model. They name `WAIT` anywhere inside nested `ENTRY` calls as richer than waiting at message arrival, and compare it to `goto`.
- **Models, not systems.** They compare their models to frictionless surfaces: no real system matches either, and most systems mix both. They also note most operating systems are hard to restructure for "accidental reasons" (addressing, global data), which is why there are few examples.
- **Scope.** The text is about one kernel and its machine architecture. It does not discuss network communication, node failure, or message loss, so the argument says nothing about whether procedure-style calls remain equivalent across machines.
- **Later literature (not part of this paper, not verified in depth).** Lampson and Redell, "Experience with Processes and Monitors in Mesa" (Communications of the ACM 23(2), 1980, DOI 10.1145/358818.358824), is the Mesa follow-up on the procedure-oriented side; I confirmed its metadata only and did not read it. In the catalog, the Multikernel and RPC pages show message passing and procedure calls each chosen for reasons tied to hardware or distribution, which fits the "substrate" argument, but those papers do not cite this one.

## Further Research

- Test the equivalence on a real kernel: port one subsystem across both styles and measure queue lengths, context switches and latency, which the paper only argues.
- Find the constructs without a dual (the paper asks whether such a primitive is "elegant" or "overimaginative"), and the boundary where the mapping breaks.
- Study the case with machines and failures: how distribution changes the cost of a call versus a message, starting from [Implementing Remote Procedure Calls](/papers/implementing-remote-procedure-calls).
- Read the later debates (threads versus events, actors, microkernels versus monolithic kernels) against this paper; I did not verify those sources here.
- Use the paper's suggestion of a uniform model of component interactions to predict performance before a system is designed.
