---
version: 1.0
updatedAt: 2026-11-21
---
# Migrating to AWS: Strategies, the Cloud Adoption Framework and Migration Services

> Exam domain: **Cloud Concepts (24%)**, task statement 1.3 *Understand the benefits of and strategies for migration to the AWS Cloud*.

---

## Why migrate

The exam guide asks for the benefits of migrating, the **AWS Cloud Adoption Framework (AWS CAF)** and appropriate **migration strategies** (its example is database replication). AWS names these benefits of moving:

- Lower costs: replace upfront capital spend with low variable costs and optimize license and compute costs.
- No need to procure servers weeks or months in advance.
- Less technical debt through modernization.
- Higher uptime and efficiency.

---

## Migration strategies: the Rs

AWS Prescriptive Guidance lists **seven** strategies. Pick one per application by asking what you are willing to change.

| Strategy | Nickname | What you do | Scenario cue |
|----------|----------|-------------|--------------|
| **Rehost** | Lift and shift | Move the server as is, no application changes | "Move 200 VMs to EC2 unchanged" |
| **Replatform** | Lift, tinker and shift | Move with a small optimization, no core change | "Self-managed SQL Server to Amazon RDS for SQL Server" |
| **Repurchase** | Drop and shop | Replace with a different product, often SaaS | "Replace the in-house CRM with a SaaS CRM" |
| **Refactor** (re-architect) | Redesign | Change the architecture to use cloud-native features. Most complex and most costly | "Break the monolith into serverless services" |
| **Relocate** | Move without rewrite | Move servers or objects to the cloud version of the platform, or to another VPC, Region or account | "Move an RDS instance to another account" |
| **Retain** | Keep | Leave it where it is, not ready to move | "Not ready, revisit next year" |
| **Retire** | Decommission | Shut down or archive | "Application nobody uses" |

- Retire candidates include **zombie applications** (average CPU and memory below 5 percent) and idle ones (5 to 20 percent over 90 days), or applications with no inbound connections for 90 days.
- For large migrations the common choices are rehost, replatform, relocate and retire. Refactor is not recommended during a large migration because of its cost and complexity.
- The exam guide does not name the Rs. Expect a scenario and the question "which strategy fits?", not a count.

> Older study material says there are six Rs (rehost, replatform, repurchase, refactor, retire, retain). The current AWS Prescriptive Guidance lists **seven** by adding relocate. If a practice question offers six, the six are still valid strategies.

---

## AWS Cloud Adoption Framework (AWS CAF)

The AWS CAF uses AWS experience and best practices to help you digitally transform and reach business outcomes. Use it to find and prioritize opportunities, evaluate and improve cloud readiness, and evolve a transformation roadmap.

