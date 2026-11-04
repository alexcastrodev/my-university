---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define the order of a quadrature rule as an asymptotic statement, and estimate it even without the exact integral.
- Use the Euler-Maclaurin expansion to explain the even powers in the trapezoid error and its behavior on periodic integrands.
- Apply Richardson extrapolation, derive Simpson's rule from it, and build a Romberg table.
- Show what extrapolation does when the assumed power of $h$ is wrong, and repair it.
- Turn two Simpson estimates into an error estimate and an adaptive algorithm that spends evaluations where the error is.
- Compare an adaptive routine with `scipy.integrate.quad` by evaluations and achieved error, and name inputs that defeat both.

## Context & Motivation

In `trapezoid-and-simpson-rules`, choosing $n$ needed a bound on $f''$ or $f^{(4)}$ over the whole interval, and one $h$ was used everywhere. Neither fits real use. A library receives only a callable and a tolerance, and an integrand such as a sharp peak needs fine panels in one place and coarse ones elsewhere.

Both problems have the same answer: compare the rule with itself at two resolutions. The difference between them estimates the error, without any derivative. It can improve the result (Richardson extrapolation) or decide where to refine (adaptive quadrature).

## Core Theory

### Order, measured

A method $A(h)$ for $I$ has **order** $p$ on an integrand $f$ if $A(h) - I = Ch^p + o(h^p)$ with $C\ne0$ as $h\to0$. Three things are packed in there: it is about the limit $h\to0$, it depends on $f$, and it says nothing about a particular $h$. For a composite rule of degree of precision $d$ on $f\in C^{d+1}$, each panel contributes $O(h^{d+2})$ and there are $O(1/h)$ panels, so the error is $O(h^{d+1})$: $O(h^2)$ for trapezoid, $O(h^4)$ for Simpson. The order is exactly $d+1$ when the leading constant is nonzero. It can be higher for a particular $f$, as the next section shows.

With the exact value, $p\approx\log_2\big(E(h)/E(h/2)\big)$. Without it, three resolutions are enough, since

$$\rho = \frac{A(h)-A(h/2)}{A(h/2)-A(h/4)} \to 2^p.$$

For the trapezoid rule on $e^x$ over $[0,1]$, $\rho = 3.996$ from $n=4,8,16$. On $\sqrt x$, $\rho$ is $2.804$, $2.816$, $2.820$ starting from $n=64$, $256$, $512$, heading to $2^{3/2}=2.828$. The exact integral was not used.

### The Euler-Maclaurin expansion

If $f\in C^{2m}[a,b]$, the composite trapezoid rule satisfies

$$T(h) - I = \frac{h^2}{12}\big[f'\big]_a^b - \frac{h^4}{720}\big[f'''\big]_a^b + \dots + O(h^{2m}), \qquad [g]_a^b = g(b)-g(a).$$

Only even powers appear, and only endpoint derivatives enter. On $e^x$ with $n=8$: the first term is $2.237346\times10^{-3}$, two terms give $2.236763488\times10^{-3}$, and the true difference is $2.236763705\times10^{-3}$. The series is asymptotic: for fixed $h$ it need not converge as more terms are added.

Two consequences follow at once.

- If $f'(a)=f'(b)$, the $h^2$ term vanishes. For $x^2(1-x)^2$ on $[0,1]$, $T_n - I$ is $-8.138\times10^{-6}$ at $n=8$ and $-5.086\times10^{-7}$ at $n=16$, a measured order of 4.00, matching the next term $-h^4/30$.
- If $f$ is $C^\infty$ and periodic with period $b-a$, every bracket vanishes, so the error beats every power of $h$. That explains the table for $e^{\cos x}$ in the previous lesson.

### Richardson extrapolation

Suppose $A(h) = I + Ch^p + O(h^q)$ with $q>p$ and $p$ known. Eliminating $C$ from $A(h)$ and $A(h/2)$ gives

$$R(h) = \frac{2^p A(h/2) - A(h)}{2^p - 1} = I + O(h^q).$$

No new function evaluations are needed. For the trapezoid rule, $p=2$, $q=4$, and the combination is exactly Simpson's rule: $S_{2n} = (4T_{2n} - T_n)/3$. So Simpson can be read as the trapezoid rule with its leading error removed.

The expansion has only even powers, so this can be repeated. **Romberg integration** fills a table with $R_{i,0}=T_{2^i}$ and

