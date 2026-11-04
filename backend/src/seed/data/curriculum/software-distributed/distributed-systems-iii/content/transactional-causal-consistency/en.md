---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain why a causal store still gives inconsistent multi-key reads through single-key gets, and why no fixed read order repairs it.
- Trace the two rounds of a COPS-GT get transaction and say why the second round names explicit versions.
- Define Transactional Causal Consistency through causally consistent snapshots, atomic visibility, and convergent data types.
- Follow Cure's rule for making a remote transaction visible, and list concretely what systems on this model give up.

## Context & Motivation

`causal-consistency` ordered individual reads and writes, but an album has an access list and a post has comments. A store can be perfectly causal and still hand a client two values that never coexisted, because the client read them at two moments. The fix is a transaction, but `two-phase-commit-and-the-blocking-problem` and wide-area latency make ordinary serializable transactions a poor fit for a system that must answer locally during a partition. Transactional causal consistency keeps transactions and drops the single order that `sequential-consistency-and-why-it-is-weaker` required.

## Core Theory

### One key at a time is not enough

Lloyd et al. give the motivating case. Alice restricts her album's ACL to friends, then adds personal photos. A reader who fetches the ACL, checks it, then fetches the album can combine the old public ACL with the private album. Reading the album first fails too: Alice may later delete the photos and reopen the ACL, and the reader then pairs the private album with the public ACL. As the paper puts it, there is no correct canonical ordering of the keys. Example 1 confirms this by enumeration.

### Read-only transactions: `get_trans`

COPS-GT stores a dependency list with every version and keeps old versions. Its `get_trans` runs in at most two rounds of local requests:

```text
Round 1: get the latest version of every requested key, in parallel.
         For each result, for each dependency on a requested key:
           ccv[key] = max(ccv[key], dependency version)
Round 2: for each key whose result is older than ccv[key]:
           get_by_version(key, ccv[key])
```

Two properties of causal+ make this terminate. The requested version is already present locally, because a visible version's dependencies were committed first. It also adds no new dependencies, since dependencies are transitive and the first round already saw them. Asking for the latest version in round two would lose this, since newer versions could keep bringing newer dependencies.

The price is state. COPS-GT keeps old versions for `trans_time`, 5 seconds in the implementation, so at 105 MB/s of writes a node may hold 525 MB of old versions. Dependency garbage collection on the newest versions also stops during a partition, which the paper lists as a limitation.

### The transactional model

Akkoorath et al. call read-only plus write-only transactions TCC-S, the model they attribute to Eiger. Keeping the two apart means a client cannot read an object and update it in one transaction. Their Transactional Causal Consistency allows interactive transactions with these properties:

- **Causally consistent snapshot.** Versions a_i and b_j belong to the same snapshot unless some other version a_k was created after a_i and is causally before b_j. A transaction reads from such a snapshot, which includes the effects of all transactions causally before it.
- **Atomicity.** All updates of a transaction become visible together, or none does.
- **Convergence through CRDTs.** Concurrent updates merge by type, for example a set's add and remove, rather than by last-writer-wins alone.

### How Cure makes it work

Cure timestamps each transaction with a **commit vector clock**, one entry per datacenter. Every partition m of datacenter d keeps `pvc`, recording how far it has received updates from each datacenter. Partitions exchange `pvc` in the background, and the entrywise minimum is the **globally stable snapshot**, GSS: everything known to be available at every partition of the local datacenter.

```text
Start:   svc = GSS, except svc[d] = max(client cvc[d], local clock)
Read:    wait until the partition has caught up to svc[d], then
         return the newest version with commit vector <= svc
Commit:  2PC among updated partitions of the LOCAL datacenter.
         Each proposes its clock, and commit time = maximum.
         ct = svc with ct[d] = commit time
Remote:  updates are logged on arrival and become visible only
         when GSS passes their commit vector
```

Taking the maximum matters. A smaller commit time could fall below a participant's prepare time, and a reader with a snapshot in between would not wait for the transaction and would miss it. Because all of a transaction's updates share one commit vector and reads wait for the same snapshot at each partition, a reader sees all of them or none. Clocks need only be loosely synchronized: skew affects performance, not correctness.

A single scalar would be smaller, and Akkoorath et al. compare against GentleRain, which uses one. Their argument for a vector is failure behavior: with a scalar, remote visibility follows the furthest datacenter, and one disconnected datacenter freezes updates from all remote ones. With a vector, only the disconnected datacenter's updates freeze. [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) attacks the same metadata trade-off from a different direction, in `causal-metadata-for-geo-replication-saturn`.

### What is given up

Cure's comparison table sets the model against stronger ones (x means the anomaly is disallowed):

```text
                  SER  SI   PSI/NMSI  Cure  TCC-S  EC
Transactions      yes  yes  yes       yes   RO,WO  no
Short fork        x    ok   ok        ok    ok     ok
Long fork         x    x    ok        ok    ok     ok
Convergent fork   x    x    x         ok    ok     ok
Convergence       -    -    -         CRDT  LWW    LWW
```

A short fork is write skew, a long fork lets two observers see two concurrent transactions in opposite states, and a convergent fork lets concurrent transactions update the same item and merge. Concretely, these systems give up:

- **Invariants across concurrent transactions.** Nothing stops two datacenters from each approving an action that is individually legal and jointly illegal, as Example 3 shows.
- **Freshness.** Remote updates wait for stability. Cure measured an average of 80 to 90 ms of remote visibility latency with 50 ms injected between datacenters.
- **Recent writes when a datacenter dies.** Lloyd et al. state that updates not yet copied out of a failed datacenter are lost, an inevitable cost of low-latency local commits. The Cure paper does not say this, but the same reasoning applies to it, because commit returns before updates propagate.
- **Some throughput.** In Cure's benchmark on LWW registers, eventual consistency outperformed it by about 30 percent across all workloads.
- **Waiting is not gone.** Reads can wait for a partition to catch up, and a client whose `cvc` is ahead of the GSS blocks when it starts a transaction. Commit inside a datacenter is 2PC, and the failures the paper discusses are datacenter failures and partitions between datacenters.

