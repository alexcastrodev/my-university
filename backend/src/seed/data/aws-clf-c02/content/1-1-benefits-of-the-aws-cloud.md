---
version: 1.0
updatedAt: 2026-11-21
---
# Benefits of the AWS Cloud: Six Advantages, Global Infrastructure and Availability

> Exam domain: **Cloud Concepts (24%)**, task statement 1.1 *Define the benefits of the AWS Cloud*.

---

## What "cloud" means to AWS

AWS defines cloud computing as the **on-demand delivery of IT resources over the Internet with pay-as-you-go pricing**. Instead of buying, owning and maintaining data centers and servers, you rent what you need, when you need it, from a provider.

The exam guide asks for the **value proposition** of the AWS Cloud, the benefits of **global infrastructure** (speed of deployment, global reach) and the advantages of **high availability, elasticity and agility**. Everything below maps to one of those three.

---

## The six advantages of cloud computing

AWS publishes exactly six advantages. Learn the headings, because question stems paraphrase them.

| Advantage (AWS heading) | What it means | Scenario cue |
|-------------------------|---------------|--------------|
| **Trade fixed expense for variable expense** | No big upfront investment in data centers and servers. You pay only when you consume, and only for how much you consume | "Stop pre-buying hardware", "pay monthly by usage" |
| **Benefit from massive economies of scale** | Usage from a very large customer base is aggregated, so AWS achieves lower costs and passes lower pay-as-you-go prices on | "Why do prices fall as AWS grows?" |
| **Stop guessing capacity** | Use as much or as little as you need and scale up or down on short notice, instead of idle servers or too little capacity | "Cannot forecast traffic", "servers idle most of the month" |
| **Increase speed and agility** | New resources are a click away: weeks become minutes, and experiments get cheaper and faster | "Need a test stack tomorrow, not next quarter" |
| **Stop spending money running and maintaining data centers** | Focus on what differentiates the business, not on racking, stacking and powering servers | "Plan a server room", "staff busy with hardware" |
| **Go global in minutes** | Deploy in multiple Regions with a few clicks for lower latency and a better customer experience, at minimal cost | "Customers on another continent" |

```text
 On premises                          AWS Cloud
 -----------                          ---------
 buy servers first (fixed)    -->     pay per use (variable)
 guess peak capacity          -->     scale to actual demand
 weeks to provision           -->     minutes
 one site                     -->     many Regions
```

> Older study material says the heading is "Trade capital expense for variable expense"; the current official whitepaper says **fixed expense**. Both wordings appear in practice material, so recognize both. One study book also lists "cost efficiency, scalability, flexibility, reliability, security, sustainability" as the "six advantages". That is a generic list, **not** the AWS list. For an AWS exam, use the six above.

---

## Global infrastructure in one picture

| Building block | What it is | Why it matters |
|----------------|------------|----------------|
| **Region** | A physical location where AWS clusters data centers | Pick it for latency to users, price, service availability and where data is allowed to live |
| **Availability Zone (AZ)** | One or more discrete data centers with redundant power, networking and connectivity, inside a Region | Spread a workload across AZs to survive the loss of one |
| **Edge location** | A point of presence used by services such as Amazon CloudFront to cache content near users | Lower latency for end users, no change to where your data is stored |
| **Local Zone** | An extension of a Region that places some services closer to a metro area | Not a Region and not an AZ |

Facts you can rely on:

- Every Region has **a minimum of three AZs**, each isolated and physically separate.
- AZs are far enough apart to be isolated from common failures (they do not share generators or cooling), yet close enough, **up to about 60 miles (100 km)**, for synchronous replication at single-digit millisecond latency.
- Using multiple AZs isolates your application from problems in a single AZ, which is why AZs are the building block for high availability.
- Edge locations **cache** content. They are not where you replicate databases, and they do not give you a second copy of your data for recovery.

```text
              Region (for example eu-central-1)
   +--------------------------------------------------+
   |   AZ-a            AZ-b            AZ-c   (3 or more)
   |  [app][db]       [app][db]       [app][db]       |
   +--------------------------------------------------+
        ^                                   ^
        |  Internet users                   |
   Edge locations (CloudFront cache) ........
```

