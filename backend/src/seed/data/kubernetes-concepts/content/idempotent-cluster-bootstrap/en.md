---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A cluster that can only be rebuilt by someone remembering 30 commands is a cluster you will rebuild wrong. The goal is one script that takes a fresh machine to a fully working platform, and that can be **re-run safely** on a cluster that is already up: every step either converges to the desired state or does nothing. This concept covers which commands are naturally idempotent and which are not, patterns that turn the latter into the former, waiting for readiness between steps, and validating the result with a rebuild from scratch.

## Use Cases

- Rebuilding a single-node cluster after disk loss, as part of a restore drill.
- Bringing up an identical lab, staging and production node.
- Re-running the bootstrap after a partial failure without cleaning up first.
- Making the whole setup reviewable in Git.

## Deep Dive

### Idempotent vs not

| Command | Re-run behaviour |
|---|---|
| `snap install microk8s --channel=...` | no-op if installed (use `snap refresh` to change channel) |
| `microk8s enable <addon>` | verified: `Addon core/dns is already enabled`, exit code 0 |
| `kubectl apply -f` / `-k` | converges to the manifest; no-op if unchanged |
| `kubectl create namespace demo` | verified: `Error from server (AlreadyExists)`, exit code 1 |
| `kubectl create secret ...` | fails if it exists |
| `helm install` | fails if the release exists (`helm upgrade --install` converges) |

The rule: **declare, then apply**. Anything you would `create` imperatively can be turned into an apply:

```bash
kubectl create namespace demo --dry-run=client -o yaml | kubectl apply -f -
kubectl -n demo create secret generic db-credentials --from-env-file=secrets/demo.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Verified: applying over a namespace that was created imperatively works, with a one-time warning that the `last-applied-configuration` annotation was missing and is being added. Objects created by `apply` from the start never show it.

### The shape of a bootstrap script

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. cluster
sudo snap install microk8s --classic --channel=1.35/stable
sudo microk8s status --wait-ready
sudo microk8s enable dns hostpath-storage rbac metrics-server ingress cert-manager

# 2. node-level configuration (idempotent file writes, restart only if changed)
sudo install -D -m 0644 registry/hosts.toml \
  /var/snap/microk8s/current/args/certs.d/registry.internal:5000/hosts.toml
# ... compare before copying and restart MicroK8s only when a file changed

# 3. cluster-wide prerequisites
kubectl wait --for condition=established --timeout=120s crd/certificates.cert-manager.io
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
kubectl apply -k k8s/00-cluster          # namespaces, ClusterIssuers, RBAC, policies

# 4. secrets from outside Git
for ns in team-a team-b; do
  kubectl -n "$ns" create secret generic db-credentials \
    --from-env-file="secrets/$ns/db.env" --dry-run=client -o yaml | kubectl apply -f -
done

# 5. workloads, in dependency order, waiting between layers
kubectl apply -k k8s/10-shared
kubectl -n shared rollout status deploy/redis --timeout=300s
kubectl apply -k k8s/20-apps/team-a
kubectl -n team-a rollout status deploy/web --timeout=300s

# 6. smoke test
curl -fsS --retry 10 --retry-delay 3 https://api.example.com/healthz
```

Principles behind it:

- **`set -euo pipefail`**: stop at the first failure instead of continuing on a half-configured cluster.
- **Wait for what the next step needs**, not a fixed `sleep`. `microk8s status --wait-ready`, `kubectl wait --for condition=established crd/...`, `kubectl rollout status`, `kubectl wait --for=condition=complete job/...`.
- **Webhooks are a classic race**: right after installing cert-manager (or any admission webhook), creating its resources fails until the webhook Pod is ready. Wait for its Deployment explicitly.
- **Secrets come from outside Git** (a password manager export, SOPS-encrypted files, a vault) through the same apply pattern.
- **Restarts only when needed**: node-level file changes that require `snap restart microk8s` should compare content first, so a re-run does not restart the cluster for nothing.

### Validating: rebuild from zero

Idempotency is tested by running the script twice on a fresh machine: the second run must change nothing. Reproducibility is tested by destroying everything and running it once more:

```bash
multipass launch 24.04 --name rebuild-test --cpus 2 --memory 8G --disk 40G
multipass transfer -r ./platform rebuild-test:
multipass exec rebuild-test -- ./platform/bootstrap.sh
multipass exec rebuild-test -- ./platform/bootstrap.sh    # second run: no changes, no errors
```

Then the checks that prove it works, not just that it applied:

- `kubectl get pods -A` shows nothing outside `Running` or `Completed`.
- Every Deployment reports `rollout status` complete.
- Smoke tests pass: a request through the Ingress with a valid certificate, a login, a write and a read.
- `kubectl diff -k` on every overlay exits `0`: the cluster matches Git exactly.

What rebuilds typically reveal: an image that only existed in a registry that was part of the old node, a Secret that was never written down, a manual `kubectl edit` that is not in Git, a step that depends on a previous run's leftovers.

### From script to GitOps

A bootstrap script is the right first step. As the number of clusters or applications grows, a GitOps controller (Argo CD, Flux) takes over step 5: it continuously applies what is in Git, reports drift, and handles ordering with sync waves or dependencies. The cluster-level steps (install, add-ons, node files, the GitOps controller itself) stay in the bootstrap script.

## Trade-offs

- **Imperative `create` vs declare-and-apply.** `create` is shorter to type and fails on re-runs; the dry-run-and-apply pattern is a little longer and makes every step re-runnable.
- **Fixed sleeps vs explicit waits.** Sleeps are either too short (flaky) or too long (slow); explicit waits are precise and fail with a clear message.
- **Script vs GitOps.** A script is transparent and has no extra component; GitOps adds a controller to run and gives continuous reconciliation and drift detection.

## Documentation Links

- [Kubernetes docs: Declarative Management of Kubernetes Objects Using Configuration Files](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/): why apply converges.
- [kubectl wait reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_wait/): conditions, JSONPath waits, timeouts.
- [MicroK8s: Command reference](https://canonical.com/microk8s/docs/command-reference): `status --wait-ready`, `enable`.
- [Argo CD: Sync Phases and Waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/): declarative ordering for GitOps.