$$R_{i,j} = \frac{4^j R_{i,j-1} - R_{i-1,j-1}}{4^j - 1}.$$

### From extrapolation to an error estimate

On a panel $[a,b]$ with midpoint $m$, let $S_1$ be one Simpson panel and $S_2$ the sum of two half panels. If $f^{(4)}$ is nearly constant on $[a,b]$, then $I-S_1\approx 16(I-S_2)$, and so

$$I - S_2 \approx \frac{S_2 - S_1}{15}.$$

The approximation rests on that condition. Where $f^{(4)}$ varies strongly, or does not exist, the factor 15 is wrong. Adding the correction, $S_2+(S_2-S_1)/15$, is Boole's rule on the five points, which is exact for polynomials of degree 5.

### Adaptive Simpson

The algorithm: estimate the error on a panel; if it is within tolerance accept, otherwise split in two, give each half half the tolerance, and recurse. Function values are passed down, so each split costs only two new evaluations, and $P$ accepted panels cost $4P+1$ evaluations.

```python
def adaptive_simpson(f, a, b, tol):
    def simp(a, fa, fm, b, fb):
        return (b - a) / 6 * (fa + 4 * fm + fb)
    def rec(a, fa, m, fm, b, fb, whole, tol, depth):
        l, r = (a + m) / 2, (m + b) / 2
        fl, fr = f(l), f(r)
        left, right = simp(a, fa, fl, m, fm), simp(m, fm, fr, b, fb)
        d = left + right - whole
        if abs(d) <= 15 * tol or depth == 0:
            return left + right + d / 15
        return (rec(a, fa, l, fl, m, fm, left, tol / 2, depth - 1)
                + rec(m, fm, r, fr, b, fb, right, tol / 2, depth - 1))
    m = (a + b) / 2
    fa, fm, fb = f(a), f(m), f(b)
    return rec(a, fa, m, fm, b, fb, simp(a, fa, fm, b, fb), tol, 60)
```

### What `scipy.integrate.quad` does differently

`quad` calls QUADPACK. For a finite interval without weights or break points the routine is `qagse`, which the SciPy documentation describes as globally adaptive subdivision with extrapolation and a 21-point Gauss-Kronrod rule on each subinterval. "Globally adaptive" means it keeps a list of panels and refines the one with the largest error estimate, instead of splitting the tolerance in advance as the recursion above does. It has the defaults `epsabs=1.49e-8`, `epsrel=1.49e-8`, `limit=50`. A Gauss-Kronrod rule evaluates only interior points, so an integrand that blows up at an endpoint is not a problem for it by itself.

## Worked Examples

### Example 1: Richardson by hand

On $e^x$ over $[0,1]$: $T_4 = 1.7272219046$ and $T_8 = 1.7205185922$, with errors $8.94\times10^{-3}$ and $2.24\times10^{-3}$. Then

$$\frac{4T_8 - T_4}{3} = 1.7182841547,$$

with error $2.33\times10^{-6}$, which is $S_8$ to rounding. Nine evaluations were already spent on $T_8$, so the gain of about a factor of 1000 cost nothing.

For the error estimator on the single panel $[0,1]$: $S_1 = 1.7188611519$, $S_2 = 1.7183188419$, so $(S_2-S_1)/15 = -3.615\times10^{-5}$, close to the true $I-S_2 = -3.701\times10^{-5}$.

### Example 2: a Romberg table

Errors on $e^x$ over $[0,1]$, each column one order of extrapolation further:

```text
panels evals  order 2   order 4   order 6   order 8   order 10
   1     2    1.41e-01
   2     3    3.56e-02  5.79e-04
   4     5    8.94e-03  3.70e-05  8.59e-07
   8     9    2.24e-03  2.33e-06  1.38e-08  3.35e-10
  16    17    5.59e-04  1.46e-07  2.16e-10  1.34e-12  3.31e-14
  32    33    1.40e-04  9.10e-09  3.38e-12  4.88e-15  2.22e-16
```

With 33 evaluations the table has reached rounding, so the $2.22\times10^{-16}$ under order 10 is noise: in 60-digit arithmetic that entry has error $3.3\times10^{-17}$, and the next one on the diagonal, not printed, has $8.2\times10^{-19}$. `scipy.integrate.romb` on the same 33 samples also ends at $2.2\times10^{-16}$.

