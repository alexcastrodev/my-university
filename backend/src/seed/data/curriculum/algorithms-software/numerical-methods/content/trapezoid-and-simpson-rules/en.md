---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Derive the trapezoid and Simpson rules by integrating an interpolating polynomial, and write their composite forms.
- State each error term with its hypothesis: $f\in C^2[a,b]$ for trapezoid, $f\in C^4[a,b]$ for Simpson.
- Explain why Simpson's rule, built on a parabola, is exact for cubics.
- Measure an order of convergence from a table of errors, and show it dropping on an integrand that lacks the required derivatives.
- Choose $n$ from an error bound, and tell a bound from the true error.
- Say where rounding stops the convergence, and when a higher-degree rule makes things worse.

## Context & Motivation

The lesson `the-definite-integral-and-riemann-sums` built the trapezoid rule as the average of the left and right sums and observed its $O(1/n^2)$ rate on a table. An observed rate does not say which property of $f$ is responsible, or what to do when a function has no antiderivative and only samples are available.

This lesson reaches the same rule by another road: replace $f$ by a polynomial that interpolates it, then integrate the polynomial exactly. The interpolation error from `polynomial-interpolation-lagrange-and-newton` then turns into an exact error term, with a specific derivative in it. That derivative is the hypothesis, and removing it is what makes the order fall.

## Core Theory

### Integrate the interpolant

Let $p$ interpolate $f$ at nodes $x_0,\dots,x_d$ in $[a,b]$. Writing $p$ in the Lagrange basis gives

$$\int_a^b f\,dx \approx \int_a^b p\,dx = \sum_{i=0}^{d} w_i\, f(x_i), \qquad w_i = \int_a^b \ell_i(x)\,dx.$$

The weights depend on the nodes only, so they are computed once. With $H = b-a$ and $m = (a+b)/2$:

- **Degree 1**, nodes $a, b$: $w = H/2$ for each node, so $T = \frac{H}{2}\big(f(a)+f(b)\big)$.
- **Degree 2**, nodes $a, m, b$: integrating the three basis parabolas gives $H/6$, $4H/6$, $H/6$, so $S = \frac{H}{6}\big(f(a)+4f(m)+f(b)\big)$.

### The trapezoid error

If $f\in C^2[a,b]$, for each $x$ there is a $\xi(x)$ with $f(x)-p(x) = \frac12 f''(\xi(x))\,(x-a)(x-b)$. The factor $(x-a)(x-b)$ never changes sign on $[a,b]$, so the mean value theorem for integrals with a one-signed weight applies. Since $\int_a^b (x-a)(x-b)\,dx = -H^3/6$,

$$\int_a^b f\,dx - T = -\frac{H^3}{12}\,f''(\eta), \qquad \eta\in[a,b].$$

Split $[a,b]$ into $n$ panels of width $h=(b-a)/n$ and add the panels. Because $f''$ is continuous, the average of the $n$ values $f''(\eta_i)$ is itself a value of $f''$, which gives the composite result:

$$I - T_n = -\frac{(b-a)h^2}{12}\,f''(\xi), \qquad T_n = h\Big[\tfrac12 f_0 + f_1 + \dots + f_{n-1} + \tfrac12 f_n\Big].$$

For convex $f$ this says $T_n$ overestimates. As $h\to0$ the mean value tends to the average of $f''$, so $I-T_n \approx -\frac{h^2}{12}\big(f'(b)-f'(a)\big)$.

### Simpson gets one degree for free

The same argument stalls for Simpson. The factor $(x-a)(x-m)(x-b)$ changes sign at $m$, and its integral over $[a,b]$ is $0$ by symmetry. That zero is good news: it means the rule integrates every cubic exactly, one degree more than the parabola it was built from. Its **degree of precision** is 3.

To get the error, use a cubic that also matches $f'(m)$. For $f\in C^4[a,b]$,

$$f(x) - p_3(x) = \frac{f^{(4)}(\xi(x))}{24}\,(x-a)(x-m)^2(x-b),$$

