---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the diagonalization A = PDP⁻¹, and identify precisely what P and D contain in terms of A's eigenvectors and eigenvalues.
- Explain why Dⁿ is trivial to compute for a diagonal matrix D, and derive Aⁿ = PDⁿP⁻¹ from A = PDP⁻¹.
- Diagonalize a 2×2 matrix by hand, assembling P from its eigenvectors and D from its eigenvalues.
- Compute a high power of a 2×2 matrix (e.g., A¹⁰) via diagonalization, and contrast the effort against repeated direct multiplication.
- Recognize when a matrix fails to be diagonalizable (too few independent eigenvectors) as a limitation of this technique.

## Context & Motivation

The previous concept established that an eigenvector v of a matrix A is a direction A leaves alone except for scaling it by λ. Diagonalization is what happens when you take that idea and push it as far as it can go: if A has *enough* independent eigenvectors — specifically, n of them for an n×n matrix — you can use them to build an entirely new coordinate system in which A's action becomes as simple as it could possibly be. In that eigenvector coordinate system, A doesn't rotate, shear, or mix components together at all; it just scales each coordinate independently by its own eigenvalue. That is exactly what a **diagonal matrix** does, and diagonalization is the precise statement that A, viewed through the right lens, *is* a diagonal matrix.

This would be an elegant fact on its own, but it earns its place in this discipline because of a genuinely practical payoff: computing a high power of a general matrix — A¹⁰⁰, say — by repeated direct multiplication is expensive (each matrix multiplication for an n×n matrix costs roughly n³ operations, so multiplying A by itself 99 times is enormously wasteful, quite apart from how tedious it would be by hand). But once A is diagonalized, computing any power of A collapses to computing powers of a *diagonal* matrix, which is almost embarrassingly cheap — you just raise each number on the diagonal to that power, independently, with zero cross-terms to track. This single trick — diagonalize once, then every power is nearly free — is the mechanism underneath simulating repeated transformations (applying the same linear step over and over, as in a discrete dynamical system), and it is exactly the computational engine behind the Markov chain analysis two concepts ahead, where "what happens after many, many steps" is precisely a question about a high power of a matrix.

## Core Theory

### The diagonalization A = PDP⁻¹

Suppose an n×n matrix A has n linearly independent eigenvectors v⁽¹⁾, v⁽²⁾, …, v⁽ⁿ⁾, with corresponding eigenvalues λ₁, λ₂, …, λₙ (not necessarily distinct). Build two matrices from this data:

- **P**, whose columns are the eigenvectors, in order: P = [v⁽¹⁾ v⁽²⁾ ⋯ v⁽ⁿ⁾].
- **D**, the diagonal matrix with the corresponding eigenvalues down the diagonal, in the same order: D = diag(λ₁, λ₂, …, λₙ), meaning Dᵢᵢ = λᵢ and every off-diagonal entry is 0.

Then A satisfies:

A = PDP⁻¹

Because P's columns are linearly independent by assumption, P is invertible (this is exactly the earlier concept connecting independent columns to an invertible matrix), so P⁻¹ exists and this equation is well formed. This is called **diagonalizing** A, and a matrix for which such a P and D exist is called **diagonalizable**.

**Why this holds.** Each eigenvector equation Av⁽ⁱ⁾ = λᵢv⁽ⁱ⁾ can be written for all i at once as a single matrix equation: AP = PD (multiplying A into each column of P reproduces exactly that column scaled by its own λᵢ, which is exactly what multiplying P by the diagonal matrix D on the right does — D's diagonal structure is precisely what makes "scale column i by λᵢ" the correct interpretation of PD). Since P is invertible, multiply both sides on the right by P⁻¹:

AP = PD ⟹ A = PDP⁻¹

Equivalently, and just as usefully, P⁻¹AP = D — this reads as "changing coordinates by P⁻¹, then applying A, then changing back with P⁻¹'s inverse P" — wait, more precisely: P⁻¹AP = D says that when A's action is re-expressed in the coordinate system whose axes are the eigenvectors (that's what multiplying by P and P⁻¹ accomplishes), A behaves exactly like the diagonal matrix D — pure independent scaling along each new axis, no mixing between them.

### The payoff: Aⁿ = PDⁿP⁻¹

This is the entire reason diagonalization matters computationally. Starting from A = PDP⁻¹, compute A²:

A² = (PDP⁻¹)(PDP⁻¹) = PD(P⁻¹P)DP⁻¹ = PD·I·DP⁻¹ = PD²P⁻¹

The middle P⁻¹P collapses to the identity, leaving the two D's adjacent to each other. The same cancellation happens at every step of a longer product, so for any positive integer k:

Aᵏ = PDᵏP⁻¹

This holds because every P⁻¹P pair in the middle of the expanded product Aᵏ = (PDP⁻¹)(PDP⁻¹)⋯(PDP⁻¹) collapses to the identity, leaving only P at the far left, P⁻¹ at the far right, and k copies of D multiplied together in between.

