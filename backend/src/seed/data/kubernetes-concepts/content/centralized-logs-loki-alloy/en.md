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

## Lab

In this lab you receive a Grafana Alloy pipeline that discovers Pods and reads their logs, but nothing reaches Loki, the logs have no namespace label and passwords would go through in plain text. Your job is to fix `alloy-config.yaml` so it delivers logs to Loki, makes them searchable by namespace and masks passwords before they leave the cluster. The core idea is to feel that in Loki you search by labels, that the right place to hide sensitive data is the collection pipeline, and that Alloy only tells you what is wrong in its own logs.

**The scenario**

The test starts Loki and Alloy on a real Kubernetes cluster (k3s, started by Testcontainers) and queries Loki's API.

- `src/test/resources/k8s/logging.yaml`: given. It has Loki (single binary, local storage), Alloy, which reads its configuration from the `alloy-config` ConfigMap, a `checkout` Pod in the `shop` namespace that logs `order N placed` and `login user=alice password=hunter2` every second, and a `client` Pod to query Loki from.
- `src/main/resources/k8s/alloy-config.yaml`: the only file you edit. The ConfigMap holds Alloy's pipeline: `discovery.kubernetes`, `discovery.relabel`, `loki.source.kubernetes` and `loki.write`.
- `src/test/java/CentralizedLogsTest.java`: requires `{namespace="shop"}` to return the checkout logs, no stored line to contain the password and the login lines to show `password=****`.

**What you will do, step by step**

1. **Run the tests and read the message.** It shows the labels Loki knows and Alloy's last errors.
2. **Make the logs reach Loki (TODO-00).** Read Alloy's own logs: they say why `loki.write` does not deliver. Check the `endpoint` address and what it needs for Loki to accept the push.
3. **Make them searchable by namespace (TODO-01).** Queries select logs by labels. Add a rule to `discovery.relabel` that copies the Pod's namespace (a `__meta_kubernetes_*` label) into the `namespace` label, like the ones already there for `pod` and `container`.
4. **Mask the passwords (TODO-02).** Put a `loki.process` component between `loki.source.kubernetes` and `loki.write`, with a replace stage that swaps the password value for `****`, and make the source forward to it. That way the sensitive data never leaves the cluster.

**How you know you are done**

`mvn -pl kubernetes-concepts/centralized-logs-loki-alloy test` passes: `{namespace="shop"}` returns the `order ... placed` lines, the login lines appear with `password=****` and `hunter2` exists in no stored log. You should be able to explain why masking in Alloy is safer than relying on whoever queries.

**Optional challenges**

- **TODO-03:** add the Pod's `app` label as a Loki label, and then think about adding the order number as another one. Why is the first fine and the second a problem for Loki?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container, which pulls Loki and Alloy from `mirror.gcr.io` and `busybox`) and the article "Centralized Logs with Loki and Grafana Alloy".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/centralized-logs-loki-alloy test`. The `TODO-00` to `TODO-02` comments in `alloy-config.yaml` mark the three places.

## Documentation Links

- [Grafana: Migrate from Promtail to Grafana Alloy](https://grafana.com/docs/alloy/latest/set-up/migrate/from-promtail/): `alloy convert` and the migration path.
- [Grafana Loki: Promtail agent](https://grafana.com/docs/loki/latest/send-data/promtail/): deprecation and end-of-life notice.
- [Grafana Alloy documentation](https://grafana.com/docs/alloy/latest/): components such as `loki.source.kubernetes`.
- [Grafana Loki: Install with Helm](https://grafana.com/docs/loki/latest/setup/install/helm/): deployment modes and storage.
- [Kubernetes docs: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/): node-level log files and rotation.
