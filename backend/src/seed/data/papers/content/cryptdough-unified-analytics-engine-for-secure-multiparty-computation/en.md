---
title: "CryptDough: A Unified Analytics Engine for Secure Multiparty Computation"
summary: CryptDough is a layered engine for secure multiparty computation that runs relational, time series and ML inference workloads, and pipelines mixing them, under four MPC protocols covering semi-honest and malicious adversaries, using vector-only data types and virtual vectors so that library authors write single-threaded oblivious code while the runtime batches messages and parallelizes it.
researchArea: Security and Privacy
keywords: secure multiparty computation, secret sharing, oblivious algorithms, secure analytics, virtual vectors, threat models, ml inference
version: 1.0
updatedAt: 2026-11-18
---

## Overview

Secure multiparty computation (MPC) lets several parties compute a function over their private data and learn only the result, by splitting each value into secret shares held by independent computing parties. Real deployments are few and mostly simple (aggregate statistics, basic ML), and the authors, from Boston University, name three reasons that pull in different directions. Threat models vary: some uses accept semi-honest (honest-but-curious) parties, others need protection from malicious ones, with an honest or a dishonest majority. Analytics pipelines mix workloads, such as a relational query feeding an ML model, or time series windows followed by aggregations. And analysts want high-level programs without cryptographic expertise.

Existing systems each target one protocol or one workload (ML inference, relational queries or time series), so a mixed pipeline means stitching systems together, with incompatible data encodings, threat models and runtimes, or writing everything in a general MPC compiler. This SOSP 2026 paper presents CryptDough as the first unified analytics system for MPC, with built-in support for mixed workloads under various threat models and a design aimed at modularity and extensibility.

Terms to keep apart: a secret share is one random piece of a value (arithmetic shares add up to the secret modulo `2^l`, boolean shares XOR to it), an oblivious algorithm has control flow that never depends on secret data, a Beaver triple is precomputed correlated randomness (a, b, c with c = a x b) used to multiply shares, and malicious security with abort means the computation stops as soon as cheating is detected.

Worth knowing first: additive secret sharing and why multiplication needs communication while addition does not, and how sorting networks give data-independent comparison sequences. The paper's relational and time series libraries build on earlier systems it names, ORQ and TVA, so reading about them helps.

## Contribution

- **A four-layer hierarchy.** Low-level MPC functionalities (secure `+`, `x`, XOR, AND), then oblivious primitives (comparisons, multiplexers, adders, compare-and-swap, ReLU, convolution, matrix multiplication), then high-level operators, then operator composition. Every layer except the bottom is protocol-agnostic and uses the layer below as a black box, so the code has no branches on secret data and runs the same operations for all inputs of a given size.
- **Three kinds of user, one stack.** A data analyst composes dataflows with a declarative, Spark-like API (`SecureTable`, `SecureTS`, `SecureMatrix`). A library developer writes new secure operators from vectorized primitives. An applied cryptographer adds a protocol by defining a share type, the number of parties and a small set of functionalities, with a communicator and a randomness generator provided. Work by each kind of user is meant to benefit the other two without integration effort, and experts can override defaults with protocol-specific versions, for example a dot product that does the interactive part of the multiplication once instead of per element in replicated sharing.
- **Vector-only programming model.** Data types are containers (`Vector`, `EVector` for several shares per secret or MACs, `SharedVector`) that support only whole-container operations. The operator and analytics layers forbid element loops and conditionals on private data, and data-dependent choices use an oblivious multiplexer that evaluates both branches. This lets the runtime batch messages across element-wise operations, so a compare-and-swap takes `O(log |T|)` rounds, where `|T|` is the share size in bits, instead of `O(n log |T|)` for a per-element loop.
- **Virtual vectors.** Oblivious algorithms such as sorting and prefix networks touch non-contiguous elements. A virtual vector `W` is a restricted view of a base vector `V` with `W[i] = V[f(i)]`, built declaratively with `offset()`, `step()` and `limit()`. The runtime partitions and distributes virtual vectors like contiguous ones, handling index translation and memory, so library developers write single-threaded code and still get parallelism without extra copies of the data.
- **Execution model.** Each party is one OS process with a coordinator thread and worker threads. Corresponding workers across parties form independent mini-clusters with their own protocol, communicator and randomness objects, and dedicated communication threads exchange messages through lock-free buffers. Mini-clusters synchronize only at primitive boundaries.
- **Protocols and libraries.** Four protocols span the threat models: ABY (semi-honest, dishonest majority), ABY3 (semi-honest, honest majority), Fantastic Four (malicious, honest majority) and SPDZ2k (malicious, dishonest majority). The relational library has the functionality of ORQ plus fixed-point arithmetic, prefix networks and bitonic sort, the time series library has tumbling and session windows and the time-agnostic operators of TVA, and the ML library has convolution, ReLU, pooling and fully connected layers for networks such as VGG-16 and AlexNet. The code is C++ (libsodium, libOTE, Blaze) with an MPI or socket communicator.

## Methodology

