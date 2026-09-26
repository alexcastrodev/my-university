---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

The de facto metrics stack on Kubernetes is **kube-prometheus-stack**: the Prometheus Operator, Prometheus, Alertmanager, Grafana, node-exporter and kube-state-metrics, with ready-made dashboards and alert rules. Instead of editing a Prometheus config file, you declare what to scrape with **ServiceMonitor** and **PodMonitor** resources, and the operator generates the configuration. MicroK8s packages this stack as the `observability` add-on, with defaults you need to know before trusting it. This concept covers what the add-on installs, how ServiceMonitors are selected (and why a new one is silently ignored), and what to change for real use.

## Use Cases

- Getting cluster, node and Pod dashboards on a small cluster in minutes.
- Scraping your own application's `/metrics` endpoint.
- Understanding why a ServiceMonitor exists but its target never appears in Prometheus.
- Making metrics survive a Prometheus restart.

## Deep Dive

### What the MicroK8s add-on installs

```bash
microk8s enable observability            # --without-tempo to skip tracing
```

Verified on MicroK8s 1.35 (September 2026), namespace `observability`:

| Component | Image |
|---|---|
| Prometheus Operator | `prometheus-operator:v0.85.0` |
| Prometheus | `prometheus:v3.5.0` (retention `10d`) |
| Alertmanager | `alertmanager:v0.28.1` |
| Grafana | `grafana:12.1.1` |
| node-exporter, kube-state-metrics | `v1.9.1`, `v2.17.0` |
| Loki + Promtail (logs, see the logging concept) | `loki:2.6.1`, `promtail:3.5.1` |

It also ships 35 `PrometheusRule` objects (node, Kubernetes, etcd, Alertmanager alerts) and dashboards.

Three defaults to change before relying on it:

- **No persistence.** `kubectl -n observability get pvc` returned nothing: Prometheus, Alertmanager and Loki store data in the Pod. A restart or reschedule loses all history, including the ten days of "retention".
- **Well-known Grafana password.** The admin password in Secret `kube-prom-stack-grafana` is `prom-operator`, the chart's public default. Change it, or put Grafana behind SSO, before exposing it.
- **ClusterIP services only.** Access with `kubectl -n observability port-forward svc/kube-prom-stack-grafana 3000:80`, or publish through an Ingress with authentication.

The add-on accepts Helm values files (`--kube-prometheus-stack-values`, `--loki-stack-values`) to set storage, passwords and resources; the same values work with the upstream Helm chart if you install it directly.

### How Prometheus finds targets: ServiceMonitor

A ServiceMonitor selects **Services** by label, and scrapes the endpoints (Pods) behind them on a named port:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: web
  namespace: team-a
  labels:
    release: kube-prom-stack          # required, see below
spec:
  selector:
    matchLabels: {app: web}           # Services with this label
  endpoints:
    - port: metrics                   # the Service port NAME, not number
      path: /metrics
      interval: 30s
```

The Service must have a **named** port matching `endpoints.port`. A PodMonitor does the same without a Service, selecting Pods directly.

### The release label trap

The Prometheus resource itself decides which ServiceMonitors it reads. In the add-on (and by default in the Helm chart):

```
serviceMonitorSelector: {"matchLabels":{"release":"kube-prom-stack"}}
serviceMonitorNamespaceSelector: {}       # all namespaces
ruleSelector:           {"matchLabels":{"release":"kube-prom-stack"}}
```

Verified: a ServiceMonitor for Traefik's metrics port **without** that label produced no target at all, no error, no event. After `kubectl label servicemonitor traefik-nolabel release=kube-prom-stack`, the target `serviceMonitor/ingress/traefik-nolabel/0` appeared within a minute. The same applies to `PrometheusRule` objects via `ruleSelector`.

Two ways out: always add the label, or configure the stack to select every ServiceMonitor (`prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues: false` in Helm values).

### Checking targets

```bash
kubectl -n observability port-forward svc/kube-prom-stack-kube-prome-prometheus 9090:9090
# http://localhost:9090/targets : state UP/DOWN and the last scrape error
```

A target that is missing entirely is a selection problem (labels on the ServiceMonitor, the Service selector, the port name, a namespace selector). A target that is `DOWN` is a network or application problem (wrong path, TLS, a NetworkPolicy blocking the Prometheus namespace).

### What you get for free

- **node-exporter**: node CPU, memory, disk, filesystem, network.
- **kube-state-metrics**: object state (`kube_pod_container_status_restarts_total`, `kube_deployment_status_replicas_available`, `kube_pod_status_phase`).
- **cAdvisor via the kubelet**: container usage (`container_memory_working_set_bytes`, `container_cpu_usage_seconds_total`), which is what right-sizing is based on.

Useful queries:

```
sum by (namespace, pod) (container_memory_working_set_bytes{container!=""})
sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))
increase(kube_pod_container_status_restarts_total[1h]) > 0
```

## Trade-offs

- **Add-on vs Helm chart.** The add-on is one command and pins versions with the MicroK8s release (Loki 2.6 is very old); the upstream chart gives current versions and full control, and one more thing to upgrade.
- **Label-based selection vs select-all.** Requiring the `release` label lets several Prometheus instances coexist; selecting everything is simpler on a single-stack cluster.
- **Local storage vs remote write.** A PVC keeps history on the node; `remote_write` to Mimir, Thanos or a hosted service keeps it off the cluster, which is what you want when the node itself fails.

## Documentation Links

- [kube-prometheus-stack chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack): values, selectors, storage.
- [Prometheus Operator: ServiceMonitor API](https://prometheus-operator.dev/docs/api-reference/api/#monitoring.coreos.com/v1.ServiceMonitor): all fields.
- [Prometheus Operator: Troubleshooting ServiceMonitor changes](https://prometheus-operator.dev/docs/platform/troubleshooting/): why targets do not show up.
- [MicroK8s: Add-ons](https://canonical.com/microk8s/docs/addons): the `observability` add-on in the core add-on list.
