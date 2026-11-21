---
version: 1.0
updatedAt: 2026-11-21
---
# AWS Global Infrastructure: Regions, Availability Zones, Edge Locations and Outposts

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.2 *Define the AWS global infrastructure*.

---

## What the exam wants

You must know how **Regions, Availability Zones (AZs) and edge locations** relate, why **multiple AZs** give high availability, that **AZs do not share single points of failure**, and **when to use multiple Regions**: disaster recovery, business continuity, low latency for distant users and data sovereignty.

---

## The three building blocks

| Block | What it is | Main use |
|-------|------------|----------|
| **Region** | A geographic area made of multiple independent, physically separate AZs. Region infrastructure and services are isolated from other Regions | Where your resources and data live |
| **Availability Zone** | One or more discrete data centers with independent and redundant power, networking and connectivity | Fault isolation inside a Region |
| **Edge location (point of presence, POP)** | A CloudFront site that serves popular content close to viewers | Lower latency for end users |

```text
                         Region (us-west-2)
   +------------------------------------------------------------+
   |   AZ 1                 AZ 2                 AZ 3 (or more)  |
   |  [data center(s)]     [data center(s)]     [data center(s)]  |
   |        <==== high-bandwidth, low-latency metro fiber ====>   |
   +------------------------------------------------------------+
                ^ origin
                |
   regional edge cache  (content not popular enough for a POP)
                ^
                |
   edge locations / POPs near viewers  <---  users
```

---

## Regions

- **Choosing a Region**: the services and features it offers, latency to most of your users, and legal requirements about where data may be stored. Services are not all available in every Region, so check before you design.
- Data stays in the Region you choose unless you copy or replicate it yourself.
- Regions introduced after March 20, 2019 are **opt-in**: an account must enable them before use. Older Regions are enabled by default.
- AWS GovCloud (US) and the China Regions need separate account types and cannot be reached from a standard AWS account.
- A Region code looks like `eu-west-1`; a Regional endpoint looks like `https://dynamodb.us-west-2.amazonaws.com`.

> As of 2026-11-21 the AWS Global Infrastructure page currently shows 39 geographic Regions and 124 AZs, with more announced. Books print older, smaller numbers. Counts change every year: do not memorize them.

---

## Availability Zones

- **Each Region has at least three AZs.**
- AZs are separated by many kilometers from each other, yet all AZs in a Region are within 100 km (60 miles) of each other, linked by redundant dedicated metro fiber.
- AZs do not share power, networking or connectivity, so a failure in one AZ (a flood, a power loss) does not take down the others.
- AZ IDs (for example `euw1-az1`) name the same physical AZ in every account; AZ names such as `us-east-1a` can map to different physical AZs in different older accounts.

> Older study material says "at least two AZs per Region". The current official documentation says each Region has at least three.

---

## Multi-AZ versus multi-Region

| Requirement | Design |
|-------------|--------|
| Survive the loss of one data center or one AZ | Run across **multiple AZs in one Region** (for example behind a load balancer) |
| Be highly available and fault tolerant at the lowest added cost | **Multiple AZs** in one Region |
| Recover from the loss of a whole Region (disaster recovery, business continuity) | **Multiple Regions** |
| Low latency for users on another continent | A **second Region** near them, or **edge locations** for cacheable content |
| Data must stay in a given country (data sovereignty) | A **Region in that country**, and no replication outside it |

Using multiple AZs lets production applications be more highly available, fault tolerant and scalable than a single data center allows. Nothing in the official material says fault tolerance requires multiple Regions.

---

## Edge locations and regional edge caches

- CloudFront POPs (edge locations) cache popular content close to viewers. DNS sends a request to the POP that can best serve it, typically the nearest in latency.
- **Regional edge caches** sit between the POPs and your origin and hold content that is not popular enough to stay at a POP, still closer to viewers than the origin.
- Services that run their data plane at POPs include Amazon CloudFront, Amazon Route 53, AWS WAF for CloudFront, AWS Global Accelerator and AWS Shield Advanced.
- Edge locations **do not** run your EC2 instances or databases and do not hold your primary copy of data.

> As of 2026-11-21 CloudFront currently lists 750+ POPs and 15 regional edge caches. Treat these as "hundreds of POPs, a few regional caches".

---

## AWS Outposts: AWS on your premises

- A fully managed service that extends AWS infrastructure, services, APIs and tools to your own data center or site, with the same programming interfaces as in a Region.
- Form factors: **Outposts racks** (42U) and **Outposts servers** (1U or 2U). AWS owns and manages the hardware and operates the capacity as part of a Region.
- Supported resources include EC2 instances, EBS volumes, ECS clusters, EKS nodes, RDS DB instances (on racks) and S3 on Outposts.
- Cue: "process data on site for latency or residency rules, but use the same AWS APIs".

**Not named in the exam guide (context only):** AWS Local Zones place compute, storage and select services near large population and industry centers for low-latency use cases such as gaming or live streaming; they extend a Region and are neither a Region nor an AZ. AWS Wavelength (compute at the edge of telecom 5G networks) is explicitly out of scope.

---

## Global, regional and zonal resources

| Scope | Examples |
|-------|----------|
| **Global** (not tied to a Region) | IAM, AWS Organizations, Route 53, CloudFront, Global Accelerator |
| **Regional** | S3 buckets (created in one Region, which cannot be changed), AMIs |
| **Zonal** | EBS volumes (replicated within one AZ), EC2 instances (each one runs in one AZ) |

An IAM user works in every Region. An AMI belongs to a Region, so you copy it to use it elsewhere. The S3 console looks "global", but each bucket lives in the one Region you picked.

---

## Watch out

- **Three AZs minimum.** Answers saying "at least two" use the old rule.
- **AZ failure: multiple AZs. Region failure: multiple Regions.** Do not pay for multi-Region when the requirement is only "survive one data center".
- **Edge locations cache, they do not host workloads.** Caching never replaces a backup or a second Region.
- **Data sovereignty is a Region choice.** AWS does not move your data to another Region by itself.
- **Missing service?** Service availability varies by Region; choose a Region that offers it.
- **Outposts is on premises; a Local Zone is near a city.** Only Outposts is in the exam's service list.
- **Global services**: IAM, Route 53 and CloudFront are global; EC2 and RDS are not.

## Quick check

1. What is the minimum number of AZs in a Region? **Three.**
2. An application must survive a flood in one data center at the lowest added cost. Design? **Multiple AZs in one Region.**
3. Regulators require customer data to stay in Germany. What decides compliance first? **Choosing a Region in Germany and not replicating outside it.**
4. Which infrastructure serves cached images close to viewers? **CloudFront edge locations (POPs).**
5. A factory must run EC2 workloads on its own floor with AWS APIs. Which service? **AWS Outposts.**

## Official documentation

- [AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
- [AWS Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)
- [Availability Zones and fault isolation](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html)
- [Global services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/global-services.html)
- [How CloudFront works with regional edge caches](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html)
- [What is AWS Outposts](https://docs.aws.amazon.com/outposts/latest/userguide/what-is-outposts.html)
- [AWS Regions and Availability Zones (global infrastructure)](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/)
