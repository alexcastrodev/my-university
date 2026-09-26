---
version: 1.0
updatedAt: 2026-09-26
title: "Imagens no Kustomize: Uma Imagem, Vários Papéis"
summary: "O transformer de imagens para trocar registry e tag, e como estruturar uma única imagem nos papéis de web, worker e migração."
---
## Objective

Muitas aplicações são entregues como uma imagem que pode desempenhar vários papéis: o servidor HTTP, um ou mais workers em background, um agendador, uma tarefa de migração. O papel é escolhido na inicialização (um argumento, um subcomando, uma variável de ambiente), enquanto o código e as dependências são idênticos. O Kustomize combina bem com esse padrão: a base declara um Deployment ou Job por papel, todos referenciando o mesmo nome de imagem, e o transformer `images:` aponta cada um deles para o registry e a tag certos num único lugar. Este conceito cobre o transformer de imagens e como estruturar uma única imagem com vários papéis.

## Use Cases

- Promover um build (`1.4.2`) para todos os papéis de um ambiente com uma linha.
- Trocar um nome de imagem público usado em desenvolvimento por um registry interno em produção.
- Rodar o servidor web e vários workers a partir da mesma imagem com argumentos e resources diferentes.
- Fixar uma imagem por digest em produção.

## Deep Dive

### Um nome de imagem na base

```yaml
# base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: web, labels: {role: web}}
spec:
  selector: {matchLabels: {app: web}}
  template:
    metadata: {labels: {app: web}}
    spec:
      containers:
        - name: app
          image: registry.example.com/demo/web-app:latest
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: worker, labels: {role: worker}}
spec:
  selector: {matchLabels: {app: worker}}
  template:
    metadata: {labels: {app: worker}}
    spec:
      containers:
        - name: app
          image: registry.example.com/demo/web-app:latest
          args: [worker]
```

```yaml
# base/job.yaml
apiVersion: batch/v1
kind: Job
metadata: {name: migrate, labels: {role: job}}
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: app
          image: registry.example.com/demo/web-app:latest
          args: [migrate]
```

O `image:` da base é um nome de referência. O que importa é que todos os papéis usam **o mesmo** nome, para que uma única regra do transformer case com todos.

### O transformer de imagens

```yaml
# overlays/staging/kustomization.yaml
images:
  - name: registry.example.com/demo/web-app      # o que casar (a tag da base é ignorada no casamento)
    newName: registry.internal:5000/demo/web-app
    newTag: "1.4.2"
```

Verificado com `kubectl kustomize overlays/staging` (kubectl 1.36, Kustomize v5.8): a imagem do Deployment `web`, do Deployment `worker` e do Job `migrate` virou `registry.internal:5000/demo/web-app:1.4.2`.

Outras formas:

```yaml
images:
  - name: registry.example.com/demo/web-app
    digest: sha256:4f5c...             # fixa por digest em vez de tag
  - name: redis
    newTag: "8.2"                      # só a tag, mantém o nome
```

- **Coloque o `newTag` entre aspas.** Verificado: `newTag: 1.10` sem aspas falha o build (`cannot unmarshal number into Go struct field Image.images.newTag of type string`). Em outras ferramentas de YAML o mesmo erro transforma `1.10` em `1.1` em silêncio.
- O transformer reescreve `containers[].image` e `initContainers[].image` nos kinds de workload embutidos (Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet). Imagens dentro de custom resources, ou em variáveis de ambiente e args, não são tocadas a menos que você configure field specs extras.
- No CI, atualize o overlay sem editar YAML à mão: `kustomize edit set image registry.example.com/demo/web-app=registry.internal:5000/demo/web-app:1.4.3` (binário `kustomize` independente, rodando dentro do diretório do overlay).

### Papéis: o que muda e o que fica igual

| Aspecto | web | worker | migrate |
|---|---|---|---|
| Argumento de início | nenhum (comando padrão) | `worker` | `migrate` |
| Réplicas | 2+ | depende da carga da fila | 1 execução |
| Service / Ingress | sim | não | não |
| Probes | readiness e liveness HTTP | só liveness (não há tráfego HTTP para estar pronto) | nenhuma |
| Resources | CPU para requisições | memória para lotes | curta duração |
| Kind | Deployment | Deployment | Job |

Um worker que não serve HTTP não deveria ganhar uma readiness probe HTTP; ele nunca ficaria pronto ou precisaria de um servidor só para a probe. Use uma verificação de liveness que faça sentido para ele (uma probe `exec`, uma pequena porta de health) ou nenhuma.

### Configuração compartilhada entre papéis

Todos os papéis costumam precisar das mesmas configurações de conexão. Gere uma ConfigMap e a referencie em todos os papéis; o sufixo de hash então reinicia todos juntos quando a configuração compartilhada muda:

```yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
      - QUEUE_URL=redis://queue.shared.svc.cluster.local:6379
```

Verificado no mesmo build: `web` e `worker` referenciaram o mesmo nome gerado (`app-config-<hash>`). Configurações específicas de um papel vão no `env` dele ou numa segunda ConfigMap.

Mire patches pelo label do papel em vez do nome, para que um worker novo receba as configurações de worker automaticamente:

```yaml
patches:
  - target: {kind: Deployment, labelSelector: role=worker}
    patch: |-
      - op: add
        path: /spec/replicas
        value: 3
```

Verificado: só o Deployment `worker` recebeu `replicas: 3`.

### Implantando uma versão nova

Uma mudança de `newTag`, e então:

```bash
kubectl apply -k overlays/staging
kubectl -n web-staging rollout status deploy/web
kubectl -n web-staging rollout status deploy/worker
```

Todos os papéis vão para a versão nova no mesmo apply. Se o release exige ordem (migrate, depois web, depois workers), essa ordem precisa vir do pipeline (aplicar o Job, esperar ele terminar, depois aplicar o resto) ou da aplicação tolerar as duas versões durante o rollout. Lembre que o template de Pod de um Job é imutável: uma tag nova num Job `migrate` existente falha no apply; veja o conceito de Jobs.

## Trade-offs

- **Uma imagem, vários papéis vs uma imagem por papel.** Uma imagem significa um build, um scan, uma versão para raciocinar, e código consistente entre papéis; também leva as dependências de todos os papéis para todo Pod e acopla os ciclos de release deles.
- **Tags vs digests nos overlays.** Tags são legíveis e fáceis de subir; digests garantem exatamente o que roda e são ilegíveis em revisões. Alguns times mantêm tags no Git e deixam o CI resolvê-las para digests na hora de renderizar.
- **Argumentos vs entrypoints separados.** Um único entrypoint com argumento de papel mantém a imagem simples; comandos separados por papel deixam os papéis explícitos e evitam que um papel suba sem querer componentes de outro.

## Documentation Links

- [Kustomize reference: images](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/): `newName`, `newTag`, `digest`.
- [Kustomize: kustomize edit](https://kubectl.docs.kubernetes.io/references/kustomize/cmd/edit/): atualizando overlays a partir do CI.
- [Kubernetes docs: Define a Command and Arguments for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-command-argument-container/): como `command` e `args` sobrescrevem a imagem.
- [Kubernetes docs: Images](https://kubernetes.io/docs/concepts/containers/images/): tags, digests e comportamento de pull.
