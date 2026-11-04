---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Write the Jacobi and Gauss-Seidel sweeps entrywise and as splittings $x^{(k+1)}=Gx^{(k)}+c$, and count the flops of a sweep on a sparse matrix.
- State the spectral radius theorem and the sufficient conditions (strict diagonal dominance, symmetric positive definiteness) with their hypotheses, and show what happens when each one is missing.
- Measure the convergence factor from a run and compare it with $\rho(G)$.
- Stop on the residual knowing what it does and does not say about the error, and find the point where rounding ends the iteration.
- Decide from measured fill-in, sweep counts, and the number of right-hand sides when iteration beats factorization, and when it does not.

## Context & Motivation

`lu-decomposition-and-partial-pivoting` solves a dense system in about $\tfrac23n^3$ flops. A sparse matrix does not stay sparse under that process: $L$ and $U$ gain nonzeros where $A$ has none, which is called **fill-in**. For a 3D grid with $n=64\,000$ unknowns, $A$ has $4.4\times10^5$ nonzeros and its sparse factors have $9.6\times10^7$.

An iteration avoids that entirely. It touches only the existing nonzeros, it stores a few vectors, and it can stop as soon as the answer is good enough. Jacobi needs nothing beyond the diagonal and the product of $A$ with a vector. The price is that it may converge slowly or not at all, depending on the matrix. Jacobi and Gauss-Seidel are the two simplest such methods, and their convergence conditions show the kind of analysis any iteration needs.

## Core Theory

### Two sweeps

Solve equation $i$ for $x_i$, assuming every $a_{ii}\neq0$. **Jacobi** uses only old values:

$$x_i^{(k+1)}=\frac{1}{a_{ii}}\Big(b_i-\sum_{j\neq i}a_{ij}x_j^{(k)}\Big).$$

**Gauss-Seidel** uses each new value as soon as it exists:

$$x_i^{(k+1)}=\frac{1}{a_{ii}}\Big(b_i-\sum_{j<i}a_{ij}x_j^{(k+1)}-\sum_{j>i}a_{ij}x_j^{(k)}\Big).$$

Jacobi needs two vectors, ignores the order of the equations, and its updates can run simultaneously. Gauss-Seidel overwrites in place, but its iterates depend on the order, and its updates are sequential unless the sparsity pattern allows groups of independent unknowns. A sweep of either on a matrix with `nnz` nonzeros costs $\text{nnz}-n$ multiplications, $\text{nnz}-n$ subtractions, and $n$ divisions: $2\,\text{nnz}-n$ flops.

### The splitting

Write $A=D+L+U$, the diagonal and the strictly lower and upper parts. These $L$ and $U$ are pieces of $A$, not the factors of an LU decomposition. Then

$$G_J=-D^{-1}(L+U),\qquad G_{GS}=-(D+L)^{-1}U,$$

and each method is $x^{(k+1)}=Gx^{(k)}+c$. The solution $x$ of $Ax=b$ satisfies $x=Gx+c$, so subtracting gives $e^{(k+1)}=Ge^{(k)}$ and $e^{(k)}=G^ke^{(0)}$. This is `fixed-point-iteration` in $n$ dimensions, with $G$ in the role of $g'$.

### The convergence theorem

The **spectral radius** $\rho(G)$ is the largest $\lvert\lambda\rvert$ over the eigenvalues of $G$.

**Hypotheses.** $A$ is nonsingular and every $a_{ii}\neq0$. **Conclusion.** The iteration converges to $x$ for every $x^{(0)}$ if and only if $\rho(G)<1$.

If $\rho(G)<1$ then $G^k\to0$. If $\rho(G)\ge1$, a start whose error is an eigenvector for that eigenvalue never converges. A particular lucky start may still work, which is why the theorem says "every". Asymptotically the error shrinks by $\rho(G)$ per sweep, so reducing it by $10^{-d}$ takes about $d/(-\log_{10}\rho)$ sweeps. That is a long-run rate, not a promise for each sweep.

### Sufficient conditions

Computing $\rho(G)$ can be as hard as the original problem, so simpler tests matter.

- **Strict diagonal dominance by rows:** $\lvert a_{ii}\rvert>\sum_{j\neq i}\lvert a_{ij}\rvert$ for all $i$. The row sums of $\lvert G_J\rvert$ are then below 1, so $\lVert G_J\rVert_\infty<1$. Jacobi and Gauss-Seidel both converge for every start, and $A$ is automatically nonsingular. The same holds with columns in place of rows.
- **Weak dominance plus irreducibility**, with strict inequality in at least one row, also suffices. This covers the model problem of Example 2.
- **Symmetric positive definite $A$:** Gauss-Seidel converges for every start. Jacobi needs more: $2D-A$ must be positive definite too.

