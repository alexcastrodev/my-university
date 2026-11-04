---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State what a function is (domain, codomain, range) and find the natural domain of an expression that involves a quotient, an even root, or a logarithm.
- Form a composition $f\circ g$, find its domain, and explain why $f\circ g$ and $g\circ f$ are usually different functions.
- Decide when a function has an inverse, build it, and name the domain restriction that makes it exist.
- Recognize the six families the rest of the discipline uses (affine, quadratic, polynomial, exponential, logarithmic, trigonometric) and describe the shape, domain, and range of each.
- Use the logarithm to answer "how many doublings" and "how long to double" questions, and avoid the domain errors that logarithm laws invite.

## Context & Motivation

Calculus studies how a quantity changes when another one does, so every statement in it is a statement about a function. A function is the mathematical version of a pure procedure: give it an input, get exactly one output, with no hidden state. Programmers already think this way, but with one difference that matters here. Code usually accepts "any integer" or "any float" and crashes or returns garbage outside the cases the author imagined. Mathematics asks for the set of legal inputs to be part of the definition, and most of the errors in calculus (a cancelled factor that removed a point, a logarithm of a negative number, an inverse that is not an inverse) are errors about that set.

This lesson also does something unusual for a calculus course: it absorbs the precalculus the later lessons assume. It is selective. It does not re-teach factoring or the unit circle from scratch. It collects the facts that limits, derivatives, and integrals will use again and again: what a domain is, how composition and inverses work, and the handful of function families that model almost everything. The exponential and logarithm get the most attention, because they connect directly to computing: the number of times you can halve a problem before it is solved is a logarithm, and a quantity that doubles each step is an exponential. The next lesson, `limits-intuition-and-the-formal-definition`, assumes everything here.

## Core Theory

### Functions, domain, and range

A **function** $f$ from a set $D$ to a set $C$ assigns to each $x$ in $D$ exactly one element $f(x)$ of $C$. $D$ is the **domain**, $C$ the **codomain**, and the set of values actually produced, $\{f(x) : x\in D\}$, is the **range**. The range can be smaller than the codomain: $f(x)=x^2$ with codomain $\mathbb{R}$ has range $[0,\infty)$.

When a formula is given without a domain, the **natural domain** is the set of real $x$ for which the formula makes sense. Three restrictions cover almost every case:

- a denominator must not be zero ($1/(x-3)$ excludes $x=3$);
- an even root needs a nonnegative argument ($\sqrt{x-1}$ needs $x\ge 1$);
- a logarithm needs a positive argument ($\ln(x)$ needs $x>0$).

A graph of $y=f(x)$ represents a function only if every vertical line meets it at most once. Whether a function is **one-to-one** (never gives the same output for two different inputs) is the horizontal-line version of the test: every horizontal line meets the graph at most once.

In code, `math.sqrt(-1)` raises a `ValueError` in Python, which is the domain being enforced. NumPy returns `nan` instead, which is the domain being ignored, and the `nan` then travels through the rest of the computation. Knowing the domain in advance is the way to tell which one you got.

### Composition and inverses

The **composition** $(f\circ g)(x)=f(g(x))$ applies $g$ first. Its domain is the set of $x$ in the domain of $g$ for which $g(x)$ lies in the domain of $f$. Order matters: with $f(t)=t+1$ and $g(t)=t^2$, we get $f(g(2))=5$ but $g(f(2))=9$.

A function $f$ has an **inverse** $f^{-1}$ exactly when $f$ is one-to-one. The inverse is defined on the range of $f$ and undoes it:

$$f^{-1}(f(x))=x \text{ for every } x \text{ in the domain of } f, \qquad f(f^{-1}(y))=y \text{ for every } y \text{ in the range of } f.$$

The hypothesis is not decoration. $f(x)=x^2$ on all of $\mathbb{R}$ is not one-to-one, since $f(-3)=f(3)=9$, so it has no inverse. Restricting the domain to $[0,\infty)$ makes it one-to-one, and then the inverse is $\sqrt{y}$. Without the restriction, "undoing" fails: $\sqrt{(-3)^2}=3$, not $-3$. The correct identity on all of $\mathbb{R}$ is $\sqrt{x^2}=\lvert x\rvert$. The graph of $f^{-1}$ is the graph of $f$ reflected across the line $y=x$.

### The families

