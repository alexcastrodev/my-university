---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define an autonomous system (AS) and explain why the real Internet is organized as thousands of independently-administered ASes rather than one flat routing domain.
- Distinguish intra-domain (interior gateway) routing from inter-domain (exterior gateway) routing, and identify which real protocol handles each.
- Explain OSPF as a real, deployed link-state protocol, connecting it directly back to the Dijkstra-based algorithm covered in the previous concept.
- Explain why BGP is fundamentally a policy protocol, not merely a shortest-path protocol, and give a concrete example of policy overriding a shorter path.
- Explain, at a high level, why inter-domain routing at Internet scale is as much an economic and administrative problem as a purely technical one.

## Context & Motivation

The previous concept covered link-state and distance-vector routing as algorithmic families — Dijkstra and Bellman-Ford, applied in a distributed setting. This concept connects those families to the actual, deployed protocols that run the real Internet, and introduces a structural fact the previous concept's clean algorithmic framing glossed over for simplicity: the Internet is not one single network where every router participates in one shared routing computation. It is thousands of independently-administered networks — autonomous systems — each running its own internal routing, connected to each other by a separate protocol built to handle the genuinely different problem of routing between organizations that do not fully trust each other and do not want to expose their internal network structure.

## Core Theory

### Autonomous systems

An autonomous system (AS) is a network, or group of networks, under a single administrative control — an ISP, a university, a large company's network — with its own internal routing policy, identified by a globally-unique AS number. The real Internet consists of many thousands of these autonomous systems, interconnected via agreements (business relationships, peering arrangements) that are as much economic and contractual as technical. Routing within a single AS is a fundamentally different problem from routing between different autonomous systems, and the Internet uses two entirely separate protocol families to address them.

### Intra-domain routing: OSPF

Intra-domain (or interior gateway) routing operates within a single autonomous system, where every router is under the same administrative control and, critically, can reasonably trust every other router's advertised information. OSPF (Open Shortest Path First) is the dominant real, deployed link-state protocol used for this: every router within the AS floods link-state information to every other router within that same AS, and each router runs Dijkstra's algorithm — exactly the algorithm and the flooding mechanism already covered in the previous concept — to compute shortest paths to every other router within its own AS. OSPF is, concretely, link-state routing as already covered, deployed at real, operational scale within a single administrative domain.

### Inter-domain routing: BGP

Inter-domain (or exterior gateway) routing operates between different autonomous systems, where no such mutual trust or shared administrative control exists — an AS generally does not want to expose its full internal topology to other, independently-operated ASes, and different ASes may have real, conflicting business interests in how traffic flows between them. BGP (Border Gateway Protocol) is the single protocol that glues the entire Internet's autonomous systems together, and it is structurally a distance-vector-like protocol (each AS advertises, to its neighboring ASes, the AS-level paths it knows to various destinations, rather than flooding a complete topology) — but BGP is more precisely described as a path-vector protocol: each advertisement includes the entire sequence of AS numbers the path traverses, not merely a distance/cost number, which lets a receiving AS detect and avoid routing loops directly (a router simply refuses a path that already contains its own AS number) rather than needing distance-vector's more failure-prone iterative convergence.

### BGP is a policy protocol, not a shortest-path protocol

The genuinely important, sometimes surprising thing about BGP is that it does not simply select the shortest available AS-path — it selects the path that best satisfies each AS's own business and administrative policies, which can and often do override a shorter path entirely. An AS might prefer routing traffic through a business partner it has a favorable financial agreement with, even if a technically shorter path exists through a different AS it has no such arrangement with, or might refuse to carry certain traffic through its network entirely for policy reasons unrelated to path length. This is a genuine, deliberate departure from the pure shortest-path optimization that OSPF (and Dijkstra underneath it) performs within a single AS — at Internet scale, between independently-operated organizations with real competing interests, "shortest" is simply not the only, or even the primary, criterion that matters.

### Why this two-tier structure exists

Running a single, flat routing protocol across the entire Internet — every router everywhere participating in one shared computation — would be both technically infeasible at that scale (link-state flooding to every router on Earth, or Bellman-Ford's iterative convergence across every router on Earth, would be enormously slow and resource-intensive) and organizationally unworkable (no single AS wants to expose its full internal structure to every other AS, and no single routing policy could satisfy every AS's independent business interests simultaneously). The two-tier structure — fast, trust-based, shortest-path OSPF within an AS; slower, policy-driven, loop-safe BGP between ASes — is the real Internet's actual, deployed answer to both of those genuine constraints.

