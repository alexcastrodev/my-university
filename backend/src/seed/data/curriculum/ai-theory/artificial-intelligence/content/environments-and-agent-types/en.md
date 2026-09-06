---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Use the PEAS framework (Performance, Environment, Actuators, Sensors) to specify a task environment precisely enough to design an agent for it.
- Classify a task environment along each of its defining dimensions: fully vs. partially observable, deterministic vs. stochastic, episodic vs. sequential, static vs. dynamic, discrete vs. continuous, single-agent vs. multi-agent.
- Explain why each dimension changes what kind of agent design is even possible, not just how hard the problem is.
- Describe the four-level hierarchy of agent designs — simple reflex, model-based reflex, goal-based, utility-based — and what capability each level adds over the one before it.
- Identify which environment properties this discipline's later concepts (games, CSPs, logic, Bayesian networks, MDPs) are specifically built to handle.

## Context & Motivation

The previous concept defined what an agent and rationality are in the abstract. But rationality is always rationality *relative to a task environment* — the specific world the agent is dropped into, together with what it is trying to achieve there. Before an agent designer can pick an approach (search? logic? probability?), the task environment itself has to be pinned down precisely, because different environments make entirely different techniques appropriate, or even possible. A chess-playing agent and a self-driving car are both "agents," but nothing about the games-and-adversarial-search machinery this discipline covers next would make sense applied to driving, and nothing about a probabilistic sensor model would help at all with chess.

The PEAS framework and the dimensional classification introduced in this concept give a shared vocabulary for that upfront analysis. This is not busywork before the "real" content starts — CS188 and *Artificial Intelligence: A Modern Approach* both open with exactly this classification because every subsequent technique in the field is, in effect, an answer to one specific combination of these properties. Adversarial search answers "what if the environment contains another agent working against me?" CSPs answer "what if my choices are interconnected by constraints?" Bayesian networks answer "what if I only partially observe the state?" Markov decision processes answer "what if my actions have stochastic effects and I care about the future, not just the next step?" Naming a task's properties correctly is most of the work of choosing the right tool.

## Core Theory

### PEAS: specifying a task environment

**PEAS** stands for **Performance** measure, **Environment**, **Actuators**, and **Sensors** — the four things that must be nailed down before "build an agent for this" is even a well-posed request.

```text
Example: an automated taxi
Performance measure: safety, speed, legality, passenger comfort, profit
Environment:          roads, other traffic, pedestrians, weather, customers
Actuators:             steering, accelerator, brake, signal, horn, display
Sensors:               cameras, lidar, speedometer, GPS, engine sensors
```

Two designers given only "build a self-driving car" could build wildly different, equally defensible systems; PEAS forces the disagreement about goals and constraints out into the open before any algorithm is chosen.

### The dimensions that classify a task environment

