---
title: "Metastable Failures in Distributed Systems"
summary: A vision paper that names a class of outages where a trigger pushes a system into a bad state that a feedback loop then keeps alive after the trigger is gone.
researchArea: Distributed Systems
keywords: metastable failures, resilience, overload, retries, caching, outages
version: 1.2
updatedAt: 2026-10-31
---

## Overview

Large outages are often blamed on a trigger: a network blip, a lost cache, a traffic spike. This HotOS 2021 vision paper, written from experience operating hyperscale systems, says that in many of them the trigger is not the root cause.

It describes metastable failures: after a trigger, the system stays in a bad state with very low goodput (useful work per second) even though the trigger has ended, because something inside the system sustains it. Getting out takes a strong push such as a restart or a large cut in load.

## Contribution

The paper does not propose a system. Its contribution is a vocabulary and a way of looking at outages.

- A system moves between a **stable** state, a **vulnerable** state (healthy, but a trigger can tip it over) and a **metastable** state (stuck).
- The **root cause** is the sustaining effect, usually a feedback loop with work amplification, not the trigger. Many different triggers lead to the same state.
- Many production systems choose to run in the vulnerable state on purpose, because it is much more efficient than the stable one.

## Methodology

The method is case analysis from production experience, in a simplified form, followed by a survey of what practitioners did.

The cases are request retries (a web application with a database behind it), a look-aside cache that is lost and cannot be refilled, slow error handling, and an imbalance between links of an aggregated network connection. For each one the paper identifies the trigger, the sustaining effect and the resource that runs out.

It then lists techniques used after the fact: changing policies during overload (retry budgets, LIFO scheduling, load shedding, circuit breakers), prioritization, and stress tests, and it closes with research questions.

## Findings

There are no experiments. The numbers come from worked examples in the text.

- In the retry example the database serves 300 queries per second. At 280 queries per second, a 10 second network outage followed by retransmitted requests and retries doubles the load to 560 and the system gets stuck with no goodput. Recovery needs the load under 150 queries per second or retries limited to under 20.
- With a 90% cache hit rate the web application can handle 3,000 queries per second, but the database alone handles about 300. If the cache is lost at a load above that, the empty cache cannot refill and losing a cache with a 90% hit rate multiplies database queries by 10.
- The paper describes a link imbalance failure that took more than two years to explain and had a one-line fix, a change of connection pool policy.
- One geo-distributed system that added retries and failover for steady-state reliability reached a worst-case work amplification of over 100x.

## Critical Analysis

The framing is useful because it moves attention from the trigger to the loop that sustains the failure, and because it shows that features added for reliability (retries, caches, failover) can be the cause.

Limits to keep in mind:

- It is a vision paper. The examples are simplified retellings, not data, and the paper does not say how common metastable failures are.
- The definition is broad. It separates them from denial of service, limplock and livelock, but in practice deciding whether an outage was metastable still needs judgment after the fact.
- The mitigations are ad hoc and reactive, as the authors admit, and several have costs of their own (for instance, coordination for adaptive policies can become a new sustaining effect).
- Prediction is left open: finding the vulnerable state before a trigger arrives is the hard part and is not solved here.

## Further Research

The authors list open questions.

- Systematic ways to find vulnerable states in existing systems.
- Designing systems whose feedback loops are impossible or at least discoverable, for instance by bounding work amplification.
- Using a characteristic metric (such as queueing delay or cache hit rate) that stays abnormal until the failure resolves.
- Whether elastic cloud capacity can end a metastable failure, and what reconfiguration costs.
- Models and tests that predict the next failure instead of explaining the last one.
