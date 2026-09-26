---
version: 1.0
updatedAt: 2026-09-26
title: "Logs Centralizados com Loki e Grafana Alloy"
summary: "Como os logs dos containers são coletados, o que o add-on traz (Loki 2.6 e o Promtail em fim de vida), a migração para o Alloy, labels e LogQL."
---
## Objective

O `kubectl logs` lê arquivos de log que o kubelet mantém no nó, de containers que ainda existem, e só da execução atual e da anterior de cada um. Quando um Pod é apagado, reagendado ou reiniciado duas vezes, os logs dele somem. Logging centralizado coleta o stdout/stderr de todo container de todo nó num armazenamento que você consulta entre Pods e ao longo do tempo. No Kubernetes, o padrão leve é o **Loki** para armazenamento e um agente de nó para enviar os logs. Esse agente costumava ser o Promtail, que chegou ao **fim de vida em 2 de março de 2026**; o sucessor é o **Grafana Alloy**. Este conceito cobre como os logs dos containers são coletados, o que o add-on do MicroK8s oferece, a migração do agente para o Alloy, e consultas com LogQL.

## Use Cases

- Ler os logs de um Pod que caiu e foi substituído uma hora atrás.
- Procurar um ID de requisição em todas as réplicas de um serviço.
- Correlacionar erros entre namespaces durante um incidente.
- Guardar eventos do Kubernetes ao lado dos logs das aplicações.

## Deep Dive

### Onde ficam os logs dos containers

Os containers escrevem no stdout e no stderr; o container runtime grava isso em arquivos no nó:

```
/var/log/pods/<namespace>_<pod>_<uid>/<container>/0.log
```

O kubelet faz a rotação deles (10 MiB, 5 arquivos por padrão). Um agente de nó (um DaemonSet) acompanha esses arquivos, anexa metadados do Kubernetes como labels, e os envia ao Loki. A aplicação só precisa logar no stdout/stderr, de preferência um evento por linha, idealmente estruturado (JSON).

### O que o add-on do MicroK8s traz

`microk8s enable observability` instala, verificado na 1.35 no namespace `observability`: `loki-0` (imagem `grafana/loki:2.6.1`) e um DaemonSet `loki-promtail` (imagem `grafana/promtail:3.5.1`), com o Loki configurado como data source do Grafana. Consultar a API do Loki mostrou os labels que o Promtail anexa:

```
app, component, container, filename, instance, job, namespace, node_name, pod, stream
```

e linhas de log chegando do ingress controller:

```json
{"stream":{"namespace":"ingress","pod":"traefik-vkpfl","container":"traefik",
           "job":"ingress/traefik","stream":"stderr", ...},
 "values":[["1790456488695750386","E0926 21:01:28 ... nodes is forbidden ..."]]}
```

Funciona, com duas ressalvas: o Loki 2.6 é um release de 2022, e o Promtail não recebe mais correções, incluindo de segurança. Como o resto do add-on, o Loki também não tem PVC, então os logs somem quando o Pod reinicia. Trate como um ambiente de laboratório.

### A stack atual: Loki + Alloy

Para uma instalação mantida, instale a partir dos charts upstream:

- **Loki** (Helm chart `grafana/loki`) em modo single-binary ou simple-scalable, com um PVC ou object storage (S3, MinIO) para os chunks, e um período de retenção.
- **Alloy** (Helm chart `grafana/alloy`) como DaemonSet. Ele substitui o Promtail e também coleta métricas, traces e eventos do Kubernetes.

Um pipeline mínimo do Alloy para logs de Pods:

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

Uma configuração existente do Promtail é convertida automaticamente:

```bash
alloy convert --source-format=promtail --output=config.alloy promtail.yaml
```

### Labels: poucos e limitados

O Loki indexa **labels**, não o conteúdo dos logs. Cada combinação única de labels é um stream separado. Bons labels têm poucos valores: `namespace`, `app`, `container`, `node`. Nunca transforme IDs de requisição, de usuário ou de trace em labels; isso cria milhões de streams e deixa tudo lento. Procure por eles no conteúdo.

### Consultando com LogQL

No Grafana, Explore, data source Loki:

```
{namespace="team-a", app="web"}                                  # todos os logs da aplicação
{namespace="team-a"} |= "ERROR"                                  # linha contém
{namespace="team-a", app="web"} | json | status >= 500           # interpreta JSON, filtra um campo
{namespace="team-a"} |= "req-7f3a9c"                             # uma requisição em todos os Pods
sum by (pod) (count_over_time({namespace="team-a"} |= "ERROR" [5m]))   # erros por Pod, como métrica
```

A última forma transforma logs em séries temporais, que o Grafana consegue plotar e o ruler do Loki consegue usar em alertas.

### Dimensionamento e retenção

Logs crescem rápido. Decida de antemão:

- **Retenção** (por exemplo 7 a 30 dias) aplicada pelo compactor do Loki.
- **Armazenamento**: um PVC para um nó único, object storage além disso.
- **Ruído**: descarte logs de debug ou logs de acesso de health checks no agente (`loki.process` com um `stage.drop`) em vez de pagar para guardá-los.

## Trade-offs

- **Loki vs Elasticsearch/OpenSearch.** O Loki indexa só labels, então é barato de rodar e de armazenar, e busca de texto completo é uma varredura; o Elasticsearch indexa o conteúdo para buscas arbitrárias rápidas, a um custo de recursos muito maior.
- **Add-on vs charts upstream.** O add-on é um comando só, com componentes desatualizados e sem suporte; os charts upstream são atuais e precisam ser configurados e atualizados por você.
- **Agente em cada nó vs sidecars.** Um agente em DaemonSet coleta tudo com um Pod por nó; sidecars só fazem sentido para aplicações que não conseguem logar no stdout.

## Documentation Links

- [Grafana: Migrate from Promtail to Grafana Alloy](https://grafana.com/docs/alloy/latest/set-up/migrate/from-promtail/): `alloy convert` e o caminho de migração.
- [Grafana Loki: Promtail agent](https://grafana.com/docs/loki/latest/send-data/promtail/): aviso de deprecação e fim de vida.
- [Grafana Alloy documentation](https://grafana.com/docs/alloy/latest/): componentes como `loki.source.kubernetes`.
- [Grafana Loki: Install with Helm](https://grafana.com/docs/loki/latest/setup/install/helm/): modos de implantação e storage.
- [Kubernetes docs: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/): arquivos de log no nó e rotação.
