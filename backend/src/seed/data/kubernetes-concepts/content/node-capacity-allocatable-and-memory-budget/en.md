---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

The scheduler places Pods by comparing their **requests** with the node's **allocatable** resources, not with what is actually free. On a single-node MicroK8s cluster those two numbers drift apart quickly: the operating system, the snap's own services and every add-on consume memory the scheduler knows nothing about. The result is either Pods stuck in `Pending` with `Insufficient memory` while `free` shows plenty, or the opposite, a node that accepted everything on paper and then starts evicting or OOM-killing under real load. This concept covers capacity vs allocatable, why a Pod is `Pending`, and how to build an honest memory budget for a node.

## Use Cases

- A new Deployment stays `Pending` and `describe` says `0/1 nodes are available: 1 Insufficient memory`.
- Deciding whether a 16 GiB VM is big enough for a database, a cache, monitoring and a handful of web services.
- Protecting the node itself (SSH, containerd, the API server) from being starved by workloads.
- Explaining why the kubelet evicted Pods with `The node was low on resource: memory`.

## Deep Dive

### Capacity vs allocatable

```bash
kubectl describe node <node>
```

Verified on a 4 GiB MicroK8s 1.35 VM:

```
Capacity:
  cpu:                2
  memory:             3995108Ki
  pods:               110
Allocatable:
  cpu:                2
  memory:             3892708Ki
  pods:               110
```

`allocatable = capacity - kube-reserved - system-reserved - eviction threshold`. MicroK8s sets no reservations, only the kubelet flag `--eviction-hard="memory.available<100Mi,nodefs.available<1Gi,imagefs.available<1Gi"`. So allocatable is capacity minus exactly 100 MiB: the scheduler believes almost the whole machine is available for Pods.

At that moment, with nothing but the base add-ons running, the VM already used about 900 MiB (`free -m`), and `kubectl top node` reported 1.4 GiB after enabling ingress and metrics-server. None of that is visible to the scheduler.

### What the scheduler counts

Only **requests**. `kubectl describe node` shows the running total:

```
Allocated resources:
  Resource           Requests      Limits
  --------           --------      ------
  cpu                1650m (82%)   4 (200%)
  memory             2816Mi (74%)  5Gi (134%)
```

- A Pod fits if `sum(requests on node) + its requests <= allocatable`. Actual usage is irrelevant.
- Limits may add up to more than 100% (overcommit). That is allowed and normal; it is also how a node runs out of real memory.
- A Pod with no requests (`BestEffort`) always fits, and is the first to be evicted.

### Pending because of memory

```yaml
resources:
  requests:
    memory: 100Gi
```

```
$ kubectl describe pod bigmem
Events:
  Warning  FailedScheduling  default-scheduler  0/1 nodes are available: 1 Insufficient memory.
  preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
```

Nothing is broken; the request is simply larger than what is left of allocatable. The fixes, in order of preference: lower an oversized request (measure first), remove or scale down something else, add memory or a node. Rolling updates hit this too: with `maxSurge`, the new Pod needs room **while the old one still holds its request**, so a node at 90% can run the service but not update it. `strategy: Recreate` or `maxSurge: 0` avoids that for single-replica workloads.

### Reserving memory for the system

Tell the kubelet what to keep for the OS and for Kubernetes itself, in `/var/snap/microk8s/current/args/kubelet` (replace the existing `--eviction-hard` line rather than adding a second one):

```
--system-reserved=memory=1Gi,cpu=500m
--kube-reserved=memory=1Gi,cpu=500m
--eviction-hard=memory.available<500Mi,nodefs.available<10%,imagefs.available<10%
```

```bash
sudo snap restart microk8s
kubectl describe node | grep -A6 Allocatable
```

Allocatable drops accordingly. Existing Pods keep running, but the scheduler now refuses workloads that would push the node into the reserved zone, which is precisely the point: a `Pending` Pod is a much better failure than an OOM-killed database.

### Building a memory budget

For a single node, write the budget down. Example, 16 GiB VM:

| Consumer | Memory |
|---|---|
| OS, SSH, journald, snapd | 0.8 GiB |
| MicroK8s (kubelite, dqlite, containerd) | 0.8 GiB |
| Add-ons: Calico, CoreDNS, Traefik, metrics-server, cert-manager | 0.6 GiB |
| Observability (Prometheus, Grafana, Loki, Alloy) | 2.0 GiB |
| Database (buffers + connections) | 2.5 GiB |
| Cache (e.g. Redis, with its `maxmemory`) | 1.0 GiB |
| Message queue | 1.0 GiB |
| 4 web services x 768 MiB | 3.0 GiB |
| Rolling update headroom (one extra service Pod) | 0.8 GiB |
| Safety margin | 1.5 GiB |
| **Total** | **~14 GiB** |

Then make the cluster agree with the table:

- `system-reserved` + `kube-reserved` cover the first three rows.
- Each workload's memory **request** equals its row, and its **limit** equals the request for anything stateful or with a managed heap (predictable, `Guaranteed`-like behaviour; see the QoS concept).
- Measure with `kubectl top pods -A` and Prometheus after a week of real traffic and revise the numbers.

The kernel page cache is the silent extra: databases and queues that read files depend on it for performance, and it is not counted in their container limits. A node with zero free memory for cache runs, but slowly.

### Eviction vs OOM kill

Two different mechanisms end a Pod under memory pressure:

- **Kubelet eviction**: `memory.available` on the node drops below the eviction threshold. The kubelet evicts Pods (BestEffort first, then Burstable using more than their request). The Pod shows `Status: Failed, Reason: Evicted`.
- **Kernel OOM kill**: a container exceeds its own memory limit, or the node runs out before the kubelet reacts. The container shows `Last State: Terminated, Reason: OOMKilled, Exit Code: 137` and restarts.

Reservations and honest requests make the first rare; correct limits make the second a local problem of one misbehaving container.

## Trade-offs

- **Tight requests vs generous requests.** Tight requests pack more onto the node and let it overcommit; generous requests waste memory on paper but make scheduling decisions match reality. On a single node with stateful services, lean generous.
- **Reserving resources costs capacity.** 2 GiB reserved on an 8 GiB node is 25% you cannot schedule. Skipping it only moves the problem from `Pending` Pods to evictions and OOM kills of the node's own services.
- **Limits equal to requests vs higher limits.** Equal values give predictability and the `Guaranteed` QoS class; higher limits let spiky services borrow idle memory, at the risk of the node running out when several spike together.

## Documentation Links

- [Kubernetes docs: Reserve Compute Resources for System Daemons](https://kubernetes.io/docs/tasks/administer-cluster/reserve-compute-resources/): allocatable formula, `system-reserved`, `kube-reserved`.
- [Kubernetes docs: Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/): thresholds and eviction order.
- [Kubernetes docs: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): how requests drive scheduling.
- [MicroK8s: Configuring services](https://canonical.com/microk8s/docs/configuring-services): where the kubelet args file lives.
