---
version: 1.0
updatedAt: 2026-09-26
title: "Tokens de ServiceAccount e Automount"
summary: "O que é o token montado automaticamente, quando desligá-lo com automountServiceAccountToken, ServiceAccounts dedicadas, e tokens com audience própria."
---
## Objective

Todo Pod roda como uma **ServiceAccount**, e por padrão o Kubernetes monta um token dela em todo container, em `/var/run/secrets/kubernetes.io/serviceaccount`. Esse token é uma credencial para o API server. A maioria das aplicações nunca chama a API do Kubernetes, então para elas o token é pura superfície de ataque: quem conseguir execução de código no container ganha as permissões da ServiceAccount, o que num cluster sem RBAC significa tudo. Este conceito cobre o que é o token, quanto tempo ele vive, quando desligar o automount com `automountServiceAccountToken: false`, e como dar aos poucos Pods que precisam de acesso à API uma identidade própria e restrita.

## Use Cases

- Endurecer serviços web comuns que nunca falam com a API do Kubernetes.
- Dar a um operator, a um runner de CI ou a um controller a sua própria ServiceAccount com uma Role mínima.
- Emitir um token de vida curta com audience customizada para um sistema externo (Vault, um provedor de nuvem).
- Evitar a colisão de montagem que o token causa com Secrets montadas em `/run/secrets`.

## Deep Dive

### O que é montado

```bash
kubectl exec web-xyz -- ls /var/run/secrets/kubernetes.io/serviceaccount/
# ca.crt  namespace  token
```

- `token`: um JWT assinado pelo API server, vinculado a este Pod.
- `ca.crt`: para verificar o certificado do API server.
- `namespace`: o namespace do Pod.

As claims do token, verificadas no k3s v1.36 (payload decodificado, resumido):

```json
{"aud":["https://kubernetes.default.svc.cluster.local","k3s"],
 "iss":"https://kubernetes.default.svc.cluster.local",
 "kubernetes.io":{"namespace":"app","node":{"name":"..."},"pod":{"name":"client"},
                  "serviceaccount":{"name":"default"}},
 "exp":1821989008, "iat":1790453008}
```

É um **token projetado e vinculado**: amarrado ao Pod (deixa de valer quando o Pod é apagado), com audience e expiração, e o kubelet o renova automaticamente. Aqui `exp - iat` é um ano: o API server estende tokens pedidos pelo kubelet por compatibilidade com clientes antigos (`--service-account-extend-token-expiration`, ligado por padrão), enquanto o vínculo com o Pod ainda o invalida quando o Pod some. Desde o Kubernetes 1.24 nenhuma Secret de token de vida longa é criada automaticamente para ServiceAccounts.

Se um Pod não especifica `serviceAccountName`, ele usa a ServiceAccount `default` do namespace.

### Desligando

Na ServiceAccount (todo Pod que a usa):

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: {name: default, namespace: team-a}
automountServiceAccountToken: false
```

Ou por Pod (sobrescreve a configuração da ServiceAccount):

```yaml
spec:
  automountServiceAccountToken: false
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
```

Verificado: com isso, o diretório `serviceaccount` simplesmente não existe, e nada muda para uma aplicação que nunca o usou.

Isso também elimina uma falha real de inicialização. Em imagens onde `/var/run` é um symlink para `/run` (baseadas em Debian e Ubuntu), montar uma Secret somente leitura em `/run/secrets` colide com o ponto de montagem do token e o container falha com `StartError: ... mkdirat .../run/secrets/kubernetes.io: read-only file system`. Verificado: o mesmo Pod sobe quando o automount está desligado. (O conceito de volumes cobre os detalhes.)

### Pods que precisam da API

Dê a eles uma ServiceAccount dedicada em vez de usar a `default`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: {name: config-watcher, namespace: team-a}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: read-configmaps, namespace: team-a}
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: config-watcher, namespace: team-a}
roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: read-configmaps}
subjects: [{kind: ServiceAccount, name: config-watcher, namespace: team-a}]
---
# no spec do Pod
serviceAccountName: config-watcher
automountServiceAccountToken: true
```

Teste: `kubectl -n team-a auth can-i list secrets --as=system:serviceaccount:team-a:config-watcher` deve responder `no`.

### Tokens para outras audiences

Um volume projected consegue montar um token extra com audience e validade específicas, para sistemas que verificam tokens do Kubernetes (o auth de Kubernetes do Vault, identidade de workload em nuvens):

```yaml
volumes:
  - name: vault-token
    projected:
      sources:
        - serviceAccountToken:
            audience: vault
            expirationSeconds: 3600
            path: token
```

Um token assim não pode ser reaproveitado contra a API do Kubernetes (audience errada). Para pessoas e CI, `kubectl create token <sa> --duration=1h` emite um token de vida curta sob demanda.

