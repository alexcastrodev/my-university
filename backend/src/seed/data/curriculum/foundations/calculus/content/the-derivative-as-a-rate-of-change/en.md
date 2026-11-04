---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define the derivative of $f$ at a point as the limit of a difference quotient, and compute it from the definition for simple functions.
- Interpret $f'(a)$ in three equivalent ways: an instantaneous rate of change with units, the slope of the tangent line, and the coefficient of the best local linear approximation.
- Write the tangent line at a point and use it to estimate nearby values, with an idea of how large the error is.
- Recognize the four standard ways a derivative fails to exist (corner, vertical tangent, discontinuity, oscillation), and state how differentiability relates to continuity.
- Explain why a computer estimates derivatives with a small but not too small step, and why the central difference is the better default.

## Context & Motivation

The previous lesson, `continuity-and-the-intermediate-value-theorem`, was about whether a small change in the input produces a small change in the output. This lesson is about how small. Two functions can both be continuous and still differ enormously in how violently they respond to a nudge: $f(x) = 0.001x$ barely moves when $x$ moves, and $g(x) = 1000x$ swings a thousand times as far. The **derivative** is the number that measures that sensitivity at a point.

The idea is older than any formula. A car's odometer records position, while a speedometer reports a different quantity, speed. Speed at an instant is not a position reading: it is the limit of average speeds over shorter and shorter windows. Turning that sentence into mathematics is the whole definition of the derivative.

For computing, the derivative is the quantity that optimization runs on. Training a model means choosing parameters to make an error small, and the sign and size of the derivative of the error say which way to move a parameter and how far to trust the move. The lesson `gradients-extending-derivatives-to-several-variables` collects one such number per parameter into a vector; each entry there is an ordinary derivative of the kind defined here, taken with the other variables held fixed. Getting the single-variable idea right first, including where it breaks, is what makes that extension straightforward.

## Core Theory

### From average rate to instantaneous rate

For a function $f$, the **average rate of change** over $[a, a + h]$ is the **difference quotient**

$$\frac{f(a + h) - f(a)}{h}.$$

Geometrically it is the slope of the secant line through $(a, f(a))$ and $(a + h, f(a + h))$. The **derivative of $f$ at $a$** is what that slope settles to as the window shrinks:

$$f'(a) = \lim_{h \to 0} \frac{f(a + h) - f(a)}{h},$$

provided the limit exists as a finite number. Equivalent form: $f'(a) = \lim_{x \to a} \frac{f(x) - f(a)}{x - a}$. When $f$ is defined on both sides of $a$, the two one-sided limits ($h \to 0^+$ and $h \to 0^-$) must agree. In Leibniz notation, $\frac{dy}{dx}$ is the same number; the notation is a reminder that the units of the derivative are the units of $y$ divided by the units of $x$ (meters per second, dollars per unit sold, loss per unit of parameter).

### Three readings of the same number

**Rate of change.** If $s(t)$ is position, $s'(t)$ is velocity. The derivative is the instantaneous version of "how much does the output change per unit of input".

**Slope of the tangent line.** The tangent line at $a$ is the line through $(a, f(a))$ with slope $f'(a)$:

$$y = f(a) + f'(a)(x - a).$$

**Best local linear approximation.** Rewriting the definition, the error $f(a + h) - f(a) - f'(a)h$ is not merely small, it is small compared with $h$:

$$\lim_{h \to 0} \frac{f(a + h) - f(a) - f'(a)\,h}{h} = 0.$$

So $f(a + h) \approx f(a) + f'(a)h$ for small $h$, and no other line through $(a, f(a))$ has this property. The next lesson, `differentiation-rules-and-the-chain-rule`, turns this reading into the chain rule.

### The derivative as a function

Computing $f'(a)$ at a general $a$ produces a new function $f'$, defined at every point where the limit exists. Three computations from the definition that later lessons reuse:

- $f(x) = x^2$: $\frac{(x+h)^2 - x^2}{h} = 2x + h \to 2x$.
- $f(x) = \frac{1}{x}$, for $x \neq 0$: $\frac{1}{h}\left(\frac{1}{x+h} - \frac{1}{x}\right) = \frac{-1}{x(x+h)} \to -\frac{1}{x^2}$.
- $f(x) = \sqrt{x}$, for $x > 0$: multiplying by the conjugate gives $\frac{1}{\sqrt{x+h} + \sqrt{x}} \to \frac{1}{2\sqrt{x}}$. At $x = 0$ the function is defined only on one side and the quotient is $\frac{1}{\sqrt{h}}$, which grows without bound, so $\sqrt{x}$ has no derivative at $0$.

### When the derivative does not exist

A derivative exists at $a$ only if the difference quotient has a finite limit. Four standard failures are:

- **Corner.** $f(x) = \lvert x \rvert$ at $0$: the quotient is $\frac{\lvert h \rvert}{h}$, which is $+1$ for $h > 0$ and $-1$ for $h < 0$. The two sides disagree.
- **Vertical tangent.** $f(x) = \sqrt[3]{x}$ (real cube root) at $0$: the quotient is $h^{-2/3}$, which is about $4.6$ at $h = 0.1$, $100$ at $h = 10^{-3}$, $10^4$ at $h = 10^{-6}$, and grows without bound from both sides. The graph is continuous and its tangent is vertical, with no finite slope.
- **Discontinuity.** If $f$ jumps at $a$, the quotient blows up.
- **Oscillation.** $f(x) = x \sin\frac{1}{x}$ with $f(0) = 0$ is continuous at $0$, but the quotient is $\sin\frac{1}{h}$, which takes the value $1$ at $h = \frac{1}{\pi/2 + 2\pi k}$ and $-1$ at $h = \frac{1}{3\pi/2 + 2\pi k}$ for every positive integer $k$, so it has no limit.

**Theorem.** If $f$ is differentiable at $a$, then $f$ is continuous at $a$.

The proof is one line. For $h \neq 0$, $f(a + h) - f(a) = h \cdot \frac{f(a+h) - f(a)}{h}$. As $h \to 0$ the first factor goes to $0$ and the second to the finite number $f'(a)$, so the product goes to $0$, which is continuity.

The converse is false: $\lvert x \rvert$ is continuous at $0$ and not differentiable there. Differentiability is a stronger property than continuity, not an equivalent one. The contrapositive is useful in practice: a function with a jump cannot have a derivative at the jump, so the derivative rules of the next lessons cannot be applied there.

## Worked Examples

### Example 1: velocity of a falling object

An object dropped from rest falls $s(t) = 4.9\,t^2$ meters in $t$ seconds, ignoring air resistance. Find its velocity at $t = 3$.

Average velocity over $[3, 3 + h]$, computed from $s(3) = 44.1$:

```text
h        average velocity (m/s)
0.5      31.85
0.1      29.89
0.01     29.449
0.001    29.4049
```

The pattern is explained by the algebra: $\frac{4.9(3+h)^2 - 44.1}{h} = 29.4 + 4.9h$. As $h \to 0$ the extra term vanishes, so $s'(3) = 29.4$ m/s. The units come from the quotient: meters divided by seconds. Over a short window the object really is moving at about $29.4$ m/s, and the tangent line $y = 44.1 + 29.4(t - 3)$ predicts position near $t = 3$.

### Example 2: estimating $\sqrt{4.1}$ with the tangent line

From the computation above, $f(x) = \sqrt{x}$ has $f'(4) = \frac{1}{2\sqrt{4}} = \frac{1}{4}$ and $f(4) = 2$. The tangent line is $y = 2 + \frac{1}{4}(x - 4)$, so

$$\sqrt{4.1} \approx 2 + \frac{0.1}{4} = 2.025.$$

The true value is $2.0248457\ldots$, an error of about $1.5 \times 10^{-4}$. Shrinking the step shows the error falling faster than $h$:

```text
h       sqrt(4+h)   2 + h/4    error
0.4     2.097618    2.100000   2.4e-03
0.1     2.024846    2.025000   1.5e-04
0.01    2.002498    2.002500   1.6e-06
```

Cutting $h$ by a factor of $10$ cuts the error by about $100$, here roughly $0.0156\,h^2$. The approximation is only trustworthy near $a$, and the curvature of the function sets how fast it degrades. A tangent line to $\sqrt{x}$ lies above the curve, which is why the estimate is slightly high.

### Example 3: estimating a derivative numerically

A program that can evaluate $f$ but not differentiate it may use the **forward difference** $\frac{f(a+h) - f(a)}{h}$ or the **central difference** $\frac{f(a+h) - f(a-h)}{2h}$. Take $f(x) = \sqrt{x}$ at $a = 4$, where the true derivative is exactly $0.25$, in double precision:

```text
h        forward error   central error
1e-01    1.5e-03         2.0e-05
1e-02    1.6e-04         2.0e-07
1e-04    1.6e-06         2.1e-11
1e-05    1.6e-07         1.6e-12
1e-06    1.6e-08         7.6e-11
1e-07    1.5e-09         4.1e-10
1e-08    2.4e-08         1.3e-08
1e-10    2.1e-08         2.1e-08
1e-12    2.2e-05         2.2e-05
1e-16    2.5e-01         2.5e-01
```

Two effects compete. For larger $h$ the error comes from the approximation: forward error shrinks in proportion to $h$, central error in proportion to $h^2$. For smaller $h$ the error comes from rounding: $f(a + h)$ and $f(a)$ agree in most of their digits, so their difference loses precision, and dividing by a tiny $h$ magnifies what is left. At $h = 10^{-16}$ the sum $4 + h$ rounds back to $4$ exactly, the quotient is $0$, and the error is the whole derivative. The best step is neither the smallest nor the largest. For this function the central difference reaches an error near $10^{-12}$ at a step near $10^{-5}$, while the forward difference does no better than about $10^{-9}$, at a step near $10^{-7}$. The exact figures depend on the function and the machine, and the shape of the curve does not.

## Common Misconceptions & Pitfalls

- **"The derivative is the slope of a secant line."** A secant has finite width $h$; the derivative is the limit of secant slopes. Putting $h = 0$ directly into the quotient gives $\frac{0}{0}$, which is why a limit is needed.
- **"Continuous implies differentiable."** $\lvert x \rvert$ and $\sqrt[3]{x}$ are continuous at $0$ and have no derivative there. The true direction is the theorem above: differentiable implies continuous.
- **"A smaller step always gives a more accurate numerical derivative."** Example 3 shows the opposite below roughly $10^{-5}$ for the central difference and $10^{-7}$ for the forward difference. Rounding takes over.
- **"The tangent line approximation is good everywhere."** It is good near $a$, with error that shrinks faster than $h$. Far from $a$ it can be wildly wrong: for $\sqrt{x}$ at $a = 4$, the tangent line predicts $2 + \frac{12}{4} = 5$ at $x = 16$, where the true value is $4$, an error of $25\%$.
- **"$f'(a)$ is the derivative of the constant $f(a)$."** The derivative of a constant is $0$. $f'(a)$ means differentiate $f$ first, then evaluate at $a$. Reversing the order gives $0$ instead.

## Summary

The derivative of $f$ at $a$ is the limit of the difference quotient $\frac{f(a+h) - f(a)}{h}$ as $h \to 0$, when that limit is a finite number. It is simultaneously an instantaneous rate of change with units, the slope of the tangent line, and the coefficient of the best linear approximation, in the sense that the approximation error is small compared with $h$. From the definition, $x^2$ has derivative $2x$, $\frac{1}{x}$ has derivative $-\frac{1}{x^2}$ for $x \neq 0$, and $\sqrt{x}$ has derivative $\frac{1}{2\sqrt{x}}$ for $x > 0$. Differentiability implies continuity, and the converse fails at corners and vertical tangents. Numerically, a step small enough to approximate the limit but large enough to avoid rounding is needed, and, while truncation error dominates and $f''(a) \neq 0$, the central difference is more accurate than the forward difference at the same step. When rounding dominates the two are no better than each other, and for $\sin x$ at $0$ the two formulas are identical. The next lesson, `differentiation-rules-and-the-chain-rule`, replaces repeated limit computations with rules.

## Documentation Links

- [OpenStax Calculus Volume 1, 3.1 Defining the Derivative](https://openstax.org/books/calculus-volume-1/pages/3-1-defining-the-derivative): tangent lines, velocity, and the limit definition of the derivative
- [OpenStax Calculus Volume 1, 3.2 The Derivative as a Function](https://openstax.org/books/calculus-volume-1/pages/3-2-the-derivative-as-a-function): the derivative function, differentiability and continuity, and cases where a derivative does not exist
- [OpenStax Calculus Volume 1, 3.4 Derivatives as Rates of Change](https://openstax.org/books/calculus-volume-1/pages/3-4-derivatives-as-rates-of-change): velocity, speed and other rates, with units
- [MIT OCW 18.01SC, Session 3: Derivative as Rate of Change](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-3-derivative-as-rate-of-change/): the derivative read as a rate of change, with video clips and notes
- [Active Calculus, 1.8 The tangent line approximation](https://activecalculus.org/single/sec-1-8-tan-line-approx.html): the tangent line as a local linear approximation
