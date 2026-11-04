---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Set up a curve fit as $\min\lVert Ax-b\rVert_2$ for any model linear in its parameters, with the rank hypothesis it needs.
- Show that $\kappa_2(A^TA)=\kappa_2(A)^2$, and measure how many digits the normal equations lose against QR on an ill-conditioned fit.
- Solve a least-squares problem by QR, by hand and in code, and check it against `numpy.linalg.lstsq`.
- Explain how the size of the residual changes the accuracy of every method.
- Choose a basis and a scaling so that the fit is well conditioned, and recognize when no basis can save it.

## Context & Motivation

`least-squares-via-linear-algebra` derived the normal equations $A^TAx=A^Tb$ twice, by projection and by gradient, and `linear-regression-as-least-squares` wrote the closed form $\theta=(X^TX)^{-1}X^Ty$ for a linear model. Those lessons settle what the answer is. This one asks how to compute it in float64, and the formula turns out to be a poor algorithm. It is the fitting counterpart of the Hilbert matrix story in `the-matrix-condition-number`.

Fitting also finishes what interpolation started. `polynomial-interpolation-lagrange-and-newton` and `splines` force the curve through every point, which is the wrong goal when the data has noise. With fewer parameters than points, the curve smooths instead.

## Core Theory

### The problem

Take a model $g(x)=\sum_{j=1}^{n} c_j\varphi_j(x)$, linear in the coefficients $c_j$ and possibly not in $x$, and data $(x_i,y_i)$ for $i=1,\ldots,m$ with $m>n$. With $A_{ij}=\varphi_j(x_i)$ and $b_i=y_i$, find $c$ minimizing $\lVert Ac-b\rVert_2$. **Hypothesis:** $A$ has full column rank. Then the minimizer is unique. Without it there are infinitely many (Example 6).

### Why the normal equations lose digits

From the SVD $A=U\Sigma V^T$ we get $A^TA=V\Sigma^2V^T$, so for full column rank

$$\kappa_2(A^TA)=\kappa_2(A)^2.$$

Forming $A^TA$ and solving by Cholesky takes about $mn^2+\tfrac13n^3$ flops. It is cheap, but the problem handed to the solver is conditioned like the square of the original, and the error scales accordingly. With $\kappa_2(A)=10^8$, $A^TA$ is at the edge of what float64 can tell from singular.

### QR

Write $A=QR$ in reduced form: $Q$ is $m\times n$ with orthonormal columns and $R$ is $n\times n$ upper triangular. Full column rank makes $R$ invertible. Substituting into the normal equations and cancelling $R^T$ leaves

$$Rx=Q^Tb.$$

Nothing gets squared in this step: $\kappa_2(R)=\kappa_2(A)$, because multiplying by $Q$ preserves 2-norms. Householder QR costs about $2mn^2-\tfrac23n^3$ flops, roughly twice the normal equations when $m\gg n$. `numpy.linalg.lstsq` goes further and works from the singular values, which also reveal numerical rank.

### What the residual does

The sensitivity of least squares itself is not simply $\kappa(A)$. It has a term near $\kappa(A)$ and a term in $\kappa(A)^2\tan\theta$, where $\theta$ is the angle between $b$ and the range of $A$. The second term takes over once $\tan\theta$ is about $1/\kappa(A)$, which is $5\times10^{-8}$ for $\kappa(A)=2.1\times10^7$, so a residual that looks tiny can already trigger it. So QR is not always immune to $\kappa^2$: it matches the true sensitivity of the problem, while the normal equations pay for $\kappa^2$ regardless (Example 3).

### The basis

Polynomials of degree at most $d$ form one space, but each basis gives a different $A$. A monomial basis on $[0,1]$ has columns that nearly coincide, and the Gram matrix $A^TA/m$ tends to the Hilbert matrix as $m$ grows. Chebyshev polynomials on the data's interval keep the columns far from parallel, though they are not orthogonal on equispaced data: at $d=12$ on 100 equispaced points the largest cosine between two columns is $0.465$, against $0.999$ for monomials on $[0,1]$. Changing basis is a change in the problem's conditioning, while changing solver is not.

## Worked Examples

### Example 1: QR by hand on a familiar fit

Use the four points of `least-squares-via-linear-algebra`, $(0,1),(1,1),(2,2),(3,2)$, which gave $y=0.9+0.4x$. The columns of $A$ are $a_1=(1,1,1,1)$ and $a_2=(0,1,2,3)$. Gram-Schmidt gives $r_{11}=2$, $q_1=\tfrac12(1,1,1,1)$, $r_{12}=q_1\cdot a_2=3$. Then $a_2-3q_1=(-1.5,-0.5,0.5,1.5)$, so $r_{22}=\sqrt5$. With $b=(1,1,2,2)$, $Q^Tb=(3,\ 2/\sqrt5)$, and back substitution on

