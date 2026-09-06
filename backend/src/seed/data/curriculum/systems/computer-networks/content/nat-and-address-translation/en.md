---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the address-scarcity problem NAT was deployed to solve, and why private address ranges alone don't fully solve it.
- Trace how a NAT router rewrites an outgoing packet's source address and port, and maintains a translation table to route replies back correctly.
- Explain why one public IP address, via port translation, can serve many simultaneous internal hosts.
- State honestly what NAT breaks: the end-to-end principle, and give a concrete example of a real complication this causes.
- Distinguish NAT (a data-plane, per-packet rewriting mechanism) from routing (a control-plane path-computation mechanism) — a direct application of the distinction established earlier in this cluster.

## Context & Motivation

IPv4's roughly 4.3 billion addresses sounded enormous when the protocol was designed, decades before the Internet's real scale — billions of connected devices — became apparent. Rather than an immediate, wholesale transition to a larger address space (IPv6, which does provide one, but whose full deployment has taken decades and is still ongoing), Network Address Translation (NAT) became the pragmatic, widely-deployed stopgap that let the IPv4 Internet keep functioning far longer than its original address space alone would have allowed. This concept covers how NAT actually works, mechanically, and is honest about the real architectural cost it imposes — a cost every following concept about routing across the wider Internet implicitly assumes NAT has already been dealt with.

## Core Theory

### The problem: not enough public addresses

Every device that wants to communicate directly on the public Internet traditionally needs its own globally-unique IP address, but the demand for addresses — billions of laptops, phones, and other devices — vastly exceeds IPv4's roughly 4.3 billion total address space, especially once the wasteful allocation practices CIDR only partially corrected are accounted for. Private address ranges (blocks like `10.0.0.0/8` and `192.168.0.0/16`, reserved specifically for use within private networks and never routed on the public Internet) let an organization or a household use as many internal addresses as it wants without needing that many public addresses — but private addresses alone are not directly reachable from the public Internet, so something is needed to let devices using them still communicate outward.

### How NAT works

A NAT router sits at the boundary between a private network (using private addresses internally) and the public Internet (where it has one, or a small number, of genuine public IP addresses). When an internal host sends an outgoing packet, the NAT router rewrites the packet's source IP address (replacing the internal host's private address with the router's own public address) and typically also rewrites the source port number (to a fresh, router-chosen port), then records this translation — private address, private port, chosen public port — in a translation table before forwarding the packet onward. When a reply arrives from the outside, addressed to the router's public address and that specific chosen port, the router consults its translation table to determine which internal host and port the reply should actually be delivered to, rewrites the destination address and port accordingly, and forwards the reply inward.

### Port translation: many internal hosts, one public address

Because NAT rewrites port numbers, not just addresses, a single public IP address can serve many simultaneous internal hosts and connections at once — the translation table's key is the (private address, private port) to (public address, public port) mapping, and as long as the router assigns a distinct public port to each active internal connection, replies can be correctly routed back to the right internal host even though they all appear, from the outside, to be going to or from the exact same single public IP address.

### What NAT breaks: the end-to-end principle

The Internet's original design assumed the end-to-end principle: two communicating hosts have their own genuine, stable, globally-reachable addresses, and any intelligence needed for the communication belongs at the endpoints, not inside the network. NAT genuinely violates this: an internal host behind NAT does not have a stable, globally-reachable address of its own from the outside world's point of view — it is reachable only via the NAT router's translation table, which is itself only populated in response to an outgoing connection the internal host initiated. This is precisely why an unsolicited inbound connection to a host behind NAT (someone outside trying to initiate contact with an internal host that has not first reached out) generally does not work without additional configuration (port forwarding, or a NAT traversal technique) — a real, concrete complication for peer-to-peer applications and certain protocols that assume any host can be reached directly.

### NAT is a data-plane mechanism, not a routing decision

Consistent with the data-plane/control-plane distinction established earlier in this cluster, NAT is a per-packet rewriting operation, performed at the same fast timescale as ordinary forwarding, using a translation table the router maintains as connections are established and torn down — it does not involve recomputing routes or running a routing algorithm; it simply rewrites addressing information on packets as they pass through, then forwards them using ordinary forwarding logic afterward.

## Worked Examples

### Example 1: Tracing an outgoing connection through NAT

An internal host at `10.0.0.5`, using local port `40000`, sends a packet to a public web server at `93.184.216.34:80`. The NAT router's own public address is `203.0.113.9`.