- **Fully observable vs. partially observable.** Fully observable means the agent's sensors give it complete access to the state relevant to its decision at every instant (a chess board, viewed entirely). Partially observable means some relevant state is hidden (a taxi cannot see around a blind corner; a card player cannot see the other hands). This dimension alone determines whether the agent needs any account of belief or probability at all.
- **Deterministic vs. stochastic.** Deterministic means the next state is completely determined by the current state and the agent's action (in a vacuum world with no other actors). Stochastic means there is genuine randomness or an unpredictable adversary (dice, an opponent's hidden strategy, sensor noise). This is exactly the line between plain minimax and expectimax, covered next.
- **Episodic vs. sequential.** In an episodic environment, each "episode" (perceive, then act) is independent of every other — classifying a single image does not depend on which image was classified before. In a sequential environment, the current decision can affect all future decisions (a chess move constrains every later position; an MDP's whole point is that actions have long-range consequences).
- **Static vs. dynamic.** A static environment does not change while the agent is deliberating (the environment "waits" for you); a dynamic environment can change mid-decision (real-time driving, where the world moves regardless of how long the agent thinks).
- **Discrete vs. continuous.** Discrete environments have a countable, often finite, set of distinct states, percepts, and actions (chess, a CSP over finite domains); continuous environments have states or actions that vary smoothly (steering angle, speed).
- **Single-agent vs. multi-agent.** Single-agent environments contain only the agent itself acting against a passive world (a Sudoku puzzle); multi-agent environments contain other agents whose goals may align, conflict, or be unknown (a chess opponent is a competitive multi-agent case; adversarial search, covered next, is built entirely for this dimension).

### The four-level hierarchy of agent designs

- **Simple reflex agents** act only on the current percept, via condition-action rules ("if dirty, then suck"), with no memory of the past. They work only in fully observable environments where the correct action truly depends on nothing else.
- **Model-based reflex agents** maintain an internal state that tracks aspects of the world not currently visible, updated as new percepts arrive — the minimum machinery needed in any partially observable environment.
- **Goal-based agents** additionally reason about the future: given a model of how actions change the world, they search or plan for a sequence of actions that reaches an explicit goal, rather than reacting rule by rule. This is exactly where the search algorithms already covered (BFS, DFS, A\*) plug in as the mechanism a goal-based agent uses.
- **Utility-based agents** go one step further than "reach some goal state" by ranking states with a utility function, allowing the agent to trade off competing, partially conflicting objectives (speed vs. safety vs. fuel) and to act sensibly even when no single crisp goal captures what "success" means. Every technique from expectimax onward in this discipline assumes a utility-based agent.

### Mapping this discipline's later concepts onto these dimensions

```text
Concept (this discipline)          Environment properties it targets
----------------------------------------------------------------------
Minimax / alpha-beta                Multi-agent, deterministic, adversarial
Expectimax                          Multi-agent or stochastic, chance nodes
CSPs                                Single-agent, static, discrete, structured by constraints
Logic (propositional/FOL)           Fully observable, deterministic, discrete
Bayesian networks                   Partially observable, stochastic
Hidden Markov Models                Partially observable, sequential, stochastic
MDPs / value iteration              Sequential, stochastic, utility-based
```

No single technique covered in this discipline is meant to handle every dimension at once; each is a deliberate specialization to one corner of this classification.

## Worked Examples

### Example 1: PEAS and dimensions for a chess-playing agent

```text
PEAS:
  Performance: win the game, ideally quickly and decisively
  Environment: the chessboard and the opponent's moves
  Actuators:   moving a piece
  Sensors:     the current board position

Dimensions:
  Fully observable   — the entire board is visible to both players at all times
  Deterministic       — no randomness; each move's result is fully determined
  Sequential           — every move constrains and is constrained by future moves
  Static (per turn)   — the board does not change while a player is thinking
  Discrete             — finitely many squares, pieces, and legal moves
  Multi-agent          — an adversary with an opposing goal
```

This exact combination — fully observable, deterministic, sequential, multi-agent — is precisely the environment minimax and alpha-beta pruning (the next two concepts) are built for. Chess is, in this framework, the textbook case for adversarial search specifically because it has no hidden information and no randomness to complicate the picture.

### Example 2: PEAS and dimensions for a poker-playing agent

```text
PEAS:
  Performance: maximize winnings over many hands
  Environment: the table, the deck, opponents' visible actions
  Actuators:   bet, call, raise, fold
  Sensors:     own cards, community cards, opponents' bets

Dimensions:
  Partially observable — opponents' hole cards are hidden
  Stochastic            — the deck is shuffled randomly
  Sequential             — earlier bets affect later strategy and information
  Discrete               — finitely many cards, bets, and actions
  Multi-agent             — competitive, with hidden and possibly deceptive opponents
```

Compare this directly against chess: the deterministic/fully-observable pair is what let plain minimax work at all. Poker's partial observability and stochasticity are exactly why it needs the probabilistic machinery (Bayesian reasoning about hidden hands) that chess simply does not, and why "just do minimax, but for poker" is not a sufficient answer.

### Example 3: classifying an email spam filter

```text
PEAS:
  Performance: correctly classify emails as spam or not spam
  Environment: an email inbox, one message at a time
  Actuators:   label as spam / not spam
  Sensors:     the email's text, sender, headers

Dimensions:
  Fully observable — the email's full content is available at classification time
  Deterministic     — the same email always has the same "true" label
  Episodic           — classifying one email does not depend on classifying the previous one
  Discrete           — a finite (if huge) vocabulary and a binary decision
  Single-agent       — no adversary reacting to the classifier in real time (in the basic formulation)
```

Notice this is episodic, unlike chess or poker — nothing about classifying today's email depends on yesterday's classification. This is exactly the dimension that determines whether an agent needs any of the sequential machinery (search, planning, MDPs) covered later in this discipline, or whether a simpler per-instance decision procedure suffices.

## Common Misconceptions & Pitfalls

- **"Partially observable just means 'harder,' not fundamentally different."** Partial observability is a qualitative, not merely quantitative, difference: it requires maintaining a belief state (a probability distribution over possible true states) rather than acting on the true state directly, which is precisely what Bayesian networks and HMMs, covered later, are built to represent and update.
- **"Stochastic and adversarial are the same kind of uncertainty."** A stochastic environment (like dice) has known, fixed probabilities the agent can reason about with expectimax; an adversarial environment has another rational agent actively trying to hurt you, reasoned about with minimax's worst-case assumption. Treating an adversary as if it were a random dice roll systematically underestimates how badly a skilled opponent can exploit a mistake.
- **"A goal-based agent is strictly better than a reflex agent."** Goal-based reasoning (search/planning) costs more computation than a reflex rule; in a genuinely simple, fully observable, static environment, a well-designed reflex agent can be both correct and dramatically cheaper. The hierarchy is about capability, not universal superiority.
- **"Episodic just means 'short.'** Episodic refers to whether one decision's outcome is independent of the next, not to how much time elapses. A single, very long deliberation over one isolated image classification is still episodic; a sequence of very short chess moves is still sequential, because each one constrains the next.

## Summary

PEAS (Performance, Environment, Actuators, Sensors) is the framework for specifying a task environment precisely; six dimensions — observability, determinism, episodic/sequential, static/dynamic, discrete/continuous, and single-/multi-agent — classify how hard and what kind of hard that environment actually is, and the four-level agent hierarchy (simple reflex, model-based reflex, goal-based, utility-based) escalates the agent's internal machinery to match. Every technique this discipline covers from here forward is a deliberate answer to one specific point in this classification: adversarial search for multi-agent deterministic games, CSPs for structured single-agent problems, logic for fully observable deterministic knowledge, Bayesian networks and HMMs for partial observability and stochasticity, and MDPs for sequential decisions under uncertainty. The next concept starts with the multi-agent, deterministic, sequential case — adversarial games — because it is the closest in spirit to the search algorithms already covered, changing only one assumption: another rational agent is now working against you.

## Documentation Links

- [Russell & Norvig — Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html) — the canonical source for PEAS and the task-environment dimensions used throughout the field.
- [UC Berkeley CS188 — Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/) — course using this exact classification to motivate the sequence of techniques (search, games, CSPs, probability, MDPs) that follow it.
