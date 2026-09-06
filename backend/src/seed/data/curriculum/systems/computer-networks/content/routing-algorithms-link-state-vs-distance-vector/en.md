---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain that link-state routing is Dijkstra's algorithm, already covered, run over a globally-known topology graph — not new graph theory.
- Explain that distance-vector routing is the Bellman-Ford algorithm, already covered, run in a distributed fashion with each router knowing only its neighbors' costs.
- State the real information each approach requires a router to have, and why that difference has real, practical consequences for how each protocol actually operates.
- Trace the count-to-infinity problem in distance-vector routing on a small concrete topology, and explain why it happens.
- Connect this concept forward to the real protocols (OSPF, BGP) the next concept covers, which are concrete implementations of these two algorithmic families.

## Context & Motivation

The previous three concepts covered forwarding — the data-plane mechanics of using an already-built forwarding table. This concept turns to the control plane: how a network actually computes good paths, the routing-algorithm question the data-vs-control-plane distinction, several concepts ago, set aside for exactly this point in the cluster. The genuinely good news is that this is not new material to learn from scratch — link-state routing is Dijkstra's algorithm, already covered in full in `algorithms`, and distance-vector routing is the Bellman-Ford algorithm, also already covered there — this concept's real job is connecting those already-understood graph algorithms to the specific, real constraint networking adds: routers do not have free, instant access to a shared, correct picture of the entire network's topology the way an algorithms textbook's input graph assumes.

## Core Theory

### Modeling a network as a graph

A network of routers and links maps directly onto a graph: routers are nodes, links between routers are edges, and each edge has a cost (which might represent physical distance, delay, or simply "1" if hop count alone is what matters). Finding a "good" path from one router to another is, in this framing, exactly the shortest-path problem — the same problem `algorithms` already developed two complete, real solutions for.

### Link-state routing: Dijkstra's algorithm, applied

In link-state routing, every router first obtains complete, accurate knowledge of the entire network's topology — every router and every link's cost, network-wide — typically via a link-state broadcast, where each router floods information about its own directly-connected links to every other router in the network. Once a router has this complete topology graph, it runs Dijkstra's algorithm, exactly as already covered, computing shortest paths from itself to every other router in the network. The genuinely new thing link-state routing adds, relative to the already-covered algorithm itself, is the distributed mechanism (flooding) by which every router obtains the same complete, consistent topology graph in the first place — the shortest-path computation, once that graph is in hand, is unchanged Dijkstra.

### Distance-vector routing: Bellman-Ford, distributed

In distance-vector routing, no router ever has a complete picture of the network's topology — each router knows only the cost to reach each of its own directly-connected neighbors, and periodically exchanges its own current estimated distances to every destination with those same neighbors (never with the whole network). This is a direct, distributed application of the Bellman-Ford algorithm's core idea, already covered: a router updates its own estimated shortest distance to a destination based on a neighbor's advertised distance to that destination plus the cost of the link to that neighbor — repeated iteratively across the whole network until every router's estimates converge, with no single router ever needing the complete topology graph link-state routing requires.

### The real practical difference: how much each router needs to know

Link-state routing requires every router to hold and process a copy of the entire network's topology — more memory and computation per router, but each router computes its own routes independently and correctly, once, from a complete and consistent picture. Distance-vector routing requires only local knowledge (a router's own neighbors and the costs to reach them) — less memory and simpler computation per router, but convergence depends on repeated rounds of neighbor-to-neighbor communication, and, as the next section covers, can suffer from a genuine correctness problem link-state's global-knowledge approach does not have.

### The count-to-infinity problem

Distance-vector routing's reliance on possibly-stale, indirect information from neighbors (rather than direct, complete topology knowledge) creates a real failure mode when a link fails: a router that loses its direct route to a destination may, before it has processed the failure correctly, receive from a neighbor an advertised distance to that same destination that is itself based on a route through the now-failed link (information the neighbor has not yet updated) — the two routers can end up incrementing each other's distance estimates back and forth, slowly "counting up" toward infinity instead of correctly recognizing the destination is now unreachable via that path, a slow, undesirable convergence failure this concept's Worked Examples trace concretely. Link-state routing, because every router recomputes routes from a complete, freshly-updated topology graph after any change, does not suffer from this specific failure mode.

## Worked Examples

### Example 1: Link-state routing as literally Dijkstra's algorithm

A network has routers A, B, C, D with the following link costs: A-B: 1, B-C: 2, A-C: 4, C-D: 1. Every router, via link-state flooding, learns this entire topology. Router A now runs Dijkstra's algorithm — the exact same algorithm, with the exact same correctness guarantee, already covered in full — over this graph, computing:

```text
Shortest path from A to B: A-B, cost 1
Shortest path from A to C: A-B-C, cost 3 (cheaper than the direct A-C
  edge, cost 4)
Shortest path from A to D: A-B-C-D, cost 4
```

