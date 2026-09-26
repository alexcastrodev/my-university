---
version: 1.0
updatedAt: 2026-09-26
title: "kubectl Essencial"
summary: "get, describe, apply, delete, formatos de saída, flags de namespace e --dry-run para gerar YAML, com as armadilhas que importam no dia a dia."
---
## Objective

O `kubectl` tem centenas de flags, mas o trabalho diário usa um subconjunto pequeno e afiado: `get`, `describe`, `apply`, `delete`, alguns formatos de saída, flags de namespace e `--dry-run` para gerar YAML em vez de escrevê-lo. Saber exatamente o que cada um faz, e o que ele **não** faz, é o que separa "rodei o comando" de "sei o estado do cluster". Este conceito é uma referência de trabalho com as armadilhas que importam na prática.

## Use Cases

- Verificar o estado de um namespace em cinco segundos.
- Descobrir por que um recurso não está bem (`describe` + eventos).
- Gerar o esqueleto correto de um manifest de Secret, Deployment ou Job sem copiar da internet.
- Aplicar e apagar manifests com segurança, inclusive em todos os namespaces.

## Deep Dive

### get: listas, uma linha por objeto

```bash
kubectl get pods                       # namespace atual (do contexto, muitas vezes "default")
kubectl get pods -n team-a             # um namespace
kubectl get pods -A                    # todos os namespaces (--all-namespaces)
kubectl get deploy,svc,pvc -n team-a   # vários tipos de uma vez
kubectl get pods -o wide               # + nó, IP do Pod
kubectl get pods -l app=api            # label selector
kubectl get pods --field-selector=status.phase!=Running
kubectl get pods -w                    # watch: imprime as mudanças conforme acontecem
```

`kubectl get all` engana: ele mostra Pods, Services, Deployments, ReplicaSets, StatefulSets, Jobs e CronJobs, mas **não** ConfigMaps, Secrets, PVCs, Ingresses ou ServiceAccounts. Nunca use para concluir que um namespace está vazio.

### Formatos de saída

```bash
kubectl get deploy api -o yaml          # objeto completo, incluindo status e managed fields
kubectl get deploy api -o json | jq '.spec.template.spec.containers[0].image'
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,QOS:.status.qosClass
kubectl get pods -o name                # pod/api-6b48...; ideal para loops
```

O `-o yaml` de um objeto vivo não é um bom manifest para commitar: ele contém `status`, `uid`, `resourceVersion`, `creationTimestamp` e `managedFields`. Commite o arquivo que você aplicou, não o que o servidor devolve.

### describe: a visão humana com eventos

```bash
kubectl describe pod api-6b48bf5ccc-4cvpp -n team-a
kubectl describe node
```

O `describe` agrega informações relacionadas: estado dos containers, motivo da última terminação, volumes montados, conditions e, no fim, os **Events** daquele objeto. Para "por que este Pod não está rodando", o `describe` é o primeiro comando, antes dos logs.

### apply: criar ou atualizar de forma declarativa

```bash
kubectl apply -f deployment.yaml
kubectl apply -f k8s/                 # todos os arquivos de um diretório
kubectl apply -k overlays/staging     # um diretório Kustomize
```

O `apply` calcula um merge de três vias entre o arquivo, o objeto vivo e a última configuração aplicada, então applies repetidos são idempotentes e campos que você removeu do arquivo são removidos do objeto. `kubectl create` falha se o objeto existe; `kubectl replace` o sobrescreve por completo. Em scripts e pipelines, `apply` é o padrão certo.

O que o `apply` não consegue: mudar campos imutáveis. O template de Pod de um Job, o `spec.selector` de um Deployment, o `clusterIP` de um Service ou o `storageClassName` de um PVC falham com `field is immutable`. Você precisa apagar e recriar esses objetos.

### delete

```bash
kubectl delete -f deployment.yaml     # o que o arquivo descreve
kubectl delete deploy api -n team-a
kubectl delete pods -l app=api        # por label
kubectl delete pod api-xyz --grace-period=0 --force   # último recurso, veja o conceito de remoção de Pods
```

Apagar um Deployment apaga os ReplicaSets e Pods dele (cascata). Apagar um namespace apaga **tudo** dentro dele, incluindo PVCs e, com reclaim policy `Delete`, os dados.

### Gerando YAML com --dry-run=client

Comandos imperativos mais `--dry-run=client -o yaml` produzem esqueletos corretos sem tocar no cluster:

```bash
kubectl create deployment api --image=registry.example.com/demo/web-app:1.4.2 \
  --replicas=2 --port=8080 --dry-run=client -o yaml > deployment.yaml

kubectl create secret generic db-credentials \
  --from-env-file=db.env --dry-run=client -o yaml > secret.yaml

kubectl create job migrate --image=registry.example.com/demo/web-app:1.4.2 \
  --dry-run=client -o yaml -- ./app migrate
```

`--dry-run=server` manda o objeto para o API server, que roda validação e admission (Pod Security, webhooks) sem persistir. Ele pega erros que o `client` não pega, como um `restartPolicy` inválido num Job ou uma violação de Pod Security.

O mesmo padrão atualiza uma Secret a partir de um arquivo de forma idempotente:

```bash
kubectl create secret generic db-credentials --from-env-file=db.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Explicando campos

```bash
kubectl explain deployment.spec.strategy
kubectl explain pod.spec.containers.resources --recursive
```

O `explain` lê o schema do API server, então sempre bate com a versão do seu cluster e inclui CRDs.

### Higiene de namespace

- Defina um namespace padrão por contexto (`kubectl config set-context --current --namespace=team-a`) para trabalho interativo.
- Em scripts, passe sempre `-n` explicitamente e prefira `metadata.namespace` nos manifests (ou `namespace:` no Kustomize).
- `-A` é só para leitura. Um `kubectl delete ... -A` quase nunca é o que você quer.

## Trade-offs

- **Comandos imperativos vs manifests.** `kubectl create/scale/set image` são rápidos para experimentos e emergências, mas não deixam registro. Tudo que precisa sobreviver pertence a um manifest no Git, aplicado com `apply`.
- **`--dry-run=client` vs `server`.** O client é offline e instantâneo; o server precisa de acesso ao cluster mas reporta o que o cluster aceitaria de fato.
- **`-o yaml` para depurar vs para escrever.** Ótimo para ver o estado efetivo e os defaults; barulhento e não portável como arquivo fonte.

## Documentation Links

- [kubectl Quick Reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/): a cola canônica.
- [Kubernetes docs: Declarative management with kubectl apply](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/): merge de três vias e remoção de campos apagados.
- [kubectl reference: output formats and JSONPath](https://kubernetes.io/docs/reference/kubectl/jsonpath/): sintaxe de jsonpath.
- [kubectl reference: kubectl create](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/): todos os geradores usáveis com `--dry-run`.
