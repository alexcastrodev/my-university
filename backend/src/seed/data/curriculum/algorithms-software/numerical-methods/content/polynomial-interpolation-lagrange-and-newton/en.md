---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Prove that $n+1$ distinct nodes determine one polynomial of degree at most $n$, and explain why the Vandermonde system is the wrong way to compute it.
- Build the interpolant in Lagrange form, in barycentric form, and in Newton form with divided differences, and add a node to the Newton form.
- State the interpolation error formula with its hypotheses and use it to bound an error.
- Measure Runge's phenomenon, and separate true divergence of the polynomial from rounding amplified by the Lebesgue constant.
- Say what Chebyshev nodes fix and what they do not.

## Context & Motivation

A Taylor polynomial matches a function at one point. An interpolant matches it at many, and `taylor-and-maclaurin-series-with-error-bounds` already showed interpolation at Chebyshev nodes beating the Taylor polynomial of the same degree for $\sin$ by a factor of more than 250. Interpolation is also the raw material of quadrature in `trapezoid-and-simpson-rules`. The same Lagrange formula runs over finite fields in Reed-Solomon codes and Shamir secret sharing, where arithmetic is exact and nothing in this lesson about rounding applies.

Over floating-point numbers, three things can go wrong even though the polynomial is unique: the basis can be ill-conditioned in the sense of `the-matrix-condition-number`, the node positions can make the polynomial itself diverge, and the data's rounding can be amplified. These are separate failures, and this lesson measures each one.

## Core Theory

### Existence and uniqueness

Given distinct nodes $x_0,\ldots,x_n$ and any values $y_0,\ldots,y_n$, exactly one polynomial $p$ of degree at most $n$ has $p(x_j) = y_j$. Uniqueness: the difference of two such polynomials has degree at most $n$ and $n+1$ roots, so it is zero. Existence: the Lagrange form below builds it. The nodes must be distinct, since a repeated node with two different values admits no function at all.

So the "Lagrange polynomial" and the "Newton polynomial" are one polynomial written in two bases. Only their numerical behavior differs. Writing it in the monomial basis means solving a Vandermonde system $Vc = y$, whose condition number grows fast: for 21 nodes, $\kappa_2(V)$ is $8.3\times10^{8}$ for equispaced nodes on $[-1,1]$ and $8.9\times10^{16}$ on $[0,1]$.

### Lagrange and barycentric forms

The cardinal polynomials are $\ell_j(x) = \prod_{k\ne j}\frac{x-x_k}{x_j-x_k}$, with $\ell_j(x_i)$ equal to 1 when $i=j$ and 0 otherwise, so $p(x) = \sum_j y_j\ell_j(x)$. Evaluated directly this costs $O(n^2)$ per point. With weights $w_j = 1/\prod_{k\ne j}(x_j-x_k)$ and $\omega(x) = \prod_k (x-x_k)$, we have $p(x) = \omega(x)\sum_j \frac{w_j y_j}{x-x_j}$. The constant function 1 is its own interpolant, so $1 = \omega(x)\sum_j\frac{w_j}{x-x_j}$. Dividing cancels $\omega$ and gives the **barycentric formula**, for $x$ not a node:

$$p(x) = \frac{\sum_j \dfrac{w_j y_j}{x-x_j}}{\sum_j \dfrac{w_j}{x-x_j}}.$$

Setup is $O(n^2)$ and each evaluation is $O(n)$. This is what `scipy.interpolate.BarycentricInterpolator` computes.

### Newton form and divided differences

Write $p(x) = c_0 + c_1(x-x_0) + c_2(x-x_0)(x-x_1) + \cdots$. The coefficients are the **divided differences** $c_k = f[x_0,\ldots,x_k]$, defined by $f[x_i] = y_i$ and

$$f[x_i,\ldots,x_{i+k}] = \frac{f[x_{i+1},\ldots,x_{i+k}] - f[x_i,\ldots,x_{i+k-1}]}{x_{i+k}-x_i}.$$

The table takes $O(n^2)$ work, and nested multiplication evaluates $p$ in $O(n)$. Adding a node appends one row, $O(n)$ work, and leaves every earlier $c_k$ unchanged.

### The error formula

**Hypotheses.** $f \in C^{n+1}[a,b]$, the nodes are distinct points of $[a,b]$, and $x \in [a,b]$. **Conclusion.** There is $\xi \in [a,b]$, depending on $x$, with

