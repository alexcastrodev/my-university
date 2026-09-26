---
version: 1.0
updatedAt: 2026-09-26
title: "PersistentVolumes, Claims e StorageClasses"
summary: "Modos de binding, o Pending normal e o quebrado, access modes, reclaim policies, e como verificar que os dados sobrevivem a restarts de Pod e de nó."
---
## Objective

Dados que precisam sobreviver a um Pod (um banco de dados, o log de um broker, arquivos enviados) moram num **PersistentVolume** (PV), um pedaço de armazenamento registrado no cluster. As aplicações nunca referenciam PVs diretamente; elas pedem armazenamento com um **PersistentVolumeClaim** (PVC), e uma **StorageClass** diz ao Kubernetes como criar um PV compatível sob demanda. Este conceito cobre os três objetos, o ciclo de binding, as duas situações de `Pending` que você vai ver (uma normal, uma quebrada), e como verificar que os dados realmente persistem a restarts de Pod e de nó.

## Use Cases

- Dar a bancos de dados, filas e dashboards um diretório de dados que sobreviva a redeploys.
- Entender um Pod preso em `Pending` com `pod has unbound immediate PersistentVolumeClaims`.
- Escolher access modes e reclaim policies para um banco de dados.
- Provar, antes da produção, que um restart não apaga os dados.

## Deep Dive

### Os três objetos

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: db-data, namespace: shared}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: microk8s-hostpath      # omita para usar a StorageClass padrão
  resources:
    requests:
      storage: 20Gi
```

```yaml
volumes:
  - name: data
    persistentVolumeClaim: {claimName: db-data}
```

- **PVC** (de namespace): "preciso de 20 GiB, montados para leitura e escrita por um nó, da classe X".
- **StorageClass** (de escopo de cluster): um provisioner mais parâmetros, reclaim policy e binding mode.
- **PV** (de escopo de cluster): o volume de fato, criado pelo provisioner (provisionamento dinâmico) ou por um admin (estático). Ligado um para um a um PVC.

```bash
kubectl get storageclass
kubectl -n shared get pvc
kubectl get pv
```

### Access modes

| Modo | Significado |
|---|---|
| `ReadWriteOnce` (RWO) | leitura e escrita por um único **nó** (vários Pods nesse nó podem montá-lo) |
| `ReadWriteOncePod` (RWOP) | leitura e escrita por um único **Pod** no cluster inteiro |
| `ReadOnlyMany` (ROX) | somente leitura por vários nós |
| `ReadWriteMany` (RWX) | leitura e escrita por vários nós (NFS, CephFS, Longhorn RWX...) |

RWO ser por nó é uma armadilha real em clusters de nó único: dois Pods de um Deployment de banco, durante um rolling update, conseguem montar o mesmo volume RWO. Use `strategy: Recreate` para workloads stateful de instância única, ou `ReadWriteOncePod` onde o driver suporta (provisioners estilo hostpath em geral não aplicam modo nenhum).

### Binding modes e o Pending normal

Uma StorageClass com `volumeBindingMode: WaitForFirstConsumer` (`microk8s-hostpath` no MicroK8s, `local-path` no k3s) não cria o PV até que um Pod que usa o PVC seja agendado, para poder colocar o volume no nó desse Pod:

```
$ kubectl get pvc
NAME            STATUS    VOLUME   CAPACITY   STORAGECLASS
db-data         Pending                       microk8s-hostpath
$ kubectl describe pvc db-data
  Normal  WaitForFirstConsumer  waiting for first consumer to be created before binding
```

Isso é esperado. O PVC faz bind assim que um Pod o usa.

O binding `Immediate` cria o PV na hora, onde o provisioner quiser. Com armazenamento local de nó, isso pode colocar o volume num nó onde o Pod não consegue rodar; o `WaitForFirstConsumer` evita isso.

### O Pending quebrado: sem StorageClass

Um PVC que cita uma StorageClass inexistente, ou que não tem `storageClassName` num cluster sem classe padrão, nunca é provisionado. O Pod que o usa não consegue ser agendado. Verificado no k3s:

```
$ kubectl get pvc nosc
NAME   STATUS    STORAGECLASS
nosc   Pending   missing

$ kubectl describe pod pvcpod
  Warning  FailedScheduling  default-scheduler  0/1 nodes are available:
  pod has unbound immediate PersistentVolumeClaims. not found
