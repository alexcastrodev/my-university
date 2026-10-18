---
version: 1.0
updatedAt: 2026-09-25
---
## Objective

A Pod can consume a Secret in two ways: as environment variables (`env` with `secretKeyRef`, or `envFrom`) or as files in a mounted volume. Both look equivalent on day one. They behave differently on the day you rotate a credential, and on the day something dumps a process's environment into a log. This concept covers what each mechanism does at runtime, why a rotated Secret reaches mounted files but never environment variables or `subPath` mounts, and what that means for how applications should read secrets.

## Use Cases

- Rotating a database password or API key without restarting every Pod that uses it.
- Deciding how a service should receive credentials: `${DB_PASSWORD}` from the environment or a file under `/run/secrets`.
- Understanding why a rotation "did not take" for part of the fleet.
- Reducing the places a secret can leak from: crash dumps, debug endpoints, child processes, node-level tooling.

## Deep Dive

### The two mechanisms

```yaml
containers:
  - name: app
    image: busybox:1.37
    env:
      - name: DB_PASSWORD                  # one key, renamed if you like
        valueFrom:
          secretKeyRef: { name: tenant-alpha, key: DB_PASSWORD }
    envFrom:
      - secretRef: { name: tenant-beta }   # every key becomes a variable
        prefix: BETA_
    volumeMounts:
      - name: secrets
        mountPath: /run/secrets
        readOnly: true
volumes:
  - name: secrets
    secret:
      secretName: tenant-alpha
```

Environment variables are resolved **once**, when the container starts, and copied into the process environment. Mounted files are maintained by the kubelet for as long as the Pod runs.

### What rotation actually does

The experiment, on k3s v1.36: a Pod reads `tenant-alpha`'s `DB_PASSWORD` three ways (env var, full volume mount, `subPath` mount of the single key), then the Secret is updated:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-literal=DB_USER=alpha_app --from-literal=DB_PASSWORD=rotated-999 \
  --dry-run=client -o yaml | kubectl apply -f -
```

| Consumer | Value after rotation |
|---|---|
| mounted volume (`/run/secrets/DB_PASSWORD`) | `rotated-999`, after 74 to 79 seconds across two runs |
| environment variable (`printenv DB_PASSWORD`) | still `alpha-s3cret` |
| `subPath` mount (`/etc/alpha-pass`) | still `alpha-s3cret` |

- **Volumes** are refreshed by the kubelet's periodic sync. The delay is the kubelet sync period (1 minute by default) plus the time its Secret cache takes to notice the change, so "about a minute, sometimes a bit more" is the honest expectation, not "instant".
- **Environment variables** belong to the process. Kubernetes cannot change a running process's environment, so the old value stays until the container restarts.
- **`subPath`** bind-mounts one file from the volume directly. The kubelet updates a volume by writing a new timestamped directory and swapping the `..data` symlink, and a `subPath` mount stays pinned to the original file, so it never sees the swap. The docs state it plainly: a container using a Secret as a `subPath` volume mount does not receive updates.

`subPath` is usually reached for to drop one file into a directory that already has other content (for example a single keystore into `/etc/ssl/`). If the file must follow rotation, mount the volume into its own directory and point the application there instead.

### A file that changes is only useful if you read it again

The kubelet updating `/run/secrets/DB_PASSWORD` does nothing for an application that read it once at startup into a connection pool. Options, from simplest:

- **Restart on change.** `kubectl rollout restart deployment/app` after rotating, or put a hash of the Secret into a Pod template annotation (the Helm `checksum/secret` pattern) so any change triggers a rolling update. Works for env vars and files alike.
- **Re-read per use or on failure.** Read the file when opening a new connection, or reload on an authentication error. Cheap, and it fits the "about a minute" propagation window.
- **Watch the directory.** Watch `/run/secrets` for the `..data` symlink swap, not the individual file. A watch on `/run/secrets/DB_PASSWORD` follows the symlink to the file inside the old timestamped directory, which the kubelet deletes during the swap, so the watch ends with a delete event instead of reporting a modification.
- **Framework reload.** Some frameworks can reload their configuration when Secrets change, and tools such as Stakater Reloader restart workloads automatically.

### Where each form leaks

The same Pod, inspected from different angles:

```bash
$ kubectl describe pod app | grep DB_PASSWORD
DB_PASSWORD:  <set to the key 'DB_PASSWORD' in secret 'tenant-alpha'>  Optional: false

