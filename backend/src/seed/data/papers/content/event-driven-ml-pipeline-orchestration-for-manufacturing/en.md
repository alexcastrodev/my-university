---
title: "Event-Driven ML Pipeline Orchestration for Manufacturing: An AWS Industry Experience"
summary: A three-year experience report on running continuous ML training for automotive plants on AWS, built from SQS queues with dead-letter queues, a Lambda dispatcher that caps concurrent GPU tasks, and tasks that drain overflow messages. It includes a reported 2 percent dead-letter rate, a cleanup job that redrives transient failures, and a simulation of the dispatcher.
researchArea: Distributed Systems
keywords: event-driven architecture, dead-letter queue, admission control, SQS, GPU scheduling, MLOps, infrastructure as code, experience report
version: 1.0
updatedAt: 2026-11-22
---

## Overview

This is an industry experience report, accepted at the IEEE International Conference on Cloud Engineering (IC2E 2026), about operating the infrastructure that retrains machine learning models for automotive manufacturing plants. Each product on each plant line has two models: a physics model of the process and a reinforcement-learning control policy trained against it, retrained in a strict chain when production conditions change. The system has run since 2023 and has executed over 40,000 jobs. The work was funded by Liveline Technologies, whose proprietary models the system trains.

The authors' claim is that this workload is an event-driven batch workload: jobs arrive in bursts (30 to 50 requests per plant per week), take hours of expensive GPU time, and then nothing happens for days. They argue it fits queues, a serverless dispatcher and container compute better than an always-on cluster or a managed ML platform. I read the author's version posted on arXiv. The paper is about infrastructure design and operations, not about the models.

## Contribution

- **An admission-controlled dispatcher.** An SQS queue triggers a Lambda function that counts the running ECS GPU tasks. If there is capacity (a limit of 2 in production, bound to the autoscaling group maximum through one Terraform variable) it starts a task, and otherwise it forwards the message to a task queue. The Lambda has a reserved concurrency of 1 so admission decisions are serialized.
- **Queue draining.** A running GPU task first does its own work item, then polls the task queue with long polling and processes overflow messages until it sees 3 empty polls (60 seconds of silence). A bounded number of GPU instances thus works through an unbounded stream of requests without a new instance start per job.
- **Queues and dead-letter queues.** 8 SQS queues, each with its own DLQ, a maximum of 5 receives before a message goes to the DLQ, server-side encryption and 7-day retention. Visibility timeouts are set to at least 1.5 times the maximum job duration (12 hours for training queues).
- **Active DLQ cleanup.** Lambda functions triggered by a CloudWatch alarm on the number of visible messages in a DLQ log each message, classify the failure from message attributes (data quality, capacity, timeout), redrive transient failures to the source queue, and raise a structured alert for a person on persistent ones.
- **A simulation and an architecture comparison.** A discrete-event simulator, released as open source, and a qualitative comparison with SageMaker Pipelines, Step Functions, Airflow and Kubernetes.

## Methodology

Production figures come from AWS CloudWatch Container Insights and Cost Explorer filtered by an application tag, so they are self-reported by the operator. The simulator replays a 52-week workload of 2,077 requests (weekly bursts of about 40, Gaussian with sigma 10, each using 0.5 to 1.5 hours of GPU) against three strategies with a limit of 2 GPUs: naive dispatch (retry 5 times with exponential backoff, then drop the message, no DLQ), a Step Functions Map state, and the authors' pattern. It uses 2024 to 2026 us-east-1 prices and a fixed random seed.

## Findings

- **Cost.** The text says an always-on baseline costs about $3,200 a month per facility. Event-driven with on-demand GPUs is about $910 (72 percent less), and with Spot instances for the checkpointable physics model about $760 (76 percent less). The abstract gives 72 to 78 percent. The reinforcement-learning training stays on-demand because an episode cannot be checkpointed. GPU training is 96 percent of the monthly cost.
- **Admission control is needed.** In the simulation naive dispatch loses 1,342 of 2,077 jobs (65 percent), because placement failures exhaust the retry budget during bursts. Step Functions and the authors' pattern lose none. Their median latencies are within 0.7 hours (11.8 and 12.5 hours). The authors credit draining, with no per-job start, for 94 percent GPU utilization during bursts, against an always-on cluster at about 50 percent peak and under 15 percent baseline.
- **Dead letters.** About 2 percent of messages reached a DLQ over three years. By root cause, 65 percent were upstream data quality, 18 percent GPU out of memory, 12 percent transient EC2 capacity and 5 percent visibility-timeout cases. The authors say messages are never lost because the DLQ keeps them for 7 days, and that the cleanup job reduced mean time to resolution by 60 percent compared with passive monitoring.
- **Lessons.** Too short a visibility timeout caused duplicate execution that wasted about $2,000 of GPU compute in year one. Without a reserved concurrency of 1, four GPU tasks once launched from a cluster that could hold two, giving two placement failures. Messages in the DLQ were called the highest-signal operational data.

## Critical Analysis

The paper is open about its limits: one organization on one cloud, a small scale (a limit of 2 workers, behavior at hundreds of tasks unverified), cost figures from the operator's own dashboards, and a simulator that leaves out network jitter, API rate limits and zone failures.

The points below are a reading of the paper, not claims it makes.

- **The headline cost does not match the stated prices.** At $1.21 an hour, one instance running all month costs about $870, not $3,200. The text names one g4dn.4xlarge instance as the always-on baseline and does not say what else the $3,200 includes (several instances, other services). The percentages depend on that number, so it should be checked before it is reused.
- **The naive baseline is weak by construction.** It drops a message after 5 failed attempts and has no queue. The 65 percent loss describes a design nobody would run, and the comparison that matters is with Step Functions, where the result is parity in loss and latency, with a difference in start-up overhead.
- **The dead-letter numbers lack their methods.** The 60 percent drop in time to resolution has no definition of the baseline, no sample size and is not covered by the threats section. How a message gets the attribute that separates data quality, capacity and timeout, and how often it is wrong, is not described. The figure 9 caption says GPU out-of-memory and capacity cases "auto-resolve via SQS retry", but a message in the DLQ has already failed five receives, so the resolution there must be the redrive or a configuration fix, which the body text mentions for the memory case.
- **Transient versus persistent is a rule, not a test.** The cleanup redrives what it classifies as transient. The paper does not report how often a redriven message failed again, nor whether a redrive limit exists, which is the risk that [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) describes for blind retry.
- **A rare measured account of DLQ use.** The microservices review [Resilient Microservices](/papers/resilient-microservices-systematic-review-recovery-patterns) warns about "DLQ purgatory" and advises a replay policy and an SLA for the queue. This paper is a case that shows one, although with self-reported results.

## Further Research

- Rerun the cost comparison with the baseline defined (instance count, hours, services included) and with independent billing data.
- Measure the redrive loop: share of redriven messages that fail again, time to second failure, and the effect of a redrive cap.
- Test the dispatcher at hundreds of concurrent GPU tasks, where one serialized Lambda becomes a bottleneck.
- Compare against Step Functions Distributed Map and managed schedulers that did not exist in the simulation.
