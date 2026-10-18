---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Events are the cluster's short-term memory: the scheduler, the kubelet and controllers record what they did or failed to do (`Scheduled`, `Pulled`, `FailedMount`, `BackOff`, `Killing`, `ScalingReplicaSet`). They are the fastest way to answer "what just happened to this Pod", and they disappear quickly: one hour by default, and only **five minutes** on MicroK8s. This concept covers event types and fields, reading them in the right order (a classic `--sort-by` pitfall included), how long they live, and how to keep them longer when you need to.

## Use Cases

- Finding why a Pod is `Pending`, `ContainerCreating` or restarting.
- Seeing the timeline of a rollout across ReplicaSets and Pods.
- Cleaning noisy old events from a namespace while debugging.
- Keeping events for post-incident analysis.

## Deep Dive

### What an event contains

```bash
kubectl -n team-a get events
```

Key fields: `type` (`Normal` or `Warning`), `reason` (a CamelCase code such as `FailedScheduling`), `message`, the `involvedObject` (kind, name), the reporting component, and timestamps. Repeated identical events are aggregated: instead of 50 events you see one with a count, shown as `(x21 over 19m)` by `kubectl events`.

Events are objects in the API (`events.k8s.io/v1`, also readable through the core `v1` Event API), stored in the cluster's datastore, namespaced like the object they describe.

### Reading them

Per object, `describe` shows the relevant events at the bottom. Across a namespace:

```bash
kubectl -n team-a events                       # sorted by time, newest last
kubectl -n team-a events --types=Warning       # only problems
kubectl -n team-a events --for pod/web-xyz     # one object
kubectl events -A --types=Warning -w           # watch the whole cluster
```

Filtering with field selectors:

```bash
kubectl -n team-a get events --field-selector type=Warning,reason=FailedScheduling
kubectl -n team-a get events --field-selector involvedObject.name=web-xyz
```

### The sort-by pitfall

The widely copied `kubectl get events --sort-by=.lastTimestamp` misorders some events. Newer components (the scheduler among them) write events through the `events.k8s.io` API with only `eventTime` and `series`; the legacy `lastTimestamp` stays empty. Verified on k3s v1.36:

```
$ kubectl get events --field-selector reason=FailedScheduling \
    -o custom-columns=LAST:.lastTimestamp,EVENTTIME:.eventTime,SERIES:.series.count
LAST    EVENTTIME                     SERIES
<nil>   2026-09-26T19:59:44.454632Z   <none>
<nil>   2026-09-26T20:01:36.131499Z   2
```

Sorting by `.lastTimestamp` puts all those `<nil>` events together at one end, so the most important "why is my Pod Pending" events appear out of place. `kubectl events` (a regular kubectl command since 1.26) understands both formats and sorts correctly; prefer it.

### Retention: gone in minutes

The API server deletes events after `--event-ttl`: **1 hour** by default in upstream Kubernetes. MicroK8s sets it much lower. Verified in `/var/snap/microk8s/current/args/kube-apiserver` on 1.35:

```
--event-ttl=5m
```

Five minutes. If a Pod failed at night, its events are long gone by the morning; a `describe` shows `Events: <none>` and people conclude "nothing happened". To change it, edit that file and restart:

```bash
sudo sed -i 's/--event-ttl=5m/--event-ttl=1h/' /var/snap/microk8s/current/args/kube-apiserver
sudo snap restart microk8s
```

A longer TTL costs datastore space and write load on busy clusters; an hour is a reasonable middle ground. For anything longer, export events.

### Keeping events longer

Events belong in your observability stack, not in the datastore:

- **Grafana Alloy** has a `loki.source.kubernetes_events` component that ships events to Loki as logs.
- **kube-state-metrics** does not export events, but the Prometheus ecosystem has event exporters.
- The simplest option: `kubectl events -A -w -o json >> events.log` from a small Pod or a systemd service.

Once in Loki, you can query them next to container logs: `{job="loki.source.kubernetes_events"} |= "BackOff"`.

### Deleting events

