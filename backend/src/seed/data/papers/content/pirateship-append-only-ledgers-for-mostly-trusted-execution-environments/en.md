---
title: "Pirateship: Append-Only Ledgers for (Mostly) Trusted Execution Environments"
summary: Pirateship embeds a Byzantine fault-tolerant audit protocol inside a crash-fault-tolerant consensus protocol, with no extra messages, so that a ledger running in trusted execution environments commits at the usual speed while rare TEE compromises are detected and reconciled within a bounded window, under a failure model that treats correlated platforms as the unit of compromise.
researchArea: Distributed Systems
keywords: consensus, trusted execution environments, byzantine fault tolerance, append-only ledger, auditing, platform fault tolerance, view change
version: 1.0
updatedAt: 2026-11-18
---

## Overview

Tamper-proof ledgers hold small amounts of highly sensitive state, such as secret keys or software-release claims, and serve as the root of trust of larger applications. Industry and academia now build them in layers: a crash-fault-tolerant (CFT) consensus protocol such as Raft replicates the log, and each node runs inside a hardware trusted execution environment (TEE) such as AMD SEV-SNP or Intel TDX, which is trusted to make the node follow the protocol and so rules out Byzantine behavior. That trust is cheap, since CFT needs only 2c+1 nodes and one voting phase.

The authors, from UC Berkeley, IST Lisboa and Microsoft Azure Research, point out that this trust is a single point of failure. Attackers have extracted secrets from every major TEE, vulnerabilities keep appearing, and one flaw can compromise every TEE of the same type in a cloud region, so a compromise is rare but catastrophic: the attacker can fork the whole log undetected. The opposite choice, trusting no TEE and running a Byzantine-fault-tolerant (BFT) protocol, costs more replicas (3f+1), more phases and more latency.

This SOSP 2026 paper (Prague) takes a middle path it calls cautious trust: commit at CFT speed, and audit in the background with BFT guarantees, so that a compromise is detected and the log reconciled without burdening clients.

Terms to keep apart: a committed transaction is durable as long as TEEs are not compromised, an audited transaction can never be rolled back up to a stated number of platform compromises, equivocation is a node sending conflicting messages to different peers, and a platform is a group of nodes that share a correlated failure domain (same TEE type, operator or region).

Worth knowing first: Raft and quorum intersection. [Raft](/papers/raft-understandable-consensus-algorithm) is the CFT protocol the paper takes as its starting point and as its baseline. [Autobahn](/papers/autobahn-seamless-high-speed-bft) is the state-of-the-art BFT protocol its audit performance is compared with.

## Contribution

- **Platform fault tolerance (PFT).** A failure model with nodes grouped into platforms, where crashes are independent per node but a TEE vulnerability compromises a whole platform. It separates safety from liveness and gives each its own tolerance: safe up to a number of platform compromises (`f_safe` nodes in the worst case), live up to `c` crashes and a number of platform compromises (`f_live`). Consensus needs `N >= 2(c + f_live) + f_safe + 1` nodes. With no Byzantine faults this is the CFT bound `2c+1`, and with `u = f_safe = f` it is the BFT bound `3f+1`, and it never exceeds BFT's. Pirateship is always configured to stay safe and may give up liveness.
- **Two confirmation levels.** A batch commits when a majority (`floor(N/2)+1`) has stored it in the same view, with no signatures, as in today's TEE ledgers. It is audited after a quorum of `N-u` signed votes, which guarantees non-equivocation, plus a second such quorum over the first, which guarantees the decision survives view changes (slow audit), or after signed votes from all `N` replicas (fast audit, a single round trip). A transaction that is audited can never be rolled back, a committed one can if platforms are compromised.
- **No extra messages.** Batches are hash-chained, so a vote for a batch is a vote for all its ancestors. Late votes, or votes for later batches, upgrade a commit quorum into an audit quorum asynchronously. Pipelining layers the second BFT phase on the next batch, so the audit never trails the commit index by more than a constant bound. The leader signs only every `s` batches, and auditing a signed batch audits its ancestors.
- **View stabilization.** After the usual view-change steps, a new leader proposes a blank signed batch and waits for an audit quorum on it before adding anything else. This makes committed-but-unaudited branches survive leader changes when nobody is malicious, even though commit quorums are smaller and unsigned. A four-rule branch selection (highest audit QC, fast-path candidates, then highest view and sequence number) preserves audited branches always and committed ones in the absence of malicious replicas.
- **Receipts and an audit API.** Commit receipts carry a Merkle inclusion proof, audit receipts add the audit quorum certificates and a short hash-chain segment, so clients can hand evidence to others. Clients choose per transaction, or per period, whether to wait for the audit.
- **Correctness and size.** The authors prove the protocol correct in an appendix and give a TLA+ specification. The implementation is about 8K lines of Rust (Tokio, Protobuf, Ed25519 and SHA-512).

## Methodology

