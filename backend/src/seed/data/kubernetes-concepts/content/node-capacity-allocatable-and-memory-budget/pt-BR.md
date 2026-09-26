---
version: 1.0
updatedAt: 2026-09-26
title: "Capacidade do Nó, Allocatable e Orçamento de Memória"
summary: "Por que o scheduler compara requests com allocatable e não com a memória livre, Pods Pending por Insufficient memory, reservar memória para o sistema e um orçamento de memória do nó."
---
## Objective

O scheduler posiciona Pods comparando os **requests** deles com os recursos **allocatable** do nó, e não com o que está realmente livre. Num cluster MicroK8s de nó único esses dois números se distanciam rápido: o sistema operacional, os serviços do próprio snap e cada add-on consomem memória que o scheduler desconhece. O resultado é ou Pods presos em `Pending` com `Insufficient memory` enquanto o `free` mostra memória sobrando, ou o contrário, um nó que aceitou tudo no papel e começa a fazer eviction ou OOM kill sob carga real. Este conceito cobre capacity vs allocatable, por que um Pod fica `Pending` e como montar um orçamento de memória honesto para um nó.

## Use Cases

- Um Deployment novo fica `Pending` e o `describe` diz `0/1 nodes are available: 1 Insufficient memory`.
- Decidir se uma VM de 16 GiB é suficiente para um banco de dados, um cache, monitoramento e alguns serviços web.
- Proteger o próprio nó (SSH, containerd, o API server) de ficar sem recursos por causa dos workloads.
- Explicar por que o kubelet fez eviction de Pods com `The node was low on resource: memory`.

## Deep Dive

### Capacity vs allocatable

```bash
kubectl describe node <node>
```

Verificado numa VM MicroK8s 1.35 de 4 GiB:

```
Capacity:
  cpu:                2
  memory:             3995108Ki
  pods:               110
Allocatable:
  cpu:                2
  memory:             3892708Ki
  pods:               110
```

`allocatable = capacity - kube-reserved - system-reserved - limite de eviction`. O MicroK8s não define reservas, só a flag do kubelet `--eviction-hard="memory.available<100Mi,nodefs.available<1Gi,imagefs.available<1Gi"`. Então allocatable é a capacity menos exatamente 100 MiB: o scheduler acredita que quase a máquina inteira está disponível para Pods.

Naquele momento, com nada além dos add-ons básicos rodando, a VM já usava cerca de 900 MiB (`free -m`), e o `kubectl top node` reportou 1,4 GiB depois de habilitar ingress e metrics-server. Nada disso é visível para o scheduler.

### O que o scheduler conta

Só **requests**. O `kubectl describe node` mostra o total atual:

```
Allocated resources:
  Resource           Requests      Limits
  --------           --------      ------
  cpu                1650m (82%)   4 (200%)
  memory             2816Mi (74%)  5Gi (134%)
```

- Um Pod cabe se `soma(requests no nó) + os requests dele <= allocatable`. O uso real é irrelevante.
- Os limits podem somar mais de 100% (overcommit). Isso é permitido e normal; também é como um nó fica sem memória de verdade.
- Um Pod sem requests (`BestEffort`) sempre cabe, e é o primeiro a sofrer eviction.

### Pending por causa de memória

```yaml
resources:
  requests:
    memory: 100Gi
```

```
$ kubectl describe pod bigmem
Events:
  Warning  FailedScheduling  default-scheduler  0/1 nodes are available: 1 Insufficient memory.
  preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
```

Nada está quebrado; o request simplesmente é maior do que o que sobrou do allocatable. As correções, em ordem de preferência: reduzir um request superdimensionado (meça antes), remover ou reduzir outra coisa, adicionar memória ou um nó. Rolling updates também caem nisso: com `maxSurge`, o Pod novo precisa de espaço **enquanto o antigo ainda segura o request dele**, então um nó a 90% consegue rodar o serviço mas não atualizá-lo. `strategy: Recreate` ou `maxSurge: 0` evitam isso em workloads de uma réplica.

### Reservando memória para o sistema

Diga ao kubelet o que guardar para o SO e para o próprio Kubernetes, em `/var/snap/microk8s/current/args/kubelet` (substitua a linha `--eviction-hard` existente em vez de adicionar uma segunda):

