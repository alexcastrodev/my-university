---
title: "Narwhal and Tusk: A DAG-based Mempool and Efficient BFT Consensus"
summary: Narwhal moves transaction dissemination out of the leader's critical path into a DAG of certified blocks, so a consensus protocol only orders small certificates. Tusk reads that DAG with a random coin to reach asynchronous consensus with zero extra messages.
researchArea: Distributed Systems
keywords: byzantine fault tolerance, mempool, dag, asynchronous consensus, random coin, reliable broadcast, hotstuff, scale-out
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

The authors propose separating reliable transaction dissemination from transaction ordering to enable high-performance Byzantine fault-tolerant quorum-based consensus. They design and evaluate Narwhal, a mempool specialized in high-throughput reliable dissemination and storage of causal histories of transactions, which tolerates an asynchronous network, keeps performance despite failures and scales out with multiple workers per validator. Composed with a partially synchronous consensus (Narwhal-HotStuff) it gives much better throughput even with faults or intermittent loss of liveness, but liveness loss can raise latency. To get good performance under faults they design Tusk, a zero-message overhead asynchronous consensus protocol that works with Narwhal.

## Overview

This is the EuroSys '22 paper (Rennes, France, April 2022) by George Danezis, Lefteris Kokoris-Kogias, Alberto Sonnino and Alexander Spiegelman, done largely at Facebook's Novi team. Text read: the arXiv v4 PDF (16 March 2022, 17 pages), the last revision, not the ACM version.

The problem: HotStuff (Yin et al., PODC 2019) reaches linear message complexity by having a leader collect, aggregate and broadcast messages, but the authors argue that message count is the wrong target. A leader that also proposes the bulk transactions becomes a bottleneck, while consensus messages (about 100 B) are tiny next to blocks (about 10 MB). Their hypothesis: a better mempool that reliably distributes transactions is the key to a high-performance ledger, leaving consensus to order small fixed-size references.

Background in this library: [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance), which the paper cites (its 2002 journal version), and [The Byzantine Generals Problem](/papers/byzantine-generals-problem) for the fault model. [FLP](/papers/flp-impossibility-of-distributed-consensus) explains why asynchronous consensus needs randomness, and [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) give the crash-fault ancestry. The paper cites none of these three, nor the Byzantine Generals paper; these links are the library's context, not the authors'. HotStuff itself is not in the catalog.

## Contribution

- **Narwhal mempool.** Each validator, per round, broadcasts a block holding transactions and 2f+1 certificates of availability from the previous round. 2f+1 signatures on a block form a certificate, so at least f+1 honest validators store it. The paper lists the properties Integrity, Block-Availability, Containment, 2/3-Causality and 1/2-Chain Quality, and the system model is n parties with f < n/3 Byzantine and eventually reliable asynchronous links.
- **Narwhal-HotStuff.** The leader proposes one or more certificates instead of transactions. On commit, the uncommitted causal history is ordered deterministically.
- **Tusk.** An extension of DAG-Rider: waves of 3 rounds (propose, vote, reveal a random coin), a leader block is committed if f+1 round-two blocks reference it, and earlier leaders are ordered recursively through DAG paths. The coin is built from an adaptively secure threshold signature. Tusk adds no messages beyond Narwhal.
- **Engineering.** Pull-based reliable broadcast with bounded memory, garbage collection agreed through consensus, and a primary-worker scale-out design in which workers stream transaction batches and the primary only handles batch hashes.

## Methodology

A Rust implementation (about 4,000 lines plus 2,000 of unit tests, Tokio, ed25519-dalek, RocksDB) was benchmarked on AWS m5.8xlarge instances (10 Gbps, 32 vCPUs) across 5 regions: N. Virginia, N. California, Sydney, Stockholm and Tokyo. Baseline parameters: 4 validators with one worker, 500 KB batches, 1 KB blocks, 512 B transactions, one client per worker at a fixed rate for 5 minutes, each point the mean of 2 runs. Latency is client submission to commit. Compared systems: Baseline-HS (transactions gossiped as in Bitcoin or Libra), Batched-HS (batches disseminated outside the critical path, as in Prism) and the Narwhal-based ones. Faults are crash faults.

