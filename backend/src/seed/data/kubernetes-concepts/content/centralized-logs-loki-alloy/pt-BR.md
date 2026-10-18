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

## Lab

Neste lab você recebe um pipeline do Grafana Alloy que descobre Pods e lê seus logs, mas nada chega ao Loki, os logs não têm label de namespace e as senhas passariam em texto puro. O seu trabalho é consertar o `alloy-config.yaml` para entregar os logs ao Loki, deixá-los pesquisáveis por namespace e mascarar senhas antes de saírem do cluster. A ideia central é sentir que em Loki você busca por labels, que o lugar certo para esconder dados sensíveis é o pipeline de coleta, e que o Alloy só diz o que está errado nos próprios logs.

**O cenário**

O teste sobe Loki e Alloy num cluster Kubernetes real (k3s, subido pelo Testcontainers) e consulta a API do Loki.

- `src/test/resources/k8s/logging.yaml`: já vem pronto. Tem o Loki (binário único, armazenamento local), o Alloy, que lê a configuração do ConfigMap `alloy-config`, um Pod `checkout` no namespace `shop` que loga `order N placed` e `login user=alice password=hunter2` a cada segundo, e um Pod `client` para consultar o Loki.
- `src/main/resources/k8s/alloy-config.yaml`: o único arquivo que você edita. O ConfigMap traz o pipeline do Alloy: `discovery.kubernetes`, `discovery.relabel`, `loki.source.kubernetes` e `loki.write`.
- `src/test/java/CentralizedLogsTest.java`: exige que `{namespace="shop"}` retorne os logs do checkout, que nenhuma linha guardada contenha a senha e que as linhas de login mostrem `password=****`.

**O que você vai fazer, passo a passo**

1. **Rodar os testes e ler a mensagem.** Ela mostra os labels que o Loki conhece e os últimos erros do Alloy.
2. **Fazer os logs chegarem ao Loki (TODO-00).** Leia os logs do próprio Alloy: eles dizem por que o `loki.write` não entrega. Confira o endereço do `endpoint` e o que ele precisa ter para o Loki aceitar o envio.
3. **Torná-los pesquisáveis por namespace (TODO-01).** Consultas selecionam logs por labels. Adicione ao `discovery.relabel` uma regra que copie o namespace do Pod (um rótulo `__meta_kubernetes_*`) para o label `namespace`, como já é feito para `pod` e `container`.
4. **Mascarar as senhas (TODO-02).** Coloque um componente `loki.process` entre o `loki.source.kubernetes` e o `loki.write`, com uma regra de substituição que troque o valor da senha por `****`, e faça a fonte encaminhar para ele. Assim o dado sensível nunca sai do cluster.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/centralized-logs-loki-alloy test` passa: `{namespace="shop"}` devolve as linhas `order ... placed`, as linhas de login aparecem com `password=****` e `hunter2` não existe em nenhum log guardado. Você deve conseguir explicar por que mascarar no Alloy é mais seguro do que depender de quem consulta.

**Desafios opcionais**

- **TODO-03:** adicione o label `app` do Pod como label do Loki e depois pense em adicionar o número do pedido como outro. Por que o primeiro é aceitável e o segundo é um problema para o Loki?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s`, que baixa Loki e Alloy de `mirror.gcr.io` e `busybox`) e o artigo "Centralized Logs with Loki and Grafana Alloy".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/centralized-logs-loki-alloy test`. Os comentários `TODO-00` a `TODO-02` em `alloy-config.yaml` marcam os três pontos.

## Documentation Links

- [Grafana: Migrate from Promtail to Grafana Alloy](https://grafana.com/docs/alloy/latest/set-up/migrate/from-promtail/): `alloy convert` e o caminho de migração.
- [Grafana Loki: Promtail agent](https://grafana.com/docs/loki/latest/send-data/promtail/): aviso de deprecação e fim de vida.
- [Grafana Alloy documentation](https://grafana.com/docs/alloy/latest/): componentes como `loki.source.kubernetes`.
- [Grafana Loki: Install with Helm](https://grafana.com/docs/loki/latest/setup/install/helm/): modos de implantação e storage.
- [Kubernetes docs: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/): arquivos de log no nó e rotação.
