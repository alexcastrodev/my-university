---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State Rolle's theorem and the Mean Value Theorem with every hypothesis, and explain what each hypothesis is for.
- Show with a concrete function that the conclusion fails when continuity on the closed interval or differentiability on the open interval is dropped.
- Use the Mean Value Theorem to prove that a zero derivative on an interval means a constant function, and that two functions with the same derivative differ by a constant.
- Decide where a function increases or decreases from the sign of its derivative, and say why the word "interval" matters.
- Turn the theorem into a quantitative tool: bound a change in a function by a bound on its derivative.

## Context & Motivation

A derivative is local information: the slope at one point. Most questions are global. Is the function larger at $b$ than at $a$? By how much at most? If two cars start together and the first is never slower than the second, can the second be ahead at the end? The Mean Value Theorem is the bridge from local to global. It says that if a function is smooth enough, the average rate of change over an interval equals the instantaneous rate at some point inside it.

The consequences are used constantly: the first derivative test for extrema, the fact that a function is determined by its derivative up to a constant, and the error bounds of numerical methods all rest on it. In computing, the same idea appears as a Lipschitz bound: if $\lvert f'\rvert \le L$ everywhere, then changing the input by $\delta$ changes the output by at most $L\delta$. Applied to a gradient, this is behind step-size rules in gradient descent; applied to an activation function, it bounds how much noise in the input can reach the output. This lesson builds on `the-derivative-as-a-rate-of-change` and `continuity-and-the-intermediate-value-theorem`, and it prepares `extrema-concavity-and-optimization`.

## Core Theory

### Fermat's observation

Suppose $f$ has a local maximum at an interior point $c$ and $f'(c)$ exists. For small $h > 0$ the quotient $\frac{f(c+h) - f(c)}{h}$ is at most $0$, and for small $h < 0$ it is at least $0$. The limit exists, so it is both $\le 0$ and $\ge 0$, hence $f'(c) = 0$. The same argument covers a local minimum. The hypothesis "$f'(c)$ exists" matters: $\lvert x\rvert$ has a minimum at $0$ where the derivative is not zero, because it does not exist.

### Rolle's theorem

**Rolle's theorem.** Let $f$ be continuous on $[a, b]$ and differentiable on $(a, b)$, with $f(a) = f(b)$. Then there is some $c \in (a, b)$ with $f'(c) = 0$.

The idea: a continuous function on a closed interval attains a largest and a smallest value (the Extreme Value Theorem, stated carefully in the next lesson). If both equal $f(a)$, the function is constant and every point works. Otherwise one of them differs from $f(a) = f(b)$, so it is attained at an interior point, and Fermat's observation gives $f'(c) = 0$.

### The Mean Value Theorem

**Mean Value Theorem (MVT).** Let $f$ be continuous on $[a, b]$ and differentiable on $(a, b)$. Then there is some $c \in (a, b)$ with

$$f'(c) = \frac{f(b) - f(a)}{b - a}.$$

Proof from Rolle: let $m = \frac{f(b) - f(a)}{b - a}$ and define $g(x) = f(x) - f(a) - m(x - a)$. This is $f$ minus the secant line, so $g(a) = g(b) = 0$, and $g$ inherits continuity and differentiability. Rolle gives $c$ with $g'(c) = f'(c) - m = 0$.

Geometrically, some tangent line is parallel to the secant line. The theorem does not say where $c$ is, only that one exists; there can be several.

### What fails when a hypothesis is dropped

Each hypothesis earns its place. Three functions show it.

- $f(x) = \lvert x\rvert$ on $[-1, 1]$: continuous, and $f(-1) = f(1)$, but not differentiable at $0$. For $x \ne 0$ the derivative is $\pm 1$, never $0$. Rolle's conclusion fails. On $[-1, 2]$ the secant slope is $\frac{2 - 1}{3} = \frac13$, but $f' \in \{-1, 1\}$ wherever it exists, so the MVT conclusion fails too. A single corner is enough.
- $f(x) = x - \lfloor x\rfloor$ on $[0, 1]$: it equals $x$ on $[0, 1)$ and jumps back to $0$ at $x = 1$, so $f(0) = f(1) = 0$ and $f$ is differentiable on $(0, 1)$, but it is not continuous at $1$. Here $f'(x) = 1$ everywhere inside, never $0$.
- The hypotheses are sufficient, not necessary. Let $f(x) = x^2$ on $[-1, 1)$ and $f(1) = 2$. It is discontinuous at $1$, yet the secant slope is $\frac{2 - 1}{2} = \frac12$ and $f'(c) = 2c = \frac12$ at $c = \frac14$. Failing a hypothesis makes the theorem silent, not the conclusion false.

