---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Dashboards only help when someone is looking. Alerts turn metrics into notifications: Prometheus evaluates **alerting rules** and sends firing alerts to **Alertmanager**, which groups, deduplicates, silences and routes them to e-mail, Slack, Teams, PagerDuty or a webhook. kube-prometheus-stack ships dozens of useful rules, and, verified on the MicroK8s add-on, sends every one of them to a receiver called `"null"`: nothing reaches anyone until you configure routing. This concept covers the rules you already have, writing your own for restarts, disk and memory, and routing alerts somewhere a human will see them.

## Use Cases

- Being told when a Pod is crash-looping, before users notice.
- Getting a warning while the node's disk is filling up, not when it is full.
- Detecting memory pressure on a single node before evictions start.
- Sending alerts to a team chat channel and silencing them during maintenance.

## Deep Dive

### What is already there

The add-on installs 35 `PrometheusRule` objects. Among the alerts, verified present:

| Alert | Fires when |
|---|---|
| `KubePodCrashLooping` | a container is in `CrashLoopBackOff` (for 15 minutes) |
| `KubePodNotReady` | a Pod is not ready for 15 minutes |
| `KubeContainerWaiting` | a container is stuck waiting (image pull, config error) for an hour |
| `KubeDeploymentReplicasMismatch` | a Deployment does not have its desired available replicas |
| `KubeJobFailed` | a Job failed |
| `KubeMemoryOvercommit` | memory requests exceed what the cluster can tolerate losing a node |
| `CPUThrottlingHigh` | a container is heavily CPU-throttled |
| `NodeFilesystemSpaceFillingUp` | a filesystem is predicted to fill up within 24h / 4h |
| `NodeFilesystemAlmostOutOfSpace` | less than 5% / 3% free |
| `NodeMemoryHighUtilization` | node memory above 90% |
| `Watchdog` | always firing, on purpose |

The crash-loop rule, as shipped:

```
max_over_time(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff", job="kube-state-metrics", namespace=~".*"}[5m]) >= 1
```

`Watchdog` is a dead man's switch: route it to an external service that alerts you when it **stops** arriving, which is how you learn that Prometheus or Alertmanager itself is down.

Every shipped alert links to a runbook explaining causes and fixes (`runbook_url` annotation).

### Writing your own rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: team-a-alerts
  namespace: team-a
  labels:
    release: kube-prom-stack             # required by the default ruleSelector
spec:
  groups:
    - name: team-a
      rules:
        - alert: PodRestartingOften
          expr: increase(kube_pod_container_status_restarts_total{namespace="team-a"}[15m]) > 3
          for: 5m
          labels: {severity: warning}
          annotations:
            summary: "{{ $labels.pod }} restarted more than 3 times in 15 minutes"
        - alert: ContainerNearMemoryLimit
          expr: |
            max by (namespace, pod, container) (container_memory_working_set_bytes{namespace="team-a", container!=""})
              / max by (namespace, pod, container) (kube_pod_container_resource_limits{namespace="team-a", resource="memory"})
              > 0.9
          for: 10m
          labels: {severity: warning}
          annotations:
            summary: "{{ $labels.pod }}/{{ $labels.container }} uses over 90% of its memory limit"
        - alert: NodeDiskAlmostFull
          expr: |
            node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"}
              / node_filesystem_size_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} < 0.15
          for: 10m
          labels: {severity: critical}
          annotations:
            summary: "Less than 15% disk left on {{ $labels.instance }}"
```

Verified: with the `release: kube-prom-stack` label, the group `team-a` and the alert `PodRestartingOften` appeared in Prometheus' `/api/v1/rules` within a minute. Without the label, the rule is ignored silently, exactly like ServiceMonitors.

Rules that make good alerts are about **symptoms that need a human**: something is broken or about to break. `for:` avoids paging on a blip. Put the details a responder needs in annotations (what, where, a runbook link).

Test expressions in the Prometheus UI (Graph tab) before turning them into rules, and check `/alerts` to see their state: `inactive`, `pending` (condition true, waiting for `for`), `firing`.

### Routing: from the null receiver to people

The add-on's Alertmanager configuration, verified:

```yaml
route:
  receiver: "null"
  group_by: [namespace]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  routes:
    - matchers: [alertname = "Watchdog"]
      receiver: "null"
receivers:
  - name: "null"
```

Alerts fire, and are routed nowhere. Two ways to fix it:

**Helm values** for the whole stack (with the add-on: `--kube-prometheus-stack-values`):

```yaml
alertmanager:
  alertmanagerSpec:
    secrets: [slack]          # Secret "slack" mounted at /etc/alertmanager/secrets/slack/
  config:
    route:
      receiver: team-chat
      group_by: [namespace, alertname]
      routes:
        - matchers: [alertname = "Watchdog"]
          receiver: deadmans-switch
          repeat_interval: 1m
    receivers:
      - name: team-chat
        slack_configs:
          - api_url_file: /etc/alertmanager/secrets/slack/webhook-url
            channel: "#alerts"
            send_resolved: true
      - name: deadmans-switch
        webhook_configs:
          - url: https://hc-ping.example.com/<uuid>
