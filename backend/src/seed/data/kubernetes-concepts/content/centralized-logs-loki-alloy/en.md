---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

`kubectl logs` reads log files the kubelet keeps on the node, for containers that still exist, and only the current and previous run of each. Once a Pod is deleted, rescheduled or restarted twice, its logs are gone. Centralized logging collects every container's stdout/stderr from every node into a store you can query across Pods and time. On Kubernetes the lightweight standard is **Loki** for storage and a node agent to ship the logs. That agent used to be Promtail, which reached **end of life on 2 March 2026**; its successor is **Grafana Alloy**. This concept covers how container logs are collected, what the MicroK8s add-on gives you, migrating the agent to Alloy, and querying with LogQL.

## Use Cases

- Reading the logs of a Pod that crashed and was replaced an hour ago.
- Searching all replicas of a service for one request ID.
- Correlating errors across namespaces during an incident.
- Keeping Kubernetes events next to application logs.

## Deep Dive

### Where container logs live

Containers write to stdout and stderr; the container runtime writes that to files on the node:

```
/var/log/pods/<namespace>_<pod>_<uid>/<container>/0.log
```

The kubelet rotates them (10 MiB, 5 files by default). A node agent (a DaemonSet) tails these files, attaches Kubernetes metadata as labels, and pushes them to Loki. The application only needs to log to stdout/stderr, ideally one event per line, preferably structured (JSON).

### What the MicroK8s add-on ships

`microk8s enable observability` installs, verified on 1.35 in namespace `observability`: `loki-0` (image `grafana/loki:2.6.1`) and a `loki-promtail` DaemonSet (image `grafana/promtail:3.5.1`), with Loki wired as a Grafana data source. Querying Loki's API showed the labels Promtail attaches:

```
app, component, container, filename, instance, job, namespace, node_name, pod, stream
```

and log lines arriving from the ingress controller:

```json
{"stream":{"namespace":"ingress","pod":"traefik-vkpfl","container":"traefik",
           "job":"ingress/traefik","stream":"stderr", ...},
 "values":[["1790456488695750386","E0926 21:01:28 ... nodes is forbidden ..."]]}
```

It works, with two caveats: Loki 2.6 is a 2022 release, and Promtail no longer receives fixes, including security fixes. Like the rest of the add-on, Loki also has no PVC, so logs vanish when the Pod restarts. Treat it as a lab setup.

### The current stack: Loki + Alloy

For a maintained setup, install from the upstream charts:

- **Loki** (`grafana/loki` Helm chart) in single-binary or simple-scalable mode, with a PVC or object storage (S3, MinIO) for chunks, and a retention period.
- **Alloy** (`grafana/alloy` Helm chart) as a DaemonSet. It replaces Promtail and can also collect metrics, traces and Kubernetes events.

A minimal Alloy pipeline for Pod logs:

```
discovery.kubernetes "pods" {
  role = "pod"
}

discovery.relabel "pods" {
  targets = discovery.kubernetes.pods.targets
  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label  = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label  = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label  = "container"
  }
}

loki.source.kubernetes "pods" {
  targets    = discovery.relabel.pods.output
  forward_to = [loki.write.default.receiver]
}

loki.source.kubernetes_events "events" {
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki.observability.svc.cluster.local:3100/loki/api/v1/push"
  }
}
```

An existing Promtail configuration converts automatically:

```bash
alloy convert --source-format=promtail --output=config.alloy promtail.yaml
```

### Labels: few and bounded

Loki indexes **labels**, not log content. Each unique label combination is a separate stream. Good labels have few values: `namespace`, `app`, `container`, `node`. Never turn request IDs, user IDs or trace IDs into labels; that creates millions of streams and slows everything down. Search for them in the content instead.

### Querying with LogQL

In Grafana, Explore, data source Loki:

```
{namespace="team-a", app="web"}                                  # all logs of the app
{namespace="team-a"} |= "ERROR"                                  # line contains
{namespace="team-a", app="web"} | json | status >= 500           # parse JSON, filter a field
{namespace="team-a"} |= "req-7f3a9c"                             # one request across all Pods
sum by (pod) (count_over_time({namespace="team-a"} |= "ERROR" [5m]))   # errors per Pod, as a metric
```

The last form turns logs into time series, which Grafana can graph and the Loki ruler can alert on.

### Sizing and retention

Logs grow fast. Decide up front:

- **Retention** (for example 7 to 30 days) enforced by Loki's compactor.
- **Storage**: a PVC for a single node, object storage beyond that.
- **Noise**: drop debug logs or health-check access logs in the agent (`loki.process` with a `stage.drop`) rather than paying to store them.

## Trade-offs

- **Loki vs Elasticsearch/OpenSearch.** Loki indexes only labels, so it is cheap to run and store, and full-text search is a scan; Elasticsearch indexes content for fast arbitrary search at a much higher resource cost.
- **Add-on vs upstream charts.** The add-on is one command with outdated, unsupported components; upstream charts are current and must be configured and upgraded by you.
- **Agent on every node vs sidecars.** A DaemonSet agent collects everything with one Pod per node; sidecars only make sense for apps that cannot log to stdout.

## Documentation Links

- [Grafana: Migrate from Promtail to Grafana Alloy](https://grafana.com/docs/alloy/latest/set-up/migrate/from-promtail/): `alloy convert` and the migration path.
- [Grafana Loki: Promtail agent](https://grafana.com/docs/loki/latest/send-data/promtail/): deprecation and end-of-life notice.
- [Grafana Alloy documentation](https://grafana.com/docs/alloy/latest/): components such as `loki.source.kubernetes`.
- [Grafana Loki: Install with Helm](https://grafana.com/docs/loki/latest/setup/install/helm/): deployment modes and storage.
- [Kubernetes docs: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/): node-level log files and rotation.
