---
title: "If At First You Don’t Succeed, Try, Try, Again...? Insights and LLM-informed Tooling for Detecting Retry Bugs in Software Systems"
summary: A study of 70 real retry bugs in Java systems sorts them into whether, when and how to retry, and the Wasabi toolkit finds new ones by combining CodeQL and GPT-4 to locate retry code with fault injection into existing unit tests and retry-specific oracles.
researchArea: Distributed Systems
keywords: retry bugs, fault injection, unit testing, static analysis, large language models, cloud systems
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Retry, re-running a task after it fails, is the standard answer to transient errors in cloud software, and often the last defence against bugs, hardware faults and bad configuration. It is also rarely tested: the errors that trigger it almost never happen in a test environment, and none of the studied systems has a dedicated retry API, so it is hard to find automatically.

This SOSP 2024 paper (Austin), from the University of Chicago and Microsoft Research, asks what goes wrong in real retry code and whether such bugs can be found automatically. The authors first study bug reports from open-source Java systems, then build Wasabi, which they release together with a description of every bug it reports.

Terms used throughout: a bug is an **IF** problem (should this error be retried at all), a **WHEN** problem (the **delay** between attempts or the **cap** on their number) or a **HOW** problem (state cleanup and job tracking). The retried method is the one whose failure causes re-execution, the coordinator method is the caller that catches the error and retries, the retry trigger is the exception, and the call site is the retry location.

Worth knowing first: Java exceptions and try/catch, how unit tests and bytecode instrumentation (AspectJ) work, and why backoff matters. Two pairings of mine, not the paper's. [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) is cited here only in related work, as one class of understudied cloud bugs, but its first case is retries multiplying load, which is what missing-delay and missing-cap bugs can do. [Atropos](/papers/targeted-task-cancellation-for-application-resource-overload) postdates this paper, and the study here found bugs where a cancelled task is retried as if it had failed.

## Contribution

- **A taxonomy from 70 issues.** The authors searched the issue trackers of Elasticsearch, Hadoop (Common, HDFS and Yarn), HBase, Hive, Kafka and Spark, eight applications in all, for retry, resubmit, reattempt and reschedule, between April 2018 and November 2023, keeping valid bugs that were fixed or had a patch awaiting merge. IF has 25 issues (17 wrong policy, 8 missing or disabled retry), WHEN has 23 (10 delay, 13 cap) and HOW has 22 (12 improper state reset, 8 broken or raced job tracking, 2 other).
- **What retry code looks like.** No studied case uses a dedicated retry API. About 55% are simple loops and 45% are not: 25% re-enqueue a task on a queue and 20% are state machines that re-enter the current state. Comments, log messages, variable names and error codes are the clearest evidence of retry. Errors reach the coordinator as exceptions in 70% of cases and as error codes in 30%.
- **Locating retry.** CodeQL finds loops whose header is reachable from a catch block inside the loop and whose names or literals contain "retry" or "retries". GPT-4 reads one file at a time and says whether it retries, which also covers queues and state machines, and CodeQL then lists the callees and their exceptions. The output is triples of coordinator, retried method and trigger exception.
- **Repurposed unit tests.** An AspectJ handler throws the trigger exception before the retried method runs, up to K times, with K set to 1 (to reach the code after a retry) and to 100 (to hit caps and delays). A planner runs the suite once to learn coverage, then covers each retry location in exactly one test, and a script restores default retry settings that tests had lowered.
- **Three oracles.** Missing cap: 100 injections or a run over 15 minutes. Missing delay: no sleep call from the coordinator between two consecutive injections at one location. Different exception: the test fails with an exception other than the injected one. A test that simply rethrows the injected exception is accepted.
- **Static checks.** For WHEN bugs, GPT-4 answers yes/no prompts about delay and cap, with prompts that exclude spin locks and polling. For IF bugs, CodeQL computes, per exception, the share of retry loops that retry it, and flags outliers.

## Methodology

The evaluation uses eight applications: Hadoop Common, HDFS, MapReduce, Yarn, HBase, Hive, Cassandra and Elasticsearch, at their latest versions as of March 2023. Kafka was dropped because its retry is driven by error codes and state, and Spark because of an AspectJ plugin incompatibility, and MapReduce and Cassandra were added. Runs used one Ubuntu 22.04 machine with 12 cores and 32 GB of RAM.

The authors examined every report themselves to label true bugs and false positives. They sampled 40 CodeQL loops and 100 GPT-4 locations to check retry identification, and ran ablations without the keyword filter and without the oracles.

## Findings

These are the authors' reported results.

