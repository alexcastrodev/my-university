---
version: 1.0
updatedAt: 2026-11-21
---
# AWS Support Plans and Technical Resources: Trusted Advisor, Health Dashboard, Partners and Where to Get Help

> Exam domain: **Billing, Pricing, and Support (12%)**, task statement 4.3 *Identify AWS technical resources and AWS Support options*.

---

## What the exam wants

The guide lists the **AWS Support plans** (Basic Support, AWS Business Support+, AWS Enterprise Support, AWS Unified Operations), the **AWS Support Center**, **AWS Trusted Advisor**, the **AWS Health Dashboard** and **AWS Health API**, the **AWS Trust and Safety team**, the **AWS Partner Network**, **AWS Marketplace**, **AWS Professional Services**, **AWS solutions architects**, and self-service resources such as docs, whitepapers, blogs, **AWS Prescriptive Guidance**, **AWS Knowledge Center** and **AWS re:Post**. Support questions compare plans: which is the lowest plan that gives a feature.

---

## The four current Support plans (as of 2026-11-21)

Each paid plan builds on the one below it.

| Feature | Basic | Business Support+ | Enterprise Support | Unified Operations |
|---------|-------|-------------------|--------------------|--------------------|
| Price | Free, included | Paid | Paid | Paid, highest tier |
| Account and billing help, service quota requests | Yes, 24x7 | Yes | Yes | Yes, with a Senior Billing and Account Specialist |
| Technical support cases | No | Yes, 24x7 phone, web and chat, unlimited cases | Yes | Yes |
| Trusted Advisor | Core checks | Full checks | Full checks plus **Trusted Advisor Priority** | Full checks plus Trusted Advisor Priority |
| AWS Health API, AWS Support API | No | Yes | Yes | Yes |
| Third-party software support | No | Yes | Yes | Yes |
| **Designated Technical Account Manager (TAM)** | No | No | **Yes** | **Yes**, plus a Domain Specialist Engineer |
| Proactive programs | No | No | Strategic business reviews, AWS Countdown | 24/7 workload monitoring, Infrastructure Event Management, critical workload reviews |

Remember the ladder: Basic has **no technical cases**, Business Support+ is the **lowest plan with technical support and full Trusted Advisor**, Enterprise Support is the **lowest plan with a designated TAM**, and Unified Operations is the plan AWS recommends for **mission-critical workloads**.

### First-response targets (as of 2026-11-21)

| Case severity | Business Support+ | Enterprise Support | Unified Operations |
|---------------|-------------------|--------------------|--------------------|
| General guidance | 24 hours | 24 hours | 24 hours |
| System impaired | 12 hours | 12 hours | 12 hours |
| Production system impaired | 4 hours | 4 hours | 4 hours |
| Production system down | 1 hour | 1 hour | 1 hour |
| Business-critical system down | under 30 minutes | under 15 minutes | 5 minutes |

AWS makes "every reasonable effort" to meet these targets; they are not a guaranteed SLA. The exam tests the order (Unified Operations fastest, then Enterprise Support, then Business Support+), not the minutes.

### How the fee works (as of 2026-11-21)

Paid plans charge the greater of a monthly minimum or a percentage of your monthly AWS charges, with **banded** rates: each percentage applies only to its slice of spend. Current minimums: Business Support+ USD 29, Enterprise Support USD 5,000, Unified Operations USD 50,000 per month. Fees are calculated per account in an organization.

> Older study material says there are five plans: Basic, Developer, Business, Enterprise On-Ramp and Enterprise. The current official documentation says Developer Support and Business Support closed to new subscriptions on December 2, 2025, and Developer, Business and Enterprise On-Ramp are discontinued on January 1, 2027. The current plans are Basic, Business Support+, Enterprise Support and Unified Operations. Where an old question answers "Business", today's answer is Business Support+.

---

## AWS Trusted Advisor

Trusted Advisor inspects your account and recommends how to save money, improve performance and availability, and close security gaps. Six check categories today:

| Category | Example of what it flags |
|----------|--------------------------|
| **Cost optimization** | Idle or underused resources you still pay for |
| **Performance** | Resources that limit throughput |
| **Security** | Root account without MFA, unrestricted security group ports, public S3 or snapshot permissions |
| **Fault tolerance** | Missing redundancy or backups |
| **Service limits** | Usage close to a service quota |
| **Operational excellence** | Gaps in operational best practices |

- **Basic** gets the core checks: all **Service limits** checks plus a few selected Security and Fault tolerance checks (such as MFA on the root account, S3 bucket permissions, and public EBS or RDS snapshots).
- **Business Support+, Enterprise Support and Unified Operations** unlock the full set of checks and the Trusted Advisor API.
- **Trusted Advisor Priority** needs Enterprise Support or Unified Operations.

