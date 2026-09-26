---
version: 1.0
updatedAt: 2026-09-26
title: "Rollouts: Status, Restart, Histórico e Rollback"
summary: "Acompanhar um rollout em scripts, o que o rollout restart faz de verdade, histórico de revisões e change causes, e o que o rollout undo desfaz e o que não desfaz."
---
## Objective

Toda mudança no template de Pod de um Deployment é um **rollout**: um ReplicaSet novo cresce, o antigo diminui. O `kubectl rollout` é a caixa de ferramentas em volta disso: acompanhar um rollout até ele terminar (`status`), disparar um novo sem mudar o spec (`restart`), listar revisões anteriores (`history`) e voltar para uma delas (`undo`). O comportamento tem detalhes que surpreendem no meio de um incidente: o `restart` é só uma annotation, o `undo` renumera revisões, e a coluna de "change cause" é fácil de encher de mentiras. Este conceito cobre o ciclo completo, com saídas verificadas num cluster real.

## Use Cases

- Implantar uma imagem nova e esperar, num script, até ela estar totalmente no ar ou falhar.
- Reiniciar todos os Pods de um Deployment para pegar uma ConfigMap ou Secret alterada.
- Voltar rapidamente depois de um release ruim.
- Entender a que um número de revisão se refere.

## Deep Dive

### Disparando um rollout: tag nova ou restart

Dois jeitos de começar um:

```bash
# 1. mudar o template, por exemplo uma tag de imagem nova (ou aplicar um manifest/overlay com a tag nova)
kubectl -n team-a set image deploy/web app=registry.example.com/demo/web-app:1.4.3

# 2. mesmo template, Pods novos
kubectl -n team-a rollout restart deploy/web
```

O `rollout restart` não reinicia nada diretamente. Ele escreve a hora atual numa annotation do template do Pod, e essa mudança de template dispara um rolling update normal. Verificado no k3s:

```
$ kubectl rollout restart deploy/web
deployment.apps/web restarted
$ kubectl get deploy web -o jsonpath='{.spec.template.metadata.annotations}'
{"kubectl.kubernetes.io/restartedAt":"2026-09-26T20:02:47Z"}
```

Consequências: ele respeita `maxSurge`/`maxUnavailable` e readiness exatamente como qualquer rollout (sem downtime com réplicas suficientes), cria uma revisão nova, e com `imagePullPolicy: IfNotPresent` e uma tag reaproveitada ele **não** baixa uma imagem mais nova. Use para mudanças de configuração lidas na inicialização; use uma tag nova para código novo.

### Acompanhando: rollout status

```bash
kubectl -n team-a rollout status deploy/web --timeout=300s
```

Ele imprime o progresso e sai com `0` quando todas as réplicas estão atualizadas e disponíveis. Com `--timeout`, sai com código diferente de zero se o rollout não terminar a tempo. Verificado com uma imagem que não existe:

```
Waiting for deployment "web" rollout to finish: 1 out of 2 new replicas have been updated...
error: timed out waiting for the condition
exit=1
```

Sem `--timeout` ele espera até o `progressDeadlineSeconds` do próprio Deployment (padrão 600) marcar o rollout como falho (`ProgressDeadlineExceeded`), e então sai com erro. Num pipeline, use sempre depois do `apply`: um `kubectl apply` com sucesso só significa que a API aceitou o objeto, não que a versão nova está rodando.

Para ver os Pods enquanto isso acontece:

```bash
kubectl -n team-a get pods -l app=web -w
```

### Histórico

```bash
kubectl -n team-a rollout history deploy/web
kubectl -n team-a rollout history deploy/web --revision=3    # o template da revisão 3
```

Cada revisão é um ReplicaSet mantido com 0 réplicas (`revisionHistoryLimit`, padrão 10). A coluna `CHANGE-CAUSE` vem da annotation `kubernetes.io/change-cause` do Deployment **no momento em que a revisão foi criada**. Verificado com um Deployment `nginx`: depois de anotar uma vez, o mesmo texto foi copiado para todas as revisões seguintes, incluindo uma produzida por `rollout restart` e uma com imagem quebrada:

```
REVISION  CHANGE-CAUSE
1         <none>
2         bump nginx to 1.30
3         bump nginx to 1.30
4         bump nginx to 1.30
```

Ou você define a annotation a cada mudança (um pipeline pode escrever o SHA do Git ou a versão do release) ou ignora a coluna; um change cause desatualizado é pior que nenhum. A antiga flag `--record`, que o preenchia automaticamente, está deprecada.

### Voltando: rollout undo

```bash
kubectl -n team-a rollout undo deploy/web                  # para a revisão anterior
kubectl -n team-a rollout undo deploy/web --to-revision=2
kubectl -n team-a rollout status deploy/web
```

O `undo` copia o template de Pod da revisão antiga de volta para o Deployment, o que é em si um rollout novo. A revisão restaurada ganha um número **novo e maior**: verificado, desfazer da revisão 4 para a 3 transformou a 3 em 5:

```
REVISION  CHANGE-CAUSE
1         <none>
2         bump nginx to 1.30
4         bump nginx to 1.30
5         bump nginx to 1.30
```

O que o `undo` não faz:

- Não desfaz ConfigMaps ou Secrets editadas no lugar. Se a configuração é referenciada pelo nome com o sufixo de hash do Kustomize, a revisão antiga referencia a ConfigMap antiga, que ainda existe, então a configuração volta junto. Esse é um dos melhores motivos para usar nomes gerados.
- Não muda os seus manifests no Git. O próximo `kubectl apply` do manifest inalterado avança de novo para a versão quebrada. Depois de um undo de emergência, corrija o Git (reverta o commit) antes que qualquer outra coisa seja implantada.
- Não funciona para Jobs, dados de StatefulSet, migrações de banco, nem nada fora do template do Pod.

### Pausando

```bash
kubectl -n team-a rollout pause deploy/web
kubectl -n team-a set image deploy/web app=...:1.4.3
kubectl -n team-a set resources deploy/web -c app --limits=memory=1Gi
kubectl -n team-a rollout resume deploy/web          # um rollout com as duas mudanças
```

Útil para juntar várias mudanças imperativas num único rollout; com `apply` declarativo de um manifest inteiro você raramente precisa.

## Trade-offs

- **`rollout restart` vs tag nova.** O restart reaproveita a mesma imagem e é ideal para pegar configuração; uma tag nova é o único jeito confiável de entregar código novo com pulls `IfNotPresent`.
- **`rollout undo` vs seguir em frente.** O undo é o caminho mais rápido de volta a um estado bom conhecido; seguir em frente com uma correção mantém Git e cluster sincronizados. Na prática: undo primeiro para estancar o problema, depois faça o Git bater.
- **`revisionHistoryLimit` longo vs curto.** Mais revisões significam mais alvos de rollback e mais ReplicaSets parados poluindo o `kubectl get rs`.

## Documentation Links

- [Kubernetes docs: Deployments (updating, rolling back, pausing)](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): mecânica de rollout e histórico de revisões.
- [kubectl rollout reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/): `status`, `history`, `undo`, `restart`, `pause`, `resume`.
- [Kubernetes docs: Well-known annotations (kubernetes.io/change-cause)](https://kubernetes.io/docs/reference/labels-annotations-taints/#change-cause): como o change cause é registrado.
