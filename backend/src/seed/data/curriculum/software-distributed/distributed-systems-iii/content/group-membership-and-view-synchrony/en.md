---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define group membership as an agreed sequence of views, and distinguish primary component from partitionable services.
- State Same View Delivery, Sending View Delivery, and the Virtual Synchrony property, and check them on a trace.
- Explain how Isis turns imperfect suspicion into an authoritative event, what that costs, and why membership cannot escape the impossibility results.
- Relate view-synchronous communication to consensus-based replication, including the irrevocability gap and the stronger delivery rule that closes it.

## Context & Motivation

`failure-detectors` gave each process a private suspect list that may disagree with everyone else's. Chandra and Toueg's algorithms tolerate that disagreement. The Isis line of work, starting with Birman and Joseph, went the other way: make everyone see the same list, change it through an ordered sequence, and program as if failures were clean global events. `reconfiguration-changing-membership-in-paxos-and-raft` arrived at a sequence of configurations from the state machine side. This lesson comes from the communication side, and ends where the two meet.

## Core Theory

### Views

A view-oriented group communication system (GCS) provides a membership service and a reliable multicast service. The membership service tracks the currently active and connected processes, and reports each change by installing a new view, which has an identifier and a member set. The Chockler, Keidar, and Vitenberg survey (2001) unifies over thirty specifications around such properties. Two are basic:

- **Self Inclusion:** a process that installs a view is a member of it.
- **Local Monotonicity:** a process installs views with increasing identifiers, so two processes that install the same two views install them in the same order.

Birman and Joseph show why the agreed list matters. In Isis, every member sees the same sequence of changes, and the list is sorted by decreasing age. Members can then coordinate through any deterministic rule with no extra messages: a member's index can serve as its number for splitting requests, and when a coordinator fails, its cohorts all learn this and pick the replacement by the same rule.

### Primary component or partitionable

In a **primary component** service, views form a total order, and consecutive views share a process that survives from one to the next and can carry information forward. In a **partitionable** service, views are only partially ordered, so disjoint views can exist at the same time. Isis assumes partitions can happen but lets only one component proceed: detached processes "commit suicide", in the survey's phrase. Later systems such as Transis and Totem are partitionable, which suits applications that can keep working in each component. Applications that maintain shared state usually let only one primary view update it.

Inside Isis, Birman's history describes how the membership service avoids split brain: moving from view `i` to view `i + 1` requires explicit acknowledgment from a majority of its own processes in view `i`. A 5-process service that splits into `{a,b,c}` and `{d,e}` keeps going on the 3-process side. One that splits 4 processes into 2 and 2 has no majority, and neither side proceeds.

### Virtual synchrony

Birman and Joseph (1987) start from a fully synchronous environment, where multicasts are atomic and all events occur in the same order everywhere. That would make these problems easy, but ordering every message is prohibitively expensive. Virtual synchrony keeps the appearance and relaxes the reality: to any process, it appears that "all processes observed the same events in the same order", including failures, recoveries, and membership changes. Actual orders may differ when the results are equivalent, which is where concurrency comes from. The primitives are ABCAST (total order), CBCAST (causal order), and GBCAST (ordered relative to both, used for membership). The 1987 system tolerates message loss but not partitions, which could make parts of it hang.

The survey separates three delivery properties that are easy to conflate:

```text
Same View Delivery:    if p and q both receive m, they receive it in
                       the same view.
Sending View Delivery: m is received in the view in which it was sent.
Virtual Synchrony:     if p and q install the same new view V in the same
                       previous view V', then any message p received in
                       V' was also received by q in V'.
```

Sending View Delivery has a price: a GCS must block sending during a view change, by asking the application for a flush and waiting. Same View Delivery exists to avoid that block.

Virtual Synchrony pays off in state transfer. Replicas that move together from `V'` to `V` received the same messages, so they already hold the same state and need no transfer. A process cannot always tell who moved with it, though, because the property speaks of what other processes installed (Example 3). A **transitional set** delivered with each view gives it that information.

