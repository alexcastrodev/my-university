---
version: 1.0
updatedAt: 2026-08-05
title: "Automação de HA com repmgr"
summary: Como o repmgr sobrepõe metadados de cluster, clonagem de standby com um comando, quorum baseado em witness e failover automático conduzido pelo repmgrd, tudo por cima da replicação por streaming nativa; requisitos de confiança SSH/sudo, promote_command/follow_command, e como ele se compara ao Patroni para novos deployments hoje.
---
## Objective

A replicação por streaming coloca um standby em dia com o primário, mas não responde "quem decide quando fazer failover, e como o resto do cluster fica sabendo?" O repmgr é uma camada de gerenciamento de cluster construída sobre a replicação por streaming nativa: ele rastreia a identidade e o papel de cada nó em seus próprios metadados, conduz a clonagem para que um novo standby não precise de nenhuma coreografia manual com `pg_basebackup`, e, com seu daemon companheiro `repmgrd` rodando, consegue detectar a falha de um primário e promover um standby automaticamente, usando um nó witness para evitar uma promoção falsa durante uma partição de rede.

## Use Cases

- Clonar um novo nó standby com um único comando em vez de montar `pg_basebackup`, `primary_conninfo` e criação de slot na mão.
- Automatizar o failover para que uma indisponibilidade do primário promova um standby sem precisar de um humano acordando às 3 da manhã para rodar a promoção manualmente.
- Proteger contra split-brain durante uma partição de rede exigindo o voto de um nó witness antes que um failover prossiga.
- Reincorporar um ex-primário recuperado de volta ao cluster como standby, em vez de reconstruí-lo do zero.
- Clonar diretamente a partir de um backup do Barman em vez de fazer streaming de uma cópia nova a partir do primário (possivelmente já sobrecarregado).

## Deep Dive

### Pré-requisitos do cluster: SSH sem senha e sudo para controle de serviço

O repmgr emite comandos reais contra todo nó que gerencia (iniciar/parar o PostgreSQL, mover um IP virtual), então ele precisa de credenciais para agir, não só para observar:

```bash
# on every node, as postgres
ssh-keygen -t rsa -N ''
ssh-copy-id postgres@pgha1
ssh-copy-id postgres@pgha2
ssh-copy-id postgres@pgha3
```

```
# /etc/sudoers.d/postgres — scoped to exactly the commands repmgr needs
Defaults:postgres !requiretty
postgres ALL = NOPASSWD: \
  /bin/systemctl stop postgresql@12-main, \
  /bin/systemctl start postgresql@12-main, \
  /bin/systemctl restart postgresql@12-main, \
  /bin/systemctl reload postgresql@12-main, \
  /sbin/ip addr add 10.0.30.50/32 dev eth0 label eth0\:pg, \
  /sbin/ip addr del 10.0.30.50/32 dev eth0 label eth0\:pg, \
  /usr/sbin/arping -b -A -c 3 -I eth0 10.0.30.50
```

A entrada em `sudoers` é deliberadamente uma allowlist exata, não acesso `sudo` genérico: o usuário `postgres` só consegue rodar esses comandos específicos de controle de serviço e de VIP, nada mais, o que mantém o raio de impacto da automação limitado mesmo se a própria conta `postgres` for comprometida.

### Ativando o repmgr no primeiro nó (primário)

O repmgr é ele mesmo uma extensão do PostgreSQL mais um banco de metadados, então a ativação acontece dentro do PostgreSQL antes de a ferramenta de linha de comando ter algo para gerenciar:

```sql
CREATE USER repmgr WITH SUPERUSER REPLICATION;
CREATE DATABASE repmgr OWNER repmgr;
```

```ini
# postgresql.conf
shared_preload_libraries = 'pg_stat_statements, repmgr'
wal_log_hints = 'on'
```

```ini
# /etc/repmgr.conf
node_id = 1
node_name = 'pgha1'
conninfo = 'host=pgha1 port=5432 dbname=repmgr user=repmgr'
data_directory = '/db/pgdata'
use_replication_slots = 'yes'

failover = 'automatic'
primary_visibility_consensus = 'true'

promote_command = 'repmgr standby promote'
follow_command  = 'repmgr standby follow -f /etc/repmgr.conf -W --upstream-node-id=%n'

service_start_command   = 'sudo systemctl start postgresql@12-main'
service_stop_command    = 'sudo systemctl stop postgresql@12-main'
service_restart_command = 'sudo systemctl restart postgresql@12-main'
```

```bash
repmgr primary register
```

`promote_command`/`follow_command` são o que o `repmgrd` de fato invoca durante um failover: o arquivo de configuração é o script de automação, não apenas configurações. `use_replication_slots = 'yes'` faz o repmgr criar e gerenciar um slot físico por standby automaticamente, o mesmo mecanismo de segurança de retenção de WAL que um standby configurado manualmente precisaria ter montado à mão.

