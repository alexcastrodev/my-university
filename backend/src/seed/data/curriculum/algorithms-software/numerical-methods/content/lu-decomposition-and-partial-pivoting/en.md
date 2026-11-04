---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Read LU decomposition as Gaussian elimination with its multipliers recorded, and state when $A=LU$ exists.
- Compute $PA=LU$ by hand with partial pivoting, then solve by forward and back substitution and reuse the factors for a new right-hand side.
- Count the exact number of floating-point operations in the factorization and in each solve.
- Show in float64 how elimination without pivoting destroys the answer on a well-conditioned matrix, and measure forward error, backward error, and growth.
- Separate the partial-pivoting pivot from the simplex pivot, and name the cases where partial pivoting is unnecessary or insufficient.

## Context & Motivation

`gaussian-elimination` solved a system by row operations, with a swap only when a needed pivot was zero. Two things change on a computer. First, that lesson threw its multipliers away, so a second right-hand side would repeat all the work, although the matrix is the same. Keeping the multipliers fixes this: the work on $A$ is done once and each new $b$ is cheap. Second, in floating point the swap rule is not enough. A pivot that is tiny rather than zero passes the rule and ruins the result, even when the problem itself is well conditioned, in the sense of `conditioning-and-numerical-stability`.

## Core Theory

### Elimination records its own inverse

Step $k$ subtracts $m_{ik}=a_{ik}/a_{kk}$ times row $k$ from each row $i>k$. In matrix form that is $M_kA$ with $M_k=I-\mathbf m_k\mathbf e_k^T$, where $\mathbf m_k$ holds the multipliers below position $k$. After $n-1$ steps $M_{n-1}\cdots M_1A=U$ is upper triangular. Each inverse just flips a sign, $M_k^{-1}=I+\mathbf m_k\mathbf e_k^T$, and in the order they appear the products do not interact:

$$A=\underbrace{M_1^{-1}\cdots M_{n-1}^{-1}}_{L}\,U,\qquad L=I+\sum_{k=1}^{n-1}\mathbf m_k\mathbf e_k^T.$$

So $L$ is unit lower triangular with the multipliers sitting in place. Elimination needs no second matrix: multipliers overwrite the zeros they create, which is the format `scipy.linalg.lu_factor` returns.

**Existence.** A square $A$ has $A=LU$ with $L$ unit lower triangular and $U$ nonsingular upper triangular if and only if every leading principal submatrix of $A$ is nonsingular. Nonsingularity of $A$ alone is not enough: $\begin{pmatrix}0&1\\1&0\end{pmatrix}$ is nonsingular and has no such factorization, since $u_{11}=0$ would contradict $l_{21}u_{11}=1$.

### Why a small pivot does damage

Rounding errors in a factorization scale with the entries of $L$ and $U$, not with those of $A$. A small pivot makes a large multiplier, which scales a row up, and adding that to a smaller row rounds the smaller row away. Two measurements watch this: the **growth factor** $\rho=\max_{i,j}\lvert u_{ij}\rvert/\max_{i,j}\lvert a_{ij}\rvert$, and the **backward error** $\lVert b-A\hat x\rVert_\infty\big/\big(\lVert A\rVert_\infty\lVert\hat x\rVert_\infty+\lVert b\rVert_\infty\big)$, which says how much the data must change for $\hat x$ to be an exact solution. The relative forward error is at most about the condition number times the backward error, so a large forward error on a well-conditioned matrix indicts the algorithm.

### Partial pivoting and PA = LU

At step $k$, search column $k$ on and below the diagonal for the largest magnitude, swap that row into position $k$ (whole rows, stored multipliers included), then eliminate. Every multiplier now has $\lvert m_{ik}\rvert\le1$. "Partial" means only a column is searched; full pivoting searches the whole remaining block.

**Theorem.** For every square $A$ there is a permutation matrix $P$ with $PA=LU$, where $L$ is unit lower triangular with $\lvert l_{ij}\rvert\le1$ and $U$ is upper triangular. $A$ is nonsingular if and only if every $u_{kk}\neq0$.

To solve $Ax=b$, solve $Ly=Pb$ forward and $Ux=y$ backward. Also $\det A=(-1)^s\prod_k u_{kk}$ for $s$ swaps.

### This pivot is not the simplex pivot

`the-simplex-method-tableau-and-pivoting` also says "pivot". The word is shared because each one divides by an entry to clear a column; the jobs are different.

