---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define an agent as anything that perceives its environment through sensors and acts upon it through actuators, and give the agent function/agent program distinction.
- Define rationality precisely: choosing, at each instant, the action expected to maximize performance given the percept sequence so far and whatever the agent already knows — not the action that turns out best after the fact.
- Explain why rationality is not omniscience, and why a rational agent can still make a choice that leads to a bad outcome without having been irrational.
- Distinguish a performance measure (defined on the environment, external to the agent) from a value the agent computes internally.
- Explain why this discipline builds directly on the search algorithms (BFS, DFS, Dijkstra, A*) already covered elsewhere in this curriculum, rather than re-deriving them.

## Context & Motivation

Every algorithm covered so far in this curriculum — a sorting routine, a shortest-path search, a parser — takes a fixed input and produces a fixed output, once, and is done. Artificial intelligence, as a field, is organized around a different unit of analysis: an **agent**, something that sits inside an environment, perceives it continuously through sensors, and acts on it continuously through actuators, over and over, often without ever fully knowing the state of the world it is acting in. A thermostat, a chess program, a self-driving car, and a customer-support chatbot are all agents in this sense, however different their internals.

This reframing matters because it changes the central question. A sorting algorithm is judged by whether its output is correct. An agent is judged by whether its *behavior* — the whole sequence of actions it takes over time, in response to a whole sequence of percepts — achieves what its designer wanted, in an environment where the agent typically does not have complete information and cannot foresee every consequence. That is a much harder object to specify precisely, and Russell and Norvig's *Artificial Intelligence: A Modern Approach* opens with exactly this problem: before writing any algorithm, first define what "doing the right thing" even means for an agent that is stuck perceiving and acting inside a world it does not fully control.

This discipline assumes the search techniques already taught elsewhere in this curriculum — breadth-first and depth-first search, Dijkstra's algorithm, A\* pathfinding — as machinery an agent can call on. It does not re-teach any of them. What it adds is the layer above pure graph search: adversarial opponents, constraints between variables, uncertain and partial information, and sequential decisions with delayed reward — the situations where "just find a path" is no longer the whole problem.

## Core Theory

### The agent function and the agent program

Abstractly, an **agent function** maps every possible percept sequence the agent could ever receive to an action. This is a complete, if usually infinite and unwritable, table specifying what the agent does in every conceivable situation. The **agent program** is the concrete, runnable implementation — the actual code — that computes this function (or an approximation of it) as percepts arrive. The distinction matters because it separates the specification of correct behavior from the mechanism that produces it: two very different agent programs (a giant lookup table versus a compact rule-based one) can implement the exact same agent function.

### Rationality: the precise definition

An agent is **rational** if, for each possible percept sequence, it selects an action expected to maximize its performance measure, given the evidence provided by the percept sequence so far and whatever built-in knowledge the agent has. Every clause here is load-bearing:

- **"Expected to maximize"**, not "guaranteed to maximize." Rationality is about the best decision given available information, not about the actual outcome, which may depend on factors the agent cannot perceive or control.
- **"Given the evidence... so far"** — rationality is judged relative to what the agent has actually perceived, not to facts about the world it had no way to know.
- **"And whatever built-in knowledge the agent has"** — an agent is not expected to derive from scratch what it could reasonably be told in advance (e.g., the rules of chess).

### Rationality is not omniscience

A rational agent can still lose. Consider an agent crossing a street who looks both ways, sees no traffic, and steps into the road, only for a truck to run a red light from a blocked sightline a fraction of a second later. The agent's action was rational at the moment it was taken — it used all available percepts correctly — even though the outcome was bad. Demanding that a rational agent never have a bad outcome would demand omniscience, which is a different and generally unachievable property. This distinction is not a technicality; it is the entire reason rationality, not perfection, is the standard used to evaluate every agent design covered in this discipline, including ones that will provably sometimes lose to chance (expectimax) or to imperfect information (a partially observable environment).

### Performance measure vs. internal value

A **performance measure** is an external, objective standard applied to the sequence of environment states an agent's behavior brings about — for a vacuum-cleaning robot, perhaps "amount of dirt cleaned per unit of electricity used," judged by an outside observer over the robot's entire operating lifetime. This is different from any number the agent computes internally (such as a game-tree evaluation function's estimate of a position's value) to *decide* what to do. Conflating the two is a common source of confusing agent design with agent evaluation: the performance measure defines the goal from the environment's perspective; the agent's internal machinery — search, logic, probability, whichever this discipline covers next — is just the means by which the agent tries to act well against that external standard.

### Why this discipline is not "search, again"