- **Affine**, $mx+b$: domain $\mathbb{R}$. Constant rate of change $m$; $b$ is the value at $x=0$.
- **Quadratic**, $ax^2+bx+c$ with $a\ne0$: domain $\mathbb{R}$. A parabola with one vertex, so the range is bounded on one side.
- **Polynomial**, $a_nx^n+\dots+a_0$ with $a_n\ne0$: domain $\mathbb{R}$. At most $n$ real roots, and for large $\lvert x\rvert$ the term $a_nx^n$ dominates.
- **Exponential**, $a^x$ with $a>0$, $a\ne1$: domain $\mathbb{R}$, range $(0,\infty)$. Grows if $a>1$, decays if $0<a<1$.
- **Logarithm**, $\log_a x$: domain $(0,\infty)$, range $\mathbb{R}$. The inverse of $a^x$.
- **Trigonometric**, $\sin x$, $\cos x$, $\tan x$: $\sin$ and $\cos$ have domain $\mathbb{R}$, range $[-1,1]$, and period $2\pi$; $\tan$ excludes $\pi/2+k\pi$.

**Quadratics.** Completing the square rewrites $ax^2+bx+c$ as $a(x-h)^2+k$, which exposes the vertex $(h,k)$ and the range at once. The discriminant $b^2-4ac$ tells how many real roots there are: two if positive, one if zero, none if negative.

**Exponentials and logarithms.** Writing $\log_a$ for the inverse of $a^x$ gives, for every real $x$ and every $y>0$:

$$\log_a(a^x)=x, \qquad a^{\log_a y}=y.$$

