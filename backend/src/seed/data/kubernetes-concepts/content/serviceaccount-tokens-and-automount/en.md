---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Every Pod runs as a **ServiceAccount**, and by default Kubernetes mounts a token for it into every container at `/var/run/secrets/kubernetes.io/serviceaccount`. That token is a credential for the API server. Most applications never call the Kubernetes API, so for them the token is pure attack surface: whoever gets code execution in the container gets the ServiceAccount's permissions, which on a cluster without RBAC means everything. This concept covers what the token is, how long it lives, when to turn automounting off with `automountServiceAccountToken: false`, and how to give the few Pods that need API access their own, narrowly scoped identity.

## Use Cases

- Hardening ordinary web services that never talk to the Kubernetes API.
- Giving an operator, a CI runner or a controller its own ServiceAccount with a minimal Role.
- Issuing a short-lived token with a custom audience for an external system (Vault, a cloud provider).
- Avoiding the mount collision that the token causes with Secrets mounted at `/run/secrets`.

## Deep Dive

### What gets mounted

```bash
kubectl exec web-xyz -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ca.crt  namespace  token
```

- `token`: a JWT signed by the API server, bound to this Pod.
- `ca.crt`: to verify the API server's certificate.
- `namespace`: the Pod's namespace.

The token's claims, verified on k3s v1.36 (decoded payload, trimmed):

```json
{"aud":["https://kubernetes.default.svc.cluster.local","k3s"],
 "iss":"https://kubernetes.default.svc.cluster.local",
 "kubernetes.io":{"namespace":"app","node":{"name":"..."},"pod":{"name":"client"},
                  "serviceaccount":{"name":"default"}},
 "exp":1821989008, "iat":1790453008}
```

It is a **bound, projected token**: tied to the Pod (it stops being valid when the Pod is deleted), with an audience and an expiry, and the kubelet refreshes it automatically. `exp - iat` here is one year: the API server extends kubelet-requested tokens for compatibility with old clients (`--service-account-extend-token-expiration`, on by default), while the Pod binding still invalidates it when the Pod goes away. Since Kubernetes 1.24 no long-lived token Secrets are created automatically for ServiceAccounts.

If a Pod does not specify `serviceAccountName`, it uses the namespace's `default` ServiceAccount.

### Turning it off

For the ServiceAccount (every Pod using it):

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: {name: default, namespace: team-a}
automountServiceAccountToken: false
```

Or per Pod (overrides the ServiceAccount setting):

```yaml
spec:
  automountServiceAccountToken: false
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
```

Verified: with it, the `serviceaccount` directory is simply absent, and nothing changes for an application that never used it.

It also removes a real startup failure. In images where `/var/run` is a symlink to `/run` (Debian and Ubuntu based), mounting a Secret read-only at `/run/secrets` collides with the token mount point and the container fails with `StartError: ... mkdirat .../run/secrets/kubernetes.io: read-only file system`. Verified: the same Pod starts once automounting is off. (The volumes concept covers the details.)

### Pods that do need the API

Give them a dedicated ServiceAccount instead of using `default`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: {name: config-watcher, namespace: team-a}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: read-configmaps, namespace: team-a}
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: config-watcher, namespace: team-a}
roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: read-configmaps}
subjects: [{kind: ServiceAccount, name: config-watcher, namespace: team-a}]
---
# in the Pod spec
serviceAccountName: config-watcher
automountServiceAccountToken: true
```

Test it: `kubectl -n team-a auth can-i list secrets --as=system:serviceaccount:team-a:config-watcher` should say `no`.

### Tokens for other audiences

A projected volume can mount an extra token with a specific audience and lifetime, for systems that verify Kubernetes tokens (Vault's Kubernetes auth, cloud workload identity):

```yaml
volumes:
  - name: vault-token
    projected:
      sources:
        - serviceAccountToken:
            audience: vault
            expirationSeconds: 3600
            path: token
```

Such a token cannot be replayed against the Kubernetes API (wrong audience). For humans and CI, `kubectl create token <sa> --duration=1h` issues a short-lived token on demand.

### When the default token is dangerous

The token's power is exactly the permissions of its ServiceAccount:

- With RBAC enforced and no bindings, the `default` ServiceAccount can do almost nothing (discovery endpoints and self-review).
- On a cluster with `--authorization-mode=AlwaysAllow` (MicroK8s until `microk8s enable rbac`), every token is effectively cluster-admin. Verified: a Pod's default token read Secrets in `kube-system` (HTTP 200) until RBAC was enabled (HTTP 403).
- A RoleBinding someone added to `default` "to make a tool work" silently grants that to every Pod in the namespace.

Turning automount off by default and granting API access explicitly makes all three cases safe.

## Trade-offs

- **Automount on vs off by default.** On is convenient for the few apps that use the API and exposes a credential in every other container; off requires opting in explicitly for those few.
- **Per-application ServiceAccounts vs `default`.** Dedicated accounts give precise permissions and clear audit logs; they add one object per application.
- **Projected audience tokens vs long-lived secrets.** Audience-bound, expiring tokens limit the damage of a leak; long-lived token Secrets never expire and must be rotated by hand.

## Documentation Links

- [Kubernetes docs: Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/): default ServiceAccounts, tokens, use cases.
- [Kubernetes docs: Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/): opting out of automounting, projected tokens.
- [Kubernetes docs: Managing Service Accounts](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/): bound tokens and their lifetime.
- [Kubernetes docs: Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): limiting credential exposure.
