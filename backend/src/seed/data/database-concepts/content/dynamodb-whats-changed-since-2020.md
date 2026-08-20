---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Close out this batch of DynamoDB concepts with a short addendum: what AWS has actually shipped for DynamoDB since 2020 that isn't already covered elsewhere in this category. This concept has no book source at all — Alex DeBrie's *The DynamoDB Book* (2020) predates every feature below, and everything here is verified directly against current AWS documentation and AWS "What's New" announcements rather than assumed from training knowledge, because the exact dates and feature names are recent enough to be easy to get wrong. One closely-related feature is deliberately out of scope: PartiQL, DynamoDB's SQL-compatible query language, is already covered in full by the sibling `dynamodb-using-the-api-well-expressions-and-avoiding-orms` concept, which links its own `PartiQL for DynamoDB` reference — nothing more on it here. Four things are genuinely additive and net-new: a second, cheaper table class; a resource-level way to grant access; two no-code data pipelines out of DynamoDB; and, most recently, an opt-in strong-consistency mode for Global Tables that removes a limitation every DynamoDB concept before this one has taken for granted.

## Use Cases

- Storing years of application logs, superseded order history, or old gaming achievements in a table that's rarely read but has to stay queryable — a candidate for the **Standard-Infrequent Access (Standard-IA)** table class instead of Standard.
- Granting a partner account read access to one specific table, or a stream, without writing or maintaining a separate cross-account IAM role setup — a **resource-based policy** attached directly to that table or stream.
- Running BI dashboards or ad hoc SQL analytics on live DynamoDB data without hand-building a Streams-to-Lambda-to-Redshift pipeline — a **zero-ETL integration to Amazon Redshift**.
- Adding full-text or vector search on top of DynamoDB items — product catalogs, support tickets, user profiles — without standing up and syncing a separate OpenSearch ingestion pipeline yourself — a **zero-ETL integration to Amazon OpenSearch Service**.
- Building a multi-Region financial ledger, inventory count, or user-profile store where a reader in one Region must never see stale data written in another Region — **Multi-Region Strong Consistency (MRSC)** for Global Tables, opted into at table creation.

## Deep Dive

### Standard-IA table class (Dec 2021)

Announced December 1, 2021, the **DynamoDB Standard-Infrequent Access (Standard-IA)** table class sits alongside the original DynamoDB Standard class as a second, cost-optimized option. Per AWS's own framing, it is "optimized for tables where storage is the dominant cost. For example, tables that store infrequently accessed data, such as application logs, old social media posts, e-commerce order history, and past gaming achievements, are good candidates for the Standard-IA table class." The trade is explicit and symmetric: Standard-IA gives "60 percent lower storage costs than the existing DynamoDB Standard tables," but read and write request pricing is higher than Standard — the same shape as S3 Standard versus S3-IA, applied to a database instead of an object store. A table class is not a permanent choice: "you can change this setting using the AWS Management Console, AWS CLI, or AWS SDK," and every secondary index on a table always shares the table's class — there's no picking Standard-IA for the base table but Standard for a GSI.

### Resource-based policies (Mar 2024)

Announced March 20, 2024, resource-based policies let you attach a JSON access policy directly to a DynamoDB table, its indexes, or a stream, rather than expressing all access exclusively through IAM identity-based policies attached to users or roles. AWS's own description: "Resource-based policies let you define access permissions by specifying who has access to each resource, and the actions they are allowed to perform on each resource... the policy attached to a table will contain permissions for access to the table and its indexes." The headline use case is cross-account sharing: "a significant benefit of using resource-based policies is to simplify cross-account access control for providing cross-account access to IAM principals in different AWS accounts" — no more per-account role-assumption setup just to let a partner account read one table. A policy is capped at 20 KB, and the feature ships with two safety nets baked into the console workflow: **IAM Access Analyzer**'s external access analyzer reports any cross-account access a resource-based policy grants, and **Block Public Access (BPA)** is "automatically enabled in the resource-based policies creation and modification workflows" to keep a misconfigured policy from accidentally exposing a table publicly. The feature is available across all AWS Commercial Regions at no additional cost.

### Zero-ETL integrations to Redshift and OpenSearch (2023-2024)

DynamoDB now ships two managed, no-code data pipelines out of a table, both under the "zero-ETL" name AWS uses across several services:

- **Redshift.** Announced in preview in November 2023 and generally available as of October 15, 2024: "Amazon DynamoDB zero-ETL integration with Amazon Redshift is now generally available, enabling customers to run high-performance analytics on their DynamoDB data in Amazon Redshift with no impact on production workloads running on DynamoDB." Mechanically, "as data is written into a DynamoDB table, it is seamlessly made available in Amazon Redshift, eliminating the need for customers to build and maintain complex data pipelines for performing extract, transform, and load (ETL) operations." It targets a Redshift Serverless workgroup or a provisioned cluster on RA3 instances, configured from the console, CLI, or Redshift APIs.
- **OpenSearch Service.** Announced November 28, 2023, this integration "provides customers advanced search capabilities, such as full-text and vector search, on their Amazon DynamoDB data," set up "with a few button clicks in the AWS console" — the service "automatically understand[s] the format of the data in Amazon DynamoDB tables and map[s] the data to your index mapping templates." It also supports fanning multiple source tables into one destination: "consolidate data from multiple Amazon DynamoDB tables into one Amazon OpenSearch managed cluster or serverless collection to offer holistic insights."