and now the factor keeps one sign. Its integral is $-H^5/120$, and $\int p_3 = S$ because $S$ is exact for cubics and $p_3$ agrees with $f$ at the three nodes. Hence $I - S = -\frac{H^5}{2880}f^{(4)}(\eta)$. Each panel has $H=2h$, so the composite rule needs $n$ even, and

$$I - S_n = -\frac{(b-a)h^4}{180}\,f^{(4)}(\xi), \qquad S_n = \frac{h}{3}\big[f_0 + 4f_1 + 2f_2 + 4f_3 + \dots + 4f_{n-1} + f_n\big].$$

Both composite rules use $n+1$ evaluations of $f$:

```python
def trapezoid(f, a, b, n):
    x = np.linspace(a, b, n + 1); y = f(x); h = (b - a) / n
    return h * (y[0] / 2 + y[1:-1].sum() + y[-1] / 2)

def simpson(f, a, b, n):  # n even
    x = np.linspace(a, b, n + 1); y = f(x); h = (b - a) / n
    return h / 3 * (y[0] + y[-1] + 4 * y[1:-1:2].sum() + 2 * y[2:-1:2].sum())
```

### Why not one polynomial of high degree

More nodes in one polynomial can help when $f$ is very smooth: on $e^x$ over $[0,1]$, Newton-Cotes of degree 8 has error $9.8\times10^{-13}$, against $2.3\times10^{-6}$ for Simpson on the same nine nodes. On equally spaced nodes it can also fail badly. Take $f(x)=1/(1+25x^2)$ on $[-1,1]$, where $I = \frac25\arctan 5$. The closed Newton-Cotes rule of degree $d$ integrates the interpolant at $d+1$ equispaced nodes. Its weights, in units of the spacing, come from `scipy.integrate.newton_cotes`:

```text
 d   Newton-Cotes error   most negative weight   composite Simpson, same nodes
 4        7.46e-02              (none)                 1.93e-02
 8        2.49e-01              -1.28                  2.59e-02
12        6.12e-01              -16.7                  9.00e-03
16        1.80e+00              -168                   2.70e-03
20        5.92e+00              -1800                  7.79e-04
```

This is Runge's phenomenon, integrated. Negative weights also amplify rounding in $f$. Low degree on many panels is the usual remedy.

### Where the order drops

The orders 2 and 4 are promises under $C^2$ and $C^4$. Measured here by doubling $n$ from 1024 to 2048, except the last two rows, which fit a line through $n = 2^4,\dots,2^{16}$ because their errors are erratic:

```text
integrand on [0,1]     T order   S order   what fails
x^(1/2)                 1.50      1.50     f'  unbounded at 0
x^(3/2)                 2.00      2.50     f'' unbounded at 0
x^(5/2)                 2.00      3.49     f''' unbounded at 0
x^(7/2)                 2.00      3.99     f'''' unbounded at 0
|x - 1/sqrt(2)|         2.02      1.83     kink
step at 1/sqrt(2)       0.98      1.05     jump
```

On $\sqrt x$ Simpson's advantage disappears: both rules have order $3/2$. The row $x^{3/2}$ shows the hypotheses are sufficient, not necessary: $f''$ is unbounded, the theorem says nothing, and trapezoid still has order 2. For a kink, the remedy is to split the integral there. With $\lvert x-\tfrac14\rvert$ and $n$ a multiple of 4 the kink is a node and $T_n$ is exact, because $f$ is linear on every panel.

Order can also be better than promised. For $f(x)=e^{\cos x}$ over the full period $[0,2\pi]$, a smooth periodic integrand:

```text
 n    trapezoid error   Simpson error
 8      1.25e-06         1.15e-02
16      1.78e-15         4.17e-07
32      1.78e-15         2.66e-15
```

Both are far ahead of $h^2$ and $h^4$, and trapezoid beats Simpson. The next lesson, `error-orders-and-adaptive-quadrature`, explains why.

### Rounding stops the convergence

The error terms above are truncation only. Run the trapezoid rule on $e^x$ over $[0,1]$ in float32, with a plain running sum:

```text
      n     float32 error   truncation h^2(e-1)/12
     16       5.591e-04         5.593e-04
    256       2.182e-06         2.185e-06
   1024       2.018e-07         1.366e-07
   4096       5.594e-07         8.535e-09
  65536       6.786e-07         3.334e-11
 262144       7.474e-06         2.084e-12
1048576       3.066e-04         1.302e-13
```

Up to $n\approx 256$ truncation dominates. Past $n\approx 2000$ the error stops falling, and past $65536$ it grows, because the accumulated rounding of the sum (see `sources-of-error-truncation-rounding-propagation`) passes the shrinking truncation. In float64 the same effect sits far lower. Simpson on this integral has error $8.66\times10^{-15}$ at $n=1024$, which is still truncation (predicted $8.68\times10^{-15}$), and rounding shows at $n=2048$: $6.66\times10^{-16}$ against a predicted $5.43\times10^{-16}$.

## Worked Examples

### Example 1: exact for cubics, not for quartics

Take $f(x)=x^3-2x+1$ on $[0,2]$ with one Simpson panel: $f(0)=1$, $f(1)=0$, $f(2)=5$, so $S = \frac{2}{6}(1+0+5) = 2$, and the exact integral is $2$. For $f(x)=x^4$ on $[0,1]$ with $n=2$, $h=\tfrac12$: $S_2 = \frac{1}{6}\big(0+\tfrac{4}{16}+1\big) = \tfrac{5}{24}$ against $\tfrac15$, so $I-S_2 = -\tfrac{1}{120}$. The error formula gives $-\frac{1\cdot(1/2)^4}{180}\cdot 24 = -\tfrac{1}{120}$, exactly, because $f^{(4)}$ is constant.

### Example 2: measuring both orders on $e^x$

For $I=\int_0^1 e^x\,dx = e-1$, a script prints the errors, the ratio on doubling $n$, the order $\log_2(\text{ratio})$, and the predicted leading terms $h^2(e-1)/12$ and $h^4(e-1)/180$.

```text
  n    |I-T_n|   ratio  order   predicted    |I-S_n|   ratio  order   predicted
  4   8.940e-03                 8.949e-03   3.701e-05                 3.729e-05
  8   2.237e-03  3.997  2.00    2.237e-03   2.326e-06  15.91  3.99    2.331e-06
 16   5.593e-04  3.999  2.00    5.593e-04   1.456e-07  15.98  4.00    1.457e-07
 32   1.398e-04  4.000  2.00    1.398e-04   9.103e-09  15.99  4.00    9.104e-09
 64   3.496e-05  4.000  2.00    3.496e-05   5.690e-10  16.00  4.00    5.690e-10
128   8.740e-06  4.000  2.00    8.740e-06   3.556e-11  16.00  4.00    3.556e-11
```

Both $T_n - I$ and $S_n - I$ are positive here, as the signs of the error terms predict for $f''>0$ and $f^{(4)}>0$.

### Example 3: choosing $n$ from a bound

The integrand of $\int_0^1 e^{-x^2}dx$ has no elementary antiderivative; the value is $\frac{\sqrt\pi}{2}\operatorname{erf}(1) \approx 0.746824$. Aim for error $10^{-6}$. Here $f''=(4x^2-2)e^{-x^2}$ and $f^{(4)}=(16x^4-48x^2+12)e^{-x^2}$, whose absolute values on $[0,1]$ peak at $x=0$ with values $2$ and $12$. So:

- Trapezoid: $\frac{2}{12n^2}\le10^{-6}$ needs $n\ge 409$.
- Simpson: $\frac{12}{180n^4}\le10^{-6}$ needs $n\ge16.07$, so the first even value is $n=18$.

That is 410 evaluations against 19. Both bounds are safe and pessimistic: at $n=409$ the trapezoid error is $3.67\times10^{-7}$, and at $n=18$ the Simpson error is $7.78\times10^{-8}$. Scanning $n$ with the exact value shows the target is first met at $n=248$ for trapezoid ($9.97\times10^{-7}$) and $n=10$ for Simpson ($8.15\times10^{-7}$).

### Example 4: where trapezoid is exact and Simpson is wrong

