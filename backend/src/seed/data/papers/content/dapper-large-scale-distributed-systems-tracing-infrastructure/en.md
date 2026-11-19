---
title: "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure"
summary: Dapper is Google's production tracing system, built on three goals (low overhead, application-level transparency, scalability) by instrumenting only a few common libraries, sampling traces, and modeling each request as a tree of spans, with an experience report after more than two years in production.
researchArea: Distributed Systems
keywords: distributed tracing, spans, trace sampling, instrumentation, observability, RPC, performance debugging
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Modern Internet services are often implemented as complex, large-scale distributed systems. These applications are constructed from collections of software modules that may be developed by different teams, perhaps in different programming languages, and could span many thousands of machines across multiple physical facilities. Tools that aid in understanding system behavior and reasoning about performance issues are invaluable in such an environment. Here we introduce the design of Dapper, Google's production distributed systems tracing infrastructure, and describe how our design goals of low overhead, application-level transparency, and ubiquitous deployment on a very large scale system were met. Dapper shares conceptual similarities with other tracing systems, particularly Magpie and X-Trace, but certain design choices were made that have been key to its success in our environment, such as the use of sampling and restricting the instrumentation to a rather small number of common libraries. The main goal of this paper is to report on our experience building, deploying and using the system for over two years, since Dapper's foremost measure of success has been its usefulness to developer and operations teams. Dapper began as a self-contained tracing tool but evolved into a monitoring platform which has enabled the creation of many different tools, some of which were not anticipated by its designers. We describe a few of the analysis tools that have been built using Dapper, share statistics about its usage within Google, present some example use cases, and discuss lessons learned so far.

## Overview

When one web search fans out to thousands of machines across many services, an engineer who sees only the end-to-end latency cannot tell which service is slow or why. The paper's answer is a tracing system that records the work done on behalf of each request across every process it touches. It is a Google technical report from April 2010, the first article, as the authors state it, to report on a large production distributed tracing framework. It sits on the same Google stack as [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), [GFS](/papers/google-file-system) and [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters): Bigtable stores the traces, MapReduce processes them in bulk, and the paper uses Bigtable, GFS and Chubby as examples of layered services to trace.

The paper places Dapper among black-box schemes (Project5, WAP5, Sherlock), which infer causality statistically and need more data, and annotation-based schemes (Pinpoint, Magpie, X-Trace), which tag every record with a global identifier but require instrumentation. Dapper chose annotation, hidden inside shared libraries.

Worth knowing first: RPC, thread-local storage, and why a request that crosses many servers leaves its evidence scattered in many logs.

## Contribution

- **Three design goals.** Low overhead (negligible impact, or teams turn tracing off), application-level transparency (programmers need not be aware of it) and scalability. The authors add a target that data be available for analysis ideally within a minute.
- **Trees, spans and annotations.** A trace is a tree whose nodes are spans, units of work with a name, a span id, a parent id, timestamps and optional annotations. All spans of a trace share a trace id. Ids are probabilistically unique 64-bit integers. A span with no parent is a root span.
- **Instrumentation in a few libraries.** The trace context lives in thread-local storage. A common control-flow library makes callbacks carry the creator's context. The single RPC framework, in C++ and Java, defines spans around all RPCs and sends trace and span ids from client to server.
- **Annotations, opt-in.** A simple API for timestamped text and key-value annotations, with a configurable per-span volume limit so they cannot displace the structural span data. No RPC payload is logged, only method names.
- **Out-of-band collection.** Spans go to local log files, Dapper daemons pull them, and collectors write them to a regional Bigtable repository, one trace per row and one column per span. Sampling is the main tool for keeping overhead low.
- **A platform.** The Depot API (DAPI) offers access by trace id, bulk access through MapReduce, and indexed access, and a web UI sits on top.

## Methodology

This is an experience report, not a controlled study. The measurements come from Google's production environment: microbenchmarks of the runtime library on a 2.2GHz x86 server, a load test of the collection daemon, and an experiment on a web search cluster that varies the fraction of sampled traces. Usage statistics come from logs and from counts of tools and applications known to the Dapper team. The use cases (Ads Review, universal search, service dependencies, network usage, shared storage) are told by the teams or authors who worked on them.

## Findings

These are the authors' reported results.

