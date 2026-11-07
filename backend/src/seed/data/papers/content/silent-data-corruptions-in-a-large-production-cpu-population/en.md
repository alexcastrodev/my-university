---
title: "Understanding Silent Data Corruptions in a Large Production CPU Population"
summary: A study of more than one million Alibaba Cloud processors that measures how often CPUs silently compute wrong results, which features, data types and temperatures trigger them and how well current defenses cope, followed by Farron, a mitigation that pairs prioritized testing with temperature control.
researchArea: Distributed Systems
keywords: silent data corruption, cpu faults, production fleet, bitflips, temperature, sdc testing, farron
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Software assumes a processor computes what its instructions say. Some processors do not, and the failure is often silent: no crash and no exception, only a wrong checksum, a wrong hash or a lost file. Checksums protect data at rest, but nothing equivalent tells you that an arithmetic instruction returned the wrong value. The authors cite Meta's report that such cases can take months of engineering to debug, and say one case at Alibaba Cloud took weeks.

This SOSP 2023 paper (Koblenz), from Tsinghua University, The Ohio State University and Alibaba Cloud, reports tests of more than one million processors from hundreds of clusters in 28 data centers across 14 countries over 32 months. The authors say it is the first quantitative and systematic study of CPU silent data corruption (SDC) in a production fleet, since earlier work was theoretical, based on fault injection, or brief. It ends with Farron, a mitigation built on the findings.

Terms to keep straight: a testcase is one of the 633 programs in the chip vendor's toolchain, and a setting is a testcase paired with one processor. A computation SDC comes from defective arithmetic, vector or floating-point units, a consistency SDC from defective cache coherence or transactional memory. Occurrence frequency is errors per minute for a setting. "Apparent" SDCs are easy to trigger near idle temperature, "tricky" ones need higher temperature and fire rarely. Failure rates here are per 10,000 CPUs (the paper writes ‱).

Worth knowing first: end-to-end checksums, ECC and erasure coding, and the sign, exponent and fraction fields of an IEEE-754 float. Two pairings with library papers, both mine and not the paper's: [Orthrus](/papers/orthrus-detecting-silent-user-data-corruption-in-the-cloud) is a SOSP 2025 paper that takes up online detection and quotes this study's 3.61 in 10,000, so it postdates this one. [Metastable failures](/papers/metastable-failures-in-distributed-systems) is not cited here, but the first Alibaba case, wrong checksum results that made an application repeat requests and hurt performance, is a small example of retry amplification.

## Contribution

- **A fleet measurement.** Testing at four moments (after factory delivery, after datacenter delivery, after reinstallation, and regularly in production), with failure rates by moment and by nine micro-architectures (M1 to M9), and a look at whether a fault hits one physical core or all cores.
- **A close look at 27 faulty processors.** The authors ran tens of millions of tests and collected more than ten thousand SDC records. They separate computation from consistency SDCs, because the second kind can only be found by multi-threaded tests, and they use Pin to count executed instruction types per testcase to narrow down suspects (an arctangent instruction for FPU1 and FPU2, transactional region instructions for CNST2).
- **A challenge to failure models.** Bitflips avoid the most significant bits of numeric types, recur at fixed positions within a setting and sometimes flip several bits, against the independent, single-flip assumptions of radiation-based models.
- **Reproducibility and triggers.** Occurrence frequency per setting, its dependence on temperature and on instruction usage stress, and a split of SDCs into apparent and tricky.
- **An assessment of defenses.** Observation 11 on how testing is wasted, and Observation 12 on why checksums, ECC, erasure coding, redundancy and prediction are weakened by CPU SDCs.
- **Farron.** It runs in three states: pre-production, online and suspected. An adaptive temperature boundary triggers workload backoff (throttling the application) and rises if more than half of recent readings exceed it, and a lower boundary gets less test time. Regular tests rank testcases as basic, active or suspected, favor those targeting features the protected application uses, and start with burn-in workloads on every core to raise temperature. Fine-grained decommission masks one defective core and retires the whole processor if more than two are defective.

## Methodology

