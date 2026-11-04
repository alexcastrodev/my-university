---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Compute absolute and relative error, and say which one is meaningful for a given quantity.
- Separate truncation error from rounding error in a computed result, and derive how each depends on a parameter such as a step size $h$.
- State the standard model of floating-point arithmetic, including where it stops holding, and distinguish machine epsilon from unit roundoff.
- Propagate error through sums, products and functions to first order, and predict loss of significance in a subtraction.
- Locate the crossover where rounding overtakes truncation, and explain why shrinking $h$ past it makes the answer worse.

## Context & Motivation

`ieee-754-floating-point` shows what a double is, and `floating-point-and-approximation` shows the symptoms: `0.1 + 0.2` missing `0.3`, and ten additions of `0.1` missing `1.0`. Numerical work needs something stronger than "be careful with floats". It needs a budget: how far is a computed number from the truth, which decision caused which part of the gap, and which knob reduces it?

A number that comes out of a numerical program has usually been damaged in three ways. Its inputs arrive with error, from a measurement or an earlier computation. The method replaces an infinite process with a finite one, which is truncation. The hardware rounds every intermediate result. The programmer controls the second, the format sets the third, and the first often comes from outside the program. This lesson names the three, measures them, and shows how they interact, because the rest of this discipline keeps meeting the same trade-off: reducing truncation takes a smaller step or more work, and past some point that gain is paid back in rounding.

## Core Theory

### Absolute and relative error

If $\hat x$ approximates $x$, the **absolute error** is $\lvert\hat x - x\rvert$, and for $x \ne 0$ the **relative error** is $\lvert\hat x - x\rvert/\lvert x\rvert$. An absolute error of $1$ is excellent for a distance of $10^6$ km and meaningless for a probability. Relative error is free of units and roughly counts digits: a value near $10^{-d}$ means about $d$ correct significant digits. It is undefined at $x = 0$, so any test built on it needs a separate rule for answers near zero.

### Truncation error

Truncation error is what remains when an infinite or limiting process is stopped early, assuming every operation is exact. It exists even in exact arithmetic. The forward difference

$$D_h f(x) = \frac{f(x+h) - f(x)}{h}$$

stops the limit that defines $f'(x)$ at a finite $h$. Suppose $f'$ is continuous on the closed interval between $x$ and $x+h$ and $\lvert f''\rvert \le M$ on the open interval inside it. Taylor's theorem with $n = 1$ (`taylor-and-maclaurin-series-with-error-bounds`) gives $D_h f(x) - f'(x) = \tfrac{h}{2} f''(\xi)$ for some $\xi$ in between, so the error is at most $Mh/2$: first order in $h$.

The exponent depends on that hypothesis. For $f(x) = \lvert x\rvert^{3/2}$ at $x = 0$ we have $f'(0) = 0$, but $f''$ is unbounded near $0$. Then $D_h f(0) = h^{1/2}$ for $h > 0$, so $h = 10^{-2}$ gives error $0.1$ and $h = 10^{-6}$ gives only $10^{-3}$: order $\tfrac12$, not $1$.

### Rounding error

Rounding error comes from storing a result in finite precision. **Machine epsilon** $\epsilon$ is the gap between $1$ and the next float: $2^{-52} \approx 2.22\times10^{-16}$ in float64 and $2^{-23} \approx 1.19\times10^{-7}$ in float32, the value `numpy.finfo` reports as `eps`. Rounding to nearest has relative error at most the **unit roundoff** $u = \epsilon/2$, which is $2^{-53}$ and $2^{-24}$. Terminology varies: Goldberg's paper uses "machine epsilon" for $u$, so check the definition in each reference.

IEEE 754 requires correct rounding for the basic operations, which gives the **standard model**:

$$\operatorname{fl}(x \circ y) = (x \circ y)(1 + \delta), \qquad \lvert\delta\rvert \le u, \qquad \circ \in \{+, -, \times, /\}.$$

It holds when the exact result lies in the normalized range. Outside that range it can fail: `5e-324 / 2` returns `0.0`, a relative error of $1$, and `1e308 * 10` returns `inf`. A sum or difference with a subnormal result is exact, as in `5e-324 + 1.5e-323`, so for $+$ and $-$ only overflow breaks the model. Over 200,000 pairs of doubles, each operand uniform on $(-1, 1)$ times $2^k$ with integer $k$ uniform on $[-30, 30]$ (Python `random`, seed 1), checked against exact rational arithmetic, the largest $\lvert\delta\rvert$ across the four operations was $1.11019\times10^{-16}$, below $u = 1.11022\times10^{-16}$.

### Propagation

Let $\hat x$ be the stored input and $\hat f$ the computed version of $f$. The total error splits into two parts:

