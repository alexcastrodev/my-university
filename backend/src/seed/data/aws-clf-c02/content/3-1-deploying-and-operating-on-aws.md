---
version: 1.0
updatedAt: 2026-11-21
---
# Deploying and Operating on AWS: Console, CLI, SDKs, Infrastructure as Code and Deployment Models

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.1 *Define methods of deploying and operating in the AWS Cloud*.

---

## What the exam wants

Task 3.1 asks three things: how you **access** AWS services, how you **provision and operate** resources (one-time actions versus repeatable processes), and which **deployment model** a company uses (cloud, hybrid, on-premises). Questions are almost always "which access method fits this person and this job".

---

## Four ways in, one decision

| Method | What it is | Pick it when |
|--------|------------|--------------|
| **AWS Management Console** | Browser-based graphical interface | A person explores, learns, or does a one-off task by clicking |
| **AWS CLI** | Open source command line tool for bash, zsh, tcsh, Windows command prompt, PowerShell, or a shell on an EC2 instance | An administrator scripts tasks from a terminal; it offers functionality equivalent to the console |
| **AWS SDKs** | Language libraries (Java, Python, JavaScript, .NET, Go and others) | Application code must call AWS services without hand-writing HTTP requests |
| **APIs (service endpoints)** | The URL entry point of each service, for example `https://dynamodb.us-west-2.amazonaws.com` | Something must call the service directly; the CLI and SDKs use the default Regional endpoint for you |
| **Infrastructure as code (IaC)** | Resources described in template files, deployed by a service such as AWS CloudFormation | The same environment must be built again and again, reviewed and versioned like source code |

```text
 one-time, by hand                          repeatable, automated
 ------------------                         ---------------------
 Console  ->  CLI one-liner  ->  CLI script  ->  SDK in an app  ->  CloudFormation template
```

A small CLI example: list the S3 buckets of the configured account.

```bash
aws s3 ls
```

The same call from application code goes through the SDK for that language. Nobody "logs in to the CLI" with a console password: the CLI and SDKs use programmatic credentials, the console uses a sign-in.

---

## One-time operations versus repeatable processes

- **One-time**: investigating a problem, creating a test bucket, reading a dashboard. The console is fine.
- **Repeatable**: building identical test, staging and production environments, or rebuilding in another Region. Use infrastructure as code, so the result is the same every time and changes can be reviewed.
- Clicking through the console for every new environment is slow and invites drift between environments. That is the cue for IaC.

---

## AWS CloudFormation

- You write a **template** (a text file in JSON or YAML) that describes resources and their properties.
- CloudFormation creates them as a **stack**. The same template provisions the same resources repeatedly, and in multiple Regions.
- Templates are text files, so you track them in version control like source code.
- **Drift detection** finds changes someone made to stack resources outside CloudFormation, for example in the EC2 console.
- Through the **CloudFormation registry**, extensions (resource types, modules, Hooks) from AWS, third-party publishers and your own private ones can be activated. CloudFormation is not limited to AWS resource types.
- **Pricing model**: no CloudFormation charge for AWS resource types (`AWS::*`), you pay for the resources created. Third-party and private resource types are billed per handler operation (as of 2026-11-21).
- The **AWS CDK** lets you define infrastructure in TypeScript, JavaScript, Python, Java, C# or Go, and it deploys through CloudFormation.

```yaml
Resources:
  LogsBucket:
    Type: AWS::S3::Bucket
```

> Older study material says CloudFormation "cannot create non-AWS resources" and that it is always free. The current official documentation says third-party resource types are supported through the registry, and only AWS resource types carry no CloudFormation charge.

---

## AWS Elastic Beanstalk

- You upload an application source bundle. Beanstalk provisions the EC2 instances, configures load balancing, sets up health monitoring and scales the environment.
- Platforms include Go, Java (Java SE and Tomcat), .NET, Node.js, PHP, Python, Ruby and Docker.
- **No additional charge** for Elastic Beanstalk: you pay for the underlying resources (EC2, S3, load balancing).

