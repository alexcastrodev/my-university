---
version: 1.0
updatedAt: 2026-11-21
---
# Analytics Services: Athena, Glue, EMR, Kinesis, Redshift, OpenSearch and Amazon Quick

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.7 *Identify AI/ML services and analytics services* (analytics half).

---

## What the exam wants

The guide names Amazon Athena, Amazon Kinesis, AWS Glue and Amazon Quick as examples of data analytics services. Its in-scope analytics list adds **Amazon EMR, Amazon OpenSearch Service and Amazon Redshift**. Questions describe what someone wants to do with data, and one noun in the stem decides the service.

---

## The noun decides

| The stem says | Service | Shape |
|---------------|---------|-------|
| **Query** files in S3 with SQL, occasionally, pay per query, no servers | **Amazon Athena** | Serverless interactive SQL, billed by data scanned |
| **Transform**, clean, catalog and move data (ETL), discover schemas | **AWS Glue** | Serverless data integration with a central Data Catalog |
| **Cluster** of Hadoop or Spark for big data processing | **Amazon EMR** | Managed big data framework clusters |
| **Stream** of records in real time (clickstream, logs, IoT, orders) | **Amazon Kinesis** | Real-time streaming ingestion and delivery |
| **Warehouse** of years of structured data for complex reports | **Amazon Redshift** | Petabyte-scale data warehouse |
| **Search** and analyze logs or text in near real time | **Amazon OpenSearch Service** | Managed OpenSearch clusters (search and analytics engine) |
| **Dashboard** or BI visualization for business users | **Amazon Quick** | AI-powered BI and analytics, Quick Sight dashboards |

```text
 Sources --> Kinesis (stream) --+
                                +--> S3 data lake --> Glue (catalog, ETL) --> Athena (SQL)
 Databases --> Glue (ETL) ------+                                      \--> Redshift (warehouse)
                                                                        \--> EMR (Spark, Hadoop)
                                       Redshift / Athena --> Amazon Quick (dashboards)
```

---

## Amazon Athena

- Interactive query service that analyzes data **directly in Amazon S3** with standard SQL.
- **Serverless**: no infrastructure to set up, and you pay for the queries you run. For SQL queries the charge is based on the data each query scans (as of 2026-11-21), so a query that scans less data costs less.
- Athena is the "occasional ad hoc SQL on logs sitting in S3" answer. Redshift fits when the same large data is queried all day by many reports.

---

## AWS Glue

- Serverless **data integration**: discover, prepare, move and integrate data from many sources.
- Builds **ETL** (extract, transform, load) pipelines and keeps a central **Data Catalog** of your datasets and their schemas.
- Glue is a batch ETL and catalog service, not the real-time streaming answer.

---

## Amazon EMR

- Formerly Elastic MapReduce: managed clusters for **Hadoop, Spark** and related open-source frameworks.
- Fits "move our on-premises Hadoop or Spark jobs to AWS without managing the cluster software". EMR also transforms and moves large amounts of data, so it can run ETL.
- Managed scaling adds or removes cluster instances based on the workload.

---

## Amazon Kinesis

| Capability | Use it to |
|------------|-----------|
| **Kinesis Data Streams** | Ingest records in real time for **your own consumer applications**, which read them within a second |
| **Kinesis Data Firehose** (now called Amazon Data Firehose) | **Deliver** streaming data to S3, Redshift, OpenSearch Service and other destinations with **no consumer code** |
| **Kinesis Video Streams** | Stream live video from cameras and phones for analytics |
| **Kinesis Data Analytics** (now called Amazon Managed Service for Apache Flink) | Process streams with SQL, Java, Scala or Python |

Rule: **"custom real-time processing" means Data Streams; "just load the stream into S3 or Redshift" means Firehose.**

> Older study material uses "Kinesis Data Firehose", "Kinesis Data Analytics" and "Elasticsearch Service". The current documentation calls them Amazon Data Firehose, Amazon Managed Service for Apache Flink and Amazon OpenSearch Service. The exam guide lists only "Amazon Kinesis" and "Amazon OpenSearch Service".

---

## Amazon Redshift

- Fully managed, **petabyte-scale data warehouse** for analytics with SQL. **Redshift Serverless** removes cluster sizing.
- **Redshift Spectrum** queries files in S3 without loading them into Redshift tables.
- Redshift is for analytics (OLAP) over large history, not for an application's day-to-day transactions (OLTP), which belong in RDS, Aurora or DynamoDB.

---

## Amazon OpenSearch Service

- Managed service to deploy, operate and scale **OpenSearch** clusters (called domains). It also runs legacy Elasticsearch versions.
- OpenSearch is a search and analytics engine for use cases such as **log analytics, real-time application monitoring and clickstream analysis**, with OpenSearch Dashboards for visualization.

---

## Amazon Quick

- The exam guide calls it **Amazon Quick** (the documentation brands it AWS Quick). It replaced the stand-alone QuickSight name.
- An AI-powered service to analyze data, automate tasks and do research through natural-language chat over connected data.
- Its **Quick Sight** feature provides interactive dashboards, BI visualizations and embedded analytics. That is the part the exam tests: "business users need shareable dashboards from Redshift or Athena data".

> Older study material says "Amazon QuickSight". The exam guide (version 1.3) lists **Amazon Quick**, and QuickSight dashboards are now the Quick Sight feature of Amazon Quick.

Not named in the exam guide: AWS Lake Formation (fine-grained permissions on a data lake). Out of scope: Amazon MSK (managed Apache Kafka) and AWS Data Exchange.

---

## Watch out

- **Athena queries in place, Redshift loads into a warehouse.** "No infrastructure, pay per query, data already in S3" means Athena.
- **Glue is ETL and catalog, not streaming.** A "real-time" stem wants Kinesis.
- **Firehose delivers, Data Streams lets you build consumers.** "No custom code to load into S3" is Firehose.
- **EMR is the Hadoop or Spark answer.** If the stem names those frameworks, pick EMR over Glue.
- **Dashboards are Amazon Quick,** not Athena (which returns query results) and not OpenSearch (unless the stem is about log search).
- **Redshift is OLAP.** It is in the Analytics list, even though it is a database.
- **Use the guide's names in answers:** Amazon Quick, Amazon Kinesis, Amazon OpenSearch Service.

## Quick check

1. Analysts run a few SQL queries a week on log files in S3 and want no servers. **Amazon Athena.**
2. Clickstream events must land in S3 every few minutes with no consumer code. **Kinesis Data Firehose (now Amazon Data Firehose).**
3. An on-premises Spark cluster moves to a managed service. **Amazon EMR.**
4. Combine five years of sales data from several databases for complex reports. **Amazon Redshift.**
5. Executives want interactive dashboards on that warehouse. **Amazon Quick (Quick Sight).**

## Official documentation

- [What is Amazon Athena](https://docs.aws.amazon.com/athena/latest/ug/what-is.html)
- [What is AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html)
- [What is Amazon EMR](https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-what-is-emr.html)
- [Amazon Kinesis Data Streams](https://docs.aws.amazon.com/streams/latest/dev/introduction.html)
- [What is Amazon Data Firehose](https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html)
- [What is Amazon Redshift](https://docs.aws.amazon.com/redshift/latest/mgmt/welcome.html)
- [What is Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html)
- [What is AWS Quick](https://docs.aws.amazon.com/quicksight/latest/user/welcome.html)
