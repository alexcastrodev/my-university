---
version: 1.0
updatedAt: 2026-09-26
title: "Requests, Limits, Classes de QoS e OOMKilled"
summary: "Como os requests guiam o agendamento e os limits são aplicados pelo kernel, OOMKilled vs throttling de CPU, e como as classes de QoS decidem a ordem de eviction."
---
## Objective

Todo container pode declarar **requests** (o que o scheduler reserva para ele) e **limits** (o que o kernel deixa ele usar). Os dois são aplicados por partes completamente diferentes do sistema, e memória e CPU se comportam de forma diferente no limite: passar do limit de memória mata o processo (`OOMKilled`), passar do limit de CPU só o deixa mais lento (throttling). A combinação de requests e limits também coloca cada Pod numa **classe de QoS**, que decide quem sofre eviction primeiro quando o nó fica sem recursos. Este conceito cobre os três, com a assinatura de `OOMKilled` que você vai ver na prática.

## Use Cases

- Um serviço reiniciando com exit code 137 e `Reason: OOMKilled`.
- Picos de latência num serviço cujo uso de CPU "nunca chega a 100%".
- Proteger um banco de dados de sofrer eviction antes de Pods menos importantes.
- Impor padrões sensatos num namespace onde os desenvolvedores esquecem de definir resources.

## Deep Dive

### Requests e limits

```yaml
resources:
  requests:
    cpu: 250m          # um quarto de core reservado para o agendamento
    memory: 512Mi
  limits:
    memory: 768Mi      # teto rígido: acima disso, o kernel mata o processo
    # limit de CPU omitido de propósito, veja abaixo
```

- **Requests** são um contrato de agendamento. O scheduler só coloca o Pod num nó cujo allocatable menos os requests dos outros Pods os cubra. Em execução, o request de CPU vira um peso de cgroup: sob disputa, a CPU é dividida proporcionalmente aos requests.
- **Limits** são aplicados pelo kernel Linux através de cgroups no nó, independentemente do scheduler.
- Unidades: CPU em cores ou millicores (`500m` = meio core); memória em bytes com sufixos binários (`Mi`, `Gi`). `512M` (decimal) e `512Mi` (binário) diferem em cerca de 5%.

### Limit de memória: o processo morre

Passar do limit de memória não tem negociação. O OOM killer do kernel encerra o processo no container, e o kubelet reporta. Verificado no k3s com um limit de 64 Mi e um container que aloca 300 MiB:

```
$ kubectl get pod oom
NAME   READY   STATUS      RESTARTS      AGE
oom    0/1     OOMKilled   3 (26s ago)   45s

$ kubectl get pod oom -o jsonpath='{.status.containerStatuses[0].lastState}'
{"terminated":{"exitCode":137,"reason":"OOMKilled", ...}}
```

Exit code 137 = 128 + 9 (SIGKILL). O `kubectl describe pod` mostra o mesmo em `Last State: Terminated, Reason: OOMKilled`. Entre os restarts o Pod mostra `CrashLoopBackOff`.

Um container `OOMKilled` usou mais memória do que o limit. A correção é um limit maior ou menos uso de memória. Runtimes com gerenciamento de memória próprio (JVM, Node.js, .NET) leem o limit do container e dimensionam o heap a partir dele; um heap configurado perto demais do limit não deixa espaço para o resto do processo e termina em `OOMKilled` em vez de um erro de falta de memória dentro do processo.

Não confunda com **eviction**: quando o próprio nó fica com pouca memória, o kubelet faz eviction de Pods inteiros (`Status: Failed, Reason: Evicted`), até de Pods abaixo dos seus limits.

### Limit de CPU: o processo fica lento

Um limit de CPU é aplicado por cota do CFS: o container recebe `limit x 100ms` de tempo de CPU a cada período de 100 ms. Um processo com várias threads e limit de `500m` pode gastar os seus 50 ms de cota nos primeiros 10 ms de um período em várias threads e depois ficar **throttled** por 90 ms. O uso médio de CPU parece baixo, mas as requisições travam. A métrica `container_cpu_cfs_throttled_periods_total` no Prometheus mostra isso.

É por isso que muitos times definem **requests** de CPU sempre e **limits** de CPU raramente: o request garante uma fatia justa sob disputa, e sem limit o serviço pode usar CPU ociosa em picos como a inicialização ou o aquecimento de cache. Limits de memória, ao contrário, devem ser sempre definidos, porque memória não é compressível.

### Classes de QoS

O Kubernetes deriva a classe dos resources de todos os containers do Pod:

| Classe | Regra | Prioridade de eviction |
|---|---|---|
| `Guaranteed` | todo container tem requests de CPU **e** memória iguais aos limits | sai por último |
| `Burstable` | pelo menos um request ou limit definido, mas não é Guaranteed | no meio |
| `BestEffort` | nenhum request e nenhum limit | sai primeiro |

Verificado: um Pod com request = limit = 1Gi de memória, mas request de CPU 500m e limit de CPU 2, é `Burstable` (os valores de CPU diferem); um Pod só com limit de memória também é `Burstable` (o request assume o valor do limit quando só o limit é informado); um Pod sem nada definido é `BestEffort`.

```bash
kubectl get pods -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass
```

Sob pressão de memória no nó, o kubelet faz eviction primeiro dos Pods BestEffort, depois dos Burstable que mais usam memória acima do request. Isso também afeta o OOM score do kernel: Pods Guaranteed são os últimos candidatos quando o nó inteiro fica sem memória.

Para um banco de dados num nó compartilhado, `Guaranteed` é a classe a buscar, e isso exige limits de CPU iguais aos requests. Esse é um lugar legítimo para aceitar um limit de CPU.

### Padrões por namespace: LimitRange

Pods sem resources são BestEffort e invisíveis para o scheduler. Uma LimitRange preenche padrões e impõe limites:

```yaml
apiVersion: v1
kind: LimitRange
metadata: {name: defaults, namespace: team-a}
spec:
  limits:
    - type: Container
      defaultRequest: {cpu: 100m, memory: 256Mi}
      default: {memory: 512Mi}           # limit padrão
      max: {memory: 4Gi}
```

Uma ResourceQuota limita o total do namespace (`requests.memory: 8Gi`), útil quando vários times dividem um nó.

## Trade-offs

- **Limits de CPU vs nenhum.** Limits dão previsibilidade e isolamento entre tenants; também causam throttling que parece latência misteriosa. Num nó que você controla, requests sem limits de CPU são uma escolha comum e defensável, exceto onde você quer `Guaranteed`.
- **Limit de memória = request vs limit > request.** Valores iguais significam nenhuma surpresa e nenhum overcommit. Um limit maior deixa um serviço ter picos mas permite overcommit no nó, o que termina em evictions quando vários Pods têm pico ao mesmo tempo.
- **Limits apertados economizam capacidade, limits folgados economizam incidentes.** Comece generoso, meça com `kubectl top` e Prometheus, depois aperte.

## Documentation Links

- [Kubernetes docs: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): unidades, requests, limits, aplicação.
- [Kubernetes docs: Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/): regras das classes e comportamento de eviction.
- [Kubernetes docs: Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/): padrões por namespace.
- [Kubernetes docs: Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/): totais por namespace.
