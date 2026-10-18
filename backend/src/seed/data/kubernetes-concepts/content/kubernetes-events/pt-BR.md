---
version: 1.0
updatedAt: 2026-09-26
title: "Eventos do Kubernetes"
summary: "Tipos e campos de eventos, como lê-los na ordem certa (a armadilha do sort-by), retenção de cinco minutos no MicroK8s, e exportação de eventos."
---
## Objective

Eventos são a memória de curto prazo do cluster: o scheduler, o kubelet e os controllers registram o que fizeram ou não conseguiram fazer (`Scheduled`, `Pulled`, `FailedMount`, `BackOff`, `Killing`, `ScalingReplicaSet`). São o jeito mais rápido de responder "o que acabou de acontecer com este Pod", e somem rápido: uma hora por padrão, e só **cinco minutos** no MicroK8s. Este conceito cobre tipos e campos de eventos, como lê-los na ordem certa (incluindo uma armadilha clássica do `--sort-by`), quanto tempo eles vivem, e como guardá-los por mais tempo quando você precisa.

## Use Cases

- Descobrir por que um Pod está `Pending`, `ContainerCreating` ou reiniciando.
- Ver a linha do tempo de um rollout entre ReplicaSets e Pods.
- Limpar eventos antigos e barulhentos de um namespace durante a depuração.
- Guardar eventos para análise pós-incidente.

## Deep Dive

### O que um evento contém

```bash
kubectl -n team-a get events
```

Campos principais: `type` (`Normal` ou `Warning`), `reason` (um código em CamelCase como `FailedScheduling`), `message`, o `involvedObject` (kind, nome), o componente que reportou, e timestamps. Eventos idênticos repetidos são agregados: em vez de 50 eventos você vê um com um contador, mostrado como `(x21 over 19m)` pelo `kubectl events`.

Eventos são objetos da API (`events.k8s.io/v1`, também legíveis pela API core `v1` de Event), guardados no datastore do cluster, com namespace igual ao do objeto que descrevem.

### Lendo os eventos

Por objeto, o `describe` mostra os eventos relevantes no fim. Num namespace inteiro:

```bash
kubectl -n team-a events                       # ordenados por tempo, mais novos por último
kubectl -n team-a events --types=Warning       # só problemas
kubectl -n team-a events --for pod/web-xyz     # um objeto
kubectl events -A --types=Warning -w           # observa o cluster inteiro
```

Filtrando com field selectors:

```bash
kubectl -n team-a get events --field-selector type=Warning,reason=FailedScheduling
kubectl -n team-a get events --field-selector involvedObject.name=web-xyz
```

### A armadilha do sort-by

O muito copiado `kubectl get events --sort-by=.lastTimestamp` ordena alguns eventos errado. Componentes mais novos (o scheduler entre eles) escrevem eventos pela API `events.k8s.io` só com `eventTime` e `series`; o `lastTimestamp` legado fica vazio. Verificado no k3s v1.36:

```
$ kubectl get events --field-selector reason=FailedScheduling \
    -o custom-columns=LAST:.lastTimestamp,EVENTTIME:.eventTime,SERIES:.series.count
LAST    EVENTTIME                     SERIES
<nil>   2026-09-26T19:59:44.454632Z   <none>
<nil>   2026-09-26T20:01:36.131499Z   2
```

Ordenar por `.lastTimestamp` junta todos esses eventos `<nil>` numa das pontas, então os eventos mais importantes para "por que o meu Pod está Pending" aparecem fora do lugar. O `kubectl events` (comando regular do kubectl desde a 1.26) entende os dois formatos e ordena corretamente; prefira-o.

### Retenção: somem em minutos

O API server apaga eventos depois do `--event-ttl`: **1 hora** por padrão no Kubernetes upstream. O MicroK8s define bem menos. Verificado em `/var/snap/microk8s/current/args/kube-apiserver` na 1.35:

```
--event-ttl=5m
```

Cinco minutos. Se um Pod falhou de madrugada, os eventos dele sumiram muito antes da manhã; um `describe` mostra `Events: <none>` e as pessoas concluem "não aconteceu nada". Para mudar, edite esse arquivo e reinicie:

```bash
sudo sed -i 's/--event-ttl=5m/--event-ttl=1h/' /var/snap/microk8s/current/args/kube-apiserver
sudo snap restart microk8s
```

Um TTL maior custa espaço no datastore e carga de escrita em clusters movimentados; uma hora é um meio-termo razoável. Para qualquer coisa mais longa, exporte os eventos.

### Guardando eventos por mais tempo

Eventos pertencem à sua stack de observabilidade, não ao datastore:

- O **Grafana Alloy** tem um componente `loki.source.kubernetes_events` que envia eventos ao Loki como logs.
- O **kube-state-metrics** não exporta eventos, mas o ecossistema do Prometheus tem exporters de eventos.
- A opção mais simples: `kubectl events -A -w -o json >> events.log` a partir de um Pod pequeno ou de um serviço do systemd.

