---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State Karl Popper's demarcation criterion precisely: a theory is scientific to the extent that it is logically incompatible with some possible observation.
- Explain the logical asymmetry between verification and falsification that motivates the criterion.
- Apply the criterion to Popper's own paradigm cases — Einstein's general relativity and the 1919 Eddington eclipse test, contrasted with Popper's examples of Marxist history and psychoanalysis.
- Distinguish "not yet falsified" from "proven true," and "hard to test" from "unfalsifiable."
- Identify unfalsifiable or ad hoc reasoning in everyday technical claims.

## Context & Motivation

Karl Popper developed the falsifiability criterion, as documented in the Stanford Encyclopedia of Philosophy's entry on Popper, as a response to a specific problem: what separates genuine science from claims that merely dress themselves up as science? Popper's answer was not "science makes claims that have been confirmed by evidence" — plenty of pseudo-scientific claims can point to confirming instances — but something sharper: a theory earns the label "scientific" only insofar as it is *falsifiable*, meaning it forbids certain observations from happening. If a theory is compatible with literally any observation you could make — if no experiment, no measurement, no outcome could ever count against it — then the theory says nothing about the world in particular, however impressive-sounding its vocabulary.

The reasoning behind this rests on a logical asymmetry that traces back to Hume's problem of induction: no finite number of confirming observations can ever *prove* a universal claim ("all swans are white," "this data structure always resizes in amortized constant time"), because the very next observation could always be the exception. But a single genuine counter-instance — one black swan, one pathological input that breaks the amortized bound — can conclusively refute it. Confirmation is asymptotic and never complete; refutation, when it happens, is decisive. Popper built his entire criterion on this asymmetry: since a theory can never be verified once and for all, the only thing that meaningfully distinguishes a scientific theory from a non-scientific one is whether it is exposed to that kind of decisive refutation at all.

This concept is the direct payoff of the previous one in this track. Turning a question into a hypothesis produces a specific, checkable claim — but "checkable" and "scientific" are not automatically the same thing until the claim is shown to be genuinely falsifiable, in Popper's precise sense: there must exist some conceivable observation that, if it occurred, would force you to abandon the claim. A claim that survives every possible outcome by design has not yet been checked in any meaningful sense, no matter how much it sounds like a hypothesis.

## Core Theory

### The demarcation criterion, stated precisely

Popper's criterion, as the Stanford Encyclopedia of Philosophy's entry on Popper documents it: a theory is scientific if it is logically incompatible with possible empirical observations, and unscientific if it is compatible with all of them. The test is not "has this been confirmed?" but "could this, even in principle, be shown wrong, and by what?" A scientific theory takes a risk — it forbids something. The more a theory forbids, the more falsifiable, and in Popper's view the more scientific and informative, it is; a theory that forbids nothing is empirically empty regardless of how much apparent explanatory power it seems to have.

### Einstein and the 1919 eclipse: the paradigm case of genuine risk

Popper repeatedly pointed to Einstein's general theory of relativity as the clearest example of a theory behaving exactly as a scientific theory should. General relativity predicted that light passing near a massive body — the sun, specifically — would be deflected by gravity by a small, specific amount, contradicting the Newtonian prediction of no such deflection (or a different, smaller amount under a Newtonian treatment of light as matter). This was, as the Stanford Encyclopedia of Philosophy's entry describes it, a genuinely risky prediction: an improbable-sounding consequence that, if observations had come out otherwise, would have falsified the theory outright. There was no way to reinterpret "starlight bends by roughly the predicted amount near the sun" so that any result whatsoever would count as confirming it.

Arthur Eddington's 1919 solar eclipse expeditions measured the apparent positions of stars near the sun during totality — the only time such faint light is visible against the sun's glare — and found deflections consistent with Einstein's predicted value rather than the Newtonian one. Popper's point was not simply that the theory was confirmed; it was that the theory had been exposed to a test that could have gone the other way, and did not. Popper's own term for what a theory earns by surviving such a test is **corroboration**, deliberately distinct from proof: a well-corroborated theory has withstood serious attempts at refutation and is, provisionally, the best available theory, but it remains exposed to being falsified by some future observation. Corroboration is a report on how a theory has fared so far, not a certificate of permanent truth.

