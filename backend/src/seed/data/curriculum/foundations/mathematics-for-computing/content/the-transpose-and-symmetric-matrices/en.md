---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define the transpose Aᵀ of a matrix, and compute it directly for a concrete m×n example.
- State and verify the core algebraic properties of the transpose: (Aᵀ)ᵀ = A, (A+B)ᵀ = Aᵀ+Bᵀ, (cA)ᵀ = cAᵀ, and — the one that reverses order — (AB)ᵀ = BᵀAᵀ.
- Define a symmetric matrix (A = Aᵀ), recognize why symmetry requires a square matrix, and prove that AᵀA is symmetric for any matrix A.
- Identify common places symmetric matrices arise in practice, such as Gram matrices (AᵀA) and covariance matrices.
- State, without proof, that symmetric matrices have unusually well-behaved eigenvalues — a fact a later concept in this discipline develops in full.

## Context & Motivation

The transpose is, at first glance, one of the least dramatic operations in linear algebra — flip a matrix across its diagonal, and swap what was a row for what was a column. But this simple, purely mechanical operation shows up constantly, often quietly, throughout the rest of this course and throughout applied linear algebra generally. The dot product concept already used it implicitly: writing a vector u as a column and computing uᵀv is exactly the row-times-column pattern that produces the familiar scalar dot product, and this notation — a transpose turning a column into a row so it can be multiplied against another column — recurs everywhere a dot product needs to be expressed in matrix form.

The transpose also singles out an especially important family of matrices: those equal to their own transpose, called symmetric matrices. These aren't a rare curiosity — they arise naturally and repeatedly in applied work. Whenever a dataset is represented as a matrix A (rows as observations, columns as features, the framing CS229's linear algebra review leans on throughout), the product AᵀA is a symmetric matrix that shows up as the normal equations matrix in least-squares regression (a later concept in this discipline) and, in a closely related form, as the covariance matrix behind PCA and countless other statistical techniques. Symmetric matrices are worth understanding as their own category now precisely because a later concept in this discipline will show they have unusually clean, well-behaved eigenvalues — real-valued and paired with orthogonal eigenvectors, guarantees that fail for general matrices — but that payoff is easiest to appreciate once the definition and basic algebra of symmetry are already comfortable, which is this concept's entire job.

## Core Theory

### Definition of the transpose

For a matrix A ∈ ℝ^(m×n), the **transpose** Aᵀ ∈ ℝ^(n×m) is obtained by making row i of A into column i of Aᵀ (equivalently, reflecting every entry across the main diagonal):

    Aᵀ[j,i] = A[i,j]     for every i, j

Concretely, if

    A = [ 1  2  3 ]     (2×3)
        [ 4  5  6 ]

then

    Aᵀ = [ 1  4 ]     (3×2)
         [ 2  5 ]
         [ 3  6 ]

Note the shape change: an m×n matrix transposes to an n×m matrix. Only when m = n (a square matrix) does the transpose have the same shape as the original — a necessary (though not sufficient) condition for A to possibly equal Aᵀ. This is exactly the notation used to turn a column vector into a row vector: for column vectors u, v ∈ ℝⁿ, the expression uᵀv is a 1×n matrix times an n×1 matrix, producing a 1×1 result — a single number — that works out to be exactly the dot product u · v from the earlier dot-product concept. Every dot product computed so far can be rewritten this way, and this notation is the standard one used going forward whenever a proof needs to manipulate a dot product algebraically.

### Basic algebraic properties

Four properties follow directly from the entry-swap definition, each checkable by comparing entries on both sides:

    (Aᵀ)ᵀ = A                    (transposing twice returns the original)
    (A + B)ᵀ = Aᵀ + Bᵀ            (transpose distributes over addition)
    (cA)ᵀ = c(Aᵀ)                 (scalars pass through unaffected)

The first says the flip-across-the-diagonal operation is its own inverse: flipping back undoes the flip, entry by entry. The second and third both follow because addition and scalar multiplication are themselves entry-by-entry operations (matrix-operations concept) — swapping rows and columns doesn't interact with either in any special way, so the operations commute freely with transposing.

### The transpose of a product reverses order

The property that actually requires care is how transpose interacts with matrix multiplication:

    (AB)ᵀ = BᵀAᵀ

Note the reversal — not AᵀBᵀ. To see why, compare shapes first: if A is m×n and B is n×p, then AB is m×p, so (AB)ᵀ is p×m. On the right side, Aᵀ is n×m and Bᵀ is p×n; the product BᵀAᵀ is (p×n)(n×m) = p×m, which matches — while AᵀBᵀ would be (n×m)(p×n), which isn't even defined unless m = p. The shapes alone rule out AᵀBᵀ as the general answer and point to BᵀAᵀ instead. A full entry-by-entry check confirms the values agree too: entry (j,i) of (AB)ᵀ equals entry (i,j) of AB, which is row i of A dotted with column j of B; entry (j,i) of BᵀAᵀ is row j of Bᵀ (i.e., column j of B) dotted with column i of Aᵀ (i.e., row i of A) — the same dot product, just described from the other side. This exact reversal-of-order pattern was already seen with matrix inverses in the previous concept, (AB)⁻¹ = B⁻¹A⁻¹ — the two operations, transpose and inverse, both "undo a product" by flipping it around, and both insist on reversing the order to do so correctly.

