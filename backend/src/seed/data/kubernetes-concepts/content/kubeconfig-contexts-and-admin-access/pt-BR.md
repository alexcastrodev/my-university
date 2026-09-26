---
version: 1.0
updatedAt: 2026-09-26
title: "Kubeconfig, Contextos e Acesso de Admin"
summary: "Exportar o kubeconfig, contextos e arquivos KUBECONFIG combinados, e por que o certificado de admin do MicroK8s (system:masters, dez anos, sem revogação) não deve ser compartilhado."
---
## Objective

O `kubectl` sabe com qual cluster falar, e como quem, a partir de um arquivo kubeconfig. Quando você passa a rodar comandos de um laptop ou de um job de CI em vez do próprio nó, precisa exportar esse arquivo, combiná-lo com outros, trocar de contexto com segurança e entender o que as credenciais dentro dele podem fazer. No MicroK8s as credenciais exportadas são um certificado de cliente no grupo `system:masters`, válido por dez anos e impossível de revogar individualmente, o que torna a proteção desse arquivo um assunto sério de segurança. Este conceito cobre `microk8s config`, contextos, a variável `KUBECONFIG` e como parar de distribuir essa chave de admin.

## Use Cases

- Rodar `kubectl` e `kubectl apply -k` da sua estação de trabalho contra o nó MicroK8s.
- Trabalhar com vários clusters (laboratório, staging, produção) sem aplicar no errado.
- Dar a um pipeline de CI acesso a um único namespace.
- Reagir quando um kubeconfig de admin vazou.

## Deep Dive

### Exportando o kubeconfig

```bash
microk8s config > ~/.kube/microk8s.yaml
```

Estrutura (verificado na 1.35, segredos ocultados):

```yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: <CA>
    server: https://192.168.252.3:16443
  name: microk8s-cluster
contexts:
- context:
    cluster: microk8s-cluster
    user: admin
  name: microk8s
current-context: microk8s
users:
- name: admin
  user:
    client-certificate-data: <cert>
    client-key-data: <key>
```

Três coisas para notar:

- O API server escuta na **16443**, não na 6443.
- `server` é o IP do nó. Se você acessa o nó por um nome DNS ou outro IP (NAT, VPN), troque-o, e o nome precisa estar nos SANs do certificado do API server (o MicroK8s adiciona IPs automaticamente; nomes extras vão em `/var/snap/microk8s/current/certs/csr.conf.template`, seguido de `sudo microk8s refresh-certs --cert server.crt`).
- O usuário `admin` se autentica com um certificado de cliente:

```bash
$ microk8s config | grep client-certificate-data | awk '{print $2}' | base64 -d \
    | openssl x509 -noout -subject -enddate
subject=CN = admin, O = system:masters
notAfter=Sep 23 19:59:25 2036 GMT
```

`O = system:masters` é um grupo que ignora o RBAC por completo, e o certificado vale por dez anos. O Kubernetes não tem lista de revogação de certificados: a única forma de invalidar uma cópia vazada é rotacionar a CA do cluster (`microk8s refresh-certs --cert ca.crt`), o que invalida toda credencial assinada por ela.

### Contextos: cluster + usuário + namespace

