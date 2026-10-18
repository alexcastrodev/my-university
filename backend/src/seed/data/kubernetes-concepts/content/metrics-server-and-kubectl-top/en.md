---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

`kubectl top` shows current CPU and memory usage of nodes and Pods. The data does not come from the API server itself but from **metrics-server**, a small add-on that scrapes the kubelets every few seconds and serves the latest values through the Metrics API. It is the quickest way to see who uses what right now, and it is also what the Horizontal Pod Autoscaler reads. It keeps no history, which is why sizing decisions need Prometheus as well. This concept covers enabling metrics-server, reading `kubectl top` correctly, and turning measurements into requests and limits.

## Use Cases

- Finding the Pod that is eating the node's memory.
- Checking a container's real usage against its requests and limits.
- Providing metrics for the Horizontal Pod Autoscaler.
- Starting a right-sizing exercise for a namespace.

## Deep Dive

### Enabling it

```bash
microk8s enable metrics-server      # MicroK8s
kubectl get apiservice v1beta1.metrics.k8s.io      # AVAILABLE must be True
```

k3s ships it by default. Without it, `kubectl top` fails with `error: Metrics API not available`. If the APIService shows `False`, metrics-server cannot reach the kubelets (often a TLS issue on self-built clusters, solved with `--kubelet-insecure-tls` in labs or proper kubelet serving certificates in production). A broken aggregated API also blocks namespace deletion, so fix or remove it rather than leaving it half-installed.

### Reading kubectl top

Verified on MicroK8s 1.35 right after enabling ingress and metrics-server:

```
$ kubectl top node
NAME          CPU(cores)   CPU(%)   MEMORY(bytes)   MEMORY(%)
claude-mk8s   70m          3%       1411Mi          37%

$ kubectl top pods -A
NAMESPACE     NAME                                       CPU(cores)   MEMORY(bytes)
ingress       traefik-vkpfl                              1m           19Mi
kube-system   calico-node-plbml                          9m           99Mi
kube-system   coredns-78894c95f4-8p5nf                   1m           11Mi
kube-system   metrics-server-6577ff95c4-gkfpc            1m           15Mi
```

Useful variants:

```bash
kubectl top pods -n team-a --containers          # per container, not per Pod
kubectl top pods -A --sort-by=memory | head      # biggest consumers
kubectl top pods -l app=web --sum                # total for a selector
```

What the numbers are:

- **CPU**: average over the last scrape window, in millicores (`70m` = 7% of one core). Short spikes are smoothed out.
- **Memory**: the container's **working set** (resident memory minus inactive file cache). This is the number the kubelet uses for eviction decisions and roughly what counts toward the OOM limit, so it is the right one to compare with limits.
- **Node memory %** is relative to **allocatable**, not total RAM, and includes everything running on the node (the OS, the Kubernetes components), not only Pods. The sum of `top pods` is therefore smaller than `top node`.

### Comparing usage with requests and limits

`kubectl top` shows usage only. Put it next to the spec:

```bash
kubectl -n team-a get pods -o custom-columns=\
NAME:.metadata.name,\
REQ_MEM:.spec.containers[0].resources.requests.memory,\
LIM_MEM:.spec.containers[0].resources.limits.memory,\
REQ_CPU:.spec.containers[0].resources.requests.cpu
kubectl -n team-a top pods
```

Signals to look for:

- Usage close to the memory limit: an `OOMKilled` waiting to happen.
- Usage far below the request: the node reserves capacity nobody uses, which later shows up as `Pending` Pods elsewhere.
- CPU usage at the CPU limit: throttling, visible as latency.

### From a snapshot to a sizing decision

metrics-server keeps only the latest value. Sizing needs history, under real load, over days. With Prometheus (see the observability concepts):

```
# peak memory working set per container over 7 days
max_over_time(container_memory_working_set_bytes{namespace="team-a", container!=""}[7d])

# p95 CPU usage per container over 7 days
quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{namespace="team-a", container!=""}[5m])[7d:5m])
```

A practical rule:

- **Memory request = limit = peak working set + 20 to 30%.** Memory is not compressible; the peak matters, not the average.
- **CPU request ≈ p95 of usage**, CPU limit absent or generous (see the resources concept for why).
- Re-measure after major version changes of the application or its runtime, and after traffic changes.

Tools like the Vertical Pod Autoscaler in recommendation mode (`updateMode: "Off"`) automate exactly this analysis and suggest values without changing anything.

### The Horizontal Pod Autoscaler uses the same data

```bash
kubectl -n team-a autoscale deploy/web --cpu-percent=70 --min=2 --max=6
kubectl -n team-a get hpa
```

HPA percentages are relative to **requests**. A Deployment without CPU requests cannot be autoscaled on CPU (`<unknown>` targets). Wrong requests produce wrong scaling.

## Trade-offs

- **metrics-server vs Prometheus.** metrics-server is tiny and gives current values plus autoscaling; Prometheus stores history and supports real analysis, at a much higher resource cost. Most clusters need both.
- **Sizing from peaks vs averages.** Peaks protect against OOM kills and waste some capacity; averages pack more workloads and fail under load.
- **Manual right-sizing vs VPA.** Manual review is transparent and periodic; VPA recommendations are continuous and need their own component.

## Lab

In this lab you receive a `worker` Deployment that keeps its CPU busy and a HorizontalPodAutoscaler (HPA) that should scale it, but the autoscaler shows `<unknown>`. Your job is to make the HPA able to compute utilization and to keep a `kubectl apply` from undoing its decisions. The core idea is to feel that the HPA measures CPU relative to the `request`, and that the manifest's `replicas` field fights the autoscaler on every deploy.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers) ships metrics-server, so `kubectl top` and CPU autoscaling work as in production.

- `src/main/resources/k8s/worker.yaml`: the only file you edit. It has the `worker` Deployment (busybox in a CPU loop, `replicas: 1`) and the `worker` HPA, which targets 50% CPU utilization with 1 to 3 replicas.
- `src/test/java/AutoscalingTest.java`: applies the manifest and checks, in order, that the HPA reads a utilization and `kubectl top pods` shows the worker, that the CPU limit is `200m`, and that the HPA scales to 3 replicas and still has 3 after another `kubectl apply` of the same file.

metrics-server needs a minute or two to answer after the cluster starts, and the starter takes about six minutes to fail.

**What you will do, step by step**

1. **Run the tests and read the HPA's conditions.** The failure message shows why it cannot compute a utilization.
2. **Make the HPA compute utilization and set the limit (TODO-00).** In the `worker` container, declare resources: a CPU `request`, which the percentage utilization needs in order to exist, and a `limit` of `200m` so the worker cannot take more than 0.2 CPU.
3. **Leave the replica count to the HPA (TODO-01).** With the autoscaler working, every `kubectl apply` of the file goes back to `replicas: 1`. Make the manifest stop declaring the count, so `apply` leaves it to the HPA.

**How you know you are done**

`mvn -pl kubernetes-concepts/metrics-server-and-kubectl-top test` passes: the HPA has a CPU utilization, the limit is `200m`, the worker reaches 3 replicas and a new `apply` keeps 3. You should be able to explain why the HPA stays at `<unknown>` without a `request` and why the fixed `replicas` in the manifest undid the scaling.

**Optional challenges**

- **TODO-02:** while the test runs, compare `kubectl top pods` with the HPA's `TARGETS` column. With a `request` of `100m` and a `limit` of `200m`, why does the HPA report 200% and never more?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container and pull `busybox` inside it), the article "metrics-server and kubectl top" and patience: metrics-server needs a minute or two after the cluster starts.

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/metrics-server-and-kubectl-top test`. The `TODO-00` and `TODO-01` comments in `worker.yaml` mark where to change things.

## Documentation Links

- [Kubernetes docs: Resource metrics pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/): metrics-server and the Metrics API.
- [metrics-server on GitHub](https://github.com/kubernetes-sigs/metrics-server): installation and flags.
- [kubectl top reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_top/): node and pod subcommands.
- [Kubernetes docs: Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/): how HPA uses resource metrics.
- [MicroK8s: Add-ons](https://canonical.com/microk8s/docs/addons): the metrics-server add-on.
