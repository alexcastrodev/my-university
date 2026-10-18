---
version: 1.0
updatedAt: 2026-09-26
title: "Backups Lógicos de Banco com kubectl exec e CronJobs"
summary: "Transmitir um dump para fora do cluster com kubectl exec, restaurá-lo, e um CronJob de backup que falha de verdade quando o dump falha (o problema do pipe com sh -e)."
---
## Objective

Um backup lógico (um dump SQL) exporta um banco de dados num formato portável que pode ser carregado em qualquer servidor compatível, independente do storage por baixo. Essa independência importa em clusters cujos volumes são diretórios comuns do nó que ferramentas de backup de volume não conseguem salvar. O Kubernetes dá dois jeitos de fazer um: um dump pontual transmitido pelo `kubectl exec`, e um CronJob agendado. Os dois são simples, e os dois têm um jeito de produzir um backup que parece bom e não é. Este conceito cobre transmitir um dump para fora do cluster, restaurá-lo, e um CronJob que falha de forma visível quando o dump falha. Os exemplos usam MariaDB; os mesmos padrões valem para PostgreSQL (`pg_dump`), MySQL e outros.

## Use Cases

- Um backup logo antes de uma migração ou atualização arriscada, num único comando.
- Backups noturnos de um banco de dados rodando no cluster.
- Copiar dados de um ambiente para outro.
- Restaurar um único banco ou tabela sem mexer no volume.

## Deep Dive

### Um dump transmitido pelo kubectl exec

O container do banco já tem a ferramenta de dump. Transmita a saída dela direto para a sua máquina:

```bash
kubectl -n shared exec deploy/db -- sh -c \
  'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction shop | gzip' \
  > shop-$(date +%F).sql.gz

gzip -t shop-$(date +%F).sql.gz && gzip -dc shop-$(date +%F).sql.gz | grep -c 'INSERT INTO'
```

Verificado no k3s v1.36: o arquivo chegou íntegro (`gzip -t` passou) e continha os comandos `CREATE TABLE` e `INSERT INTO`.

- A saída vai para o stdout, pelo API server, até o seu arquivo local. Nenhum arquivo temporário no container, nada para limpar.
- A senha é expandida **dentro** do container (`sh -c '... $VAR'` com aspas simples), então ela nunca aparece na lista de processos local nem no histórico do shell.
- `--single-transaction` (MariaDB/MySQL com InnoDB) dá um snapshot consistente sem locks; o `pg_dump` do PostgreSQL é consistente por padrão.
- **Não** passe `-t`: com um TTY, o lado remoto pode traduzir quebras de linha, o que corrompe saídas binárias como um stream gzip. Use `-i` só quando você envia dados para dentro.

O `kubectl cp` é a alternativa para arquivos já gravados dentro do container, e ele precisa de `tar` na imagem (imagens distroless não têm):

```bash
kubectl -n shared cp shared/<pod>:/tmp/dump.sql.gz ./dump.sql.gz
# tar: Removing leading `/' from member names   (inofensivo, verificado)
```

### Restaurando

```bash
kubectl -n shared exec deploy/db -- sh -c \
  'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "create database shop_restore"'

gzip -dc shop-2026-09-26.sql.gz | kubectl -n shared exec -i deploy/db -- sh -c \
  'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" shop_restore'
```

Verificado: o banco restaurado devolveu a contagem de linhas esperada. `-i` passa o stdin para dentro do container; continua sem `-t`. Restaurar num banco **novo** e depois trocar a aplicação é mais seguro do que sobrescrever o banco em uso.

Lembre o que um dump de um único banco não contém: usuários, permissões e configurações do servidor. Exporte-os separadamente (`mariadb-dump --system=users`, `pg_dumpall --globals-only`), ou uma restauração num servidor novo falha por roles inexistentes.

### Um backup agendado com CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: {name: db-backup, namespace: shared}
spec:
  schedule: "30 2 * * *"
  timeZone: "UTC"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 3600
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: backup
              image: mariadb:11.8                     # mesma versão major do servidor
              env:
                - name: MYSQL_PWD                     # lida pelo cliente, nunca na linha de comando
                  valueFrom: {secretKeyRef: {name: db-backup, key: password}}
              command: ["bash", "-euo", "pipefail", "-c"]
              args:
                - |
                  f=/backup/shop-$(date +%F-%H%M).sql.gz
                  mariadb-dump -h db.shared.svc.cluster.local -ubackup --single-transaction shop | gzip > "$f"
                  gzip -dc "$f" | tail -1 | grep -q 'Dump completed'
                  find /backup -name 'shop-*.sql.gz' -mtime +14 -delete
              volumeMounts: [{name: backup, mountPath: /backup}]
          volumes:
            - name: backup
              persistentVolumeClaim: {claimName: db-backups}
```