### Symmetric matrices

A square matrix A is **symmetric** if it equals its own transpose:

    A = Aᵀ

Equivalently, A[i,j] = A[j,i] for every i, j — the matrix looks the same whether read normally or reflected across its main diagonal. A symmetric matrix must be square (only square matrices can equal their own transpose, since Aᵀ has swapped dimensions unless m = n). Symmetric matrices arise constantly, and one especially useful, general source is worth proving directly:

**Claim: AᵀA is symmetric, for any matrix A (not necessarily square).**

**Proof.** Let B = AᵀA. Then, using the product-reversal rule just established together with (Aᵀ)ᵀ = A:

    Bᵀ = (AᵀA)ᵀ = Aᵀ(Aᵀ)ᵀ = AᵀA = B

Since Bᵀ = B, B is symmetric. ∎

Notice this holds regardless of whether A itself is square, or symmetric, or has any special structure at all — AᵀA is symmetric unconditionally, for literally any matrix A for which the product is defined (which is always the case for AᵀA, since A is m×n and Aᵀ is n×m, making AᵀA an n×n product every time). This single fact is the reason Gram matrices (AᵀA, used in least squares) and covariance matrices (built from AᵀA after centering the data) are always symmetric by construction, a property later exploited heavily once eigenvalues enter the picture.

### Forward pointer: symmetric matrices and eigenvalues

A later concept in this discipline, eigenvalues of symmetric matrices, proves two remarkable guarantees that hold only for symmetric matrices and can fail for general square matrices: every eigenvalue of a symmetric matrix is a real number (never complex, even though complex eigenvalues are entirely possible for non-symmetric matrices), and its eigenvectors can always be chosen to be mutually orthogonal. Nothing about that machinery is needed here — the point of flagging it now is only that the definition being learned in this concept, A = Aᵀ, is not an arbitrary special case to file away, but the exact condition that later unlocks some of the cleanest and most widely used results in applied linear algebra, including the mathematics behind PCA.

## Worked Examples

### Example 1 — computing a transpose and confirming the double-transpose property

**Problem.** Let A = [ 1 2 3 ; 0 -1 4 ] (2×3). Compute Aᵀ, then compute (Aᵀ)ᵀ and confirm it equals A.

**Transpose.** Row 1 of A, (1, 2, 3), becomes column 1 of Aᵀ; row 2 of A, (0, -1, 4), becomes column 2:

    Aᵀ = [ 1   0 ]
         [ 2  -1 ]
         [ 3   4 ]

**Double transpose.** Applying the same rule to Aᵀ (a 3×2 matrix) swaps its rows and columns back: row 1 of Aᵀ, (1,0), becomes column 1; row 2, (2,-1), becomes column 2; row 3, (3,4), becomes column 3:

    (Aᵀ)ᵀ = [ 1  2  3 ]
            [ 0 -1  4 ]

This matches A exactly, confirming (Aᵀ)ᵀ = A on a concrete non-square example.

### Example 2 — verifying (AB)ᵀ = BᵀAᵀ

**Problem.** Let A = [ 1 2 ; 3 4 ] and B = [ 0 1 ; 1 0 ]. Compute (AB)ᵀ directly, then compute BᵀAᵀ, and confirm they match.

**Step 1 — compute AB.**

    AB = [ 1·0+2·1   1·1+2·0 ]   [ 2  1 ]
         [ 3·0+4·1   3·1+4·0 ] = [ 4  3 ]

**Step 2 — transpose the product.**

    (AB)ᵀ = [ 2  4 ]
            [ 1  3 ]

**Step 3 — compute Aᵀ and Bᵀ separately.**

    Aᵀ = [ 1  3 ]        Bᵀ = [ 0  1 ]
         [ 2  4 ]              [ 1  0 ]

(B happens to equal its own transpose here — a coincidence worth noting but not relied upon.)

**Step 4 — compute BᵀAᵀ.**

    BᵀAᵀ = [ 0·1+1·2   0·3+1·4 ]   [ 2  4 ]
           [ 1·1+0·2   1·3+0·4 ] = [ 1  3 ]

**Conclusion.** (AB)ᵀ = [ 2 4 ; 1 3 ] and BᵀAᵀ = [ 2 4 ; 1 3 ] — identical, confirming the reversal rule on concrete numbers. Note that AᵀBᵀ, computed for comparison, would give a different result entirely (left as an exercise in noticing the reversal is not optional):

