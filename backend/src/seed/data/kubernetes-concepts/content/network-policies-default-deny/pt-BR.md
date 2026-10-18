---
version: 1.0
updatedAt: 2026-09-26
title: "NetworkPolicies e Default Deny"
summary: "Default deny de entrada e saída, regras entre namespaces, selectors AND vs OR, e como liberar o DNS para que políticas de egress não quebrem a resolução de nomes."
---
## Objective

Por padrão todo Pod consegue falar com todo outro Pod do cluster, em todos os namespaces. Uma **NetworkPolicy** muda isso para os Pods que ela seleciona: quando um Pod é selecionado por uma política de ingress (ou egress), só passa o tráfego que alguma política permite explicitamente. O padrão usual é um **default deny** por namespace mais pequenas regras de liberação para as dependências reais. As políticas são aplicadas pelo plugin de CNI, não pelo próprio Kubernetes, e regras de egress têm uma armadilha que quebra o DNS. Este conceito cobre as duas direções, regras entre namespaces, e como verificá-las, com resultados de um cluster real.

## Use Cases

- Tornar um banco de dados acessível só pelas aplicações que o usam.
- Isolar times ou ambientes que dividem um cluster.
- Limitar o que um container comprometido consegue alcançar (movimento lateral, exfiltração de dados).
- Deixar monitoramento e ingress controllers passarem sem abrir tudo.

## Deep Dive

### A aplicação depende do CNI

A API aceita NetworkPolicies em qualquer cluster, mas só um CNI que as implementa as aplica. Calico (padrão do MicroK8s), Cilium e o controller embutido do k3s aplicam; Flannel puro não, e lá as políticas são ignoradas em silêncio. Sempre verifique com um teste de conexão de verdade.

### Default deny para tráfego de entrada

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny-ingress, namespace: shared}
spec:
  podSelector: {}               # todo Pod do namespace
  policyTypes: [Ingress]        # nenhuma regra de ingress listada = nada entra
```

Depois libere o necessário:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-db-from-team-a, namespace: shared}
spec:
  podSelector: {matchLabels: {app: db}}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: {kubernetes.io/metadata.name: team-a}
      ports: [{port: 5432, protocol: TCP}]
```

Verificado no k3s v1.36 com um `db` nginx no namespace `infra` e clientes em `app` e `lab`:

| Passo | De `app` | De `lab` |
|---|---|---|
| sem política | alcança | alcança |
| `default-deny-ingress` em `infra` | bloqueado (timeout) | bloqueado |
| + liberação do namespace `app` na porta 80 | alcança | bloqueado |

`kubernetes.io/metadata.name` é um label que o Kubernetes coloca automaticamente em todo namespace, o que o torna o jeito confiável de selecionar um namespace pelo nome.

### A semântica de selectors que confunde

```yaml
ingress:
  - from:
      - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: team-a}}
        podSelector: {matchLabels: {app: web}}        # AND: Pods web em team-a
```

```yaml
ingress:
  - from:
      - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: team-a}}
      - podSelector: {matchLabels: {app: web}}        # OR: todo team-a, ou Pods web DESTE namespace
```

Um item da lista com os dois selectors é um AND; dois itens são um OR. A diferença é um único `-`. Um `podSelector` sozinho no `from` só casa com Pods do próprio namespace da política.

Políticas são aditivas: se alguma política permite uma conexão, ela é permitida. Não existe regra de "deny" para sobrescrever uma liberação.

### Default deny para tráfego de saída, e o DNS

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny-egress, namespace: team-a}
spec:
  podSelector: {}
  policyTypes: [Egress]
```

Verificado: logo depois de aplicá-la, a resolução de nomes no namespace falhou:

```
$ kubectl -n app exec client -- nslookup db.infra
nslookup: write to '10.43.0.10': Connection refused
```

Todo hostname passa a parecer "desconhecido", e as aplicações logam erros de DNS em vez de erros de rede. Um deny de egress precisa sempre vir com uma liberação de DNS:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-dns, namespace: team-a}
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: kube-system}}
          podSelector: {matchLabels: {k8s-app: kube-dns}}
      ports:
        - {port: 53, protocol: UDP}
        - {port: 53, protocol: TCP}
```

Depois adicione regras de egress para cada dependência real (o banco em `shared`, uma API externa por CIDR com `ipBlock`). Lembre que a conexão precisa dos dois lados: uma liberação de egress em `team-a` **e** uma de ingress em `shared`, se `shared` tem default deny.

### O que mais precisa ser liberado

Depois do default deny, liste o tráfego fácil de esquecer:

- **Ingress controller** até os seus Pods web (a partir do namespace do controller, por exemplo `ingress`).
- **Monitoramento**: o Prometheus coletando portas de métricas (a partir de `observability` ou `monitoring`).
- **Webhooks e operators** chamando Pods, e Pods chamando a API do Kubernetes (egress para o endereço do API server em 443/6443/16443).
- **Health probes** são enviadas pelo kubelet a partir do nó e, em geral, não são bloqueadas por NetworkPolicies nos CNIs comuns.

