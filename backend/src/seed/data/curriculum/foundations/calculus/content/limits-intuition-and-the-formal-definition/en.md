---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain what $\lim_{x\to a}f(x)=L$ says in words, including why the value $f(a)$ plays no role.
- Estimate a limit from a table or a graph, and recognize when a table is misleading.
- Compute one-sided limits and use them to decide whether a two-sided limit exists.
- Classify the three standard ways a limit fails to exist: a jump, unbounded growth, and oscillation.
- State the $\varepsilon$-$\delta$ definition and carry out a complete proof with explicit numbers for both a linear and a nonlinear function.

## Context & Motivation

The derivative, the integral, and the sum of an infinite series are all defined as limits, so this is the lesson on which the rest of the discipline rests. The reason limits exist at all is a practical one. The average speed of a car over an interval is distance divided by time, but the speed at one instant would be $0/0$. A limit is the tool that gives that expression a meaning: not by dividing zero by zero, but by asking what the quotient does as the interval shrinks toward zero.

Programmers meet the same obstacle without the vocabulary. You cannot evaluate a function at the point where it is undefined, so you evaluate it at points close by and trust the trend. This lesson shows when that trust is justified and when it is not (a floating-point table below gets the answer wrong). The cure is a precise definition: one that says exactly what "close" means and can be checked without a computer. That definition is also the shape of every numerical guarantee in computing: to get an output within $\varepsilon$ of the true value, how accurately must the input be known? The functions used here come from `functions-and-the-elementary-families`.

## Core Theory

### Approaching a value

Consider $f(x)=\dfrac{x^2-1}{x-1}$. It is undefined at $x=1$, since the formula gives $0/0$. Still, for $x\ne1$ we can factor and cancel, so $f(x)=x+1$. Evaluating near $1$:

```text
     x     0.9   0.99  0.999  1.001   1.01    1.1
  f(x)     1.9   1.99  1.999  2.001   2.01    2.1
```

The values close in on 2 from both sides. We write $\lim_{x\to1}f(x)=2$ and read it as: "$f(x)$ can be made as close to 2 as we like by taking $x$ close enough to 1, but not equal to 1." The restriction $x\ne a$ is part of the idea. A limit describes the behavior of $f$ near $a$, not at $a$. The function may be undefined at $a$, or defined with a different value, and the limit is the same.

### Tables can lie

A table is evidence, not a proof. The limit $\lim_{x\to0}\dfrac{1-\cos x}{x^2}$ equals $\tfrac12$. Computing it in double precision with the formula as written:

```text
       x    (1-cos x)/x^2    2 sin^2(x/2)/x^2
   1e-01     0.4995834722        0.4995834722
   1e-04     0.4999999970        0.4999999996
   1e-06     0.5000444503        0.5000000000
   1e-07     0.4996003611        0.5000000000
   1e-08     0.0000000000        0.5000000000
```

The left column drifts away from $0.5$ and then collapses to $0$, because $\cos x$ is so close to 1 that the subtraction $1-\cos x$ cancels every significant digit. The right column uses the identity $1-\cos x=2\sin^2(x/2)$, which is the same function written without a subtraction of nearly equal numbers. A student who stopped reading the left column at $x=10^{-8}$ would conclude that the limit is $0$. The limit is a fact about the function, and the definition below is what lets you reason about the function rather than about its floating-point shadow.

### One-sided limits and the ways a limit fails

The **left-hand limit** $\lim_{x\to a^-}f(x)$ only uses $x<a$, and the **right-hand limit** $\lim_{x\to a^+}f(x)$ only uses $x>a$.

**Theorem.** $\lim_{x\to a}f(x)=L$ if and only if both one-sided limits exist and both equal $L$.

The "both equal" hypothesis can fail. For $f(x)=\lvert x\rvert/x$, the right-hand limit at $0$ is $1$ and the left-hand limit is $-1$. Both exist, they disagree, and so the two-sided limit does not exist. Three patterns cover most failures:

- **Jump.** The one-sided limits exist but differ (the case above).
- **Unbounded growth.** For $1/x^2$ at $0$ the values are $100$, $10{,}000$, $10^6$ at $x=0.1,0.01,0.001$. We write $\lim_{x\to0}1/x^2=\infty$ as a description of how the limit fails to be a real number, not as a number.
- **Oscillation.** $\sin(1/x)$ at $0$ takes the value $1$ at $x_n=1/(\pi/2+2\pi n)$ and $-1$ at $x_n'=1/(3\pi/2+2\pi n)$. For $n=1,2,3$ the first sequence is $0.1273,\ 0.0707,\ 0.0490$ and the second is $0.0909,\ 0.0579,\ 0.0424$. Both shrink toward $0$, but the function value alternates between $1$ and $-1$ along them, so no single $L$ works.

