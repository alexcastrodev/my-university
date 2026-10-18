---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Role-Based Access Control decides what each identity (a person, a CI job, a ServiceAccount used by a Pod) may do in the API. It is built from four objects: **Role** and **ClusterRole** list allowed verbs on resources, **RoleBinding** and **ClusterRoleBinding** grant them to subjects. Least privilege means every identity gets exactly the verbs, resources and namespaces it needs, and `cluster-admin` is reserved for break-glass access. On MicroK8s there is a prerequisite that surprises people: RBAC is **off** by default. This concept covers enabling it, writing tight Roles, testing them with `kubectl auth can-i`, and replacing the `cluster-admin` bindings that dashboards and admin tools ask for.

## Use Cases

- A CI pipeline that may update Deployments in one namespace and nothing else.
- Read-only access for developers to production namespaces.
- A dashboard or admin tool that its installer binds to `cluster-admin`.
- Auditing who can read Secrets.

## Deep Dive

### First: is RBAC even on?

A fresh MicroK8s 1.35 node runs the API server with:

```
--authorization-mode=AlwaysAllow
```

Every authenticated request is allowed. Verified: from a Pod in the `default` namespace, its auto-mounted ServiceAccount token could list Secrets in `kube-system`:

```bash
curl -sk -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  https://kubernetes.default.svc/api/v1/namespaces/kube-system/secrets     # HTTP 200
```

Any compromised container is therefore cluster-admin. After `microk8s enable rbac` (which switches to `--authorization-mode=RBAC,Node` and restarts the API server), the same request returned **403**. Enable it before anything else runs on the cluster. Components installed while everything was allowed may lack the RBAC objects they need: verified, the ingress add-on enabled before `rbac` later logged `nodes is forbidden: User "system:serviceaccount:ingress:traefik" cannot list resource "nodes"`. Also check other distributions too: `kubectl api-versions | grep rbac` only tells you the API exists, not that it is enforced; test with a token that should be denied.

### The four objects

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: deployer, namespace: team-a}
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: deployer, namespace: team-a}
roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: deployer}
subjects:
  - {kind: ServiceAccount, name: deployer, namespace: team-a}