BFS, DFS, Dijkstra's algorithm, and A\* — all already covered — solve a single, well-defined class of problem: find a path through a graph, alone, with full information, where the environment does not react to the agent's choices. Most of what makes a task genuinely hard for an intelligent agent lies outside that class: an adversary that reacts, a set of constraints between many variables at once, knowledge that must be represented and reasoned about rather than just searched over, and outcomes that are uncertain rather than deterministic. Each of the topics that follow in this discipline — games, CSPs, logic, probability, sequential decision-making — is a genuine addition to the agent's toolkit for exactly one of these harder situations, not a restatement of search under a new name.

## Worked Examples

### Example 1: The agent function for a two-square vacuum world

Consider a toy environment: two locations, A and B, each either Clean or Dirty, and a vacuum agent that perceives its current location and its cleanliness, and can act `Left`, `Right`, `Suck`, or `NoOp`. A tiny slice of its agent function, written as a table:

```text
Percept: (location, status)         Action
(A, Dirty)                          Suck
(A, Clean)                          Right
(B, Dirty)                          Suck
(B, Clean)                          Left
```

This is the entire agent function for a *single-percept* version of the problem (no memory of the past). Notice it is rational under a natural performance measure ("maximize clean squares over time, minimize movement"): whenever a square is dirty, clean it; whenever it is already clean, move toward the other square in case it needs cleaning. The agent function is a complete specification of behavior; nothing here yet says how it is implemented.

### Example 2: Rational but unlucky

Suppose the vacuum agent above is in square A, perceives Clean, and rationally moves Right toward B. Suppose, unknown to the agent (no percept indicated it), someone had *just* dropped dirt in square A a moment after the agent left. The agent's performance over this episode is worse than if it had stayed — but its decision to move was still rational: given everything it had perceived, moving to check the other square was the best available choice. This is the precise sense in which rationality is judged by the decision process at the time, using available evidence, not by the outcome after the fact.

### Example 3: Classifying performance measures vs. internal values

```text
Statement                                                Classification
--------------------------------------------------------------------------
"Minimize total travel time across all trips this year"  Performance measure
"This board position is worth +3.2 to me"                 Internal value (e.g. a game evaluation function)
"Maximize dirt cleaned per unit of battery used"          Performance measure
"My current belief: 78% chance the opponent has a queen"  Internal value (a probability estimate)
```

The pattern: a performance measure is stated about the *environment's history*, judged externally and after the fact; an internal value is whatever the agent computes, in the moment, to help it decide what to do next. This discipline's later concepts — game-tree values, CSP constraint checks, log-probabilities, Bellman values — are all internal values in this sense, always in service of some performance measure that is never itself part of the algorithm.

## Common Misconceptions & Pitfalls

- **"A rational agent must always win / succeed."** Rationality is about decision quality given available information, not about guaranteed outcomes. A rational agent can lose to bad luck, an adversary's better hidden information, or an environment it cannot fully observe, and still have been rational at every step.
- **"An agent needs to be conscious or human-like to count as intelligent."** The agent definition used throughout AI (and this discipline) is purely functional: percepts in, actions out, judged by a performance measure. A thermostat and a chess engine are both agents under this definition; neither needs anything resembling human cognition.
- **"The agent program and the agent function are the same thing."** The agent function is an abstract specification (in general, an infinite table); the agent program is the concrete, runnable mechanism that computes it. Two very different programs can realize the same function.
- **"AI is just search with extra steps."** Search, already covered, solves one specific problem shape: single-agent, fully known, non-reactive environments. Adversaries, constraints, incomplete knowledge, and uncertainty each require genuinely different machinery, covered concept by concept in the rest of this discipline.

## Summary

An agent perceives its environment through sensors and acts through actuators; the agent function abstractly specifies what it does for every possible percept sequence, and the agent program is the concrete mechanism that computes it. Rationality means choosing, at each step, the action expected to maximize an external performance measure given the evidence perceived so far and whatever prior knowledge the agent has — a standard that explicitly does not require omniscience or guaranteed good outcomes. This discipline builds directly on the search algorithms already covered elsewhere (BFS, DFS, Dijkstra, A\*) as existing machinery, and instead tackles the situations plain graph search cannot: adversaries, constraints, logical knowledge, and uncertainty — starting with the next concept's vocabulary for classifying exactly what makes one task environment harder than another.

## Documentation Links

- [Russell & Norvig — Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html) — the canonical textbook definition of agents, agent functions, and rationality that opens the field.
- [UC Berkeley CS188 — Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/) — course covering the same agent framework as the entry point to search, games, CSPs, and probabilistic reasoning.