```

Verificações, em ordem:

```bash
kubectl get storageclass                              # existe alguma? qual é a (default)?
kubectl -n shared get pvc db-data -o jsonpath='{.spec.storageClassName}{"\n"}'
kubectl -n shared describe pvc db-data                # eventos do provisioner
```

Num nó MicroK8s novo a causa usual é simplesmente que o `hostpath-storage` nunca foi habilitado. Note que `storageClassName` é imutável: um PVC criado com a classe errada precisa ser apagado e recriado. E `storageClassName: ""` (string vazia) significa explicitamente "sem classe, faça bind só com um PV pré-criado", o que é diferente de omitir o campo.

### Reclaim policy

Quando um PVC é apagado, a `persistentVolumeReclaimPolicy` do PV decide o que acontece com os dados:

- `Delete` (padrão no provisionamento dinâmico): o PV e o armazenamento por baixo são apagados. Verificado no MicroK8s: o diretório do hostpath sumiu segundos depois do `kubectl delete pvc`.
- `Retain`: o PV fica `Released` e os dados ficam. Reusá-lo exige limpeza manual (remover `spec.claimRef`) e um novo bind.

Para bancos de dados, use uma StorageClass com `Retain`, ou altere o PV depois de criado:

```bash
kubectl patch pv <nome-do-pv> -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

Apagar um namespace apaga os PVCs dele, então com `Delete` um `kubectl delete namespace shared` também apaga os arquivos do banco. O finalizer `kubernetes.io/pvc-protection` só adia a remoção enquanto algum Pod ainda usa o PVC; não a impede.

### Verificando a persistência

Faça isso uma vez para cada novo arranjo de storage, antes de confiar nele:

```bash
# 1. grave um marcador
kubectl -n shared exec deploy/db -- sh -c 'echo persisted-$(date +%s) > /data/marker'

# 2. restart de Pod: apague o Pod e deixe o Deployment recriá-lo
kubectl -n shared delete pod -l app=db
kubectl -n shared exec deploy/db -- cat /data/marker

# 3. restart de nó (nó único: downtime planejado)
sudo snap restart microk8s          # ou reinicie a máquina
kubectl -n shared exec deploy/db -- cat /data/marker
```

Verificado no MicroK8s: um marcador gravado num PVC hostpath sobreviveu tanto a um `snap restart microk8s` quanto a apagar o Pod e montar o mesmo claim num Pod novo.

O que procurar é um volume que **não** é persistente de verdade: um erro de digitação no `mountPath` (a aplicação grava num caminho que não é a montagem), uma diretiva `VOLUME` da imagem que cria um diretório anônimo em outro lugar, ou um diretório de dados configurado (ou alterado por uma versão nova da imagem) para um caminho fora da montagem. Confira o caminho de dados documentado da imagem sempre que atualizá-la. Se o marcador sobrevive mas os dados da aplicação não, a aplicação grava em outro lugar.

### Redimensionando

Se a StorageClass tem `allowVolumeExpansion: true`, aumente `spec.resources.requests.storage` no PVC e o driver cresce o volume (às vezes só depois de um restart do Pod). Reduzir nunca é suportado. A `microk8s-hostpath` reporta `ALLOWVOLUMEEXPANSION false` e, de qualquer forma, não aplica tamanhos.

## Trade-offs

- **Provisionamento dinâmico vs estático.** O dinâmico não exige trabalho de admin por volume; PVs estáticos dão controle total sobre onde os dados moram (útil para dados pré-existentes ou discos específicos).
- **`Delete` vs `Retain`.** `Delete` mantém o armazenamento arrumado e torna apagamentos acidentais fatais; `Retain` torna acidentes recuperáveis e deixa a limpeza com você.
- **Armazenamento local do nó vs em rede.** Discos locais são rápidos e simples e prendem os dados a um nó; armazenamento em rede (Ceph, Longhorn, discos de nuvem) sobrevive à perda do nó e custa latência e complexidade operacional.

## Documentation Links

- [Kubernetes docs: Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/): ciclo de vida, access modes, reclaim policies, expansão.
- [Kubernetes docs: Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/): provisioners, classe padrão, `volumeBindingMode`.
- [Kubernetes docs: Dynamic Volume Provisioning](https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/): como PVCs disparam a criação de PVs.
- [Kubernetes docs: Change the Reclaim Policy of a PersistentVolume](https://kubernetes.io/docs/tasks/administer-cluster/change-pv-reclaim-policy/): alterando para `Retain`.
