---
title: "Basic Concepts and Taxonomy of Dependable and Secure Computing"
summary: The reference vocabulary for dependability. It defines faults, errors and failures as a causal chain, classifies faults along eight viewpoints (including permanent versus transient), classifies service failures, and organizes the means to achieve dependability into prevention, tolerance, removal and forecasting.
researchArea: Distributed Systems
keywords: dependability, fault, error, failure, fault tolerance, transient faults, intermittent faults, taxonomy, failure modes
version: 1.0
updatedAt: 2026-11-22
---

## Overview

When engineers talk about "failures" they often mean a bug, a crash, a bad deploy or a broken disk, and two people in the same meeting can mean different things. This paper, from a line of work that began in 1980 with a joint IEEE and IFIP committee, fixes a shared vocabulary. It is a taxonomy and not a measurement paper: it argues that dependability is the umbrella concept, that security is its sibling concern (adding confidentiality), and that three words, fault, error and failure, name three different links of one causal chain.

I read the University of Maryland technical report (TR 2004-47) of the paper, which is the same text as the IEEE Transactions on Dependable and Secure Computing article. The authors say they do not try to document the state of the art, and do not address implementation issues found in standards. The aim is to give a minimum consensus of concepts across communities.

## Contribution

- **Fault, error, failure.** A service failure is an event where the delivered service deviates from correct service. The deviation in the system's state is an error. The adjudged or hypothesized cause of an error is a fault. A fault is dormant until it causes an error, and then it is active. Many errors never reach the service interface and never become a failure.
- **A failure of one component is a fault for the next.** A service failure of component A shows up as an external fault for component B that receives service from A, which is how errors propagate through a system and across systems.
- **Dependability and security.** Dependability is the ability to deliver service that can justifiably be trusted, or alternatively the ability to avoid service failures more frequent or more severe than acceptable. Its attributes are availability, reliability, safety, integrity and maintainability. Security adds confidentiality and is a composite of confidentiality, integrity and availability.
- **Fault classes.** Faults are classified from eight viewpoints: phase of creation (development or operational), system boundary (internal or external), phenomenological cause (natural or human-made), dimension (hardware or software), objective (malicious or not), intent (deliberate or not), capability (accidental or incompetence) and persistence (permanent or transient). Of 256 theoretical combinations, the paper identifies 31 likely ones.
- **Failure modes.** Service failures are classified by domain (content or timing, with halt and erratic failures), by detectability (signaled or unsignaled), by consistency (consistent or inconsistent, the latter being Byzantine) and by consequences (from minor to catastrophic).
- **Means.** Four groups: fault prevention, fault tolerance (error detection and recovery, with error handling by rollback, rollforward or compensation, and fault handling by diagnosis, isolation, reconfiguration and reinitialization), fault removal and fault forecasting.

## Methodology

There is no experiment. The method is conceptual: start from basic definitions, comment on them, then supplement them with finer ones for threats, attributes and means. Terms are defined in bold and the text shows how each connects to others in a tree. The paper lists seven new contributions over the earlier versions of the taxonomy, among them the relation between dependability and security, a quantitative definition of dependability, the criterion of capability for human-made faults (to separate accidents from incompetence), an updated treatment of malicious faults, and the distinction between service failures and dependability failures.

## Findings

Because it is a taxonomy, the findings are the definitions and the structure they give. Everything below is stated in the text.

- **Persistence is one of the eight viewpoints.** Permanent faults are those whose presence is assumed to be continuous in time. Transient faults are those whose presence is bounded in time.
- **Intermittent faults group two kinds of fault.** Elusive development faults and transient physical faults look alike when they manifest, so both are grouped as intermittent faults, and the errors they produce are usually called soft errors.
- **Tolerating each kind needs a different mechanism.** The paper says repeating a computation over channels of identical design has proved adequate for elusive development faults, through rollback, but is not suitable for solid development faults. Solid development faults need separate designs and implementations of the same function, which is design diversity.
- **Intermittent faults need no isolation.** In the discussion of fault tolerance, the authors note that intermittent faults do not necessitate isolation or reconfiguration, and that error recurrence is one way to find out the fault is not intermittent.
- **Fault tolerance has limits the paper names.** Effectiveness is the coverage of a technique. Imperfect coverage comes from development faults in the tolerance mechanism itself or from fault assumptions that differ from the faults really occurring, including common-mode failures when independence was assumed. The paper notes that conservative assumptions such as Byzantine faults raise coverage at the cost of more redundancy and complexity, which can lower dependability.
- **Dependability can be judged, not only asserted.** Because a system "can, and usually does, fail", the alternate definition gives a criterion for when it still counts as dependable, based on acceptable frequency and severity of service failures.

## Critical Analysis

The strength is also the limit: the taxonomy is a shared language, and a language cannot be wrong in the way a measurement can. The authors admit gaps themselves. They say a consensus on measures of dependability and security has not emerged, that confidentiality is not given the attention it deserves, and that the work needs unified measures, deeper treatment of trust and risk, and attention to new technologies.

The points below are a reading of the paper, not claims it makes.

- **"Transient" has no time scale.** A fault is transient when its presence is bounded in time, but bounded relative to what? For a program that retries, a fault that lasts ten seconds is transient or permanent depending on the retry budget. The taxonomy gives the classes, but a practitioner still has to decide the threshold, and the paper leaves it to the fault assumption of each design.
- **Classification is a judgment, not an observation.** A fault is "adjudged or hypothesized" as the cause of an error, and the paper says failures can be subjective and disputable. Treating the persistence of a fault as known at the moment a message fails is a stronger assumption than the text supports. Recurrence of the error is the evidence the paper offers, which means the classification is learned after the fact.
- **The failure-mode viewpoints map to cloud-era problems, but only partly.** Silent and halt failures, and consistent versus inconsistent failures, anticipate what [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) calls failures observed differently by different observers, and the definition of a Byzantine failure as one users perceive differently ties to [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance). The paper has no vocabulary for the self-sustaining overload loops studied in [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), where the trigger is gone and the failure remains.
- **Failure detection is treated structurally.** The paper notes detectors can issue false alarms or miss failures, but does not discuss the timing and accuracy trade-offs studied in [Unreliable Failure Detectors for Reliable Distributed Systems](/papers/unreliable-failure-detectors-for-reliable-distributed-systems).

## Further Research

- Pair the classes with data: how often do real incidents in cloud services fall in each class, and how often is persistence known at the time of the first error?
- Study how to turn "transient versus permanent" into an operational rule, with an explicit observation window, and how often such a rule misclassifies.
- Map the means (rollback, rollforward, compensation, reconfiguration) to the recovery mechanisms of current messaging and job systems.
- Extend the failure-mode viewpoints to cover performance failures that feed back into load, which the taxonomy treats as a timing failure.
