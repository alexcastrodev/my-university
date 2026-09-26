---
version: 1.0
updatedAt: 2026-09-26
title: "Backup de Volumes, Velero e Testes de Restauração"
summary: "O que backups no nível do nó, o Velero e snapshots CSI conseguem salvar num nó único (o Velero não lê volumes hostPath), e como cronometrar um teste de restauração."
---
## Objective

Dumps lógicos protegem um banco de dados. Eles não protegem o resto: o diretório de dados de uma fila, o estado de um dashboard, arquivos enviados, e os próprios objetos do Kubernetes. Backups no nível de volume (copiar os dados por baixo dos PVCs) e no nível de cluster (Velero) cobrem isso. No MicroK8s existe uma armadilha: os volumes do `hostpath-storage` são PVs `hostPath`, que nem snapshots CSI nem o file-system backup do Velero suportam. Este conceito cobre o que cada abordagem consegue e não consegue salvar num nó único, um arranjo pragmático que funciona, e a parte que todo mundo pula: testar a restauração e escrever o RPO e o RTO.

## Use Cases

- Fazer backup de tudo que um cluster MicroK8s de nó único precisa para ser reconstruído depois de uma falha de disco.
- Escolher entre backups de diretório no nó, Velero e snapshots CSI.
- Mover workloads e seus dados para um nó novo.
- Provar, com um teste cronometrado, quantos dados você perderia e quanto tempo a recuperação leva.

## Deep Dive

### O que existe para salvar

1. **Objetos do Kubernetes**: manifests e overlays do Kustomize no Git são a fonte da verdade. Se tudo é aplicado a partir do Git, os objetos já estão salvos, exceto Secrets criadas à mão.
2. **Secrets e configuração fora do Git**: `kubectl create secret` a partir de arquivos `.env` locais. Guarde os arquivos de origem num gerenciador de senhas ou criptografados no Git (SOPS, Sealed Secrets), ou exporte-os.
3. **Dados dos volumes**: o conteúdo dos PVCs.
4. **O estado do próprio cluster**: o datastore dqlite e os certificados do MicroK8s, se você quer restaurar o cluster em si em vez de reconstruí-lo.

Num ambiente pequeno e reproduzível, reconstruir o cluster a partir do Git e restaurar os dados dos volumes costuma ser mais rápido e confiável do que restaurar o control plane.

### Opção 1: backup dos diretórios hostpath a partir do nó

O MicroK8s guarda todo PVC hostpath num único diretório:

```
/var/snap/microk8s/common/default-storage/<namespace>-<pvc>-<pv>/
```

Isso torna o backup no nível do nó fácil: `restic`, `borg` ou `rsync` para outra máquina, rodando por timer do systemd ou cron no nó.

```bash
restic -r sftp:backup@backup-host:/srv/restic/k8s-node1 backup \
  /var/snap/microk8s/common/default-storage \
  --exclude '*/cache-*'              # exemplo de dados reconstruíveis que podem ficar de fora
```

O porém é a **consistência**: copiar o diretório de dados de um banco em execução produz uma cópia rasgada. Então:

- escale o workload para zero durante o backup (`kubectl scale deploy/db --replicas=0`), faça o backup, escale de volta; ou
- use a ferramenta de backup consistente da própria aplicação para bancos de dados (um dump lógico feito com `kubectl exec`) e backups de diretório para o que tolera isso (dashboards, arquivos enviados); ou
- use snapshots de sistema de arquivos por baixo (snapshot LVM ou ZFS do disco que guarda o `default-storage`) e faça backup do snapshot. A maioria dos bancos se recupera de um snapshot crash-consistent como de uma queda de energia.

Mapeie os diretórios de volta para os workloads com:

```bash
kubectl get pv -o custom-columns=PV:.metadata.name,CLAIM:.spec.claimRef.namespace,PVC:.spec.claimRef.name,PATH:.spec.hostPath.path
```

### Opção 2: Velero

O Velero faz backup de objetos do Kubernetes (como JSON, em object storage) e de dados de volumes, e os restaura no mesmo cluster ou em outro, opcionalmente remapeando namespaces.

