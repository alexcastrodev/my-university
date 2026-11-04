---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the limit laws with their hypotheses, and say which direction each implication runs.
- Evaluate limits of polynomials and rational functions by direct substitution, and recognize when substitution is not allowed.
- Explain why $0/0$ is called indeterminate, and resolve it by factoring, rationalizing, or combining fractions.
- State and apply the Squeeze Theorem, including what goes wrong when its hypotheses are weakened.
- Explain why an algebraically equivalent rewrite can give a correct answer in floating point when the original expression gives a wrong one.

## Context & Motivation

The previous lesson, `limits-intuition-and-the-formal-definition`, defined a limit and proved two of them with $\varepsilon$ and $\delta$. That does not scale. A real derivative computation involves dozens of limits, and no one writes an $\varepsilon$-$\delta$ proof for each. The limit laws are the fix: they say that limits pass through sums, products, and quotients, so that a limit of a complicated expression is assembled from limits of simple parts, the way a compiler evaluates an expression tree from its leaves.

The laws have one gap, and it is the interesting part. The quotient law needs the limit of the denominator to be nonzero. The most important limits in calculus are exactly the ones where numerator and denominator both go to zero. Those are the **indeterminate forms**, and they need a different method: rewrite the expression until the troublesome factor disappears. That rewriting is also a practical numerical technique. Evaluating $0/0$-like expressions directly in floating point loses digits, and the algebraically simplified form recovers them, as a table in Example 2 shows.

## Core Theory

### The limit laws

**Theorem (limit laws).** Suppose $\lim_{x\to a}f(x)=A$ and $\lim_{x\to a}g(x)=B$, where $A$ and $B$ are real numbers (both limits exist and are finite). Then:

- $\lim (f+g)=A+B$ and $\lim (f-g)=A-B$;
- $\lim (cf)=cA$ for any constant $c$;
- $\lim (fg)=AB$;
- $\lim (f/g)=A/B$, provided $B\ne0$;
- $\lim f(x)^n=A^n$ for a positive integer $n$;
- $\lim \sqrt[n]{f(x)}=\sqrt[n]{A}$ for a positive integer $n$, provided, when $n$ is even, that $A>0$, or $A=0$ with $f(x)\ge0$ near $a$.

The laws come from the definition. For the sum, given $\varepsilon$, take $\delta_1$ that puts $f$ within $\varepsilon/2$ of $A$ and $\delta_2$ that puts $g$ within $\varepsilon/2$ of $B$. With $\delta=\min(\delta_1,\delta_2)$, the triangle inequality gives $\lvert f+g-(A+B)\rvert\le\lvert f-A\rvert+\lvert g-B\rvert<\varepsilon$.

Each hypothesis does work, and the implications go one way only:

- **The parts must have limits.** The functions $1/x$ and $-1/x$ have no limit at $0$, yet their sum is the constant $0$, whose limit is $0$. The product $x\cdot\tfrac1x$ has limit $1$ at $0$, although the factors have limits $0$ and "none". So when a part lacks a limit, the law is silent: the combination may or may not have one.
- **The quotient needs $B\ne0$.** When $B=0$ the law gives no answer. (See Indeterminate forms below.)
- **The even root needs $A>0$, or $A=0$ with $f\ge0$ near $a$.** For $f(x)=x^2$ at $0$ we have $A=0$ and $\sqrt{x^2}=\lvert x\rvert\to0$, which is fine. For $f(x)=x$ at $0$ we also have $A=0$, but $f<0$ on the left, so $\sqrt{x}$ is undefined there and the two-sided limit does not exist. Only the right-hand limit exists.
- **Composition needs more than a limit.** If $\lim_{x\to a}g(x)=B$, the tempting rule $\lim f(g(x))=\lim_{u\to B}f(u)$ fails in general. Let $g(x)=0$ for all $x$, and $f(u)=1$ for $u\ne0$ with $f(0)=0$. Then $f(g(x))=0$ for every $x$, so its limit is $0$, while $\lim_{u\to0}f(u)=1$. The rule holds in two situations. One is that $f$ is continuous at $B$ (made precise in `continuity-and-the-intermediate-value-theorem`), which is true of every polynomial, rational function away from its poles, exponential, and so on. The other is that $g(x)\ne B$ for $x\ne a$ near $a$, so the value of $f$ at $B$ is never used.

**Direct substitution.** Applying the laws repeatedly to $x\to a$ gives: for a polynomial $p$, $\lim_{x\to a}p(x)=p(a)$; for a rational function $p/q$ with $q(a)\ne0$, $\lim_{x\to a}p(x)/q(x)=p(a)/q(a)$. For example $\lim_{x\to3}\dfrac{x^2+1}{x+1}=\dfrac{10}{4}=\dfrac52$.

### Indeterminate forms

