---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define what distinguishes a hypothesis (the claim under test) from an assumption (what is taken for granted so the test can run at all).
- Explain, via the Duhem-Quine observation, why a test result technically bears on the conjunction of a hypothesis and its assumptions, not the hypothesis alone.
- Identify the hidden assumptions embedded in a concrete test design before running it.
- Diagnose, when a test "fails," whether the hypothesis was actually refuted or an assumption was instead violated.
- Distinguish legitimate assumption-checking from the ad hoc rescue of a hypothesis that falsifiability warns against.

## Context & Motivation

The previous concept in this track established Popper's falsifiability criterion: a claim counts as scientific to the extent that some conceivable observation could show it false. But no test of a hypothesis ever happens in a vacuum. Testing "the slowdown is caused by repeated re-allocation in the hot loop" requires trusting that the profiler's timing is accurate, that the workload used to trigger the slowdown is representative of the one that motivated the question, and that nothing else on the machine is contending for the same CPU cores during the measurement. None of these are the hypothesis. All of them are quietly required for the test of the hypothesis to mean anything. These background requirements are **assumptions**: propositions taken for granted, not because they are certain, but because a test has to stand on something, and testing everything at once is not possible.

This distinction is not a philosophical nicety; it has a precise logical consequence, sometimes called the Duhem-Quine problem, that follows directly from the falsifiability discussion in the prior concept. When an experiment's outcome contradicts a prediction, what has strictly been falsified is not the hypothesis in isolation — it is the conjunction of the hypothesis *and* every assumption the test relied on. If pre-sizing a buffer to eliminate repeated `resize()` calls fails to speed anything up, logic alone does not tell you whether the re-allocation hypothesis was wrong or whether, say, the benchmark harness introduced its own overhead that swamped the effect being measured. Both are consistent with the same failed test. Sorting out which one actually broke is a distinct, necessary skill — treating every failed test as an automatic refutation of the hypothesis, without first checking the assumptions the test depended on, produces confident but wrong conclusions.

The stakes of getting this right connect back to the falsifiability discussion in a second way. Popper's criticism of pseudo-science was aimed at theories rescued from refutation by adding explanations after the fact, with no principled limit on how many such rescues could be invented. Legitimately identifying a broken assumption is not the same move — but it can look identical from the outside if done carelessly, which is exactly why this distinction deserves to be drawn carefully rather than invoked as a convenient excuse whenever a hypothesis fails.

## Core Theory

### What counts as a claim, what counts as an assumption

A **claim** (hypothesis) is the specific, checkable guess the test exists to evaluate — it is what you are trying to learn whether is true. An **assumption** is something the test's design depends on being true, but which the test is not designed to evaluate; it is presupposed rather than investigated. The test of "adding a cache layer reduces median response time" presupposes, among other things, that the load generator issues a consistent, comparable request pattern across the with-cache and without-cache runs, and that the timing instrumentation measures what it claims to measure. Neither of those is the claim being tested; both are conditions the test's validity depends on.

The line is not about certainty — an assumption can be well-justified or shaky, and either way it remains an assumption as long as the test does not actually check it. The line is about *role*: the claim is the thing this particular test is designed to put at risk; the assumption is everything else the test's design leans on without putting at risk.

### The Duhem-Quine observation, applied to a single test

Formally, a test of hypothesis H, run under assumptions A1, A2, …, An, produces a prediction that follows from H **together with** all the Ai. If the prediction fails, classical logic (modus tollens) only licenses rejecting the conjunction "H and A1 and A2 and … and An" — it does not, by itself, tell you which conjunct to blame. This is the same logical structure recognized in the philosophy of science literature the Stanford Encyclopedia of Philosophy's entries on Popper and on science and pseudo-science both gesture toward when discussing how auxiliary assumptions can shield a theory from a clean refutation: a failed test is always, strictly, evidence against the whole bundle, and apportioning that blame to the hypothesis specifically requires additional work — checking the assumptions independently, one at a time, rather than assuming by default that the hypothesis is the part that broke.

