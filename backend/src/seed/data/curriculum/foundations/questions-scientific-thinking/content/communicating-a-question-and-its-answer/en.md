---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why a result nobody can understand or verify has, in practical terms, the same value as no result at all.
- Apply Peyton Jones' opening move — state the idea, why it matters, why it's hard — to describing a question and its answer.
- Distinguish communicating a result from merely reporting it: the difference between stating what happened and making it checkable.
- Identify the specific information a reader needs to verify a claimed result, not merely to be told it occurred.
- Evaluate a written summary of an investigation for whether it would let an independent reader reproduce or challenge the conclusion.

## Context & Motivation

Every concept so far in this discipline has focused on the internal discipline of investigation: forming a question, building a testable hypothesis, designing an experiment, weighing evidence, iterating when a result comes back. All of that work can be done with total rigor and still, in a very real sense, accomplish nothing beyond the investigator's own head — if nobody else can understand what the question was, what was actually tested, or what the result means, the investigation's value never leaves the room it was done in. This concept is about the step that turns private understanding into something that can be checked, built on, or acted on by someone else: communicating the question and its answer clearly enough that another person could, in principle, verify it.

Simon Peyton Jones' "How to Write a Great Research Paper" opens with a specific, memorable structural move, and it is worth taking at face value rather than treating as generic writing advice: before anything else, say what the idea is, why it matters, and why it's hard. Peyton Jones' point is that a reader who does not yet have these three things has no way to evaluate anything that follows — not the method, not the result, not the significance of either — because they don't yet know what question is being answered or why anyone should care about the answer. This is not a formatting convention specific to academic papers; it is a direct consequence of how understanding actually works. A result presented without its question is a fact floating free of any reason to believe it matters; a question presented without why it's hard invites the reasonable objection that the answer might be obvious and the whole effort unnecessary.

The stakes of skipping this step are not abstract. A result that cannot be understood cannot be verified, and a result that cannot be verified cannot be trusted, built on, or cited by anyone other than the person who produced it — which, for almost any purpose this discipline cares about, is functionally the same as not having produced a result. This is the flip side of the previous concept's point about reading prior work: someone else, later, will need to be able to do to your result exactly what you did to the prior work you checked — read it, understand what was actually claimed and tested, and decide whether it settles the question or leaves something open. If your own communication doesn't support that, the cycle this discipline is building toward (developed fully in the final concept) breaks at exactly the handoff point where one person's result should become another person's starting point.

## Core Theory

### Peyton Jones' opening move, applied to a question and its answer

The three-part opening — what the idea is, why it matters, why it's hard — maps directly onto communicating an investigation's question and result, not just a formal paper's introduction:

1. **What the idea is:** State the actual question investigated, in concrete terms, not a vague topic area. "I looked into cache performance" is a topic; "I tested whether eviction policy X handles bursty access patterns better than policy Y" is an idea someone can evaluate.
2. **Why it matters:** State what would change, for someone, if the question were answered one way versus the other. This connects back to the problem-selection standard from earlier in this discipline — if the answer wouldn't matter to anyone, that fact should already have disqualified the question, but a reader who wasn't there for that earlier judgment still needs to be told why the answer is worth their attention now.
3. **Why it's hard:** State what makes the question non-obvious — why a reasonable person couldn't just guess the answer confidently without testing it, or why prior approaches to it (per the previous concept's literature check) fell short. This is what justifies the effort the investigation took, and it is often exactly the content the "reading prior work" step surfaced.

Skipping any one of these three leaves a reader unable to fully evaluate what follows: without (1) they don't know what's being claimed, without (2) they don't know why to care, and without (3) they may reasonably assume the result was trivial to obtain, undercutting its credibility even if the work behind it was genuinely rigorous.

### Reporting is not the same as communicating

It is possible to state a result accurately and still fail to communicate it, if the statement leaves a reader unable to check it. "The new algorithm was faster" reports an outcome; it does not communicate a checkable claim, because it omits faster under what conditions, faster by how much, faster compared to what baseline, and measured how. Communicating the result means including enough of the actual investigation — the hypothesis tested, the experimental setup, the specific measurement — that an independent reader could, at least in principle, run the same test and expect to get a comparable answer, or could spot a flaw in the reasoning if one exists. This is the direct extension of falsifiability into the communication step: a claim that can't be checked by anyone but its author is, for practical purposes, no more verifiable than an unfalsifiable hypothesis was in the earlier concepts on Popper's criterion.

### What a reader needs in order to verify, not just believe

Verifying a result requires more than being told it is true; it requires enough information to independently assess it. At minimum, this means: the question, stated precisely enough to know what would count as an answer (echoing the well-formed-question standard from earlier in this discipline); the hypothesis actually tested, not a looser paraphrase of it; the essential conditions of the experiment — what was held constant, what was varied, what was measured — sufficient to distinguish the actual test from other tests that might sound similar but check something different; and the result itself, stated with enough precision (a number, a clear comparison, an explicit "this held" or "this did not hold") that it cannot be silently reinterpreted later as having shown something it didn't.

### Communicating negative and inconclusive results is not optional

A falsified hypothesis, per the earlier concept on contradicting evidence, is a real result — and this means it deserves the same communication discipline as a confirming one. A common and damaging shortcut is to communicate confirmations carefully and quietly drop falsifications, which both distorts the record (making the field's or the team's collective picture look more settled than it is) and denies the next investigator, who might otherwise have tried the same falsified approach, the benefit of already knowing it doesn't work. Peyton Jones' "why it's hard" framing applies just as well to a negative result: often the most valuable thing communicated is precisely that an intuitive-seeming approach was tried carefully and did not work, which is exactly the kind of information the previous concept's literature check depends on existing somewhere for the next person to find.

## Worked Examples

### Example 1 — the same result, reported versus communicated

**Bare report (insufficient):** "We tried adding a cache to the search endpoint and it helped a lot."

**What's missing, mapped to Peyton Jones' three elements and the verification checklist:** What idea, precisely, was tested (which cache strategy, applied to which part of the request path)? Why did it matter (what was the actual cost of the current latency, to whom)? Why was it hard (was the obvious approach already tried and found insufficient, and if so, why)? And for verification: helped by how much, measured how, compared against what baseline, under what load?

**Communicated version:** "The search endpoint's median response time was 340ms under production-representative load (10,000 requests over a 5-minute window, on the standard staging cluster), largely driven by repeated identical database queries during typical usage bursts — a pattern that a naive per-request cache doesn't help with, since most of the repetition happens across distinct users rather than within a single user's requests. We hypothesized that a shared, cross-request cache keyed on the normalized query would reduce median latency, since it directly targets that specific pattern. After deploying a shared cache with a 60-second TTL and testing under the same load profile, median response time dropped to 95ms (a 72% reduction), while cache hit rate stabilized at 81%. The remaining 19% of requests, which miss the cache, still show latency consistent with the original uncached figure, confirming the mechanism (cache hits, not some unrelated change) is what accounts for the improvement."

**Why the second version succeeds:** It states the idea (a shared, cross-request cache targeting a specific repetition pattern), why it mattered (a specific, quantified latency problem), why it was hard (the obvious per-request cache wouldn't have worked, and explains why), and it gives a reader everything needed to verify or challenge the claim — including the detail that cache misses still show the original latency, which is itself a small internal check supporting that the cache, specifically, caused the improvement rather than some confound.

### Example 2 — communicating a falsified hypothesis usefully

**Scenario:** An investigation hypothesized that switching a service's data format from JSON to a binary serialization format would meaningfully reduce end-to-end request latency, reasoning that smaller payloads and faster parsing should both help.

**Bare, discouraged version:** "We tried binary serialization; it didn't really help, so we reverted it." This reports an outcome but communicates almost nothing checkable or reusable.

**Communicated version:** "We hypothesized that binary serialization (format X) would reduce end-to-end latency, since it produces roughly 40% smaller payloads and should parse faster than JSON, and this mattered because payload size was suspected as a bottleneck for our largest responses. We measured end-to-end latency across representative request sizes before and after switching formats, holding network conditions and server load constant. Median latency changed by less than 2% (within measurement noise), despite the payload size reduction being confirmed as expected. Profiling revealed that serialization and network transfer together accounted for only about 6% of total request time; the remaining 94% was dominated by a downstream database query unaffected by the wire format — meaning payload size was never actually the bottleneck for this endpoint, contrary to our initial hypothesis. We are recording this here so the format is not tried again for this specific latency problem without first addressing the database query time."

**Why this succeeds even though the hypothesis failed:** It states what was tried and why it seemed reasonable (why it's hard actually to have known in advance), reports the negative result with enough specificity (the 2% figure, the profiling breakdown) to be verified or challenged, and — critically — it identifies the actual bottleneck the falsification exposed, directly setting up the next question per the earlier concept on iterating from result to new question. A future investigator encountering only the bare version would have no way to know whether the format change was tried correctly, tried under representative conditions, or worth revisiting; the communicated version answers all of that in advance.

## Common Misconceptions & Pitfalls

- **"If the result is correct, how it's communicated is a secondary concern."** A correct result that cannot be verified by anyone but its author provides essentially the same practical value as an unverified claim, regardless of whether it happens to be true — correctness that can't be checked is indistinguishable, from the outside, from an unsupported assertion.
- **"Negative or inconclusive results aren't worth writing up carefully."** Example 2 shows a falsified hypothesis communicated well doing real, specific work: preventing a repeated wasted attempt and pointing directly at the actual bottleneck. Skipping careful communication of a negative result throws away exactly the information the "reading prior work" step, covered previously, depends on existing for the next person.
- **"Explaining why it matters is just marketing, not substance."** Peyton Jones' "why it matters" step is not persuasion for its own sake — it's the information a reader needs to decide whether investing attention in the rest of the communication is worthwhile at all, and without it, a technically accurate result can be entirely overlooked by the people who would have most benefited from it.
- **"More detail is always better communication."** Communicating well means including what's needed to understand and verify the claim, not exhaustively including every detail of the process — an experimental log with no structure is not more communicative than a focused summary, it is merely longer; the verification checklist in Core Theory is a floor, not license for undifferentiated detail.
- **"A result is communicated once it's written down somewhere."** Written down and understandable-and-checkable-by-someone-else-with-different-context are not the same thing — a summary that only makes sense to someone who already watched the investigation happen has not actually closed the communication gap this concept addresses.

## Summary

A result nobody else can understand or verify has, for nearly every purpose that matters, the same practical value as no result at all — the private discipline of a rigorous investigation does not by itself make its outcome usable to anyone else. Peyton Jones' opening move for a great research paper — state the idea, why it matters, why it's hard — applies directly to communicating a question and its answer, and doing so well means giving a reader enough to verify the claim independently: the precise question, the actual hypothesis tested, the essential experimental conditions, and a precisely stated result. Both worked examples showed the same underlying move: a bare report of an outcome versus a communicated result that a reader could check, challenge, or build on — including, in the second example, a falsified hypothesis whose careful communication did real, specific, forward-looking work. Communicating clearly is not a polish step applied after the real work is done; it is the step that determines whether the real work was ever actually usable by anyone besides the person who did it.

## Documentation Links

- [Peyton Jones, "How to Write a Great Research Paper"](https://www.microsoft.com/en-us/research/academic-program/write-great-research-paper/) — doc
- [Hamming, "You and Your Research" (1986 transcript)](https://www.cs.virginia.edu/~robins/YouAndYourResearch.pdf) — doc