All of these are sufficient, not necessary, and in general neither method dominates the other (Example 3).

A separate relation is not a test at all: for tridiagonal $A$ with nonzero diagonal, $\rho(G_{GS})=\rho(G_J)^2$. When Jacobi converges, one Gauss-Seidel sweep is then worth two Jacobi sweeps. When it diverges, Gauss-Seidel diverges too, as $\begin{pmatrix}1&3\\4&1\end{pmatrix}$ shows in Example 3.

### Stopping, and what the residual means

The computable quantity is the residual $r^{(k)}=b-Ax^{(k)}$, a backward-error measure. The error obeys $e^{(k)}=-A^{-1}r^{(k)}$, which gives

$$\frac{\lVert e^{(k)}\rVert}{\lVert x\rVert}\le\kappa(A)\,\frac{\lVert r^{(k)}\rVert}{\lVert b\rVert}.$$

A small residual on an ill-conditioned matrix can therefore hide a large error. See `conditioning-and-numerical-stability`. Also cap the sweeps, since a diverging run may never trigger the test.

## Worked Examples

### Example 1: a strictly dominant system

$$A=\begin{pmatrix}4&-1&1\\2&6&-1\\1&1&5\end{pmatrix},\qquad b=\begin{pmatrix}5\\11\\18\end{pmatrix},\qquad x=\begin{pmatrix}1\\2\\3\end{pmatrix}.$$

The off-diagonal sum divided by the diagonal is $0.5$, $0.5$, $0.4$ by row, so both methods converge and the error falls by at least $0.5$ per sweep in the infinity norm under Jacobi. From $x^{(0)}=0$, one Jacobi sweep gives $(\tfrac54,\tfrac{11}6,\tfrac{18}5)$. One Gauss-Seidel sweep gives $x_1=1.25$, then $x_2=(11-2.5)/6=1.4167$, then $x_3=(18-1.25-1.4167)/5=3.0667$. A float64 run, with the infinity norm of the error:

```text
sweep   Jacobi      Gauss-Seidel
1       6.000e-01   5.833e-01
4       1.389e-02   4.958e-04
8       2.277e-04   9.970e-08
12      2.168e-06   2.498e-12
16      3.527e-08   4.441e-16
```

The eigenvalues give $\rho(G_J)=0.338$ and $\rho(G_{GS})=0.091$. Those eigenvalues are complex, so the sweep-to-sweep ratio oscillates, and the right measurement is a geometric mean: $0.332$ for Jacobi over sweeps 4 to 24 and $0.083$ for Gauss-Seidel over sweeps 2 to 12. Both are below the guaranteed $0.5$. `numpy.linalg.solve` returns the same $(1,2,3)$.

### Example 2: the model problem and the measured rate

The tridiagonal matrix with $2$ on the diagonal and $-1$ beside it, of size $n$, comes from a 1D diffusion problem. It is only weakly dominant, but it is irreducible, so both methods converge. Its Jacobi matrix has $\rho=\cos\big(\pi/(n+1)\big)$. For $n=50$ that predicts $0.998103$ for Jacobi and $0.996210$ for Gauss-Seidel. With exact solution $x_i=\sin(\pi t_i)+0.3\sin(3\pi t_i)$, $t_i=i/51$, $b=Ax$ and $x^{(0)}=0$:

```text
sweep  Jacobi error  ratio     Gauss-Seidel error  ratio
100    7.939e-01     0.998038  6.556e-01           0.996215
1000   1.435e-01     0.998103  2.153e-02           0.996210
2000   2.149e-02     0.998103  4.832e-04           0.996210
4000   4.823e-04     0.998103  2.433e-07           0.996210
8000   2.428e-07     0.998103  6.398e-14           0.996677
```

Errors are relative in the 2-norm, and the ratio is $\lVert e^{(k)}\rVert/\lVert e^{(k-1)}\rVert$. The measured ratios match the prediction to six digits. Gauss-Seidel at sweep 1000 equals Jacobi at sweep 2000, as $\rho_{GS}=\rho_J^2$ says. The ratio $0.996677$ in the last row is rounding starting to interfere: the Gauss-Seidel error freezes at $1.9\times10^{-14}$ by sweep 9000, while `numpy.linalg.solve` gets $6.2\times10^{-15}$. Before the freeze the error is the iteration's truncation error. After it, more sweeps do nothing.

The rate is the problem. Reducing the error by $10^{-6}$ takes about 334 Jacobi sweeps at $n=10$, 28,554 at $n=100$, and $2.8\times10^6$ at $n=1000$, growing like $n^2$. Here a banded LU solves the system in $O(n)$ flops, so iterating on this one-dimensional matrix is a poor choice.

