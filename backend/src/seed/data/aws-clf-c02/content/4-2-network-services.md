---
version: 1.0
updatedAt: 2026-11-21
---
# Network Services: VPC, Gateways, Route 53, Edge Delivery and Hybrid Connectivity

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.5 *Identify AWS network services*.

---

## What the exam wants

The guide asks you to know the **components of a VPC** (subnets, gateways), **VPC security** (network ACLs, security groups, Amazon Inspector), the **purpose of Amazon Route 53** and the **connectivity options** (AWS VPN, AWS Direct Connect). The in-scope networking list also has API Gateway, CloudFront, Global Accelerator, PrivateLink, Transit Gateway, Site-to-Site VPN and Client VPN.

---

## Amazon VPC building blocks

A **VPC** is a logically isolated virtual network you define in one Region. It spans the AZs of that Region. A **subnet** lives entirely inside **one AZ**.

```text
 Region
 +-- VPC 10.0.0.0/16 -------------------------------------------+
 |  AZ-a                          AZ-b                           |
 |  [Public subnet]  route 0.0.0.0/0 -> Internet gateway        |
 |     web servers, NAT gateway                                  |
 |  [Private subnet] route 0.0.0.0/0 -> NAT gateway             |
 |     app servers, databases (outbound only)                    |
 +--------------------------------------------------------------+
```

| Component | What it does |
|-----------|--------------|
| **Subnet** | A range of addresses in one AZ. Its type follows its routing |
| **Route table** | Decides where traffic leaving a subnet goes |
| **Internet gateway** | Lets a VPC talk to the internet in both directions. Horizontally scaled, redundant, no bandwidth constraint |
| **NAT gateway** | Lets instances in a private subnet reach out (patches, APIs) while the outside cannot start connections to them. A public NAT gateway sits in a public subnet with an Elastic IP |
| **Elastic IP** | A static public IPv4 address. Every public IPv4 address is charged, in use or idle |
| **VPC peering** | Private connection between two VPCs, same or different account or Region |
| **VPC Flow Logs** | Capture IP traffic information, published to CloudWatch Logs, Amazon S3 or Amazon Data Firehose |

**What makes a subnet public is a route to an internet gateway.** A private subnet has no such route and uses a NAT device for outbound internet access. Each Region also has a **default VPC** with a public subnet in every AZ and an internet gateway already attached.

---

## Security groups vs network ACLs (network view)

| | Security group | Network ACL |
|---|---|---|
| Attached to | Instance (network interface) | Subnet |
| Rules | Allow only | Allow and **deny** |
| State | **Stateful**: return traffic allowed automatically | **Stateless**: return traffic must be allowed explicitly |
| Evaluation | All rules together | In number order, first match wins |

Use a security group for "only the load balancer may reach the app servers". Use a network ACL for "block this IP range for the whole subnet". Amazon Inspector, also named in this objective, scans workloads for vulnerabilities and unintended network exposure (lesson 2-4).

---

## Amazon Route 53

Route 53 is a highly available, scalable **DNS** service with three functions you can combine: **domain registration**, **DNS routing** and **health checking**. Registering a domain creates a hosted zone automatically. A **private hosted zone** answers DNS queries only inside your VPCs. An **alias record** can point the zone apex (example.com, no www) at an AWS resource such as a CloudFront distribution, which a CNAME cannot do, and alias queries to AWS resources are not charged.

| Routing policy | Use when |
|----------------|----------|
| Simple | One resource, no special logic |
| Weighted | Split traffic by percentage (send 10 percent to a new version) |
| Latency | Send users to the Region with the lowest latency for them |
| Failover | Active-passive: primary while healthy, secondary when the health check fails |
| Geolocation | Answer by the user's country or continent (local content, legal limits) |
| Geoproximity | Route by distance to your resources, with a bias to shift traffic |
| Multivalue answer | Return several healthy records at random |
| IP-based | Route by the client's IP range |

---

## Edge and front door services

| Need | Service |
|------|---------|
| Cache static and dynamic content close to users worldwide (images, video, web pages) | **Amazon CloudFront** |
| Two static anycast IP addresses, TCP or UDP traffic over the AWS global network, fast Regional failover, no caching | **AWS Global Accelerator** |
| Spread traffic across healthy targets in one or more AZs | **Elastic Load Balancing** |
| Create, publish, secure and monitor REST, HTTP and WebSocket APIs in front of Lambda or other backends | **Amazon API Gateway** |

