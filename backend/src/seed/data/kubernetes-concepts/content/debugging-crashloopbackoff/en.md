---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

`CrashLoopBackOff` means one thing: the container started, exited, and the kubelet is waiting before starting it again. It says nothing about why. The why is almost always in three places: the **logs of the previous attempt**, the **exit code and reason** of the last termination, and the **events**. This concept is a repeatable procedure to find it, including the cases where the logs are empty because the process never really ran, or the container dies too fast to inspect.

## Use Cases

- A new version that restarts every few seconds after a deploy.
- A container that crashes only in the cluster, not locally.
- A Pod whose logs are empty while it keeps restarting.
- Inspecting the filesystem and environment of a container that will not stay up.

## Deep Dive

### Step 1: read the state, not just the status

```bash
kubectl -n team-a get pod web-xyz
kubectl -n team-a describe pod web-xyz
```

In `describe`, the container section shows the key facts:

```
State:          Waiting
  Reason:       CrashLoopBackOff
Last State:     Terminated
  Reason:       Error
  Exit Code:    1
  Started:      ...
  Finished:     ...
Restart Count:  4
```

The **exit code** routes the investigation:

| Last State | Meaning | Next step |
|---|---|---|
| `Error`, exit 1 (or any app code) | the application decided to exit | logs of the previous attempt |
| `OOMKilled`, exit 137 | memory limit exceeded | limits vs real usage |
| exit 137 without OOMKilled | killed by liveness probe or after grace period | events: `Killing ... failed liveness probe` |
| `StartError`/`RunContainerError`, exit 128 | the runtime could not start the process | `lastState.terminated.message` |
| exit 126 / 127 | entrypoint not executable / not found | image `ENTRYPOINT`/`CMD`, `command` in the spec |
| `Completed`, exit 0 | the process finished successfully, but a Deployment expects it to run forever | wrong command, or it belongs in a Job |

### Step 2: logs of the previous attempt

The current container is usually either waiting (no logs) or just restarted (few lines). The crash is in the **previous** one:

```bash
kubectl -n team-a logs web-xyz --previous
kubectl -n team-a logs web-xyz --previous -c app      # multi-container Pods
kubectl -n team-a logs deploy/web --previous          # any Pod of the Deployment
```

Verified on k3s: a container that prints `booting` and `fatal: DB_URL missing` and exits 1 shows both lines with `kubectl logs`, and the Pod cycles between `Error` and `CrashLoopBackOff` with a growing restart count. Only the **last** previous container's logs are kept on the node, so earlier attempts are gone; ship logs to a central store (Loki or similar) if you need the full history.

If the log is empty:

- The process died before writing anything: check exit code 126/127/128 and `lastState.terminated.message`.
- The application logs to a file instead of stdout/stderr. Configure it to log to stdout, which is what `kubectl logs` reads.
- Output is buffered and lost on crash (Python without `-u`, some loggers with async appenders).

### Step 3: events

```bash
kubectl -n team-a events --for pod/web-xyz
kubectl -n team-a get events --field-selector involvedObject.name=web-xyz
```

Events show probe failures (`Unhealthy`, `Killing`), mount problems, and back-off messages (`Back-off restarting failed container app in pod web-xyz`). A container killed by its liveness probe crash-loops just like one that exits on its own; only the events tell them apart.

### Step 4: keep the container alive to look inside

When the process dies too fast for `kubectl exec`, replace the command temporarily:

```bash
kubectl -n team-a debug web-xyz -it --copy-to=web-debug --container=app -- sh
```

`--copy-to` creates a copy of the Pod with the container's command replaced by a shell, leaving the original untouched. Inside you can check what the app would see: `env`, mounted files, DNS (`nslookup db.shared`), permissions on volumes (`ls -ln /data`), and run the entrypoint by hand to watch it fail. Delete the copy afterwards.

Alternatively, patch the Deployment's command to `["sleep", "3600"]` for a moment, which also removes it from any liveness restarts. Revert it with your normal apply.

### Common root causes

- **Missing or wrong configuration**: an environment variable, a Secret key, a config file path. The app's own error message says so; compare with `kubectl exec ... env`.
- **Dependency not reachable at startup**: the app exits instead of retrying. Fix the app (retry with back-off) or add an init container that waits; do not mask it with a huge restart count.
- **Permissions**: non-root user writing to a root-owned volume, read-only root filesystem without a writable `/tmp`.
- **Wrong command or arguments** in the manifest overriding the image's defaults.
- **Probes**: a liveness probe that fails during a slow start kills a healthy app. Add a startup probe.
- **Resources**: `OOMKilled` at startup because the limit is below what the runtime needs to boot.

## Trade-offs

- **Fixing the app vs working around it in Kubernetes.** An init container that waits for a dependency or a larger restart budget hides fragile startup code; making the app retry is more work and more robust.
- **Debug copies vs editing the live Deployment.** `--copy-to` leaves production untouched but runs outside its controller; editing the Deployment is realistic but must be reverted carefully.
- **Local logs vs central logs.** `kubectl logs --previous` is immediate and keeps only one previous attempt; central logging keeps everything and needs a stack to run.

## Documentation Links

- [Kubernetes docs: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/): logs, exec, `kubectl debug` and Pod copies.
- [Kubernetes docs: Determine the Reason for Pod Failure](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/): termination messages and exit codes.
- [kubectl logs reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/): `--previous`, containers, selectors.
- [Kubernetes docs: Pod Lifecycle (container restart policy)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy): back-off timing.