### Quando o token padrão é perigoso

O poder do token é exatamente o das permissões da sua ServiceAccount:

- Com RBAC aplicado e sem bindings, a ServiceAccount `default` quase não consegue fazer nada (endpoints de discovery e auto-revisão).
- Num cluster com `--authorization-mode=AlwaysAllow` (o MicroK8s até `microk8s enable rbac`), todo token é na prática cluster-admin. Verificado: o token padrão de um Pod leu Secrets em `kube-system` (HTTP 200) até o RBAC ser habilitado (HTTP 403).
- Um RoleBinding que alguém adicionou à `default` "para fazer uma ferramenta funcionar" concede isso em silêncio a todo Pod do namespace.

Desligar o automount por padrão e conceder acesso à API de forma explícita deixa os três casos seguros.

## Trade-offs

- **Automount ligado vs desligado por padrão.** Ligado é conveniente para as poucas aplicações que usam a API e expõe uma credencial em todos os outros containers; desligado exige optar explicitamente para essas poucas.
- **ServiceAccounts por aplicação vs `default`.** Contas dedicadas dão permissões precisas e logs de auditoria claros; adicionam um objeto por aplicação.
- **Tokens projetados com audience vs segredos de vida longa.** Tokens com audience e expiração limitam o estrago de um vazamento; Secrets de token de vida longa nunca expiram e precisam ser rotacionadas à mão.

## Lab

Neste lab você recebe um namespace em que alguém fez um Pod funcionar dando o papel `edit` à ServiceAccount `default`, de modo que todo Pod do namespace carrega um token capaz de ler e alterar quase tudo, Secrets incluídos. O seu trabalho é tirar o token de quem não precisa e dar ao único Pod que chama a API uma identidade própria com uma única permissão. A ideia central é sentir que, por padrão, o Kubernetes monta um credencial de API em todo Pod, e que quem ganhar execução de código no container herda as permissões dela.

**O cenário**

Um cluster Kubernetes real (k3s, subido pelo Testcontainers) recebe o namespace `team-a` com um ConfigMap `settings` e um Secret `db`, e o seu manifesto.

- `web`: um Pod comum que nunca chama a API do Kubernetes.
- `watcher`: um Pod com `curl` que lista os ConfigMaps do namespace pela API e nada além disso.
- `default-edit`: um `RoleBinding` que dá o `ClusterRole` `edit` à ServiceAccount `default`. É o atalho a ser desfeito.
- `src/main/resources/k8s/app.yaml`: o único arquivo que você edita.
- `src/test/java/ServiceAccountTokensTest.java`: executa dentro dos Pods e confere que o `web` não tem token algum, que o `watcher` lista ConfigMaps (HTTP 200) mas não lê Secrets (HTTP 403), que ele roda como `config-watcher` e que a ServiceAccount `default` ficou sem permissões.

**O que você vai fazer, passo a passo**

1. **Rodar os testes primeiro.** Veja quais verificações falham e perceba que o `watcher` só funciona por causa do atalho.
2. **Tirar o token do `web` (TODO-00).** Faça o Kubernetes não montar o token da ServiceAccount nesse Pod, para que o diretório de credenciais nem exista dentro do container.
3. **Dar identidade própria ao watcher (TODO-01).** Apague o `RoleBinding` `default-edit` e crie uma ServiceAccount `config-watcher`, um `Role` em `team-a` que só pode `get`, `list` e `watch` em `configmaps`, e um `RoleBinding` entre eles. Depois faça o Pod `watcher` rodar como `config-watcher`.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/serviceaccount-tokens-and-automount test` passa. Você deve conseguir explicar por que o `web` ficou sem token, por que o `watcher` recebe 200 para ConfigMaps mas 403 para Secrets, e por que tirar o `edit` da `default` protege também qualquer Pod futuro do namespace.

**Desafios opcionais**

- **TODO-02:** decodifique o token do watcher (`cut -d. -f2 token | base64 -d`) e leia as claims `aud`, `exp` e o nome do Pod ao qual ele está vinculado. O que acontece com o token quando o Pod é apagado?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s` e baixam `busybox` e `curlimages/curl` dentro dele) e os artigos "ServiceAccount Tokens and Automount" e "RBAC and Least Privilege".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/serviceaccount-tokens-and-automount test`. Os comentários `TODO-00` e `TODO-01` em `app.yaml` marcam o que mudar.

## Documentation Links

- [Kubernetes docs: Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/): ServiceAccounts padrão, tokens, casos de uso.
- [Kubernetes docs: Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/): desligando o automount, tokens projetados.
- [Kubernetes docs: Managing Service Accounts](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/): tokens vinculados e a sua validade.
- [Kubernetes docs: Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): limitando a exposição de credenciais.