```

- A **Role** is namespaced; a **ClusterRole** is cluster-wide and can be used for cluster-scoped resources (nodes, namespaces) or as a reusable template.
- A **RoleBinding** grants a Role or a ClusterRole **within one namespace**. A **ClusterRoleBinding** grants a ClusterRole everywhere.
- Rules are additive; there are no deny rules.
- `apiGroups: [""]` is the core group (Pods, Secrets, ConfigMaps, Services). Subresources (`pods/log`, `pods/exec`, `pods/portforward`, `deployments/scale`) are listed separately.

Binding a built-in ClusterRole in one namespace is the most common pattern:

```bash
kubectl -n team-a create rolebinding devs-view --clusterrole=view --group=team-a-devs
kubectl -n team-a create rolebinding ci-edit --clusterrole=edit --serviceaccount=team-a:ci
```

Built-in roles: `view` (read, no Secrets), `edit` (read/write most objects including Secrets, no RBAC), `admin` (edit plus RBAC inside the namespace), `cluster-admin` (everything).

### Testing with kubectl auth can-i

Verified on k3s with a Role in namespace `app` granting `get,list,watch,patch` on `deployments` to the ServiceAccount `app:deployer`:

```
$ kubectl -n app auth can-i patch deployments --as=system:serviceaccount:app:deployer
yes
$ kubectl -n app auth can-i delete deployments --as=system:serviceaccount:app:deployer
no
$ kubectl -n app auth can-i get secrets --as=system:serviceaccount:app:deployer
no
$ kubectl -n infra auth can-i patch deployments --as=system:serviceaccount:app:deployer
no
```

```bash
kubectl -n app auth can-i --list --as=system:serviceaccount:app:deployer
```

`--as` impersonates (you need the `impersonate` permission, which admins have). Put these checks in a script and run them after every RBAC change: they are the unit tests of your permissions.

### What is more powerful than it looks

- **`get`/`list` on Secrets** reveals every credential in the namespace. `list` returns full contents, not only names.
- **`create` on Pods** (or on anything that creates Pods: Deployments, Jobs) lets someone mount any Secret of the namespace and run as any ServiceAccount there. Namespace edit rights are effectively access to all its Secrets.
- **`pods/exec`** is a shell inside containers with their credentials.
- **`escalate`, `bind`, `impersonate`** and write access to Roles/RoleBindings allow granting yourself more.
- **Wildcards** (`resources: ["*"]`, `verbs: ["*"]`) include resource types that do not exist yet.

### Replacing cluster-admin for tools

Dashboards, admin UIs and some operators are installed with a ClusterRoleBinding to `cluster-admin` because it always works. Tighten it:

1. Decide what the tool must do: read everything? manage workloads in some namespaces? read Secrets?
2. Create a ClusterRole with those rules (for read-only across the cluster, bind the built-in `view` with a ClusterRoleBinding; it excludes Secrets).
3. For write access, bind `edit` or a custom role **per namespace** with RoleBindings instead of cluster-wide.
4. Delete the `cluster-admin` binding and verify with `kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>`.

Accept that some features of the tool will stop working; that is the point. If a tool truly needs cluster-admin, protect access to the tool itself (SSO, network restrictions) as you would protect the admin kubeconfig.

### Finding who can do what

```bash
kubectl get rolebindings,clusterrolebindings -A -o wide | grep -E 'cluster-admin|edit'
kubectl auth can-i get secrets -n team-a --as=system:serviceaccount:team-a:default
```

Tools like `rbac-tool` or `kubectl-who-can` answer "who can get secrets in team-a" directly.

## Trade-offs

- **Built-in roles vs custom roles.** `view`/`edit`/`admin` are maintained and aggregate new resource types automatically; custom roles are tighter and must be updated when needs change.
- **Namespace-scoped vs cluster-wide grants.** RoleBindings per namespace limit blast radius and multiply objects; ClusterRoleBindings are simple and grant everything everywhere.
- **Strict RBAC vs convenience.** Tight permissions break tools and scripts that assumed admin; each breakage is a decision about what that tool should really be allowed to do.

## Lab

In this lab you receive an `rbac.yaml` with two namespace identities and two grants that are too generous: `deployer` is `cluster-admin` across the whole cluster and `viewer` has the `edit` role. Your job is to replace them with least-privilege permissions and prove it with `kubectl auth can-i`. The core idea is to feel that "it works" is not an RBAC criterion: the test matters as much for what must be allowed as for what must be denied.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers, with RBAC enforced) receives the `team-a` and `team-b` namespaces and your manifest.

- `ServiceAccount deployer` (CI): must roll out Deployments in `team-a` (get, list, watch, patch, update) and read Pods and their logs, nothing else.
- `ServiceAccount viewer` (developers): reads everything in `team-a` except Secrets and changes nothing.
- `src/main/resources/k8s/rbac.yaml`: the only file you edit. Today `deployer` sits in a `ClusterRoleBinding` to `cluster-admin` and `viewer` in a `RoleBinding` to `edit`.
- `src/test/java/RbacTest.java`: asks the API server, with `kubectl auth can-i --as=system:serviceaccount:team-a:<name>`, what each identity may do. It requires allowed: patch, update and watch on Deployments, listing Pods and reading `pods/log` (deployer), and reading Deployments, logs and ConfigMaps (viewer). It requires denied: deleting Deployments, reading Secrets, `pods/exec`, creating RoleBindings, anything in `team-b` and cluster resources such as nodes.

**What you will do, step by step**

1. **Run the tests first.** Every "must be allowed" check passes and the "must not" checks fail: excess permission does not show up until someone asks what should be denied.
2. **Give the deployer only what it needs (TODO-00).** Remove the `ClusterRoleBinding` to `cluster-admin`. Create a `Role` in `team-a` with only the verbs and resources from the file header (mind `pods/log` as a subresource and the API group of Deployments) and a `RoleBinding` that attaches it to `deployer`.
3. **Give the viewer the right role (TODO-01).** Kubernetes ships a ready-made `ClusterRole` for reading without Secrets. Swap `edit` for it in `viewer`'s `RoleBinding`, which stays limited to `team-a`.

**How you know you are done**

`mvn -pl kubernetes-concepts/rbac-least-privilege test` passes: everything that must be allowed is still allowed and everything that must be denied is now denied. You should be able to explain why a `Role` with a `RoleBinding` limits access to a namespace and a `ClusterRoleBinding` does not.

**Optional challenges**

- **TODO-02:** run `kubectl auth can-i --list -n team-a --as=system:serviceaccount:team-a:deployer` inside the cluster and compare it with the `Role`. Then give the deployer `create` on `pods` only and explain why that alone lets it read every Secret in the namespace.

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container) and the article "RBAC and Least Privilege".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/rbac-least-privilege test`. The `TODO-00` and `TODO-01` comments in `rbac.yaml` mark the two grants to replace.

## Documentation Links

- [Kubernetes docs: Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/): objects, default roles, privilege escalation prevention.
- [Kubernetes docs: Role Based Access Control Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/): risky permissions.
- [kubectl auth can-i reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/): testing permissions.
- [MicroK8s: RBAC add-on](https://canonical.com/microk8s/docs/multi-user): enabling RBAC and multi-user access.
