---
title: "The Dataflow Model: A Practical Approach to Balancing Correctness, Latency, and Cost in Massive-Scale, Unbounded, Out-of-Order Data Processing"
summary: A programming model for stream and batch processing that treats data as unbounded and late, and separates what is computed, where in event time, when in processing time, and how results are refined.
researchArea: Distributed Systems
keywords: stream processing, event time, windowing, triggers, watermarks, dataflow
version: 1.0
updatedAt: 2026-11-01
---

## Overview

A lot of useful data never ends: web logs, mobile usage, sensors. It also arrives out of order, because phones go offline and networks are slow, so the time at which an event happened (event time) differs from the time at which the system sees it (processing time). Older practice treated such data as a batch that would eventually be complete, or used a stream engine that was fast but approximate, and the authors say teams ended up with disparate systems for each need.

This VLDB 2015 paper from Google proposes the Dataflow Model, a way of writing these computations that gives up the idea of completeness and lets the practitioner choose a point between correctness, latency and cost. It is the model behind Google Cloud Dataflow and its open source SDK, which later became Apache Beam.

Worth knowing first: MapReduce-style batch processing, the difference between event time and processing time, and what a window is (a finite slice of a stream, such as the events of one session or of one minute).

## Contribution

The model asks four questions of every pipeline:

- **What** results are computed (the transformations and aggregations).
- **Where** in event time (windowing, including windows that do not align across keys, such as per-user sessions).
- **When** in processing time results are produced (triggers, driven by watermarks, counts or timers).
- **How** later results relate to earlier ones (accumulation: discard, accumulate, or accumulate and retract).

Around this the paper offers a windowing API with unaligned event-time windows, a declarative triggering model, support for updates and retractions, and a list of design principles. Its stated view is that batch, micro-batch and streaming engines can all give the same correct answers, and the choice among them should come down to latency and cost.

## Methodology

The paper is a design and semantics paper. It builds up the model with a running example, summing integer values per key with several windowing, triggering and accumulation choices, and shows the output of each choice on the same sample data in figures. It defines the watermark as a lower bound, often heuristic, on the event times still to be seen.

Validation is by experience and not by benchmark. The model was implemented in FlumeJava with MillWheel as the streaming engine, with an external reimplementation for Cloud Dataflow, and the authors describe how real pipelines at Google (billing, statistics, abuse detection, recommendations) shaped it.

## Findings

These are the authors' reported results, and they are qualitative.

- Watermarks alone are a poor completion signal. A heuristic watermark can let late data through, and a slow one, delayed by stragglers, holds all results back. One billing team had trouble with watermark lag from stragglers, and a team without updates and retractions left the platform to build its own solution, which ended up close to the model described.
- Triggers let the same data produce different outputs without changing the computation. Statistics and abuse-detection pipelines are happy with a watermark trigger or a percentile watermark, because a mostly complete answer sooner is worth more than a perfect answer later.
- Batch is treated as a special case: ideas such as early termination of a long job based on progress become an ordinary trigger.
- A large part of the windowing and triggering code is shared by the batch and streaming implementations.

## Critical Analysis

The ideas have been influential, and many open-source stream engines adopted similar concepts. That is partly why it is worth reading with some distance.

- **No measurements.** The paper does not report latency, throughput or cost, and the implementation details are left to earlier papers. The claim that the model lets you tune cost, latency and correctness is argued by examples, not shown by data.
- **Authors and system share an owner.** The experiences come from Google teams and products, and the paper also introduces a commercial service. Independent evidence comes from later adoption outside the paper.
- **Watermarks are still heuristics.** The paper admits that most real watermarks cannot be exact. The model gives tools for living with late data (allowed lateness, retractions) but the choice of trigger is left to the practitioner and is easy to get wrong.
- **Cost of retractions.** Emitting retractions and refinements pushes complexity downstream, since consumers must handle updates, and the paper does not quantify the state kept to support them.
- **Statement of principle.** Claims such as "the future of data processing is unbounded data" are opinions of the authors.

## Further Research

- Measuring the cost of state, triggers and retractions under real load, and comparing engines that implement the model.
- Better, and possibly adaptive, watermark estimation, and guidance for choosing triggers and allowed lateness.
- Exactly-once and consistency questions at sinks that cannot take retractions.
- A deeper account of the shared batch and streaming runtime, which the authors say deserves its own analysis.
