---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Overlays change the base with **patches**. Kustomize supports two formats: a **strategic merge patch** (a partial YAML of the object, merged with Kubernetes-aware list semantics) and a **JSON 6902 patch** (a list of `add`/`replace`/`remove` operations on exact paths). Both live under the single `patches:` field, and both can be aimed at many resources at once with a `target` (by kind, name regex, labels or annotations). Knowing how each treats lists is the difference between adding an environment variable and silently wiping the others. This concept covers both formats, targets, and the list behaviours that bite.

## Use Cases

- Setting resources, replicas or extra environment variables for one environment.
- Applying the same change to every Deployment with a given label (all workers, all web Pods).
- Removing something the base defines (a sidecar, an env var, a probe).
- Inserting into or replacing an item at a precise position in a list.

## Deep Dive

### Strategic merge patch

A partial object with `apiVersion`, `kind` and `metadata.name` to identify the target:

```yaml
patches:
  - patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata: {name: web}
      spec:
        replicas: 3
        template:
          spec:
            containers:
              - name: app                       # matched by name, not position
                resources:
                  requests: {memory: 512Mi}
                  limits: {memory: 1Gi}
                env:
                  - {name: NEW_VAR, value: "1"} # merged into env by name
```

Maps are merged recursively. Lists are the subtle part: Kubernetes types declare a **merge key** for some lists, and those are merged item by item; lists without one are **replaced entirely**.

| List | Behaviour in a strategic merge patch |
|---|---|
| `containers`, `initContainers` | merged by `name` |
| `env` | merged by `name` |
| `volumes` | merged by `name` |
| `volumeMounts` | merged by `mountPath` |
| `ports` (container) | merged by `containerPort` |
| `args`, `command` | **replaced** |
| `envFrom` | **replaced** |
| `imagePullSecrets` | merged by `name` |

Verified: a patch with `args: ["worker", "--concurrency=4"]` replaced the base's args completely, and an `env` entry in the patch was added next to the base's entries. A patch listing one `envFrom` source replaced all the base's sources, which is a silent way to lose a ConfigMap reference.

Directives modify the default:

```yaml
env:
  - name: DEBUG_OPTS
    $patch: delete                  # remove this item from a merged list
```

```yaml
containers:
  - name: sidecar
    $patch: delete                  # remove a whole container
```

`$patch: replace` works on maps and on merged lists. Do not use it on lists that are replaced anyway: verified, placing `- $patch: replace` in an `envFrom` list left the directive **literally** in the rendered output as a bogus list item.

### JSON 6902 patch

Operations on exact paths. Needs a `target` because the patch itself does not name the object:

```yaml
patches:
  - target: {kind: Deployment, name: worker}
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/env/-     # append to the list
        value: {name: TZ, value: America/New_York}
      - op: replace
        path: /spec/replicas
        value: 3
      - op: remove
        path: /spec/template/spec/containers/0/livenessProbe
```

- Paths use indexes (`containers/0`), so they depend on the order in the base. Reordering containers in the base silently retargets the patch.
- `-` means "end of the list".
- `add` requires the parent to exist. Verified: `add .../env/-` on a container **without** an `env` list fails the whole build with `add operation does not apply: doc is missing path`. Add the list itself (`path: .../env`, `value: [...]`) where it may not exist, or use a strategic merge patch.
- `test` operations make a patch fail unless a value is what you expect, a cheap safety net for index-based paths.

### Targets: one patch, many resources

```yaml
patches:
  - target:
      kind: Deployment
      labelSelector: role=worker          # all worker Deployments
    patch: |-
      - op: add
        path: /spec/replicas
        value: 3
  - target:
      kind: Deployment
      name: "web|worker"                  # regex on the name
    path: extra-env.yaml                  # patch in a file, strategic or JSON
```

Target fields: `group`, `version`, `kind`, `name` (regex), `namespace`, `labelSelector`, `annotationSelector`. Verified: the `labelSelector: role=worker` patch set `replicas: 3` on the `worker` Deployment only.

A strategic merge patch used with a `target` is applied to every match; its own `metadata.name` is then ignored for matching, which is how one "add these environment variables" file can serve all Deployments.

### Choosing

| Need | Format |
|---|---|
| Change fields, add/override env vars, set resources | strategic merge |
| Remove an item from a merged list | strategic merge with `$patch: delete` |
| Append to a list without merge key, or insert at a position | JSON 6902 |
| Same change on many resources | either, with `target` |
| Custom resources (CRDs) | JSON 6902 (no merge keys known, strategic merge replaces all lists) |