The target is Alibaba Cloud, with processors from one unnamed manufacturer, deployed since 2017, covering nine micro-architectures. The tool is the manufacturer's toolchain: 633 testcases that mimic cloud workloads (a looped instruction, a library call or application logic) plus a framework that runs them. Pre-production tests run after factory delivery, datacenter delivery and reinstallation. In production, machines are tested in groups of about 2 weeks each, and the whole fleet takes months. Every testcase runs sequentially with equal duration, and regular testing started in January 2021. When the root cause was unclear, suspect processors were sent to the manufacturer, which confirmed all those reported, and OpenDCDiag served as a supplementary toolchain that gave the same observations.

For the 27 processors studied in depth (the others went back to the manufacturer), a bitflip pattern is a mask of expected XOR actual output shared by more than 5% of the records of a setting. Temperature came from cooling-device data in the kernel, with the Linux stress tool preheating cores and also running on other cores to separate heat from instruction stress. Farron was evaluated on six of the faulty processors (MIX1, SIMD1, FPU1, FPU2, CNST1, CNST2). Coverage is detected errors over known errors in one round of tests, and overhead is one round's duration over three months plus backoff time over simulation time. The baseline is Alibaba's practice: tests in pre-production and every three months, equal resources per testcase, whole-processor retirement.

## Findings

These are the authors' reported results.

- **Fleet rate.** 3.61 in 10,000 CPUs cause SDCs. Pre-production tests found 3.262 (90.36% of the faulty processors: 0.776 at factory delivery, 0.18 at datacenter delivery, 2.306 after reinstallation) and regular tests 0.348. The authors call this more precise than Google's and Meta's statements and say SDCs are pervasive, not a "black swan".
- **Newer chips do not help.** Every micro-architecture has faulty processors, with rates from 0.082 to 9.29 in 10,000, and the rate does not fall with newer chips.
- **Scope of a fault.** In about half of the faulty processors one physical core is defective, in the other half all are. When a defect sits in the same per-core component of every core (MIX1, MIX2), the cores fail the same testcases at frequencies that can differ by several orders of magnitude. Of the 27, 19 have computation defects and the rest consistency defects.
- **Vulnerable features.** Arithmetic logic, vector operations, floating point, cache coherency and transactional memory. Every tested data type is affected, floating point most. In MIX1 a defective instruction appears in seven testcases and only two produce errors.
- **Bitflips.** 51.08% go from zero to one (72.27% for 16-bit integers in MIX1). Floating-point flips mostly hit the fraction, so losses are small: all 80-bit cases under 0.002%, 99.9% of doubles under 0.02%, 80.25% of singles under 5%, while 40.2% of 32-bit integer losses exceed 100%. Positions repeat per setting, usually one bit, with a considerable share of two or more.
- **Reproducibility.** Frequency runs from 0.01 to hundreds of errors per minute and exceeds one per minute in 51.2% of settings. One faulty processor made a service report 26 invalid-data errors in about 4.5 hours.
- **Temperature and stress.** On 6 of 27 processors the log of frequency is linear in core temperature, with Pearson above 0.75. Testcase C on MIX1 failed only above 59 °C (idle about 45 °C). Failing testcases use the defective instruction orders of magnitude more often, and stress on other cores raised frequency at nearly constant temperature. Heat explained a core that erred only when others were busy (shared cooling), a test-order effect, and a toolchain update whose more efficient framework lowered the frequency. Minimum triggering temperature and frequency are strongly negatively correlated (Pearson 0.8272 in magnitude).
- **Testing is wasteful.** In a part of the fleet with tens of thousands of CPUs, 560 of 633 testcases found nothing, and some faulty processors err only in multi-thread conflicts the testcases do not cover.
- **Defenses, by argument.** Erasure coding recovers lost data but does not detect corruption, ECC and CRC can bless a result already wrong, standard ECC corrects one bit and detects two, redundancy is too costly for every application, and range prediction struggles with small precision losses.
- **Farron.** A regular round averages 1.02 hours against 10.55 for the baseline. Coverage in one round is higher than the baseline's (figure only). Total overhead ranges from 0.017% to 0.145%, against 0.488% for the baseline's testing, and workload backoff fired 0.864 seconds per hour on average with temperature under 59 °C.

