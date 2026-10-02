---
version: 1.0
updatedAt: 2026-08-05
title: "Gerenciamento de Backups: Barman e pgBackRest"
summary: Como o Barman (backup centralizado de uma frota via SSH/streaming, com capacidade de RPO quase zero) e o pgBackRest (backups autocontidos, comprimidos, incrementais e diferenciais) vão além do pg_basebackup com catálogos, políticas de retenção e PITR, além do suporte nativo a armazenamento em nuvem e da remoção do modo de backup exclusivo no PostgreSQL 15.
---
## Objective

O `pg_basebackup` consegue produzir um backup, mas uma *estratégia* de backup de verdade precisa de mais: um inventário de todos os backups feitos, WAL arquivado continuamente para recuperação até um ponto no tempo (PITR), uma política de retenção que expira backups antigos automaticamente e a capacidade de restaurar em um servidor totalmente diferente. O Barman e o pgBackRest resolvem isso por dois ângulos diferentes: o Barman gerencia uma frota de clusters PostgreSQL a partir de um servidor de backup dedicado via SSH e replicação por streaming, enquanto o pgBackRest é uma ferramenta autocontida construída para velocidade, que funciona igualmente bem fazendo backup de uma única instância local ou (com mais configuração) de um host de repositório dedicado. O `pg_dump` não é uma ferramenta de backup para nenhum desses casos de uso: é uma exportação lógica, útil para extrações parciais, não uma forma de proteger um cluster inteiro.

## Use Cases

- Gerenciar backups de uma frota inteira de clusters PostgreSQL (produção, DR, staging) a partir de um servidor centralizado, com políticas de retenção por cluster e um catálogo pesquisável de todos os backups já feitos.
- Alcançar perda de dados quase nula (RPO ≈ 0) fazendo a ferramenta de backup participar do próprio fluxo de replicação, em vez de depender apenas do envio periódico de WAL via `archive_command`.
- Clonar um banco de produção em um novo servidor para testes ou recuperação de desastres, sem tocar no primário além de um backup normal.
- Rodar backups rápidos, comprimidos e incrementais em um único servidor de alto throughput, quando um host dedicado de gerenciamento de backups não se justifica.

## Deep Dive

### Barman: um servidor de backup dedicado que alcança o PostgreSQL via SSH

O Barman roda em seu próprio servidor e puxa arquivos do primário PostgreSQL via SSH; nenhum agente precisa rodar no servidor de banco além do acesso SSH normal:

```bash
# no pg-backup, como usuário barman
ssh-keygen -t rsa -N ''
ssh-copy-id postgres@pg-primary
```

```sql
-- no pg-primary
CREATE USER barman WITH REPLICATION SUPERUSER PASSWORD 'mypasshere';
```

```
# pg_hba.conf no pg-primary
host    all             barman      pg-backup   md5
host    replication     barman      pg-backup   md5
```

```ini
# /etc/barman.d/pg-primary.conf no pg-backup
[pg-primary]
description = "Primary PostgreSQL Server"
conninfo = "host=pg-primary user=barman dbname=postgres"
streaming_conninfo = "host=pg-primary user=barman"
ssh_command = "ssh postgres@pg-primary"
backup_method = rsync
archiver = off
streaming_archiver = on
slot_name = barman
```

`backup_method = rsync` usa hard links do sistema de arquivos entre backups, e é isso que torna os backups do Barman efetivamente incrementais sem nenhuma lógica especial de backup incremental: arquivos que não mudaram são linkados, não copiados de novo. `streaming_archiver = on` (com `archiver = off`) diz ao Barman para puxar o WAL pelo protocolo de replicação em vez de esperar o `archive_command` empurrar arquivos; um replication slot (`slot_name = barman`) impede o primário de reciclar WAL que o Barman ainda não buscou, exatamente o mesmo mecanismo em que um standby físico se apoia.

```bash
# inicializa o fluxo de WAL e depois verifica
barman receive-wal pg-primary --create-slot
barman cron
barman switch-wal pg-primary --force
barman check pg-primary
```

### Fazendo e inspecionando um backup com Barman

```bash
barman backup pg-primary
barman list-backup pg-primary
barman show-backup pg-primary latest
barman list-files pg-primary latest
```

`latest` é um atalho permanente que sempre aponta para o ID do backup mais recente, então scripts não precisam acompanhar IDs manualmente. Uma política de retenção expira backups e WAL antigos automaticamente, em vez de exigir limpeza manual:

```ini
retention_policy = RECOVERY WINDOW OF 1 WEEK
```

### Restaurando com Barman, inclusive em outro servidor

```bash
# no pg-backup, como barman: restaura remotamente no pg-clone via SSH
barman recover \
  --remote-ssh-command "ssh postgres@pg-clone" \
  pg-primary latest /db/pgdata
```

Restaurações do Barman podem ter como alvo qualquer servidor que ele alcance via SSH, não só o primário original, e é isso que torna simples clonar um banco de produção para testes ou DR. O Barman desativa deliberadamente o `archive_command` em um servidor recém-restaurado (para evitar que o clone polua o arquivo de WAL original com seus próprios arquivos); transformar uma cópia restaurada em um standby de verdade exige configurar manualmente o `primary_conninfo`, o que a flag `--standby-mode` pode deixar pré-configurado.

### pgBackRest: uma ferramenta autocontida com compressão e paralelismo embutidos

