---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Patroni takes the same job repmgr does — automated PostgreSQL failover — and solves it with a fundamentally different architecture: instead of implementing its own consensus/quorum logic, it delegates that to an external Distributed Configuration Store (DCS — etcd, ZooKeeper, or Consul), and instead of a floating virtual IP that has to be reassigned, it pairs with HAProxy so every node is reachable at the same address and the proxy always routes to whoever the DCS says is currently primary. Every Patroni instance runs the same loop independently — check the DCS for a primary, claim the role if none exists, or become a replica if one does — which means there's no single Patroni process that's a point of failure; the cluster self-heals because every node is running the same decision logic against a shared, consistent source of truth.

## Use Cases

- Building fully automated PostgreSQL failover without hand-rolling consensus logic — the DCS (etcd/ZooKeeper/Consul) already solves the "how do distributed nodes agree on one fact" problem.
- Performing zero-downtime rolling upgrades: switch the primary role away from a node, upgrade it while it's a replica, switch back, repeat for the rest of the cluster.
- Avoiding virtual-IP reassignment races entirely — HAProxy routes to the node the DCS currently names as primary, so there's no window where two nodes could each believe they own the same floating IP.
- Running PostgreSQL HA inside Kubernetes, where Patroni's native Kubernetes-as-DCS support and the broader ecosystem of Patroni-based operators (CloudNativePG, the Zalando postgres-operator) are now a common deployment path.

## Deep Dive

### Why three layers instead of one

```
                 ┌─────────┐
   clients ────▶ │ HAProxy │  (routes to whoever the DCS says is primary)
                 └────┬────┘
              ┌────────┼────────┐
              ▼        ▼        ▼
          [pgha1]   [pgha2]   [pgha3]   ← each running Patroni + PostgreSQL
              │        │        │
              └────────┼────────┘
                        ▼
                  [etcd cluster]        ← the shared source of truth
```

HAProxy removes the virtual-IP reassignment problem: every node is reachable at the same proxy address, and the proxy's health checks decide who's actually primary right now, rather than something having to move a floating IP and hope no stale ARP cache points the wrong way. etcd (Raft-based, the same consensus algorithm family used by many distributed systems) gives every node a consistent view of "who is primary" that survives network partitions without split-brain — this is the part repmgr implements internally, and Patroni instead treats as a pluggable, replaceable component (ZooKeeper and Consul work identically from Patroni's perspective, just different DCS backends).

### The reconciliation loop every Patroni instance runs

1. Check the DCS for an existing primary key.
2. If none exists, claim the primary role by writing that key.
3. If this node holds the primary role, tell HAProxy to route here.
4. If a primary already exists elsewhere, verify this node's state and, if needed, transform it into a replica.

This loop runs on every node, every few seconds, independently. A primary failure means every surviving node's next loop iteration finds no primary key and attempts to claim it — the DCS's consensus guarantee ensures exactly one attempt wins, and every other node's loop then converges on "become a replica of the winner."

### Configuring a node: one YAML file per instance

```yaml
scope: stampede
name: pgha1

restapi:
  listen: pgha1:8008
  connect_address: pgha1:8008

etcd:
  host: pgha1:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        wal_level: replica
        wal_log_hints: "on"
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: pgha1:5432
  connect_address: pgha1:5432
  data_dir: /db/pgdata
  bin_dir: /usr/lib/postgresql/18/bin
  authentication:
    replication:
      username: rep_user
      password: newpass
    superuser:
      username: postgres
      password: newpass
```

`ttl`/`loop_wait`/`retry_timeout` tune how quickly a failure is detected versus how tolerant the cluster is of transient network hiccups — a shorter `ttl` fails over faster but risks a false-positive promotion during a brief blip. `maximum_lag_on_failover` (in bytes) excludes replicas that have fallen too far behind from being promotion candidates, so a badly-lagging standby doesn't win an election and then present stale data as if it were current. `use_pg_rewind: true` lets a demoted former primary rejoin as a replica by resynchronizing only the diverged blocks, instead of requiring a full rebuild. Every field under `bootstrap` only applies to first-time cluster creation; on an existing cluster, the DCS-stored configuration is authoritative and this file's bootstrap section is ignored.

### Operating the cluster: patronictl

```bash
patronictl -d pgha1:2379 list stampede
patronictl -d pgha1:2379 switchover stampede
```

`switchover` triggers a controlled handover — Patroni asks which node to promote (or picks one automatically), demotes the current primary, and reconciles the rest of the cluster, all without taking the database offline. This is the mechanism a zero-downtime rolling upgrade is built on: switch primary away from a node, upgrade the now-replica, switch back when ready, repeat per node. Patroni also actively defends its own authority — if an operator manually stops PostgreSQL on a node Patroni manages, Patroni notices the outage on its next loop iteration and either restarts it or, if it was the primary, promotes a replacement — deliberately hard to defeat by accident, which is exactly the property wanted from an HA tool.

## Trade-offs

- **Delegating consensus to a DCS is more operationally honest than implementing it yourself, but it adds a whole extra distributed system to operate.** etcd/ZooKeeper/Consul each need their own quorum (an odd number of nodes, their own failure-tolerance math) — Patroni's HA is only as good as the DCS cluster underneath it, so a poorly-run 1-node etcd "cluster" undermines the entire design regardless of how well Patroni itself is configured.
- **The bootstrap section only fires once, and that catches people off guard.** Changing `bootstrap.dcs.postgresql.parameters` in the YAML file after a cluster already exists does nothing — the DCS-stored config from initial bootstrap is what's live, and it has to be updated through `patronictl edit-config`, not by editing the file and restarting Patroni.
```yaml
# editing this after the cluster already exists has no effect —
# it only applies on first bootstrap:
bootstrap:
  dcs:
    postgresql:
      parameters:
        wal_level: replica
```
- **`patronictl switchover` makes maintenance genuinely zero-downtime, at the cost of trusting the tool completely with primary selection.** Patroni actively fighting manual intervention (restarting a stopped instance, promoting a replacement if an operator kills the primary by hand) is a feature for unattended reliability and a trap for anyone who doesn't know Patroni is managing the node — "just restart postgres" stops being a safe troubleshooting step.
- **Book vs. today**: the recipe's `wal_level: logical` for a physical-only cluster is more than needed — `replica` (the default since PostgreSQL 10) is sufficient for physical streaming replication and avoids the extra WAL volume `logical` writes for no benefit here (the same correction applies to the plain streaming-replication recipe in this book — see the companion concept on streaming replication). Separately, this recipe installs Patroni 1.6.3 via `pip3` directly onto bare servers; the current release is in the **4.x** series, and — more significantly than the version bump — **Patroni today is very commonly deployed via Kubernetes operators** (CloudNativePG, the Zalando postgres-operator) rather than hand-installed on VMs, with Patroni's native Kubernetes-API DCS support as a fourth option alongside etcd/ZooKeeper/Consul. The manual install-and-YAML-file workflow this recipe teaches is still valid and is exactly what those operators automate under the hood — worth knowing when deciding whether to reach for the operator or roll a stack by hand.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 10, "High Availability with Patroni", p. 433-475](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [Patroni Documentation](https://patroni.readthedocs.io/en/latest/) — doc
- [Patroni — YAML Configuration Settings](https://patroni.readthedocs.io/en/latest/yaml_configuration.html) — doc
- [Patroni — Running Patroni on Kubernetes](https://patroni.readthedocs.io/en/latest/kubernetes.html) — doc
- [etcd Documentation](https://etcd.io/docs/latest/) — doc