$ kubectl exec app -- sh -c 'tr "\0" "\n" < /proc/1/environ | grep DB_'
DB_PASSWORD=alpha-s3cret

$ crictl inspect <container-id> | grep DB_PASSWORD     # on the node
          "DB_PASSWORD=alpha-s3cret",
```

`kubectl describe` only shows the reference, but the resolved value is in the process environment and in the container runtime's spec on the node. Environment variables are also inherited by every child process, printed by many crash reporters and error pages, and exposed by debug endpoints that dump the environment. A file under `/run/secrets` is readable only by processes that open it, can be restricted with `defaultMode: 0400`, and does not travel into child processes by default.

## Trade-offs

- **Env vars are the easiest to consume, and the hardest to rotate or contain.** Every language and framework reads them natively, and the twelve-factor model assumes them. In exchange, rotation always means a restart, and the value can surface anywhere the environment is dumped.
- **Files rotate in place, but only if the app cooperates.** The kubelet does its part within about a minute; the application still has to re-read. For libraries that only take a string at startup, files give you no rotation advantage over env vars, only the leak-surface one.
- **`subPath` is a convenience that silently opts out of updates.** Fine for files that never change, a trap for anything rotated.
- **Restart-on-change is the most predictable rotation strategy.** It is slower than in-place reload, but every Pod converges to the same value through a normal, observable rolling update, and it works the same for env vars and files.

## Lab

In this lab you get an `app` Pod that reads the database password from `/etc/app/secrets/DB_PASSWORD` on every connection, while operations rotate the `db-credentials` Secret without restarting Pods. The problem is that the Pod delivers the password in a way that never updates. Your job is to edit `app.yaml` so the application sees the new value. The core idea is to feel the difference between an environment variable (copied into the process at start) and a mounted file (updated by the kubelet), and how a `subPath` defeats that update.

**The scenario**

The test creates the Secret with `DB_PASSWORD=old-111`, applies your `app.yaml`, rotates the Secret to `new-222` with `kubectl apply` (same name, no restart) and waits up to 150 seconds for the file inside the Pod to change. Everything runs on a real cluster (k3s via Testcontainers).

- `src/main/resources/k8s/app.yaml`: your file. The Pod exposes the password as the `DB_PASSWORD` environment variable and also mounts the Secret as a single file with `subPath`.
- `src/test/resources/k8s/naive-app.yaml`: the same Pod in its starting state (before any TODO), kept for comparison.

**What you will do, step by step**

1. **Observe the naive Pod.** Run the tests before editing. `naiveEnvVarAndSubPathKeepTheOldPassword` passes: long after the rotation, the Pod with an environment variable and a `subPath` still sees `old-111`.
2. **Take the password out of the environment (TODO-00).** Remove the `DB_PASSWORD` variable. The app only reads the file, and a variable never changes after start, besides leaking into child processes and crash dumps.
3. **Mount the directory, not the file (TODO-01).** Replace the single-file mount with `subPath` by a mount of the Secret as a directory at `/etc/app/secrets`. That way the kubelet can update the content in place; `subPath` mounts are never updated.

**How you know you are done**

`mvn -pl kubernetes-concepts/secrets-as-env-vars-vs-mounted-files test` passes completely: the password is not in the process environment and the file holds `new-222` after the rotation. The passing run prints how long the kubelet took to refresh the file (usually 60 to 90 seconds). You should be able to explain why that delay exists and why `subPath` and environment variables require restarting the Pod.

**Optional challenges**

- **TODO-02:** add `defaultMode: 0400` to the Secret volume and check it with `stat -c %a /etc/app/secrets/..data/DB_PASSWORD`. Why does `ls -la /etc/app/secrets` show `DB_PASSWORD` as a symlink?

**Prerequisites:** Docker running (the test starts a `rancher/k3s` container and pulls `busybox` inside it), the article "Secrets as Environment Variables vs Mounted Files", Java and Maven.

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/secrets-as-env-vars-vs-mounted-files test`. Expect two to three minutes per run, because the rotation is real and the kubelet only refreshes Secret volumes periodically. You only edit `app.yaml`.

## Documentation Links

- [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/): `env`, `envFrom` and volume examples.
- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): mounted Secrets are updated automatically, env vars and `subPath` are not.
- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): `subPath` and its lack of updates.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): limiting exposure inside containers.