$$\hat f(\hat x) - f(x) = \underbrace{\hat f(\hat x) - f(\hat x)}_{\text{truncation and rounding in the method}} + \underbrace{f(\hat x) - f(x)}_{\text{propagated input error}}.$$

For $f$ differentiable at $x$, the second part is about $f'(x)(\hat x - x)$ to first order. Applied to two inputs, this says that in a sum or difference the absolute errors add, and in a product or quotient the relative errors add, up to sign.

Subtraction is where this hurts. If $x$ and $y$ carry relative errors at most $\rho$, then

$$\frac{\lvert\Delta(x - y)\rvert}{\lvert x - y\rvert} \le \frac{\lvert x\rvert + \lvert y\rvert}{\lvert x - y\rvert}\,\rho.$$

The factor is huge when $x \approx y$. This is **loss of significance**. The subtraction itself is innocent: in IEEE arithmetic, when $y/2 \le x \le 2y$ the difference is computed exactly (Theorem 11 in Goldberg), and 200,000 random such pairs produced no exception. The operation only exposes errors already present in its operands. Goldberg calls this catastrophic cancellation when the operands carry rounding errors, and benign cancellation when they are known exactly.

For a long computation, the same reasoning bounds the running sum of $n$ terms: to first order, $\lvert\hat s_n - s_n\rvert \lesssim (n-1)\,u\sum_i\lvert x_i\rvert$.

## Worked Examples

### Example 1: the step size that cannot go to zero

A gradient check in machine learning compares a backpropagated derivative with a finite difference. Take $f = \tanh$ at $x = 1$, so $f'(1) = \operatorname{sech}^2 1 = 0.4199743416$ and $\lvert f''(1)\rvert = 0.6397$. Truncation should be about $0.32h$. For rounding, $f(x+h)$ and $f(x)$ each carry an error near $u\lvert f\rvert$, and dividing by $h$ scales it up. Together:

$$E(h) \approx \frac{h}{2}\lvert f''\rvert + \frac{2u\lvert f\rvert}{h}, \qquad h^* = 2\sqrt{\frac{u\lvert f\rvert}{\lvert f''\rvert}}, \qquad E(h^*) = \lvert f''\rvert\, h^*.$$

This predicts $h^* = 2.3\times10^{-8}$ with $E = 1.5\times10^{-8}$ in float64, and $h^* = 5.3\times10^{-4}$ with $E = 3.4\times10^{-4}$ in float32. The measured error:

```text
h       float64 error   float32 error
1e-01   3.09e-02        3.09e-02
1e-02   3.19e-03        3.19e-03
1e-03   3.20e-04        2.98e-04   float32 best
1e-04   3.20e-05        3.58e-04
1e-05   3.20e-06        2.74e-03
1e-06   3.20e-07        2.74e-03
1e-07   3.18e-08        1.76e-01
1e-08   8.53e-09        4.20e-01   float64 best
1e-10   2.86e-07        4.20e-01
1e-12   2.30e-05        4.20e-01
1e-14   1.91e-03        4.20e-01
1e-16   4.20e-01        4.20e-01
```

In float64, a line fitted to $\log_{10}$ error against $\log_{10} h$ has slope $+0.999$ for $h$ from $10^{-1}$ to $10^{-7}$, where truncation dominates and shrinking $h$ helps. It has slope $-0.977$ for $h$ from $10^{-9}$ to $10^{-15}$, where rounding dominates and shrinking $h$ hurts. The table ends in total loss: `1 + 1e-16 == 1` in float64 and `1 + 1e-8 == 1` in float32, so the quotient is $0$ and the error is all of $f'(1)$.

A better formula moves the crossover without removing it. The central difference $\frac{f(x+h)-f(x-h)}{2h}$ has second-order truncation, and on this $f$ its best float64 error is $1.2\times10^{-11}$, at $h = 10^{-5}$.

### Example 2: loss of significance in $1 - \cos x$

For small $x$, $1 - \cos x \approx x^2/2$. The stored $\cos x$ is within about $u$ of its true value, and the subtraction is exact, so the relative error can reach about $u/(x^2/2) = 2u/x^2$. Rewriting as $2\sin^2(x/2)$ removes the subtraction of nearby numbers:

```text
x      true value     1 - cos x      rel. error   2 sin^2(x/2) rel. error
1e-02  4.999958e-05   4.999958e-05   2.88e-13     1.42e-16
1e-04  5.000000e-09   5.000000e-09   5.24e-09     7.62e-17
1e-06  5.000000e-13   5.000445e-13   8.89e-05     9.62e-19
1e-07  5.000000e-15   4.996004e-15   7.99e-04     2.40e-17
1e-08  5.000000e-17   0.000000e+00   1.00e+00     6.88e-17
```