## Critical Analysis

The authors are open that this is best effort. They concede the following.

- **Not a census.** The toolchain may miss SDCs and the authors found some it cannot detect, so false negatives and false positives are possible, and telling an SDC from other causes such as memory errors is hard. The toolchain is not public, which is why they point to OpenDCDiag.
- **Causes are hypotheses.** They say the five features may be more vulnerable or may only crash less, and give several possible reasons why rates do not fall with new chips. Fixed-position bitflips have "one potential explanation".
- **Mitigation limits.** Cooling control costs no performance but is not widely applicable at Alibaba Cloud yet, so Farron uses workload backoff. Errors beyond the toolchain need better testcases, and whether small precision losses are acceptable needs further study.

The following points are a reading of the evidence, not claims of the paper.

- **A detection rate from one vendor and one toolchain.** 3.61 in 10,000 counts what that toolchain flags. Comparing it with Google's and Meta's statements mixes tools, fleets and regimes, and the denominators of Table 1 are not stated: the four rates sum exactly to the total, which suggests one population, although regular tests only reach processors that passed pre-production. That every processor comes from one unnamed manufacturer and "represents the international mainstream" is asserted.
- **Escapes and late onset are not separated.** The 0.348 from regular tests passed pre-production, some several regular rounds. The paper does not say whether these are late-onset faults or earlier misses, and Table 3 lists age but no analysis relates age to failure. The same goes for newer chips: micro-architecture, deployment age, test exposure and maturity are mixed, and I found no ordering of M1 to M9 in the text.
- **The deep dive is 27 kept processors, not a sample.** The others were returned, so shares such as half single-core, 19 against the rest, and the temperature law on 6 of 27 rest on whatever was retained.
- **Bitflips are inferred from outputs.** The mask compares the final output of a whole testcase, which may involve several instructions and later computation, so it may not show where hardware flipped a bit. The challenge to independent, single-flip models rests on a few processors.
- **Production impact is argued from anecdotes.** Section 2.2 gives three cases and Observation 9 one count. The study measures how many CPUs fail tests, not how often applications saw corrupted data or how much escaped, and testcase error frequency is not an application error rate. The first two cases were in fact surfaced by checksum mismatches, so "ineffective checksums" concerns corruption before the checksum is computed. Observation 12 is argued, not tested: no defense was run against the SDC records.
- **Farron's evaluation is thin and close to its own data.** It uses six of the 27 processors behind the observations, with coverage measured against "known errors" from the same toolchain, and "suspected" is defined as testcases that already failed on that processor. The text does not say how priorities were set in the evaluation, so some gain may reflect prior knowledge. There are no healthy processors, false-positive rate, held-out fleet or deployment, and protection was checked by simulating workloads for hours, with cost reported as backoff time, not latency or throughput.
- **Loose ends in the numbers.** I could not tie 0.864 s per hour (about 0.024%) to Table 4, whose control overhead runs from 0 to 0.049% (up to about 1.8 s per hour), and the 59 °C bound matches the threshold the paper reports for one setting (testcase C on MIX1), while the text does not say which processors the simulation used. Decommissioning (mask one core, retire above two) and the reliable pool are not evaluated, although half the faults affect all cores.

## Further Research

- Better testcase generation for multi-thread conflicts, which the authors expect from academia and industry and for which they name SiliFuzz without trying it. The recipe resembles [Csmith](/papers/csmith-finding-bugs-in-c-compilers) for compilers (random programs plus a cross-check), my pairing, not the paper's.
- Failure models and encodings that follow the bitflip patterns, and the application impact of small floating-point errors in domains such as finance or autonomous vehicles.
- Cooling-device control and continued use of unaffected cores in a faulty processor, which the authors call worth investigating, validated on a held-out fleet and other vendors.
- Online tolerance aimed at the few vulnerable features, which the authors pose as a question. [Orthrus](/papers/orthrus-detecting-silent-user-data-corruption-in-the-cloud) is one later answer, re-executing data-path operators on another core.
