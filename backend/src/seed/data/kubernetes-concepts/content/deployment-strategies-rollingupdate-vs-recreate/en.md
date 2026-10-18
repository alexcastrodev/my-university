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

## Lab

In this lab you get two Deployments whose rollout strategy is wrong for what each one does. Your job is to adjust only the `strategy` field of each. The core idea is that `RollingUpdate` and `Recreate` answer different questions: a stateless app must keep full capacity even when the new image is broken, and a singleton must never run twice at the same time.

**The scenario**

The test runs on a real cluster (k3s via Testcontainers) and simulates two incidents.

- `src/main/resources/k8s/web.yaml`: a stateless web app with 2 replicas behind a Service, with a `readinessProbe`. Someone tuned the rollout to "save resources" with `maxSurge: 0` and `maxUnavailable: 1`. The test rolls out an image tag that does not exist and, 30 seconds later, checks how many replicas are still available and whether the Service still answers.
- `src/main/resources/k8s/singleton.yaml`: a scheduler with 1 replica that must never have two instances (every job would fire twice). The test does a `rollout restart` and counts, twice per second, how many of its Pods are `Running` at the same time.

**What you will do, step by step**

1. **Run it and read both failures.** Run the tests before editing to watch both incidents happen.
2. **Protect the web capacity (TODO-00).** In `web.yaml`, change `maxSurge` and `maxUnavailable` so a rollout never goes below 2 available Pods. Think about which combination lets a new Pod start without taking down any old one, and why, with a broken image, the rollout stalls while the Service keeps answering from the old replicas.
3. **Stop the singleton from running twice (TODO-01).** In `singleton.yaml`, choose the strategy that stops the old Pod before starting the new one. The price is a gap with no instance, which is acceptable here.

**How you know you are done**

`mvn -pl kubernetes-concepts/deployment-strategies-rollingupdate-vs-recreate test` passes completely: during the broken rollout the web app keeps 2 available replicas and the Service answers `ok`, the singleton never has more than one `Running` Pod at the same time, and it comes back with 1 available replica. You should be able to explain why each workload needs a different strategy and which risk each choice accepts.

**Optional challenges**

- **TODO-02:** set `replicas: 4` on `web` with the default strategy (25% / 25%) and roll out the broken image again. How many Pods exist and how many are available? Work out the rounding rule from what you see.

**Prerequisites:** Docker running (the test starts a `rancher/k3s` container and pulls `busybox` inside it), the article "Deployment Strategies: RollingUpdate vs Recreate", Java and Maven.

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/deployment-strategies-rollingupdate-vs-recreate test`. A run takes about 90 seconds. You only edit the `strategy` of each Deployment, and the TODO comments mark the spot.

## Documentation Links

- [Kubernetes docs: Deployments (strategy)](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy): Recreate, RollingUpdate, maxSurge and maxUnavailable.
- [Kubernetes docs: Failed Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment): `progressDeadlineSeconds` and conditions.
- [Kubernetes docs: Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination): SIGTERM, grace period, preStop.
- [Kubernetes docs: Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/): `preStop` and its interaction with the grace period.
