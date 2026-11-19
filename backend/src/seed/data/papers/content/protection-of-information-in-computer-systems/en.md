---
title: "The Protection of Information in Computer Systems"
summary: Saltzer and Schroeder write the 1975 tutorial that names the classic protection design principles (economy of mechanism, fail-safe defaults, complete mediation, open design and others) and builds descriptors, capabilities and access control lists from a single model of walls, doors and guards.
researchArea: Operating Systems
keywords: protection, design principles, least privilege, capabilities, access control lists, descriptors, protected subsystems, multics
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This tutorial paper explores the mechanics of protecting computer-stored information from unauthorized use or modification. It concentrates on those architectural structures, whether hardware or software, that are necessary to support information protection. The paper develops in three main sections. Section I describes desired functions, design principles, and examples of elementary protection and authentication mechanisms. Any reader familiar with computers should find the first section to be reasonably accessible. Section II requires some familiarity with descriptor-based computer architecture. It examines in depth the principles of modern protection architectures and the relation between capability systems and access control list systems, and ends with a brief analysis of protected subsystems and protected objects. The reader who is dismayed by either the prerequisites or the level of detail in the second section may wish to skip to Section III, which reviews the state of the art and current research projects and provides suggestions for further reading.

## Overview

This is an invited tutorial in Proceedings of the IEEE (volume 63, number 9, pages 1278 to 1308, 1975) by Jerome Saltzer and Michael Schroeder, both at Project MAC and the EECS department at MIT. The manuscript was received in October 1974 and revised in April 1975. The date matters for reading it: the paper looks at a world of time-sharing machines, terminals and telephone lines, where the IBM System/360 had only a privileged state and a memory protection key, and "fetch protect" became standard in IBM's architecture only in 1970.

The authors say plainly that no complete method exists to build a large system without protection flaws, so they offer experience-based principles and a bottom-up series of models. The paper is about direct access by executing programs (LOAD and STORE), not about privacy, which it defines as a socially defined ability and leaves aside.

Worth knowing first: what a segment and a base-and-bound register are, and what a supervisor does. Pairings below are mine, the 1975 paper cannot cite them. [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) is one of the systems the paper lists among those trying user-specified protected subsystems. [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) is access control lists at Google scale. [Spectre](/papers/spectre-attacks-exploiting-speculative-execution) and [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) bear on two themes the authors raise: hardware that was assumed to isolate, and certifying a protection kernel. For the app's concept on today's authorization models, see [Authorization models](/identity-concepts/authorization-models-rbac-abac-rebac-and-policy-engines).

## Contribution

- **A vocabulary and a model.** Protection is a wall around each object, a door in it and a guard at the door, who demands a match between something he knows and something the requester possesses. Terms such as principal, domain, descriptor, capability and access control list are defined in the glossary and used throughout.
- **Eight design principles, plus two.** Economy of mechanism, fail-safe defaults (credited to E. Glaser, 1965), complete mediation, open design, separation of privilege (credited to R. Needham, 1973), least privilege, least common mechanism, and psychological acceptability. Two more, work factor and compromise recording, come from physical security and "apply only imperfectly to computer systems". The authors call the principles warnings, not absolute rules.
- **Functional levels.** Unprotected, all-or-nothing, controlled sharing, user-programmed sharing controls (protected subsystems) and "putting strings on information".
- **Two families of sharing mechanism.** List-oriented (the guard holds a list) and ticket-oriented (the user holds unforgeable tickets), developed as access control list systems and capability systems.
- **Authority to change authorization.** Self control and hierarchical control, plus a "prescript" field for checks on abuse of authority, and the split between discretionary and nondiscretionary controls with confinement of borrowed programs.

## Methodology

There are no experiments. The method is a bottom-up sequence of models, each fixing a defect of the last: an isolated virtual machine with a descriptor register (base and bound) and a privileged state bit; authentication by passwords or enciphered handshake; shared descriptors with read and write permission bits; segments with unique, never-reused identifiers and a separation of addressing from protection; a tagged-memory capability system; access controllers holding access control lists; shadow capability registers; and protected subsystems entered through an ENTER permission. The authors say their bottom-up choice differs from the judgment of some colleagues, and that the models serve to explain concepts, not particular systems. Section III then surveys real systems and research.