- CloudFront serves cached content from the edge and fetches from the **origin** (S3 bucket, load balancer, EC2, API Gateway) on a miss. A private S3 bucket works as an origin through **origin access control** (OAC).
- Global Accelerator fits non-HTTP workloads (multiplayer games over UDP, IoT, VoIP) or HTTP apps that need fixed IPs.
- Load balancer types: **Application Load Balancer** (layer 7, HTTP and HTTPS, routes by path or header), **Network Load Balancer** (layer 4, TCP and UDP, extreme performance, static IP), **Gateway Load Balancer** (third-party virtual appliances). Classic Load Balancer is the previous generation.

---

## Connecting networks

| Need | Service |
|------|---------|
| Encrypted tunnel from an office or data center to a VPC over the internet, set up quickly | **AWS Site-to-Site VPN** (IPsec, two tunnels per connection) |
| Individual remote users connecting from laptops to AWS and on-premises resources | **AWS Client VPN** (managed, OpenVPN-based client) |
| Dedicated private link from your network to AWS that **bypasses the internet**, consistent performance for large transfers | **AWS Direct Connect** |
| One hub joining many VPCs and on-premises networks instead of a mesh of peerings | **AWS Transit Gateway** |
| Reach a service in another VPC or account (or an AWS service) privately, as if it were inside your VPC | **AWS PrivateLink** |

- Site-to-Site VPN needs a **customer gateway** (your device) and a virtual private gateway or transit gateway on the AWS side.
- Direct Connect runs over a fiber link to a Direct Connect location. Dedicated connections currently come in 1, 10, 100 or 400 Gbps, and partners offer hosted connections from 50 Mbps (as of 2026-11-21). A **Direct Connect gateway** lets one connection reach VPCs in many Regions.
- **Direct Connect is not encrypted by default.** Run a Site-to-Site VPN over it for IPsec, or use MACsec on supported dedicated connections.

> Not named in the exam guide: **VPC endpoints**. A gateway endpoint lets a private subnet reach S3 or DynamoDB without an internet gateway or NAT device; interface endpoints are powered by PrivateLink.

> Older study material says Direct Connect speeds stop at 10 or 100 Gbps and hosted links stop at 500 Mbps. The current Direct Connect FAQ lists dedicated connections up to 400 Gbps and hosted connections up to 25 Gbps.

---

## Watch out

- **A VPC belongs to one Region and a subnet to one AZ.** "Span two Regions" is false for a VPC.
- **Internet gateway vs NAT gateway: who starts the connection.** Inbound and outbound for public resources means internet gateway; outbound only from a private subnet means NAT gateway.
- **"Deny" or "whole subnet" means network ACL.** Security groups have no deny rules.
- **VPN vs Direct Connect: the transport decides, not the word "secure".** VPN is encrypted and travels over the internet; Direct Connect is private and bypasses the internet but needs VPN or MACsec for encryption.
- **CloudFront caches content, Global Accelerator does not.** Static IPs and UDP point to Global Accelerator.
- **Client VPN is for people, Site-to-Site VPN is for networks.**
- **Many VPCs plus data centers in one hub means Transit Gateway,** not dozens of peering connections.
- **Route 53 is DNS, not a load balancer.** It answers with an address by policy and health checks; ELB spreads the actual connections.

## Quick check

1. What makes a subnet public? **A route to an internet gateway.**
2. Private servers must download patches but accept no inbound connections from the internet. **NAT gateway.**
3. Send 5 percent of users to a new application version by DNS. **Route 53 weighted routing.**
4. A UDP game needs two fixed IPs and fast failover between Regions. **AWS Global Accelerator.**
5. A dedicated link that bypasses the internet must also be encrypted. **Direct Connect with a Site-to-Site VPN over it (or MACsec).**

## Official documentation

- [What is Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)
- [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)
- [Compare security groups and network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [Route 53 routing policies](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html)
- [Global Accelerator FAQs](https://aws.amazon.com/global-accelerator/faqs/)
- [What is AWS Direct Connect](https://docs.aws.amazon.com/directconnect/latest/UserGuide/Welcome.html)
- [Direct Connect encryption in transit](https://docs.aws.amazon.com/directconnect/latest/UserGuide/encryption-in-transit.html)
