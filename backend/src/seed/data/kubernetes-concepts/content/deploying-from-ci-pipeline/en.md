---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Deploying by hand from a laptop does not scale and leaves no trace. A CI pipeline that runs `kubectl apply -k` is the natural next step, and it raises three questions: which identity the pipeline uses (never the admin kubeconfig), how it selects the right cluster and namespace (explicit context, not whatever is current), and how it knows the deploy actually worked (`rollout status`, not the exit code of `apply`). This concept builds a push-based deploy job end to end, and compares it with the pull-based GitOps alternative.

## Use Cases

- Deploying every merge to `main` to staging, and tagged releases to production.
- Giving the pipeline exactly the permissions it needs in the namespaces it deploys to.
- Failing the pipeline when the new version does not become ready.
- Deploying to a cluster that is not reachable from the internet.

## Deep Dive

### An identity for the pipeline

Create a ServiceAccount per target namespace and bind only what deploying needs (see the RBAC concept for a tailored Role; the built-in `edit` ClusterRole is a reasonable start):

```bash
kubectl -n team-a create serviceaccount ci-deployer
kubectl -n team-a create rolebinding ci-deployer --clusterrole=edit \
  --serviceaccount=team-a:ci-deployer
```

Give the pipeline a **short-lived token**, not a long-lived Secret:

```bash
kubectl -n team-a create token ci-deployer --duration=1h
```

Two practical options:

- **OIDC federation** (best): the CI system issues an OIDC token per job (GitHub Actions, GitLab CI both do), and the API server is configured to trust that issuer (`--authentication-config` / structured authentication). No stored cluster credential at all. Requires control over the API server flags, which you have on MicroK8s (`args/kube-apiserver`).
- **A stored token or kubeconfig** in the CI secret store, scoped to the namespace and rotated. If you must store a long-lived one, it should belong to a ServiceAccount that can do nothing but deploy to one namespace.

Never store the admin kubeconfig from `microk8s config` in CI: its client certificate is in `system:masters`, bypasses RBAC and cannot be revoked short of rotating the cluster CA.

### A kubeconfig built in the job

```bash
kubectl config set-cluster target --server="$K8S_SERVER" \
  --certificate-authority=<(printf '%s' "$K8S_CA_PEM") --embed-certs=true
kubectl config set-credentials ci --token="$K8S_TOKEN"
kubectl config set-context deploy --cluster=target --user=ci --namespace=team-a
kubectl config use-context deploy
```

The job's kubeconfig contains exactly one context, so no command can accidentally hit another cluster. Pass `--context deploy -n team-a` explicitly anyway in scripts; it documents intent and survives someone adding a second context later.

### The deploy job

A GitHub Actions example (the same steps work in any CI):

```yaml
deploy-staging:
  runs-on: ubuntu-latest
  environment: staging                    # environment-scoped secrets and approvals
  steps:
    - uses: actions/checkout@v4
    - name: Set image tag
      run: |
        cd k8s/overlays/staging
        kustomize edit set image registry.example.com/demo/web-app=registry.example.com/demo/web-app:${GITHUB_SHA}
    - name: Render and diff
      run: |
        kubectl kustomize k8s/overlays/staging > rendered.yaml
        kubectl diff -f rendered.yaml || [ $? -eq 1 ]      # 1 = differences, >1 = error
    - name: Apply
      run: kubectl apply -f rendered.yaml
    - name: Wait for rollout
      run: |
        for d in $(kubectl get deploy -o name); do
          kubectl rollout status "$d" --timeout=300s
        done
    - name: Smoke test
      run: curl -fsS --retry 10 --retry-delay 3 https://staging.example.com/healthz
```

The details that make it trustworthy:

- **Immutable tags**: the image tag is the commit SHA, so every deploy changes the Pod template and a rollout actually happens.
- **Render once, apply what was rendered**: the artefact `rendered.yaml` can be stored with the job, so you always know exactly what was deployed.
- **`kubectl diff` exit codes**: `0` no changes, `1` changes, anything else an error (for example `field is immutable` on a Job). Treat `1` as success and higher as failure.
- **`rollout status` is the real result**: `apply` succeeds as soon as the API accepts the objects. The job must fail if Pods crash-loop or never become ready.
- **Environment protection**: production deploys behind a manual approval, with production credentials only visible to that environment.

On failure, the job can run `kubectl rollout undo` for each Deployment, but then Git and the cluster disagree. Prefer failing loudly and fixing forward, or reverting the commit so the next pipeline run redeploys the previous state.

### Clusters CI cannot reach

A single-node cluster behind a firewall has no public API endpoint, and it should not get one just for CI. Options:

- A **self-hosted runner** inside the network, which reaches the API server locally.
- A VPN or tunnel step in the job (WireGuard, Tailscale) to reach the node.
- **Pull-based GitOps**: an agent inside the cluster (Argo CD, Flux) watches the Git repository and applies changes itself. CI only builds images and updates the tag in Git. The cluster needs outbound access to Git and the registry, and no inbound access at all.

### Push vs pull

| | Push (CI runs kubectl) | Pull (GitOps agent) |
|---|---|---|
| Credentials | CI holds cluster credentials | cluster holds Git read credentials |
| Network | CI must reach the API server | cluster must reach Git |
| Drift | only corrected on the next deploy | detected and corrected continuously |
| Visibility | in CI logs | in the GitOps UI and Git history |
| Setup | minimal | a controller to install and run |

## Trade-offs

- **Push vs pull.** Push is simpler to start and keeps everything in the CI tool; pull removes cluster credentials from CI and fixes drift continuously, at the cost of running another component.
- **Stored tokens vs OIDC federation.** Stored tokens work everywhere and must be rotated; OIDC removes stored secrets and needs API server configuration.
- **Namespace-scoped vs cluster-wide deploy identity.** Scoped identities limit the blast radius of a leaked CI secret; cluster-wide identities are simpler for pipelines that manage many namespaces and dangerous for the same reason.

## Documentation Links

- [Kubernetes docs: Authenticating (OpenID Connect tokens)](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens): trusting an external issuer.
- [Kubernetes docs: Service account tokens (kubectl create token)](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_token/): short-lived tokens.
- [kubectl diff reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/): exit codes.
- [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/): pull-based GitOps.
- [GitHub Docs: Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment): approvals and scoped secrets.
