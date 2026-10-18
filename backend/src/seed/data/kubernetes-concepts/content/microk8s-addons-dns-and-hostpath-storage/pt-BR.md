---
version: 1.0
updatedAt: 2026-09-26
title: "Add-ons do MicroK8s: DNS e Hostpath Storage"
summary: "Habilitar add-ons, como o CoreDNS escolhe os resolvers upstream, e onde os volumes hostpath realmente ficam, incluindo capacidade não aplicada e reclaim Delete."
---
## Objective

Um nó MicroK8s novo é um Kubernetes cru: sem storage padrão, sem ingress, sem métricas e (surpreendentemente) sem RBAC. As funcionalidades são ligadas com add-ons, `microk8s enable <nome>`, e cada um aplica manifests ou um Helm chart no cluster. Dois deles são necessários para quase todo workload: `dns` (CoreDNS, para que os Pods resolvam Services e o mundo externo) e `hostpath-storage` (uma StorageClass padrão, para que PersistentVolumeClaims façam bind). Este conceito cobre os dois, incluindo onde os dados do hostpath realmente ficam no nó, seus limites, e como o CoreDNS decide quais servidores DNS upstream usar.

## Use Cases

- Fazer PersistentVolumeClaims de bancos de dados e outros workloads stateful fazerem bind num nó único.
- Corrigir Pods que resolvem Services do cluster mas não nomes externos (ou o contrário) numa rede corporativa com DNS interno.
- Saber qual diretório fazer backup, monitorar o uso de disco ou mover para um disco maior.
- Revisar quais add-ons um nó tem antes de confiar nele (`rbac` em especial).

## Deep Dive

### Listando e habilitando add-ons

```bash
microk8s status                     # add-ons habilitados e desabilitados
microk8s enable hostpath-storage
microk8s enable dns:10.0.0.53       # add-ons aceitam argumentos depois de dois-pontos
microk8s disable <nome>
```

Numa instalação nova da 1.35 (verificado em setembro de 2026), só `dns`, `ha-cluster`, `helm` e `helm3` vêm habilitados. Todo o resto, incluindo `rbac`, `hostpath-storage`, `ingress`, `metrics-server`, `cert-manager` e `observability`, fica desligado. Add-ons são só manifests: `microk8s enable ingress` cria um namespace e um DaemonSet que você vê com `kubectl`.

O add-on `rbac` merece um aviso separado: com ele desabilitado o API server roda com `--authorization-mode=AlwaysAllow`, então qualquer identidade autenticada, incluindo o token de ServiceAccount de cada Pod, pode fazer qualquer coisa. Veja o conceito de RBAC.

### DNS: o CoreDNS e seus upstreams

O add-on `dns` implanta o CoreDNS em `kube-system` atrás de um Service em `10.152.183.10`, e o kubelet é configurado com `--cluster-dns=10.152.183.10 --cluster-domain=cluster.local`, então o `/etc/resolv.conf` de todo Pod aponta para lá.

O CoreDNS responde `*.cluster.local` a partir da API do Kubernetes e encaminha todo o resto. O Corefile padrão na 1.35:

```
.:53 {
    errors
    health { lameduck 5s }
    ready
    log . { class error }
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
```

`forward . /etc/resolv.conf` significa "use os resolvers do nó". No Ubuntu esse arquivo é a visão do systemd-resolved (o kubelet é iniciado com `--resolv-conf=/run/systemd/resolve/resolv.conf` para evitar o stub `127.0.0.53`, que causaria um loop). Isso funciona até os resolvers do nó não serem o que os Pods precisam: um resolver de VPN, um DNS corporativo split-horizon, ou um nó cujo DNS vem do DHCP e muda.

Fixando forwarders explícitos:

```bash
microk8s disable dns
microk8s enable dns:10.0.0.53,10.0.0.54
```

O `disable` é necessário: o `dns` já vem habilitado numa instalação nova, e habilitar um add-on já habilitado só imprime `Addon core/dns is already enabled` e não muda nada (verificado: o Corefile manteve `forward . /etc/resolv.conf`).

