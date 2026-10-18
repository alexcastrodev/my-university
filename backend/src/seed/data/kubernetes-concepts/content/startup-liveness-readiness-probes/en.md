---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

The kubelet can check a container in three ways, and each answer triggers a different action. A failing **readiness** probe removes the Pod from Service endpoints but leaves it running. A failing **liveness** probe restarts the container. A **startup** probe holds the other two back until the application has finished booting. Mixing them up is one of the most common ways to turn a slow dependency into a cluster-wide outage. This concept covers what each probe does, how the timing fields combine, and the rules that keep probes from causing the failures they are supposed to detect.

## Use Cases

- A service that needs 40 seconds to start and gets killed at 30 by an eager liveness probe.
- Taking a Pod out of load balancing while it warms up or loses a dependency, without restarting it.
- Recovering automatically from a deadlocked process that still has an open port.
- Making rolling updates stop when the new version is broken.

## Deep Dive

### What each probe does

| Probe | Question | On failure |
|---|---|---|
| `startupProbe` | Has the app finished starting? | Keeps checking until `failureThreshold`; then the container is killed and restarted |
| `livenessProbe` | Is the process healthy, or stuck beyond recovery? | Container is restarted (`RESTARTS` increases) |
| `readinessProbe` | Can it serve traffic right now? | Pod marked `NotReady`, removed from Service endpoints; no restart |

While a startup probe is defined and has not yet succeeded, liveness and readiness probes do not run. Once it succeeds, it never runs again for that container.

Readiness also drives rollouts: a new Pod only counts as available when it is Ready, so a version that never becomes ready stalls the RollingUpdate instead of replacing healthy Pods.

### Probe mechanisms

```yaml
httpGet:   {path: /healthz, port: 8080}          # status 200-399 is success
tcpSocket: {port: 6379}                          # the connection opens
exec:      {command: ["redis-cli", "ping"]}      # exit code 0
grpc:      {port: 9090}                          # gRPC health checking protocol
```

`httpGet` is the default choice for web apps. `exec` forks a process inside the container every period, which adds up on busy nodes; prefer HTTP or TCP when possible.

### Timing fields

```yaml
containers:
  - name: app
    image: registry.example.com/demo/web-app:1.4.2
    ports: [{name: http, containerPort: 8080}]
    startupProbe:
      httpGet: {path: /healthz, port: http}
      periodSeconds: 5
      failureThreshold: 36        # up to 36 x 5s = 180s to start
    livenessProbe:
      httpGet: {path: /healthz, port: http}
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3         # 3 consecutive failures, about 30s, before a restart
    readinessProbe:
      httpGet: {path: /readyz, port: http}
      periodSeconds: 5
      failureThreshold: 2
      successThreshold: 1
```

- `initialDelaySeconds`: wait before the first check. With a startup probe you rarely need it.
- `periodSeconds` (default 10), `timeoutSeconds` (default 1), `failureThreshold` (default 3), `successThreshold` (default 1, must be 1 for liveness and startup).
- Worst-case time to react is roughly `periodSeconds x failureThreshold`.
- `port` can be a named container port, as above, so the probe follows the port if it changes.

The startup budget is `periodSeconds x failureThreshold`. Size it for the slowest realistic start (cold caches, CPU throttled by a low limit, a slow first connection to a dependency), not the average.

### Two endpoints, two meanings

A common convention, also used by the Kubernetes API server itself (`/livez`, `/readyz`):

- `/healthz` (or `/livez`): "the process works". Answers from memory, checks nothing external.
- `/readyz`: "I can serve requests now". May check that warm-up is done and that critical local resources (a connection pool, a loaded model, a cache) are available.

Many frameworks ship both endpoints ready to use; whatever you use, make sure the liveness endpoint does not include external checks.

### The rules that prevent outages

**1. Liveness must not depend on anything outside the process.** If the liveness endpoint checks a shared database, a database blip makes every replica fail liveness at the same time, and Kubernetes restarts all of them together. The restarts do not fix the database; they add a thundering herd of reconnections and cold starts. Liveness answers only "is this process broken beyond self-recovery" (deadlock, corrupted internal state).

**2. Readiness may depend on critical dependencies, carefully.** Taking a Pod out of rotation when it cannot reach its dependency is reasonable. But if every replica shares the same dependency, they all go NotReady together and the Service has zero endpoints: callers get connection refused instead of a clear error from your app. Decide per dependency whether "unready" or "ready but degraded" is the better failure.

**3. Never use the same aggressive settings for startup and liveness.** Before startup probes existed, people used a large `initialDelaySeconds` on liveness, which also delays detection of real hangs. A startup probe with a generous budget plus a tight liveness probe gives both fast detection and slow-start tolerance.

