---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define the relative condition number of a problem, compute it with its hypotheses, and say where it blows up.
- Distinguish conditioning, a property of the problem, from stability, a property of the algorithm.
- Compute the forward error and the backward error of a computed answer.
- Use the rule that forward error is at most about condition number times backward error, and state what it does and does not promise.
- Diagnose an unstable formula and replace it with a stable one, or recognize that no replacement can help.

## Context & Motivation

Example 2 of `sources-of-error-truncation-rounding-propagation` lost every digit of $1 - \cos x$, and a rewrite recovered them all. That rewrite will not always exist. Two failures look identical on screen and call for opposite responses. Sometimes the answer is so sensitive to its input that rounding the input alone destroys it, and only better data or a different question can help. Sometimes the problem is perfectly healthy and the formula is what wastes the digits.

Telling these apart is this lesson's subject, and it decides what to do next: rewrite the code, raise the precision, or question the input. The same vocabulary carries through the discipline. `bisection-and-convergence-rate` reads a small residual as a backward error, and `the-matrix-condition-number` extends the condition number to $Ax = b$.

## Core Theory

### Conditioning: how sensitive is the problem

Treat a problem as a map $f$ from data to answer. Conditioning asks how much the exact answer moves when the data moves, with no algorithm involved. If $x \ne 0$, $f(x) \ne 0$ and $f$ is differentiable at $x$, the **relative condition number** is

