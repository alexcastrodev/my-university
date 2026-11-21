---
version: 1.0
updatedAt: 2026-11-21
---
# Design Principles: Well-Architected Pillars, Elasticity and Service Models

> Exam domain: **Cloud Concepts (24%)**, task statement 1.2 *Identify design principles of the AWS Cloud*.

---

## The AWS Well-Architected Framework

The Framework helps you understand the pros and cons of the decisions you make when building on AWS, and gives a consistent way to measure an architecture against best practices. A Well-Architected review is "a constructive conversation, not an audit".

The exam guide names **six pillars** (it never prints the word "six", it prints six names):

| Pillar | Intent | A typical scenario cue |
|--------|--------|------------------------|
| **Operational Excellence** | Support development and run workloads effectively, gain insight into operations, and keep improving processes and procedures | Infrastructure and operations defined as code, small frequent changes, runbooks, learning from incidents |
| **Security** | Protect data, systems and assets with a layered approach, starting from the shared responsibility model | Identity, data protection, detection, incident response |
| **Reliability** | A workload performs its intended function correctly and consistently when expected, across its lifecycle. Resilience (recovering from disruption) is the main focus | Automatic failover, backups, fault isolation, recovery testing |
| **Performance Efficiency** | Use computing resources efficiently to meet requirements, and keep that efficiency as demand and technology evolve | Choosing the right compute type, caching near users, reviewing choices when new offerings appear |
| **Cost Optimization** | Deliver business value at the lowest appropriate price point, while still meeting functional, performance, reliability, security and sustainability needs | Cloud financial management, usage awareness, right resources, continuous optimization |
| **Sustainability** | Reduce the environmental impact of running workloads: measure it, provision only what you need, improve efficiency, optimize data and processing | Higher utilization, no idle capacity, efficient hardware and managed services |

```text
 Well-Architected Framework (one document, current structure)
 |-- Cloud Foundations  : account and organization level decisions
 `-- Cloud Workloads    : the six pillars, each split into areas and capabilities
```

Facts worth keeping:

- **Six pillars**: Sustainability was added on December 2, 2021. "Five pillars" is outdated.
- **Not pillars**: resiliency (it is the focus of Reliability), elasticity, scalability, distributed systems, data consistency.
- **Framework vs Tool**: the Framework is the guidance. The **AWS Well-Architected Tool** is the console service where you answer questions about a workload, get recommendations and track improvements. It is available at no cost in the console.
- **Trade-offs**: you balance pillars by business context. A short-lived development environment may favor cost and sustainability over reliability. A mission-critical system may accept more cost for reliability. An online shop knows that performance affects revenue. **Security and operational excellence are generally not traded off** against the other pillars.

> Older study material says the Framework has "design principles" per pillar (for example "perform operations as code" or "stop guessing capacity") and a list of six general design principles. AWS restructured the Framework on 2026-11-16: the per-pillar whitepapers were merged, each pillar is now organized into areas and capabilities, and the classic "Design principles" pages were removed (they remain only in historical versions). The six pillar names did not change. Treat the old lists as historical wording: learn the intent of each pillar, and expect questions about the idea, not an exact principle sentence.

---

## Scalability and elasticity

| Term | Official idea | Memory cue |
|------|---------------|------------|
| **Scalability** | A measure of a system's ability to **grow** to accommodate more demand | Grow |
| **Elasticity** | Acquire resources as needed **and release them when no longer needed**, which in the cloud you can do automatically | Grow **and** shrink |

- **Horizontal scaling** adds more computers (more instances). **Vertical scaling** adds resources to one computer (a bigger instance type). Horizontally scaled systems can outperform vertically scaled ones by spreading work in parallel.
- **Amazon EC2 Auto Scaling** keeps a group between a minimum and a maximum size, launches or terminates instances with scaling policies, replaces impaired instances, and can balance instances across AZs. It has no extra fee, you pay for the resources.
- **Elastic Load Balancing (ELB)** spreads traffic across healthy targets in one or more AZs and checks target health. It raises availability and fault tolerance.

| Need | Use | Not |
|------|-----|-----|
| Add and remove instances as load changes, replace failed ones | EC2 Auto Scaling group | ELB (it does not launch instances) |
| Distribute requests and avoid unhealthy targets | Elastic Load Balancing | Auto Scaling (it does not route traffic) |
| Resize a single server from 4 to 16 vCPUs | Vertical scaling | Horizontal scaling |

```text
 users -> [ ELB, health checks ] -> instance (AZ-a)
                                 -> instance (AZ-b)   <- Auto Scaling group
                                 -> instance (AZ-c)      adds and removes these