### Keeping patches honest

- Render and review: `kubectl kustomize overlays/staging | less`. A patch that targets nothing is not always an error (a `labelSelector` that matches zero resources applies zero times, silently).
- Prefer small patch files named after their intent (`resources-large.yaml`, `debug-logging.yaml`) over one giant patch per overlay.
- When a base changes the order of containers or list items, re-render every overlay that uses JSON 6902 index paths.

## Trade-offs

- **Strategic merge vs JSON 6902.** Strategic merge reads like the object and survives reordering, but its list semantics depend on hidden merge keys. JSON 6902 is explicit and precise, and brittle against index changes and missing parents.
- **Targeted patches vs per-resource patches.** Targets remove duplication across many resources; they also make it less obvious, from the resource's point of view, what modified it.
- **Patching vs parameterising the base.** Many patches for the same field in every overlay signal that the base should expose it differently (a generator value, a replacement, or a component).

## Lab

In this lab you get a production overlay with three faulty patches: one breaks the build, one silently drops configuration and one misses Deployments it should cover. Your job is to fix all three, editing only the files under `overlays/production`. The core idea is to feel when to use each kind of patch: JSON 6902 is precise but depends on paths that exist, and strategic merge combines lists by key (like `env` by `name`) but replaces lists with no merge key (like `envFrom`).

**The scenario**

The base has three Deployments, all reading the `app-config` ConfigMap through `envFrom`: `web` (label `role: web`, with an `env` list) and two workers, `worker` and `worker-emails` (label `role: worker`, no `env` list). The tests build and apply the overlay on a real k3s started by Testcontainers and inspect the resulting Deployments. The overlay must:

- add `TZ=UTC` to every Deployment, without losing `web`'s own `PORT`;
- give `worker` the `worker-secrets` Secret in addition to `app-config`;
- run every worker with 3 replicas, while `web` keeps 2.

The files:

- `overlays/production/kustomization.yaml`: the patches, with a `TODO` comment on each.
- `overlays/production/worker-secrets-patch.yaml`: the strategic merge patch for `worker`.
- `overlays/production/worker-secrets.yaml`: the `worker-secrets` Secret. Given.
- `base/`: the three Deployments and the `app-config` `configMapGenerator`. Do not touch.

**What you will do, step by step**

1. **Build the overlay and read the error.** See the result with `kubectl kustomize src/main/resources/kustomize/overlays/production`. Today the build fails with `doc is missing path`.
2. **Fix the timezone patch (TODO-00).** The JSON 6902 patch appends to the end of the `env` list, which only `web` has, so the whole build fails. Rewrite it as a strategic merge, which combines `env` by `name`, so it works with and without an `env` list, without adding an `env` list to the base.
3. **Do not lose `app-config` in the worker (TODO-01).** `envFrom` has no merge key, so strategic merge replaces the whole list and the patch drops the ConfigMap reference. Adjust the patch to keep both sources.
4. **Select the workers by label (TODO-02).** The replicas patch picks the Deployment by name, so `worker-emails` is left out. Select by the label `role=worker` so it also covers workers added to the base later.

**How you know you are done**

`mvn -pl kubernetes-concepts/kustomize-patches test` passes `overlayBuilds`, `everyDeploymentGetsTimezone`, `workerKeepsSharedConfigAndGetsItsSecret` and `everyWorkerHasThreeReplicas`. You should be able to explain why each patch failed and how JSON 6902 and strategic merge treat lists differently.

**Optional challenges**

- **TODO-03:** remove `web`'s liveness probe (add one to the base first) with a strategic merge patch using `$patch: delete`, then with a JSON 6902 `remove` operation. Which one breaks if the base's container order changes?

**Prerequisites:** Docker running (the tests start a `rancher/k3s` container), Java and Maven, and the article Kustomize Patches: Strategic Merge vs JSON 6902.

**How to run it:** clone the repository and, from its root, run `mvn -pl kubernetes-concepts/kustomize-patches test`. To see the rendered YAML while you work, use `kubectl kustomize src/main/resources/kustomize/overlays/production`. The `TODO-00`, `TODO-01` and `TODO-02` comments mark what is left.

## Documentation Links

- [Kustomize reference: patches](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/patches/): formats, targets, inline and file patches.
- [Kubernetes docs: Update API Objects in Place Using kubectl patch](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/): strategic merge semantics, merge keys, directives.
- [Strategic merge patch design](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/strategic-merge-patch.md): `$patch`, `$retainKeys`, list rules.
- [RFC 6902: JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902): operations and path syntax.
