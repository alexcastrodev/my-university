---
title: "Gray Failure: The Achilles' Heel of Cloud-Scale Systems"
summary: A HotOS position paper from Microsoft that defines gray failure as differential observability, a state where an application sees a system as failing while the system's own failure detector sees it as healthy, and illustrates it with Azure incidents.
researchArea: Distributed Systems
keywords: gray failure, differential observability, failure detection, partial failures, cloud reliability, health monitoring, Azure
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Cloud scale provides the vast resources necessary to replace failed components, but this is useful only if those failures can be detected. For this reason, the major availability breakdowns and performance anomalies the authors see in cloud environments tend to be caused by subtle underlying faults, i.e., gray failure rather than fail-stop failure. The paper discusses experiences with gray failure in production cloud-scale systems to show its broad scope and consequences. It also argues that a key feature of gray failure is differential observability: the system's failure detectors may not notice problems even when applications are afflicted by them. This leads the authors to believe that, to best deal with gray failure, we should focus on bridging the gap between different components' perceptions of what constitutes failure.

## Overview

Fault-tolerant systems are usually built from three ingredients: redundancy, failure detection and failure recovery. They work well when a component is either correct or stopped. This 2017 HotOS paper, by researchers at Microsoft Research and Microsoft Azure (the first author was also at Johns Hopkins University), starts from the observation that real cloud incidents are often neither. A component keeps answering heartbeats while its disk is flaky, its network path drops packets at random, or it is under capacity pressure. The authors call this gray failure and say that, in their first-hand experience with production cloud systems, it is behind most cloud incidents.

The paper is a position paper of six pages. It has no system and no benchmark. Its value is a vocabulary and a model: the authors describe it as the first attempt to characterize gray failure, a problem they say is largely overlooked in the literature.

Useful context from the catalog: the classic redundancy and consensus techniques the paper says assume a fail-stop model, such as [The Part-Time Parliament](/papers/paxos-part-time-parliament) and [Chain Replication](/papers/chain-replication-high-throughput-availability), and [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance), which the paper discusses as a way to mask gray failure. A later HotOS paper on a related theme is [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems).

## Contribution

- **A definition.** Gray failure is a form of differential observability: a system experiences gray failure when at least one app observes it as unhealthy while the system's own observer observes it as healthy.
- **A model.** A system provides a service and an app uses it (a web application, a user, an operator, or another system). Inside the system, an observer gathers information, actively or passively, and a reactor acts on it to recover. Observer and reactor are part of the system.
- **A taxonomy of four cases** (Table 1), crossing "system observes good or bad" with "app observes good or bad". Gray failure is the one where the app sees bad and the observer sees good.
- **A temporal pattern.** A latent failure becomes a degraded mode that the app can see but the observer cannot, and ends as a complete failure that the observer finally notices. In the model this is a path from case 1 to case 2 to case 4.
- **Case studies from Azure** that show how redundancy, failure detectors and recovery can misbehave under gray failure.
- **Directions** for closing the observation gap (see Findings).

## Methodology

The paper rests on what the authors call an extensive study of real incidents in Azure cloud services, from which they highlight a few illustrative cases. It does not report a systematic corpus, incident counts or percentages, and it does not run experiments. The model of Section 3 is then applied back to two of the cases to show that it explains them. The related-work section positions the paper against Gray's Heisenbug discussion, outage studies by Gunawi et al., fail-slow faults in an internal Microsoft study, Byzantine fault tolerance, the Falcon and Pigeon failure detectors, and statistical performance diagnosis.

## Findings

The "findings" are four case studies and a set of observations. They are qualitative.

- **High redundancy hurts.** In a Clos data center network, a crashed switch is routed around, but a switch with random silent packet drops is usually not. If a request fans out to m back-end servers and there are n core switches, the chance that a given core switch is on the request's path is 1 - ((n-1)/n)^m, which approaches 100% as m grows. So one gray core switch delays nearly every front-end request, and adding more core switches makes it more likely that at least one is gray.
- **Under the radar of failure detectors.** Unhealthy Azure VMs had internal network connectivity problems, for example from a driver bug. The compute manager's heartbeats arrive through a host agent over local RPCs, so they never exercise the VM's external network, and nothing was recovered until a user reported the issue (Figure 3).
- **Recovery that kills, rather than heals.** A data server with a capacity constraint was not detected because of a resource-reporting bug. The storage manager kept routing writes to it, it crashed and rebooted repeatedly, and was finally removed as irreparable. With another subtlety in the replication workflow, this reduced total capacity, pressured healthy servers and ended in a cascading failure.
- **The blame game.** A VM that cannot reach its virtual disk crashes, and the compute failure detector may blame the compute stack when storage or network is at fault. The authors report teams blaming each other because no one had clear evidence.
- **Model fit.** In the network case the switches are the observers and routing is the reactor. In the storage case the storage manager is both observer and reactor, and each crash and reboot makes the observation difference vanish and reappear, until it vanishes for good too late.
- **Directions.** (1) Move from single-signal failure detection, such as heartbeats, to multi-dimensional health monitoring, using the analogy of body temperature and blood pressure. (2) Approximate the application's view with probes, as in Pingmesh, while avoiding probe load on an already degraded system. (3) Use scale, aggregating many components' partial observations, possibly in an independent plane outside the core system. (4) Use temporal patterns, since there was a window between the time t1 when compute saw an uptick in I/O exceptions and the time t2 when storage reacted.

## Critical Analysis

What the paper does not claim. It does not give an incidence rate beyond saying gray failure is behind most incidents in its authors' experience. It does not propose or evaluate a detector. It does not say that masking techniques such as BFT are wrong, only that they are costly in practice, hard to make robust to slowness, and leave failed components unreplaced. It also does not say gray failure is specific to large systems: the definition is independent of scale, although the discussion focuses on large distributed systems.

The following points are a reading of the evidence, not claims from the paper.

- **Evidence is anecdotal by design.** Four cases motivate a general definition. This suits a HotOS paper, but the claim about "most incidents" cannot be checked from the text.
- **The definition depends on who counts as an app.** If any one app can declare the system unhealthy, then a buggy or very demanding app can create gray failure on paper. The paper notes apps can differ in their metrics, but gives no rule for deciding when an app's observation is the one that matters.
- **The directions are costs as well as advice.** The paper itself warns that more probing can burden a degraded system and that temporal patterns risk false positives, since most latent faults are benign.
- **Later literature, not part of this paper.** The authors' own follow-up work is a sequel: "Capturing and Enhancing In Situ System Observability for Failure Detection" (Huang et al., OSDI 2018) and "Understanding, Detecting and Localizing Partial Failures in Large System Software" (Lou, Huang, Smith, NSDI 2020). I checked the titles and venues on the USENIX pages and the first author's publication list, not the full texts. The overlapping vocabulary of [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) is useful, but the two papers describe different mechanisms: there, a sustaining feedback loop keeps a system in a bad state after its trigger; here, a gap between observers hides a bad state from the detector.

## Further Research

- How to decide, for a given system, which app observations should count as ground truth for health.
- Probes that approximate app views without adding load to a degraded system, and where to place the aggregation and inference plane relative to the core system.
- Detecting the latent-fault phase early enough to act, with a tolerable false-positive rate.
- Failure detectors that expose uncertainty rather than a binary verdict, in the direction of the Pigeon and Falcon work the paper cites, and the question of how [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus), which avoids relying on timeouts, behaves under gray failure.