| You want to... | Use |
|----------------|-----|
| Deploy a web app and let AWS handle capacity, load balancing and scaling | **Elastic Beanstalk** |
| Describe any set of AWS resources (networks, databases, queues) as a template | **CloudFormation** |
| Write infrastructure in a programming language | **AWS CDK** (it deploys through CloudFormation) |

---

## CI/CD: CodeBuild and CodePipeline

| Service | Job |
|---------|-----|
| **AWS CodeBuild** | Fully managed build service: compiles source, runs unit tests, produces deployable artifacts, with no build servers to manage |
| **AWS CodePipeline** | Continuous delivery service that models and automates the stages of a release (source, build, test, deploy), and can include a manual approval |

A classic pipeline: a commit triggers CodePipeline, CodeBuild builds and tests, a person approves, then the release goes to production.

Out of scope or gone (one line each, only to avoid confusion): **AWS CodeDeploy**, **AWS CodeArtifact** and **AWS CloudShell** are explicitly out of scope for this exam; **AWS CodeStar** and **AWS OpsWorks** are shut down; **AWS Cloud9** is no longer available to new customers.

---

## Operating at scale: AWS Systems Manager

Systems Manager lets you view, manage and operate nodes at scale in AWS, on premises and in other clouds. Its tools include Run Command, Session Manager, Automation and Parameter Store, and a typical task is applying security patches across a fleet. (More in module 4.)

> Older study material teaches "Chef or Puppet means AWS OpsWorks". OpsWorks, in all its variants, reached end of support on May 1, 2024. Do not pick it as a current service.

---

## Deployment models

| Model | Meaning | Scenario cue |
|-------|---------|--------------|
| **Cloud** | The whole application runs in the cloud, built there or migrated | "Everything runs in AWS" |
| **Hybrid** | Cloud resources connected to existing resources outside the cloud, usually on premises | "Database stays in our data center, web tier runs in AWS" |
| **On-premises** | Resources deployed locally with virtualization and resource management tools (often called private cloud) | "Everything stays in our own data center" |

AWS Outposts (lesson 3-2) is a way to run AWS infrastructure on premises as part of a hybrid design.

---

## Watch out

- **Console for one-off work, IaC for repeatable work.** "Identical environments in several Regions" means CloudFormation, not a person following a console runbook.
- **SDK versus CLI.** Code inside an application uses an SDK. A person or a shell script at a terminal uses the CLI.
- **Beanstalk versus CloudFormation.** Beanstalk runs your application for you; CloudFormation provisions whatever resources the template describes. Neither charges for itself, you pay for the resources.
- **Drift detection** is the answer to "someone changed stack resources by hand".
- **CodeBuild builds and tests; CodePipeline orchestrates the release.** CodeDeploy is out of scope, so it is not the expected answer.
- **Hybrid means connected.** A company with both an on-premises data center and AWS resources linked together is hybrid, not "cloud".

## Quick check

1. A developer's Python application must write objects to S3. Which access method? **An AWS SDK.**
2. A team must build the same network, servers and database in three Regions, reviewed like code. Which service? **AWS CloudFormation.**
3. Someone edited a security group created by a stack. Which feature reports it? **CloudFormation drift detection.**
4. A company uploads a Java web app and wants AWS to handle load balancing and scaling. Which service? **AWS Elastic Beanstalk.**
5. A company keeps its ERP on premises and connects it to new services in AWS. Which deployment model? **Hybrid.**

## Official documentation

- [What is the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-welcome.html)
- [AWS SDKs and Tools overview](https://docs.aws.amazon.com/sdkref/latest/guide/overview.html)
- [AWS service endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html)
- [What is AWS CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html)
- [CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)
- [What is AWS Elastic Beanstalk](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html)
- [What is AWS CodePipeline](https://docs.aws.amazon.com/codepipeline/latest/userguide/welcome.html)
- [Types of cloud computing (deployment models)](https://aws.amazon.com/types-of-cloud-computing/)
