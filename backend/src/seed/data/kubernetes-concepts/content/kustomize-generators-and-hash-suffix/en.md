---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Kustomize can create ConfigMaps and Secrets from literals, `.env` files and plain files, instead of you writing them as YAML. The generated objects get a **hash suffix** computed from their content (`app-config-g5t6m8m4hk`), and Kustomize rewrites every reference to them. The consequence is the main reason to use generators: change a value, and the Pod templates that reference it change too, which triggers a rolling update automatically. This concept covers `configMapGenerator` and `secretGenerator` (literals, `envs`, `files`, `type`), `behavior: merge` and `replace` across layers, the hash suffix and when to disable it.

## Use Cases

- Per-environment configuration layered on top of shared defaults.
- Creating the database and registry Secrets for an environment from local `.env` and JSON files that never enter Git.
- Restarting Pods automatically when their configuration changes.
- Objects that external tools reference by a fixed name (and so must not get a suffix).

## Deep Dive

### configMapGenerator

```yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=INFO
      - FEATURE_X=false
    envs:
      - app.env                      # KEY=VALUE lines, each becomes a key
    files:
      - application.yaml             # key = file name, value = content
      - logging=logging-prod.yaml    # key renamed to "logging"
```

`literals` and `envs` produce one key per variable, ideal for `envFrom`. `files` produce one key per file, ideal for volume mounts.

### Layering: behavior merge and replace

A generator in an overlay with the same name as one in the base must say what to do. Verified: omitting `behavior` fails the build:

```
Error: merging from generator ... ConfigMap ... Name:"app-config" ... exists;
can not use behavior: 'unspecified', behavior must be merge or replace
```

- `behavior: merge` adds keys and overrides existing ones. Verified: base `LOG_LEVEL=info, FEATURE_X=false` + component `LOG_LEVEL=debug` + overlay `FEATURE_X=true, ENVIRONMENT=staging` produced `ENVIRONMENT=staging, FEATURE_X=true, LOG_LEVEL=debug`.
- `behavior: replace` discards the base's data entirely. Verified: `replace` with `ONLY=1` produced a ConfigMap containing only `ONLY: "1"`.
- `behavior: create` (the default) requires that no object with that name exists yet.

### secretGenerator

```yaml
secretGenerator:
  - name: db-credentials
    envs: [db.env]                                   # DB_USER=..., DB_PASSWORD=...
  - name: client-tls
    files: [ca.crt, client.properties]
  - name: regcred
    type: kubernetes.io/dockerconfigjson
    files: [.dockerconfigjson=registry-config.json]
  - name: api-tls
    type: kubernetes.io/tls
    files: [tls.crt=certs/api.crt, tls.key=certs/api.key]
```

- `type` defaults to `Opaque`. Typed Secrets need the right key names (`.dockerconfigjson`, `tls.crt`/`tls.key`), hence the `key=file` renaming syntax.
- The source files are read at build time from the overlay directory. Keep them out of Git (`.gitignore`), in a password manager, or encrypted (SOPS with a Kustomize plugin like KSOPS). A secretGenerator whose `.env` is committed in plain text is no better than a committed Secret YAML.
- Env file rules match `kubectl --from-env-file`: one `KEY=VALUE` per line, `#` comments, and quotes are kept literally as part of the value.

### The hash suffix and automatic rollouts

The generated name is `<name>-<hash of content>`, and Kustomize rewrites references in `envFrom`, `env.valueFrom`, `volumes`, `imagePullSecrets` and other known fields. Verified in the overlay build: `configMapRef: {name: app-config-g5t6m8m4hk}` and `secretRef: {name: db-credentials-dfcfkgfmh9}`.

Change one value and the hash changes, so:

1. a **new** ConfigMap is created (the old one is not modified),
2. the Deployment's Pod template now references the new name,
3. the template change triggers a normal rolling update,
4. rolling back the Deployment (`rollout undo`) restores the reference to the old ConfigMap, which still exists, so config and code roll back together.

Without the suffix, updating a ConfigMap changes nothing in running Pods that read it as environment variables, and nothing restarts them.

The flip side: old generated ConfigMaps and Secrets are never deleted by `kubectl apply -k`. They accumulate. Clean them up periodically, or apply with pruning (`kubectl apply --prune` with a label selector, or ApplySets), knowing that pruning removes the old object that `rollout undo` would need.

### Disabling the suffix

Some consumers need a stable name: a Secret referenced by an Ingress's `tls.secretName` from another tool, a ConfigMap read by name by an operator, a registry Secret patched into a ServiceAccount.

```yaml
generatorOptions:
  disableNameSuffixHash: true        # for every generator in this kustomization
```

or per generator:

```yaml
secretGenerator:
  - name: regcred
    type: kubernetes.io/dockerconfigjson
    files: [.dockerconfigjson=registry-config.json]
    options:
      disableNameSuffixHash: true
```

