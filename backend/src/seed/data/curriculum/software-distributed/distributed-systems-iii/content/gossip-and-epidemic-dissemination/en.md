---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Name the three update-distribution strategies of the Xerox PARC epidemic work (direct mail, anti-entropy, rumor mongering) and say what each one gives up.
- Distinguish push, pull, and push-pull, and use the recurrences to explain why pull wins once few sites remain uninformed.
- Define residue, traffic, and delay, and use `s = e^-m` to estimate what a push rumor costs for a target residue.
- Explain why a rumor can die with sites still uninformed, and why infrequent anti-entropy closes that gap.
- Explain why uniform partner choice is both the assumption behind the analysis and the expensive part of the deployment.

## Context & Motivation

Update-everywhere replication, as framed in `replicating-a-database-eager-vs-lazy-primary-copy-vs-update-everywhere-and-certification`, needs some way to move each update to every copy. `anti-entropy-read-repair-and-merkle-tree-synchronization` showed how two replicas find what differs. `cassandra-distributed-architecture-gossip-tokens-vnodes` showed one deployed gossip exchange. Neither answers the question underneath: if every node talks to a random partner, how fast does information spread, what does it cost, and what can go wrong?

The answer comes from Demers and colleagues at Xerox PARC, who studied the Clearinghouse name servers on the Xerox Corporate Internet. In early 1986 many of that network's performance problems were traced to traffic from keeping highly replicated domains consistent. Anti-entropy was followed by a remailing step: whenever two sites disagreed, the correct value was mailed to all sites. For a domain stored at 300 sites, the paper reports that 90,000 mail messages might be introduced each night, which is 300 squared. That was far beyond the capacity of the network, and mail, file transfer, and name lookup broke down with it. The fix did not come from better reliable-delivery machinery. It came from treating propagation as an epidemic that could be designed rather than merely endured.

## Core Theory

### Three strategies

```text
DIRECT MAIL:     the entry site mails each update to all others. n messages,
                 timely, but mail is lost and the sender may not know every site.
ANTI-ENTROPY:    every site regularly picks a random site and resolves all
                 differences with it. Very reliable, examines the whole database.
RUMOR MONGERING: a site holding a "hot" update keeps telling random sites, and
                 stops once too many of them already knew. Cheap, can miss sites.
```

The paper borrows epidemiology's vocabulary, per update: a site is **susceptible** if it lacks the update, **infective** if it has it and is sharing it, and **removed** if it has it and has stopped sharing. Anti-entropy is a **simple epidemic**, with no removed state. Rumor mongering is a **complex epidemic**.

### Anti-entropy: push, pull, push-pull

With timestamps deciding which value is newer, `ResolveDifference[s, s']` comes in three forms: **push** copies from `s` to `s'` when `s` is newer, **pull** copies from `s'` to `s` when `s'` is newer, and **push-pull** does whichever applies. Starting from one infected site, a simple epidemic reaches everyone in expected time proportional to `log n`. For push the paper cites the exact form `log2(n) + ln(n) + O(1)`.

The strategies really separate in the tail. Let `p_i` be the probability that a site is still susceptible after cycle `i`:

```text
pull:  p_{i+1} = p_i^2                      a site stays ignorant only if it
                                            contacts another ignorant site
push:  p_{i+1} = p_i (1 - 1/n)^(n(1-p_i))   no infective site happened to pick it
       which is about p_i / e when p_i is small
```

Pull squares the remainder, while push divides it by a constant. So when anti-entropy backs up another mechanism and only a few sites are behind, the paper concludes that pull or push-pull is greatly preferable, and that push-pull behaves essentially like pull.

Comparing whole databases is the cost. The paper's mitigations are checksums, a recent-update list covering a window larger than the expected spread time, and "peel back" in reverse timestamp order. Merkle-tree comparison in Dynamo-style stores is a later answer to the same cost.

### Rumor mongering and its three metrics

In the basic rumor, an active site phones a random site, and after an unnecessary call it loses interest with probability `1/k`. Modeling fractions `s`, `i`, `r` with differential equations and solving for `i(s)` gives a final residue satisfying `s = e^(-(k+1)(1-s))`, about 20% at `k = 1` and 6% at `k = 2`. The design is judged on three numbers:

- **Residue**: the value of `s` when `i` reaches zero.
- **Traffic**: `m`, updates sent divided by the number of sites.
- **Delay**: `t_ave` averaged over sites, and `t_last` for the last site reached.