**4. Timeouts must survive pauses and CPU throttling.** `timeoutSeconds: 1` with a CPU limit of 250m on a busy service fails intermittently under load. A liveness restart then makes the load problem worse.

**5. Probes need a cheap endpoint.** The probe runs every few seconds on every replica. It should not run queries, call other services, or allocate much.

### Seeing probe failures

```bash
kubectl describe pod web-xyz
#  Warning  Unhealthy  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503
#  Warning  Unhealthy  kubelet  Liveness probe failed: Get "http://10.1.2.3:8080/healthz": context deadline exceeded
#  Normal   Killing    kubelet  Container app failed liveness probe, will be restarted
kubectl get pods         # READY 0/1 = readiness failing; RESTARTS climbing = liveness or crashes
```

`Killing ... failed liveness probe` in the events distinguishes a probe-driven restart from a crash. A container killed by liveness shows exit code 137 (SIGKILL after the grace period) or 143 (SIGTERM honoured).

## Trade-offs

- **Liveness probe vs none.** A liveness probe recovers deadlocks automatically; a badly tuned one causes restarts that would never have been needed. If you cannot define a meaningful "broken beyond recovery" check, having no liveness probe is often safer than a naive one.
- **Readiness including dependencies vs not.** Including them protects callers from a replica that cannot work; excluding them avoids all replicas vanishing from the Service together.
- **Short periods vs long periods.** Faster detection costs more probe traffic and more false positives under load.

## Lab

In this lab you get two manifests with two probe mistakes: a liveness probe that kills a slow app before it finishes starting, and a Deployment with no readiness probe that lets a broken version replace every healthy Pod. Your job is to fix both. The core idea is that each probe answers a different question (has it finished starting? is it stuck? can it receive traffic?) and that the wrong probe, or the lack of one, makes Kubernetes take the wrong decision.

**The scenario**

The test applies both manifests in the `example` namespace of a real cluster (k3s via Testcontainers) and runs in real time, so it takes about three minutes.

- `src/main/resources/k8s/slow.yaml`: the `slow` Pod, an app that takes about 40 seconds before it starts answering `/healthz`. It has a `livenessProbe` (`periodSeconds: 10`, `failureThreshold: 3`) that kills it before it comes up.
- `src/main/resources/k8s/web.yaml`: a `web` Deployment with 2 replicas and a Service. After it is up, the test rolls out `VERSION=2`, which starts but never serves `/readyz`, and checks what the Service returns 45 seconds later.

**What you will do, step by step**

1. **Run it and read the failures.** Run before editing: `slow` keeps restarting, and after the broken rollout nobody serves `/readyz` while `kubectl rollout status` says everything is fine.
2. **Give the slow app time to start (TODO-00).** In `slow.yaml`, add a `startupProbe` on the same endpoint with a budget (`periodSeconds` times `failureThreshold`) of at least 60 seconds. Do not loosen the liveness probe: once the app is up, a hang must still be detected in about 30 seconds. The startup probe holds the liveness probe off until it passes for the first time.
3. **Block the broken version (TODO-01).** In `web.yaml`, add a `readinessProbe` on `/readyz`. Without it, a Pod counts as `Ready` the moment its container starts, and the rollout swaps every healthy Pod for a broken one. With it, the new Pods never become ready, the rollout stalls and the old Pods keep serving.

**How you know you are done**

`mvn -pl kubernetes-concepts/startup-liveness-readiness-probes test` passes completely: `slow` starts with no restarts, the startup probe has at least 60 s and the liveness probe still reacts within 30 s, the Service still answers `ok` on `/readyz` after the broken rollout, and `kubectl rollout status` exits with an error instead of reporting success. You should be able to explain what each probe does when it fails (restart, or remove from the Service) and why the stalled rollout is the desired behavior.

**Optional challenges**

- **TODO-02:** remove `terminationGracePeriodSeconds: 5` from `slow.yaml` and run the starter version again. Why can the app answer `/healthz` once even though the liveness probe already decided to kill it?

**Prerequisites:** Docker running (the test starts a `rancher/k3s` container and pulls `busybox` inside it), the article "Startup, Liveness and Readiness Probes", Java and Maven.

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/startup-liveness-readiness-probes test`. A run takes about three minutes (the slow app, the liveness window and the rollout all happen in real time). You only edit `slow.yaml` and `web.yaml`, and the TODO comments mark the spots.

## Documentation Links

- [Kubernetes docs: Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/): concepts and interactions.
- [Kubernetes docs: Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/): all fields and defaults.
- [Kubernetes docs: Pod Lifecycle (container probes)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes): probe outcomes and restarts.
- [Kubernetes docs: Kubernetes API health endpoints](https://kubernetes.io/docs/reference/using-api/health-checks/): the `/livez` and `/readyz` convention.
