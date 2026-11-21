---
version: 1.1
updatedAt: 2026-11-21
---
# AWS Pricing Models: On-Demand, Savings Plans, Reserved Instances, Spot and Dedicated Options

> Exam domain: **Billing, Pricing, and Support (12%)**, task statement 4.1 *Compare AWS pricing models*.

---

## What the exam wants

The guide lists the compute purchasing options (**On-Demand, Reserved Instances, Spot Instances, Savings Plans, Dedicated Hosts, Dedicated Instances, Capacity Reservations**), when to use each one, **Reserved Instance flexibility**, **how Reserved Instances behave in AWS Organizations**, **incoming and outgoing data transfer costs** and **pricing for storage options and tiers**. Almost every question is "which option fits this usage pattern", so learn the pattern first and the discount second.

---

## Pick the option from the usage pattern

| Usage pattern | Best fit | Why |
|---------------|----------|-----|
| Short, spiky or unpredictable work that must not be interrupted | **On-Demand** | No commitment, pay by the second for what you launch |
| Steady usage for 1 or 3 years, flexible about instance family, Region, or also Fargate and Lambda | **Compute Savings Plans** | Commit to a USD per hour amount, discount follows the usage |
| Steady usage in one instance family and Region | **EC2 Instance Savings Plans** or **Standard Reserved Instances** | Deepest commitment discount for EC2 |
| Steady usage, but you expect to change instance family or OS during the term | **Convertible Reserved Instances** | Can be exchanged for a different configuration |
| Flexible, fault-tolerant, restartable work (batch, analysis, rendering, CI) | **Spot Instances** | Spare capacity, deepest discount, can be interrupted |
| Server-bound licenses (per socket, per core, per VM) or rules that forbid sharing a physical server you cannot see | **Dedicated Hosts** | A whole physical server, socket and core visibility |
| Single-tenant hardware without license or placement control | **Dedicated Instances** | Hardware dedicated to your account, billed per instance |
| Guaranteed capacity in one AZ, with no long-term commitment | **On-Demand Capacity Reservations** | Reserves capacity, gives no discount by itself |

Rule of thumb: commitment buys a discount, interruption buys a bigger discount, and neither applies to work that is short and cannot stop.

---

## On-Demand and billing granularity

- **On-Demand**: no upfront payment and no term. The hourly rate is fixed, and you can start and stop at any time.
- On-Demand EC2 usage is billed **per second with a 60-second minimum** for Linux, Windows, RHEL and Ubuntu Pro (as of 2026-11-21). A few operating systems, such as SUSE Linux Enterprise Server, are still billed by the full hour.
- An instance that runs 2 hours 10 minutes 30 seconds on Linux pays for exactly that time, it is not rounded up to 3 hours.

---

## Savings Plans

A Savings Plan is a commitment to spend a **consistent amount in USD per hour** for **1 or 3 years**. Anything above the commitment is billed at On-Demand rates. Payment can be All Upfront, Partial Upfront or No Upfront.

| Type | Applies to | Flexibility | Max discount (up to, as of 2026-11-21) |
|------|-----------|-------------|-----------------------------------|
| **Compute Savings Plans** | EC2, AWS Fargate, AWS Lambda | Any instance family, size, AZ, Region, OS or tenancy | 66 percent |
| **EC2 Instance Savings Plans** | EC2 only | One instance family in one Region; size, AZ, OS and tenancy can change | 72 percent |
| **SageMaker Savings Plans** | Amazon SageMaker AI usage | Within SageMaker AI | 64 percent |
| **Database Savings Plans** | Eligible database usage | 1-year, no upfront only | 35 percent |

- Benefits are **shared across an AWS Organization by default**. The management account can limit sharing.
- Savings Plans **do not reserve capacity**. Use Capacity Reservations for that.
- **Spot usage is not covered** by Savings Plans.
- There is no Savings Plan for Amazon S3.

---

## Reserved Instances (RIs)

An RI is a commitment to a consistent instance configuration (instance type and Region) for **1 or 3 years**, with **All Upfront, Partial Upfront or No Upfront** payment. Longer term and more upfront give a deeper discount.

| | Standard RI | Convertible RI |
|--|-------------|----------------|
| Max discount (up to, as of 2026-11-21) | 72 percent | 66 percent |
| Can change | AZ, instance size (Linux), networking type | Instance family, OS, tenancy, payment option |
| Sell unused term in the **Reserved Instance Marketplace** | Yes | No |

**Capacity:** only a **zonal RI** (bought for a specific AZ) reserves capacity. A **regional RI** applies its discount to matching usage in any AZ of the Region (and across sizes) but reserves no capacity.

```text
Zonal RI     -> discount + capacity reserved in us-east-1a
Regional RI  -> discount in any AZ of us-east-1, no capacity reservation
Capacity Reservation -> capacity in one AZ, no discount by itself
```

**In AWS Organizations:** consolidated billing treats all accounts as one, so an unused RI hour bought by one account can discount matching usage in another. The purchasing account gets the benefit first. The **management account** can turn RI and Savings Plans discount sharing off for specific accounts.

**Other services with reservations** (Cost Explorer gives reservation recommendations for them): Amazon EC2, Amazon RDS, Amazon ElastiCache, Amazon OpenSearch Service, Amazon Redshift, Amazon MemoryDB and Amazon DynamoDB (reserved capacity). AWS Lambda and Amazon S3 have no reservations.

