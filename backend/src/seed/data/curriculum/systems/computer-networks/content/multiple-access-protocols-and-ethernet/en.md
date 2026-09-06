---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the multiple-access problem: what happens when several nodes share one physical transmission medium simultaneously.
- Describe CSMA/CD (carrier sense, multiple access, collision detection) step by step, including exponential random backoff.
- Explain why exponential backoff is randomized, and why the "exponential" part matters as contention increases.
- Distinguish a hub (a shared collision domain) from a switch (which isolates each link into its own collision domain), and explain why this makes CSMA/CD largely unnecessary on modern switched Ethernet.
- Contrast MAC addresses (link layer) with IP addresses (network layer), and state why both are needed rather than either alone.

## Context & Motivation

The previous concept covered framing and error detection for a single link between two nodes. This concept covers a genuinely different problem: what happens when more than two nodes share the exact same physical medium — the same wire, or the same slice of radio spectrum — and any of them might want to transmit at any moment. Classic Ethernet, historically, was built on exactly this shared-medium model, and CSMA/CD is its real, deployed solution to the resulting contention problem. Even though modern switched Ethernet has largely made CSMA/CD's active collision-avoidance mechanism unnecessary in practice (a genuinely important, concrete fact this concept explains, not glosses over), understanding the shared-medium problem and its classic solution remains foundational — and directly sets up the following concept on wireless networking, where a very similar problem reappears in a form that cannot be solved the same way.

## Core Theory

### The multiple-access problem

When multiple nodes share one physical transmission medium, and more than one transmits at the same time, their signals interfere — a collision — corrupting both transmissions so that neither is received correctly. A multiple-access protocol is the set of rules nodes sharing a medium follow to coordinate who transmits when, in an attempt to avoid, or at least recover gracefully from, such collisions.

### CSMA: carrier sense, multiple access

Carrier Sense Multiple Access (CSMA) is the first half of classic Ethernet's approach: before transmitting, a node "listens" to the shared medium (senses whether a carrier signal — someone else's ongoing transmission — is currently present). If the medium appears idle, the node transmits; if the medium appears busy, the node waits. This alone substantially reduces, but does not eliminate, collisions: because of real propagation delay, two nodes at different points on the medium can both sense the medium as idle and begin transmitting at nearly the same instant, before either one's signal has had time to physically reach and be sensed by the other — a genuine collision can still occur even with carrier sensing in place.

### CD: collision detection

Collision Detection (CD), the second half, has a transmitting node continue to listen to the medium while it transmits, specifically to detect whether a collision has occurred (typically by noticing a signal level inconsistent with only its own transmission). If a collision is detected, the transmitting node immediately stops transmitting (rather than wasting the medium's capacity finishing a transmission that has already been corrupted), and enters a backoff-and-retry procedure.

### Exponential random backoff

After detecting a collision, a node does not simply retry immediately — doing so would very likely produce another immediate collision with the same other node(s) it just collided with, especially if both follow an identical, deterministic retry rule. Instead, each node waits a random amount of time, chosen from a range that grows exponentially after each successive collision involving the same frame — the first collision picks a random wait from a small range, a second consecutive collision (for the same frame) picks from a range twice as large, and so on. Randomization spreads out retry attempts so that two nodes that just collided are very unlikely to pick the exact same wait time again; the exponential growth in range specifically responds to genuinely high contention (many consecutive collisions suggesting the medium is heavily loaded right now) by spreading retries over an increasingly wide window, reducing the odds of yet another collision as contention increases.

### Hubs vs. switches: collision domains

A hub is a simple physical-layer device that repeats an incoming signal out to every other port — every node connected to a hub shares one single collision domain, meaning CSMA/CD's collision-avoidance mechanism is genuinely necessary, since any two nodes connected to the same hub really can collide. A switch, by contrast, is a link-layer device that examines each frame's destination MAC address and forwards it only out the specific port connected to the intended recipient — each link connected to a switch is effectively its own, isolated collision domain, and if a switch's ports operate in full-duplex mode (separate simultaneous send and receive paths, common on modern Ethernet), collisions become structurally impossible on that link altogether. This is exactly why CSMA/CD, while historically essential to classic hub-based Ethernet, is largely vestigial on modern, fully-switched, full-duplex Ethernet networks — the collision-prone shared medium the protocol was designed for has, in most modern deployments, simply been engineered away by switches.

### MAC addresses vs. IP addresses

Every network interface has a link-layer address — a MAC (Media Access Control) address, typically a globally-unique 48-bit identifier burned into the hardware — used to identify a specific interface for exactly one hop's worth of link-layer delivery (an Ethernet frame's source and destination fields are MAC addresses, not IP addresses). This is a genuinely different kind of address from the network-layer IP address already covered, which identifies a host for routing purposes across the entire, multi-hop network core. Both are needed simultaneously, at different layers, for exactly the same reason layering itself exists: IP addresses support hierarchical, aggregatable routing across a network of arbitrary size and structure, while MAC addresses provide a flat, hardware-level identity needed for a single link's local delivery, a job IP addressing is not structured to do directly.

