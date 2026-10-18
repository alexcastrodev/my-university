---
version: 1.0
updatedAt: 2026-09-26
title: "Alertmanager e Alertas Básicos"
summary: "As regras de alerta que já vêm prontas, escrever regras para restarts, memória e disco, e rotear alertas para fora do receiver null padrão."
---
## Objective

Dashboards só ajudam quando alguém está olhando. Alertas transformam métricas em notificações: o Prometheus avalia **regras de alerta** e manda os alertas disparados para o **Alertmanager**, que agrupa, deduplica, silencia e roteia para e-mail, Slack, Teams, PagerDuty ou um webhook. O kube-prometheus-stack traz dezenas de regras úteis e, verificado no add-on do MicroK8s, manda todas elas para um receiver chamado `"null"`: nada chega a ninguém até você configurar o roteamento. Este conceito cobre as regras que você já tem, como escrever as suas para restarts, disco e memória, e como rotear alertas para algum lugar onde uma pessoa vai vê-los.

## Use Cases

- Ser avisado quando um Pod está em crash loop, antes de os usuários perceberem.
- Receber um aviso enquanto o disco do nó está enchendo, não quando já encheu.
- Detectar pressão de memória num nó único antes de as evictions começarem.
- Mandar alertas para um canal do time e silenciá-los durante manutenções.

## Deep Dive

### O que já existe

O add-on instala 35 objetos `PrometheusRule`. Entre os alertas, verificados como presentes:

| Alerta | Dispara quando |
|---|---|
| `KubePodCrashLooping` | um container está em `CrashLoopBackOff` (por 15 minutos) |
| `KubePodNotReady` | um Pod não fica pronto por 15 minutos |
| `KubeContainerWaiting` | um container fica preso esperando (pull de imagem, erro de configuração) por uma hora |
| `KubeDeploymentReplicasMismatch` | um Deployment não tem as réplicas disponíveis desejadas |
| `KubeJobFailed` | um Job falhou |
| `KubeMemoryOvercommit` | os requests de memória passam do que o cluster tolera perdendo um nó |
| `CPUThrottlingHigh` | um container sofre muito throttling de CPU |
| `NodeFilesystemSpaceFillingUp` | um sistema de arquivos deve encher em 24h / 4h |
| `NodeFilesystemAlmostOutOfSpace` | menos de 5% / 3% livre |
| `NodeMemoryHighUtilization` | memória do nó acima de 90% |
| `Watchdog` | sempre disparando, de propósito |

A regra de crash loop, como vem:

```
max_over_time(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff", job="kube-state-metrics", namespace=~".*"}[5m]) >= 1
```

O `Watchdog` é um dead man's switch: roteie-o para um serviço externo que avisa quando ele **para** de chegar, e é assim que você descobre que o próprio Prometheus ou o Alertmanager caiu.

Todo alerta que vem pronto aponta para um runbook explicando causas e correções (annotation `runbook_url`).

### Escrevendo as suas regras

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: team-a-alerts
  namespace: team-a
  labels:
    release: kube-prom-stack             # exigido pelo ruleSelector padrão
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

Verificado: com o label `release: kube-prom-stack`, o grupo `team-a` e o alerta `PodRestartingOften` apareceram no `/api/v1/rules` do Prometheus em menos de um minuto. Sem o label, a regra é ignorada em silêncio, exatamente como acontece com ServiceMonitors.

Regras que dão bons alertas são sobre **sintomas que precisam de uma pessoa**: algo quebrou ou está para quebrar. O `for:` evita alertar por uma oscilação. Coloque nas annotations os detalhes de que quem responde precisa (o quê, onde, um link de runbook).

Teste as expressões na interface do Prometheus (aba Graph) antes de transformá-las em regras, e confira `/alerts` para ver o estado delas: `inactive`, `pending` (condição verdadeira, esperando o `for`), `firing`.

### Roteamento: do receiver null para pessoas

A configuração do Alertmanager do add-on, verificada:

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

Os alertas disparam e não são roteados para lugar nenhum. Dois jeitos de resolver:

**Values do Helm** para a stack inteira (com o add-on: `--kube-prometheus-stack-values`):

