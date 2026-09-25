---
version: 1.0
updatedAt: 2026-09-25
---
## Objective

A Pod can consume a Secret in two ways: as environment variables (`env` with `secretKeyRef`, or `envFrom`) or as files in a mounted volume. Both look equivalent on day one. They behave differently on the day you rotate a credential, and on the day something dumps a process's environment into a log. This concept covers what each mechanism does at runtime, why a rotated Secret reaches mounted files but never environment variables or `subPath` mounts, and what that means for how applications should read secrets.

## Use Cases

- Rotating a database password or API key without restarting every Pod that uses it.
- Deciding how a Java or Spring Boot service should receive credentials: `${DB_PASSWORD}` from the environment or a file under `/run/secrets`.
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
- **Framework reload.** Spring Cloud Kubernetes can refresh beans when Secrets change, and tools such as Stakater Reloader restart workloads automatically.

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
  ```properties
  # Spring Boot, env var: resolved once at startup
  spring.datasource.password=${DB_PASSWORD}
  ```
- **Files rotate in place, but only if the app cooperates.** The kubelet does its part within about a minute; the application still has to re-read. For libraries that only take a string at startup, files give you no rotation advantage over env vars, only the leak-surface one.
  ```properties
  # Spring Boot, files: /run/secrets/DB_PASSWORD becomes property DB_PASSWORD
  spring.config.import=optional:configtree:/run/secrets/
  ```
- **`subPath` is a convenience that silently opts out of updates.** Fine for files that never change, a trap for anything rotated.
- **Restart-on-change is the most predictable rotation strategy.** It is slower than in-place reload, but every Pod converges to the same value through a normal, observable rolling update, and it works the same for env vars and files.

## Documentation Links

- [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/): `env`, `envFrom` and volume examples.
- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): mounted Secrets are updated automatically, env vars and `subPath` are not.
- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): `subPath` and its lack of updates.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): limiting exposure inside containers.
