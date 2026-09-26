---
version: 1.0
updatedAt: 2026-09-26
title: "containerd do MicroK8s e Confiança em Registry Privado"
summary: "Onde o MicroK8s guarda as flags dos componentes, e como fazer o containerd dele confiar num registry com CA privada via certs.d/<host:porta>/hosts.toml."
---
## Objective

Toda imagem que um Pod roda é baixada pelo containerd, não pelo Kubernetes. Quando a imagem está num registry privado cujo certificado TLS é assinado pela sua própria CA, o pull falha com `x509: certificate signed by unknown authority` por mais correto que esteja o seu `imagePullSecrets`, porque a confiança é configurada no containerd do nó. O MicroK8s traz o seu próprio containerd com os seus próprios arquivos de configuração, separados de qualquer containerd ou Docker do host. Este conceito cobre onde ficam esses arquivos, como fazer o containerd confiar num registry via `certs.d/<host:porta>/hosts.toml`, e como aplicar a mudança.

## Use Cases

- Baixar imagens de um Harbor, Nexus, GitLab ou `registry:2` interno com a CA da empresa.
- Usar um registry só HTTP num laboratório (`localhost:32000` do add-on `registry`).
- Adicionar um mirror pull-through do Docker Hub para evitar rate limits.
- Ligar o log de debug do containerd para entender uma falha de pull.

## Deep Dive

### Onde o MicroK8s guarda a configuração dos serviços

Todas as flags dos componentes ficam em arquivos simples em `/var/snap/microk8s/current/args/` (`${SNAP_DATA}/args`), legíveis só pelo root:

```
/var/snap/microk8s/current/args/
  kube-apiserver          kubelet            kube-proxy
  kube-scheduler          kube-controller-manager
  containerd              # flags de linha de comando do containerd
  containerd-template.toml  # template renderizado em containerd.toml
  containerd-env          # ambiente (ex.: HTTP_PROXY para pulls)
  certs.d/                # configuração de host por registry
  ...
```

O arquivo de flags do containerd na 1.35:

```
--config ${SNAP_DATA}/args/containerd.toml
--root ${SNAP_COMMON}/var/lib/containerd
--state ${SNAP_COMMON}/run/containerd
--address ${SNAP_COMMON}/run/containerd.sock
```

E o template aponta a configuração de registries do CRI para `certs.d`:

```toml
config_path = "${SNAP_DATA}/args/certs.d"
```

Depois de editar qualquer arquivo de args, reinicie os serviços:

```bash
sudo snap restart microk8s
# ou
microk8s stop && microk8s start
```

Num nó único isso reinicia o control plane inteiro e o containerd; os containers em execução continuam rodando, mas a API fica indisponível por um tempo, então faça numa janela de manutenção. Exemplo, log de debug do containerd:

```bash
echo '-l=debug' | sudo tee -a /var/snap/microk8s/current/args/containerd
sudo snap restart microk8s
sudo journalctl -u snap.microk8s.daemon-containerd -f
```

### certs.d: um diretório por registry

Cada registry ganha um diretório com o nome exato da parte de host da referência da imagem, **incluindo a porta**:

```
image: registry.internal:5000/demo/web-app:1.4.2
       └────────────────────┘
       /var/snap/microk8s/current/args/certs.d/registry.internal:5000/hosts.toml
```

Uma instalação nova já tem dois, `docker.io` e `localhost:32000`:

```toml
# certs.d/docker.io/hosts.toml
server = "https://docker.io"

[host."https://registry-1.docker.io"]
  capabilities = ["pull", "resolve"]
```

Para um registry assinado por uma CA privada:

```bash
sudo mkdir -p /var/snap/microk8s/current/args/certs.d/registry.internal:5000
sudo cp company-root-ca.crt /var/snap/microk8s/current/args/certs.d/registry.internal:5000/ca.crt
```

```toml
# certs.d/registry.internal:5000/hosts.toml
server = "https://registry.internal:5000"

[host."https://registry.internal:5000"]
  capabilities = ["pull", "resolve"]
  ca = "/var/snap/microk8s/current/args/certs.d/registry.internal:5000/ca.crt"
```

Para um registry só HTTP (apenas em laboratório):

```toml
server = "http://10.0.0.20:32000"

[host."http://10.0.0.20:32000"]
  capabilities = ["pull", "resolve"]
```

`skip_verify = true` também existe; ele remove a proteção que o TLS dá e não deveria sobreviver além da depuração.

Depois reinicie o MicroK8s e teste um pull direto com o `ctr` embutido, sem passar pelo Kubernetes:

```bash
sudo microk8s ctr images pull --hosts-dir /var/snap/microk8s/current/args/certs.d \
  registry.internal:5000/demo/web-app:1.4.2
```

### Erros comuns

- **Porta faltando no nome do diretório.** `certs.d/registry.internal/` não casa com `registry.internal:5000/...`. O nome do diretório é o host do registry como escrito na referência da imagem.
- **Confiar na CA só no host.** `update-ca-certificates` no Ubuntu ajuda o `curl` e o Docker do host; o containerd do MicroK8s usa o seu próprio `certs.d`. Os dois podem ser necessários, são independentes.
- **Intermediária faltando.** Se o registry serve só o certificado folha, o `ca.crt` precisa conter a cadeia até a raiz (intermediária + raiz concatenadas).
- **Editar o `containerd.toml`.** Ele é gerado a partir do `containerd-template.toml`; edite o template (ou melhor, use `certs.d`) ou sua mudança some.
- **Guias antigos.** O MicroK8s 1.22 e anteriores configuravam registries como `registry.mirrors` dentro do template. Da 1.23 em diante, o mecanismo é o `certs.d`.
- **Credenciais aqui.** O `hosts.toml` é para confiança e endpoints. Credenciais do registry ficam numa Secret `kubernetes.io/dockerconfigjson` referenciada por `imagePullSecrets`; veja o conceito de pull de imagens.

### Proxies

Se o nó acessa registries através de um proxy HTTP, o containerd precisa das variáveis de proxy no `containerd-env`:

```
HTTPS_PROXY=http://proxy.example.com:3128
NO_PROXY=10.1.0.0/16,10.152.183.0/24,127.0.0.1,localhost,registry.internal
```

Esquecer o `NO_PROXY` para os CIDRs de Pods e Services (`10.1.0.0/16` e `10.152.183.0/24` por padrão) manda o tráfego interno do cluster para o proxy.

## Trade-offs

- **Confiança por nó vs objetos do cluster.** O `certs.d` é configuração de nó: com três nós, os três precisam do arquivo, e é por isso que ele pertence ao script de bootstrap e não a um passo de runbook.
- **CA privada vs certificado público no registry.** Um certificado público (por exemplo Let's Encrypt via DNS-01) elimina qualquer configuração de nó, ao custo de o registry ter um nome DNS público.
- **Custo do restart.** Toda mudança exige um restart do MicroK8s. Agrupe as mudanças de registry e teste com `ctr` antes de reiniciar.

## Documentation Links

- [MicroK8s: Working with a private registry](https://canonical.com/microk8s/docs/registry-private): exemplos de `hosts.toml`, CA, restart.
- [MicroK8s: Configuring services](https://canonical.com/microk8s/docs/configuring-services): arquivos de args de cada componente.
- [containerd: Registry host configuration](https://github.com/containerd/containerd/blob/main/docs/hosts.md): referência completa do `hosts.toml` (`ca`, `client`, `skip_verify`, mirrors).
- [MicroK8s: Built-in registry](https://canonical.com/microk8s/docs/registry-built-in): o add-on `registry` em `localhost:32000`.
