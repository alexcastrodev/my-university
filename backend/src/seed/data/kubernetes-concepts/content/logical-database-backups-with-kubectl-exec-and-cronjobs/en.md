---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A logical backup (a SQL dump) exports a database in a portable format that can be loaded into any compatible server, independent of the storage underneath. That independence matters on clusters whose volumes are plain node directories that volume-level tools cannot back up. Kubernetes gives you two ways to take one: an ad hoc dump streamed through `kubectl exec`, and a scheduled CronJob. Both are simple, and both have a way to produce a backup that looks fine and is not. This concept covers streaming a dump off the cluster, restoring it, and a CronJob that fails loudly when the dump fails. The examples use MariaDB; the same patterns apply to PostgreSQL (`pg_dump`), MySQL and others.

## Use Cases

- A backup right before a risky migration or upgrade, in one command.
- Nightly backups of a database running in the cluster.
- Copying data from one environment into another.
- Restoring a single database or table without touching the volume.

## Deep Dive

### A dump streamed through kubectl exec

The database container already has the dump tool. Stream its output straight to your machine:

```bash
kubectl -n shared exec deploy/db -- sh -c \
  'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction shop | gzip' \
  > shop-$(date +%F).sql.gz

gzip -t shop-$(date +%F).sql.gz && gzip -dc shop-$(date +%F).sql.gz | grep -c 'INSERT INTO'
```

Verified on k3s v1.36: the file arrived intact (`gzip -t` passed) and contained the `CREATE TABLE` and `INSERT INTO` statements.

- Output goes to stdout, through the API server, into your local file. No temporary file in the container, nothing to clean up.
- The password is expanded **inside** the container (`sh -c '... $VAR'` with single quotes), so it never appears in your local process list or shell history.
- `--single-transaction` (MariaDB/MySQL with InnoDB) gives a consistent snapshot without locking; PostgreSQL's `pg_dump` is consistent by default.
- Do **not** pass `-t`: with a TTY, the remote side may translate line endings, which corrupts binary output such as a gzip stream. Use `-i` only when you send data in.

`kubectl cp` is the alternative for files already written inside the container, and it needs `tar` in the image (distroless images do not have it):

```bash
kubectl -n shared cp shared/<pod>:/tmp/dump.sql.gz ./dump.sql.gz
# tar: Removing leading `/' from member names   (harmless, verified)
```

### Restoring

```bash
kubectl -n shared exec deploy/db -- sh -c \
  'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "create database shop_restore"'

gzip -dc shop-2026-09-26.sql.gz | kubectl -n shared exec -i deploy/db -- sh -c \
  'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" shop_restore'
```

Verified: the restored database returned the expected row count. `-i` passes stdin into the container; still no `-t`. Restoring into a **new** database and then switching the application is safer than overwriting the live one.

Remember what a single-database dump does not contain: users, grants and server-wide settings. Export those separately (`mariadb-dump --system=users`, `pg_dumpall --globals-only`), or a restore onto a fresh server fails on missing roles.

### A scheduled backup with a CronJob

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
              image: mariadb:11.8                     # same major version as the server
              env:
                - name: MYSQL_PWD                     # read by the client, never on the command line
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

Test it immediately instead of waiting for the schedule:

```bash
kubectl -n shared create job --from=cronjob/db-backup backup-test-1
kubectl -n shared wait --for=condition=complete job/backup-test-1 --timeout=300s
kubectl -n shared logs job/backup-test-1
```

### The backup that "succeeds" without data

The first version of this CronJob used `command: ["sh", "-ec"]` and checked the file with `gzip -t`. To test the failure path, the host was changed to one that does not exist. Verified result:

```
$ kubectl -n shared get job backup-test-2
NAME            STATUS     COMPLETIONS
backup-test-2   Complete   1/1