Events are ordinary objects, so you can remove noise while debugging:

```bash
kubectl -n team-a delete events --all
kubectl -n team-a delete events --field-selector reason=BackOff
```

It does not affect anything else; controllers emit new events as things happen. Do not script it in production, you only lose information.

### Useful reasons to know

| Reason | From | Meaning |
|---|---|---|
| `FailedScheduling` | scheduler | no node fits (resources, PVC, taints, affinity) |
| `FailedMount`, `FailedAttachVolume` | kubelet | Secret/ConfigMap/PVC problems |
| `Failed` + `ErrImagePull` / `BackOff` pulling | kubelet | image pull failures |
| `BackOff` restarting | kubelet | crash loop |
| `Unhealthy` | kubelet | probe failure |
| `Killing` | kubelet | container stopped (liveness, deletion, preemption) |
| `Evicted`, `EvictionThresholdMet` | kubelet | node pressure |
| `ScalingReplicaSet` | deployment controller | rollout progress |
| `BackoffLimitExceeded` | job controller | Job failed |

## Trade-offs

- **Short vs long event TTL.** Short TTLs keep the datastore small and throw away the evidence you need for anything not investigated immediately.
- **`kubectl events` vs `get events`.** The dedicated command sorts correctly and aggregates nicely; `get events` supports custom output formats and works everywhere.
- **Exporting events vs relying on the API.** Exporting needs a pipeline but gives history and search; the API is zero-setup and forgetful by design.

## Lab

In this lab you receive a `latest-warning.sh` script that looks right and prints the wrong event. Your job is to find out which events it misses and why, and make it really print the most recent Warning in the namespace. The core idea is to feel that sorting events by `.lastTimestamp` is not reliable: not every event fills that field.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers) receives, in the `shop` namespace, a Job that fails and, a few seconds later, a Pod that asks for more memory than any node has.

- `src/test/resources/k8s/migrate.yaml`: given, a `migrate` Job that fails once, early (`backoffLimit: 0`).
- `src/test/resources/k8s/report.yaml`: given, a `report` Pod created later, requesting `100Gi` of memory, which no node can fit.
- `src/main/resources/latest-warning.sh`: the only file you edit. It takes the namespace and today runs `kubectl get events --field-selector type=Warning --sort-by=.lastTimestamp` and takes the last line.
- `src/test/java/EventsTest.java`: runs the script inside the node and requires exactly one line: the `FailedScheduling` warning for `pod/report`, with `Insufficient memory`.

**What you will do, step by step**

1. **Run the tests first.** The script prints the Job's warning, which is older. The failure message lists every warning with its `lastTimestamp` and `eventTime`.
2. **Understand what is missing (TODO-00).** Compare the two time fields in the listing: events from different sources fill different fields, and one that leaves a field empty does not sort the way you expect.
3. **Print the really most recent Warning (TODO-00).** Rewrite the script to sort by a criterion that covers every event, or use another way of listing events that already orders them, and print a single line with reason, object and message.

**How you know you are done**

`mvn -pl kubernetes-concepts/kubernetes-events test` passes: the script exits successfully, prints exactly one line and it is the `FailedScheduling` for `pod/report`. You should be able to explain why `--sort-by=.lastTimestamp` picked the Job's event.

**Optional challenges**

- **TODO-01:** print every warning for a single object (for example `pod/report`), including repeated ones. How does `kubectl events` show an event that happened many times, and which field holds the count for each kind of event?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container and pull `busybox` inside it) and the article "Kubernetes Events".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/kubernetes-events test`. The `TODO-00` comment in `latest-warning.sh` marks what to change, and the test prints every warning in the namespace when the result is wrong.

## Documentation Links

- [kubectl events reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/): filtering, watching, sorting.
- [Kubernetes API: Event (events.k8s.io/v1)](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/): fields including `eventTime` and `series`.
- [kube-apiserver flags (--event-ttl)](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/): retention default.
- [Grafana Alloy: loki.source.kubernetes_events](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.kubernetes_events/): shipping events to Loki.
