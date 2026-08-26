---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn Cassandra's three-part security model — authentication (proving *who* is connecting), role-based authorization (controlling *what* that identity may do), and encryption (protecting data *in motion*, client-to-node and node-to-node) — and understand why every one of these is opt-in. The book is explicit that Cassandra's out-of-the-box posture is wide open: "Cassandra allows any client on your network to connect to your cluster... configured to use an authentication mechanism that allows all clients, without requiring that they provide credentials." Nothing here defaults to secure; every layer is a pluggable interface (`IAuthenticator`, `IAuthorizer`, `IRoleManager`, `IInternodeAuthenticator`) that you deliberately swap in.

## Use Cases

- Bootstrapping a new cluster's security from scratch: switching `authenticator` from `AllowAllAuthenticator` to `PasswordAuthenticator`, logging in with the built-in `cassandra`/`cassandra` superuser, and immediately rotating that password before doing anything else.
- Giving a microservice its own scoped credential — a `reservation_service` user with `SELECT` and `MODIFY` on exactly one keyspace — instead of sharing the superuser login across every application that touches the cluster.
- Grouping permissions into a role (`reservation_maintenance`) once a team grows past "just remember who has what," so adding or removing a person's access is one `GRANT`/`REVOKE` of a role rather than reconciling permissions per user.
- Restricting a role to specific data centers with `ACCESS TO DATACENTERS` on a multi-DC cluster, so an analytics role reading from a reporting DC can't touch the transactional DC.
- Encrypting node-to-node traffic (`server_encryption_options`) on a cluster that spans data centers or crosses any network boundary you don't fully control, and client-to-node traffic (`client_encryption_options`) for any application server reaching Cassandra over something less trusted than a private VPC.
- Locking down remote JMX access — required once a cluster is large enough that you can't just SSH into every node to run `nodetool` — with either a password file or Cassandra's own integrated authentication/authorization.
- Turning on audit logging ahead of a compliance review, scoped to a specific keyspace and category (`QUERY`, `DML`, `AUTH`, ...) so you can produce a record of who read or modified what, without paying the cost of logging every operation on the whole cluster.

## Deep Dive

### Authentication: pluggable, and off by default

The default authenticator, `org.apache.cassandra.auth.AllowAllAuthenticator`, performs no check at all. The alternative that ships with Cassandra is `org.apache.cassandra.auth.PasswordAuthenticator`, set in `cassandra.yaml`:

```yaml
authenticator: PasswordAuthenticator
```

Once that's live, `cqlsh` refuses anonymous connections outright (`AuthenticationFailed('Remote end requires authentication.')`). Cassandra ships a built-in superuser to get you past that first login: username `cassandra`, password `cassandra`. The book's very next move is to change it:

```sql
cassandra@cqlsh> ALTER USER cassandra WITH PASSWORD 'Kxl0*nGpB6';
```

and it flags a real operational trap along the way: `cqlsh` writes every command — including plaintext passwords typed on the command line — to `~/.cassandra/cqlsh_history`, so that history file needs clearing after you set a password. The `LOGIN` command lets you switch users inside a `cqlsh` session without reconnecting, and a `.cqlshrc` file lets you skip typing credentials on every invocation (at the cost of a plaintext password sitting in a dotfile you must then protect).

Authentication is genuinely pluggable beyond passwords: implement `IAuthenticator` for Kerberos or an LDAP-backed store (DataStax Enterprise and Instaclustr both ship such integrations), and separately, `IInternodeAuthenticator` controls which nodes are allowed to connect to each other at all — defaulting to `AllowAllInternodeAuthenticator`, which performs no check.

From application code, the DataStax Java driver authenticates with:

```java
CqlSession session = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("127.0.0.1", 9042))
    .withAuthCredentials("reservation_service", "i6XJsj!k#9")
    .build();
```

`withAuthCredentials()` registers the driver's default `PlainTextAuthProvider`; a custom `AuthProvider` implementation swaps in whatever the server side needs to match.

### Authorization: CassandraAuthorizer and the permission model

Authorization is a second, independent pluggable layer. The default, `org.apache.cassandra.auth.AllowAllAuthorizer`, grants every authenticated client access to everything — authentication alone buys you *identity*, not *restriction*. Turning on real access control means switching to `org.apache.cassandra.auth.CassandraAuthorizer`:

```yaml
authorizer: CassandraAuthorizer
```

With that in place, a non-superuser can browse schema (`DESCRIBE KEYSPACES`, `DESCRIBE TABLES`) but is denied on any actual data access until granted permissions explicitly:

```
reservation_service@cqlsh:reservation> SELECT * FROM reservations_by_confirmation;
Unauthorized: Error from server: code=2100 [Unauthorized]
  message="User reservation_service has no SELECT permission on
  <table reservation.reservations_by_confirmation> or any of its parents"
```

The fix is an explicit grant, scoped as narrowly or broadly as the resource hierarchy allows (keyspace, or a single table):

```sql
cassandra@cqlsh> GRANT SELECT ON KEYSPACE reservation TO reservation_service;
cassandra@cqlsh> GRANT MODIFY ON KEYSPACE reservation TO reservation_service;
```

The permission vocabulary, per `HELP PERMISSIONS`:

| Permission | Grants |
|---|---|
| `CREATE`, `ALTER`, `DROP` | Manage keyspaces, tables, functions, and roles |
| `SELECT` | Read data (and `get()` on MBeans) |
| `MODIFY` | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` (and `set()` on MBeans) |
| `AUTHORIZE` | `GRANT`/`REVOKE` other permissions — administrative delegation |
| `DESCRIBE` | Access to `DESCRIBE` output, since schema itself can be sensitive |
| `EXECUTE` | Invoke functions and MBean actions |

### Role-based access control

Starting with the 2.2 release, permissions attach to **roles**, not directly to individual login accounts — and a role can be granted to another role, or to a user, in any combination:

```sql
cassandra@cqlsh> CREATE ROLE reservation_maintenance;
cassandra@cqlsh> GRANT ALL ON KEYSPACE reservation TO reservation_maintenance;
cassandra@cqlsh> GRANT reservation_maintenance TO jeff;
```

A role created this way (no password, no login) can't be logged into directly — it exists purely as a bundle of permissions to be attached to real accounts. "Roles are additive in Cassandra, meaning that if any of the roles granted to a user have a specific permission granted, then that permission is granted to the user." There is no separate "user" concept at the storage level at all — Cassandra tracks both users and roles as rows in the same `system_auth` keyspace, which is why `CREATE USER` and `CREATE ROLE` are close cousins of the same underlying mechanism.

Cassandra 4.0 added a fourth pluggable layer, `INetworkAuthorizer`, to restrict a role to specific data centers:

```yaml
network_authorizer: CassandraNetworkAuthorizer
```

```sql
CREATE ROLE reservation_maintenance WITH ACCESS TO DATACENTERS {'DC1', 'DC2'};
```

> **`system_auth` replication is easy to forget.** The book flags this directly: `system_auth` ships with `SimpleStrategy` and `replication_factor: 1` out of the box, which means "any users, roles, and permissions you configure will not be distributed across the cluster until you reconfigure the replication strategy of the `system_auth` keyspace to match your cluster topology and run repair" on it. Skip that step on a multi-node cluster and your carefully configured roles may simply not exist consistently everywhere.

### Encryption: TLS in motion, not at rest

Cassandra encrypts data **in motion** — client-to-node and node-to-node — via TLS (still commonly called SSL after its predecessor protocol). As of the book's edition, encryption of **data files at rest is not supported** in open-source Cassandra; that gap is filled either by DataStax Enterprise or by storage-layer options like encrypted EBS volumes.

TLS setup starts with certificates — a public/private key pair per node, generated with the JDK's `keytool` for development clusters, or signed by a real CA for production:

```
$ keytool -genkey -keyalg RSA -alias node1 -keystore node1.keystore \
    -storepass cassandra -keypass cassandra \
    -dname "CN=192.168.86.29, OU=None, O=None, L=Scottsdale, C=USA"
```

Each node also needs a **truststore** containing the public keys of every peer it should trust, built by exporting and importing certificates between nodes' keystores and truststores.

**Node-to-node encryption** is `server_encryption_options` in `cassandra.yaml`:

```yaml
server_encryption_options:
    enabled: false
    internode_encryption: none   # none | rack | dc | all
    keystore: conf/.keystore
    keystore_password: cassandra
    truststore: conf/.truststore
    truststore_password: cassandra