Teste na hora em vez de esperar o agendamento:

```bash
kubectl -n shared create job --from=cronjob/db-backup backup-test-1
kubectl -n shared wait --for=condition=complete job/backup-test-1 --timeout=300s
kubectl -n shared logs job/backup-test-1
```

### O backup que "tem sucesso" sem dados

A primeira versão deste CronJob usava `command: ["sh", "-ec"]` e verificava o arquivo com `gzip -t`. Para testar o caminho de falha, o host foi trocado por um que não existe. Resultado verificado:

```
$ kubectl -n shared get job backup-test-2
NAME            STATUS     COMPLETIONS
backup-test-2   Complete   1/1

$ kubectl -n shared logs job/backup-test-2
mariadb-dump: Got error: 2005: "Unknown server host 'nope.shared' (-2)" when trying to connect
REPORTED_SUCCESS
```

O dump falhou, mas o Job está **Complete**:

- O `sh -e` só confere o exit code do **último** comando de um pipeline. `mariadb-dump ... | gzip` "tem sucesso" porque o `gzip` tem.
- O `gzip -t` passa, porque uma entrada vazia vira um arquivo gzip perfeitamente válido.

Duas correções, ambas no manifest acima:

1. `bash -o pipefail`, para que qualquer comando que falhe num pipe falhe o passo. O `sh` da imagem (dash) não suporta isso (verificado: `set -o pipefail` sai com código 2), e é por isso que o comando é `bash`. Com ele, o mesmo host quebrado produziu um Job `Failed` depois da nova tentativa.
2. Verificar o **conteúdo**, não só o formato do arquivo: o `mariadb-dump` termina com `-- Dump completed on <data>`; o `pg_dump` em formato texto termina com `-- PostgreSQL database dump complete`; um teste de restauração é melhor ainda.

Depois alerte sobre isso: `KubeJobFailed` dispara para Jobs com falha, e um alerta de "último backup com sucesso mais antigo que 26 horas" (`time() - kube_cronjob_status_last_successful_time > 26*3600`) pega um CronJob que parou de rodar em silêncio.

### Onde os backups não podem ficar

Um PVC no mesmo nó do banco protege contra uma tabela apagada, não contra perder o nó ou o disco dele. Copie cada dump para fora da máquina: um bucket compatível com S3 (um segundo passo com `rclone` ou `aws s3 cp`), outro servidor, ou pelo menos outro disco. Três cópias, duas mídias, uma fora do local vale no Kubernetes como em qualquer lugar.

### Backups lógicos vs físicos

Um dump é consistente e portável, e é um instante no tempo: tudo depois do último dump se perde (RPO = intervalo), e restaurar um banco grande demora porque os índices são reconstruídos (o RTO cresce com o tamanho). Para recuperação a um ponto no tempo você precisa de backups físicos com arquivamento de logs, que operators de banco (CloudNativePG, os operators de MariaDB e da Percona) automatizam.

## Trade-offs

- **Dumps com `kubectl exec` vs um CronJob.** O exec é perfeito para backups pontuais e usa as suas credenciais; um CronJob roda sozinho com o seu próprio usuário de banco de menor privilégio e precisa ser monitorado.
- **Dumps comprimidos vs SQL puro.** Compressão economiza espaço e esconde o conteúdo de verificações rápidas; verifique descomprimindo, não olhando o tamanho do arquivo.
- **Backups lógicos vs físicos.** Backups lógicos são simples e portáveis entre versões, com um RPO grosso; backups físicos com arquivamento de logs dão recuperação a um ponto no tempo ao custo de mais ferramentas.