### Marxism and psychoanalysis: Popper's contrast cases

Popper contrasted this directly with theories he considered pseudo-scientific, most prominently certain interpretations of Marxist theories of history and Freudian and Adlerian psychoanalysis. His objection was specific: it was not that these theories had been tested and found false, but that, as actually practiced by their adherents, they seemed capable of explaining *any* observation after the fact. Popper described psychoanalytic theories as effectively irrefutable in this sense — there was, in his assessment, no conceivable human behavior that could not be accommodated by the theory's explanatory apparatus, which meant the theory's apparent explanatory power came at the cost of forbidding nothing. A well-known illustration Popper offered contrasts two opposite actions — a man pushing a child into a river to drown him, and a man sacrificing his own life to save a drowning child — both of which, he observed, could be "explained" within Adlerian theory as expressions of the same underlying inferiority complex. A theory that explains both an action and its exact opposite equally well has not been tested by either outcome.

Popper's assessment of Marxism specifically was more historically nuanced: he held that Marx's original theory of history made genuinely risky, falsifiable predictions — about the trajectory of capitalist economies, for instance — and was scientific in its original form. What changed its status, in Popper's account, was what happened when those predictions failed to materialize: rather than abandoning or revising the theory, later adherents introduced additional explanations to accommodate the discrepancy after the fact, preserving the theory against the falsifying evidence rather than letting the evidence count against it. Popper's complaint was aimed at this move — his phrase for it, per the Stanford Encyclopedia of Philosophy, was that it converted the theory into "reinforced dogmatism" — rather than at the original theory's content.

### A caveat: falsification is not always as clean as it sounds

The Stanford Encyclopedia of Philosophy's entry on science and pseudo-science raises an important complication that later philosophy of science (particularly the Duhem-Quine thesis) sharpened further: no theory is ever tested entirely in isolation. A test of a theory always also relies on auxiliary assumptions — about instruments, background conditions, other accepted theories — and a failed prediction technically falsifies only the *conjunction* of the theory and its auxiliary assumptions, not the theory alone. This does not undo Popper's criterion, but it means "falsifiable in principle" and "cleanly falsified by this one result" are not quite the same thing in practice; distinguishing a theory's own falsity from a broken auxiliary assumption is significant enough to be its own concept later in this track. It is also why the same encyclopedia entry notes a genuine puzzle for Popper's criterion: astrology, one of his go-to examples of pseudo-science, has in fact been rigorously tested and refuted in controlled studies — which makes it falsified, not unfalsifiable, and shows that unfalsifiability alone does not capture everything that makes a claim pseudo-scientific in practice.

## Worked Examples

### Example 1 — the eclipse test, reconstructed

**Claim under test:** general relativity's prediction that light from a distant star, passing close to the sun's limb, would be deflected by an angle attributable to the sun's gravity — a specific, non-zero, non-Newtonian value.

**What would have falsified it:** if Eddington's photographic plates, taken during the 1919 eclipse and compared against reference plates of the same stars taken when the sun was elsewhere in the sky, had shown no measurable deflection, or a deflection matching the (different, smaller) Newtonian figure, the theory's prediction would have failed outright — there was no fallback interpretation under which "no deflection" would still count as consistent with general relativity's specific claim.

**What was observed:** the measured deflections were consistent with Einstein's predicted value rather than a Newtonian one or no effect at all.

**Why this counts as genuine corroboration rather than mere confirmation-seeking:** the theory staked out, in advance of the observation, a specific numerical prediction that differed from the reigning alternative and from the null case. The test had two ways to come out that would have embarrassed the theory, and one way that would have supported it; the fact that the supporting outcome occurred is what makes this an instance of a theory surviving real risk, in exactly the sense Popper's criterion asks for.

### Example 2 — the Adlerian "explanation" of opposite behaviors

**Claim under test (as Popper describes it):** human behavior is driven by attempts to compensate for feelings of inferiority (the Adlerian framework).

**Observation A:** a man pushes a child into a river, intending to drown him.

