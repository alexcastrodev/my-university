---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Distinguish a well-formed question from a testable hypothesis, and explain why the second is not just a restatement of the first.
- Convert a diagnostic question ("why is this slow?") into one or more specific, checkable hypotheses.
- Identify the properties that make a hypothesis testable: specificity, a proposed mechanism, and a predicted, observable difference.
- Generate multiple competing hypotheses for the same question and explain why that is normal rather than a sign of confusion.
- Recognize disguised non-hypotheses — statements that sound like guesses but commit to nothing checkable.

## Context & Motivation

A prior concept in this track established what makes a question well-formed: it names what would count as an answer. "Which of these three operations dominates the running time under load X?" is well-formed in exactly this sense — there is a finite set of candidate answers (the three operations), and any one of them, once identified, settles the question. But a well-formed question is still just a question. It tells you what shape an answer must have; it does not commit to any particular answer. Knowing that the answer is "one of these three operations" is not the same as having a guess about *which* one, or *why*. That guess — specific, checkable, and offered before you look at the evidence that would confirm or refute it — is a hypothesis, and turning a question into one is the step this concept is about.

The distinction matters because a question, by itself, cannot be tested. You cannot design an experiment, write a profiling script, or run a measurement against "why is this slow?" — there is nothing there to check against reality, only a gap you'd like filled. A hypothesis fills that gap with a specific claim: "the slowdown is caused by repeated re-allocation in the hot loop." That claim can be checked. You can look at allocation counts, you can pre-size the buffer and re-measure, you can profile and see where time is actually spent. The question told you *what kind* of thing would count as an answer (an operation, a cause); the hypothesis proposes an actual candidate and, in doing so, becomes something evidence can bear on.

This step also sets up the next concept in this track directly: Karl Popper's demarcation criterion, as documented in the Stanford Encyclopedia of Philosophy's entry on Popper, holds that a claim is scientific to the extent that it could conceivably be shown false by some observation. That criterion applies to hypotheses, not to questions — a question has no truth value to falsify, but a hypothesis does. So refining a question into a hypothesis is also, implicitly, the first move toward making your reasoning falsifiable in Popper's sense: you cannot ask whether a bare question could be wrong, but you can ask that of "the slowdown is caused by repeated re-allocation," and the answer is yes, which is exactly what makes it worth testing.

## Core Theory

### Question vs. hypothesis: two different jobs

A question defines the space of acceptable answers without picking one. A hypothesis picks one — or one of a short list — and states it as a claim that could turn out to be right or wrong. Compare:

- Question: "Which of these three operations dominates the running time under load X?"
- Hypothesis: "The `resize()` calls inside the loop dominate the running time under load X."

The question is satisfied by *any* correct identification of the dominant operation; it doesn't commit to one in advance. The hypothesis commits. That commitment is what makes it useful: once you have a specific guess, you know exactly what evidence would support it (profiling shows `resize()` consuming most of the wall-clock time) and exactly what evidence would undercut it (profiling shows the dominant cost lies elsewhere). A question alone gives you no such target.

### The refinement process: narrowing the space of answers

Turning a question into a hypothesis is an act of narrowing, and it typically proceeds through recognizable moves:

1. **Start from the well-formed question**, which already names the category of answer (an operation, a cause, a value).
2. **Bring in whatever partial evidence or domain knowledge already exists** — a stack trace, a profiler's flame graph, a hunch from having seen this failure mode before — to propose a specific candidate rather than leaving the category open.
3. **State the candidate as a claim about the world**, not as a further question. "Is it the re-allocation?" is still a question. "The re-allocation is the cause" is a hypothesis.
4. **Attach, even informally, what observing the hypothesis being wrong would look like.** If you cannot say what a false version of your claim would look like, you likely have not yet produced a hypothesis — see Common Misconceptions below.

This is a refinement, not a leap: the hypothesis should be traceable back to the question it answers. A hypothesis that answers a different question than the one you started with is not progress, even if it happens to be true of something.

### What makes a hypothesis testable

Three properties, in practice, separate a testable hypothesis from a vague guess:

- **Specificity.** "Something about memory is slowing this down" names a category, not a claim. "Repeated calls to `resize()` inside the loop account for most of the wall-clock time" names a specific, checkable mechanism.
- **A proposed mechanism or locus.** A good hypothesis says not just *that* something is true but *where* or *how* — which function, which resource, which interaction. This is what lets you design a test that targets exactly that mechanism rather than a broad sweep of everything.
- **A predicted observable difference.** If the hypothesis is true, some measurement should come out differently than if it is false. "The re-allocation is the cause" predicts that pre-sizing the buffer to avoid repeated `resize()` calls should measurably reduce the running time; if pre-sizing does nothing, the prediction fails.

None of these properties requires the hypothesis to be *correct*. A specific, mechanism-naming, prediction-making hypothesis that turns out to be wrong is still a good hypothesis — it did its job by being checkable, and the check simply came out negative. That is a different failure mode from a hypothesis that was never checkable to begin with.

