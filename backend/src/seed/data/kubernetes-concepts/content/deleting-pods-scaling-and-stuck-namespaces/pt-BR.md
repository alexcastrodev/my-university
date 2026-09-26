---
version: 1.0
updatedAt: 2026-09-26
title: "Apagando Pods, Escalando e Namespaces Presos"
summary: "Reiniciar e forçar a remoção de Pods com segurança, escalar para zero, e diagnosticar um namespace preso em Terminating pelos seus finalizers."
---
## Objective

Apagar coisas no Kubernetes normalmente é um pedido, não uma ação: o API server marca o objeto para remoção, controllers e o kubelet fazem o trabalho, e **finalizers** podem segurar o objeto até alguma limpeza terminar. É por isso que um Pod apagado volta (o controller dele o recria), por que uma remoção forçada pode deixar um processo rodando, e por que um namespace pode ficar dias em `Terminating`. Este conceito cobre reiniciar e remover Pods com segurança, escalar para zero, e diagnosticar e resolver um namespace preso, com as condições exatas que o Kubernetes reporta.

## Use Cases

- Reiniciar um Pod com problema sem mexer no resto do Deployment.
- Parar um workload temporariamente (manutenção, um backup que precisa de um volume parado).
- Limpar um ambiente apagando o namespace dele.
- Destravar um namespace preso em `Terminating`.

## Deep Dive

### Apagando um Pod

```bash
kubectl -n team-a delete pod web-6b48bf5ccc-4cvpp
```

O que acontece:

1. O Pod ganha um `deletionTimestamp` e entra em `Terminating`; ele é removido dos endpoints do Service.
2. O kubelet roda os hooks `preStop`, envia `SIGTERM`, espera até `terminationGracePeriodSeconds` (padrão 30) e depois `SIGKILL`.
3. O objeto Pod desaparece.

Enquanto isso, se o Pod pertence a um ReplicaSet, o ReplicaSet percebe que tem uma réplica a menos e cria uma substituta **imediatamente**. Apagar um Pod gerenciado é, portanto, o jeito padrão de reiniciar uma instância. Para reiniciar todas de forma ordenada, use `kubectl rollout restart` em vez de apagar Pods por label (o que remove todos de uma vez).

### Remoção forçada

```bash
kubectl delete pod web-xyz --grace-period=0 --force
# Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated.
#          The resource may continue to run on the cluster indefinitely.
```

Isso remove o **objeto** Pod da API sem esperar o kubelet confirmar que os containers sumiram. Se o nó está saudável, o kubelet os mata logo depois. Se o nó está inacessível, os processos podem continuar rodando enquanto o Kubernetes já considera o Pod encerrado e sobe um substituto em outro lugar: duas cópias de um singleton, possivelmente no mesmo volume. Use só para Pods presos em `Terminating` num nó que você sabe que morreu, nunca como um `delete` mais rápido.

### Escalar em vez de apagar

```bash
kubectl -n team-a scale deploy/worker --replicas=0     # para, mantém todo o resto
kubectl -n team-a scale deploy/worker --replicas=2     # sobe de novo
```

Escalar para zero mantém o Deployment, suas ConfigMaps, Secrets, PVCs e o Service; nada precisa ser reaplicado. É a ferramenta certa para janelas de manutenção e para parar a escrita num volume antes de um backup. Note que o próximo `kubectl apply` de um manifest com `replicas: 2` escala de volta. Se um HPA gerencia o Deployment, ele briga com o escalonamento manual; pause ou apague o HPA antes.

### Apagando um namespace

```bash
kubectl delete namespace team-b
```

O namespace vai para `Terminating`, e o controller de namespaces apaga **todos** os objetos dentro dele: Deployments, Secrets, PVCs (e, com reclaim policy `Delete`, os dados), tudo. Só quando o namespace está vazio o objeto Namespace em si é removido. Não há como desfazer.

### Preso em Terminating: finalizers

Um finalizer é uma string em `metadata.finalizers` que diz "algum controller precisa limpar algo antes de este objeto poder sumir". O objeto fica, com um `deletionTimestamp`, até a lista ficar vazia. Se o controller que deveria remover o finalizer não existe mais (operator desinstalado, webhook quebrado, controller de CRD apagado), o objeto nunca some, e o namespace dele também não.

Verificado no k3s: uma ConfigMap com um finalizer inventado, e depois `kubectl delete ns stuck`:

```
$ kubectl get ns stuck
NAME    STATUS        AGE
stuck   Terminating   9s

$ kubectl get ns stuck -o jsonpath='{.status.conditions}'
... "type":"NamespaceContentRemaining",
    "message":"Some resources are remaining: configmaps. has 1 resource instances"
... "type":"NamespaceFinalizersRemaining",
    "message":"Some content in the namespace has finalizers remaining: example.com/cleanup in 1 resource instances"
```

As conditions dizem exatamente o que procurar. Depois:

```bash
# descubra o que sobrou (o get all não mostra tudo)
kubectl api-resources --verbs=list --namespaced -o name \
  | xargs -n 1 kubectl get --show-kind --ignore-not-found -n stuck

# veja os finalizers do objeto que sobrou
kubectl -n stuck get configmap c -o jsonpath='{.metadata.finalizers}'
```

A correção certa, em ordem de preferência:

1. **Traga o controller de volta** (reinstale o operator) e deixe-o terminar a limpeza. O finalizer pode estar protegendo algo fora do cluster, como um load balancer de nuvem ou um registro de DNS.
2. **Remova o finalizer do objeto preso**, quando você sabe que a limpeza externa é desnecessária ou foi feita à mão:

```bash
kubectl -n stuck patch configmap c --type=json \
  -p '[{"op":"remove","path":"/metadata/finalizers"}]'
```

Verificado: segundos depois desse patch, `kubectl get ns stuck` retornou `NotFound`.

Outra causa comum é uma **API agregada indisponível** (um metrics-server quebrado, um API server de extensão removido): a condition é `NamespaceDeletionDiscoveryFailure`, e a correção é consertar ou apagar esse `APIService` (`kubectl get apiservice | grep False`).

O truque popular de remover o finalizer **do próprio Namespace** pelo subresource `/finalize` faz o namespace sumir deixando os objetos órfãos dele no etcd, invisíveis e ainda com os seus finalizers. Corrija os objetos, não o namespace.

## Trade-offs

- **Apagar um Pod vs rollout restart.** Apagar um Pod é pontual e imediato; o `rollout restart` substitui todos os Pods aos poucos e respeita as configurações de disponibilidade.
- **Escalar para zero vs apagar.** Escalar é reversível e mantém configuração e dados; apagar é definitivo e limpa tudo.
- **Remover finalizers à mão vs consertar o controller.** Removê-los destrava na hora e pode deixar vazar recursos externos que o finalizer protegia; restaurar o controller é mais lento e limpa direito.

## Documentation Links

- [Kubernetes docs: Termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination): grace period, remoção forçada.
- [Kubernetes docs: Finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/): como finalizers bloqueiam a remoção.
- [Kubernetes docs: Namespaces (deleting)](https://kubernetes.io/docs/tasks/administer-cluster/namespaces/#deleting-a-namespace): o que a remoção apaga.
- [Kubernetes docs: Namespace status conditions](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/namespace-v1/#NamespaceStatus): significado de cada tipo de condition.
