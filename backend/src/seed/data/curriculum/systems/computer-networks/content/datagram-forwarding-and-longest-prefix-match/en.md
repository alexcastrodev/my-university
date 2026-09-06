---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the longest-prefix-match rule and explain what problem it solves when a forwarding table has multiple matching entries for one address.
- Perform a longest-prefix-match lookup by hand against a small, concrete forwarding table.
- Explain why longest-prefix match, rather than exact match, is necessary given that CIDR blocks of different sizes can overlap.
- Connect longest-prefix match's speed requirement back to the data-plane/control-plane distinction: why this specific lookup must be extremely fast.
- Explain what happens when no entry in the forwarding table matches an address at all (the default route).

## Context & Motivation

The previous concept established CIDR's variable-length address prefixes; this concept covers the actual algorithm a router runs, for every single arriving packet, to decide which outgoing link to forward it on: longest-prefix match. This is the concrete data-plane mechanic the data-vs-control-plane distinction, covered two concepts ago, was building toward — the specific, must-be-extremely-fast lookup a router performs millions of times per second, using whatever forwarding table the (much slower) control plane has already computed and installed.

## Core Theory

### Why exact match is not enough

A forwarding table entry is not a single address — it is a CIDR prefix, covering potentially millions of addresses at once (a `/8` entry, for instance, covers over 16 million individual addresses). This is precisely CIDR's point: one entry can summarize routing information for an enormous range of addresses, keeping forwarding tables far smaller than they would be if every individual host address needed its own entry. But this creates a real complication: because prefixes of different lengths can genuinely overlap (a `/8` entry and a more specific `/24` entry, both covering the same destination address, can both legitimately exist in the same table simultaneously, if that `/24` subset needs to be routed differently than the rest of its containing `/8`), a router cannot simply find "an" entry that matches an address — it must find the *right* one.

### The longest-prefix-match rule

When multiple entries in a forwarding table match a given destination address (multiple prefixes, of different lengths, all containing that address), the router selects the entry with the longest matching prefix — the most specific match, not merely the first one found or an arbitrary one among the matches. This rule exists precisely because a longer, more specific prefix represents more detailed, more authoritative routing information about that particular sub-range of addresses than a shorter, more general prefix covering a much larger range that happens to also contain it.

### Speed requirements

Because this lookup happens for every single packet a router forwards — potentially millions of times per second on a busy router — it must be implemented extremely efficiently. Real routers use specialized data structures and often dedicated hardware (rather than a naive linear scan through every table entry) to perform longest-prefix match in the few nanoseconds a modern link's transmission rate demands; the algorithmic and hardware details of exactly how this is achieved at that speed are beyond this concept's scope, but the *requirement* — that this specific lookup sits squarely in the data plane and must be blisteringly fast — is exactly the property the data-plane/control-plane distinction, covered earlier in this cluster, exists to protect.

### The default route

If no entry in the forwarding table matches a destination address at all — not even the shortest, most general prefix — the router uses a default route: typically a `0.0.0.0/0` entry (a prefix of length zero, matching every possible address) pointing toward a single, general "everything else goes here" outgoing link, most commonly toward an upstream provider that has broader knowledge of how to reach the wider Internet. The default route is, technically, just the shortest possible prefix — length zero — so it participates in the same longest-prefix-match rule as every other entry, simply losing to any more specific match whenever one exists.

## Worked Examples

### Example 1: Longest-prefix match against a small forwarding table

A router's forwarding table contains:

```text
Prefix              Outgoing link
128.11.0.0/16        Link A
128.11.3.0/24        Link B
0.0.0.0/0            Link C (default route)
```

A packet arrives destined for `128.11.3.5`. Check every entry:

```text
128.11.0.0/16: matches (128.11.3.5 falls within 128.11.0.0-128.11.255.255)
128.11.3.0/24: matches (128.11.3.5 falls within 128.11.3.0-128.11.3.255)
0.0.0.0/0:     matches (matches everything)
```

All three entries technically match — but the longest-prefix-match rule selects `128.11.3.0/24` (a 24-bit prefix, the longest among the matches), so the packet is forwarded via Link B, even though the shorter `/16` entry and the default route both also technically cover this address.

### Example 2: A packet that only matches the default route

Using the same table, a packet arrives destined for `203.0.113.7`:

```text
128.11.0.0/16: does NOT match (203.0.113.7 is outside this range)
128.11.3.0/24: does NOT match (same reason)
0.0.0.0/0:     matches (matches everything, by definition)
```

Only the default route matches, so the packet is forwarded via Link C — the router has no more specific information about `203.0.113.7`'s destination network, so it forwards toward the general-purpose "everything else" path, which typically leads to an upstream provider better positioned to route it further.

### Example 3: Why a more specific entry can legitimately coexist with a broader one

Suppose an organization owns the entire `128.11.0.0/16` block (routed generally via Link A) but has recently moved one specific `/24` subset of that block, `128.11.3.0/24`, to a different physical location, now reachable only via Link B. Rather than reconfiguring the entire `/16` entry (which would misroute every other address in that block, still correctly reachable via Link A), the router simply adds the more specific `128.11.3.0/24` entry alongside the existing `/16` entry. Longest-prefix match then automatically sends traffic for the moved subset via Link B while everything else in the `/16` block continues, correctly, via Link A — a real, practical reason overlapping prefixes of different lengths coexist in real forwarding tables, and exactly why "most specific match wins" is the necessary rule rather than an arbitrary convention.

## Common Misconceptions & Pitfalls

- **"A forwarding table only ever has one entry that matches any given address."** Multiple entries, with prefixes of different lengths, can legitimately match the same address simultaneously — this is a normal, expected situation (Example 3 shows exactly why), not a table-configuration error, and it is precisely what the longest-prefix-match rule exists to resolve correctly.
- **"The default route is a special case handled separately from longest-prefix match."** It is not special-cased — it is simply the shortest possible prefix (length zero), participating in the exact same longest-prefix-match rule as every other entry; it only "wins" when nothing more specific matches.
- **"Longer prefixes are somehow slower to match."** Real router implementations are built specifically so that finding the longest matching prefix, among potentially many matches, is not meaningfully slower than finding any single match — the speed requirement applies equally regardless of which prefix length ultimately wins.
- **"A router picks the first matching entry it happens to check, in table order."** The rule is defined by prefix length (most specific wins), not by the order entries happen to be stored or checked — a correct implementation must find the longest match among *all* matching entries, not merely the first one encountered.

## Summary

Because CIDR prefixes of different lengths can legitimately overlap — a broad, general entry and a narrower, more specific entry both covering the same address — a router cannot simply find any matching forwarding-table entry; it must apply the longest-prefix-match rule, selecting the most specific (longest) matching prefix among every entry that matches. This lookup happens for every single packet a router forwards and must therefore be extremely fast, the concrete instantiation of the data-plane speed requirement established two concepts ago. When no entry matches at all, the default route (prefix length zero, matching everything) provides a fallback, typically pointing toward an upstream provider — participating in the same longest-prefix-match rule as every other entry, simply as the least specific possible match. This concept completes the picture of how a single router turns an address, structured as covered in the previous concept, into an actual forwarding decision.

## Documentation Links

- [Stanford CS144 — Lecture Schedule ("IP and Forwarding")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture covering IP forwarding directly, immediately after addressing.
- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of longest-prefix-match forwarding.