### Making assumptions explicit before testing

Because assumptions are easy to overlook precisely because they are taken for granted, the practical discipline is to write them down before running the test, not after it fails. For a given hypothesis, this means asking: what does this test's design require to be true, that the test itself does not check? Typical categories worth naming explicitly:

- **Instrumentation validity** — does the measuring tool (a profiler, a timer, a logging pipeline) actually measure the quantity the hypothesis is about, at adequate resolution?
- **Environmental stability** — is anything besides the variable under test also changing between conditions being compared (background load, cache warmth, network conditions)?
- **Representativeness** — does the test's workload or input resemble the situation the original question was actually about, or a convenient stand-in for it?

None of this list is exhaustive; the point of the exercise is not to produce a checklist but to convert silent, unexamined assumptions into named ones that can later be checked independently if a test result is surprising.

### Diagnosing a failed test: hypothesis or assumption?

When a test's outcome contradicts the prediction, the Duhem-Quine structure above says the correct next step is not to immediately conclude the hypothesis is false, but to check the assumptions the test depended on, starting with the ones most plausible to have been wrong or least previously verified. If every named assumption checks out independently — the timer's resolution is confirmed adequate by a separate calibration test, the environment is confirmed stable by monitoring during the run, the workload is confirmed representative by comparison to production traffic — then the failed prediction can be attributed to the hypothesis with much more confidence. If instead one of the assumptions turns out to have been violated, the correct conclusion is that the test said nothing decisive about the hypothesis at all; it needs to be re-run once the broken assumption is fixed.

## Worked Examples

### Example 1 — does caching improve response time?

**Hypothesis:** "Adding a read-through cache in front of this database call will reduce median response time under normal load."

**Assumptions the test depends on (made explicit beforehand):** (a) the request timer used to measure response time captures the full round trip, not just a partial span of it; (b) the load used in the with-cache and without-cache runs is generated the same way, so any difference isn't an artifact of different traffic patterns; (c) no other process on the test host is competing for CPU or network resources during either run.

**Test result:** median response time is essentially unchanged with the cache enabled — the prediction fails.

**Naive conclusion:** "The hypothesis is false; caching doesn't help here."

**Correct diagnosis:** checking assumption (a) first (as the least previously verified), it turns out the timer wraps only the database call itself, not the full request handler — and the full handler was, unbeknownst to the tester, re-fetching the same data a second time later in the request for an unrelated reason, a cost the cache never touched and the timer never saw. Once the timer is corrected to measure the full round trip, the cache shows a clear, measurable improvement. The hypothesis was never actually tested by the first run; a broken assumption about what the timer measured was hiding the effect the whole time. The "failed" test refuted assumption (a), not the caching hypothesis.

### Example 2 — an A/B test on a UI change

**Hypothesis:** "The redesigned checkout button increases the completion rate of the checkout flow."

**Assumptions:** (a) users are randomly and independently assigned to the control or treatment version, so the two groups are comparable in all other respects; (b) the completion-rate metric counts each real user's outcome exactly once; (c) both variants receive the same mix of traffic sources (organic, paid, referral) over the test window.

**Test result:** the treatment group shows a lower completion rate than control — the opposite of the predicted direction.

**Naive conclusion:** "The new button hurts conversion; the hypothesis is refuted, and worse, it's backwards."

**Correct diagnosis:** an audit of assumption (b) reveals that a batch of automated monitoring traffic — bot requests that never complete checkout by design — was misclassified as real users and happened to be routed disproportionately into the treatment bucket by a caching quirk in the assignment logic, violating assumption (a) as well. Once bot traffic is filtered out of both groups, the treatment group's completion rate is actually slightly higher than control, consistent with the original hypothesis. The test as originally run refuted the conjunction of the hypothesis with a violated randomization assumption, not the hypothesis on its own.

### Example 3 — a case where the hypothesis really was wrong

**Hypothesis:** "Switching the sorting algorithm from the current implementation to a specialized radix sort will reduce total processing time for this batch job."

