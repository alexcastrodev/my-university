---
version: 1.0
updatedAt: 2026-09-26
title: "Image Pull Secrets e Pull Policy"
summary: "Credenciais de registry com Secrets dockerconfigjson, anexadas por Pod ou por ServiceAccount, e como escolher uma imagePullPolicy honesta sobre o que está rodando."
---
## Objective

Antes de um container subir, o kubelet pede ao containerd para baixar a imagem. Dois campos do Pod controlam essa etapa: **`imagePullSecrets`**, que fornece credenciais do registry, e **`imagePullPolicy`**, que decide se o kubelet baixa ou não quando a imagem já está no nó. Errar neles produz ou `ImagePullBackOff` ou, pior, um Pod rodando em silêncio uma imagem antiga sob uma tag que você achava ter atualizado. Este conceito cobre criar uma Secret de registry, anexá-la a Pods ou a uma ServiceAccount, e escolher uma pull policy confiável e honesta sobre qual código está rodando.

## Use Cases

- Baixar imagens da aplicação de um registry privado (Harbor, GitLab, GHCR, Nexus).
- Fazer todo Pod de um namespace usar as credenciais do registry sem editar cada Deployment.
- Implantar `:latest` ou uma tag móvel e entender por que alguns nós rodam o build novo e outros o antigo.
- Rotacionar um token de registry.

## Deep Dive

### Criando uma Secret dockerconfigjson

```bash
kubectl -n team-a create secret docker-registry regcred \
  --docker-server=registry.internal:5000 \
  --docker-username=ci-puller \
  --docker-password="$REGISTRY_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
```

O resultado tem tipo `kubernetes.io/dockerconfigjson` e uma chave, `.dockerconfigjson`, com o mesmo JSON que o Docker escreve em `~/.docker/config.json`:

```json
{"auths":{"registry.internal:5000":{"username":"ci-puller","password":"...","auth":"Y2ktcHVsbGVyOi4uLg=="}}}
```

Dois jeitos que quebram com frequência:

- **`--docker-server` precisa bater exatamente com o host da referência da imagem**, incluindo a porta. Para o Docker Hub use `https://index.docker.io/v1/`.
- **Criá-la a partir do seu próprio `~/.docker/config.json`** (`--from-file=.dockerconfigjson=...`) só funciona se esse arquivo contém as credenciais. Com um credential helper (`"credsStore": "osxkeychain"`), ele não contém nenhuma.

No Kustomize, o equivalente é um `secretGenerator` com `type: kubernetes.io/dockerconfigjson` e `files: [.dockerconfigjson=config.json]`.

Use uma conta robô ou token dedicado e somente leitura (só pull), nunca um login pessoal.

### Anexando

Por Pod:

```yaml
spec:
  imagePullSecrets:
    - name: regcred
  containers:
    - name: app
      image: registry.internal:5000/demo/web-app:1.4.2
```

Por ServiceAccount, para que todo Pod que usa essa ServiceAccount (incluindo a `default`) a receba automaticamente:

```bash
kubectl -n team-a patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"regcred"}]}'
```

A Secret precisa existir **no namespace do Pod**. Uma `regcred` em `default` não faz nada para Pods em `team-a`, uma causa clássica de "funcionava no meu namespace".

### imagePullPolicy

| Policy | Comportamento |
|---|---|
| `IfNotPresent` | baixa só se o nó ainda não tem aquela referência de imagem |
| `Always` | consulta o registry a cada início de container; reaproveita camadas locais se o digest bate |
| `Never` | nunca baixa; falha se a imagem não estiver no nó |

Se você omitir, o Kubernetes define um padrão quando o Pod é criado:

- tag `:latest` ou sem tag: `Always`
- qualquer outra tag ou um digest: `IfNotPresent`

Confira o que o seu Pod recebeu de fato com `kubectl get pod <pod> -o jsonpath='{.spec.containers[*].imagePullPolicy}'`.

### A armadilha da tag móvel

Com `IfNotPresent` e uma tag que você sobrescreve (`1.4`, `develop`, `stable`), um nó que baixou a tag ontem continua rodando a imagem de ontem para sempre, e um nó novo baixa a de hoje. O spec do Pod é idêntico nos dois casos, então o Kubernetes não tem como perceber. `kubectl rollout restart` também não ajuda: a imagem está "presente".

Opções, da mais para a menos confiável:

1. **Tags imutáveis** (`1.4.2`, um SHA do Git) trocando a tag a cada deploy. O template do Pod muda, um rollout acontece, e `IfNotPresent` é correto e rápido.
2. **Digests** (`image: registry.internal:5000/demo/web-app@sha256:...`), que não podem mudar por definição.
3. **`Always`** com tag móvel. Todo início consulta o registry, então um restart pega a imagem nova, mas o registry vira uma dependência rígida de todo início de Pod: registry fora do ar significa nenhum restart e nenhum reagendamento depois de uma falha de nó.

`Always` não baixa de novo camadas inalteradas; o custo é a ida ao registry e a dependência de disponibilidade, não banda.

### Rotacionando as credenciais

O kubelet lê a Secret de pull na hora do pull. Atualize a Secret (mesmo nome) e o próximo pull usa o token novo; containers em execução não são afetados porque já foram baixados. Teste um pull logo depois de rotacionar, por exemplo escalando um Deployment em uma réplica, em vez de descobrir um token expirado durante uma falha de nó.

### Erros de pull em resumo

`ErrImagePull` é uma tentativa que falhou; `ImagePullBackOff` é o kubelet esperando antes da próxima (10s, dobrando até 5 minutos). O `kubectl describe pod` mostra o motivo real nos eventos: `401 Unauthorized` (credenciais), `not found` (tag), `x509: certificate signed by unknown authority` (confiança de CA no containerd), `no match for platform in manifest` (arquitetura). O conceito de troubleshooting de erros de pull passa por cada um.

## Trade-offs

- **Pull secrets por Pod vs por ServiceAccount.** Por Pod é explícito e visível no Deployment; anexar à ServiceAccount elimina repetição e faz workloads novos simplesmente funcionarem, ao custo de ficar invisível na leitura de um manifest.
- **`IfNotPresent` vs `Always`.** `IfNotPresent` torna o início dos Pods independente do registry; só é correto com tags imutáveis. `Always` tolera tags móveis e amarra todo início ao registry.
- **Tags vs digests.** Digests são os mais precisos e os menos legíveis; tags são legíveis e só são seguras quando o seu processo nunca as reutiliza.

## Documentation Links

- [Kubernetes docs: Images (image pull policy)](https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy): padrões e comportamento de cada policy.
- [Kubernetes docs: Pull an Image from a Private Registry](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/): criando e usando a `regcred`.
- [Kubernetes docs: Add ImagePullSecrets to a service account](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#add-imagepullsecrets-to-a-service-account): credenciais para o namespace inteiro.
- [kubectl create secret docker-registry](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_secret_docker-registry/): referência das flags.
