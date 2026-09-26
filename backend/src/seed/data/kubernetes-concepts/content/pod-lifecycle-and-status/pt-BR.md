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

## Documentation Links

- [Kubernetes docs: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): phases, conditions, estados de container, back-off de restart.
- [Kubernetes docs: Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/): o que verificar em cada estado.
- [Kubernetes docs: Determine the Reason for Pod Failure](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/): mensagens de terminação.
- [Kubernetes docs: Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/): status `Init:`.