And Dᵏ, for a diagonal matrix D = diag(λ₁, …, λₙ), is essentially free to compute:

Dᵏ = diag(λ₁ᵏ, λ₂ᵏ, …, λₙᵏ)

This is because multiplying diagonal matrices together multiplies corresponding diagonal entries with zero cross-terms (off-diagonal entries stay exactly zero at every step), so raising D to the k-th power is nothing more than raising each of its n diagonal numbers to the k-th power independently — n independent scalar exponentiations, versus the (k−1) full n×n matrix multiplications, each costing roughly n³ operations, that direct computation of Aᵏ would otherwise require.

```mermaid
graph LR
    A["A (general matrix)"] -->|"diagonalize once"| PDP["P, D, P⁻¹"]
    PDP -->|"raise D to the k-th power<br/>(cheap: per-entry exponentiation)"| Dk["Dᵏ"]
    Dk -->|"reassemble: P · Dᵏ · P⁻¹"| Ak["Aᵏ"]
```

### When diagonalization fails

Diagonalization requires n *linearly independent* eigenvectors for an n×n matrix — not merely n eigenvalues (counted with multiplicity, there are always n, by the characteristic polynomial's degree), but n independent eigenvectors to actually build an invertible P. A repeated eigenvalue can fail to produce enough independent eigenvectors to span the full space — its eigenspace can have lower dimension than its multiplicity in the characteristic polynomial suggests. A matrix with this defect is **not diagonalizable** (technically, a "defective" matrix); powers of it must be computed by other means (a more advanced decomposition beyond this discipline's scope handles that case). Every symmetric matrix, however — the subject of the next concept — is always guaranteed to be diagonalizable, with an especially well-behaved P, which is one reason symmetric matrices are singled out for special treatment.

## Worked Examples

### Example 1 — diagonalizing a 2×2 matrix

**Problem:** Diagonalize A = [[4, 1], [2, 3]] (the same matrix from the previous concept's Example 1).

**Step 1 — recall the eigendata.** From the previous concept: eigenvalues λ₁ = 5 with eigenvector v⁽¹⁾ = (1, 1), and λ₂ = 2 with eigenvector v⁽²⁾ = (1, −2).

**Step 2 — assemble P and D.**

P = [[1, 1], [1, −2]]  D = [[5, 0], [0, 2]]

**Step 3 — compute P⁻¹.** For a 2×2 matrix [[a, b], [c, d]], the inverse is (1/(ad−bc))·[[d, −b], [−c, a]]. Here det(P) = (1)(−2) − (1)(1) = −3, so:

P⁻¹ = (1/−3)·[[−2, −1], [−1, 1]] = [[2/3, 1/3], [1/3, −1/3]]

**Step 4 — verify A = PDP⁻¹ by checking P⁻¹AP = D (an equivalent, often easier check).**

AP = [[4, 1], [2, 3]]·[[1, 1], [1, −2]] = [[4·1+1·1, 4·1+1·(−2)], [2·1+3·1, 2·1+3·(−2)]] = [[5, 2], [5, −4]]

P⁻¹(AP) = [[2/3, 1/3], [1/3, −1/3]]·[[5, 2], [5, −4]] = [[(2/3)(5)+(1/3)(5), (2/3)(2)+(1/3)(−4)], [(1/3)(5)+(−1/3)(5), (1/3)(2)+(−1/3)(−4)]]

= [[10/3+5/3, 4/3−4/3], [5/3−5/3, 2/3+4/3]] = [[5, 0], [0, 2]] = D ✓

The diagonalization checks out: A = PDP⁻¹ with the P and D above.

### Example 2 — computing A¹⁰, the hard way sketched and the easy way done in full

**Problem:** Compute A¹⁰ for A = [[4, 1], [2, 3]] from Example 1.

**The hard way, sketched.** Direct computation would require forming A² = A·A, then A⁴ = A²·A², then A⁸ = A⁴·A⁴, then A¹⁰ = A⁸·A² — even using repeated squaring to cut the number of multiplications down, that's still four full 2×2 matrix multiplications, each one entry-by-entry, with numbers growing larger and messier at every step (A²'s entries are already two-digit combinations; by A⁸ the arithmetic is unwieldy by hand, and for a larger matrix or a much higher power, this cost grows rapidly).

**The easy way, via diagonalization.** From Example 1, A = PDP⁻¹ with D = [[5, 0], [0, 2]]. So:

A¹⁰ = PD¹⁰P⁻¹, where D¹⁰ = [[5¹⁰, 0], [0, 2¹⁰]] = [[9765625, 0], [0, 1024]]

Now compute PD¹⁰P⁻¹:

PD¹⁰ = [[1, 1], [1, −2]]·[[9765625, 0], [0, 1024]] = [[9765625, 1024], [9765625, −2048]]

(PD¹⁰)P⁻¹ = [[9765625, 1024], [9765625, −2048]]·[[2/3, 1/3], [1/3, −1/3]]