## Lab

Neste lab você recebe um CronJob de backup que "dá certo" mesmo sem dados: com o banco fora do ar o dump falha, mas o Job termina `Complete`, e o arquivo gerado passa em `gzip -t`. O seu trabalho é fazer o backup falhar alto quando o dump falha, tirar a senha do manifesto e impedir que duas execuções rodem ao mesmo tempo. A ideia central é sentir que um pipeline de shell devolve o código de saída do último comando, então um backup vazio pode parecer um sucesso para quem monitora.

**O cenário**

Um MariaDB real num cluster Kubernetes real (k3s, subido pelo Testcontainers).

- `src/test/resources/k8s/db.yaml`: já vem pronto, com o Deployment e o Service `db`, e um PVC `db-backups`. A senha de root vem do Secret `db-root`, e o banco `shop` ganha uma tabela `orders` com três linhas.
- `src/main/resources/k8s/backup.yaml`: o único arquivo que você edita. O CronJob `db-backup` (`30 2 * * *`, UTC, `backoffLimit: 1`, `restartPolicy: Never`) roda `mariadb-dump ... | gzip` num arquivo datado no PVC e depois um `gzip -t`.
- `src/test/java/DatabaseBackupTest.java`: dispara o CronJob duas vezes com `kubectl create job --from=cronjob/db-backup`, a primeira com o banco no ar e a segunda com o banco escalado para zero, e confere o manifesto.

**O que você vai fazer, passo a passo**

1. **Rodar os testes primeiro.** A segunda execução é a interessante: o `mariadb-dump` não conecta, e mesmo assim o Job termina `Complete`.
2. **Fazer qualquer falha no pipeline falhar o Job (TODO-00).** Um pipeline devolve o status do último comando, o `gzip`, que vai bem com entrada vazia. Faça uma falha em qualquer ponto do pipeline derrubar o Job. A imagem usa um `sh` que não tem `pipefail`, mas o `bash` tem.
3. **Tirar a senha do manifesto (TODO-01).** Hoje ela está escrita no comando, visível no manifesto e no `ps` do container. Leia-a do Secret `db-root` (chave `password`) para a variável `MYSQL_PWD`, que o cliente do MariaDB lê sozinho, e remova o `-p` do comando.
4. **Proibir execuções sobrepostas (TODO-02).** Um backup lento nunca deve se sobrepor ao seguinte. Defina a política de concorrência do CronJob de acordo.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/logical-database-backups-with-kubectl-exec-and-cronjobs test` passa: com o banco no ar o Job completa e o dump contém os `INSERT INTO`, com o banco fora ele falha, a senha vem de um `secretKeyRef` e a política de concorrência é `Forbid`. Você deve conseguir explicar por que um backup que "terminou com sucesso" pode estar vazio.

**Desafios opcionais**

- **TODO-03:** troque o `gzip -t` por uma checagem do conteúdo do dump (a última linha de um `mariadb-dump` completo é `-- Dump completed on <data>`). Por que o `gzip -t` sozinho não é uma verificação de backup?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s` e baixam `mariadb` e `busybox` dentro dele) e os artigos "Jobs, CronJobs and restartPolicy" e "Logical Database Backups with kubectl exec and CronJobs".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/logical-database-backups-with-kubectl-exec-and-cronjobs test`. Os comentários `TODO-00` a `TODO-02` em `backup.yaml` marcam o que fazer. A primeira execução baixa a imagem do MariaDB (cerca de 100 MB).

## Documentation Links

- [kubectl exec reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_exec/): `-i`, `-t` e seleção de container.
- [kubectl cp reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_cp/): cópia de arquivos, a exigência de `tar`.
- [Kubernetes docs: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): agendamentos, fusos horários, concorrência.
- [MariaDB docs: mariadb-dump](https://mariadb.com/kb/en/mariadb-dump/): opções, `--single-transaction`.
- [PostgreSQL docs: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html): a ferramenta equivalente para PostgreSQL.
