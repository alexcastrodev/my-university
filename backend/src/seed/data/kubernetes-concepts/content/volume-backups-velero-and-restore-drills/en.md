---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Logical dumps protect a database. They do not protect the rest: a queue's data directory, a dashboard's state, uploaded files, and the Kubernetes objects themselves. Volume-level backups (copying the data under PVCs) and cluster-level backups (Velero) cover those. On MicroK8s there is a trap: its `hostpath-storage` volumes are `hostPath` PVs, which neither CSI snapshots nor Velero's file-system backup support. This concept covers what each approach can and cannot back up on a single node, a pragmatic setup that works, and the part everyone skips: testing the restore and writing down RPO and RTO.

## Use Cases

- Backing up everything a single-node MicroK8s cluster needs to be rebuilt after a disk failure.
- Choosing between node-level directory backups, Velero and CSI snapshots.
- Moving workloads and their data to a new node.
- Proving, with a timed drill, how much data you would lose and how long recovery takes.

## Deep Dive

### What there is to back up

1. **Kubernetes objects**: manifests and Kustomize overlays in Git are the source of truth. If everything is applied from Git, the objects are already backed up, except Secrets you created by hand.
2. **Secrets and configuration not in Git**: `kubectl create secret` from local `.env` files. Keep the source files in a password manager or encrypted in Git (SOPS, Sealed Secrets), or export them.
3. **Volume data**: PVC contents.
4. **The cluster's own state**: MicroK8s' dqlite datastore and certificates, if you want to restore the cluster itself rather than rebuild it.

For a small, reproducible setup, rebuilding the cluster from Git plus restoring volume data is usually faster and more reliable than restoring the control plane.

### Option 1: back up the hostpath directories from the node

MicroK8s stores every hostpath PVC under one directory:

```
/var/snap/microk8s/common/default-storage/<namespace>-<pvc>-<pv>/
```

That makes a node-level backup easy: `restic`, `borg`, or `rsync` to another machine, run by systemd timer or cron on the node.

```bash
restic -r sftp:backup@backup-host:/srv/restic/k8s-node1 backup \
  /var/snap/microk8s/common/default-storage \
  --exclude '*/cache-*'              # example of skipping rebuildable data
```

The catch is **consistency**: copying a running database's data directory produces a torn copy. Either:

- scale the workload to zero for the duration (`kubectl scale deploy/db --replicas=0`), back up, scale back; or
- rely on the application's own consistent backup tool for databases (a logical dump taken with `kubectl exec`) and use directory backups for things that tolerate it (dashboards, uploaded files); or
- use filesystem snapshots underneath (LVM or ZFS snapshot of the disk holding `default-storage`), then back up the snapshot. Most databases recover from a crash-consistent snapshot like from a power loss.

Map directories back to workloads with:

```bash
kubectl get pv -o custom-columns=PV:.metadata.name,CLAIM:.spec.claimRef.namespace,PVC:.spec.claimRef.name,PATH:.spec.hostPath.path
```

### Option 2: Velero

Velero backs up Kubernetes objects (as JSON, to object storage) and volume data, and restores them into the same or another cluster, optionally remapping namespaces.

```bash
velero install --provider aws --plugins velero/velero-plugin-for-aws:<version matching your Velero> \
  --bucket k8s-backups --backup-location-config region=eu-west-1,s3Url=https://s3.example.com \
  --use-node-agent --default-volumes-to-fs-backup
velero backup create nightly-$(date +%F) --include-namespaces shared,team-a
velero restore create --from-backup nightly-2026-09-26
```

Volume data goes through one of two paths:

- **CSI snapshots**: needs a CSI driver with snapshot support and `VolumeSnapshotClass`. MicroK8s hostpath has no CSI driver, so no snapshots.
- **File-system backup (FSB)** with the node agent (Kopia by default): reads files from the mounted volume of a running Pod. The Velero documentation is explicit: **"hostPath volumes are not supported"**, and MicroK8s hostpath PVs are `hostPath: {path: ..., type: DirectoryOrCreate}` (verified). Local PVs (`local:` type) are supported.

So on MicroK8s with `hostpath-storage`, Velero backs up your objects well and silently skips the data. It becomes the right tool once volumes come from a CSI driver (OpenEBS LocalPV via CSI, Longhorn, Ceph, a cloud disk).

### Option 3: CSI VolumeSnapshots

With a snapshot-capable CSI driver:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata: {name: db-data-2026-09-26, namespace: shared}
spec:
  volumeSnapshotClassName: csi-snapclass
  source: {persistentVolumeClaimName: db-data}
```

A snapshot is fast and crash-consistent, and a new PVC can be created from it (`dataSource`). It usually lives on the same storage system, so it protects against mistakes, not against losing that storage. Pair it with copying off the system (Velero's data mover does that).

### RPO, RTO and the restore drill

- **RPO** (recovery point objective): how much data you can lose. Nightly dumps mean up to 24 hours.
- **RTO** (recovery time objective): how long until the service is back. Includes getting a machine, installing MicroK8s, applying manifests, restoring data, verifying.

Nobody knows their RTO until they have restored once. A drill on a throwaway VM:

```bash
# 1. fresh node
sudo snap install microk8s --classic --channel=1.35/stable
microk8s enable dns hostpath-storage rbac
# 2. platform from Git
kubectl apply -k overlays/production
# 3. data
kubectl -n shared scale deploy/db --replicas=0
#    restore the directories, or load the database dump
# 4. verify: row counts, a login, the application smoke tests
```

Time every step, write the numbers into the runbook, and repeat after big changes. The things drills typically find: a Secret nobody had outside the cluster, a manual step not in the bootstrap script, an image that only existed in a registry on the lost node, dumps that restore with errors.

## Trade-offs

- **Node-level directory backups vs Velero.** Directory backups work with hostPath storage and are simple, but need workload quiescing for consistency and know nothing about Kubernetes objects. Velero understands namespaces and objects and cannot read hostPath volumes.
- **Rebuild from Git vs restore the control plane.** Rebuilding is reproducible and tests your bootstrap path; restoring dqlite is faster only if the bootstrap is not automated, and harder to verify.
- **Snapshots vs copies.** Snapshots are instant and local; copies to another system are slower and survive the loss of the original storage. You need copies; snapshots are an optimisation.

## Documentation Links

- [Velero docs: File System Backup](https://velero.io/docs/main/file-system-backup/): how FSB works and its limitations (hostPath).
- [Velero docs: Container Storage Interface Snapshot Support](https://velero.io/docs/main/csi/): CSI snapshots and the data mover.
- [Kubernetes docs: Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/): VolumeSnapshot API.
- [MicroK8s: Hostpath storage](https://canonical.com/microk8s/docs/addon-hostpath-storage): where volume data lives.
- [restic documentation](https://restic.readthedocs.io/en/stable/): encrypted, deduplicated backups of directories.