$$\kappa_f(x) = \left\lvert\frac{x f'(x)}{f(x)}\right\rvert,$$

the limit, as the perturbation shrinks, of relative change in $f$ over relative change in $x$. So a relative perturbation $\eta$ in the input moves the answer by about $\kappa_f(x)\lvert\eta\rvert$. Stored inputs carry relative error up to $u$, so even a perfect algorithm should expect a relative error near $\kappa u$ in float64, a loss of about $\log_{10}\kappa$ digits. This is a first-order statement, and a problem with $\kappa$ near $1$ is **well-conditioned** while one with large $\kappa$ is **ill-conditioned**.

| Problem | $\kappa_f(x)$ | Large when | Formula at sample point | Measured |
|---|---|---|---|---|
| $\sqrt{x}$ | $1/2$ | never | $0.5$ at $x=2$ | $0.5$ |
| $e^x$ | $\lvert x\rvert$ | $\lvert x\rvert$ large | $20$ at $x=20$ | $20$ |
| $\ln x$ | $1/\lvert\ln x\rvert$ | $x$ near $1$ | $10000.5$ at $x=1.0001$ | $10000.5$ |
| $\sin x$ | $\lvert x\cot x\rvert$ | $x$ near $n\pi$, $n\ne0$; most large $\lvert x\rvert$ | $1971.6$ at $x=3.14$ | $1971.6$ |
| $x - 1$ | $\lvert x\rvert/\lvert x-1\rvert$ | $x$ near $1$ | $10001$ at $x=1.0001$ | $10001$ |

The measured column perturbs $x$ by a relative $10^{-20}$ in high-precision arithmetic and divides the two relative changes. For $\sin$, size alone also hurts: $\kappa = 2.68\times10^6$ at $x = 10^6$, unless $x$ is near $\pi/2 + n\pi$, where $\cot x$ vanishes. The last row is the subtraction $x - y$ with $y = 1$ held exact, so only $x$ carries error. The factor $(\lvert x\rvert + \lvert y\rvert)/\lvert x - y\rvert$ from the previous lesson assumes both operands do, and gives $20001$ here.

The hypotheses matter. At a zero of $f$ the relative number does not exist, and the absolute version $\lvert f'(x)\rvert$ takes over. `math.sin(math.pi)` returns $1.2246\times10^{-16}$, which is not a defect of `sin`: the stored `math.pi` differs from $\pi$ by that same amount, and $\sin$ has slope $-1$ there.

Conditioning also depends on what counts as data. As a function of $x$, $\ln x$ is ill-conditioned at $x = 1 + \delta$, because rounding $x$ has already damaged $\delta$. As a function of $\delta$, $\ln(1+\delta)$ has $\kappa$ near $1$. That is why `math.log1p(delta)` exists: when $\delta$ is known exactly, pass $\delta$.

### Stability: how good is the algorithm

An algorithm computes $\hat f(x)$. Its **forward error** is the distance to the true answer, $\lvert\hat f(x) - f(x)\rvert$, usually taken relative to $\lvert f(x)\rvert$. Its **backward error** asks a different question: which problem did the algorithm solve exactly? It is the smallest relative perturbation $\lvert\Delta x\rvert/\lvert x\rvert$ with $\hat f(x) = f(x + \Delta x)$.

An algorithm is **backward stable** if its backward error is a modest multiple of $u$ for every input. Loosely, an algorithm is **stable** if its forward error is not much larger than $\kappa u$, the amount conditioning already forces. An **unstable** algorithm loses more than the problem requires.

### Connecting the two

If $\hat f(x) = f(x + \Delta x)$, the definition of $\kappa$ gives, to first order,

$$\frac{\lvert\hat f(x) - f(x)\rvert}{\lvert f(x)\rvert} \lesssim \kappa_f(x)\,\frac{\lvert\Delta x\rvert}{\lvert x\rvert}.$$

This is an upper bound and it reads as a diagnostic:

- Backward error near $u$ and $\kappa$ moderate: the answer is accurate.
- Backward error near $u$ and $\kappa$ huge: the answer may be poor, and the algorithm is not to blame.
- Forward error far above $\kappa u$: the algorithm is to blame.

### How formulas go unstable

An algorithm is a chain of steps, and each step is a small problem with its own condition number. A common failure route is a well-conditioned whole that passes through an ill-conditioned step: errors from earlier steps are then magnified, and nothing later can recover them. The lost digits of $1 - \cos x$ fit this pattern. The whole map has $\kappa = \lvert x\sin x/(1 - \cos x)\rvert$, which tends to $2$ as $x \to 0$, so the problem is well-conditioned. The bad step is the last one: $y \mapsto 1 - y$ at $y = \cos x$ has $\kappa = \lvert y\rvert/\lvert 1 - y\rvert \approx 2/x^2$, which is $2\times10^{16}$ at $x = 10^{-8}$. The rewrite $2\sin^2(x/2)$ has no such step. Both unstable examples below fail this way.

## Worked Examples

### Example 1: a healthy problem, a bad formula

Solve $x^2 + bx + c = 0$ with $b = -10^8$ and $c = 1$. The roots are $r_1 \approx 10^8$ and $r_2 \approx 10^{-8}$. Differentiating $r^2 + br + c = 0$ gives the condition numbers of a root $r$ with respect to each coefficient: $\kappa_b = \lvert b/(2r+b)\rvert$ and $\kappa_c = \lvert c/(r(2r+b))\rvert$. For $r_2$ both equal $1$ to many digits. The problem is well-conditioned.

The textbook formula $r_2 = (-b - \sqrt{b^2-4c})/2$ subtracts $99999999.99999999$ from $10^8$. That one step has condition number about $10^{16}$. The stable alternative computes $r_1$ with the signs that add, then uses $r_1 r_2 = c$:

```text
formula            r2                       forward error   backward error in c
(-b - sqrt(D))/2   7.450580596923828e-09    2.5e-01         2.5e-01
c / r1             1e-08                    7.9e-17         7.9e-17
```

The backward error comes from $c' = -\hat r^2 - b\hat r$, the coefficient for which $\hat r$ is an exact root. The bad formula solved an equation with $c$ wrong by 25 percent, and with $\kappa \approx 1$ the forward error matches, as the bound predicts. `numpy.roots([1, -1e8, 1])` is also fine here, with relative error $8.6\times10^{-17}$ on this root.

The rewrite assumes $r_1 \ne 0$ and helps with cancellation between $b$ and the square root. If $b^2 \approx 4c$ the roots nearly coincide, the problem itself is ill-conditioned, and no rewrite restores the lost digits.

### Example 2: the same numbers, computed in two directions

Let $I_n = \int_0^1 \frac{x^n}{x+10}\,dx$. Since $\frac{x^n + 10x^{n-1}}{x+10} = x^{n-1}$, we get $I_n = \frac1n - 10 I_{n-1}$ for $n \ge 1$, with $I_0 = \ln 1.1$. From $10 \le x + 10 \le 11$ on $[0,1]$ also $\frac{1}{11(n+1)} \le I_n \le \frac{1}{10(n+1)}$. The forward recurrence in float64:

```text
n    forward I_n            exact I_n             error      ratio
0    0.09531017980432493    0.09531017980432487   7.48e-17
1    0.04689820195675065    0.0468982019567514    7.48e-16   10.00
5    0.015352900839845474   0.015352900847328939  7.48e-12   10.00
10   0.008328713865253717   0.008327965518886312  7.48e-07   10.00
14   0.013578878977397152   0.006095415303348168  7.48e-03   10.00
16   0.7537212310730486     0.005374863668150086  7.48e-01   10.00
18   74.83944336874276      0.004806628252917123  7.48e+01   10.00
```

Every step multiplies the error by $-10$, as the recurrence says, so an ordinary rounding error of $7.5\times10^{-17}$ in $I_0$ reaches $75$ by $n = 18$. At $n = 14$ the value is already above the upper bound $1/150$.

Run it backward, $I_{n-1} = \frac{1}{10}\left(\frac1n - I_n\right)$, and each step divides the error by $10$. Starting from the crude guess $I_{40} = 0$ (true value $0.00222$), the error is $2.2\times10^{-13}$ at $n = 30$ and $7.0\times10^{-19}$ at $n = 22$, where the result $0.003967651066880172$ differs from `scipy.integrate.quad` only in the last digit. The same numbers, reached two ways: one unstable, one stable. So the trouble was never the numbers. The forward route passes through the subproblem $I_0 \mapsto I_n$, which amplifies absolute error by $10^n$.

### Example 3: a good algorithm, a terrible problem

Take the degree-20 Wilkinson polynomial $p(x) = \prod_{k=1}^{20}(x-k)$, with coefficients $a_i$. Perturbing each $a_i$ by a relative $\eta_i$ moves the root $k$ by about $-\sum_i a_i\eta_i k^i/p'(k)$, so its condition number with respect to the coefficients is

$$\kappa_k = \frac{\sum_i \lvert a_i\rvert k^i}{k\,\lvert p'(k)\rvert}.$$

`numpy.roots`, which computes eigenvalues of the companion matrix, gives on the expanded coefficients:

```text
k    computed root         relative forward error   kappa_k
1    0.9999999999999833    1.7e-14                  4.2e+02
5    5.000000877361879     1.8e-07                  8.2e+08
10   9.990574635182616     9.4e-04                  5.6e+12
14   13.935190089077999    4.6e-03                  5.4e+13
20   19.999888806572073    5.6e-06                  1.4e+11
```

Now expand $\prod_i(x - \hat r_i)$ in exact arithmetic. Its coefficients differ from the true ones by a relative $1.2\times10^{-14}$ at most. So the computed roots are the exact roots of a polynomial that is almost the right one: backward error is tiny, while forward error reaches $4.6\times10^{-3}$. For $k = 14$ the bound gives $5.4\times10^{13} \times 1.2\times10^{-14} \approx 0.65$, which the actual error respects by a wide margin.

The data itself is already rounded: five of these integer coefficients do not fit exactly in a float64. Exact arithmetic confirms the sensitivity. Changing the coefficient of $x^{19}$ from $-210$ to $-210 - 2^{-23}$, a relative change of $5.7\times10^{-10}$, sends roots to $16.73 \pm 2.81i$. No algorithm that accepts rounded coefficients can undo that. The cure is a different representation: a program that holds the factors $(x-k)$ has no problem to solve.

## Common Misconceptions & Pitfalls

- **"Ill-conditioned means the algorithm is bad."** Conditioning involves no algorithm. Example 3 has a tiny backward error and a large forward error.
- **"A small residual means an accurate answer."** It means a small backward error. Accuracy needs $\kappa$ too.
- **"An accurate answer proves backward stability."** Take $f(x) = 1 + x$ at $x = 10^{-20}$. The computed `1.0` has forward error $10^{-20}$, yet it is the exact answer only for $x = 0$, a relative backward error of $1$.
- **"More precision fixes instability."** In Example 2 each extra decimal digit buys one more step. The cure is the backward direction.
- **"A function has one condition number."** $\kappa$ depends on the point and on what counts as data: $\ln$ has $\kappa = 10000.5$ at $1.0001$ and $0.22$ at $100$.
- **"The bound is an estimate."** Example 3 shows $0.65$ against an actual $4.6\times10^{-3}$. It limits the worst perturbation, and the actual one need not be the worst.

## Summary

The condition number $\kappa_f(x) = \lvert x f'(x)/f(x)\rvert$ measures how much the problem amplifies relative perturbations, before any algorithm runs. It needs $x \ne 0$, $f(x) \ne 0$ and differentiability, and it depends on what is taken as data. Forward error compares the answer with the truth, and backward error asks which nearby problem was solved exactly. To first order, forward error is at most $\kappa$ times backward error. A backward stable algorithm on a well-conditioned problem gives an accurate answer. On an ill-conditioned problem it gives a small backward error and possibly a poor answer, and a better algorithm cannot change that. When forward error far exceeds $\kappa u$, the formula is at fault, often through one ill-conditioned step, and rewriting it or running it in another direction can recover the digits.

## Documentation Links

- [Fundamentals of Numerical Computation, 1.2 Problems and conditioning](https://fncbook.com/conditioning): the relative condition number, its formula, and worked conditioning of roots.
- [Fundamentals of Numerical Computation, 1.4 Stability](https://fncbook.com/stability): unstable formulas, backward error, and the comparison with conditioning.
- [MIT OpenCourseWare 18.335J, Week 2](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-2/): lecture summary on floating-point summation, forward and backward stability.
- [Goldberg (1991), What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): rearranging the quadratic formula and other expressions to avoid catastrophic cancellation.
- [NumPy documentation, numpy.roots](https://numpy.org/doc/stable/reference/generated/numpy.roots.html): polynomial roots through the eigenvalues of the companion matrix.
- [SciPy documentation, scipy.integrate.quad](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.quad.html): adaptive quadrature, used as an independent check.
- [Python documentation, math](https://docs.python.org/3/library/math.html): `log1p`, `expm1` and related functions for arguments near a cancellation.
