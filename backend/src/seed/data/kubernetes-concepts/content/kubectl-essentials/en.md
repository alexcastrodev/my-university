---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

`kubectl` has hundreds of flags, but daily work uses a small, sharp subset: `get`, `describe`, `apply`, `delete`, a few output formats, namespace flags, and `--dry-run` to generate YAML instead of writing it. Knowing exactly what each one does, and what it does **not** do, is what separates "I ran the command" from "I know the state of the cluster". This concept is a working reference with the pitfalls that matter in practice.

## Use Cases

- Checking the state of a namespace in five seconds.
- Finding why a resource is unhappy (`describe` + events).
- Generating a correct manifest skeleton for a Secret, Deployment or Job without copying from the internet.
- Applying and deleting manifests safely, including across all namespaces.

## Deep Dive

### get: lists, one line per object

```bash
kubectl get pods                       # current namespace (from the context, often "default")
kubectl get pods -n team-a             # one namespace
kubectl get pods -A                    # all namespaces (--all-namespaces)
kubectl get deploy,svc,pvc -n team-a   # several kinds at once
kubectl get pods -o wide               # + node, Pod IP
kubectl get pods -l app=api            # label selector
kubectl get pods --field-selector=status.phase!=Running
kubectl get pods -w                    # watch: print changes as they happen
```

`kubectl get all` is misleading: it shows Pods, Services, Deployments, ReplicaSets, StatefulSets, Jobs and CronJobs, but **not** ConfigMaps, Secrets, PVCs, Ingresses or ServiceAccounts. Never use it to decide that a namespace is empty.

### Output formats

```bash
kubectl get deploy api -o yaml          # full object, including status and managed fields
kubectl get deploy api -o json | jq '.spec.template.spec.containers[0].image'
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,QOS:.status.qosClass
kubectl get pods -o name                # pod/api-6b48...; ideal for loops
```

`-o yaml` of a live object is not a good manifest to commit: it contains `status`, `uid`, `resourceVersion`, `creationTimestamp` and `managedFields`. Commit the file you applied, not what the server returns.

### describe: the human view with events

```bash
kubectl describe pod api-6b48bf5ccc-4cvpp -n team-a
kubectl describe node
```

`describe` aggregates related information: container states, last termination reason, mounted volumes, conditions, and at the bottom the **Events** for that object. For "why is this Pod not running", `describe` is the first command, before logs.

### apply: declarative create-or-update

```bash
kubectl apply -f deployment.yaml
kubectl apply -f k8s/                 # every file in a directory
kubectl apply -k overlays/staging     # a Kustomize directory
```

`apply` computes a three-way merge between the file, the live object and the last applied configuration, so repeated applies are idempotent and fields you removed from the file are removed from the object. `kubectl create` fails if the object exists; `kubectl replace` overwrites it completely. In scripts and pipelines, `apply` is the right default.

What `apply` cannot do: change immutable fields. A Job's Pod template, a Deployment's `spec.selector`, a Service's `clusterIP` or a PVC's `storageClassName` fail with `field is immutable`. You must delete and recreate those objects.

### delete

```bash
kubectl delete -f deployment.yaml     # what the file describes
kubectl delete deploy api -n team-a
kubectl delete pods -l app=api        # by label
kubectl delete pod api-xyz --grace-period=0 --force   # last resort, see the pod deletion concept
```

Deleting a Deployment deletes its ReplicaSets and Pods (cascade). Deleting a namespace deletes **everything** in it, including PVCs and, with a `Delete` reclaim policy, the data.

### Generating YAML with --dry-run=client

Imperative commands plus `--dry-run=client -o yaml` produce correct skeletons without touching the cluster:

```bash
kubectl create deployment api --image=registry.example.com/demo/web-app:1.4.2 \
  --replicas=2 --port=8080 --dry-run=client -o yaml > deployment.yaml

kubectl create secret generic db-credentials \
  --from-env-file=db.env --dry-run=client -o yaml > secret.yaml

kubectl create job migrate --image=registry.example.com/demo/web-app:1.4.2 \
  --dry-run=client -o yaml -- ./app migrate
```

`--dry-run=server` sends the object to the API server, which runs validation and admission (Pod Security, webhooks) without persisting. It catches errors `client` cannot, like an invalid `restartPolicy` for a Job or a Pod Security violation.

The same pattern updates a Secret from a file idempotently:

```bash
kubectl create secret generic db-credentials --from-env-file=db.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Explaining fields

```bash
kubectl explain deployment.spec.strategy
kubectl explain pod.spec.containers.resources --recursive
```

`explain` reads the schema from the API server, so it always matches your cluster version and includes CRDs.

### Namespace hygiene

- Set a default namespace per context (`kubectl config set-context --current --namespace=team-a`) for interactive work.
- In scripts, always pass `-n` explicitly and prefer `metadata.namespace` in manifests (or `namespace:` in Kustomize).
- `-A` is only for reading. A `kubectl delete ... -A` is almost never what you want.

## Trade-offs

- **Imperative commands vs manifests.** `kubectl create/scale/set image` are fast for experiments and emergencies, but leave no record. Anything that should survive belongs in a manifest in Git, applied with `apply`.
- **`--dry-run=client` vs `server`.** Client is offline and instant; server needs cluster access but reports what the cluster would actually accept.
- **`-o yaml` for debugging vs for authoring.** Great for seeing effective state and defaults; noisy and non-portable as a source file.

## Documentation Links

- [kubectl Quick Reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/): the canonical cheat sheet.
- [Kubernetes docs: Declarative management with kubectl apply](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/): three-way merge and pruning of removed fields.
- [kubectl reference: output formats and JSONPath](https://kubernetes.io/docs/reference/kubectl/jsonpath/): jsonpath syntax.
- [kubectl reference: kubectl create](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/): all generators usable with `--dry-run`.
