---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

An algorithm is an ordered sequence of unambiguous steps that transforms a starting situation into a desired result in a finite number of steps. Problem decomposition is the practice of arriving at that sequence *before* worrying about how to type it in a specific language — Stanford's CS106A famously teaches this with Karel, a robot that only understands `move()`, `turnLeft()`, `pickBeeper()`, and a handful of other commands, precisely so students plan the steps without the distraction of real syntax. The goal of this concept is to practice that same separation: think in steps and conditions first, worry about Python's exact keywords later.

## Use Cases

- Planning a robot's or game character's path through a grid before writing any movement code.
- Turning a vague task ("organize these files") into a concrete, ordered checklist a person — or a machine — could execute without asking a clarifying question.
- Spotting which steps must happen in order and which could happen in any order, before those constraints get baked into real code.
- Catching an ambiguous or missing step ("what if the wall is already there?") on paper, where it's cheap to fix, instead of in a debugger.

## Deep Dive

### A toy robot on a grid

Imagine a robot on a grid of streets and avenues, facing East, that can only do four things: move forward one square, turn left 90°, pick up a "beeper" token if one is on its current square, and check whether a wall blocks the square ahead. The task: walk to the nearest wall and place a beeper against it.

Decomposed into pseudocode, with no real programming language yet:

```
repeat until wall is directly ahead:
    move forward one square
put down a beeper
```

This is already an algorithm — precise, ordered, and finite — even though it isn't Python. Decomposition means noticing the plan has exactly one repeated action ("move forward") guarded by exactly one condition ("wall ahead"), and one final action that only happens once. Writing it this way, before touching real code, forces you to answer questions a compiler would otherwise force on you anyway: what happens if the robot starts already facing a wall? (The loop body never runs, and it places the beeper immediately — which is correct.)

Only once the plan is settled does translating it become close to mechanical:

```python
while not wall_ahead():
    move_forward()
put_down_beeper()
```

### Ordering and dependency

Decomposition also means noticing which steps *must* come before others. "Turn to face North, then move forward" only works in that order — reversing it moves the robot in the wrong direction. Spotting this kind of ordering dependency on paper, as a numbered list, catches the bug before a single line of code exists:

```
1. turn_left()      # now facing North
2. move_forward()   # moves North, not East
```

## Trade-offs

- **A precise plan takes longer up front than "just start typing"** — but an ambiguous step ("move toward the wall") discovered while debugging real code costs far more time than discovering it on paper, where fixing it is a one-line edit to a numbered list.
- **Toy environments like a grid-robot hide real-world messiness (multiple robots, sensors, timing)** — the discipline transfers, but a plan that only works in a clean toy world may need rework once real constraints (concurrency, sensor noise) show up later in the curriculum.
- **Over-specifying a plan (writing out every possible edge case in prose) can be as unproductive as under-specifying it** — the aim is a plan precise enough to be unambiguous, not one so exhaustive it takes longer to read than to just write the code and test it.

## Documentation Links

- [Wing, "Computational Thinking" — Communications of the ACM (2006)](https://dl.acm.org/doi/10.1145/1118178.1118215) — doc
- [Stanford CS106A — Course Schedule](https://web.stanford.edu/class/cs106a/schedule) — doc
