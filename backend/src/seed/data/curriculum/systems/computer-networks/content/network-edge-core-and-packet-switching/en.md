---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe the Internet's structure as two distinct parts: the network edge (end systems and access networks) and the network core (an interconnected mesh of packet switches).
- Define packet switching and explain how it differs from circuit switching.
- Compute store-and-forward transmission delay for a packet of a given size crossing a link of a given rate.
- Explain why packet switching allows statistical multiplexing, and why that makes it more efficient than circuit switching's dedicated reservations for the kind of bursty traffic real applications generate.
- Identify the tradeoff packet switching accepts in exchange for that efficiency: no guaranteed bandwidth, and the possibility of queuing delay or loss at a switch.

## Context & Motivation

Before any protocol, any layer, any algorithm can be discussed, this discipline needs a picture of what the Internet actually *is*, physically. It is not a single wire or a single machine; it is millions of end systems — laptops, phones, servers, sensors — connected at the edge to access networks (a home Wi-Fi router, a cellular tower, a corporate LAN), which in turn connect into the network core: a mesh of interconnected routers, owned by many different organizations (Internet Service Providers, universities, backbone operators), that carries data between any two edge points that need to communicate. Kurose & Ross's *Computer Networking: A Top-Down Approach* opens with exactly this edge/core distinction, and it is not just scene-setting — every later concept in this discipline lives on one side of that line or the other. Application-layer and transport-layer concepts describe what happens at the edge, between two communicating end systems; network-layer and below describe what happens inside the core, as packets are moved hop by hop toward their destination.

The core's defining design decision is how it moves data: packet switching. A message a user wants to send — an email, a web page, a video frame — is broken into smaller chunks called packets, each stamped with a destination address, and each one is forwarded independently through the network, hop by hop, with no advance reservation of resources along the path. This stands in contrast to circuit switching, the design telephone networks historically used, where a call first reserves a dedicated slice of bandwidth along an entire path before any conversation begins, and holds that reservation, unused or not, for the call's whole duration. The Internet's designers chose packet switching deliberately, and understanding why — and what it costs — is the entry point to everything else in this discipline.

## Core Theory

### The network edge

The network edge consists of end systems (also called hosts): the computers that actually run the applications a network exists to support — web browsers, email clients, video-conferencing software. Hosts connect to the rest of the Internet through an access network, which can be a home broadband connection, a corporate Ethernet, or a cellular data connection. The access network is the "last mile" — the single link (or first hop) connecting an end system into the shared infrastructure of the network core.

### The network core

The network core is the mesh of packet switches — routers — and the links connecting them, that interconnects every access network on the planet, in principle allowing any two end systems anywhere to communicate. A path between two hosts typically crosses many routers, each owned by a potentially different organization, connected via bilateral or multilateral agreements. There is no single owner or central controller of the core as a whole; it functions as a network of independently-administered networks, which is precisely why the word "Internet" — literally, a network of networks — describes it accurately.

### Packet switching, defined

In a packet-switched network, an end system's message is divided into packets: fixed-or-variable-length chunks of data, each carrying a header with, at minimum, the packet's destination address. Each packet is transmitted independently across the network core. At every router along the path, a packet is received in full, stored briefly, and then forwarded onward toward the next hop — a strategy called store-and-forward transmission. No resources (bandwidth, buffer space) are reserved in advance for any particular flow of packets; a router serves whichever packets arrive, in whatever order they arrive, sharing its outgoing link's capacity among all of them.

### Store-and-forward transmission delay

Because a router must receive an entire packet before it can begin forwarding any part of it onward, a packet of `L` bits crossing a link of transmission rate `R` bits/second incurs a store-and-forward delay of `L/R` seconds at every hop, before propagation delay (the time for the signal itself to travel the physical length of the link) is even considered. A message crossing `N` links, each with the same rate `R`, therefore experiences store-and-forward delay that accumulates hop by hop rather than existing only once at the source — a concrete, quantifiable cost of the "receive it all, then send it on" design, worked through with real numbers in this concept's Worked Examples.

### Statistical multiplexing: why packet switching is efficient

Circuit switching reserves a fixed slice of a link's capacity for a connection's entire duration, whether or not that connection has data to send at any given instant — a phone call that pauses in silence for a few seconds still holds its reserved circuit. Packet switching instead lets every flow contend for a link's full capacity whenever it actually has a packet ready to send; a router serves packets from many different flows in whatever order they arrive, an arrangement called statistical multiplexing (no fixed schedule per user, unlike circuit switching's fixed time slots). For traffic that is bursty — as almost all real computer-network traffic is, alternating between active bursts and idle gaps — statistical multiplexing lets far more flows share a given link's total capacity than a circuit-switched reservation scheme would allow, since idle flows consume nothing.

### The cost: no guarantees, and contention at every hop

Packet switching's efficiency is not free. Because no bandwidth is reserved, packets from many different flows genuinely compete for a router's outgoing link at every hop; if too many packets arrive at once, a router's queue can grow, adding queuing delay, and if a router's buffer is full, arriving packets are simply discarded — packet loss. Unlike a circuit-switched call, which is guaranteed its reserved capacity for its entire duration once the call is set up, a packet-switched connection has no such guarantee at any point along its path; performance genuinely depends on how much other traffic happens to be competing for the same links at the same moment. This tradeoff — statistical efficiency purchased at the cost of no per-flow guarantee — is the single most important design decision this whole discipline builds on top of, and it re-appears explicitly when reliable data transfer and congestion control are introduced later: TCP exists specifically because the network layer itself makes no promise that a packet will arrive, arrive in order, or arrive at all.

