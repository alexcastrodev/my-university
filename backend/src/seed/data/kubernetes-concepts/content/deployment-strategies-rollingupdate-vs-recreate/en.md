---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

When a Deployment's Pod template changes, Kubernetes replaces the old Pods with new ones according to `spec.strategy`. `RollingUpdate`, the default, replaces them gradually and keeps the service available; `Recreate` stops everything first and then starts the new version. The rolling behaviour is controlled by two numbers, `maxSurge` and `maxUnavailable`, whose percentage rounding surprises people with small replica counts. This concept covers both strategies, the arithmetic, what a failed rollout looks like, and which strategy fits which workload.

## Use Cases

- Zero-downtime deploys of a stateless web API with two or more replicas.
- Deploying a single-replica database or message broker that must never run twice against the same volume.
- Updating on a node with little free memory, where a surge Pod does not fit.
- Understanding why a broken image did not take the service down.

## Deep Dive

### RollingUpdate

```yaml
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%          # default: how many Pods above `replicas` may exist
      maxUnavailable: 25%    # default: how many below `replicas` may be unavailable
  minReadySeconds: 10        # a new Pod must stay Ready this long to count as available
```

The controller scales the new ReplicaSet up and the old one down in steps, never exceeding `replicas + maxSurge` Pods and never dropping below `replicas - maxUnavailable` **available** Pods. "Available" means Ready (readiness probe passing) for at least `minReadySeconds`. Without a readiness probe, a Pod is Ready as soon as its container starts, so the rollout marches on even if the application inside is still booting or broken.

### The rounding rule

Percentages are converted to absolute numbers: `maxSurge` rounds **up**, `maxUnavailable` rounds **down**.

| replicas | maxSurge 25% | maxUnavailable 25% | Behaviour |
|---|---|---|---|
| 1 | 1 | 0 | start 1 new, wait until available, stop the old |
| 2 | 1 | 0 | always 2 available; one extra Pod during the update |
| 4 | 1 | 1 | up to 5 Pods, at least 3 available |
| 10 | 3 | 2 | up to 13 Pods, at least 8 available |

Verified on k3s with 2 replicas and a non-existent image tag:

```
NAME                   READY   STATUS             RESTARTS   AGE
web-595b4ff974-jkhnn   0/1     ImagePullBackOff   0          20s
web-6b48bf5ccc-4cvpp   1/1     Running            0          20s
web-6b48bf5ccc-rppzw   1/1     Running            0          21s
```

One surge Pod was created and never became ready; because `maxUnavailable` is 0, no old Pod was touched. The service stayed fully up, and the rollout simply stalled. That is the safety net rolling updates give you, **as long as the new Pods can fail readiness**.

### When the rollout gets stuck

A stalled rollout does not roll back by itself. After `progressDeadlineSeconds` (default 600) the Deployment gets the condition `Progressing=False, reason=ProgressDeadlineExceeded`, and `kubectl rollout status` exits with an error. The old Pods keep serving. You fix forward (new image) or roll back with `kubectl rollout undo`; see the rollout concept.

### Recreate

```yaml
spec:
  replicas: 1
  strategy:
    type: Recreate
```

All old Pods are terminated, and only once they are gone are the new ones created. There is downtime between the two, as long as the old Pod's shutdown plus the new Pod's startup.

Why accept that? Because some workloads must never run two instances at once:

- **A database or broker on a `ReadWriteOnce` volume.** With RollingUpdate, the new Pod starts while the old one still holds the volume. On a single node both can actually mount a hostPath or local volume (RWO is per node, not per Pod), and two database processes on the same data directory is corruption. Many databases keep a lock file that usually stops the second one, but relying on that is not a strategy.
- **Singletons**: a scheduler that must not double-fire, a consumer that assumes it is alone.
- **A node without room for a surge Pod.** With RollingUpdate, the new Pod needs its full memory request while the old one still holds its own. If the node cannot fit both, the new Pod is `Pending` forever. `Recreate`, or `maxSurge: 0, maxUnavailable: 1`, frees the space first.

### A middle ground for one replica

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate: {maxSurge: 0, maxUnavailable: 1}
```

For one replica this behaves like Recreate (stop, then start) but applies per Pod, so with more replicas it becomes "replace one at a time without extra capacity".

### Graceful shutdown matters for both

Old Pods receive `SIGTERM`, get `terminationGracePeriodSeconds` (default 30) to finish, then `SIGKILL`. Meanwhile they are removed from Service endpoints, but that removal propagates asynchronously, so a few requests may still arrive after `SIGTERM`. An application that drains in-flight requests on `SIGTERM` (most web servers and frameworks support graceful shutdown) plus a short `preStop` sleep closes that gap:

```yaml
lifecycle:
  preStop:
    sleep: {seconds: 5}        # native sleep action, no shell needed in the image
```

## Trade-offs

- **RollingUpdate** gives zero downtime and a built-in safety net, and needs readiness probes, spare capacity for surge Pods, and an application that tolerates two versions running side by side (database schema compatible with both).
- **Recreate** is simple and safe for stateful singletons, and always costs a short outage. For a single-replica database there is no rolling option that avoids it anyway.
- **Aggressive vs conservative values.** High `maxSurge`/`maxUnavailable` finish rollouts faster; `maxUnavailable: 0` guarantees capacity but needs surge room.

## Documentation Links

- [Kubernetes docs: Deployments (strategy)](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy): Recreate, RollingUpdate, maxSurge and maxUnavailable.
- [Kubernetes docs: Failed Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment): `progressDeadlineSeconds` and conditions.
- [Kubernetes docs: Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination): SIGTERM, grace period, preStop.
- [Kubernetes docs: Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/): `preStop` and its interaction with the grace period.