### Example 3: extrapolating with the wrong power

On $\sqrt x$ the trapezoid expansion is not in even powers. It is $T(h)-I = \zeta(-\tfrac12)\,h^{3/2} + \tfrac{1}{24}h^2 + \dots$ with $\zeta(-\tfrac12)\approx-0.2079$, a generalized Euler-Maclaurin form for an endpoint singularity. At $n=4096$ those two terms give $-7.905394871\times10^{-7}$, matching the computed difference to ten digits. Richardson with the textbook $p=2$ only changes the constant. With the measured $p=3/2$, the leading term goes away:

```text
   n    T error    p=2 error  order   p=3/2 error  order
 256   5.012e-05   1.982e-05          4.074e-07
 512   1.779e-05   7.008e-06  1.50    1.018e-07    2.00
1024   6.304e-06   2.478e-06  1.50    2.546e-08    2.00
2048   2.233e-06   8.759e-07  1.50    6.365e-09    2.00
4096   7.905e-07   3.097e-07  1.50    1.591e-09    2.00
```

Romberg, which assumes even powers, inherits the problem: with 1025 evaluations its last diagonal entry has error $2.1\times10^{-6}$, against $2.2\times10^{-16}$ for 33 evaluations on $e^x$. Measure $\rho$ first, then extrapolate.

### Example 4: adaptive Simpson against `quad`

Tolerance $10^{-6}$ for both, with `epsabs=1e-6, epsrel=0, limit=500`, counting calls with a wrapper (the count equals `infodict['neval']` from `quad`). The last column comes from a linear scan over even $n$: it is the first $n$, plus 1, at which uniform Simpson reaches the adaptive error.

```text
integrand on [0,1]      adaptive Simpson     quad              uniform Simpson
                        evals   error        evals  error      evals
e^x                        17   2.2e-10        21   2.2e-16        83
sqrt(x)                   105   2.0e-08       231   2.2e-16     25849
1/(1e-6 + (x-0.3)^2)     5009   1.7e-09       567   2.7e-12      8493
|x - 1/sqrt(2)|            37   4.0e-08       357   4.8e-10       413
step at 1/sqrt(2)         217   1.1e-16       735   6.5e-08     (see below)
```

Read the columns with care, because the errors differ. Evaluations alone do not rank the methods. The uniform column is also a first hit, not a stable threshold, on the peak and the kink: the error is not monotone in $n$, and larger even $n$ still miss the target, up to $n=8860$ on the peak and $n=2728$ on the kink.

- **Smooth:** `quad` reaches rounding in 21 evaluations. Adaptive Simpson stops at 17 with a much larger error, and needs 129 evaluations (tolerance $10^{-10}$) to reach $6.7\times10^{-16}$. The higher-degree rule wins.
- **Peak:** on the peak of half-width $\varepsilon=10^{-3}$, adaptive Simpson needs 5009 evaluations against 8493 uniform. Adaptivity is not automatically a win: with $\varepsilon=10^{-2}$ it needs 1413 to the uniform rule's 779, and with $\varepsilon=10^{-4}$ it needs 16433 to 89463. The gain grows with how concentrated the difficulty is. At $\varepsilon=10^{-2}$, 234 of the 353 accepted panels sit in $[0.25,0.35]$, a tenth of the interval.
- **Singular:** on $\sqrt x$ the panels shrink toward $0$ (the narrowest accepted panel has width $4.8\times10^{-7}$) and the order in evaluations is restored: fitted over tolerances $10^{-4}$ to $10^{-10}$, error falls like $N^{-5.7}$, against $N^{-1.5}$ for uniform Simpson. The rate exceeds 4 because the routine returns the extrapolated value.
- **Step:** the recursion costs 217 evaluations for every tolerance tried. On a panel holding the jump, $\lvert d\rvert$ and the tolerance both halve at each split, so the test never passes until the panel is about $10^{-16}$ wide and rounding makes $d$ zero. Uniform Simpson is erratic here, with error near $10^{-5}$ at 65537 evaluations. `quad` given the location, with `points=[c]`, needs 42 evaluations and has error 0.

### Example 5: what defeats an adaptive method

Any method that samples finitely many points can be fooled, because a function can differ from $f$ only between the samples. Each of these was run:

- **A spike between the samples.** Take $e^{-((x-1/\pi)/w)^2}$ on $[0,1]$ with $w=10^{-3}$, whose integral is $0.00177$. Adaptive Simpson sees five values near zero and returns $0.0$ after 5 evaluations. `quad` returns $0.0$ with error estimate $0.0$ after 21, and no warning. `points=[1/pi]` fixes this case, but for $w=10^{-4}$ it still returns about $3\times10^{-24}$. Knowing the scale, split the interval by hand around the spike.
- **An estimate that is too small.** Adaptive Simpson on $\sqrt x$ with tolerance $10^{-3}$ uses 9 evaluations and has error $3.2\times10^{-3}$, over three times the tolerance. The factor 15 assumed a nearly constant $f^{(4)}$.
- **A reported error that is wrong.** For the step at $1/\sqrt2$ with `epsabs=1e-10, epsrel=0, limit=500`, `quad` returns an error of $1.8\times10^{-10}$, reports $3.3\times10^{-16}$, and raises no warning. The error is above the tolerance and the report is more than five orders of magnitude too small.
- **An integral that does not exist.** $\int_0^1 dx/(x-0.3)$ diverges. `quad` returns $0.8473$ (which is $\ln\frac73$, the principal value) with error estimate $4\times10^{-13}$, and raises `IntegrationWarning`: "The integral is probably divergent, or slowly convergent." The documentation says: "For valid results, the integral must converge; behavior for divergent integrals is not guaranteed."
- **An endpoint blow-up.** For $\int_0^1 \cos x/\sqrt x\,dx \approx 1.8090484758$, the routine above fails with `ZeroDivisionError` at $f(0)$. `quad` succeeds with 231 evaluations and error $1.6\times10^{-15}$, because it never evaluates $0$. The substitution $x=t^2$ gives $\int_0^1 2\cos(t^2)\,dt$, which is smooth, and `quad` then needs 21 evaluations.

Book versus today: older tutorials use `scipy.integrate.romberg` and `scipy.integrate.quadrature`, which are absent from current SciPy. Use `quad` for a function and `romb` for $2^k+1$ equally spaced samples.

## Common Misconceptions & Pitfalls

- **"Order $p$ tells me the error at my $h$."** It describes the limit, under hypotheses. Measure with $\rho$.
- **"Richardson always adds accuracy."** Only if the power is right and $f$ is smooth enough. With $p=2$ on $\sqrt x$ the order stays 1.50.
- **"The tolerance is a guarantee."** Example 5 has the error at three times the tolerance. It is a target that an estimate tries to meet.
- **"The reported error from `quad` is an upper bound."** Example 5 has it more than five orders of magnitude too small.
- **"Adaptive is always cheaper than uniform."** Not for a mild peak: 1413 against 779 evaluations.
- **"A warning-free result is correct."** The spike returned $0.0$, with no warning. If the integrand has known features, pass them with `points` or split the interval.
- **Comparing routines by evaluations at the same tolerance.** Compare at the same achieved error, since the routines overshoot a tolerance by very different amounts.

## Summary

Order is an asymptotic statement, measurable without the exact answer through the ratio $\rho$. The Euler-Maclaurin expansion shows that the trapezoid error is a series in even powers driven by endpoint derivatives, which explains order 4 when $f'(a)=f'(b)$ and the very fast convergence on smooth periodic integrands. Richardson extrapolation removes a known power: applied to the trapezoid rule it gives Simpson, and repeated it gives Romberg. It needs the right power, as $\sqrt x$ shows. Comparing one Simpson panel with two gives an error estimate, and refining where it is large gives adaptive quadrature, which helps most when the difficulty is concentrated. `quad` adds a much higher-degree rule and global refinement, and it wins on smooth integrands. Neither can see between samples, so their tolerances and estimates are not guarantees.

## Documentation Links

- [Fundamentals of Numerical Computation, 5.7 Adaptive integration](https://fncbook.com/adaptive): the error estimate from two Simpson levels and a recursive adaptive integrator.
- [Fundamentals of Numerical Computation, 5.6 Numerical integration](https://fncbook.com/integration): the Euler-Maclaurin formula and extrapolation of the trapezoid rule.
- [SciPy, scipy.integrate.quad](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.quad.html): parameters, `infodict`, break points, and the QUADPACK routines.
- [SciPy, scipy.integrate.romb](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.romb.html): Romberg integration on $2^k+1$ equally spaced samples.