### The epsilon-delta definition

**Definition.** Let $f$ be defined on an interval around $a$, except possibly at $a$ itself. Then $\lim_{x\to a}f(x)=L$ means: for every $\varepsilon>0$ there is a $\delta>0$ such that

$$0<\lvert x-a\rvert<\delta \quad\Longrightarrow\quad \lvert f(x)-L\rvert<\varepsilon.$$

It is a challenge-and-response game. An adversary picks a tolerance $\varepsilon$ around $L$ on the output side. You must answer with a $\delta$ that places every $x$ within $\delta$ of $a$ (other than $a$) inside that tolerance. If you can always answer, the limit is $L$. Several details are load-bearing:

- The inequality $0<\lvert x-a\rvert$ is what excludes $x=a$.
- $\delta$ may depend on $\varepsilon$ (smaller tolerances usually need smaller $\delta$) and on $a$.
- Any smaller $\delta$ also works, so the proof only needs one valid choice.
- The hypothesis that $f$ is defined near $a$ matters: the definition needs points $x\ne a$ arbitrarily close to $a$ to test.

**Uniqueness.** If a limit exists, it is unique. Two different values $L_1\ne L_2$ would need $f(x)$ to be within $\lvert L_1-L_2\rvert/2$ of both at once, which is impossible. This is why writing "the" limit is justified.

In engineering terms, $\varepsilon$ is the error you can tolerate in the answer and $\delta$ is the precision you must demand of the input.

## Worked Examples

### Example 1: a linear function, $\lim_{x\to3}(2x+1)=7$

*Scratch work (backward).* We need $\lvert(2x+1)-7\rvert=2\lvert x-3\rvert<\varepsilon$, which holds when $\lvert x-3\rvert<\varepsilon/2$. So choose $\delta=\varepsilon/2$.

*Proof (forward).* Let $\varepsilon>0$ and set $\delta=\varepsilon/2$. If $0<\lvert x-3\rvert<\delta$, then $\lvert(2x+1)-7\rvert=2\lvert x-3\rvert<2\delta=\varepsilon$. $\blacksquare$

*With real numbers.* For $\varepsilon=0.1$ the recipe gives $\delta=0.05$. Sampling 100,000 points of $(2.95,3.05)$ other than $3$, the largest value of $\lvert f(x)-7\rvert$ is just below $0.1$, as expected from a strict inequality. For $\varepsilon=0.001$, $\delta=0.0005$. The slope $2$ is the exchange rate between input precision and output precision.

### Example 2: a nonlinear function, $\lim_{x\to2}x^2=4$

*Scratch work.* Factor: $\lvert x^2-4\rvert=\lvert x-2\rvert\,\lvert x+2\rvert$. The factor $\lvert x+2\rvert$ is not constant, so we bound it by first requiring $\delta\le1$. Then $\lvert x-2\rvert<1$ gives $1<x<3$, so $\lvert x+2\rvert<5$. Hence $\lvert x^2-4\rvert<5\lvert x-2\rvert$, and this is at most $\varepsilon$ if $\lvert x-2\rvert<\varepsilon/5$. Both requirements together: $\delta=\min(1,\varepsilon/5)$.

*Proof.* Given $\varepsilon>0$, let $\delta=\min(1,\varepsilon/5)$. If $0<\lvert x-2\rvert<\delta$, then $\lvert x+2\rvert<5$ and $\lvert x^2-4\rvert=\lvert x-2\rvert\lvert x+2\rvert<5\delta\le\varepsilon$. $\blacksquare$

*With real numbers.* A scan of the interval around $2$ (excluding $2$) gives the worst-case error for each tolerance:

```text
epsilon   delta = min(1, epsilon/5)   largest |x^2 - 4| on the interval
      1                         0.2                              0.84
    0.1                        0.02                            0.0804
   0.01                       0.002                          0.008004
    100                           1                                 5
```

The recipe is safe but not tight: the real error stays below $\varepsilon$ with room to spare. The $\min$ with $1$ is needed for this recipe. For $\varepsilon=100$, using only $\varepsilon/5=20$ would allow $x=21$, which is within $20$ of $2$, yet $\lvert 21^2-4\rvert=437>100$. The recipe $\delta=\varepsilon/5$ fails exactly when $\varepsilon>5$, because the bound $\lvert x+2\rvert<5$ needs $\delta\le1$. The cap is one repair; $\delta=\varepsilon/(5+\varepsilon)$ is another.