## Findings

All numbers are the authors' and come from the text unless marked.

- **Baseline-HS** never exceeds 1,800 tx/s with 10 or 20 validators, at about 1 s latency.
- **Batched-HS** peaks at 70,000 tx/s with 10 nodes and up to 50,000 with 20, at about 2 s before saturation. The text calls this "almost 20x" over baseline, while the introduction says "up to 50x".
- **Narwhal-HotStuff** reaches 140,000 tx/s (Section 7.1) below 2 s. The abstract and conclusion say "over 130,000", with the conclusion tying it to 50 validators.
- **Tusk** is stable at about 3 s, with a peak of 170,000 tx/s at 50 validators in Section 7.1, while the abstract says 160,000. The paper says it is the most performant fully asynchronous protocol and about 20x faster than Dumbo2 (5,000 tx/s, 8 nodes, 250 B transactions).
- **Scale-out.** Throughput grows linearly with workers, up to about 600,000 tx/s, without added latency. The introduction describes Fig. 1 as over 500,000 tx/s at under 3.5 s latency.
- **Faults** (10 validators, 1 and 3 crashes). Baseline-HS throughput drops 5x from 800 tx/s and latency rises 40x. Batched-HS drops 30x (70k to 2.5k tx/s) and latency rises 10x. Tusk stays under 4 s with 1 fault and under 6 s with 3. Narwhal-HotStuff stays under 7 s with 1 and about 10 s with 3, against 35 to 40 s for the baselines.
- **Theory.** Table 1 gives expected commit latency in RTTs: HotStuff 3, Narwhal-HS 4, Tusk 4.5, and 7 under asynchrony for Tusk. Lemma 4 gives a leader commit probability above 1/3 per wave under an asynchronous adversary. Lemma 5 gives 4.5 rounds with random message delays, 7 rounds worst case. Safety and liveness are proved or argued in Section 5 and Appendix A.

## Critical Analysis

What the paper does not claim: it gives no formal message-complexity bound for Narwhal or Tusk beyond "zero message overhead" for Tusk and O(1) average, O(n) worst-case pull requests per block. It leaves fairness mechanisms to future work and warns that a slow honest validator is indistinguishable from a faulty one, so its transactions may commit much later. It gives 1/2-Chain Quality, not control over transaction order by the adversary. Clients must resubmit transactions that are not sequenced. The execution engine, and light clients that must locate batches across workers, are left open. The authors also note that evaluating BFT protocols under real Byzantine faults is an open question, and their faults are crashes.

Conditions to keep in mind: 512 B transactions, 5 AWS regions with 10 Gbps machines, committees of 4 to 50, no-op style load from fixed-rate clients and no execution. The numbers are not a prediction for other sizes or networks. The conclusion that dissemination, not consensus, is the main cost is a strong claim drawn from these settings. The paper's own numbers are inconsistent in places (130,000 vs 140,000; 160,000 vs 170,000; 20x vs 50x).

Later literature (not part of this paper): the catalog page for [Autobahn](/papers/autobahn-seamless-high-speed-bft), which I read as a catalog entry and not the original paper, reports building on the Narwhal and Bullshark code and argues that DAG protocols such as Bullshark need up to 12 message delays to commit. I did not open Bullshark, Sui or other later work.

## Further Research

The authors name fairness and incentives, client resubmission and transaction de-duplication (they point to Mir-BFT's hashing technique), an execution engine matched to the throughput, light clients, a more scalable primary (for example a Merkle root of batch hashes) and sharding interfaces as open work. A natural check is a deployment with actively Byzantine validators rather than crashes.
