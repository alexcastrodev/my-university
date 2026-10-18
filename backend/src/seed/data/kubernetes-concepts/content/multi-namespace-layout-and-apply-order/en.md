---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A cluster rarely runs one application. It runs shared services (a cache, a queue, a database) plus several applications owned by different teams, plus tooling. Giving each group its own namespace, with shared services in a namespace of their own, keeps applications independent and the shared parts reusable. It also creates dependencies between namespaces that decide the order in which things must be applied. This concept covers that layout, how applications reach shared services, what can and cannot cross a namespace boundary, and a reliable apply order.

## Use Cases

- Running `team-a` and `team-b` applications side by side against one shared cache and queue.
- Deleting or recreating one application's namespace without touching the others or the shared data.
- Bootstrapping an empty cluster in the right order from a script.
- Deciding where a new component belongs.

## Deep Dive

### A layout by namespace

```
k8s/
  00-namespaces/          # Namespace objects + labels (Pod Security, owner)
  10-shared/              # shared services: redis, a queue, a database    -> ns shared
  20-apps/
    team-a/               # Kustomize overlay                              -> ns team-a
    team-b/               # Kustomize overlay                              -> ns team-b
  90-tooling/             # dashboards, admin tools                        -> ns tooling
```

- **Shared services get their own namespace** (`shared`). Their lifecycle is different from any application's: you delete and recreate application namespaces, you almost never delete the shared data.
- **Each application** lives in its own namespace, usually rendered from a Kustomize overlay that sets `namespace:`, the image tag and its own configuration and Secrets.
- **Tooling** that needs cluster-wide privileges is isolated, so RBAC and NetworkPolicies can treat it separately.

Namespaces are cheap. The question for each new component is "whose lifecycle does it share?". A cache used only by `team-a` belongs in `team-a`; one used by every application belongs in `shared`.

### What crosses namespace boundaries

| Thing | Cross-namespace? |
|---|---|
| Network traffic to a Service | yes, by DNS (`redis.shared.svc.cluster.local`), unless a NetworkPolicy blocks it |
| Mounting a Secret, ConfigMap or PVC | **no**, only from the Pod's own namespace |
| Ingress backend Service | **no**, an Ingress routes only to its own namespace's Services |
| Gateway API route to a Service | yes, with a `ReferenceGrant` in the target namespace |
| RBAC | Roles are namespaced; ClusterRoles can be bound per namespace |

So each application needs **its own copy** of the credentials it uses for shared services: a `cache-credentials` Secret in `team-a` holding team A's user, another in `team-b` holding team B's. That is a feature: each application gets its own identity, and deleting its namespace revokes nothing shared. With many namespaces, External Secrets Operator or a small bootstrap script keeps these copies in sync.

### Why order matters

Kubernetes is eventually consistent. Applied out of order, most things converge: an app that starts before its cache crash-loops until the cache is up, then recovers. But some orderings fail outright:

1. **Namespaces before anything in them.** Verified: applying a ConfigMap and its Namespace in one plain `kubectl apply -f` with the ConfigMap first fails with `namespaces "zzz-new" not found` (the Namespace is still created, so a second run succeeds). `kubectl kustomize` output sorts `Namespace` first, so `apply -k` of the same files succeeds on the first try. Concatenating files by hand loses that guarantee.
2. **CRDs before custom resources.** A `Certificate` or `ServiceMonitor` applied in the same run as its CRD fails with `no matches for kind` until the CRD is established. Install operators and CRDs (cert-manager, Prometheus Operator) as an earlier step and `kubectl wait --for condition=established crd/<name>`.
3. **Stateful dependencies before their consumers**, for a clean start without crash loops.
4. **Admission-affecting objects first**: Namespace labels for Pod Security, LimitRanges and ResourceQuotas must exist before Pods are created, or those Pods escape them until recreated.

### A bootstrap order

```bash
set -euo pipefail
kubectl apply -k k8s/00-namespaces

kubectl apply -k k8s/10-shared
kubectl -n shared rollout status deploy/redis --timeout=300s

for team in team-a team-b; do
  kubectl apply -k k8s/20-apps/$team
done
for team in team-a team-b; do
  kubectl -n $team rollout status deploy/web --timeout=300s
done

kubectl apply -k k8s/90-tooling
```

