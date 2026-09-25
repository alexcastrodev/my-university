---
version: 1.0
updatedAt: 2026-09-25
---
## Objective

A Kubernetes Secret is a small API object (at most 1 MiB) that holds key/value pairs of sensitive data, so the data lives outside your container image and your Pod spec. The name promises more than the object delivers: by default a Secret is base64-encoded, not encrypted, and anyone who can create a Pod in its namespace can read it. This concept covers what a Secret really is, how `kubectl create secret generic` turns an env file into one (including the inputs it rejects), how to update Secrets, and the access model you have to get right before any of it is actually secret.

## Use Cases

- Database credentials, API keys and webhook tokens per environment, kept out of Git and out of the image.
- One Secret per tenant or per downstream system (`tenant-alpha`, `tenant-beta`), so each can be rotated and permissioned on its own.
- TLS certificates for Ingress (`kubernetes.io/tls`) and registry credentials for image pulls (`kubernetes.io/dockerconfigjson`).
- Bootstrapping a Secret from the same `.env` file a developer already uses locally with Docker Compose.

## Deep Dive

### What is actually stored

A Secret is a map of keys to base64-encoded bytes, plus a `type`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tenant-alpha
  namespace: example
type: Opaque
data:
  DB_USER: YWxwaGFfYXBw         # "alpha_app"
  DB_PASSWORD: YWxwaGEtczNjcmV0 # "alpha-s3cret"
```

Base64 exists so arbitrary binary data (a keystore, a certificate) fits in JSON. It is an encoding, not a protection: `echo YWxwaGEtczNjcmV0 | base64 -d` is all it takes. Anyone who can `kubectl get secret -o yaml` has the plaintext.

`Opaque` is the generic type. The built-in types (`kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`, `kubernetes.io/basic-auth`, `kubernetes.io/ssh-auth`, `kubernetes.io/service-account-token`) only add validation of the required keys; they are not stored any differently.

When writing YAML by hand, `stringData` accepts plain text and the API server encodes it into `data` for you. `stringData` is write-only: you never see it when reading the Secret back.

### Creating a Secret from an env file

The shortest path from a local `.env` to a cluster is:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-env-file=secrets/example/alpha.env

kubectl -n example create secret generic tenant-beta \
  --from-env-file=secrets/example/beta.env
```

Each `KEY=value` line becomes one key of the Secret. The parsing is stricter and more literal than most `.env` loaders, which is where the surprises are (all verified against kubectl v1.36):

| Line in the env file | Result |
|---|---|
| `# comment` or blank line | ignored |
| `URL=postgres://u:p@h/db?x=1` | everything after the first `=` is the value, `=` and `:` included |
| `QUOTED="with quotes"` | value is `"with quotes"`, quotes included. kubectl does **not** strip them |
| `SPACED=  padded  ` | whitespace in the value is kept |
| `EMPTY=` | key created with an empty value |
| `KEY = value` | **rejected**: `"KEY " is not a valid key name` |
| the same key twice (in one file, or across two `--from-env-file` flags) | **rejected**: `cannot add key ..., another key by that name already exists` |

The quotes row is the classic production bug: a `.env` that works with Docker Compose or `dotenv` suddenly yields a password with literal quote characters in Kubernetes.

The other sources are `--from-literal=KEY=value` (repeatable, fine for demos, but the value lands in your shell history) and `--from-file=[key=]path`, which uses the whole file content as one value (the file name is the key unless you give one). `--from-file` is the right choice for certificates, keystores and anything multi-line.

### Updating a Secret

`kubectl create` fails if the Secret already exists. The idiomatic update is to render and apply:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-env-file=secrets/example/alpha.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

If the Secret was originally made with plain `kubectl create`, the first `apply` prints a warning about the missing `last-applied-configuration` annotation and patches it in. Creating with `--save-config`, or always going through `apply`, avoids that.

For values that must never change once deployed, mark the Secret `immutable: true`. Any later change to `data` is refused (`field is immutable when immutable is set`); you delete and recreate it under a new name instead. Besides protecting against accidental edits, immutable Secrets let the kubelet stop watching them, which reduces API server load in clusters with thousands of Secrets.

### Who can really read a Secret

This is the part that makes or breaks the whole thing:

- **Storage.** By default Secrets sit in etcd unencrypted. Encryption at rest needs an `EncryptionConfiguration` on the API server (ideally with a KMS provider). Managed clusters (EKS, GKE, AKS) usually offer it as a setting, but check it is on.
- **RBAC.** `get` on `secrets` reveals the value, and so does `list` and `watch`: listing returns full objects, not just names. Granting `list secrets` "just to see what exists" grants every value in the namespace.
- **Pod creation.** Anyone who can create a Pod in a namespace can mount any Secret in that namespace and read it from inside the container. Namespace boundaries, not RBAC on the Secret alone, are the real isolation unit.
- **Nodes.** The kubelet only fetches Secrets for Pods scheduled on its node, and keeps them in `tmpfs`, never on disk. Root on a node still means access to everything mounted there.

## Trade-offs

- **Native Secrets are simple but only as safe as your cluster configuration.** Without encryption at rest and tight RBAC, a Secret is a ConfigMap with a scarier name. The alternative is an external manager (Vault, AWS Secrets Manager, GCP Secret Manager) synchronized by the External Secrets Operator or mounted by the Secrets Store CSI Driver. That buys audit logs and central rotation at the cost of another system to run.
- **`--from-env-file` is convenient but literal.** It reuses the file developers already have, but quoting that works locally breaks silently in the cluster:
  ```bash
  # .env used with Docker Compose
  API_KEY="abc123"   # Compose: abc123, kubectl: "abc123" (with the quotes)
  ```
- **Imperative `kubectl create` does not fit GitOps.** Git cannot hold plaintext Secrets, so GitOps teams encrypt them before committing (Sealed Secrets, SOPS) or reference external managers instead. The `kubectl create ... --dry-run=client -o yaml` output is a good starting point for either.
- **`immutable: true` trades flexibility for safety and scale.** Rotation becomes "create `tenant-alpha-v2`, point the Deployment at it, delete v1", which is more steps but gives you an automatic rollout and a clean rollback.

## Documentation Links

- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): types, `data` vs `stringData`, immutable Secrets, size limit.
- [Managing Secrets using kubectl](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kubectl/): `create secret generic`, editing and decoding.
- [kubectl create secret generic](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_generic/): every flag, including `--from-env-file`.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): RBAC, least privilege, encryption.
- [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/): `EncryptionConfiguration` and KMS providers.
