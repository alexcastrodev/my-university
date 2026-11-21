---
version: 1.0
updatedAt: 2026-11-21
---
# Compute on AWS: EC2, Auto Scaling, Containers, Serverless, Lightsail and Batch

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.3 *Identify AWS compute services*.

---

## What the exam wants

The guide names five skills: **EC2 instance types** (compute optimized, storage optimized), **container options** (Amazon ECS, Amazon EKS), **serverless compute** (AWS Fargate, AWS Lambda), **auto scaling for elasticity**, and the **purpose of load balancers**. Batch, Lightsail, Elastic Beanstalk and Outposts are also in the compute list. The real skill is choosing how much of the server you want to manage.

```text
 you manage more                                              you manage less
 ---------------------------------------------------------------------------
 EC2 instance  ->  ECS/EKS on EC2  ->  ECS/EKS on Fargate  ->  Lambda function
 (OS, patches)     (hosts + containers)  (containers only)       (code only)
```

---

## Amazon EC2 essentials

- An **AMI** (Amazon Machine Image) provides the software to boot an instance plus a block device mapping. You must choose one at launch, and one AMI launches many identically configured instances. An AMI belongs to a Region.
- The launch wizard offers **Quick Start AMIs** and a full AMI catalog; paid AMIs from vendors come from **AWS Marketplace**.
- A custom "golden" AMI is how you make every new server start with the same hardened OS and agents.

### Instance families

| Family | Built for | Scenario cue |
|--------|-----------|--------------|
| **General purpose** | Balanced CPU, memory and network; includes burstable `T` types with a baseline CPU that can burst | Web servers, small apps, dev and test |
| **Compute optimized** | High CPU relative to memory | CPU-bound simulations, batch processing, game servers |
| **Memory optimized** | Large memory (the `U` high memory types sit here) | In-memory databases and caches |
| **Storage optimized** | High local storage throughput (`D` and `I` types) | Large data sets on local disks |
| **Accelerated computing** | GPUs and other accelerators | Machine learning, graphics |
| **High-performance computing** | Tightly coupled HPC | Scientific modeling |

A type name is family plus size. In `c7g.large`, `c` is the series, `7` the generation, `g` an attribute (Graviton) and `large` the size. Other attribute letters include `a` (AMD), `i` (Intel) and `d` (instance store).

### Purchase options in one line each (detail in lesson 5-1)

On-Demand (no commitment, billed per second with a 60-second minimum), Savings Plans and Reserved Instances (1 or 3 year commitment for a discount), Spot (spare capacity that EC2 can interrupt; you pay the current Spot price set by EC2, there is no bidding), Dedicated Hosts (a whole physical server, for per-core or per-socket licenses), Dedicated Instances (single-tenant hardware), Capacity Reservations (capacity in one AZ).

---

## Amazon EC2 Auto Scaling and load balancers

| Concept | Meaning |
|---------|---------|
| **Auto Scaling group** | A set of instances with a **minimum**, **desired** and **maximum** size; scaling stays within min and max |
| **Health checks** | Terminated or impaired instances are replaced automatically |
| **Multi-AZ** | A group can span several AZs of a Region and is balanced evenly across them |
| **Scaling options** | Manual, **scheduled** (known peaks), **dynamic** (follow a metric), **predictive** (forecast from history) |
| **Launch template** | Describes what to launch; **versioned**, recommended by AWS, needed for mixed Spot and On-Demand or several instance types |
| **Launch configuration** | The legacy object: cannot be modified after creation and no longer recommended |

**Elastic Load Balancing** distributes incoming traffic across multiple targets in one or more AZs, checks their health and sends traffic only to healthy targets. Auto Scaling changes **how many** instances run; the load balancer decides **which** healthy instance gets each request. Together they give elasticity and high availability. (Load balancer types are covered in module 4.)

> Older study material presents launch configurations as current and one book says launch templates "cannot be modified". The current official documentation says launch templates are versioned, launch configurations are immutable, and accounts created on or after October 1, 2024 cannot create launch configurations at all.

---

## Containers: ECS, EKS, ECR