```ini
# /etc/pgbackrest.conf no pg-primary
[main]
pg1-path=/db/pgdata
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=1
start-fast=y
```

```ini
# postgresql.conf
archive_command = 'pgbackrest --stanza=main archive-push %p'
```

```bash
pgbackrest --stanza=main --log-level-console=info stanza-create
pgbackrest --stanza=main --log-level-console=info check
pgbackrest info
```

A numeração `pg1-path`/`repo1-*` existe porque o pgBackRest consegue gerenciar várias instâncias PostgreSQL e vários repositórios de backup a partir de uma única configuração, indexando-os em vez de presumir exatamente um de cada. `start-fast` força um checkpoint imediato em vez de esperar o próximo agendado, trocando um breve pico de E/S por um backup que começa mais cedo.

### Fazendo backup com pgBackRest: completo, incremental, diferencial

```bash
pgbackrest --stanza=main --type=full backup
pgbackrest --stanza=main info
pgbackrest ls backup/main/latest --recurse
```

Três tipos de backup, cada um com uma troca diferente: `full` copia tudo, sem dependência de backups anteriores; `incr` guarda só o que mudou desde o *último backup bem-sucedido* (completo ou incremental); `diff` guarda o que mudou desde o *último backup completo* especificamente. Enquanto a abordagem do Barman baseada em rsync sempre produz um backup com a listagem completa de arquivos (via hard links para os arquivos inalterados), os backups incrementais e diferenciais do pgBackRest de fato pulam no disco os arquivos que não mudaram: são menores, mas cada incremental da cadeia passa a depender do backup completo em que se baseia. Remover esse backup completo invalida todos os incrementais construídos sobre ele, e é por isso que o pgBackRest recomenda fazer um backup completo novo com uma cadência regular (por exemplo, semanal) em vez de deixar uma cadeia de incrementais crescer indefinidamente.

## Trade-offs

- **O modelo de frota centralizada do Barman e o modelo autocontido do pgBackRest resolvem problemas diferentes.** O Barman é construído em torno de gerenciar muitos clusters a partir de um servidor de backup via SSH/streaming; o pgBackRest funciona muito bem localmente em uma única instância e pode ser estendido para um host de repositório dedicado, mas essa configuração é um esforço separado de cliente-servidor, documentado como um tópico próprio ("Dedicated Backup Host"), não a forma padrão. Escolher entre eles é, na verdade, escolher qual topologia combina com o número de clusters que de fato está sendo gerenciado.
- **Os backups incrementais do pgBackRest têm uma cadeia de dependência rígida; os do Barman não.** Apagar o backup completo que está por baixo de uma cadeia de incrementais do pgBackRest invalida todos os incrementais construídos sobre ele; a abordagem com hard links do Barman faz com que todo backup, incremental em espírito ou não, seja independentemente uma listagem completa de arquivos. Isso muda o quão agressivamente backups completos antigos podem ser podados em cada ferramenta.
```bash
# pgBackRest: este backup completo NÃO pode ser apagado com segurança se houver incrementais dependendo dele
pgbackrest --stanza=main --type=full backup
```
- **A capacidade de RPO quase zero do Barman (fazer streaming do WAL diretamente para o catálogo de backups, com suporte a replicação síncrona) é um diferencial real.** A maioria das ferramentas de backup só arquiva WAL periodicamente via `archive_command`, deixando uma janela de possível perda de dados entre os ciclos de arquivamento; o Barman recebendo WAL como uma réplica por streaming fecha essa janela a quase nada, ao custo de rodar o Barman como um participante permanente da topologia de replicação em vez de um processo batch offline.
- **Livro vs. hoje**: esta receita define `backup_options = exclusive_backup` para o Barman, e as duas ferramentas presumem a API clássica de "backup exclusivo" `pg_start_backup()`/`pg_stop_backup()`. **O PostgreSQL 15 removeu completamente do core o modo de backup exclusivo**: só a API de backup não exclusivo/concorrente permanece. As versões atuais do Barman e do pgBackRest usam backups concorrentes (não exclusivos) por padrão; a configuração explícita `exclusive_backup` do livro não é só um conselho desatualizado, ela mira uma API que o PostgreSQL não tem mais a partir da versão 15. Além disso, as duas ferramentas adicionaram **suporte nativo a armazenamento de objetos em nuvem** desde a base de 2020 deste livro: o pgBackRest suporta `repo-type=s3`/`azure`/`gcs` diretamente como backend de repositório, e o Barman ganhou o "Barman Cloud" para enviar backups direto para armazenamento compatível com S3, Azure ou GCS. Nenhuma das ferramentas oferecia isso em 2020 como uma opção de configuração de primeira classe, como as duas oferecem hoje.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3ª edição (Packt, 2020): Capítulo 8, "Backup Management", receitas "Installing and configuring Barman", "Backing up a database with Barman", "Restoring a database with Barman", "Installing and configuring pgBackRest", "Backing up a database with pgBackRest", "Restoring a database with pgBackRest", p. 342-372](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854): doc
- [Barman Documentation](https://docs.pgbarman.org/): doc
- [pgBackRest User Guide](https://pgbackrest.org/user-guide.html): doc
- [PostgreSQL Documentation: Continuous Archiving and Point-in-Time Recovery (PITR)](https://www.postgresql.org/docs/current/continuous-archiving.html): doc
