---
title: "SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol"
summary: Das, Gupta and Motivala replace all-to-all heartbeating with a membership protocol that probes one random member per period, asks k others to probe on its behalf, and spreads membership changes by piggybacking them on those probes, so the per-member load and the expected detection time stay constant as the group grows.
researchArea: Distributed Systems
keywords: swim, group membership, failure detector, gossip, epidemic dissemination, suspicion, incarnation number
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Several distributed peer-to-peer applications require weakly-consistent knowledge of process group membership information at all participating processes. SWIM is a generic software module that offers this service for large-scale process groups. The SWIM effort is motivated by the unscalability of traditional heart-beating protocols, which either impose network loads that grow quadratically with group size, or compromise response times or false positive frequency w.r.t. detecting process crashes. This paper reports on the design, implementation and performance of the SWIM sub-system on a large cluster of commodity PCs. Unlike traditional heartbeating protocols, SWIM separates the failure detection and membership update dissemination functionalities of the membership protocol. Processes are monitored through an efficient peer-to-peer periodic randomized probing protocol. Both the expected time to first detection of each process failure, and the expected message load per member, do not vary with group size. Information about membership changes, such as process joins, drop-outs and failures, is propagated via piggybacking on ping messages and acknowledgments. This results in a robust and fast infection style (also epidemic or gossip-style) of dissemination. The rate of false failure detections in the SWIM system is reduced by modifying the protocol to allow group members to suspect a process before declaring it as failed: this allows the system to discover and rectify false failure detections. Finally, the protocol guarantees a deterministic time bound to detect failures. Experimental results from the SWIM prototype are presented. We discuss the extensibility of the design to a WAN-wide scale.

## Overview

The problem is keeping, at every member of a large group, a list of the members that have not failed. The paper (DSN 2002, Cornell) starts from the observation that the usual answer, heartbeating, does not scale. A central server becomes a hot spot, multicasting heartbeats to everyone costs a load that grows quadratically with group size, and a logical ring has unpredictable detection time when several members fail. The gossip-style detector of van Renesse and colleagues, which the paper cites, needs a bandwidth that also grows with n and a list of counters that no longer fits a UDP packet. The authors argue that the quadratic cost comes from fusing two jobs: detecting failures and disseminating membership updates. SWIM separates them.

The membership it offers is deliberately weak: members' lists need not agree at the same causal point in time. Stronger guarantees (virtual synchrony) are left to layers above, and the paper says they may have fundamental scalability limits. This is the opposite end of the design space from coordination services such as [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems), where membership is kept strongly consistent in a small replicated core. It fits the gossip-based membership of [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) and the replica groups of ring-based stores such as [Chord](/papers/chord-scalable-peer-to-peer-lookup-service), which the paper names as targets. The paper's own limits on what failure detection can promise come from [FLP](/papers/flp-impossibility-of-distributed-consensus), which it cites: a process that loses messages cannot be told from a failed one.

Worth knowing first: what a UDP timeout means in a failure detector, why "slow" and "dead" look the same from outside, and the idea of an epidemic spreading exponentially.

## Contribution

- **Separation of detection and dissemination.** A failure detector (probing) and a dissemination component (membership updates) are designed independently.
- **Randomized probing with indirect probes.** Each protocol period of length T', a member M_i pings one random member M_j. If no ack arrives in time, it sends ping-req(M_j) to k random members, each of which pings M_j and relays the ack. If none arrives by the end of the period, M_j is declared failed. The indirect path avoids blaming M_j for congestion on the M_i to M_j link. Properties (1) and (2) of the five the paper lists come from an earlier detector by Gupta, Chandra and Goldszmidt (PODC 2001).
- **Infection-style dissemination.** Updates ride on ping, ping-req and ack, with a buffer where each update carries a local count of times piggybacked, at most lambda log n, and fewer-sent updates go first. No extra packets, no multicast. Two lists (not yet failed, recently failed) share the piggyback slots equally.
- **Suspicion subprotocol.** A member that gets no ack marks the target Suspect and spreads that; a Confirm after a time-out declares it faulty, an Alive from the target clears it.
- **Incarnation numbers.** A member's number starts at 0 at join and only the member itself can increase it, when it learns it is suspected, so that it can issue Alive(inc+1).
- **Round-robin probe targets.** Targets are taken in order from a list that is reshuffled after each traversal, with new members inserted at a random position, which turns the average-case detection time into a worst-case bound.

## Methodology

The analysis is partly inherited and partly new. The detection-time and false-positive results for the basic detector are summarized from the earlier paper, and the text tells the reader to work them out or consult it ("The reader is encouraged to work out these results"). The dissemination analysis is new and borrows Bailey's deterministic epidemic model for a homogeneously mixing group with one initially infected member.