- **Bugs found.** Wasabi reports 191 distinct problems, of which 109 are true bugs and 82 false positives. Unit testing finds 42 (20 missing cap, 17 missing delay, 5 HOW) among 63 reports, with 21 false positives. Static analysis finds 87 (79 by GPT-4, 8 IF by CodeQL) among 148 reports, 61 of them false, and 20 bugs are found by both. The authors give 2 true bugs per false positive for testing and 1.4 for static analysis.
- **A HOW example.** Injecting one `SocketException` into an HDFS test caused a `NullPointerException`: the catch block logs the state of objects that were never built because the error came early.
- **Retry code identified.** 323 structures, 239 of them loops. CodeQL finds 205 loops (over 85% of those found by either method) but no non-loop retry. GPT-4 finds 140 loops and 84 other structures but misses about 100 loops, in files almost twice as large as those where it does find retry. Without the keyword filter CodeQL would report 725 loops instead of 205. In the samples, 3 of 40 CodeQL loops and 16 of 100 GPT-4 locations were wrong.
- **Coverage.** Unit tests reach 32% to 75% of retry structures in six applications, and less in Hive and Elasticsearch, where error-code retry is common. Between 4% and 27% of unit tests cover a retry location.
- **Cost.** Unit testing takes about 10 hours per application and close to 20 for HBase. Planning cuts injection runs by 27× to 170×, and test time grows by 2× to 5×. GPT-4 needs a median of about 2,600 calls, 16 MB and 3.3 million tokens per application, around 8 USD.
- **Oracles matter.** Without them all missing-delay bugs and most missing-cap bugs would be missed, and about 90% of test crashes are rethrown injected exceptions that the oracles correctly ignore.
- **Study side.** Severity labels give 5% blocker, 10% critical, 65% major and 5% minor, with 10% unlabeled. Developers added regression tests for 42 of the 70 bugs.

## Critical Analysis

The paper is candid about scope, and concedes these limits.

- **The study may not generalize.** It covers Java open-source systems, issues containing four keywords, and skips unclear reports.
- **Retry location is neither sound nor complete.** The oracles absorb its false positives, not its misses.
- **Blind spots by design.** The prototype handles exception-triggered retry, not error codes (30% of studied cases). Missing or disabled retry (8 of 70) is not covered, and misconfiguration (about 10%) is missed unless the tests use the same setting. Static checks produce more false positives than tests and miss bugs tied to runtime state.
- **False negatives are not quantified.** The authors say they are hard to measure and list the sources: uncovered code, missed retry locations and the blind spots above.
- **False positives cost review time.** The authors suggest showing the snippet taken as retry next to each report.

The following points are a reading of the evidence, not claims of the paper.

- **No recall estimate.** The evaluation uses newer versions and swaps two applications, so the 109 bugs are new and nothing says how many of the 70 studied bugs Wasabi would catch. The text does not say how many of the 109 maintainers confirmed or fixed, so true and false are the authors' own labels.
- **The bug mix is lopsided.** The study finds the three categories about equally common, yet the 109 bugs split into 8 IF, 5 HOW and 96 WHEN (37 plus 79, minus the 20 found by both). "All three types" holds, but mostly one type is found.
- **Labels set the false-positive rate.** Of the 21 unit-testing false positives, 8 are missing-delay reports where, the authors say, Wasabi was right but the delay seemed unnecessary (an HDFS retry that contacts another replica), so the 2 to 1 ratio depends on that call.
- **IF detection is thin.** It covers loops only and produced 9 reports. The design says outliers have ratios very close to 1 or 0, while the evaluation uses 2/3 and 1/3, with ratios such as 1/3, 2/3 and 2/9 from a handful of sites.
- **The GPT-4 side is one configuration.** Prompts were tuned by experiment, and the text names no model snapshot and reports no repeated runs. Cost and accuracy may not carry to other models or languages.
- **Two wording mismatches.** The introduction says Wasabi handles all three bug types in loop and non-loop retry, but the body limits IF detection to loops and HOW detection to exception-triggered unit tests. It also says 0.1% to 0.5% of tests contain a mechanism to inject transient errors, while Section 2.5 gives the same range as tests labeled retry-related (348 in total). The body is followed here.

## Further Research

- Error-code-triggered retry, which the prototype leaves out and which explains the low coverage in Hive and Elasticsearch.
- Fewer false positives through call and exception context (wrapped exceptions, retries spread across tasks), merging static and test results, and giving GPT-4 callee code or compressed prompts, as the authors suggest.
- Test frameworks with built-in retry-test configuration, and more consistent retry structures and error encoding, which the authors argue would help.
- My own gap: measuring recall on the 70 known bugs, and adding oracles for load amplification, to see whether a missing delay or cap can sustain an overload as in [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems).
