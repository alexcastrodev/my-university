---
version: 1.0
updatedAt: 2026-09-26
title: "RBAC e Menor Privilégio"
summary: "O MicroK8s roda com AlwaysAllow até o RBAC ser habilitado; Roles, bindings, testes com auth can-i, permissões perigosas, e como substituir concessões de cluster-admin."
---
## Objective

O Role-Based Access Control decide o que cada identidade (uma pessoa, um job de CI, uma ServiceAccount usada por um Pod) pode fazer na API. Ele é montado com quatro objetos: **Role** e **ClusterRole** listam verbos permitidos em recursos, **RoleBinding** e **ClusterRoleBinding** os concedem a sujeitos. Menor privilégio significa que cada identidade recebe exatamente os verbos, recursos e namespaces de que precisa, e `cluster-admin` fica reservado para acesso de emergência. No MicroK8s existe um pré-requisito que surpreende: o RBAC vem **desligado** por padrão. Este conceito cobre habilitá-lo, escrever Roles enxutas, testá-las com `kubectl auth can-i`, e substituir os bindings de `cluster-admin` que dashboards e ferramentas de administração pedem.

## Use Cases

- Um pipeline de CI que pode atualizar Deployments num namespace e nada mais.
- Acesso somente leitura para desenvolvedores em namespaces de produção.
- Um dashboard ou ferramenta de administração que o instalador vincula a `cluster-admin`.
- Auditar quem consegue ler Secrets.

## Deep Dive

### Primeiro: o RBAC está mesmo ligado?

Um nó MicroK8s 1.35 novo roda o API server com:

```
--authorization-mode=AlwaysAllow
```

Toda requisição autenticada é permitida. Verificado: a partir de um Pod no namespace `default`, o token de ServiceAccount montado automaticamente conseguiu listar Secrets em `kube-system`:

```bash
curl -sk -H "Authorization: Bearer $(cat /var/run/secrets/kubernetes.io/serviceaccount/token)" \
  https://kubernetes.default.svc/api/v1/namespaces/kube-system/secrets     # HTTP 200
```

Qualquer container comprometido é, portanto, cluster-admin. Depois de `microk8s enable rbac` (que muda para `--authorization-mode=RBAC,Node` e reinicia o API server), a mesma requisição retornou **403**. Habilite antes de qualquer outra coisa rodar no cluster. Componentes instalados enquanto tudo era permitido podem ficar sem os objetos de RBAC de que precisam: verificado, o add-on de ingress habilitado antes do `rbac` passou a logar `nodes is forbidden: User "system:serviceaccount:ingress:traefik" cannot list resource "nodes"`. Confira também outras distribuições: `kubectl api-versions | grep rbac` só diz que a API existe, não que ela é aplicada; teste com um token que deveria ser negado.

### Os quatro objetos

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: deployer, namespace: team-a}
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: deployer, namespace: team-a}
roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: deployer}
subjects:
  - {kind: ServiceAccount, name: deployer, namespace: team-a}
