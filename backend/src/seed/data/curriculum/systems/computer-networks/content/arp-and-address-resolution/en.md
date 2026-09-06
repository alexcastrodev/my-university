---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the problem ARP solves: knowing a destination's IP address is not enough to construct a link-layer frame for the next hop.
- Trace an ARP request-and-reply exchange step by step, including the broadcast nature of the request.
- Explain the ARP cache as, mechanically, exactly the hash table already covered — same structure, same purpose (fast key lookup), a real timeout instead of an explicit eviction policy.
- Explain why ARP is scoped to one local network (a broadcast domain) and does not, by itself, work across routers.
- State what happens when an ARP cache lookup misses, and how the resulting reply gets cached for future use.

## Context & Motivation

The previous concept established that MAC addresses and IP addresses serve genuinely different purposes at different layers, and that both are needed simultaneously. This concept covers the concrete mechanism that bridges the two: a node that knows a destination's IP address (from the network layer, already covered) but needs to construct a link-layer frame for the very next hop needs the destination's MAC address as well — ARP (Address Resolution Protocol) is what supplies it. This is also a genuinely nice moment to connect back to `data-structures-i`: the ARP cache that makes this resolution fast on every request after the first one is not merely *similar* to a hash table — it is mechanically exactly the hash table already covered, applied to a real, everyday networking problem.

## Core Theory

### The problem: IP addresses route, but frames need MAC addresses

A router (or host) deciding to forward a datagram to a specific next hop, using the routing information already covered, knows that next hop's IP address — but to actually transmit a link-layer frame across the physical medium to reach that next hop, the frame's link-layer header needs the next hop's MAC address, not its IP address (link-layer devices along that one hop, including any switches, forward based on MAC addresses, not IP addresses). ARP is the protocol that translates a known IP address, for a node on the same local network, into its corresponding MAC address.

### The ARP request-reply exchange

When a node needs the MAC address corresponding to a known IP address on its local network, and does not already have it cached, it broadcasts an ARP request to every node on the local network: "who has this IP address? tell me your MAC address." Every node on the local network receives this broadcast, but only the one node whose own IP address matches the request responds, with a unicast ARP reply directly back to the requester, containing its MAC address. The requesting node then has the mapping it needs to construct its link-layer frame, and — critically — caches this mapping for future use, avoiding the need to broadcast an ARP request again for the same IP address any time soon.

### The ARP cache is a hash table

The ARP cache stores exactly the kind of mapping `hashing-and-hash-functions`, already covered, is built to support: a key (the IP address) mapped to a value (the corresponding MAC address), with fast, average-case constant-time lookup by key — precisely a hash table's defining property. The one genuinely distinctive feature networking adds is not a different data structure, but a different eviction policy: rather than an explicit, programmer-chosen eviction strategy (like the load-factor-driven rehashing already covered), ARP cache entries simply expire after a fixed timeout (commonly a few minutes), on the theory that a network's IP-to-MAC mappings can genuinely change over time (a network interface card can be replaced, a device can be reassigned a different IP address) and a stale cached mapping, kept indefinitely, would eventually become incorrect.

### Scope: one local network only

ARP operates entirely within one local network — a single broadcast domain, where an ARP request broadcast genuinely reaches every node directly. It does not, by itself, resolve an IP address on a different network reachable only through a router: a node needing to reach a destination on a different network resolves, via ARP, only the MAC address of its own local router (the next hop for that destination, per its own forwarding table, already covered), not the MAC address of the ultimate destination itself, which may be many hops and many separate ARP resolutions away, one per hop, each entirely local to that hop's own broadcast domain.

## Worked Examples

### Example 1: A full ARP request-reply exchange

Host A (IP `192.168.1.10`, MAC `AA:AA:AA:AA:AA:AA`) needs to send a frame to host B (IP `192.168.1.20`), on the same local network, but does not have B's MAC address cached.

```text
1. Host A broadcasts an ARP request to the entire local network:
   "Who has 192.168.1.20? Tell 192.168.1.10 (AA:AA:AA:AA:AA:AA)."

2. Every node on the local network receives this broadcast. Only
   host B, whose own IP address matches, responds.

3. Host B sends a unicast ARP reply directly to host A:
   "192.168.1.20 is at BB:BB:BB:BB:BB:BB."

4. Host A now has the mapping it needs, caches it, and constructs
   its link-layer frame with destination MAC = BB:BB:BB:BB:BB:BB.
```