Nothing about this computation differs from the already-covered algorithm — the only genuinely new element link-state routing adds is that A had to first obtain this complete graph via flooding, information that, in a pure algorithms-textbook setting, is simply handed to the algorithm as its input.

### Example 2: Distance-vector convergence via Bellman-Ford's core update rule

Using the same topology, but now via distance-vector: router B initially knows only its direct neighbors' costs (to A: 1, to C: 2). Router C shares its own current distance estimates with B: "my distance to D is 1." B applies exactly the Bellman-Ford relaxation rule, already covered: "is going through C cheaper than what I currently know?"

```text
B's current estimate to D: unknown (infinity)
C's advertised distance to D: 1
Cost of the B-C link: 2

B's new estimate to D, via C: 2 (link cost) + 1 (C's distance to D) = 3
Since 3 < infinity (B's previous estimate), B updates: distance to D = 3
```

This is the identical relaxation step from Bellman-Ford, applied here in a distributed setting where B only ever sees C's advertised distance, never the underlying topology graph C used to compute it.

### Example 3: Tracing count-to-infinity after a link failure

Three routers in a line: A-B-C, with A-B cost 1 and B-C cost 1. A's route to C is via B, cost 2. Now the B-C link fails.

```text
1. B loses its direct link to C. B's OWN distance to C becomes infinity
   (correctly recognized).
2. BEFORE B has propagated this update, A still believes its old route
   (distance to C = 2, via B) is valid, and, per its normal periodic
   update schedule, advertises to B: "my distance to C is 2."
3. B, not yet aware A's route was ALSO through the now-broken B-C link,
   incorrectly computes: distance to C via A = 1 (A-B link cost) + 2
   (A's advertised distance) = 3. B updates its distance to C: 3.
4. B now advertises "distance to C is 3" back to A.
5. A, seeing B's new, higher distance, recomputes ITS OWN distance to C
   via B: 1 (A-B link cost) + 3 (B's now-updated distance) = 4.
6. This exchange continues, with both A and B's distance-to-C estimates
   slowly incrementing back and forth (3, 4, 5, 6, ...) instead of
   correctly converging on "C is unreachable" — count-to-infinity.
```

The root cause is visible directly in the trace: A's distance-2 route was silently routed through the very link that just failed, and B, lacking any global topology view, has no way to recognize this without additional mechanisms (such as split-horizon or poison-reverse, real partial mitigations not developed further in this introductory concept) beyond the basic Bellman-Ford update rule alone.

## Common Misconceptions & Pitfalls

- **"Link-state and distance-vector are entirely new algorithms invented specifically for networking."** They are direct, distributed applications of Dijkstra's algorithm and the Bellman-Ford algorithm respectively, both already covered in full in `algorithms` — the genuinely new material here is the distributed mechanism (flooding, or iterative neighbor exchange) each approach uses to obtain the information its underlying algorithm needs, not the shortest-path computation itself.
- **"Distance-vector routing is simply an inferior version of link-state routing."** Distance-vector requires far less information and computation per router (only local, neighbor-level knowledge, versus a complete topology graph) — a real, legitimate advantage in resource-constrained or very large networks, traded against distance-vector's genuine correctness weakness (count-to-infinity) that link-state does not share.
- **"Count-to-infinity happens because Bellman-Ford is a flawed algorithm."** The already-covered Bellman-Ford algorithm, given a complete and static graph as input, is fully correct — count-to-infinity arises specifically from distance-vector routing's *distributed*, information-limited setting, where routers act on stale, indirect information from neighbors that has not yet propagated a topology change, a problem the algorithm itself, run centrally over a complete graph, never encounters.
- **"Every router in a link-state network computes different, potentially inconsistent routes."** Assuming every router receives the same, complete, correct topology information via flooding, every router runs the identical Dijkstra computation over the identical graph and arrives at globally consistent shortest-path results — a real correctness guarantee link-state's global-knowledge approach provides that distance-vector's purely local, iterative approach does not.

## Summary

Link-state routing and distance-vector routing are not new graph algorithms — they are Dijkstra's algorithm and the Bellman-Ford algorithm, both already covered in full, applied under networking's real, distributed constraints. Link-state routing first floods complete topology information to every router, which then independently runs Dijkstra over that shared, complete graph, guaranteeing globally consistent, correct routes at the cost of requiring every router to hold and process the entire network's topology. Distance-vector routing requires only local, neighbor-level knowledge, iteratively applying Bellman-Ford's relaxation rule via periodic exchange of distance estimates with immediate neighbors — a lighter-weight approach with a real, well-known correctness weakness, count-to-infinity, that can arise when a link fails and stale, indirect distance information circulates between routers before correctly converging. The next concept connects both algorithmic families to real, deployed protocols — OSPF (link-state) and BGP (a policy-driven cousin of distance-vector) — at the actual scale of the real Internet.

## Documentation Links

- [Stanford CS144 — Lecture Schedule ("Routing 1", "Routing 2")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture sequence dedicated to both routing-algorithm families.
- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of link-state and distance-vector routing, including the count-to-infinity problem.
