---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define $\kappa(A) = \lVert A\rVert\,\lVert A^{-1}\rVert$, compute it in the 1-, 2- and $\infty$-norms, and read it as the inverse of the relative distance to a singular matrix.
- Derive the bound $\lVert\Delta x\rVert/\lVert x\rVert \le \kappa(A)\,\lVert\Delta b\rVert/\lVert b\rVert$ and state the hypothesis needed when $A$ itself is perturbed.
- Explain why a tiny residual does not mean a tiny error, and connect the two through $\kappa$.
- Use "$\kappa \approx 10^t$ costs up to $t$ digits" as a ceiling, not a prediction.
- Measure the Hilbert matrix losing digits, and tell a bad condition number from a small determinant or from bad scaling.

## Context & Motivation

`conditioning-and-numerical-stability` separates the sensitivity of a problem from the quality of an algorithm. This lesson puts a number on that sensitivity for $Ax = b$. The number matters because solvers such as `lu-decomposition-and-partial-pivoting` and `iterative-methods-jacobi-and-gauss-seidel` hand back a vector with no comment attached. Later in this lesson, a $12\times12$ Hilbert system is solved with a relative residual of about $10^{-16}$ and a relative error of $30\%$. Nothing in the output hints at it, and `numpy.linalg.solve` raises no warning. The condition number is what predicts this.

## Core Theory

### Definition

For an invertible square matrix and an induced norm,

$$\kappa(A) = \lVert A\rVert\,\lVert A^{-1}\rVert,$$

and $\kappa(A) = \infty$ when $A$ is singular. Three facts follow directly. Since $1 = \lVert I\rVert = \lVert AA^{-1}\rVert \le \lVert A\rVert\,\lVert A^{-1}\rVert$, always $\kappa(A)\ge 1$. Since $(cA)^{-1} = c^{-1}A^{-1}$, $\kappa(cA) = \kappa(A)$ for $c \ne 0$. And in the 2-norm $\kappa_2(A) = \sigma_{\max}/\sigma_{\min}$, the ratio of the longest to the shortest axis of the ellipsoid that $A$ makes from the unit sphere; for a symmetric positive definite matrix this is $\lambda_{\max}/\lambda_{\min}$. The value depends on the norm, usually mildly: the $8\times8$ Hilbert matrix has $\kappa_2 = 1.53\times10^{10}$ and $\kappa_\infty = 3.39\times10^{10}$.

### Perturbing the right-hand side

**Hypotheses.** $A$ is invertible, $b \ne 0$, $Ax = b$ and $A(x+\Delta x) = b+\Delta b$. **Conclusion.**

$$\frac{\lVert\Delta x\rVert}{\lVert x\rVert} \le \kappa(A)\,\frac{\lVert\Delta b\rVert}{\lVert b\rVert}.$$

The proof is two lines. Subtracting gives $A\,\Delta x = \Delta b$, so $\lVert\Delta x\rVert \le \lVert A^{-1}\rVert\,\lVert\Delta b\rVert$. And $b = Ax$ gives $\lVert b\rVert \le \lVert A\rVert\,\lVert x\rVert$, that is, $1/\lVert x\rVert \le \lVert A\rVert/\lVert b\rVert$. Multiply the two. Equality needs both inequalities tight at once: $x$ in the direction $A$ stretches most and $\Delta b$ in the direction $A^{-1}$ stretches most. Example 1 attains it, so the bound cannot be improved in general.

### Perturbing the matrix

**Hypotheses.** $A$ is invertible, $b \ne 0$, and $\lVert A^{-1}\rVert\,\lVert\Delta A\rVert < 1$. **Conclusion.** $A+\Delta A$ is invertible, and the solution of $(A+\Delta A)(x+\Delta x) = b+\Delta b$ satisfies

$$\frac{\lVert\Delta x\rVert}{\lVert x\rVert} \le \frac{\kappa(A)}{1-\kappa(A)\,\lVert\Delta A\rVert/\lVert A\rVert}\left(\frac{\lVert\Delta A\rVert}{\lVert A\rVert}+\frac{\lVert\Delta b\rVert}{\lVert b\rVert}\right).$$

