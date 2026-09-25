---
version: 1.0
updatedAt: 2026-09-25
---
## Objective

A plain `secret` volume mounts exactly one Secret. When a container needs credentials from several Secrets (one per tenant, one per downstream system), a `projected` volume merges them into a single directory. It is the cleanest way to give an application one well-known place, like `/run/secrets`, to read everything from. It also has a sharp edge: when two sources contain the same key, Kubernetes neither fails nor warns, and the last source silently wins. This concept covers the projected volume, that collision, and how `items` and `path` keep the sources apart.

## Use Cases

- A multi-tenant service that needs `tenant-alpha` and `tenant-beta` credentials at the same time, each Secret owned and rotated independently.
- One mount point with credentials, config and Pod metadata together (`secret` + `configMap` + `downwardAPI` sources).
- Feeding Spring Boot's `configtree:` import, which turns a directory tree into configuration properties.
- A short-lived, audience-bound ServiceAccount token (`serviceAccountToken` source) next to the app's own Secrets.

## Deep Dive

### The starting point

Two Secrets created from env files:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-env-file=secrets/example/alpha.env

kubectl -n example create secret generic tenant-beta \
  --from-env-file=secrets/example/beta.env
```

And a projected volume that mounts both into the same directory:

```yaml
volumes:
  - name: secrets
    projected:
      sources:
        - secret:
            name: tenant-alpha
        - secret:
            name: tenant-beta

volumeMounts:
  - name: secrets
    mountPath: /run/secrets
    readOnly: true
```

Every key of every source becomes a file named after the key: `/run/secrets/<KEY>`, content = value. With disjoint keys this is exactly what you want.

### The silent collision

Env files for the same kind of system tend to use the same names:

```
# alpha.env                      # beta.env
DB_USER=alpha_app                DB_USER=beta_app
DB_PASSWORD=alpha-s3cret         DB_PASSWORD=beta-s3cret
ALPHA_API_KEY=ak-alpha-111       BETA_WEBHOOK_TOKEN=wt-beta-222
```

Both Secrets now contain `DB_USER` and `DB_PASSWORD`, and both want to write `/run/secrets/DB_PASSWORD`. What happens, verified on k3s v1.36:

```bash
$ kubectl -n example exec app -- cat /run/secrets/DB_PASSWORD
beta-s3cret
```

The API server accepts the Pod, the kubelet mounts the volume, no event is emitted, and the **last source in the list wins**. Tenant alpha's application now authenticates with tenant beta's password. Reorder the sources and it flips. Compare that with `kubectl create secret` itself, which refuses a duplicate key outright (`cannot add key DB_PASSWORD, another key by that name already exists`): the check you get at creation time does not exist at projection time.

### Keeping sources apart with `items`

`items` maps a key to a path inside the volume, and the path may contain directories:

```yaml
volumes:
  - name: secrets
    projected:
      sources:
        - secret:
            name: tenant-alpha
            items:
              - key: DB_USER
                path: alpha/DB_USER
              - key: DB_PASSWORD
                path: alpha/DB_PASSWORD
              - key: ALPHA_API_KEY
                path: alpha/ALPHA_API_KEY
        - secret:
            name: tenant-beta
            items:
              - key: DB_USER
                path: beta/DB_USER
              - key: DB_PASSWORD
                path: beta/DB_PASSWORD
              - key: BETA_WEBHOOK_TOKEN
                path: beta/BETA_WEBHOOK_TOKEN
```

Result:

```
/run/secrets/alpha/DB_USER        alpha_app
/run/secrets/alpha/DB_PASSWORD    alpha-s3cret
/run/secrets/alpha/ALPHA_API_KEY  ak-alpha-111
/run/secrets/beta/DB_USER         beta_app
/run/secrets/beta/DB_PASSWORD     beta-s3cret
/run/secrets/beta/BETA_WEBHOOK_TOKEN  wt-beta-222
```

Two properties of `items` to keep in mind:

- **It is an allow-list.** As soon as a source has `items`, only the listed keys are projected. A key you forget (say `ALPHA_API_KEY`) is not an error, it simply is not there.
- **A listed key that does not exist is an error.** The volume fails to mount and the Pod stays in `ContainerCreating` with a `FailedMount` event (`references non-existent secret key`), unless the source is marked `optional: true`. The same applies to a missing Secret.

### What the mount looks like on disk

```
$ ls -la /run/secrets
..2026_09_25_09_19_37.1291824148/
..data -> ..2026_09_25_09_19_37.1291824148
alpha -> ..data/alpha
beta -> ..data/beta
```

The kubelet writes each new version into a fresh timestamped directory and then swaps the `..data` symlink, so an update is atomic: a reader never sees half of alpha's old credentials and half of the new ones. `readOnly: true` applies to the whole mount including subdirectories, and the volume is `tmpfs`, never written to the node's disk.

File permissions come from `defaultMode` on the projected volume (default `0644`), or `mode` per item. `0400` is a common hardening step when the container runs as a known non-root user.

### Mixing source types

Sources are not limited to Secrets:

```yaml
projected:
  sources:
    - secret:
        name: tenant-alpha
        items: [{ key: DB_PASSWORD, path: alpha/DB_PASSWORD }]
    - configMap:
        name: app-settings
    - downwardAPI:
        items:
          - path: pod/namespace
            fieldRef: { fieldPath: metadata.namespace }
    - serviceAccountToken:
        audience: vault
        expirationSeconds: 3600
        path: tokens/vault
```

All referenced Secrets and ConfigMaps must live in the Pod's namespace. The same collision rule applies across source types (a `DB_PASSWORD` key in a ConfigMap listed later overwrites the Secret's), so give every source its own directory.

### Reading it from an application

Spring Boot reads a directory tree directly as configuration:

```properties
spring.config.import=optional:configtree:/run/secrets/
```

Folder and file names form the property name, so `/run/secrets/alpha/DB_PASSWORD` becomes `alpha.DB_PASSWORD`. The per-tenant directories from `items` turn into per-tenant property prefixes for free.

## Trade-offs

- **One projected volume vs one `secret` volume per Secret.** Separate volumes at separate mount paths make collisions impossible by construction, but every new tenant touches both `volumes` and `volumeMounts`. One projected volume is a single mount point, at the price of having to namespace keys yourself.
  ```yaml
  # collision-proof alternative: one mount per Secret
  volumeMounts:
    - { name: alpha, mountPath: /run/secrets/alpha, readOnly: true }
    - { name: beta,  mountPath: /run/secrets/beta,  readOnly: true }
  ```
- **`items` makes the Pod spec depend on the list of keys.** Adding a key to a Secret no longer reaches the app until the Pod spec lists it too. That is explicit and reviewable, but it is also one more place to forget.
- **Silent last-wins is a runtime bug, not a deploy-time error.** Nothing in the cluster catches it. Cover it with a test that reads the mounted files, as the lab does, or with a policy (Kyverno, OPA Gatekeeper) that requires `items` on projected secret sources.

## Documentation Links

- [Kubernetes docs: Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/): supported sources, `items`, `defaultMode`, `serviceAccountToken`.
- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): using Secrets as files, `optional`, automatic updates.
- [Configure a Pod to Use a Projected Volume for Storage](https://kubernetes.io/docs/tasks/configure-pod-container/configure-projected-volume-storage/): step-by-step task.
- [Spring Boot docs: Using Configuration Trees](https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.files.configtree): `configtree:` import and how paths become property names.
