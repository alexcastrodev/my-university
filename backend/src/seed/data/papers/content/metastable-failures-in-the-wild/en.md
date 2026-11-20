---
title: "Metastable Failures in the Wild"
summary: An OSDI 2022 study of public postmortems that finds 21 metastable failures at 11 organizations, shows that retries are the most common sustaining effect, and extends the metastability model with two kinds of trigger and two kinds of amplification, reproduced in three small applications.
researchArea: Distributed Systems
keywords: metastable failures, incident postmortems, retry storms, load shedding, garbage collection, look-aside cache
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Recently, Bronson et al. introduced a framework for understanding a class of failures in distributed systems called metastable failures. The examples of metastable failures presented in that work are simplified versions of failures observed at Facebook. In this work, we study the prevalence of such failures in the wild by scouring over publicly available incident reports from many organizations, ranging from hyperscalers to small companies. Our main findings are threefold. First, metastable failures are universally observed: we present an in-depth study of 22 metastable failures from 11 different organizations. Second, metastable failures are a recurring pattern in many severe outages, e.g., at least 4 out of 15 major outages in the last decade at Amazon Web Services were caused by metastable failures. Third, we extend the model by Bronson et al. to better reflect the metastable failures seen in the wild by categorizing two types of triggers and two types of amplification mechanisms, which we confirm through developing multiple example applications that reproduce different types of metastable failures in a controlled environment.

## Overview

A metastable failure is an outage that outlives its cause. A temporary trigger overloads a system, a feedback loop inside the system keeps the overload going, and the system stays degraded after the trigger is gone. [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) (HotOS 2021) named the class from experience at Facebook, with simplified examples and the claim that the pattern is common, but no data on how common.

This OSDI 2022 paper, from Penn State, the University of New Hampshire and Twitter, supplies the data. It reads public incident reports and asks whether they fit the pattern. It also cites two catalog papers that sit next to it: [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems), as one kind of slowdown that can act as a trigger, and [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures), which the authors cite for its observation that critical failures often need an unusual sequence of events, something they suggest may have been metastable failures.

Worth knowing first: goodput (useful work per second), retry with timeouts, look-aside caches, load shedding and JVM garbage collection.

## Contribution

- **A study of incidents in the wild.** 21 metastable failures from public sources (Table 1), 4 each at AWS, Google Cloud and Azure, plus IBM, Spotify, Elasticsearch, Wikimedia, CircleCI, Cassandra, Ably and Facebook.
- **An extended model.** Two trigger types, a load spike or a capacity decrease, and two amplification types, workload amplification (more or costlier requests, as with retries) and capacity degradation amplification (background work such as garbage collection lowers capacity). Four scenarios follow from the combinations.
- **Degrees of vulnerability.** The vulnerable state is not binary: whether a trigger tips the system depends on how close load is to capacity, the trigger's size and duration, and the amplification. The paper states four theorems about this, proved in an appendix.
- **A Twitter case study.** A garbage collection loop seen in a peak load test, found with internal data.
- **Three reproductions**, open-sourced: garbage collection, retries on a replicated MongoDB, and a look-aside cache.

## Methodology

The authors searched public postmortems from cloud providers' incident and outage tools, which they call their primary source, and from postmortem communities and weekly outage digests such as SRE Weekly. They looked at hundreds of incidents and report a handful. They searched for tell-tale signs: a temporary trigger, work amplification or a sustaining effect, and mitigation by load shedding. Each incident was then analyzed for impact (duration and affected services), trigger, amplification mechanism and mitigation, and sorted into categories. The paper says it used best judgment because reports differ in format and detail, and it marks some incidents gray when a sustaining effect is plausible but not clearly described. I did not see a second reviewer or an agreement measure described.

The experiments run in Docker on AWS EC2: a multi-threaded Java 8 program under default GC (1 GB container, m5.large), a 3-replica MongoDB 4.4.9 cluster on m5a.large instances, and a web application with a 15 GB MySQL database (34.6 million entries) and a 1 GB memcached cache under a Zipf workload. Each reproduction varies trigger size, duration, request rate and one parameter.

## Findings

All numbers are the paper's. They come from a small, hand-labeled set.

- **Scale and duration.** Outages ran from 1.5 to 73.53 hours, and 4 to 10 hours was the most common range (35% of the incidents that report a duration). IBM1 lasted over three days.
- **Triggers.** About 45% of triggers are engineer errors (buggy configuration or code, latent bugs) and about 35% are load spikes. 45% of incidents have more than one trigger. Around 50% have direct human involvement.
- **Sustaining effects.** Retries sustain more than 50% of the incidents (11 of 21 named). Others are queue growth, expensive error handling, lock contention, leader election churn and cascading overload.
- **Mitigation.** Load shedding was used in over 50% of incidents (the text also says over 55%). Others were reboots, policy changes, rollbacks and added capacity.
- **Twitter.** A peak load test triggered a loop of queue length, GC duration, slower jobs and more queueing. Success rate stayed below the SLO after load fell back, until a restart.
- **Retries on MongoDB.** At about 6,200 successful requests per second, a 10 s trigger cutting CPU by 78% recovered, while 80% did not: attempted load peaked near 20,000 RPS (3x) and goodput fell about 90% to 600 RPS. A 9 s trigger at 80% recovered, and a 30% lower baseline load also recovered.
- **Cache.** Metastability appeared at higher RPS and shrank with a 2 s timeout over 1 s, and a ~95% hit rate still left a wide vulnerable range.
- **Prevention and mitigation.** The paper says to understand the system's vulnerability, cap retries (at most two retries means at most 3x), shed load, add capacity, shorten triggers by automation, and watch overload against the metastable boundary. It warns of fixes that backfire, such as unlimited retries or heavier error logging.

## Critical Analysis

What the paper does not claim, and where it is soft:

- **Selection bias.** The data are postmortems that companies chose to publish, so the paper cannot give a rate of metastable failures, only that they occur. It says the count may look low next to other failure studies.
- **Judgment, not proof.** Classification is by the authors' reading of public text, and some entries are plausible rather than clear.
- **Numbers that do not line up.** The abstract says 22 incidents, the body and Table 1 say 21. The "4 of 15 major AWS outages" appears in the abstract, and I found no table of the 15 in the text.
- **Mitigations are not tested.** The experiments show the failures and their sensitivity, but no mitigation is evaluated. Autoscaling is called an open question.
- **Small reproductions.** Each reproduction is one application at small scale.

My reading, not the paper's: the trigger shares overlap by design, since half the incidents have several triggers, so the percentages should not be added.

Later literature, which I know only from this catalog and did not read as part of this task: [Mitigating Application Resource Overload with Targeted Task Cancellation](/papers/targeted-task-cancellation-for-application-resource-overload) (SOSP 2025) covers overload but not metastability, and [Retry Bugs](/papers/retry-bugs-insights-and-llm-informed-tooling) studies the retry code that this paper blames most often.

## Further Research

- Detecting a system near the metastable boundary before it crosses it, as the paper suggests by monitoring overload.
- Whether autoscaling reacts fast enough, given amplification such as 100x for a 99% hit-rate cache.
- Retry policies that cap amplification without losing availability.
- Evaluating the mitigations the paper lists in a controlled setup, which the paper leaves undone.
