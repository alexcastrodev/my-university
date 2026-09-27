---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A fresh MicroK8s node is a bare Kubernetes: no default storage, no ingress, no metrics, and (surprisingly) no RBAC. Features are switched on with add-ons, `microk8s enable <name>`, each of which applies manifests or a Helm chart into the cluster. Two of them are needed by almost every workload: `dns` (CoreDNS, so Pods can resolve Services and the outside world) and `hostpath-storage` (a default StorageClass, so PersistentVolumeClaims bind). This concept covers both, including where hostpath data really lives on the node, its limits, and how CoreDNS decides which upstream DNS servers to use.

## Use Cases

- Getting PersistentVolumeClaims for databases and other stateful workloads to bind on a single node.
- Fixing Pods that resolve cluster Services but not external names (or the other way round) in a corporate network with internal DNS servers.
- Knowing which directory to back up, monitor for disk usage, or move to a bigger disk.
- Reviewing which add-ons a node has before trusting it (`rbac` in particular).

## Deep Dive

### Listing and enabling add-ons

```bash
microk8s status                     # enabled and disabled add-ons
microk8s enable hostpath-storage
microk8s enable dns:10.0.0.53       # add-ons can take arguments after a colon
microk8s disable <name>
```

On a fresh 1.35 install (verified September 2026), only `dns`, `ha-cluster`, `helm` and `helm3` are enabled. Everything else, including `rbac`, `hostpath-storage`, `ingress`, `metrics-server`, `cert-manager` and `observability`, is off. Add-ons are just manifests: `microk8s enable ingress` creates a namespace and a DaemonSet you can see with `kubectl`.

The `rbac` add-on deserves a separate warning: with it disabled the API server runs with `--authorization-mode=AlwaysAllow`, so any authenticated identity, including every Pod's ServiceAccount token, can do anything. See the RBAC concept.

### DNS: CoreDNS and its upstreams

The `dns` add-on deploys CoreDNS in `kube-system` behind a Service at `10.152.183.10`, and the kubelet is configured with `--cluster-dns=10.152.183.10 --cluster-domain=cluster.local`, so every Pod's `/etc/resolv.conf` points there.

CoreDNS answers `*.cluster.local` from the Kubernetes API and forwards everything else. The default Corefile on 1.35:

```
.:53 {
    errors
    health { lameduck 5s }
    ready
    log . { class error }
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
```

`forward . /etc/resolv.conf` means "use the node's resolvers". On Ubuntu that file is systemd-resolved's view (the kubelet is started with `--resolv-conf=/run/systemd/resolve/resolv.conf` to avoid the `127.0.0.53` stub, which would loop). This works until the node's resolvers are not what Pods need: a VPN resolver, a split-horizon corporate DNS, or a node whose DNS is managed by DHCP and changes.

Pinning explicit forwarders:

```bash
microk8s disable dns
microk8s enable dns:10.0.0.53,10.0.0.54
```

The `disable` is required: `dns` is enabled on a fresh install, and enabling an enabled add-on only prints `Addon core/dns is already enabled` and changes nothing (verified: the Corefile kept `forward . /etc/resolv.conf`).

Or edit the live config, which CoreDNS reloads on its own (`reload` plugin, about 30 seconds):

```bash
microk8s kubectl -n kube-system edit configmap/coredns
#   forward . 10.0.0.53 10.0.0.54
```

A split setup, internal zone to the corporate DNS and the rest to public resolvers:

```
corp.example.com:53 {
    forward . 10.0.0.53
}
.:53 {
    ...
    forward . 1.1.1.1 8.8.8.8
}
```

Debugging from inside the cluster:

```bash
kubectl run dnstest --rm -it --image=busybox:1.37 --restart=Never -- nslookup kubernetes.default
kubectl run dnstest --rm -it --image=busybox:1.37 --restart=Never -- nslookup example.com
kubectl -n kube-system logs deploy/coredns
```

If cluster names resolve but external ones fail, the problem is the `forward` target. If nothing resolves, look at CoreDNS itself (is it running? is a NetworkPolicy blocking port 53?).

### hostpath-storage: a StorageClass backed by a directory

```bash
microk8s enable hostpath-storage
kubectl get storageclass
```

```
NAME                          PROVISIONER            RECLAIMPOLICY   VOLUMEBINDINGMODE
microk8s-hostpath (default)   microk8s.io/hostpath   Delete          WaitForFirstConsumer
```

It is marked default, so a PVC without `storageClassName` uses it. For each PVC the provisioner creates a directory and a PersistentVolume of type `hostPath` pointing to it:

```
/var/snap/microk8s/common/default-storage/<namespace>-<pvc-name>-<pv-name>
```

Verified: a 1 Gi PVC `kdata` in `default` became `/var/snap/microk8s/common/default-storage/default-kdata-pvc-9063aedf-...`, a directory with mode `0777` owned by root, and the PV spec is `hostPath: {path: ..., type: DirectoryOrCreate}`.

What that implies:

- **Capacity is not enforced.** A Pod wrote 200 MiB into a 50 Mi claim without any error; the claim still reports 50Mi. A runaway log or a growing data directory can fill the node's disk, which then triggers kubelet disk-pressure eviction of everything.
- **`Delete` really deletes.** Deleting the PVC removed the directory and its data within seconds. For databases, consider a StorageClass with `reclaimPolicy: Retain`.
- **Node-bound.** Data cannot move to another node. Fine on one node, a trap once you add nodes.
- **`WaitForFirstConsumer`.** A PVC stays `Pending` until a Pod uses it. That is normal, not an error.
- **Backup tooling may skip it.** Velero's file-system backup does not support `hostPath` volumes.

### A custom directory or reclaim policy

To put volumes on a dedicated disk, or keep data after the PVC is deleted, create your own StorageClass:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ssd-retain
provisioner: microk8s.io/hostpath
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
parameters:
  pvDir: /mnt/ssd/k8s-volumes
```

Only one StorageClass should carry the `storageclass.kubernetes.io/is-default-class: "true"` annotation.

Disabling the add-on keeps the data by default; `microk8s disable hostpath-storage:destroy-storage` removes it as well.

## Trade-offs

- **hostpath-storage vs a real storage system.** It is zero-setup and fast (local disk), and it is honest about being single-node, with no quotas, no snapshots and no replication. For more than one node, look at OpenEBS, Longhorn, `rook-ceph` or a cloud CSI driver.
- **`Delete` vs `Retain`.** `Delete` keeps the disk clean automatically; `Retain` protects you from a `kubectl delete namespace` wiping a database, at the price of cleaning up released PVs by hand.
- **Node resolvers vs explicit forwarders.** Following `/etc/resolv.conf` adapts when the node's DNS changes; explicit forwarders are predictable and survive VPN or DHCP changes, but must be updated when the network changes.

## Documentation Links

- [MicroK8s: Add-ons](https://canonical.com/microk8s/docs/addons): full list and what each installs.
- [MicroK8s: DNS add-on](https://canonical.com/microk8s/docs/addon-dns): custom forwarders and editing the CoreDNS ConfigMap.
- [MicroK8s: Hostpath storage](https://canonical.com/microk8s/docs/addon-hostpath-storage): default path, `pvDir`, limitations.
- [Kubernetes docs: Customizing DNS Service](https://kubernetes.io/docs/tasks/administer-cluster/dns-custom-nameservers/): Corefile, stub domains, upstreams.
- [Kubernetes docs: Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/): default class, reclaim policy, binding mode.
