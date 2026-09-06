---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why minimax's worst-case assumption is the wrong model for environments involving genuine randomness (dice, shuffled cards) rather than a rational adversary.
- Define a chance node and state the expectimax value rule: the expected value of children, weighted by their probabilities, rather than a min or a max.
- Trace expectimax on a small tree with an explicit probability distribution over chance outcomes.
- Explain why alpha-beta pruning generally does not apply, or applies only in limited forms, to expectimax trees.
- Distinguish "the opponent is random" from "the opponent is suboptimal but still adversarial," and explain why expectimax models the first, not the second, correctly.

## Context & Motivation

Minimax and alpha-beta pruning, covered in the previous two concepts, both assume the same thing about the non-MAX player: it is a perfectly rational adversary that will always choose the outcome worst for MAX. That assumption is exactly right for games like chess or tic-tac-toe, but it is exactly wrong for a large and important class of games that involve genuine chance — backgammon's dice, a card game's shuffle, or any environment where the next state depends on a random event rather than another agent's strategic choice. Treating a die roll as if it were an adversary deliberately trying to hurt you produces systematically wrong decisions: a minimax-based backgammon player would assume the dice are conspiring against it, which is not how dice work.

Expectimax keeps the exact same recursive tree-search skeleton as minimax — the same depth-first traversal, the same alternation between different node types at different levels — and changes only one thing: wherever a node represents a random event rather than a choice by either player, it becomes a **chance node**, whose value is the probability-weighted average of its children rather than a minimum or a maximum. This is a small, surgical change to the algorithm with a real conceptual payoff: it is the first place in this discipline where the actual probabilities of different outcomes, not just their existence, become part of the decision computation itself.

## Core Theory

### Chance nodes and the expectimax value

An **expectimax tree** has three kinds of nodes: MAX nodes (unchanged from minimax — the agent maximizing its own outcome), MIN nodes (used only when there is still a genuinely adversarial opponent present alongside the randomness), and **chance nodes**, representing an event whose outcome is determined by a known probability distribution rather than by any agent's choice.

The value of a chance node is defined as its **expected value**:

```text
value(chance node) = Σ  P(outcome) × value(child for that outcome)
                    over all possible outcomes
```

This is the same expected-value calculation already covered as a core idea in probability — a chance node in a game tree is nothing more than a random variable whose possible values are the values of its children, weighted by how likely each child actually is.

### Why alpha-beta pruning mostly does not carry over

Alpha-beta pruning's correctness relies on a MIN node's guarantee only ever getting *worse* (lower) as more children are explored, letting the algorithm safely conclude "MIN's value here is already low enough that MAX will avoid this branch regardless of what's left." A chance node's expected value does not behave this way: an unexplored child could have an extremely high or low value, and because the final value is a weighted *average*, a single remaining unexplored outcome can still swing the total significantly, even if everything examined so far looks bad (or good). Some pruning is still possible in special cases (for instance, if the value range of remaining outcomes is bounded and the weights are known), but the clean, general pruning guarantee available for minimax does not transfer to chance nodes in the same form. This is a real, structural cost of introducing randomness — not a minor implementation detail.

### Random opponent vs. suboptimal opponent: a critical distinction

Expectimax correctly models an opponent whose behavior is governed by **known, fixed probabilities** — a die that lands on each face with probability 1/6, a shuffled deck. It does **not** correctly model an opponent who is simply a *weaker or non-optimal strategic player* but is still actively trying to win. A weak chess opponent is not equivalent to a random-move generator: a weak opponent still usually plays reasonably and occasionally blunders in specific, exploitable ways, which is a very different probability distribution over moves than "uniformly at random," and treating a weak adversary as literally random both overestimates how often they will make a truly terrible move and underestimates the value of specifically provoking the kinds of mistakes they are prone to. Expectimax is the right tool exactly when the source of uncertainty is genuinely mechanical chance (dice, shuffles, noisy sensors), not when it is merely "an opponent I believe plays worse than optimally."

### Evaluation functions apply the same way here as in minimax

Just as with minimax, a full expectimax tree for a real game (backgammon, for instance) is far too large to expand to terminal states. The same practical compromise applies: search to a bounded depth and use a heuristic evaluation function to estimate the value of non-terminal nodes at the cutoff, exactly as a depth-limited minimax search would. Nothing about introducing chance nodes changes this need — it is orthogonal to whether the remaining structure is deterministic or stochastic.

## Worked Examples

### Example 1: expected value at a chance node

Consider a simplified dice game where, after MAX's move, a fair six-sided die determines which of two possible follow-up positions is reached: rolling 1–3 leads to a position worth 4 to MAX, rolling 4–6 leads to a position worth 10.

