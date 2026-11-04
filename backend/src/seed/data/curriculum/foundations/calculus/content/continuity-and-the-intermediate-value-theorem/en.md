---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the three conditions that make a function continuous at a point, and use them to decide whether a given function is continuous there.
- Classify a discontinuity as removable, jump, infinite, or oscillating, and say which kind can be repaired by redefining a single value.
- Build continuous functions from known continuous pieces, and choose a parameter so that a piecewise function is continuous.
- State the Intermediate Value Theorem with all of its hypotheses, and show by example what goes wrong when each one is dropped.
- Explain why the theorem is the existence guarantee behind bisection search, and recognize inputs where a sign change does not guarantee a root.

## Context & Motivation

The lesson `guess-and-check-and-bisection-search` solves equations that have no formula by halving an interval: keep a `low` and a `high`, test the midpoint, discard the half that cannot contain the answer. Its square-root loop works, and the lesson explains why it is fast. What it leaves open is a prior question: why is there an answer inside `[low, high]` at all? A program can halve an interval forever without ever being told that the thing it is hunting exists.

Calculus answers that question with the **Intermediate Value Theorem**. Roughly, a function whose graph has no breaks cannot go from negative to positive without passing through zero. The word "roughly" hides the whole difficulty, because "no breaks" has to become a precise, checkable property of $f$. That property is **continuity**, and it is the first place in this discipline where a limit is used to define a property of a function rather than to compute a number.

Continuity also matters beyond bisection. Nearly every theorem about derivatives and integrals in the lessons ahead begins with the words "suppose $f$ is continuous on $[a, b]$", and the failures are instructive: a discontinuity is where numerical methods, optimizers and simulations tend to misbehave, because a small change in the input produces a large change in the output.

## Core Theory

### Continuity at a point

A function $f$ is **continuous at $a$** when all three of the following hold:

1. $f(a)$ is defined.
2. $\lim_{x \to a} f(x)$ exists.
3. $\lim_{x \to a} f(x) = f(a)$.

In words: the value the function approaches (`limits-intuition-and-the-formal-definition`) is the value it actually takes. Equivalent form: $f(a + h) \to f(a)$ as $h \to 0$, so a tiny change in the input produces a tiny change in the output.

A function is **continuous on an interval** if it is continuous at every point of it. At the endpoints of a closed interval $[a, b]$ only the one-sided limit from inside the interval is required.

Continuity is built up from pieces. Polynomials, $\sin x$, $\cos x$ and $e^x$ are continuous at every real number. Sums, differences, products and compositions of continuous functions are continuous, and a quotient $f/g$ is continuous wherever $g \neq 0$. These facts are the limit laws (`limit-laws-and-indeterminate-forms`) restated, which is why most continuity checks reduce to looking for a place where a denominator vanishes or a formula changes.

### Kinds of discontinuity

When one of the three conditions fails, the way it fails has a name:

- **Removable:** $\dfrac{x^2 - 1}{x - 1}$ at $1$. The limit is $2$, but $f(1)$ is undefined.
- **Jump:** $\lfloor x \rfloor$ at $0$. The one-sided limits are $-1$ and $0$, so the limit does not exist.
- **Infinite:** $\dfrac{1}{x}$ at $0$. The function is unbounded near $a$.
- **Oscillating:** $\sin\!\left(\dfrac{1}{x}\right)$ at $0$. The values keep swinging between $-1$ and $1$.

Only the removable kind can be repaired, by assigning $f(a)$ the value of the limit. Defining $f(1) = 2$ turns $\frac{x^2-1}{x-1}$ into the continuous function $x + 1$.

A point where $f$ is not defined is a point where $f$ is not continuous, but that does not make $\frac{1}{x}$ a "broken" function: it is continuous at every point of its domain, which simply has a gap at $0$. This distinction returns in the theorem below.

### The Intermediate Value Theorem

**Theorem.** Let $f$ be continuous on the closed interval $[a, b]$, and let $N$ be any number strictly between $f(a)$ and $f(b)$. Then there is at least one $c$ in $(a, b)$ with $f(c) = N$.

The most used special case is $N = 0$: if $f$ is continuous on $[a, b]$ and $f(a)$ and $f(b)$ have opposite signs, then $f$ has a root in $(a, b)$.

Each hypothesis earns its place, and the fastest way to see it is to remove it.

