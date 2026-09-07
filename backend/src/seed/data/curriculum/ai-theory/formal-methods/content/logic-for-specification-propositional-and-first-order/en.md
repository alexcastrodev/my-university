---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Translate informal requirements into propositional and first-order assertions over program states.
- Combine smaller claims precisely using the connectives ¬, ∧, ∨, →, and ↔.
- Use bounded quantifiers to specify properties of arrays, heaps, and collections without leaving any ambiguity about scope.
- Distinguish satisfiability, validity, and entailment as three different questions a verification obligation can pose.
- Recognize the tradeoff between logical expressiveness — how much a specification language can say — and how automatable checking it turns out to be.

## Context & Motivation

`specifications-preconditions-postconditions-invariants` introduced preconditions, postconditions, and invariants as predicates over states, but left the actual language those predicates are written in mostly implicit. Before a Hoare triple can be proved or a model-checking property can be evaluated against a transition system, assertions like `x ≥ 0`, `sorted(a)`, or "every request is eventually acknowledged" have to be written down with enough precision that a proof system — or eventually an automated solver — can manipulate them mechanically, without ever having to guess what an English sentence was trying to say.

The building blocks here are not new: propositional logic's connectives and first-order logic's predicates, functions, and quantifiers are exactly the machinery Discrete Math and Logic already developed and proved sound. What is genuinely new in this concept is the *interpretation* — these formulas are no longer evaluated over abstract mathematical domains chosen for pedagogical convenience, but over program states, heaps, arrays, and, eventually, entire execution traces. The logic doesn't change; the universe it's talking about does, and that shift in universe is what turns a familiar mathematical toolkit into a specification language.

The connection to Computability and Complexity is worth stating up front rather than discovering by surprise later: richer logical languages can express strictly more properties, but a tool that could automatically decide the truth of every first-order formula about every possible program would amount to a general-purpose program verifier, and that would directly contradict the undecidability results — the Halting Problem, Rice's Theorem — that Computability and Complexity already proved. Every choice made in this concept about how expressive to let a specification language be is implicitly also a choice about how much automated support that language can ever hope to receive later, a tension that resurfaces explicitly once SAT and SMT solvers enter the picture.

## Core Theory

### Assertions over states

An assertion is not an eternal, context-free truth — it is a formula evaluated at a specific state, and its truth value can depend entirely on which state is chosen. The assertion `x < y` is true in a state where `x` happens to hold 3 and `y` holds 5, and false in a state where the values are reversed; the same syntactic formula, two different verdicts, because the two states differ. This is exactly why Hoare-logic proof rules are described as "transforming assertions" as commands transform states: proving `{P} C {Q}` is really an argument about how the truth value of assertions changes as execution steps from a `P`-satisfying state, through whatever `C` does, to a final state that must satisfy `Q`. A well-formed state assertion, as a matter of good practice, should mention only the variables and model components its claim genuinely depends on — an assertion that silently references a variable a command never touches invites confusion about whether that variable's value is actually constrained by anything at all.

### Propositional structure

The five familiar connectives do real, distinct work once they're applied to program assertions rather than abstract propositions. Conjunction `P ∧ Q` demands both sub-claims hold simultaneously in the same state — exactly the shape of an invariant like `0 ≤ top ≤ capacity` from the stack example in the previous concept, where both halves must hold together, not separately at different times. Disjunction `P ∨ Q` permits either sub-claim to hold, which is the natural shape for describing a specification that admits more than one acceptable outcome — say, an operation that either succeeds and updates state, or fails cleanly and leaves state unchanged. Implication `P → Q` is, by a wide margin, the most common shape a verification proof obligation actually takes: "if the precondition and loop guard hold, then the postcondition of this step holds" is exactly the shape of a Hoare-logic consequence obligation, and recognizing an obligation as an implication is often the first step toward knowing how to attack it (assume the antecedent, derive the consequent). Equivalence `P ↔ Q` supports the kind of rewriting and simplification that makes a hard-to-read assertion easier to work with without changing its meaning — replacing `¬(x < y)` with `x ≥ y` over the integers, for instance, is licensed by exactly this connective.

### First-order predicates

Propositional logic alone cannot say "every element of this array is nonnegative" — that requires naming a property that applies uniformly across a domain of individuals, which is what predicates and quantifiers are for. A predicate such as `sorted(a, n)` or `owns(user, file)` names a property that may or may not hold of specific arguments, and it is genuinely different in kind from a Boolean variable, because its truth depends on which arguments are plugged in. The universal quantifier `∀` expresses "this holds of every relevant element" — the natural shape for safety-style specifications that must hold uniformly, like "every index of a sorted array respects the ordering." The existential quantifier `∃` expresses "there is at least one element for which this holds" — the natural shape for claims that something exists somewhere, without saying where, such as "there is a valid path from the start state to the goal." Crucially, the domain each quantifier ranges over must be stated explicitly rather than left to context, because "for all elements" of an unbounded or ill-defined domain is a different, and often meaningless or unprovable, claim from "for all elements within these array bounds" — this is precisely why explicit bounds on quantifiers matter so much in practice, and why omitting them is flagged below as a genuine pitfall rather than a stylistic nicety.

### Entailment and satisfiability

