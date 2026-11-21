---
version: 1.0
updatedAt: 2026-11-21
---
# Block, File and Hybrid Storage: EBS, Instance Store, EFS, FSx, Storage Gateway, AWS Backup and Elastic Disaster Recovery

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.6 *Identify AWS storage services*.

---

## What the exam wants

From task 3.6 this lesson covers **block storage** (Amazon EBS, instance store), **file services** (Amazon EFS, Amazon FSx), **cached file systems** (AWS Storage Gateway) and **use cases for AWS Backup**, plus AWS Elastic Disaster Recovery from the storage service list. The questions describe how the data is used and ask which kind of storage fits.

---

## Object, block or file?

| Need | Storage type | Service |
|------|--------------|---------|
| Store any amount of objects, reach them over an API from anywhere | Object | **Amazon S3** (lesson 3-4) |
| A disk for one EC2 instance: boot volume, database files | Block | **Amazon EBS** |
| Very fast temporary disk physically on the host | Block | **Instance store** |
| One shared file system mounted by many Linux instances in several AZs | File (NFS) | **Amazon EFS** |
| Windows file shares (SMB) with Active Directory | File (SMB) | **Amazon FSx for Windows File Server** |
| On-premises applications using AWS storage through local protocols | Hybrid | **AWS Storage Gateway** |

---

## Amazon EBS

- Persistent block volumes for EC2. A volume's data is replicated across multiple servers **within one AZ**, so the volume lives in that AZ.
- **Snapshots** are point-in-time backups. You restore a snapshot into a new volume, also in another AZ, another Region or another account. That is how you "move" a volume.
- **Elastic Volumes** let you increase capacity or change performance with no downtime. You pay for what you provision, whether it is used or not.
- A volume normally attaches to one instance. **Multi-Attach** (io1 and io2 only) attaches one volume to several Nitro instances in the same AZ; it cannot be a boot volume.

| Volume family | Types | Good for | Boot volume? |
|---------------|-------|----------|--------------|
| **SSD** | gp3, gp2 (general purpose); io2 Block Express, io1 (provisioned IOPS) | Boot disks, transactional databases, random I/O | Yes |
| **HDD** | st1 (throughput optimized), sc1 (cold) | Large sequential reads such as logs and big data, lowest cost | **No** |

> Older study material lists only gp2, io1 and Magnetic. The current official documentation lists gp3, gp2, io2 Block Express, io1, st1 and sc1, and calls Magnetic a previous generation type.

---

## Instance store

- Disks physically attached to the host computer. They are very fast and carry **no extra charge**.
- Data **survives a reboot** but is **lost when the instance stops, hibernates or terminates**.
- Use it for buffers, caches, scratch data, or data that is replicated elsewhere. Never for the only copy of anything.
- NVMe instance store data is always encrypted in hardware, and the keys are destroyed when the instance stops or terminates.

```text
 reboot     ->  instance store: kept      EBS: kept
 stop       ->  instance store: LOST      EBS: kept
 terminate  ->  instance store: LOST      EBS: kept unless deleted with the instance
```

---

## File storage: EFS and FSx

**Amazon EFS**

- Serverless, fully elastic file storage that grows and shrinks automatically; NFS (v4.0 and v4.1).
- Usable from EC2, ECS, EKS, Lambda and Fargate at the same time.
- File system types: **Regional** (recommended, data stored across multiple AZs) and **One Zone** (one AZ, data can be lost if the AZ is lost).
- Storage classes: **Standard**, **Infrequent Access** and **Archive**, with lifecycle management that moves files that are not accessed.
- Windows-based EC2 instances are **not supported**.

**Amazon FSx** provides fully managed file systems built on popular file systems. The current offerings are FSx for NetApp ONTAP, FSx for OpenZFS, FSx for Windows File Server and FSx for Lustre (FSx for Lustre is explicitly out of scope for this exam).

- **FSx for Windows File Server**: fully managed Windows file servers, SMB protocol, integration with Microsoft Active Directory. The cue is "Windows application, SMB shares, NTFS permissions, AD users".

