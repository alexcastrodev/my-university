---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the definition of $\lim_{x\to\infty}f(x)=L$ and prove a simple case with explicit $\varepsilon$ and $N$.
- Evaluate limits at infinity of rational functions and of expressions with roots, including the sign care needed at $-\infty$.
- Find horizontal, vertical, and slant asymptotes of a function, and tell an asymptote from a hole.
- Order logarithms, powers, and exponentials by growth, and say precisely what "grows faster" means.
- Use the limit of a ratio to decide Big-O relationships, and name the case where that test cannot decide.

## Context & Motivation

The question behind asymptotic analysis is what a function does at the far end of its domain. In `big-o-and-asymptotic-complexity`, $f(n)$ is $O(g(n))$ when $f(n)\le c\,g(n)$ for all $n\ge n_0$, and the growth rates there are ordered with tables and with crossover points such as $n=100$ where $100n$ meets $n^2$. That lesson gives the notation and the definition. This one supplies the calculus underneath: a limit of a ratio as the variable grows without bound is a computation, and for the common function families it settles the comparison without a table.

Limits at infinity also describe long-run behavior in general: the steady state of a system, the speed of a falling object approaching terminal velocity, the learning rate that decays toward zero. The tools are those of `limit-laws-and-indeterminate-forms`, now applied to $x\to\infty$ instead of $x\to a$.

## Core Theory

### Limits as x grows without bound

**Definition.** Let $f$ be defined on some interval $(c,\infty)$. Then $\lim_{x\to\infty}f(x)=L$ means: for every $\varepsilon>0$ there is a number $N$ such that

$$x>N \quad\Longrightarrow\quad \lvert f(x)-L\rvert<\varepsilon.$$

This is the earlier $\varepsilon$-$\delta$ game with "$x$ near $a$" replaced by "$x$ far out". The statement $\lim_{x\to\infty}f(x)=\infty$ means that for every $M$ there is an $N$ with $x>N\Rightarrow f(x)>M$; as before, the symbol describes how the limit fails to be a real number. The case $x\to-\infty$ is the mirror image. The limit laws from the previous lesson hold for limits at infinity with the same proofs, with the same hypotheses (parts must have finite limits; a quotient needs a nonzero denominator limit).

Two building blocks: $\lim_{x\to\infty}1/x^p=0$ for every $p>0$, and $\lim_{x\to\infty}x^p=\infty$.

**Real variable versus integer variable.** Big-O is stated for integers $n$. If $\lim_{x\to\infty}f(x)=L$, then $\lim_{n\to\infty}f(n)=L$ along the integers, since the integers are among the $x$'s that must be close. The converse fails: $\sin(\pi x)$ equals $0$ at every integer, so along the integers its limit is $0$, but as a function of real $x$ it has no limit.

### Rational functions: compare degrees

For $f=p/q$ with $p$ of degree $m$ and $q$ of degree $n$, divide numerator and denominator by $x^n$:

- $m<n$: the limit at $\pm\infty$ is $0$;
- $m=n$: the limit is the ratio of leading coefficients;
- $m>n$: there is no finite limit; $f$ grows without bound in magnitude.

Roots demand care with signs. For $x>0$, $\sqrt{x^2}=x$, but for $x<0$, $\sqrt{x^2}=\lvert x\rvert=-x$. This is why $\lim_{x\to\infty}\dfrac{x}{\sqrt{x^2+1}}=1$ while $\lim_{x\to-\infty}\dfrac{x}{\sqrt{x^2+1}}=-1$. The difference $\sqrt{x^2+x}-x$ is an $\infty-\infty$ form, resolved by multiplying by the conjugate (Example 3).

### Asymptotes

- A **horizontal asymptote** is a line $y=L$ with $\lim_{x\to\infty}f(x)=L$ or $\lim_{x\to-\infty}f(x)=L$. A function can have none ($\sin x$), one ($e^x$ has $y=0$ at $-\infty$ only), or two ($\arctan x$ has $y=\pi/2$ and $y=-\pi/2$).
- A **vertical asymptote** is a line $x=a$ at which at least one one-sided limit is $\pm\infty$.
- A **slant asymptote** is a line $y=mx+b$ with $f(x)-(mx+b)\to0$ as $x\to\pm\infty$. Rational functions whose numerator degree is exactly one more than the denominator degree have one.

Two corrections to common pictures. An asymptote is not a barrier the graph never touches: $\dfrac{\sin x}{x}$ has the horizontal asymptote $y=0$ and crosses it at every nonzero multiple of $\pi$, infinitely often. And a point where the formula is $0/0$ does not automatically give a vertical asymptote; it may be a hole, where the limit is finite (Example 2).

### The dominance hierarchy

Say that $f$ grows more slowly than $g$ (written $f\ll g$) when $\lim_{x\to\infty}f(x)/g(x)=0$. For every $k>0$, $p>0$, and $a>1$:

$$(\ln x)^k\ll x^p\ll a^x.$$

So any power of the logarithm is beaten by any positive power of $x$, however small, and any power of $x$ is beaten by any exponential with base above $1$, however close to $1$. The base condition $a>1$ is necessary: for $0<a<1$, $a^x\to0$. The proofs are cleanest with `lhopitals-rule`. For a quick argument that $n^p/a^n\to0$, note that the ratio of consecutive terms is $\tfrac1a\left(\tfrac{n+1}{n}\right)^p$, which tends to $\tfrac1a<1$, so the terms eventually shrink by roughly a constant factor at every step.

**"Eventually" can be very far away.** Compare $x^{10}$ with $1.1^x$ through $10\ln x$ against $x\ln1.1$. The curves cross near $x=1.01$ and again near $x=685.08$, and $1.1^x$ stays above $x^{10}$ only from the second crossing on. At $x=500$, $1.1^x\approx4.97\times10^{20}$ while $x^{10}\approx9.77\times10^{26}$; at $x=686$ the exponential finally leads, $2.49\times10^{28}$ against $2.31\times10^{28}$. Similarly $x^{0.1}$ stays above $\ln x$ only beyond about $3.43\times10^{15}$; for $3.06<x<3.43\times10^{15}$ the logarithm is larger. The hierarchy is a statement about the limit, not about any particular size.

### From the ratio limit to Big-O

Let $f,g$ be positive for large arguments and suppose $\lim f/g=L$ exists in $[0,\infty]$.

- **$L<\infty$ implies $f=O(g)$.** Taking $\varepsilon=1$ in the definition, $f/g<L+1$ beyond some point, so $c=L+1$ and that point serve as the constants.
- **$0<L<\infty$ means the two have the same order**: $f=O(g)$ and $g=O(f)$.
- **$L=0$ means $f\ll g$**: $f=O(g)$ but $g\ne O(f)$, because $g/f\to\infty$ beats any constant.
- **$L=\infty$ implies $f\ne O(g)$.**

The hypothesis that the limit exists matters. When it does not, the test is silent. Take $f(n)=n(2+\sin n)$ and $g(n)=n$. The ratio $2+\sin n$ stays between $1$ and $3$ and keeps returning near both values, so it has no limit, yet $f(n)\le3g(n)$ and $g(n)\le f(n)$ hold for all $n\ge1$: the two are of the same order. So $f=O(g)$ can be true with no limit. The limit test proves relations when it works and proves nothing when it does not.

## Worked Examples

### Example 1: an $\varepsilon$-$N$ proof

Prove $\lim_{x\to\infty}\dfrac{3x+1}{x+2}=3$. For $x>-2$,

$$\left\lvert\frac{3x+1}{x+2}-3\right\rvert=\left\lvert\frac{-5}{x+2}\right\rvert=\frac{5}{x+2}.$$

This is less than $\varepsilon$ exactly when $x>\dfrac5\varepsilon-2$. So take $N=\max\left(1,\dfrac5\varepsilon-2\right)$. Concretely, $\varepsilon=0.1$ gives $N=48$, $\varepsilon=0.01$ gives $N=498$, and $\varepsilon=0.001$ gives $N=4998$. Scanning $x$ beyond each $N$, the error is never above $\varepsilon$, and at $x=N$ it equals $\varepsilon$ exactly, so for this choice of $N$ the strict inequality $x>N$ is needed. Each tenfold increase in accuracy costs a roughly tenfold increase in $N$ here (from $48$ to $498$ to $4998$): the error shrinks like $1/x$.

### Example 2: asymptotes versus a hole

Let $f(x)=\dfrac{2x^2-3x+1}{x^2-1}=\dfrac{(2x-1)(x-1)}{(x-1)(x+1)}$. For $x\ne1$ this equals $\dfrac{2x-1}{x+1}$.

- *Horizontal.* The degrees are equal, so the limit at $\pm\infty$ is the ratio of leading coefficients, $2$. Numerically, $f(1000)=1.99700$ and $f(-1000)=2.00300$: the graph approaches $y=2$ from below on the right and from above on the left. The equation $f(x)=2$ has no solution, so here the graph never crosses it.
- *Vertical at $x=-1$.* The numerator tends to $-3$ and the denominator to $0$. From the right, $x+1>0$ and $f\to-\infty$ ($f(-0.999)=-2998$); from the left, $f\to+\infty$ ($f(-1.001)=3002$). The two-sided limit does not exist.
- *Hole at $x=1$.* The form is $0/0$. After cancelling, $\lim_{x\to1}f(x)=\dfrac{2-1}{1+1}=\dfrac12$. This is a finite limit, so the line $x=1$ is not an asymptote.

### Example 3: $\infty-\infty$ and floating point

Find $\lim_{x\to\infty}\left(\sqrt{x^2+x}-x\right)$. Multiplying by the conjugate, for $x>0$:

$$\sqrt{x^2+x}-x=\frac{x}{\sqrt{x^2+x}+x}=\frac{1}{\sqrt{1+1/x}+1}.$$

Since $1/x\to0$, the limit is $\dfrac{1}{1+1}=\dfrac12$. Dividing by $x$ used $x>0$, which is legitimate as $x\to+\infty$. The form $\infty-\infty$ was indeterminate: $x-x$ has limit $0$, and $(x^2+x)-x^2$ has limit $\infty$. In double precision:

```text
       x   sqrt(x^2+x)-x   x/(sqrt(x^2+x)+x)
   1e+02    0.498756211209      0.498756211209
   1e+04    0.499987500625      0.499987500625
   1e+08    0.500000000000      0.499999998750
   1e+16    2.000000000000      0.500000000000
```

At $10^8$ the subtraction has already lost digits (the true value is below $0.5$), and at $10^{16}$ it returns $2$, because $x^2+x$ rounds to a number whose square root differs from $x$ by one unit in the last place. The rewritten form stays accurate.

### Example 4: deciding Big-O with the ratio

- $n\ln n$ versus $n^2$ (the base of the logarithm only changes a constant factor): the ratio is $\dfrac{\ln n}{n}$, which is $0.23$ at $n=10$, $0.046$ at $100$, and $1.4\times10^{-5}$ at $10^6$, tending to $0$. So $n\ln n\ll n^2$.
- $n^3$ versus $2^n$: the ratio $n^3/2^n$ is $0.98$ at $n=10$, $0.0076$ at $20$, $1.1\times10^{-10}$ at $50$, and $7.9\times10^{-25}$ at $100$. So $n^3\ll2^n$. At $n=10$ the two are nearly equal, which is how a small-$n$ table can hide the difference.
- $100n$ versus $n^2$: the ratio $100/n$ is $10$ at $n=10$, exactly $1$ at $n=100$ (the crossover in `big-o-and-asymptotic-complexity`), and $0.1$ at $n=1000$. The limit is $0$, so $100n\ll n^2$, whatever the constant.
- $n(2+\sin n)$ versus $n$: no limit, but same order, as shown above.

## Common Misconceptions & Pitfalls

- **"$\infty$ is a number, so $\infty-\infty=0$ and $\infty/\infty=1$."** The forms are indeterminate. Among $x/x$, $2x/x$, $x^2/x$, and $x/x^2$, all of type $\infty/\infty$, the limits at infinity are $1$, $2$, $\infty$, and $0$.
- **"A graph cannot cross its asymptote."** A horizontal asymptote describes the far end, and $\sin x/x$ crosses $y=0$ infinitely often.
- **"Every $0/0$ point is a vertical asymptote."** Example 2 has a hole at $x=1$ with finite limit $\tfrac12$.
- **"$\sqrt{x^2}=x$."** At $-\infty$ it is $-x$, which flips the sign of limits such as $x/\sqrt{x^2+1}$.
- **"Exponentials always win."** Only with base $a>1$. And "eventually" can be beyond practical sizes: $x^{10}$ stays ahead of $1.1^x$ from about $x=1.01$ to about $x=685$.
- **"If $f=O(g)$ then $f/g$ has a limit."** The converse of the ratio test is false (the $n(2+\sin n)$ example).
- **"Along the integers the limit exists, so the real limit exists."** $\sin(\pi x)$ is the counterexample.

## Summary

A limit at infinity asks for a number $N$ beyond which the function stays within $\varepsilon$ of $L$; the limit laws carry over unchanged. For rational functions the degrees decide: lower degree in the numerator gives $0$, equal degrees give the ratio of leading coefficients, higher degree gives unbounded growth. Asymptotes are horizontal, vertical, or slant, a graph may cross a horizontal one, and a $0/0$ hole is not a vertical asymptote. Logarithmic powers are dominated by powers, and powers by exponentials with base above one, in the sense that the ratio tends to $0$, though the crossover can lie far out. The limit of a ratio connects directly to Big-O: a finite limit gives $f=O(g)$, a zero limit gives strict domination, an infinite limit rules out $f=O(g)$, and a missing limit decides nothing. The next lesson, `continuity-and-the-intermediate-value-theorem`, returns to finite points and asks when the limit equals the value.

## Documentation Links

- [OpenStax Calculus Volume 1: 4.6 Limits at Infinity and Asymptotes](https://openstax.org/books/calculus-volume-1/pages/4-6-limits-at-infinity-and-asymptotes): limits at infinity, end behavior, and horizontal, vertical, and oblique asymptotes.
- [OpenStax Calculus Volume 1: 2.2 The Limit of a Function](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function): infinite limits and vertical asymptotes from one-sided limits.
- [MIT OpenCourseWare 18.01SC: Part A, Definition and Basic Rules](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/): a free course unit whose sessions 4 and 5 cover limits, continuity, and discontinuity, with videos and notes.