- **Drop continuity.** Let $f(x) = -1$ for $x < 0$ and $f(x) = 1$ for $x \geq 0$, on $[-1, 1]$. The endpoint values are $-1$ and $1$, yet $f$ never equals $0$, or any other number in between.
- **Drop the interval.** $f(x) = \frac{1}{x}$ has $f(-1) = -1$ and $f(1) = 1$, and is continuous at every point where it is defined, yet it has no root. The interval $[-1, 1]$ is not inside the domain, because $0$ is missing.
- **Reverse the implication.** The theorem does not say that a root forces a sign change. $f(x) = x^2$ has a root at $0$ on $[-1, 1]$ although $f(-1) = f(1) = 1$.
- **Change the number system.** The theorem relies on the real numbers having no gaps. On the rationals, $f(x) = x^2 - 2$ is continuous, $f(0) = -2$ and $f(2) = 2$, and there is still no rational root.

The conclusion is also weak in two ways worth stating. It says "at least one", not exactly one: $x^3 - x$ has three roots on $[-2, 2]$. And it says nothing about where $c$ is. It is a statement of existence, and finding $c$ is a separate job.

### From the theorem to bisection

Suppose $f$ is continuous on $[a, b]$ and $f(a)$, $f(b)$ have opposite signs. Let $m = \frac{a + b}{2}$. If $f(m) = 0$ the search is over. Otherwise $f(m)$ has the sign of exactly one endpoint, so one of the halves $[a, m]$ and $[m, b]$ again has endpoints of opposite signs. The theorem, applied to that half, guarantees a root inside it. Repeating the step gives intervals of width $\frac{b - a}{2^n}$ after $n$ steps, each containing a root.

This is the loop of `guess-and-check-and-bisection-search`. Its square-root search for $x > 0$ is bisection on $f(t) = t^2 - x$ over $[0, \max(1, x)]$. At the left end $f(0) = -x < 0$, at the right end $f(\text{high}) \geq 0$ (for $x \geq 1$ it is $x^2 - x$; for $x < 1$ it is $1 - x$). The test `guess ** 2 < x` is the sign of $f(\text{guess})$. A polynomial is continuous, so the theorem is what makes the invariant "a root is between `low` and `high`" true at every step. That lesson states the precondition as an ordered space where each check reveals a direction. The theorem gives a weaker and more general one: a sign change on an interval where $f$ is continuous, with no need for $f$ to be monotone.

## Worked Examples

### Example 1: choosing a parameter for continuity

Find $a$ so that

$$f(x) = \begin{cases} a x + 1 & x \leq 2 \\ x^2 - a & x > 2 \end{cases}$$

is continuous everywhere.

Each piece is a polynomial, hence continuous on its own region, so the only risk is at $x = 2$. The left piece gives $f(2) = 2a + 1$, which is also the limit from the left. The limit from the right is $2^2 - a = 4 - a$. Condition 3 asks for $2a + 1 = 4 - a$, so $a = 1$.

Check with $a = 1$: both sides give $3$, so the limit exists and equals $f(2) = 3$. With any other $a$ the one-sided limits differ and $f$ has a jump at $2$.

### Example 2: solving $\cos x = x$ by bisection

Let $f(x) = \cos x - x$ on $[0, 1]$. It is continuous (a difference of continuous functions), $f(0) = 1 > 0$ and $f(1) \approx -0.4597 < 0$. The theorem guarantees a root in $(0, 1)$. Bisection, keeping the half whose endpoints still have opposite signs:

```text
step     a         b         m       f(m)      keep
1     0.000000  1.000000  0.500000  +0.377583  right
2     0.500000  1.000000  0.750000  -0.018311  left
3     0.500000  0.750000  0.625000  +0.185963  right
4     0.625000  0.750000  0.687500  +0.085335  right
5     0.687500  0.750000  0.718750  +0.033879  right
6     0.718750  0.750000  0.734375  +0.007875  right
7     0.734375  0.750000  0.742188  -0.005196  left
8     0.734375  0.742188  0.738281  +0.001345  right
```

After eight steps the root lies in $[0.738281, 0.742188]$, an interval of width $2^{-8} \approx 0.0039$. The true root is $0.7390851\ldots$, inside it, as the theorem requires. To pin the root down to width $10^{-6}$ starting from width $1$ takes the smallest $n$ with $2^{-n} \leq 10^{-6}$, which is $n = 20$.