| | Partial pivoting in LU | Simplex pivot |
|---|---|---|
| Purpose | limit rounding error | move to an adjacent vertex |
| Entry chosen by | largest magnitude in the column | entering rule on the objective row, then the ratio test |
| Operation | swap rows, eliminate below only | Gauss-Jordan: clear the column everywhere, objective row included |
| Effect on the answer | none: the same $x$, by a route with less rounding | changes the current solution, on purpose |
| In exact arithmetic | needed only for zero pivots | is the algorithm |

The simplex rule looks at feasibility and the objective, not at entry size, so its pivot can be small. The partial-pivoting rule looks only at size.

### Counting the work

Count one flop for each $+$, $-$, $\times$, $\div$. Step $k$ does $n-k$ divisions and $(n-k)^2$ multiply-subtract pairs, so

$$\text{factorization: }\sum_{k=1}^{n-1}\big[(n-k)+2(n-k)^2\big]=\tfrac23n^3-\tfrac12n^2-\tfrac16n.$$

Forward substitution with unit diagonal costs $n^2-n$. Back substitution costs $n^2$, which includes $n$ divisions. Each solve is therefore $2n^2-n$ flops. Pivot search adds $n(n-1)/2$ comparisons and the swaps, none of which are flops. With $k$ right-hand sides the total is $\tfrac23n^3-\tfrac12n^2-\tfrac16n+k(2n^2-n)$.

## Worked Examples

### Example 1: the same system, now factored

Use the system of `gaussian-elimination`:

$$A=\begin{pmatrix}1&1&1\\2&3&1\\1&1&2\end{pmatrix},\qquad b=\begin{pmatrix}6\\11\\8\end{pmatrix}.$$

That lesson's row operations used multipliers $2$ and $1$, and the third row needed nothing in column 2. Keeping them gives, with no swaps,

$$L=\begin{pmatrix}1&0&0\\2&1&0\\1&0&1\end{pmatrix},\quad U=\begin{pmatrix}1&1&1\\0&1&-1\\0&0&1\end{pmatrix}.$$

With partial pivoting, the largest entry of column 1 is the $2$, so rows 1 and 2 swap. The multipliers are $\tfrac12,\tfrac12$, leaving rows $(0,-\tfrac12,\tfrac12)$ and $(0,-\tfrac12,\tfrac32)$. Column 2 is a tie, so no swap, the multiplier is $1$, and

$$P=\begin{pmatrix}0&1&0\\1&0&0\\0&0&1\end{pmatrix},\quad L=\begin{pmatrix}1&0&0\\\tfrac12&1&0\\\tfrac12&1&1\end{pmatrix},\quad U=\begin{pmatrix}2&3&1\\0&-\tfrac12&\tfrac12\\0&0&1\end{pmatrix}.$$

Now $Pb=(11,6,8)$, forward substitution gives $y=(11,\tfrac12,2)$, and back substitution gives $x=(3,1,2)$, the answer of that lesson. A new $b=(1,0,0)$ needs no elimination: $Pb=(0,1,0)$, $y=(0,1,-1)$, $x=(5,-3,-1)$, for 15 flops. Also $\det A=(-1)^1\cdot2\cdot(-\tfrac12)\cdot1=1$. `scipy.linalg.lu` returns the same $L$ and $U$, with its $P$ defined by $A=PLU$, so its $P$ is the transpose of this one. `numpy.linalg.solve` gives the same two solutions.

### Example 2: ordinary entries, a pivot made of noise

$$A=\begin{pmatrix}3&1&2\\0.3&0.1&0.7\\1&2&1\end{pmatrix},\qquad x=\begin{pmatrix}1\\1\\1\end{pmatrix},\qquad b=Ax=\begin{pmatrix}6\\1.1\\4\end{pmatrix}.$$

Nothing here is small, and $\kappa_2(A)=10.3$, so the problem is well conditioned. In decimal the first step makes the $(2,2)$ entry exactly $0.1-\tfrac{0.3}{3}\cdot1=0$, and a swap would follow. But $0.3$ and $0.1$ are not binary fractions. In float64, $0.3/3=0.09999999999999999$, so the entry becomes $1.39\times10^{-17}$. That is rounding noise, it is nonzero, and the swap rule of `gaussian-elimination` never fires. The next multiplier is $1.667/(1.39\times10^{-17})=1.2\times10^{17}$, and $u_{33}=0.333-(1.2\times10^{17})(0.5)=-6.0\times10^{16}$, in which the $0.333$ has vanished. The results:

```text
method              x                    max error   backward error   growth
no pivoting         (1.3333, 0, 1.0000)  1.0         0.12             2.0e+16
partial pivoting    (1, 1, 1)            2.2e-16     0                1
numpy.linalg.solve  (1, 1, 1)
```

The residual of the unpivoted answer is $(0,0,1.67)$: the first two equations hold and the third was lost. Partial pivoting takes the row with $1.667$ as the second pivot, and the noise entry only produces a multiplier of $8\times10^{-18}$.

### Example 3: the size of the damage, and a scaling trap

For $A=\begin{pmatrix}\varepsilon&1\\1&1\end{pmatrix}$ and $b=(1,2)$, the exact solution is close to $(1,1)$ and $\kappa_\infty(A)\approx4$ for all these $\varepsilon$:

```text
epsilon   error, no pivoting   error, partial pivoting
1e-08     5.0e-09              2.2e-16
1e-12     2.2e-05              0
1e-20     1.0  (x = (0, 1))    0
```

Partial pivoting compares raw sizes, so it depends on scaling. Multiply the first equation of the $\varepsilon=10^{-20}$ case by $10^{20}$: $\begin{pmatrix}1&10^{20}\\1&1\end{pmatrix}$ with $b=(10^{20},2)$. The solution is the same, but the first column is now a tie, no swap happens, and both a hand-written LU and `numpy.linalg.solve` return $(0,1)$. Dividing each row by its largest entry first recovers $(1,1)$. Partial pivoting assumes rows of comparable scale.

The damage also appears without any planted entry. Take `rng = numpy.random.default_rng(42)`, `A = rng.uniform(-1, 1, (1000, 1000))`, `x = rng.uniform(-1, 1, 1000)`, `b = A @ x`, for which $\kappa_2=4269$. With relative forward error in the infinity norm:

```text
             forward error   backward error   growth    max |L|
no pivoting  4.5e-10         7.5e-13          2.9e+04   1.3e+03
partial      1.3e-12         1.3e-15          4.7e+01   1
```

Here pivoting saves more than two digits, and the implementation agrees with `numpy.linalg.solve` to $2.2\times10^{-12}$.

### Example 4: the counts, run

An instrumented loop that increments a counter at every arithmetic operation, on random matrices:

```text
n    sub      mul      div    factor   formula  forward  back   solve  2n^2-n
2    1        1        1      3        3        2        4      6      6
3    5        5        3      13       13       6        9      15     15
10   285      285      45     615      615      90       100    190    190
100  328350   328350   4950   661650   661650   9900     10000  19900  19900
200  2646700  2646700  19900  5313300  5313300  39800    40000  79800  79800
```

For $n=2000$ the factorization costs $5.33\times10^9$ flops and one solve $8.0\times10^6$, so one factorization equals about 667 solves. For 100 right-hand sides, factoring once and solving 100 times costs $6.13\times10^9$ flops, against $5.34\times10^{11}$ for 100 separate eliminations, a factor of 87.

This also settles "just invert $A$". Solving for the $n$ columns of $A^{-1}$ adds $n(2n^2-n)$ to the factorization, about $\tfrac83n^3$ in this count (less if the zeros of the unit vectors are exploited), and then $A^{-1}b$ costs $2n^2-n$, exactly what the two triangular solves cost. It is no faster per right-hand side, and on the random matrix of Example 3 its backward error was $7.7\times10^{-14}$ against $2.0\times10^{-15}$ for `numpy.linalg.solve`, 38 times larger; seeds 0 to 3 gave factors from 22 to 52.

### Example 5: where partial pivoting is not enough, and where it is not needed

**Not enough.** The theorem bounds multipliers, not growth, and $\rho\le2^{n-1}$ can be attained. Take ones on the diagonal, $-1$ below it, and ones in the last column. Every entry below the diagonal ties with the pivot, so no swap happens (ties keep the current row), the last column doubles at each step, and for $n=60$:

```text
kappa_2 = 26.8   growth = 5.8e+17 (2^59)
numpy.linalg.solve: forward error 0.89, backward error 0.045
QR factorization:   forward error 3.0e-15
```

So partial pivoting is not backward stable in the worst case. It is the default because such matrices are rare in practice: over the 20 matrices `numpy.random.default_rng(s).uniform(-1, 1, (500, 500))` with $s=0,\dots,19$ the growth stayed between 25 and 41.

