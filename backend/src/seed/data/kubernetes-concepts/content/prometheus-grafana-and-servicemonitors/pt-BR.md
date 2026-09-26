---
version: 1.0
updatedAt: 2026-09-26
title: "Prometheus, Grafana e ServiceMonitors"
summary: "O que o add-on de observabilidade do MicroK8s instala (e os seus padrões), como ServiceMonitors são selecionados, e o label release que esconde targets em silêncio."
---
## Objective

A stack de métricas padrão de fato no Kubernetes é o **kube-prometheus-stack**: o Prometheus Operator, o Prometheus, o Alertmanager, o Grafana, o node-exporter e o kube-state-metrics, com dashboards e regras de alerta prontos. Em vez de editar um arquivo de configuração do Prometheus, você declara o que coletar com recursos **ServiceMonitor** e **PodMonitor**, e o operator gera a configuração. O MicroK8s empacota essa stack como o add-on `observability`, com padrões que você precisa conhecer antes de confiar nele. Este conceito cobre o que o add-on instala, como os ServiceMonitors são selecionados (e por que um novo é ignorado em silêncio), e o que mudar para uso real.

## Use Cases

- Ter dashboards de cluster, nós e Pods num cluster pequeno em minutos.
- Coletar o endpoint `/metrics` da sua própria aplicação.
- Entender por que um ServiceMonitor existe mas o seu target nunca aparece no Prometheus.
- Fazer as métricas sobreviverem a um restart do Prometheus.

## Deep Dive

### O que o add-on do MicroK8s instala

```bash
microk8s enable observability            # --without-tempo para pular o tracing
```

Verificado no MicroK8s 1.35 (setembro de 2026), namespace `observability`:

| Componente | Imagem |
|---|---|
| Prometheus Operator | `prometheus-operator:v0.85.0` |
| Prometheus | `prometheus:v3.5.0` (retenção `10d`) |
| Alertmanager | `alertmanager:v0.28.1` |
| Grafana | `grafana:12.1.1` |
| node-exporter, kube-state-metrics | `v1.9.1`, `v2.17.0` |
| Loki + Promtail (logs, veja o conceito de logs) | `loki:2.6.1`, `promtail:3.5.1` |

Ele também traz 35 objetos `PrometheusRule` (alertas de nó, de Kubernetes, de etcd, de Alertmanager) e dashboards.

Três padrões para mudar antes de confiar nele:

- **Sem persistência.** `kubectl -n observability get pvc` não retornou nada: Prometheus, Alertmanager e Loki guardam os dados no Pod. Um restart ou reagendamento perde todo o histórico, incluindo os dez dias de "retenção".
- **Senha do Grafana conhecida.** A senha de admin na Secret `kube-prom-stack-grafana` é `prom-operator`, o padrão público do chart. Troque-a, ou coloque o Grafana atrás de SSO, antes de expô-lo.
- **Só Services ClusterIP.** Acesse com `kubectl -n observability port-forward svc/kube-prom-stack-grafana 3000:80`, ou publique por um Ingress com autenticação.

O add-on aceita arquivos de values do Helm (`--kube-prometheus-stack-values`, `--loki-stack-values`) para definir storage, senhas e resources; os mesmos values funcionam com o Helm chart upstream se você o instalar diretamente.

### Como o Prometheus encontra targets: ServiceMonitor

Um ServiceMonitor seleciona **Services** por label, e coleta os endpoints (Pods) por trás deles numa porta nomeada:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: web
  namespace: team-a
  labels:
    release: kube-prom-stack          # obrigatório, veja abaixo
spec:
  selector:
    matchLabels: {app: web}           # Services com este label
  endpoints:
    - port: metrics                   # o NOME da porta do Service, não o número
      path: /metrics
      interval: 30s
```

O Service precisa ter uma porta **nomeada** que case com `endpoints.port`. Um PodMonitor faz o mesmo sem Service, selecionando Pods diretamente.

### A armadilha do label release

O próprio recurso Prometheus decide quais ServiceMonitors ele lê. No add-on (e por padrão no Helm chart):

```
serviceMonitorSelector: {"matchLabels":{"release":"kube-prom-stack"}}
serviceMonitorNamespaceSelector: {}       # todos os namespaces
ruleSelector:           {"matchLabels":{"release":"kube-prom-stack"}}
```

Verificado: um ServiceMonitor para a porta de métricas do Traefik **sem** esse label não produziu target nenhum, sem erro, sem evento. Depois de `kubectl label servicemonitor traefik-nolabel release=kube-prom-stack`, o target `serviceMonitor/ingress/traefik-nolabel/0` apareceu em menos de um minuto. O mesmo vale para objetos `PrometheusRule` via `ruleSelector`.

Duas saídas: sempre adicionar o label, ou configurar a stack para selecionar todo ServiceMonitor (`prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues: false` nos values do Helm).

### Conferindo os targets

```bash
kubectl -n observability port-forward svc/kube-prom-stack-kube-prome-prometheus 9090:9090
# http://localhost:9090/targets : estado UP/DOWN e o último erro de coleta
```

Um target que não aparece de jeito nenhum é problema de seleção (labels no ServiceMonitor, o selector do Service, o nome da porta, um namespace selector). Um target `DOWN` é problema de rede ou de aplicação (path errado, TLS, uma NetworkPolicy bloqueando o namespace do Prometheus).

### O que vem de graça

- **node-exporter**: CPU, memória, disco, sistema de arquivos e rede do nó.
- **kube-state-metrics**: estado dos objetos (`kube_pod_container_status_restarts_total`, `kube_deployment_status_replicas_available`, `kube_pod_status_phase`).
- **cAdvisor via kubelet**: uso dos containers (`container_memory_working_set_bytes`, `container_cpu_usage_seconds_total`), que é a base do dimensionamento.

Queries úteis:

```
sum by (namespace, pod) (container_memory_working_set_bytes{container!=""})
sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))
increase(kube_pod_container_status_restarts_total[1h]) > 0
```

## Trade-offs

- **Add-on vs Helm chart.** O add-on é um comando só e fixa as versões junto com o release do MicroK8s (o Loki 2.6 é bem antigo); o chart upstream dá versões atuais e controle total, e mais uma coisa para atualizar.
- **Seleção por label vs selecionar tudo.** Exigir o label `release` deixa várias instâncias de Prometheus coexistirem; selecionar tudo é mais simples num cluster com uma única stack.
- **Storage local vs remote write.** Um PVC mantém o histórico no nó; `remote_write` para Mimir, Thanos ou um serviço gerenciado o mantém fora do cluster, que é o que você quer quando o próprio nó falha.

## Documentation Links

- [kube-prometheus-stack chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack): values, selectors, storage.
- [Prometheus Operator: ServiceMonitor API](https://prometheus-operator.dev/docs/api-reference/api/#monitoring.coreos.com/v1.ServiceMonitor): todos os campos.
- [Prometheus Operator: Troubleshooting ServiceMonitor changes](https://prometheus-operator.dev/docs/platform/troubleshooting/): por que targets não aparecem.
- [MicroK8s: Add-ons](https://canonical.com/microk8s/docs/addons): o add-on `observability` na lista de add-ons core.
