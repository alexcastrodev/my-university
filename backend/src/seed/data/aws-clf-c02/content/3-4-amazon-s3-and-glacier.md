---
version: 1.0
updatedAt: 2026-11-21
---
# Object Storage: Amazon S3, Storage Classes, Lifecycle and S3 Glacier

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.6 *Identify AWS storage services*.

---

## What the exam wants

From task 3.6 this lesson covers **uses for object storage**, the **differences among S3 storage classes** and **use cases for lifecycle policies**, plus Amazon S3 Glacier. Lesson 3-5 covers block, file and hybrid storage and AWS Backup. Questions describe an access pattern and ask for a class: learn to read the pattern.

---

## Object storage in one paragraph

Amazon S3 stores **objects** (data plus a key and metadata) in **buckets**. You reach objects through the S3 API over HTTP(S), not as a disk attached to an instance. A bucket has no maximum size and no limit on the number of objects. Typical uses: backups and archives, data lakes, media files, static website assets, log storage.

- A general purpose bucket name must be unique across all accounts and Regions **within a partition** (the standard AWS partition, China, GovCloud and others). If another account owns the name, you cannot create it.
- Names are 3 to 63 characters of lowercase letters, numbers, periods and hyphens, and must begin and end with a letter or a number.
- A bucket is created in **one Region**, and its name and Region cannot be changed afterward.
- S3 is not a block device or an EC2 volume. (Tools such as Mountpoint for Amazon S3 can present a bucket as a local file system by translating file operations into S3 API calls, but the data is still objects.)

---

## Choose the storage class from the access pattern

Every class below is designed for **11 nines (99.999999999%) of durability**. The classes differ in availability, number of AZs, minimum storage duration and retrieval cost.

| Class | AZs | Minimum storage duration | Access | Pick it when |
|-------|-----|--------------------------|--------|--------------|
| **S3 Standard** | 3 or more | None | Milliseconds, no retrieval fee | Frequently accessed data |
| **S3 Intelligent-Tiering** | 3 or more | None | Milliseconds (frequent and infrequent tiers), no retrieval fee, small monitoring fee per object | Access pattern **unknown or changing** |
| **S3 Standard-IA** | 3 or more | 30 days | Milliseconds, per-GB retrieval fee | Rarely read but must be **available immediately** |
| **S3 One Zone-IA** | **1** | 30 days | Milliseconds, per-GB retrieval fee | Rarely read and **easy to re-create** (a lost AZ loses the data) |
| **S3 Glacier Instant Retrieval** | 3 or more | 90 days | **Milliseconds**, retrieval fee | Archive that is rarely read but still needs instant access |
| **S3 Glacier Flexible Retrieval** | 3 or more | 90 days | **Restore first**: minutes to hours | Archive where a wait of minutes or hours is fine |
| **S3 Glacier Deep Archive** | 3 or more | 180 days | **Restore first**: within 12 or 48 hours | Lowest-cost long-term retention, read maybe once a year |

- All classes except One Zone-IA (and S3 Express One Zone) are designed to survive the physical loss of an AZ.
- **Intelligent-Tiering** moves an object to an infrequent access tier after 30 consecutive days without access and to an archive instant access tier after 90 days, and brings it back when it is read. Optional archive tiers require a restore.
- **Reduced Redundancy Storage** still appears in old material; AWS recommends not using it.

```text
 hot ----------------------------------------------------------------> cold
 Standard  ->  Standard-IA / One Zone-IA  ->  Glacier Instant  ->  Glacier Flexible  ->  Deep Archive
 (no min)      (30 days)                       (90 days)           (90 days)             (180 days)
 unknown pattern?  ->  Intelligent-Tiering
```

**Not named in the exam guide (context only):** S3 Express One Zone is a newer single-AZ class with single-digit millisecond access, stored in directory buckets. The guide does not list it.

---

## Restoring from the Glacier classes

| Class | Expedited | Standard | Bulk |
|-------|-----------|----------|------|
| **Glacier Flexible Retrieval** | 1 to 5 minutes | 3 to 5 hours (default) | 5 to 12 hours, free |
| **Glacier Deep Archive** | Not available | Within 12 hours | Within 48 hours |

