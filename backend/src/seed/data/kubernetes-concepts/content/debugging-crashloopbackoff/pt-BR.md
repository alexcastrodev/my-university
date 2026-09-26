---
version: 1.0
updatedAt: 2026-09-26
title: "Depurando CrashLoopBackOff"
summary: "Um procedimento repetível: exit codes e reasons, logs da tentativa anterior, eventos, e como manter vivo um container que cai para inspecioná-lo."
---
## Objective

`CrashLoopBackOff` significa uma coisa só: o container subiu, saiu, e o kubelet está esperando antes de subi-lo de novo. Não diz nada sobre o porquê. O porquê quase sempre está em três lugares: os **logs da tentativa anterior**, o **exit code e o reason** da última terminação, e os **eventos**. Este conceito é um procedimento repetível para encontrá-lo, incluindo os casos em que os logs estão vazios porque o processo nunca rodou de verdade, ou em que o container morre rápido demais para ser inspecionado.

## Use Cases

- Uma versão nova que reinicia a cada poucos segundos depois de um deploy.
- Um container que cai só no cluster, não localmente.
- Um Pod com logs vazios que continua reiniciando.
- Inspecionar o sistema de arquivos e o ambiente de um container que não fica de pé.

## Deep Dive

### Passo 1: leia o estado, não só o status

```bash
kubectl -n team-a get pod web-xyz
kubectl -n team-a describe pod web-xyz
```

No `describe`, a seção do container mostra os fatos principais:

```
State:          Waiting
  Reason:       CrashLoopBackOff
Last State:     Terminated
  Reason:       Error
  Exit Code:    1
  Started:      ...
  Finished:     ...
Restart Count:  4
```

O **exit code** direciona a investigação:

| Last State | Significado | Próximo passo |
|---|---|---|
| `Error`, exit 1 (ou qualquer código da aplicação) | a aplicação decidiu sair | logs da tentativa anterior |
| `OOMKilled`, exit 137 | limit de memória excedido | limits vs uso real |
| exit 137 sem OOMKilled | morto pela liveness probe ou depois do grace period | eventos: `Killing ... failed liveness probe` |
| `StartError`/`RunContainerError`, exit 128 | o runtime não conseguiu iniciar o processo | `lastState.terminated.message` |
| exit 126 / 127 | entrypoint não executável / não encontrado | `ENTRYPOINT`/`CMD` da imagem, `command` no spec |
| `Completed`, exit 0 | o processo terminou com sucesso, mas um Deployment espera que ele rode para sempre | comando errado, ou deveria ser um Job |

### Passo 2: logs da tentativa anterior

O container atual normalmente está esperando (sem logs) ou acabou de reiniciar (poucas linhas). O crash está no **anterior**:

```bash
kubectl -n team-a logs web-xyz --previous
kubectl -n team-a logs web-xyz --previous -c app      # Pods com vários containers
kubectl -n team-a logs deploy/web --previous          # qualquer Pod do Deployment
```

Verificado no k3s: um container que imprime `booting` e `fatal: DB_URL missing` e sai com 1 mostra as duas linhas no `kubectl logs`, e o Pod alterna entre `Error` e `CrashLoopBackOff` com o contador de restarts crescendo. Só os logs do **último** container anterior ficam no nó, então tentativas mais antigas se perdem; mande os logs para um armazenamento central (Loki ou similar) se você precisa do histórico completo.

Se o log está vazio:

- O processo morreu antes de escrever qualquer coisa: confira exit code 126/127/128 e `lastState.terminated.message`.
- A aplicação loga num arquivo em vez de stdout/stderr. Configure-a para logar no stdout, que é o que o `kubectl logs` lê.
- A saída fica em buffer e se perde no crash (Python sem `-u`, alguns loggers com appenders assíncronos).

### Passo 3: eventos

```bash
kubectl -n team-a events --for pod/web-xyz
kubectl -n team-a get events --field-selector involvedObject.name=web-xyz
```

Os eventos mostram falhas de probe (`Unhealthy`, `Killing`), problemas de montagem e mensagens de back-off (`Back-off restarting failed container app in pod web-xyz`). Um container morto pela liveness probe entra em crash loop igual a um que sai sozinho; só os eventos os diferenciam.

### Passo 4: mantenha o container vivo para olhar dentro

Quando o processo morre rápido demais para um `kubectl exec`, troque o comando temporariamente:

```bash
kubectl -n team-a debug web-xyz -it --copy-to=web-debug --container=app -- sh
```

O `--copy-to` cria uma cópia do Pod com o comando do container trocado por um shell, sem tocar no original. Lá dentro você confere o que a aplicação veria: `env`, arquivos montados, DNS (`nslookup db.shared`), permissões nos volumes (`ls -ln /data`), e roda o entrypoint à mão para vê-lo falhar. Apague a cópia depois.

Como alternativa, altere por um momento o comando do Deployment para `["sleep", "3600"]`, o que também o livra dos restarts por liveness. Reverta com o seu apply normal.

### Causas raiz comuns

- **Configuração faltando ou errada**: uma variável de ambiente, uma chave de Secret, o caminho de um arquivo de configuração. A própria mensagem de erro da aplicação diz isso; compare com `kubectl exec ... env`.
- **Dependência inacessível na inicialização**: a aplicação sai em vez de tentar de novo. Corrija a aplicação (tentativas com back-off) ou adicione um init container que espera; não mascare isso com um contador de restarts enorme.
- **Permissões**: usuário não root escrevendo num volume de dono root, sistema de arquivos raiz somente leitura sem um `/tmp` gravável.
- **Comando ou argumentos errados** no manifest sobrescrevendo os padrões da imagem.
- **Probes**: uma liveness probe que falha durante uma subida lenta mata uma aplicação saudável. Adicione uma startup probe.
- **Resources**: `OOMKilled` na inicialização porque o limit está abaixo do que o runtime precisa para subir.

## Trade-offs

- **Corrigir a aplicação vs contornar no Kubernetes.** Um init container que espera uma dependência ou um orçamento maior de restarts esconde um código de inicialização frágil; fazer a aplicação tentar de novo dá mais trabalho e é mais robusto.
- **Cópias de debug vs editar o Deployment ao vivo.** O `--copy-to` deixa a produção intocada, mas roda fora do controller dela; editar o Deployment é realista, mas precisa ser revertido com cuidado.
- **Logs locais vs logs centrais.** `kubectl logs --previous` é imediato e guarda só uma tentativa anterior; logs centrais guardam tudo e exigem uma stack para rodar.

## Documentation Links

- [Kubernetes docs: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/): logs, exec, `kubectl debug` e cópias de Pod.
- [Kubernetes docs: Determine the Reason for Pod Failure](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/): mensagens de terminação e exit codes.
- [kubectl logs reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/): `--previous`, containers, selectors.
- [Kubernetes docs: Pod Lifecycle (container restart policy)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy): tempos do back-off.