**Singular $A$.** $A$ with rows $(1,2,3)$, $(4,5,6)$, $(7,8,9)$ is singular and $b=(1,2,4)$ has no solution. Rounding leaves $u_{33}=-1.6\times10^{-16}$ instead of $0$, so `numpy.linalg.solve` raises nothing and returns entries of size $6\times10^{15}$. `scipy.linalg.solve` returns the same with an ill-conditioning warning. `numpy.linalg.solve` does raise `LinAlgError` on $\begin{pmatrix}1&2\\2&4\end{pmatrix}$, where the pivot is exactly $0$. A nonzero pivot does not prove nonsingularity.

**Not needed.** If each diagonal entry strictly dominates its column, it stays the largest, and partial pivoting never swaps. Take `rng = numpy.random.default_rng(42)`, `R = rng.uniform(-1, 1, (500, 500))`, `x = rng.uniform(-1, 1, 500)`, `b = A @ x`. With $A$ equal to $R$ except that each diagonal entry is replaced by $1$ plus the sum of the absolute values of the other entries of its column, there were 0 swaps, growth $1.00$, and no-pivot backward error $6\times10^{-16}$. The symmetric positive definite $A=R^TR+10^{-3}I$, with $\kappa_2=5\times10^5$, gave growth $0.95$ and backward error $8\times10^{-17}$ with no pivoting, and such matrices use Cholesky at about half the flops. `iterative-methods-jacobi-and-gauss-seidel` takes up the sparse case, where factorization has a different problem.

## Common Misconceptions & Pitfalls

- **"Pivoting is for zero pivots."** In floating point the dangerous pivot is the small one, and in Example 2 a true zero arrived disguised as $10^{-17}$.
- **"A bad answer means a bad matrix."** Example 2 has $\kappa_2=10.3$. The algorithm did the damage.
- **"Partial pivoting makes LU always stable."** Example 5 lost every digit at $n=60$ with $\kappa_2=26.8$. It is reliable in practice, not in the worst case.
- **"The simplex pivot is the same pivot."** One chooses a vertex and changes the solution. The other only reduces rounding and leaves the solution alone.
- **"A small residual means an accurate solution."** It means small backward error. The forward error is that times up to the condition number.
- **"Invert $A$, then multiply."** It costs more up front, the same per right-hand side, and its backward error was 38 times larger on the matrix of Example 4.
- **"`scipy.linalg.lu` gives $PA=LU$."** It gives $A=PLU$. Check the convention before using its $P$.

## Summary

LU decomposition is elimination with memory: the multipliers form a unit lower triangular $L$, the result is $U$, and $A=LU$ with nonsingular $U$ exists exactly when all leading principal submatrices are nonsingular. Partial pivoting takes the largest entry of each column, which gives $PA=LU$ for every square matrix with $\lvert l_{ij}\rvert\le1$. The factorization costs exactly $\tfrac23n^3-\tfrac12n^2-\tfrac16n$ flops and each solve $2n^2-n$, so reusing factors is the main practical gain. Without pivoting, a noise pivot of $10^{-17}$ destroyed a system with $\kappa_2=10.3$, and a random $n=1000$ system lost more than two digits. The pivot here reduces rounding and leaves the solution unchanged, unlike the simplex pivot. It depends on row scaling, it can be defeated by growth of $2^{n-1}$, and it is unnecessary for diagonally dominant and positive definite matrices.

## Documentation Links

- [Fundamentals of Numerical Computation, 2.4 LU factorization](https://fncbook.com/lu): the outer-product view of LU, and solving through triangular systems.
- [Fundamentals of Numerical Computation, 2.5 Efficiency of matrix computations](https://fncbook.com/efficiency): flop counting and asymptotic notation for matrix algorithms.
- [Fundamentals of Numerical Computation, 2.6 Row pivoting](https://fncbook.com/pivoting): failure of unpivoted LU, the PLU factorization, and why the largest entry is chosen.
- [Fundamentals of Numerical Computation, 2.9 Exploiting matrix structure](https://fncbook.com/structure): diagonal dominance, banded matrices, and Cholesky.
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic (Goldberg)](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): representation and rounding error, the source of the noise pivot.
- [SciPy, scipy.linalg.lu](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.lu.html): the factorization and its $A=PLU$ convention.
- [SciPy, scipy.linalg.lu_factor](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.lu_factor.html): compact in-place factors for reuse with `lu_solve`.
- [NumPy, numpy.linalg.solve](https://numpy.org/doc/stable/reference/generated/numpy.linalg.solve.html): the dense solver, built on LAPACK's `_gesv`.
