---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Before a container starts, the kubelet asks containerd to pull its image. Two Pod fields control that step: **`imagePullSecrets`**, which provides registry credentials, and **`imagePullPolicy`**, which decides whether the kubelet pulls at all when the image is already on the node. Getting them wrong produces either `ImagePullBackOff` or, more dangerously, a Pod silently running an old image under a tag you thought you had updated. This concept covers creating a registry Secret, attaching it to Pods or to a ServiceAccount, and choosing a pull policy that is both reliable and honest about which code is running.

## Use Cases

- Pulling application images from a private registry (Harbor, GitLab, GHCR, Nexus).
- Making every Pod in a namespace use the registry credentials without editing each Deployment.
- Deploying `:latest` or a moving tag and understanding why some nodes run the new build and some the old.
- Rotating a registry token.

## Deep Dive

### Creating a dockerconfigjson Secret

```bash
kubectl -n team-a create secret docker-registry regcred \
  --docker-server=registry.internal:5000 \
  --docker-username=ci-puller \
  --docker-password="$REGISTRY_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
```

The result has type `kubernetes.io/dockerconfigjson` and one key, `.dockerconfigjson`, holding the same JSON Docker writes to `~/.docker/config.json`:

```json
{"auths":{"registry.internal:5000":{"username":"ci-puller","password":"...","auth":"Y2ktcHVsbGVyOi4uLg=="}}}
```

Two ways that break often:

- **`--docker-server` must match the image reference host exactly**, including the port. For Docker Hub use `https://index.docker.io/v1/`.
- **Creating it from your own `~/.docker/config.json`** (`--from-file=.dockerconfigjson=...`) only works if that file contains the credentials. With a credential helper (`"credsStore": "osxkeychain"`), it contains none.

In Kustomize, the equivalent is a `secretGenerator` with `type: kubernetes.io/dockerconfigjson` and `files: [.dockerconfigjson=config.json]`.

Use a dedicated, read-only (pull-only) robot account or token, never a personal login.

### Attaching it

Per Pod:

```yaml
spec:
  imagePullSecrets:
    - name: regcred
  containers:
    - name: app
      image: registry.internal:5000/demo/web-app:1.4.2
```

Per ServiceAccount, so every Pod using that ServiceAccount (including `default`) gets it automatically:

```bash
kubectl -n team-a patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"regcred"}]}'
```

The Secret must exist **in the Pod's namespace**. A `regcred` in `default` does nothing for Pods in `team-a`, a classic cause of "it worked in my namespace".

### imagePullPolicy

| Policy | Behaviour |
|---|---|
| `IfNotPresent` | pull only if the node does not have that image reference yet |
| `Always` | contact the registry on every container start; reuse local layers if the digest matches |
| `Never` | never pull; fail if the image is not on the node |

If you omit it, Kubernetes sets a default when the Pod is created:

- tag `:latest` or no tag: `Always`
- any other tag or a digest: `IfNotPresent`

Check what your Pod actually got with `kubectl get pod <pod> -o jsonpath='{.spec.containers[*].imagePullPolicy}'`.

### The moving-tag trap

With `IfNotPresent` and a tag you overwrite (`1.4`, `develop`, `stable`), a node that pulled the tag yesterday keeps running yesterday's image forever, and a new node pulls today's. The Pod spec is identical in both cases, so Kubernetes has no way to notice. `kubectl rollout restart` does not help either: the image is "present".

Choices, from most to least reliable:

1. **Immutable tags** (`1.4.2`, a Git SHA) and change the tag on every deploy. The Pod template changes, a rollout happens, and `IfNotPresent` is correct and fast.
2. **Digests** (`image: registry.internal:5000/demo/web-app@sha256:...`), which cannot move by definition.
3. **`Always`** with a moving tag. Every start contacts the registry, so a restart picks up the new image, but the registry becomes a hard dependency for every Pod start: registry down means no restarts, no rescheduling after a node failure.

`Always` does not re-download unchanged layers; the cost is the registry round-trip and the availability dependency, not bandwidth.

### Rotating the credentials

The kubelet reads the pull Secret at pull time. Update the Secret (same name) and the next pull uses the new token; running containers are unaffected because they are already pulled. Test a pull right after rotating, for example by scaling a Deployment up by one, instead of discovering an expired token during a node failure.

### Pull errors in a nutshell

`ErrImagePull` is a failed attempt; `ImagePullBackOff` is the kubelet waiting before the next one (10s, doubling up to 5 minutes). `kubectl describe pod` shows the real reason in the events: `401 Unauthorized` (credentials), `not found` (tag), `x509: certificate signed by unknown authority` (containerd CA trust), `no match for platform in manifest` (architecture). The troubleshooting concept for image pull errors goes through each.

## Trade-offs

- **Per-Pod vs ServiceAccount pull secrets.** Per-Pod is explicit and visible in the Deployment; attaching to the ServiceAccount removes repetition and makes new workloads just work, at the cost of being invisible when reading a manifest.
- **`IfNotPresent` vs `Always`.** `IfNotPresent` makes Pod starts independent from the registry; it is only correct with immutable tags. `Always` tolerates moving tags and couples every start to the registry.
- **Tags vs digests.** Digests are the most precise and the least readable; tags are readable and only safe when your process never reuses them.

## Documentation Links

- [Kubernetes docs: Images (image pull policy)](https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy): defaults and behaviour of each policy.
- [Kubernetes docs: Pull an Image from a Private Registry](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/): creating and using `regcred`.
- [Kubernetes docs: Add ImagePullSecrets to a service account](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#add-imagepullsecrets-to-a-service-account): namespace-wide credentials.
- [kubectl create secret docker-registry](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_docker-registry/): flags reference.
