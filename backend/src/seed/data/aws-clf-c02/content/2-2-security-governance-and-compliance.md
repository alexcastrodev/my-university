---
version: 1.0
updatedAt: 2026-11-21
---
# Security, Governance and Compliance: Encryption, KMS, Artifact, Organizations and Audit Logs

> Exam domain: **Security and Compliance (30%)**, task statement 2.2 *Understand AWS Cloud security, governance, and compliance concepts*.

---

## The Security pillar in seven principles

The Well-Architected **Security pillar** gives seven design principles. The exam maps a control to one of them.

| Principle | What it looks like |
|-----------|--------------------|
| **Implement a strong identity foundation** | Central identity management and least-privilege permissions (lesson 2.3) |
| **Maintain traceability** | Record and monitor actions and changes (CloudTrail, Config) |
| **Apply security at all layers** | Defense in depth: account guardrails, network edge, VPC, load balancing, every instance and compute service, OS, application, code |
| **Automate security best practices** | Automatic detection and correction instead of manual reviews |
| **Protect data in transit and at rest** | Encryption and access control for stored and moving data |
| **Keep people away from data** | Reduce direct human access to data |
| **Prepare for security events** | Have incident response ready before you need it |

The current framework groups security practices into four areas: security governance and operations (including detection and incident response), identity and access management, data protection, and infrastructure and application protection.

> Older study material says "enable traceability" and lists seven security areas from the standalone Security Pillar whitepaper; the current official documentation says "maintain traceability", marks that whitepaper as historical and uses four areas.

---

## Encryption: at rest vs in transit

| Need | Usual control |
|------|---------------|
| Data **moving** between client and AWS (browser to load balancer, app to database) | **SSL/TLS** (HTTPS), with a certificate from AWS Certificate Manager (lesson 2.4) |
| Data **stored** (S3 objects, EBS volumes, RDS databases) | **Server-side encryption** with AWS KMS keys |
| AWS must **never see plaintext** | **Client-side encryption**: you encrypt before sending, so the data is protected in transit and at rest |
| Private link from your data center (**AWS Direct Connect**) | **Not encrypted by default**. Add a Site-to-Site VPN (IPsec) over Direct Connect, or MACsec on supported connections |

AWS encrypts all data crossing Regions on its global network at the physical layer before it leaves AWS facilities, and all traffic between Availability Zones.

### Amazon S3

- Since **January 5, 2023**, every new object upload is **automatically encrypted with SSE-S3** (AES-256) at no additional cost. This **cannot be disabled** for new uploads. Objects that existed unencrypted before that date were not encrypted retroactively.
- Server-side options: **SSE-S3** (default), **SSE-KMS** (KMS keys, auditable), **DSSE-KMS** (two layers), **SSE-C** (you provide the key with each request). Client-side: you run the process and hold the keys.

> Older study material says S3 stores uploads unencrypted unless you turn encryption on; the current official documentation says all new uploads are encrypted with SSE-S3 by default and this cannot be turned off.

### EBS and RDS

- An encrypted EBS volume protects data at rest **and** data moving between the instance and the volume; snapshots stay encrypted. You can turn on **encryption by default** for new volumes.
- Neither an existing EBS volume nor an existing RDS instance can be switched to encrypted in place: make an **encrypted copy of a snapshot** and create a new volume or restore a new instance from it.

---

## AWS KMS and AWS CloudHSM

**AWS KMS** creates and controls the keys that encrypt and sign your data. Keys are protected by FIPS 140-3 Security Level 3 validated HSMs and **never leave KMS unencrypted**. KMS keys belong to the **Region** where you create them (multi-Region keys are a special case). Use of customer managed and AWS managed keys is **logged in AWS CloudTrail**.

| KMS key type | Where it lives | Your control | Visible in CloudTrail |
|--------------|----------------|--------------|-----------------------|
| **Customer managed key** | Your account | You create it, write the key policy, choose rotation | Yes |
| **AWS managed key** (alias `aws/service`) | Your account | View and audit only; AWS rotates it every year | Yes |
| **AWS owned key** | An AWS service account | None, you do not see it | No |

AWS managed keys are a legacy type: since 2021 new services default to AWS owned keys.

> Older study material says "customer master key (CMK)"; the current official documentation says "AWS KMS key" (or "KMS key"). The concept did not change.

**AWS CloudHSM** gives you **single-tenant** HSMs. AWS provisions, backs up and maintains the hardware; **you** control the keys, the algorithms and the HSM users (managed outside IAM). That is more control and more responsibility.

| Requirement | Choose |
|-------------|--------|
| Managed keys integrated with S3, EBS, RDS, audited in CloudTrail | **AWS KMS** |
| Dedicated, single-tenant hardware; you manage HSM users yourself | **AWS CloudHSM** |

"FIPS Level 3" alone no longer separates them, because KMS HSMs are validated at that level too. The word that decides is **single-tenant**.

---

## Compliance: AWS Artifact

**AWS Artifact** is the free, self-service portal for AWS compliance information:

- **Reports:** download AWS's own security and compliance documents on demand, such as SOC reports, ISO certifications and PCI reports. You accept the AWS Artifact NDA before downloading.
- **Agreements:** review, accept, track and terminate agreements such as the **HIPAA Business Associate Addendum (BAA)**, for one account or for the whole organization. Organization agreements need AWS Organizations with all features and are accepted from the **management account**.

Compliance programs vary by **industry and geography**: SOC, ISO 27001 and PCI DSS are global; FedRAMP is in the Americas, C5 in EMEA, IRAP in Asia Pacific; HIPAA and GDPR are laws and regulations. Not every AWS service is in scope for every program, so check the in-scope list for the services you use.

---

## Governance: AWS Organizations, SCPs and AWS Control Tower

**AWS Organizations** manages many accounts centrally. It has two feature sets: **all features** (the default and recommended one) and **consolidated billing** only. Accounts are grouped into organizational units (OUs), up to five levels deep.

The **management account** creates the organization, creates, invites and removes accounts, attaches policies, enables service integrations and pays all charges. AWS recommends keeping workloads out of it and using it only for tasks that need it.

**Service control policies (SCPs)** set the **maximum permissions** for member accounts:

- An SCP **grants nothing**. An action is allowed only if the SCP allows it **and** an IAM policy allows it, and no explicit deny exists.
- SCPs affect every identity in member accounts, **including the member account's root user**.
- SCPs **do not affect the management account** and never affect service-linked roles.
- SCPs need the all features set.

**AWS Control Tower** sets up and governs a multi-account environment (a **landing zone**) by orchestrating Organizations, Service Catalog and IAM Identity Center. Its **controls** (also called guardrails) are preventive, detective or proactive, and **Account Factory** creates standardized new accounts.

---

## Where security logs live

| Question | Service |
|----------|---------|
| **Who** did what, when, from where (API calls from console, CLI, SDK) | **AWS CloudTrail** |
| **What did this resource look like** before, and does it follow my rules | **AWS Config** |
| Metrics and alarms on resources and applications | **Amazon CloudWatch** (monitoring) |
| Who has which credentials, which permissions are unused | IAM **access reports** (lesson 2.3) |

**CloudTrail details:** **Event history** is a searchable, immutable record of the last **90 days of management events** in each Region, available automatically at no CloudTrail charge. A **trail** delivers events to S3 (optionally CloudWatch Logs and EventBridge) for longer retention; **CloudTrail Lake** lets you store and query events. Trails **do not log data events by default** (S3 object-level, Lambda Invoke, DynamoDB item-level), and data events cost extra. **Log file integrity validation** detects whether a delivered log file was modified or deleted; it detects, it does not block.

**Config details:** records configurations, relationships and history; evaluates them with **Config rules** and conformance packs; flags noncompliant resources, can notify through SNS and can **remediate** noncompliant resources.

---

## Acceptable use and penetration testing

- The **Acceptable Use Policy** forbids using AWS to violate the security, integrity or availability of any user or network.
- You may run security assessments **without prior approval** on a list of services that includes EC2, RDS, Aurora, CloudFront, API Gateway, Lambda, Lightsail, Elastic Beanstalk, ECS, Fargate, Elastic Load Balancing and AWS WAF.
- **Prohibited:** DoS and DDoS attacks or simulations (those follow a separate DDoS simulation policy), flooding, and DNS zone walking against Route 53 hosted zones. Red team and command and control (C2) activity need **prior submission**.
- Abuse coming **from** AWS resources is reported to **AWS Trust and Safety**.

---

## Watch out

- **Direct Connect is private, not encrypted.** Rule: add VPN (IPsec) or MACsec when the stem says "encrypted".
- **S3 is already encrypted at rest by default.** Rule: "AWS must never read the data" is the only case that forces client-side encryption.
- **Artifact holds AWS's reports**, it does not make you compliant. Rule: "download AWS's SOC or PCI report" or "accept the BAA" means Artifact.
- **SCPs never grant** and skip the management account. Rule: effective permission = SCP allow AND IAM allow AND no explicit deny.
- **CloudTrail vs Config.** Rule: "who" is CloudTrail, "what changed in the configuration" is Config.
- **Integrity validation detects tampering**, it does not prevent it.
- **Pen testing your own EC2 or RDS needs no approval**, but DoS testing is prohibited outside the DDoS simulation policy.

---

## Quick check

1. An app must keep data private even from AWS. **Client-side encryption with keys the company holds.**
2. A regulator requires single-tenant key hardware. **AWS CloudHSM.**
3. Where do you download AWS's PCI DSS report? **AWS Artifact.**
4. An SCP denies a service at the organization root. Can users in the management account still use it? **Yes, SCPs do not affect the management account.**
5. Who stopped an instance 20 days ago, with no trail configured? **CloudTrail Event history (90 days of management events).**

---

## Official documentation

- [Security pillar design principles](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec-design-principles.html)
- [Protecting data with encryption in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html)
- [S3 default encryption FAQ](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html)
- [AWS KMS concepts](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html)
- [What is AWS Artifact](https://docs.aws.amazon.com/artifact/latest/ug/what-is-aws-artifact.html)
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [What is AWS CloudTrail](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html)
- [Penetration testing policy](https://aws.amazon.com/security/penetration-testing/)