```

---

## Loose coupling and no single point of failure

Components that depend on each other less can fail and scale independently. Putting a queue between "checkout" and "billing" means billing can lag or fail without breaking checkout. **Fault isolation** limits how far a failure spreads, and loosely coupled dependencies let a workload keep running when one dependency is impaired.

---

## Service models and serverless

| Model | AWS definition | Control |
|-------|----------------|---------|
| **IaaS** | Basic building blocks: networking, computers, storage | Most control, most management |
| **PaaS** | The provider removes the need to manage the underlying infrastructure so you focus on the application | Less to manage |
| **SaaS** | A complete application run and managed by the vendor | Least control |

- AWS publishes these three definitions but **does not classify its services** into them. Safe mappings: Amazon EC2 is a building block (IaaS-style). **AWS Elastic Beanstalk**: you upload code, and it provisions instances, configures load balancing, sets up health monitoring and scales the environment (PaaS-like).
- **Serverless** is AWS's own category for running code without managing servers: no server management, pay for use, automatic scaling from zero to peak, built-in high availability. Compute examples are **AWS Lambda** and **AWS Fargate**.
- Lambda is for short-lived tasks. As of 2026-11-21 its maximum timeout is 30 minutes. Older material says 15 minutes. The exam stresses the model (pay per use, no servers to manage), not the limit.
- Not stated by AWS: whether Lambda "is FaaS" or "is PaaS". Some books label it one way, some the other. Do not rely on either label.

---

## Automation and disaster recovery (background)

- **Infrastructure as code** provisions infrastructure from code instead of manual steps. Benefits: **repeatability** (the same environment again), **consistency** (fewer human errors and less drift) and **version control** (track and roll back changes). AWS services: AWS CloudFormation and the AWS CDK.
- **RTO** is the maximum acceptable delay between interruption and restored service. **RPO** is the maximum acceptable time since the last recovery point, so the maximum data loss window.

| DR approach | What runs in the recovery site | Cost and speed |
|-------------|--------------------------------|----------------|
| **Backup and restore** | Only backups | Cheapest, slowest recovery |
| **Pilot light** | Data replicated, core infrastructure ready, app servers switched off | Low cost, cannot serve traffic until started |
| **Warm standby** | A scaled-down, fully functional copy | Serves traffic at reduced capacity |
| **Multi-site active/active** | Full workload in every site | Highest cost, recovery near zero |

For the loss of a single data center, a highly available multi-AZ design may only need backup and restore. For the loss of a whole Region, consider the other three. AWS Elastic Disaster Recovery uses the pilot light strategy. The exam guide does not name these strategies, so weight them low.

---

## Watch out

- **Six pillars, with Sustainability.** An option that says five pillars or lists resiliency as a pillar is wrong.
- **Scalability grows, elasticity grows and shrinks automatically.** The cue "removes capacity when idle" means elasticity.
- **Auto Scaling replaces and sizes instances, ELB distributes and health-checks.** Neither one alone does both jobs, and EC2 Auto Scaling is about EC2 instances, not a generic "scale everything" switch.
- **Framework vs Tool.** The Framework is guidance, the Well-Architected Tool is the review service.
- **Security is not the pillar you relax.** Cost and reliability trade off by context, security and operational excellence generally do not.
- **Do not hinge an answer on an exact principle sentence.** The classic lists are historical since 2026-11-16.

## Quick check

1. Name the six pillars. **Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, Sustainability.**
2. A shop adds servers at peak and removes them at night, automatically. **Elasticity.**
3. Which tool lets a team answer questions about a workload and get an improvement plan? **AWS Well-Architected Tool.**
4. A team uploads code and wants AWS to handle provisioning, load balancing and scaling. **AWS Elastic Beanstalk.**
5. Which pillar tolerates lower reliability for a prototype, and which does not tolerate weaker security? **Reliability may relax for a prototype, security generally is not traded off.**

## Official documentation

- [Well-Architected Framework: definitions and terms](https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html)
- [Well-Architected Framework: welcome](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
- [Well-Architected Framework: release notes](https://docs.aws.amazon.com/wellarchitected/latest/framework/release-notes.html)
- [AWS Well-Architected Tool](https://docs.aws.amazon.com/wellarchitected/latest/userguide/tool.html)
- [Types of cloud computing](https://aws.amazon.com/types-of-cloud-computing/)
- [What is Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html)
- [What is Elastic Load Balancing](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)
- [Disaster recovery options in the cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