### Consequences for monotonicity

Let $I$ be an interval, and let $f$ (and $g$, in item 2) be continuous on $I$ and differentiable at its interior points.

1. If $f' = 0$ on the interior of $I$, then $f$ is constant on $I$. For any $x_1 < x_2$ in $I$, the MVT gives $f(x_2) - f(x_1) = f'(c)(x_2 - x_1) = 0$.
2. If $f' = g'$ on the interior of $I$, then $f - g$ is constant on $I$. Apply item 1 to $f - g$, which is continuous on $I$ because both functions are. Continuity of $g$ on all of $I$ is needed: on $I = [0, 1]$ take $f = 0$ and $g = 0$ on $[0, 1)$ with $g(1) = 1$. Then $f' = g'$ on $(0, 1)$, but $f - g$ is not constant.
3. If $f' > 0$ on the interior of $I$, then $f$ is strictly increasing on $I$. The same formula gives $f(x_2) - f(x_1) = f'(c)(x_2 - x_1) > 0$. If $f' \ge 0$, $f$ is non-decreasing. Reversing the signs gives decreasing.

All three hold on an interval: the proofs need any two points to be joined by a stretch inside the domain.

## Worked Examples

### Example 1: finding $c$, and a failing case

Rolle on $f(x) = x^3 - 3x$ over $[-\sqrt3, \sqrt3]$. Both endpoint values are $0$, because $x(x^2 - 3)$ vanishes at $x = 0, \pm\sqrt3$. The derivative is $3x^2 - 3 = 3(x - 1)(x + 1)$, zero at $c = \pm 1$, both inside the interval. Rolle promised at least one; here there are two.

MVT on $f(x) = \sqrt x$ over $[1, 4]$: $f$ is continuous on $[1, 4]$ and differentiable on $(1, 4)$. The secant slope is $\frac{2 - 1}{3} = \frac13$. Solving $\frac{1}{2\sqrt c} = \frac13$ gives $\sqrt c = \frac32$, so $c = \frac94 \in (1, 4)$.

Now a failing case. Here $x^{2/3}$ means $(\sqrt[3]{x})^2$, the square of the real cube root, and $x^{-1/3}$ means $1/\sqrt[3]{x}$, so both are defined for negative $x$. (In code, `numpy.power(-1.0, 2/3)` returns `nan`, while `numpy.cbrt(-1.0)**2` gives `1.0`.) The function $g(x) = x^{2/3}$ on $[-1, 1]$ has $g(-1) = g(1) = 1$ and a cusp at $0$ where $g'$ does not exist. For $x \ne 0$, $g'(x) = \frac{2}{3}x^{-1/3}$ is never $0$, so Rolle's conclusion fails. The habit to build: check differentiability at every interior point, not just the typical ones.

### Example 2: bounding a value

How large is $\sqrt{26}$? Apply the MVT to $\sqrt x$ on $[25, 26]$: $\sqrt{26} - 5 = \frac{1}{2\sqrt c}$ for some $c \in (25, 26)$. Since $c > 25$, $\sqrt c > 5$, so $\sqrt{26} - 5 < \frac{1}{10}$, which gives $\sqrt{26} < 5.1$. Now $\sqrt c < \sqrt{26} < 5.1$, so $\sqrt{26} - 5 > \frac{1}{2 \cdot 5.1} = \frac{1}{10.2} \approx 0.09804$. Together, $5.0980 < \sqrt{26} < 5.1$, a rigorous bracket that never uses the value of $\sqrt{26}$ itself. The true value is $5.09902$.

The same technique proves $e^x > 1 + x$ for $x \ne 0$. For $x > 0$: $e^x - 1 = e^c x$ with $0 < c < x$, and $e^c > 1$, so $e^x - 1 > x$. For $x < 0$: $e^x - 1 = e^c x$ with $x < c < 0$, so $e^c < 1$, and multiplying by the negative number $x$ flips the inequality: $e^c x > x$. The sign of $x$ changes the argument, which is why both cases are written out.

### Example 3: a Lipschitz bound for the sigmoid

