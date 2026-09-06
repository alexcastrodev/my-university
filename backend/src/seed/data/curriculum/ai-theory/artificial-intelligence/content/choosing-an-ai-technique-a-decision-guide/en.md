---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Recall, in one pass, every technique covered in this discipline and the specific task-environment shape (from the second concept's classification) each one targets.
- Apply the right technique to a newly described problem by identifying its task-environment properties first, before reaching for an algorithm.
- Compare adversarial search, CSPs, logic, Bayesian networks, and MDPs directly, in a single table, on the specific problem shape each is built for.
- Explain, explicitly and honestly, what this discipline does NOT cover, and which later disciplines in this curriculum's `ai-theory` module are responsible for that material instead.
- Trace, end to end, a single realistic scenario that plausibly calls on several of this discipline's techniques together, showing how they compose rather than compete.

## Context & Motivation

This discipline opened by defining an intelligent agent and classifying task environments along six dimensions — observability, determinism, episodic/sequential structure, static/dynamic, discrete/continuous, single-/multi-agent — and promised that every subsequent technique would be a deliberate, well-motivated answer to one specific combination of those properties. Having now covered adversarial search, constraint satisfaction, logic and planning, Bayesian reasoning and hidden Markov models, and Markov decision processes, this capstone closes the loop: it is not a re-teaching of any of these techniques, but an explicit map of when each one is the right tool, and — just as important — an honest accounting of where this discipline's coverage stops and the next disciplines in this curriculum's `ai-theory` module pick up.

The single biggest practical skill this capstone is meant to reinforce is not "know every algorithm," but "correctly diagnose the shape of a new problem before reaching for any algorithm at all" — precisely the diagnostic exercise the second concept's PEAS-and-dimensions framework was introduced to enable.

## Core Theory

### The full map: technique to task-environment shape

```text
Technique                Task-environment shape it targets
--------------------------------------------------------------------------
Minimax / alpha-beta      Multi-agent, deterministic, fully observable,
                          zero-sum, adversarial
Expectimax                Multi-agent or single-agent with genuine chance
                          (known probabilities, not a strategic adversary)
CSPs (backtracking,       Single-agent, static, discrete, structured by
  forward checking, AC-3) explicit constraints between variables
Propositional/first-order Fully observable, deterministic, discrete
  logic, resolution       knowledge that must be represented and queried
Classical planning        Same as logic, but the question is "what
  (STRIPS)                 sequence of actions reaches a goal," not "what
                            is true right now"
Bayesian networks         Partially observable, static (single time slice),
                          uncertain — reasoning about hidden causes from
                          observed effects
Hidden Markov models      Partially observable, sequential, uncertain — the
  (filtering)              same reasoning as Bayesian networks, extended
                            across time
MDPs (value/policy        Sequential, stochastic, utility-based — an agent
  iteration)                choosing actions now to optimize a reward
                            accumulated over many future steps
```

No single technique in this list is a general-purpose replacement for the others; each is the right answer to a genuinely different combination of the task-environment dimensions from the second concept, and misapplying one to the wrong shape of problem (treating a genuine adversary as random chance, or ignoring partial observability and reasoning as if the true state were fully known) produces concretely wrong decisions, not merely suboptimal ones — exactly as demonstrated in this discipline's own worked examples (the expectimax-vs-minimax mismatch, the money-pump consequence of ignoring proper decision theory).

### What this discipline does NOT cover, and where it goes instead

Three deliberate boundaries, each already signposted at the relevant point earlier in this discipline, are worth stating together, in one place, now that the whole picture is visible:

- **Reinforcement learning** — an agent that does not already know the MDP's transition model or reward function, and must learn a policy from experience by trial and error — is a direct extension of the MDP material just covered, but genuinely different in what is known upfront versus learned from interaction. This belongs to `ai-theory/machine-learning`, a sibling discipline in this same module, not yet written.
- **Learning-based approaches generally** (estimating a model, a value function, or a policy from data rather than being handed one) — including everything from simple statistical learning through deep neural networks — is the subject matter of `ai-theory/machine-learning` and `ai-theory/deep-learning`, both still-empty sibling disciplines. Everything in this discipline assumed the relevant model (game rules, CSP constraints, a knowledge base, a Bayesian network's CPTs, an MDP's transition and reward functions) was already fully specified and handed to the agent.
- **Modern large-scale, learned approaches to search, planning, and reasoning** (learned heuristics, neural game-playing, learned world models) are downstream extensions of exactly the classical techniques covered here, and are addressed, where this curriculum reaches them at all, within `machine-learning`/`deep-learning`, not retroactively folded into this discipline's already-complete scope.

### Techniques compose — they are not mutually exclusive

A realistic intelligent system rarely uses just one of these techniques in isolation. A single real agent might use Bayesian inference to maintain a belief about a partially observed world, an MDP (built on top of that belief) to decide what to do next, and — if that world happens to include another competing agent — adversarial search layered on top of all of it. None of this discipline's techniques were built to be used alone in every context; they are more like a toolbox where different tools are combined for different parts of a single larger problem, exactly the way this discipline's own worked examples cross-referenced algorithms and data structures already covered elsewhere in this curriculum rather than treating AI as an isolated subject.

## Worked Examples

### Example 1: diagnosing a new problem's task-environment shape before picking a technique

```text
Problem: "An autonomous drone needs to deliver packages across a city with
unpredictable wind gusts (known statistical patterns), while also avoiding
a small number of other delivery drones from a competing company that may
adjust routes to intercept preferred flight paths."

Diagnosis:
  - Wind gusts: stochastic, but NOT adversarial — known probability
    distribution, no strategic intent → this part calls for something in
    the expectimax/MDP family, not minimax.
  - Competing drones: potentially adversarial (if genuinely trying to
    interfere) → this part may call for adversarial-search-style reasoning
    layered on top.
  - Partial observability: if the drone can't fully sense the competing
    drones' exact positions/intentions at all times → a Bayesian-network-
    or HMM-style belief-tracking layer is needed underneath everything else.

Recommended composition: HMM-style belief tracking over the uncertain
  parts of the world (competitor positions, wind), feeding into an MDP
  (or adversarial variant of one) that selects actions to maximize expected
  utility — not any single technique used alone.
```

### Example 2: a CSP problem misdiagnosed as adversarial search (and why that would be wrong)

```text
Problem: "Assign each of 30 employees to one of 5 shifts, respecting
each employee's stated availability and ensuring no shift is understaffed."

Common misdiagnosis: "there are competing preferences among employees, so
  this needs adversarial search (minimax) between employees' interests."

Correct diagnosis: this is single-agent (a single central scheduler makes
  all the assignments), static, discrete, and defined entirely by
  constraints between variables (each employee's availability, each
  shift's staffing requirement) — the textbook shape of a CSP, not an
  adversarial game. Nobody in this problem is a rational adversary
  choosing moves specifically to minimize the scheduler's outcome;
  every employee's "preference" is simply a constraint (or a soft
  preference to be optimized) on the scheduler's own single decision.

Misapplying minimax here would search over a "game tree" that does not
  actually correspond to anything in the problem (there is no genuine
  adversarial turn-taking), while a CSP formulation (variables = employees,
  domains = shifts, constraints = availability/staffing) maps directly and
  correctly onto backtracking search with forward checking and arc
  consistency, exactly as covered earlier in this discipline.
```

### Example 3: a capstone-scale comparison table for four different described scenarios

```text
Scenario                                    Best-fit technique(s)
--------------------------------------------------------------------------
"Two players alternate moves, full info,    Minimax / alpha-beta pruning
 no randomness, competitive"
"Assign colors/times/slots subject to a     CSP: backtracking + forward
 fixed set of pairwise restrictions"        checking + arc consistency
"Derive what necessarily follows from a     Propositional/FOL + resolution,
 fixed set of known facts and rules"        or STRIPS if the goal is a
                                              sequence of actions
"Infer a hidden cause from noisy, partial   Bayesian network (single
 observations, at one point in time"        snapshot) or HMM (if this
                                              repeats over time)
"Choose actions now to maximize reward      MDP: value iteration or
 accumulated over a long, uncertain          policy iteration
 future, when the model is already known"
```

This table is a deliberately compact summary of the same diagnostic process worked through in Examples 1 and 2 — always starting from the actual shape of the problem (observability, determinism, adversarial or not, sequential or not), never from "which algorithm do I already know."

## Common Misconceptions & Pitfalls

- **"There is one single 'AI algorithm' that should be tried first on any new problem."** As this entire discipline has shown, the right technique depends entirely on the task environment's actual properties; misapplying adversarial search to a non-adversarial CSP (Example 2), or expectimax to a genuinely adversarial opponent, produces concretely wrong decisions, not merely a slower path to the right answer.
- **"Machine learning is a more advanced replacement for everything covered in this discipline."** Machine learning (covered in this module's later, still-unwritten disciplines) is a way to *estimate* the models — transition probabilities, reward functions, CPTs, evaluation functions — this discipline assumed were already fully known and handed to the agent; it does not replace the decision-making frameworks (minimax, CSPs, Bayesian inference, MDPs) themselves, which remain exactly as relevant once a model has been learned as when it was hand-specified.
- **"Techniques covered in this discipline must be used one at a time, never combined."** As Example 1 shows, realistic systems routinely layer these techniques — belief tracking feeding a decision procedure, a decision procedure adapting to a detected adversary — and recognizing when a real problem needs more than one of this discipline's tools together is itself part of the diagnostic skill this capstone is meant to reinforce.
- **"This discipline covers everything meaningful in artificial intelligence."** It deliberately does not — reinforcement learning and every learning-based technique are explicitly out of scope here, reserved for `machine-learning` and `deep-learning`, precisely so this discipline could go deep on the classical, model-given decision-making toolkit without either skipping it or trying to cram a fundamentally different topic (learning from data) into the same 80 hours.

## Summary

This discipline's techniques — adversarial search, constraint satisfaction, logic and planning, Bayesian networks and hidden Markov models, and Markov decision processes — each answer a distinct, precisely characterized combination of the task-environment dimensions introduced at the very start (observability, determinism, adversarial structure, sequential structure), and diagnosing a new problem's actual shape, before reaching for any specific algorithm, is the single most transferable skill this discipline aims to leave behind. Real systems typically compose several of these techniques together rather than relying on just one, and this discipline deliberately stops short of reinforcement learning and every learning-based technique for estimating a model from data — that material belongs to `machine-learning` and `deep-learning`, the sibling disciplines that continue this curriculum's `ai-theory` module from exactly the point this one leaves off: models fully known and handed to the agent, versus models that must be learned.

## Documentation Links

- [UC Berkeley CS188 — Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/) — course whose overall structure (search, games, CSPs, logic, Bayesian reasoning, MDPs, then machine learning) this discipline's scope and sequencing directly follows.
- [ACM/IEEE CS2013 — AI and the Intelligent Systems Knowledge Area](https://dl.acm.org/doi/abs/10.1145/2735392.2735394) — curriculum-guideline source confirming Intelligent Systems as its own distinct knowledge area within the broader computer science curriculum.