```text
1. Internal host sends: source=10.0.0.5:40000, dest=93.184.216.34:80
2. NAT router rewrites the source and records the translation:
   source rewritten to 203.0.113.9:60001 (router-chosen public port)
   Translation table entry added:
     (10.0.0.5:40000) <-> (203.0.113.9:60001)
3. Packet forwarded to the web server as: source=203.0.113.9:60001,
   dest=93.184.216.34:80
4. Web server's reply arrives addressed to: dest=203.0.113.9:60001
5. NAT router looks up 60001 in its translation table, finds it maps
   to (10.0.0.5:40000), rewrites the destination accordingly, and
   forwards the reply inward to the actual internal host.
```

From the web server's point of view, it only ever saw `203.0.113.9:60001` — it has no visibility into the actual internal address `10.0.0.5` at all.

### Example 2: Multiple internal hosts sharing one public address

```text
Internal host A: 10.0.0.5:40000  →  translated to  203.0.113.9:60001
Internal host B: 10.0.0.8:50000  →  translated to  203.0.113.9:60002
Internal host C: 10.0.0.5:40001  →  translated to  203.0.113.9:60003
  (note: host A again, but a DIFFERENT local port — this needs its
   own, distinct translation entry too, since it's a separate
   connection)
```

All three connections appear, from any external host's point of view, to originate from the single public address `203.0.113.9` — only the port numbers differ, and the NAT router's translation table is what correctly routes each reply back to the right internal host and port, out of potentially thousands of simultaneous translated connections it may be tracking at once.

### Example 3: Why an unsolicited inbound connection fails without configuration

Suppose an external host tries to initiate a brand-new connection directly to internal host A at `10.0.0.5`, with no prior outgoing connection from A having established a relevant translation table entry:

```text
External host sends a packet addressed to 203.0.113.9 (the NAT
  router's public address) on some port, hoping to reach host A.

NAT router checks its translation table for an entry matching that
  destination port — finds NOTHING, because no outgoing connection
  from any internal host has ever used that specific public port.

Result: the router has no idea which internal host this packet is
  "for" (10.0.0.5 was never actually reachable at that specific public
  port from the outside) — the packet is typically dropped.
```

This is exactly the end-to-end-principle violation named above, made concrete: without a pre-existing translation entry (created only by an internal host initiating an outgoing connection first), or explicit manual configuration (port forwarding, telling the router in advance "always send traffic on port X to internal host A"), an external host simply cannot reach an internal host behind NAT directly.

## Common Misconceptions & Pitfalls

- **"NAT is a routing mechanism."** NAT rewrites addressing information on packets as a data-plane operation — it does not compute paths or make routing decisions; after rewriting, the packet is forwarded using ordinary, unrelated forwarding logic, consistent with the data-plane/control-plane distinction established earlier in this cluster.
- **"NAT solved IPv4 address exhaustion permanently."** NAT is a pragmatic workaround that dramatically reduced the *rate* of public-address consumption (many internal hosts sharing one public address) — it did not increase the total available address space, which is what IPv6's much larger address space is actually designed to solve.
- **"Every internal host behind NAT is completely unreachable from outside."** An internal host is unreachable *by default*, absent a pre-existing outgoing-connection-created translation entry — but explicit configuration (port forwarding) or additional NAT-traversal techniques can enable specific inbound reachability when genuinely needed, at the cost of extra setup complexity NAT's basic operation does not require.
- **"NAT and private address ranges are the same thing."** Private address ranges (like `10.0.0.0/8`) are simply reserved address blocks not routed on the public Internet; NAT is the separate, active mechanism that actually lets hosts using those private addresses communicate with the public Internet at all, by rewriting their addressing at the network boundary.

## Summary

NAT lets many internal hosts, using private addresses not directly reachable from the public Internet, share one (or a small number of) public IP addresses by rewriting outgoing packets' source address and port and maintaining a translation table to correctly route replies back to the right internal host — port translation is specifically what allows many simultaneous internal connections to share a single public address without ambiguity. This was a genuinely pragmatic, widely-deployed response to IPv4 address scarcity, but it comes at a real architectural cost: it breaks the end-to-end principle, since an internal host behind NAT is not stably, directly reachable from an unsolicited outside connection without additional configuration — a real complication for peer-to-peer applications and certain protocols. NAT itself is a data-plane, per-packet rewriting mechanism, distinct from and unrelated to the control-plane routing-algorithm concepts (link-state and distance-vector) covered next in this cluster.

## Documentation Links

- [Stanford CS144 — Lecture Schedule ("DCCP & NAT")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture covering NAT directly.
- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of NAT and its end-to-end-principle implications.
