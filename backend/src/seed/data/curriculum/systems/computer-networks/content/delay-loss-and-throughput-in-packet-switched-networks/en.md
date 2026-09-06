---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Name and define the four components of nodal delay: processing, queuing, transmission, and propagation.
- Compute transmission delay and propagation delay separately for a given link, and explain why they are easy to conflate but govern different physical quantities.
- Define traffic intensity and explain, qualitatively and with a formula, why average queuing delay grows without bound as traffic intensity approaches 1.
- Define packet loss as a consequence of finite buffer capacity, and explain why it is a normal, expected feature of a packet-switched network rather than a rare failure.
- Distinguish instantaneous throughput from average throughput, and identify the bottleneck link along a path as the one that determines end-to-end throughput.

## Context & Motivation

The previous concept introduced store-and-forward transmission delay in isolation, as the time to push a packet's bits onto a single link. That is only one of four distinct delay components a packet accumulates at every single hop on its way across the network core, and by far the most important of the four to understand deeply is queuing delay — because unlike the other three, which are essentially fixed given a packet's size and a link's physical properties, queuing delay depends entirely on how much other traffic happens to be competing for the same link at that exact moment, and it can grow explosively as a network approaches its capacity.

This concept develops nodal delay in full, introduces traffic intensity as the tool for reasoning about queuing delay quantitatively, and defines packet loss and throughput as the other two performance-defining quantities every later concept in this discipline — TCP's timeout estimation, congestion control's response to loss, the practical experience of "the network feels slow" — ultimately traces back to.

## Core Theory

### The four components of nodal delay

At every node (router or host) a packet passes through, it experiences:

1. **Processing delay (`d_proc`)** — the time for a router to examine the packet's header (to decide, for instance, which outgoing link to forward it on) and perform any needed checks. Typically on the order of microseconds or less in modern routers.
2. **Queuing delay (`d_queue`)** — the time the packet waits in an output buffer before it can be transmitted, because the outgoing link is currently busy transmitting another packet. This is the most variable of the four, and the focus of the rest of this concept.
3. **Transmission delay (`d_trans`)** — `L/R`: the time to push all `L` bits of the packet onto the link, at the link's transmission rate `R`. Already introduced in the previous concept.
4. **Propagation delay (`d_prop`)** — the time for a single bit, once transmitted, to physically travel the length of the link, at close to the speed of light in the medium. Depends only on the link's physical length, never on the packet's size or the link's transmission rate.

Total nodal delay is the sum: `d_nodal = d_proc + d_queue + d_trans + d_prop`.

### Transmission delay vs. propagation delay: a genuinely common confusion

Transmission delay depends on packet size `L` and link rate `R` (bigger packet, or slower link, means longer transmission delay); propagation delay depends only on the link's physical length and the speed of signal propagation in that medium — it does not depend on packet size or link rate at all. A very short packet sent over a very fast link can have negligible transmission delay while still incurring substantial propagation delay if the link spans, say, a transcontinental fiber route, and vice versa: a slow link can have large transmission delay for a large packet even if it's physically short. These two delays measure genuinely different physical phenomena and must not be conflated, even though both are, informally, "how long it takes the packet to get across this one link."

### Queuing delay and traffic intensity

Queuing delay depends on how many other packets are already queued ahead of a given packet at a router's output buffer, which in turn depends on how the rate of packets arriving compares to the rate the link can serve them. Define traffic intensity as `La/R`, where `L` is average packet length, `a` is the average packet arrival rate, and `R` is the link's transmission rate. This ratio captures how "full" a link is being kept:

- If `La/R > 1`: packets are arriving, on average, faster than the link can serve them. The queue grows without bound, and average queuing delay is effectively infinite (in practice, the buffer fills and packets are dropped).
- If `La/R` is close to 1 but below it: the queue can still grow very large during bursts of arrivals, even though the long-run average rate is technically sustainable — average queuing delay grows sharply, non-linearly, as traffic intensity approaches 1.
- If `La/R` is small: the queue rarely has more than a packet or two in it, and average queuing delay stays small.

This non-linear blowup as traffic intensity approaches 1 is a real, important phenomenon — a network operating at, say, 95% of a link's capacity is genuinely far worse off, in terms of delay experienced by real traffic, than one operating at 50%, even though both are "under capacity."

### Packet loss

