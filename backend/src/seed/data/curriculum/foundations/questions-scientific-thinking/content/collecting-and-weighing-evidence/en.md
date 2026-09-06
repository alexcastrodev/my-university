---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why the strength of evidence for a hypothesis depends on how surprising that evidence would be if the hypothesis were false, not merely on whether it's consistent with the hypothesis.
- Distinguish evidence that is merely consistent with a hypothesis from evidence that actually discriminates it from a plausible alternative.
- Connect this informal reasoning to the formal logic a p-value encodes, without needing the full statistical machinery to reason correctly day to day.
- Weigh a single surprising result against a larger body of weaker, less surprising results.
- Identify common ways people misjudge how much a given piece of evidence should shift their confidence.

## Context & Motivation

Once a hypothesis has been tested — a minimal experiment run, variables properly isolated and controlled — a result comes back. The remaining, easy-to-underrate skill is figuring out how much that result should actually change what you believe. Not every result that's *consistent with* a hypothesis is strong evidence for it, and not every result that *contradicts* it is a decisive refutation; the right question to ask of any single piece of evidence is not "does this fit my hypothesis?" but "how surprising would this particular result be if my hypothesis were actually false?" A result that would be almost equally likely whether the hypothesis is true or false barely moves the needle, no matter how neatly it seems to confirm the story. A result that would be very unlikely if the hypothesis were false, but is exactly what the hypothesis predicts, is strong evidence — because its occurrence is hard to explain any other way.

This is precisely the logic that a **p-value** formalizes, covered in full statistical rigor in *Hypothesis Testing and p-Values* (in the probability-and-statistics track): a p-value is, roughly, the probability of observing a result at least as extreme as the one actually seen, *if* the null hypothesis (the "nothing interesting is going on" alternative) were true. A small p-value means the observed result would have been surprising under the null — which is exactly "how surprising would this be if my hypothesis [that something real is going on] were false" turned into a specific, calculable number. This concept is not a substitute for that formal machinery, and doesn't re-derive it — its job is to connect the formal apparatus back to the everyday, informal judgment call everyone actually has to make constantly, often with no formal test in hand at all: reading a single benchmark result, a single user complaint, a single week of metrics, and asking honestly how much it should actually shift your confidence, one way or the other.

## Core Theory

### The core question: surprising under what alternative?

Evidence is strong exactly to the degree that it would be unlikely to occur if the hypothesis were false — this is the informal heart of what a formal significance test measures precisely. Concretely: if a hypothesis predicts outcome A, and outcome A is *also* what would be expected under most plausible alternative explanations, then observing A barely distinguishes the hypothesis from those alternatives — it's weak evidence, however comfortably it "fits." If instead outcome A would be genuinely unlikely under any alternative explanation anyone has proposed, and the hypothesis specifically predicts it, then observing A is strong evidence, precisely because there's no easy competing story for why it happened. This reframes "does the evidence support the hypothesis" into the sharper "does the evidence discriminate the hypothesis from its live alternatives" — the same discrimination-first framing that governs how a minimal experiment gets designed in the first place (*Designing a Minimal Experiment*), now applied to interpreting whatever result actually came back.

### Weak confirmation vs. genuine discrimination

A classic weak-confirmation pattern: a hypothesis predicts "performance will improve," a change is made, and performance does improve — taken as confirming evidence. But if performance tends to improve slightly on most deploys regardless of their content (due to gradual infrastructure improvements, caching warming up over time, or simple measurement noise trending in one direction that week), then "performance improved" was likely to happen whether or not this specific change had any real effect — it doesn't discriminate the hypothesis from the alternative "this had no effect and performance would have improved anyway." A genuinely discriminating result would be one that the alternative explanation does *not* predict — say, a specific, precisely-sized improvement that matches a theoretical calculation of the change's expected effect, of a magnitude too large to be explained by ordinary week-to-week drift. The size and specificity of a match to a hypothesis's prediction, not just its direction, is often what separates weak confirmation from real discrimination.

### One striking result vs. many weak ones

Weighing evidence also means comparing across pieces of evidence that differ enormously in strength, and a common error is treating quantity as a substitute for quality. Ten data points that are each individually compatible with either the hypothesis or its alternative do not add up to strong evidence just because there are ten of them, if none of the ten actually discriminates between the two — the weakness of each doesn't disappear through repetition; it can, in some situations, compound (more chances for one to look supportive by chance), but it doesn't get stronger. By contrast, a single result that would be highly improbable under the alternative — a single benchmark that lands exactly where a specific theoretical model predicted, with a precision unlikely to arise by chance — can outweigh a much larger pile of ambiguous, non-discriminating observations. This connects directly to the p-value logic: a p-value is computed from a specific observed result (or one at least as extreme) against a specific null hypothesis, and a very small p-value reflects exactly this situation — a result that would have been quite improbable if nothing interesting were actually going on.

### Updating incrementally, not all-or-nothing