| Component | Items |
|-----------|-------|
| **Business outcomes** (the guide's examples) | **Reduce business risk** (better reliability, performance, security), **improve ESG performance** (environmental, social, governance), **grow revenue** (new products, customers, market segments), **increase operational efficiency** (lower operating cost, higher productivity, better employee and customer experience) |
| **Six perspectives** | **Business**, **People**, **Governance** (business side), **Platform**, **Security**, **Operations** (technical side) |
| **Four transformation domains** | Technology, Process, Organization, Product |
| **Four iterative phases** | Envision, Align, Launch, Scale |

| Perspective | One-line focus |
|-------------|----------------|
| Business | Cloud investments accelerate digital transformation and business outcomes (CEO, CFO, CIO) |
| People | The bridge between technology and business: culture, organization structure, leadership, workforce |
| Governance | Orchestrate cloud initiatives, maximize benefits and minimize transformation risk |
| Platform | A scalable hybrid cloud platform, modernized workloads, cloud-native solutions |
| Security | Confidentiality, integrity and availability of data and workloads |
| Operations | Deliver cloud services at the level the business needs |

> Not stated by AWS in the pages we read: what each phase does in detail. Learn only the four phase names.

---

## Migration services

```text
 Discover      Plan / business case     Convert schema     Move data / servers
 --------      --------------------     --------------     -------------------
 Application   Migration Evaluator      AWS SCT            AWS DMS (databases)
 Discovery     AWS Migration Hub        (DMS Schema        AWS Application
 Service                                 Conversion)        Migration Service
```

| Service | Use it to | Not for |
|---------|-----------|---------|
| **AWS Application Migration Service** | Rehost physical, virtual or cloud servers on Amazon EC2 with continuous block-level replication, automated conversion and orchestrated cutover, so downtime stays small | Moving a database schema between engines |
| **AWS Database Migration Service (DMS)** | Migrate relational databases, data warehouses and NoSQL stores, as a one-time move or **continuous replication** of changes. Works for same-engine and different-engine moves | Converting schema code |
| **AWS Schema Conversion Tool (SCT)** | **Convert a schema** from one database engine to another (for example Oracle to Aurora PostgreSQL), and convert SQL in application code | Moving the data itself |
| **Migration Evaluator** | Build a data-driven **business case**: projected cloud cost per scenario, right-sizing of over-provisioned servers, license analysis (BYOL versus License Included) | Running the migration |
| **AWS Application Discovery Service** | Collect usage and configuration data about on-premises servers and databases | Estimating prices |
| **AWS Migration Hub** | One place to discover servers, plan migrations and track status across tools | Moving data |

Rule of thumb for exam questions: **"convert the schema between different engines" means SCT; "move or keep replicating the data with minimal downtime" means DMS.** DMS now also offers a "DMS Schema Conversion" feature, so a question that has no SCT option may use it. Physical devices for moving data belong to the Snow Family, and DataSync moves data over the network (domain 3).

> Names in flux. The exam guide (version 1.3) still prints "AWS Application Migration Service", and the AWS product page now shows it as "AWS Transform MGN" (formerly AWS Application Migration Service). Application Discovery Service and AWS Migration Hub are "no longer open to new customers" (Migration Hub since 2025-11-07) and point to AWS Transform, yet the exam guide still lists them. Learn their purpose and use the guide's names in answers.

---

## Watch out

- **Rehost, replatform and refactor differ by how much you change.** No change means rehost, a small managed-service swap means replatform, a redesign for cloud-native means refactor.
- **Repurchase is a different product, not the same software moved.** Replacing an in-house system with SaaS is repurchase.
- **Retire is about applications nobody needs.** Retain is about applications you are not ready to touch.
- **SCT converts the schema, DMS moves the data.** A question about replication with minimal downtime is DMS, even though SCT can create DMS tasks.
- **Migration Evaluator builds the business case, Application Migration Service performs the server move.** Do not swap planning and doing.
- **The CAF outcomes in the guide are four: risk, ESG, revenue, operational efficiency.** Pair each scenario with the matching outcome.
- **Six perspectives, four of everything else.** Do not invent a "Cost" or "Compliance" perspective.

## Quick check

1. Move a server to EC2 with no changes. **Rehost.**
2. Replace an in-house HR system with a SaaS product. **Repurchase.**
3. Convert an Oracle schema to Aurora PostgreSQL, then replicate the data. **SCT for the schema, DMS for the data.**
4. Which tool builds a migration business case with right-sizing and license analysis? **Migration Evaluator.**
5. Name the six CAF perspectives. **Business, People, Governance, Platform, Security, Operations.**

## Official documentation

- [About the migration strategies](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html)
- [AWS Cloud Adoption Framework](https://aws.amazon.com/cloud-adoption-framework/)
- [AWS CAF perspectives](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/foundational-capabilities.html)
- [AWS Application Migration Service](https://aws.amazon.com/application-migration-service/)
- [What is AWS Database Migration Service](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [What is the AWS Schema Conversion Tool](https://docs.aws.amazon.com/SchemaConversionTool/latest/userguide/CHAP_Welcome.html)
- [Migration Evaluator](https://aws.amazon.com/migration-evaluator/)
- [What is AWS Migration Hub](https://docs.aws.amazon.com/migrationhub/latest/ug/whatishub.html)