Variations are **blind vs feedback** (lose interest regardless of the recipient, or only if it already knew) and **coin vs counter** (with probability `1/k`, or after `k` unnecessary contacts). The surprising result is that they share one law for push, `s = e^-m`: there are `nm` updates sent, and one site misses all of them with probability `(1 - 1/n)^(nm)`. Only delay separates them, with counters mattering more than feedback.

Pull rumors do better than `s = e^-m`, and the paper's counter-with-feedback recurrence exhibits `s = e^(-Theta(m^3))`. The tradeoff is idle cost: on a quiescent database push stops generating traffic, while pull keeps sending fruitless requests.

### When a rumor dies, and when data must die

A complex epidemic runs to quiescence. If `i` hits zero with sites still susceptible, the system sits in a stable state where the update is known by only some sites. Running anti-entropy infrequently removes that outcome: every update then reaches, or is superseded at, every site with probability 1.

Deletion needs its own mechanism. Removing a local copy achieves nothing, because propagation resurrects the item from other sites. Deleted items are replaced by **death certificates**, timestamped entries that spread like data. Holding them for a fixed time (the paper's example is 30 days) trades space against resurrection risk. **Dormant** certificates, kept by a few sites and reactivated when an obsolete copy appears, extend that history.

### Partner choice is where the money is

Uniform choice looks free in the analysis, but on the Xerox network a pair of transatlantic links were the only route between Europe and North America. In the paper's simulation of push-pull anti-entropy on that topology (Table 4), the link to Bushey, England saw 75.7 comparisons per cycle under uniform choice, against an average of 5.9 over all links. Choosing partners with probability that falls with the distance rank (`a = 2.0` in the paper's distribution) cut Bushey to 2.4, while `t_last` degraded from 7.8 to 13.3 cycles. A `1/Q(d)^2` distribution, where `Q(d)` counts sites within distance `d`, was deployed across the network with what the paper calls dramatic improvements.

Uniform choice also assumes a node knows the membership. Jelasity and colleagues argue that a complete membership table is unrealistic in a large dynamic system, and factor out a **peer-sampling service**: each node holds a small partial view and refreshes it by gossiping membership itself. Their results favor push-pull there too, since push-only or pull-only can partition the nodes.

## Worked Examples

All runs below are this lesson's own round-based simulation: `n` sites, uniform partners, and no site acts on news received in the same cycle.

### Example 1: spreading one update by anti-entropy

```text
n = 1000, one infected site, 2000 runs
strategy    mean cycles   99th percentile
push        18.0          22
pull        13.8          18
push-pull    9.2          10

Infected sites per cycle, one run of each:
push       1 2 4 8 16 32 63 120 216 364 546 737 870 943 977 992 997 1000
pull       1 2 5 9 20 44 90 174 315 523 790 962 997 1000
push-pull  1 3 9 28 83 235 541 879 993 1000

Mean push cycles vs log2(n) + ln(n):
n = 100: 12.4 vs 11.2     n = 1000: 18.0 vs 16.9
n = 10^4: 23.7 vs 22.5    n = 10^5: 29.4 vs 28.1
```

The gap stays near 1.2 as `n` grows by a factor of 1000, which is the `O(1)` term. The tails show the recurrences. Push leaves 57, 23, 8, 3, 0 sites, close to dividing by `e` (57, 21, 8, 3). Pull leaves 210, 38, 3, 0, while squaring predicts 210, 44, 2.

### Example 2: anti-entropy as a backup

```text
n = 1000, 990 sites already infected, 5000 runs
strategy    mean cycles   worst run
push        3.45          15
pull        1.09           2
push-pull   1.03           2

Recurrence from p = 0.01, expected sites left after one cycle:
pull 0.1      push 3.7
```

This is the case the paper cares about: direct mail or a rumor did most of the work. Push fires 990 random shots at 10 targets each cycle. Pull has each of the 10 ask a random site, and nearly every site knows.

### Example 3: reproducing the paper's rumor table

Push rumor, feedback and counter, `n = 1000`, 3000 runs. The counter resets on a useful contact. The paper states that rule in its pull footnote, and the close match here suggests the same rule for push.

