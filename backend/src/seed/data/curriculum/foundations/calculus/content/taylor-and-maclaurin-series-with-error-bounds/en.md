---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Build the Taylor polynomial $T_n$ and the Taylor series of a function at a point $a$, and the Maclaurin series when $a = 0$.
- State Taylor's theorem with the Lagrange remainder, including its hypotheses, and use $\lvert R_n\rvert \le M\lvert x-a\rvert^{n+1}/(n+1)!$ with $M$ taken over the whole interval between $a$ and $x$.
- Compute how many terms a target accuracy requires, and check that the bound holds against the true error.
- Explain why a Taylor series can converge without converging to the function, and why it can fail to converge where the function is perfectly defined.
- Choose between expansions (or around different centers) to reach an accuracy with far fewer terms.

## Context & Motivation

A computer can add, subtract, multiply, and divide. Everything else, such as $e^x$, $\sin x$, or $\ln x$, has to be reduced to those four operations, and the natural way is a polynomial. A Taylor polynomial is the polynomial that matches a function and its first $n$ derivatives at one point. The degree-1 version is the tangent line, the linearization behind gradient-based optimization. The degree-2 version adds curvature, which is the local model behind Newton's method for minimization.

Approximating without knowing the error is guessing. This lesson's real subject is the **remainder**: a bound on $f(x) - T_n(x)$ that depends only on the derivatives of $f$ and so can be computed before the approximation is ever evaluated. The bound turns "how many terms do I need?" into an inequality that can be solved. It builds directly on `power-series-and-the-radius-of-convergence`: the Taylor series of a function is a power series, so it has a radius, and its behavior at the endpoints follows the tests of `convergence-tests`.

## Core Theory

### Taylor polynomials and series

Suppose $f$ has derivatives of all orders at $a$. The **Taylor polynomial** of degree $n$ at $a$ is

$$T_n(x) = \sum_{k=0}^{n} \frac{f^{(k)}(a)}{k!}(x-a)^k,$$

and the **Taylor series** is the series $\sum_{k=0}^\infty \frac{f^{(k)}(a)}{k!}(x-a)^k$ whose partial sums are these polynomials. It is defined by its coefficients alone; whether it converges at a given $x$ is a separate question. At $a=0$ it is called the **Maclaurin series**. The coefficients are forced by the requirement that $T_n$ match $f$ and its first $n$ derivatives at $a$, which is the same formula $c_k = f^{(k)}(a)/k!$ that term-by-term differentiation gave in the previous lesson. The error is $R_n(x) = f(x) - T_n(x)$.

### Taylor's theorem and the Lagrange remainder

**Hypotheses.** $f^{(n)}$ is continuous on the closed interval $I$ between $a$ and $x$, and $f^{(n+1)}$ exists on the open interval inside it. **Conclusion.** There is a number $\xi$ strictly between $a$ and $x$ such that

$$R_n(x) = \frac{f^{(n+1)}(\xi)}{(n+1)!}(x-a)^{n+1}.$$

The point $\xi$ is not known, so the theorem is used through a bound. If $\lvert f^{(n+1)}(t)\rvert \le M$ for all $t$ in $I$, then

$$\lvert R_n(x)\rvert \le \frac{M\,\lvert x-a\rvert^{n+1}}{(n+1)!}.$$

The value $M$ must bound the derivative on the whole interval between $a$ and $x$, not just at $a$. The case $n=0$ is the Mean Value Theorem, $f(x)-f(a) = f'(\xi)(x-a)$ (see `the-mean-value-theorem-and-monotonicity`), so Taylor's theorem is its higher-order generalization.

### When the series equals the function

The Taylor series converges to $f(x)$ exactly when $R_n(x) \to 0$. Both parts can fail separately.

For $e^x$ every derivative is $e^x$, so $M = e^{\lvert x\rvert}$ works for any $x$ and $\lvert R_n\rvert \le e^{\lvert x\rvert}\lvert x\rvert^{n+1}/(n+1)! \to 0$, because factorials outgrow exponentials. The same argument with $M=1$ works for $\sin$ and $\cos$. These three series therefore equal their functions on all of $\mathbb R$.