Experiments use four environments: a bare-metal cluster of four 96-core AMD EPYC 9655P machines in a LAN (up to 25 Gbps, 0.17 to 0.25 ms RTT) and in a throttled WAN (6 Gbps, 20 ms RTT), and two AWS g6.8xlarge instances with NVIDIA L4 GPUs in the same two settings. Shares are 64 bits unless stated, numbers are the average of three runs, and for dishonest-majority protocols only online time is reported.

The first experiment is an end-to-end mixed pipeline on all four protocols: VGG16 classification of 64 X-ray images, a join with 1K asthmatic patient records, a threshold window with filter and aggregation over 16K oxygen saturation measurements, and a relational subquery with a join, three filters and a group-by. Then CryptDough is compared, always under the same threat model, with ORQ (nine real-world queries at scale factor 1, about 5M rows per table), TVA (its three applications on time series of 2^22 rows, with 32-bit shares and bitonic sort, 16 threads), Pigeon (AlexNet and VGG16 on CIFAR-10 and ImageNet, 192 images, 24 processes), Piranha (GPU only, run on AWS against single-threaded CryptDough) and MP-SPDZ (a custom AlexNet under SPDZ2k, 16 threads, 192 images). Finally the scaling of primitives (comparison, ripple-carry and parallel-prefix adders, convolution) and of bitonic sort and quicksort is measured from 1 to 32 threads on ABY3. No stitched-together baseline of specialized systems is built, only a cost estimate.

## Findings

These are the authors' reported results.

- **Mixed pipeline.** With semi-honest security the whole pipeline takes about 1 minute in the LAN and under 5 minutes in the WAN. Malicious security takes 18 minutes with an honest majority and just over 1 hour with a dishonest majority in the WAN. The authors say this is the first demonstration of such a mixed analytics pipeline under MPC, and the first evaluation of VGG16 inference with SPDZ2k.
- **Relational and time series.** CryptDough averages a 1.5 times speedup over ORQ on its queries, and beats TVA in all but one configuration, with up to 2.7 times lower latency.
- **ML inference.** Against Pigeon it is competitive and faster in the LAN, while in a high-RTT setting Pigeon's custom ReLU circuits give it an advantage. Single-threaded CryptDough beats Piranha in all but one case, up to 2.2 times faster inference. Against MP-SPDZ it wins in LAN and WAN, up to 4.7 times lower inference time in the WAN.
- **Scaling.** Comparison and addition scale almost perfectly to 8 threads, about 2 times per doubling, and about 1.5 times from 16 to 32. Convolution, with a high ratio of communication to computation, gains 1.45 to 1.1 times per doubling. Bitonic sort and quicksort, written as single-threaded oblivious control flow, are parallelized by the runtime.
- **Effort.** Writing one relational query directly from low-level primitives takes about 800 lines even with the vectorized API, and about twice as many in an earlier version of the code without it.

## Critical Analysis

The paper states several limits itself.

- **No fault tolerance or scale-out.** Each party is one server and a failure restarts the computation. The authors say real MPC deployments have very few parties and that horizontal scaling inside a party is future work.
- **Virtual vectors are not checked.** Nothing verifies at compile time or run time that a developer uses them correctly, which depends on oblivious stages being conflict-free. Oblivious shuffling needs random access, so most of it runs single-threaded.
- **Baselines sometimes use better protocols.** The authors note that some baseline protocols are more efficient than the ones CryptDough implements, which favors the baseline, and that they leave out the Fantastic Four protocol in ORQ because of a published attack whose fix was in progress.

The following points are a reading of the evidence, not claims of the paper.

- **The central claim is not measured.** The case for a unified engine rests on avoiding the cost of stitching systems together (initialization, re-sharing, materializing intermediate shares), but that cost is only estimated, and the pipeline is small (64 images, 1K records, 16K readings). The comparisons show CryptDough does not lose much on single workloads, not how much a user gains on mixed ones.
- **Mixed hardware and thin statistics.** The Piranha comparison puts GPUs on AWS against CPUs on bare metal, results are means of three runs with no spread, and dishonest-majority numbers leave out the offline phase, which is the expensive part for those protocols.
- **Security is inherited, not shown.** The system claims the guarantees of the underlying protocols and hides even intermediate and output sizes, which needs padding bounds. The text I read gives no composition proof for the layers and no leakage analysis of virtual vectors, and the padding cost is not reported separately.
- **Expressivity has a price.** Without loops or conditionals on private data, any program outside the vector operators must be written by an expert one layer down, and the paper's examples are operators and models from the authors' own libraries. Training is not covered, only inference.
- **Maintenance of four protocols is unproven.** Extensibility is argued with four protocols the authors wrote, and the evaluation does not show an outside cryptographer adding one. The virtual vector index mappings are materialized in memory, which the authors flag as a design point they are still revisiting.

## Further Research

- Fault tolerance and distributed execution inside each logical party, and handling many more parties.
- Compile-time or run-time verification of virtual vector use, and better parallelization of oblivious shuffling.
- Alternative implementations of virtual vectors (iterator-based, expression templates) to avoid materializing index mappings, and an optimizer that mixes protocols within one pipeline.
- Measuring the end-to-end gain over stitched systems on large mixed pipelines, and extending the libraries to graph analytics and to training.
