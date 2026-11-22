---
title: "Formal Analysis of Metastable Failures in Software Systems"
summary: Gives metastable failures a mathematical definition. Request-response systems with timeouts and retries are described in a small language, abstracted into a continuous-time Markov chain calibrated against a simulator, and analyzed with a flow picture of the state space, expected recovery times and an eigenvalue characterization of metastability.
researchArea: Distributed Systems
keywords: metastable failures, retry storms, continuous-time Markov chains, retrial queues, recovery time, calibration, request-response systems, performance modeling
version: 1.0
updatedAt: 2026-11-22
---

## Abstract

Many large-scale software systems demonstrate metastable failures. In this class of failures, a stressor such as a temporary spike in workload causes the system performance to drop and, subsequently, the system performance continues to remain low even when the stressor is removed. These failures have been reported by many large corporations and considered to be a rare but catastrophic source of availability outages in cloud systems. In this paper, we provide the mathematical foundations of metastability in request-response server systems. We model such systems using a domain-specific language. We show how to construct continuous-time Markov chains (CTMCs) that approximate the semantics of the programs through modeling and data-driven calibration. We use the structure of the CTMC models to provide a visualization of the qualitative behavior of the model. The visualization is a surprisingly effective way to identify system parameterizations that cause a system to show metastable behaviors. We complement the qualitative analysis with quantitative predictions. We provide a formal notion of metastable behaviors based on escape probabilities, and show that metastable behaviors are related to the eigenvalue structure of the CTMC. Our characterization leads to algorithmic tools to predict recovery times in metastable models of server systems. We have implemented our technique in a tool for the modeling and analysis of server systems. Through models inspired by failures in real request-response systems, we show that our qualitative visual analysis captures and predicts many instances of metastability that were observed in the field in a matter of milliseconds. Our algorithms confirm that recovery times surge as the system parameters approach metastable modes in the dynamics.

## Overview

Metastable failures are the ones where a trigger (a load spike, a lost cache) is over but the system stays slow. Reports from large operators and the empirical studies that followed describe and classify them, as in [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild), but the authors note that there was little theory to predict them. Their questions are practical: for which parameters can a metastable failure happen, how long will recovery take, and how much do common mitigations such as throttling help.

This is a preprint from researchers at UC Santa Cruz, the Max Planck Institute for Software Systems, the University of Birmingham and AWS. It is part of a larger effort at AWS on metastable failures, and the paper itself says it covers only the formal part. It states no venue. I read version 2 on arXiv.

## Contribution

- **A small language for request-response systems.** A server has a queue and a worker pool, and a client has an arrival distribution, a timeout and a retry policy. Programs are acyclic graphs of clients and servers. Their meaning is a discrete-event simulation, a core of about 100 lines of Python on top of asyncio, which the paper treats as ground truth.
- **An abstract Markov chain.** The state of one server is a pair (u, v): requests in the system, and requests in the orbit waiting to be retried. A new request joins the orbit with a probability that depends on the queue length, which captures the chance that it will not be served before its timeout. The construction extends to several worker threads, several request types, and chains of servers where an upstream thread blocks on the downstream call.
- **Calibration.** The abstraction is approximate, since the simulator tracks each attempt and the chain only tracks averages. The authors fit a few constants of the chain (the arrival rate and the timeout in their example) so that its average trajectories match many short simulator runs, using the CMA-ES optimizer.
- **A picture of the flow.** In the plane of queue length against orbit length, an arrow at each state points to the most probable next direction. Where the arrows turn from "toward empty" to "toward full" is where a system can get stuck. Computing an arrow does not depend on the size of the chain.
- **A definition of metastability.** Based on escape probabilities, in the line of earlier work on discrete-time Markov chains: a set of states is metastable if moving between them takes much longer than reaching one of them from outside. A theorem links k such states to k eigenvalues of the generator matrix near zero, and the second eigenvalue gives a lower bound on mixing time.
- **Recovery time.** The expected time to go from a full queue back to the typical queue, computed by solving linear systems, or estimated through the spectrum when that is numerically unstable.

## Methodology

The running example is one server with a service rate of 10 requests per second, a client sending 9.5 requests per second, a 9 second timeout, 3 retries, and a queue of 100. A spike to 20 requests per second between 200 s and 400 s leaves the queue full for at least 600 s after the load is back to normal. The chain bounds the queue and the orbit at 100 and 20.