Ou editando a configuração em produção, que o CoreDNS recarrega sozinho (plugin `reload`, cerca de 30 segundos):

```bash
microk8s kubectl -n kube-system edit configmap/coredns
#   forward . 10.0.0.53 10.0.0.54
```

Uma configuração dividida, com a zona interna indo para o DNS corporativo e o resto para resolvers públicos:

```
corp.example.com:53 {
    forward . 10.0.0.53
}
.:53 {
    ...
    forward . 1.1.1.1 8.8.8.8
}
```

Depurando de dentro do cluster:

```bash
kubectl run dnstest --rm -it --image=busybox:1.37 --restart=Never -- nslookup kubernetes.default
kubectl run dnstest --rm -it --image=busybox:1.37 --restart=Never -- nslookup example.com
kubectl -n kube-system logs deploy/coredns
```

Se nomes do cluster resolvem e externos falham, o problema é o destino do `forward`. Se nada resolve, olhe para o próprio CoreDNS (está rodando? alguma NetworkPolicy bloqueia a porta 53?).

### hostpath-storage: uma StorageClass baseada em diretório

```bash
microk8s enable hostpath-storage
kubectl get storageclass
```

```
NAME                          PROVISIONER            RECLAIMPOLICY   VOLUMEBINDINGMODE
microk8s-hostpath (default)   microk8s.io/hostpath   Delete          WaitForFirstConsumer
```

Ela é marcada como padrão, então um PVC sem `storageClassName` a usa. Para cada PVC o provisioner cria um diretório e um PersistentVolume do tipo `hostPath` apontando para ele:

```
/var/snap/microk8s/common/default-storage/<namespace>-<nome-do-pvc>-<nome-do-pv>
```

Verificado: um PVC `kdata` de 1 Gi em `default` virou `/var/snap/microk8s/common/default-storage/default-kdata-pvc-9063aedf-...`, um diretório com modo `0777` pertencente ao root, e o spec do PV é `hostPath: {path: ..., type: DirectoryOrCreate}`.

O que isso implica:

- **A capacidade não é aplicada.** Um Pod gravou 200 MiB num claim de 50 Mi sem erro nenhum; o claim continua reportando 50Mi. Um log descontrolado ou um diretório de dados crescendo pode encher o disco do nó, o que dispara a eviction por disk pressure do kubelet em tudo.
- **`Delete` apaga mesmo.** Apagar o PVC removeu o diretório e seus dados em segundos. Para bancos de dados, considere uma StorageClass com `reclaimPolicy: Retain`.
- **Preso ao nó.** Os dados não mudam de nó. Tudo bem com um nó, uma armadilha quando você adiciona nós.
- **`WaitForFirstConsumer`.** Um PVC fica `Pending` até um Pod usá-lo. Isso é normal, não um erro.
- **Ferramentas de backup podem ignorá-lo.** O file-system backup do Velero não suporta volumes `hostPath`.

### Um diretório ou reclaim policy customizados

Para colocar os volumes num disco dedicado, ou manter os dados depois que o PVC é apagado, crie sua própria StorageClass:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ssd-retain
provisioner: microk8s.io/hostpath
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
parameters:
  pvDir: /mnt/ssd/k8s-volumes