Uma vez no Loki, você os consulta ao lado dos logs dos containers: `{job="loki.source.kubernetes_events"} |= "BackOff"`.

### Apagando eventos

Eventos são objetos comuns, então você pode tirar o barulho durante uma depuração:

```bash
kubectl -n team-a delete events --all
kubectl -n team-a delete events --field-selector reason=BackOff
```

Isso não afeta mais nada; os controllers emitem eventos novos conforme as coisas acontecem. Não coloque isso em script na produção, você só perde informação.

### Reasons úteis de conhecer

| Reason | De | Significado |
|---|---|---|
| `FailedScheduling` | scheduler | nenhum nó serve (resources, PVC, taints, affinity) |
| `FailedMount`, `FailedAttachVolume` | kubelet | problemas com Secret/ConfigMap/PVC |
| `Failed` + `ErrImagePull` / `BackOff` no pull | kubelet | falhas de pull de imagem |
| `BackOff` restarting | kubelet | crash loop |
| `Unhealthy` | kubelet | falha de probe |
| `Killing` | kubelet | container parado (liveness, remoção, preempção) |
| `Evicted`, `EvictionThresholdMet` | kubelet | pressão no nó |
| `ScalingReplicaSet` | controller de deployment | progresso do rollout |
| `BackoffLimitExceeded` | controller de job | Job falhou |

## Trade-offs

- **TTL de eventos curto vs longo.** TTLs curtos mantêm o datastore pequeno e jogam fora a evidência de que você precisa para qualquer coisa não investigada na hora.
- **`kubectl events` vs `get events`.** O comando dedicado ordena direito e agrega bem; o `get events` suporta formatos de saída customizados e funciona em qualquer lugar.
- **Exportar eventos vs depender da API.** Exportar exige um pipeline, mas dá histórico e busca; a API não exige configuração e é esquecida por design.

## Lab

Neste lab você recebe um script `latest-warning.sh` que parece correto e imprime o evento errado. O seu trabalho é descobrir quais eventos ele perde e por quê, e fazê-lo imprimir de fato o Warning mais recente do namespace. A ideia central é sentir que ordenar eventos por `.lastTimestamp` não é confiável: nem todo evento preenche esse campo.

**O cenário**

Um cluster Kubernetes real (k3s, subido pelo Testcontainers) recebe, no namespace `shop`, um Job que falha e, alguns segundos depois, um Pod que pede mais memória do que qualquer nó tem.

- `src/test/resources/k8s/migrate.yaml`: já vem pronto, um Job `migrate` que falha uma vez, cedo (`backoffLimit: 0`).
- `src/test/resources/k8s/report.yaml`: já vem pronto, um Pod `report` criado depois, pedindo `100Gi` de memória, que nenhum nó comporta.
- `src/main/resources/latest-warning.sh`: o único arquivo que você edita. Recebe o namespace e hoje faz `kubectl get events --field-selector type=Warning --sort-by=.lastTimestamp` e pega a última linha.
- `src/test/java/EventsTest.java`: roda o script dentro do nó e exige exatamente uma linha: o warning `FailedScheduling` do `pod/report`, com `Insufficient memory`.

**O que você vai fazer, passo a passo**

1. **Rodar os testes primeiro.** O script imprime o warning do Job, que é mais antigo. A mensagem de falha lista todos os warnings com `lastTimestamp` e `eventTime`.
2. **Entender o que falta (TODO-00).** Compare os dois campos de tempo na listagem: eventos de fontes diferentes preenchem campos diferentes, e o que não preenche um deles não entra na ordenação do jeito que você espera.
3. **Imprimir o Warning mais recente de verdade (TODO-00).** Reescreva o script para ordenar por um critério que cubra todos os eventos, ou use outra forma de listar os eventos que já os ordene, e imprima uma única linha com motivo, objeto e mensagem.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/kubernetes-events test` passa: o script termina com sucesso, imprime exatamente uma linha e ela é o `FailedScheduling` do `pod/report`. Você deve conseguir explicar por que o `--sort-by=.lastTimestamp` escolheu o evento do Job.

**Desafios opcionais**

- **TODO-01:** imprima todos os warnings de um único objeto (por exemplo `pod/report`), inclusive os repetidos. Como o `kubectl events` mostra um evento que aconteceu muitas vezes, e qual campo guarda a contagem em cada tipo de evento?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s` e baixam `busybox` dentro dele) e o artigo "Kubernetes Events".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/kubernetes-events test`. O comentário `TODO-00` em `latest-warning.sh` marca o que mudar, e o teste mostra todos os warnings do namespace quando o resultado está errado.

## Documentation Links

- [kubectl events reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/): filtros, watch, ordenação.
- [Kubernetes API: Event (events.k8s.io/v1)](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/): campos, incluindo `eventTime` e `series`.
- [kube-apiserver flags (--event-ttl)](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/): padrão de retenção.
- [Grafana Alloy: loki.source.kubernetes_events](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.kubernetes_events/): enviando eventos ao Loki.
