---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

`ErrImagePull` and `ImagePullBackOff` both mean the kubelet could not get the image; the second one only adds that it is now waiting before retrying. The status column hides the cause, but the event message states it precisely, and there are only a handful of causes: the image or tag does not exist, the registry refuses the credentials, the registry's TLS certificate is not trusted, the name does not resolve, or the image has no build for the node's CPU architecture. This concept shows the exact message for each, verified on a real cluster, and the fix that goes with it.

## Use Cases

- A deploy stuck with Pods in `ImagePullBackOff`.
- Moving images to a private registry with its own CA.
- Running on ARM nodes (Raspberry Pi, Apple Silicon VMs, Graviton) with images built only for amd64.
- Distinguishing a registry outage from a configuration mistake.

## Deep Dive

### Get the real message

```bash
kubectl -n team-a describe pod web-xyz | sed -n '/Events:/,$p'
kubectl -n team-a get events --field-selector involvedObject.name=web-xyz,type=Warning
```

The `Failed` event contains the error returned by containerd. The sequence is always `Pulling` -> `Failed: ErrImagePull` -> `BackOff` (retry after 10s, 20s, 40s... up to 5 minutes).

### The causes and their messages

All verified on k3s v1.36 (containerd 2.x), arm64 node.

**Tag or repository does not exist**

```
failed to resolve reference "docker.io/library/nginx:9.99-does-not-exist":
docker.io/library/nginx:9.99-does-not-exist: not found
```

Check the exact tag in the registry (`crane ls`, `skopeo list-tags`, or the registry UI). Typical causes: a CI job that did not push, a typo, a tag deleted by a retention policy.

**No access (missing or wrong credentials)**

```
failed to authorize: failed to fetch anonymous token: unexpected status from GET request to
https://ghcr.io/token?scope=repository%3A...%3Apull&service=ghcr.io: 403 Forbidden
```

`anonymous token` gives it away: no credentials were sent. Registries also answer `401 Unauthorized` or `denied` for wrong credentials, and many answer "not found" for private repositories to avoid revealing they exist. Check:

```bash
kubectl -n team-a get pod web-xyz -o jsonpath='{.spec.imagePullSecrets}'
kubectl -n team-a get secret regcred -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d
```

The Secret must be in the Pod's namespace, be of type `kubernetes.io/dockerconfigjson`, and its `auths` key must match the registry host exactly (including the port). See the image pull secrets concept.

**Registry certificate not trusted**

A registry with a self-signed or private-CA certificate:

```
failed to do request: Head "https://172.17.0.3:5000/v2/demo/web-app/manifests/1.0":
tls: failed to verify certificate: x509: certificate signed by unknown authority
```

Trust is configured in containerd on **each node**, not in Kubernetes. On MicroK8s: `/var/snap/microk8s/current/args/certs.d/<host:port>/hosts.toml` with `ca = ".../ca.crt"`, then restart MicroK8s (see the containerd concept). On k3s: `/etc/rancher/k3s/registries.yaml`. `imagePullSecrets` cannot fix this.

**Name does not resolve**

```
failed to do request: Head "https://registry.example.invalid/v2/app/manifests/1.0":
dial tcp: lookup registry.example.invalid: no such host
```

The **node** resolves registry names with its own DNS (containerd does not use CoreDNS), so an in-cluster Service name like `registry.tools.svc.cluster.local` does not work as an image host. Use a name the node can resolve, or the node-reachable address (a NodePort, `localhost:32000` for the MicroK8s registry add-on).

**No image for the node's architecture**

```
failed to pull and unpack image "docker.io/amd64/busybox:1.37":
no match for platform in manifest: not found
```

The image exists but has no variant for the node's platform (here: an amd64-only image on an arm64 node). Check what an image provides:

```bash
docker buildx imagetools inspect registry.example.com/demo/web-app:1.4.2
# lists linux/amd64, linux/arm64, ...
```

Fix it at build time with a multi-platform build (`docker buildx build --platform linux/amd64,linux/arm64 --push`). Emulation is not a runtime fix in Kubernetes. A related failure happens when a single-platform image **without** an index is pulled onto the wrong architecture: the pull succeeds and the container dies with `exec format error`.

**Rate limits**

Docker Hub limits anonymous and free pulls. The message contains `429 Too Many Requests` or `toomanyrequests`. Authenticate the pulls, use a pull-through mirror (`hosts.toml` mirror entry), or host the images you depend on.

### Checks that save time

- `kubectl get pod -o jsonpath='{.spec.containers[*].image}'`: the image the Pod really asks for, after Kustomize or Helm rendering, is not always what you think.
- Try the pull on the node itself: `sudo microk8s ctr images pull <image>` (add `--user` for credentials). If it fails there, the problem is node-level (DNS, CA, proxy, architecture), not Kubernetes.
- `imagePullPolicy: Always` makes every restart depend on the registry. During a registry outage, Pods with `IfNotPresent` and an already-pulled image keep restarting fine.

## Trade-offs

- **Public base images vs a private mirror.** Public images are convenient and subject to rate limits, deletion and outages; mirroring them into your own registry adds a component and removes those external dependencies.
- **Single-architecture vs multi-platform builds.** Single-architecture builds are faster; multi-platform builds let the same tag run on amd64 and arm64 nodes without surprises.
- **Node-level trust vs public certificates.** A private CA requires configuring every node; a publicly trusted certificate on the registry needs none.

## Documentation Links

- [Kubernetes docs: Images](https://kubernetes.io/docs/concepts/containers/images/): pull policy, private registries, multi-architecture images.
- [Kubernetes docs: Debug Pods (image pull issues)](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/): diagnosing Pods stuck pulling.
- [MicroK8s: Working with a private registry](https://canonical.com/microk8s/docs/registry-private): trusting a CA with `hosts.toml`.
- [Docker docs: Multi-platform builds](https://docs.docker.com/build/building/multi-platform/): building images for several architectures.
- [k3s docs: Private Registry Configuration](https://docs.k3s.io/installation/private-registry): `registries.yaml`.