```yaml
alertmanager:
  alertmanagerSpec:
    secrets: [slack]          # Secret "slack" montada em /etc/alertmanager/secrets/slack/
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

Objetos **AlertmanagerConfig**, por namespace, para que cada time roteie os seus alertas:

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

No add-on o Alertmanager seleciona AlertmanagerConfigs de todos os namespaces (verificado: selectors vazios). O operator restringe cada um automaticamente aos alertas com `namespace=<o namespace dele>`, então alertas de nível de nó (disco, memória) ainda precisam de uma rota na configuração principal.

### Silences e inibição

- **Silences** calam os alertas que casam durante uma janela de tempo (manutenção): pela interface do Alertmanager via `kubectl -n observability port-forward svc/kube-prom-stack-kube-prome-alertmanager 9093`, ou `amtool silence add`.
- **Inibição** (já configurada no add-on) cala alertas `warning` quando um `critical` dispara para o mesmo namespace e nome de alerta, para que um incidente não chame três vezes.

## Trade-offs

- **Regras prontas vs regras próprias.** O conjunto pronto cobre bem a plataforma e pode ser barulhento em clusters pequenos (por exemplo alertas de overcommit num nó único); ajuste ou desative regras individuais em vez de ignorar o canal.
- **Roteamento central vs AlertmanagerConfig por namespace.** A configuração central mantém um único lugar para revisar; objetos por namespace deixam os times donos do próprio roteamento, ao preço de mais lugares para olhar.
- **Alertar por causas vs por sintomas.** Alertas por causas (CPU em 80%) são barulhentos e muitas vezes irrelevantes; alertas por sintomas (crash loops, taxas de erro, um disco prestes a encher) apontam para o que precisa de ação.

## Lab

Neste lab você recebe uma regra de alerta (`PrometheusRule`) que parece razoável e não faz nada: o Prometheus não a carrega, a expressão não casa com nenhuma série e o `for` de uma hora a deixaria muda por tempo demais. O seu trabalho é consertar a regra até o alerta chegar ao Alertmanager. A ideia central é sentir que um alerta pode falhar em silêncio em três lugares diferentes (seleção da regra, expressão e tempo), e que cada um deixa um sintoma distinto.

**O cenário**

O teste instala o Prometheus Operator (v0.94.1) num cluster Kubernetes real (k3s, subido pelo Testcontainers) e consulta as APIs do Prometheus e do Alertmanager.

- `src/test/resources/k8s/app.yaml`: já vem pronto, com o `example-app` (2 réplicas) no namespace `shop`, seu ServiceMonitor, e um Pod `bad-client` que pede uma página inexistente a cada segundo, então o app responde 404 o tempo todo.
- `src/test/resources/k8s/monitoring.yaml`: já vem pronto, com o Prometheus `lab` e o Alertmanager `lab` em `monitoring`. O Prometheus carrega PrometheusRules de qualquer namespace, mas só as que tiverem o label do seu `ruleSelector`.
- `src/main/resources/k8s/rules.yaml`: o único arquivo que você edita. Tem o alerta `ExampleAppErrors`, para erros 4xx ou 5xx.
- `src/test/java/AlertingTest.java`: em até uns dois minutos e meio, exige que o Prometheus tenha carregado a regra e que o alerta esteja disparando no Alertmanager com `severity: warning`.

**O que você vai fazer, passo a passo**

1. **Rodar os testes e ler as mensagens.** Elas mostram os grupos de regras que o Prometheus carregou, os alertas dele com o estado, e os labels reais de `http_requests_total`.
2. **Fazer o Prometheus carregar a regra (TODO-00).** Leia o `ruleSelector` em `monitoring.yaml` e dê à `PrometheusRule` o label que ele exige.
3. **Casar a expressão com as séries do app (TODO-01).** A expressão não retorna nada. Compare os nomes e valores dos labels que ela usa com os labels reais da métrica, que a mensagem de falha lista.
4. **Disparar em cerca de um minuto (TODO-02).** O `for: 1h` é longo demais. A equipe quer saber de erros em cerca de um minuto, mas não por causa de um erro isolado: escolha um `for` que faça as duas coisas.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/alertmanager-basic-alerts test` passa: o Prometheus carregou `ExampleAppErrors` e o Alertmanager recebeu o alerta com `severity: warning`. Você deve conseguir dizer qual dos três erros faz a regra sumir da lista, qual a deixa sem série e qual a deixa em `pending` para sempre.

**Desafios opcionais**

- **TODO-03:** roteie alertas `severity: warning` para um receiver com um `AlertmanagerConfig` em `shop`. Que label o `AlertmanagerConfig` precisa ter, e que matcher o operator acrescenta sozinho às rotas?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s`, que baixa o Prometheus Operator v0.94.1 e imagens de `quay.io`), o artigo "Alertmanager and Basic Alerts" e, opcionalmente, o lab "Prometheus, Grafana and ServiceMonitors".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/alertmanager-basic-alerts test`. Os comentários `TODO-00` a `TODO-02` em `rules.yaml` marcam os três pontos. A primeira execução baixa bastante coisa e demora.

## Documentation Links

- [Prometheus docs: Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/): `expr`, `for`, labels e annotations.
- [Prometheus docs: Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/): rotas, receivers, inibição.
- [Prometheus Operator: Alerting](https://prometheus-operator.dev/docs/developer/alerting/): PrometheusRule e AlertmanagerConfig.
- [kube-prometheus runbooks](https://runbooks.prometheus-operator.dev/): o que cada alerta pronto significa e como responder.
