---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define a vector in ℝⁿ as an ordered list of n real numbers, and distinguish this concrete view from an informal notion of "a quantity with direction and magnitude."
- Compute the sum of two vectors and the scalar multiple of a vector using component-wise arithmetic.
- Interpret vector addition and scalar multiplication geometrically as arrows in the plane (n = 2) and connect that picture to the algebra that generalizes it to higher dimensions.
- Verify, from the component definitions, the basic algebraic properties of addition and scalar multiplication (commutativity, associativity, distributivity).
- Recognize a vector equation written in component form and rewrite it as a statement about individual coordinates, and vice versa.

## Context & Motivation

Every algorithm that touches numerical data — a machine learning model's weight update, a 3D engine's camera transform, a search ranking function comparing two embeddings — is, underneath its domain-specific language, doing arithmetic on vectors. Before any of that machinery makes sense, the object itself has to be pinned down precisely: what exactly *is* a vector, and what are the only two operations this discipline lets you perform on one directly? This concept answers both questions in the most concrete terms possible, because concreteness is what makes everything downstream computable. A vector here is not a mystical "thing with direction and magnitude" borrowed from a physics classroom — it is an ordered list of real numbers, full stop, and the two operations (addition, scalar multiplication) are defined coordinate by coordinate, with nothing left to interpretation.

This concrete framing is a deliberate scoping choice, not a simplification made for beginners that gets replaced later. Both MIT's 18.06 (Linear Algebra) and Stanford's CS229 linear algebra reference — the two anchor sources for this discipline — treat vectors as elements of ℝⁿ throughout: ordered n-tuples of real numbers, full stop, with no detour through the abstract vector-space axioms that a pure-math linear algebra course might open with (a vector space over an arbitrary field, defined by which axioms addition and scalar multiplication must satisfy). That abstraction has real value in its own context, but it buys generality at the cost of concreteness, and this discipline is built for a computing audience that needs to reason about actual arrays of actual numbers — the kind of object a program literally stores and operates on. So the plan here is: get the concrete object and its two operations exactly right, build genuine geometric intuition for what they mean, and let every later concept (dot products, span, systems of equations, elimination) inherit that same concrete footing.

The payoff for getting this right early is that vectors stop being a special notation and start being simply a convenient way of writing down "a list of n numbers I want to treat as one object." A pixel's RGB values, a row of a dataset's feature columns, a point's (x, y, z) coordinates, a polynomial's coefficients — all of these are vectors the moment you decide to add them, scale them, or combine them as a group rather than manipulating each number separately. The operations you're about to define are exactly what make that grouping useful.

## Core Theory

### A vector as an ordered list of real numbers

A **vector** in ℝⁿ is an ordered list of n real numbers, written as a column:

x = (x₁, x₂, …, xₙ)

where each xᵢ ∈ ℝ is called the i-th **component** (or coordinate) of x. The number n is the vector's **dimension**, and the set of all such lists is denoted ℝⁿ — read "R-n," the set of all ordered n-tuples of real numbers. So ℝ² is the set of all pairs (x₁, x₂), ℝ³ the set of all triples, and so on; nothing about the definition changes as n grows, only the number of components being tracked.

Two vectors are **equal** exactly when they have the same dimension and agree in every component: x = y means x₁ = y₁, x₂ = y₂, …, xₙ = yₙ. This sounds trivial, but it is the entire content of what it means for a "vector equation" to hold — a single equation between two vectors in ℝⁿ is secretly n simultaneous equations between real numbers, one per coordinate. That equivalence — one vector equation unpacking into n scalar equations — is exactly the bridge this discipline later uses to turn a system of linear equations into a single equation Ax = b.

### Vector addition

Given two vectors x = (x₁, …, xₙ) and y = (y₁, …, yₙ) in ℝⁿ, their **sum** x + y is defined component-wise:

x + y = (x₁ + y₁, x₂ + y₂, …, xₙ + yₙ)

Addition is only defined between vectors of the same dimension — there is no meaningful way to add a vector in ℝ² to one in ℝ³, because there is no natural pairing of components between them. From the component definition, addition inherits the ordinary properties of real-number addition directly:

- **Commutativity**: x + y = y + x, since xᵢ + yᵢ = yᵢ + xᵢ for every real number pair.
- **Associativity**: (x + y) + z = x + (y + z), for the same reason applied component-wise.
- **Identity element**: the **zero vector** 0 = (0, 0, …, 0) satisfies x + 0 = x for every x.
- **Additive inverse**: −x = (−x₁, −x₂, …, −xₙ) satisfies x + (−x) = 0.