```python
import numpy as np
A = np.array([[1, 2], [3, 4]])
B = np.array([[0, 1], [1, 0]])
print((A @ B).T)      # [[2 4] [1 3]]
print(B.T @ A.T)       # [[2 4] [1 3]]  -- matches
print(A.T @ B.T)       # different result -- confirms the order matters
```

### Example 3 — proving AᵀA is symmetric on a non-square example

**Problem.** Let A = [ 1 0 ; 2 1 ; 0 3 ] (3×2, a non-square matrix). Compute AᵀA and confirm it is symmetric.

**Step 1 — compute Aᵀ.**

    Aᵀ = [ 1  2  0 ]     (2×3)
         [ 0  1  3 ]

**Step 2 — compute AᵀA** (a 2×3 times a 3×2, giving a 2×2 result):

    (AᵀA)[1,1] = (1)(1)+(2)(2)+(0)(0) = 1+4+0 = 5
    (AᵀA)[1,2] = (1)(0)+(2)(1)+(0)(3) = 0+2+0 = 2
    (AᵀA)[2,1] = (0)(1)+(1)(2)+(3)(0) = 0+2+0 = 2
    (AᵀA)[2,2] = (0)(0)+(1)(1)+(3)(3) = 0+1+9 = 10

    AᵀA = [ 5   2 ]
          [ 2  10 ]

**Conclusion.** The off-diagonal entries, (AᵀA)[1,2] = 2 and (AᵀA)[2,1] = 2, are equal, confirming AᵀA = (AᵀA)ᵀ — this matrix is symmetric, exactly as the general proof in Core Theory guarantees, despite A itself being a plain 3×2 matrix with no special structure at all. This is the exact computation underlying, for instance, a Gram matrix built from three data points recorded in two features each.

```python
import numpy as np
A = np.array([[1, 0], [2, 1], [0, 3]])
G = A.T @ A
print(G)              # [[ 5  2] [ 2 10]]
print(np.allclose(G, G.T))   # True -- symmetric
```

## Common Misconceptions & Pitfalls

- **"(AB)ᵀ = AᵀBᵀ."** The correct identity reverses the order: (AB)ᵀ = BᵀAᵀ. Example 2 confirms this on concrete numbers and also shows that AᵀBᵀ, computed for the same A and B, produces a different (and generally not even meaningfully related) result — this is not a minor notational preference, it changes the answer.
- **"Only square matrices have a transpose."** Any m×n matrix has a well-defined n×m transpose, regardless of whether m equals n — Example 1 transposes a 2×3 matrix into a 3×2 one with no issue. It's *symmetry* (A = Aᵀ) that specifically requires a square matrix, not the transpose operation itself.
- **"AᵀA only makes sense, or is only symmetric, when A is square or already symmetric."** Example 3 uses a 3×2 (non-square) matrix with no symmetry of its own, and AᵀA still comes out symmetric — the proof in Core Theory places no restriction on A whatsoever. This unconditional guarantee is exactly why Gram and covariance matrices, built from arbitrary data matrices, can always be relied upon to be symmetric.
- **"A symmetric matrix is one where the rows and columns are equal, like a matrix full of repeated values."** Symmetry is specifically about mirroring across the main diagonal — A[i,j] = A[j,i] — not about rows and columns containing the same numbers as each other in any other pattern. A matrix with wildly different-looking rows can still be symmetric, as long as each off-diagonal pair of entries mirrors correctly (Example 3's result, [ 5 2 ; 2 10 ], has two very different diagonal entries and is still symmetric).

## Summary

The transpose Aᵀ flips a matrix across its main diagonal, swapping rows for columns and turning an m×n matrix into an n×m one; it undoes itself under repetition, ((Aᵀ)ᵀ = A), distributes over addition and scalar multiplication without complication, but reverses order when applied to a product: (AB)ᵀ = BᵀAᵀ, echoing the identical reversal seen with matrix inverses in the previous concept. A symmetric matrix satisfies A = Aᵀ and must be square, and one of the most important sources of symmetric matrices is entirely unconditional: AᵀA is symmetric for any matrix A whatsoever, square or not, a fact that underlies Gram matrices in least squares and covariance matrices throughout statistics and machine learning. This concept plants one more forward pointer worth carrying ahead: a later concept in this discipline shows that symmetric matrices enjoy unusually clean eigenvalue behavior — always real eigenvalues, always orthogonal eigenvectors — a guarantee that fails for general square matrices and that makes symmetry one of the most consequential properties a matrix can have.

## Documentation Links

- [Stanford CS229 — Linear Algebra Review and Reference](https://cs229.stanford.edu/section/cs229-linalg.pdf) — doc
- [MIT 18.06 — Course Home (OCW)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/) — doc