The residual test also behaves as stated. At $n=50$ the relative residual first drops below $10^{-6}$ at sweep 6722 for Jacobi and 3362 for Gauss-Seidel, with relative error $2.7\times10^{-6}$ for both. With $\kappa_2(A)=1053$ the bound allows $10^{-3}$. It is a bound, not an estimate.

### Example 3: what each hypothesis does

Each run takes $x=(1,2)$ or $(1,2,3)$, sets $b=Ax$, and starts from zero.

| Matrix | Missing | $\rho(G_J)$ | $\rho(G_{GS})$ | Measured from $x^{(0)}=0$ |
|---|---|---|---|---|
| $\begin{pmatrix}0&1\\1&0\end{pmatrix}$ | $a_{ii}\neq0$ | undefined | undefined | division by zero on the first sweep; swapping the rows fixes it |
| $\begin{pmatrix}1&3\\4&1\end{pmatrix}$ | dominance | $3.46$ | $12$ | both diverge |
| $\begin{pmatrix}4&1\\1&3\end{pmatrix}$ | nothing | $0.289$ | $0.083$ | the same equations reordered: both converge |
| $\begin{pmatrix}1&0.8&0.8\\0.8&1&0.8\\0.8&0.8&1\end{pmatrix}$ | $2D-A$ positive definite | $1.6$ | $0.716$ | positive definite, yet Jacobi's error is $2.9\times10^8$ at sweep 40; Gauss-Seidel's is $7.1\times10^{-6}$ |
| $\begin{pmatrix}1&2&-2\\1&1&1\\2&2&1\end{pmatrix}$ | dominance | $0$ | $2$ | Jacobi is exact after 3 sweeps ($G_J^3=0$); Gauss-Seidel's error is $2.1\times10^5$ at sweep 12 |
| $\begin{pmatrix}2&3\\1&2.5\end{pmatrix}$ | dominance | $0.775$ | $0.6$ | both converge: dominance is not necessary |

So neither method is always better, and row order can decide everything. The row with $\rho=0$ also warns about the asymptotic reading in the other direction. Take $I$ minus $2.5$ on the superdiagonal, $n=30$, with $x$ all ones and $b=Ax$. Jacobi has $\rho(G_J)=0$ and is exact at sweep 30, but its error grows to $3.5\times10^{11}$ at sweep 29 first. $\rho<1$ decides the limit, not the path.

### Example 4: when iteration beats factorization

Each row below compares `scipy.sparse.linalg.splu` (one factorization and one solve, relative residual near $10^{-16}$) with Jacobi run from zero to a relative residual of $10^{-6}$. The first three rows use `x = default_rng(0).standard_normal(n)` and `b = A @ x`. Sweep counts depend on $b$: on the first matrix, five other right-hand sides gave 18,188 to 28,555 sweeps. The last row solves the PageRank system below and stops at $\lVert x^{(k+1)}-x^{(k)}\rVert_1<10^{-10}$. Times are from one run on one machine and only their rough size matters. The accuracies differ, so this compares six-digit Jacobi with full-accuracy LU.

```text
problem                     n        nnz(A)    nnz(L+U)  splu    sweeps  Jacobi
2D Poisson, 100x100         10,000   49,600    6.5e+05   0.03 s  14,905  1.1 s
3D Poisson, 40x40x40        64,000   438,400   9.6e+07   31 s    3,282   2.8 s
I + 2D Poisson, 500x500     250,000  1.25e+06  2.9e+07   1.5 s   52      0.3 s
PageRank, random graph      20,000   219,946   2.7e+08   670 s   18      0.004 s
```

**2D Poisson: factorization wins.** The sparse factors are only 13 times denser than $A$, and Jacobi needs tens of thousands of sweeps because $\rho\to1$ as the grid refines. A large sparse matrix alone is not a reason to iterate.

**3D Poisson: fill-in decides.** The factors are 218 times denser than $A$, and growing fast with the grid, so even a slow iteration wins.

**A step of implicit diffusion: $\rho$ does not depend on $n$.** Adding the identity to the 2D Poisson matrix makes the diagonal $5$ and the off-diagonal row sum at most $4$, so $\lVert G_J\rVert_\infty\le0.8$ on any grid. Jacobi took 52 sweeps on the $100\times100$, $300\times300$ and $500\times500$ grids alike, so its total cost is linear in $n$. Started from the previous solution after a small change in the right-hand side, it took 23 on the largest grid. This is the good case for iteration: a dominant diagonal and a good initial guess.

**PageRank is Jacobi.** The update $x\leftarrow dMx+(1-d)\tfrac1n\mathbf 1$ of `pagerank-via-power-iteration` is exactly the Jacobi sweep for $(I-dM)x=(1-d)\tfrac1n\mathbf 1$ when no page links to itself, because then $D=I$. With a column-stochastic $M$, $\lVert G\rVert_1=d=0.85$, which guarantees a factor of $0.85$ per sweep whatever $n$ is. On this graph (10 random links per page) the measured factor was $0.27$, and it took 18 sweeps at $n=20\,000$, $10^5$ and $10^6$, each at $2\,\text{nnz}-n$ flops. A dense LU at $n=20\,000$ would be $5.3\times10^{12}$ flops, and the sparse one above had 1,200 times the nonzeros of $A$.

