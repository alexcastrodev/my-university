---
title: "Dirigent: Lightweight Serverless Orchestration"
summary: Dirigent is a clean-slate cluster manager for function-as-a-service platforms that swaps Kubernetes-style orchestration for a few small abstractions, no persistent writes on the cold-start path and monolithic control and data planes, which the authors report lets it create sandboxes orders of magnitude faster than Knative.
researchArea: Distributed Systems
keywords: serverless, function as a service, cluster manager, cold start, sandbox scheduling, kubernetes, control plane
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Function-as-a-service (FaaS) workers can start a sandbox in tens to hundreds of milliseconds, yet in real clusters the end-to-end latency to get a function running is often one or more orders of magnitude higher. The authors place the gap in the cluster manager, which must pick a worker for each new sandbox and then plug it into the cluster so that it receives traffic. That work scales badly when many sandboxes are created at once, which FaaS makes routine: in the Azure Functions trace the authors simulate, the manager creates about 300 sandboxes per second on average, with bursts of thousands.

This SOSP 2024 paper (Austin), by Lazar Cvetković, François Costa, Mihajlo Djokic, Michal Friedman and Ana Klimovic at ETH Zurich (one author also at IBM Research Europe), blames the habit of building FaaS managers on Kubernetes (K8s), which was designed for long-lived, stateful applications. Its answer is Dirigent, a new cluster manager that keeps the user API of Lambda or Knative (register a function, invoke it) and rebuilds everything underneath.

Key terms: a **sandbox** is the isolated environment that runs a function instance, a **cold start** is an invocation that must wait for a new sandbox, and a **warm start** reuses an existing one. The **control plane** creates, places and tears down sandboxes, and the **data plane** routes, buffers and throttles invocations. **Churn** is the rate at which sandboxes are created and removed.

Worth knowing first: K8s controllers and reconciliation loops, Knative as the autoscaling layer on top of K8s, Firecracker microVMs, [Raft](/papers/raft-understandable-consensus-algorithm), which the paper cites for control plane leader election, and [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs), one of the works the paper cites on stronger request-level guarantees.

## Contribution

- **A root cause analysis.** With Knative as the representative case, the authors show that creating one sandbox takes tens of RPCs and sequential database updates, because K8s controllers can only exchange state through read-modify-write operations on etcd, behind the API server. The objects are large (key-value pairs averaging 17 kB in their experiments), so the API server burns CPU on serialization, and every update is persisted with strong consistency. OpenWhisk, bare Pods and K3s show similar problems.
- **Simple abstractions.** Four objects replace Deployments, ReplicaSets and Endpoints: Function, Sandbox, DataPlane and WorkerNode. A sandbox's state takes 16 bytes, where the authors find a K8s Pod definition can reach 17 KB, and it is stored in a compact binary format.
- **No persistent writes on the cold-start path.** The control plane persists only what it needs to restart: functions (with their scheduling configuration), data planes and worker nodes, in a replicated database. Sandbox state is rebuilt from the workers and scheduling metrics from data plane traffic. The price is deliberate: after a failure Dirigent need not restore the same number of sandboxes, IP addresses or placement, since FaaS hides all three from users.
- **Monolithic planes.** Control plane modules (state manager, health monitor, autoscaler, placer) talk through in-memory channels and atomic primitives, with one active replica and standbys. Data plane replicas are all active, buffer cold invocations in per-function queues and throttle concurrency, which removes Knative's per-sandbox queue-proxy sidecar. A front-end load balancer hashes the function ID so that one data plane tracks each function's in-flight requests. The two planes stay separate so that warm-start load can scale on its own.
- **Recovery rules.** A new control plane leader, elected with Raft, reloads data planes, worker nodes and functions from the database and then merges the sandbox lists that workers report. Recovered sandboxes are not downscaled for one autoscaling window (60 s by default). A restarted data plane pulls the function and sandbox lists, and workers are judged by heartbeats. Data planes may route to a vanished sandbox, because Dirigent favors availability over consistency.
- **Limited request-level guarantees.** Synchronous invocations get none, as on Lambda or Knative, and asynchronous ones get at-least-once through request persistence and retries.

## Methodology

Dirigent is about 11.3K lines of Go. Components talk over gRPC, Raft elects the control plane leader, systemd restarts failed processes, and Redis (append-only mode, fsync on every query, one replica beside each control plane replica) holds the persisted state. Workers run containerd or Firecracker, with or without microVM snapshots, and keep a pool of pre-created network configurations to avoid kernel contention. Scheduling reuses Knative's default autoscaling, placement and load-balancing policies, to keep the comparison fair.

Experiments run on a 100-node CloudLab xl170 cluster (10-core Xeons, 64 GB of DRAM) with 3 control plane and 3 data plane replicas and prefetched images and snapshots. Baselines are Knative v1.13.1 and OpenWhisk v1.0.1 on K8s v1.29.1, plus AWS Lambda in us-east-1 invoked from EC2. The authors dropped OpenFaaS because its community version supports only up to 15 functions. Microbenchmarks use hello-world functions on 93 workers. The macro-benchmark replays a 30-minute window of the Azure trace (500 functions, 168K invocations, first 10 minutes discarded) with the InVitro load generator, plus a larger sample of 4000 functions and 3.33M invocations. Components are also killed on purpose. The code is open source, and the authors thank artifact evaluators for verifying the results.

## Findings

These are the authors' reported results.