```text
Chance node children:
  Outcome "1-3" (probability 3/6 = 0.5): value 4
  Outcome "4-6" (probability 3/6 = 0.5): value 10

Expected value = 0.5 × 4 + 0.5 × 10 = 2 + 5 = 7
```

The chance node's value, 7, is neither the minimum (4) nor the maximum (10) of its children — it is exactly the weighted average a die roll would actually produce on repeated play. Neither minimax's min nor max operation would be the correct combination rule here.

### Example 2: a small expectimax tree, MAX choosing between two chance branches

```text
                     MAX (root)
                    /           \
              Chance A         Chance B
              /      \         /      \
            0.5      0.5     0.3      0.7
            (2)      (14)    (6)      (6)

Chance A's value = 0.5×2 + 0.5×14 = 1 + 7 = 8
Chance B's value = 0.3×6 + 0.7×6 = 6            (both outcomes have the same value here)

Root: max(8, 6) = 8 → MAX should choose branch A
```

Compare this against minimax's treatment of a similar-looking tree: if these had been MIN nodes instead of chance nodes, MIN would send MAX to whichever child is worst — Branch A's worst case (2) is far below Branch B's guaranteed 6, so a (wrong, for this game) minimax analysis would favor Branch B. Expectimax correctly recognizes that Branch A's *average* outcome (8) is actually better, because the bad outcome (2) only happens half the time and the good outcome (14) happens the other half — exactly the calculation that matters when the uncertainty is genuine chance rather than a hostile, optimizing opponent.

### Example 3: why treating chance as adversarial gives the wrong decision

Reusing Example 2's numbers, suppose an agent designer mistakenly modeled the dice outcomes as MIN nodes instead of chance nodes:

```text
(Incorrect) minimax treatment:
  "MIN" A: min(2, 14) = 2
  "MIN" B: min(6, 6)  = 6
  Root: max(2, 6) = 6 → chooses Branch B

(Correct) expectimax treatment:
  Chance A: 0.5×2 + 0.5×14 = 8
  Chance B: 6
  Root: max(8, 6) = 8 → chooses Branch A
```

The two models disagree on which branch is actually better, and the expectimax answer is the one that matches what would actually happen on average across many repetitions of this random event. This is the concrete cost of using the wrong model for uncertainty: not a small numerical error, but a different, worse decision.

## Common Misconceptions & Pitfalls

- **"Expectimax always makes better decisions than minimax."** Neither algorithm is universally better; each is correct for a different kind of uncertainty. Using expectimax against a truly adversarial opponent (assuming they play "on average" rather than optimally against you) can be exploited badly, just as using minimax against genuine randomness produces overly pessimistic, wrong decisions.
- **"A weak or beatable opponent can be modeled as a chance node."** A suboptimal-but-still-trying opponent has a probability distribution over moves that depends on the position and on that opponent's specific weaknesses — it is not the same as a fixed, known, position-independent distribution like a fair die, and modeling it as if it were misses opportunities to specifically provoke that opponent's known mistakes.
- **"Alpha-beta pruning works the same way on expectimax trees."** The clean pruning guarantee from minimax relies on a strict min/max at every internal node; a chance node's expected value is an average that a single unexplored child can still swing substantially, so the same unconditional pruning rule does not generally apply.
- **"Expectimax needs to know the exact probabilities to be useful at all."** In practice, the probabilities used (die faces, card odds) are usually exactly known from the rules of the game itself, which is precisely why expectimax is the standard, not merely an approximation of last resort, for games with well-defined randomness like backgammon or many card games.

## Summary

Expectimax adapts minimax's exact recursive tree-search skeleton to environments with genuine randomness by introducing chance nodes, whose value is the probability-weighted expected value of their children rather than a strict minimum or maximum — the correct model when uncertainty comes from known, fixed-probability mechanics (dice, shuffled cards) rather than from another agent's strategic choice. This correctly distinguishes "the next state is random" from "the next state is chosen by an adversary," a distinction minimax's worst-case assumption gets wrong, at the real cost that alpha-beta pruning's clean guarantees mostly do not transfer to chance nodes. Adversarial search — minimax, alpha-beta, and expectimax together — closes out this discipline's answer to multi-agent, deterministic-or-stochastic, sequential environments; the next three concepts turn to a completely different environment shape: single-agent problems whose difficulty comes not from an opponent, but from many interacting constraints between variables.

## Documentation Links

- [UC Berkeley CS188 — Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/) — course covering expectimax as the direct generalization of minimax to stochastic games.
- [Russell & Norvig — Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html) — the canonical treatment of chance nodes and games with an element of chance, such as backgammon.