Three distinct logical questions recur constantly once formulas are used as specifications, and conflating them is a real source of confusion. Entailment, written `P ⊨ Q`, asks whether every state satisfying `P` also satisfies `Q` — this is the exact logical shape of a Hoare-logic consequence step, where a proof needs to show that whatever the current assertion guarantees is strong enough to imply what's needed next. Satisfiability asks a weaker question: does *at least one* state make a given formula true? A formula can be satisfiable without being always true, which matters enormously for bug-finding, where the goal is often precisely to find *some* state that violates a safety property. Validity asks the strongest question: does *every* state make a formula true, with no exceptions at all? These three notions are tightly linked rather than independent: many practical verifiers prove an entailment `P ⊨ Q` indirectly, by instead showing that the formula `P ∧ ¬Q` is unsatisfiable — if no state can simultaneously satisfy `P` and violate `Q`, then every state satisfying `P` must satisfy `Q`, which is exactly what entailment claims. This translation from "prove an entailment" into "show a conjunction is unsatisfiable" is the exact conceptual bridge that SAT and SMT solvers, introduced later in this discipline, are built to exploit at automated scale.

## Worked Examples

### A propositional obligation

Suppose a Hoare-logic proof has already established the assertion `x ≥ 5` at some point, and the next step in the proof requires `x > 0` to hold at that same point. This is an entailment question: does `x ≥ 5 ⊨ x > 0`? The argument is immediate once stated as ordinary arithmetic: any integer `x` satisfying `x ≥ 5` is at least 5, and every integer that is at least 5 is certainly greater than 0, so every state satisfying the first assertion also satisfies the second. This tiny piece of arithmetic reasoning is not a toy exercise disconnected from the rest of the discipline — it is *exactly* the logical work performed by a consequence step in Hoare logic, the rule that lets a proof strengthen or weaken an assertion at any point by appeal to ordinary logical implication rather than by re-examining the program's execution at all.

### A sortedness predicate

Consider specifying that an array `a` of length `n` is sorted in non-decreasing order. Writing this precisely requires exactly the quantifier machinery just introduced:

```text
∀ i. ∀ j. 0 ≤ i ≤ j < n → a[i] ≤ a[j]
```

Read piece by piece: the two universal quantifiers range over every pair of indices `i` and `j`; the guard `0 ≤ i ≤ j < n` restricts attention to pairs that are both valid array indices *and* ordered with `i` at or before `j`, ruling out nonsensical or out-of-range index pairs from the claim entirely; the implication then says that for every such valid, ordered pair, the earlier element is no greater than the later one. Every piece of this formula is doing necessary work: dropping the bound `0 ≤ i ≤ j < n` would leave the quantifiers ranging over an unconstrained and meaningless domain, and reversing the implication or swapping `i` and `j`'s roles would produce a formula that looks superficially similar but asserts something different (or nothing coherent at all). This is a direct, concrete illustration of why explicit quantifier bounds are not optional decoration — without them, "every element of the array" doesn't actually pin down what "every" ranges over.

### Negating a safety property

A common technique in automated verification is to search for the negation of the property being proved, rather than searching for a direct proof of the property itself. Suppose the safety claim is "every reachable state satisfies `balance ≥ 0`." Directly proving this over an unbounded or complex state space can be hard; but its negation — "some reachable state satisfies `balance < 0`" — turns the same question into a *search* problem: does such a state exist anywhere in the reachable state space? This is exactly the reformulation a model checker or an SMT-based bounded verifier typically performs internally: rather than attempting a direct universal proof, it searches for a witness to the negation. If the search succeeds and finds such a state, that witness is a genuine counterexample to the original safety claim, not merely evidence of a failed proof attempt — it is a constructive demonstration, in the same spirit as the finite failing test from the previous concept, that the universal claim is false. If the search exhausts the entire reachable state space and finds no such witness, the original safety property is proved, because the negation has been shown unsatisfiable over exactly the domain that mattered.

## Common Misconceptions & Pitfalls

- **Reading implication as if it meant time or causation.** `P → Q` is a purely logical relationship — "whenever P is true, Q is also true" in the same state or under the same assumptions — not a claim that `P` happening causes `Q` to happen afterward. Conflating logical implication with temporal sequencing is a frequent source of confusion once temporal logic, where operators genuinely do talk about "afterward," enters the discipline later and the two notions need to be kept clearly apart.
- **Forgetting the state in which an assertion is evaluated.** Because the same formula can be true in one state and false in another, writing an assertion without being clear about exactly which point in execution it's claimed to hold at (before a command, after it, at every point during a loop) leaves the claim genuinely ambiguous rather than merely informally stated.
- **Writing an existential claim when the requirement is actually universal.** "There exists a path that satisfies the requirement" (`∃`) is a categorically weaker and easier-to-satisfy claim than "every path satisfies the requirement" (`∀`) — mistaking one for the other is a common way a specification ends up far weaker than the author intended, silently passing programs that should have been rejected.
- **Leaving array and heap quantifier bounds implicit.** As the sortedness example shows concretely, `∀ i. a[i] ≤ a[i+1]` without any stated bound on `i` is not a well-formed claim about a finite array at all — the bound is not stylistic polish, it is what makes the formula refer to the actual, finite domain intended rather than an unconstrained one.
- **Confusing satisfiable with valid.** A formula being satisfiable (true in at least one state) is a far weaker fact than a formula being valid (true in every state); a formula can easily be satisfiable while also being false in most states, and mistaking "a solver found a satisfying assignment" for "this property always holds" inverts the actual logical content of what was just established.

## Summary

Logic is what gives specifications their precision, and none of the machinery is new — connectives structure claims out of smaller claims, predicates describe properties of program states, quantifiers range explicitly over the elements those properties apply to, and entailment turns a specification into a checkable verification obligation. What is new relative to Discrete Math and Logic is only the interpretation: these formulas are now evaluated over program states, arrays, and heaps rather than abstract domains, and the same three questions — satisfiability, validity, and entailment — recur throughout the rest of this discipline in every technique that follows, from Hoare-logic consequence steps to the SAT and SMT encodings that automate them at scale later on.

## Documentation Links

- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