```

**AlertmanagerConfig** objects, per namespace, so each team routes its own alerts:

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: AlertmanagerConfig
metadata: {name: team-a, namespace: team-a}
spec:
  route:
    receiver: team-a-webhook
    groupBy: [alertname]
  receivers:
    - name: team-a-webhook
      webhookConfigs:
        - url: http://alert-relay.team-a.svc.cluster.local/hook
```

In the add-on the Alertmanager selects AlertmanagerConfigs from all namespaces (verified: empty selectors). The operator automatically restricts each one to alerts carrying `namespace=<its namespace>`, so node-level alerts (disk, memory) still need a route in the main configuration.

### Silences and inhibition

- **Silences** mute matching alerts for a time window (maintenance): Alertmanager UI via `kubectl -n observability port-forward svc/kube-prom-stack-kube-prome-alertmanager 9093`, or `amtool silence add`.
- **Inhibition** (already configured in the add-on) mutes `warning` alerts when a `critical` one fires for the same namespace and alert name, so one incident does not page three times.

## Trade-offs

- **Shipped rules vs custom rules.** The shipped set covers the platform well and can be noisy for small clusters (for example overcommit alerts on a single node); tune or disable individual rules rather than ignoring the channel.
- **Central routing vs per-namespace AlertmanagerConfig.** Central config keeps one place to review; per-namespace objects let teams own their routing, at the price of more places to look.
- **Paging on causes vs symptoms.** Alerts on causes (CPU at 80%) are noisy and often irrelevant; alerts on symptoms (crash loops, error rates, a disk about to fill) point at what needs action.

## Lab

In this lab you receive an alerting rule (`PrometheusRule`) that looks reasonable and does nothing: Prometheus does not load it, the expression matches no series and the one hour `for` would keep it quiet for far too long. Your job is to fix the rule until the alert reaches Alertmanager. The core idea is to feel that an alert can fail silently in three different places (rule selection, expression and timing), and that each leaves a distinct symptom.

**The scenario**

The test installs the Prometheus Operator (v0.94.1) on a real Kubernetes cluster (k3s, started by Testcontainers) and queries the Prometheus and Alertmanager APIs.

- `src/test/resources/k8s/app.yaml`: given, with `example-app` (2 replicas) in the `shop` namespace, its ServiceMonitor, and a `bad-client` Pod that requests a page that does not exist every second, so the app answers 404 all the time.
- `src/test/resources/k8s/monitoring.yaml`: given, with the Prometheus `lab` and the Alertmanager `lab` in `monitoring`. Prometheus loads PrometheusRules from any namespace, but only those carrying the label in its `ruleSelector`.
- `src/main/resources/k8s/rules.yaml`: the only file you edit. It has the `ExampleAppErrors` alert, for 4xx or 5xx errors.
- `src/test/java/AlertingTest.java`: within about two and a half minutes, requires Prometheus to have loaded the rule and the alert to be firing in Alertmanager with `severity: warning`.

**What you will do, step by step**

1. **Run the tests and read the messages.** They show the rule groups Prometheus loaded, its alerts with their state, and the real labels of `http_requests_total`.
2. **Make Prometheus load the rule (TODO-00).** Read the `ruleSelector` in `monitoring.yaml` and give the `PrometheusRule` the label it requires.
3. **Match the expression to the app's series (TODO-01).** The expression returns nothing. Compare the label names and values it uses with the metric's real labels, which the failure message lists.
4. **Fire within about a minute (TODO-02).** The `for: 1h` is far too long. The team wants to hear about errors within about a minute, but not about a single stray error: pick a `for` that does both.

**How you know you are done**

`mvn -pl kubernetes-concepts/alertmanager-basic-alerts test` passes: Prometheus loaded `ExampleAppErrors` and Alertmanager received the alert with `severity: warning`. You should be able to say which of the three mistakes makes the rule vanish from the list, which leaves it with no series and which keeps it `pending` forever.

**Optional challenges**

- **TODO-03:** route `severity: warning` alerts to a receiver with an `AlertmanagerConfig` in `shop`. Which label must the `AlertmanagerConfig` have, and which matcher does the operator add to its routes automatically?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container, which downloads the Prometheus Operator v0.94.1 and pulls images from `quay.io`), the article "Alertmanager and Basic Alerts" and, optionally, the "Prometheus, Grafana and ServiceMonitors" lab.

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/alertmanager-basic-alerts test`. The `TODO-00` to `TODO-02` comments in `rules.yaml` mark the three places. The first run downloads a lot and takes a while.

## Documentation Links

- [Prometheus docs: Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/): `expr`, `for`, labels and annotations.
- [Prometheus docs: Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/): routes, receivers, inhibition.
- [Prometheus Operator: Alerting](https://prometheus-operator.dev/docs/developer/alerting/): PrometheusRule and AlertmanagerConfig.
- [kube-prometheus runbooks](https://runbooks.prometheus-operator.dev/): what each shipped alert means and how to respond.
