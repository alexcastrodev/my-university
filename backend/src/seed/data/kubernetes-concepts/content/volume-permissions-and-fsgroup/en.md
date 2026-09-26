---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Many images run as a non-root user, and hardened clusters force it. When such a container mounts a freshly provisioned PersistentVolume, the volume's root directory is often owned by root with mode `0755`, and the first write fails with `Permission denied`. The Kubernetes answer is the Pod `securityContext`: `runAsUser`, `runAsGroup` and above all **`fsGroup`**, which makes the kubelet give the volume to a group the container belongs to. Whether you need it depends on the storage backend, which is why a manifest that works on one cluster fails on another. This concept covers how `fsGroup` works, when it applies, and what to do when it does not.

## Use Cases

- A Pod in `CrashLoopBackOff` with `Permission denied` on its data directory right after getting a PVC.
- Running stateful workloads with `runAsNonRoot` under a `restricted` Pod Security policy.
- Slow Pod starts on large volumes because of recursive ownership changes.
- Moving manifests from a lab (hostpath storage) to real block storage.

## Deep Dive

### Who is the container?

```bash
kubectl exec <pod> -- id
# uid=1000 gid=1000 groups=1000
docker image inspect <image> --format '{{.Config.User}}'
```

The image's `USER` decides the default; `securityContext.runAsUser`/`runAsGroup` override it. Numeric IDs matter, not names: the node and the volume only see numbers.

### fsGroup

```yaml
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    fsGroupChangePolicy: OnRootMismatch
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
      volumeMounts: [{name: data, mountPath: /data}]
  volumes:
    - name: data
      persistentVolumeClaim: {claimName: app-data}
```

For volume types that support ownership management, the kubelet, before starting the containers:

1. changes the group of the volume's files to `fsGroup` (recursively),
2. adds group read/write permissions and the setgid bit on directories, so new files inherit the group,
3. adds `fsGroup` to the supplementary groups of every container process.

The process can now write, as a group member, no matter which UID owns the directory. Verified on k3s: with `fsGroup: 10001` and `runAsUser: 10001`, a file created in an `emptyDir` shows owner `10001` and group `10001`, and `id` lists `10001` among the groups.

### When fsGroup does nothing

Ownership management depends on the volume plugin:

- **Applies**: block-backed volumes (cloud disks, Longhorn, Ceph RBD, local volumes, CSI drivers that declare `fsGroupPolicy: File`), `emptyDir`, `configMap`/`secret`/`projected` (group applied to the files).
- **Does not apply**: `hostPath`, and CSI drivers with `fsGroupPolicy: None`. NFS depends on the driver and the server (root squashing often prevents it).

MicroK8s `hostpath-storage` provisions `hostPath` PersistentVolumes. Verified on MicroK8s 1.35 with a `busybox` Pod running as UID 1000:

```
uid=1000 gid=1000 groups=1000
drwxrwxrwx    2 root     root          4096 /data
WRITE_OK
```

The provisioned directory has mode `0777`, so the write works with or without `fsGroup`, and with `fsGroup: 1000` the directory stays `root:root`. It "just works" because the directory is world-writable, not because of `fsGroup`. k3s's `local-path` provisioner behaves the same way.

That is how the classic surprise happens: a manifest works for months on a hostpath-style provisioner, then moves to a cluster with real block storage where the new ext4 volume's root is `root:root 0755` (plus a `lost+found` directory), and the application fails at startup. Setting `fsGroup` from day one makes the manifest portable.

### Slow starts: fsGroupChangePolicy

The recursive `chown`/`chmod` runs on every mount. On a volume with millions of files it can delay container start by minutes, long enough to hit startup probe limits.

```yaml
securityContext:
  fsGroup: 1000
  fsGroupChangePolicy: OnRootMismatch   # skip the walk if the root dir already has the right group and mode
```

`OnRootMismatch` checks only the top-level directory; `Always` (the default) walks everything every time.

### When the software expects to own the directory

Some software checks ownership rather than permissions and refuses a data directory it does not own, or one with group permissions. Images for such software often start as root, `chown` the directory, and drop to an unprivileged user in their entrypoint. That needs the container to start as root, which conflicts with `runAsNonRoot`.

Options for software like that:

- Keep the image's root entrypoint and harden elsewhere (capabilities, seccomp, NetworkPolicies).
- Run as the target user and point the data directory at a **subdirectory** the process creates itself (for example `/data/app`), so the mount root's ownership does not matter as long as it is writable, which `fsGroup` guarantees.
- An `initContainer` running as root that `chown`s the volume once. It works, and it is exactly what `restricted` Pod Security forbids, so prefer the options above.

### Diagnosing

```bash
kubectl logs <pod> --previous | grep -iE 'permission|denied|read-only'
kubectl exec <pod> -- sh -c 'id; ls -ldn /data'
kubectl get pv <pv> -o jsonpath='{.spec.csi.driver}{.spec.hostPath.path}{"\n"}'   # which backend?
```

Compare the process's UID and groups with the directory's numeric owner, group and mode. If the Pod crashes too quickly to exec into, temporarily override the command with `sleep 3600` to inspect.

## Trade-offs

- **fsGroup vs world-writable storage.** `fsGroup` grants access to exactly one group and works on real block storage; relying on `0777` directories works only on hostpath-style provisioners and grants write access to everyone on the node.
- **`Always` vs `OnRootMismatch`.** `Always` repairs ownership drift inside the volume on every start; `OnRootMismatch` starts much faster on large volumes and trusts that nothing changed ownership underneath.
- **Root entrypoints vs non-root everywhere.** Letting images that need it start as root is pragmatic; strict non-root requires image-specific configuration but passes `restricted` Pod Security.

## Documentation Links

- [Kubernetes docs: Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): `runAsUser`, `fsGroup`, `fsGroupChangePolicy`.
- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): which volume types support ownership management.
- [Kubernetes CSI docs: Support for fsGroup](https://kubernetes-csi.github.io/docs/support-fsgroup.html): `fsGroupPolicy` values for CSI drivers.
- [MicroK8s: Hostpath storage](https://canonical.com/microk8s/docs/addon-hostpath-storage): how hostpath volumes are provisioned.
