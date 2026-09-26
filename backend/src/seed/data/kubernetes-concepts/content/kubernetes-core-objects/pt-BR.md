---
version: 1.0
updatedAt: 2026-09-26
title: "Pods, ReplicaSets, Deployments, Services e Namespaces"
summary: "Os cinco objetos por trás de quase todo deploy, como controllers e label selectors os ligam, e quais você escreve e quais você só observa."
---
## Objective

Quase tudo que você implanta no Kubernetes é feito de cinco objetos: um **Namespace** para agrupar as coisas, um **Pod** que de fato roda os containers, um **ReplicaSet** que mantém N Pods idênticos vivos, um **Deployment** que gerencia ReplicaSets entre versões, e um **Service** que dá a esses Pods um endereço estável. Cada objeto é um estado desejado guardado na API; um controller trabalha continuamente para fazer a realidade bater com ele. Este conceito mostra como os cinco se encaixam, quais você deve escrever à mão (Deployment e Service) e quais você só observa (ReplicaSet e Pod), e como labels e selectors os colam.

## Use Cases

- Implantar uma API web com duas réplicas e um endereço estável dentro do cluster.
- Entender por que apagar um Pod "não faz nada" (ele volta) e apagar um ReplicaSet também "não faz nada".
- Ler a saída de `kubectl get all` e saber qual objeto é dono de qual.
- Separar aplicações ou tenants em namespaces.

## Deep Dive

### O loop declarativo

Você nunca diz ao Kubernetes "suba um container". Você guarda um objeto que diz "devem existir 2 Pods assim", e os controllers reconciliam:

```
Deployment (você escreve)  --é dono de-->  ReplicaSet (gerado)  --é dono de-->  Pods (gerados)
Service (você escreve)     --seleciona por label-->  Pods
```

Cada objeto possuído carrega `metadata.ownerReferences`, e é assim que `kubectl delete deployment` se propaga para os ReplicaSets e Pods dele.

### Pod

A menor unidade: um ou mais containers compartilhando um network namespace (mesmo IP, `localhost` entre eles) e volumes. Pods são **descartáveis**: ganham um nome e um IP novos toda vez que são recriados, e nada recria um Pod avulso criado à mão se o nó dele morrer. Escrever Pods diretamente serve para um shell de depuração (`kubectl run`), não para uma aplicação.

### ReplicaSet

Mantém exatamente `replicas` Pods que casam com o seu `selector`. Apague um Pod e o ReplicaSet cria outro em um segundo. Você raramente escreve um: o Deployment cria um ReplicaSet novo a cada mudança no template do Pod e reduz o antigo. É por isso que `kubectl get rs` mostra vários ReplicaSets com `DESIRED 0`: eles são o histórico de rollouts.

### Deployment

O objeto que você de fato escreve para serviços stateless:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: team-a
spec:
  replicas: 2
  selector:
    matchLabels: {app: api}          # quais Pods pertencem a este Deployment
  template:                          # a planta do Pod
    metadata:
      labels: {app: api}             # precisa casar com o selector
    spec:
      containers:
        - name: app
          image: registry.example.com/demo/web-app:1.4.2
          ports: [{containerPort: 8080}]
```

- Mudar qualquer coisa em `template` (imagem, env, resources) cria um ReplicaSet novo e inicia um rolling update.
- Mudar `replicas` só escala o ReplicaSet atual.
- `spec.selector` é **imutável** depois da criação. Mudar labels do selector exige apagar e recriar o Deployment.

Para software stateful com identidade estável (um PVC por réplica, nomes previsíveis como `db-0`) existe o `StatefulSet`; para um Pod por nó, o `DaemonSet`; para execução até terminar, o `Job`. Num nó único, um Deployment de uma réplica com `strategy: Recreate` e um PVC é uma escolha comum e simples para um banco de dados.

### Service

Pods vêm e vão; um Service é a porta de entrada estável:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: team-a
spec:
  selector: {app: api}               # todo Pod pronto com este label recebe tráfego
  ports:
    - port: 80                       # porta do Service
      targetPort: 8080               # porta do container
```

O Service ganha um IP virtual e um nome DNS (`api.team-a.svc.cluster.local`). O controller de EndpointSlice mantém a lista de IPs dos Pods **prontos** por trás dele. Um Pod que falha na readiness probe sai dessa lista sem ser reiniciado. O tipo de Service e o DNS têm conceitos próprios.

O erro de ligação mais comum é um selector que não casa com nada:

```bash
kubectl -n team-a get endpointslices -l kubernetes.io/service-name=api
# ENDPOINTS <unset>  -> o selector não casa com nenhum Pod pronto
kubectl -n team-a get pods -l app=api --show-labels
```

### Namespace

Um escopo de nomes e uma fronteira de políticas. Nomes precisam ser únicos por namespace, não por cluster, então `team-a/api` e `team-b/api` coexistem. Namespaces são onde você pendura ResourceQuotas, LimitRanges, RoleBindings de RBAC, NetworkPolicies e labels de Pod Security. Alguns objetos são de escopo de cluster e não vivem em namespace nenhum (Nodes, PersistentVolumes, StorageClasses, ClusterRoles, os próprios Namespaces):

```bash
kubectl api-resources --namespaced=false
```

Um Pod só consegue referenciar ConfigMaps, Secrets e PVCs do seu próprio namespace. Ele consegue alcançar Services de qualquer namespace pela rede, a não ser que uma NetworkPolicy bloqueie.

### Vendo a cadeia

```bash
kubectl -n team-a get deploy,rs,pods,svc -l app=api
kubectl -n team-a get pod <pod> -o jsonpath='{.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}'
# ReplicaSet/api-6b48bf5ccc
```

O nome do ReplicaSet é o nome do Deployment mais um hash do template do Pod (label `pod-template-hash`), e o nome do Pod acrescenta um sufixo aleatório. Esse hash é como você descobre, só pelo nome do Pod, qual versão do template ele roda.

## Trade-offs

- **Deployment vs StatefulSet para bancos de dados.** Um StatefulSet dá nomes estáveis e PVCs por réplica, o que importa a partir de duas réplicas. Com uma réplica, um Deployment com `Recreate` e um PVC é mais simples de operar e de entender.
- **Um namespace por aplicação vs por componente.** Um por aplicação ou time (`team-a`, `team-b`) mantém cada um autocontido e fácil de apagar. Infraestrutura compartilhada (um cache ou fila usado por várias aplicações) fica melhor no seu próprio namespace, acessada por DNS entre namespaces.
- **Labels são de graça, selectors são para sempre.** Coloque um conjunto pequeno e estável de labels no selector (`app`), e todo o resto (`version`, `team`) só em metadata, porque o selector não pode mudar depois.

## Documentation Links

- [Kubernetes docs: Pods](https://kubernetes.io/docs/concepts/workloads/pods/): ciclo de vida, Pods com vários containers.
- [Kubernetes docs: ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/): ownership e por que usar Deployments no lugar.
- [Kubernetes docs: Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): mudanças de template, selectors, rollouts.
- [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/): selectors, portas, EndpointSlices.
- [Kubernetes docs: Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): escopo e recursos de escopo de cluster.