`rollout status` turns "eventually" into "now, or fail the script with a clear message". The same script is safe to re-run on an existing cluster, because every step is an `apply`.

### Deleting one application

```bash
kubectl delete namespace team-b
```

Everything in the namespace goes, including its PVCs (and with a `Delete` reclaim policy, their data). Shared services are untouched, but whatever team B stored in them (keys, queues, database schemas) remains, which is usually what you want (recreate the namespace and it finds its data again), and occasionally a leak to clean up by hand.

## Trade-offs

- **Shared services namespace vs services per application.** Sharing saves memory on a small cluster (one instance instead of several) and couples applications to that instance's availability and upgrades. Per-application services isolate failures and multiply resource usage.
- **Copied credentials vs cross-namespace access.** Copies per namespace are more objects to manage and give each application its own identity and blast radius.
- **Scripted order vs GitOps sync waves.** A bootstrap script is explicit and easy to read; Argo CD sync waves or Flux `dependsOn` express the same ordering declaratively and keep enforcing it continuously.

## Lab

In this lab you get a deploy script that only runs `kubectl apply -f /lab/deploy/` and fails on an empty cluster. Your job is to make the script work on the first attempt, with no errors at all, by organizing the order in which things are created and waiting for what needs waiting for. The core idea is to feel that `kubectl apply` on a directory does not understand dependencies: it applies in alphabetical order, a custom object cannot be born in the same step as its definition, and the script should only return when the app is really available. Running it twice or retrying until it works is not the fix.

**The scenario**

The `src/main/resources/deploy/` directory holds the objects of a shop, and the test copies it to `/lab/deploy` on a fresh k3s node (started by Testcontainers) and runs your `deploy.sh`.

- `namespace.yaml`: the `shop` Namespace.
- `app.yaml`: a `web-config` ConfigMap and a `web` Deployment in `shop`. The app takes a few seconds to become ready (the readinessProbe only passes after a `sleep 5`).
- `widget-crd.yaml`: the CustomResourceDefinition of the `Widget` kind.
- `widget.yaml`: a `Widget` called `default-widget` in `shop`.
- `src/main/resources/deploy.sh`: the script you edit, with one `TODO` per defect.

You may reorganize `deploy/` freely: new directories and `kustomization.yaml` files.

**What you will do, step by step**

1. **Run the tests and read the errors from the first run.** The failure message lists every error `kubectl` printed.
2. **Create the Namespace before what is inside it (TODO-00).** Alphabetical order puts `app.yaml` before `namespace.yaml`. Organize the directory with Kustomize (`kustomization.yaml` files) so each object is created after what it needs.
3. **Create the Widget only once the CRD is served (TODO-01).** A custom resource cannot be created in the same step as its CRD. Apply the CRD first and wait until the API server serves the new kind, and only then apply the rest.
4. **Wait for the app (TODO-02).** `kubectl apply` returns as soon as the objects are accepted, not when the Pod is ready. Make the script return only when `deploy/web` is available.

**How you know you are done**

`mvn -pl kubernetes-concepts/multi-namespace-layout-and-apply-order test` passes `firstRunSucceedsWithoutErrors` (exit 0 and no "error" on stderr), `everythingIsCreated`, `returnsOnlyWhenWebIsAvailable` and `secondRunSucceedsToo`. You should be able to explain why each wait exists and why the script also works when run a second time.

**Optional challenges**

- **TODO-03:** put the CRD and the `Widget` in the same kustomization and apply it once. Kustomize sorts CRDs first; why does it still fail?

**Prerequisites:** Docker running (the tests start a `rancher/k3s` container and pull `busybox` inside it), Java and Maven, and the article Multi-Namespace Layout and Apply Order.

**How to run it:** clone the repository and, from its root, run `mvn -pl kubernetes-concepts/multi-namespace-layout-and-apply-order test`. The `TODO-00`, `TODO-01` and `TODO-02` comments in `deploy.sh` mark what is left.

## Documentation Links

- [Kubernetes docs: Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): scope, DNS, when to use several.
- [Kubernetes docs: Share a Cluster with Namespaces](https://kubernetes.io/docs/tasks/administer-cluster/namespaces/): creating and deleting namespaces.
- [Gateway API: ReferenceGrant](https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/): allowing cross-namespace references.
- [Kubernetes docs: Multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/): isolation options between teams or tenants.
