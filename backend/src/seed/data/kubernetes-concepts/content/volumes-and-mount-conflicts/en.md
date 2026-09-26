---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A container's filesystem comes from its image and disappears with the container. **Volumes** add directories with a different lifecycle and source: scratch space shared by containers (`emptyDir`), configuration and credentials from the API (`configMap`, `secret`, `projected`), or durable storage (`persistentVolumeClaim`). Each volume is declared once in the Pod and mounted into containers with `volumeMounts`. Most volume bugs are mount bugs: a mount that hides the image's own files, a file mounted with `subPath` that never updates, or two mounts that collide and stop the container from starting. This concept covers the common volume types and those collisions, including a verified `StartError`.

## Use Cases

- A temp or cache directory for an app running with a read-only root filesystem.
- Mounting a whole `application.yaml` or `nginx.conf` from a ConfigMap.
- Combining several Secrets and ConfigMaps in one directory.
- Diagnosing `StartError`/`RunContainerError` with `read-only file system` in the message.

## Deep Dive

### Declaring and mounting

```yaml
spec:
  containers:
    - name: app
      volumeMounts:
        - {name: tmp,     mountPath: /tmp}
        - {name: config,  mountPath: /etc/app, readOnly: true}
        - {name: secrets, mountPath: /etc/secrets, readOnly: true}
  volumes:
    - name: tmp
      emptyDir: {}
    - name: config
      configMap: {name: app-config}
    - name: secrets
      projected:
        sources:
          - secret: {name: db-credentials}
          - secret: {name: api-keys}
```

### The volume types you will use daily

**`emptyDir`**: created empty when the Pod starts, deleted when the Pod is deleted (it survives container restarts). Shared by all containers in the Pod. Backed by node disk by default, counted as ephemeral storage. With `medium: Memory` it is a tmpfs, and its content counts toward the container's **memory** limit. Verified: an `emptyDir` with `medium: Memory, sizeLimit: 64Mi` is mounted as a 64 MiB tmpfs, and writing 80 MiB fails with `No space left on device` rather than growing silently.

**`configMap` / `secret`**: every key becomes a file (use `items` to pick keys and rename them). Mounted read-only, updated in place by the kubelet about a minute after the object changes (not with `subPath`, see below). Secret volumes are always tmpfs.

**`projected`**: merges several `secret`, `configMap`, `downwardAPI` and `serviceAccountToken` sources into one directory. Keys with the same name collide silently, last source wins; the Secrets section has a full concept on it.

**`persistentVolumeClaim`**: durable storage that outlives Pods, covered in the PersistentVolumes concept.

**`hostPath`**: a directory of the node. Powerful and dangerous (a Pod can read node files), blocked by the `baseline` Pod Security level. Avoid in application manifests; storage provisioners use it internally.

### Conflict 1: a mount hides what the image had

A volume mounted on a directory replaces its entire content for that container. Verified with `nginx` and a ConfigMap containing only `application.yaml` mounted at `/etc/nginx`:

```
$ ls /etc/nginx
application.yaml
$ ls /etc/nginx/conf.d
ls: /etc/nginx/conf.d: No such file or directory
```

The image's `nginx.conf`, `conf.d`, `mime.types` are all gone. The same mistake with `/app` hides the application binary, with `/etc/ssl` hides the image's CA bundle. Mount into a dedicated directory, or mount a single file with `subPath`.

### Conflict 2: subPath works once and never updates

`subPath` mounts one entry of a volume at an exact path, leaving the rest of the directory intact:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/nginx/application.yaml
    subPath: application.yaml
```

Verified: `/etc/nginx` keeps `conf.d`, `fastcgi.conf` and the rest, and `application.yaml` is added. The price: **subPath mounts are a snapshot**. When the ConfigMap or Secret changes, full-directory mounts are updated, subPath mounts never are, until the Pod is recreated. For secrets that rotate, this is a silent bug.

### Conflict 3: identical mountPath

Two mounts on the same path are rejected before the Pod exists:

```
The Pod "dupmount" is invalid: spec.containers[0].volumeMounts[1].mountPath:
Invalid value: "/cfg": must be unique
```

That one is easy. The next one is not.

### Conflict 4: nested mounts inside a read-only volume

A mount **inside** another mount works when the runtime can create the mount point directory. With a read-only parent volume it cannot. The common real case is the ServiceAccount token, which Kubernetes mounts at `/var/run/secrets/kubernetes.io/serviceaccount`, combined with a Secret mounted read-only at `/run/secrets` in an image where `/var/run` is a symlink to `/run` (all Debian and Ubuntu based images, which includes many official language runtime images).

Verified on k3s v1.36 with `ubuntu:24.04`:

```
NAME             READY   STATUS              RESTARTS
overlap-ubuntu   0/1     RunContainerError   2

lastState.terminated.reason: StartError
message: ... error mounting ".../kube-api-access-2z2l6" to rootfs at
"/var/run/secrets/kubernetes.io/serviceaccount": create mountpoint ... mkdirat
.../rootfs/run/secrets/kubernetes.io: read-only file system
```

Exit code 128, the container never ran, and `kubectl logs` is empty because there is no process. The same manifest with `busybox` starts fine (no symlink there), which is why it passes a quick test and fails with the real application image.

Fixes: mount the Secret elsewhere (`/etc/secrets`, `/run/secrets/app`), or set `automountServiceAccountToken: false` if the app does not call the Kubernetes API (verified: the Pod then starts), or declare the token yourself in a `projected` volume at a path of your choosing.

The general rule: when a container fails with `StartError` and a message about `mkdirat`, `mountpoint` or `read-only file system`, list every `mountPath` (including the ones Kubernetes injects, visible in `kubectl get pod -o yaml`) and look for one nested inside another.

### Inspecting mounts

```bash
kubectl get pod <pod> -o jsonpath='{range .spec.containers[*].volumeMounts[*]}{.mountPath}{"\t"}{.name}{"\t"}{.readOnly}{"\n"}{end}'
kubectl exec <pod> -- mount | grep -E 'secrets|config'
kubectl describe pod <pod>     # Mounts: and Volumes: sections
```

## Trade-offs

- **Directory mounts vs subPath.** Directory mounts update in place and hide the target directory; subPath preserves the directory and freezes the content.
- **emptyDir on disk vs in memory.** Disk is cheap and slower; memory is fast and competes with the application for its memory limit.
- **Automounted ServiceAccount token vs none.** Leaving it on is harmless for most apps but occupies `/var/run/secrets`, grants API credentials to the container, and causes the nested-mount failure above. Turning it off by default is a reasonable hardening step.

## Documentation Links

- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): every volume type, `subPath`, `readOnly`.
- [Kubernetes docs: Ephemeral Volumes](https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/): `emptyDir`, sizing, memory medium.
- [Kubernetes docs: Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/): combined sources and the ServiceAccount token source.
- [Kubernetes docs: ConfigMaps (mounted ConfigMaps are updated automatically)](https://kubernetes.io/docs/concepts/configuration/configmap/#mounted-configmaps-are-updated-automatically): update behaviour and the subPath exception.