A router's output buffer has finite capacity. When a packet arrives and the buffer is already full, the router has no choice but to drop it — packet loss. This is not a malfunction; it is an expected, designed-for consequence of packet switching's finite buffers combined with no advance reservation of capacity. A lost packet may be retransmitted by a higher layer (as later concepts on TCP's reliable data transfer cover in detail) or simply never recovered (as is the case for many UDP-based applications), but the loss itself, at the network layer, is a normal event under load, not an anomaly to be surprised by.

### Throughput

Throughput is the rate, in bits per second, at which data is actually delivered between sender and receiver. Instantaneous throughput is the rate at a specific point in time; average throughput is measured over a longer transfer. For an end-to-end path crossing multiple links, the achievable throughput is capped by the bottleneck link — the single slowest link along the entire path — no matter how fast every other link on the path is; a 1 Gbps connection at each end of a path that happens to cross one 10 Mbps link in the middle can never sustain more than roughly 10 Mbps end to end.

## Worked Examples

### Example 1: Separating transmission delay from propagation delay

A 1,000-byte (8,000-bit) packet is sent over a 10 Mbps link that is 2,000 km long, with a propagation speed of `2 × 10^8` m/s (typical for fiber).

```text
Transmission delay = L / R = 8,000 bits / 10,000,000 bits/sec = 0.8 ms

Propagation delay = distance / speed
                   = 2,000,000 m / (2 × 10^8 m/s)
                   = 10 ms
```

Here propagation delay (10 ms) dominates transmission delay (0.8 ms) by more than an order of magnitude — a direct, numeric illustration that a link's physical length, not its speed, can be the larger contributor to total delay, especially over long-haul links.

### Example 2: Traffic intensity and queuing-delay blowup

A link has transmission rate `R = 1` Mbps. Average packet length `L = 1,000` bits. Consider three different average arrival rates `a`:

```text
a = 500 packets/sec:  La/R = (1,000 × 500) / 1,000,000 = 0.5
a = 900 packets/sec:  La/R = (1,000 × 900) / 1,000,000 = 0.9
a = 999 packets/sec:  La/R = (1,000 × 999) / 1,000,000 = 0.999
```

Even though all three arrival rates are technically below the link's capacity (traffic intensity below 1 in all three cases), average queuing delay is dramatically higher at 0.999 than at 0.9, and dramatically higher at 0.9 than at 0.5 — the relationship is sharply non-linear, not proportional. This is the concrete, numeric version of "a network running close to full capacity feels much slower than the raw utilization percentage alone would suggest."

### Example 3: Finding the bottleneck link

A path from host A to host B crosses three links in sequence:

```text
Link 1 (A to router R1):  100 Mbps
Link 2 (R1 to router R2):  10 Mbps
Link 3 (R2 to host B):    100 Mbps
```

Even though two of the three links support 100 Mbps, the end-to-end throughput achievable between A and B cannot exceed 10 Mbps — the rate of the slowest link, Link 2, which is the bottleneck. No amount of speed on the other two links can compensate for one genuinely slower link somewhere on the path; this is exactly the reasoning applied later when diagnosing why an otherwise fast connection is capped at some unexpectedly low rate.

## Common Misconceptions & Pitfalls

- **"A faster link always means lower total delay."** A faster link (higher `R`) reduces transmission delay, but propagation delay depends only on the link's physical length and the medium's signal speed — a faster but equally long link does not reduce propagation delay at all.
- **"Traffic intensity below 1 means no meaningful delay."** Average queuing delay grows sharply, non-linearly, as traffic intensity approaches 1 from below — "under capacity" is not the same as "no delay," especially close to the boundary.
- **"Packet loss indicates a broken network."** Loss from a full buffer under load is an expected, designed-for outcome of packet switching's finite buffers and lack of advance reservation — it is what happens when demand exceeds capacity, by design, not evidence of malfunction.
- **"Throughput is set by the fastest link on the path."** It is capped by the slowest link on the path — the bottleneck — regardless of how fast every other link happens to be.

## Summary

Every hop a packet crosses adds nodal delay made of four components: processing (examine the header), queuing (wait for a busy outgoing link — the most variable of the four), transmission (`L/R`, the time to push the packet's bits onto the link), and propagation (the physical travel time of a signal along the link, independent of packet size or link rate). Traffic intensity (`La/R`) governs queuing delay, which grows sharply and non-linearly as intensity approaches 1, meaning a link running near its capacity feels far worse than the raw utilization number alone would suggest. Packet loss, from finite buffers filling under load, is a normal and expected feature of packet switching, not a failure. End-to-end throughput across a multi-link path is capped by the single slowest link — the bottleneck — regardless of every other link's speed. These four quantities — delay, queuing, loss, throughput — are what every later mechanism in this discipline (TCP's reliability, its timeout estimation, its congestion control) exists specifically to measure, react to, or work around.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of nodal delay, traffic intensity, loss, and throughput.
- [ACM/IEEE CS2013 — Networking and Communication Knowledge Area](https://csed.acm.org/knowledge-areas-networking-and-communication-nc-cs2013-version/) — curriculum guidelines listing delay, loss, and throughput analysis among the field's foundational quantitative tools.