## Worked Examples

### Example 1: Store-and-forward delay across two links

A 2,000-bit packet must cross two links, each with a transmission rate of 1 Mbps (1,000,000 bits/second), via one intermediate router. Ignoring propagation delay for now, the store-and-forward delay at each hop is:

```text
L / R = 2,000 bits / 1,000,000 bits/sec = 0.002 seconds = 2 ms
```

Because the intermediate router must receive the *entire* packet before forwarding any of it, the total store-and-forward delay across both hops is not a single 2 ms — it is 2 ms + 2 ms = 4 ms, one full transmission delay incurred independently at each link the packet crosses. This is a direct, quantifiable consequence of store-and-forward: the delay accumulates linearly with the number of hops, before any propagation delay along the physical links is even added in.

### Example 2: Circuit switching vs. packet switching under bursty traffic

Consider a link with 1 Mbps total capacity shared among 10 users, each of whom is active only 10% of the time (bursty — sending data in short bursts, then idle) but who, when active, needs the full 1 Mbps to communicate at their desired rate.

```text
Circuit switching: reserves 1 Mbps / 10 = 100 kbps per user, permanently,
  whether that user is active or idle. All 10 users can be connected
  simultaneously, but each is capped at 100 kbps even when active — far
  below the 1 Mbps they actually need when sending.

Packet switching: makes no fixed reservation. When a user is active, its
  packets can use up to the link's full 1 Mbps capacity (contending with
  any other users who happen to be active at the exact same instant).
  Since only ~10% of users are active on average at any moment, the odds
  that more than a couple of users contend simultaneously are low, so most
  active users get close to the full 1 Mbps they need most of the time.
```

This is the concrete, numeric version of "statistical multiplexing lets more users share a link efficiently under bursty traffic" — not an abstract claim, but a real capacity-sharing calculation.

### Example 3: Where a packet's total delay actually comes from

A packet crossing a single link accumulates four distinct kinds of delay, only one of which (transmission/store-and-forward) was derived above:

```text
d_total = d_proc + d_queue + d_trans + d_prop

d_proc  = processing delay: time for the router to examine the packet's
          header and decide which outgoing link to use.
d_queue = queuing delay: time the packet waits in a buffer before it can
          be transmitted, if the outgoing link is currently busy.
d_trans = transmission delay: L / R, derived above.
d_prop  = propagation delay: the physical time for the signal to travel
          the link's length, at roughly the speed of light in the medium.
```

Queuing delay is the most variable of the four — it depends entirely on how much other traffic happens to be competing for the same outgoing link at that moment, which is precisely the contention packet switching accepts in exchange for its efficiency (Delay, Loss, and Throughput, the next concept, develops this further with real numeric traffic-intensity scenarios).

## Common Misconceptions & Pitfalls

- **"Packet switching means packets take a fixed, single reserved path, just broken into pieces."** No — packet switching specifically means no path or bandwidth is reserved in advance. Different packets belonging to the same flow may even take different physical paths through the network, arriving out of order, though this discipline's later transport-layer concepts show how that gets hidden from the application.
- **"Store-and-forward means the packet is stored permanently at each router."** It means each router waits to receive the packet *in full* before forwarding any of it onward — a brief, temporary hold for exactly as long as it takes to receive all L bits, not persistent storage.
- **"Circuit switching is strictly worse than packet switching."** For traffic that isn't bursty — a use case needing a constant, guaranteed rate for a long duration — circuit switching's guarantee has real value that packet switching's best-effort service does not provide. The tradeoff is genuine, not a one-sided historical mistake.
- **"The network core is one organization's infrastructure."** It is a mesh of independently-owned and -administered networks (ISPs, backbone providers, universities) interconnected by business and technical agreements — there is no single central owner, which is exactly what makes routing between autonomous systems (covered later in this discipline) a genuinely hard, partly economic problem.

## Summary

The Internet's physical structure splits into the network edge (end systems and their access networks) and the network core (a mesh of independently-owned packet switches and links). The core moves data via packet switching: messages are broken into packets, each forwarded independently hop by hop with no advance reservation of bandwidth, using store-and-forward transmission (a full packet must be received before any of it is forwarded onward, adding L/R delay at every hop). This design enables statistical multiplexing — many bursty flows sharing a link's capacity far more efficiently than circuit switching's fixed per-flow reservations would allow — at the real cost of no per-flow performance guarantee, since packets genuinely contend for capacity at every hop, which can produce queuing delay or, when a router's buffer is full, outright packet loss. This edge/core, packet-switched foundation is the physical reality every later concept in this discipline — protocol layering, delay analysis, transport reliability, routing — is built directly on top of.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's framing of the network edge, network core, and packet switching as the foundational structure of the Internet.
- [ACM/IEEE CS2013 — Networking and Communication Knowledge Area](https://csed.acm.org/knowledge-areas-networking-and-communication-nc-cs2013-version/) — curriculum guidelines establishing packet switching and network structure as Tier-1 foundational material for this subject area.