## Findings

All claims below are from the paper.

- **Principles, as stated.** Economy of mechanism: keep the design as simple and small as possible, since unwanted access paths are not noticed in normal use. Fail-safe defaults: base access decisions on permission rather than exclusion. Complete mediation: every access to every object must be checked, and remembered authority checks must be updated when authority changes. Open design: the design should not be secret, only keys and passwords. Separation of privilege: two keys are more robust than one. Least privilege: the least set of privileges for the job. Least common mechanism: minimize mechanism shared by all users, for example a library procedure rather than a supervisor procedure. Psychological acceptability: the human interface must be easy, so users apply protection correctly.
- **Work factor.** The paper's example is the four-letter alphabetic password: 26 to the 4th power is 456,976 attempts, a minor barrier to an attacker who can try a million passwords per second. It notes that many mechanisms resist direct work factor calculation.
- **Compromise recording.** Useful only if the record is tamperproof, and rarely used in computers because a clever attacker can undo logical damage and internal records.
- **Capabilities.** An unforgeable ticket. Virtues: efficiency (if the accessor can present one, the request is valid), simplicity and flexibility. Problems: revocation, propagation and review of access. Mitigations discussed: a copy bit, capability-holding segments, a depth counter (CTSS used a software version with depth limit two) and Redell's indirect objects.
- **Access control lists.** Checked on every access, so revocation is manageable and the question "who may access this segment" has a direct answer. Costs: serial memory references, a search with possibly several principal identifiers, and variable-length list allocation. One popular implementation allowed three entries (creator, one group, all users).
- **They are combined.** "Most real systems use a combination of these two forms, the capability system for speed and an access control list system for the human interface."
- **Multics.** In 1969 Multics implemented "a complete descriptor-based access control list system with hierarchical control of authorization" on the Honeywell 645, and in 1973 rings of protection with argument address validation reached hardware on the Honeywell 6180. The paper says Multics uses software-interpreted access control lists with hardware-interpreted descriptor tables.
- **Authentication.** In one study of about 300 self-chosen passwords, more than 50 percent were guessable by exhaustion or derived from the owner. The paper also describes storing passwords through a hard-to-invert transformation, and the masquerading attack on one-way schemes.
- **Open problems (Section III).** Certification of correctness, invulnerability to single hardware faults, constraints after release, encipherment, and better authentication. A minimum protected kernel "has not yet been established".

## Critical Analysis

What the paper does not claim: it gives no evidence that following the principles prevents flaws, no formal model or proof, and no winner between capabilities and access control lists. It does not use the term "defense in depth", touches networks only in passing (authentication and encipherment), and leaves content-based protection (statistical access) outside the tutorial. It warns that complete confinement may be "very difficult, or perhaps impossible" because of signaling channels such as paging rate. It also admits the protection mechanisms are "clumsy to program" and poorly matched to users' mental image, a point it frames as an open research problem.

Small note: the paper counts four functional levels in its summary, but lists five items (a to e), and later refers to a "fifth level".

Later literature (not part of this paper). Miller and Shapiro, "Paradigm Regained: Abstraction Mechanisms for Access Control" (ASIAN 2003, Springer LNCS 2896; checked in the MIT-hosted copy), cite the paper for least privilege, but ask whether it is best read as least permission or least authority, and argue that capability systems were "proven" unable to enforce revocation, confinement and the *-properties because the analysis ignored access abstractions. They also quote the discretionary-control passage above.

## Further Research

- Certify a protection kernel against a precise model of goals, which the paper says is much harder for controlled sharing than for isolation. See [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) for one modern attempt, in a different setting.
- Make the specification of protection match how people think (psychological acceptability), including where users make errors.
- Revocation, propagation and review of access in capability systems, and how to coexist with discretionary and nondiscretionary controls.
- Reading the later history: Miller and Shapiro (2003) for the capability argument, and [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) for what access control lists look like at scale.