The logistic sigmoid $\sigma(t) = \frac{1}{1 + e^{-t}}$ has $\sigma'(t) = \sigma(t)\,(1 - \sigma(t))$. Since $u(1 - u) \le \frac14$ for any $u$, we get $0 < \sigma' \le \frac14$ everywhere. The MVT then says that for any $a < b$,

$$\lvert\sigma(b) - \sigma(a)\rvert = \sigma'(c)\,(b - a) \le \frac{b - a}{4}.$$

Take $a = 0.5$ and $b = 3$. The true difference is $\sigma(3) - \sigma(0.5) \approx 0.3301$, the bound gives $0.625$, and the secant slope is $\approx 0.1320$, which equals $\sigma'(c)$ at $c \approx 1.684$. The bound is loose here but holds for every pair of inputs, and $\sigma' > 0$ also shows $\sigma$ is strictly increasing.

### Example 4: the constant can change across a gap

Let $h(x) = \arctan x + \arctan\frac1x$, defined for $x \ne 0$. Using $\frac{d}{dx}\arctan x = \frac{1}{1 + x^2}$, the derivative is $\frac{1}{1 + x^2} + \frac{1}{1 + 1/x^2}\cdot\left(-\frac{1}{x^2}\right) = 0$ for every $x \ne 0$. So $h$ is constant on $(0, \infty)$ and constant on $(-\infty, 0)$, but the domain is not an interval. Indeed $h(2) = h(\tfrac12) \approx 1.5708 = \frac{\pi}{2}$ while $h(-2) \approx -1.5708 = -\frac{\pi}{2}$. Two constants, one per piece.

## Common Misconceptions & Pitfalls

- **"Derivative positive at a point means increasing near it."** False. Let $f(x) = \frac{x}{2} + x^2 \sin\frac1x$ with $f(0) = 0$. Then $f'(0) = \frac12 > 0$, but for $x \ne 0$, $f'(x) = \frac12 + 2x\sin\frac1x - \cos\frac1x$, and at $x = \frac{1}{2\pi k}$ this equals $-\frac12$. Negative slopes occur arbitrarily close to $0$, so $f$ is not increasing on any interval around $0$. The theorem needs $f' > 0$ on a whole interval.
- **"Negative derivative everywhere means decreasing."** Only on an interval. $f(x) = \frac1x$ has $f'(x) = -\frac{1}{x^2} < 0$ at every point of its domain, but $f(-1) = -1 < f(1) = 1$. It decreases on $(-\infty, 0)$ and on $(0, \infty)$ separately.
- **"Strictly increasing requires $f' > 0$ everywhere."** No: $f(x) = x^3$ has $f'(0) = 0$ and is still strictly increasing. Positive derivative is sufficient, not necessary. What does follow is that $f'$ cannot vanish on a whole interval.
- **"The MVT gives the point $c$."** It only asserts existence. In Example 3, $c \approx 1.684$ had to be solved for separately, and in general it may not be expressible in closed form.

## Summary

Rolle's theorem and the Mean Value Theorem need continuity on $[a, b]$ and differentiability on $(a, b)$, and Rolle also needs $f(a) = f(b)$. Dropping either hypothesis can make the conclusion fail: $\lvert x\rvert$ has a corner, $x - \lfloor x\rfloor$ has a jump, and in both cases no point has the required slope. From the MVT on an interval follow the three workhorse facts: a zero derivative gives a constant, equal derivatives give functions that differ by a constant, and a positive derivative gives a strictly increasing function. The word "interval" cannot be dropped, as $\frac1x$ and $\arctan x + \arctan\frac1x$ show. The theorem also converts bounds on $f'$ into bounds on $f$, which gave a rigorous bracket for $\sqrt{26}$ and the Lipschitz constant $\frac14$ for the sigmoid. The next lesson, `extrema-concavity-and-optimization`, uses these facts to turn signs of derivatives into maxima and minima.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.4: The Mean Value Theorem](https://openstax.org/books/calculus-volume-1/pages/4-4-the-mean-value-theorem): Rolle's theorem, the Mean Value Theorem, and the corollaries on constant functions and equal derivatives.
- [OpenStax Calculus Volume 1, 4.5: Derivatives and the Shape of a Graph](https://openstax.org/books/calculus-volume-1/pages/4-5-derivatives-and-the-shape-of-a-graph): how the sign of the derivative decides increasing and decreasing intervals.
- [MIT OCW 18.01SC, Unit 2, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): lecture sessions introducing and using the Mean Value Theorem.