$ kubectl -n shared logs job/backup-test-2
mariadb-dump: Got error: 2005: "Unknown server host 'nope.shared' (-2)" when trying to connect
REPORTED_SUCCESS
```

The dump failed, but the Job is **Complete**:

- `sh -e` only checks the exit code of the **last** command in a pipeline. `mariadb-dump ... | gzip` "succeeds" because `gzip` does.
- `gzip -t` passes, because an empty input compresses into a perfectly valid gzip file.

Two fixes, both in the manifest above:

1. `bash -o pipefail`, so any failing command in a pipe fails the step. The image's `sh` (dash) does not support it (verified: `set -o pipefail` exits with code 2), which is why the command is `bash`. With it, the same broken host produced a `Failed` Job after its retry.
2. Check the **content**, not just the container format: `mariadb-dump` ends with `-- Dump completed on <date>`; `pg_dump` in plain format ends with `-- PostgreSQL database dump complete`; a restore test is better still.

Then alert on it: `KubeJobFailed` fires for failed Jobs, and a "last successful backup older than 26 hours" alert (`time() - kube_cronjob_status_last_successful_time > 26*3600`) catches a CronJob that silently stopped running.

### Where backups must not live

A PVC on the same node as the database protects against a dropped table, not against losing the node or its disk. Copy each dump off the machine: an S3-compatible bucket (a second step with `rclone` or `aws s3 cp`), another server, or at least another disk. Three copies, two media, one off-site applies to Kubernetes as much as anywhere.

### Logical vs physical backups

A dump is consistent and portable, and it is a point in time: everything after the last dump is lost (RPO = interval), and restoring a large database takes long because indexes are rebuilt (RTO grows with size). For point-in-time recovery you need physical backups with log archiving, which database operators (CloudNativePG, the MariaDB and Percona operators) automate.

## Trade-offs

- **`kubectl exec` dumps vs a CronJob.** Exec is perfect for ad hoc backups and uses your credentials; a CronJob runs unattended with its own least-privilege database user and must be monitored.
- **Compressed dumps vs plain SQL.** Compression saves space and hides content from quick checks; verify by decompressing, not by looking at the file size.
- **Logical vs physical backups.** Logical backups are simple and version-portable with a coarse RPO; physical backups with log archiving give point-in-time recovery at the cost of more tooling.

## Lab

In this lab you receive a backup CronJob that "succeeds" without data: with the database down the dump fails, yet the Job ends `Complete`, and the file it produced passes `gzip -t`. Your job is to make the backup fail loudly when the dump fails, take the password out of the manifest and stop two runs from happening at once. The core idea is to feel that a shell pipeline returns the exit code of its last command, so an empty backup can look like a success to whoever monitors it.

**The scenario**

A real MariaDB on a real Kubernetes cluster (k3s, started by Testcontainers).

- `src/test/resources/k8s/db.yaml`: given, with the `db` Deployment and Service, and a `db-backups` PVC. The root password comes from the `db-root` Secret, and the `shop` database gets an `orders` table with three rows.
- `src/main/resources/k8s/backup.yaml`: the only file you edit. The `db-backup` CronJob (`30 2 * * *`, UTC, `backoffLimit: 1`, `restartPolicy: Never`) runs `mariadb-dump ... | gzip` into a dated file on the PVC and then a `gzip -t`.
- `src/test/java/DatabaseBackupTest.java`: triggers the CronJob twice with `kubectl create job --from=cronjob/db-backup`, the first with the database up and the second with the database scaled to zero, and checks the manifest.

**What you will do, step by step**

1. **Run the tests first.** The second run is the interesting one: `mariadb-dump` cannot connect, and the Job still ends `Complete`.
2. **Make any failure in the pipeline fail the Job (TODO-00).** A pipeline returns the status of its last command, `gzip`, which is fine with empty input. Make a failure anywhere in the pipeline bring the Job down. The image's `sh` has no `pipefail`, but `bash` does.
3. **Take the password out of the manifest (TODO-01).** Today it is written in the command, visible in the manifest and in the container's `ps`. Read it from the `db-root` Secret (key `password`) into the `MYSQL_PWD` variable, which the MariaDB client reads by itself, and remove `-p` from the command.
4. **Forbid overlapping runs (TODO-02).** A slow backup must never overlap with the next one. Set the CronJob's concurrency policy accordingly.

**How you know you are done**

`mvn -pl kubernetes-concepts/logical-database-backups-with-kubectl-exec-and-cronjobs test` passes: with the database up the Job completes and the dump contains the `INSERT INTO` statements, with the database down it fails, the password comes from a `secretKeyRef` and the concurrency policy is `Forbid`. You should be able to explain why a backup that "finished successfully" can be empty.

**Optional challenges**

- **TODO-03:** replace `gzip -t` with a check of the dump's content (the last line of a complete `mariadb-dump` output is `-- Dump completed on <date>`). Why is `gzip -t` alone not a backup check?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container and pull `mariadb` and `busybox` inside it) and the articles "Jobs, CronJobs and restartPolicy" and "Logical Database Backups with kubectl exec and CronJobs".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/logical-database-backups-with-kubectl-exec-and-cronjobs test`. The `TODO-00` to `TODO-02` comments in `backup.yaml` mark what to do. The first run pulls the MariaDB image (about 100 MB).

## Documentation Links

- [kubectl exec reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_exec/): `-i`, `-t` and container selection.
- [kubectl cp reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_cp/): copying files, the `tar` requirement.
- [Kubernetes docs: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): schedules, time zones, concurrency.
- [MariaDB docs: mariadb-dump](https://mariadb.com/kb/en/mariadb-dump/): options, `--single-transaction`.
- [PostgreSQL docs: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html): the equivalent tool for PostgreSQL.