### Clonando um standby: um comando em vez de uma dança manual com pg_basebackup

```ini
# repmgr.conf on pgha2 — only these three differ from the primary's file
node_id = 2
node_name = 'pgha2'
conninfo = 'host=pgha2 port=5432 dbname=repmgr user=repmgr'
```

```bash
repmgr standby clone -h pgha1 -U repmgr -d repmgr
systemctl start postgresql@12-main
repmgr standby register
```

`standby clone` define `primary_conninfo` e `primary_slot_name` automaticamente como parte da clonagem: o novo nó já sobe apontando para o upstream correto, sem edição manual do `postgresql.conf`. O estado do cluster fica consultável tanto via SQL quanto via CLI:

```sql
SELECT standby_node_id, standby_name, replication_lag
  FROM repmgr.replication_status;
```

```bash
repmgr cluster show
```

A clonagem também pode puxar de um backup do Barman em vez de fazer streaming diretamente do primário, útil para manter o tráfego de clonagem fora de um servidor de produção sobrecarregado:

```ini
barman_host = 'barman@pg-backup'
barman_server = 'pg-primary'
```

### O nó witness: um desempate sem dados

Um witness evita uma promoção falsa durante uma partição de rede exigindo seu voto antes que um failover prossiga, a mesma lógica de quorum de "número ímpar de votantes" de qualquer sistema de consenso distribuído. Fundamentalmente, ele não guarda nenhuma réplica dos dados de verdade:

```bash
initdb -D /db/pgdata      # empty instance — never receives streaming replication
```

```ini
# postgresql.conf on the witness — no replication config needed
shared_preload_libraries = 'repmgr'
```

```bash
repmgr witness register -h pgha1 -d repmgr
```

Um nó witness não tem `promote_command`/`follow_command`: ele nunca se torna primário e nunca é candidato a promoção, seu único trabalho é observar o cluster e votar. O posicionamento importa para o que o witness de fato protege: colocado junto ao primário, ele protege contra uma partição isolando um standby; em uma terceira localização independente, ele consegue distinguir "o primário está de fato fora do ar" de "meu link de rede até o primário está fora do ar".

## Trade-offs

- **O modelo de confiança SSH/sudo do repmgr é amplo por necessidade.** Automatizar o failover exige que o repmgr consiga parar, iniciar e recarregar o PostgreSQL em qualquer nó, e mover o VIP: isso é poder operacional real, não monitoramento somente leitura, então proteger as chaves SSH e restringir bem a entrada em `sudoers` importa mais aqui do que para uma ferramenta puramente observacional.
- **Um nó witness é infraestrutura barata, mas decisões de posicionamento têm consequências reais.** Errar o caminho de rede do witness (por exemplo, roteando pelo mesmo switch do primário) anula todo o propósito de adicioná-lo: toda a proposta de valor depende de o witness ter uma visão independente de alcançabilidade.
```
# a witness sharing a network path with the primary can't distinguish
# "primary is down" from "my own link to the primary is down"
```
- **`failover = 'automatic'` troca controle manual por velocidade, e essa troca não é de graça.** Failover automático significa que nenhum humano confirma que o primário está de fato morto antes da promoção acontecer: um soluço de rede classificado erroneamente como uma indisponibilidade, sem proteção adequada de witness/quorum, pode disparar uma promoção desnecessária e um risco subsequente de split-brain enquanto o antigo primário ainda está tecnicamente acessível para alguns clientes.
- **Livro vs. hoje**: o formato desta receita (`repmgr.conf` mais o `repmgrd` conduzindo `promote_command`/`follow_command` para failover automatizado) ainda é atual; o repmgr 5.5 (visando PostgreSQL 13 até 18) mantém a mesma superfície de comandos `standby clone`/`standby register`/`witness register` descrita aqui. O que mudou desde 2020 é menos sobre o repmgr em si e mais sobre posição de mercado: **o Patroni se tornou a ferramenta mais comumente escolhida para nova automação de HA de PostgreSQL**, em boa parte porque ele se apoia em um Distributed Configuration Store externo (etcd/Consul/ZooKeeper) para consenso em vez da lógica de quorum própria do repmgr; uma diferença que vale a pena conhecer ao escolher entre os dois para um novo deployment, coberta no conceito complementar sobre HA baseada em Patroni.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 9, "High Availability with repmgr", p. 384-431](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) - doc
- [repmgr Documentation](https://repmgr.org/docs/current/index.html) - doc
- [repmgr: standby clone](https://repmgr.org/docs/current/repmgr-standby-clone.html) - doc
- [repmgr: witness register](https://repmgr.org/docs/current/repmgr-witness-register.html) - doc
- [repmgrd: automatic failover daemon](https://repmgr.org/docs/current/repmgrd.html) - doc
