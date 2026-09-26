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

## Documentation Links

- [Kubernetes docs: Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/): objects, default roles, privilege escalation prevention.
- [Kubernetes docs: Role Based Access Control Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/): risky permissions.
- [kubectl auth can-i reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/): testing permissions.
- [MicroK8s: RBAC add-on](https://canonical.com/microk8s/docs/multi-user): enabling RBAC and multi-user access.
