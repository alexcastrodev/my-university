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

## Lab

In this lab you receive an nginx Deployment that serves the welcome page, but as root, with the default capabilities and a writable filesystem. Your job is to harden the container with `securityContext` and then solve the problem that causes, without weakening any of the settings. The core idea is to feel that every security restriction has a cost, and that the official nginx image was built assuming it can be root and write to disk.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers) receives your `web.yaml` and a ready-made `client` Pod.

- `src/main/resources/k8s/web.yaml`: the only file you edit. It has the `web` Deployment (`nginx:1.29-alpine`, port `http` 80, readiness probe on `/`) and the `web` Service on port 80.
- `src/test/resources/k8s/client.yaml`: the `client` Pod (busybox) from which the test requests `http://web`.
- `src/test/java/SecurityContextTest.java`: reads `/proc/1/status` inside the container and checks the result.

The test requires the container to be unable to write to its root filesystem, its main process to have `CapEff: 0000000000000000`, `NoNewPrivs: 1` and `Seccomp: 2`, not to run as UID 0 and `http://web` to still return the nginx page.

**What you will do, step by step**

1. **Run the tests first.** nginx serves the page, but as root, with default capabilities and a writable disk, so the security checks fail.
2. **Harden the container (TODO-00).** Add the `securityContext` at both levels: at the Pod level, a non-root user and the runtime's default seccomp profile, and at the container level, a read-only root filesystem, no privilege escalation and no capabilities at all. Each value maps to a line of `/proc/1/status` that the test reads.
3. **Make nginx work like that (TODO-01).** Now it crashes on start, and the failure message shows its last log lines. Solve it one of two ways: give nginx writable directories (`emptyDir` volumes at the paths it writes to) or switch to an image built to run unprivileged. Remember that an unprivileged nginx cannot listen on port 80, so the Service must keep answering on 80. Either way you may not loosen what you did in the previous step.

**How you know you are done**

`mvn -pl kubernetes-concepts/securitycontext-hardening test` passes. You should be able to explain what each line of `/proc/1/status` proves and why nginx needed help to run under these restrictions.

**Optional challenges**

- **TODO-02:** solve TODO-01 the other way too. If you switched images, go back to `nginx:1.29-alpine` and find every directory it needs to write to; if you kept the official image, try `nginxinc/nginx-unprivileged`. Which solution would you rather maintain?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container and pull `nginx` and `busybox` inside it) and the article "securityContext Hardening".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/securitycontext-hardening test`. The `TODO-00` and `TODO-01` comments in `web.yaml` mark what to do.

## Documentation Links

- [Kubernetes docs: Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): every field with examples.
- [Kubernetes docs: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): which fields each level requires.
- [Kubernetes docs: Restrict a Container's Syscalls with seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/): RuntimeDefault and custom profiles.
- [Kubernetes docs: Use a User Namespace With a Pod](https://kubernetes.io/docs/tasks/configure-pod-container/user-namespaces/): `hostUsers: false`.
- [nginx-unprivileged image](https://hub.docker.com/r/nginxinc/nginx-unprivileged): nginx built to run as non-root.
