---
title: "Rakaia: Scalable In-Kernel Scheduling for TCP-Based RPCs"
summary: Rakaia is a Linux kernel module that cuts messages out of TCP streams in the receive path and schedules them from a logically central queue, so worker threads see messages instead of connections and head-of-line blocking goes away while TCP stays unchanged on the wire.
researchArea: Operating Systems
keywords: rpc, head-of-line blocking, in-kernel scheduling, tcp, work conservation, grpc, ktls
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Cloud applications mostly carry RPCs over TCP and TLS, but the POSIX TCP API hands userspace one byte stream per connection, with no message boundaries. Two kinds of head-of-line (HOL) blocking follow. Inter-connection HOL blocking happens when traffic is uneven across connections, so some cores idle while others queue. Intra-connection HOL blocking happens when a slow RPC delays every later RPC on the same connection. Frameworks such as gRPC rebuild message semantics in userspace with I/O threads, work queues and worker pools, and pay for it in context switches and synchronization.

This OSDI 2026 paper, from EPFL, asks whether RPCs free of HOL blocking are possible without that machinery and without abandoning TCP, as Homa-style transports and userspace stacks do. Its answer is Rakaia, a Linux kernel module that exposes a purely message-oriented socket and schedules messages inside the kernel.

Four terms are worth keeping straight. Work-conserving means no core idles while any message waits. Throughput-under-SLO is the highest load a server sustains while its p99 latency stays within a target. The MS model is the ideal message-shared FIFO queue, the yardstick of the paper. KCM is the Kernel Connection Multiplexor, Linux's existing in-kernel message API over TCP.

Worth knowing first: the Linux TCP receive path (softirq context) and how queueing drives tail latency. For contrast, the paper cites [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) among the userspace dataplanes that replace the Linux TCP stack. Two pairings of mine, not the paper's: [Snap](/papers/snap-microkernel-approach-to-host-networking) moves host networking out of the kernel, and [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) delegates scheduling policy to userspace, while Rakaia moves message scheduling into the kernel's receive path.

## Contribution

- **Two insights.** Parse and schedule messages in the same softirq that already runs the TCP receive path, and detach messages from their connections as early as possible. KCM follows the first insight but ties each message to its connection, so it schedules locally and still suffers inter-connection HOL blocking. With T threads and C connections it also creates T times C sockets, which the authors call a quadratic blow-up.
- **A connection-oblivious socket.** Each worker thread opens one `AF_RAKAIA` socket and attaches existing TCP connections with a single `rakaia_attach` ioctl that picks a built-in parser (Memcached, or HTTP/2-based protocols such as gRPC). After that it only calls `recvmsg` and `sendmsg`, and epoll watches one file descriptor per thread instead of one per connection. The socket keeps no per-connection or remote-peer state.
- **Receive path.** The kernel's `strparser`, which KCM also uses, extracts messages. The authors extend it to HTTP/2 by buffering frames per stream and coalescing them when END_STREAM arrives, and control frames such as PING and WINDOW_UPDATE are answered in the kernel. Each message goes to one of the per-socket FIFO queues, chosen by power-of-two choices (sample two sockets, take the shorter queue). An empty chosen queue means direct handoff to the idle worker, and a worker with an empty queue steals from another, found through a bitmap of non-empty queues. The queue is logically centralized and physically distributed.
- **Transmit delegation.** Taking the TCP socket lock in every sender would serialize threads and put some to sleep. Each connection instead has a staging queue and a flag. A sender that finds the flag set enqueues its message and returns. Otherwise it becomes the designated transmitter: it takes the lock, moves the staged messages into the TCP write queue, calls `tcp_push` and rechecks the staging queue before releasing the lock. Each message is copied into its own skb, which keeps failure paths simple.
- **TLS and size.** Rakaia works over kTLS, where the handshake stays in userspace and record processing moves to the kernel. Decryption runs from a Linux workqueue, because the authors find softirq decryption in kTLS not robust today. The module has about 3,000 lines of C on Linux 6.8, plus about 60 lines in the kernel to register the socket type, and the authors modified gRPC-Go and gRPC-C++ to use it.

## Methodology

The evaluation has two layers. A discrete-event simulation compares three queuing models on a 20-core server: connection-partitioned FIFO (CP), connection-shared FIFO (CS) and message-shared FIFO (MS). It uses an open-loop Poisson load and zero system overheads, to separate queuing effects from implementation costs.

The real experiments run on CloudLab xl170 nodes (one 10-core Xeon E5-2640v4 with hyperthreading, Ubuntu 24.04, Linux 6.8), with the server using 20 hyperthreads and an extended Lancet open-loop load generator reporting p99 latency against achieved load. Service times are deterministic, exponential or bimodal (90% of requests at half the mean, 10% at 5.5 times the mean), for 100 µs and 20 µs tasks, with 20, 80 and 5,000 connections, with and without TLS. Baselines are TCP-CP and TCP-CS programs, a userspace Worker Pool (I/O threads feeding a shared ring), KCM with the same parser, and official gRPC-Go v1.75.0 and gRPC-C++ v1.78.1 against their Rakaia ports. Applications are Silo running TPC-C (garbage collection off, no SQL marshalling) and the OpenTelemetry Collector with a no-op and a Jaeger-backed exporter.

## Findings

These are the authors' reported results.

