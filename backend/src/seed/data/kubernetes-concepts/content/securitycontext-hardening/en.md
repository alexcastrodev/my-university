---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A container is a Linux process with a restricted view of the system, and by default the restrictions are looser than most applications need: it may run as root, gain privileges through setuid binaries, keep a dozen Linux capabilities, write anywhere in its filesystem, and call almost any syscall. The `securityContext` fields remove each of those, so that a compromised application can do as little as possible. This concept goes through the fields that matter (`runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities: drop: [ALL]`, `seccompProfile`, `readOnlyRootFilesystem`), shows how to verify they are in effect, and what typically breaks when you apply them.

## Use Cases

- Meeting the `restricted` Pod Security level for application namespaces.
- Limiting the damage of a remote code execution in a web application.
- Making container filesystems immutable so malware cannot drop files.
- Running an off-the-shelf image such as nginx without root.

## Deep Dive

### The hardened baseline

```yaml
spec:
  securityContext:                       # Pod level: applies to all containers
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile: {type: RuntimeDefault}
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
      securityContext:                   # container level: overrides Pod level where both exist
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
      volumeMounts:
        - {name: tmp, mountPath: /tmp}   # writable scratch space
  volumes:
    - name: tmp
      emptyDir: {}
  automountServiceAccountToken: false
```

What each field does:

| Field | Effect |
|---|---|
| `runAsNonRoot: true` | the kubelet refuses to start a container that would run as UID 0 |
| `runAsUser` / `runAsGroup` | the numeric identity of the process, regardless of the image's `USER` |
| `allowPrivilegeEscalation: false` | sets `no_new_privs`: setuid binaries (`sudo`, `su`, `ping` on some images) cannot raise privileges |
| `capabilities.drop: [ALL]` | removes all Linux capabilities (the runtime default set includes `CHOWN`, `SETUID`, `NET_BIND_SERVICE`, `NET_RAW`...) |
| `seccompProfile: RuntimeDefault` | the runtime's syscall filter blocks dangerous syscalls (kernel module loading, `ptrace` of other processes, raw mounts) |
| `readOnlyRootFilesystem: true` | the image's filesystem is mounted read-only; only volumes are writable |

### Verifying it is in effect

From inside the container, the kernel tells the truth. Verified on k3s with a hardened `nginx-unprivileged` Pod:

```
$ kubectl exec nginx-unpriv -- sh -c 'id; grep -E "^(CapEff|NoNewPrivs|Seccomp):" /proc/1/status'
uid=101(nginx) gid=101(nginx) groups=101(nginx)
CapEff:	0000000000000000        # no capabilities
NoNewPrivs:	1                   # allowPrivilegeEscalation: false
Seccomp:	2                   # filter mode active
```

And for the read-only filesystem (another verified Pod):

```
$ touch /x
touch: /x: Read-only file system
```

### What breaks, and how to fix it

**The image runs as root.** With `runAsNonRoot: true` and no `runAsUser`, a root image is refused:

```
CreateContainerConfigError
container has runAsNonRoot and image will run as root (pod: "nonroot-on-root-image_lab(...)", container: c)
```

(verified). Set `runAsUser` to a non-zero UID if the software works as any user, or use an image built with a non-root `USER`.

**The software writes to its own filesystem.** Verified with the standard `nginx:1.29-alpine` image forced to UID 101 and a read-only root:

```
nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system)
```

The container went into `Error`/`CrashLoopBackOff`. Two fixes: mount an `emptyDir` on each directory the software writes to (`/var/cache/nginx`, `/var/run`, `/tmp`), or use an image designed for it. `nginxinc/nginx-unprivileged` runs as UID 101, listens on 8080 and writes only to `/tmp`; with an `emptyDir` on `/tmp` and the full hardened securityContext, it ran and served its welcome page (verified above).

**Ports below 1024.** Without `NET_BIND_SERVICE` (dropped with `ALL`), a non-root process cannot bind port 80. Listen on 8080 inside the container and map it in the Service (`port: 80, targetPort: 8080`). If you really must, add back only that one capability:

```yaml
capabilities:
  drop: [ALL]
  add: [NET_BIND_SERVICE]
```

**Tools that need `ping` or raw sockets** lose `NET_RAW`. That is intended for application containers; debug with `kubectl debug` and a separate image instead.

**Volumes not writable by the UID.** Use `fsGroup` (see the volume permissions concept).

### Beyond the basics

- **`privileged: false`** is the default; never set it to true for applications (it disables almost every isolation).
- **`hostNetwork`, `hostPID`, `hostIPC`, `hostPath`** break isolation from the node; blocked by the `baseline` level.
- **AppArmor/SELinux** profiles add mandatory access control on top (`appArmorProfile`, `seLinuxOptions`); Ubuntu nodes (including MicroK8s) have AppArmor enabled.
- **User namespaces** (`hostUsers: false`) map root inside the container to an unprivileged UID on the node, a strong mitigation on recent kernels and Kubernetes versions.
- **Minimal images** (distroless, scratch) remove the shell and package manager an attacker would use.

## Trade-offs

- **Hardened by default vs compatibility.** A strict securityContext breaks images that assume root or a writable filesystem; each fix (an emptyDir, a different image, a UID) is small and must be done per workload.
- **Read-only root filesystem vs convenience.** Immutable containers stop an attacker from persisting files and force you to declare every writable path; apps that write caches in unexpected places fail on first run.
- **Pod-level vs container-level settings.** Pod-level fields keep manifests short; container-level settings are needed when sidecars have different requirements.

## Documentation Links

- [Kubernetes docs: Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): every field with examples.
- [Kubernetes docs: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): which fields each level requires.
- [Kubernetes docs: Restrict a Container's Syscalls with seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/): RuntimeDefault and custom profiles.
- [Kubernetes docs: Use a User Namespace With a Pod](https://kubernetes.io/docs/tasks/configure-pod-container/user-namespaces/): `hostUsers: false`.
- [nginx-unprivileged image](https://hub.docker.com/r/nginxinc/nginx-unprivileged): nginx built to run as non-root.