Convergence of the series alone does not settle it. The function $f(x) = e^{-1/x^2}$ for $x\neq0$, with $f(0)=0$, has $f^{(k)}(0) = 0$ for every $k$ (Example 4). Its Maclaurin series is identically $0$, so it converges everywhere, and it equals $f$ only at $x=0$. The function is infinitely differentiable but not equal to its Taylor series.

The series can also stop short of the function's domain. $\ln(1+x)$ is defined for all $x>-1$, but its Maclaurin series has radius $1$ and diverges at $x = 2$.

### Standard Maclaurin series

- $e^x$: $\sum x^n/n!$, converging to the function for all real $x$.
- $\sin x$: $\sum (-1)^n x^{2n+1}/(2n+1)!$, converging to the function for all real $x$.
- $\cos x$: $\sum (-1)^n x^{2n}/(2n)!$, converging to the function for all real $x$.
- $\frac{1}{1-x}$: $\sum x^n$, converging to the function for $-1 < x < 1$.
- $\ln(1+x)$: $\sum_{n\ge1} (-1)^{n+1} x^n/n$, converging to the function for $-1 < x \le 1$.
- $\arctan x$: $\sum (-1)^n x^{2n+1}/(2n+1)$, converging to the function for $-1 \le x \le 1$.

The last three are the ones where endpoints matter. For $\ln(1+x)$ the endpoint $x=1$ is included and $x=-1$ is excluded (it gives $-\sum 1/n$).

### Three ways to bound an error

1. **Lagrange bound**, as above, for any smooth function.
2. **Alternating series bound**, $\lvert R_N\rvert \le b_{N+1}$, when the terms alternate and decrease to $0$ (see `convergence-tests`). It needs no derivatives.
3. **Geometric tail bound**, when terms are dominated by a ratio $r<1$: the sum of the terms from $t_K$ on is at most $t_K/(1-r)$ if each term is at most $r$ times the previous one.

### How many terms are needed

Fix the tolerance $\varepsilon$, the point $x$, and a bound $M$. The smallest $n$ with $M\lvert x-a\rvert^{n+1}/(n+1)! \le \varepsilon$ guarantees the accuracy. It is a guarantee, not a prediction: the true error is often several times smaller.

## Worked Examples

### Example 1: $e$ to six decimals, and a wrong $M$

Approximate $e = e^1$ with the Maclaurin polynomial at $a=0$, $x=1$, tolerance $10^{-6}$. On $[0,1]$ every derivative of $e^x$ is at most $e<3$, so take $M=3$. Then $\lvert R_n\rvert \le 3/(n+1)!$. Because $3/9! = 8.3\times10^{-6}$ and $3/10! = 8.27\times10^{-7}$, the first $n$ that works is $n=9$, that is, $T_9(1) = \sum_{k=0}^9 1/k!$. A script compares the bound with the actual error $e - T_n(1)$:

```text
n   bound 3/(n+1)!   actual error
7   7.44e-05         2.79e-05
8   8.27e-06         3.06e-06
9   8.27e-07         3.03e-07
10  7.52e-08         2.73e-08
```

The bound holds for every $n$ (a script confirms it for $n=0,\ldots,30$ in 80-digit arithmetic), and here it is about $2.7$ times too large. Here $n=8$ really does miss the target: its actual error is $3.06\times10^{-6}$. If $M=1$ had been used, taking $f^{(10)}(0)$ instead of the maximum on $[0,1]$, the bound would read $1/10! = 2.76\times10^{-7}$ at $n=9$, smaller than the actual error $3.03\times10^{-7}$. A wrong $M$ is not just loose; it is false.

### Example 2: $\sin 1$ to ten decimals

