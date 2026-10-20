---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Define a points-to set and may-alias, and explain why almost every other analysis and optimization needs them.
- Extract the four kinds of points-to constraints from a program and solve them with Andersen's inclusion-based algorithm.
- Solve the same program with Steensgaard's unification-based algorithm and explain exactly where precision is lost and why it is faster.
- Describe flow, context, field, and heap sensitivity, and apply points-to information to call-graph construction and escape analysis.

## Context & Motivation

`computer/c-and-assembly` showed that `*p = 1` can change any variable `p` points to, and `software-distributed/compilers` showed that optimizations such as common-subexpression elimination, dead-store elimination, and constant propagation are valid only when no hidden write changes a value in between. Without knowing which locations a pointer may refer to, the compiler must assume that a store through `p` could modify anything, and that kills most optimizations. The same question decides whether a taint analysis sees a leak, whether a data-race detector reports two accesses as conflicting, and which methods a virtual call may reach. Java has no pointer arithmetic, but every object reference is a pointer and the aliasing question is identical.

**Pointer analysis** (or alias analysis) computes, for each pointer variable, a **points-to set**: the abstract memory locations it may hold. Two pointers **may alias** if their sets overlap. Exact answers are undecidable, so every analysis over-approximates, as in abstract interpretation. The design space is a trade-off between precision and cost that stretches from near-linear to exponential, and the two best-known endpoints for the cheap end are Andersen's (1994) and Steensgaard's (1996) algorithms. Møller and Schwartzbach's *Static Program Analysis* and the survey by Smaragdakis and Balatsouras develop the whole space.

## Core Theory

### Abstract locations and constraints

The analysis names memory with **abstract locations**: each program variable whose address is taken, and each **allocation site** (each `malloc` or `new` in the source, standing for all objects it ever creates). A flow-insensitive analysis ignores statement order and computes one points-to relation valid for the whole program. Each statement yields a constraint, where $\text{pts}(p)$ is the points-to set of $p$:

| Statement | Constraint |
|---|---|
| `p = &x` or `p = new T` (site $o$) | $\{x\} \subseteq \text{pts}(p)$ (or $\{o\}$) |
| `p = q` | $\text{pts}(q) \subseteq \text{pts}(p)$ |
| `p = *q` | for each $a \in \text{pts}(q)$: $\text{pts}(a) \subseteq \text{pts}(p)$ |
| `*p = q` | for each $a \in \text{pts}(p)$: $\text{pts}(q) \subseteq \text{pts}(a)$ |

The last two are conditional on the current points-to sets, so solving them is an iteration. For object-oriented languages, `p = q.f` and `p.f = q` read and write the field $f$ of each object that $q$ or $p$ points to, with a separate set $\text{pts}(o.f)$ per object and field.

### Andersen's algorithm: inclusion-based

Andersen treats the constraints as **subset** relations and computes the least solution with a worklist: propagate points-to sets along `p = q` edges, and each time a set grows, add the new edges implied by the load and store constraints. It is the most precise of the flow-insensitive, context-insensitive analyses, with a worst-case cost of $O(n^3)$ in the number of pointer variables. In practice, **cycle elimination** (variables on a cycle of subset edges must have equal sets and can be merged) and **difference propagation** (forward only newly added facts) make it scale to millions of lines of C.

### Steensgaard's algorithm: unification-based

Steensgaard treats `p = q` as **equality**: it merges the *targets* of $p$ and $q$ into one equivalence class, maintained with a union-find structure, and each class points to at most one class. One pass over the program gives nearly linear time, $O(n\,\alpha(n))$. The price is precision: the pointers on both sides of an assignment are merged even if one assignment is all the evidence, so unrelated data can become connected transitively.

### Dimensions of precision

- **Flow sensitivity**: respect statement order, so `p = &x; ...; p = &y;` leaves $\{y\}$ after the second assignment (a *strong update*). Much more expensive; most whole-program analyses are flow-insensitive.
- **Context sensitivity**: analyze a function separately for different callers. Variants are call-string sensitivity (the last $k$ call sites) and **object sensitivity** (the receiver object of the call), which is usually the better fit for Java. Cost grows quickly with $k$.
- **Field sensitivity**: distinguish `s.a` from `s.b`. A field-insensitive analysis merges all fields of a struct or object.
- **Heap abstraction**: an allocation site in a loop represents many objects, so facts about "the" object at that site are weak; finer naming (per calling context) helps.

### Applications

Points-to sets serve as input to many other analyses. **Call-graph construction** for virtual calls: class hierarchy analysis (CHA) considers every subclass of the static type, while points-to analysis considers only the classes of the objects that can actually reach the receiver. A call with one target can be inlined. **Escape analysis** decides whether an object can leave the method that created it; if not, the JIT can replace it with scalars on the stack, an optimization HotSpot's C2 and Graal perform. **Alias-based optimization** in LLVM uses the answers of its alias-analysis passes, and Rust's `&mut` references give LLVM `noalias` for free, because ownership rules already state that the reference is unaliased. Frameworks such as Soot, WALA, and Doop (which expresses analyses as Datalog rules) build Java analyses on top of this.