- **Cold start throughput.** Dirigent peaks at 1750 cold starts per second with containerd, limited by kernel lock contention in sandbox creation, network setup and iptables updates. With Firecracker snapshots it reaches 2500, with control plane CPU at 55% and lock contention on autoscaling data structures as the bottleneck. Knative and OpenWhisk saturate below 2 per second, which is the paper's 1250× headline.
- **Unloaded cold start.** Dirigent is faster even at 1 cold start per second. Knative needs about 400 ms to boot the user container and its sidecar, created one after the other, and then about 500 ms of readiness probes.
- **Warm starts.** Dirigent sustains 4000 warm invocations per second with p50 of 1.4 ms and p99 of 2.5 ms, until the machine runs out of ports. Knative peaks at 1200 per second with p50 of 7 ms.
- **Registration and scale.** Registering a function takes 2 ms on average in Dirigent against about 770 ms in Knative on an empty cluster, and the authors report about 18 minutes against 1 second for the registration experiment (the passage gives no function count). With emulated workers, throughput matches the real runs up to 2500 workers and reaches 2000 cold starts per second at 5000.
- **Ablation.** Persisting sandbox state too lowers peak throughput to 1000 cold starts per second, and p99 surges at 500. Knative on K3s, a single-process K8s, gains only marginally, so the authors conclude that state management matters more than a monolithic control plane.
- **Azure trace, 500 functions.** Median per-function slowdown is 1.38 for Dirigent, 1.87 for Lambda and 13.2 for Knative. Per-function scheduling latency is 3.07× lower at the median and 2.79× lower at p99 than Lambda, and 403× lower at p99 than Knative. P99 slowdown is 6.89× lower than Lambda. Per-invocation scheduling latency is 1.74 ms at the median and 1.13 s at p99 for Dirigent, against 4.67 ms and 59.59 s for Knative.
- **Resources.** Knative spawned 2930 sandboxes for this workload and Dirigent 713 under the same autoscaling algorithm, which the authors attribute to Knative's slow scale-up letting queues keep growing. The Dirigent control plane node uses 3% CPU on average, against above 75% for Knative.
- **Larger trace.** Dirigent reaches p50 and p99 slowdowns of 2.14 and 15.4 at 70% worker CPU, where Lambda reaches 70 and 11631 and 33% of its invocations time out.
- **Failures.** Control plane failover takes 10 ms to detect, elect, reload and resynchronize, against several seconds for Knative. After a data plane failure, invocation failures stop within 2 s, against 15 s for Knative. With 47 of 93 worker daemons killed, peak slowdown is 2.7, 10× lower than Knative.

## Critical Analysis

The diagnosis is convincing, and the ablations are direct about which choices carry the gain. The paper concedes several limits.

- **Not a general-purpose manager.** There is no function versioning with traffic steering yet, no QoS support or remote log fetching, no naming or discovery between sandboxes and no strict state reconstruction. The authors call Dirigent an alternative for FaaS, not a replacement for K8s.
- **Weak request-level guarantees.** Synchronous invocations in flight when a worker or data plane dies are lost, and the evaluation covers synchronous calls only.
- **Scale ceilings.** One control plane replica is active, and the authors see lock contention at 2500 cold starts per second and heartbeat contention at 5000 workers. They propose sub-clusters, like Borg cells, but do not evaluate them.
- **Stale caches.** If the control plane stays down long, data planes can send requests to sandboxes that no longer exist.

The following points are a reading of the evidence, not claims of the paper.

- **The headline pairs different runtimes.** The 1250× compares Dirigent on Firecracker snapshots with Knative on containerd. With containerd, Dirigent peaks at 1750, which by my arithmetic is about 875× against 2 per second, still large but a different number. The Knative side is also a saturation point ("below 2"), not a measured peak.
- **The conclusion contradicts the body.** It credits a 6.89× lower p99 slowdown to the comparison with Knative, while the body gives 6.89× against Lambda and over three orders of magnitude against Knative. This note uses the body.
- **Lambda is a black box.** The authors cannot see its cluster manager, hardware or other tenants, while Dirigent runs on a dedicated 100-node cluster with prefetched images. The text does not say whether Lambda's latencies include front-end and network time that the cluster-local Dirigent runs avoid, and the larger trace is compared with Lambda only. The numbers show Dirigent can beat a production service in this setup, not why Lambda is slower.
- **The ablation is partial.** Persistence and the monolithic control plane are tested by experiment. State volume and sidecar removal are argued from the K8s analysis and the warm-start results but not isolated, and the K3s gain is only called marginal.
- **Failure testing is thin.** The text describes one injected failure per component class, with a single control plane failover figure and no discussion of network partitions or a deposed leader. The persisted state lives in Redis, described as replicated with strong consistency, but the paper does not say how that guarantee is obtained, for example whether writes wait for replicas.
- **The workloads are synthetic.** Functions are hello-world or a loop of SQRTSD instructions sized to the trace's execution times, and images and snapshots are prefetched on every worker, so pulling images and restoring snapshots from disk at scale, which the paper lists as future work, is outside the measurements. The 500-function sample is also the largest Knative handled without many timeouts.

## Further Research

- Workflows: extending data plane components into workflow orchestrators, which the authors are exploring.
- The cost of stricter request-level guarantees (at-least-once, exactly-once) at scale, possibly on top of a shared-log runtime such as [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs), which the paper cites. [FlexLog](/papers/flexlog-shared-log-for-stateful-serverless-computing) is my pairing, not a work the paper cites.
- Image and snapshot caching at scale, more sandbox runtimes, and the Hermod and CH-RLU policies that Dirigent supports but leaves out of the evaluation.
- Gaps the paper leaves open: partition and deposed-leader testing of the Redis-backed control plane, and a measured sub-cluster deployment beyond a single control plane.