With $M=1$ (any derivative of $\sin$ is $\pm\sin$ or $\pm\cos$), $\lvert R_n(1)\rvert \le 1/(n+1)!$. We need $1/(n+1)! < 10^{-10}$, which first happens at $n+1 = 14$ ($13! = 6.2\times10^9$ is too small, $14! = 8.7\times10^{10}$ is enough). Hence $n=13$, and $T_{13}(1) = 0.8414709848087\ldots$ against $\sin 1 = 0.8414709848079\ldots$, with actual error $7.6\times10^{-13}$ and bound $1.1\times10^{-11}$. The bound is loose by a factor of $15$ because the Taylor polynomial of $\sin$ has no even terms, so $T_{13}=T_{14}$ and the bound with $n=14$ gives $1/15! = 7.6\times10^{-13}$, the actual error to two digits. The bound is only as sharp as the $n$ it is applied with.

### Example 3: the same number, far fewer terms ($\ln 2$ and $\sin 3$)

The series $\ln(1+x) = \sum (-1)^{n+1}x^n/n$ at $x=1$ gives $\ln 2$, and the alternating bound is $\lvert R_N\rvert \le 1/(N+1)$. Reaching $10^{-10}$ would take about $10^{10}$ terms. (The Lagrange bound agrees: on $[0,1]$ the maximum of $\lvert f^{(N+1)}\rvert$ is $N!$, giving $1/(N+1)$.) A smarter route subtracts the series for $\ln(1-x)$ to get

$$\ln\frac{1+y}{1-y} = 2\sum_{k\ge0}\frac{y^{2k+1}}{2k+1}, \qquad \lvert y\rvert<1.$$

Taking $y=\tfrac13$ gives $\ln 2$. Each term is smaller than the previous by at least a factor of $y^2 = \tfrac19$, so the tail after $K$ terms is at most $2y^{2K+1}/\big((2K+1)(1-y^2)\big)$. This is below $10^{-10}$ at $K=10$ (bound $1.0\times10^{-11}$, actual error $1.0\times10^{-11}$), against $10^{10}$ terms before. Ten terms instead of ten billion: the form of the expansion matters more than the number of terms.

Changing the center helps in the same way. To get $\sin 3$ to within $10^{-10}$ from the Maclaurin series, the bound $3^{n+1}/(n+1)!$ first drops below $10^{-10}$ at $n=21$ (bound $2.8\times10^{-11}$, actual error $3.6\times10^{-12}$). Expanding at $a=\pi$ instead, where $x-a = 3-\pi = -0.1416$ is small, the bound $\lvert x-a\rvert^{n+1}/(n+1)!$ is below $10^{-10}$ already at $n=7$ (bound $4.0\times10^{-12}$, actual error $6.3\times10^{-14}$). The polynomial is $T_7(3) = -\big[h - h^3/3! + h^5/5! - h^7/7!\big]$ with $h = 3-\pi$, because $\sin x = -\sin(x-\pi)$. Four nonzero terms replace eleven.

### Example 4: a function not equal to its Taylor series

Let $f(x) = e^{-1/x^2}$ for $x\ne0$ and $f(0)=0$. For every $k$, $f^{(k)}(x)$ is a sum of terms of the form $p(1/x)\,e^{-1/x^2}$ with $p$ a polynomial, and $e^{-1/x^2}$ goes to $0$ faster than any power of $x$, so $f^{(k)}(0)=0$ (a script verifies this by limits for $k=1,\ldots,5$). The Maclaurin series is $0+0x+0x^2+\cdots$. But $f(0.5) = e^{-4} = 0.0183$ and $f(1) = 0.3679$. The series converges at every $x$, to the wrong value. In Taylor's theorem terms: $R_n(x) = f(x)$ for all $n$, and it never tends to $0$.

### Example 5: where the bound is useless

For $\ln(1+x)$ at $x=2$ (outside the radius), $\lvert f^{(n+1)}\rvert = n!/(1+t)^{n+1} \le n!$ on $[0,2]$, giving $\lvert R_n(2)\rvert \le 2^{n+1}/(n+1)$, which grows without bound, and the partial sums confirm it: $T_3(2) = 2.67$, $T_5(2) = 5.07$, $T_{10}(2) = -64.8$, $T_{20}(2) = -34\,360$, while $\ln 3 = 1.0986$. The bound is not merely weak; the series genuinely diverges, because the terms $2^n/n$ do not tend to $0$. At $x=\tfrac12$, by contrast, the same bound $0.5^{n+1}/(n+1)$ is $9.5\times10^{-7}$ at $n=15$, with actual error $6.5\times10^{-7}$.

