---
version: 1.0
updatedAt: 2026-09-25
title: "Fundamentos de Secrets no Kubernetes"
summary: "O que uma Secret realmente é, como o kubectl monta uma a partir de um env file (e o que ele rejeita), por que base64 não é criptografia, e quem de fato consegue lê-la."
---
## Objective

Uma Secret do Kubernetes é um objeto pequeno da API (no máximo 1 MiB) que guarda pares chave/valor sensíveis, para que esses dados fiquem fora da imagem do container e fora do spec do Pod. O nome promete mais do que o objeto entrega: por padrão uma Secret é codificada em base64, não criptografada, e qualquer um que consiga criar um Pod no namespace dela consegue lê-la. Este conceito cobre o que uma Secret realmente é, como `kubectl create secret generic` transforma um env file em uma (incluindo as entradas que ele rejeita), como atualizar Secrets, e o modelo de acesso que você precisa acertar antes que qualquer coisa ali seja de fato secreta.

## Use Cases

- Credenciais de banco, API keys e tokens de webhook por ambiente, fora do Git e fora da imagem.
- Uma Secret por tenant ou por sistema externo (`tenant-alpha`, `tenant-beta`), para que cada uma seja rotacionada e tenha permissões de forma independente.
- Certificados TLS para Ingress (`kubernetes.io/tls`) e credenciais de registry para pull de imagens (`kubernetes.io/dockerconfigjson`).
- Criar uma Secret a partir do mesmo arquivo `.env` que o desenvolvedor já usa localmente com Docker Compose.

## Deep Dive

### O que é armazenado de fato

Uma Secret é um mapa de chaves para bytes codificados em base64, mais um `type`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tenant-alpha
  namespace: example
type: Opaque
data:
  DB_USER: YWxwaGFfYXBw         # "alpha_app"
  DB_PASSWORD: YWxwaGEtczNjcmV0 # "alpha-s3cret"
```

O base64 existe para que dados binários arbitrários (um keystore, um certificado) caibam em JSON. É uma codificação, não uma proteção: `echo YWxwaGEtczNjcmV0 | base64 -d` basta. Quem consegue rodar `kubectl get secret -o yaml` tem o texto puro.

`Opaque` é o tipo genérico. Os tipos embutidos (`kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`, `kubernetes.io/basic-auth`, `kubernetes.io/ssh-auth`, `kubernetes.io/service-account-token`) só adicionam validação das chaves obrigatórias; não são armazenados de forma diferente.

Ao escrever YAML à mão, `stringData` aceita texto puro e o API server codifica para `data` por você. `stringData` é só de escrita: ele nunca aparece quando você lê a Secret de volta.

### Criando uma Secret a partir de um env file

O caminho mais curto de um `.env` local até o cluster é:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-env-file=secrets/example/alpha.env

kubectl -n example create secret generic tenant-beta \
  --from-env-file=secrets/example/beta.env
```

Cada linha `CHAVE=valor` vira uma chave da Secret. O parsing é mais estrito e mais literal do que a maioria dos loaders de `.env`, e é aí que moram as surpresas (tudo verificado com kubectl v1.36):

| Linha no env file | Resultado |
|---|---|
| `# comentário` ou linha em branco | ignorada |
| `URL=postgres://u:p@h/db?x=1` | tudo depois do primeiro `=` é o valor, incluindo `=` e `:` |
| `QUOTED="with quotes"` | o valor é `"with quotes"`, com as aspas. O kubectl **não** as remove |
| `SPACED=  padded  ` | os espaços do valor são mantidos |
| `EMPTY=` | chave criada com valor vazio |
| `KEY = value` | **rejeitada**: `"KEY " is not a valid key name` |
| a mesma chave duas vezes (no mesmo arquivo, ou em dois `--from-env-file`) | **rejeitada**: `cannot add key ..., another key by that name already exists` |

A linha das aspas é o bug clássico de produção: um `.env` que funciona com Docker Compose ou `dotenv` de repente gera, no Kubernetes, uma senha com caracteres de aspas literais.

