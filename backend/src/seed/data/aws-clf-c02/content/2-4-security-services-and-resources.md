---
version: 1.0
updatedAt: 2026-11-21
---
# Security Components: Network Filters, WAF, Shield, Detection Services and Where to Learn More

> Exam domain: **Security and Compliance (30%)**, task statement 2.4 *Identify components and resources for security*.

---

## Security groups vs network ACLs

Both filter traffic in a VPC, at different places and with different rules.

| | **Security group** | **Network ACL** |
|---|---|---|
| Applies to | A resource (EC2 instance, RDS DB instance, load balancer and others) | A **subnet** (every resource in it) |
| Rules | **Allow only** | **Allow and deny** |
| Evaluation | All rules together | In ascending **rule number**, first match wins |
| Return traffic | **Automatically allowed (stateful)** | Must be **explicitly allowed (stateless)** |
| Role | Primary control | Secondary, coarse control, for example to deny a specific source |

```text
 Internet --> route to subnet --> [ Network ACL: may this enter the subnet? ]
                                   --> [ Security group: may this reach the instance? ] --> instance
```

- Each subnet has exactly **one** network ACL (the default one if you do not choose); one network ACL can serve many subnets.
- Every network ACL ends with a non-removable `*` rule that **denies anything no numbered rule matched**.
- Neither has an extra charge. To see the traffic that reaches your resources, use **VPC Flow Logs**.

"Block one IP address for a whole subnet" is a network ACL deny rule: a security group has no deny rule. AWS Network Firewall also filters VPC traffic, but it is **not in scope for this exam**.

---

## Edge protection: AWS WAF, AWS Shield, AWS Firewall Manager

| Threat or need | Service |
|----------------|---------|
| Web exploits in HTTP(S) requests: **SQL injection**, bad source IPs, suspicious query strings | **AWS WAF** |
| **DDoS** at the network and transport layers (3 and 4), for everyone, no charge | **AWS Shield Standard** (automatic) |
| DDoS at the application layer, response experts, **cost protection** | **AWS Shield Advanced** (paid subscription) |
| The same WAF, Shield Advanced, security group and network ACL policies on **many accounts**, including new ones | **AWS Firewall Manager** |

**AWS WAF** inspects web requests to CloudFront distributions, API Gateway REST APIs, Application Load Balancers, AppSync, Cognito user pools, App Runner and other front doors, and answers with the content, an HTTP 403 or a custom response. It works at layer 7, where security groups cannot look.

**AWS Shield Standard** is on for **all AWS customers at no additional charge**. It defends against the most common network and transport layer DDoS attacks; Route 53 hosted zones, CloudFront and Global Accelerator get comprehensive protection against known layer 3 and 4 attacks.

**AWS Shield Advanced** protects only the resources you **add** to it: CloudFront distributions, Route 53 hosted zones, Global Accelerator accelerators, Elastic IP addresses (and the EC2 instances or Network Load Balancers behind them), Application Load Balancers and Classic Load Balancers. It adds:

- automatic **application layer (layer 7)** DDoS mitigation, using AWS WAF (WAF fees for protected resources are included);
- health-based detection and enhanced visibility of attacks;
- access to the **Shield Response Team (SRT)**, which requires **a paid AWS Support plan**, plus proactive engagement;
- **cost protection**: service credits for scaling charges caused by a DDoS attack.

It is billed as a monthly subscription with a one-year commitment, plus data transfer out usage fees.

**AWS Firewall Manager** works with AWS Organizations to apply those rule sets centrally and to new accounts and resources automatically. You still pay for the underlying services it configures.

> Older study material says the DDoS Response Team (DRT) helps during attacks; the current official documentation says the Shield Response Team (SRT). Some books also say Shield covers layer 7 at no extra cost; layer 7 DDoS mitigation is a Shield Advanced feature.

---

## The detection ladder: pick the service by the verb

| The stem says | Service | What it uses or covers |
|---------------|---------|------------------------|
| **Detect threats** continuously (cryptomining, calls from malicious IPs) | **Amazon GuardDuty** | Threat intelligence and ML over CloudTrail management events, VPC flow logs and DNS logs, plus optional protection plans (S3, EKS, RDS, Lambda, malware) |
| **Find software vulnerabilities** and unintended network exposure | **Amazon Inspector** | Continually scans **EC2 instances, container images in Amazon ECR and Lambda functions**; rescans when a new CVE appears |
| **Discover sensitive data** (PII, financial data, credentials) | **Amazon Macie** | **Amazon S3** buckets; also flags public or shared buckets |
| **Investigate the root cause** of a finding | **Amazon Detective** | Behavior graph built from CloudTrail, VPC flow logs and GuardDuty findings, up to a year of history |
| **One view** of findings plus **automated checks against standards** | **AWS Security Hub** | Aggregates GuardDuty, Inspector, Macie and partner findings; checks against AWS Foundational Security Best Practices, CIS, PCI DSS and NIST |
| **Who** called an API | **AWS CloudTrail** | Lesson 2.2 |
| **What a resource looked like**, is it compliant with my rules | **AWS Config** | Lesson 2.2 |
| **Best-practice checks** across the account, security included | **AWS Trusted Advisor** | See below |

