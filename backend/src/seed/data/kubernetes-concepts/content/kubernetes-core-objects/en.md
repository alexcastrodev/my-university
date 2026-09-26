---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Almost everything you deploy on Kubernetes is built from five objects: a **Namespace** to group things, a **Pod** that actually runs containers, a **ReplicaSet** that keeps N identical Pods alive, a **Deployment** that manages ReplicaSets across versions, and a **Service** that gives those Pods one stable address. Each object is a desired state stored in the API; a controller works continuously to make reality match it. This concept shows how the five fit together, which one you should write by hand (Deployment and Service) and which ones you only observe (ReplicaSet and Pod), and how labels and selectors glue them.

## Use Cases

- Deploying a web API with two replicas and a stable in-cluster address.
- Understanding why deleting a Pod "does nothing" (it comes back) and deleting a ReplicaSet also "does nothing".
- Reading `kubectl get all` output and knowing which object owns which.
- Splitting environments or tenants into namespaces.

## Deep Dive

### The declarative loop

You never tell Kubernetes "start a container". You store an object that says "there should be 2 Pods like this", and controllers reconcile:

```
Deployment (you write)  --owns-->  ReplicaSet (generated)  --owns-->  Pods (generated)
Service (you write)     --selects by label-->  Pods
```

Each owned object carries `metadata.ownerReferences`, which is how `kubectl delete deployment` cascades to its ReplicaSets and Pods.

### Pod

The smallest unit: one or more containers sharing a network namespace (same IP, `localhost` between them) and volumes. Pods are **disposable**: they get a new name and IP every time they are recreated, and nothing re-creates a bare Pod you created by hand if its node dies. Writing Pods directly is fine for a debug shell (`kubectl run`), not for an application.

### ReplicaSet

Keeps exactly `replicas` Pods matching its `selector`. Delete one Pod and the ReplicaSet creates another within a second. You rarely write one: a Deployment creates a new ReplicaSet for every change to the Pod template and scales the old one down. That is why `kubectl get rs` shows several ReplicaSets with `DESIRED 0`: they are the rollout history.

### Deployment

The object you actually write for stateless services:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: team-a
spec:
  replicas: 2
  selector:
    matchLabels: {app: api}          # which Pods belong to this Deployment
  template:                          # the Pod blueprint
    metadata:
      labels: {app: api}             # must match the selector
    spec:
      containers:
        - name: app
          image: registry.example.com/demo/web-app:1.4.2
          ports: [{containerPort: 8080}]
```

- Changing anything under `template` (image, env, resources) creates a new ReplicaSet and starts a rolling update.
- Changing `replicas` just scales the current ReplicaSet.
- `spec.selector` is **immutable** after creation. Changing labels in the selector requires deleting and recreating the Deployment.

For stateful software with stable identity (one PVC per replica, predictable names like `db-0`), there is `StatefulSet`; for one Pod per node, `DaemonSet`; for run-to-completion, `Job`. On a single node, a one-replica Deployment with `strategy: Recreate` and a PVC is a common, simple choice for a database.

### Service

Pods come and go; a Service is the stable front door:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: team-a
spec:
  selector: {app: api}               # every ready Pod with this label receives traffic
  ports:
    - port: 80                       # Service port
      targetPort: 8080               # container port
```

The Service gets a virtual IP and a DNS name (`api.team-a.svc.cluster.local`). The EndpointSlice controller keeps the list of **ready** Pod IPs behind it. A Pod that fails its readiness probe drops out of that list without being restarted. The Service type and DNS are covered in their own concepts.

The most common wiring bug is a selector that matches nothing:

```bash
kubectl -n team-a get endpointslices -l kubernetes.io/service-name=api
# ENDPOINTS <unset>  -> selector does not match any ready Pod
kubectl -n team-a get pods -l app=api --show-labels
```

### Namespace

A name scope and a policy boundary. Names must be unique per namespace, not per cluster, so `team-a/api` and `team-b/api` coexist. Namespaces are where you attach ResourceQuotas, LimitRanges, RBAC RoleBindings, NetworkPolicies and Pod Security labels. Some objects are cluster scoped and live in no namespace (Nodes, PersistentVolumes, StorageClasses, ClusterRoles, Namespaces themselves):

```bash
kubectl api-resources --namespaced=false
```

A Pod can only reference ConfigMaps, Secrets and PVCs in its own namespace. It can reach Services in any namespace over the network unless a NetworkPolicy blocks it.

### Seeing the chain

```bash
kubectl -n team-a get deploy,rs,pods,svc -l app=api
kubectl -n team-a get pod <pod> -o jsonpath='{.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}'
# ReplicaSet/api-6b48bf5ccc
```

The ReplicaSet name is the Deployment name plus a hash of the Pod template (`pod-template-hash` label), and the Pod name adds a random suffix. That hash is how you tell, from a Pod name alone, which version of the template it runs.

## Trade-offs

- **Deployment vs StatefulSet for databases.** A StatefulSet gives stable names and per-replica PVCs, which matters from two replicas on. For a single replica, a Deployment with `Recreate` and one PVC is simpler to operate and to reason about.
- **One namespace per application vs per component.** One per application or team (`team-a`, `team-b`) keeps each one self-contained and easy to delete. Shared infrastructure (a cache or queue used by several applications) fits better in its own namespace, reached via cross-namespace DNS.
- **Labels are free, selectors are forever.** Put a small, stable set of labels in the selector (`app`), and everything else (`version`, `team`) only in metadata, because the selector cannot change later.

## Documentation Links

- [Kubernetes docs: Pods](https://kubernetes.io/docs/concepts/workloads/pods/): lifecycle, multi-container Pods.
- [Kubernetes docs: ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/): ownership and why to use Deployments instead.
- [Kubernetes docs: Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): template changes, selectors, rollouts.
- [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/): selectors, ports, EndpointSlices.
- [Kubernetes docs: Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): scope and cluster-scoped resources.
