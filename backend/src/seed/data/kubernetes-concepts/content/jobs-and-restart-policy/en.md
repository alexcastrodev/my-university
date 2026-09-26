---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A Deployment keeps a process running forever. Many tasks should run once and stop: a database migration, a data import, a one-off cleanup, a backup. That is a **Job**: it runs Pods until a given number of them succeed, retries failures up to a limit, and records the outcome. Its behaviour is shaped by a few fields (`restartPolicy`, `backoffLimit`, `activeDeadlineSeconds`, `ttlSecondsAfterFinished`) that are easy to get subtly wrong. This concept covers a single-run Job, what happens on failure, how finished Jobs are cleaned up, why re-applying a Job fails, and CronJobs for schedules.

## Use Cases

- Running schema migrations before the new application version starts.
- A one-off import or reprocessing task using the same image as the application.
- Seeding initial data or configuration when an environment is created.
- Nightly backups with a CronJob.

## Deep Dive

### A single-run Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
spec:
  backoffLimit: 2                 # retries before the Job is marked Failed (default 6)
  activeDeadlineSeconds: 600      # hard wall-clock limit for the whole Job
  ttlSecondsAfterFinished: 3600   # delete the Job and its Pods 1h after it finishes
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: app
          image: registry.example.com/demo/web-app:1.4.2
          args: ["migrate"]
```

`completions` (default 1) and `parallelism` (default 1) make this "run one Pod until it succeeds once".

### restartPolicy: Never vs OnFailure

A Job's Pod template accepts only `Never` or `OnFailure`. `Always`, the Pod default, is rejected:

```
The Job "alwaysjob" is invalid: spec.template.spec.restartPolicy: Required value:
valid values: "OnFailure", "Never"
```

- **`Never`**: a failed container leaves its Pod in `Error`, and the Job controller creates a **new Pod** for the retry. Every attempt keeps its own Pod and logs, which is great for debugging.
- **`OnFailure`**: the kubelet restarts the container **inside the same Pod**. Fewer Pods, but the logs of earlier attempts are only reachable with `kubectl logs --previous`, and only for the last one.

### What failure looks like

A Job with `backoffLimit: 2` whose container exits with code 3, verified on k3s v1.36:

```
$ kubectl get job,pods -l batch.kubernetes.io/job-name=failjob
job.batch/failjob   Failed   0/1   35s
pod/failjob-sh2q9   0/1     Error
pod/failjob-v4mxf   0/1     Error
pod/failjob-ttj6n   0/1     Error

$ kubectl describe job failjob
  Normal   SuccessfulCreate      job-controller  Created pod: failjob-sh2q9
  Normal   SuccessfulCreate      job-controller  Created pod: failjob-v4mxf
  Normal   SuccessfulCreate      job-controller  Created pod: failjob-ttj6n
  Warning  BackoffLimitExceeded  job-controller  Job has reached the specified backoff limit
```

Three Pods: the first attempt plus two retries, spaced by an exponential back-off (10s, 20s, 40s, capped at 6 minutes). Once the limit is reached the Job is `Failed` and nothing retries it. The default `backoffLimit: 6` means a broken migration can take several minutes to be declared failed; set it explicitly.

`activeDeadlineSeconds` is the other stop condition: when the Job has been running longer than that, all its Pods are killed and the Job fails with `DeadlineExceeded`, even if retries remain. It protects against a migration stuck on a lock.

### Cleaning up: ttlSecondsAfterFinished

Finished Jobs and their Pods stay forever by default, cluttering `kubectl get pods` and keeping logs around. `ttlSecondsAfterFinished` lets the TTL controller delete the Job (and cascade to its Pods) that many seconds after it completes or fails. Verified: a Job with `ttlSecondsAfterFinished: 30` had disappeared, Pods included, well before a minute had passed.

Pick the value by how long you need the logs: long enough to investigate a failure (hours), not zero. If you ship logs to Loki or similar, you can be more aggressive.

### Why re-applying a Job fails

A Job's `spec.template` is **immutable**. Apply a Job, change its image tag, apply again:

```
The Job "migrate" is invalid: spec.template: Invalid value: ...: field is immutable
```

This bites every project where a migration Job lives next to Deployments in the same Kustomize directory: the Deployments update, the Job apply fails, and depending on the pipeline, the whole `kubectl apply -k` reports an error. Options:

- Delete the old Job before applying (`kubectl delete job migrate --ignore-not-found`), as a pipeline step.
- Let `ttlSecondsAfterFinished` remove it, so a later apply creates a fresh one. Only works if the next deploy comes after the TTL.
- Give the Job a unique name per version (`migrate-1-4-2`), for example via a Kustomize `nameSuffix` or a generated name with `kubectl create`.
- Run migrations inside the application at startup (many migration libraries support it) and skip the Job entirely for single-replica services.

### CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-backup
spec:
  schedule: "30 2 * * *"
  timeZone: "America/New_York"       # otherwise the kube-controller-manager's time zone (usually UTC)
  concurrencyPolicy: Forbid            # never two backups at once
  startingDeadlineSeconds: 600         # skip a run that could not start within 10 minutes
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: backup
              image: busybox:1.37
              command: ["sh", "-c", "tar czf /backup/data-$(date +%F).tgz -C /data ."]
              volumeMounts:
                - {name: data, mountPath: /data, readOnly: true}
                - {name: backup, mountPath: /backup}
          volumes:
            - name: data
              persistentVolumeClaim: {claimName: app-data}
            - name: backup
              persistentVolumeClaim: {claimName: app-backups}
```

The CronJob creates a Job per schedule tick; the history limits replace `ttlSecondsAfterFinished` for cleanup. To test it without waiting:

```bash
kubectl create job --from=cronjob/nightly-backup backup-manual-1
```

## Trade-offs

- **`Never` vs `OnFailure`.** `Never` keeps every attempt inspectable at the cost of more Pods; `OnFailure` is tidier but hides earlier attempts.
- **Low `backoffLimit` vs default.** A migration should fail fast (0 to 2 retries), because retrying a half-applied migration rarely helps. A flaky network import benefits from more retries.
- **Migration Job vs migration on startup.** A Job gives one explicit, ordered step and works with many replicas. On-startup migration is simpler for one replica, but a failing migration becomes a CrashLoopBackOff of the service itself.

## Documentation Links

- [Kubernetes docs: Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/): completions, parallelism, backoff limit, deadlines, Pod failure policy.
- [Kubernetes docs: Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/): `ttlSecondsAfterFinished`.
- [Kubernetes docs: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): schedule syntax, time zones, concurrency policy.
- [Kubernetes docs: Pod Lifecycle (restart policy)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy): back-off behaviour.