> As of 2026-11-21 the AWS Global Infrastructure page shows 39 geographic Regions with 124 AZs within them, and CloudFront states 750+ points of presence. These numbers move every year and old books print smaller ones, so treat them as "dozens of Regions and hundreds of edge locations". Do not memorize them.

Choosing a Region is a design decision about latency, cost, service availability and rules about where data may live. The AWS page that lists these four factors as a set was not readable when this course was checked (not stated by AWS in the sources we read), so use them as practical reasoning, not as a quotable AWS list.

---

## High availability and fault tolerance

| Term | Meaning | How you get it |
|------|---------|----------------|
| **Availability** | The percentage of time a workload is available for use (it does its agreed job when asked) | Redundancy, health checks, automatic recovery |
| **High availability (HA)** | A design that keeps the workload available despite failures of single components | Multiple AZs behind a load balancer |
| **Fault tolerance** | The ability to withstand the failure of a subsystem and keep working because **spare redundant capacity can take 100% of the failed part's work** | Redundant components in separate AZs |
| **Scalability and elasticity** | Capacity to match demand | Covered in lesson 1-2, a different goal from availability |

- 99.99% availability allows roughly **52 minutes** of interruption per year.
- Redundant independent components across AZs raise availability: two independent 99.9% components in parallel give 99.9999% in theory.
- A multi-AZ design provides both high availability and fault tolerance. Nothing in the official material says fault tolerance "requires" multiple Regions. Multi-Region designs are mostly a **disaster recovery** and latency choice (lesson 1-2).

> Not stated by AWS in the pages we read: a one-line rule such as "HA means zero interruption, fault tolerance means a short recovery". Some books teach that wording, and the official definitions do not say it. Rely on the definitions in the table.

---

## Deployment models (named in task 3.1, useful here)

| AWS name | Meaning |
|----------|---------|
| **Cloud** | All parts of the application run in the cloud (people often say "public cloud") |
| **On-premises** | Resources run in your own data center with virtualization tools (sometimes called "private cloud") |
| **Hybrid** | Cloud resources connected to existing non-cloud resources |

---

## Watch out

- **"Six advantages" means the AWS list.** If an option lists generic benefits (reliability, security, compliance) it is not the AWS six. The AWS six never include moving your security responsibility to AWS.
- **Economies of scale is why AWS lowers prices.** Pay-as-you-go is a pricing model, global infrastructure is reach, and reserved pricing is a commitment discount. None of them is the reason AWS can pass savings on.
- **Agility is speed, not cost.** Provisioning in minutes is agility. Matching size to usage is rightsizing (lesson 1-4).
- **At least three AZs per Region** is the official minimum. Older material says "two or more".
- **HA is not the same as elasticity.** Availability is uptime, elasticity is capacity following demand.
- **Edge locations never replicate your data.** They cache content for latency. For failure isolation use AZs, for disaster recovery use another Region.
- **A Local Zone is not an AZ** and not a Region.

## Quick check

1. A team needs a realistic test environment tomorrow instead of next quarter. Which advantage? **Increase speed and agility.**
2. What is the minimum number of AZs in an AWS Region? **Three.**
3. A workload must survive the loss of one data center building at modest cost. First design move? **Run it in multiple AZs of the same Region behind a load balancer.**
4. Why does the price per unit fall as AWS grows? **Massive economies of scale.**
5. Which building block caches content near users to cut latency? **Edge locations (for example through CloudFront).**

## Official documentation

- [Six advantages of cloud computing](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/six-advantages-of-cloud-computing.html)
- [AWS Regions and Availability Zones](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/)
- [Availability Zones and fault isolation](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html)
- [Fault tolerance and fault isolation](https://docs.aws.amazon.com/whitepapers/latest/availability-and-beyond-improving-resilience/fault-tolerance-and-fault-isolation.html)
- [Well-Architected concepts: availability](https://docs.aws.amazon.com/wellarchitected/latest/framework/concepts.html)
- [Types of cloud computing and deployment models](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/types-of-cloud-computing.html)
