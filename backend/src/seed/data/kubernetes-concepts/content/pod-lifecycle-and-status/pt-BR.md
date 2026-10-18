---
version: 1.0
updatedAt: 2026-09-26
title: "Ciclo de Vida e Status do Pod"
summary: "Phases, conditions e estados de container por trás da coluna STATUS, de onde cada status vem, e o que verificar primeiro em cada caso."
---
## Objective

A coluna `STATUS` do `kubectl get pods` parece uma máquina de estados, mas é um resumo calculado pelo kubectl a partir de vários campos: a **phase** do Pod (só cinco valores), as **conditions** (agendado, inicializado, pronto), e o **estado** de cada container com o seu **reason**. `CrashLoopBackOff`, `ImagePullBackOff` ou `OOMKilled` não são phases, são reasons de container. Ler o campo certo diz em segundos qual componente culpar: o scheduler, o kubelet, o registry de imagens ou a sua aplicação. Este conceito mapeia cada status que você vai ver com frequência para a sua origem e para o que verificar em seguida.

## Use Cases

- Triagem de um deploy com falha: é agendamento, pull, configuração ou a própria aplicação?
- Escrever scripts ou alertas que verificam a saúde de Pods corretamente.
- Explicar por que um Pod mostra `Running` mas `READY 0/1`.
- Reconhecer estados esperados (`Completed`, `ContainerCreating`) em vez de problemas reais.

## Deep Dive

### As cinco phases

| Phase | Significado |
|---|---|
| `Pending` | aceito pela API, mas nem todos os containers estão rodando ainda (não agendado, baixando imagens, init containers rodando) |
| `Running` | vinculado a um nó, pelo menos um container rodando ou reiniciando |
| `Succeeded` | todos os containers saíram com 0 e não vão reiniciar (Jobs) |
| `Failed` | todos os containers terminaram, pelo menos um com erro, sem restart |
| `Unknown` | o nó parou de reportar |

```bash
kubectl get pod web-xyz -o jsonpath='{.status.phase}'
```

Um Pod em `CrashLoopBackOff` normalmente está na phase `Running`: o container continua sendo reiniciado, e a phase não muda.

### O caminho de um Pod saudável

```
Pending (não agendado)  ->  Pending (ContainerCreating / Init:0/1)  ->  Running  ->  (Succeeded | Failed quando roda até terminar)
   scheduler                  kubelet: volumes, pull da imagem, init containers     containers sobem, probes rodam
```

As conditions registram cada etapa: `PodScheduled`, `PodReadyToStartContainers`, `Initialized`, `ContainersReady`, `Ready`.

```bash
kubectl get pod web-xyz -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}{"\n"}{end}'
```

### Valores de STATUS e de onde vêm

Verificado no k3s v1.36, salvo indicação em contrário:

| STATUS | Origem | Causa típica | Primeira verificação |
|---|---|---|---|
| `Pending` | scheduler | nenhum nó serve: `Insufficient memory`, PVC sem bind, taints, node selector | eventos `FailedScheduling` no `describe pod` |
| `ContainerCreating` | kubelet | baixando a imagem, montando volumes; preso = `FailedMount` | eventos no `describe pod` |
| `Init:0/1`, `Init:Error`, `Init:CrashLoopBackOff` | init containers | um init container ainda rodando ou falhando | `logs <pod> -c <init-container>` |
| `ErrImagePull`, `ImagePullBackOff` | kubelet + registry | tag errada, sem credenciais, CA não confiável, arquitetura errada | eventos `Failed` no `describe pod` |
| `CreateContainerConfigError` | kubelet | ConfigMap/Secret ou chave referenciada faltando (`couldn't find key nope in ConfigMap lab/appcfg`), `runAsNonRoot` numa imagem root | `describe pod`, `waiting.message` do container |
| `RunContainerError` / `StartError` | container runtime | não conseguiu iniciar o processo: conflitos de montagem (`read-only file system`), binário do entrypoint inexistente | `lastState.terminated.message` |
| `Running` com `READY 0/1` | probes do kubelet | readiness probe falhando | eventos `Unhealthy` no `describe pod` |
| `Error` | a aplicação | o processo saiu com código diferente de zero | `logs --previous` |
| `OOMKilled` | kernel | limit de memória excedido (exit 137) | limits vs uso |
| `CrashLoopBackOff` | kubelet | o container continua saindo; esperando antes do próximo restart | `logs --previous`, `lastState` |
| `Completed` | a aplicação | saiu com 0 (normal para Jobs) | nada, ou confira o restartPolicy se for inesperado |
| `Terminating` | API server | remoção pedida; preso = finalizer ou nó inacessível | `metadata.finalizers`, status do nó |
| `Evicted` | kubelet | pressão no nó (memória, disco) | conditions do nó, `describe node` |

### Onde ficam os detalhes

```bash
# estado atual e anterior do container, com reason, exit code e mensagem
kubectl get pod web-xyz -o jsonpath='{.status.containerStatuses[0].state}{"\n"}{.status.containerStatuses[0].lastState}{"\n"}'
```

Exemplo verificado, um container morto por OOM entre restarts:

```
{"waiting":{"reason":"CrashLoopBackOff", ...}}
{"terminated":{"exitCode":137,"reason":"OOMKilled", ...}}
```

E um Pod que nunca iniciou o seu processo:

```
{"terminated":{"exitCode":128,"reason":"StartError","message":"... read-only file system"}}
```

Exit codes ajudam: `0` sucesso, `1` erro genérico da aplicação, `126`/`127` comando não executável ou não encontrado, `128` o runtime não conseguiu iniciá-lo, `137` SIGKILL (OOM ou morto depois do grace period), `143` SIGTERM atendido.

### Back-off de restart

Quando um container continua falhando, o kubelet espera antes de cada restart: 10s, 20s, 40s... até 5 minutos, zerando depois que o container roda com sucesso por 10 minutos. Essa espera é o que `CrashLoopBackOff` significa. Não é um erro separado; o erro real está nos logs e no exit code do container anterior.

### Scripts de verificação de saúde

Não interprete a coluna `STATUS`. Use conditions e campos:

```bash
kubectl wait --for=condition=Ready pod -l app=web --timeout=120s
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
kubectl get pods -A -o jsonpath='{range .items[?(@.status.containerStatuses[0].restartCount>5)]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}'
```

## Trade-offs

- **Coluna `STATUS` vs campos brutos.** A coluna é o resumo humano mais rápido; scripts e alertas devem usar phase, conditions e estados de container, que são campos estáveis da API.
- **Observar phases vs readiness.** A phase `Running` não diz nada sobre atender tráfego; `Ready` é o que importa para Services e rollouts.
- **Back-off de restart.** Protege o nó de crash loops, e também significa que uma dependência corrigida pode levar até 5 minutos para ser percebida; `kubectl delete pod` reinicia na hora.

## Lab

Neste lab você recebe um script `classify.sh` que classifica Pods olhando só a coluna `STATUS` do `kubectl get pods`, e o seu trabalho é reescrevê-lo para decidir a partir dos campos de status de verdade (fase, condições e estados dos containers). A ideia central é sentir na prática que o `STATUS` é um resumo feito para humanos: ele esconde alguns casos e muda de um segundo para o outro em outros, então um script que depende dele erra.

**O cenário**

Um cluster Kubernetes real (k3s, subido pelo Testcontainers) recebe sete Pods no namespace `lab`, cada um numa situação diferente. O script precisa imprimir uma linha `<nome> <categoria>` por Pod.

- `src/test/resources/k8s/pods.yaml`: já vem pronto, com um Pod por situação (`ok`, `warming-up`, `too-big`, `bad-image`, `crashing`, `batch-done`, `batch-failed`). O comentário ao lado de cada nome diz a categoria esperada.
- `src/main/resources/classify.sh`: o único arquivo que você edita. Recebe o namespace como argumento e hoje faz um `case` em cima da coluna `STATUS`.
- `src/test/java/PodStatusTest.java`: espera os Pods chegarem aos seus estados e roda o script quatro vezes, com três segundos de intervalo, exigindo exatamente a mesma saída em todas.

As categorias são `ready`, `not-ready`, `unschedulable`, `image-pull`, `crash-loop`, `succeeded` e `failed`.

**O que você vai fazer, passo a passo**

1. **Rodar os testes primeiro.** A mensagem de falha mostra o que o `kubectl get pods` exibia naquele momento. Compare a coluna `STATUS` com o que cada Pod realmente é.
2. **Classificar pelos campos de status (TODO-00).** Troque o `case` em cima do `STATUS` por consultas aos campos do Pod, por exemplo com `-o jsonpath`: a fase (`status.phase`), as condições (como `Ready` e `PodScheduled`, com seus motivos) e o estado de cada container (`waiting`, `running`, `terminated`, mais o `restartCount`). Use `kubectl get pod <nome> -o yaml` no seu próprio cluster, ou o artigo, para ver quais campos existem.
3. **Cuidar dos casos que enganam.** Um container em crash loop fica `Running` (e até `Ready`) por um instante a cada restart, e um Pod que nunca ficou pronto mas rodou é diferente de um que já reiniciou. Decida pelo que não oscila.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/pod-lifecycle-and-status test` passa, ou seja, as quatro execuções imprimem exatamente a tabela esperada. Você deve conseguir explicar, para cada categoria, qual campo a decide e por que a coluna `STATUS` não serviria.

**Desafios opcionais**

- **TODO-01:** estenda o script para Pods com vários containers e init containers. Qual container deve decidir a categoria quando um está em crash loop e outro está saudável?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s` e baixam `busybox` dentro dele) e o artigo "Pod Lifecycle and Status".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/pod-lifecycle-and-status test`. O teste falha com a saída atual do script e mostra o `kubectl get pods` do momento, e esse é o seu ponto de partida.

## Documentation Links

- [Kubernetes docs: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): phases, conditions, estados de container, back-off de restart.
- [Kubernetes docs: Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/): o que verificar em cada estado.
- [Kubernetes docs: Determine the Reason for Pod Failure](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/): mensagens de terminação.
- [Kubernetes docs: Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/): status `Init:`.