Weighing evidence well also means treating each new result as an update to existing confidence, not as a standalone verdict considered in isolation from everything already known. A surprising result that would be strong evidence on its own carries somewhat less weight if it contradicts a large, carefully gathered body of prior evidence pointing the other way — not because the new result should be dismissed, but because "this one new measurement is itself mistaken or unusual" is now a live alternative explanation that has to be weighed against "the entire prior body of evidence was wrong." Good evidence-weighing keeps track of this balance explicitly, asking not just "is this new result surprising under my hypothesis being false" but also "how does this fit with, or against, the accumulated evidence I already have."

## Worked Examples

### Example 1 — a benchmark result, weak vs. strong evidence compared

**Setup.** Hypothesis: a new database index reduces query latency for a specific slow query pattern. Alternative: the index makes no real difference, and any measured improvement is due to caching effects or ordinary measurement noise.

**Weak evidence.** A single run shows the query completing 8% faster with the index in place. Query timing on this system is known to vary by roughly ±10% run to run due to caching state and background load — an 8% improvement is well within the range that would be expected even under the "no real effect" alternative. This result is close to equally likely whether the hypothesis is true or false; it barely discriminates between them, however much it looks like confirmation on the surface.

**Strong evidence.** Instead, thirty interleaved runs (alternating indexed and non-indexed queries, controlling for caching state as in the earlier controls concept) show a consistent, repeatable 60% latency reduction with the index, far outside the observed run-to-run noise band. A 60% improvement, this consistently, would be quite unlikely if the index had no real effect and the earlier gains were just noise — this specific pattern of results is much more probable under the hypothesis than under the alternative, which is exactly the property that makes it strong evidence. In p-value terms, this second scenario is the kind of result that would correspond to a small p-value against the "no effect" null — a result that would rarely arise by chance alone.

**The lesson.** The single 8% figure and the thirty-run 60% figure differ enormously in evidential weight, even though both are nominally "consistent with" the hypothesis that the index helps — only the second one actually discriminates the hypothesis from its stated alternative.

### Example 2 — a single bug report vs. an accumulating pattern

**Setup.** Hypothesis: a recent change introduced a race condition causing intermittent request failures under load. Alternative: the failures are unrelated pre-existing flakiness in the test environment.

**Weighing the first report.** One user reports an intermittent failure shortly after the change ships. Intermittent failures of this general shape were already occasionally reported before the change too, at a low background rate — so the arrival of one more such report is not, by itself, strongly surprising under the "pre-existing flakiness, unrelated to the change" alternative. It's suggestive, worth investigating, but weak evidence on its own.

**Weighing an accumulating pattern.** Over the following week, the rate of these reports rises to several times the pre-change background rate, and — critically — the reports now cluster specifically around the exact code path the change modified, a pattern the "pre-existing unrelated flakiness" alternative gives no particular reason to expect. This pattern (an unlikely one under the alternative, a likely one under the hypothesis) is strong evidence, not because any single report is dramatic, but because the overall shape of the accumulated evidence is hard to explain except by the hypothesis.

**The lesson.** The evidence didn't become strong because more reports came in per se — quantity alone, as noted above, doesn't manufacture discrimination. It became strong because the *pattern* of the accumulated reports (rate and location) was specifically what the hypothesis predicted and specifically not what the leading alternative predicted.

## Common Misconceptions & Pitfalls

- **"Any result consistent with my hypothesis is evidence for it."** Consistency is necessary but not sufficient — a result has to be more likely under the hypothesis than under a live alternative to actually count as evidence for it over that alternative. A result equally likely either way is evidentially neutral, however comfortably it "fits" the preferred story.
- **"More data points always means stronger evidence."** More non-discriminating data points do not add up to strong evidence; what matters is whether each additional piece of evidence would be surprising under the alternative, not merely how many pieces there are. A single well-designed, highly discriminating result can outweigh a large pile of weak ones.
- **"A surprising result that contradicts everything I previously believed should immediately overturn that belief."** A single new result has to be weighed not just against the hypothesis being tested but against the prior body of evidence already gathered — an isolated surprising result is sometimes best explained by measurement error or an unusual fluke rather than by discarding a well-supported prior conclusion outright, though it should still prompt a genuine re-check rather than dismissal.
- **"A p-value tells you the probability the hypothesis is true."** This is a common misreading of the formal tool this concept connects to informally — a p-value is the probability of the observed (or more extreme) data given the null hypothesis, not the probability of the hypothesis given the data. The informal reasoning in this concept ("how surprising would this be if the hypothesis were false") mirrors the p-value's actual logic; conflating it with "probability the hypothesis is true" gets both the informal and the formal version wrong in the same way.

## Summary

The strength of a piece of evidence is not measured by whether it fits a hypothesis, but by how surprising it would be if the hypothesis were false — a result that's just as likely under a plausible alternative barely shifts confidence at all, however neatly it seems to confirm the story, while a result that would be genuinely improbable under any competing explanation is strong evidence precisely because it's hard to explain away. This is the same logic a p-value formalizes exactly, computing the probability of a result at least this extreme under the null hypothesis; the informal skill this concept builds is applying that same discrimination-first reasoning day to day, without always running a formal test — weighing a single striking, hard-to-explain-otherwise result against a larger pile of weaker, non-discriminating ones, and updating existing confidence incrementally rather than treating each new result as a standalone, all-or-nothing verdict.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Karl Popper](https://plato.stanford.edu/entries/popper/) — doc
- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