$$\begin{pmatrix}2&3\\0&\sqrt5\end{pmatrix}\begin{pmatrix}c\\m\end{pmatrix}=\begin{pmatrix}3\\2/\sqrt5\end{pmatrix}$$

gives $m=\tfrac25$, $c=\tfrac9{10}$, the same line. `numpy.linalg.qr` returns $R$ with both diagonal entries negative and the same solution. Here $\kappa_2(A)=3.76$ and $\kappa_2(A^TA)=14.13=3.76^2$.

### Example 2: normal equations against QR on a real fit

Fit degree $d$ monomials to $m=100$ equispaced points on $[0,1]$, with $y=\sin 4x$ plus Normal noise of standard deviation $0.01$ (seed 42). The reference is the exact minimizer of the stored $A$ and $y$, computed with 250 digits, so the table measures solver error only.

```python
Q, R = np.linalg.qr(A)
x_qr = scipy.linalg.solve_triangular(R, Q.T @ y)
c = scipy.linalg.cho_factor(A.T @ A, lower=True)
x_ne = scipy.linalg.cho_solve(c, A.T @ y)
```

Relative errors in the coefficients and in the fitted values $Ax$:

```text
 d   kappa(A)   kappa(A^T A)   coef NE    coef QR    curve NE   curve QR
 4   6.65e+02   4.42e+05       3.90e-12   4.90e-15   1.87e-13   1.07e-15
 6   2.07e+04   4.27e+08       2.91e-10   5.47e-14   5.78e-13   9.33e-16
 8   6.56e+05   4.31e+11       6.48e-06   5.38e-12   8.03e-09   2.31e-14
10   2.12e+07   4.47e+14       4.35e-03   4.08e-10   7.70e-06   1.36e-12
12   6.90e+08   4.76e+17       2.64e-01   8.68e-08   7.63e-05   2.46e-11
14   2.27e+10   5.16e+20       fails      3.26e-07   fails      9.13e-10
```

At $d=10$ QR keeps about 9 coefficient digits and the normal equations about 2. At $d=14$, Cholesky reports the matrix is not positive definite. Falling back to LU there gives coefficient error $1.0$. The computed residual norm gives the failure away: at $d=18$ that fallback reports $0.0745$, higher than the $0.0725$ of $d=12$, which is impossible for a true minimizer over a larger space. QR gives $0.0664$.

`numpy.linalg.lstsq` agrees with the QR code: at $d=12$ the coefficients differ by $6.8\times10^{-14}$ in relative terms. Agreement is not accuracy: both sit $8.68\times10^{-8}$ from the exact minimizer, and only the high-precision reference shows that. The normal-equation digits are noise too: with the default `lower=False`, the error at $d=10$ is $7.98\times10^{-3}$ instead of $4.35\times10^{-3}$. Notice that curves are more accurate than coefficients. Errors go mostly into combinations of nearly dependent columns, which barely change $Ax$.

The link to the Hilbert matrix is measurable. For $d=9$ and $10^5$ midpoints, $A^TA/m$ differs from $H_{10}$ by at most $7.5\times10^{-11}$ per entry, and their condition numbers are $1.602\times10^{13}$ and $1.603\times10^{13}$.

### Example 3: the residual changes the picture

Keep $d=10$ and build $b=A\mathbf 1+t\hat r$. Here $\hat r$ is `numpy.random.default_rng(0).normal(size=100)` with its projection on the range of $A$ removed in high precision, then normalized, repeated for 40 successive draws. The residual norm is $t$ and $\lVert A\mathbf 1\rVert\approx39$. Coefficient errors:

```text
residual t   NE median   QR median   QR min     QR max     QR worse than NE
0            7.17e-03    5.01e-10    (no r, one case)      0
1e-03        6.33e-03    6.56e-09    1.37e-10   2.93e-08   0 of 40
1e-01        6.15e-03    6.44e-07    2.54e-08   2.95e-06   0 of 40
1            5.71e-03    6.44e-06    2.59e-07   2.95e-05   0 of 40
1e+02        4.82e-03    6.44e-04    2.60e-05   2.95e-03   3 of 40
1e+04        6.19e-02    6.44e-02    2.60e-03   2.95e-01   18 of 40
```