```

`internode_encryption` chooses the blast radius: `all` encrypts every internode link, `dc` only cross-data-center traffic, `rack` only cross-rack. `require_client_auth` turns on mutual TLS between nodes; `require_endpoint_verification` checks the connecting node's name against its certificate.

**Client-to-node encryption** is the parallel `client_encryption_options` block, with its own `enabled`/`optional` toggle and its own keystore/truststore (which can reuse the node ones or be separate).

> **Prefer strong cipher suites by ordering them first.** `cipher_suites` is a priority list negotiated between client and server, "the same technique... your browser [uses] in negotiating with web servers." If you don't control every client, removing weak suites entirely closes off downgrade attacks rather than just deprioritizing them.

### JMX security

By default JMX — the interface `nodetool` and monitoring tools use — is only reachable from `localhost`. Exposing it remotely (`LOCAL_JMX=no` in `cassandra-env.sh`) is necessary at cluster scale but opens a real attack surface, so the book pairs it with either a `jmxremote.password`/`jmxremote.access` file pair (with SSL optionally layered on top via the same keystore/truststore machinery) or, from release 3.6 onward, routing JMX auth through Cassandra's own `PasswordAuthenticator`/`CassandraAuthorizer` instead of a separate credential store — configured via `DESCRIBE ON MBEANS`, `SELECT ON MBEAN`, `MODIFY ON MBEAN`, and `EXECUTE ON MBEAN` grants.

### Audit logging

Cassandra 4.0 added first-class audit logging (`org.apache.cassandra.audit`, the `IAuditLogger` interface), distinct from full query logging even though the two share implementation. Audit logging is scoped by keyspace, user, and category — `QUERY`, `DML`, `DDL`, `PREPARE`, `DCL`, `AUTH`, `ERROR`, `OTHER` — and configured in `cassandra.yaml`:

```yaml
audit_logging_options:
    enabled: true
    logger: FileAuditLogger
    included_keyspaces: reservation
    included_categories: QUERY,DML
