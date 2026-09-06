---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why almost no worthwhile question is being asked for the first time, and why this makes checking prior work a required step, not an optional courtesy.
- Apply Hamming's standard of knowing a field well enough to see what is actually still open, rather than what merely feels unexplored to a newcomer.
- Use Peyton Jones' guidance on situating a question relative to prior work to distinguish a genuinely new angle from an unwitting repetition.
- Identify the specific failure modes of skipping prior work: wasted repetition, an already-answered question, and a "novel" result that already exists under different terms.
- Describe how this concept previews the literature-review step of this curriculum's later, dedicated research module.

## Context & Motivation

Earlier concepts in this discipline treated question-formation and hypothesis-testing largely as if they happened in a vacuum: notice something, refine it, test it, learn from the result, ask the next question. That description is accurate as far as it goes, but it leaves out something almost every real investigation depends on and almost every beginner underrates: by the time you notice something puzzling enough to investigate, there is a very good chance someone else has already noticed it too, investigated it, and written down what they found. Skipping the step of checking this is one of the most common — and most avoidable — ways effort gets wasted in practice.

Richard Hamming's "You and Your Research" makes this point with characteristic bluntness. Hamming's advice was not merely to "do some background reading" as a polite formality before starting real work; his stronger claim was that knowing a field well enough to see what is *actually* still open — as opposed to what merely feels unexplored to someone new to it — is itself a major part of the skill of picking a good problem, a skill this discipline already introduced under "Picking Problems Worth Working On." A newcomer's sense of what's unexplored is built entirely from what they personally haven't yet encountered, which is a poor proxy for what the field as a whole hasn't already resolved. Hamming's point is that closing this gap — actually knowing the terrain — is not busywork standing between you and the real investigation; it is a precondition for the real investigation being aimed anywhere useful.

Simon Peyton Jones' "How to Write a Great Research Paper" approaches the same requirement from the other end: not "how do I avoid wasting my own time" but "how do I situate my work so someone else can tell it's actually contributing something." Peyton Jones is explicit that a paper (and, earlier in the process, a question) needs to be placed relative to what's already known — not to prove novelty for its own sake, but because a reader (or a fellow investigator) cannot evaluate whether a question is worth answering, or whether an answer is actually new, without knowing what it's being compared against. This concept sits at the intersection of those two motivations: reading prior work protects your own effort from being wasted, and it is also what makes your eventual result legible and checkable to anyone else — a theme the next concept in this discipline, on communicating a question and its answer, develops further.

This concept also does a specific piece of structural work for this curriculum: this whole discipline is a small-scale, foundational rehearsal of a cycle that a much later, dedicated module in this track — called simply "research" — will ask students to run for real, at length. That module's own planned structure explicitly includes a "LITERATURE" step, positioned right after the initial question and before a hypothesis is committed to. What you are learning here, at small scale and with modest stakes, is a first pass at exactly that step.

## Core Theory

### Why almost no question is being asked for the first time

The space of things a curious, competent person might wonder about is large, but it is not nearly as large as the number of curious, competent people who have wondered about things over the history of a field. For any question interesting enough to be worth the effort of investigating, there is a real prior probability that someone has already asked a version of it — possibly using different terminology, possibly in a different but related context, possibly as a side observation buried inside an investigation of something else. Treating your own question as presumptively novel, rather than checking, is optimistic in a way that predictably wastes effort when the assumption turns out wrong.

This is not a claim that nothing is ever genuinely new — it plainly is, or no field would progress at all. It is a claim about where the burden of proof should sit: novelty should be a conclusion you reach after checking, not a default assumption you start from.

### Hamming's standard: know the field, not just your corner of it

Hamming's specific formulation is worth taking literally rather than as generic advice to "read more." His claim was that people who did important work typically knew their field deeply enough to have a working sense of its actual open problems — the ones that remained hard even for the people who best understood the existing tools — as opposed to problems that merely felt open to someone standing just outside the field's accumulated knowledge. The difference matters practically: a problem that looks unsolved because you haven't yet found where it was solved is not the same kind of opportunity as a problem that is unsolved because the field's best existing tools genuinely can't crack it yet. Only checking prior work can tell these two apart, and only the second kind is actually worth committing sustained effort to, per the problem-selection standard this discipline already established.

### Peyton Jones' standard: situate the question, don't just assert it

Peyton Jones' guidance is aimed specifically at making a piece of work legible to someone else, and it applies just as well one step earlier, to forming the question itself. His practical recommendation is to be able to state, concretely, what related work exists and how the question at hand relates to it — extends it, contradicts it, applies it to a new setting, or fills a gap it explicitly left open. A question that cannot be situated this way — that can only be described in isolation, with no reference to what's already known about the topic — is a warning sign, not necessarily that the question is bad, but that the checking step hasn't actually been done yet.

### Reading for what's actually open, not just what's been said

Prior work rarely says "this problem is now completely solved and no interesting variant remains" — real results almost always come with limitations, assumptions, and scope boundaries, explicit or implicit. Reading prior work well means reading past the headline claim to find these boundaries: what conditions was this result established under, what did the authors explicitly flag as future work, what does the result assume that might not always hold. This is often exactly where the genuinely open, worth-pursuing version of a question actually lives — not in ignorance of prior work, but in its stated or implied edges.

### A minimal, practical check before committing to a question

