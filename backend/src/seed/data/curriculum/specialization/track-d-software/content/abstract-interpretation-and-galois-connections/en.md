---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Explain why exact program analysis is impossible and how abstracting the semantics gives a computable, sound approximation.
- Define an abstract domain (signs, intervals) with its join and abstract operators, and state soundness through a Galois connection $(\alpha, \gamma)$.
- Run an interval analysis of a loop with widening and narrowing, and read the result.
- Distinguish sound analyses from bug finders, explain false alarms, and say what relational domains add to non-relational ones.

## Context & Motivation

`software-distributed/compilers` presented data-flow analysis as iteration over a lattice until a fixed point, and `ai-theory/formal-methods` ended with the limits of verification: by Rice's theorem, no algorithm decides any non-trivial semantic property of programs exactly. Static analyzers get around that by giving up exactness in one direction. They answer "this property **definitely holds**" or "**I cannot tell**", never wrongly the first way. **Abstract interpretation**, introduced by Patrick and Radhia Cousot in 1977, is the theory that says how to build such analyzers and prove them sound.

It is the basis of the strongest industrial static analyzers. Astrée, built on this theory, proved the absence of run-time errors (overflow, division by zero, out-of-bounds access) in the primary flight control software of the Airbus A340, a program of over 100,000 lines of C, with no false alarms after being specialized to that domain (Blanchet et al., PLDI 2003). Frama-C's Eva plugin, NASA's IKOS, and the value-range analyses inside optimizing compilers such as LLVM follow the same recipe. The data-flow analyses you already know are special cases: abstract interpretation adds domains of infinite height and a principled way to make the iteration terminate.

## Core Theory

### Concrete and abstract semantics

Take a tiny imperative language with integer variables. Its **concrete semantics** assigns to each program point the set of all values (or, in general, all memory states) that can reach it in some execution. That is a mathematical object, an element of the powerset lattice $\mathcal{P}(\mathbb{Z})$ per variable, and it is not computable in general.

An **abstract domain** replaces sets of values by a small description that a program can manipulate. Two classic non-relational domains:

- **Signs**: $\{\bot, -, 0, +, \top\}$, describing the sign of a variable. $\bot$ means "no value", $\top$ means "any integer".
- **Intervals**: $[l, u]$ with $l \in \mathbb{Z} \cup \{-\infty\}$ and $u \in \mathbb{Z} \cup \{+\infty\}$. The join is the smallest enclosing interval: $[a,b] \sqcup [c,d] = [\min(a,c), \max(b,d)]$.

Every operation of the language gets an **abstract transfer function** that over-approximates it. For intervals, $[a,b] + [c,d] = [a+c,\ b+d]$, and multiplication takes the minimum and maximum of the four products. A conditional `if (x < 100)` refines the interval by intersecting it with $(-\infty, 99]$ on one branch and $[100, +\infty)$ on the other.

### Galois connections and soundness

The relationship between concrete and abstract is a **Galois connection**: two monotone maps, abstraction $\alpha : \mathcal{P}(\mathbb{Z}) \to A$ and concretization $\gamma : A \to \mathcal{P}(\mathbb{Z})$, such that

$$\alpha(C) \sqsubseteq a \iff C \subseteq \gamma(a)$$

In words, $\alpha(C)$ is the most precise abstract value that covers $C$, and $\gamma(a)$ is the set of concrete values that $a$ stands for. An abstract transfer function $f^\#$ is **sound** for a concrete function $f$ when