None of these need a separate proof beyond "check it coordinate by coordinate" — they are true because real-number addition already has these properties, and vector addition is defined to be nothing more than real-number addition applied n times in parallel.

### Scalar multiplication

Given a vector x = (x₁, …, xₙ) ∈ ℝⁿ and a real number c (called a **scalar**), the **scalar multiple** cx is defined component-wise:

cx = (cx₁, cx₂, …, cxₙ)

Scalar multiplication scales every component by the same factor c. Its algebraic properties again follow directly from real-number arithmetic:

- **Distributivity over vector addition**: c(x + y) = cx + cy.
- **Distributivity over scalar addition**: (c + d)x = cx + dx.
- **Associativity of scalars**: c(dx) = (cd)x.
- **Multiplicative identity**: 1x = x.
- **Zero scalar**: 0x = 0 (the zero vector), for any x.

Subtraction of vectors, x − y, is simply shorthand for x + (−1)y — adding the negative — and inherits its behavior from addition and scalar multiplication rather than needing its own definition.

### The geometric picture: vectors as arrows

For n = 2 (and n = 3), a vector has a genuine geometric meaning: draw x = (x₁, x₂) as an arrow starting at the origin (0, 0) and ending at the point (x₁, x₂). This "arrow from the origin" picture is what makes addition and scalar multiplication intuitive rather than purely symbolic.

**Addition as tip-to-tail placement.** To visualize x + y geometrically, place the tail of y's arrow at the tip (head) of x's arrow; the sum x + y is the arrow from the origin to wherever y's tip now lands. This is the familiar "parallelogram rule" from physics: x + y is the diagonal of the parallelogram formed by x and y.

**Scalar multiplication as stretching and flipping.** The vector cx points in the same direction as x when c > 0, stretched by a factor of c (or shrunk, if 0 < c < 1); it points in the exact opposite direction when c < 0; and c = 0 collapses it to the origin regardless of x.

```mermaid
graph LR
    O(("origin (0,0)")) -->|x = (3,1)| X(("(3,1)"))
    O -->|y = (1,2)| Y(("(1,2)"))
    O -.->|"x + y = (4,3)"| S(("(4,3)"))
```

The diagram shows the two original vectors from the origin, and the resulting sum as a third arrow — geometrically, exactly the point you'd reach by walking along x and then along y (translated to start where x ended), even though the diagram only draws all arrows from the shared origin for clarity.

Crucially, nothing about the algebra above required n = 2 or n = 3 — component-wise addition and scaling are defined identically for any n. What's lost as n grows past 3 is only the ability to *draw* the picture, not the validity of the operations or the intuition they encode; a vector in ℝ¹⁰⁰ still "adds tip to tail" and "scales" in exactly the same algebraic sense, even though no human can sketch a 100-dimensional arrow. This is the single most important habit to build early in this discipline: trust the algebra to tell you what's true in high dimensions, and use the n = 2 picture only as a source of intuition, never as a constraint on what counts as valid.

## Worked Examples

### Example 1 — computing a sum and a scalar multiple directly

**Problem:** Let x = (3, −1, 4) and y = (2, 5, −2) in ℝ³. Compute x + y, 2x, and x − 3y.

**x + y:** add component-wise: (3+2, −1+5, 4+(−2)) = (5, 4, 2).

**2x:** scale each component by 2: (2·3, 2·(−1), 2·4) = (6, −2, 8).

**x − 3y:** first compute 3y = (3·2, 3·5, 3·(−2)) = (6, 15, −6); then x − 3y = x + (−1)(3y) = (3 − 6, −1 − 15, 4 − (−6)) = (−3, −16, 10).

Each result is itself a vector in ℝ³, computed one coordinate at a time — no step here used anything beyond ordinary real-number arithmetic applied three times per operation.

### Example 2 — verifying an algebraic property from the component definitions

**Problem:** Confirm, using x = (1, 2) and y = (3, −1) and scalar c = 4, that c(x + y) = cx + cy (distributivity), by computing both sides independently.

**Left side, c(x + y):** first x + y = (1+3, 2+(−1)) = (4, 1). Then c(x+y) = 4·(4, 1) = (16, 4).

