---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Every change to a Deployment's Pod template is a **rollout**: a new ReplicaSet scales up, the old one scales down. `kubectl rollout` is the toolbox around it: follow a rollout until it finishes (`status`), trigger a new one without changing the spec (`restart`), list past revisions (`history`) and go back to one (`undo`). The behaviour has details that surprise people in the middle of an incident: `restart` is just an annotation, `undo` renumbers revisions, and the "change cause" column is easy to fill with lies. This concept covers the full loop, with outputs verified on a real cluster.

## Use Cases

- Deploying a new image and waiting, in a script, until it is fully rolled out or failed.
- Restarting all Pods of a Deployment to pick up a changed ConfigMap or Secret.
- Rolling back quickly after a bad release.
- Understanding what a revision number refers to.

## Deep Dive

### Triggering a rollout: new tag or restart

Two ways to start one:

```bash
# 1. change the template, e.g. a new image tag (or apply a manifest/overlay with the new tag)
kubectl -n team-a set image deploy/web app=registry.example.com/demo/web-app:1.4.3

# 2. same template, new Pods
kubectl -n team-a rollout restart deploy/web
```

`rollout restart` does not restart anything directly. It writes the current time into a Pod template annotation, and that template change triggers a normal rolling update. Verified on k3s:

```
$ kubectl rollout restart deploy/web
deployment.apps/web restarted
$ kubectl get deploy web -o jsonpath='{.spec.template.metadata.annotations}'
{"kubectl.kubernetes.io/restartedAt":"2026-09-26T20:02:47Z"}
```

Consequences: it respects `maxSurge`/`maxUnavailable` and readiness exactly like any rollout (no downtime with enough replicas), it creates a new revision, and with an `imagePullPolicy: IfNotPresent` and a reused tag it does **not** pull a newer image. Use it for configuration changes consumed at startup; use a new tag for new code.

### Following it: rollout status

```bash
kubectl -n team-a rollout status deploy/web --timeout=300s
```

It prints progress and exits `0` when all replicas are updated and available. With `--timeout`, it exits non-zero if the rollout does not finish in time. Verified with an image that does not exist:

```
Waiting for deployment "web" rollout to finish: 1 out of 2 new replicas have been updated...
error: timed out waiting for the condition
exit=1
```

Without `--timeout` it waits until the Deployment's own `progressDeadlineSeconds` (default 600) marks the rollout as failed (`ProgressDeadlineExceeded`), then exits with an error. In a pipeline, always use it after `apply`: a successful `kubectl apply` only means the API accepted the object, not that the new version runs.

To watch Pods while it happens:

```bash
kubectl -n team-a get pods -l app=web -w
```

### History

```bash
kubectl -n team-a rollout history deploy/web
kubectl -n team-a rollout history deploy/web --revision=3    # the template of revision 3
```

Each revision is a ReplicaSet kept around with 0 replicas (`revisionHistoryLimit`, default 10). The `CHANGE-CAUSE` column comes from the `kubernetes.io/change-cause` annotation on the Deployment **at the time the revision was created**. Verified with an `nginx` Deployment: after annotating once, the same text was copied into every later revision, including one produced by `rollout restart` and one with a broken image:

```
REVISION  CHANGE-CAUSE
1         <none>
2         bump nginx to 1.30
3         bump nginx to 1.30
4         bump nginx to 1.30
```

Either set the annotation on every change (a pipeline can write the Git SHA or release version) or ignore the column; a stale change cause is worse than none. The old `--record` flag that filled it automatically is deprecated.

### Rolling back: rollout undo

```bash
kubectl -n team-a rollout undo deploy/web                  # to the previous revision
kubectl -n team-a rollout undo deploy/web --to-revision=2
kubectl -n team-a rollout status deploy/web
```

`undo` copies the old revision's Pod template back into the Deployment, which is itself a new rollout. The restored revision gets a **new, highest number**: verified, undoing from revision 4 to revision 3 turned 3 into 5:

```
REVISION  CHANGE-CAUSE
1         <none>
2         bump nginx to 1.30
4         bump nginx to 1.30
5         bump nginx to 1.30
```

Things `undo` does not do:

- It does not roll back ConfigMaps or Secrets you edited in place. If configuration is referenced by name with a Kustomize hash suffix, the old revision references the old ConfigMap, which still exists, so config does roll back with it. That is one of the best reasons to use generated names.
- It does not change your manifests in Git. The next `kubectl apply` of the unchanged manifest rolls forward to the broken version again. After an emergency undo, fix Git (revert the commit) before anything else deploys.
- It does not work for Jobs, StatefulSet data, database migrations, or anything outside the Pod template.

### Pausing

```bash
kubectl -n team-a rollout pause deploy/web
kubectl -n team-a set image deploy/web app=...:1.4.3
kubectl -n team-a set resources deploy/web -c app --limits=memory=1Gi
kubectl -n team-a rollout resume deploy/web          # one rollout with both changes
```

Useful to batch several imperative changes into one rollout; with declarative `apply` of a whole manifest you rarely need it.

## Trade-offs

- **`rollout restart` vs a new tag.** Restart reuses the same image and is ideal for picking up configuration; a new tag is the only reliable way to ship new code with `IfNotPresent` pulls.
- **`rollout undo` vs rolling forward.** Undo is the fastest way back to a known-good state; rolling forward with a fix keeps Git and the cluster in sync. In practice: undo first to stop the bleeding, then make Git match.
- **Long vs short `revisionHistoryLimit`.** More revisions mean more rollback targets and more idle ReplicaSets cluttering `kubectl get rs`.

## Documentation Links

- [Kubernetes docs: Deployments (updating, rolling back, pausing)](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): rollout mechanics and revision history.
- [kubectl rollout reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/): `status`, `history`, `undo`, `restart`, `pause`, `resume`.
- [Kubernetes docs: Well-known annotations (kubernetes.io/change-cause)](https://kubernetes.io/docs/reference/labels-annotations-taints/#change-cause): how the change cause is recorded.