- **Trace generation.** Creating and destroying a root span takes 204 ns on average and a non-root span 176 ns, the difference being the cost of a globally unique trace id. An annotation costs about 9 ns on an unsampled span and 40 ns for a string literal on a sampled one.
- **Collection.** The daemon never uses more than 0.3% of one core under an unrealistically heavy test (0.125% to 0.267% in Table 1). A span averages 426 bytes, and trace data is under 0.01% of the network traffic in production.
- **Sampling on web search (Table 2).** Tracing every request adds 16.3% average latency and -1.48% throughput. At 1/16 it is 2.12% and -0.08%, and at 1/1024 it is -0.20% and -0.06%. Below 1/16 the penalties are within experimental error (2.5% for latency, 0.15% for throughput). The first production version used a uniform probability of one trace in 1024, and the authors report that a sample of one in thousands of requests suffices for many uses, even 0.01% for high-traffic services.
- **Second sampling.** More than 1 TB of sampled trace data per day. The collection system keeps or drops whole traces by hashing the trace id against one coefficient. Users want data kept for at least two weeks.
- **Collection delay.** The median time from the application to the repository is under 15 seconds. The 98th percentile is under two minutes about 75% of the time and can grow to many hours the other 25%.
- **Coverage.** The daemon is in the base machine image of virtually every server, and 40 C++ and 33 Java applications needed manual propagation, out of thousands. Core instrumentation is under 1000 lines of C++ and under 800 of Java. 70% of spans and 90% of traces have at least one application annotation.
- **Use.** About 200 distinct engineers use the UI on a weekday and 750 to 1000 in a week. DAPI has 3 persistent applications, 8 on-demand tools and about 15 to 20 one-off tools.
- **Experiences.** The Ads Review team estimates latency improved by two orders of magnitude. Traces found queries needlessly sent to the master database, and unnecessary serial requests on the critical path. In universal search, slow traces mostly had network degradation on the critical path. A service-dependency project infers dependencies from annotations, and a network console was built on the APIs in under 2 weeks.

## Critical Analysis

The authors list the limits themselves.

- **Homogeneity.** Transparency depends on one threading model, one control-flow library and one RPC system. The paper calls its environment somewhat unusual in this and offers only sufficient conditions for more heterogeneous ones.
- **Coalescing and batching.** The model assumes subsystems work for one traced request at a time. When requests are batched, a traced request can be blamed for a deceptively large unit of work, and only one of the batched requests appears responsible, because each trace has a single trace id. Batch workloads such as MapReduce need the id tied to another unit, such as a key range or a shard.
- **Root cause.** Dapper shows where a slowdown is, not always why. A request can be slow because others were queued ahead of it. The paper suggests annotations with queue sizes and the paired sampling of ProfileMe, and notes kernel-level information is hard to tie to a user-level context.
- **Out-of-band collection.** Chosen so traces do not inflate RPC responses and because RPCs are not always perfectly nested, since middleware may reply before its own backends finish.
- **Firefighting.** Until bulk analysis completes within 10 minutes of an event, shared storage services cannot use Dapper fully.
- **Adaptive sampling is in progress.** The text lists it among the design's features, but Section 4.4 says it is being deployed. What ran in production was uniform, plus the second sampling in the collectors.

The following points are a reading of the evidence, not claims of the paper.

- **No numbers for sampling's cost to analysis.** The argument that frequent patterns show up thousands of times is sound for common cases. Rare slow requests, the very ones that matter for tail latency, are the cost, and the paper offers no data on how often they are missed.
- **Later literature (not in the paper).** The Canopy paper (Facebook, SOSP 2017) describes Dapper as modeling traces as trees of spans and reports that users of the open-source Zipkin struggled with queues, asynchronous executions and multiple-parent causality. Canopy argues that fixing a high-level model in pervasive instrumentation causes problems for legacy and future components, and describes a pipeline that derives performance data from system-generated traces. The OpenTelemetry documentation today describes spans with a SpanContext and a list of Links to other spans, which allow relations outside a strict tree, and it distinguishes head sampling (decided as early as possible, like Dapper's runtime) from tail sampling (decided after inspecting the whole trace).

## Further Research

- Sampling that keeps rare slow traces: what decides to keep a trace, and with which accounting of the real probability, which Dapper records with the trace.
- Tracing of batches and queues without losing causality: the open question the authors name for coalescing effects and for MapReduce workloads.
- Joining traces with kernel-level events and resource data, which the paper only sketches.
- Faster aggregation during incidents, relevant to failures that are hard to see from one node, such as [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) and [metastable failures](/papers/metastable-failures-in-distributed-systems).