## Worked Examples

### Example 1: OSPF as deployed Dijkstra, within one AS

A university's network (a single AS) has routers R1 through R5, connected internally. OSPF floods link-state information among these five routers only — never beyond the university's own network boundary — and each router runs Dijkstra's algorithm over this internal topology to compute its own shortest paths to every other router within the university's network. This is identical, in mechanism, to the link-state example already worked through in the previous concept — OSPF is that mechanism, given a name and deployed at real operational scale.

### Example 2: BGP path-vector loop prevention

AS 100 advertises to AS 200 a path to some destination as: "AS-PATH: 100." AS 200, receiving this, prepends its own AS number before re-advertising it further: "AS-PATH: 200, 100." If this advertisement eventually reaches AS 100 again, via some other path (say, through AS 300): "AS-PATH: 300, 200, 100" — AS 100 immediately recognizes its own AS number already present in the path and rejects it, preventing a routing loop directly, from the explicit path information itself, without needing any iterative distance-comparison convergence process the way plain distance-vector routing would.

### Example 3: Policy overriding shortest path

AS X can reach a destination via two possible paths: Path A, through AS Y, with an AS-path length of 2 hops; Path B, through AS Z, with an AS-path length of 4 hops (longer). AS X has a business (peering) agreement with AS Z that makes routing through Z financially favorable, and no such favorable agreement with AS Y.

```text
Shortest AS-path:  via Y (2 hops)
AS X's actual policy choice:  via Z (4 hops) — chosen specifically
  because of the business relationship, despite being longer
```

This is not a malfunction or a routing error — it is BGP behaving exactly as designed: path length is only one input among several a real AS's routing policy can weigh, and business/administrative considerations can, and routinely do, legitimately override a shorter available path.

## Common Misconceptions & Pitfalls

- **"BGP is just distance-vector routing at a larger scale."** BGP is more precisely a path-vector protocol — each advertisement carries the complete AS-path, not merely a distance number — which is specifically what lets it detect and prevent routing loops directly (by checking for its own AS number in an advertised path) rather than relying on distance-vector's slower, more failure-prone convergence process; it is also explicitly policy-driven, unlike a "pure" shortest-path distance-vector protocol.
- **"OSPF and BGP solve the same problem at different scales."** They solve genuinely different problems: OSPF computes shortest paths within one trusted administrative domain; BGP negotiates reachability and policy between independently-operated, mutually-untrusting domains — the trust and policy dimension, absent within a single AS, is BGP's entire reason for being structured so differently from OSPF.
- **"The Internet would work better with one unified routing protocol instead of two tiers."** A single flat protocol would be technically infeasible at global scale (flooding or iterative convergence across every router on Earth) and organizationally impossible (no shared trust or unified policy exists across independently-operated organizations) — the two-tier intra-domain/inter-domain split is a real, necessary response to both constraints, not an arbitrary historical accident.
- **"Shortest path is always the correct or expected outcome of routing."** Within a single AS (OSPF), yes — that is exactly what link-state/Dijkstra optimizes for. Between autonomous systems (BGP), path length is only one factor among several real business and policy considerations, and a longer path is frequently, legitimately chosen over a shorter one.

## Summary

The real Internet is not one flat routing domain — it is thousands of independently-administered autonomous systems (ASes), each running intra-domain routing internally (OSPF, a real, deployed link-state protocol directly built on the Dijkstra-based mechanism already covered) and connected to each other via inter-domain routing (BGP, a path-vector protocol structurally related to distance-vector routing but explicitly driven by each AS's own business and administrative policy, not pure shortest-path optimization). BGP's path-vector design — advertising the complete AS-path, not just a distance — is what lets it detect and reject routing loops directly, and its policy-driven route selection means a technically longer path is routinely, legitimately chosen over a shorter one when business considerations favor it. This two-tier structure — fast and trust-based within an AS, slower and policy-negotiated between ASes — is the real Internet's practical, deployed answer to routing at a scale and across an organizational landscape no single flat protocol could handle. This concludes the Network Layer cluster; the next cluster moves one layer further down, to the link layer's single-hop framing and error detection.

## Documentation Links

- [ACM/IEEE CS2013 — Networking and Communication Knowledge Area](https://csed.acm.org/knowledge-areas-networking-and-communication-nc-cs2013-version/) — curriculum guidelines listing intra- and inter-domain routing among the field's core knowledge units.
- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of OSPF, BGP, autonomous systems, and inter-domain routing policy.
