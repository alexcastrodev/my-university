---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe an IPv4 address's structure: a 32-bit number, written in dotted-decimal notation, split into a network prefix and a host suffix.
- Explain CIDR notation and read a real address/prefix-length pair (e.g., `128.11.3.0/24`) correctly.
- Compute the number of usable host addresses available under a given prefix length.
- Explain why CIDR replaced the older, rigid class-based (Class A/B/C) addressing scheme, and what specific problem it solved.
- Perform a basic subnetting calculation: dividing one address block into smaller subnets of a specified size.

## Context & Motivation

Having established, in the previous concept, that forwarding and addressing are data-plane concerns, this concept covers the concrete structure of the addresses the data plane actually forwards on: IPv4 addresses, and CIDR, the notation and allocation scheme that has governed IPv4 addressing since the early 1990s. This is genuinely practical, computational material — subnetting arithmetic is a real, everyday task for anyone configuring network infrastructure — and it sets up the next concept, datagram forwarding via longest-prefix match, which depends directly on understanding how an address's prefix length determines which forwarding-table entries can match it.

## Core Theory

### IPv4 address structure

An IPv4 address is a 32-bit number, conventionally written in dotted-decimal notation as four 8-bit numbers (each ranging 0–255) separated by dots — for example, `192.168.1.10`. Conceptually, an address is split into two parts: a network prefix (identifying which network the address belongs to) and a host suffix (identifying a specific host within that network). Where exactly the split falls between prefix and suffix is not fixed globally — it varies address block by address block, which is precisely what CIDR notation exists to specify explicitly.

### CIDR notation

Classless Inter-Domain Routing (CIDR) notation writes an address block as `address/prefix-length` — for example, `128.11.3.0/24` means the first 24 bits of the address are the fixed network prefix, and the remaining 8 bits (32 − 24) are available for host addresses within that network. A `/24` block therefore has `2^8 = 256` total possible values in its host portion; a `/16` block has `2^16 = 65,536` total possible values; a `/30` block has `2^2 = 4` total possible values — the smaller the prefix length, the more bits remain for hosts, and the larger the block.

### From class-based addressing to CIDR

IPv4 addressing originally used a rigid class-based scheme: Class A networks used a fixed 8-bit prefix (allowing 16 million host addresses per network — usually far more than any real organization needed), Class B used a fixed 16-bit prefix (65,536 hosts — often still far more than needed, or sometimes not enough), and Class C used a fixed 24-bit prefix (256 hosts — often too few). This rigidity was a real, serious problem: an organization needing 1,000 addresses had no size that fit well — a Class C block (256) was too small, forcing it to request a Class B block (65,536), wasting the other roughly 64,000 addresses that block could have served elsewhere. CIDR replaced this with an arbitrary prefix length, letting an address block be sized to genuinely match an organization's real need (a `/22` block, for instance, provides exactly 1,024 addresses) — directly alleviating the address-space exhaustion this rigid, wasteful allocation scheme was accelerating.

### Usable host addresses

Within a given prefix, not every address is available for an actual host: by convention, the first address in a block (all host bits zero) identifies the network itself, and the last address (all host bits one) is reserved as a broadcast address for that network — both are excluded from the pool of addresses that can actually be assigned to a host. A `/24` block, with `2^8 = 256` total addresses, therefore has `256 - 2 = 254` usable host addresses.

## Worked Examples

### Example 1: Reading a CIDR block

`128.11.3.0/24` means:

```text
Fixed network prefix: the first 24 bits, corresponding to 128.11.3
Variable host portion: the remaining 8 bits (32 - 24 = 8)

Total addresses in this block: 2^8 = 256
Usable host addresses:         256 - 2 = 254
  (excluding 128.11.3.0 as the network address and
   128.11.3.255 as the broadcast address)
Address range:                  128.11.3.0 through 128.11.3.255
```

### Example 2: Computing usable hosts for several prefix lengths

```text
Prefix     Host bits   Total addresses (2^host bits)   Usable hosts (total - 2)
/30        2           4                                 2
/28        4           16                                14
/24        8           256                                254
/22        10          1,024                             1,022
/16        16          65,536                            65,534
```

An organization that genuinely needs about 1,000 host addresses is best served by a `/22` block (1,022 usable addresses) — under the old class-based scheme, the closest fit above a Class C's 254 addresses would have been a full Class B's 65,534, wasting well over 98% of that block's address space.

### Example 3: Subnetting a `/24` block into four smaller subnets

An organization is allocated `10.0.1.0/24` (254 usable addresses) and needs to split it into 4 equally-sized subnets, one per department.

```text
Splitting a /24 into 4 equal pieces means borrowing 2 additional bits
for subnetting (since 2^2 = 4), producing four /26 subnets:

10.0.1.0/26     (addresses 10.0.1.0   - 10.0.1.63,   62 usable hosts)
10.0.1.64/26    (addresses 10.0.1.64  - 10.0.1.127,  62 usable hosts)
10.0.1.128/26   (addresses 10.0.1.128 - 10.0.1.191,  62 usable hosts)
10.0.1.192/26   (addresses 10.0.1.192 - 10.0.1.255,  62 usable hosts)
```

Each `/26` subnet has `2^(32-26) = 2^6 = 64` total addresses, minus 2 (network and broadcast) = 62 usable host addresses per department — a real, worked subnetting calculation of exactly the kind performed when configuring real network infrastructure.

## Common Misconceptions & Pitfalls

- **"A smaller prefix number means a smaller block of addresses."** It is the opposite — a smaller prefix length (e.g., `/16`) leaves more bits for the host portion and therefore describes a *larger* block; a larger prefix length (e.g., `/28`) leaves fewer host bits and describes a *smaller* block.
- **"Every address in a CIDR block can be assigned to a host."** Two addresses in every block are reserved by convention — the all-zeros host portion (the network address itself) and the all-ones host portion (the broadcast address) — leaving `2^(host bits) - 2` addresses actually usable for hosts.
- **"Class-based addressing and CIDR describe the same thing with different names."** Class-based addressing fixed the prefix length at one of exactly three values (8, 16, or 24 bits) regardless of an organization's actual need; CIDR allows any prefix length, letting a block's size be matched precisely to real requirements — a genuine, not merely cosmetic, difference in flexibility.
- **"Subnetting only divides a block into equally-sized pieces."** Equally-sized subnetting (as in Example 3) is the simplest case; real subnetting can also allocate differently-sized subnets from the same parent block (variable-length subnet masking), a more flexible but more involved calculation not developed further in this introductory concept.

## Summary

An IPv4 address is a 32-bit number split into a network prefix and a host suffix, with CIDR notation (`address/prefix-length`) specifying exactly where that split falls for a given block — a `/24` block has 256 total addresses (254 usable, after excluding the network and broadcast addresses), and smaller prefix lengths describe larger blocks. CIDR replaced the earlier, rigid class-based scheme (fixed 8-, 16-, or 24-bit prefixes only) specifically to let address-block sizes match real organizational need, directly alleviating the enormous address waste the old scheme's poor fit produced. Subnetting — dividing a block into smaller pieces by borrowing additional prefix bits — is a real, everyday computation this concept works through concretely. The next concept, datagram forwarding via longest-prefix match, depends directly on this prefix-length structure: it is precisely what lets one short-prefix forwarding-table entry cover many addresses while a more specific, longer-prefix entry still takes precedence when it applies.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of IPv4 addressing, CIDR, and subnetting.
- [Stanford CS144 — Lecture Schedule ("IP and Forwarding")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture covering IP addressing directly ahead of forwarding mechanics.
