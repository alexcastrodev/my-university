---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A ConfigMap holds non-sensitive configuration as key/value pairs, so the same image can run in every environment with different settings. Containers consume it in two ways: as **environment variables** (one key with `configMapKeyRef`, or all keys with `envFrom`) or as **files** in a volume. Secrets use the same mechanics (`secretKeyRef`, `secretRef`). This concept covers the environment variable path: precedence rules, what happens with missing keys and odd key names, why a changed ConfigMap does not reach a running container, and the ConfigMap/Secret types you will meet.

## Use Cases

- Setting the application mode, log levels and feature flags per environment.
- Injecting a database password from a Secret as `DB_PASSWORD` next to non-secret settings from a ConfigMap.
- Reusing one ConfigMap across the API, consumers and jobs that share an image.
- Debugging a Pod stuck in `CreateContainerConfigError`.

## Deep Dive

### Creating ConfigMaps

```bash
kubectl -n team-a create configmap app-config \
  --from-literal=APP_MODE=production \
  --from-literal=LOG_LEVEL=INFO \
  --from-env-file=app.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: app-config, namespace: team-a}
data:
  APP_MODE: production
  LOG_LEVEL: INFO
  application.yaml: |          # a whole file as one key, typically mounted as a volume
    server:
      port: 8080
```

Values are always strings. `true` or `8080` must be quoted in YAML (`"true"`), otherwise the API rejects the object. The total size limit is 1 MiB.

### envFrom: every key becomes a variable

```yaml
containers:
  - name: app
    image: registry.example.com/demo/web-app:1.4.2
    envFrom:
      - configMapRef: {name: app-config}
      - secretRef: {name: db-credentials}
      - configMapRef: {name: tenant-settings}
        prefix: TENANT_                 # TENANT_<key>
    env:
      - name: LOG_LEVEL                  # explicit env wins over envFrom
        value: WARN
      - name: DB_PASSWORD
        valueFrom:
          secretKeyRef: {name: db-credentials, key: password}
      - name: POD_NAME
        valueFrom:
          fieldRef: {fieldPath: metadata.name}
```

Precedence, verified: a key `LOG_LEVEL=INFO` in the ConfigMap and `env: LOG_LEVEL=WARN` in the Pod produce `LOG_LEVEL=WARN`. Explicit `env` always overrides `envFrom`. Between several `envFrom` sources with the same key, the **last** one listed wins, silently.

### Key names

Keys that are not valid shell identifiers used to be skipped by `envFrom` with an `InvalidEnvironmentVariableNames` event. Current Kubernetes relaxed that rule (any printable ASCII except `=`). Verified on v1.36: keys `app.name`, `log-level` and `1BAD` all arrived in the environment unchanged.

That is valid for the kernel but not for every consumer: a shell cannot reference `$log-level`, and many configuration libraries that map `LOG_LEVEL` to a setting do not recognise `log-level`. Keep ConfigMap keys meant for `envFrom` in `UPPER_SNAKE_CASE`.

### Missing ConfigMaps and keys

A reference to a key that does not exist blocks the container from starting:

```
$ kubectl get pod envmissing
NAME         READY   STATUS                       RESTARTS   AGE
envmissing   0/1     CreateContainerConfigError   0          12s

message: couldn't find key nope in ConfigMap lab/appcfg
```

The same happens when the whole ConfigMap or Secret is missing, which is common when the application is applied before its configuration. The Pod recovers on its own once the object exists (the kubelet retries). If the value is genuinely optional, say so:

```yaml
envFrom:
  - configMapRef: {name: tenant-overrides, optional: true}
```

### Changes do not reach running containers

Environment variables are read once, when the container starts. Updating the ConfigMap changes nothing in running Pods, and `kubectl apply` on the Deployment does not restart them either, because the Pod template did not change. Two ways to roll it out:

```bash
kubectl -n team-a rollout restart deployment/api       # manual, after changing the ConfigMap
```

or make the change part of the Pod template automatically: Kustomize's `configMapGenerator` appends a content hash to the ConfigMap name (`app-config-g5t6m8m4hk`) and rewrites every reference, so new content means a new name, a changed template and a rolling update. See the Kustomize generators concept.

Mounted ConfigMap files, in contrast, are updated in place after about a minute, but only if the application re-reads them.

### Variables you did not define: service links

Kubernetes also injects Docker-link style variables for every Service in the Pod's namespace that existed when the Pod started. Verified on k3s v1.36 with a Service named `redis` in the namespace:

```
REDIS_PORT=tcp://10.43.51.106:6379
REDIS_PORT_6379_TCP=tcp://10.43.51.106:6379
REDIS_PORT_6379_TCP_ADDR=10.43.51.106
REDIS_SERVICE_HOST=10.43.51.106
REDIS_SERVICE_PORT=6379
...
```

That is harmless until the application itself reads a variable with the same name. An app that expects `REDIS_PORT=6379` now gets `tcp://10.43.51.106:6379` and fails to parse it, or a tool that turns every `PREFIX_*` variable into configuration picks up junk keys. The fix is one line:

```yaml
spec:
  enableServiceLinks: false
```

Verified: with it, none of the `REDIS_*` variables appear. Services are found through DNS anyway, so most workloads lose nothing. (`KUBERNETES_SERVICE_HOST`/`PORT` for the API server are always injected.)

### Types of Secrets you will meet

ConfigMaps have no type. Secrets do, and the type validates the keys:

| Type | Required keys | Used for |
|---|---|---|
| `Opaque` | any | application credentials (default) |
| `kubernetes.io/dockerconfigjson` | `.dockerconfigjson` | registry credentials for `imagePullSecrets` |
| `kubernetes.io/tls` | `tls.crt`, `tls.key` | TLS certificates (Ingress, cert-manager) |
| `kubernetes.io/basic-auth` | `username`, `password` | documentation value mostly |
| `kubernetes.io/service-account-token` | managed by Kubernetes | legacy long-lived ServiceAccount tokens |

An `Opaque` Secret can be consumed with `envFrom`/`secretKeyRef` exactly like a ConfigMap. A `dockerconfigjson` Secret is for the kubelet, not for the application.

### Env vars vs files for configuration

- Env vars are simple, visible in `kubectl describe` only as references, and easy for any framework to read. They are fixed for the life of the container.
- Files support structured config (a whole `application.yaml`), can be updated in place, and leak less when they carry secrets.

## Trade-offs

- **`envFrom` vs explicit `env`.** `envFrom` is short and picks up new keys automatically; explicit `env` entries document exactly what the app consumes and fail loudly on missing keys. A common compromise: `envFrom` for a ConfigMap owned by the app, explicit `secretKeyRef` for each secret.
- **One big ConfigMap vs several.** One per concern (app, tenant, feature flags) keeps ownership clear; each extra source adds another silent last-wins collision risk.
- **Restart on change vs hot reload.** Restarting is predictable and works for every app; hot reload of mounted files avoids restarts but needs code that re-reads configuration safely.

## Documentation Links

- [Kubernetes docs: ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/): creation, consumption, immutable ConfigMaps.
- [Kubernetes docs: Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/): `envFrom`, `prefix`, `optional`.
- [Kubernetes docs: Define Environment Variables for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/): `env`, `valueFrom`, dependent variables.
- [Kubernetes docs: Secret types](https://kubernetes.io/docs/concepts/configuration/secret/#secret-types): built-in types and required keys.