```bash
velero install --provider aws --plugins velero/velero-plugin-for-aws:<versão compatível com o seu Velero> \
  --bucket k8s-backups --backup-location-config region=eu-west-1,s3Url=https://s3.example.com \
  --use-node-agent --default-volumes-to-fs-backup
velero backup create nightly-$(date +%F) --include-namespaces shared,team-a
velero restore create --from-backup nightly-2026-09-26
```

Os dados de volume seguem um de dois caminhos:

- **Snapshots CSI**: exigem um driver CSI com suporte a snapshots e uma `VolumeSnapshotClass`. O hostpath do MicroK8s não tem driver CSI, então não há snapshots.
- **File-system backup (FSB)** com o node agent (Kopia por padrão): lê os arquivos do volume montado de um Pod em execução. A documentação do Velero é explícita: **"hostPath volumes are not supported"**, e os PVs hostpath do MicroK8s são `hostPath: {path: ..., type: DirectoryOrCreate}` (verificado). PVs locais (tipo `local:`) são suportados.

Então, no MicroK8s com `hostpath-storage`, o Velero faz bem o backup dos seus objetos e pula os dados em silêncio. Ele vira a ferramenta certa quando os volumes vêm de um driver CSI (OpenEBS LocalPV via CSI, Longhorn, Ceph, um disco de nuvem).

### Opção 3: VolumeSnapshots CSI

Com um driver CSI que suporta snapshots:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata: {name: db-data-2026-09-26, namespace: shared}
spec:
  volumeSnapshotClassName: csi-snapclass
  source: {persistentVolumeClaimName: db-data}
```

Um snapshot é rápido e crash-consistent, e dá para criar um PVC novo a partir dele (`dataSource`). Ele normalmente mora no mesmo sistema de storage, então protege contra erros, não contra perder esse storage. Combine com uma cópia para fora do sistema (o data mover do Velero faz isso).

### RPO, RTO e o teste de restauração

- **RPO** (recovery point objective): quantos dados você pode perder. Dumps noturnos significam até 24 horas.
- **RTO** (recovery time objective): quanto tempo até o serviço voltar. Inclui conseguir uma máquina, instalar o MicroK8s, aplicar os manifests, restaurar os dados e verificar.

Ninguém sabe o seu RTO até ter restaurado uma vez. Um teste numa VM descartável:

```bash
# 1. nó novo
sudo snap install microk8s --classic --channel=1.35/stable
microk8s enable dns hostpath-storage rbac
# 2. plataforma a partir do Git
kubectl apply -k overlays/production
# 3. dados
kubectl -n shared scale deploy/db --replicas=0
#    restaure os diretórios, ou carregue o dump do banco
# 4. verifique: contagem de linhas, um login, os smoke tests da aplicação
```

Cronometre cada passo, escreva os números no runbook, e repita depois de mudanças grandes. O que esses testes costumam encontrar: uma Secret que ninguém tinha fora do cluster, um passo manual fora do script de bootstrap, uma imagem que só existia num registry do nó perdido, dumps que restauram com erros.

## Trade-offs

- **Backup de diretórios no nó vs Velero.** Backups de diretório funcionam com storage hostPath e são simples, mas precisam parar o workload para ter consistência e não sabem nada de objetos do Kubernetes. O Velero entende namespaces e objetos e não consegue ler volumes hostPath.
- **Reconstruir a partir do Git vs restaurar o control plane.** Reconstruir é reproduzível e testa o seu caminho de bootstrap; restaurar o dqlite só é mais rápido se o bootstrap não for automatizado, e é mais difícil de verificar.
- **Snapshots vs cópias.** Snapshots são instantâneos e locais; cópias para outro sistema são mais lentas e sobrevivem à perda do storage original. Você precisa de cópias; snapshots são uma otimização.

## Documentation Links

- [Velero docs: File System Backup](https://velero.io/docs/main/file-system-backup/): como o FSB funciona e suas limitações (hostPath).
- [Velero docs: Container Storage Interface Snapshot Support](https://velero.io/docs/main/csi/): snapshots CSI e o data mover.
- [Kubernetes docs: Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/): a API de VolumeSnapshot.
- [MicroK8s: Hostpath storage](https://canonical.com/microk8s/docs/addon-hostpath-storage): onde os dados dos volumes moram.
- [restic documentation](https://restic.readthedocs.io/en/stable/): backups de diretórios criptografados e deduplicados.
