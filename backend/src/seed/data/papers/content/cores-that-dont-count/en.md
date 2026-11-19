---
title: "Cores that don't count"
summary: A HotOS position paper from Google that names "mercurial cores", CPU cores that miscompute silently after passing manufacturing tests, describes the anecdotal evidence the authors have, and sketches research on detection, isolation and software and hardware mitigation.
researchArea: Operating Systems
keywords: mercurial cores, silent data corruption, corrupt execution errors, fail-stop, core screening, fault tolerance, position paper
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We are accustomed to thinking of computers as fail-stop, especially the cores that execute instructions, and most system software implicitly relies on that assumption. During most of the VLSI era, processors that passed manufacturing tests and were operated within specifications have insulated us from this fiction. As fabrication pushes towards smaller feature sizes and more elaborate computational structures, and as increasingly specialized instruction-silicon pairings are introduced to improve performance, we have observed ephemeral computational errors that were not detected during manufacturing tests. These defects cannot always be mitigated by techniques such as microcode updates, and may be correlated to specific components within the processor, allowing small code changes to effect large shifts in reliability. Worse, these failures are often "silent": the only symptom is an erroneous computation.

We refer to a core that develops such behavior as "mercurial." Mercurial cores are extremely rare, but in a large fleet of servers we can observe the disruption they cause, often enough to see them as a distinct problem, one that will require collaboration between hardware designers, processor vendors, and systems software architects.

This paper is a call-to-action for a new focus in systems research; we speculate about several software-based approaches to mercurial cores, ranging from better detection and isolating mechanisms, to methods for tolerating the silent data corruption they cause.

## Overview

Most system software assumes a CPU either computes correctly or stops. This paper, by Google authors at HotOS '21 (8 pages), says that assumption has quietly failed: some cores keep running and return wrong answers, for particular instructions, without any signal. The authors call these "corrupt execution errors" (CEEs) and the cores "mercurial". The paper opens with a data-analysis pipeline that started giving wrong answers after an innocent library change made servers use rarely-used instructions more heavily, and only a few machines were responsible.

It is a position paper, not a measurement study. The authors say they cannot reveal exact CEE rates for business reasons. Storage and networks have long had redundancy against corruption (ECC, checksums, CRCs), and the paper explains why computation is harder: for storage the right answer is the identity function, while checking a computation seems to cost double work, or triple to correct.

Related catalog papers: [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance) is cited as one general approach that might apply to CEEs in some cases. The later [Silent Data Corruptions in a Large Production CPU Population](/papers/silent-data-corruptions-in-a-large-production-cpu-population) (SOSP 2023, Alibaba Cloud) measures the problem, and [Orthrus](/papers/orthrus-detecting-silent-user-data-corruption-in-the-cloud) builds an online detector. Both are later than this paper and are not part of its claims.

## Contribution

- **A name and a framing.** CEEs are a cause of silent data corruption (SDC), not only a symptom. SDC was mostly blamed on alpha particles, cosmic rays and overclocking, and the paper proposes high-rate CEEs as a new cause.
- **A taxonomy of impact,** in increasing risk: wrong answers caught immediately (retry possible), machine checks, wrong answers caught too late to retry, and wrong answers never caught. Bad metadata can lose a whole file system, and a corrupted encryption key can make large amounts of data permanently inaccessible.
- **A discussion of causes and metrics,** admitting the authors cannot infer root causes without hardware test structures, and that they lack good metrics.
- **A research agenda:** detection and isolation, software mitigation, hardware mitigation, and access for researchers who are not hyperscalers.

## Methodology

There is no experimental method. The evidence is the authors' operational experience: production incidents, core-dump evidence, and a "modest corpus" of test code (real snippets, compression, hash, math, cryptography, copying, locking, fork and system call libraries, and vendor tests) chosen by intuition, with no systematic way to develop more. They can control which code runs on which core and partly control frequency, voltage and temperature (f, V, T). The only figure is the CEE incident rate per machine, user-reported and from the automatic detector, normalized to an arbitrary baseline.

## Findings

These are the paper's claims, almost all observational.

- **Rate.** "On the order of a few mercurial cores per several thousand machines", which the authors say is similar to the rate Facebook reported, and "many engineer-decades" already spent. No exact figure and no fleet size are given.
- **Characteristics.** CEEs typically hit specific cores, not the whole chip, and usually one core of a multicore CPU. Failures are mostly non-deterministic, repeat intermittently, often get worse with time, and the authors have "some evidence" that aging is a factor. They appear across vendors but not at a uniform rate, and rates vary by many orders of magnitude. Rates depend on workload and f, V, T: some cores are frequency-sensitive, some are not, and lower frequency sometimes surprisingly raises the failure rate. A data-copy defect and a vector defect shared the same hardware logic in more than one case.
- **Examples.** Lock semantics violations; load, store, vector and coherence corruption; a deterministic AES miscomputation that was "self-inverting" (encrypt and decrypt on the same core gave identity, decryption elsewhere gave gibberish); garbage-collection corruption in a storage system that lost live data; database index corruption depending on which replica served the query; repeated bit-flips at one bit position in strings; corrupted kernel state causing crashes.
- **Triage.** Roughly half of the suspects humans identify turn out to be mercurial cores. Reports concentrated on a few cores point to CEEs, reports spread evenly probably do not. The automatic detector's rate is gradually increasing, but the authors do not know whether the underlying rate changed.
- **Why now.** Larger fleets, more reliability attention, fewer software bugs, and, the authors argue, smaller feature sizes and more complex designs that strain manufacturing tests.

## Critical Analysis

- **The evidence is anecdotal.** The only quantity is a range ("a few per several thousand machines") and a normalized chart, with no fleet size, denominator, test coverage or confidence. The paper itself says its understanding is "primarily empirical". Note that the text says several thousand machines, not a few per thousand.
- **Detection claims are not evaluated.** Screening ideas, the report-a-suspect RPC service and self-checking libraries are described, not measured. The authors also note that their test corpus is unsystematic.
- **Later literature.** The rate and causes this paper could not give were addressed by [Silent Data Corruptions in a Large Production CPU Population](/papers/silent-data-corruptions-in-a-large-production-cpu-population), a later and much larger study at Alibaba Cloud (literature after this paper, not something the paper claims). Its numbers are not compared here.

## Further Research

- Detect novel defect modes and record forensic evidence across fleets, with testing as part of the whole CPU lifecycle (pre and post deployment, online and offline, infrastructure and application level).
- Isolate single cores in schedulers, or find tasks that avoid a defective unit.
- Mitigate in software: end-to-end checks, checkpointing to retry on another core, application invariants, double computation, triple modular redundancy possibly compiler-inserted using deterministic-replay ideas, and critical-function libraries.
- Mitigate in hardware: design-for-test, continuous verification, conservative design, a rethought machine-check architecture and better CPU telemetry.
- Open for researchers without a fleet: mercurial-core machines made available as IaaS, CEE-injecting simulators, fault injectors, and CEEs in GPUs and other accelerators.
