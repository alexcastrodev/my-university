---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Many applications ship as one image that can play several roles: the HTTP server, one or more background workers, a scheduler, a migration task. The role is chosen at start (an argument, a subcommand, an environment variable), while the code and its dependencies are identical. Kustomize fits this pattern well: the base declares one Deployment or Job per role, all referencing the same image name, and the `images:` transformer points every one of them at the right registry and tag in one place. This concept covers the images transformer and how to structure a single image with many roles.

## Use Cases

- Promoting one build (`1.4.2`) to every role of an environment with a single line.
- Moving from a public image name used in development to an internal registry in production.
- Running the web server and several workers from the same image with different arguments and resources.
- Pinning an image by digest in production.

## Deep Dive

### One image name in the base

```yaml
# base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: web, labels: {role: web}}
spec:
  selector: {matchLabels: {app: web}}
  template:
    metadata: {labels: {app: web}}
    spec:
      containers:
        - name: app
          image: registry.example.com/demo/web-app:latest
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: worker, labels: {role: worker}}
spec:
  selector: {matchLabels: {app: worker}}
  template:
    metadata: {labels: {app: worker}}
    spec:
      containers:
        - name: app
          image: registry.example.com/demo/web-app:latest
          args: [worker]
```

```yaml
# base/job.yaml
apiVersion: batch/v1
kind: Job
metadata: {name: migrate, labels: {role: job}}
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: app
          image: registry.example.com/demo/web-app:latest
          args: [migrate]
```

The base's `image:` is a placeholder name. What matters is that every role uses **the same** name, so one transformer rule matches all of them.

### The images transformer

```yaml
# overlays/staging/kustomization.yaml
images:
  - name: registry.example.com/demo/web-app      # what to match (the tag in the base is ignored for matching)
    newName: registry.internal:5000/demo/web-app
    newTag: "1.4.2"
```

Verified with `kubectl kustomize overlays/staging` (kubectl 1.36, Kustomize v5.8): the image of the `web` Deployment, the `worker` Deployment and the `migrate` Job all became `registry.internal:5000/demo/web-app:1.4.2`.

Other forms:

```yaml
images:
  - name: registry.example.com/demo/web-app
    digest: sha256:4f5c...             # pin by digest instead of tag
  - name: redis
    newTag: "8.2"                      # tag only, keep the name
```

- **Quote `newTag`.** Verified: `newTag: 1.10` without quotes fails the build (`cannot unmarshal number into Go struct field Image.images.newTag of type string`). In other YAML tools the same mistake silently turns `1.10` into `1.1`.
- The transformer rewrites `containers[].image` and `initContainers[].image` in the built-in workload kinds (Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet). Images inside custom resources, or in environment variables and args, are not touched unless you configure extra field specs.
- From CI, update the overlay without hand-editing YAML: `kustomize edit set image registry.example.com/demo/web-app=registry.internal:5000/demo/web-app:1.4.3` (standalone `kustomize` binary, run inside the overlay directory).

### Roles: what differs, what stays the same

| Aspect | web | worker | migrate |
|---|---|---|---|
| Start argument | none (default command) | `worker` | `migrate` |
| Replicas | 2+ | depends on queue load | 1 run |
| Service / Ingress | yes | no | no |
| Probes | HTTP readiness and liveness | liveness only (no HTTP traffic to be ready for) | none |
| Resources | CPU for requests | memory for batches | short-lived |
| Kind | Deployment | Deployment | Job |

A worker that does not serve HTTP should not get an HTTP readiness probe; it would never become ready or would need a server just for the probe. Use a liveness check that makes sense for it (an `exec` probe, a small health port) or none.

### Shared configuration across roles

All roles usually need the same connection settings. Generate one ConfigMap and reference it from every role; the hash suffix then restarts all roles together when shared configuration changes:

```yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
      - QUEUE_URL=redis://queue.shared.svc.cluster.local:6379
```

Verified in the same build: `web` and `worker` both referenced the same generated name (`app-config-<hash>`). Role-specific settings go in the role's own `env` or a second ConfigMap.

Target patches by role label instead of by name, so a new worker gets the worker settings automatically:

```yaml
patches:
  - target: {kind: Deployment, labelSelector: role=worker}
    patch: |-
      - op: add
        path: /spec/replicas
        value: 3
```

Verified: only the `worker` Deployment received `replicas: 3`.

