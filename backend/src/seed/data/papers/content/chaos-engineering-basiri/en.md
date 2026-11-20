---
title: "Chaos Engineering"
summary: A Netflix practice-and-vision article that names chaos engineering as the discipline of experimenting on a distributed system to build confidence in how it withstands turbulent production conditions, states four principles and a four-step experiment, and illustrates them with Chaos Monkey, Chaos Kong and the stream-starts-per-second metric.
researchArea: Distributed Systems
keywords: chaos engineering, Netflix, steady state, failure injection, experimentation in production, Chaos Monkey
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Modern software-based services are implemented as distributed systems with complex behavior and failure modes. Many large tech organizations are using experimentation to verify the reliability of such systems. We use the term "Chaos Engineering" to refer to this approach, and discuss the underlying principles and how to use it to run experiments.

## Overview

This is an IEEE Software article (vol. 33, no. 3, May/June 2016, pp. 35-41) by the Traffic and Chaos Team at Netflix. It is not a systems or measurement paper: it is a definition of a practice that Netflix and other large service providers were already running, written to help it be recognized as a discipline.

The problem is how to trust a production distributed system under the failures that really happen. Netflix engineers push code and change runtime configuration hundreds of times a day, so "install proven software and leave it alone" (Jim Gray's 1985 advice) is not an option. The authors argue that functional specifications of such systems are incomplete and that the scale of the services makes composing per-service specifications impractical. They also give two failure modes that need integration testing: a client with an unbounded queue toward an overloaded server runs out of memory, and a transient error from a service gets cached and served to other clients.

The article cites the study behind [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) for two numbers: 92% of catastrophic failures come from incorrect handling of non-fatal errors, and many failures need combinations of events.

## Contribution

- **A definition.** Chaos engineering is "the discipline of experimenting on a distributed system in order to build confidence in its capability to withstand turbulent conditions in production": a hardware failure, a surge of requests, or a malformed runtime parameter.
- **A system perspective.** Treat the services in production as one system and watch metrics at its boundary, asking "are users complaining?" before "does the implementation match the specification?".
- **Four principles.** Build a hypothesis around steady-state behavior, vary real-world events, run experiments in production, and automate experiments to run continuously.
- **A four-step experiment.** Define steady state as a measurable output that indicates normal behavior; hypothesize it continues in a control group and an experimental group; introduce variables that reflect real-world events; try to disprove the hypothesis by looking for a difference between the groups.
- **A research agenda.** Case studies from other domains, adoption, reusable tooling, and event injection models, since failures are often triggered by combinations of events.

## Methodology

There is no evaluation section. The article is argued from Netflix experience and illustrated by examples. Netflix runs Chaos Monkey (random termination of production virtual machines, during working hours so engineers can respond), Chaos Kong (simulating the loss of an entire Amazon EC2 region, about once a month) and Failure Injection Testing (FIT), which fails requests between services. The Control Plane runs on AWS across three regions (Northern Virginia, Oregon and Ireland); the Open Connect CDN is outside the scope of the examples.

The steady-state metric is SPS, (stream) starts per second, chosen because it varies slowly and predictably over a day and directly reflects whether users can watch. The article contrasts it with finer metrics such as CPU load or query time, which are watched during an experiment and may end it early, but are not used to design it. A hypothetical experiment shows the method: fail all bookmark-service requests for a small control-versus-experiment split of users and compare SPS.

## Findings

The article reports practice, not measurements.

- **Experience claims.** Chaos Monkey is said to have succeeded, since all Netflix engineers now design services to handle instance failure as a matter of course. No count of incidents prevented is given.
- **Steady state.** SPS is the primary health indicator, and a second example is new account signups per second. For other domains the authors suggest completed purchases per second or ads viewed per second.
- **Simulation.** Netflix does not take a region offline; it redirects requests as if it were gone. The authors say engineers must trade the realism of an event against the risk of harming the system, and mention confining an experiment to a subset of users as risk mitigation.
- **Automation.** Confidence in past experiments decays as the system changes, so experiments must eventually run repeatedly after a first manual run.
- **Expected outcome.** An experiment ends with more confidence in the system or with a weakness that points to an improvement.

## Critical Analysis

What the article does not claim: there is no quantitative evaluation of incidents avoided, no comparison with unit, integration or fault-injection testing, and the bookmark experiment is hypothetical. Every result cited comes from Netflix itself, and the authors say they hope other organizations will document their own. Safety is discussed, not studied: the risk of an experiment spreading is handled by judgment, subset targeting and early stopping. The case for production rests on assertion and two examples: even when a test context can reproduce the whole system, the authors say it never reproduces everything (synthetic versus real clients, DNS configuration). They state that traditional testing is not sufficient for distributed systems, without data comparing it to experiments.

Differences from how this practice is often summarized: the article names four principles, not three, and "minimize the blast radius" is not one of them in this text; it appears as the subset-of-users tactic. The steady-state metric is a user-facing availability signal at the system boundary, not a business metric as such.

The following is a reading of the evidence, not a claim of the paper. The method needs a good steady-state metric, and SPS works for Netflix because it is smooth and tied to availability. Systems whose failures are slow, gray or self-sustaining may not show up in such a metric (see [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) and [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild)). This reading draws on the catalog pages for those papers, not on a new reading here.

Source note: this analysis was written from the arXiv manuscript (arXiv:1702.05843, 11 pages, by the same authors and marked as published in IEEE Software). The journal version spans pp. 35-41 and was not read, so wording differences from it are unchecked.

## Further Research

- Which events to inject, since combinations are hard to enumerate (an open question in the article). The fault-injection framework in [Analysis of Network-Partitioning Failures](/papers/analysis-of-network-partitioning-failures-in-cloud-systems) is a catalog example of a targeted answer.
- How to check outcomes beyond one aggregate metric: [Elle](/papers/elle-inferring-isolation-anomalies-from-experimental-observations) checks a database's observed histories for isolation anomalies (a pointer from this catalog, not from the article).
- Latency under injected faults and fan-out, a gap the article leaves open and that [The Tail at Scale](/papers/the-tail-at-scale) approaches from the latency side.
- Quantitative evidence that continuous experiments reduce incidents, and reusable tooling across organizations, both named as open by the authors.