$$f(x) - p(x) = \frac{f^{(n+1)}(\xi)}{(n+1)!}\,\omega(x), \qquad \omega(x) = \prod_{k=0}^n (x-x_k).$$

It reads like the Taylor remainder with $(x-a)^{n+1}$ replaced by $\omega$. Two factors compete: the derivative belongs to $f$, and $\omega$ belongs to the nodes.

### Nodes and the Lebesgue constant

On $[-1,1]$, the **Chebyshev nodes** $x_k = \cos\frac{(2k+1)\pi}{2n+2}$, $k=0,\ldots,n$, are the zeros of $T_{n+1}$. They give $\max\lvert\omega\rvert = 2^{-n}$, the smallest value any choice of $n+1$ nodes can reach. Equispaced nodes leave $\omega$ small in the middle and large at the ends: for $n=20$, $\lvert\omega\rvert$ is $4.3\times10^{-9}$ near $x=0.05$ and $2.3\times10^{-4}$ near the ends, against a maximum of $9.5\times10^{-7}$ for Chebyshev ($8.3\times10^{-7}$ at $x=0.05$). On $[a,b]$, map by $x\mapsto\frac{a+b}{2}+\frac{b-a}{2}x$.

The nodes also fix the conditioning of the data-to-polynomial map. Changing the values by at most $\varepsilon$ changes $p$ by at most $\Lambda_n\varepsilon$, where $\Lambda_n = \max_x\sum_j\lvert\ell_j(x)\rvert$ is the **Lebesgue constant**:

```text
n    Lambda_n equispaced   Lambda_n Chebyshev
10   2.99e+01              2.49
20   1.10e+04              2.90
40   4.69e+09              3.33
60   2.98e+15              3.58
```

For $f$ analytic on an open interval containing $[-1,1]$, interpolation at Chebyshev nodes converges geometrically: the max error is at most $CK^{-n}$ for some $C>0$, $K>1$. For equispaced nodes no such statement holds.

## Worked Examples

### Example 1: one polynomial, three forms, one new node

Interpolate $(0,1), (1,3), (2,2), (4,5)$. The denominators $\prod_{k\ne j}(x_j-x_k)$ are $-8, 3, -4, 24$, so $w = (-\tfrac18, \tfrac13, -\tfrac14, \tfrac1{24})$. At $x=3$ the barycentric sums are

$$\frac{-\frac1{24}+\frac12-\frac12-\frac5{24}}{-\frac1{24}+\frac16-\frac14-\frac1{24}} = \frac{-1/4}{-1/6} = \frac32.$$

The divided-difference table, with Newton coefficients on top of each column:

```text
x   f      f[,]   f[,,]   f[,,,]
0   1      2      -3/2    7/12
1   3      -1     5/6
2   2      3/2
4   5
```

So $p(x) = 1 + 2x - \tfrac32 x(x-1) + \tfrac7{12}x(x-1)(x-2)$, which expands to $\tfrac7{12}x^3 - \tfrac{13}4x^2 + \tfrac{14}3x + 1$ and gives $p(3) = \tfrac32$ again. Symbolic expansion of the Lagrange form returns the same cubic, and `BarycentricInterpolator` and `KroghInterpolator` both return $1.5$ at $x=3$.

Now add $(3,0)$. One new row gives $5$, $\tfrac72$, $\tfrac43$, $\tfrac14$, so $p$ gains only the term $\tfrac14x(x-1)(x-2)(x-4)$. That term is zero at the four old nodes and equals $-\tfrac32$ at $x=3$, which takes $\tfrac32$ to $0$.

### Example 2: checking the error formula

For $f = e^x$ on $[0,1]$ with nodes $0, \tfrac13, \tfrac23, 1$, the fourth derivative lies in $[1,e]$. Calculus gives $\max\lvert\omega\rvert = \tfrac1{81}$, at $x = \tfrac12\pm\tfrac{\sqrt5}{6}$. So the max error is between $\frac{1}{24\cdot81} = 5.14\times10^{-4}$ and $\frac{e}{24\cdot81} = 1.40\times10^{-3}$. Measured on a grid of $10^5$ points it is $9.24\times10^{-4}$, near $x = 0.875$. There the formula gives $e^\xi = 1.797$, that is, $\xi = 0.586$, inside $[0,1]$ as promised.