Every other node on the local network, besides B, simply ignores the broadcast request, since the requested IP address does not match their own.

### Example 2: The ARP cache as a hash table, explicitly

```text
ARP cache (conceptually identical to a hash table):

Key (IP address)     Value (MAC address)       TTL remaining
192.168.1.20          BB:BB:BB:BB:BB:BB          180 seconds
192.168.1.30          CC:CC:CC:CC:CC:CC           45 seconds
192.168.1.1            DD:DD:DD:DD:DD:DD          299 seconds
```

A lookup for `192.168.1.20` is exactly a hash-table lookup by key, already covered — hash the IP address, find the corresponding bucket, retrieve the associated MAC address, all in average-case constant time. The only genuinely networking-specific addition is the TTL column: once an entry's remaining time reaches zero, it is evicted automatically (a fresh ARP request is issued the next time that IP address needs to be resolved again), rather than an explicit rehashing or load-factor-driven eviction policy managing the table's size.

### Example 3: Resolving only the next hop, across a router

Host A (on network `192.168.1.0/24`) wants to reach host C (on a different network, `10.0.5.0/24`), reachable via router R.

```text
1. Host A's forwarding logic (per routing already covered) determines
   the next hop for this destination is router R, not host C directly.

2. Host A uses ARP to resolve ROUTER R's MAC address (not host C's) —
   R is on A's own local network, so this ARP resolution is entirely
   local and works normally.

3. Host A sends its frame with destination MAC = R's MAC address, but
   the frame's INNER network-layer datagram still specifies host C's
   IP address as the ultimate destination.

4. Router R receives the frame, strips the link-layer header, sees the
   network-layer datagram is destined for host C, and separately runs
   ITS OWN ARP resolution (on ITS OWN local network, where C resides)
   to find C's actual MAC address for the next hop.
```

Host A never resolves host C's MAC address directly — only the immediate next hop's, at each link along the path, exactly matching ARP's genuinely local, one-hop-at-a-time scope.

## Common Misconceptions & Pitfalls

- **"ARP resolves the final destination's MAC address, no matter how many hops away it is."** ARP only ever resolves the MAC address of the *next hop* on the local network, which the routing/forwarding logic already covered has determined — for a distant destination, this next hop is typically a local router, not the ultimate destination itself, and each router along the path performs its own separate, local ARP resolution for its own next hop in turn.
- **"The ARP cache needs a completely different data structure from anything already covered in this curriculum."** It is mechanically a hash table — IP address as key, MAC address as value, average-case constant-time lookup — with only its eviction strategy (timeout-based expiration) differing from the load-factor-driven rehashing already covered for hash tables generally.
- **"An ARP request reaches only the specific node being asked about."** An ARP request is broadcast to every node on the local network — every node receives it, and only the one node whose IP address actually matches responds; every other node simply ignores it.
- **"ARP works across different networks, connected by routers, directly."** ARP is scoped entirely to one local network (one broadcast domain) — resolving an address on a genuinely different network requires that different network's own separate ARP resolution, performed by whichever router is directly connected to it, not a single ARP request spanning both networks at once.

## Summary

ARP bridges the network layer's IP addressing and the link layer's MAC addressing: given a known IP address on the local network, it resolves the corresponding MAC address needed to actually construct a link-layer frame for the next hop, via a broadcast request answered by a unicast reply from the one matching node. The resulting ARP cache is, mechanically, exactly the hash table already covered — IP address as key, MAC address as value, fast average-case lookup — differing only in using a timeout-based eviction policy rather than an explicit rehashing strategy. ARP's scope is deliberately local: it resolves only the immediate next hop on one broadcast domain, never a distant destination directly, with each router along a multi-hop path performing its own separate, local resolution for its own next hop in turn. The next concept turns to a genuinely different physical-layer setting — wireless — where the shared-medium assumptions Ethernet's multiple-access protocol relied on break down in new ways.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of ARP and address resolution.