As outras fontes são `--from-literal=CHAVE=valor` (repetível, bom para demos, mas o valor vai parar no histórico do shell) e `--from-file=[chave=]caminho`, que usa o conteúdo inteiro do arquivo como um único valor (o nome do arquivo vira a chave, a menos que você informe uma). `--from-file` é a escolha certa para certificados, keystores e qualquer coisa com várias linhas.

### Atualizando uma Secret

`kubectl create` falha se a Secret já existe. A atualização idiomática é renderizar e aplicar:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-env-file=secrets/example/alpha.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Se a Secret foi criada originalmente com `kubectl create` puro, o primeiro `apply` imprime um aviso sobre a anotação `last-applied-configuration` ausente e a adiciona. Criar com `--save-config`, ou sempre passar por `apply`, evita isso.

Para valores que nunca devem mudar depois do deploy, marque a Secret com `immutable: true`. Qualquer alteração posterior em `data` é recusada (`field is immutable when immutable is set`); em vez disso você apaga e recria com outro nome. Além de proteger contra edições acidentais, Secrets imutáveis permitem que o kubelet pare de observá-las, o que reduz a carga no API server em clusters com milhares de Secrets.

### Quem consegue ler uma Secret de verdade

Esta é a parte que decide se tudo funciona ou não:

- **Armazenamento.** Por padrão as Secrets ficam no etcd sem criptografia. Criptografia em repouso exige uma `EncryptionConfiguration` no API server (idealmente com um provedor KMS). Clusters gerenciados (EKS, GKE, AKS) costumam oferecer isso como configuração, mas confira se está ligado.
- **RBAC.** `get` em `secrets` revela o valor, e `list` e `watch` também: a listagem devolve os objetos completos, não só os nomes. Conceder `list secrets` "só para ver o que existe" concede todos os valores do namespace.
- **Criação de Pods.** Quem consegue criar um Pod em um namespace consegue montar qualquer Secret desse namespace e lê-la de dentro do container. A fronteira de namespace, e não o RBAC da Secret sozinho, é a verdadeira unidade de isolamento.
- **Nós.** O kubelet só busca Secrets de Pods agendados no próprio nó, e as mantém em `tmpfs`, nunca em disco. Root em um nó ainda significa acesso a tudo que está montado ali.

## Trade-offs

- **Secrets nativas são simples, mas só tão seguras quanto a configuração do cluster.** Sem criptografia em repouso e RBAC apertado, uma Secret é um ConfigMap com nome mais assustador. A alternativa é um gerenciador externo (Vault, AWS Secrets Manager, GCP Secret Manager) sincronizado pelo External Secrets Operator ou montado pelo Secrets Store CSI Driver. Isso traz logs de auditoria e rotação central, ao custo de mais um sistema para operar.
- **`--from-env-file` é conveniente, mas literal.** Reaproveita o arquivo que os desenvolvedores já têm, só que aspas que funcionam localmente quebram em silêncio no cluster:
  ```bash
  # .env usado com Docker Compose
  API_KEY="abc123"   # Compose: abc123, kubectl: "abc123" (com as aspas)
  ```
- **`kubectl create` imperativo não combina com GitOps.** O Git não pode guardar Secrets em texto puro, então times com GitOps criptografam antes do commit (Sealed Secrets, SOPS) ou referenciam gerenciadores externos. A saída de `kubectl create ... --dry-run=client -o yaml` é um bom ponto de partida para qualquer um dos dois.
- **`immutable: true` troca flexibilidade por segurança e escala.** Rotacionar vira "criar `tenant-alpha-v2`, apontar o Deployment para ela, apagar a v1", o que tem mais passos, mas dá um rollout automático e um rollback limpo.

## Documentation Links

- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): tipos, `data` vs `stringData`, Secrets imutáveis, limite de tamanho.
- [Managing Secrets using kubectl](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kubectl/): `create secret generic`, edição e decodificação.
- [kubectl create secret generic](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_generic/): todas as flags, incluindo `--from-env-file`.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): RBAC, menor privilégio, criptografia.
- [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/): `EncryptionConfiguration` e provedores KMS.