The hypothesis is not decoration. The smallest $\Delta A$ that makes $A$ singular has $\lVert\Delta A\rVert_2/\lVert A\rVert_2 = 1/\kappa_2(A)$, so $\kappa_2$ is exactly the inverse of the relative distance to a singular matrix. A perturbation that size can already leave no solution at all, so no bound can cover it (Example 2).

### Residual versus error

For a computed $\hat x$, the residual is $r = b - A\hat x$. Then $\hat x$ solves exactly the system with right-hand side $b - r$, so the first theorem gives

$$\frac{\lVert x-\hat x\rVert}{\lVert x\rVert} \le \kappa(A)\,\frac{\lVert r\rVert}{\lVert b\rVert}.$$

The residual measures backward error, and it is computable. The error is forward error, and it is not. An iteration from `iterative-methods-jacobi-and-gauss-seidel` that stops on a small residual has to pay this factor too.

Gaussian elimination with partial pivoting normally returns $\lVert r\rVert/(\lVert A\rVert\,\lVert\hat x\rVert)$ near unit roundoff $u$ (about $1.1\times10^{-16}$ in float64, $6.0\times10^{-8}$ in float32). Since $x-\hat x = A^{-1}r$, this gives $\lVert x-\hat x\rVert/\lVert\hat x\rVert \le \kappa(A)\,\lVert r\rVert/(\lVert A\rVert\,\lVert\hat x\rVert)$, about $\kappa u$. The ratio $\lVert r\rVert/\lVert b\rVert$ does not have to be near $u$: for $H_{12}$ with $x$ its smallest right singular vector it is $0.16$, while $\lVert r\rVert/(\lVert A\rVert\,\lVert\hat x\rVert) = 9.3\times10^{-18}$. Hence the working rule: with $\kappa \approx 10^t$, expect to lose **up to** $t$ of the roughly 16 (float64) or 7 (float32) significant digits. It is a ceiling from a worst-case bound, not a forecast.

### The Hilbert matrix

$H_n$ has entries $1/(i+j+1)$ for $i,j = 0,\ldots,n-1$. It is symmetric positive definite, and its inverse has integer entries (`scipy.linalg.invhilbert` with `exact=True` returns them as integers). It is a Gram matrix:

$$(H_n)_{ij} = \int_0^1 x^i x^j\, dx.$$

So $H_n$ is what appears when functions are fitted by polynomials in the monomial basis on $[0,1]$, and its bad conditioning says that $1, x, x^2, \ldots$ are nearly linearly dependent there. That thread continues in `least-squares-curve-fitting`. The known growth is $\kappa_2(H_n) = O\big((1+\sqrt2)^{4n}/\sqrt n\big)$, a factor approaching $(1+\sqrt2)^4 \approx 33.97$ per unit of $n$, which is about $1.5$ digits per row.

## Worked Examples

### Example 1: nearly parallel rows, and the bound attained

Take

$$A = \begin{pmatrix}1 & 1\\ 1 & 1.0001\end{pmatrix},\quad b = \begin{pmatrix}2\\ 2.0001\end{pmatrix},\quad x = \begin{pmatrix}1\\ 1\end{pmatrix}, \quad A^{-1} = \begin{pmatrix}10001 & -10000\\ -10000 & 10000\end{pmatrix}.$$

Then $\lVert A\rVert_\infty = 2.0001$ and $\lVert A^{-1}\rVert_\infty = 20001$, so $\kappa_\infty(A) = 40004.0001$. Also $\kappa_2(A) = 40002.0$. Changing $b_2$ by $10^{-4}$, to $2.0002$, gives $x+\Delta x = (0, 2)$. The relative change in $b$ is $5.0\times10^{-5}$ and in $x$ it is $1$, so the amplification is $20001$, half the bound.

The worst direction is $\Delta b = (\delta, -\delta)$. With $\delta = 10^{-6}$, exact arithmetic gives $x+\Delta x = (1.020001,\ 0.98)$. Now $\lVert\Delta x\rVert_\infty = 0.020001$, the relative change in $b$ is $\delta/2.0001$, and their ratio is $40004.0001$, exactly $\kappa_\infty(A)$.

