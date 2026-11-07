---
title: "One Simple API Can Cause Hundreds of Bugs An Analysis of Refcounting Bugs in All Modern Linux Kernels"
summary: A manual study of 1,033 fixed refcounting bugs in Linux from 2005 to 2022 finds that most cause memory leaks, that many live for years, and that a few API design traps explain hundreds of them, then turns nine anti-patterns into static checkers that report 351 new bugs.
researchArea: Operating Systems
keywords: reference counting, linux kernel, memory leaks, use-after-free, bug study, static checkers, anti-patterns
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Reference counting (refcounting) lets a program free an object when its last reference disappears: an integer counts the references, each new reference must increment it, each dropped one must decrement it, and at zero the memory is released. In the Linux kernel these calls are manual, and the authors cite earlier work saying 93.5% of kernel files involve refcounting. A missed decrement leaks memory because the count never reaches zero. A missed increment, or a decrement that comes too early, frees an object that is still in use, a use-after-free (UAF).

This SOSP 2023 paper (the 29th ACM Symposium on Operating Systems Principles, Koblenz) comes from the Institute of Software of the Chinese Academy of Sciences (TCA and SKLCS), the University of Chinese Academy of Sciences, Tsinghua University, Zhongguancun Laboratory and CNITSEC. It asks what the many existing detectors did not: why are refcounting bugs still reported in growing numbers, and what do they have in common?

Key terms: a refcounting-embedded API does some other job (find a device, parse a node) but increments the count of the object it returns, and a find-like API is the usual case. UAD (use-after-decrease) means touching an object after the call that drops the reference. A smartloop is a macro such as `for_each_matching_node` whose iteration hides the get and put calls. An anti-pattern is a semantic template of a buggy code path, used to build a checker.

Worth knowing first: manual memory management in C, what a UAF is, and the kernel's `Fixes:` tag in patch descriptions. The paper leaves out refcounting bugs caused by races. [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs) attacks another class of kernel bugs that need concurrency to show up, and [kSTEP](/papers/kstep-deterministic-testing-of-linux-cpu-scheduler-bugs) is a similar bug-fix study for the scheduler. Neither is cited here, and both pairings are mine.

## Contribution

- **A dataset built from history.** The authors collect 1,033 refcounting bugs from 753 kernel versions released from 2005 to 2022. A first filter looks for patches that add, delete or move calls whose names contain words such as get, take, hold, grab, put, drop or release, and a second checks the API implementation. This gave 1,825 candidates out of more than one million commit logs, and manual reading of the commit message, the patch, the context and the mailing-list discussion kept 1,033.
- **A classification with semantic templates.** Bugs are classified as missing (a skipped increment or decrement) or misplacing (the call is in the wrong place), plus an Others bucket. Templates use operators for increment, decrement, assignment, dereference, lock and unlock, plus contexts such as statement, block and function, so a leak on an error path reads as function start, increment, error block, function end.
- **Root causes in four groups.** Implementation deviation covers APIs that increment even on error (return-error) or return NULL. Hidden refcounting covers smartloops and APIs whose names say nothing about refcounting. Overlooked location covers error paths, paired functions that run at different times (open and release, probe and remove) and direct `kfree` calls. Future risk covers UAD and references that escape through a global or an out parameter.
- **Nine anti-patterns and checkers.** Each anti-pattern becomes a static checker. Lexer parsers extended from PLY find refcounted structures, refcounting APIs and smartloops, and Joern builds code property graphs. The checkers are not meant to be sound or complete, only to test whether the root causes are real. The authors say LLVM failed on the many architecture-specific build configurations.

## Methodology

The study has three steps. First the dataset above, with a threats-to-validity discussion: bugs may be missed when a patch moves a `mutex_unlock` and changes no refcounting call, or when the commit message lacks the key words, and wrong "fixes" are removed by dropping any bug whose commit id is the target of another commit's `Fixes` tag. Second, statistics on impact, subsystem distribution and lifetime. Lifetimes use the `Fixes` tags, so they cover only the 567 bugs that have one.

Third, root-cause inference on representative bugs only: all missing-decrement bugs (67.2%), the UAD bugs (9.1%) and the intra-unpaired missing-increment bugs (5.1%). To test the naming theory, the authors train word2vec (CBOW) on more than a million commit logs and compute cosine similarity between key words of API names (find, parse, open, foreach) and refcounting words (get, put, hold, release) for the 254 intra-unpaired bugs. The checkers then run over the source of recent kernel releases, a patch is sent for each report, and developers' answers are counted.

## Findings

These are the authors' reported results.

