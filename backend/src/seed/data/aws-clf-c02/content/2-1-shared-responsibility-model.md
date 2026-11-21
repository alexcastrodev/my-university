---
version: 1.0
updatedAt: 2026-11-21
---
# The AWS Shared Responsibility Model: Who Secures What, Service by Service

> Exam domain: **Security and Compliance (30%)**, task statement 2.1 *Understand the AWS shared responsibility model*.

---

## The one-sentence rule

AWS is responsible for **security OF the cloud**. The customer is responsible for **security IN the cloud**.

- **OF the cloud (AWS):** the hardware, software, networking and facilities that run AWS Cloud services, from the **host operating system and virtualization layer** down to the **physical security** of the data centers.
- **IN the cloud (customer):** what you put on top and how you configure it: guest OS updates and patches, application software, security group rules, your data, encryption options, data classification and IAM permissions.

The customer side is not fixed. It depends on **which services you choose**, how sensitive your data is, your company's requirements and the laws and regulations that apply to you.

```text
 +-------------------------------------------------------------+
 |  CUSTOMER: security IN the cloud                            |
 |  data, classification, IAM permissions, encryption choices, |
 |  application code and config, guest OS (when you have one), |
 |  security groups, network placement                         |
 +-------------------------------------------------------------+
 |  AWS: security OF the cloud                                 |
 |  software that runs the services, host OS, virtualization,  |
 |  hardware, networking, facilities and physical security     |
 +-------------------------------------------------------------+
```

---

## How the line moves by service

The more AWS manages, the fewer layers you own. The exam names **Amazon EC2, Amazon RDS and AWS Lambda** as the examples, and it likes Amazon S3 and Amazon DynamoDB as the "abstracted" end.

| Service | AWS handles | Customer handles |
|---------|-------------|------------------|
| **Amazon EC2** (you get a virtual server) | Physical host, hypervisor, network, facilities | Guest OS and every piece of software on it, **including updates and security patches**; security groups and VPC settings; the credentials used to connect to the instance; IAM roles attached to the instance |
| **Amazon RDS** (managed database) | The processes RDS manages, such as **creating automated backups** and **replication to read replicas** | VPC placement, security groups, IAM policies for managing RDS, SSL/TLS connections, whether to **enable encryption at rest**, database engine logins, the backup window and retention period you want |
| **AWS Lambda** (serverless functions) | Underlying infrastructure, foundation services, **the OS and the application platform**; publishing patched runtimes (and applying them in the default automatic mode) | Your **function code** and the **IAM permissions** to the Lambda service and inside the function |
| **Amazon S3, Amazon DynamoDB** (abstracted services) | Infrastructure, OS and platform | Your data, its encryption and the permissions on it |

A quick way to place any item: **if you can log in to that layer or configure it, it is yours.** On EC2 you log in to the guest OS, so its patches are yours. On Lambda there is no OS for you to reach, so there is nothing to patch at that level.

### Two details that the exam turns into traps

**RDS backups.** RDS **creates and saves automated backups** during the backup window you configure and keeps them for the retention period you set. So "who performs RDS backups" is AWS, while "who chooses the window and retention" is you.

**RDS encryption.** Encryption at rest is **your choice, made when you create the instance**. AWS supplies the mechanism (AWS KMS keys), but it does not decide for you. Encryption can only be turned on at creation. To encrypt an existing unencrypted instance:

```text
unencrypted DB  ->  snapshot  ->  copy the snapshot WITH encryption  ->  restore a new, encrypted DB
```

You cannot restore an unencrypted backup or snapshot directly to an encrypted instance.

**Lambda container images.** If you package a function as a **container image**, the runtime ships inside your image. When a patched base image comes out, **you rebuild the image from the latest base image and redeploy**. The automatic runtime updates only cover functions that use a Lambda managed runtime.

---

## Controls: inherited, shared and customer specific

The model also sorts IT controls into three groups.

| Control type | Meaning | Example from AWS |
|--------------|---------|------------------|
| **Inherited** | You take it over from AWS completely | **Physical and environmental** controls |
| **Shared** | Both sides apply it, each in its own layer | **Patch management** (AWS patches its infrastructure, you patch guest OS and apps), **configuration management** (AWS configures its devices, you configure guest OS, databases, apps), **awareness and training** (each side trains its own people) |
| **Customer specific** | Only the customer, because it depends on how you use the services | **Service and communications protection or zone security** |

"Patch management is shared" and "EC2 guest OS patching is the customer's" are both true. The first is about the control as a whole; the second is your half of it.

---

## Compliance follows the same split

Third-party auditors regularly test **AWS's own controls** through the AWS compliance programs, and AWS publishes which services each program covers ("AWS Services in Scope by Compliance Program"). That proves AWS's layer. It does not make your workload compliant: **you remain responsible for your own compliance**, including your data, your configuration and your access rules. Lesson 2.2 shows where to download AWS's reports (AWS Artifact).

---

## Sorting common items

| Item | Owner |
|------|-------|
| Replacing failed disks, physical access to data centers | AWS |
| Hypervisor and host OS of EC2 | AWS |
| Guest OS patches on an EC2 instance | Customer |
| Security group rules | Customer |
| Rotating IAM users' access keys | Customer |
| Deciding who can read an S3 bucket | Customer |
| Classifying data and choosing encryption | Customer |
| Performing RDS automated backups | AWS (you pick window and retention) |
| Patching the OS under a Lambda function | AWS |
| Rebuilding a Lambda container image with a patched base image | Customer |
| Application code, its configuration and its security | Customer |

---

## Watch out

- **"AWS manages it, so AWS secures my configuration."** No. A managed service hides the OS, not your data, permissions or settings. Rule: managed means fewer layers for you, never zero.
- **Application security is the customer's.** Distractors that make AWS responsible for "following best practices in your new application" are wrong. Rule: your code and its configuration are always on your side.
- **EC2 vs RDS patching.** EC2: you patch the guest OS. RDS: you never log in to the DB host, so its OS is not yours. Rule: the layer you can log in to is yours.
- **RDS backups and encryption.** AWS performs automated backups; you choose window and retention. You choose encryption, and only at creation. Rule: AWS runs the process, you make the decision.
- **Physical and environmental = inherited; awareness and training = shared.** Rule: if both sides have staff or devices that need it, it is shared.
- **AWS compliance reports do not certify your workload.** Rule: AWS proves its layer; you prove yours.

> Older study material says database backups on RDS are a customer duty; the current official documentation says RDS itself creates the automated backups, and the customer only configures the backup window and retention period (and can take manual snapshots).

---

## Quick check

1. A company runs Linux on Amazon EC2. Who installs the OS security patches? **The customer.**
2. Who performs the automated backups of an Amazon RDS instance? **AWS (RDS), during the window and with the retention the customer sets.**
3. An RDS instance was created without encryption. Can it be switched on in place? **No. Snapshot, make an encrypted copy, restore a new instance.**
4. Which control is fully inherited from AWS? **Physical and environmental controls.**
5. A Lambda function is deployed as a container image and its base image gets a security fix. Who acts? **The customer rebuilds and redeploys the image.**

---

## Official documentation

- [Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/)
- [Security in Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)
- [Security in Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.html)
- [Amazon RDS automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [Encrypting Amazon RDS resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [Lambda: the shared responsibility model](https://docs.aws.amazon.com/whitepapers/latest/security-overview-aws-lambda/the-shared-responsibility-model.html)
- [Lambda runtime updates and shared responsibility](https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-shared.html)