Calibration uses two starting conditions (empty and full) and 100 simulator runs each. The paper then asks three research questions: whether the calibrated chain is faithful to the simulator, whether the analysis explains how parameters affect metastability, and whether it helps design recovery policies. A second example has two servers in series, the first with 32 threads and the second with a service rate of 2.8 requests per second, with 5 second timeouts and retry limits of 5 and 3.

## Findings

- **A plain queue is never metastable.** An M/M/1 queue is stable or unstable. Metastable behavior appears only when retries are added.
- **Calibration matters.** The chain built directly from the program deviates from the simulator, and after calibration the trajectories align closely. The fitted values are 9.43 requests per second and a 10.54 second timeout, against the nominal 9.5 and 9.
- **Parameters move the system between three regimes.** Lowering the service rate or the timeout, or raising the arrival rate, produces metastability. In the example it appears for arrival rates between 9 and 10.5, service rates between 9.5 and 10.5, and timeouts between 5 and 10 seconds. A longer queue, in contrast, keeps the system metastable beyond a point (above 90). The paper's point is that metastable differs from both stable (only the empty state attracts) and unstable (only the full state attracts): both are attractors.
- **Recovery policies can be compared.** Recovery from a full queue is slow at an arrival rate of 9.5 (a metastable setting), and quick when the rate is throttled to 8 (a stable setting), which a simulated run confirms. Recovery time grows with lower service rates, shorter timeouts and higher arrival rates.
- **It scales to a chain of servers.** For the two-server example the picture, computed in milliseconds, shows a region around an orbit length of 15 where flows nearly balance. The mixing time is far larger than the time scale of the chain, and it is not monotonic in the service rate: very low and very high rates are unstable or stable, and middle values are metastable.
- **Cost.** The qualitative analysis takes milliseconds, and the quantitative analysis a few hours for the largest examples. The authors report that, in their industrial use, modeling three servers or fewer was enough to reproduce many cases and to find effects in hours instead of weeks.

## Critical Analysis

This is mostly a theory paper, and its strongest part is the definition: it separates metastable from merely unstable and gives a computable test. The evidence for the practical claims is narrower than the abstract suggests.

The points below are a reading of the paper, not claims it makes.

- **The ground truth is the authors' simulator.** The abstract says the analysis "captures and predicts many instances of metastability that were observed in the field". What the evaluation compares is the chain against a simulator written for the paper, on a textbook example and one two-server example described as inspired by an industrial service. I found no comparison with measurements from a real system, so the claim about field behavior depends on how close the simulator is to real services.
- **Calibration is a fit.** Two constants are adjusted until the chain matches the simulator, and the fitted timeout (10.54 s) is about 17 percent above the real one (9 s). That suggests the correction absorbs the error of the abstraction instead of recovering true parameters. The text I read does not say whether the constants are fitted again for each point of the parameter sweeps, or how far the calibrated chain stays accurate away from the calibration points. It also gives no numeric error, only plots.
- **Numbers that are not reconciled.** For the same running example, the introduction places the point where the dynamics change at a queue length of about 100, Section 2 places it at about 65, and the hitting time jumps near 75. They may refer to different figures or definitions, but the text does not say so.
- **Mitigation evidence is one run each.** The throttling result is shown with a single simulated run, next to the chain's prediction. It is consistent, and it is still a demonstration and not a measurement of how often throttling recovers the system.
- **Scope is retries in synchronous request-response systems.** The chain models retries at an average rate tied to the timeout, so backoff and jitter, the usual mitigations, do not show up in it as far as I read. Other sustaining effects, such as caches or background work, are named as expected extensions and not modeled. The chain is ergodic, so a full queue always drains eventually and "metastable" here means a long time scale, and how long counts as long is a parameter of the definition.
- **Reproducibility is not yet supported.** The text calls the tool open source but gives no link.
- **The comparison with earlier work is the authors' own.** The paper says the queuing model in [MSF-Model](/papers/msf-model-queuing-based-prediction-of-metastable-failures) defines metastability as a large average distance from the empty state, which does not separate it from instability, and that a model without calibration deviates from simulation. That is a fair reading of the definition in that paper, and the claim about deviation was not tested here by me.

## Further Research

- Compare the model with measurements from a real service, or with the prototype of [MSF-Model](/papers/msf-model-queuing-based-prediction-of-metastable-failures), on the same load surge.
- Report calibration error, refit it across the sweeps, and test how far from the calibration data it stays predictive.
- Model backoff, jitter and retry budgets, and compare them as recovery policies the way throttling is compared.
- Extend the abstraction to caches and background work, the other sustaining effects found in [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild).