| Service | What it is | Pick it when |
|---------|------------|--------------|
| **Amazon ECS** (Elastic Container Service) | A fully managed container orchestration service from AWS | You want to run containers the AWS way, with the least orchestration to learn |
| **Amazon EKS** (Elastic Kubernetes Service) | A fully managed Kubernetes service; AWS manages the control plane | The team already uses Kubernetes manifests and tools, or needs Kubernetes portability |
| **Amazon ECR** (Elastic Container Registry) | A managed container image registry with private repositories and IAM permissions | You need a place to store and pull container images |

Both ECS and EKS can run containers on EC2 instances you manage or on **AWS Fargate**.

---

## Serverless compute: Fargate and Lambda

| | **AWS Fargate** | **AWS Lambda** |
|--|-----------------|----------------|
| Unit you deploy | A container (ECS task or EKS Pod) | A function (code) |
| Servers to manage | None; you choose CPU and memory per task | None; AWS handles capacity, scaling and patching |
| Typical trigger | A long-running service or a task you start | An event: an S3 upload, an API call, a queue message |
| Billing model | Pay as you go for the resources the task requests | Requests plus duration (GB-seconds); nothing while idle |

- Fargate is a serverless, pay-as-you-go compute engine for containers, and each task has its own isolation boundary.
- Lambda runs code without provisioning or managing servers, and scales with the number of events.
- Lambda has a maximum run time per invocation; as of 2026-11-21 it is currently 30 minutes for standard functions. Long jobs that run for hours belong on containers, Batch or EC2.

> Older study material says a Lambda function can run "at most 15 minutes". The current official documentation says the maximum timeout is 1,800 seconds (30 minutes) as of 2026-11-21. The number has changed before, so design questions should not depend on it.

---

## Lightsail, Batch and Elastic Beanstalk

| Service | Choose it when |
|---------|----------------|
| **Amazon Lightsail** | A small business or beginner wants a simple virtual private server (WordPress, LAMP, Windows images), managed databases or a load balancer at a **fixed monthly bundle price**. Snapshots can later be exported to EC2 |
| **AWS Batch** | You must run large numbers of batch jobs; Batch provisions the compute (EC2, Fargate) and queues the jobs. No additional charge, you pay for the resources |
| **AWS Elastic Beanstalk** | You upload a web application and let AWS provision instances, load balancing and scaling (lesson 3-1) |

**Not named in the exam guide (context only):** EC2 placement groups (cluster, partition, spread) control how instances are placed on hardware for low latency or failure isolation. The guide does not list them, so learn the name only.

---

## Watch out

- **"No servers to manage for containers" is Fargate**, not ECS on EC2. ECS and EKS are orchestrators; Fargate is the serverless engine under them.
- **Existing Kubernetes skills or manifests point to EKS.** ECS is AWS's own orchestrator.
- **ECR stores images; it does not run them.**
- **Auto Scaling changes the number of instances**, not their size, and works within one Region. Distributing requests is the load balancer's job.
- **Known daily peak means scheduled scaling.** Dynamic scaling reacts after the metric moves.
- **Launch templates are the current, versioned way** to describe what Auto Scaling launches.
- **Spot means interruptible.** Never for a workload that cannot stop.
- **Lightsail is the fixed-price simple option**; it does include WordPress images.
- **Lambda is event-driven and short-running.** Hours-long processing is Batch, containers or EC2.

## Quick check

1. A CPU-bound simulation needs little memory. Which instance family? **Compute optimized.**
2. A team wants to run containers but never patch or scale the underlying hosts. Which service? **AWS Fargate.**
3. Traffic jumps every weekday at 09:00 and capacity must be ready before. Which scaling option? **Scheduled scaling.**
4. Thumbnails must be created each time an image lands in S3, with nothing running when idle. Which service? **AWS Lambda.**
5. Which service stores container images for ECS and EKS? **Amazon ECR.**

## Official documentation

- [Amazon Machine Images (AMIs)](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html)
- [Amazon EC2 instance types](https://docs.aws.amazon.com/ec2/latest/instancetypes/instance-types.html)
- [What is Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html)
- [What is Elastic Load Balancing](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)
- [What is Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
- [What is Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [What is AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [What is Amazon Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/what-is-amazon-lightsail.html)
