---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

The `STATUS` column of `kubectl get pods` looks like a state machine, but it is a summary computed by kubectl from several fields: the Pod **phase** (only five values), the **conditions** (scheduled, initialized, ready), and each container's **state** with its **reason**. `CrashLoopBackOff`, `ImagePullBackOff` or `OOMKilled` are not phases at all, they are container reasons. Reading the right field tells you in seconds which component to blame: the scheduler, the kubelet, the image registry, or your application. This concept maps every status you will commonly see to where it comes from and what to check next.

## Use Cases

- Triage of a failing deploy: is it scheduling, pulling, configuration, or the app itself?
- Writing scripts or alerts that check Pod health correctly.
- Explaining why a Pod shows `Running` but `READY 0/1`.
- Recognising expected states (`Completed`, `ContainerCreating`) from real problems.

## Deep Dive

### The five phases

| Phase | Meaning |
|---|---|
| `Pending` | accepted by the API, but not all containers are running yet (not scheduled, pulling images, init containers running) |
| `Running` | bound to a node, at least one container running or restarting |
| `Succeeded` | all containers exited 0 and will not restart (Jobs) |
| `Failed` | all containers terminated, at least one with an error, no restart |
| `Unknown` | the node stopped reporting |

```bash
kubectl get pod web-xyz -o jsonpath='{.status.phase}'
```

A Pod in `CrashLoopBackOff` is usually in phase `Running`: the container keeps being restarted, and the phase does not change.

### The path of a healthy Pod

```
Pending (unscheduled)  ->  Pending (ContainerCreating / Init:0/1)  ->  Running  ->  (Succeeded | Failed for run-to-completion)
   scheduler                  kubelet: volumes, image pull, init containers     containers start, probes run
```

Conditions record each step: `PodScheduled`, `PodReadyToStartContainers`, `Initialized`, `ContainersReady`, `Ready`.

```bash
kubectl get pod web-xyz -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}{"\n"}{end}'
```

### STATUS values and where they come from

Verified on k3s v1.36 unless stated otherwise:

| STATUS | Source | Typical cause | First check |
|---|---|---|---|
| `Pending` | scheduler | no node fits: `Insufficient memory`, unbound PVC, taints, node selector | `describe pod` events `FailedScheduling` |
| `ContainerCreating` | kubelet | pulling image, mounting volumes; stuck = `FailedMount` | `describe pod` events |
| `Init:0/1`, `Init:Error`, `Init:CrashLoopBackOff` | init containers | an init container still running or failing | `logs <pod> -c <init-container>` |
| `ErrImagePull`, `ImagePullBackOff` | kubelet + registry | wrong tag, no credentials, untrusted CA, wrong architecture | `describe pod` events `Failed` |
| `CreateContainerConfigError` | kubelet | referenced ConfigMap/Secret or key missing (`couldn't find key nope in ConfigMap lab/appcfg`), `runAsNonRoot` on a root image | `describe pod`, container `waiting.message` |
| `RunContainerError` / `StartError` | container runtime | could not start the process: mount conflicts (`read-only file system`), missing entrypoint binary | `lastState.terminated.message` |
| `Running` with `READY 0/1` | kubelet probes | readiness probe failing | `describe pod` events `Unhealthy` |
| `Error` | the application | process exited non-zero | `logs --previous` |
| `OOMKilled` | kernel | memory limit exceeded (exit 137) | limits vs usage |
| `CrashLoopBackOff` | kubelet | container keeps exiting; waiting before the next restart | `logs --previous`, `lastState` |
| `Completed` | the application | exited 0 (normal for Jobs) | nothing, or check restartPolicy if unexpected |
| `Terminating` | API server | deletion requested; stuck = finalizer or unreachable node | `metadata.finalizers`, node status |
| `Evicted` | kubelet | node pressure (memory, disk) | node conditions, `describe node` |

### Where the details live

```bash
# current and previous container state, with reason, exit code and message
kubectl get pod web-xyz -o jsonpath='{.status.containerStatuses[0].state}{"\n"}{.status.containerStatuses[0].lastState}{"\n"}'
```

Verified example, an OOM-killed container between restarts:

```
{"waiting":{"reason":"CrashLoopBackOff", ...}}
{"terminated":{"exitCode":137,"reason":"OOMKilled", ...}}
```

And a Pod that never started its process:

```
{"terminated":{"exitCode":128,"reason":"StartError","message":"... read-only file system"}}
```

Exit codes help: `0` success, `1` generic application error, `126`/`127` command not executable or not found, `128` the runtime could not start it, `137` SIGKILL (OOM or killed after the grace period), `143` SIGTERM honoured.

### Restart back-off

When a container keeps failing, the kubelet waits before each restart: 10s, 20s, 40s... up to 5 minutes, reset after the container runs successfully for 10 minutes. That wait is what `CrashLoopBackOff` means. It is not a separate error; the real error is in the previous container's logs and exit code.

### Scripting health checks

Do not parse the `STATUS` column. Use conditions and fields:

```bash
kubectl wait --for=condition=Ready pod -l app=web --timeout=120s
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
kubectl get pods -A -o jsonpath='{range .items[?(@.status.containerStatuses[0].restartCount>5)]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}'
```

## Trade-offs

- **`STATUS` column vs raw fields.** The column is the fastest human summary; scripts and alerts should use phase, conditions and container states, which are stable API fields.
- **Watching phases vs readiness.** Phase `Running` says nothing about serving traffic; `Ready` is what matters for Services and rollouts.
- **Restart back-off.** It protects the node from crash loops, and it also means a fixed dependency can take up to 5 minutes to be noticed; `kubectl delete pod` restarts immediately.

## Documentation Links

- [Kubernetes docs: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): phases, conditions, container states, restart back-off.
- [Kubernetes docs: Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/): what to check for each state.
- [Kubernetes docs: Determine the Reason for Pod Failure](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/): termination messages.
- [Kubernetes docs: Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/): `Init:` statuses.