Akkoorath et al. call TCC "the strongest semantics a system can achieve under high-availability and low-latency". They cite Attiya, Ellen and Morrison for the claim about individual operations, and the paper's correctness section argues only that Cure implements TCC. The transactional claim is the authors' position, and no optimality proof appears in the paper.

## Worked Examples

Each result below covers every schedule stated. Example 2's clock values are invented for illustration and do not come from the paper.

### Example 1: the ACL race, enumerated

Start from ACL v1 public and Album v1 clean. Alice issues four writes: ACL v2 friends, Album v2 personal (depends on ACL v2), Album v3 clean (depends on Album v2), ACL v3 public (depends on Album v3). A step counts the writes applied so far. A forbidden result pairs a public ACL with the personal album.

```text
Two single gets, each read at any step (15 schedules):
  ACL then Album:  1 forbidden (ACL read at step 0, Album at 2)
  Album then ACL:  1 forbidden (Album read at step 2, ACL at 4)

get_trans (55 schedules of two first-round reads and a round 2):
  raw first-round pairs forbidden: 2 of 25
  final results forbidden:         0
  schedules using round 2:         9

Repair of one race:
  round 1: ACL v1 public, Album v2 personal, which needs ACL >= 2
  round 2: get_by_version(ACL, 2) returns friends
  result:  ACL v2 friends, Album v2 personal
```

Each sequential order fails on a different schedule.

### Example 2: when a remote transaction appears in Cure

Datacenter A has partitions p1 and p2. Transaction T from datacenter B writes x on p1 and y on p2, with commit entry B = 120.

```text
Start        p1.pvc[B]=0    p2.pvc[B]=0    GSS[B]=0
             read x=init, y=init
p1 gets T    p1.pvc[B]=120  p2.pvc[B]=0    GSS[B]=0
             read x=init, y=init   (x is stored but invisible)
p2 gets T    p1.pvc[B]=120  p2.pvc[B]=120  GSS[B]=120
             read x=T, y=T         (both appear together)

Datacenter C partitioned: pvc[B]=300, pvc[C]=90 on both.
  GSS = {B: 300, C: 90}
  B update at time 200, snapshot entry for C <= 90,
  vector rule:                          visible (200 <= 300, C entry <= 90)
  same update, scalar min(300, 90)=90:  invisible
```

The scalar row is a simplified model of the behavior the paper describes for GentleRain.

### Example 3: a bank account under TCC

Balance 100. T1 and T2, at different datacenters, read 100 from their snapshots and each withdraw 80 if the balance allows.

```text
Serial T1,T2 or T2,T1:   one withdrawal refused, final 20
Under TCC, both commit:  80 + 80 = 160 paid out
  LWW register merge:    final 20   (one update lost)
  counter CRDT merge:    final -60  (no update lost, invariant broken)

Write skew, x=y=1. T1 reads y, sets x=0. T2 reads x, sets y=0.
Observed: both read 1.
  order T1,T2 would give T2 a read of 0
  order T2,T1 would give T1 a read of 0
No serial order explains it.
```

Both snapshots were causally consistent and the CRDT converged. Neither guarantee speaks about the invariant.

## Common Misconceptions & Pitfalls

- **"Reading several keys from a causal store gives a consistent view."** Example 1 shows forbidden pairs under both read orders, on a store that is causal throughout.
- **"A snapshot means snapshot isolation."** Under SI, concurrent writers of one item conflict and a total update order exists. TCC allows long forks and convergent forks, so Cure's table places it below SI, PSI and NMSI.
- **"CRDTs make concurrent updates safe."** They guarantee convergence. Example 3 converges to -60. A CRDT merges effects and never rejects one.
- **"These systems never coordinate."** They avoid coordination between datacenters on the commit path. Cure still runs 2PC among partitions of one datacenter.

## Summary

Single-key causal consistency gives no consistent multi-key view, whatever the read order. COPS-GT adds read-only transactions in at most two rounds by storing dependencies with versions. Transactional Causal Consistency, defined with Cure, gives interactive transactions reading from causally consistent snapshots, with atomic visibility and CRDT convergence. Cure achieves it with commit vector clocks and a globally stable snapshot that decides when remote transactions appear. The model gives up invariants across concurrent transactions, some freshness, recent writes in a lost datacenter, and, on LWW registers, part of the throughput of eventual consistency. Its claim to be the strongest available transactional model is the authors' position, not a proved bound.

## Documentation Links

- [Akkoorath et al.: Cure: Strong Semantics Meets High Availability and Low Latency (ICDCS 2016)](https://webperso.info.ucl.ac.be/~pvr/icdcs2016-cure.pdf): the TCC definition, Table I, Algorithms 1 and 2, the vector clock argument, and the evaluation figures.
- [Lloyd, Freedman, Kaminsky and Andersen: Don't Settle for Eventual (SOSP 2011)](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf): the ACL example, `get_trans`, garbage collection costs, and datacenter failure behavior.
- [Bravo, Rodrigues and Van Roy: Saturn: a Distributed Metadata Service for Causal Consistency (EuroSys 2017)](https://webperso.info.ucl.ac.be/~pvr/p111-Bravo.pdf): a metadata service that separates causal metadata from data dissemination.