The laws $\log_a(uv)=\log_a u+\log_a v$ and $\log_a(u^r)=r\log_a u$ hold for $u,v>0$. Changing base is a constant factor: $\log_a x=\ln x/\ln a$. The special base $e\approx 2.71828$ is the one whose exponential has the simplest rate of change, which a later lesson, `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, explains.

**Trigonometry.** Angles are measured in radians, so that the arc length on the unit circle equals the angle. The point at angle $x$ on the unit circle is $(\cos x,\sin x)$, which gives the identity $\sin^2x+\cos^2x=1$. Because $\sin$ and $\cos$ repeat every $2\pi$, neither is one-to-one on $\mathbb{R}$. Their inverses exist only after a restriction: $\arcsin$ returns values in $[-\pi/2,\pi/2]$ and $\arccos$ in $[0,\pi]$.

## Worked Examples

### Example 1: domain and range

Find the natural domain of $f(x)=\dfrac{\sqrt{x-1}}{x-3}$ and the range of $g(x)=x^2-4x+7$.

For $f$, the root needs $x-1\ge0$, so $x\ge1$. The denominator forbids $x=3$. The domain is $[1,3)\cup(3,\infty)$.

For $g$, complete the square: $g(x)=(x-2)^2+3$. A square is never negative, so $g(x)\ge3$, with equality at $x=2$. Every value above 3 is reached, so the range is $[3,\infty)$. The discriminant is $(-4)^2-4(1)(7)=-12<0$, which agrees: the graph never touches the $x$-axis. A numerical scan of $g$ over $[-50,50]$ gives a minimum of exactly $3.0$.

### Example 2: composition and inverse

Let $h(x)=e^{2x-1}$. Its range is $(0,\infty)$. To invert, set $y=e^{2x-1}$, take $\ln$ of both sides (legal because $y>0$), and solve:

$$\ln y=2x-1 \quad\Longrightarrow\quad x=\frac{1+\ln y}{2}.$$

So $h^{-1}(y)=\dfrac{1+\ln y}{2}$ with domain $(0,\infty)$, the range of $h$. Check both compositions:

$$h^{-1}(h(x))=\frac{1+(2x-1)}{2}=x, \qquad h(h^{-1}(y))=e^{(1+\ln y)-1}=y.$$

A numerical check at $x=0.5$ gives $h(0.5)=e^0=1$ and $h^{-1}(1)=0.5$. The second identity needs $y>0$. Without that restriction it fails, because $\ln y$ does not exist.

For a composition domain, take $f(t)=\sqrt{t}$ and $g(x)=x-4$. Then $(f\circ g)(x)=\sqrt{x-4}$, with domain $[4,\infty)$: the inner function is defined everywhere, but its output must land in the domain of the square root.

### Example 3: the logarithm in computing, and a trigonometric equation

*How many doublings reach a billion?* Start with $i=1$ and double until $i\ge10^9$. We want the smallest integer $k$ with $2^k\ge10^9$, that is $k\ge\log_2(10^9)=29.897\ldots$, so $k=30$. Running the loop confirms it: it stops after 30 iterations with $i=2^{30}=1{,}073{,}741{,}824$. The same count appears when a search halves its range each step, which is why halving a range of $10^6$ items takes at most $\lceil\log_2 10^6\rceil=\lceil19.93\rceil=20$ steps.

*How long to double at 7% per year?* We need $1.07^t=2$, so $t=\ln2/\ln1.07\approx10.24$ years. Whole-year checks agree: $1.07^{10}=1.967$ is still short of 2, and $1.07^{11}=2.105$ has passed it.

*Solve $\sin x=\tfrac12$ on $[0,2\pi]$.* The inverse function gives $\arcsin(1/2)=\pi/6$, but $\sin$ is not one-to-one here, and the calculator reports only one answer. The symmetry $\sin(\pi-x)=\sin x$ gives the second solution $5\pi/6$. Both satisfy the equation numerically ($\sin(5\pi/6)=0.5$ up to rounding). The inverse of a restriction returns one representative of the solution set, so you must supply the others.

## Common Misconceptions & Pitfalls

- **"Cancelling a factor does not change the function."** $\dfrac{x^2-1}{x-1}$ and $x+1$ agree for every $x\ne1$, but they are different functions: the first has no value at $x=1$. This difference is the starting point of the next lesson.
- **"$f^{-1}$ means $1/f$."** The $-1$ in $f^{-1}$ is the inverse under composition, not a reciprocal. $\sin^{-1}x$ is $\arcsin x$, while $1/\sin x$ is $\csc x$.
- **"$\sqrt{x^2}=x$."** It equals $\lvert x\rvert$. Squaring and rooting only undo each other on $x\ge0$.
- **"$\ln(x^2)=2\ln x$."** The rule needs $x>0$. For $x=-3$, the left side is $\ln 9=2.197$, while $\ln(-3)$ does not exist. The safe form for all $x\ne0$ is $\ln(x^2)=2\ln\lvert x\rvert$.
- **"Polynomials of degree $n$ have $n$ real roots."** They have at most $n$. The quadratic $x^2-4x+7$ has none.
- **"Degrees and radians are interchangeable."** Calculus formulas for trigonometric functions assume radians. Computing `sin(30)` in a language that uses radians answers a different question from $\sin 30^\circ$.
- **"A computed $\sin\pi$ is exactly 0."** In double precision it is about $1.22\times10^{-16}$, because $\pi$ itself is stored rounded. Numerical code compares to a tolerance, not to zero.

## Summary

A function is a rule together with its domain, and many calculus mistakes are domain mistakes: a denominator that vanishes, an even root of a negative number, a logarithm of a nonpositive number. Composition applies one function after another and its domain is cut down by the inner output. An inverse exists only for a one-to-one function, which is why $x^2$, $\sin$, and $\cos$ need restricted domains before they can be inverted. The families to carry forward are affine (constant rate), quadratic (a vertex and a discriminant), polynomial (dominated by the leading term), exponential and logarithm (inverses of each other, with the logarithm counting doublings and halvings), and the periodic sine and cosine. The next lesson, `limits-intuition-and-the-formal-definition`, uses these functions to ask what a function does near a point where it may not be defined.

## Documentation Links

- [OpenStax Calculus Volume 1: 1.1 Review of Functions](https://openstax.org/books/calculus-volume-1/pages/1-1-review-of-functions): domain, range, composition, and symmetry of functions, with graphs.
- [OpenStax Calculus Volume 1: 1.2 Basic Classes of Functions](https://openstax.org/books/calculus-volume-1/pages/1-2-basic-classes-of-functions): linear, polynomial, rational, and algebraic functions and their transformations.
- [OpenStax Calculus Volume 1: 1.3 Trigonometric Functions](https://openstax.org/books/calculus-volume-1/pages/1-3-trigonometric-functions): radian measure, the unit circle, identities, and graphs of the trigonometric functions.
- [OpenStax Calculus Volume 1: 1.4 Inverse Functions](https://openstax.org/books/calculus-volume-1/pages/1-4-inverse-functions): one-to-one functions, restricted domains, and inverse trigonometric functions.
- [OpenStax Calculus Volume 1: 1.5 Exponential and Logarithmic Functions](https://openstax.org/books/calculus-volume-1/pages/1-5-exponential-and-logarithmic-functions): exponentials, the number e, logarithm laws, and change of base.