This need not become an exhaustive literature survey to be worth doing — that fuller version is precisely what the later, dedicated research module's "LITERATURE" step will ask for, at proper depth. At this discipline's scale, a minimal but genuine version of the same check consists of: searching for the question (or close variants of it) using the field's actual vocabulary, not just your own first phrasing of it; finding at least the most obviously relevant existing treatment if one exists; and, specifically, checking whether that treatment already answers your question, answers a broader question that subsumes it, or explicitly leaves it open. Skipping straight from "I have a sharp, testable hypothesis" to "let me run the experiment" without this check is precisely the gap this concept targets.

## Worked Examples

### Example 1 — a question that already had a well-established answer

**Question, formed without checking prior work:** "Does the order in which you insert elements into a binary search tree affect its resulting height?"

**What a naive approach might do:** Design an experiment, insert elements in several different orders, measure resulting heights, and report the (real, correct) finding that insertion order matters a great deal — sorted or nearly-sorted input produces a badly unbalanced, nearly linear tree, while random or well-shuffled input produces a much shorter tree.

**What checking prior work reveals:** This exact phenomenon is a standard, long-established result in data structures — it's precisely the motivation given for self-balancing tree structures (AVL trees, red-black trees) in essentially any serious treatment of the topic, and it is typically accompanied by a precise characterization (worst case height Θ(n) for a naive BST under sorted input, versus expected height Θ(log n) under random input) that a small from-scratch experiment would only crudely approximate.

**What this changes about the question:** The original question isn't wrong to ask, but asking it as if it were open wastes effort re-deriving a well-known result with less rigor than what already exists. Checking prior work first redirects effort toward the actually interesting, less-settled follow-up: "given that self-balancing trees solve this in the worst case, what is the practical overhead of maintaining balance for workloads where the input happens to already be well-behaved?" — a sharper question that only becomes visible once the settled part is set aside.

### Example 2 — a question that prior work leaves genuinely, explicitly open

**Question:** "Can a particular cache-eviction policy be tuned to perform well for workloads with highly bursty (not steady-rate) access patterns?"

**Checking prior work:** A search turns up substantial existing literature on cache-eviction policies (LRU, LFU, and adaptive variants), most of it evaluated under steady-state or standard-benchmark access patterns, and — importantly — several of these treatments explicitly flag bursty, non-stationary access patterns as outside the scope of their evaluation, or as a noted limitation rather than as an already-answered question.

**What this changes about the question:** Rather than discovering the question is already answered (Example 1's outcome) or discovering it's a well-worn triviality, this check confirms — with actual evidence, not just an assumption of novelty — that the specific question sits in a real, acknowledged gap. It also supplies something else valuable per Peyton Jones' standard: the question can now be *situated* precisely ("existing evaluations of policy X assume steady-rate access; this investigates the same policy under bursty access") rather than asserted in isolation, which makes both the motivation and the eventual result far easier for someone else to evaluate.

**The next step this enables:** Because prior work established the standard evaluation methodology for cache-eviction policies, that methodology can now be adapted (not reinvented) to the bursty-access case — reading prior work here doesn't just avoid wasted effort, it hands over usable tools and a comparison baseline for free.

## Common Misconceptions & Pitfalls

- **"If I can't find prior work on my exact question in five minutes, it must be genuinely novel."** A brief search failing to surface something is weak evidence of novelty — it may just mean the search used the wrong vocabulary, or that the relevant work exists under a related but differently-named question. Hamming's standard requires actually knowing the field, not a quick check that returns no hits.
- **"Reading prior work is about proving my idea is 100% original before I'm allowed to start."** The goal, per Peyton Jones, is to situate the question relative to what's known, not to guarantee total originality — a question that extends, applies, or specializes existing work in a genuine way is a perfectly legitimate and often more tractable question than one aiming for complete novelty.
- **"Once I've found one relevant paper or source, I've done the literature check."** A single source can create a false sense of completeness; the useful check specifically includes looking for what that source itself flags as unresolved or out of scope, since that is often where a genuinely open version of the question is actually hiding, as in Example 2.
- **"This step is only relevant for academic research, not for everyday computational problem-solving."** The binary-search-tree example is a routine engineering question, not an academic one, and checking prior work saved exactly the same kind of wasted effort it would in a research setting — the habit applies at any scale where the question is worth taking seriously enough to test.
- **"Checking prior work is a one-time gate before starting, not something revisited later."** New information discovered mid-investigation (an unexpected result, a term you now know to search for) can and should send you back to check prior work again — the check is not confined to the very first step of the cycle.

## Summary

Almost no question worth investigating is being asked for the first time, which makes checking prior work a required step rather than a courtesy. Hamming's standard demands knowing a field well enough to distinguish a problem that only looks open to a newcomer from one that is genuinely still unresolved by the field's best existing tools; Peyton Jones' standard demands being able to situate a question relative to what's already known, so that both its motivation and its eventual answer are legible to someone else. The two worked examples showed both outcomes checking prior work can produce — discovering a question is already well-answered, and confirming a question sits in a real, acknowledged gap — and both outcomes are useful, because both redirect effort toward the version of the question actually worth pursuing. This concept is also a direct, small-scale preview of the "LITERATURE" step that this curriculum's later, dedicated research module will ask students to carry out for real, at far greater depth.

## Documentation Links

- [Hamming, "You and Your Research" (1986 transcript)](https://www.cs.virginia.edu/~robins/YouAndYourResearch.pdf) — doc
- [Peyton Jones, "How to Write a Great Research Paper"](https://www.microsoft.com/en-us/research/academic-program/write-great-research-paper/) — doc
