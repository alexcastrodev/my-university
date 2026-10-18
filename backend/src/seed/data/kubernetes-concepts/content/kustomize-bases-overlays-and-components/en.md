---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Kustomize builds Kubernetes manifests by layering plain YAML, with no templating language. A **base** holds what every environment shares, an **overlay** takes a base and changes what differs (namespace, image tag, replicas, configuration), and a **component** is an optional, reusable slice of changes that several overlays can opt into. It is built into `kubectl` (`kubectl apply -k`), which makes it the zero-dependency way to deploy the same application to several environments. This concept covers the directory layout, how the pieces compose, and how to see exactly what will change before applying.

## Use Cases

- One application deployed to staging and production (or per customer) from one set of manifests.
- Optional features switched on per environment: debug logging, an extra worker, a monitoring sidecar.
- Reviewing the full rendered YAML of a change in a pull request.
- Checking what `apply` would change in the live cluster before running it.

## Deep Dive

### Layout

```
k8s/
  base/
    kustomization.yaml
    deployment.yaml          # web and worker Deployments
    job.yaml                 # migrate Job
  components/
    debug/
      kustomization.yaml     # kind: Component
  overlays/
    staging/
      kustomization.yaml
      db.env                 # never committed
    production/
      kustomization.yaml
      db.env
```

The base, knowing nothing about environments:

```yaml
# base/kustomization.yaml
resources: [deployment.yaml, job.yaml]
labels:
  - pairs: {app.kubernetes.io/part-of: web-app}
configMapGenerator:
  - name: app-config
    literals: [LOG_LEVEL=info, FEATURE_X=false]
```

A component, a reusable delta:

```yaml
# components/debug/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
configMapGenerator:
  - name: app-config
    behavior: merge
    literals: [LOG_LEVEL=debug]
```

An overlay that uses both:

```yaml
# overlays/staging/kustomization.yaml
namespace: web-staging
resources: [../../base]
components: [../../components/debug]
images:
  - name: registry.example.com/demo/web-app
    newName: registry.internal:5000/demo/web-app
    newTag: "1.4.2"
configMapGenerator:
  - name: app-config
    behavior: merge
    literals: [FEATURE_X=true, ENVIRONMENT=staging]
secretGenerator:
  - name: db-credentials
    envs: [db.env]
```

### What the build produces

Verified with `kubectl kustomize overlays/staging` (kubectl 1.36, Kustomize v5.8):

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-g5t6m8m4hk
  namespace: web-staging
  labels: {app.kubernetes.io/part-of: web-app}
data:
  ENVIRONMENT: staging
  FEATURE_X: "true"
  LOG_LEVEL: debug           # from the component
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: web-staging
  labels: {app.kubernetes.io/part-of: web-app, role: web}
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.internal:5000/demo/web-app:1.4.2
          envFrom:
            - configMapRef: {name: app-config-g5t6m8m4hk}      # reference rewritten
            - secretRef: {name: db-credentials-dfcfkgfmh9}
```

- `namespace:` is set on every namespaced resource.
- The ConfigMap merges base, component and overlay values, and its name gets a content hash that every reference follows.
- The image transformer rewrote the image in both Deployments **and** the Job.
- The Secret generated in the overlay did not receive the base's `labels` (labels declared in a kustomization apply to the resources of that kustomization and below, not to what an overlay generates).

The order of operations: resources from `resources:` are loaded (recursively built if they are directories with a kustomization), components are applied, then the overlay's own transformers and generators.

### resources vs components

- `resources:` are things that exist on their own: files or other kustomizations. Adding the same base twice is an error (duplicate IDs).
- `components:` are applied **to** the accumulated resources and can patch, add generators and add resources. They are the answer to "these three overlays need the debug settings, those two do not" without copy-paste or deep inheritance chains.

Keep inheritance shallow: base, then overlay, with components for optional features. Overlays built on overlays on overlays become hard to reason about.

### labels vs commonLabels

```yaml
labels:
  - pairs: {app.kubernetes.io/part-of: web-app}
    includeSelectors: false      # default: metadata only