This function has no closed-form solution, which is exactly the situation in which the theorem and the algorithm earn their keep.

### Example 3: a sign change that does not contain a root

Take $f(x) = \frac{1}{x}$ on $[-1, 2]$. The endpoint values are $-1$ and $0.5$, opposite signs, so the bisection loop starts without complaint. The midpoint sequence squeezes toward $0$:

```text
step   interval after the step       f(m)
1      [-1.0, 0.5]                    +2
5      [-0.0625, 0.03125]             +32
10     [-0.00098, 0.00195]            -1024
20     [-9.5e-07, 1.9e-06]            -1048576
```

The interval shrinks as promised, but $\lvert f(m) \rvert$ doubles at every step instead of shrinking. The loop is converging to the discontinuity, not to a root. A practical guard is to check, at the end, that $\lvert f \rvert$ at the final point is actually small. A sign change tells you a root exists only when the continuity hypothesis has been checked separately.

## Common Misconceptions & Pitfalls

- **"Continuous means you can draw the graph without lifting the pen."** That picture is fair for a function on an interval, and it is how the theorem is usually remembered. It misleads on domains with gaps: $\frac{1}{x}$ is continuous at every point where it is defined, even though its graph comes in two pieces.
- **"The theorem finds the root, or says it is unique."** It only asserts that at least one exists in the open interval. Where, and how many, are separate questions. Bisection on $x^3 - x$ over $[-2, 1.5]$ converges to $-1$ and ignores the roots at $0$ and $1$.
- **"If there is no sign change, there is no root."** $x^2$ on $[-1, 1]$ touches zero without changing sign, so bisection started there has nothing to work with. The theorem gives a sufficient condition, not a necessary one.
- **"Any bracket with opposite signs makes bisection safe."** Example 3 is the counter-example. Continuity on the whole bracket is part of the hypothesis, and bisection cannot check it.
- **"On a computer, bisection halves forever."** Real numbers can be halved indefinitely; doubles cannot. Applied to $\cos x - x$ on $[0, 1]$ in double precision, a loop with no zero test halves the interval 53 times before the midpoint equals an endpoint, leaving a width of about $1.1 \times 10^{-16}$. With the zero test of the algorithm above, the run stops one step earlier, at step 52, where `cos(m) - m` evaluates to exactly `0.0`, which is a rounding coincidence and not a proof that $m$ is the exact root. A loop that stops when the midpoint repeats an endpoint always ends. A loop that stops on interval width ends only if the tolerance is no smaller than the spacing of doubles near the root, about $1.1 \times 10^{-16}$ here, so `while b - a > 1e-20` never exits. A loop that demands $\lvert f(m) \rvert$ below a very small tolerance may never get there, as the bisection lesson warns.

## Summary

A function is continuous at $a$ when $f(a)$ is defined, the limit at $a$ exists, and the two agree. Failures come in four kinds: removable, jump, infinite and oscillating, and only the first can be repaired by redefining one value. The Intermediate Value Theorem says that if $f$ is continuous on $[a, b]$ then $f$ takes every value between $f(a)$ and $f(b)$ at some point of the interval; with opposite signs at the ends it guarantees a root. Each hypothesis is needed: dropping continuity, using an interval with a gap, or leaving the real numbers breaks the conclusion, and the converse is false. Bisection is the theorem turned into an algorithm: each step keeps the half with a sign change, so the root stays trapped while the width falls like $2^{-n}$. The theorem guarantees existence, not uniqueness or location, and bisection cannot detect a discontinuity on its own. The next lesson, `the-derivative-as-a-rate-of-change`, uses the same limit machinery to ask how fast $f$ changes at a point.

## Documentation Links

- [OpenStax Calculus Volume 1, 2.4 Continuity](https://openstax.org/books/calculus-volume-1/pages/2-4-continuity): continuity at a point and on an interval, types of discontinuity, and the Intermediate Value Theorem
- [MIT OCW 18.01SC, Session 5: Discontinuity](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-5-discontinuity/): jump and removable discontinuities in video clips and notes
- [MIT OCW 18.01SC, Session 4: Limits and Continuity](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-4-limits-and-continuity/): limits and the related notion of continuity, with video clips and a mathlet
- [Active Calculus, 1.7 Limits, continuity, and differentiability](https://activecalculus.org/single/sec-1-7-lim-cont-diff.html): continuity and its relation to differentiability
