---
version: 1.0
updatedAt: 2026-09-26
title: "Jobs, CronJobs e restartPolicy"
summary: "Workloads que rodam até terminar: Never vs OnFailure, backoffLimit, deadlines, ttlSecondsAfterFinished, por que reaplicar um Job falha, e CronJobs."
---
## Objective

Um Deployment mantém um processo rodando para sempre. Muitas tarefas deveriam rodar uma vez e parar: uma migração de banco, uma importação de dados, uma limpeza pontual, um backup. Isso é um **Job**: ele roda Pods até que um número definido deles tenha sucesso, tenta de novo em caso de falha até um limite, e registra o resultado. O comportamento é moldado por alguns campos (`restartPolicy`, `backoffLimit`, `activeDeadlineSeconds`, `ttlSecondsAfterFinished`) fáceis de errar de forma sutil. Este conceito cobre um Job de execução única, o que acontece numa falha, como Jobs terminados são limpos, por que reaplicar um Job falha, e CronJobs para agendamentos.

## Use Cases

- Rodar migrações de schema antes de a nova versão da aplicação subir.
- Uma importação ou reprocessamento pontual usando a mesma imagem da aplicação.
- Popular dados ou configuração inicial quando um ambiente é criado.
- Backups noturnos com um CronJob.

## Deep Dive

### Um Job de execução única

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
spec:
  backoffLimit: 2                 # tentativas antes de o Job ser marcado Failed (padrão 6)
  activeDeadlineSeconds: 600      # limite rígido de tempo para o Job inteiro
  ttlSecondsAfterFinished: 3600   # apaga o Job e seus Pods 1h depois de terminar
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: app
          image: registry.example.com/demo/web-app:1.4.2
          args: ["migrate"]
```

`completions` (padrão 1) e `parallelism` (padrão 1) fazem disso "rode um Pod até ele ter sucesso uma vez".

### restartPolicy: Never vs OnFailure

O template de Pod de um Job só aceita `Never` ou `OnFailure`. `Always`, o padrão dos Pods, é rejeitado:

```
The Job "alwaysjob" is invalid: spec.template.spec.restartPolicy: Required value:
valid values: "OnFailure", "Never"
```

- **`Never`**: um container que falha deixa o Pod em `Error`, e o controller do Job cria um **Pod novo** para a próxima tentativa. Cada tentativa mantém o seu Pod e os seus logs, o que é ótimo para depurar.
- **`OnFailure`**: o kubelet reinicia o container **dentro do mesmo Pod**. Menos Pods, mas os logs das tentativas anteriores só ficam acessíveis com `kubectl logs --previous`, e só da última.

### Como uma falha aparece

Um Job com `backoffLimit: 2` cujo container sai com código 3, verificado no k3s v1.36:

```
$ kubectl get job,pods -l batch.kubernetes.io/job-name=failjob
job.batch/failjob   Failed   0/1   35s
pod/failjob-sh2q9   0/1     Error
pod/failjob-v4mxf   0/1     Error
pod/failjob-ttj6n   0/1     Error

$ kubectl describe job failjob
  Normal   SuccessfulCreate      job-controller  Created pod: failjob-sh2q9
  Normal   SuccessfulCreate      job-controller  Created pod: failjob-v4mxf
  Normal   SuccessfulCreate      job-controller  Created pod: failjob-ttj6n
  Warning  BackoffLimitExceeded  job-controller  Job has reached the specified backoff limit
```

Três Pods: a primeira tentativa mais duas repetições, espaçadas por um back-off exponencial (10s, 20s, 40s, com teto de 6 minutos). Quando o limite é atingido o Job fica `Failed` e nada mais tenta de novo. O padrão `backoffLimit: 6` faz uma migração quebrada levar vários minutos até ser declarada como falha; defina o valor explicitamente.

`activeDeadlineSeconds` é a outra condição de parada: quando o Job passa desse tempo rodando, todos os seus Pods são mortos e o Job falha com `DeadlineExceeded`, mesmo que ainda restem tentativas. Protege contra uma migração presa num lock.

### Limpeza: ttlSecondsAfterFinished

Jobs terminados e seus Pods ficam para sempre por padrão, poluindo o `kubectl get pods` e guardando logs. O `ttlSecondsAfterFinished` deixa o TTL controller apagar o Job (e, em cascata, os seus Pods) essa quantidade de segundos depois de ele terminar ou falhar. Verificado: um Job com `ttlSecondsAfterFinished: 30` tinha sumido, Pods incluídos, bem antes de um minuto.

Escolha o valor pelo tempo que você precisa dos logs: o suficiente para investigar uma falha (horas), não zero. Se você manda os logs para o Loki ou similar, pode ser mais agressivo.

### Por que reaplicar um Job falha

O `spec.template` de um Job é **imutável**. Aplique um Job, mude a tag da imagem, aplique de novo:

```
The Job "migrate" is invalid: spec.template: Invalid value: ...: field is immutable
```

Isso morde todo projeto em que um Job de migração vive ao lado de Deployments no mesmo diretório Kustomize: os Deployments atualizam, o apply do Job falha e, dependendo do pipeline, o `kubectl apply -k` inteiro reporta erro. Opções:

- Apagar o Job antigo antes de aplicar (`kubectl delete job migrate --ignore-not-found`), como um passo do pipeline.
- Deixar o `ttlSecondsAfterFinished` removê-lo, para que um apply posterior crie um novo. Só funciona se o próximo deploy vier depois do TTL.
- Dar ao Job um nome único por versão (`migrate-1-4-2`), por exemplo com um `nameSuffix` do Kustomize ou um nome gerado com `kubectl create`.
- Rodar as migrações dentro da aplicação na inicialização (muitas bibliotecas de migração suportam isso) e dispensar o Job em serviços de uma réplica.

### CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-backup
spec:
  schedule: "30 2 * * *"
  timeZone: "America/New_York"       # senão, o fuso do kube-controller-manager (normalmente UTC)
  concurrencyPolicy: Forbid            # nunca dois backups ao mesmo tempo
  startingDeadlineSeconds: 600         # pula uma execução que não conseguiu começar em 10 minutos
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: backup
              image: busybox:1.37
              command: ["sh", "-c", "tar czf /backup/data-$(date +%F).tgz -C /data ."]
              volumeMounts:
                - {name: data, mountPath: /data, readOnly: true}
                - {name: backup, mountPath: /backup}
          volumes:
            - name: data
              persistentVolumeClaim: {claimName: app-data}
            - name: backup
              persistentVolumeClaim: {claimName: app-backups}
```

