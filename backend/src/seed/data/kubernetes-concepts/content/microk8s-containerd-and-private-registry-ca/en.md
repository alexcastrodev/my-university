---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Every image a Pod runs is pulled by containerd, not by Kubernetes. When the image lives in a private registry whose TLS certificate is signed by your own CA, the pull fails with `x509: certificate signed by unknown authority` no matter how correct your `imagePullSecrets` are, because trust is configured in containerd on the node. MicroK8s ships its own containerd with its own configuration files, separate from any containerd or Docker on the host. This concept covers where those files are, how to make containerd trust a registry through `certs.d/<host:port>/hosts.toml`, and how to apply the change.

## Use Cases

- Pulling images from an internal Harbor, Nexus, GitLab or `registry:2` instance with a company CA.
- Using an HTTP-only registry in a lab (`localhost:32000` from the `registry` add-on).
- Adding a pull-through mirror for Docker Hub to avoid rate limits.
- Turning on containerd debug logging to understand a pull failure.

## Deep Dive

### Where MicroK8s keeps service configuration

All component flags live in plain files under `/var/snap/microk8s/current/args/` (`${SNAP_DATA}/args`), readable only by root:

```
/var/snap/microk8s/current/args/
  kube-apiserver          kubelet            kube-proxy
  kube-scheduler          kube-controller-manager
  containerd              # command-line flags of containerd
  containerd-template.toml  # template rendered into containerd.toml
  containerd-env          # environment (e.g. HTTP_PROXY for pulls)
  certs.d/                # per-registry host configuration
  ...
```

The containerd flags file on 1.35:

```
--config ${SNAP_DATA}/args/containerd.toml
--root ${SNAP_COMMON}/var/lib/containerd
--state ${SNAP_COMMON}/run/containerd
--address ${SNAP_COMMON}/run/containerd.sock
```

And the template points the CRI registry configuration at `certs.d`:

```toml
config_path = "${SNAP_DATA}/args/certs.d"
```

After editing any args file, restart the services:

```bash
sudo snap restart microk8s
# or
microk8s stop && microk8s start
```

On a single node this restarts the whole control plane and containerd; running containers keep running, but the API is unavailable for a while, so do it in a maintenance window. Example, debug logging for containerd:

```bash
echo '-l=debug' | sudo tee -a /var/snap/microk8s/current/args/containerd
sudo snap restart microk8s
sudo journalctl -u snap.microk8s.daemon-containerd -f
```

### certs.d: one directory per registry

Each registry gets a directory named exactly like the host part of the image reference, **including the port**:

```
image: registry.internal:5000/demo/web-app:1.4.2
       └────────────────────┘
       /var/snap/microk8s/current/args/certs.d/registry.internal:5000/hosts.toml
```

A fresh install already has two, `docker.io` and `localhost:32000`:

```toml
# certs.d/docker.io/hosts.toml
server = "https://docker.io"

[host."https://registry-1.docker.io"]
  capabilities = ["pull", "resolve"]
```

For a registry signed by a private CA:

```bash
sudo mkdir -p /var/snap/microk8s/current/args/certs.d/registry.internal:5000
sudo cp company-root-ca.crt /var/snap/microk8s/current/args/certs.d/registry.internal:5000/ca.crt
```

```toml
# certs.d/registry.internal:5000/hosts.toml
server = "https://registry.internal:5000"

[host."https://registry.internal:5000"]
  capabilities = ["pull", "resolve"]
  ca = "/var/snap/microk8s/current/args/certs.d/registry.internal:5000/ca.crt"
```

For an HTTP-only registry (labs only):

```toml
server = "http://10.0.0.20:32000"

[host."http://10.0.0.20:32000"]
  capabilities = ["pull", "resolve"]
```

`skip_verify = true` exists too; it removes the protection TLS gives you and should not survive past debugging.

Then restart MicroK8s and test a pull directly with the bundled `ctr`, bypassing Kubernetes:

```bash
sudo microk8s ctr images pull --hosts-dir /var/snap/microk8s/current/args/certs.d \
  registry.internal:5000/demo/web-app:1.4.2
```

### Common mistakes

- **Port missing from the directory name.** `certs.d/registry.internal/` does not match `registry.internal:5000/...`. The directory name is the registry host as written in the image reference.
- **Trusting the CA on the host only.** `update-ca-certificates` on Ubuntu helps `curl` and Docker on the host; the MicroK8s containerd uses its own `certs.d`. Both can be needed, they are independent.
- **Intermediate missing.** If the registry serves only its leaf certificate, `ca.crt` must contain the chain up to the root (intermediate + root concatenated).
- **Editing `containerd.toml`.** It is generated from `containerd-template.toml`; edit the template (or better, use `certs.d`) or your change disappears.
- **Old guides.** MicroK8s 1.22 and older configured registries as `registry.mirrors` inside the template. From 1.23 on, `certs.d` is the mechanism.
- **Credentials here.** `hosts.toml` is for trust and endpoints. Registry credentials belong in a `kubernetes.io/dockerconfigjson` Secret referenced by `imagePullSecrets`, see the image pull concept.

### Proxies

If the node reaches registries through an HTTP proxy, containerd needs the proxy variables in `containerd-env`:

```
HTTPS_PROXY=http://proxy.example.com:3128
NO_PROXY=10.1.0.0/16,10.152.183.0/24,127.0.0.1,localhost,registry.internal
```

Forgetting `NO_PROXY` for the Pod and Service CIDRs (`10.1.0.0/16` and `10.152.183.0/24` by default) sends in-cluster traffic to the proxy.

## Trade-offs

- **Per-node trust vs cluster-wide objects.** `certs.d` is node configuration: with three nodes, all three need the file, which is why it belongs in your bootstrap script, not in a runbook step.
- **Private CA vs public certificate on the registry.** A public certificate (e.g. Let's Encrypt via DNS-01) removes the need for any node configuration, at the price of the registry having a public DNS name.
- **Restart cost.** Every change requires a MicroK8s restart. Batch registry changes and test with `ctr` before restarting.

## Documentation Links

- [MicroK8s: Working with a private registry](https://canonical.com/microk8s/docs/registry-private): `hosts.toml` examples, CA, restart.
- [MicroK8s: Configuring services](https://canonical.com/microk8s/docs/configuring-services): args files for every component.
- [containerd: Registry host configuration](https://github.com/containerd/containerd/blob/main/docs/hosts.md): full `hosts.toml` reference (`ca`, `client`, `skip_verify`, mirrors).
- [MicroK8s: Built-in registry](https://canonical.com/microk8s/docs/registry-built-in): the `registry` add-on at `localhost:32000`.