```

Só uma StorageClass deve ter a annotation `storageclass.kubernetes.io/is-default-class: "true"`.

Desabilitar o add-on mantém os dados por padrão; `microk8s disable hostpath-storage:destroy-storage` remove eles também.

## Trade-offs

- **hostpath-storage vs um sistema de storage de verdade.** Não exige configuração e é rápido (disco local), e é honesto sobre ser de nó único, sem quotas, sem snapshots e sem replicação. Para mais de um nó, olhe OpenEBS, Longhorn, `rook-ceph` ou um driver CSI de nuvem.
- **`Delete` vs `Retain`.** `Delete` mantém o disco limpo automaticamente; `Retain` protege você de um `kubectl delete namespace` apagando um banco de dados, ao custo de limpar PVs liberados à mão.
- **Resolvers do nó vs forwarders explícitos.** Seguir o `/etc/resolv.conf` se adapta quando o DNS do nó muda; forwarders explícitos são previsíveis e sobrevivem a mudanças de VPN ou DHCP, mas precisam ser atualizados quando a rede muda.

## Lab

Neste lab você recebe um `addons.sh` que configura os add-ons de um nó MicroK8s 1.35 recém-instalado e um `storageclass.yaml` para um banco de dados. O seu trabalho é fazer o DNS realmente encaminhar para os resolvers escolhidos e corrigir a StorageClass. A ideia central é que habilitar um add-on que já está ativo pode não mudar nada, e que a política de reclaim e o nome do provisionador decidem se os dados do banco sobrevivem à exclusão do claim.

**O cenário**

O teste instala o MicroK8s 1.35 em uma VM Ubuntu criada com Multipass, copia os seus arquivos, roda o script como root e depois sobe um Pod de banco de dados que usa a classe `db-retain`.

- `src/main/resources/addons.sh`: habilita `dns` com os forwarders `1.1.1.1,8.8.8.8`, habilita `hostpath-storage` e aplica a StorageClass.
- `src/main/resources/storageclass.yaml`: a classe `db-retain`, cujos volumes devem ficar em `/mnt/db-volumes` (um disco dedicado, na vida real) e que não pode apagar os dados quando o claim é removido.
- `src/test/resources/db.yaml`: dado pronto. Um PVC `db-data` na classe `db-retain` e um Pod que escreve `keep-me` em um arquivo `marker` no volume.

**O que você vai fazer, passo a passo**

1. **Rodar e ler a falha.** Rode os testes antes de editar para ver o que o cluster realmente faz.
2. **Fazer o DNS mudar (TODO-00).** O add-on `dns` já vem habilitado em uma instalação nova, então verifique o que aquela linha realmente altera no ConfigMap do CoreDNS (o `Corefile`). O teste espera `forward . 1.1.1.1 8.8.8.8` e um Pod resolvendo `example.com`.
3. **Corrigir a StorageClass (TODO-01).** Há três coisas no objeto que não batem com a descrição do arquivo. Compare cada campo com o que o comentário pede: o diretório dos volumes, a retenção dos dados após a exclusão do claim e o fato de que `microk8s-hostpath` deve continuar sendo a única classe padrão.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/microk8s-addons-dns-and-hostpath-storage test` passa por inteiro: o `Corefile` encaminha para `1.1.1.1 8.8.8.8` e um Pod resolve nomes externos, existe exatamente uma StorageClass padrão (`microk8s-hostpath`), e depois de apagar o Pod e o claim o PersistentVolume fica `Released` com o arquivo `marker` ainda no disco. Você deve conseguir explicar a diferença entre `Delete` e `Retain` e por que um volume `Released` ainda não pode ser reutilizado automaticamente.

**Desafios opcionais**

- **TODO-02:** escreva 200 MiB em um claim de 50 Mi na classe `db-retain`. O que acontece, e o que isso significa para o disco do nó?

**Pré-requisitos:** [Multipass](https://canonical.com/multipass) instalado (a VM é apagada no fim), o artigo "MicroK8s Add-ons: DNS and Hostpath Storage", Java e Maven.

**Como rodar:** clone o repositório e, na raiz, rode `mvn -pl kubernetes-concepts/microk8s-addons-dns-and-hostpath-storage test`. Cada execução leva alguns minutos. Você edita o `addons.sh` e o `storageclass.yaml`, e os comentários TODO mostram onde mexer.

## Documentation Links

- [MicroK8s: Add-ons](https://canonical.com/microk8s/docs/addons): lista completa e o que cada um instala.
- [MicroK8s: DNS add-on](https://canonical.com/microk8s/docs/addon-dns): forwarders customizados e edição do ConfigMap do CoreDNS.
- [MicroK8s: Hostpath storage](https://canonical.com/microk8s/docs/addon-hostpath-storage): caminho padrão, `pvDir`, limitações.
- [Kubernetes docs: Customizing DNS Service](https://kubernetes.io/docs/tasks/administer-cluster/dns-custom-nameservers/): Corefile, stub domains, upstreams.
- [Kubernetes docs: Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/): classe padrão, reclaim policy, binding mode.