```
--system-reserved=memory=1Gi,cpu=500m
--kube-reserved=memory=1Gi,cpu=500m
--eviction-hard=memory.available<500Mi,nodefs.available<10%,imagefs.available<10%
```

```bash
sudo snap restart microk8s
kubectl describe node | grep -A6 Allocatable
```

O allocatable cai de acordo. Os Pods existentes continuam rodando, mas o scheduler agora recusa workloads que empurrariam o nó para a zona reservada, e esse é exatamente o ponto: um Pod `Pending` é uma falha muito melhor do que um banco de dados morto por OOM.

### Montando um orçamento de memória

Num nó único, escreva o orçamento. Exemplo, VM de 16 GiB:

| Consumidor | Memória |
|---|---|
| SO, SSH, journald, snapd | 0,8 GiB |
| MicroK8s (kubelite, dqlite, containerd) | 0,8 GiB |
| Add-ons: Calico, CoreDNS, Traefik, metrics-server, cert-manager | 0,6 GiB |
| Observabilidade (Prometheus, Grafana, Loki, Alloy) | 2,0 GiB |
| Banco de dados (buffers + conexões) | 2,5 GiB |
| Cache (ex.: Redis, com o seu `maxmemory`) | 1,0 GiB |
| Fila de mensagens | 1,0 GiB |
| 4 serviços web x 768 MiB | 3,0 GiB |
| Folga para rolling update (um Pod extra de serviço) | 0,8 GiB |
| Margem de segurança | 1,5 GiB |
| **Total** | **~14 GiB** |

Depois faça o cluster concordar com a tabela:

- `system-reserved` + `kube-reserved` cobrem as três primeiras linhas.
- O **request** de memória de cada workload é igual à sua linha, e o **limit** é igual ao request para tudo que é stateful ou tem heap gerenciado (comportamento previsível, parecido com `Guaranteed`; veja o conceito de QoS).
- Meça com `kubectl top pods -A` e Prometheus depois de uma semana de tráfego real e revise os números.

O page cache do kernel é o extra silencioso: bancos de dados e filas que leem arquivos dependem dele para ter desempenho, e ele não entra nos limits dos containers. Um nó sem memória livre para cache funciona, mas devagar.

### Eviction vs OOM kill

Dois mecanismos diferentes encerram um Pod sob pressão de memória:

- **Eviction do kubelet**: o `memory.available` do nó cai abaixo do limite de eviction. O kubelet faz eviction de Pods (BestEffort primeiro, depois Burstable que usam mais que o request). O Pod mostra `Status: Failed, Reason: Evicted`.
- **OOM kill do kernel**: um container passa do seu próprio limit de memória, ou o nó fica sem memória antes de o kubelet reagir. O container mostra `Last State: Terminated, Reason: OOMKilled, Exit Code: 137` e reinicia.

Reservas e requests honestos tornam o primeiro raro; limits corretos tornam o segundo um problema local de um container mal comportado.

## Trade-offs

- **Requests apertados vs generosos.** Requests apertados colocam mais coisas no nó e permitem overcommit; requests generosos desperdiçam memória no papel mas fazem as decisões de agendamento baterem com a realidade. Num nó único com serviços stateful, prefira generosos.
- **Reservar recursos custa capacidade.** 2 GiB reservados num nó de 8 GiB são 25% que você não pode agendar. Pular isso só troca o problema de Pods `Pending` por evictions e OOM kills dos serviços do próprio nó.
- **Limits iguais aos requests vs limits maiores.** Valores iguais dão previsibilidade e a classe de QoS `Guaranteed`; limits maiores deixam serviços com picos usarem memória ociosa, com o risco de o nó ficar sem memória quando vários têm pico juntos.

## Documentation Links

- [Kubernetes docs: Reserve Compute Resources for System Daemons](https://kubernetes.io/docs/tasks/administer-cluster/reserve-compute-resources/): fórmula do allocatable, `system-reserved`, `kube-reserved`.
- [Kubernetes docs: Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/): limites e ordem de eviction.
- [Kubernetes docs: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): como os requests guiam o agendamento.
- [MicroK8s: Configuring services](https://canonical.com/microk8s/docs/configuring-services): onde fica o arquivo de args do kubelet.
