---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A container memory limit covers the **whole process**, not just the heap. Runtimes with their own memory management (the JVM, Node.js, .NET, Go) size their heap from what they believe is available, and each one reads the container limit differently, or not at all. Get it wrong one way and the kernel `OOMKill`s the container with no out-of-memory error in the logs; get it wrong the other way and the runtime uses a fraction of the memory you pay for, or throws an out-of-memory error while the container is nowhere near its limit. This concept covers how common runtimes size themselves inside a container, what lives outside the heap, and a sizing rule that works.

## Use Cases

- A service restarting with exit code 137 (`OOMKilled`) while its heap metrics looked fine.
- A service with a 2 Gi limit that runs out of heap at 512 MiB.
- Choosing the heap setting and the memory limit for a new service.
- Understanding why the same image behaves differently on a laptop and in the cluster.

## Deep Dive

### Each runtime reads the limit differently

Measured with `docker run --memory=<limit>`, which sets the same cgroup limit Kubernetes sets for `resources.limits.memory`:

| Runtime | Default heap ceiling under a limit | Measured |
|---|---|---|
| JVM (Temurin 25) | 25% of the limit (`MaxRAMPercentage=25`) | 1 GiB limit: 256 MiB max heap; 2 GiB: 512 MiB |
| Node.js 22 | about 50% of the limit | 512 MiB: 259 MiB; 1 GiB: 524 MiB; 2 GiB: 1048 MiB |
| .NET | GC hard limit at 75% of the limit | documented default |
| Go | **no** heap limit derived from the cgroup; set `GOMEMLIMIT` | documented default |

Without a limit, each runtime sizes itself from the machine it sees. Verified: the same Node.js image with no limit on an 8 GiB Docker VM reported a 2096 MiB heap ceiling, far beyond what the scheduler reserved for the Pod through its request.

The JVM default of 25% is deliberately conservative (it was designed for shared machines), and it is the reason for "out of heap while the container has plenty of memory left".

### Where the rest of the memory goes

The heap is only part of the process. What typically lives outside it:

| Area | Examples |
|---|---|
| Runtime metadata | JVM metaspace and code cache, V8 code space |
| Thread stacks | about 1 MiB reserved per platform thread on the JVM |
| Off-heap buffers | direct/native buffers used by network libraries |
| Native libraries and allocator arenas | tens of MiB, sometimes growing (glibc fragmentation) |
| GC bookkeeping | a few % of the heap |

For a typical web service on the JVM this non-heap part is 150 to 400 MiB, and it does not shrink with the heap. That is why the right heap percentage depends on the container size: 75% of 4 GiB leaves 1 GiB for everything else, 75% of 512 MiB leaves only 128 MiB.

### Limits can also change runtime behaviour

The JVM also reads the CPU limit, and together with the memory limit it decides which garbage collector to use. It picks G1 only on a "server class" machine (at least 2 processors and about 1792 MiB). Measured with Temurin 25 and 2 CPUs:

| Container limits | GC chosen |
|---|---|
| memory 1 GiB, cpu 2 | Serial |
| memory 2 GiB, cpu 2 | G1 |

Serial GC stops the whole application for every collection, visible as latency spikes. Small containers should choose the collector explicitly. Similar effects exist elsewhere: thread pool sizes follow the detected CPU count in many runtimes, and Go since 1.25 sizes `GOMAXPROCS` from the CPU limit.

### A sizing rule

```
container limit = heap ceiling + non-heap + safety margin
```

Set the heap ceiling **relative to the limit**, so that changing the limit resizes the heap:

```yaml
resources:
  requests: {memory: 1Gi}
  limits:   {memory: 1Gi}
env:
  - name: JAVA_TOOL_OPTIONS            # JVM: read by every java process in the container
    value: "-XX:MaxRAMPercentage=65 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError"
  # Node.js:  NODE_OPTIONS="--max-old-space-size=640"   (MiB, absolute)
  # Go:       GOMEMLIMIT=800MiB                          (soft limit for the GC)
```

- 60 to 75% for the heap is the usual range; lower for small containers.
- Make a heap out-of-memory **exit the process** (`-XX:+ExitOnOutOfMemoryError` on the JVM) so Kubernetes restarts it, instead of leaving a half-broken process running.
- Keep request equal to limit for memory: the runtime will eventually grow its heap to the ceiling, so the "idle" usage right after startup is not the real footprint.

### Measuring instead of guessing

```bash
kubectl top pods -n team-a --containers
```

and the peak working set over a week in Prometheus:

```
max_over_time(container_memory_working_set_bytes{namespace="team-a", container="app"}[7d])
```

Compare it with the heap ceiling. If the working set keeps growing while the heap is stable, the growth is native memory: use the runtime's own tooling (JVM Native Memory Tracking with `jcmd <pid> VM.native_memory summary`, heap snapshots for V8) through `kubectl exec`. Re-measure after upgrading the runtime or major dependencies.

## Trade-offs

- **Bigger heap vs more native headroom.** More heap means fewer GCs and more room for caches; less headroom means OOM kills under native spikes.
- **Percentage vs absolute heap settings.** A percentage follows the limit automatically; an absolute value (`-Xmx`, `--max-old-space-size`) is explicit and silently drifts when someone changes only the limit.
- **Runtime defaults vs explicit flags.** Defaults change between runtime versions and container sizes (GC choice, thread counts); explicit settings make behaviour predictable at the cost of one more thing to maintain.

## Documentation Links

- [Kubernetes docs: Assign Memory Resources to Containers](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/): limits and OOM behaviour.
- [Java SE docs: the java command](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html): `MaxRAMPercentage`, `ActiveProcessorCount`, `ExitOnOutOfMemoryError`.
- [Node.js docs: --max-old-space-size](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib): V8 heap size option.
- [.NET docs: GC heap hard limit](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector#heap-hard-limit): container defaults.
- [Go docs: A Guide to the Go Garbage Collector (memory limit)](https://go.dev/doc/gc-guide#Memory_limit): `GOMEMLIMIT`.