**Assumptions:** (a) the profiler's reported time attributes cost correctly to the sorting step rather than to adjacent I/O; (b) the input data used in testing has the same key distribution as production data; (c) the machine running the test has consistent, unthrottled CPU availability throughout the run.

**Test result:** radix sort shows no improvement, and this holds after separately verifying, one at a time, that the profiler attribution is correct (confirmed by a targeted micro-benchmark isolating just the sort call), that the test data's key distribution matches a sampled production dataset (confirmed by comparing distributions directly), and that CPU throttling was not a factor (confirmed by monitoring during the run, with no throttling events observed).

**Diagnosis:** with all three assumptions independently checked and holding, the failed prediction can now be attributed to the hypothesis itself with reasonable confidence — in this case, because the batch job's total time is genuinely dominated by I/O rather than sorting, a fact the profiler's correct attribution (assumption a, verified) actually confirms directly. This is the case the naive approach in Examples 1 and 2 gets right by accident but for the wrong reason: here, checking the assumptions was still the right move, and it is what turns "the test failed" into a confidently attributable refutation of the hypothesis rather than a lucky guess.

## Common Misconceptions & Pitfalls

- **Treating every failed test as an automatic refutation of the hypothesis.** As the Duhem-Quine observation makes explicit, a failed prediction strictly falsifies the hypothesis-and-assumptions bundle, not the hypothesis alone — Examples 1 and 2 show this going wrong when the assumption, not the hypothesis, was the actual point of failure.
- **Confusing legitimate assumption-checking with the ad hoc rescue that falsifiability warns against.** Checking a named, previously-stated assumption independently, with its own test, and abandoning the hypothesis if that assumption turns out to hold, is principled; inventing a new, untested excuse only after an inconvenient result, with no independent way to check it, is the ad hoc move Popper criticized in the pseudo-scientific theories discussed in the prior concept. The difference is falsifiability of the rescue itself — was the assumption specified and checkable before or independently of the failure, or was it invented solely to explain the failure away with no way to check it on its own?
- **Assuming an assumption needs no justification because "it's just an assumption."** An assumption is not being tested by *this* experiment, but that does not mean it is beyond scrutiny altogether — it typically has been, or could be, checked by some other means (a calibration test, a separate audit), which is precisely what Examples 1 through 3 do to tell a genuine refutation of the hypothesis apart from a broken assumption.
- **Trying to question every assumption every time, turning every test into an infinite regress.** Not every assumption is equally worth auditing on every run — well-established, previously verified assumptions (a timer library known to be accurate, a randomization mechanism already audited elsewhere) can reasonably be trusted without re-checking each time; the discipline is to name the assumptions and prioritize checking the ones most likely to be wrong or least previously verified, not to re-litigate all of them indefinitely.
- **Not distinguishing an assumption from the hypothesis in the first place.** If assumptions are never made explicit before a test runs, there is nothing to check when a result is surprising, and the temptation to simply declare the hypothesis refuted (or, worse, to invent an unfalsifiable excuse) becomes much stronger by default.

## Summary

An assumption is a proposition a test's design depends on but does not itself evaluate; a hypothesis (claim) is the specific guess the test exists to put at risk. Because any real test's prediction follows from the hypothesis together with its assumptions, a failed prediction strictly falsifies only that whole bundle — attributing the failure specifically to the hypothesis requires independently checking the assumptions first, starting with the least-verified ones, rather than assuming by default that the hypothesis was the part that broke. Naming assumptions explicitly before a test runs, rather than discovering them only after a surprising result, is what makes this diagnosis possible at all. The crucial discipline this all serves is keeping legitimate, checkable assumption-auditing distinct from the ad hoc, unfalsifiable rescues that the falsifiability criterion in the prior concept warns against — the difference is not whether an explanation for a failed test exists, but whether that explanation was itself specified in advance and independently checkable, or invented solely to save the hypothesis after the fact.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Karl Popper](https://plato.stanford.edu/entries/popper/) — doc
- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