The setup is Azure: 16-core DC16ads_v5 (AMD SEV-SNP), DC16eds_v5 (Intel TDX) and D16ads_v5 (no TEE) machines with 64 GB of memory, up to five D8ds_v5 clients, and by default seven nodes (`u = f_safe = 2`) in one region (East US) on SEV-SNP with 0.6 ms ping, batches of 1000 and 512-byte payloads, signing every 10 batches. Baselines, reimplemented on the Pirateship codebase except Autobahn (its open source code), are `signed_raft` (Raft with hash chaining and periodic signatures, like Microsoft's CCF), `engraft` (Raft with an extra two-phase commit against disk rollback), `hotstuff`, `autobahn` and `peer_review` (an accountability protocol with signed witnesses). Commit performance is compared with the first two, audit performance with the BFT protocols, and results for Autobahn and PeerReview were validated with their authors.

Further experiments deploy up to five platforms, each a (TEE, region) pair across several Azure regions, in three configurations; measure TEE overhead and signing interval; inject omission attacks (nodes that never answer) and a commission attack (a leader equivocating to two partitions); and build five applications: a versioned key-value store (YCSB, 300K objects), a banking app, a key transparency service, a Signal-style secret key recovery service and a code transparency service compared with one on CCF.

## Findings

These are the authors' reported results.

- **Commit performance.** With seven nodes and signing every 10 batches, Pirateship peaks at 345K transactions per second, limited by the leader's bandwidth. `signed_raft` with only five nodes reaches 520K, which makes the 35% gap the price of the larger replication factor needed for audit, and Pirateship reaches 87% of `signed_raft` with seven nodes. It is 1.9 times faster than `engraft`, 46% faster than `hotstuff` (20% when signing every batch) and, signing every batch, 39% above `peer_review`.
- **Audit performance.** Pirateship audits at 88.6% of Autobahn's throughput with 15% lower latency, and the authors say cautious trust in TEEs gives up to 2.6 times lower commit latency than a protocol that trusts none.
- **Platforms.** With one platform compromise tolerated for safety, a configuration with seven nodes over four platforms (2,2,2,1) has 51% and 59% lower commit latency than the other two, because a commit needs votes from only two regions instead of three. Peak throughput falls 24% when a 1.17 Gbps link to West Europe joins.
- **Overheads.** Running inside Intel TDX or AMD SEV-SNP reduces throughput by 11 to 15%. Signing every 10 batches rather than every batch raises throughput 1.24 times and audit latency 1.84 times.
- **Attacks.** When nodes withhold the votes a fast audit needs, slow audits are 1.9 times slower with no throughput loss. With an equivocating leader, commits continue for about 2.4 seconds while audit throughput drops to zero, followers time out after 4 seconds, the new leader selects its branch at about 35 seconds, the replica on the conflicting branch rolls back, and steady state returns around 40 seconds.
- **Applications.** Audited bank transfers take 1.7 times as long as committed ones. A key transparency service that starts waiting for audits after a TEE vulnerability sees response time jump about 1.7 times and return to normal afterwards. The key recovery service throttles a bursty user, whose median latency is 20 times higher, while a user at one guess per second is never throttled. In the code transparency service, audit receipts on the fast path have latency comparable to commit receipts, and the authors report that the stronger guarantees do not cost performance against a CCF-based service.

## Critical Analysis

The paper states several limits itself.

- **The platform grouping is a belief.** Whether two platforms fail independently depends on the operator's judgment, and an unknown shared vulnerability can exceed `f_safe`, as in any fault threshold. Reconfiguration lets the grouping change as beliefs change.
- **Safe, not necessarily live.** Pirateship is configured for safety, and liveness under compromise costs two extra nodes per compromised node tolerated. The authors argue that malicious hosts can already stall liveness, so the cost is often not worth paying.
- **No blame.** It detects and reconciles divergence but does not identify the faulty nodes, which it leaves to accountability work such as PeerReview, called complementary.

The following points are a reading of the evidence, not claims of the paper.

- **Reconciliation is pushed to applications.** A committed transaction can be rolled back after an attack, so applications that act on commit must undo effects, as the versioned key-value layer and the password-guess counter do. The claim that auditing places no burden on clients holds for clients that never wait for audit and never see a rollback, and the 1.7 times latency of audited operations is the price for the others.
- **The attacks are injected.** The equivocation test shows the mechanism working on a scripted leader, and the vulnerabilities are not real TEE exploits. The bound on how far the audit trails the commit is a constant number of batches, but the exposure window in seconds under load is not reported, and an adversary that adapts to the protocol (for example by timing attacks around view changes) is not tried.
- **The comparison depends on the authors' own ports.** Four of the five baselines were reimplemented on the Pirateship codebase, which keeps the comparison controlled but leaves open how a production system such as CCF or the original engraft would fare. The 35% gap to a five-node `signed_raft` is real: auditing needs more replicas.
- **One cloud and one deployment shape.** Everything runs on Azure, with SEV-SNP and TDX and up to five platforms. A true multi-cloud setup, where platforms differ in operator as well as TEE type, is argued but not measured, and bandwidth, not the protocol, limits throughput in several results.
- **The formal part is hard to check.** A proof and a TLA+ specification are in the appendix, and the main text only summarizes them, so a reader cannot verify the view-stabilization argument from the paper body.

## Further Research

- Identifying the compromised platform after a divergence, combining PFT with accountability techniques.
- A genuinely multi-cloud evaluation with measured platform independence, and automatic reconfiguration when a new vulnerability changes which platforms count as independent.
- Application patterns for rollback of committed transactions, and cheaper ways to let clients choose commit or audit per request.
- Sharding the leader's bandwidth, since it limits throughput, for example with parallel proposers as in DAG-based BFT protocols.