Row 1: (9765625·2/3 + 1024·1/3, 9765625·1/3 + 1024·(−1/3)) = ((19531250+1024)/3, (9765625−1024)/3) = (19532274/3, 9764601/3) = (6510758, 3254867)

Row 2: (9765625·2/3 + (−2048)·1/3, 9765625·1/3 + (−2048)·(−1/3)) = ((19531250−2048)/3, (9765625+2048)/3) = (19529202/3, 9767673/3) = (6509734, 3255891)

So A¹⁰ = [[6510758, 3254867], [6509734, 3255891]]. The arithmetic here is still nontrivial simply because the numbers involved are large (5¹⁰ is a seven-digit number), but the *structure* of the computation stayed simple throughout: two exponentiations of single numbers (5¹⁰ and 2¹⁰), and two ordinary matrix multiplications — nothing like the escalating chain of full matrix-by-matrix products the direct approach demands, and critically, this exact same procedure computes A¹⁰⁰ or A¹⁰⁰⁰ with no additional matrix multiplications at all — only larger exponents inside D, which cost nothing extra to compute.

### Example 3 — a matrix that fails to diagonalize

**Problem:** Attempt to diagonalize N = [[3, 1], [0, 3]], and explain what goes wrong.

**Eigenvalues.** N − λI = [[3−λ, 1], [0, 3−λ]], det = (3−λ)² = 0, so λ = 3 with multiplicity 2 — a repeated eigenvalue, as in Example 2 of the previous concept, but this time with a very different matrix around it.

**Eigenvectors.** Solve (N − 3I)v = 0: N − 3I = [[0, 1], [0, 0]]. The first row gives v₂ = 0 directly (0·v₁ + 1·v₂ = 0); v₁ is unconstrained. So every eigenvector has the form (v₁, 0) — a single line, not a full plane of independent directions. Unlike Example 2 of the previous concept (where B = 3I gave *every* vector in ℝ² as an eigenvector), here the eigenspace for λ = 3 is only one-dimensional, even though λ = 3 has algebraic multiplicity 2.

**Conclusion.** N has only one independent eigenvector direction, not two — there is no way to build an invertible 2×2 matrix P out of N's eigenvectors, since both columns would have to be scalar multiples of (1, 0), making P singular. N is **not diagonalizable**. This is exactly the failure mode flagged in Core Theory: a repeated eigenvalue whose eigenspace comes up short of its multiplicity.

## Common Misconceptions & Pitfalls

- **"Every square matrix can be diagonalized."** Example 3 is a direct counterexample: N = [[3, 1], [0, 3]] has a full set of eigenvalues (two, counting multiplicity) but not a full set of independent eigenvectors, so no invertible P exists. Diagonalizability is a genuine extra condition, not automatic.
- **"D in A = PDP⁻¹ can list the eigenvalues in any order, independent of how P's columns are ordered."** The order must match exactly: the i-th diagonal entry of D must be the eigenvalue belonging to the i-th column of P. Swapping the order in D without correspondingly swapping P's columns produces a matrix product that is not equal to A at all.
- **"Since Aⁿ = PDⁿP⁻¹ is 'the same formula' for every n, you only need to compute P and P⁻¹ once and can reuse them for any power."** This is actually true and is the entire point — but it's easy to mistakenly re-derive P and P⁻¹ for each new exponent out of habit. Diagonalizing A is a one-time cost; every subsequent power only requires recomputing Dⁿ (cheap) and one multiplication PDⁿP⁻¹ (not free, but far cheaper than n−1 chained full matrix multiplications).
- **"P⁻¹AP = D and A = PDP⁻¹ are two different, independently-derived facts."** They are algebraically the same statement — multiply P⁻¹AP = D on the left by P and on the right by P⁻¹ to recover A = PDP⁻¹ directly; there's no need to re-derive one from scratch given the other.

## Summary

When an n×n matrix A has n linearly independent eigenvectors, it factors as A = PDP⁻¹, where D is the diagonal matrix of A's eigenvalues and P's columns are the corresponding eigenvectors, in matching order. This factorization's real value is computational: because P⁻¹P cancels at every internal step of a product, Aᵏ = PDᵏP⁻¹ for any power k, and Dᵏ — a diagonal matrix's power — is simply each diagonal entry raised to the k-th power independently, with no matrix multiplication required at all. This turns the otherwise expensive, error-prone task of computing a high power of A directly into a one-time diagonalization followed by cheap scalar exponentiation and two matrix multiplications, regardless of how large the exponent is. Not every matrix diagonalizes — a repeated eigenvalue can produce an eigenspace smaller than its multiplicity, leaving too few independent eigenvectors to build an invertible P — but symmetric matrices, covered next, always diagonalize, and do so in an especially clean way.

## Documentation Links

- [MIT 18.06 — Course Home (OCW)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/) — doc
- [MIT 18.06SC — Syllabus (OCW)](https://www.ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/pages/syllabus) — doc