When substitution into a quotient gives $0/0$, the laws do not decide the limit. The form is called **indeterminate** because the same shape can hide different answers. All four of these are of the form $0/0$ at $x=0$:

```text
f(x)        limit as x->0+     limit as x->0-
x/x                   1                  1
2x/x                  2                  2
x^2/x                 0                  0
x/x^2         +infinity          -infinity
```

Knowing that numerator and denominator both go to zero says nothing about the ratio; what matters is how fast each goes. Distinguish this from a nonzero numerator over a zero denominator, which is not indeterminate: $\dfrac{x+2}{x-1}$ at $x=1$ has numerator tending to $3$ and denominator to $0$, so the values grow without bound, to $+\infty$ from the right and $-\infty$ from the left, and the two-sided limit does not exist.

The strategy for $0/0$ is to rewrite the expression, for $x\ne a$, into one the laws can handle. Because a limit never uses the value at $x=a$, the rewrite only needs to be valid for $x\ne a$.

- **Factor and cancel** a common factor that vanishes at $a$.
- **Rationalize** an expression with a square root by multiplying numerator and denominator by the conjugate.
- **Combine fractions** over a common denominator.

For $\infty/\infty$ as $x\to\infty$, divide numerator and denominator by the highest power of $x$. For instance, $\dfrac{3x^2-x}{x^2+5}=\dfrac{3-1/x}{1+5/x^2}$, and since $1/x\to0$ and $1/x^2\to0$ (for any $\varepsilon>0$, $1/x<\varepsilon$ once $x>1/\varepsilon$, and $1/x^2\le1/x$ for $x\ge1$; `limits-at-infinity-and-asymptotic-growth` states the definition at infinity), the limit is $\dfrac{3-0}{1+0}=3$. The other indeterminate forms ($0\cdot\infty$, $\infty-\infty$, $1^\infty$, and so on) are rewritten into these two; `lhopitals-rule` treats them systematically.

### The Squeeze Theorem

**Theorem (Squeeze).** Suppose $g(x)\le f(x)\le h(x)$ for all $x$ in an open interval containing $a$, except possibly at $a$ itself, and $\lim_{x\to a}g(x)=\lim_{x\to a}h(x)=L$. Then $\lim_{x\to a}f(x)=L$.

Both hypotheses are needed. If the inequality holds only on one side of $a$, you get a one-sided conclusion at most. If the bounds have different limits, nothing follows: $-1\le\sin(1/x)\le1$ holds everywhere, but $-1$ and $1$ trap no single value, and as the previous lesson showed, $\lim_{x\to0}\sin(1/x)$ does not exist.

The most useful application is $\lim_{x\to0}\dfrac{\sin x}{x}=1$. Comparing areas in the unit circle gives $\sin x<x<\tan x$ for $0<x<\pi/2$. Dividing by $\sin x$ and inverting gives $\cos x<\dfrac{\sin x}{x}<1$. Since $\cos x\to1$ and the function $\sin x/x$ is even, the same bounds hold for $-\pi/2<x<0$, and the squeeze gives the limit $1$. Numerically, at $x=0.1$ the three quantities are $0.99500$, $0.99833$, and $1$.

## Worked Examples

### Example 1: factor and cancel

Find $\lim_{x\to2}\dfrac{x^2-5x+6}{x-2}$. Substitution gives $0/0$, and the quotient law does not apply. Factor the numerator: $x^2-5x+6=(x-2)(x-3)$. For $x\ne2$, the quotient equals $x-3$, so the limit is $2-3=-1$.

Check from both sides: at $x=1.99$ the quotient is $-1.01$, at $2.01$ it is $-0.99$. Note what was and was not claimed: the original function is still undefined at $2$. The limit is $-1$ because the function agrees with $x-3$ everywhere else.

### Example 2: rationalize, and why it matters in floating point

Find $\lim_{x\to0}\dfrac{\sqrt{x+4}-2}{x}$. Multiply by the conjugate $\sqrt{x+4}+2$:

$$\frac{\sqrt{x+4}-2}{x}\cdot\frac{\sqrt{x+4}+2}{\sqrt{x+4}+2}=\frac{(x+4)-4}{x(\sqrt{x+4}+2)}=\frac{1}{\sqrt{x+4}+2}\quad(x\ne0).$$

By the root, sum, and quotient laws the limit is $\dfrac{1}{\sqrt4+2}=\dfrac14$.

Now evaluate both forms in double precision:

```text
       x   (sqrt(x+4)-2)/x   1/(sqrt(x+4)+2)
   1e-01       0.2484567313      0.2484567313
   1e-04       0.2499984375      0.2499984375
   1e-08       0.2499999763      0.2499999998
   1e-12       0.2500222251      0.2500000000
   1e-14       0.2220446049      0.2500000000
   1e-15       0.0000000000      0.2500000000
```

