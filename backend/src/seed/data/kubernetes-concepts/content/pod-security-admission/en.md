---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Pod Security Standards define three security profiles for Pods: **privileged** (no restrictions), **baseline** (blocks known privilege escalations such as host namespaces, privileged containers and hostPath) and **restricted** (current hardening best practice: non-root, no privilege escalation, all capabilities dropped, a seccomp profile). **Pod Security Admission**, built into the API server, enforces them per namespace through labels. It replaced PodSecurityPolicy, removed in Kubernetes 1.25. This concept covers the three levels, the three modes (`enforce`, `warn`, `audit`), what a rejection looks like, the surprise of Deployments that are accepted while their Pods are not, and a safe rollout path.

## Use Cases

- Preventing anyone from running privileged containers or mounting the node's filesystem in application namespaces.
- Requiring non-root, hardened Pods in production namespaces.
- Finding out which existing workloads would break before enforcing a stricter level.
- Allowing the few system components that need privileges to keep working.

## Deep Dive

### Levels and modes

Labels on the Namespace choose a level per mode:

```bash
kubectl label namespace team-a \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

| Mode | Effect on a violating Pod |
|---|---|
| `enforce` | rejected by the API server |
| `warn` | accepted, with a warning returned to the client (`kubectl` prints it) |
| `audit` | accepted, violation recorded in the API server audit log |

`-version` pins the rules to a Kubernetes version (`v1.35`) or `latest`. Pinning avoids surprises when an upgrade tightens a level.

### What a rejection looks like

Verified on k3s v1.36 in a namespace with `enforce=restricted`:

```
$ kubectl -n psa run naive --image=nginx:1.29-alpine
Error from server (Forbidden): pods "naive" is forbidden: violates PodSecurity "restricted:latest":
allowPrivilegeEscalation != false (container "naive" must set securityContext.allowPrivilegeEscalation=false),
unrestricted capabilities (container "naive" must set securityContext.capabilities.drop=["ALL"]),
runAsNonRoot != true (pod or container "naive" must set securityContext.runAsNonRoot=true),
seccompProfile (pod or container "naive" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

The message is a checklist. A Pod that satisfies it:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    seccompProfile: {type: RuntimeDefault}
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
      securityContext:
        allowPrivilegeEscalation: false
        capabilities: {drop: [ALL]}
```

Verified: the equivalent Pod (with `busybox`) was admitted and ran as UID 10001.

### The Deployment trap

Admission checks **Pods**, not their controllers. Applying a Deployment in an enforced namespace succeeds, with only a warning:

```
$ kubectl -n psa create deployment d --image=nginx:1.29-alpine
Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false ...
deployment.apps/d created

$ kubectl -n psa get deploy d
NAME   READY   UP-TO-DATE   AVAILABLE
d      0/1     0            0
```

The ReplicaSet cannot create any Pod, and the reason is only in its events:

```
Error creating: pods "d-58d65dcd6-6x5dp" is forbidden: violates PodSecurity "restricted:latest": ...
```

A pipeline that checks only the exit code of `kubectl apply` reports success. This is one more reason to always run `kubectl rollout status` after applying.

### warn and audit first

Enforcing directly on a namespace with running workloads is risky. The safe path:

1. Label with `warn` and `audit` for the target level; keep `enforce` at the current level. Verified: in a namespace with `enforce=baseline, warn=restricted`, creating a non-compliant Pod printed `Warning: would violate PodSecurity "restricted:latest"` and still created it.
2. Check existing workloads without changing anything:

```bash
kubectl label --dry-run=server --overwrite namespace team-a \
  pod-security.kubernetes.io/enforce=restricted
```

Verified on k3s against a namespace full of test Pods:

```
Warning: existing pods in namespace "lab" violate the new PodSecurity enforce level "restricted:latest"
Warning: badimg (and 18 other pods): allowPrivilegeEscalation != false, unrestricted capabilities, runAsNonRoot != true, seccompProfile
Warning: nonroot-on-root-image: allowPrivilegeEscalation != false, unrestricted capabilities, seccompProfile
namespace/lab labeled (server dry run)
```

Nothing was changed; the warnings are the to-do list.

3. Fix the manifests (securityContext, non-root images), redeploy, repeat the dry run until it is clean.
4. Switch `enforce`. Existing Pods are not evicted; the level applies when Pods are created or recreated.

### Which level where

- **`restricted`**: application namespaces. Most stateless applications comply with a securityContext block and a non-root image.
- **`baseline`**: namespaces with software that needs some root behaviour (images that `chown` at startup, some databases); still blocks the dangerous things.
- **`privileged`**: system namespaces for CNI, storage drivers, node agents (log and metrics collectors that read host paths), ingress controllers using `hostPort`.

Cluster-wide defaults and exemptions (namespaces, users, runtime classes) can be set with an `AdmissionConfiguration` file given to the API server. On MicroK8s that file already exists at `/var/snap/microk8s/current/args/admission-control-config-file.yaml` (verified on 1.35 it only configures the `EventRateLimit` plugin); add a `PodSecurity` plugin entry there to set cluster defaults. Namespace labels still override the default per namespace.

### Beyond Pod Security Admission

PSA covers the Pod spec only, with fixed levels. Policy engines like **Kyverno** or **OPA Gatekeeper** (or the built-in `ValidatingAdmissionPolicy` with CEL expressions) add custom rules: required labels, allowed registries, mandatory resource limits, `items` on projected secret sources.

## Trade-offs

- **`restricted` vs `baseline`.** Restricted blocks more attack paths and requires every image to run as non-root; baseline is compatible with almost everything and leaves root containers allowed.
- **Enforce immediately vs warn first.** Enforcing at once protects immediately and may break the next deployment of an existing workload; warn and audit first give you a list to fix without downtime.
- **PSA vs a policy engine.** PSA is built in, fast and zero-maintenance, with fixed rules; Kyverno or Gatekeeper are flexible and are one more critical component in the admission path.

## Lab

In this lab you receive an unprotected `prod` namespace and a Deployment that runs as root. Your job is to make the namespace enforce the `restricted` security standard and then get the Deployment running in it. The core idea is to feel that Pod Security Admission validates Pods, not Deployments: the Deployment's `kubectl apply` keeps working, but the ReplicaSet is silently rejected, and the reason only shows up in the events.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers), whose built-in Pod Security Admission controller checks every Pod, receives your manifests in this order.

- `src/main/resources/k8s/namespace.yaml`: the `prod` namespace, which you need to label.
- `src/test/resources/k8s/root-pod.yaml`: given, a Pod with no `securityContext`, meaning root with default capabilities. The test tries to create it and it must be rejected.
- `src/main/resources/k8s/web.yaml`: a `web` Deployment (busybox serving `ok` on port 8080) in `prod`.
- `src/test/java/PodSecurityTest.java`: checks the namespace labels, the rejection of the root Pod and that `web` has an available Pod, running as a user other than 0 and answering on 8080.

You edit `namespace.yaml` and `web.yaml`.

**What you will do, step by step**

1. **Run the tests first.** Everything runs as root and nothing is rejected.
2. **Label the namespace (TODO-00).** On `prod`, add the `pod-security.kubernetes.io/*` labels to enforce the `restricted` level, pinning the version to `latest`, and also turn on `warn` and `audit` at the same level.
3. **Run again and read the event (TODO-01).** The Deployment's `kubectl apply` still succeeds, but the rollout never completes. Read the `FailedCreate` event the failure message shows: it lists each requirement the Pod violates.
4. **Add each requested setting (TODO-01).** In `web.yaml`, adjust the `securityContext` as the message asks, one item at a time. The app can run as any user (use 1000) and listens on 8080, so it needs no privileges.

**How you know you are done**

`mvn -pl kubernetes-concepts/pod-security-admission test` passes: `prod` enforces `restricted` (and warns and audits at it), the root Pod is rejected by the API server and `web` runs as non-root answering `ok`. You should be able to explain why the error showed up on the ReplicaSet and not in `kubectl apply`.

**Optional challenges**

- **TODO-02:** label the namespace with `enforce: baseline` and `warn: restricted`. Apply the original Deployment by hand: what does `kubectl apply` print, and does the Pod start? When is this combination useful?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container and pull `busybox` inside it) and the article "Pod Security Standards and Admission".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/pod-security-admission test`. The `TODO-00` comment in `namespace.yaml` and `TODO-01` in `web.yaml` mark what to change.

## Documentation Links

- [Kubernetes docs: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): exact controls per level.
- [Kubernetes docs: Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/): modes, labels, exemptions.
- [Kubernetes docs: Enforce Pod Security Standards with Namespace Labels](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/): step by step, including the dry run.
- [Kubernetes docs: Migrate from PodSecurityPolicy](https://kubernetes.io/docs/tasks/configure-pod-container/migrate-from-psp/): for older clusters and guides.
