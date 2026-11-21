---
version: 1.0
updatedAt: 2026-11-21
---
# Other Service Categories: Integration, Business Apps, Developer Tools, Monitoring, End-User Computing, IoT and Migration

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.8 *Identify services from other in-scope AWS service categories*.

---

## What the exam wants

Objective 3.8 is a tour of categories, each with one or two services: **application integration** (EventBridge, SNS, SQS), **business applications** (Amazon Connect, Amazon SES), **customer enablement** (AWS Support), **developer tools** (CodeBuild, CodePipeline, X-Ray), **end-user computing** (AppStream 2.0, WorkSpaces, WorkSpaces Secure Browser), **frontend web and mobile** (Amplify) and **IoT** (IoT Core). The skills are all "choose the service for this need".

---

## Application integration: push, pull, event or workflow

| Need | Service | Model |
|------|---------|-------|
| Buffer work between components so a slow consumer does not lose messages | **Amazon SQS** | Queue: consumers **pull** (poll) messages |
| Send one message to many subscribers at once (queues, Lambda, email, SMS, mobile push) | **Amazon SNS** | Pub/sub topic: AWS **pushes** to every subscriber |
| React to events from AWS services, SaaS apps or your code, or run something on a schedule | **Amazon EventBridge** | Event bus with rules, plus EventBridge Scheduler (cron, rate, one-time) |
| Coordinate several steps in order with branching and retries | **AWS Step Functions** | Visual workflow (state machine) |

- **SQS queue types**: Standard (nearly unlimited throughput, at-least-once delivery, best-effort order) and **FIFO** (exactly-once processing and strict order).
- **Fanout**: an SNS topic with several SQS queues subscribed delivers one event to many independent processors.
- EventBridge was formerly CloudWatch Events; the old documentation now opens the EventBridge guide.

```text
 Order placed --> SNS topic --+--> SQS queue --> billing service
                              +--> SQS queue --> shipping service
                              +--> email to the customer
```

---

## Business applications and customer enablement

| Need | Service |
|------|---------|
| A cloud contact center that connects customers to agents with intelligent routing | **Amazon Connect** |
| Send and receive email (transactional, marketing, newsletters) from your own domains | **Amazon SES** (Simple Email Service) |
| Technical help, case support and guidance from AWS | **AWS Support** (plans in lesson 5-3) |

SES is email. Text messages and mobile push to subscribers come from SNS.

---

## Developer tools and monitoring

| Need | Service |
|------|---------|
| Compile source code, run unit tests and produce deployable artifacts with no build servers | **AWS CodeBuild** |
| Model, visualize and automate the release steps from commit to production | **AWS CodePipeline** |
| Trace a request through microservices to find which one adds latency | **AWS X-Ray** |
| Metrics, alarms, dashboards and logs for resources and applications | **Amazon CloudWatch** |
| Who did what: record of API calls by users, roles and services | **AWS CloudTrail** |
| Operate fleets of servers at scale: security patching, Run Command, Session Manager, Parameter Store | **AWS Systems Manager** |

```text
 "Is it slow or broken?"      -> CloudWatch (metrics, alarm on a threshold)
 "Where in the chain is it?"  -> X-Ray (trace map across services)
 "Who changed it?"            -> CloudTrail (API activity record)
```

- CloudWatch **alarms** watch a metric against a threshold and can notify or trigger an automated action. The **CloudWatch agent** collects metrics and logs from EC2 instances and on-premises servers.
- CloudWatch metric data points expire after 15 months.
- CloudTrail Event history keeps the past 90 days of management events at no charge; a trail delivers events to S3 for longer keeping.
- Out of scope, do not pick them as answers: AWS CodeDeploy, AWS CodeArtifact, AWS CloudShell.

---

## End-user computing

| Need | Service |
|------|---------|
| A full, persistent virtual desktop (Windows or Linux) for each worker, reachable from any device | **Amazon WorkSpaces** |
| Stream one desktop application to users' browsers without installing it locally | **Amazon AppStream 2.0** (now called Amazon WorkSpaces Applications) |
| Give users secure access to internal websites and SaaS apps through a remote browser, no VPN or client software | **Amazon WorkSpaces Secure Browser** |

- WorkSpaces Personal gives a persistent desktop per user; WorkSpaces Pool gives non-persistent desktops.
- WorkSpaces Secure Browser runs the browser session in AWS and streams only encrypted pixels to the local browser. It is not a desktop.

---

## Frontend web and mobile, and IoT

- **AWS Amplify**: build and host full-stack web and mobile apps. Amplify Hosting gives a Git-based workflow with continuous deployment onto the AWS content delivery network.
- **AWS IoT Core**: connect IoT devices to the cloud, to each other and to AWS services, and route their messages. It does not analyze the data itself: predictive maintenance needs an ML service such as SageMaker AI on top.

Not named in the exam guide: AWS AppSync (GraphQL APIs). Out of scope: AWS IoT Greengrass (edge runtime) and AWS Device Farm (testing on real phones).

---

## Migration and transfer (service view)

Lesson 1-3 covers strategies. Here, match **what is moving** to the service.

| What moves | Service |
|------------|---------|
| Whole servers, rehosted on EC2 with continuous replication and a short cutover | **AWS Application Migration Service** (now called AWS Transform MGN) |
| Database data, one time or with ongoing replication | **AWS Database Migration Service (DMS)** |
| A database schema to a different engine | **AWS Schema Conversion Tool (SCT)** |
| Nothing yet: a data-driven business case and right-sized cost estimate | **Migration Evaluator** |

AWS Application Discovery Service and AWS Migration Hub are still in the exam guide but are no longer open to new customers. Not named in the exam guide: AWS DataSync (online file transfer) and the Snow Family devices, which are closed to new customers.

---

## Watch out

- **SQS is pull, SNS is push.** "Many subscribers at once" is SNS; "hold messages until a worker is free" is SQS.
- **Exactly once and in order means an SQS FIFO queue,** not a Standard queue.
- **EventBridge reacts to events and schedules; a CloudWatch alarm reacts to a metric threshold.** "Every night at 7 p.m." is EventBridge Scheduler.
- **Step Functions orchestrates; SQS only buffers.** Retries, branching and ordered steps point to Step Functions.
- **SES sends email; SNS sends SMS and push too.**
- **CloudWatch is performance, CloudTrail is audit, X-Ray is tracing.**
- **WorkSpaces is a desktop, AppStream 2.0 is an application, Secure Browser is a browser.**
- **IoT Core connects devices; it is not the analytics or ML layer.**

## Quick check

1. One order event must reach three independent processing queues. **SNS topic fanned out to SQS queues.**
2. Contractors need a full Windows desktop from their personal laptops. **Amazon WorkSpaces.**
3. Find which microservice adds 800 ms to checkout. **AWS X-Ray.**
4. A company wants a cloud contact center that routes customer calls to the right agent. **Amazon Connect.**
5. Move 300 VMs to EC2 unchanged with minimal downtime. **AWS Application Migration Service.**

## Official documentation

- [What is Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
- [What is Amazon SNS](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [What is Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)
- [What is AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [What is AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html)
- [What is Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html)
- [What is Amazon WorkSpaces](https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces.html)
- [What is AWS IoT](https://docs.aws.amazon.com/iot/latest/developerguide/what-is-aws-iot.html)