O CronJob cria um Job a cada disparo do agendamento; os limites de histórico substituem o `ttlSecondsAfterFinished` na limpeza. Para testar sem esperar:

```bash
kubectl create job --from=cronjob/nightly-backup backup-manual-1
```

## Trade-offs

- **`Never` vs `OnFailure`.** `Never` deixa toda tentativa inspecionável ao custo de mais Pods; `OnFailure` é mais limpo mas esconde as tentativas anteriores.
- **`backoffLimit` baixo vs padrão.** Uma migração deve falhar rápido (0 a 2 tentativas), porque repetir uma migração aplicada pela metade raramente ajuda. Uma importação com rede instável se beneficia de mais tentativas.
- **Job de migração vs migração na inicialização.** Um Job dá um passo explícito e ordenado e funciona com muitas réplicas. A migração na inicialização é mais simples com uma réplica, mas uma migração com falha vira um CrashLoopBackOff do próprio serviço.

## Lab

Neste lab você recebe um `jobs.yaml` com quatro Jobs de execução única, e cada um tem uma configuração errada ou faltando. O seu trabalho é ajustar cada Job para que termine do jeito certo: aceito e concluído, falhando rápido, interrompido por um prazo e limpo depois de terminar. A ideia central é que um Job não é um Deployment: `restartPolicy` tem valores permitidos diferentes, as tentativas e os prazos são configurados no próprio Job e nada some sozinho sem `ttlSecondsAfterFinished`.

**O cenário**

O teste aplica o arquivo no namespace `example` de um cluster real (k3s via Testcontainers) e observa os quatro Jobs por até 90 segundos.

- `migrate`: deve ser aceito pelo API server e concluir.
- `flaky-import`: sempre falha (sai com código 3) e deve ser declarado falho depois de exatamente 2 tentativas.
- `report`: trava para sempre (dorme 3600 s) e deve ser interrompido depois de 20 segundos.
- `cleanup`: deve desaparecer, com seus Pods, logo depois de terminar.

**O que você vai fazer, passo a passo**

1. **Rodar e ler a validação (TODO-00).** Rode os testes antes de editar: a falha de `migrate` traz a mensagem de validação do API server. Escolha um `restartPolicy` válido para Job que mantenha cada tentativa falha em seu próprio Pod, para os logs continuarem inspecionáveis.
2. **Limitar as tentativas (TODO-01).** Com o limite padrão de retries, o `flaky-import` leva minutos para ser declarado falho. Permita só uma nova tentativa, de modo que ele fique `Failed` após 2 tentativas (`BackoffLimitExceeded`).
3. **Impor um prazo (TODO-02).** O `report` nunca termina. Faça o Kubernetes parar o Job inteiro depois de 20 segundos, não importa quantos retries ainda restem (`DeadlineExceeded`). Pense na diferença entre este prazo e o limite de tentativas.
4. **Limpar depois de terminar (TODO-03).** Jobs e Pods concluídos ficam para sempre. Peça ao Kubernetes que apague o `cleanup` (e seus Pods) no máximo 30 segundos após terminar.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/jobs-and-restart-policy test` passa por inteiro: `migrate` está `Complete`, `flaky-import` está `Failed/BackoffLimitExceeded` com exatamente 2 tentativas falhas, `report` está `Failed/DeadlineExceeded` e `cleanup` concluiu e depois deixou de existir. Você deve conseguir explicar a diferença entre `backoffLimit` e `activeDeadlineSeconds` e por que `Always` não serve para um Job.

**Desafios opcionais**

- **TODO-04:** mude a tag da imagem do `migrate` e aplique o arquivo de novo enquanto o Job ainda existe. Que erro aparece, e qual dos quatro Jobs faria um `kubectl apply` repetido deste arquivo falhar em um pipeline real?

**Pré-requisitos:** Docker rodando (o teste sobe um container `rancher/k3s` e baixa `busybox` dentro dele), o artigo "Jobs, CronJobs and restartPolicy", Java e Maven.

**Como rodar:** clone o repositório e, na raiz, rode `mvn -pl kubernetes-concepts/jobs-and-restart-policy test`. Uma execução leva de um a dois minutos. Você edita apenas o `jobs.yaml`, e cada TODO fica acima do Job que ele corrige.

## Documentation Links

- [Kubernetes docs: Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/): completions, parallelism, backoff limit, deadlines, Pod failure policy.
- [Kubernetes docs: Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/): `ttlSecondsAfterFinished`.
- [Kubernetes docs: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): sintaxe do agendamento, fusos horários, concurrency policy.
- [Kubernetes docs: Pod Lifecycle (restart policy)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy): comportamento do back-off.