$$f(\gamma(a)) \subseteq \gamma(f^\#(a))$$

for every $a$: whatever concrete values the abstract input stands for, the concrete results are covered by the abstract output. If every operation is sound and the join is an upper bound, the whole analysis is sound, because it computes a superset of the real behaviors. The best possible $f^\#$ is $\alpha \circ f \circ \gamma$, which is often too expensive to compute exactly and is replaced by a cheaper sound one.

### Loops: fixed points, widening, narrowing

At a loop head, the abstract state must cover the entry state and the state after any number of iterations. That is a fixed point of $X = \text{entry} \sqcup F(X)$, which Kleene iteration computes by repeating from $\bot$. On a finite-height lattice (signs) this terminates. On the interval domain it may not: a loop that increments a counter produces $[0,0], [0,1], [0,2], \dots$ forever.

A **widening** operator $\nabla$ forces termination by extrapolating: it keeps a bound that is stable and throws away one that keeps growing, setting it to infinity:

$$[a,b] \mathbin{\nabla} [c,d] = [\,l,\ u\,] \quad \text{where } l = \begin{cases} a & c \geq a \\ -\infty & c < a \end{cases}, \quad u = \begin{cases} b & d \leq b \\ +\infty & d > b \end{cases}$$

Iteration with widening reaches a post-fixed point in a bounded number of steps, always sound but often too coarse. A following **narrowing** pass re-applies $F$ a few times, recovering precision lost by the jump. Tools also use *threshold widening* (jump to the next constant in the program rather than infinity) and delayed widening (iterate a few times first).

### Precision and relational domains

Non-relational domains keep one description per variable, and so forget correlations: if `y = x` and `z = x - y`, intervals give `z` the range $[-m, m]$ rather than $0$. **Relational domains** keep constraints between variables: octagons ($\pm x \pm y \leq c$), polyhedra (arbitrary linear inequalities), and congruences. They are more precise and more expensive, which is the central trade-off of the field. A sound analyzer reports a possible error whenever its over-approximation includes one; if no real execution has it, that report is a **false alarm**. Reducing false alarms for a family of programs by choosing or designing the right domains is what Astrée did.

### Relation to other analyses

A type system can be read as an abstract interpretation in which the domain is the set of types. A data-flow analysis is an abstract interpretation with a finite-height domain. A **bug finder** that may miss errors (unsound) is a different tool: it can have no false alarms but can have false negatives. Soundness is what lets an analyzer say "no run-time error of these kinds is possible", under stated assumptions about inputs, floating-point behavior, and the environment.

## Worked Examples

### Example 1: sign analysis and a false alarm

**Problem:** Analyze `x = 5; y = -3; z = x * y; w = z + x; r = 1 / w;` with the sign domain, then with the interval domain.

**Signs:** $x = +$, $y = -$, $z = +\cdot- = -$, $w = - + + = \top$ (a negative plus a positive can have any sign). Division by $w$: $\top$ includes $0$, so the analyzer must report **possible division by zero**. Real execution gives $z=-15$, $w=-10$, so this is a false alarm.

**Intervals:** $x=[5,5]$, $y=[-3,-3]$, $z=[-15,-15]$, $w=[-10,-10]$, and $0 \notin [-10,-10]$: no alarm, and the result is exact. Choosing a richer domain removes the false alarm at higher cost per operation.

### Example 2: an interval loop with widening and narrowing

**Problem:** Compute the interval for `i` at the exit of `i = 0; while (i < 100) { i = i + 1; }`.

**Solution:** Let $X$ be the interval of `i` at the loop head. $X_0 = [0,0]$ from the entry. One iteration: the guard `i < 100` keeps $[0,0]$, the body gives $[1,1]$, and the join with the entry gives $X_1 = [0,1]$. Without widening, this would continue to $[0,100]$ in 100 steps (and forever if the bound were unknown). Apply widening at the loop head: $[0,0] \mathbin{\nabla} [0,1] = [0,+\infty]$. Check that it is stable: the guard gives $[0,99]$, the body $[1,100]$, the join with the entry $[0,100] \sqsubseteq [0,+\infty]$, so $[0,+\infty]$ is a post-fixed point. The exit condition `i >= 100` then gives $[100,+\infty]$, imprecise. **Narrowing** re-applies $F$ to $[0,+\infty]$ and obtains $[0,100]$, so the exit becomes $[100,100]$: the analyzer proves `i == 100` after the loop.

### Example 3: array bounds and the cost of ignoring correlations

**Problem:** Which accesses can the analyzer prove safe in `int a[100]; for (i = 0; i < 100; i++) a[i] = 0;`, and what goes wrong in `x = input in [0,10]; y = x; z = x - y; a[z] = 1`?

**Solution:** In the first program, inside the loop body the guard refines `i` to $[0,99]$, which fits the array's index range $[0,99]$: every access is proven in bounds. Changing the guard to `i <= 100` gives $[0,100]$ and the analyzer correctly reports a possible out-of-bounds access at `a[100]`, a real bug. In the second program, intervals compute $x=[0,10]$, $y=[0,10]$, $z=[0,10]-[0,10]=[-10,10]$, so `a[z]` raises an alarm for negative indexes, although $z$ is always $0$. An **octagon** domain records the constraint $x - y = 0$ and computes $z=[0,0]$: the false alarm disappears.

## Common Misconceptions & Pitfalls

- **"Sound means no false alarms."** It means no missed errors (false negatives) within the property class. Soundness is bought with false alarms, and engineering effort goes into reducing them.
- **"Abstract interpretation is a tool."** It is a framework. Data-flow analysis, many type systems, and some model-checking techniques are instances, and tools such as Astrée, Eva, and IKOS are implementations with specific domains.
- **"Widening destroys the result."** It loses precision to guarantee termination, but narrowing, thresholds, and delayed widening recover much of it, as the loop example shows.
- **"A clean report proves the program correct."** It proves the absence of the error classes the analyzer models, under assumptions (input ranges, a floating-point model, absence of other threads), and says nothing about functional correctness.

## Summary

Abstract interpretation computes a sound over-approximation of a program's behavior by running it over an abstract domain. A Galois connection $(\alpha, \gamma)$ links abstract and concrete values, and soundness means each abstract operation covers the concrete one. Loops are handled by fixed-point iteration, and widening guarantees termination on infinite-height domains at some loss of precision that narrowing partly recovers. Non-relational domains such as signs and intervals are cheap but forget correlations; relational domains such as octagons and polyhedra cost more and raise precision. The result is an analyzer that can prove the absence of whole classes of run-time errors. The next concept applies the same ideas to the analysis that most other analyses depend on: which memory locations a pointer can refer to.

## Documentation Links

- [Cousot, Cousot: Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs (POPL 1977)](https://www.di.ens.fr/~cousot/COUSOTpapers/POPL77.shtml): doc
- [Moller, Schwartzbach: Static Program Analysis (lecture notes, Aarhus University)](https://cs.au.dk/~amoeller/spa/): doc
- [Blanchet et al.: A Static Analyzer for Large Safety-Critical Software (PLDI 2003)](https://www.di.ens.fr/~cousot/COUSOTpapers/PLDI03.shtml): doc
