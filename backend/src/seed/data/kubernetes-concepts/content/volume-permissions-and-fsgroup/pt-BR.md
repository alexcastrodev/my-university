---
version: 1.0
updatedAt: 2026-09-26
title: "Permissões de Volume e fsGroup"
summary: "Por que containers não root recebem Permission denied em volumes novos, como o fsGroup funciona, quando ele não faz nada (hostPath), e o fsGroupChangePolicy."
---
## Objective

Muitas imagens rodam como usuário não root, e clusters endurecidos exigem isso. Quando um container desses monta um PersistentVolume recém-provisionado, o diretório raiz do volume muitas vezes pertence ao root com modo `0755`, e a primeira escrita falha com `Permission denied`. A resposta do Kubernetes é o `securityContext` do Pod: `runAsUser`, `runAsGroup` e, principalmente, **`fsGroup`**, que faz o kubelet entregar o volume a um grupo do qual o container faz parte. Se você precisa dele depende do backend de storage, e é por isso que um manifest que funciona num cluster falha em outro. Este conceito cobre como o `fsGroup` funciona, quando ele se aplica, e o que fazer quando não se aplica.

## Use Cases

- Um Pod em `CrashLoopBackOff` com `Permission denied` no diretório de dados logo depois de ganhar um PVC.
- Rodar workloads stateful com `runAsNonRoot` sob uma política `restricted` de Pod Security.
- Pods demorando para subir em volumes grandes por causa de mudanças recursivas de dono.
- Levar manifests de um laboratório (storage hostpath) para armazenamento em bloco de verdade.

## Deep Dive

### Quem é o container?

```bash
kubectl exec <pod> -- id
# uid=1000 gid=1000 groups=1000
docker image inspect <imagem> --format '{{.Config.User}}'
```

O `USER` da imagem decide o padrão; `securityContext.runAsUser`/`runAsGroup` o sobrescrevem. IDs numéricos é que importam, não nomes: o nó e o volume só enxergam números.

### fsGroup

```yaml
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    fsGroupChangePolicy: OnRootMismatch
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
      volumeMounts: [{name: data, mountPath: /data}]
  volumes:
    - name: data
      persistentVolumeClaim: {claimName: app-data}
```

Para tipos de volume que suportam gerenciamento de dono, o kubelet, antes de subir os containers:

1. muda o grupo dos arquivos do volume para o `fsGroup` (recursivamente),
2. adiciona permissões de leitura e escrita para o grupo e o bit setgid nos diretórios, para que arquivos novos herdem o grupo,
3. adiciona o `fsGroup` aos grupos suplementares de cada processo de container.

O processo agora consegue escrever, como membro do grupo, não importa qual UID seja dono do diretório. Verificado no k3s: com `fsGroup: 10001` e `runAsUser: 10001`, um arquivo criado num `emptyDir` aparece com dono `10001` e grupo `10001`, e o `id` lista `10001` entre os grupos.

### Quando o fsGroup não faz nada

O gerenciamento de dono depende do plugin de volume:

- **Aplica**: volumes baseados em bloco (discos de nuvem, Longhorn, Ceph RBD, volumes local, drivers CSI que declaram `fsGroupPolicy: File`), `emptyDir`, `configMap`/`secret`/`projected` (grupo aplicado aos arquivos).
- **Não aplica**: `hostPath`, e drivers CSI com `fsGroupPolicy: None`. NFS depende do driver e do servidor (root squashing costuma impedir).

O `hostpath-storage` do MicroK8s provisiona PersistentVolumes `hostPath`. Verificado no MicroK8s 1.35 com um Pod `busybox` rodando como UID 1000:

```
uid=1000 gid=1000 groups=1000
drwxrwxrwx    2 root     root          4096 /data
WRITE_OK
```

