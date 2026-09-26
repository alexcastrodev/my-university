---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Deleting things in Kubernetes is usually a request, not an action: the API server marks the object for deletion, controllers and the kubelet do the work, and **finalizers** can hold the object until some cleanup is done. That is why a deleted Pod comes back (its controller recreates it), why a force delete can leave a process running, and why a namespace can sit in `Terminating` for days. This concept covers restarting and removing Pods safely, scaling to zero, and diagnosing and fixing a stuck namespace, with the exact conditions Kubernetes reports.

## Use Cases

- Restarting one misbehaving Pod without touching the rest of the Deployment.
- Temporarily stopping a workload (maintenance, a backup that needs a quiet volume).
- Cleaning up an environment by deleting its namespace.
- Unblocking a namespace stuck in `Terminating`.

## Deep Dive

### Deleting a Pod

```bash
kubectl -n team-a delete pod web-6b48bf5ccc-4cvpp
```

What happens:

1. The Pod gets a `deletionTimestamp` and enters `Terminating`; it is removed from Service endpoints.
2. The kubelet runs `preStop` hooks, sends `SIGTERM`, waits up to `terminationGracePeriodSeconds` (default 30), then `SIGKILL`.
3. The Pod object disappears.

Meanwhile, if the Pod belongs to a ReplicaSet, the ReplicaSet notices it has one replica too few and creates a replacement **immediately**. Deleting a managed Pod is therefore the standard way to restart one instance. To restart all of them in an orderly way, use `kubectl rollout restart` instead of deleting Pods by label (which removes them all at once).

### Force deletion

```bash
kubectl delete pod web-xyz --grace-period=0 --force
# Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated.
#          The resource may continue to run on the cluster indefinitely.
```

This removes the Pod **object** from the API without waiting for the kubelet to confirm the containers are gone. If the node is healthy, the kubelet kills them shortly after. If the node is unreachable, the processes may keep running while Kubernetes already considers the Pod gone and starts a replacement elsewhere: two copies of a singleton, possibly on the same volume. Use it only for Pods stuck in `Terminating` on a node you know is dead, never as a faster `delete`.

### Scaling instead of deleting

```bash
kubectl -n team-a scale deploy/worker --replicas=0     # stop, keep everything else
kubectl -n team-a scale deploy/worker --replicas=2     # start again
```

Scaling to zero keeps the Deployment, its ConfigMaps, Secrets, PVCs and Service; nothing needs to be reapplied. It is the right tool for maintenance windows and for quiescing a volume before a backup. Note that the next `kubectl apply` of a manifest with `replicas: 2` scales it back up. If an HPA manages the Deployment, it fights manual scaling; pause or delete the HPA first.

### Deleting a namespace

```bash
kubectl delete namespace team-b
```

The namespace moves to `Terminating`, and the namespace controller deletes **every** object inside it: Deployments, Secrets, PVCs (and with a `Delete` reclaim policy, their data), everything. Only when the namespace is empty is the Namespace object itself removed. There is no undo.

### Stuck in Terminating: finalizers

A finalizer is a string in `metadata.finalizers` that says "some controller must clean up before this object may disappear". The object stays, with a `deletionTimestamp`, until the list is empty. If the controller that should remove the finalizer is gone (uninstalled operator, crashed webhook, deleted CRD controller), the object never goes away, and neither does its namespace.

Verified on k3s: a ConfigMap with a made-up finalizer, then `kubectl delete ns stuck`:

```
$ kubectl get ns stuck
NAME    STATUS        AGE
stuck   Terminating   9s

$ kubectl get ns stuck -o jsonpath='{.status.conditions}'
... "type":"NamespaceContentRemaining",
    "message":"Some resources are remaining: configmaps. has 1 resource instances"
... "type":"NamespaceFinalizersRemaining",
    "message":"Some content in the namespace has finalizers remaining: example.com/cleanup in 1 resource instances"
```

The conditions tell you exactly what to look for. Then:

```bash
# find what is left (get all does not show everything)
kubectl api-resources --verbs=list --namespaced -o name \
  | xargs -n 1 kubectl get --show-kind --ignore-not-found -n stuck

# look at the finalizers of the leftover object
kubectl -n stuck get configmap c -o jsonpath='{.metadata.finalizers}'
```

The right fix, in order of preference:

1. **Bring back the controller** that owns the finalizer (reinstall the operator) and let it finish its cleanup. The finalizer may be protecting something outside the cluster, like a cloud load balancer or a DNS record.
2. **Remove the finalizer from the stuck object**, once you know the external cleanup is unnecessary or done by hand:

```bash
kubectl -n stuck patch configmap c --type=json \
  -p '[{"op":"remove","path":"/metadata/finalizers"}]'
```

Verified: seconds after that patch, `kubectl get ns stuck` returned `NotFound`.

Another common cause is an **unavailable aggregated API** (a broken metrics-server, a removed extension API server): the condition is `NamespaceDeletionDiscoveryFailure`, and the fix is to repair or delete that `APIService` (`kubectl get apiservice | grep False`).

The popular trick of removing the finalizer **from the Namespace itself** via the `/finalize` subresource makes the namespace vanish while leaving its orphaned objects in etcd, invisible and still holding their finalizers. Fix the objects, not the namespace.

## Trade-offs

- **Delete a Pod vs rollout restart.** Deleting one Pod is targeted and immediate; `rollout restart` replaces all Pods gradually and respects availability settings.
- **Scale to zero vs delete.** Scaling is reversible and keeps configuration and data; deleting is final and cleans up completely.
- **Removing finalizers by hand vs fixing the controller.** Removing them unblocks you immediately and may leak external resources the finalizer was protecting; restoring the controller is slower and cleans up properly.

## Documentation Links

- [Kubernetes docs: Termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination): grace period, forced deletion.
- [Kubernetes docs: Finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/): how finalizers block deletion.
- [Kubernetes docs: Namespaces (deleting)](https://kubernetes.io/docs/tasks/administer-cluster/namespaces/#deleting-a-namespace): what deletion removes.
- [Kubernetes docs: Namespace status conditions](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/namespace-v1/#NamespaceStatus): meaning of each condition type.