### Turning suspicion into fact

Membership still rests on timeouts, which remain imperfect. Isis treats the verdict as authoritative. Once a failure is declared, the system cuts the process off, and a process that was in fact alive must rejoin like a new one. Applications then see a detector that makes no visible mistakes, which Birman's history describes as implementing a fail-stop model.

Chandra and Toueg draw the cost. Each false suspicion removes a live process, so Isis must set timeouts very conservatively, closer to the worst case, and they report a timeout above 10 seconds in the Isis version of the time. With their detectors a premature timeout only delays progress, so timeouts can sit closer to the average case.

Membership cannot avoid the impossibility results either. Chandra and Toueg cite a proof that group membership is unsolvable in asynchronous systems with crash failures, even with the Isis approach of killing suspected processes. The survey proves a companion result: a precise membership service is as strong as ◇P, because each view can serve as a failure detector output. So GCS liveness is stated conditionally, for runs where the failure detector behaves like ◇P and the network stabilizes.

### Where it meets consensus-based replication

Lamport, Malkhi, and Zhou give a direct mapping: a view corresponds to a configuration, messages to commands, and delivered messages to chosen commands. The difference is where reliable consensus runs. A GCS delivers each message using an unreliable consensus, usually a leader whose failure stops progress, and runs fault-tolerant consensus only at a view change, to fix the old view's delivered messages and the new membership. State machine replication runs reliable consensus for each command. They argue the gap is smaller than it looks: the per-message step is like the first ballot of Paxos, and the view change is like a new leader running a new ballot for all pending instances at once. In their words, "A state-machine implementation and a strong GC service perform essentially the same actions; those actions are just viewed differently."

The word "strong" matters. By their account, Virtual Synchrony as originally defined does not ensure irrevocability, since a message delivered only to a process that then crashes need not survive (Example 2). Their fix: before delivering, a process learns that a majority of the view knows the message was sent, and the value proposed at the view change must include every message some majority knows. Isis's GBCAST and the Safe messages of Transis and Totem give this kind of guarantee.

Birman's history presents the weaker default as deliberate: delivering unstable events was a performance choice, and uniform multicast, GBCAST, or a flush give guarantees identical to Paxos when an application needs them. He concludes that real protocol suites use elements of both. The accounts differ in emphasis on one detail: Lamport, Malkhi, and Zhou say the original definition requires the new view to contain a majority of the old view, while Birman describes a majority as required inside the membership service and optional, by configuration, for application groups.

One more difference: traditional GCS has the new view run the view-changing consensus, and uses a majority overlap between views to keep views unique. In Rα the old configuration chooses the new one, and, as the authors put it, "there is no need for any overlap between the old and new views".

**Book vs today:** the survey dates from 2001, so its list of systems is a snapshot of that time. Its property vocabulary is what this lesson uses.

## Worked Examples

The traces in Examples 1 and 2 are invented for illustration.

### Example 1: a view change restores Virtual Synchrony

```text
V1 = <1,{p,q,r,s}>, V2 = <2,{p,q,r}>. s crashes.

Received in V1 before the view change:
  p {m1,m2}   q {m2}   r {m2}      (m1 came from s, reached only p)

Check Virtual Synchrony for pairs moving from V1 to V2:
  (p,q) differ on m1   (p,r) differ on m1   VIOLATED

The view change fixes the set of messages for V1:
  union reported by survivors = {m1,m2}
  p, q, and r all receive {m1,m2} in V1, then install V2.
  All pairs equal. HOLDS.
```

### Example 2: the irrevocability gap, and the majority rule

Same start, but now `s` delivers `m3` to itself, answers a client, and crashes before anyone else has `m3`.

```text
Survivors report p {m2}  q {m2}  r {m2}. Agreed set: {m2}.
Virtual Synchrony holds: s did not install V2, so it is not constrained.
The client holds an answer based on m3, and m3 is gone.
```