```

`commonLabels` is deprecated (Kustomize prints `Warning: 'commonLabels' is deprecated. Please use 'labels' instead`). It also added labels to selectors, and since `spec.selector` of a Deployment is immutable, adding a common label after the first deploy breaks every later apply. `labels` without `includeSelectors` only touches metadata, which is almost always what you want.

### Preview before applying

```bash
kubectl kustomize overlays/staging                    # render to stdout
kubectl kustomize overlays/staging > /tmp/stg.yaml    # review or archive as an artefact
kubectl diff -k overlays/staging                      # live cluster vs rendered result
kubectl apply -k overlays/staging
```

`kubectl diff` asks the API server to compute what `apply` would produce (server-side dry run) and shows a unified diff against live objects. Exit codes make it scriptable: `0` no differences, `1` differences, greater than `1` an error.

Verified gotcha: when a changed image tag affects an immutable Job, `kubectl diff -k` exits with `2` and prints `field is immutable` for the Job, because the server rejects the dry run. Pipelines that treat any non-zero code as "has changes" misread that. Handle the Job separately (see the Jobs concept).

The standalone `kustomize` binary is often newer than the one embedded in kubectl (`kubectl version --client` prints the embedded Kustomize version). Use the same one in CI and locally to avoid rendering differences.

## Trade-offs

- **Kustomize vs Helm.** Kustomize keeps manifests as valid, readable YAML and needs nothing beyond kubectl, but has no packaging, versioning or release history. Helm is better for distributing software to others; Kustomize is often simpler for your own applications. They also combine: `helmCharts:` in Kustomize, or Kustomize as a Helm post-renderer.
- **Components vs more overlays.** Components avoid duplication for optional features; too many of them make it hard to see what an environment contains without rendering it.
- **Rendering in CI vs applying directly.** Archiving the rendered YAML gives an exact record of what was deployed; applying with `-k` directly is simpler and depends on the Kustomize version at apply time.

## Lab

In this lab you get a `base` with a `web` Deployment, a `metrics` Component and two overlays (`prod` and `dev`) with four defects. Your job is to fix the overlays, without touching the base or the Component. The core idea is to feel that each environment should declare only what sets it apart from the base: `prod` includes a Component the right way and applies patches by the right name, and `dev` stops being a copy that drifts and starts inheriting from the base. The test proves this by changing the base image, as a new release would, and requiring both overlays to follow it without being edited.

**The scenario**

The tests render the overlays with the Kustomize built into `kubectl`, using a k3s container started by Testcontainers just to have `kubectl`. Before rendering, they change the base image from `busybox:1.37` to `busybox:1.38`.

- `src/main/resources/kustomize/base`: the `web` Deployment (1 replica, `LOG_LEVEL=info`). It is correct.
- `src/main/resources/kustomize/components/metrics`: a Component that adds the Prometheus scrape annotations. It is correct.
- `overlays/prod`: namespace `shop-prod`, prefix `prod-`, 3 replicas, `LOG_LEVEL=warn` and with the scrape annotations. It uses `replicas.yaml` as a patch.
- `overlays/dev`: namespace `shop-dev`, prefix `dev-`, 1 replica, `LOG_LEVEL=debug` and no scraping. Today it has a `web.yaml` that is a copy of the base.

**What you will do, step by step**

1. **Run the tests and read the `kubectl kustomize` error.** It explains each failure precisely.
2. **Include the Component the right way (TODO-00).** `prod` lists the Component under `resources`, and `kubectl kustomize` refuses, because a Component is not a resource. It has its own field in the Kustomization.
3. **Fix the replicas patch (TODO-01).** The patch matches nothing. Think about which name a patch uses: the base's or the one that appears after `namePrefix`.
4. **Set `LOG_LEVEL=warn` in prod (TODO-02).** Add a patch that changes the variable in this overlay only.
5. **Build dev on top of the base (TODO-03).** `dev` only works because `web.yaml` is a copy, and copies drift. Replace the copy with a reference to the base and change only what differs (replicas and `LOG_LEVEL`), so `dev` inherits the new image.

**How you know you are done**

`mvn -pl kubernetes-concepts/kustomize-bases-overlays-and-components test` passes `prodRendersAsSpecified`, `devRendersAsSpecified` and `everyOverlayFollowsTheBase`. You should be able to explain why the Component goes in a different field, which name the patch sees and why a copy of the base is a liability.

**Optional challenges**

- **TODO-04:** add a `staging` overlay that is scraped like prod but has 1 replica and `LOG_LEVEL=info`. How many new files does it need, and why is the Component the right place for the annotations rather than the base?

**Prerequisites:** Docker running (the tests start a `rancher/k3s` container for its `kubectl`), Java and Maven, and the article Kustomize: Bases, Overlays and Components.

**How to run it:** clone the repository and, from its root, run `mvn -pl kubernetes-concepts/kustomize-bases-overlays-and-components test`. The `TODO-00` to `TODO-03` comments in the overlays' `kustomization.yaml` files mark what is left.

## Documentation Links

- [Kubernetes docs: Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/): bases, overlays, generators, `kubectl apply -k`.
- [Kustomize docs: Components](https://kubectl.docs.kubernetes.io/guides/config_management/components/): the Component kind and use cases.
- [Kustomize reference: kustomization file](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/): every field.
- [kubectl diff reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/): exit codes and server-side dry run.
