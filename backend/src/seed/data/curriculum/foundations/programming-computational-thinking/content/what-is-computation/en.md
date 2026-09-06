---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Computational thinking is a way of formulating problems and their solutions so that a computer — human or machine — can carry them out. It is not "thinking like a computer" and it is not synonymous with programming; Jeannette Wing's influential 2006 paper frames it as a fundamental skill for everyone, "not just computer scientists," built on four habits of mind: **decomposition** (breaking a problem into smaller pieces), **pattern recognition** (noticing similarities between problems or within a problem), **abstraction** (deciding which details matter and which can be ignored), and **algorithm design** (writing a precise, step-by-step procedure to solve it). This discipline exists to build those four habits before syntax gets in the way; everything that follows — variables, loops, functions, recursion — is a tool for expressing computational thinking, not the thinking itself.

## Use Cases

- Planning a multi-step task (a recipe, a travel itinerary, a tax form) as an ordered procedure before executing any of it.
- Recognizing that two seemingly different problems (sorting a hand of cards, sorting a list of names) share the same underlying pattern.
- Deciding what information a solution actually needs, and discarding the rest, before designing it.
- Explaining *why* a program should work, independent of the specific language it will eventually be written in.
- Evaluating whether a proposed procedure is precise enough that someone else — or a machine — could follow it without guessing.

## Deep Dive

### The four pillars, applied to one problem

Take a problem that has nothing to do with code yet: "find the largest number in a pile of index cards, each with one number written on it."

- **Decomposition** — split it into: (1) look at the first card, remember it as the largest-so-far; (2) look at each remaining card one at a time; (3) compare it to the largest-so-far; (4) after the last card, report the largest-so-far.
- **Pattern recognition** — this is the same shape as "find the tallest person in a room" or "find the highest score in a game." Once you see the pattern, you can reuse the procedure for any of them.
- **Abstraction** — the procedure doesn't care what the numbers *represent* (ages, prices, temperatures) or how many cards there are. Those details are irrelevant to the solution; only "a sequence of comparable values" matters.
- **Algorithm design** — writing the four numbered steps above precisely enough that a person who has never seen the pile could execute them and get the right answer, every time, including on edge cases like a pile of exactly one card.

Only *after* this thinking is settled does it make sense to write it in a language:

```python
largest = None
for card in pile:
    if largest is None or card > largest:
        largest = card
print(largest)
```

Notice the code is a direct transcription of the four numbered steps — nothing new was invented at the syntax level. That ordering (think, then transcribe) is the discipline this whole track is built around.

## Trade-offs

- **Computational thinking is a mental discipline, not a substitute for learning a language** — you still need to learn Python's actual rules to turn a correct procedure into a correct program; thinking clearly about the problem reduces bugs, but it does not eliminate the need for syntax.
- **Over-abstracting too early can hide details that turn out to matter** — deciding "the pile size doesn't matter" is fine for finding a maximum, but would be wrong for a problem where an empty pile needs special handling; abstraction is a judgment call, not a rule to apply blindly.
- **Pattern recognition can mislead if the "same" pattern isn't actually the same** — treating "find the largest" and "find the most frequent" as the same procedure would produce a working-looking but wrong solution, since frequency requires counting, not just comparing.

## Documentation Links

- [Wing, "Computational Thinking" — Communications of the ACM (2006)](https://dl.acm.org/doi/10.1145/1118178.1118215) — doc
- [ISTE/CSTA Operational Definition of Computational Thinking](https://iste.org/standards/computational-thinking-competencies) — doc
