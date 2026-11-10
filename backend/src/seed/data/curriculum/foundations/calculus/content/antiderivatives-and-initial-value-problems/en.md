---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define an antiderivative on an interval and explain why the general antiderivative is $F(x) + C$ on that interval, and only there.
- Compute antiderivatives of the basic families and check every answer by differentiating it.
- Solve first-order and second-order initial-value problems for $y' = f(x)$, using the conditions to fix the constants.
- Recognize situations where an antiderivative does not exist, is not elementary, or is only valid on part of the domain.

## Context & Motivation

Differentiation answers "how fast is it changing?" Antidifferentiation asks the opposite: given the rate, what was the quantity? Given the velocity of a falling object, find its position. Given the rate at which requests arrive at a server, find the number served so far. Given the marginal cost of one more unit, find the total cost. In each case the rate pins down the answer only up to a constant, and a measurement (the starting position, the initial count) selects one function from the family. That pairing of an equation with a starting value is an **initial-value problem**, and it is the simplest case of the differential equations in `differential-equations-and-initial-value-problems`.

This lesson is the reverse reading of the rules in `differentiation-rules-and-the-chain-rule` and `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, and it needs the monotonicity facts from `the-mean-value-theorem-and-monotonicity`, which are exactly what justify the "$+\,C$". It prepares `the-definite-integral-and-riemann-sums`, where area appears, and `the-fundamental-theorem-of-calculus`, where the two ideas meet.

## Core Theory

### Definition and the constant of integration

A function $F$ is an **antiderivative** of $f$ on an interval $I$ if $F'(x) = f(x)$ for every $x \in I$. If $F$ is one antiderivative, so is $F + C$ for any constant $C$, since the derivative of a constant is $0$.

Conversely, if $F$ and $G$ are both antiderivatives of $f$ on an interval $I$, then $(F - G)' = 0$ on $I$, and the Mean Value Theorem consequence from `the-mean-value-theorem-and-monotonicity` says $F - G$ is constant on $I$. So on an interval, every antiderivative has the form $F(x) + C$. The notation

$$\int f(x)\,dx = F(x) + C$$

stands for this entire family, called the **indefinite integral**. The word "interval" is essential. For $f(x) = \frac1x$, whose domain is $(-\infty, 0) \cup (0, \infty)$, the function

$$F(x) = \begin{cases} \ln x + 1 & x > 0 \\ \ln\lvert x\rvert + 5 & x < 0 \end{cases}$$

is differentiable everywhere on the domain with $F' = \frac1x$, yet it does not have the form $\ln\lvert x\rvert + C$ for a single $C$. On each of the two intervals there is its own constant.

### The basic table, read backwards

Each row is a derivative formula run in reverse. Every answer can and should be checked by differentiating it.

- $\int x^n\,dx = \frac{x^{n+1}}{n+1} + C$ for $n \ne -1$ (on $(0, \infty)$ if $n$ is not an integer; for a negative integer $n$ the formula holds on $(-\infty, 0)$ and on $(0, \infty)$ separately, with an independent constant on each).
- $\int \frac1x\,dx = \ln\lvert x\rvert + C$ on each of $(-\infty, 0)$ and $(0, \infty)$. The absolute value is needed because $\frac{d}{dx}\ln(-x) = \frac1x$ as well.
- $\int e^x\,dx = e^x + C$, $\int \cos x\,dx = \sin x + C$, $\int \sin x\,dx = -\cos x + C$, $\int \sec^2 x\,dx = \tan x + C$, $\int \frac{dx}{1 + x^2} = \arctan x + C$. The formula for $\sec^2 x$ holds on each interval $\left(-\frac\pi2 + k\pi, \frac\pi2 + k\pi\right)$ separately, again with an independent constant on each, for the same reason as $\frac1x$.
- Linearity: $\int (a f + b g)\,dx = a\int f\,dx + b\int g\,dx$.
- For a linear inside function, $\int \cos(kx)\,dx = \frac{\sin(kx)}{k} + C$ for $k \ne 0$: the factor $\frac1k$ undoes the factor $k$ the chain rule produces.

There is no simple formula for the integral of a product: $\int f g\,dx \ne \int f\,dx \cdot \int g\,dx$. Integration by parts is the product rule in reverse, but it is a method with its own bookkeeping, not a formula for $\int fg\,dx$. Methods for products and compositions arrive in `integration-by-substitution-and-by-parts`.

### When no antiderivative is available

Not every function has one. A function with a jump cannot be an antiderivative's derivative on an interval containing the jump. Take $f(x) = \operatorname{sgn}(x)$, which is $-1$ for $x < 0$ and $1$ for $x > 0$. If $F' = f$ on $\mathbb{R}$, then $F$ is differentiable and hence continuous, and on each side $F$ is $\lvert x\rvert$ plus a constant, so continuity at $0$ forces the same constant: $F(x) = \lvert x\rvert + C$. But $\lvert x\rvert$ has a corner at $0$, so $F'(0)$ does not exist. No antiderivative exists on $\mathbb{R}$.

Continuous functions always have antiderivatives (this is guaranteed by `the-fundamental-theorem-of-calculus`), but the antiderivative may have no formula in elementary functions. The classic case is $e^{-x^2}$, whose antiderivatives are $\frac{\sqrt\pi}{2}\operatorname{erf}(x) + C$, where the error function $\operatorname{erf}$ is defined by an integral rather than a closed form. This is why probabilities for the Normal density are looked up in tables or computed numerically.

### Initial-value problems

An **initial-value problem** pairs $y' = f(x)$ with a condition $y(x_0) = y_0$. Integrate to get $y = F(x) + C$, then substitute the condition to solve for $C$. The solution is unique on any interval containing $x_0$ on which $f$ has an antiderivative, because two solutions differ by a constant that the condition forces to be $0$. For a second-order problem $y'' = f(x)$, integrate twice to get two constants, and supply two conditions, such as $y(0)$ and $y'(0)$.

## Worked Examples

### Example 1: antiderivatives, checked

Find the general antiderivative of $f(x) = 3\sqrt x + \cos 3x - e^{-x}$ on $(0, \infty)$. Term by term: $\int 3x^{1/2}\,dx = 2x^{3/2}$, $\int \cos 3x\,dx = \frac13\sin 3x$, and $\int -e^{-x}\,dx = e^{-x}$ (the derivative of $e^{-x}$ is $-e^{-x}$). So

$$F(x) = 2x^{3/2} + \tfrac13\sin 3x + e^{-x} + C.$$

Check: $F'(x) = 3x^{1/2} + \cos 3x - e^{-x}$. This is the original, as required.

### Example 2: a first-order initial-value problem

Solve $F'(x) = 3x^2 - 4x + 5$ with $F(1) = 2$. Integrate: $F(x) = x^3 - 2x^2 + 5x + C$. The condition gives $F(1) = 1 - 2 + 5 + C = 4 + C = 2$, so $C = -2$ and $F(x) = x^3 - 2x^2 + 5x - 2$. Check both requirements: $F(1) = 1 - 2 + 5 - 2 = 2$ and $F'(x) = 3x^2 - 4x + 5$.

### Example 3: motion under constant acceleration

A ball is thrown upward from a height of $5$ m at $20$ m/s. With acceleration $s''(t) = -9.8$ m/s$^2$ (ignoring air resistance), find the position. Integrate once: $s'(t) = -9.8t + C_1$, and $s'(0) = 20$ gives $C_1 = 20$. Integrate again: $s(t) = -4.9t^2 + 20t + C_2$, and $s(0) = 5$ gives $C_2 = 5$. So

$$s(t) = -4.9t^2 + 20t + 5.$$

The peak occurs where $s'(t) = 0$: $t = \frac{20}{9.8} \approx 2.041$ s, at height $s \approx 25.41$ m. The ball lands when $s(t) = 0$. The quadratic has roots $t \approx 4.318$ and $t \approx -0.236$. Only the positive root matters, since the model begins at $t = 0$. Each condition fixes its own constant: $s'(0)$ fixes $C_1$ after the first integration, and $s(0)$ fixes $C_2$ after the second.

### Example 4: an initial condition on a split domain

Solve $y' = \frac1x$ with $y(-2) = 3$. The condition lives at a negative $x$, so the interval containing $x_0 = -2$ on which $\frac1x$ is defined is $(-\infty, 0)$. There $y = \ln\lvert x\rvert + C$, and $y(-2) = \ln 2 + C = 3$ gives $C = 3 - \ln 2 \approx 2.307$. So $y = \ln\lvert x\rvert + 3 - \ln 2$ on $(-\infty, 0)$. The problem says nothing about what happens for $x > 0$, and the solution cannot be extended across $x = 0$, where $\frac1x$ is undefined. Quoting $y = \ln x + 3 - \ln 2$ would be wrong twice: $\ln x$ is undefined where the condition is given, and the constant on the other side is unconstrained.

### Example 5: exact antiderivative versus a step-by-step simulation

A game loop updates the ball from Example 3 in steps of size $\Delta t$. Explicit Euler uses the old velocity for the position update, $s \leftarrow s + v\,\Delta t$, then $v \leftarrow v - 9.8\,\Delta t$. Semi-implicit Euler updates $v$ first. At $t = 2$ the exact result from the antiderivative is $s(2) = -19.6 + 40 + 5 = 25.4$ and $s'(2) = 0.4$.

```text
dt      explicit Euler   semi-implicit Euler   exact
0.1     26.380           24.420                25.400
0.01    25.498           25.302                25.400
```

Both methods get the velocity exactly (constant acceleration), while the position error at $t = 2$ is $\pm 9.8\,\Delta t$ (plus for explicit, minus for semi-implicit): it shrinks in proportion to $\Delta t$. When the antiderivative is available in closed form, it is the reference against which a numerical integrator is judged.

## Common Misconceptions & Pitfalls

- **Forgetting $+\,C$.** Without it you have named one antiderivative, and an initial condition has nothing to adjust.
- **"$\int \frac1x\,dx = \ln x + C$."** Valid only for $x > 0$. The general statement is $\ln\lvert x\rvert + C$ on each interval, with possibly different constants.
- **One constant for a disconnected domain.** The uniqueness of $C$ comes from the Mean Value Theorem and needs an interval.
- **Reverse chain rule without the inner derivative.** The derivative of $\sin(x^2)$ is $2x\cos(x^2)$, so $\int \cos(x^2)\,dx$ is not $\sin(x^2)$ up to a constant factor. The shortcut $\frac{\sin(kx)}{k}$ works only because $kx$ has a constant derivative.
- **"Every initial-value problem has exactly one solution."** For $y' = f(x)$ with $f$ continuous on an interval, it does: existence from the antiderivative, uniqueness from the constant. Without continuity, existence can fail: $y' = \operatorname{sgn}(x)$ with $y(0) = 0$ has no solution on $\mathbb{R}$. For equations where the right side depends on $y$, uniqueness can fail: $y' = 3y^{2/3}$ (with $y^{2/3}$ read as the square of the real cube root) with $y(0) = 0$ has both $y = 0$ and $y = x^3$ as solutions. Existence and uniqueness are taken up in `differential-equations-and-initial-value-problems`.
- **Antiderivative versus definite integral.** An indefinite integral is a family of functions. A definite integral is a number, introduced in the next lessons.

## Summary

An antiderivative of $f$ on an interval is a function whose derivative is $f$ there. By the Mean Value Theorem, any two antiderivatives on an interval differ by a constant, so the general antiderivative is $F + C$, and the interval requirement is real: $\frac1x$ gives independent constants on $(-\infty, 0)$ and $(0, \infty)$. The basic table is the derivative table read backwards, and every answer is verified by differentiating it. Some functions have no antiderivative on an interval (a jump, like $\operatorname{sgn}(x)$), and some have one that no elementary formula expresses ($e^{-x^2}$). An initial-value problem uses conditions to fix the constants, one per integration, and the solution it selects lives on the interval containing the initial point. Antiderivatives of constant acceleration give exact motion and serve as the benchmark for numerical integrators. The next lesson, `the-definite-integral-and-riemann-sums`, introduces area, and later `the-fundamental-theorem-of-calculus` explains how it connects to what you did here.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.10: Antiderivatives](https://openstax.org/books/calculus-volume-1/pages/4-10-antiderivatives): antiderivatives, the indefinite integral, the table of basic formulas, and initial-value problems.
- [MIT OCW 18.01SC, Unit 2, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): lecture sessions on antiderivatives and introductory differential equations.