- **Glacier Instant Retrieval needs no restore**: a normal GET works in milliseconds.
- Provisioned capacity only guarantees that Expedited retrievals are available; it is not a retrieval tier.
- You can upload an object directly with the storage class `GLACIER` or `DEEP_ARCHIVE`, or move it there with a lifecycle rule.

> Older study material teaches "Amazon Glacier" vaults and archives as a separate service. The current official documentation says the standalone vault-based Glacier service is no longer accepting new customers; use the S3 Glacier storage classes inside S3.

---

## Lifecycle, versioning and replication

**Lifecycle rules** transition objects to cheaper classes as they age, and expire (delete) them when they are no longer needed. Transitions run in one direction, down the waterfall: Standard can go to any class, Standard-IA can go to Intelligent-Tiering, One Zone-IA or any Glacier class, and nothing moves out of Deep Archive by a lifecycle rule. By default, objects smaller than 128 KB are not transitioned.

Example: application logs are read daily for 30 days, kept for audit for 7 years, then deleted.

```json
{ "Rules": [ { "ID": "logs", "Status": "Enabled", "Filter": { "Prefix": "logs/" },
  "Transitions": [ { "Days": 30, "StorageClass": "STANDARD_IA" },
                   { "Days": 90, "StorageClass": "DEEP_ARCHIVE" } ],
  "Expiration": { "Days": 2555 } } ] }
```

The IA step lasts 60 days here, more than the 30-day minimum, so no early-deletion charge applies on the move to Deep Archive.

| Feature | What it does |
|---------|--------------|
| **Versioning** | Keeps every version of an object, protecting against overwrites and deletes. Disabled by default; a bucket is unversioned, versioning-enabled or versioning-suspended. A simple DELETE on a versioned object adds a delete marker |
| **Replication** | Copies objects asynchronously to another bucket: **Cross-Region Replication** (different Region) or **Same-Region Replication**. Both buckets must have versioning enabled |
| **Transfer Acceleration** | Speeds long-distance uploads and downloads through CloudFront edge locations |
| **Static website hosting** | Serves static files from a bucket; website endpoints are HTTP only. AWS now recommends AWS Amplify Hosting (with CloudFront and HTTPS) for static sites stored in S3 |

---

## Watch out

- **Rare access but instant read at low cost: Standard-IA or Glacier Instant Retrieval**, not Glacier Flexible or Deep Archive, which need a restore first.
- **Unknown or changing access pattern: Intelligent-Tiering.** It has no retrieval fee and no minimum duration.
- **One Zone-IA keeps data in a single AZ.** Use it only for data you can re-create. Its durability is still 11 nines; what is lower is resilience to losing the AZ.
- **Minimum storage duration** applies to IA (30 days), Glacier Instant and Flexible (90 days) and Deep Archive (180 days). Deleting earlier still bills the minimum.
- **Replication needs versioning on both buckets.**
- **Delete markers exist only in versioned buckets.**
- **Bucket names are unique within the partition**, so a name taken by any other account is unavailable.

> Older study material quotes a 5 TB object limit, a 100-bucket default quota and "six" S3 classes. The current official documentation gives larger limits and more classes; the limits change, so do not memorize them.

## Quick check

1. Data is read a few times a year but each read must return in milliseconds, at the lowest cost. Which class? **S3 Glacier Instant Retrieval.**
2. Nobody can predict how often a data set will be accessed. Which class? **S3 Intelligent-Tiering.**
3. Compliance records are kept for years and a 12-hour wait is acceptable. Cheapest class? **S3 Glacier Deep Archive.**
4. What must be enabled on both buckets for Cross-Region Replication? **Versioning.**
5. What moves objects to cheaper classes automatically as they age? **An S3 Lifecycle rule.**

## Official documentation

- [Amazon S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
- [Amazon S3 storage classes (product page)](https://aws.amazon.com/s3/storage-classes/)
- [General purpose bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)
- [Lifecycle transitions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
- [Archive retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)
- [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [Replicating objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)