**"Explanation" offered:** the man felt inferior and this act was an assertion of power to compensate.

**Observation B:** a different man risks his own life to save a drowning child.

**"Explanation" offered:** this man also felt inferior, and the heroic rescue was his way of proving to himself that he was capable of a difficult act.

**Why this fails Popper's criterion:** two directly opposite actions were both accommodated by the same theoretical apparatus, after each occurred, using the same underlying mechanism. There is no observation about either man's behavior that the theory, as applied here, would have treated as inconsistent with it. Because the theory can be stretched to fit any outcome after the fact, no single observed action was ever actually at risk of contradicting it — which is precisely what disqualifies the reasoning here as falsifiable, regardless of how psychologically plausible either individual explanation might sound taken alone.

### Example 3 — a CS claim rendered falsifiable

**Unfalsifiable version:** "This caching layer improves system performance." As stated, almost any outcome can be folded into this claim — if response times improve, the cache is credited; if they don't improve, one can always say the workload "wasn't cache-friendly" or the benefit "shows up under different conditions," without specifying which conditions in advance. Nothing is forbidden, so nothing is genuinely being tested.

**Falsifiable refinement:** "For read-heavy workloads with a cache-hit rate above 80%, adding this caching layer will reduce median response time by at least 15% compared to no caching, measured under otherwise identical load." This version forbids specific outcomes — a hit rate above 80% with no measurable improvement, or with an improvement well under 15%, would refute it outright, with no ambiguity about what would count as a failed test.

## Common Misconceptions & Pitfalls

- **Confusing "not yet falsified" with "proven true."** Popper's corroboration is explicitly not verification — a theory that has survived every test so far, including Einstein's general relativity, remains in principle exposed to future refutation. Treating a well-corroborated hypothesis as permanently settled reverses the logical asymmetry the whole criterion rests on.
- **Confusing "hard to test" with "unfalsifiable."** A claim can be difficult, expensive, or currently impractical to test and still be falsifiable in principle — falsifiability is about whether some conceivable observation could count against the claim, not about how easy that observation currently is to obtain. Popper himself initially misjudged natural selection as untestable and later retracted this, acknowledging it as testable, if difficult.
- **Treating "some evidence supports it" as equivalent to "it's scientific."** Pseudo-scientific claims routinely accumulate apparent confirming instances, as Popper's Adlerian example shows — the issue was never a shortage of supporting anecdotes, it was that no contrary anecdote was possible either.
- **Assuming a single failed test always cleanly falsifies the theory itself.** Because tests depend on auxiliary assumptions (instruments, conditions, other background claims), a failed prediction technically falsifies the theory-plus-assumptions conjunction — untangling which part actually broke is a distinct skill, covered in the next concept in this track.
- **Assuming unfalsifiability is the only thing that makes a claim pseudo-scientific.** As the Stanford Encyclopedia of Philosophy's entry on science and pseudo-science points out, some of Popper's own paradigm pseudo-sciences, astrology among them, have actually been tested and refuted — so being falsified is not the same as never having been falsifiable, and the criterion, however useful, does not by itself settle every disputed case.

## Summary

Popper's demarcation criterion holds that a theory counts as scientific in proportion to how much it forbids: it must be logically incompatible with some conceivable observation, because no finite set of confirmations can ever verify a universal claim while a single genuine counter-instance can refute one. Einstein's general relativity, tested by Eddington's 1919 eclipse observations, is Popper's paradigm case of a theory taking a real, specific risk and surviving it — earning corroboration, not proof. Popper's contrast cases, Marxist history and Adlerian and Freudian psychoanalysis, were criticized not for lacking supporting evidence but for being stretchable to accommodate any observation after the fact, forbidding nothing and thereby explaining nothing in the falsifiable sense. The criterion is powerful but not the whole story: falsification in practice tests a theory together with its auxiliary assumptions, and some of Popper's own paradigm pseudo-sciences turn out to have been falsified rather than unfalsifiable — both of which are reasons to hold the criterion carefully rather than as a mechanical checklist.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Karl Popper](https://plato.stanford.edu/entries/popper/) — doc
- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