### Example 2: when the hypothesis on $\Delta A$ fails

Keep $A$ and $b$ and change only $a_{22}$, using exact fractions. Write $\rho = \lVert A^{-1}\rVert_\infty\lVert\Delta A\rVert_\infty$.

```text
new a22    rho      solution x         rel. change   full bound   first-order kappa*dA/A
1.00009    0.200    (0.8889, 1.1111)   0.111         0.250        0.200
1.000001   1.980    (-98, 100)         99            not valid    1.980
1          2.000    none (singular)    undefined     not valid    2.000
```

At $\rho = 0.2$ the bound holds with room to spare. At $\rho = 1.98$ the hypothesis is gone, the formula's denominator is negative, and the first-order estimate $1.98$ is wrong by a factor of $50$. The last row has no solution at all, because $b$ is outside the range of the singular matrix.

### Example 3: the Hilbert matrix at real size

Solve $H_n x = b$ with `numpy.linalg.solve` in float64. The true solution is $x = (1,\ldots,1)$, and $b$ is computed in exact rationals and then rounded, so it is as good as float64 allows. Values of $\kappa_2$ come from 200-digit eigenvalues, and the residual column is $\lVert r\rVert_2/(\lVert H_n\rVert_2\lVert\hat x\rVert_2)$.

```text
 n   kappa_2    rel. residual   rel. error   correct digits   16 - log10(kappa)
 4   1.55e+04   0.00e+00        2.91e-13     12.5             11.8
 6   1.50e+07   6.86e-17        9.61e-11     10.0              8.8
 8   1.53e+10   3.27e-17        2.75e-07      6.6              5.8
10   1.60e+13   2.83e-17        3.15e-04      3.5              2.8
12   1.71e+16   8.21e-17        2.95e-01      0.5             -0.2
14   1.85e+19   2.06e-17        4.48e+00     -0.7             -3.3
16   2.02e+22   2.42e-17        6.35e+00     -0.8             -6.3
```

The residual stays below $10^{-16}$ while the error climbs to $100\%$ and past it. Up to $n=12$ the rule tracks the error, about one digit pessimistic. After that the ceiling is too high to be informative: at $n=14$ the error is $4.48$, nowhere near $\kappa u \approx 2000$. The ratio $\kappa_2(H_{n+1})/\kappa_2(H_n)$ rises from $27.2$ at $n=2$ to $32.8$ at $n=11$, moving toward $33.97$.

The same matrix sizes break the tools that measure them:

```text
 n   exact kappa_2   numpy.linalg.cond
12   1.71e+16        1.68e+16
13   5.63e+17        2.50e+18
14   1.85e+19        1.89e+17
16   2.02e+22        4.35e+17
```

Past $1/u$, the computed $\sigma_{\min}$ is rounding noise, and the answer can be wrong in either direction. `scipy.linalg.solve` emits a `LinAlgWarning` at $n=12$ (reported `rcond` $2.5\times10^{-17}$) and none at $n=8$; `numpy.linalg.solve` emitted no warning at any size tried.

### Example 4: the data alone does the damage

Is the solver to blame? Take the stored float64 $H_n$ and $b$ and solve them in exact rational arithmetic, so no operation rounds at all.

```text
 n   exact solve of stored data   numpy.linalg.solve
 8   2.91e-07                     2.75e-07
10   2.42e-04                     3.15e-04
12   1.43e-01                     2.95e-01
14   4.20e+00                     4.48e+00
```

Rounding $1/3$, $1/7$ and so on when storing the matrix already costs the same digits. This is conditioning, not instability. The stored matrix is measurably different too: $H_{14}$ has true smallest eigenvalue $9.9\times10^{-20}$, and its float64 copy has $-6.3\times10^{-18}$, so it is not even positive definite. For $H_{12}$, the relative distance to singularity is $5.8\times10^{-17}$, below $u$.

The same solver on the same size with a good matrix gives the control: the tridiagonal matrix with $2$ on the diagonal and $-1$ beside it, $n=12$, has $\kappa_2 = 67.8$, and the error for $x = (1,\ldots,1)$ is $3.2\times10^{-17}$.