> Older study material says Trusted Advisor has five categories; the current official documentation lists six, adding **Operational excellence**.

---

## AWS Health Dashboard and AWS Health API

- The **AWS Health Dashboard** is free for every customer. It has two views:
  - **Service health**: public status of AWS services in all Regions, no sign-in needed.
  - **Your account health**: events that affect **your** resources, such as scheduled maintenance on your instances.
- Health events reach **Amazon EventBridge** at no cost for all customers, so you can automate reactions.
- The **AWS Health API** needs Business Support+, Enterprise Support or Unified Operations.

> Older study material says "Personal Health Dashboard" and "Service Health Dashboard"; the current official name is the AWS Health Dashboard, with Service health and Your account health views.

---

## People who help: who does what

| Need | Resource |
|------|----------|
| Open a support case, request a quota increase, ask a billing question | **AWS Support Center** |
| A named AWS contact who knows your environment and coordinates proactive guidance | **Technical Account Manager** (Enterprise Support, Unified Operations) |
| AWS's own experts to design, build, migrate or manage a workload with your team | **AWS Professional Services** |
| Third-party consultants, system integrators or managed service providers | **AWS Partner Network (APN)**, Services partners |
| Third-party software (ISVs), bought and billed through AWS | **AWS Marketplace** |
| Architecture guidance during design (named in the exam guide as technical assistance) | **AWS solutions architects** |
| Report AWS resources being used for abuse or other violations of the Acceptable Use Policy | **AWS Trust and Safety team**, through the abuse reporting form |

The **APN** is the global community of companies that build on AWS: **Software** partners (ISVs) build products, **Services** partners deliver consulting, professional and managed services. Partners get training and certification, events and programs from AWS. **AWS Marketplace** is a curated catalog of third-party software, data and services with flexible pricing, private offers, and charges on the AWS bill; with AWS License Manager it supports governance of entitlements.

---

## Self-service technical resources

| You want | Go to |
|----------|-------|
| Official service guides and API references | **AWS documentation** (docs.aws.amazon.com) |
| Deep, vendor-written papers on architecture and best practices | **AWS whitepapers** and the AWS blogs |
| Proven guides and step-by-step patterns for migration and modernization | **AWS Prescriptive Guidance** |
| Answers to the most common technical and account questions | **AWS Knowledge Center** |
| A question-and-answer community for AWS questions | **AWS re:Post** (paid plans get prioritized responses) |

---

## Watch out

- **Basic cannot open technical cases**, but it can open account, billing and service quota cases.
- **Lowest plan with a designated TAM is Enterprise Support.** Business Support+ has no TAM.
- **Full Trusted Advisor starts at Business Support+.** Basic gets only the core checks.
- **Business-critical response:** Unified Operations is fastest, then Enterprise Support, then Business Support+. For "mission-critical workloads with 24/7 monitoring", the answer is Unified Operations.
- **Service health vs account health:** a general Regional outage is on Service health; maintenance on your own instances is in Your account health.
- **Professional Services vs APN:** AWS employees vs third-party partner firms. **Marketplace** sells software; it is not where you hire AWS staff.
- **A paid plan applies per account.** It does not automatically cover every account in an organization.
- AWS Activate, AWS IQ and AWS Managed Services are outside the exam scope.

---

## Quick check

1. What is the lowest plan that lets developers open technical cases 24x7 and see the full set of Trusted Advisor checks? **AWS Business Support+.**
2. Which plans include a designated Technical Account Manager? **AWS Enterprise Support and AWS Unified Operations.**
3. Which Trusted Advisor category warns that you are near a quota? **Service limits.**
4. Where do you see that AWS will run maintenance on one of your own instances next week? **AWS Health Dashboard, Your account health.**
5. An EC2 instance you do not own is being used to abuse your servers. Who do you report it to? **The AWS Trust and Safety team, through the abuse reporting form.**

---

## Official documentation

- [AWS Support plans](https://docs.aws.amazon.com/awssupport/latest/user/aws-support-plans.html)
- [Support plans end of support](https://docs.aws.amazon.com/awssupport/latest/user/support-plans-eos.html)
- [Case management and response times](https://docs.aws.amazon.com/awssupport/latest/user/case-management.html)
- [AWS Trusted Advisor check reference](https://docs.aws.amazon.com/awssupport/latest/user/trusted-advisor-check-reference.html)
- [What is AWS Health?](https://docs.aws.amazon.com/health/latest/ug/what-is-aws-health.html)
- [AWS Partner Network](https://aws.amazon.com/partners/)
- [AWS Professional Services](https://aws.amazon.com/professional-services/)
- [What is AWS Marketplace?](https://docs.aws.amazon.com/marketplace/latest/buyerguide/what-is-marketplace.html)