### Multiple hypotheses, one question

A single well-formed question routinely admits several competing hypotheses, and producing more than one is a sign of good practice, not confusion. For "which of these three operations dominates the running time under load X?", it is entirely reasonable to hold three candidate hypotheses simultaneously — one per operation — precisely because the question named three candidates and gave no reason yet to favor one. The value of writing all three out explicitly, rather than jumping straight to a favorite, is that it forces you to specify in advance what evidence would distinguish among them, before that evidence is in hand. Committing to a single hypothesis too early, before ruling out its competitors, risks interpreting ambiguous evidence as confirming the one guess you already liked.

## Worked Examples

### Example 1 — a slow API endpoint under load

**Question (already well-formed):** "Which of these three operations — database query, JSON serialization, or template rendering — dominates the response time for this endpoint under concurrent load?"

**Refinement to hypotheses.** A flame graph from a single-user profiling run shows serialization taking a large fraction of CPU time even without concurrency, which is domain evidence worth incorporating. This suggests, but does not prove, an answer under load. Three candidate hypotheses, each traceable to the original question:

- H1: "JSON serialization dominates response time under load, because it re-serializes the full object graph on every request rather than caching an already-serialized representation."
- H2: "The database query dominates under load, because connection-pool exhaustion under concurrency causes queries to queue."
- H3: "Template rendering dominates under load, because it performs redundant sub-template lookups per request."

**Checking testability.** Each hypothesis names a specific mechanism (repeated serialization, pool exhaustion, redundant lookups) and each predicts a distinct observable: H1 predicts that caching the serialized payload should reduce response time; H2 predicts that response time should correlate with pool wait time specifically, visible in pool metrics; H3 predicts that response time should not improve much from caching serialization but should improve from caching template lookups. Because the three predictions diverge, a single load test with per-stage timing can, in principle, distinguish among all three — this is exactly the target a bare question could not provide.

### Example 2 — flaky integration test

**Question:** "What causes this specific integration test to fail on roughly 1 in 20 CI runs, and does the failure originate in the test itself or in the service it exercises?"

**Refinement to hypothesis.** Rather than stopping at "it's flaky, something's wrong," which names no mechanism and predicts nothing, the refinement looks at the failure logs: every recorded failure shows the test's assertion running before the service's async write has completed. That observation supports a specific hypothesis: "The test fails intermittently because it asserts on the write's result before the service's asynchronous persistence step has finished, and the race is only lost under CI's slower, more variable scheduling."

**Why this is testable and the vague version was not.** "It's flaky" predicts nothing — no experiment could show it false, because it doesn't commit to any mechanism a measurement could target. The refined hypothesis predicts that inserting an explicit wait for the persistence step's completion should drive the failure rate toward zero, and that artificially slowing the service's write path (to widen the race window) should increase the failure rate. Both are concrete, checkable predictions; a version of this hypothesis that turned out to be false (say, the failure rate stayed the same after adding the wait) would clearly show the guess wrong, which is exactly the property a bare "it's flaky" claim lacks.

## Common Misconceptions & Pitfalls

- **Restating the question with more words is not a hypothesis.** "It's slow because something in the code is inefficient" sounds more specific than "why is this slow?" but commits to nothing a measurement could check — it does not name a mechanism or predict any particular observation. A genuine hypothesis names a *candidate cause*, not a synonym for "there is a cause."
- **A hypothesis doesn't need to be correct to be good.** The quality of a hypothesis is judged by whether it is specific and checkable, not by whether it turns out to be true. A precise hypothesis that gets refuted by the data has still done useful work — it eliminated a candidate and narrowed the search; a vague one that can neither be confirmed nor refuted has done none.
- **One question producing several hypotheses is normal, not a symptom of not understanding the problem.** Holding multiple named candidates open at once, each traceable back to the same question, is standard practice — it is premature narrowing to a single favorite, before evidence distinguishes them, that tends to bias later interpretation of results.
- **A hypothesis is not the same as a fix.** "Adding a cache would help" is a proposed action, not a claim about what is currently true. The hypothesis form is a claim about the present cause of the observed behavior ("repeated re-allocation is currently causing the slowdown"), which is what a fix's justification should rest on — proposing the fix first and reverse-engineering a hypothesis to match it risks fitting the guess to the desired solution rather than to the evidence.

## Summary

A well-formed question names the category an answer must fall into; a hypothesis is a specific, checkable claim that picks a candidate answer (or a short list of them) before the evidence is examined. The refinement from one to the other requires specificity, a named mechanism or locus, and a predicted observable difference — properties that together make a claim something a test can actually bear on, in contrast to a bare question, which nothing can directly test. A single question often supports several distinct, competing hypotheses at once, and writing them all out explicitly — rather than committing early to a favorite — keeps later evidence from being read selectively. This refinement is also the necessary first step toward the next concept in this track: only a hypothesis, not a question, can be asked whether it is falsifiable.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Karl Popper](https://plato.stanford.edu/entries/popper/) — doc
- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