**Many right-hand sides favor factoring.** After `splu` on the $500\times500$ grid, each new solve took $0.04$ s, while 23 sweeps at the rate above take about $0.13$ s, so factorization pays off once enough right-hand sides arrive.

### Book vs today

Plain Jacobi and Gauss-Seidel are rarely the final solver now. On the 2D problem above, `scipy.sparse.linalg.cg` (for symmetric positive definite $A$) needed 187 iterations against Jacobi's 14,905 with the same $b$, and 91 against 3,282 on the 3D one. Its count varies with $b$ too: 1 to 256 on those five other right-hand sides. Krylov methods and multigrid took over, with these sweeps surviving inside them as preconditioners and smoothers. On the model problem with $n=50$, five Gauss-Seidel sweeps leave $0.4\%$ of the highest-frequency error mode and $98\%$ of the smoothest, the behavior a multigrid cycle exploits. Five plain Jacobi sweeps leave $99\%$ of both, because its eigenvalues at the two ends have the same size, so a multigrid code built on Jacobi uses a damped variant.

## Common Misconceptions & Pitfalls

- **"Diagonal dominance is required."** It is sufficient. The last row of Example 3 converges without it, and Example 2 has only weak dominance.
- **"Gauss-Seidel is always faster than Jacobi."** Example 3 has a matrix where Jacobi finishes in 3 sweeps and Gauss-Seidel diverges.
- **"Positive definite means Jacobi works."** That guarantee belongs to Gauss-Seidel. Example 3 has $\rho(G_J)=1.6$ on a positive definite matrix.
- **"$\rho<1$ means the error falls every sweep."** Example 3's closing case grows by a factor of $10^{11}$ first.
- **"Iteration wins on any large sparse matrix."** 2D Poisson with direct `splu` was about 40 times faster than Jacobi, with far more accuracy.
- **"More sweeps, more digits."** Example 2 freezes at $1.9\times10^{-14}$.
- **"A small residual means a small error."** Only up to a factor of $\kappa(A)$.
- **"These $L$ and $U$ are the LU factors."** They are the strict triangles of $A$ itself.

## Summary

Jacobi solves each equation with old values, and Gauss-Seidel uses new ones at once. Both are $x^{(k+1)}=Gx^{(k)}+c$ with error $G^ke^{(0)}$, so with nonsingular $A$ and nonzero diagonal they converge from every start exactly when $\rho(G)<1$, at about $\rho$ per sweep in the long run. Strict diagonal dominance guarantees both, positive definiteness guarantees Gauss-Seidel, and tridiagonal structure gives $\rho_{GS}=\rho_J^2$, measured here to six digits. None of these is necessary, and neither method always wins. A sweep costs $2\,\text{nnz}-n$ flops, so iteration wins when fill-in is severe or when $\rho$ stays away from 1 as $n$ grows, as in implicit steps and PageRank, and it loses on the 2D Poisson matrix and with many right-hand sides. Rounding sets a floor near $10^{-14}$ in Example 2, and the residual bounds the error only through $\kappa(A)$.

## Documentation Links

- [Templates for the Solution of Linear Systems, Stationary Iterative Methods](https://netlib.org/linalg/html_templates/node11.html): overview of Jacobi, Gauss-Seidel, SOR and SSOR.
- [Templates for the Solution of Linear Systems, Convergence of the Jacobi method](https://netlib.org/linalg/html_templates/node13.html): the model problem and the spectrum of its Jacobi matrix.
- [Templates for the Solution of Linear Systems, The Gauss-Seidel Method](https://netlib.org/linalg/html_templates/node14.html): dependence on ordering and sequential updates.
- [Saad, Iterative Methods for Sparse Linear Systems, 2nd ed.](https://www-users.cse.umn.edu/~saad/IterMethBook_2ndEd.pdf): Chapter 4 proves the general convergence result and the diagonally dominant and positive definite cases.
- [Fundamentals of Numerical Computation, 8.1 Sparsity and structure](https://fncbook.com/structure-1): sparse storage and fill-in.
- [Fundamentals of Numerical Computation, 8.6 MINRES and conjugate gradients](https://fncbook.com/minrescg): the Krylov methods that replaced plain sweeps for symmetric matrices.
- [SciPy, scipy.sparse.linalg.splu](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.splu.html): the sparse LU used in Example 4.
- [SciPy, scipy.sparse.linalg.cg](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.cg.html): the conjugate gradient routine used in the comparison.
