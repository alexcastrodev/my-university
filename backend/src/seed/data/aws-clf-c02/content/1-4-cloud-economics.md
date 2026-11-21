---
version: 1.0
updatedAt: 2026-11-21
---
# Cloud Economics: Fixed vs Variable Cost, Licensing and Rightsizing

> Exam domain: **Cloud Concepts (24%)**, task statement 1.4 *Understand concepts of cloud economics*.

---

## What the exam wants

The guide lists: **fixed versus variable costs**, **costs tied to on-premises environments**, **licensing strategies** (Bring Your Own License compared with included licenses), **rightsizing**, **benefits of automation** and **economies of scale**. Billing mechanics (Budgets, Cost Explorer, consolidated billing, support plans) belong to domain 4. This lesson is the "why is the cloud cheaper and how do I keep it cheap" model.

---

## Fixed versus variable expense

| | On premises | AWS |
|--|-------------|-----|
| When you pay | Before you use: you buy servers and build data centers for the peak | While you use: you pay when you consume, for how much you consume |
| Cost shape | Large upfront investment, then fixed | Variable, follows usage |
| Risk | Over-buy (idle servers) or under-buy (outage at the peak) | Capacity follows demand |

- The direction is always **upfront capital (fixed) to usage-based (variable)**. "Trade operating for capital" is backwards.
- You still pay for what you leave running. Variable only helps if you turn off or shrink what you do not use (for example a dev and test environment used about 40 of 168 weekly hours can cut its cost by roughly 75 percent by stopping when idle).

### Costs tied to on-premises environments

AWS emphasizes the items you stop paying for: buying and running data center hardware, **racking, stacking and powering servers**, and capacity you guessed too high. Think of the full **total cost of ownership (TCO)** of an on-premises environment as hardware, facility, power, networking, security and the people who run them, compared with usage-based cloud cost.

> Not stated by AWS in the pages we read: a formal rule for what belongs in a TCO (for example "facility security counts, a salary that continues does not"). It is accounting reasoning from older books, useful for thinking, not an AWS sentence.

AWS also frames cloud value as more than TCO. Its **Cloud Value Framework** has five areas: cost savings, staff productivity, operational resilience, business agility and sustainability.

---

## Economies of scale

AWS aggregates the usage of a very large number of customers, achieves higher economies of scale and passes lower pay-as-you-go prices on. This is the reason prices can fall. Pay-as-you-go itself, global infrastructure and reserved pricing are different things.

---

## Estimating and building the business case

| Need | Use |
|------|-----|
| Estimate the cost of an architecture **you plan to build** | **AWS Pricing Calculator**, a free web tool: model solutions before building, explore price points, review calculations, export to CSV or PDF |
| Build a business case for **migrating existing servers**: projected cloud cost, right-sizing, licenses | **Migration Evaluator** (lesson 1-3) |

Details of the Pricing Calculator: its estimates include upfront, monthly and annual costs, it does not account for Free Tier pricing and it uses 730 hours per month.

> Older study material says to use the "Simple Monthly Calculator" or a "TCO Calculator". The Simple Monthly Calculator is retired and replaced by the AWS Pricing Calculator. AWS pages we read do not mention a "TCO Calculator", so use the Pricing Calculator for estimates and Migration Evaluator for the migration business case.

---

## Rightsizing

**Rightsizing** is matching resource type and size to real usage, so you stop paying for idle capacity. A fleet averaging 8 percent CPU on large instances is a rightsizing candidate: move to smaller types.

| Tool | What it tells you |
|------|-------------------|
| **AWS Compute Optimizer** | Flags over-provisioned and under-provisioned resources and suggests better configurations: EC2 instances, Auto Scaling groups, RDS, unattached EBS volumes (not a full list) |
| **Cost Explorer rightsizing recommendations** | Savings by downsizing or terminating underutilized EC2 instances; AWS now points to Cost Optimization Hub for opportunities |

Rightsizing is a cost action. Agility (speed of provisioning) and elasticity (following demand) are different advantages.

---

## Licensing: BYOL versus License Included

| Model | Meaning | Where it fits |
|-------|---------|---------------|
| **Bring Your Own License (BYOL)** | You reuse a license you already own, within its terms | Per-socket, per-core or per-VM licenses: use **Dedicated Hosts**, which give comprehensive BYOL support |
| **License Included** | The license (for example Windows Server or SQL Server) is part of the price, with no separate purchase | You have no license and want the cost folded into the hourly rate. Available on EC2 and RDS |

- **Dedicated Host** is the answer for per-socket or per-core software licenses. **Dedicated Instances** run on dedicated hardware but give only partial BYOL support, so they are not the usual answer.
- **AWS License Manager** tracks license usage against your rules and can help convert between BYOL and License Included.
- RDS for Oracle currently offers License Included only for Standard Edition 2, while Enterprise Edition and Standard Edition 2 can use BYOL.
- Migration Evaluator compares BYOL with License Included as part of a business case.

---

## Automation and managed services

- **Automation** (infrastructure as code with AWS CloudFormation or the AWS CDK) brings repeatability, consistency and version control. Fewer manual steps means fewer errors and less labor cost.
- **Managed services** lower operating cost by moving undifferentiated work to AWS. Amazon RDS automates provisioning, configuration, backups and patching, which the page says would be time consuming, complex and expensive to run yourself. The hourly price of a managed service can be higher while the total cost, including labor, is lower. AWS does not publish that hourly comparison, so keep it as TCO reasoning.

---

## Watch out

- **Direction of the shift:** fixed or capital cost to variable or operating cost, never the reverse.
- **Economies of scale explains falling prices**, not pay-as-you-go and not reserved discounts.
- **Rightsizing is cost, agility is speed.** Resizing an oversized fleet is not agility.
- **Per-socket license means Dedicated Host**, not Dedicated Instance and not default tenancy.
- **Pricing Calculator estimates a plan, Migration Evaluator justifies a move.** Neither shows your actual bill (that is Cost Explorer, domain 4).
- **Pricing Calculator ignores the Free Tier.** Its numbers can be higher than what a new account pays.
- **Old calculator names are traps.** The Simple Monthly Calculator is retired.

## Quick check

1. A company replaces a data center purchase with pay per use. **Fixed (capital) expense becomes variable expense.**
2. Where do you estimate the cost of an architecture before you build it? **AWS Pricing Calculator.**
3. Instances average 8 percent CPU. **Rightsize to smaller types, guided by Compute Optimizer.**
4. A vendor licenses software per physical socket and you own the licenses. **BYOL on a Dedicated Host.**
5. Which benefits does infrastructure as code add? **Repeatability, consistency, version control.**

## Official documentation

- [Six advantages of cloud computing](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/six-advantages-of-cloud-computing.html)
- [AWS Cloud Economics](https://aws.amazon.com/economics/)
- [What is the AWS Pricing Calculator](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html)
- [Rightsizing recommendations in Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-rightsizing.html)
- [AWS Compute Optimizer](https://aws.amazon.com/compute-optimizer/)
- [Amazon EC2 Dedicated Hosts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dedicated-hosts-overview.html)
- [Oracle licensing on Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Oracle.Concepts.Licensing.html)
- [What is infrastructure as code](https://aws.amazon.com/what-is/iac/)