The predicted ceiling $2u/x^2$ is $2.2\times10^{-12}$, $2.2\times10^{-8}$, $2.2\times10^{-4}$ and $2.2\times10^{-2}$ on the first four rows, and each measured error sits below it. At $x = 10^{-8}$ the ceiling passes $1$, and every digit is gone. Why one formula fails and the other survives is the subject of `conditioning-and-numerical-stability`.

### Example 3: a float32 clock

A simulation loop keeps time with `t += dt` at $dt = 0.1$. After $10^7$ ticks the ideal value is $10^6$:

```text
method                          result              error
float32, t += 0.1               1087937.0           +8.8e+04
float32, numpy.sum              999989.4375         -1.1e+01
float64, t += 0.1               999999.9998389754   -1.6e-04
float64, numpy.sum              999999.9999999782   -2.2e-08
float64, math.fsum              1000000.0           0
integer tick count * 0.1        1000000.0           0
```

The float32 clock is off by 8.8 percent. That respects the first-order bound of $6.0\times10^5$, but it is far above the $\sqrt{n}\,u\,s \approx 190$ that independent random errors would suggest. These errors are not independent. In $[2^{19}, 2^{20})$ float32 spacing is $2^{-4} = 0.0625$, `t` is a multiple of it, and `t + 0.1` rounds to `t + 0.125` every time, as the run confirms: every step in that range is exactly $0.125$. In $[2^{17}, 2^{19})$ every step is $0.09375$ instead. The same rounding repeats, so drift grows linearly and can change direction: $-1.4$ after $10^5$ ticks, $+958$ after $10^6$.

`numpy.sum` uses partial pairwise summation when no axis is given, which shortens the chain of operations each term passes through. `math.fsum` tracks intermediate partial sums, so the low-order bits are not lost. The cheapest fix for a clock is to stop accumulating: store an integer tick count and multiply, the integer advice of `floating-point-and-approximation` in another setting.

## Common Misconceptions & Pitfalls

- **"Truncation and rounding are the same thing."** Truncation belongs to the method and survives exact arithmetic. Rounding belongs to the format. They respond to opposite moves, as Example 1 shows.
- **"A smaller step is always better."** Only until the crossover. Below it the error grows, and at $h = 10^{-16}$ the float64 answer is $0$.
- **"Subtracting close numbers is an inaccurate operation."** The operation is exact there. It reveals error that its operands already carried.
- **"Rounding errors average out."** They can behave that way in some computations, but Example 3 is a case where they repeat with one sign across a whole range of values.
- **"Machine epsilon is the smallest positive float."** It is a relative gap at $1$. The smallest positive double is $2^{-1074} \approx 5\times10^{-324}$.
- **"Double precision makes this go away."** More bits move the crossover. Example 2 lost every digit in float64.
- **"The bound is the error."** The sum bound is $6.0\times10^5$ and the error is $8.8\times10^4$. Bounds guarantee, they do not estimate.

## Summary

Absolute error measures distance, and relative error measures distance on the scale of the answer. A computed result inherits input error, truncation from stopping a limiting process, and rounding from finite precision. The standard model $\operatorname{fl}(x\circ y) = (x\circ y)(1+\delta)$, with $\lvert\delta\rvert \le u = \epsilon/2$, describes one operation in the normalized range. To first order, absolute errors add in sums and relative errors add in products, so subtracting nearby numbers amplifies whatever error they already carry. Truncation falls with $h$ while rounding grows like $u/h$, which gives the forward difference a best step near $\sqrt{\epsilon}$ when $f$ and $f''$ have similar size. Repeated rounding can be biased rather than random, and it is often cheaper to change the formula than to add precision.

## Documentation Links

- [Goldberg (1991), What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): rounding error, the model of relative error, guard digits, catastrophic and benign cancellation, and exact subtraction of nearby numbers.
- [Fundamentals of Numerical Computation, 1.1 Floating-point numbers](https://fncbook.com/floating-point): spacing of floats, machine epsilon, and precision in double format.
- [Fundamentals of Numerical Computation, 5.5 Convergence of finite differences](https://fncbook.com/fd-converge): truncation of difference formulas and the trade-off with roundoff.
- [MIT OpenCourseWare 18.335J, Week 1](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-1/): lecture summary on floating-point arithmetic, relative accuracy, and the handouts for it.
- [NumPy documentation, numpy.finfo](https://numpy.org/doc/stable/reference/generated/numpy.finfo.html): machine limits for each float type, including `eps`.
- [NumPy documentation, numpy.sum](https://numpy.org/doc/stable/reference/generated/numpy.sum.html): behavior of partial pairwise summation.
- [Python documentation, math](https://docs.python.org/3/library/math.html): `fsum`, `expm1`, `log1p` and related floating-point functions.