The ROC curve of `evaluation-metrics-precision-recall-and-roc`, built from a finite sample with distinct scores, is a polyline. Rank ten examples by score, with labels $1,1,0,1,1,0,1,0,0,0$ (five positives, five negatives). The trapezoid rule through the ROC points gives AUC $=0.84$, which equals the fraction of positive-negative pairs ranked correctly, computed separately. It is exact because the rule integrates each straight segment exactly. Passing the same points to `scipy.integrate.simpson` returned $0.68$ with no warning (SciPy 1.15.3): the curve has vertical segments, so $x$ repeats, and a parabola through such points means nothing. The higher-order rule is the wrong tool for data that is not smooth.

### Example 5: checking against the libraries

On $e^x$ with $n=10$ and $n=100$, the two functions above agree with `scipy.integrate.trapezoid` and `scipy.integrate.simpson` to within $4.5\times10^{-16}$.

Book versus today: books say $n$ must be even, which means an odd number of samples. `scipy.integrate.simpson` also accepts an even number of samples, and handles the leftover interval with a correction. With 12 samples the order stays near 4 (measured 3.96), but exactness for cubics is gone: on $x^3$ the error is $1.7\times10^{-5}$ with 12 samples and $0$ with 11. Older code calls `scipy.integrate.trapz` and `simps`, which no longer exist in SciPy, and `numpy.trapz`, which was deprecated in NumPy 2.0 and removed in 2.4 in favor of `numpy.trapezoid`.

## Common Misconceptions & Pitfalls

- **"Simpson is always more accurate than trapezoid."** It has the higher order on $C^4$ integrands. On $\sqrt x$ the orders tie, on a smooth periodic integrand trapezoid wins, and on a step at $x=\tfrac13$ with $n=64$ the Simpson error ($5.2\times10^{-3}$) is twice the trapezoid error ($2.6\times10^{-3}$).
- **"A parabola can only be exact for parabolas."** Simpson is exact for cubics, by symmetry.
- **"Doubling $n$ divides the error by 16."** Only under $C^4$ and in the asymptotic range. On $\sqrt x$ the factor is 2.83, and in float32 it can be below 1.
- **"Higher degree means higher accuracy."** On the Runge function, degree 20 on equispaced nodes has error 5.92.
- **"The bound is the error."** It is a guarantee, here about 2.7 times too large for trapezoid at $n=409$.
- **"Simpson needs an even number of points."** It needs an even number of panels, so an odd number of points.

## Summary

Integrating a degree-1 or degree-2 interpolant gives the trapezoid and Simpson rules. For $f\in C^2$ the composite trapezoid error is $-(b-a)h^2 f''(\xi)/12$, and for $f\in C^4$ the composite Simpson error is $-(b-a)h^4 f^{(4)}(\xi)/180$, with $n$ even. Simpson gains a degree because the cubic term integrates to zero. These orders were measured on $e^x$ as 2.00 and 4.00, and they fall on integrands without the derivatives (1.50 for both on $\sqrt x$, about 1 at a jump). They can also be exceeded, as trapezoid does on smooth periodic integrands. Raising the degree of a single equispaced rule diverges on the Runge function, so low degree on many panels is the usual choice. Rounding sets a floor that float32 shows clearly. Fixed $n$ still needs a derivative bound you rarely have, which is the problem the next lesson solves.

## Documentation Links

- [Fundamentals of Numerical Computation, 5.6 Numerical integration](https://fncbook.com/integration): the trapezoid formula, its error, the Euler-Maclaurin expansion, and Simpson's formula.
- [MIT OCW 18.330, Chapter 2: Integrals as sums and derivatives as differences](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/aab35b69b416758992779e2ad508b286_MIT18_330S12_Chapter2.pdf): rectangle and trapezoidal rules analyzed with Taylor expansions.
- [SciPy, scipy.integrate.trapezoid](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.trapezoid.html): composite trapezoid rule on sampled data.
- [SciPy, scipy.integrate.simpson](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.simpson.html): composite Simpson rule on sampled data, with its exactness conditions.
- [NumPy, numpy.trapezoid](https://numpy.org/doc/stable/reference/generated/numpy.trapezoid.html): the NumPy trapezoid function that replaces `trapz`.
