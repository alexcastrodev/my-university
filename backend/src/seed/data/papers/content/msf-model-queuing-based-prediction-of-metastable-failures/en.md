---
title: "MSF-Model: Queuing-Based Analysis and Prediction of Metastable Failures in Replicated Storage Systems"
summary: Reproduces a retry-driven metastable failure in a three-node replicated store (Multi-Paxos over PostgreSQL), then builds a queuing model with a retry "orbit", a two-dimensional Markov chain and Monte Carlo simulation to predict when a load surge leaves the system stuck. The model's failure threshold lands within 0.2 requests per second of the prototype's.
researchArea: Distributed Systems
keywords: metastable failures, retry storms, queueing theory, Markov chains, Monte Carlo simulation, replicated storage, Multi-Paxos, failure prediction
version: 1.0
updatedAt: 2026-11-22
---

## Overview

A metastable failure is a state in which a system keeps running but delivers very little useful work, and stays there after the event that started it is gone. The usual culprit is a retry storm: a load surge makes responses slow, clients time out and retry, and the retries keep the system overloaded after traffic returns to normal. Earlier empirical work found that more than half of the metastable incidents it studied were sustained by retries. What was missing, the authors argue, was a way to say ahead of time whether a given configuration and a given trigger will lead to one.

This paper (SRDS 2024) does two things. It reproduces a retry-driven metastable failure on a replicated storage prototype, and it proposes MSF-Model, a queuing-theory model that predicts the outcome. I read the arXiv version of the paper. The published version may differ.

## Contribution

- **A reproduction.** A Java implementation of Multi-Paxos (see [Paxos Made Simple](/papers/paxos-made-simple)) with PostgreSQL storage, three nodes, partitioned data and batching, in which a load surge pushes the system into a state it does not leave.
- **A queuing model with memory.** The primary queue is an M/M/1 queue with infinite buffer. A second structure, the orbit space, holds requests that timed out and wait to be retried. The probability that a request retries is the probability that its wait exceeds the timeout, so a longer queue raises the retry probability, which grows the orbit, which lengthens the queue. That loop is the sustaining effect.
- **A two-dimensional Markov chain.** A state is the pair (requests in the orbit, requests in the queue). Arrivals, departures and retries are transitions with rates built from the arrival rate, the processing rate and the retry rate (the inverse of the timeout). The state probabilities are estimated with Monte Carlo simulation.
- **A distance metric.** The probability-weighted distance of the states from the empty state. It converges for a stationary system and keeps growing for a non-stationary one. The paper defines a non-stationary queuing system as one in a metastable failure.
- **Algorithm 1.** Given the normal configuration and the trigger (a changed arrival rate or processing rate, for a duration), it simulates the trigger from the empty state and sums the probability of ending in a state from which the normal configuration cannot recover. That sum is the predicted probability of a metastable failure.

## Methodology

The prototype ran on three Chameleon Cloud nodes. Clients send batches of transactions every 300 ms with a 600 ms timeout, retried at once up to three attempts in total. The scaling parameter is the batch size, and the load surge is produced by raising it.

For validation, the authors compare the model with the prototype on load surges. The load is 30 requests per second for three minutes, then a surge to a higher rate for one minute, then 30 again for three minutes. Requests arrive following an exponential distribution, with a 1 second timeout and at most three retries. They do this for batches of 3 KB, 50 KB and 100 KB, where the processing rate differs. For 3 KB the processing rate is taken as 40 requests per second.

## Findings

- **The reproduction behaves as the theory says.** With a batch of 250 KB the system is vulnerable but works. Raising the batch to 300 KB overloads it, and returning to 250 KB does not recover it: goodput stays near zero. Recovery needed a batch of 70 KB. During the failure most requests need retries, and the few that succeed are slow.
- **Exponential backoff is not a cure.** With backoff added and a 600 ms initial timeout, the metastable failure still happened. With 900 ms it started at a higher load.
- **The model shows the loop.** In the example with a processing rate of 15 and a 1 second timeout, the retry probability reaches one once the queue holds 24 requests. In a timeline, a rise of the arrival rate from 4 to 5 for 100 intervals is absorbed, and a rise from 4 to 6 leaves the system stuck even after the rate returns to 4. Recovery needs a much higher processing rate or discarding the requests in the queue and the orbit.
- **The prediction matches the prototype at the threshold.** For 3 KB batches the model says a surge above 35.5 requests per second can cause a metastable failure, and the prototype failed at 35.7 and above. The 50 KB and 100 KB cases are described as similar, without numbers in the text.

## Critical Analysis

The model is simple enough to explain and its core idea, a retry orbit whose size feeds back into the retry probability, is the part most worth keeping. The validation, though, is thin.

The points below are a reading of the paper, not claims it makes.

- **The check is one number per setup.** "High accuracy" rests on three threshold comparisons, 35.5 against 35.7 for the 3 KB case. The text I read gives no number of runs, no variance and no grid step for the load, so a 0.2 difference cannot be put in context. The processing rate used in the model is taken from the same prototype, so the test checks the structure of the model and not an independent prediction.
- **The model and the prototype differ in ways that matter.** The prototype stops retrying after three attempts. I did not find a retry limit in the transitions of the chain. The model also assumes exponential service times and a single server, while the prototype is three nodes running consensus with batching.
- **Metastable is defined as non-stationary.** That equates a metastable failure with a queue that grows without bound. A later paper, [Formal Analysis of Metastable Failures in Software Systems](/papers/formal-analysis-of-metastable-failures-in-software-systems), argues this mixes metastable with unstable behavior, because a stable queue can also be metastable, and reports that a model without calibration deviates from simulation even on simple systems. I did not reproduce either claim. They are worth checking before relying on the distance metric to classify a real system.
- **Scope is narrower than the framing.** The node-failure scenario is described but not validated, and the load surge is the only trigger tested. The model does not include backoff, so it cannot explain the backoff experiment it sits next to. Using Algorithm 1 inside a monitoring system is described as a possible use and is not evaluated.
- **Relation to field evidence.** The study of real incidents in [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) found retries as a common sustaining effect, which is why this model focuses on them. Whether it predicts failures in a production system with caches, several tiers and capped retries is left open.

## Further Research

- Report repeated runs and confidence intervals, and sweep the load finely around the threshold, to measure how often the model and the prototype disagree.
- Add a retry cap, backoff and jitter to the model and test them against the prototype, since these are the mitigations practitioners actually use.
- Validate the node-failure trigger and a system with a cache, which the paper describes but does not test.
- Compare the distance metric with the escape-probability definition of metastability in [Formal Analysis of Metastable Failures in Software Systems](/papers/formal-analysis-of-metastable-failures-in-software-systems) on the same prototype.