O diretório provisionado tem modo `0777`, então a escrita funciona com ou sem `fsGroup`, e com `fsGroup: 1000` o diretório continua `root:root`. Ele "simplesmente funciona" porque o diretório é gravável por todos, não por causa do `fsGroup`. O provisioner `local-path` do k3s se comporta do mesmo jeito.

É assim que acontece a surpresa clássica: um manifest funciona por meses num provisioner estilo hostpath, depois vai para um cluster com armazenamento em bloco de verdade, onde a raiz do volume ext4 novo é `root:root 0755` (mais um diretório `lost+found`), e a aplicação falha ao subir. Definir o `fsGroup` desde o primeiro dia torna o manifest portável.

### Inicialização lenta: fsGroupChangePolicy

O `chown`/`chmod` recursivo roda a cada montagem. Num volume com milhões de arquivos, ele pode atrasar a subida do container em minutos, tempo suficiente para estourar os limites da startup probe.

```yaml
securityContext:
  fsGroup: 1000
  fsGroupChangePolicy: OnRootMismatch   # pula a varredura se o diretório raiz já tem o grupo e o modo certos
```

`OnRootMismatch` verifica só o diretório de topo; `Always` (o padrão) percorre tudo a cada vez.

### Quando o software espera ser dono do diretório

Alguns softwares verificam o dono em vez das permissões e recusam um diretório de dados que não pertence a eles, ou um com permissões de grupo. Imagens desses softwares muitas vezes sobem como root, fazem `chown` no diretório e trocam para um usuário sem privilégios no entrypoint. Isso exige que o container suba como root, o que conflita com `runAsNonRoot`.

Opções para softwares assim:

- Manter o entrypoint root da imagem e endurecer em outros pontos (capabilities, seccomp, NetworkPolicies).
- Rodar como o usuário final e apontar o diretório de dados para um **subdiretório** que o próprio processo cria (por exemplo `/data/app`), de modo que o dono da raiz da montagem não importe desde que ela seja gravável, o que o `fsGroup` garante.
- Um `initContainer` rodando como root que faz `chown` no volume uma vez. Funciona, e é exatamente o que a Pod Security `restricted` proíbe, então prefira as opções acima.

### Diagnosticando

```bash
kubectl logs <pod> --previous | grep -iE 'permission|denied|read-only'
kubectl exec <pod> -- sh -c 'id; ls -ldn /data'
kubectl get pv <pv> -o jsonpath='{.spec.csi.driver}{.spec.hostPath.path}{"\n"}'   # qual backend?
```

Compare o UID e os grupos do processo com o dono, o grupo e o modo numéricos do diretório. Se o Pod cai rápido demais para um `exec`, sobrescreva temporariamente o comando com `sleep 3600` para inspecionar.

## Trade-offs

- **fsGroup vs storage gravável por todos.** O `fsGroup` dá acesso a exatamente um grupo e funciona em armazenamento em bloco de verdade; depender de diretórios `0777` só funciona em provisioners estilo hostpath e dá permissão de escrita a todo mundo no nó.
- **`Always` vs `OnRootMismatch`.** `Always` corrige desvios de dono dentro do volume a cada subida; `OnRootMismatch` sobe muito mais rápido em volumes grandes e confia que nada mudou os donos por baixo.
- **Entrypoints root vs não root em tudo.** Deixar que imagens que precisam subam como root é pragmático; não root estrito exige configuração específica de cada imagem, mas passa na Pod Security `restricted`.

## Documentation Links

- [Kubernetes docs: Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): `runAsUser`, `fsGroup`, `fsGroupChangePolicy`.
- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): quais tipos de volume suportam gerenciamento de dono.
- [Kubernetes CSI docs: Support for fsGroup](https://kubernetes-csi.github.io/docs/support-fsgroup.html): valores de `fsGroupPolicy` para drivers CSI.
- [MicroK8s: Hostpath storage](https://canonical.com/microk8s/docs/addon-hostpath-storage): como os volumes hostpath são provisionados.