### Example 3: showing a limit does not exist

Claim: $\lim_{x\to0}\lvert x\rvert/x$ does not exist. Suppose it equals some $L$, and take $\varepsilon=\tfrac12$. For any $\delta>0$, the points $x=\pm\delta/2$ satisfy $0<\lvert x\rvert<\delta$ and give values $1$ and $-1$. If both were within $\tfrac12$ of $L$, then $2=\lvert1-(-1)\rvert\le\lvert1-L\rvert+\lvert L+1\rvert<1$, a contradiction. No $\delta$ answers $\varepsilon=\tfrac12$, so no $L$ works. A failed challenge for one $\varepsilon$ is enough.

### Example 4: the limit ignores the point

For $f(x)=\dfrac{x^2-1}{x-1}$ at $a=1$: for $x\ne1$, $\lvert f(x)-2\rvert=\lvert x+1-2\rvert=\lvert x-1\rvert$. So $\delta=\varepsilon$ works, and $\lim_{x\to1}f(x)=2$ even though $f(1)$ does not exist. If we redefined $f(1)=10$, the limit would still be $2$. When the limit and the value do agree, that is a property with its own name, continuity, treated in `continuity-and-the-intermediate-value-theorem`.

## Common Misconceptions & Pitfalls

- **"The limit is the value of the function at the point."** Only for well-behaved functions, and that agreement is a separate property. Example 4 shows a limit without a value. The function $\operatorname{sgn}x$, defined with $\operatorname{sgn}0=0$, has a value at $0$ and no limit there (the one-sided limits are $-1$ and $1$).
- **"The function never reaches the limit."** Nothing requires that. The constant function $f(x)=3$ has limit $3$ and equals it everywhere. The condition $x\ne a$ only says the point $a$ itself is excluded.
- **"A table that settles down proves the limit."** The floating-point table above collapsed to $0$ in its last row and was wrong. Tables suggest a conjecture, and the definition (or a limit law from the next lesson, `limit-laws-and-indeterminate-forms`) proves it.
- **"$\lim=\infty$ means the limit exists."** The limit does not exist as a real number. The symbol records the way it fails.
- **"Choose $\delta=\varepsilon$ and you are done."** That works when the slope is $1$, as in Example 4. For $2x+1$ it needs $\varepsilon/2$, and for $x^2$ near $2$ it needs both the factor $1/5$ and the cap: $\delta=\min(1,\varepsilon)$ fails at $\varepsilon=0.1$, since $x=2.09$ is within $0.1$ of $2$ and gives $\lvert x^2-4\rvert=0.3681$.
- **"A formula for $\delta$ only has to work for small $\varepsilon$."** It must work for every $\varepsilon>0$. The choice $\delta=\varepsilon/5$ looks fine at $\varepsilon=0.1$ and fails at $\varepsilon=100$ (Example 2).
- **"If both one-sided limits exist, the limit exists."** They must also be equal.

## Summary

The statement $\lim_{x\to a}f(x)=L$ says that $f(x)$ can be forced within any tolerance $\varepsilon$ of $L$ by keeping $x\ne a$ within a small enough distance $\delta$ of $a$. It depends only on what $f$ does near $a$, never on $f(a)$. A two-sided limit exists exactly when both one-sided limits exist and agree, and it fails by a jump, by unbounded growth, or by oscillation. Tables and floating-point evaluation are useful for guessing and unreliable for deciding. The $\varepsilon$-$\delta$ proof is a recipe: bound the error by a multiple of $\lvert x-a\rvert$ (capping $\delta$ when the multiple varies), solve for $\delta$, then verify the implication. The next lesson, `limit-laws-and-indeterminate-forms`, turns the definition into algebra so that each limit does not need its own $\varepsilon$-$\delta$ proof.

## Documentation Links

- [OpenStax Calculus Volume 1: 2.2 The Limit of a Function](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function): limits from tables and graphs, one-sided limits, and infinite limits.
- [OpenStax Calculus Volume 1: 2.5 The Precise Definition of a Limit](https://openstax.org/books/calculus-volume-1/pages/2-5-the-precise-definition-of-a-limit): the $\varepsilon$-$\delta$ definition, proofs for linear and nonlinear functions, and one-sided and infinite versions.
- [MIT OpenCourseWare 18.01SC: Part A, Definition and Basic Rules](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/): a free course unit whose sessions 4, 5, and 8 cover limits and continuity, discontinuity, and limits of sine and cosine, with videos and notes.
