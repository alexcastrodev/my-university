---
version: 1.0
updatedAt: 2026-09-26
title: "Volumes e Conflitos de Montagem"
summary: "Volumes emptyDir, configMap, secret e projected, e os erros de montagem que escondem arquivos da imagem, congelam conteúdo de subPath ou falham com StartError."
---
## Objective

O sistema de arquivos de um container vem da imagem e some junto com o container. **Volumes** adicionam diretórios com outro ciclo de vida e outra origem: espaço temporário compartilhado entre containers (`emptyDir`), configuração e credenciais vindas da API (`configMap`, `secret`, `projected`), ou armazenamento durável (`persistentVolumeClaim`). Cada volume é declarado uma vez no Pod e montado nos containers com `volumeMounts`. A maioria dos bugs de volume é bug de montagem: uma montagem que esconde os arquivos da própria imagem, um arquivo montado com `subPath` que nunca atualiza, ou duas montagens que colidem e impedem o container de subir. Este conceito cobre os tipos de volume comuns e essas colisões, incluindo um `StartError` verificado.

## Use Cases

- Um diretório temporário ou de cache para uma aplicação rodando com sistema de arquivos raiz somente leitura.
- Montar um `application.yaml` ou `nginx.conf` inteiro a partir de uma ConfigMap.
- Combinar várias Secrets e ConfigMaps num único diretório.
- Diagnosticar `StartError`/`RunContainerError` com `read-only file system` na mensagem.

## Deep Dive

### Declarando e montando

```yaml
spec:
  containers:
    - name: app
      volumeMounts:
        - {name: tmp,     mountPath: /tmp}
        - {name: config,  mountPath: /etc/app, readOnly: true}
        - {name: secrets, mountPath: /etc/secrets, readOnly: true}
  volumes:
    - name: tmp
      emptyDir: {}
    - name: config
      configMap: {name: app-config}
    - name: secrets
      projected:
        sources:
          - secret: {name: db-credentials}
          - secret: {name: api-keys}
```

### Os tipos de volume do dia a dia

**`emptyDir`**: criado vazio quando o Pod sobe, apagado quando o Pod é apagado (sobrevive a restarts de container). Compartilhado por todos os containers do Pod. Usa o disco do nó por padrão, contado como armazenamento efêmero. Com `medium: Memory` ele é um tmpfs, e o conteúdo conta no limit de **memória** do container. Verificado: um `emptyDir` com `medium: Memory, sizeLimit: 64Mi` é montado como um tmpfs de 64 MiB, e gravar 80 MiB falha com `No space left on device` em vez de crescer em silêncio.

**`configMap` / `secret`**: cada chave vira um arquivo (use `items` para escolher chaves e renomeá-las). Montados somente leitura, atualizados no lugar pelo kubelet cerca de um minuto depois que o objeto muda (não com `subPath`, veja abaixo). Volumes de Secret são sempre tmpfs.

**`projected`**: junta várias fontes `secret`, `configMap`, `downwardAPI` e `serviceAccountToken` num único diretório. Chaves com o mesmo nome colidem em silêncio e a última fonte vence; a seção de Secrets tem um conceito inteiro sobre isso.

**`persistentVolumeClaim`**: armazenamento durável que sobrevive aos Pods, coberto no conceito de PersistentVolumes.

**`hostPath`**: um diretório do nó. Poderoso e perigoso (um Pod consegue ler arquivos do nó), bloqueado pelo nível `baseline` de Pod Security. Evite em manifests de aplicação; provisioners de storage o usam internamente.

### Conflito 1: uma montagem esconde o que a imagem tinha

Um volume montado num diretório substitui todo o conteúdo dele para aquele container. Verificado com `nginx` e uma ConfigMap contendo só `application.yaml` montada em `/etc/nginx`:

```
$ ls /etc/nginx
application.yaml
$ ls /etc/nginx/conf.d
ls: /etc/nginx/conf.d: No such file or directory
```

O `nginx.conf`, o `conf.d` e o `mime.types` da imagem sumiram. O mesmo erro em `/app` esconde o binário da aplicação, em `/etc/ssl` esconde o bundle de CAs da imagem. Monte num diretório dedicado, ou monte um único arquivo com `subPath`.

### Conflito 2: subPath funciona uma vez e nunca atualiza

