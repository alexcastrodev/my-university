---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Build and compute left, right, midpoint, and trapezoid Riemann sums for a function on $[a,b]$ with $n$ subintervals.
- State the definition of the definite integral as a limit over all tagged partitions whose mesh shrinks to zero, and say which functions are guaranteed to have one.
- Tell net signed area apart from total area, and explain why $\int_0^{2\pi}\sin x\,dx = 0$.
- Apply linearity, additivity over intervals, orientation reversal, and comparison to rewrite and bound integrals.
- Predict how fast each rule converges as $n$ doubles, and recognize when that rate degrades.
- Use integrals to estimate the cost of a sum, such as the work of a nested loop.

## Context & Motivation

The previous lesson, `antiderivatives-and-initial-value-problems`, ran differentiation backwards. This one starts from a question that looks unrelated: how much accumulates under a curve? Distance from a speed log, total energy from a power reading, probability mass from a density, total cost of a loop whose body gets more expensive each iteration: all of these are a rate multiplied by a small step and added up. The definite integral is the exact value that this adding-up approaches as the steps shrink.

The definition below never mentions a derivative. That is deliberate. It makes the integral a limit of finite sums, which a computer can actually evaluate, and it makes the next lesson, `the-fundamental-theorem-of-calculus`, a real discovery: the two ideas (rates and accumulation) were defined independently and turn out to be inverses.

## Core Theory

### Partitions and Riemann sums

A **partition** of $[a,b]$ is a list of points $a = x_0 < x_1 < \dots < x_n = b$. The subinterval widths are $\Delta x_i = x_i - x_{i-1}$ and the **mesh** $\lVert P\rVert$ is the largest of them. Pick a **tag** $x_i^*$ in each subinterval $[x_{i-1}, x_i]$. The **Riemann sum** is

$$S(f, P, x^*) = \sum_{i=1}^{n} f(x_i^*)\,\Delta x_i$$

Each term is the signed area of one rectangle: width times height, with negative height where $f<0$. With equal widths $\Delta x = (b-a)/n$ and $x_i = a + i\,\Delta x$, three tag choices give the standard rules:

- **Left**: $L_n = \Delta x\sum_{i=0}^{n-1} f(x_i)$
- **Right**: $R_n = \Delta x\sum_{i=1}^{n} f(x_i)$
- **Midpoint**: $M_n = \Delta x\sum_{i=1}^{n} f\big(\tfrac{x_{i-1}+x_i}{2}\big)$

The **trapezoid** rule averages the first two: $T_n = (L_n + R_n)/2$.

### The definition

Let $f$ be bounded on $[a,b]$. It is **Riemann integrable** with integral $I$ if for every $\varepsilon > 0$ there is a $\delta > 0$ such that every tagged partition with $\lVert P\rVert < \delta$ satisfies $\lvert S(f,P,x^*) - I\rvert < \varepsilon$. Then we write $I = \int_a^b f(x)\,dx$.

The phrase "every tagged partition" matters: equal widths and left tags are just one family. A numerical test on $f(x)=x^2$, $[0,1]$, with random partition points and a random tag in each piece gives sums of 0.3460 (10 pieces), 0.33360 (100), 0.333304 (1000), and 0.33333335 (100000 pieces, largest piece about 0.0001). All head to the same $1/3$.

Which functions qualify? A function that is continuous on $[a,b]$ is integrable, and so is a bounded function with finitely many discontinuities, and so is a monotone function. The hypotheses are not decoration, and two failures are worth seeing.

- **Unbounded.** Define $f(x)=1/x$ on $(0,1]$ and $f(0)=0$. Right sums with $n$ pieces equal the harmonic number $H_n$: 2.93 for $n=10$, 5.19 for $100$, 7.49 for $1000$, 12.09 for $10^5$. They keep growing, and a tag chosen near $0$ can inflate a sum as much as we like. No limit exists. Some unbounded functions, like $1/\sqrt{x}$, get a value through a second limit (see `improper-integrals`), which is a different object.
- **Bounded but too discontinuous.** Let $f(x)=1$ at rational $x$ and $0$ at irrational $x$ on $[0,1]$. Every subinterval, however small, holds both kinds of number. Rational tags give $S=1$ for every partition and irrational tags give $S=0$, so no single $I$ works.

### Net signed area

The integral counts area above the axis as positive and below as negative. For $\sin$ on $[0,2\pi]$ the two humps cancel, so the integral is $0$, while the total area is $\int_0^{2\pi}\lvert\sin x\rvert\,dx = 4$.