### Deploying a new version

One `newTag` change, then:

```bash
kubectl apply -k overlays/staging
kubectl -n web-staging rollout status deploy/web
kubectl -n web-staging rollout status deploy/worker
```

All roles move to the new version in the same apply. If the release needs ordering (migrate, then web, then workers), that ordering must come from the pipeline (apply the Job, wait for it to complete, then apply the rest) or from the application tolerating both versions during the rollout. Remember that a Job's Pod template is immutable: a new tag on an existing `migrate` Job fails to apply, see the Jobs concept.

## Trade-offs

- **One image, many roles vs one image per role.** One image means one build, one scan, one version to reason about, and consistent code across roles; it also ships every role's dependencies to every Pod and couples their release cycles.
- **Tags vs digests in overlays.** Tags are readable and easy to bump; digests guarantee exactly what runs and are unreadable in reviews. Some teams keep tags in Git and let CI resolve them to digests at render time.
- **Arguments vs separate entrypoints.** A single entrypoint with a role argument keeps the image simple; separate commands per role make roles explicit and avoid one role accidentally starting another's components.

## Lab

In this lab you get a base where the same image runs in three roles (API, worker and a migration Job) and a `prod` overlay that tries to change the image of all of them at once, but one role does not obey. Your job is to find out why and make `prod` point all three at the company mirror, pinned by digest. The core idea is to feel that Kustomize's `images` field changes the image in one place, but only matches the name exactly as it is written, and that a digest identifies a build immutably, unlike a tag.

**The scenario**

The same build runs as the `api` Deployment, the `worker` Deployment and the `migrate` Job; only the arguments differ. The tests render the overlay with the Kustomize built into `kubectl`, using a k3s container started by Testcontainers just to have `kubectl`.

- `src/main/resources/kustomize/base/app.yaml`: the three roles, each with its own `args` (`role=api`, `role=worker`, `role=migrate`). Notice how each one writes its image.
- `src/main/resources/kustomize/overlays/prod/kustomization.yaml`: the overlay you edit. Today it has an `images` entry that only changes the tag to `1.38`.
- `src/test/java/ImagesTest.java`: renders the overlay and extracts all the images.

Every role must run exactly `registry.lab/mirror/busybox@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e`. You can edit the overlay and, if you like, tidy up the base.

**What you will do, step by step**

1. **Run the tests and read the image list.** The failure message shows the images of the rendered roles and makes clear which one did not follow the entry.
2. **Find out why one role ignores `images` (TODO-00).** Compare how each role writes its image name. The entry matches by name, so a name written differently slips past. Fix that, in the base or in a way that makes the entry cover all three.
3. **Use the mirror and the digest (TODO-01).** Change the entry to point at the mirror registry and pin the given digest instead of a tag, so the three roles end up with one identical image.

**How you know you are done**

`mvn -pl kubernetes-concepts/kustomize-images-one-image-many-roles test` passes `everyRoleRunsTheSameImage`, `prodRunsTheReleaseFromTheMirror` and `rolesStillDifferByTheirArguments`. You should be able to explain why the Job escaped the entry and why the image change lives in one place without losing each role's arguments.

**Optional challenges**

- **TODO-02:** in CI, `kustomize edit set image busybox=registry.lab/mirror/busybox@sha256:...` writes the same entry for you. Why does a digest make a rollback, and an audit of what ran in production, more reliable than a tag?

**Prerequisites:** Docker running (the tests start a `rancher/k3s` container for its `kubectl`), Java and Maven, and the article Kustomize Images: One Image, Many Roles.

**How to run it:** clone the repository and, from its root, run `mvn -pl kubernetes-concepts/kustomize-images-one-image-many-roles test`. The `TODO-00` and `TODO-01` comments in `overlays/prod/kustomization.yaml` mark what is left. To see the result, run `kubectl kustomize` on the overlay.

## Documentation Links

- [Kustomize reference: images](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/): `newName`, `newTag`, `digest`.
- [Kustomize: kustomize edit](https://kubectl.docs.kubernetes.io/references/kustomize/cmd/edit/): updating overlays from CI.
- [Kubernetes docs: Define a Command and Arguments for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-command-argument-container/): how `command` and `args` override the image.
- [Kubernetes docs: Images](https://kubernetes.io/docs/concepts/containers/images/): tags, digests and pull behaviour.