GuardDuty findings go to Amazon EventBridge, so you can trigger automatic responses. GuardDuty and Macie each offer a 30-day free trial.

**AWS Security Hub: one note.** AWS has split the service. What study books describe (findings aggregation and automated checks against standards) is now called **AWS Security Hub CSPM**, and a newer **AWS Security Hub** correlates those findings with other services into exposures. The exam guide says "AWS Security Hub": answer it for "central view of findings and automated compliance checks". Most of its checks need AWS Config enabled.

**Trusted Advisor for security.** Trusted Advisor checks cover cost optimization, performance, **security**, fault tolerance, service limits and operational excellence. A core set of security checks is available on every plan, including Basic: **S3 bucket permissions, MFA on the root account, security groups with specific ports unrestricted, EBS and RDS public snapshots**. The full set of checks and the API come with a higher paid AWS Support plan (module 5). Trusted Advisor **recommends**; fixing and remediation belong to AWS Config rules or Security Hub automations.

---

## Other security services the guide lists

| Need | Service |
|------|---------|
| Public and private **SSL/TLS certificates** that renew automatically on CloudFront, load balancers and other integrated services | **AWS Certificate Manager (ACM)**: no extra charge for ACM-managed public certificates; certificates are regional, and for **CloudFront** they must be in **US East (N. Virginia)** |
| **Microsoft Active Directory** in AWS | **AWS Directory Service**: AWS Managed Microsoft AD; **AD Connector** (a proxy to your on-premises AD); Simple AD (Samba 4 based) |
| **Share resources** such as VPC subnets with other accounts, OUs or the whole organization | **AWS Resource Access Manager (RAM)**, no additional charge |
| Single-tenant key hardware, managed keys, secrets | CloudHSM, KMS, Secrets Manager (lessons 2.2 and 2.3) |

---

## Where security information and products live

- **AWS Cloud Security** (aws.amazon.com/security): the hub that links security services, compliance, learning resources and vulnerability reporting. It is the closest match to the guide's "AWS Security Center".
- **AWS Security Blog** (aws.amazon.com/blogs/security): announcements, how-tos and best practices.
- **Cloud Security Learning Resources**: documentation, training, videos and whitepapers.
- **AWS Knowledge Center**: answers to common questions, now on AWS re:Post.
- **AWS Marketplace**: **third-party security software** (identity, endpoint protection, SIEM, firewalls, managed security services) to find, test, buy and deploy.

---

## Watch out

- **Security group = allow only, stateful. Network ACL = allow and deny, stateless, numbered.** Rule: "deny one IP" or "return traffic blocked" points to the network ACL.
- **Inbound traffic meets the network ACL before the security group.** Rule: subnet first, then resource.
- **Security groups are not EC2-only.** Rule: RDS instances and load balancers use them too.
- **WAF vs Shield.** Rule: SQL injection and other web exploits are WAF; floods of traffic are Shield.
- **Shield Standard is free but layers 3 and 4 only.** Rule: layer 7 DDoS mitigation, SRT and cost protection mean Shield Advanced.
- **GuardDuty vs Inspector.** Rule: GuardDuty sees active threats, Inspector finds vulnerabilities before someone uses them.
- **Macie is S3 and sensitive data.** Rule: GuardDuty and Inspector do not look for PII.
- **Detective investigates, Security Hub aggregates.** Rule: "root cause" is Detective, "single pane" is Security Hub.
- **Trusted Advisor advises, it does not remediate.**
- **ACM for CloudFront lives in US East (N. Virginia).**

---

## Quick check

1. Bots send SQL fragments to a login page behind an Application Load Balancer. **AWS WAF.**
2. Which DDoS protection does every account have without doing anything? **AWS Shield Standard (layers 3 and 4).**
3. Which service flags passport numbers stored in S3? **Amazon Macie.**
4. A finding needs a timeline of the role's activity for the past months. **Amazon Detective.**
5. The same WAF rules must reach 40 accounts, new ones included. **AWS Firewall Manager.**

---

## Official documentation

- [Compare security groups and network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [What is AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html)
- [AWS Shield Advanced capabilities](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-capabilities.html)
- [AWS Firewall Manager](https://docs.aws.amazon.com/waf/latest/developerguide/fms-chapter.html)
- [What is Amazon GuardDuty](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html)
- [What is Amazon Inspector](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html)
- [Security Hub and Security Hub CSPM](https://docs.aws.amazon.com/securityhub/latest/userguide/what-are-securityhub-services.html)
- [Trusted Advisor check reference](https://docs.aws.amazon.com/awssupport/latest/user/trusted-advisor-check-reference.html)