O `subPath` monta uma entrada de um volume num caminho exato, deixando o resto do diretório intacto:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/nginx/application.yaml
    subPath: application.yaml
```

Verificado: `/etc/nginx` mantém `conf.d`, `fastcgi.conf` e o resto, e o `application.yaml` é adicionado. O preço: **montagens com subPath são uma fotografia**. Quando a ConfigMap ou a Secret muda, montagens de diretório inteiro são atualizadas, montagens com subPath nunca, até o Pod ser recriado. Para segredos que são rotacionados, esse é um bug silencioso.

### Conflito 3: mountPath idêntico

Duas montagens no mesmo caminho são rejeitadas antes mesmo de o Pod existir:

```
The Pod "dupmount" is invalid: spec.containers[0].volumeMounts[1].mountPath:
Invalid value: "/cfg": must be unique
```

Esse é fácil. O próximo não.

### Conflito 4: montagens aninhadas dentro de um volume somente leitura

Uma montagem **dentro** de outra funciona quando o runtime consegue criar o diretório do ponto de montagem. Com um volume pai somente leitura, ele não consegue. O caso real mais comum é o token da ServiceAccount, que o Kubernetes monta em `/var/run/secrets/kubernetes.io/serviceaccount`, combinado com uma Secret montada somente leitura em `/run/secrets` numa imagem onde `/var/run` é um symlink para `/run` (todas as imagens baseadas em Debian e Ubuntu, o que inclui muitas imagens oficiais de runtimes de linguagem).

Verificado no k3s v1.36 com `ubuntu:24.04`:

```
NAME             READY   STATUS              RESTARTS
overlap-ubuntu   0/1     RunContainerError   2

lastState.terminated.reason: StartError
message: ... error mounting ".../kube-api-access-2z2l6" to rootfs at
"/var/run/secrets/kubernetes.io/serviceaccount": create mountpoint ... mkdirat
.../rootfs/run/secrets/kubernetes.io: read-only file system
```

Exit code 128, o container nunca rodou, e o `kubectl logs` fica vazio porque não existe processo. O mesmo manifest com `busybox` sobe normalmente (lá não há o symlink), e é por isso que passa num teste rápido e falha com a imagem real da aplicação.

Correções: montar a Secret em outro lugar (`/etc/secrets`, `/run/secrets/app`), ou definir `automountServiceAccountToken: false` se a aplicação não chama a API do Kubernetes (verificado: o Pod então sobe), ou declarar o token você mesmo num volume `projected` num caminho da sua escolha.

A regra geral: quando um container falha com `StartError` e uma mensagem sobre `mkdirat`, `mountpoint` ou `read-only file system`, liste todo `mountPath` (incluindo os que o Kubernetes injeta, visíveis em `kubectl get pod -o yaml`) e procure um aninhado dentro de outro.

### Inspecionando montagens

```bash
kubectl get pod <pod> -o jsonpath='{range .spec.containers[*].volumeMounts[*]}{.mountPath}{"\t"}{.name}{"\t"}{.readOnly}{"\n"}{end}'
kubectl exec <pod> -- mount | grep -E 'secrets|config'
kubectl describe pod <pod>     # seções Mounts: e Volumes:
```

## Trade-offs

- **Montar diretório vs subPath.** Montagens de diretório atualizam no lugar e escondem o diretório de destino; o subPath preserva o diretório e congela o conteúdo.
- **emptyDir em disco vs em memória.** Disco é barato e mais lento; memória é rápida e disputa com a aplicação o limit de memória dela.
- **Token de ServiceAccount montado automaticamente vs nenhum.** Deixar ligado é inofensivo para a maioria das aplicações, mas ocupa `/var/run/secrets`, dá credenciais da API ao container e causa a falha de montagem aninhada acima. Desligar por padrão é um passo razoável de hardening.

## Documentation Links

- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): todos os tipos de volume, `subPath`, `readOnly`.
- [Kubernetes docs: Ephemeral Volumes](https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/): `emptyDir`, dimensionamento, meio em memória.
- [Kubernetes docs: Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/): fontes combinadas e a fonte do token de ServiceAccount.
- [Kubernetes docs: ConfigMaps (mounted ConfigMaps are updated automatically)](https://kubernetes.io/docs/concepts/configuration/configmap/#mounted-configmaps-are-updated-automatically): comportamento de atualização e a exceção do subPath.