### Example 6: Taylor is not what libraries use ("book vs today")

A degree-7 Taylor polynomial for $\sin$ on $[-\pi/2,\pi/2]$ has maximum error $1.57\times10^{-4}$, at the ends, matching the Lagrange bound $(\pi/2)^9/9! = 1.60\times10^{-4}$ (using $n=8$ since $T_7=T_8$). A polynomial interpolating $\sin$ at 9 Chebyshev nodes (degree 8, which reduces to degree 7 for an odd function) has maximum error $5.95\times10^{-7}$ on the same interval. The best possible degree-7 polynomial (minimax) has maximum error about $5.9\times10^{-7}$, found by linear programming on a fine grid, with an error curve that equioscillates at five points as the theory requires. The Taylor polynomial is therefore about 270 times worse than the best polynomial of its degree. Taylor polynomials are exact at a single point and degrade away from it. Production math libraries typically combine range reduction with polynomials fitted to minimize the worst-case error over the whole interval, which is a refinement of the idea in this lesson and not a repeal of it.

## Common Misconceptions & Pitfalls

- **"The Taylor series of $f$ always equals $f$."** Example 4 is infinitely differentiable and has a Taylor series that equals it only at one point. Equality needs $R_n \to 0$.
- **"If the function is defined at $x$, the Taylor series converges there."** $\ln(1+x)$ at $x=2$ is the counterexample (Example 5); the radius of the series is the limit.
- **"Take $M$ from the derivative at the center."** $M$ must bound the derivative on the whole interval between $a$ and $x$. Example 1 shows a bound that is smaller than the true error.
- **"The bound is the error."** It is an upper bound; the true error is often several times smaller. Do not report it as an estimate.
- **"More terms always help."** Outside the interval of convergence they make things worse (Example 5), and inside it, precision and floating-point rounding limit what is gained.
- **"The bound covers all the error."** The Lagrange bound covers truncation only. A floating-point evaluation has its own rounding error, which this lesson does not bound.

## Summary

The Taylor polynomial $T_n(x)=\sum_{k\le n} f^{(k)}(a)(x-a)^k/k!$ matches $f$ and its first $n$ derivatives at $a$, and the Taylor series is the series whose partial sums they are. Taylor's theorem, valid when $f^{(n)}$ is continuous on the interval and $f^{(n+1)}$ exists inside it, gives the remainder $f^{(n+1)}(\xi)(x-a)^{n+1}/(n+1)!$ and the bound $M\lvert x-a\rvert^{n+1}/(n+1)!$, with $M$ over the whole interval. Solving that bound for $n$ answers "how many terms", and a script can confirm the bound against the true error. The series equals the function only where $R_n\to0$: this holds for $e^x$, $\sin x$ and $\cos x$ everywhere, for $\ln(1+x)$ on $(-1,1]$, and fails for the flat function $e^{-1/x^2}$ at every $x \ne 0$. Choosing the expansion or the center well, as for $\ln 2$ with $y=\tfrac13$ and $\sin 3$ at $a=\pi$, can matter far more than adding terms.

## Documentation Links

- [OpenStax Calculus Volume 2, 6.3 Taylor and Maclaurin Series](https://openstax.org/books/calculus-volume-2/pages/6-3-taylor-and-maclaurin-series): Taylor polynomials, Taylor's theorem with remainder, and the standard Maclaurin series.
- [OpenStax Calculus Volume 2, 6.4 Working with Taylor Series](https://openstax.org/books/calculus-volume-2/pages/6-4-working-with-taylor-series): binomial series, using Taylor series to evaluate and approximate, and error estimates.
- [MIT OpenCourseWare 18.01SC, Session 98: Taylor's Series](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-98-taylors-series/): Taylor's series from successive approximations, with the coefficient formula.
- [MIT OpenCourseWare 18.01SC, Session 99: Taylor's Series, Continued](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-99-taylors-series-continued/): convergence of an alternating Taylor series and further examples.
