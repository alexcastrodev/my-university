---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Data that must survive a Pod (a database, a broker's log, uploaded files) lives in a **PersistentVolume** (PV), a piece of storage registered in the cluster. Applications never reference PVs directly; they ask for storage with a **PersistentVolumeClaim** (PVC), and a **StorageClass** tells Kubernetes how to create a matching PV on demand. This concept covers the three objects, the binding lifecycle, the two `Pending` situations you will see (one normal, one broken), and how to verify that data really persists across Pod and node restarts.

## Use Cases

- Giving databases, queues and dashboards a data directory that survives redeploys.
- Understanding a Pod stuck in `Pending` with `pod has unbound immediate PersistentVolumeClaims`.
- Choosing access modes and reclaim policies for a database.
- Proving, before production, that a restart does not wipe data.

## Deep Dive

### The three objects

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: db-data, namespace: shared}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: microk8s-hostpath      # omit to use the default StorageClass
  resources:
    requests:
      storage: 20Gi
```

```yaml
volumes:
  - name: data
    persistentVolumeClaim: {claimName: db-data}
```

- **PVC** (namespaced): "I need 20 GiB, mounted read-write by one node, of class X".
- **StorageClass** (cluster scoped): a provisioner plus parameters, reclaim policy and binding mode.
- **PV** (cluster scoped): the actual volume, created by the provisioner (dynamic provisioning) or by an admin (static). Bound one-to-one to a PVC.

```bash
kubectl get storageclass
kubectl -n shared get pvc
kubectl get pv
```

### Access modes

| Mode | Meaning |
|---|---|
| `ReadWriteOnce` (RWO) | read-write by a single **node** (several Pods on that node can mount it) |
| `ReadWriteOncePod` (RWOP) | read-write by a single **Pod** in the whole cluster |
| `ReadOnlyMany` (ROX) | read-only by many nodes |
| `ReadWriteMany` (RWX) | read-write by many nodes (NFS, CephFS, Longhorn RWX...) |

RWO being per node is a real trap on single-node clusters: two Pods of a database Deployment during a rolling update can both mount the same RWO volume. Use `strategy: Recreate` for single-instance stateful workloads, or `ReadWriteOncePod` where the driver supports it (hostpath-style provisioners generally do not enforce any mode).

### Binding modes and the normal Pending

A StorageClass with `volumeBindingMode: WaitForFirstConsumer` (MicroK8s `microk8s-hostpath`, k3s `local-path`) does not create the PV until a Pod using the PVC is scheduled, so it can place the volume on that Pod's node:

```
$ kubectl get pvc
NAME            STATUS    VOLUME   CAPACITY   STORAGECLASS
db-data         Pending                       microk8s-hostpath
$ kubectl describe pvc db-data
  Normal  WaitForFirstConsumer  waiting for first consumer to be created before binding
```

This is expected. The PVC binds as soon as a Pod uses it.

`Immediate` binding creates the PV right away, wherever the provisioner likes. With node-local storage that can put the volume on a node where the Pod cannot run; `WaitForFirstConsumer` avoids that.

### The broken Pending: no StorageClass

A PVC that names a StorageClass that does not exist, or has no `storageClassName` in a cluster without a default class, is never provisioned. The Pod that uses it cannot be scheduled. Verified on k3s:

```
$ kubectl get pvc nosc
NAME   STATUS    STORAGECLASS
nosc   Pending   missing

$ kubectl describe pod pvcpod
  Warning  FailedScheduling  default-scheduler  0/1 nodes are available:
  pod has unbound immediate PersistentVolumeClaims. not found
```

Checks, in order:

```bash
kubectl get storageclass                              # any at all? which is (default)?
kubectl -n shared get pvc db-data -o jsonpath='{.spec.storageClassName}{"\n"}'
kubectl -n shared describe pvc db-data        # provisioner events
```

On a fresh MicroK8s node the usual cause is simply that `hostpath-storage` was never enabled. Note that `storageClassName` is immutable: a PVC created with the wrong class must be deleted and recreated. And `storageClassName: ""` (empty string) explicitly means "no class, bind only to a pre-created PV", which is different from omitting the field.

### Reclaim policy

When a PVC is deleted, the PV's `persistentVolumeReclaimPolicy` decides what happens to the data:

- `Delete` (default for dynamic provisioning): the PV and the underlying storage are deleted. Verified on MicroK8s: the hostpath directory disappeared seconds after `kubectl delete pvc`.
- `Retain`: the PV becomes `Released` and the data stays. Reusing it requires manual cleanup (remove `spec.claimRef`) and re-binding.

For databases, use a StorageClass with `Retain`, or patch the PV after creation:

```bash
kubectl patch pv <pv-name> -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

Deleting a namespace deletes its PVCs, so with `Delete` a `kubectl delete namespace shared` also deletes the database files. The `kubernetes.io/pvc-protection` finalizer only delays deletion while a Pod still uses the PVC; it does not prevent it.

### Verifying persistence

Do this once per new storage setup, before you trust it:

```bash
# 1. write a marker
kubectl -n shared exec deploy/db -- sh -c 'echo persisted-$(date +%s) > /data/marker'

# 2. Pod restart: delete the Pod, let the Deployment recreate it
kubectl -n shared delete pod -l app=db
kubectl -n shared exec deploy/db -- cat /data/marker

# 3. node restart (single node: planned downtime)
sudo snap restart microk8s          # or reboot the machine
kubectl -n shared exec deploy/db -- cat /data/marker
```

Verified on MicroK8s: a marker written through a hostpath PVC survived both a `snap restart microk8s` and deleting the Pod and mounting the same claim from a new Pod.

The thing to look for is a volume that is **not** actually persistent: a typo in `mountPath` (the app writes to a path that is not the mount), an image `VOLUME` directive that creates an anonymous directory elsewhere, or a data directory configured (or changed by a new image version) to a path outside the mount. Check the image's documented data path whenever you upgrade it. If the marker survives but the application's data does not, the app writes somewhere else.

### Resizing

If the StorageClass has `allowVolumeExpansion: true`, increase `spec.resources.requests.storage` on the PVC and the driver grows the volume (sometimes only after a Pod restart). Shrinking is never supported. `microk8s-hostpath` reports `ALLOWVOLUMEEXPANSION false`, and does not enforce sizes anyway.

## Trade-offs

- **Dynamic vs static provisioning.** Dynamic provisioning needs no admin work per volume; static PVs give full control over where data lives (useful for pre-existing data or specific disks).
- **`Delete` vs `Retain`.** `Delete` keeps storage tidy and makes accidental deletions fatal; `Retain` makes accidents recoverable and leaves cleanup to you.
- **Node-local vs networked storage.** Local disks are fast and simple and tie data to a node; networked storage (Ceph, Longhorn, cloud disks) survives node loss and costs latency and operational complexity.

## Documentation Links

- [Kubernetes docs: Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/): lifecycle, access modes, reclaim policies, expansion.
- [Kubernetes docs: Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/): provisioners, default class, `volumeBindingMode`.
- [Kubernetes docs: Dynamic Volume Provisioning](https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/): how PVCs trigger PV creation.
- [Kubernetes docs: Change the Reclaim Policy of a PersistentVolume](https://kubernetes.io/docs/tasks/administer-cluster/change-pv-reclaim-policy/): patching to `Retain`.