```

- Uma **Role** é de namespace; uma **ClusterRole** vale no cluster todo e pode ser usada para recursos de escopo de cluster (nodes, namespaces) ou como template reutilizável.
- Um **RoleBinding** concede uma Role ou uma ClusterRole **dentro de um namespace**. Um **ClusterRoleBinding** concede uma ClusterRole em todo lugar.
- As regras são aditivas; não existem regras de negação.
- `apiGroups: [""]` é o grupo core (Pods, Secrets, ConfigMaps, Services). Subresources (`pods/log`, `pods/exec`, `pods/portforward`, `deployments/scale`) são listados à parte.

Vincular uma ClusterRole embutida num namespace é o padrão mais comum:

```bash
kubectl -n team-a create rolebinding devs-view --clusterrole=view --group=team-a-devs
kubectl -n team-a create rolebinding ci-edit --clusterrole=edit --serviceaccount=team-a:ci
```

Papéis embutidos: `view` (leitura, sem Secrets), `edit` (leitura e escrita da maioria dos objetos, incluindo Secrets, sem RBAC), `admin` (edit mais RBAC dentro do namespace), `cluster-admin` (tudo).

### Testando com kubectl auth can-i

Verificado no k3s com uma Role no namespace `app` concedendo `get,list,watch,patch` em `deployments` à ServiceAccount `app:deployer`:

```
$ kubectl -n app auth can-i patch deployments --as=system:serviceaccount:app:deployer
yes
$ kubectl -n app auth can-i delete deployments --as=system:serviceaccount:app:deployer
no
$ kubectl -n app auth can-i get secrets --as=system:serviceaccount:app:deployer
no
$ kubectl -n infra auth can-i patch deployments --as=system:serviceaccount:app:deployer
no
```

```bash
kubectl -n app auth can-i --list --as=system:serviceaccount:app:deployer
```

O `--as` faz impersonation (você precisa da permissão `impersonate`, que admins têm). Coloque essas verificações num script e rode depois de toda mudança de RBAC: elas são os testes unitários das suas permissões.

### O que é mais poderoso do que parece

- **`get`/`list` em Secrets** revela todas as credenciais do namespace. `list` devolve o conteúdo completo, não só os nomes.
- **`create` em Pods** (ou em qualquer coisa que cria Pods: Deployments, Jobs) permite montar qualquer Secret do namespace e rodar como qualquer ServiceAccount de lá. Direito de edição no namespace é, na prática, acesso a todas as Secrets dele.
- **`pods/exec`** é um shell dentro dos containers com as credenciais deles.
- **`escalate`, `bind`, `impersonate`** e escrita em Roles/RoleBindings permitem conceder mais a si mesmo.
- **Curingas** (`resources: ["*"]`, `verbs: ["*"]`) incluem tipos de recurso que ainda nem existem.

### Substituindo o cluster-admin de ferramentas

Dashboards, interfaces de administração e alguns operators são instalados com um ClusterRoleBinding para `cluster-admin` porque isso sempre funciona. Aperte:

1. Decida o que a ferramenta precisa fazer: ler tudo? gerenciar workloads em alguns namespaces? ler Secrets?
2. Crie uma ClusterRole com essas regras (para leitura em todo o cluster, vincule a `view` embutida com um ClusterRoleBinding; ela exclui Secrets).
3. Para escrita, vincule `edit` ou uma role customizada **por namespace** com RoleBindings em vez de no cluster todo.
4. Apague o binding de `cluster-admin` e verifique com `kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>`.

Aceite que algumas funcionalidades da ferramenta vão parar de funcionar; esse é o objetivo. Se uma ferramenta realmente precisa de cluster-admin, proteja o acesso à própria ferramenta (SSO, restrições de rede) como você protegeria o kubeconfig de admin.

### Descobrindo quem pode fazer o quê

```bash
kubectl get rolebindings,clusterrolebindings -A -o wide | grep -E 'cluster-admin|edit'
kubectl auth can-i get secrets -n team-a --as=system:serviceaccount:team-a:default
```

Ferramentas como `rbac-tool` ou `kubectl-who-can` respondem diretamente "quem consegue ler secrets em team-a".

## Trade-offs

- **Papéis embutidos vs papéis customizados.** `view`/`edit`/`admin` são mantidos e agregam automaticamente tipos de recurso novos; papéis customizados são mais enxutos e precisam ser atualizados quando as necessidades mudam.
- **Concessões por namespace vs no cluster todo.** RoleBindings por namespace limitam o raio de impacto e multiplicam objetos; ClusterRoleBindings são simples e concedem tudo em todo lugar.
- **RBAC estrito vs conveniência.** Permissões apertadas quebram ferramentas e scripts que assumiam admin; cada quebra é uma decisão sobre o que aquela ferramenta deveria realmente poder fazer.

## Documentation Links

- [Kubernetes docs: Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/): objetos, papéis padrão, prevenção de escalonamento de privilégio.
- [Kubernetes docs: Role Based Access Control Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/): permissões arriscadas.
- [kubectl auth can-i reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/): testando permissões.
- [MicroK8s: RBAC add-on](https://canonical.com/microk8s/docs/multi-user): habilitando RBAC e acesso multiusuário.