Verified: with `disableNameSuffixHash: true` the Secrets were named exactly `regcred` and `certs`. You then lose the automatic rollout for those objects; restart consumers yourself after changing them (`kubectl rollout restart`).

`generatorOptions` also sets `labels` and `annotations` on generated objects, and `immutable: true` marks them immutable (fewer watches on the API server; any change must produce a new name, which the hash already does).

## Trade-offs

- **Hash suffix vs stable names.** The suffix gives automatic, reversible rollouts of configuration and accumulates old objects; stable names are simple to reference and need manual restarts.
- **Generators vs YAML ConfigMaps.** Generators keep config in natural formats (`.env`, `.yaml`, `.conf`) and add the hash; plain YAML objects are what you see is what you get, without references being rewritten.
- **Secrets from local files vs a secrets manager.** Local files are simple and depend on the machine running the build; External Secrets Operator or Sealed Secrets keep secrets reproducible from Git or a vault, at the cost of another component.

## Lab

In this lab you get a base and a `staging` overlay where the Pod works, but a configuration change never reaches it and the database password comes from a file committed to Git. Your job is to replace the hand-written ConfigMap and Secret YAML with Kustomize generators. The core idea is to feel that the hash suffix the generator adds to the name changes the Pod template when the content changes, and that is what turns new configuration into a rollout on its own.

**The scenario**

A base has a `web` Deployment that reads the `app-config` ConfigMap and the `db-credentials` Secret through `envFrom`. The tests run on a real k3s started by Testcontainers, whose `kubectl` already includes Kustomize: they apply `overlays/staging`, change `GREETING` in your files from `hi-staging` to `hi-v2`, apply again and expect the Pod to see the new value within a minute.

- `base/deployment.yaml`: the `web` Deployment.
- `base/configmap.yaml` and `base/kustomization.yaml`: the hand-written ConfigMap (`GREETING=hello`, `LOG_LEVEL=info`) and the resource list.
- `overlays/staging/kustomization.yaml`: the overlay, which uses `config-patch.yaml` to override values and includes `secret.yaml`.
- `overlays/staging/config-patch.yaml`, `secret.yaml` and `db.env`: the patch, the Secret with the password in the repository and the `.env` file with the value.

You edit only files under `kustomize/`. To see what you are building, use `kubectl kustomize src/main/resources/kustomize/overlays/staging`.

**What you will do, step by step**

1. **Run the tests first.** The Pod works, but `changingAValueRollsOutTheDeployment` shows the new value never arrives, because nothing in the Pod template changed and nothing restarted.
2. **Generate `app-config` in the base (TODO-00).** In `base/kustomization.yaml`, delete `configmap.yaml` and generate `app-config` with a `configMapGenerator`, with the same two keys. A plain ConfigMap keeps the same name forever; the generated one gets a hash suffix.
3. **Merge the staging values (TODO-01).** In `overlays/staging/kustomization.yaml`, replace the patch with a `configMapGenerator` entry that merges `GREETING=hi-staging` and `ENVIRONMENT=staging` into the base values, and delete `config-patch.yaml`. The base's `LOG_LEVEL` must still be there.
4. **Generate the Secret from the `.env` file (TODO-02).** Delete `secret.yaml` and generate `db-credentials` with a `secretGenerator` reading `db.env`. In a real project this file would stay out of Git.

**How you know you are done**

`mvn -pl kubernetes-concepts/kustomize-generators-and-hash-suffix test` passes `baseAndOverlayValuesAreMerged`, `configMapNameCarriesAContentHash`, `secretIsGeneratedFromTheEnvFile` and `changingAValueRollsOutTheDeployment`. You should be able to explain why the hash makes the Deployment restart and why Kustomize rewrites the references to the generated name.

**Optional challenges**

- **TODO-03:** with the tests passing, run `kubectl kustomize` twice with different values and compare the ConfigMap names. What happens to the old ConfigMaps in a cluster after many deploys, and why is keeping them useful for `kubectl rollout undo`?

**Prerequisites:** Docker running (the tests start a `rancher/k3s` container and pull `busybox` inside it), Java and Maven, and the articles Kustomize: Bases, Overlays and Components and Kustomize Generators and the Hash Suffix.

**How to run it:** clone the repository and, from its root, run `mvn -pl kubernetes-concepts/kustomize-generators-and-hash-suffix test`. The `TODO-00`, `TODO-01` and `TODO-02` comments in the `kustomization.yaml` files mark what is left.

## Documentation Links

- [Kustomize reference: configMapGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/configmapgenerator/): sources, behavior, options.
- [Kustomize reference: secretGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/secretgenerator/): typed Secrets and file keys.
- [Kustomize reference: generatorOptions](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/generatoroptions/): hash suffix, labels, immutable.
- [Kubernetes docs: Managing Secrets using Kustomize](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kustomize/): end-to-end example.