The prototype uses Winsock 2 on Windows 2000 over UDP. The cluster has 16 Dell PII 450-MHz machines, 16 IBM x220 1-GHz machines and dual and quad nodes of 200 to 500 MHz, on 100 Mbps Ethernet with no external load, at most one member per node. Parameters: k = 1 ping-req target, protocol period 2 s, each update piggybacked at most 3 times ceil(log(N+1)), and the same value for the suspicion time-out. Three variants are compared: SWIM:Basic (multicast dissemination, but with round-robin targets), SWIM+Inf. (infection-style) and SWIM+Inf.+Susp. (plus suspicion). Message loads are measured over 40 protocol periods.

## Findings

- **Detection time.** The chance that a given member is chosen as ping target by someone in a period is 1 - (1 - q_f/n)^(n-1), which tends to 1 - e^(-q_f), with q_f the fraction of non-faulty members. The expected time from failure to detection by some member is therefore at most T' / (1 - e^(-q_f)). T' must be at least three times the round-trip estimate.
- **False positives.** Taking q_ml as the probability of timely delivery, independent across packets, a non-faulty member is falsely detected within a period with probability q_f (1 - q_ml^2) (1 - q_f q_ml^4)^k e^(q_f)/(e^(q_f) - 1), which gives k from a target false-positive rate. The paper says these properties do not depend, except asymptotically, on n.
- **Load.** Expected message load per member is constant and symmetric. Per period a member sends one ping and one ack and receives the same. Message size is bounded: at most 15 B in SWIM:Basic and 135 B with at most 6 piggybacked updates, against 250 B for just 50 five-byte heartbeats.
- **Dissemination.** With contact rate 2/n - 1/n^2, after lambda log n periods the expected number infected is about n - n^(-(2 lambda - 2)) members. A small constant lambda suffices, "even at small group sizes".
- **Time-bounded completeness.** With round-robin, successive picks of the same target are at most 2 n_i - 1 periods apart, so a failure is detected at each member within about twice the group size in periods.
- **Measured load.** Up to 55 members the average overhead stays around 2.0 messages per period. At N = 28 sent messages are below 5 per period with probability 0.99.
- **Measured detection and spread.** Mean time to first detection was not correlated with group size and matched the analytic estimate (plotted as e/(e-1) periods). Median infection time stays a few periods and rises slowly with group size.
- **False positives under loss.** With 10% artificial packet loss and 17 processes joining one after another, SWIM+Inf.+Susp. settled at a stable group of 12, while SWIM:Basic ended with 2 and SWIM+Inf. with 4. The paper's Figure 3 runs of SWIM+Inf.+Susp. generated an insignificant number of false detections.

## Critical Analysis

- **Failure and network model.** Failures are crashes. The analysis assumes independent packet loss and uniform random choice, and a failure is judged by the missing ack. Byzantine members, authentication and correlated loss are not treated. The suspicion mechanism "reduces (but does not eliminate)" false positives, so accuracy is not guaranteed.
- **Completeness.** Strong completeness is eventual in the basic protocol and "easy to see" is the proof offered for the preference rules. There is no formal proof in the paper, and the suspicion path may prolong detection.
- **Partitions.** The paper does not analyze partitions or heal them. It reports that runs "observed no evidence of ... involuntary partitions" at its settings. Join needs a contact, and the implementation keeps a coordinator.
- **Evaluation.** At most 55 members, one lab network, and no measured comparison with a heartbeat protocol, only with its own variants. The loss experiment is one run, and the authors say it holds for those settings only. The WAN extension and the order-of-magnitude saving for DHT replica groups are stated, not measured. The suspicion time-out trade-off is left to a later article.
- **Incarnation numbers.** The text does not discuss what happens to stale messages when a member leaves and rejoins.

Later literature, not claimed by the paper:

- **Lifeguard.** Dadgar, Phillips and Currey (arXiv 1707.00788), whose abstract I read but not the full paper, say slow message processing can still make SWIM mark healthy members failed despite suspicion, and propose a local-health extension.
- **memberlist.** HashiCorp's README (read) says the Go library memberlist is based on SWIM with extensions, including Lifeguard. I did not check Serf and make no claim about it.

## Further Research

- Self-tuning of k, the period and the suspicion time-out under changing load, and the time-out trade-off the authors left for later.
- Weighting probe targets by topology for WAN or VPN deployment (the authors were evaluating it).
- Detectors that account for a slow local host (see Lifeguard above), and for partial failures as in [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems).
- Formal proofs of the preference rules, and behavior under partitions and rejoins.
- Using SWIM inside medium-sized replica groups of a DHT, as the authors suggest.