## Worked Examples

### Example 1: solving with Andersen's algorithm

**Problem:** Compute the points-to sets of
```text
a = &x;   b = &y;   p = &a;   q = p;   *q = b;   r = *p;
```

**Solution:** Base constraints: $\text{pts}(a) \ni x$, $\text{pts}(b) \ni y$, $\text{pts}(p) \ni a$. The copy `q = p` gives $\text{pts}(q) \supseteq \text{pts}(p) = \{a\}$. The store `*q = b` applies to each $t \in \text{pts}(q) = \{a\}$: $\text{pts}(a) \supseteq \text{pts}(b) = \{y\}$, so $\text{pts}(a) = \{x, y\}$. The load `r = *p` applies to each $t \in \text{pts}(p) = \{a\}$: $\text{pts}(r) \supseteq \text{pts}(a) = \{x, y\}$. Result: $\text{pts}(a) = \{x,y\}$, $\text{pts}(b) = \{y\}$, $\text{pts}(p) = \text{pts}(q) = \{a\}$, $\text{pts}(r) = \{x,y\}$. The store through `q` changed what `a` holds, and the load through `p` observed it, because `p` and `q` have the same target `a`; flow-insensitive solving finds this without looking at statement order.

### Example 2: where Steensgaard loses precision

**Problem:** Compare the two algorithms on `p = &x; q = &y; r = p; r = q;`, then ask whether `p` and `q` may alias.

**Solution:** Andersen: $\text{pts}(p) = \{x\}$, $\text{pts}(q) = \{y\}$, $\text{pts}(r) = \{x, y\}$. The sets of `p` and `q` are disjoint, so they do not alias. Steensgaard: `r = p` merges the target class of `r` with that of `p`, and `r = q` then merges it with that of `q`; because the merge is symmetric, `p` and `q` now point to the same class $\{x, y\}$. The analysis answers "may alias", which is spurious: neither `p` nor `q` ever held the other's target. Two assignments into one pointer were enough to connect them. This is the cost of making the algorithm nearly linear.

### Example 3: context sensitivity and devirtualization

**Problem:** In the Java fragment below, what do `x` and `y` point to under a context-insensitive and a 1-call-site-sensitive analysis, and what does that mean for `x.run()`?

```java
static Object id(Object o) { return o; }
Object x = id(new A());   // call site 1, allocation site a1
Object y = id(new B());   // call site 2, allocation site b1
```

**Solution:** Context-insensitive: both calls share the single summary of `id`, so $\text{pts}(o) = \{a_1, b_1\}$ and therefore $\text{pts}(x) = \text{pts}(y) = \{a_1, b_1\}$. Then `x.run()` has two possible targets, `A.run` and `B.run`, and cannot be devirtualized. With 1-call-site sensitivity, `id` is analyzed once per call site: $\text{pts}(x) = \{a_1\}$ and $\text{pts}(y) = \{b_1\}$, so `x.run()` resolves to `A.run` alone and can be inlined. A utility method used from many places is exactly where context sensitivity pays off, and where it costs the most.

## Common Misconceptions & Pitfalls

- **"Java has no pointers, so aliasing is not an issue."** Every object reference is a pointer. Two variables can refer to the same object, and `a.f = 1` can change what `b.f` reads.
- **"More sensitivity is always better."** Precision costs time and memory, sometimes exponentially, and can make an analysis fail on a large program. Practical tools choose the cheapest configuration that answers their client question, and some mix: a precise analysis for selected methods, a cheap one elsewhere.
- **"Flow-insensitive analyses are too crude to be useful."** They are the workhorse: a single points-to graph for the whole program is what lets call graphs and escape analysis scale to millions of lines.
- **"Andersen and Steensgaard find the exact points-to sets."** They find sound over-approximations. Exact aliasing is undecidable, and even the most precise algorithms in the literature have false positives.

## Summary

Pointer analysis computes, for each pointer, a sound over-approximation of the abstract locations it may hold, which many other analyses and optimizations need. Statements become four kinds of constraints over points-to sets. Andersen solves them as subset constraints, which is more precise and cubic in the worst case, and Steensgaard solves them as equalities with union-find, which is near-linear but merges unrelated data. Flow, context, field, and heap sensitivity trade cost for precision, and the results feed call-graph construction, escape analysis, taint tracking, and alias-based optimization. The next concept takes the opposite approach: instead of over-approximating all executions at once, symbolic execution explores individual paths exactly.

## Documentation Links

- [Smaragdakis, Balatsouras: Pointer Analysis (Foundations and Trends in Programming Languages, 2015)](https://yanniss.github.io/points-to-tutorial15.pdf): doc
- [Steensgaard: Points-to Analysis in Almost Linear Time (POPL 1996)](https://dl.acm.org/doi/10.1145/237721.237727): doc
- [Moller, Schwartzbach: Static Program Analysis, chapter on pointer analysis](https://cs.au.dk/~amoeller/spa/): doc