The first column subtracts two nearly equal numbers, $\sqrt{x+4}$ and $2$, and the subtraction exposes rounding errors made earlier, in computing $x+4$ and its square root. The subtraction itself is exact, but the error it leaves is divided by a tiny $x$. By $x=10^{-15}$ it returns $0$. The rationalized form has no subtraction of close values and stays at $0.25$. The algebra that solves the limit by hand is the same algebra that makes the code accurate.

### Example 3: the Squeeze Theorem

Show $\lim_{x\to0}x^2\sin(1/x)=0$. The laws cannot be used directly, because $\sin(1/x)$ has no limit. But $-1\le\sin(1/x)\le1$ for $x\ne0$, and multiplying by $x^2\ge0$ preserves the inequalities:

$$-x^2\le x^2\sin(1/x)\le x^2.$$

Both bounds tend to $0$ as $x\to0$, so the limit is $0$. Numerically, at $x=0.1$ the middle value is $-0.00544$ with bounds $\pm0.01$; at $x=0.001$ it is $8.27\times10^{-7}$ with bounds $\pm10^{-6}$. The multiplication by $x^2\ge0$ was needed: multiplying an inequality by a negative number reverses it, which is a common slip when the bounding factor can change sign.

### Example 4: a limit through the laws and a known limit

Find $\lim_{x\to0}\dfrac{1-\cos x}{x^2}$, the limit that fooled the floating-point table in the previous lesson. Use $1-\cos x=2\sin^2(x/2)$:

$$\frac{1-\cos x}{x^2}=\frac{2\sin^2(x/2)}{x^2}=\frac12\left(\frac{\sin(x/2)}{x/2}\right)^2.$$

As $x\to0$, $x/2\to0$ too, and $x/2\ne0$ for $x\ne0$, so the second situation of the composition rule applies and $\dfrac{\sin(x/2)}{x/2}\to1$ by the Squeeze Theorem result above. The power and constant-multiple laws give $\tfrac12\cdot1^2=\tfrac12$. The rewrite is the same one used in the stable column of the earlier table.

## Common Misconceptions & Pitfalls

- **"$0/0=1$"** or **"$0/0=0$."** Neither: the form is indeterminate, and the table above shows four different outcomes from it. Each limit needs its own rewrite.
- **"If $\lim(f+g)$ exists then $\lim f$ and $\lim g$ exist."** The converse is the law; this direction is false ($1/x$ and $-1/x$).
- **"I substituted, got $k/0$ with $k\ne0$, so the limit is $\infty$."** Only if the sign is the same from both sides. In $(x+2)/(x-1)$ it is not, and the two-sided limit does not exist.
- **"Cancelling changed the function, so the limit is wrong."** The limit never looks at $x=a$. Cancelling a factor valid for $x\ne a$ is legitimate.
- **"Absolute values behave like ordinary algebra."** $\lvert x-3\rvert/(x-3)$ tends to $1$ from the right and $-1$ from the left. Split into the two cases before simplifying.
- **"A calculator that shows $0$ settles it."** The table in Example 2 returned $0$ at $x=10^{-15}$ for a limit of $1/4$.
- **"Squeeze with any bounds."** The bounds must hold near $a$ and share the same limit. Bounds like $\pm1$ for $\sin(1/x)$ squeeze nothing.

## Summary

Limit laws let limits of sums, products, quotients, powers, and roots be computed from limits of parts, as long as the parts have finite limits (the quotient also needs a nonzero denominator limit, an even root a positive one, or zero with a nonnegative argument). They run in one direction only: a combination can have a limit when its parts do not. Substitution works for polynomials and for rational functions away from zero denominators. When it produces $0/0$ the answer is not determined by the form, and the remedy is to rewrite for $x\ne a$ by factoring, rationalizing, or combining fractions; for $\infty/\infty$ divide by the highest power. The Squeeze Theorem handles oscillating factors by trapping them between two functions with the same limit, and gives $\sin x/x\to1$, which in turn gives $(1-\cos x)/x^2\to\tfrac12$. The same rewrites that solve these limits by hand are the ones that keep floating-point evaluation accurate. The next lesson, `limits-at-infinity-and-asymptotic-growth`, applies these tools as $x$ grows without bound.

## Documentation Links

- [OpenStax Calculus Volume 1: 2.3 The Limit Laws](https://openstax.org/books/calculus-volume-1/pages/2-3-the-limit-laws): the limit laws, limits of polynomials and rational functions, factoring, multiplying by a conjugate, and the Squeeze Theorem.
- [OpenStax Calculus Volume 1: 2.2 The Limit of a Function](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function): one-sided and infinite limits, which the indeterminate-form discussion above relies on.
- [MIT OpenCourseWare 18.01SC: Part A, Definition and Basic Rules](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/): a free course unit whose sessions 4 and 8 cover limits and continuity and the limits of sine and cosine, with videos and notes.