The QR error grows linearly with $t$, the $\kappa^2\tan\theta$ term at work, and `lstsq` has the same medians from $t=0.1$ on. Already at $t=10^{-3}$ the median is 13 times the value at $t=0$. The slope depends on the direction of $\hat r$, by a factor of about 100 across these draws. The normal equations stay near $6\times10^{-3}$ until the residual dwarfs the fit. The advantage of QR shrinks from about seven orders of magnitude to nothing: at $t=10^4$ it loses in 18 of the 40 draws.

### Example 4: the basis is the real fix

$\kappa_2(A)$ for the same 100 points and the same polynomial space:

```text
 d   monomial on [0,1]   monomial on [-1,1]   Chebyshev on [-1,1]
 4   6.65e+02            1.85e+01             2.33
 8   6.56e+05            5.31e+02             2.81
12   6.90e+08            1.63e+04             2.92
16   7.56e+11            5.24e+05             2.94
```

With the Chebyshev basis at $d=12$, even the normal equations reach coefficient error $1.1\times10^{-15}$, against $5.3\times10^{-16}$ for QR, and `numpy.polynomial.Chebyshev.fit` matches the QR coefficients to $1.0\times10^{-15}$. So the normal equations are not always wrong. On a $2\times10^6\times10$ Chebyshev matrix ($\kappa_2=3.7$), they took $0.02$ s against $0.18$ s for `lstsq` and $0.32$ s for `qr` on one machine, with answers differing by $2.8\times10^{-14}$. That gap is larger than the flop ratio of 2, partly because `qr` also forms $Q$ explicitly. $A^TA$ can also be accumulated row by row in $O(n^2)$ memory, which suits streams too long to store.

A good basis has limits. With $m=100$ equispaced points, the Chebyshev $\kappa_2$ is $3.0$ at $d=18$, $112$ at $d=40$, $3.0\times10^{6}$ at $d=60$ and $8.1\times10^{13}$ at $d=80$. At $d=60$ the fitted curve reaches about $9559$ between samples of data bounded by about 1. Runge's phenomenon is back, in a problem where no basis helps.

Keeping $d$ well under $m$ avoids it. Max errors for Runge's $1/(1+25x^2)$ sampled at $m$ equispaced points:

```text
  m   d=10       d=20       d=30       d=40       d=60
 41   1.03e-01   6.39e-02   4.75e+00   1.05e+05   
101   1.02e-01   1.39e-02   5.60e-03   1.53e-02   5.51e+00
401   1.01e-01   1.39e-02   1.91e-03   2.61e-04   1.70e-05
```

The case $m=41$, $d=40$ is interpolation, and it reproduces the blow-up of the earlier lesson. The best degree rises with $m$, staying far below it.

### Example 5: fitting a trend on Unix timestamps

Take 720 hourly latency samples starting at $t=1.7\times10^9$ s, an illustrative series with mean near 135 ms and a quadratic trend. Fit a parabola to raw $t$.

```python
t = 1.7e9 + 3600 * np.arange(720.0)
days = (t - 1.7e9) / 86400
y = 120 + 0.6 * days + 0.02 * days**2 + np.random.default_rng(7).normal(0, 1.5, 720)
c, _, rank, _ = np.linalg.lstsq(np.vander(t, 3), y, rcond=None)   # rank == 2
p = np.polynomial.Polynomial.fit(t, y, 2)                         # maps t to [-1, 1]
```

The raw matrix has $\kappa_2=1.67\times10^{25}$. The default cutoff, $720\,\varepsilon_{\text{mach}}\sigma_1$, removes the smallest singular value with no warning, and the returned rank is 2. The curvature comes back as $0.00006$ ms per day$^2$ instead of $0.0205$, the residual norm is $52.6$ instead of $37.5$, and the forecast one week past the data is $161.4$ ms instead of $169.7$. Mapping $t$ to $[-1,1]$ gives $\kappa_2=3.75$. `Polynomial.fit` matches the exact fit to $3\times10^{-12}$ ms. `numpy.polyfit` scales columns internally and gets $2\times10^{-9}$ ms.

### Example 6: when the hypotheses fail

**Rank deficiency.** Take $x=0,0,1,1,2,2$ and $y=1, 1.2, 2, 2.2, 5, 4.8$ with a cubic: four coefficients, three distinct abscissas, rank 3. Infinitely many cubics share the best fitted values. Cholesky fails, unpivoted QR gives $r_{44}=1.5\times10^{-15}$ and coefficients up to $6\times10^{13}$, and `lstsq` reports rank 3 and returns the minimum-norm solution, in ascending powers, $(1.10,\ 0.457,\ 0.364,\ 0.179)$. `numpy.polyfit` warns that the fit may be poorly conditioned.