## Worked Examples

### Example 1: A collision detected mid-transmission

```text
1. Node A senses the medium is idle and begins transmitting.
2. Node B, at nearly the same instant, also senses the medium as idle
   (A's signal hasn't physically reached B yet due to propagation
   delay) and also begins transmitting.
3. Both signals collide on the shared medium.
4. Both A and B, still listening while transmitting, detect the
   collision and immediately stop transmitting.
5. Both A and B independently compute a random backoff time from an
   initial small range (say, 0 to 1 time-slot units) and wait that
   long before attempting to retransmit.
```

If A and B happen to pick different random backoff values (the overwhelmingly likely outcome), one of them retransmits first, successfully, before the other's backoff timer even expires — resolving the contention without a repeated collision.

### Example 2: Exponential growth in the backoff range after repeated collisions

```text
1st collision (for a given frame): backoff chosen from range [0, 1]
2nd consecutive collision:          backoff chosen from range [0, 3]
3rd consecutive collision:          backoff chosen from range [0, 7]
4th consecutive collision:          backoff chosen from range [0, 15]
```

Each successive collision (for the same frame, still not successfully sent) doubles the range the random backoff is drawn from — a direct response to the apparent evidence of high contention (repeated collisions), spreading retry attempts over an increasingly wide window specifically to reduce the odds of yet another collision the next time around.

### Example 3: Hub vs. switch — where a collision can and cannot occur

```text
Hub topology: Nodes A, B, C, D all connected to one hub.
  A transmitting and B transmitting simultaneously: COLLISION (all
  four nodes share one single collision domain — the hub repeats every
  signal to every port).

Switch topology: Nodes A, B, C, D each connected to their own dedicated
  port on a switch, each port operating full-duplex.
  A transmitting to the switch and B transmitting to the switch
  simultaneously: NO COLLISION (each link — A-to-switch, B-to-switch —
  is its own separate, isolated collision domain; the switch simply
  forwards each frame out the correct destination port independently).
```

This is exactly why modern Ethernet deployments, built almost entirely on switches rather than hubs, rarely if ever experience an actual collision in practice — CSMA/CD's mechanism remains part of the Ethernet standard for historical and compatibility reasons, but the shared-medium scenario it exists to handle has, for the most part, been engineered out of existence by switching.

## Common Misconceptions & Pitfalls

- **"CSMA/CD prevents all collisions."** Carrier sensing alone cannot prevent collisions caused by propagation delay (two nodes both sensing an idle medium before either one's transmission has physically reached the other) — CSMA/CD's real contribution is detecting a collision quickly once it happens and recovering from it gracefully via randomized backoff, not preventing every possible collision from occurring in the first place.
- **"Modern Ethernet still relies heavily on CSMA/CD."** Modern, fully-switched, full-duplex Ethernet largely eliminates the shared-medium scenario CSMA/CD exists to handle — collisions are structurally impossible on a full-duplex switched link, making CSMA/CD's active mechanism vestigial in most contemporary deployments, even though it remains part of the historical Ethernet standard.
- **"Backoff time should simply double after every collision, not be randomized."** Randomization, not merely the doubling range itself, is what actually resolves contention between two specific colliding nodes — if both nodes used a fixed, deterministic rule with no randomness, they could plausibly retry at the exact same moment repeatedly; randomly choosing a wait time from within a (growing) range is what makes it unlikely two colliding nodes pick the same retry moment again.
- **"MAC addresses and IP addresses serve the same purpose, just at different layers, so either alone would suffice."** They serve genuinely different, complementary purposes — MAC addresses provide flat, hardware-level, single-hop identity; IP addresses provide hierarchical, aggregatable, multi-hop routing identity — a network needs both simultaneously, which is exactly why ARP (the next concept) exists to translate between the two.

## Summary

When multiple nodes share one physical transmission medium, their transmissions can collide, corrupting both — classic Ethernet's CSMA/CD protocol addresses this by having nodes sense the medium before transmitting (carrier sense), detect collisions while transmitting (collision detection), and back off for a randomized, exponentially-growing wait time after each collision before retrying, specifically to reduce the odds of repeated collisions as contention increases. Hubs create one shared collision domain across every connected node, making CSMA/CD genuinely necessary; switches isolate each link into its own collision domain, making collisions structurally rare to impossible on modern, fully-switched, full-duplex Ethernet — which is exactly why CSMA/CD, while foundational historically, is largely vestigial in most contemporary deployments. MAC addresses, distinct from and complementary to the IP addresses already covered, provide the flat, hardware-level identity link-layer delivery needs for exactly one hop. The next concept, ARP, covers precisely how a node translates between these two different kinds of address when it needs to deliver a frame to a specific next hop.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of multiple access protocols, CSMA/CD, and Ethernet.
- [Stanford CS144 — Lecture Schedule ("Physical and Link layers")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture covering Ethernet and multiple access alongside the physical layer.