Um contexto é uma tripla com nome. `kubectl config` manipula o arquivo:

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config use-context microk8s
kubectl config set-context --current --namespace=team-a   # namespace padrão deste contexto
kubectl config rename-context microk8s prod-node1
```

Uma sobrescrita por comando nunca altera o arquivo:

```bash
kubectl --context=prod-node1 -n team-a get pods
```

Em scripts e CI, **sempre passe `--context`** (ou use um kubeconfig que contenha exatamente um contexto). Confiar no `current-context` é como as pessoas rodam `kubectl delete` em produção achando que é o laboratório.

### Vários kubeconfigs e KUBECONFIG

`KUBECONFIG` é uma lista de arquivos (separados por `:` no Linux e no macOS) que o kubectl combina em memória:

```bash
export KUBECONFIG=~/.kube/config:~/.kube/microk8s.yaml:~/.kube/staging.yaml
kubectl config get-contexts     # contextos de todos os arquivos
```

Regras de combinação: o primeiro arquivo que define um nome vence, e o `current-context` vem do primeiro arquivo que o define. Colisão de nomes é a armadilha clássica: todo export do MicroK8s usa os mesmos nomes (`microk8s-cluster`, `admin`, `microk8s`), então dois clusters exportados se escondem um ao outro em silêncio. Renomeie antes de combinar:

```bash
sed -e 's/microk8s-cluster/node1/g' -e 's/name: admin/name: node1-admin/' \
    -e 's/user: admin/user: node1-admin/' -e 's/: microk8s$/: node1/' \
    microk8s.yaml > node1.yaml
```

Para achatar uma visão combinada num único arquivo:

```bash
KUBECONFIG=~/.kube/config:node1.yaml kubectl config view --flatten > merged.yaml
```

O arquivo é uma credencial: mantenha-o com `chmod 600` (o Helm avisa sobre kubeconfigs legíveis pelo grupo ou por todos, o kubectl não).

### Restringir acesso em vez de compartilhar o arquivo de admin

O kubeconfig de admin é para emergência e bootstrap. Para pessoas e pipelines, dê a cada identidade as suas próprias credenciais, com escopo. Com o add-on `rbac` habilitado:

```bash
microk8s enable rbac
kubectl -n team-a create serviceaccount ci-deployer
kubectl -n team-a create rolebinding ci-deployer --clusterrole=edit \
  --serviceaccount=team-a:ci-deployer
kubectl -n team-a create token ci-deployer --duration=1h    # token de vida curta
```

Um kubeconfig para essa identidade:

```yaml
users:
- name: ci-deployer
  user:
    token: <saída do kubectl create token>
contexts:
- name: ci-team-a
  context: {cluster: node1, user: ci-deployer, namespace: team-a}
```

Revogá-lo é `kubectl delete rolebinding ci-deployer` ou apagar a ServiceAccount, sem mexer em mais ninguém. Veja o conceito de RBAC para montar a Role.

No próprio nó:

- `/var/snap/microk8s/current/credentials/` guarda os kubeconfigs de admin e dos componentes, legíveis pelo root e pelo grupo `microk8s`. Mantenha nesse grupo só quem pode ser cluster-admin.
- Restrinja no firewall a porta 16443 às redes que realmente precisam da API.

## Trade-offs

- **Um kubeconfig de admin para todos vs credenciais por identidade.** Compartilhar é rápido de configurar e impossível de auditar ou revogar. Credenciais por identidade custam uma Role e um binding por consumidor e dão revogação e menor privilégio.
- **Tokens de vida longa vs curta.** Tokens de `kubectl create token` expiram (uma hora por padrão), o que é ideal para jobs de CI que pedem um por execução. Uma Secret de token de vida longa (`kubernetes.io/service-account-token`) dura para sempre e precisa ser rotacionada à mão.
- **KUBECONFIG combinado vs um arquivo por cluster.** Combinar é prático para trabalho interativo; para automação, um arquivo dedicado com um único contexto por destino é o padrão mais seguro.

## Documentation Links

- [Kubernetes docs: Organizing cluster access using kubeconfig files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/): regras de combinação e precedência.
- [Kubernetes docs: Configure access to multiple clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/): contextos passo a passo.
- [MicroK8s: Working with kubectl](https://canonical.com/microk8s/docs/working-with-kubectl): `microk8s config` e kubectl externo.
- [MicroK8s: Services and ports](https://canonical.com/microk8s/docs/services-and-ports): porta 16443 e o diretório de credenciais.
- [Kubernetes docs: Authenticating (X509 client certificates)](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#x509-client-certificates): por que usuários de certificado não podem ser revogados.
