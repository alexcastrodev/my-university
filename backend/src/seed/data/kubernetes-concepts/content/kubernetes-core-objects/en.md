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

## Lab

In this lab you get a `web.yaml` with a `shop` namespace, a bare Pod that serves `hello from <pod name>` and a Service in front of it. Your job is to turn the bare Pod into a Deployment and make the Service see every replica. The core idea is to see the chain of objects Kubernetes builds (Deployment, ReplicaSet, Pods) and understand that a Service picks Pods by labels, not by name.

**The scenario**

It is a team's first deployment: a web server and a `web` Service in the `shop` namespace. The test applies your file, starts a `client` Pod to make requests and then deletes the web Pods to see whether they come back.

- `src/main/resources/k8s/web.yaml`: your file, with the `shop` Namespace, the `web` Pod (label `app: web`, named port `http`) and the `web` Service (port 80 to `targetPort: http`).
- `src/test/java/CoreObjectsTest.java`: checks the ownership chain, the load spreading and the recovery.

Look at the Service selector: it requires two labels, `app: web` and `instance: web-0`, and only one Pod has both.

**What you will do, step by step**

1. **Run it and read the failures.** Run the tests before editing to see what the bare Pod does not guarantee.
2. **Replace the Pod with a Deployment (TODO-00).** Today, if the Pod is deleted (a node drain, an eviction, a mistake), nothing brings it back. Run the same container through a Deployment with 2 replicas, in the `shop` namespace, with `selector.matchLabels` and the template labels consistent with each other, and move the Pod's content into the `template`. The Deployment creates a ReplicaSet, which owns the Pods.
3. **Make the Service select every replica (TODO-01).** With 2 replicas, both must receive traffic. Review the Service `selector`: it may only use labels that every replica has. The test makes up to 30 requests to `http://web.shop` and expects to see responses from two different Pod names.

**How you know you are done**

`mvn -pl kubernetes-concepts/kubernetes-core-objects test` passes completely: each web Pod is owned by a ReplicaSet that belongs to the `web` Deployment with 2 ready replicas, requests reach both replicas and, after deleting every Pod, new ones come up and the Service answers `200` again. You should be able to explain who owns whom and why a Service with no endpoints receives no traffic.

**Optional challenges**

- **TODO-02:** change the image of the Deployment and run `kubectl -n shop get rs`. How many ReplicaSets are there now, and what are their replica counts?

**Prerequisites:** Docker running (the test starts a `rancher/k3s` container and pulls `busybox` inside it), the article "Pods, ReplicaSets, Deployments, Services and Namespaces", Java and Maven.

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/kubernetes-core-objects test`. You only edit `web.yaml`, and the TODO comments in it mark the two spots.

## Documentation Links

- [Kubernetes docs: Pods](https://kubernetes.io/docs/concepts/workloads/pods/): lifecycle, multi-container Pods.
- [Kubernetes docs: ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/): ownership and why to use Deployments instead.
- [Kubernetes docs: Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): template changes, selectors, rollouts.
- [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/): selectors, ports, EndpointSlices.
- [Kubernetes docs: Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): scope and cluster-scoped resources.