### Properties

For integrable $f$ and $g$ on the intervals involved:

$$\int_a^b (c f + g)\,dx = c\int_a^b f\,dx + \int_a^b g\,dx, \qquad \int_a^b f = \int_a^c f + \int_c^b f, \qquad \int_b^a f = -\int_a^b f$$

Also $\int_a^a f = 0$, $\int_a^b c\,dx = c(b-a)$, if $f\le g$ then $\int_a^b f \le \int_a^b g$ (for $a<b$), and $\big\lvert\int_a^b f\big\rvert \le \int_a^b \lvert f\rvert$. Both inequalities assume $a\le b$: with $f=1$, $a=1$, $b=0$ the second would read $1\le-1$. There is no product rule of this kind: $\int fg \ne \int f\int g$ in general.

### Bracketing and convergence rates

If $f$ is increasing on $[a,b]$, each left rectangle sits under the curve and each right rectangle over it, so $L_n \le I \le R_n$ and $R_n - L_n = (f(b)-f(a))\,\Delta x$. That gives a certified error bar from the sums alone. (For decreasing $f$ the inequalities flip.) For $x^2$ on $[0,1]$ with $n=4$: $0.21875 \le I \le 0.46875$, width $0.25 = 1\cdot\frac14$.

How fast do the rules close in? The script output below is for $x^2$ on $[0,1]$, where $I = 1/3$.

```text
  n      left      right    midpoint  trapezoid   |err L|    |err M|
  4    0.21875   0.46875   0.328125   0.34375    1.15e-01   5.21e-03
  8    0.27344   0.39844   0.332031   0.33594    5.99e-02   1.30e-03
 16    0.30273   0.36523   0.333008   0.33398    3.06e-02   3.26e-04
 64    0.32556   0.34119   0.333313   0.33337    7.77e-03   2.03e-05
128    0.32944   0.33725   0.333328   0.33334    3.90e-03   5.09e-06
```

Doubling $n$ halves the left and right errors (ratio 1.995 and 2.005 from $n=64$ to $128$) and quarters the midpoint and trapezoid errors (ratio 4.0). For smooth $f$ with $f(b)\ne f(a)$, the left and right errors behave like $(f(b)-f(a))\Delta x/2$, which is $O(1/n)$; midpoint and trapezoid are $O(1/n^2)$. For the midpoint rule, the over- and underestimates within each piece largely cancel. For the trapezoid rule, the leading $\pm(f(b)-f(a))\Delta x/2$ errors of the left and right sums have opposite signs, so averaging the two removes them. The guarantee needs smoothness. For $\sqrt{x}$ on $[0,1]$ the slope is unbounded at $0$, and the midpoint error ratio on doubling from $64$ to $128$ is only 2.79, about $2^{3/2}$, not 4.

## Worked Examples

### Example 1: sums by hand

Take $f(x)=x^2$ on $[0,1]$ with $n=4$, so $\Delta x = \tfrac14$.

$$L_4 = \tfrac14\big(0 + \tfrac1{16} + \tfrac4{16} + \tfrac9{16}\big) = \tfrac{14}{64} = 0.21875, \qquad R_4 = \tfrac14\cdot\tfrac{30}{16} = 0.46875$$

$$M_4 = \tfrac14\big(\tfrac1{64} + \tfrac9{64} + \tfrac{25}{64} + \tfrac{49}{64}\big) = \tfrac{84}{256} = 0.328125$$

The trapezoid value is $0.34375$. The midpoint is already within $0.0052$ of $1/3$, an error more than 20 times smaller than the left sum's $0.115$.

### Example 2: the exact value as a limit

Use $\sum_{i=1}^n i^2 = \frac{n(n+1)(2n+1)}{6}$ with right tags on $[0,b]$:

$$R_n = \sum_{i=1}^{n}\Big(\frac{ib}{n}\Big)^2\frac{b}{n} = \frac{b^3}{n^3}\cdot\frac{n(n+1)(2n+1)}{6} = b^3\,\frac{(n+1)(2n+1)}{6n^2}$$

As $n\to\infty$ the fraction tends to $\frac13$, so $\int_0^b x^2\,dx = \frac{b^3}{3}$. Check: $b=1$, $n=4$ gives $\frac{5\cdot 9}{96} = 0.46875$, the value from Example 1. Writing $R_n = \frac13 + \frac1{2n} + \frac1{6n^2}$ also explains the $O(1/n)$ error seen in the table. A symbolic integration and a numerical quadrature both return $9$ for $b=3$.

