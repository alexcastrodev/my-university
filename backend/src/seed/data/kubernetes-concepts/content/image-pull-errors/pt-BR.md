---
version: 1.0
updatedAt: 2026-09-26
title: "ImagePullBackOff e ErrImagePull"
summary: "As mensagens exatas para tag inexistente, credenciais negadas, CA não confiável, host que não resolve e arquitetura errada, e a correção de cada uma."
---
## Objective

`ErrImagePull` e `ImagePullBackOff` significam que o kubelet não conseguiu a imagem; o segundo só acrescenta que ele está esperando antes de tentar de novo. A coluna de status esconde a causa, mas a mensagem do evento diz com precisão, e só existe um punhado de causas: a imagem ou a tag não existe, o registry recusa as credenciais, o certificado TLS do registry não é confiável, o nome não resolve, ou a imagem não tem build para a arquitetura de CPU do nó. Este conceito mostra a mensagem exata de cada uma, verificada num cluster real, e a correção correspondente.

## Use Cases

- Um deploy travado com Pods em `ImagePullBackOff`.
- Mover imagens para um registry privado com CA própria.
- Rodar em nós ARM (Raspberry Pi, VMs em Apple Silicon, Graviton) com imagens construídas só para amd64.
- Distinguir uma queda do registry de um erro de configuração.

## Deep Dive

### Pegue a mensagem real

```bash
kubectl -n team-a describe pod web-xyz | sed -n '/Events:/,$p'
kubectl -n team-a get events --field-selector involvedObject.name=web-xyz,type=Warning
```

O evento `Failed` contém o erro devolvido pelo containerd. A sequência é sempre `Pulling` -> `Failed: ErrImagePull` -> `BackOff` (nova tentativa depois de 10s, 20s, 40s... até 5 minutos).

### As causas e suas mensagens

Todas verificadas no k3s v1.36 (containerd 2.x), nó arm64.

**Tag ou repositório não existe**

```
failed to resolve reference "docker.io/library/nginx:9.99-does-not-exist":
docker.io/library/nginx:9.99-does-not-exist: not found
```

Confira a tag exata no registry (`crane ls`, `skopeo list-tags`, ou a interface do registry). Causas típicas: um job de CI que não fez push, um erro de digitação, uma tag apagada por uma política de retenção.

**Sem acesso (credenciais faltando ou erradas)**

```
failed to authorize: failed to fetch anonymous token: unexpected status from GET request to
https://ghcr.io/token?scope=repository%3A...%3Apull&service=ghcr.io: 403 Forbidden
```

O `anonymous token` entrega: nenhuma credencial foi enviada. Registries também respondem `401 Unauthorized` ou `denied` para credenciais erradas, e muitos respondem "not found" para repositórios privados, para não revelar que existem. Confira:

```bash
kubectl -n team-a get pod web-xyz -o jsonpath='{.spec.imagePullSecrets}'
kubectl -n team-a get secret regcred -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d
```

A Secret precisa estar no namespace do Pod, ser do tipo `kubernetes.io/dockerconfigjson`, e a chave em `auths` precisa bater exatamente com o host do registry (incluindo a porta). Veja o conceito de image pull secrets.

**Certificado do registry não confiável**

Um registry com certificado autoassinado ou de CA privada:

```
failed to do request: Head "https://172.17.0.3:5000/v2/demo/web-app/manifests/1.0":
tls: failed to verify certificate: x509: certificate signed by unknown authority
```

A confiança é configurada no containerd **de cada nó**, não no Kubernetes. No MicroK8s: `/var/snap/microk8s/current/args/certs.d/<host:porta>/hosts.toml` com `ca = ".../ca.crt"`, e depois reinicie o MicroK8s (veja o conceito de containerd). No k3s: `/etc/rancher/k3s/registries.yaml`. `imagePullSecrets` não resolve isso.

**Nome não resolve**

```
failed to do request: Head "https://registry.example.invalid/v2/app/manifests/1.0":
dial tcp: lookup registry.example.invalid: no such host
```

O **nó** resolve nomes de registry com o seu próprio DNS (o containerd não usa o CoreDNS), então um nome de Service interno como `registry.tools.svc.cluster.local` não funciona como host de imagem. Use um nome que o nó resolva, ou um endereço alcançável pelo nó (um NodePort, `localhost:32000` para o add-on de registry do MicroK8s).

**Sem imagem para a arquitetura do nó**

```
failed to pull and unpack image "docker.io/amd64/busybox:1.37":
no match for platform in manifest: not found
```

A imagem existe mas não tem variante para a plataforma do nó (aqui: uma imagem só amd64 num nó arm64). Veja o que uma imagem oferece:

```bash
docker buildx imagetools inspect registry.example.com/demo/web-app:1.4.2
# lista linux/amd64, linux/arm64, ...
```

Corrija no build com um build multiplataforma (`docker buildx build --platform linux/amd64,linux/arm64 --push`). Emulação não é uma correção em tempo de execução no Kubernetes. Uma falha parecida acontece quando uma imagem de plataforma única **sem** índice é baixada na arquitetura errada: o pull funciona e o container morre com `exec format error`.

**Rate limits**

O Docker Hub limita pulls anônimos e gratuitos. A mensagem contém `429 Too Many Requests` ou `toomanyrequests`. Autentique os pulls, use um mirror pull-through (entrada de mirror no `hosts.toml`), ou hospede as imagens de que você depende.

### Verificações que economizam tempo

- `kubectl get pod -o jsonpath='{.spec.containers[*].image}'`: a imagem que o Pod realmente pede, depois do render do Kustomize ou do Helm, nem sempre é a que você imagina.
- Tente o pull no próprio nó: `sudo microk8s ctr images pull <imagem>` (adicione `--user` para credenciais). Se falhar lá, o problema é do nó (DNS, CA, proxy, arquitetura), não do Kubernetes.
- `imagePullPolicy: Always` faz todo restart depender do registry. Durante uma queda do registry, Pods com `IfNotPresent` e imagem já baixada continuam reiniciando sem problema.

## Trade-offs

- **Imagens base públicas vs um mirror privado.** Imagens públicas são convenientes e sujeitas a rate limits, remoção e quedas; espelhá-las no seu registry adiciona um componente e remove essas dependências externas.
- **Builds de arquitetura única vs multiplataforma.** Builds de arquitetura única são mais rápidos; builds multiplataforma permitem que a mesma tag rode em nós amd64 e arm64 sem surpresas.
- **Confiança por nó vs certificados públicos.** Uma CA privada exige configurar cada nó; um certificado publicamente confiável no registry não exige nada.

## Documentation Links

- [Kubernetes docs: Images](https://kubernetes.io/docs/concepts/containers/images/): pull policy, registries privados, imagens multiarquitetura.
- [Kubernetes docs: Debug Pods (image pull issues)](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/): diagnosticando Pods presos no pull.
- [MicroK8s: Working with a private registry](https://canonical.com/microk8s/docs/registry-private): confiando numa CA com `hosts.toml`.
- [Docker docs: Multi-platform builds](https://docs.docker.com/build/building/multi-platform/): construindo imagens para várias arquiteturas.
- [k3s docs: Private Registry Configuration](https://docs.k3s.io/installation/private-registry): `registries.yaml`.
