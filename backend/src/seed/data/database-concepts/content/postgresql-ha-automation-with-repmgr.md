---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Streaming replication gets a standby caught up with the primary, but it doesn't answer "who decides when to fail over, and how does the rest of the cluster find out?" repmgr is a cluster-management layer built on top of native streaming replication: it tracks every node's identity and role in its own metadata, drives cloning so a new standby doesn't need any manual `pg_basebackup` choreography, and — with its companion daemon `repmgrd` running — can detect a primary failure and promote a standby automatically, using a witness node to avoid a false promotion during a network partition.

## Use Cases

- Cloning a new standby node with one command instead of assembling `pg_basebackup`, `primary_conninfo`, and slot creation by hand.
- Automating failover so a primary outage promotes a standby without a human paging in at 3am to run the promotion manually.
- Protecting against split-brain during a network partition by requiring a witness node's vote before a failover proceeds.
- Rejoining a recovered former-primary back into the cluster as a standby, instead of rebuilding it from scratch.
- Cloning directly from a Barman backup instead of streaming a fresh copy from the (possibly already loaded) primary.

## Deep Dive

### Cluster prerequisites: passwordless SSH and sudo for service control

repmgr issues real commands against every node it manages — starting/stopping PostgreSQL, moving a virtual IP — so it needs credentials to act, not just to observe:

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

The `sudoers` entry is deliberately an exact allowlist, not blanket `sudo` access — the `postgres` user can only run these specific service-control and VIP commands, nothing else, which keeps the automation's blast radius bounded even if the `postgres` account itself is compromised.

### Activating repmgr on the first (primary) node

repmgr is itself a PostgreSQL extension plus a metadata database, so activation happens inside PostgreSQL before the command-line tool has anything to manage:

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

`promote_command`/`follow_command` are what `repmgrd` actually invokes during a failover — the config file is the automation script, not just settings. `use_replication_slots = 'yes'` has repmgr create and manage a physical slot per standby automatically, the same WAL-retention safety mechanism a hand-configured standby would need set up manually.

### Cloning a standby: one command instead of a manual pg_basebackup dance

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

`standby clone` sets `primary_conninfo` and `primary_slot_name` automatically as part of the clone — the new node comes up already pointed at the right upstream, no manual edit of `postgresql.conf` required. Cluster state is queryable through both SQL and the CLI:

```sql
SELECT standby_node_id, standby_name, replication_lag
  FROM repmgr.replication_status;
```

```bash
repmgr cluster show
```

Cloning can also pull from a Barman backup instead of streaming directly from the primary — useful to keep clone traffic off a loaded production server:

```ini
barman_host = 'barman@pg-backup'
barman_server = 'pg-primary'
```

### The witness node: a tie-breaker with no data

A witness prevents a false promotion during a network partition by requiring its vote before a failover proceeds — the same "odd number of voters" quorum logic as any distributed consensus system. Critically, it holds no replica of the actual data:

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

A witness node has no `promote_command`/`follow_command` — it never becomes primary and is never a promotion candidate, its only job is observing the cluster and voting. Placement matters for what the witness actually protects against: co-located with the primary, it protects against a partition isolating a standby; in a third, independent location, it can distinguish "the primary is actually down" from "my network link to the primary is down."

## Trade-offs

- **repmgr's SSH/sudo trust model is broad by necessity.** Automating failover requires repmgr to be able to stop, start, and reload PostgreSQL on any node, and to move the VIP — this is real operational power, not read-only monitoring, so securing the SSH keys and scoping the `sudoers` entry tightly matters more here than for a purely observational tool.
- **A witness node is cheap infrastructure, but placement decisions have real consequences.** Getting the witness's network path wrong (e.g., routing through the same switch as the primary) defeats the entire purpose of adding it — the whole value proposition depends on the witness having an independent view of reachability.
```
# a witness sharing a network path with the primary can't distinguish
# "primary is down" from "my own link to the primary is down"
```
- **`failover = 'automatic'` trades manual control for speed, and that trade isn't free.** Automatic failover means no human confirms the primary is actually dead before promotion happens — a network blip misclassified as an outage, without adequate witness/quorum protection, can trigger an unnecessary promotion and a subsequent split-brain risk while the old primary is still technically reachable to some clients.
- **Book vs. today**: this recipe's shape — `repmgr.conf` plus `repmgrd` driving `promote_command`/`follow_command` for automated failover — is still current; repmgr 5.5 (targeting PostgreSQL 13 through 18) keeps the same `standby clone`/`standby register`/`witness register` command surface described here. What has changed since 2020 is less about repmgr itself and more about market position: **Patroni has become the more commonly reached-for tool for new PostgreSQL HA automation**, in large part because it builds on an external Distributed Configuration Store (etcd/Consul/ZooKeeper) for consensus rather than repmgr's own quorum logic — a difference worth knowing when choosing between them for a new deployment, covered in the companion concept on Patroni-based HA.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 9, "High Availability with repmgr", p. 384-431](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [repmgr Documentation](https://repmgr.org/docs/current/index.html) — doc
- [repmgr — standby clone](https://repmgr.org/docs/current/repmgr-standby-clone.html) — doc
- [repmgr — witness register](https://repmgr.org/docs/current/repmgr-witness-register.html) — doc
- [repmgrd — automatic failover daemon](https://repmgr.org/docs/current/repmgrd.html) — doc