### Example 3: Runge's phenomenon

Take $f(x) = 1/(1+25x^2)$ on $[-1,1]$, which is in $C^\infty$ and looks harmless. Max errors on a grid of 20001 points, with the equispaced case repeated in 200-digit arithmetic:

```text
 n   equispaced   equispaced exact   Chebyshev
 5   4.33e-01     4.33e-01           5.56e-01
10   1.92e+00     1.92e+00           1.09e-01
20   5.98e+01     5.98e+01           1.53e-02
40   1.05e+05     1.05e+05           2.89e-04
60   1.64e+08     2.29e+08           5.42e-06
80   6.31e+14     5.46e+11           1.02e-07
```

The hypotheses of the error formula hold; the formula just stops helping. Since $f^{(2k)}(0)$ has size $(2k)!\,25^{k}$, the factor $f^{(n+1)}(\xi)/(n+1)!$ can grow like $5^{n+1}$, so the bound is useless here, and it cannot locate the trouble: at $n=40$, $5^{41}\lvert\omega(0.025)\rvert = 3.9\times10^{11}$ in a region where the method works. What separates the regions is the pole. For this $f$ the error is exactly $\omega(x)\cdot2\operatorname{Re}\big[1/(50z\,\omega(z)(x-z))\big]$ with $z=i/5$, so it scales with $\lvert\omega(x)/\omega(i/5)\rvert$, which at $n=40$ is $1.5\times10^{-5}$ at $x=0.025$ and $2.9\times10^{5}$ at $x=0.975$. The exact-arithmetic column proves this is real divergence and not rounding. The worst point moves toward the end, $x\approx0.94$ at $n=10$ and $0.989$ at $n=40$, while the middle converges: on $\lvert x\rvert\le\tfrac12$ the error is $0.116$, $0.0153$ and $5.5\times10^{-4}$ at $n=10,20,40$. Rounding joins in at the bottom of the table: at $n=80$ the float64 value is about 1000 times the exact one.

For Chebyshev nodes the observed factor per degree stays between $1.218$ and $1.220$ from $n=40$ to $n=160$, and the error reaches rounding level near $n=160$. Complex analysis predicts the rate from the poles of $f$ at $\pm i/5$: $\tfrac15+\sqrt{1+\tfrac1{25}} = 1.2198$. Note the first row: at $n=5$ Chebyshev is worse.

### Example 4: when rounding is the whole story

$e^x$ on $[-1,1]$ has no Runge problem, since $\lvert f^{(n+1)}\rvert \le e$ and the formula forces convergence.

```text
 n   equispaced float64   equispaced exact   Chebyshev float64
10   2.35e-10             2.35e-10           2.71e-11
20   2.12e-12             4.82e-24           2.22e-15
30   2.78e-09             1.02e-39           2.66e-15
40   2.34e-06             9.37e-57           2.66e-15
50   1.15e-03             7.98e-75           2.66e-15
60   9.66e-01             9.94e-94           3.11e-15
```

The true polynomial at $n=60$ is accurate to 93 digits, and float64 returns garbage of size 1. `BarycentricInterpolator` shows the same growth ($0.78$ at $n=60$), so this is not a coding error. Multiply out $e\,u\,\Lambda_n$ with $u = 1.1\times10^{-16}$: $3.3\times10^{-12}$, $1.4\times10^{-6}$ and $0.89$ at $n=20,40,60$, the size of the observed errors. Here the truncation error is gone and the rounding of the data, amplified by $\Lambda_n$, is everything left.

### Example 5: the same polynomial, five implementations

Chebyshev nodes, $f$ from Example 3, $n=60$, float64. All five lines compute one mathematical object:

```text
method                                     max error
barycentric                                5.42e-06
Newton, Leja node order                    5.42e-06
Vandermonde, increasing powers             4.33e-03
Newton, nodes sorted left to right         1.43e+00
Vandermonde, decreasing powers (default)   5.24e+01
```