- **Impact.** 741 of 1,033 bugs (71.7%) can leak memory and 292 (28.3%) can cause a UAF. Missing-decrement bugs are 694 (67.2%), and 590 (57.1%) can be found by looking for unpaired calls inside one function.
- **Distribution.** Bugs follow a long tail: 851 (82.4%) sit in drivers, net and fs, and 588 (56.9%) in drivers alone. By density the block subsystem is highest, with 18 bugs in 65 KLOC.
- **Lifetime.** Of the 567 tagged bugs, 429 (75.7%) took more than one year to fix, 19 lived more than 10 years (7 of them UAF), and 23 reach from v2.6 to v5.x or v6.x. 189 bugs were both introduced and fixed within v5.x.
- **API traps.** `pm_runtime_get_sync` caused 94 bugs because it increments even when it returns an error, and with `kobject_init_and_add` the return-error problem accounts for 106. The authors also report 110 error-path bugs, 44 direct-free bugs, 94 UAD bugs and 74 escape bugs. In their word2vec table, find has a similarity of 0.73 to get and 0.58 to put but low values to words such as refcount, increase and decrease, which the authors read as developers not realizing that a find-like API takes a reference.
- **New bugs.** The checkers report 351 bugs: 296 leaks (84.3%), 48 UAF (13.7%) and 7 null-pointer dereferences (2.0%). 338 are in arch and drivers (about 96%). 240 are confirmed and applied in the mainline, 3 were rejected, 5 are false positives not counted in the 351, and 111 got no answer.
- **Where they come from.** Anti-pattern 4 (hidden refcounting APIs) accounts for 255 of the 351 bugs, and the top two APIs are `of_find_compatible_node` (74) and `of_get_parent` (48). All 17 escape bugs were confirmed, while two of five potential-deallocation bugs were not, because developers believed no UAF can happen today.

## Critical Analysis

The authors are open about the limits of their method. They concede the following.

- **Scope.** Only two kinds of bugs are studied, and race-caused refcounting bugs are left for later. Keyword-based collection can miss bugs and can include wrong fixes.
- **Checker quality.** The checkers do not model the semantics of specific structures, which produced false positives such as a refcount increment that a guarding `if` makes unreachable. They also use line numbers to approximate execution order. Of the three rejected patches, two were UAD reports that developers did not see as real bugs without a proof of concept, and generating one is left as future work.

The following points are a reading of the evidence, not claims of the paper.

- **Counts are of reported fixes, not of bugs.** Leak share, subsystem share and lifetime all come from bugs someone found and patched. The paper itself says UAF patches face a high bar (a crash report or PoC) and that PoCs are hard to build, so the 71.7% leak share partly reflects what gets accepted. The lifetime results cover 55% of the dataset, the tagged part, and may not represent the rest.
- **Severity is inferred, not demonstrated.** "Almost every bug leads to a security problem" rests on commit-message keywords and patch code. The case for leaks as an attack route is one cited commit about triggering them repeatedly from a script, and no proof of concept is reported for any new bug.
- **The naming argument has no baseline.** The word2vec table covers only APIs that caused bugs. It does not compare with similarly named APIs that never caused one, and no developers were asked whether they notice hidden refcounting. It is a plausible reading, not a tested cause.
- **Numbers that do not reconcile.** The introduction says 70.0% of bugs took more than a year to fix, while Finding 4 says 75.7% (429 of 567), and I use the latter. Section 6.2 says 3 patches were rejected and Section 6.4 says 4. 240 confirmed plus 3 rejected plus 111 unanswered is 354, not 351. Section 6.3 counts 62 hidden-API bugs, but Table 5 lists 42 for anti-pattern 3 and 255 for anti-pattern 4. Finding 2 says most UAF bugs come from misplacing, yet Table 2 gives 13.9% of 28.3%, about half. UAD appears as 11.5% (9.1%) with no explanation of the gap.
- **No precision or recall.** The only false-positive count is the 5 that developers reported, with 111 reports unanswered. The checkers are not run on the historical kernels to see how many of the 1,033 known bugs they would find, and there is no head-to-head with the tools in the related work. The kernel releases analysed are described only as the latest ones.
- **A few patterns carry the result.** One anti-pattern gives about 73% of the new bugs, and two APIs give 122. The checkers are also hand-written templates, which the related work faults in other tools for manual effort, and that effort is not compared.
- **Advice is untested.** Naming conventions and API comments are suggested, but nothing measures whether they would prevent bugs.

## Further Research

- Detecting implementation deviations automatically and publishing them, which the paper names as an important next step.
- Generating proofs of concept for UAD bugs, so that UAD patches are not rejected for lack of a demonstrated crash.
- Refcounting bugs caused by races, which the paper excludes. An in-vivo reordering approach like [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs) is one possible route, my suggestion and not the paper's.
- Measuring recall of the checkers on the historical dataset. A type-level alternative, my suggestion and not the paper's, is [RustBelt](/papers/rustbelt-securing-foundations-of-rust), whose verified `Rc` and `Arc` put the counting behind a checked interface.