---

## Spot Instances

- Spot uses **spare EC2 capacity** at up to 90 percent off On-Demand (as of 2026-11-21).
- **Amazon EC2 sets the Spot price** for each instance type in each AZ and adjusts it gradually based on long-term supply and demand. You do not bid.
- When EC2 needs the capacity back, you get a **two-minute interruption notice**, and the instance is terminated, stopped or hibernated. A rebalance recommendation can arrive earlier when risk rises.
- Use it for flexible, interruptible work. Never for a database primary, a checkout service, or a job that cannot restart.

---

## Dedicated Hosts, Dedicated Instances, Capacity Reservations

| Need | Dedicated Host | Dedicated Instance |
|------|----------------|--------------------|
| Billing | Per host | Per instance |
| Socket and core visibility | Yes | No |
| Host affinity (instance stays on the same server) | Yes | No |
| Bring your own per-socket or per-core license | Yes | Only partial |

Dedicated Host Reservations give up to 70 percent off On-Demand Dedicated Host pricing. **Capacity Reservations** keep capacity in a specific AZ for as long as you need it; they are about availability, not price.

---

## Data transfer and storage pricing

```text
Internet ──(in: free)──> AWS Region ──(out to internet: charged)──> Internet
Region A ──(out of A: charged)──> Region B (in: free)
AZ 1 <──(charged in both directions for metered resources)──> AZ 2
```

- Data **in from the internet** is free. Data **out to the internet** is charged, in tiers that get cheaper with volume. The first 100 GB per month out to the internet is currently free, aggregated across services and Regions.
- Between Regions, the charge is on data **leaving the source Region**.
- Between AZs in the same Region, metered resources pay for traffic in both directions. Some services have free in-Region traffic, for example S3 to EC2 in the same Region.
- **Amazon S3** bills storage (size, duration, storage class), requests and retrievals, data transfer, management features and replication. Per-GB rates drop at higher volume tiers.
- **AWS Lambda** bills requests plus duration in GB-seconds. **Amazon Lightsail** sells fixed monthly bundles (compute, SSD storage, transfer allowance) for a predictable bill.

---

## AWS Free Tier (as of 2026-11-21)

- Accounts created **on or after July 15, 2025** choose a **Free account plan** or a **Paid account plan** at sign-up and receive **credits** to spend on AWS services.
- The **Free plan** currently lasts up to six months: it ends when that period passes or the credits run out, whichever comes first, and never charges you unless you upgrade to Paid. Some services are not available on it.
- **Always Free** offers (more than 30 services, for example Lambda requests each month) stay available with monthly limits and do not expire.
- **Paid plan** accounts can also use short-term **trials** of specific services.

> Older study material says the Free Tier has three types (Always Free, 12 Months Free, Trials) and that t2.micro is the free instance; the current official documentation says that model is the **legacy** Free Tier, kept only for accounts created before July 15, 2025 (12 months from account creation, pay-as-you-go above the limits). New accounts use the Free or Paid plan with credits.

---

## Watch out

- **Spot has no bidding.** EC2 sets the Spot price. A question that talks about "the highest bid wins" uses dated wording.
- **Scheduled Reserved Instances can no longer be purchased.** They are not a current option for a nightly or weekly window.
- **Only zonal RIs reserve capacity.** Regional RIs, Savings Plans and Spot give no capacity guarantee; Capacity Reservations do.
- **Compute vs EC2 Instance Savings Plans:** only Compute covers Fargate and Lambda and moves across Regions and families. EC2 Instance is locked to one family in one Region.
- **Only Standard RIs** can be sold in the Reserved Instance Marketplace. That is an EC2 feature, not AWS Marketplace.
- **Dedicated Host, not Dedicated Instance,** for per-socket or per-core licenses.
- **Inbound data is free; outbound is charged.** Cross-AZ traffic is not free either, which is why chatty Multi-AZ designs show transfer costs.
- **Spot is not for work that cannot be interrupted,** even when the question says "lowest cost".

---

## Quick check

1. A team moves workloads between instance families and Regions and also runs containers on Fargate. Which commitment? **Compute Savings Plans.**
2. Does a regional Reserved Instance guarantee capacity in an AZ? **No. Only a zonal RI (or a Capacity Reservation) does.**
3. Who sets the Spot price? **Amazon EC2, from long-term supply and demand. There is no bid.**
4. A company uploads 5 TB from its office into S3. Is the upload charged as data transfer? **No. Data in from the internet is free.**
5. Which EC2 option fits a per-core database license that must stay on the same physical server? **Dedicated Host.**

---

## Official documentation

- [Amazon EC2 billing and purchasing options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-purchasing-options.html)
- [Amazon EC2 Reserved Instances pricing](https://aws.amazon.com/ec2/pricing/reserved-instances/)
- [Savings Plans FAQ](https://aws.amazon.com/savingsplans/faq/)
- [Spot Instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-instances.html)
- [Dedicated Hosts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dedicated-hosts-overview.html)
- [Understanding data transfer charges](https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html)
- [RI and Savings Plans discount sharing](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ri-turn-off.html)
- [AWS Free Tier](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html)
