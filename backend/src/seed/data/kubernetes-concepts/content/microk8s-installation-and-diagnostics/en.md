---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

MicroK8s is Canonical's single-package Kubernetes: one snap that contains the API server, scheduler, controller manager, kubelet, kube-proxy, containerd, a CNI (Calico) and a datastore. It is a common choice for a single-node production box, an edge site or a lab machine, because it installs in one command and upgrades through snap channels. This concept covers installing it with a pinned version channel, checking that the cluster is actually ready, running `kubectl` without `sudo`, and collecting a diagnostic report when something is wrong.

## Use Cases

- Standing up a one-node Kubernetes on an Ubuntu VM or bare-metal server for a small production setup.
- Pinning the cluster to a Kubernetes minor version so an automatic snap refresh never jumps you to the next one.
- Scripting a bootstrap that waits for the cluster before applying manifests.
- Attaching a support bundle (`microk8s inspect`) to an issue or handing it to a colleague.

## Deep Dive

### Installing with a version channel

```bash
sudo snap install microk8s --classic --channel=1.35/stable
```

- `--classic` is required: MicroK8s needs access to the host (network, mounts, cgroups) that a strictly confined snap does not get.
- The channel is `<k8s-minor>/<risk>`. `1.35/stable` means "the latest stable 1.35.x". Snap refreshes automatically, but **only inside the tracked channel**: you get 1.35.5 to 1.35.6 patch updates, never 1.36.
- Without `--channel` you get the snap's default track, which Canonical moves over time. Verified in September 2026: a plain `snap install microk8s --classic` installed `v1.35.6` tracking `1.35/stable`, while `latest/stable` was already `v1.36.2`. The same script therefore installs different minor versions depending on the day it runs. For anything you care about, always pin.

Moving to the next minor is an explicit action:

```bash
sudo snap refresh microk8s --channel=1.36/stable
```

Check what you are tracking and what exists:

```bash
snap list microk8s          # installed version, revision, tracking channel
snap info microk8s          # all channels and their versions
```

Verified on a fresh Ubuntu 24.04 VM (September 2026): `1.35/stable` installed `v1.35.6`, tracking `1.35/stable`. At that date `1.36` was released upstream by MicroK8s but still being promoted through the channels, which is exactly why you pin.

Snap refreshes also restart the MicroK8s services. Verified with `snap restart microk8s`: running containers kept running (restart count 0), but the API server is unavailable for a while, so deploys and scheduling pause until it is back. You can control the window:

```bash
sudo snap set system refresh.timer=sat,03:00-04:00   # refresh window
sudo snap refresh --hold=720h microk8s               # postpone refreshes of this snap
```

### What runs inside the snap

MicroK8s does not run the control plane as separate Pods like kubeadm does. The Kubernetes components run in one process, `kubelite`, managed by systemd:

```
snap.microk8s.daemon-containerd
snap.microk8s.daemon-kubelite        # apiserver + scheduler + controller-manager + kubelet + proxy
snap.microk8s.daemon-k8s-dqlite      # the datastore (dqlite, not etcd)
snap.microk8s.daemon-apiserver-kicker
snap.microk8s.daemon-cluster-agent
```

Two consequences: `kubectl get pods -n kube-system` shows only add-ons (Calico, CoreDNS, ...), never a `kube-apiserver` Pod; and the datastore is dqlite, so etcd-specific tooling (`etcdctl snapshot`) does not apply.

### Is it ready?

```bash
microk8s status --wait-ready
```

`--wait-ready` blocks until the API server answers, which makes it the right first line of any bootstrap script. The output also lists which add-ons are enabled. On a fresh 1.35 install, `dns` is already enabled; `hostpath-storage`, `ingress`, `rbac` and `metrics-server` are not.

Then check the node itself:

```bash
microk8s kubectl get nodes -o wide
microk8s kubectl get pods -A
```

A `Ready` node with `calico-node`, `calico-kube-controllers` and `coredns` running is a working cluster.

### Running kubectl without sudo

Out of the box, every command needs `sudo`. Running `microk8s status` as a normal user prints the fix:

```
Insufficient permissions to access MicroK8s.
You can either try again with sudo or add the user ubuntu to the 'microk8s' group:

    sudo usermod -a -G microk8s ubuntu
    sudo chown -R ubuntu ~/.kube
```

```bash
sudo usermod -a -G microk8s $USER
mkdir -p ~/.kube && sudo chown -R $USER ~/.kube
newgrp microk8s        # or log out and back in
```

Membership of the `microk8s` group is effectively cluster-admin: the group can read the admin credentials under `/var/snap/microk8s/current/credentials`. Treat it like the `docker` group.

`microk8s kubectl` is a bundled kubectl matching the cluster version. Two ways to type less:

```bash
sudo snap alias microk8s.kubectl kubectl     # system-wide alias
alias kubectl='microk8s kubectl'             # shell alias only
```

The snap alias conflicts with a separately installed `kubectl`. If you use a standalone kubectl (to talk to several clusters), export the kubeconfig instead, see the kubeconfig concept.

### Collecting diagnostics

```bash
sudo microk8s inspect
```

It checks every service (`Service snap.microk8s.daemon-kubelite is running`), copies the args of each component, the process list, disk and memory usage, network configuration, inotify limits and a dqlite dump into a tarball:

```
Building the report tarball
  Report tarball is at /var/snap/microk8s/<revision>/inspection-report-<date>.tar.gz
```

It also prints warnings for common host problems, such as the firewall blocking Pod traffic or IP forwarding being disabled. For a single failing service, the systemd journal is faster:

```bash
sudo journalctl -u snap.microk8s.daemon-kubelite --since "10 min ago"
```

## Trade-offs

- **Automatic patch refreshes vs control.** Staying inside a channel gives you security patches for free, at the price of an unplanned restart. On a single-node production box, set a refresh window or hold refreshes and patch deliberately.
- **Bundled `microk8s kubectl` vs standalone kubectl.** The bundled one always matches the server version and needs no config. A standalone kubectl is needed as soon as you manage more than one cluster or run commands from your laptop or CI.
- **The `microk8s` group is convenient and powerful.** Adding a user to it is granting full cluster access, not "permission to run kubectl".
- **Single package, single failure domain.** One `kubelite` process restart restarts the whole control plane and the kubelet. That is fine for one node; for real availability you need three nodes (`microk8s add-node`) and the `ha-cluster` add-on.

## Documentation Links

- [MicroK8s: Getting started](https://canonical.com/microk8s/docs/getting-started): install, group membership, first commands.
- [MicroK8s: Selecting a snap channel](https://canonical.com/microk8s/docs/setting-snap-channel): channel naming and pinning.
- [MicroK8s: Upgrading a cluster](https://canonical.com/microk8s/docs/upgrade-cluster): moving between minor versions.
- [MicroK8s: Release notes](https://canonical.com/microk8s/docs/release-notes): what changed in each version (e.g. the ingress add-on moving from NGINX to Traefik).
- [Snapcraft: Managing updates](https://snapcraft.io/docs/managing-updates): refresh timers and holds.