**Right side, cx + cy:** cx = 4·(1,2) = (4, 8); cy = 4·(3,−1) = (12,−4). Then cx + cy = (4+12, 8+(−4)) = (16, 4).

**Conclusion:** both sides equal (16, 4). This single numerical instance doesn't *prove* the general property — the Core Theory argument (that it reduces to real-number distributivity coordinate by coordinate) already does that for every x, y, c — but working the instance out concretely is what makes the abstract argument trustworthy: seeing that "c(x₁+y₁, x₂+y₂) = (cx₁+cy₁, cx₂+cy₂)" is really just ordinary distributivity, applied twice, side by side.

### Example 3 — the geometric picture with parallel vs. non-parallel vectors

**Problem:** Let u = (2, 1) and v = (4, 2). Compute u + v and 3u, and comment on how v relates to u geometrically.

**Observation about v:** v = (4, 2) = 2·(2, 1) = 2u. So v is a scalar multiple of u — geometrically, v points in the exact same direction as u, just twice as long. Any two vectors related by v = cu (c ≠ 0) are called **parallel**; they lie along the same line through the origin.

**u + v:** (2+4, 1+2) = (6, 3). Note that (6,3) = 3·(2,1) = 3u as well — since v is just a scaled copy of u, adding u and v can only ever produce another vector on that same line through the origin. This is a preview of an idea developed fully in the next concept (span): two parallel vectors, no matter how you add or scale them together, never escape the single line they both lie on.

**3u:** 3·(2,1) = (6,3) — matching u + v exactly in this case, since v happened to equal 2u, so u + v = u + 2u = 3u by distributivity, algebraically confirming the geometric coincidence just observed.

## Common Misconceptions & Pitfalls

- **"A vector must have a geometric picture to be meaningful."** The algebra (component-wise addition and scalar multiplication) is defined identically for every n ≥ 1, whether or not a human can draw it. A vector in ℝ⁷ representing seven sensor readings is exactly as legitimate a vector as an arrow in the plane — it simply can't be sketched. Treating "no picture" as "not really a vector" causes real confusion once dimensions exceed 3, which happens almost immediately in any real computing application.
- **"Vectors of different dimensions can be added if you just line up whichever components exist."** Addition (and equality) is defined only between vectors of the same dimension n. (1, 2, 3) + (1, 2) is simply undefined — not "equal to (2, 4, 3)" or any other guess — because there is no canonical way to decide which components correspond to which.
- **"cx and x point in the same direction for any scalar c."** This holds only for c > 0. Multiplying by a negative scalar reverses the direction (c = −1 exactly reverses it, giving −x), and multiplying by 0 collapses the vector to the origin, which has no direction at all. For example, with x = (2, 1), −x = (−2, −1) points into the opposite quadrant, not "the same way but shorter."
- **"Vector subtraction is a third, independent operation that needs its own rule."** x − y is entirely derived from the two primitive operations: x − y := x + (−1)y. There is no separate "subtraction rule" to memorize beyond combining scalar multiplication by −1 with addition — treating it as a third primitive operation is unnecessary and, worse, obscures why (x − y) + y = x holds (it's just associativity and the additive-inverse property already established for addition).

## Summary

A vector in ℝⁿ is nothing more — and nothing less — than an ordered list of n real numbers, and the two operations that define everything downstream in this discipline, addition and scalar multiplication, are both defined component-wise: add or scale each coordinate independently, in parallel. Every algebraic property these operations satisfy (commutativity, associativity, distributivity, the zero vector, additive inverses) is inherited directly from the same properties of ordinary real-number arithmetic, applied n times over rather than once. For n = 2 and n = 3, these operations have a genuine geometric meaning — vectors as arrows from the origin, addition as tip-to-tail placement, scalar multiplication as stretching, shrinking, or flipping a direction — but the geometric picture is an aid to intuition, not a restriction on validity: the identical algebra governs vectors in ℝ¹⁰⁰ even though no picture can be drawn. This concrete, computational view of vectors — never abstract vector-space axioms over a general field — is the foundation every later concept in this discipline (dot products, span, linear systems, elimination) builds on directly.

## Documentation Links

- [MIT 18.06SC — Syllabus (OCW)](https://www.ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/pages/syllabus) — doc
- [Stanford CS229 — Linear Algebra Review and Reference](https://cs229.stanford.edu/section/cs229-linalg.pdf) — doc