float32 runs out sooner, as the rule says: the error is $2.0\times10^{-5}$ at $n=4$, $3.25\times10^{-2}$ at $n=6$ and $3.55$ at $n=8$. Because the Hilbert entries are known exactly, more digits do fix this case: with mpmath's `lu_solve` at 50 decimal digits, $H_{12}$ gives a relative 2-norm error between $2\times10^{-38}$ and $7\times10^{-37}$, depending on how $b$ is rounded. With measured data, extra working precision cannot restore what the data never had.

### Example 5: determinant and scaling are different questions

```text
matrix                     det      kappa_2
0.1 * I (size 20)          1e-20    1
[[1, 1e8], [0, 1]]         1        1e+16
[[1, 2], [3, 4]]           -2       14.9
[[1e10, 2e10], [3, 4]]     -2e10    2.5e+10
```

The determinant scales with the size of the entries; $\kappa$ does not. The last two rows are the same equations with the first one multiplied by $10^{10}$, as happens when one equation is written in different units. $\kappa$ jumps by nine orders, yet `numpy.linalg.solve` loses nothing: over 2000 random right-hand sides the worst relative error was $1.4\times10^{-15}$. Rescaling rows or columns changes $\kappa$, so equilibrate before reading it as a verdict.

## Common Misconceptions & Pitfalls

- **"A small residual means an accurate answer."** Only when $\kappa$ is moderate. In Example 3, $n=12$ has residual $8\times10^{-17}$ and error $30\%$.
- **"A small determinant means ill-conditioned."** $0.1\,I$ of size 20 has determinant $10^{-20}$ and $\kappa = 1$. A unit determinant can sit beside $\kappa = 10^{16}$.
- **"$\kappa = 10^{t}$ means exactly $t$ digits are lost."** It is a worst-case ceiling. The scaled matrix of Example 5 lost none, and the Hilbert solves lost about one digit fewer than the rule.
- **"A better solver will fix it."** Exact arithmetic on the stored data was just as bad (Example 4). The usual cures are reformulation (a better basis, as in `least-squares-curve-fitting`), rescaling, or exact data with more precision.
- **"`cond` always gives the true number."** Past about $1/u$ it reports noise (Example 3).
- **"The $\Delta A$ bound holds for any perturbation."** It needs $\lVert A^{-1}\rVert\,\lVert\Delta A\rVert < 1$ (Example 2).

## Summary

$\kappa(A) = \lVert A\rVert\,\lVert A^{-1}\rVert$ bounds how a relative change in $b$ or $A$ is amplified in $x$, the bound is attained, and for changes in $A$ it needs $\lVert A^{-1}\rVert\,\lVert\Delta A\rVert<1$. In the 2-norm it is $\sigma_{\max}/\sigma_{\min}$, and its inverse is the relative distance to singularity. The residual measures backward error and turns into forward error only after multiplying by $\kappa$, which gives the ceiling of about $\log_{10}\kappa$ digits lost. The Hilbert matrix, the Gram matrix of the monomials on $[0,1]$, shows it in full: $\kappa_2$ grows by nearly 34 per row, $n=12$ leaves about half a digit, and exact arithmetic on the stored data does no better. $\kappa$ is not the determinant, and it changes with scaling.

## Documentation Links

- [Fundamentals of Numerical Computation, 2.8 Conditioning of linear systems](https://fncbook.com/condition-number/): the matrix condition number, the perturbation theorem, and the residual as backward error.
- [MIT OpenCourseWare 18.335J, Week 2](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-2/): lecture summaries on norms, backward stability and condition numbers.
- [NumPy: numpy.linalg.cond](https://numpy.org/doc/stable/reference/generated/numpy.linalg.cond.html): the norms accepted and the SVD-based 2-norm computation.
- [SciPy: scipy.linalg.hilbert](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.hilbert.html): the entries $1/(i+j+1)$ used here.
- [SciPy: scipy.linalg.solve](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.solve.html): the solver, including its `LinAlgWarning` for ill-conditioned input.
- [Wikipedia: Hilbert matrix](https://en.wikipedia.org/wiki/Hilbert_matrix): the Gramian form and the growth rate of the condition number.