**A model not linear in its parameters.** $y=ae^{bx}$ is not of the form above. Taking logarithms makes it linear, but it needs $y>0$ and minimizes a different sum. For `x = np.linspace(0, 4, 30)` and `y = 2 * np.exp(0.8 * x) + np.random.default_rng(11).normal(0, 1, 30)`, the log fit gives $a=2.159$, $b=0.767$ with squared error $24.7$. A direct fit with `scipy.optimize.curve_fit` gives $a=2.038$, $b=0.789$ with squared error $19.6$.

## Common Misconceptions & Pitfalls

- **"$(A^TA)^{-1}A^Tb$ is how to compute the fit."** It defines the answer. Example 2 shows it losing about twice the digits of QR once $\kappa$ is large.
- **"Normal equations are always bad."** With a well-conditioned $A$ they match QR and cost less (Example 4).
- **"QR always gives error $\kappa u$."** Once $\tan\theta$ passes about $1/\kappa$, the term $\kappa^2\tan\theta$ dominates, even for a residual that looks tiny (Example 3).
- **"Any QR will do."** At $d=12$ the loss of orthogonality $\lVert Q^TQ-I\rVert_2$ is $3.0$ for classical Gram-Schmidt, $2.0\times10^{-8}$ for modified Gram-Schmidt and $1.1\times10^{-15}$ for Householder. Solving through $Q^Tb$ gives coefficient errors of $1.0$, $1.9\times10^{-5}$ and $8.7\times10^{-8}$.
- **"`lstsq` warns when something is wrong."** It returns `rank` and raises no warning. Example 5 lost a whole degree of freedom silently, so check `rank` against the number of columns.
- **"A smaller residual means a better model."** The minimum residual can only fall as $d$ rises, while the fit at $d=60$ in Example 4 swings to about $9559$ between samples.
- **"Book vs today."** The NumPy documentation marks `numpy.polyfit` as part of the old polynomial API and prefers `numpy.polynomial`, whose `fit` methods map the data to a standard window.

## Summary

Minimizing $\lVert Ac-b\rVert_2$ has a unique solution when $A$ has full column rank, and the normal equations characterize it without being the right way to compute it, because $\kappa_2(A^TA)=\kappa_2(A)^2$. On a monomial fit with $\kappa_2(A)=2.1\times10^7$, the normal equations left coefficient error $4.4\times10^{-3}$ and QR left $4.1\times10^{-10}$. QR solves $Rx=Q^Tb$ at about twice the flops, `lstsq` adds rank detection through singular values, and a residual with $\tan\theta$ above about $1/\kappa$ degrades both through $\kappa^2\tan\theta$. The strongest tool is the basis: mapping the data to $[-1,1]$ and using Chebyshev polynomials brought $\kappa_2$ from $6.9\times10^8$ to $2.9$ at $d=12$, after which even the normal equations work. Keep the degree well below $m$, and check `rank`.

## Documentation Links

- [Fundamentals of Numerical Computation, 3.2 The normal equations](https://fncbook.com/normaleqns/): the flop count, the squared condition number, and an instability example.
- [Fundamentals of Numerical Computation, 3.3 The QR factorization](https://fncbook.com/qr/): thin QR and the least-squares solution through it.
- [Fundamentals of Numerical Computation, 3.4 Computing QR factorizations](https://fncbook.com/house/): Householder reflectors and the flop count.
- [MIT OpenCourseWare 18.335J, Week 4](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-4/): lecture summaries on normal equations, loss of orthogonality in Gram-Schmidt, and Householder QR.
- [NumPy: numpy.linalg.lstsq](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html): the minimum-norm solution, the default `rcond` and the returned rank.
- [NumPy: numpy.linalg.qr](https://numpy.org/doc/stable/reference/generated/numpy.linalg.qr.html): the reduced factorization used here.
- [NumPy: numpy.polyfit](https://numpy.org/doc/stable/reference/generated/numpy.polyfit.html): the old polynomial API note and the rank warning.
- [NumPy: Polynomial.fit](https://numpy.org/doc/stable/reference/generated/numpy.polynomial.polynomial.Polynomial.fit.html): fitting with a mapped domain.
- [NumPy: Chebyshev.fit](https://numpy.org/doc/stable/reference/generated/numpy.polynomial.chebyshev.Chebyshev.fit.html): fitting in the Chebyshev basis.
- [SciPy: scipy.optimize.curve_fit](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.curve_fit.html): nonlinear least squares for models such as $ae^{bx}$.