```text
 k | residue s       | traffic m    | e^-m    | t_last
   | sim     Table 1 | sim   Table 1| from m  | sim   Table 1
 1 | 0.175   0.18    | 1.74  1.7    | 0.175   | 16.8  16.8
 2 | 0.037   0.037   | 3.30  3.3    | 0.037   | 17.0  16.9
 3 | 0.011   0.011   | 4.53  4.5    | 0.011   | 17.3  17.4
 4 | 0.0035  0.0036  | 5.64  5.6    | 0.0036  | 17.6  17.5
 5 | 0.0013  0.0012  | 6.68  6.7    | 0.0013  | 17.7  17.7

Blind and coin, k = 5 (2000 runs):
residue 0.0071 (Table 2: 0.008), m = 4.96 (4.9), t_last 32.5 (32)
```

From `k = 2` on, each extra unit of `k` buys a factor of roughly 3 in residue for a little over one extra update per site, with `t_last` almost flat. Compare `k = 3` with blind coin at `k = 5`: traffic is similar (4.53 and 4.96) and residue obeys the same law, but the last site hears 15 cycles later. That is the paper's point that delay is the only thing distinguishing these variants.

### Example 4: a rumor backed by pull anti-entropy

```text
n = 1000, rumor with k = 2, then pull anti-entropy, 3000 runs
updates sent by the rumor     3299 on average
sites missed by the rumor     37 on average, 68 at worst, never 0
pull cycles to finish         1.73 on average, 3 at worst
```

The rumor did almost all the spreading, yet not one of 3000 runs reached every site, which matches a residue of 0.037 on 1000 sites. Anti-entropy then finishes in about two cycles, for the reason Example 2 gave. Compare the 90,000 remailed messages for 300 sites from the opening: the rumor costs a small multiple of `n`, not `n` squared.

## Common Misconceptions & Pitfalls

- **"Gossip" names one algorithm.** Anti-entropy never stops and converges with probability 1. Rumor mongering stops by design and has a residue. A timer-driven state exchange that runs forever, like the gossiper in `cassandra-distributed-architecture-gossip-tokens-vnodes`, behaves as a simple epidemic rather than a rumor.
- **"Raising `k` slows the rumor down."** Example 3 shows `t_last` moving only from 16.8 to 17.7 cycles while residue falls by two orders of magnitude.
- **"Logarithmic cycles means cheap."** Cycles are not cost. An anti-entropy cycle compares databases, and uniform choice concentrated 75.7 comparisons per cycle on one link. Remailing turned a logarithmic process into `n` squared messages.
- **"A rumor that reached 96% will finish on its own."** Once every site is removed, nothing else happens. The remaining sites stay stale until anti-entropy or a later update arrives.
- **"Deleting the row is enough."** Without a death certificate, anti-entropy treats the surviving copy elsewhere as new data and restores it.
- **"Uniform random partners are free."** They need a membership view, and they ignore topology.

## Summary

Direct mail is timely and unreliable, anti-entropy is reliable and expensive, and rumor mongering is cheap and can miss sites. Together they form the working design: spread by rumor or mail, and repair by infrequent anti-entropy. Anti-entropy reaches everyone in logarithmic time, and in the tail pull squares the remainder while push only divides it by `e`. For push rumors, every blind, feedback, coin, and counter variant obeys `s = e^-m`, so only delay separates them. Deletion requires death certificates, and uniform partner choice must be tempered by topology and provided by some membership mechanism. The next lesson, `unstructured-p2p-flooding-super-peers-and-bittorrent`, takes the same random-neighbor idea from replicas that want every update to peers that want one file.

## Documentation Links

- [Demers et al.: Epidemic Algorithms for Replicated Database Maintenance (Xerox PARC CSL-89-1, 1989)](https://ftp.mirrorservice.org/sites/www.bitsavers.org/pdf/xerox/parc/techReports/CSL-89-1_Epidemic_Algorithms_for_Replicated_Database_Maintenance.pdf): the report version of the PODC paper, with the Clearinghouse history, the push and pull recurrences, Tables 1 to 5, death certificates, and spatial distributions.
- [Demers et al.: Epidemic Algorithms for Replicated Database Maintenance (PODC 1987)](https://none.cs.umass.edu/~shenoy/courses/fall04/readings/demers.pdf): a scanned copy of the original conference paper.
- [Jelasity et al.: Gossip-based Peer Sampling (ACM TOCS, 2007)](https://www.distributed-systems.net/my-data/papers/2007.tocs.pdf): the peer-sampling service, partial views maintained by gossip, and why push-pull is favored.
