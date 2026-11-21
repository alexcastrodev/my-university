---
version: 1.0
updatedAt: 2026-11-21
---
# Database Services: RDS, Aurora, DynamoDB, ElastiCache and Picking by Access Pattern

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.4 *Identify AWS database services*.

---

## What the exam wants

The guide lists four skills for 3.4: tell an **EC2-hosted** database from an **AWS managed** one, recognize the **relational** services (Amazon RDS, Amazon Aurora), the **NoSQL** service (Amazon DynamoDB) and the **memory-based** service (Amazon ElastiCache), and name the **migration tools** (AWS DMS, AWS SCT). The in-scope database list adds Amazon DocumentDB and Amazon Neptune. Amazon Redshift is filed under Analytics, and you will see it here as the data warehouse choice.

Most questions describe a workload and ask which database fits. Read the access pattern, not the brand names.

---

## Pick the database by the access pattern

| The stem says | Service | Why |
|---------------|---------|-----|
| Relational schema, joins, transactions, standard SQL engine | **Amazon RDS** | Managed relational database: AWS handles setup, patching, backups and scaling chores |
| Relational, MySQL or PostgreSQL compatible, highest throughput and storage spread over three AZs | **Amazon Aurora** | AWS-built relational engine, compatible with MySQL and PostgreSQL |
| Key-value or document items, huge scale, single-digit millisecond reads, serverless | **Amazon DynamoDB** | Serverless NoSQL, no servers, no versions, no maintenance windows |
| Cache in front of a database, sessions, leaderboards, microsecond reads from memory | **Amazon ElastiCache** | In-memory cache with Valkey, Memcached or Redis OSS engines |
| MongoDB-compatible document database | **Amazon DocumentDB** | Same drivers and tools as MongoDB |
| Highly connected data: social graph, fraud rings, recommendations by relationship | **Amazon Neptune** | Managed graph database for billions of relationships |
| Years of data from many sources, complex reports, petabyte-scale analytics | **Amazon Redshift** | Managed data warehouse (analytics, not transactions) |

DynamoDB has no JOIN operator. If the stem needs joins across tables and transactions in standard SQL, it is pointing to a relational service.

---

## EC2-hosted vs AWS managed

```text
                     You manage on EC2        AWS manages on RDS
 Hardware            AWS                      AWS
 OS install/patch    You                      AWS
 DB software patch   You                      AWS
 Backups, HA, scale  You                      AWS
 Query tuning,       You                      You
 schema, app design
```

- AWS recommends RDS as the default for most relational deployments.
- Choose a database on EC2 when you need full control of the host operating system (a vendor tool that must run on the database server, an unsupported engine or version).
- **RDS Custom** (Oracle and SQL Server) is a managed middle ground that allows OS access, aimed at legacy and packaged applications. Standard RDS gives you no shell on the host.
- Query tuning stays with you even on RDS. "Managed" never means AWS optimizes your SQL.

---

## Amazon RDS in a few facts

- Engines (as of 2026-11-21): **IBM Db2, MariaDB, Microsoft SQL Server, MySQL, Oracle Database, PostgreSQL**. Aurora is documented as its own engine.
- Storage: General Purpose SSD and Provisioned IOPS SSD. For production OLTP AWS recommends **Multi-AZ plus Provisioned IOPS**.
- Storage autoscaling grows storage with no downtime. Changing the instance class (more CPU and memory) causes a short outage, shorter with Multi-AZ.
- Automated backups with **point-in-time recovery**: restore to any second inside the retention period. A restore always creates a **new** DB instance. Manual snapshots survive deletion of the instance.

---

## Multi-AZ vs read replicas

This is the most tested database decision. One is about surviving failure, the other about offloading reads.

| | Multi-AZ (DB instance) | Read replica |
|---|---|---|
| Purpose | **High availability and automatic failover** | **Read scaling** (reports, analytics, read-heavy apps) |
| Replication | Synchronous to a standby in another AZ | Asynchronous copy |
| Serves reads? | No, the standby is passive | Yes, read-only |
| Where | Another AZ in the same Region | Same AZ, another AZ or another Region |
| Failure handling | Automatic failover to the standby | Manual promotion to a standalone database (useful for disaster recovery) |

```text
 Multi-AZ:      [Primary AZ-a] ==sync==> [Standby AZ-b]   (no reads, takes over on failure)
 Read replica:  [Primary] --async--> [Replica] <-- reporting queries
```

A **Multi-AZ DB cluster** is a newer variant: one writer plus two readable standbys in three AZs. On the exam, when a stem says "standby", assume the classic Multi-AZ instance that serves no reads.

---

## Amazon Aurora