Both integrations replace what used to be a hand-rolled DynamoDB Streams-plus-Lambda (or Kinesis) pipeline — see the sibling `dynamodb-advanced-concepts-streams-ttl-partitions-consistency` concept for how Streams itself works — with a managed, declarative sync that AWS operates end to end.

### Multi-Region Strong Consistency for Global Tables (GA June 2025)

Global Tables' original consistency model — the one every other concept in this category that mentions replication assumes — is **multi-Region eventual consistency (MREC)**: each Region's replica accepts local writes and asynchronously propagates them, so a reader in Region B can briefly see stale data relative to a very recent write in Region A. Previewed December 3, 2024 and generally available as of June 30, 2025, **Multi-Region Strong Consistency (MRSC)** is a second, opt-in consistency mode for Global Tables that closes that gap: it targets applications needing "a recovery point objective (RPO) of zero," and current AWS documentation describes Global Tables as supporting exactly "two consistency modes: multi-Region eventual consistency (MREC) and multi-Region strong consistency (MRSC)."

Three mechanical constraints matter more than the marketing framing:

- **It's a creation-time choice, not a toggle.** "If you do not specify a consistency mode when creating a global table, the global table defaults to multi-Region eventual consistency (MREC)... You cannot change a global table's consistency mode after creation." Choosing MRSC — or not — has to happen at design time.
- **Same-account only.** "Global tables configured for MRSC only support same-account configurations" — the newer multi-account Global Tables model (separate IAM/KMS/billing boundaries per account) is not compatible with MRSC.
- **No application changes required, but Region-limited at GA.** "Global tables use existing DynamoDB APIs to read and write data to your tables, so no application changes are required," and billing follows "current global tables pricing" with no separate line item called out. At GA, MRSC is available in ten Regions: US East (N. Virginia), US East (Ohio), US West (Oregon), Europe (Ireland, London, Paris, Frankfurt), and Asia Pacific (Tokyo, Seoul, Osaka) — narrower than the full set of Regions where Global Tables itself, or MREC, runs.

## Trade-offs

- **Standard-IA only wins if storage genuinely dominates.** Higher per-request pricing means a table with a small item count but constant read/write traffic can end up *more* expensive on Standard-IA than Standard — the 60% storage discount only pays for itself when storage cost, not throughput, is the line item you're trying to shrink.
- **Resource-based policies add a second place authorization can live.** Once a table has both an identity-based policy on the caller's role and a resource-based policy on the table itself, granting or debugging access means reasoning about the *combination* of both — the same category of complexity S3 bucket policies introduced years earlier, now available on DynamoDB too.
- **Zero-ETL is a fixed pipeline shape, not a general replication tool.** It moves data to exactly Redshift or exactly OpenSearch, on AWS's schedule and schema-inference logic — a workload needing a different destination, custom transformation, or tighter latency control still needs a hand-built Streams-based pipeline, not a checkbox.
- **MRSC's Region list and same-account restriction are real adoption blockers today.** A globally-distributed application already spanning Regions outside the ten supported at GA, or already using the multi-account Global Tables model for governance reasons, cannot adopt MRSC without restructuring — and because the consistency mode is locked in at table creation, retrofitting it onto an existing MREC global table means standing up a new table, not flipping a setting.
- **All four features are recent enough to verify before depending on them.** Two GA'd within the last two years (resource-based policies, Redshift zero-ETL) and one within the last two months of this writing (MRSC) — exactly the kind of detail — exact Region lists, pricing, same-account constraints — that changes fastest and is worth re-checking against live AWS documentation rather than this concept, before it ships in production.

## Documentation Links

- [AWS Documentation — DynamoDB table classes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.TableClasses.html) — doc
- [AWS What's New — Amazon DynamoDB Standard-Infrequent Access table class (Dec 2021)](https://aws.amazon.com/about-aws/whats-new/2021/12/amazon-dynamodb-standard-infrequent-access-table-class/) — doc
- [AWS Documentation — Using resource-based policies for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/access-control-resource-based.html) — doc
- [AWS What's New — Amazon DynamoDB now supports resource-based policies (Mar 2024)](https://aws.amazon.com/about-aws/whats-new/2024/03/amazon-dynamodb-resource-based-policies/) — doc
- [AWS What's New — General availability of Amazon DynamoDB zero-ETL integration with Amazon Redshift (Oct 2024)](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-dynamodb-zero-etl-integration-redshift/) — doc
- [AWS What's New — Amazon DynamoDB zero-ETL integration with Amazon OpenSearch Service (Nov 2023)](https://aws.amazon.com/about-aws/whats-new/2023/11/amazon-dynamodb-zero-etl-integration-amazon-opensearch-service) — doc
- [AWS Documentation — Global tables: multi-active, multi-Region replication](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html) — doc
- [AWS What's New — Amazon DynamoDB global tables with multi-Region strong consistency generally available (Jun 2025)](https://aws.amazon.com/about-aws/whats-new/2025/06/amazon-dynamo-db-global-tables-multi-region-strong-consistency-generally-available/) — doc