```

Each entry records the actual CQL text plus user, host, and timestamp — the detail a compliance audit needs that a query-syntax-only full query log doesn't provide.

### Book vs today

> **Everything load-bearing in the chapter is unchanged in current Cassandra (5.0.x, mid-2026).** `AllowAllAuthenticator`/`AllowAllAuthorizer` are still the defaults; `PasswordAuthenticator`, `CassandraAuthorizer`, and `CassandraRoleManager` are still the opt-in replacements described in the book, with the same `CREATE ROLE` / `GRANT` / `ACCESS TO DATACENTERS` syntax. The default `cassandra`/`cassandra` superuser still exists exactly as the book describes.

> **Current docs add one detail the book doesn't mention: the default superuser's credentials are read at `QUORUM` consistency, not the cluster's usual read consistency.** This is a deliberate special case — a low-consistency read of superuser credentials during an outage could let a stale or missing credential lock out the one account guaranteed to exist. Current documentation gives the exact disable syntax the book's prose only describes: `ALTER ROLE cassandra WITH SUPERUSER = false AND LOGIN = false;` rather than `DROP USER`, since dropping it entirely can complicate recovery scenarios. The book's own advice — create a new superuser, then strip `cassandra`'s superuser status — points at the same practice; current docs just make the CQL explicit.

> **SSTable-level encryption at rest is still not in open-source Cassandra, even at 5.0.** The book's claim holds today: commit log and hints encryption have existed since the 3.x series (the JIRA tickets it cites, `CASSANDRA-11040` and `CASSANDRA-6018`), but full datafile (SSTable) encryption remains outside upstream Cassandra. The workaround is unchanged too — DataStax Enterprise, or full-disk/volume encryption (LUKS, cloud provider EBS-style disk encryption) managed entirely outside the database.

> **A password-strength guardrail is coming, but not yet in the 5.0 line the book targets.** CEP-24 (`CASSANDRA-17457`) adds a configurable password validator/generator, built on the Guardrails framework introduced in 4.1, that can warn on or reject weak `CREATE ROLE`/`ALTER ROLE` passwords. It shipped in the 5.1-alpha line, not 5.0 — worth knowing if you're planning around it, but it doesn't change anything about the 5.0 behavior described above.

> **The deprecated `ssl_storage_port` is exactly as the book describes and hasn't moved further.** Since 4.0, encrypted and unencrypted internode traffic can share the storage port, and the separate SSL storage port only matters when `enable_legacy_ssl_storage_port` is set during a 3.x-to-4.0 upgrade. That upgrade path is now old enough that most current clusters will never touch this setting, but the mechanism itself is unchanged.

## Trade-offs

- **Every security layer is opt-in, which means "secure by default" is not a thing you get for free.** A freshly installed Cassandra node accepts unauthenticated connections and authorizes them for everything. That's a deliberate design choice favoring ease of getting started over safe defaults — but it means security is a checklist you must actually run through (authenticator, authorizer, role manager, TLS, JMX) rather than a box you can leave unchecked and trust the platform to have covered.
- **The append/upsert data model has no equivalent safety net for credentials — a lost `cqlsh_history` password is not recoverable, only rotatable.** Every plaintext password typed at a `cqlsh` prompt or on a `LOGIN` command line lands in `~/.cassandra/cqlsh_history` by default. There's no undo; the mitigation is prompting for passwords interactively (never on the command line) and manually clearing history after any command that included one.
- **Roles are additive-only, which is simple to reason about and easy to over-grant.** Because permissions from every granted role simply union together, there's no way to grant a role and then subtract a specific permission from it for one user — the fix is always a more finely scoped role, not a negative grant. This pushes toward many small, narrowly scoped roles rather than a few broad ones, the same discipline the book's own `reservation_maintenance` example models.
- **TLS protects the wire, not the disk, and not the operator.** `server_encryption_options` and `client_encryption_options` stop an eavesdropper on the network from reading traffic — they say nothing about a stolen disk (no OSS SSTable encryption) or a superuser role that can already read anything RBAC lets it read. Defense in depth here means TLS, RBAC, and disk-level encryption are three separate investments, not one setting that covers all three.
- **Certificate operations are a real, ongoing cost that the "generate once" tutorial understates.** Every keystore/truststore pair needs distribution to the right nodes, every certificate has an expiry, and rotating a compromised CA means re-issuing everything signed under it. Cassandra 4.0's hot certificate reloading (`nodetool reloadssl`, or an automatic 10-minute reload) removes the downtime cost of rotation, but not the operational process of generating, signing, and distributing new certificates in the first place.
- **JMX is a second attack surface that's easy to secure the database and forget.** Locking down the native transport port with `PasswordAuthenticator` and `CassandraAuthorizer` while leaving JMX open to the network — or open with weak file-based credentials — leaves `nodetool`-level control of the cluster exposed. The book calls this out directly: "it would be a waste to invest your efforts in securing access to Cassandra via the native transport, but leave a major attack surface like JMX vulnerable."
- **Audit logging is scoped for a reason — logging everything has a real latency cost.** The feature is deliberately narrowable by keyspace, user, and category precisely because Cassandra's design goal for it was to "minimize the impact on read and write latency." Turning on unscoped audit logging across an entire busy cluster trades away some of the throughput the rest of this security model was careful not to touch.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022) — Chapter 14, "Security", p. 353-378](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) — doc
- [Apache Cassandra Documentation — Security (Authentication, Authorization, SSL/TLS, JMX, Audit Logging)](https://cassandra.apache.org/doc/latest/cassandra/operating/security.html) — doc
- [Apache Cassandra Documentation — cassandra.yaml (authenticator, authorizer, encryption options)](https://cassandra.apache.org/doc/latest/cassandra/configuration/cass_yaml_file.html) — doc
- [ASF Jira — CASSANDRA-17457, CEP-24 Password validation/generation](https://issues.apache.org/jira/browse/CASSANDRA-17457) — doc
- [Apache Cassandra Blog — 4.1 Features: Guardrails Framework](https://cassandra.apache.org/_/blog/Apache-Cassandra-4.1-Features-Guardrails-Framework.html) — doc
