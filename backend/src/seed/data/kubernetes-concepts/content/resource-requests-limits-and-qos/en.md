---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Every container can declare **requests** (what the scheduler reserves for it) and **limits** (what the kernel lets it use). The two are enforced by completely different parts of the system, and memory and CPU behave differently at the limit: going over the memory limit kills the process (`OOMKilled`), going over the CPU limit only slows it down (throttling). The combination of requests and limits also puts each Pod in a **QoS class**, which decides who is evicted first when the node runs short. This concept covers all three, with the `OOMKilled` signature you will see in practice.

## Use Cases

- A service restarting with exit code 137 and `Reason: OOMKilled`.
- Latency spikes on a service whose CPU usage "never reaches 100%".
- Protecting a database from being evicted before less important Pods.
- Enforcing sane defaults in a namespace where developers forget to set resources.

## Deep Dive

### Requests and limits

```yaml
resources:
  requests:
    cpu: 250m          # a quarter of a core reserved for scheduling
    memory: 512Mi
  limits:
    memory: 768Mi      # hard ceiling: above this, the kernel kills the process
    # cpu limit deliberately omitted, see below
```

- **Requests** are a scheduling contract. The scheduler only places the Pod on a node whose allocatable minus other Pods' requests covers them. At runtime, the CPU request becomes a cgroup weight: under contention, CPU is shared proportionally to requests.
- **Limits** are enforced by the Linux kernel through cgroups on the node, independently of the scheduler.
- Units: CPU in cores or millicores (`500m` = half a core); memory in bytes with binary suffixes (`Mi`, `Gi`). `512M` (decimal) and `512Mi` (binary) differ by about 5%.

### Memory limit: the process dies

Exceeding the memory limit is not negotiable. The kernel OOM killer terminates the process in the container, and the kubelet reports it. Verified on k3s with a 64 Mi limit and a container that allocates 300 MiB:

```
$ kubectl get pod oom
NAME   READY   STATUS      RESTARTS      AGE
oom    0/1     OOMKilled   3 (26s ago)   45s

$ kubectl get pod oom -o jsonpath='{.status.containerStatuses[0].lastState}'
{"terminated":{"exitCode":137,"reason":"OOMKilled", ...}}
```

Exit code 137 = 128 + 9 (SIGKILL). `kubectl describe pod` shows the same under `Last State: Terminated, Reason: OOMKilled`. Between restarts the Pod shows `CrashLoopBackOff`.

An `OOMKilled` container used more memory than its limit. The fix is either a higher limit or less memory usage. Runtimes with their own memory management (JVM, Node.js, .NET) read the container limit and size their heap from it; a heap configured too close to the limit leaves no room for the rest of the process and ends in `OOMKilled` instead of an in-process out-of-memory error.

Not to be confused with **eviction**: when the node itself runs low, the kubelet evicts whole Pods (`Status: Failed, Reason: Evicted`), even Pods under their limits.

### CPU limit: the process slows down

A CPU limit is enforced by CFS quota: the container gets `limit x 100ms` of CPU time per 100 ms period. A multi-threaded process with a `500m` limit can burn its 50 ms of quota in the first 10 ms of a period on several threads and then sit **throttled** for 90 ms. Average CPU usage looks low, but requests stall. The metric `container_cpu_cfs_throttled_periods_total` in Prometheus shows it.

That is why many teams set CPU **requests** always and CPU **limits** rarely: the request guarantees a fair share under contention, and without a limit the service can use idle CPU for bursts like startup or cache warm-up. Memory limits, in contrast, should always be set, because memory is not compressible.

### QoS classes

Kubernetes derives the class from the resources of all containers in the Pod:

| Class | Rule | Eviction priority |
|---|---|---|
| `Guaranteed` | every container has CPU **and** memory requests equal to limits | evicted last |
| `Burstable` | at least one request or limit set, but not Guaranteed | in the middle |
| `BestEffort` | no requests and no limits at all | evicted first |

Verified: a Pod with memory request = limit = 1Gi but CPU request 500m and CPU limit 2 is `Burstable` (CPU values differ); a Pod with only a memory limit is `Burstable` too (the request defaults to the limit when only a limit is given); a Pod with nothing set is `BestEffort`.

```bash
kubectl get pods -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass
```

Under node memory pressure the kubelet evicts BestEffort Pods first, then Burstable Pods using the most memory above their request. It also affects the kernel's OOM score: Guaranteed Pods are the last candidates when the whole node runs out.

For a database on a shared node, `Guaranteed` is the class to aim for, which requires CPU limits equal to requests. That is a legitimate place to accept a CPU limit.

### Defaults per namespace: LimitRange

Pods without resources are BestEffort and invisible to the scheduler. A LimitRange fills in defaults and enforces bounds:

```yaml
apiVersion: v1
kind: LimitRange
metadata: {name: defaults, namespace: team-a}
spec:
  limits:
    - type: Container
      defaultRequest: {cpu: 100m, memory: 256Mi}
      default: {memory: 512Mi}           # default limit
      max: {memory: 4Gi}
```

A ResourceQuota caps the namespace total (`requests.memory: 8Gi`), useful when several teams share a node.

## Trade-offs

- **CPU limits vs none.** Limits give predictability and isolation between tenants; they also cause throttling that looks like mysterious latency. On a node you control, requests without CPU limits are a common, defensible choice, except where you want `Guaranteed`.
- **Memory limit = request vs limit > request.** Equal values mean no surprises and no overcommit. A higher limit lets a service burst but allows the node to overcommit, which ends in evictions when several Pods burst at once.
- **Tight limits save capacity, loose limits save incidents.** Start generous, measure with `kubectl top` and Prometheus, then tighten.

## Documentation Links

- [Kubernetes docs: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): units, requests, limits, enforcement.
- [Kubernetes docs: Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/): class rules and eviction behaviour.
- [Kubernetes docs: Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/): namespace defaults.
- [Kubernetes docs: Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/): namespace totals.