### Verificando as políticas

```bash
kubectl -n team-a run nettest --rm -it --image=busybox:1.37 --restart=Never -- \
  sh -c 'nslookup db.shared; wget -qO- -T 3 http://db.shared:5432 || echo BLOCKED'
kubectl get networkpolicy -A
kubectl -n shared describe networkpolicy allow-db-from-team-a
```

Mantenha um pequeno script com pares "deve conectar" e "deve ser bloqueado" e rode depois de toda mudança de política, como as verificações de `auth can-i` para RBAC.

## Trade-offs

- **Default deny vs aberto por padrão.** Negar por padrão contém invasões e documenta dependências, ao custo de quebrar tudo que ninguém anotou, o que você descobre no primeiro dia.
- **Só ingress vs ingress e egress.** Políticas de ingress protegem serviços e são fáceis de acertar; políticas de egress impedem exfiltração e exigem listar explicitamente DNS, API server e endpoints externos.
- **NetworkPolicy padrão vs políticas específicas do CNI.** A API padrão é portável e limitada (sem regras L7, sem padrões para o cluster todo, sem deny explícito); as políticas do Calico e do Cilium adicionam isso e prendem você ao CNI.

## Lab

Neste lab você recebe um namespace compartilhado com um banco e um cache, e um `policies.yaml` que parece proteger o banco mas deixa quatro coisas erradas ao mesmo tempo. O seu trabalho é fechar o namespace para que só um tipo de Pod de outro namespace alcance o banco, mantendo um egress restrito que não quebre o DNS. A ideia central é sentir que uma NetworkPolicy só restringe os Pods que ela seleciona, e que a diferença entre dois seletores na mesma lista ou em itens separados muda completamente o significado.

**O cenário**

Um cluster Kubernetes real (k3s, subido pelo Testcontainers, cujo controlador embutido aplica NetworkPolicies) recebe os Pods de `src/test/resources/k8s/workloads.yaml`, que já vem pronto.

- `shared`: `db` e `cache` (HTTP na 8080) e um Pod `impostor` com o label `app=api`.
- `team-a`: um Pod `api` (`app=api`).
- `team-b`: um Pod `client`.
- `src/main/resources/k8s/policies.yaml`: o único arquivo que você edita. Já traz um `default-deny-egress` em `team-a` (mantenha) e uma `allow-api-to-db` em `shared` com um erro de seletor.
- `src/test/java/NetworkPoliciesTest.java`: faz requisições HTTP reais e exige que `team-a/api` alcance `db.shared` pelo nome e que nada mais alcance `db` ou `cache`.

**O que você vai fazer, passo a passo**

1. **Rodar os testes primeiro.** Quatro coisas falham de uma vez: `team-a/api` nem resolve nomes, `team-b` alcança o `cache` e `shared/impostor` alcança os dois serviços.
2. **Fechar o ingress de `shared` (TODO-00).** O `cache` não é selecionado por política nenhuma, então o cluster inteiro chega nele. Adicione uma política de negar por padrão o tráfego de entrada para todos os Pods de `shared`.
3. **Corrigir os seletores (TODO-01).** Em `allow-api-to-db`, os dois seletores estão em itens separados da lista `from`, o que significa "qualquer Pod de `team-a`" OU "qualquer Pod com `app=api`" (inclusive o impostor em `shared`). Junte-os no mesmo item para significar "Pods `app=api` **em** `team-a`".
4. **Liberar o DNS e o tráfego até o banco (TODO-02).** Com o egress negado, o `api` não resolve `db.shared`. Permita as consultas DNS (UDP e TCP 53 para os Pods do kube-dns em `kube-system`) e o tráfego de `team-a` para o `db` em `shared` na porta 8080.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/network-policies-default-deny test` passa: `team-a/api` busca `db` pelo nome e `impostor`, `team-b` e qualquer outro são bloqueados. Você deve conseguir explicar por que o `namespaceSelector` e o `podSelector` no mesmo item são um E, e em itens separados são um OU.

**Desafios opcionais**

- **TODO-03:** remova a regra de DNS da sua solução e rode `nslookup db.shared` a partir de `team-a/api`. Que erro a aplicação vê, e por que ele parece um problema de DNS e não de NetworkPolicy?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s` e baixam `busybox` dentro dele) e o artigo "NetworkPolicies and Default Deny".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/network-policies-default-deny test`. Os comentários `TODO-00` a `TODO-02` em `policies.yaml` marcam o que fazer. As regras de permissão podem levar alguns segundos para ser programadas, e o teste já repete a tentativa.

## Documentation Links

- [Kubernetes docs: Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/): semântica, políticas padrão, comportamento dos selectors.
- [Kubernetes docs: Declare Network Policy](https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/): exemplo passo a passo.
- [Calico docs: Kubernetes network policy](https://docs.tigera.io/calico/latest/network-policy/get-started/kubernetes-policy/kubernetes-network-policy): aplicação no CNI padrão do MicroK8s.
- [Network Policy Editor (Cilium)](https://editor.networkpolicy.io/): editor visual para conferir a lógica dos selectors.