Now apply the stronger rule in `V = {p,q,r,s,t}`. `s` delivers `m3` only after learning that the majority `K = {s,p,q}` knows it was sent. Then `s` crashes. The view change runs among any majority, and without `s` there are four:

```text
{p,q,r} meets K in {p,q}
{p,q,t} meets K in {p,q}
{p,r,t} meets K in {p}
{q,r,t} meets K in {q}
```

Every one contains a process that reports `m3`, so `m3` survives. With only `K = {s,p}`, the majority `{q,r,t}` misses it, which is why knowledge at less than a majority is not enough.

### Example 3: the same view, different histories

This is the scenario in Figure 3 of the survey. `p` partitions from `q`. `q` notices first, installs a view without `p`, and the network heals before `p` reacts.

```text
p installs <1,{p,q}>, then <3,{p,q}>
q installs <1,{p,q}>, <2,{q}>, then <3,{p,q}>

At p: <3,...> and its previous view intersect in {p,q}.
      But q's previous view was <2,{q}>, so the hypothesis of
      Virtual Synchrony fails for the pair (p,q).
      Transitional set at p: {p}.
At q: previous view <2,{q}>. Transitional set at q: {q}.
```

Both installed the same view, and neither may assume the other has the same state. Each sees only itself in its transitional set, so each knows it cannot skip a state transfer with the other.

## Common Misconceptions & Pitfalls

- **"Virtual synchrony means the system is synchronous."** The system stays asynchronous, and the 1987 paper's point is that only the appearance is preserved, at lower cost than real lock-step ordering.
- **"Virtual Synchrony gives all-or-nothing delivery."** The survey notes that all-or-nothing is impossible where messages may be lost, and the property binds only processes that move together. Example 2 shows a delivered message vanishing with no violation.
- **"The same new view means the same messages."** It needs the same previous view too. Example 3 has the same new view and no such guarantee.
- **"Membership sidesteps consensus."** Birman's history itself recognizes the membership protocol as a fault-tolerant agreement solution, and the impossibility results above apply to it.

## Summary

Group membership replaces private suspect lists with an agreed sequence of views, which lets processes coordinate through deterministic rules. Virtual synchrony preserves the appearance that all processes see the same events in the same order, and its central property says that processes moving together between two views received the same messages, which spares them a state transfer. Isis makes suspicion authoritative by removing suspected processes, which forces conservative timeouts and still cannot escape the impossibility of membership in asynchronous systems. A view maps to a configuration, and the difference from consensus-based replication is where reliable consensus runs and whether delivery is irrevocable. With the stronger delivery rule, the two perform essentially the same actions.

## Documentation Links

- [Birman and Joseph (1987): Exploiting Virtual Synchrony in Distributed Systems](https://courses.csail.mit.edu/6.895/fall02/papers/Birman/sosp87-birman.pdf): the virtual synchrony model, ABCAST, CBCAST, GBCAST, and process groups in Isis.
- [Chockler, Keidar, and Vitenberg (2001): Group Communication Specifications: A Comprehensive Study](https://people.csail.mit.edu/idish/ftp/gcs-survey.pdf): the unified properties of membership and multicast, transitional sets, and the proof that precise membership is as strong as ◇P.
- [Lamport, Malkhi, and Zhou (2010): Reconfiguring a State Machine](https://lamport.azurewebsites.net/pubs/reconfiguration-tutorial.pdf): section 4, on the correspondence between group communication and the state machine approach.
- [Chandra and Toueg (1996): Unreliable Failure Detectors for Reliable Distributed Systems](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/p225-chandra.pdf): section 9.3, comparing the Isis approach, and section 9.4, on the impossibility of group membership.
- [Birman (2010): A History of the Virtual Synchrony Replication Model](https://www.cs.purdue.edu/homes/bb/cs542-15Spr/Birman-Cornell-history-Replication.pdf): the author's own account of the membership service, unstable delivery, and the relation to Paxos.