### Example 3: net area versus area

Midpoint sums of $\sin$ on $[0,2\pi]$ for $n=4, 8, 100$ are all zero up to rounding ($10^{-16}$), because the midpoints pair off with opposite sine values. So $\int_0^{2\pi}\sin x\,dx = 0$, while $\int_0^{2\pi}\lvert\sin x\rvert\,dx = 4$ (both confirmed symbolically and by quadrature).

### Example 4: bounding the cost of a loop

Suppose iteration $i$ of a loop does $i^2$ units of work, for $i=1,\dots,n$. Total work is $\sum_{i=1}^n i^2$, a right sum with $\Delta x = 1$ for $x^2$ on $[0,n]$. Because $x^2$ is increasing,

$$\int_0^n x^2\,dx \le \sum_{i=1}^n i^2 \le \int_1^{n+1} x^2\,dx, \qquad\text{that is}\qquad \frac{n^3}{3} \le \sum_{i=1}^n i^2 \le \frac{(n+1)^3 - 1}{3}$$

For $n=10$ the true sum is $385$, between $333.3$ and $443.3$. The ratio of the sum to $n^3/3$ is 1.155 at $n=10$, 1.015 at $100$, and 1.0015 at $1000$. The work is $\Theta(n^3)$, and no closed form was needed.

## Common Misconceptions & Pitfalls

- **"The integral is the area, full stop."** It is the net signed area. Regions below the axis subtract. Use $\int\lvert f\rvert$ for total area (and split at sign changes to compute it).
- **"Every bounded function is integrable."** The rational-indicator function is bounded and has no Riemann integral. Continuity, or at least finitely many jumps, is what the usual theorems assume.
- **"Left, right, and midpoint rules are equally good."** They converge to the same limit, but for smooth functions the midpoint and trapezoid errors shrink like $1/n^2$ against $1/n$ for the others. The exception proves the point: for $\sin$ on $[0,\pi]$ the endpoint values are both $0$, so the left, right, and trapezoid sums coincide and all three are $O(1/n^2)$.
- **"Left sums always underestimate."** Only for increasing $f$ is that guaranteed. For decreasing $f$ they overestimate, and for a function that rises and falls neither bound is guaranteed (for $\sin$ on $[0,\pi]$ every left sum happens to fall below $2$, but that is not a rule).
- **"$\int fg = \int f\cdot\int g$."** Integration is linear in $f$, not multiplicative. With $f=g=x$ on $[0,1]$: $\int fg = \frac13$ but $\int f\int g = \frac14$.

## Summary

A Riemann sum adds up $f(x_i^*)\,\Delta x_i$ over a partition. The definite integral $\int_a^b f$ is the number every such sum approaches as the mesh goes to zero, for every choice of partition and tags, and it exists for continuous functions and for bounded functions with finitely many discontinuities. It fails to exist for unbounded functions and for functions like the rational indicator that are too discontinuous. The integral measures net signed area. For smooth integrands the left and right rules have $O(1/n)$ error and the midpoint and trapezoid rules $O(1/n^2)$, which the table above shows directly, and for increasing $f$ the left and right sums bracket the true value. Comparing a sum with an integral is a standard way to bound the running time of a loop. Computing integrals by limits of sums works but is slow, and the next lesson, `the-fundamental-theorem-of-calculus`, replaces it with antiderivatives.

## Documentation Links

- [OpenStax Calculus Volume 1, 5.1 Approximating Areas](https://openstax.org/books/calculus-volume-1/pages/5-1-approximating-areas): sigma notation and left, right, and midpoint sums as area approximations.
- [OpenStax Calculus Volume 1, 5.2 The Definite Integral](https://openstax.org/books/calculus-volume-1/pages/5-2-the-definite-integral): the limit definition, net signed area, and the properties of the integral.
- [Active Calculus, 4.2 Riemann sums](https://activecalculus.org/single/sec-4-2-Riemann.html): sigma notation and Riemann sums built from a velocity problem.
- [Active Calculus, 4.3 The definite integral](https://activecalculus.org/single/sec-4-3-definite-integral.html): the definition, signed area, and properties.
- [MIT OCW 18.01SC, Unit 3 Part A](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-3-the-definite-integral-and-its-applications/part-a-definition-of-the-definite-integral-and-first-fundamental-theorem/): lectures and exercises on the definition of the definite integral.