- **Matches the theory.** In simulation, CP does not balance load even with 5,000 connections, CS suffers intra-connection HOL blocking that eases as connections grow, and CS with 5,000 connections nearly matches MS. In the 100 µs experiments Rakaia stays close to the MS curve at every connection count.
- **Versus plain TCP.** With 20 connections and bimodal times Rakaia sustains about 160 KQPS while TCP-CS reaches about 40 KQPS, roughly 4×. At 5,000 connections the gap shrinks to 7%, as expected when connections are plentiful.
- **Versus KCM.** KCM reaches about 30 KQPS in the bimodal case, 19% of Rakaia's throughput, and with 20 µs tasks it does worse than both plain TCP models. The abstract summarizes this as up to 5× higher throughput-under-SLO.
- **Versus the Worker Pool.** It tracks Rakaia at 100 µs but falls behind at 20 µs, where the authors say it degrades under exponential and bimodal times even after tuning.
- **gRPC-Go.** With 80 connections gRPC-Rakaia sustains 39% more load than gRPC-POSIX. From 80 to 5,000 connections gRPC-POSIX loses 11% and gRPC-Rakaia stays nearly flat, giving 1.56× at 5,000. At 170 KQPS the goroutine count is 1,077 and 16,946 for POSIX at 80 and 5,000 connections, against 29 and 33 for Rakaia. At 5,000 connections, moving work into the kernel adds 1.8 points of kernel CPU time and removes 22.7 points of userspace time.
- **gRPC-C++.** The async and callback APIs gain 2× and 2.33× at 80 connections, and 2.69× and 2.67× at 5,000. The sync API is left out because its handlers run on a dynamically growing thread pool, and gRPC-Rakaia offers the same user-facing API as sync.
- **TLS.** With 100 µs tasks Rakaia-kTLS reaches about 120 to 130 KQPS, against 130 to 140 for TCP-CS-TLS and the TLS Worker Pool. With 20 µs tasks it reaches 320 to 340, against about 380 for TCP-CS-TLS and 200 to 220 for the TLS Worker Pool. The authors blame the workqueue and call the limit not fundamental.
- **Applications.** For Silo on TPC-C, at a 500 µs tail latency Rakaia sustains 350 KQPS against 309 for TCP-CS-80 and 299 for the Worker Pool, and gRPC-Rakaia improves gRPC-POSIX by 1.25× at 80 connections and 1.39× at 5,000. For the OpenTelemetry Collector the gain is 1.35× with the no-op exporter (192 against 142 KQPS at a 2 ms p99 SLO) and 1.42× with Jaeger (131 against 92 KQPS).

## Critical Analysis

The paper is candid about what staying on TCP costs. It concedes the following.

- **Inherited TCP limits.** With the stack unmodified, a lost or reordered segment still stalls its connection, and sender-driven congestion control still handles incast worse than receiver-driven transports such as Homa. The authors call this the price of wire compatibility and unmodified clients.
- **Narrow coverage today.** Parsers exist only for Memcached and HTTP/2-based protocols, gRPC works only in Go and C++, SmartNICs that fully offload TCP are incompatible, and richer policies such as priority queues are left for later. The kTLS workqueue also caps throughput for now.

The following points are a reading of the evidence, not claims of the paper.

- **One machine type.** Every real result comes from one CloudLab node type with a single 10-core CPU. "Scalable" is shown along connection count (20 to 5,000), not along cores or sockets, so cross-socket queues, stealing and cache traffic at higher core counts are not tested.
- **No spread reported.** The text gives no payload sizes for the synthetic runs and no repetition counts or error bars, and many comparisons are read off p99 curves. A 7% difference at 5,000 connections has unknown run-to-run noise.
- **Baselines built and tuned by the authors.** TCP-CP, TCP-CS and the Worker Pool are their own programs. The Worker Pool's I/O and worker thread counts were swept per service time, but at 20 µs it was tuned for fixed times only, and with TLS it kept the unencrypted configuration, which the authors say explains its drop. A better tuned pool could narrow those gaps.
- **Headline gRPC gains are maxima, and plaintext.** The 1.56× and 2.69× figures are at 5,000 connections, and at 80 connections they are 1.39× for Go and 2× to 2.33× for C++. Much of the gain comes from gRPC-POSIX degrading as goroutines multiply. gRPC-Rakaia was never run with TLS, since Go lacks kTLS, although the paper says RPC protocols almost universally use TLS, and Rakaia-kTLS trails TCP-CS-TLS in the microbenchmarks.
- **The motivating alternatives are not measured.** Homa, eRPC and similar designs justify the work, yet none appears as a baseline, so the cost of staying on TCP is argued, not quantified. Loss and incast, which the paper names as limits, are not measured either.
- **Deployability is partial.** Clients stay unmodified, but the server needs a patched kernel (the 60-line socket registration) and a modified gRPC. The paper does not give the size of the gRPC change or any upstreaming status.
- **Attack surface is not discussed.** The module parses untrusted HTTP/2 and handles flow control in softirq context. The text does not discuss hardening, fuzzing or failure containment for in-kernel parsers.

## Further Research

- Patching kTLS to decrypt safely in softirq context, which the authors plan and which should remove the workqueue bottleneck.
- Richer queueing models such as priority queues, other RPC protocols through in-kernel or eBPF parsers, gRPC for Java and Rust, and io_uring, all named by the authors.
- A many-core and multi-socket evaluation with I/O-bound handlers and injected loss or incast, to see where inherited TCP limits start to dominate.
- Hardening in-kernel message parsers against malformed input, for example by fuzzing or by moving parsers to eBPF.