Leja order picks each next node to maximize the product of distances to those already chosen. Node order is the only difference between the two Newton lines, and at $n=120$ the gap is $3.6\times10^{-11}$ against $3.2\times10^{24}$. The Vandermonde lines have $\kappa_2(V) = 4.5\times10^{22}$, solve the system with `numpy.linalg.solve`, and use the nodes in the order $k=0,\ldots,n$. Their values are rounding noise: column order moves the error by four orders of magnitude here, sorting the nodes gives $0.048$ and $3.66$ instead, and the digits can change between machines. For $e^x$ the same matrices give $5.3\times10^{-15}$ with increasing powers and $3.0\times10^{-10}$ with decreasing powers, so $\kappa$ bounds the worst right-hand side, and this smooth data is not it. A direct implementation of the barycentric formula matches `BarycentricInterpolator` to $1.1\times10^{-15}$ at $n=20$ and $n=40$.

### Example 6: when smoothness fails

$f(x) = \lvert x\rvert$ is continuous but has no derivative at $0$, so the error formula does not apply.

```text
 n   equispaced exact   Chebyshev   n * Chebyshev error
10   6.64e-01           5.46e-02    0.55
20   9.52e+01           2.85e-02    0.57
40   1.47e+07           1.46e-02    0.58
80   2.45e+18           7.37e-03    0.59
```

Equispaced interpolation diverges. Chebyshev converges, but only like $1/n$: the geometric rate needed analyticity. Continuity alone is not enough for any fixed node table: Faber's theorem says every table has some continuous function whose interpolants diverge.

## Common Misconceptions & Pitfalls

- **"More nodes always give a better fit."** Examples 3, 4 and 6 show errors growing with $n$, for three different reasons.
- **"Runge's phenomenon is a rounding effect."** The exact-arithmetic column of Example 3 diverges too. Example 4 is the opposite case: there the exact polynomial is fine and only rounding hurts.
- **"Lagrange and Newton give different answers."** Uniqueness makes them one polynomial. They differ in cost and rounding.
- **"The Newton form is safe in any node order."** Example 5 shows five orders of magnitude of difference from ordering alone at $n=60$.
- **"Chebyshev nodes are always better."** They lost at $n=5$ in Example 3, they give only $1/n$ for $\lvert x\rvert$, and they require choosing where to sample. For data already sampled on a fixed grid, see `splines` and `least-squares-curve-fitting`.
- **"Book vs today."** The SciPy documentation warns that `scipy.interpolate.lagrange` is numerically unstable, says not to expect more than about 20 points, and marks it deprecated since version 1.18 in favor of `BarycentricInterpolator`.

## Summary

There is one polynomial of degree at most $n$ through $n+1$ distinct nodes. The barycentric form evaluates it stably in $O(n)$ per point; the Newton form adds nodes cheaply but depends on node order; the monomial form inherits a Vandermonde condition number. The error is $f^{(n+1)}(\xi)\,\omega(x)/(n+1)!$ for $f \in C^{n+1}$. Equispaced nodes make $\omega$ and the Lebesgue constant large near the ends, which gives true divergence for $1/(1+25x^2)$ ($10^5$ at $n=40$) and rounding blow-up for $e^x$ (about $1$ at $n=60$). Chebyshev nodes keep $\Lambda_n$ under 4 in these runs and give geometric convergence for analytic functions, at a rate set by the poles ($1.2198$ per degree for $1/(1+25x^2)$), but only $1/n$ for $\lvert x\rvert$.

## Documentation Links

- [Fundamentals of Numerical Computation, 9.1 Polynomial interpolation](https://fncbook.com/polynomial/): existence, uniqueness, Lagrange form and the error formula.
- [Fundamentals of Numerical Computation, 9.2 The barycentric formula](https://fncbook.com/barycentric/): derivation of the barycentric weights and formula.
- [Fundamentals of Numerical Computation, 9.3 Stability of polynomial interpolation](https://fncbook.com/stability-1/): Runge's phenomenon, Chebyshev nodes and spectral convergence.
- [MIT OpenCourseWare 18.330, Chapter 3: Interpolation](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter3/): Lagrange interpolation, the error theorem and the Runge phenomenon.
- [SciPy: BarycentricInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.BarycentricInterpolator.html): the library interpolator used to check these results, with notes on node choice.
- [SciPy: KroghInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.KroghInterpolator.html): an alternative interpolator and its warning on ill-conditioning.
- [SciPy: scipy.interpolate.lagrange](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.lagrange.html): the warning and deprecation note quoted in the pitfalls.
- [Wikipedia: Polynomial interpolation](https://en.wikipedia.org/wiki/Polynomial_interpolation): the Lebesgue constant and the theorem on divergence for every table of nodes.