- Fully managed, compatible with **MySQL and PostgreSQL**, with higher throughput than the stock engines on similar hardware (the overview currently says up to 6x; learn "faster than standard MySQL and PostgreSQL", not the multiplier).
- Storage: each write is replicated synchronously to **six storage nodes across three AZs** in one Region. The cluster volume grows automatically.
- Compute: **one writer** plus up to 15 read-only **Aurora Replicas** that share the same volume. If the writer fails, a replica is promoted automatically.
- **Aurora Global Database**: one primary Region plus read-only secondary Regions, replication typically under a second, for global reads and Regional disaster recovery.

> Older study material says Aurora is "multi-master" while RDS is "single-master". The current Aurora documentation describes a single writer with readers, and the old multi-master page now redirects. Do not pick "multi-master" as the Aurora trait.

---

## Amazon DynamoDB

- Serverless, fully managed NoSQL: key-value and document models, single-digit millisecond performance at any scale.
- Data replicated across three AZs by default. **Global tables** make it multi-Region and multi-active.
- Capacity modes: **on-demand** (pay per request, scales instantly) or **provisioned**.
- All data is **encrypted at rest** by default, with an AWS owned key at no charge. You can switch to an AWS managed or customer managed key at any time.
- **DynamoDB Accelerator (DAX)**: an in-memory cache that takes eventually consistent reads from milliseconds to **microseconds**, API-compatible, so the application barely changes.

---

## Amazon ElastiCache

- In-memory cache, serverless or node-based, with three engines: **Valkey, Memcached and Redis OSS**.
- **Memcached**: the simplest model, multi-threaded nodes, scale out and in, plain object caching.
- **Valkey or Redis OSS**: richer features such as replication, Multi-AZ, persistence options, pub/sub and sorted sets (gaming **leaderboards**).
- Typical use: put it in front of RDS or another store to cut read latency and database load.

> Older study material says ElastiCache has two engines, Redis and Memcached. The current documentation lists three (Valkey, Memcached, Redis OSS). Amazon MemoryDB is a separate durable in-memory database and is out of scope for this exam.

---

## Moving databases: DMS and SCT

| Need | Tool |
|------|------|
| Move data with minimal downtime, keep source and target in sync until cutover | **AWS Database Migration Service (DMS)** |
| Same engine on both sides (Oracle to RDS for Oracle) | DMS alone |
| Different engines (Oracle to Aurora PostgreSQL): convert schema and code first | **AWS Schema Conversion Tool (SCT)** (or the DMS Schema Conversion feature), then DMS for the data |

DMS handles relational databases, data warehouses and NoSQL stores. SCT is a tool you download and run locally. More on migration services in lesson 1-3.

Not named in the exam guide: Amazon Timestream (time series database). Amazon QLDB is no longer documented by AWS, so do not treat a "ledger database" as a current answer.

---

## Watch out

- **Multi-AZ is for availability, read replicas are for read scaling.** "Reports slow down production" means a read replica. "Survive an AZ failure automatically" means Multi-AZ.
- **The Multi-AZ standby does not serve traffic.** Adding Multi-AZ does not speed up reads.
- **Multi-AZ is not a backup.** A table dropped by mistake is replicated to the standby too. Recover with point-in-time restore or a snapshot.
- **RDS does not mean AWS tunes your queries.** Schema design and query tuning stay with the customer.
- **DynamoDB is not relational.** No joins, so a stem that needs multi-table SQL joins wants RDS or Aurora.
- **DAX caches DynamoDB, ElastiCache caches anything.** "Microseconds for an existing DynamoDB table with no rewrite" means DAX.
- **SCT converts the schema, DMS moves the data.** A heterogeneous migration uses both.
- **Redshift is a warehouse, not an OLTP database.** It answers analytics over large history, not shopping-cart transactions.

## Quick check

1. Reporting queries slow down a production RDS database that already runs Multi-AZ. **Add a read replica and point the reports at it.**
2. A relational database must keep running if an AZ fails, with automatic failover. **RDS Multi-AZ.**
3. A mobile game needs a serverless key-value store with millisecond reads at any scale. **DynamoDB.**
4. Which ElastiCache engines support sorted sets for leaderboards? **Valkey and Redis OSS.**
5. Oracle to Aurora PostgreSQL with the source live until cutover. **SCT for the schema, DMS for the data.**

## Official documentation

- [What is Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
- [Working with read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)
- [What is Amazon Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html)
- [What is Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [Choosing an ElastiCache engine](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SelectEngine.html)
- [What is AWS DMS](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [What is Amazon Neptune](https://docs.aws.amazon.com/neptune/latest/userguide/intro.html)