| Clue in the question | Answer |
|----------------------|--------|
| Linux instances in several AZs share the same files | **EFS** |
| Windows servers need shared folders with AD permissions | **FSx for Windows File Server** |
| One instance needs a persistent disk | **EBS** |

---

## AWS Storage Gateway (cached and hybrid storage)

Storage Gateway lets on-premises applications use AWS storage through standard protocols, keeping recently used data in a local cache.

| Gateway type | Protocol on premises | Stores data in |
|--------------|----------------------|----------------|
| **S3 File Gateway** | NFS (v3, v4.1) and SMB (v2, v3) file shares | Amazon S3, as objects |
| **Volume Gateway** | iSCSI block volumes. **Cached**: data in S3, hot data local. **Stored**: all data local, asynchronous point-in-time snapshots to S3 | S3, with snapshots as EBS snapshots (both modes) |
| **Tape Gateway** | Virtual tape library for existing backup software | S3, archiving tapes to Glacier Flexible Retrieval or Deep Archive |

Amazon FSx File Gateway is no longer available to new customers, so do not choose it for a new design.

---

## AWS Backup and AWS Elastic Disaster Recovery

| Service | What it does | Cue |
|---------|--------------|-----|
| **AWS Backup** | Fully managed service that **centralizes and automates** data protection across AWS services, in the cloud and on premises, with backup policies (schedules, retention) and monitoring in one place | "Same backup policy for EBS, RDS and EFS from one place", "prove backups follow the policy" |
| **AWS Elastic Disaster Recovery** | Continuously replicates on-premises or cloud servers to a low-cost staging area in a chosen AWS Region, and launches recovery instances when needed; supports non-disruptive drills and failback | "Recover our running servers in AWS after a site disaster, and fail back later" |

- AWS Backup only governs backups taken through AWS Backup, not snapshots you scripted on your own.
- Backup is about **restoring data**; Elastic Disaster Recovery is about **bringing whole servers back up** in AWS fast.

**Not named in the exam guide (context only):** the AWS Snow Family of physical transfer devices is not in the exam guide. AWS Snowmobile was shut down in 2024 and AWS Snowball Edge is no longer available to new customers, so capacity figures in older books are obsolete.

---

## Watch out

- **EBS is zonal.** To use a volume's data in another AZ or Region, take a snapshot and create a new volume from it.
- **st1 and sc1 cannot boot.** Boot volumes and databases need SSD (gp3, gp2, io2, io1).
- **Instance store is lost on stop or terminate.** "Must survive a stop" rules it out.
- **Shared file system across instances and AZs is EFS (Linux) or FSx for Windows (Windows)**, not EBS. EBS Multi-Attach is limited to io1 and io2 in one AZ.
- **EFS does not support Windows instances.** Windows plus SMB means FSx for Windows File Server.
- **"Cached file system for on premises" is Storage Gateway.** Keep tape software and send tapes to AWS: Tape Gateway.
- **AWS Backup's main benefit is centralized, policy-based backup**, not faster servers or lower storage prices.

## Quick check

1. Which storage loses its data when the EC2 instance is stopped? **Instance store.**
2. Thirty Linux web servers in three AZs must read and write the same uploaded files. Which service? **Amazon EFS.**
3. A Windows application needs SMB shares integrated with Active Directory. Which service? **Amazon FSx for Windows File Server.**
4. A company wants to keep its tape backup software but stop shipping physical tapes. Which service? **AWS Storage Gateway, Tape Gateway.**
5. One policy must back up EBS volumes, RDS databases and EFS file systems daily. Which service? **AWS Backup.**

## Official documentation

- [What is Amazon EBS](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)
- [Amazon EBS volume types](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html)
- [Instance store temporary block storage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/InstanceStorage.html)
- [What is Amazon EFS](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)
- [What is FSx for Windows File Server](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html)
- [What is AWS Storage Gateway](https://docs.aws.amazon.com/storagegateway/latest/vgw/WhatIsStorageGateway.html)
- [What is AWS Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
- [What is AWS Elastic Disaster Recovery](https://docs.aws.amazon.com/drs/latest/userguide/what-is-drs.html)
