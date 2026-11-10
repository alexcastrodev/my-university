---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define a differential equation, its order, and what it means for a function to be a solution on an interval.
- Verify a candidate solution by substituting it into the equation and into the initial condition.
- Distinguish a general solution from a particular solution, and state what an initial-value problem adds.
- State the existence and uniqueness theorem with its hypotheses, and recognize an equation where the conclusion fails.
- Read a slope field, follow it with Euler's method, and judge the error of the result.
- Solve $y' = ky$ and use it for exponential growth, decay, doubling time, and half-life.

## Context & Motivation

Many laws of change are stated as rates: a population grows in proportion to its size, a hot object loses heat in proportion to the temperature gap, a parameter vector moves against the gradient of a loss. A rate is a derivative, so the law is an equation containing the unknown function and its derivative. That is a **differential equation**, and solving it means finding the function whose rate of change obeys the law.

The simplest case, $y' = f(t)$, is solved by antiderivatives (`antiderivatives-and-initial-value-problems`). Here the right-hand side may depend on $y$ itself, so the answer is no longer one integral away. This lesson sets up the vocabulary, the substitution check used on every solution that follows, the theorem on when an answer exists and is unique, and the first model, exponential growth and decay. The next lesson, `separable-differential-equations`, solves a whole class of such equations.

## Core Theory

### Equations, order, and solutions

An **ordinary differential equation** (ODE) relates an unknown function $y(t)$ of one variable to its derivatives. Its **order** is the highest derivative that appears: $y' = 2y$ is first order, $y'' + 4y = 0$ is second order.

A **solution** on an interval $I$ is a differentiable function that turns the equation into a true identity for every $t \in I$. The interval is part of the answer: a formula can solve the equation on one interval and be meaningless on another.

The reliable test of a solution is substitution: put the candidate and its derivatives into the equation and check that both sides agree for every $t$ in the interval, that is, that the residual $y' - f(t, y)$ simplifies to $0$. It works however the candidate was found, so it is the last step of every problem below.

### General and particular solutions, initial-value problems

For a first-order equation, solutions usually come as a family with one arbitrary constant. For $y' = 2y$, every function $y = Ce^{2t}$ works: $y' = 2Ce^{2t} = 2y$. This is a **general solution**. A **particular solution** fixes the constant. A second-order equation typically needs two constants, one per order.

An **initial-value problem** (IVP) pairs the equation with conditions that fix the constants: for a first-order equation, $y(t_0) = y_0$. For $y' = 2y$, $y(0) = 3$ gives $C = 3$ and $y = 3e^{2t}$. The condition is part of what you must verify.

A general solution is not a guarantee that no other solution exists; Example 2 has one outside its family.

### Existence and uniqueness

Consider the IVP $y' = f(t, y)$, $y(t_0) = y_0$.

**Theorem (Picard and Lindelöf).** Suppose $f$ and $\partial f/\partial y$ are both continuous on an open rectangle in the $(t, y)$ plane that contains $(t_0, y_0)$. Then there is some interval around $t_0$ on which the IVP has a solution, and two solutions agree on every interval containing $t_0$ on which both stay in the rectangle.

The theorem is **local**: it guarantees a solution near $t_0$, not for all $t$. And uniqueness is guaranteed by the **second** hypothesis (sufficient, not necessary: $y' = \lvert y\rvert$ has no $\partial f/\partial y$ at $y = 0$, yet each of its IVPs has one solution). With only $f$ continuous, a solution exists but uniqueness can fail. Both failures appear below. A consequence used later: when the hypotheses hold everywhere, two different solution curves never touch, since touching would mean two solutions through one point.

### Slope fields and Euler's method

The equation $y' = f(t, y)$ assigns a slope to every point $(t, y)$. Draw a short segment with that slope at each point and you have a **slope field** (also called a direction field). A solution curve is one that is tangent to the segments everywhere it passes. For $y' = t - y$ the slopes at a few points are:

```text
slope = t - y      t=0   t=1   t=2   t=3   t=4
y =  3              -3    -2    -1     0     1
y =  2              -2    -1     0     1     2
y =  1              -1     0     1     2     3
y =  0               0     1     2     3     4
y = -1               1     2     3     4     5
```

The slope is $0$ along the line $y = t$, negative above it and positive below it. A solution that starts above that line falls until it meets the line, then rises.

**Euler's method** turns the picture into an algorithm: from $(t_n, y_n)$, follow the local slope for a step $h$:

$$y_{n+1} = y_n + h\,f(t_n, y_n), \qquad t_{n+1} = t_n + h.$$

It is the tangent-line approximation applied repeatedly. The error at a fixed time shrinks roughly in proportion to $h$ (it is a first-order method), and in general it does not vanish for a fixed $h$.

### Exponential growth and decay

Suppose a quantity changes at a rate proportional to its size: $y' = ky$, $y(0) = y_0$, with $k$ constant. The function $y = y_0 e^{kt}$ solves it. To see that it is the **only** solution, let $y$ be any solution on an interval and compute

$$\frac{d}{dt}\left(y\,e^{-kt}\right) = y'e^{-kt} - ky\,e^{-kt} = (y' - ky)\,e^{-kt} = 0.$$

A function whose derivative is zero on an **interval** is constant there (a consequence of the Mean Value Theorem, `the-mean-value-theorem-and-monotonicity`), so $y e^{-kt} = C$, and the initial condition gives $C = y_0$. The word "interval" matters: on a domain such as $t \neq 0$, which has two pieces, the constant may differ on each piece.

For $k > 0$ this is growth with **doubling time** $T_2 = \ln 2 / k$. For $k < 0$ it is decay with **half-life** $T_{1/2} = \ln 2 / \lvert k \rvert$. Both are independent of the starting amount, which is the signature of exponential change.

## Worked Examples

### Example 1: verifying a solution, and its interval

Check that $y = 1/(1 - t)$ solves $y' = y^2$, $y(0) = 1$.

$$y' = \frac{1}{(1-t)^2} = y^2, \qquad y(0) = \frac{1}{1 - 0} = 1.$$

Both sides agree, so the formula solves the equation wherever it is defined and differentiable, which is $t \neq 1$, a set with two pieces. It meets $y(0) = 1$ on the piece containing $t_0 = 0$. The solution of the IVP through $(0, 1)$ lives on $(-\infty, 1)$, the piece that contains $t_0 = 0$. A numerical integration agrees ($y(0.9) = 10$, $y(0.99) = 100$) and runs away to infinity as $t \to 1^-$.

This is the locality in the theorem: $y^2$ and $2y$ are continuous on the whole plane, yet the solution blows up in finite time.

### Example 2: when uniqueness fails

Consider $y' = 3y^{2/3}$, $y(0) = 0$, with the real cube root. The function $y \equiv 0$ is a solution: both sides are $0$. The function $y = t^3$ also is: $y' = 3t^2$ and $3(t^3)^{2/3} = 3t^2$ for every real $t$, and $y(0) = 0$. So one IVP has two solutions.

There are many more. For any $c \ge 0$, take $y = 0$ for $t \le c$ and $y = (t - c)^3$ for $t > c$: the second piece has derivative $3(t-c)^2 \to 0$ at $t = c$, matching the first, so the glued function solves the equation. A solution can sit at $0$ as long as it likes and then lift off.

The theorem explains it. Here $f(y) = 3y^{2/3}$ is continuous, but $\partial f/\partial y = 2y^{-1/3}$ is undefined at $y = 0$ and unbounded near it (it is $20$ at $y = 10^{-3}$ and $2000$ at $y = 10^{-9}$). The second hypothesis fails at exactly the initial point. Also, the family $y = (t - c)^3$ never equals the zero function, so $y \equiv 0$ lies outside that "general solution".

### Example 3: Euler's method against the exact solution

Take $y' = t - y$, $y(0) = 1$. The function $y = t - 1 + 2e^{-t}$ solves it: $y' = 1 - 2e^{-t}$ and $t - y = 1 - 2e^{-t}$, and $y(0) = -1 + 2 = 1$. With $h = 0.5$, Euler gives:

```text
t      Euler y    exact y
0.0    1.0000     1.0000
0.5    0.5000     0.7131
1.0    0.5000     0.7358
1.5    0.7500     0.9463
2.0    1.1250     1.2707
```

The error at $t = 2$ is $0.1457$. Halving the step gives errors at $t = 2$ of $0.0704$ ($h = 0.25$), $0.0345$ ($h = 0.125$), and $0.0171$ ($h = 0.0625$): each halving of $h$ roughly halves the error.

### Example 4: Euler's method is gradient descent

Minimize $f(x) = 5x^2$ by gradient descent with step size $h$: $x_{k+1} = x_k - h\,f'(x_k) = (1 - 10h)\,x_k$. This is exactly Euler's method applied to the **gradient flow** $x' = -f'(x) = -10x$, whose solution is $x(t) = x_0 e^{-10t}$ (see `gradients-extending-derivatives-to-several-variables` for the gradient in several variables). Starting from $x_0 = 1$:

```text
h      factor 1-10h   x_0..x_5
0.05    0.5           1, 0.5, 0.25, 0.125, 0.0625, 0.0312
0.15   -0.5           1, -0.5, 0.25, -0.125, 0.0625, -0.0312
0.20   -1.0           1, -1, 1, -1, 1, -1
0.25   -1.5           1, -1.5, 2.25, -3.375, 5.0625, -7.5938
```

The true flow decays monotonically, but Euler's iterates converge only when $\lvert 1 - 10h \rvert < 1$, that is $0 < h < 0.2$. At $h = 0.15$ the iterates converge while flipping sign, so they do not follow the flow at all; at $h = 0.25$ they diverge. A step that is too large breaks the discretization even though the continuous equation is perfectly well behaved.

### Example 5: half-life

A substance decays with a half-life of $8$ days (a hypothetical value). Then $k = -\ln 2 / 8 \approx -0.08664\ \text{day}^{-1}$ and $y = y_0 e^{kt} = y_0\,2^{-t/8}$. After $30$ days the fraction left is $2^{-30/8} \approx 0.0743$, about $7.4\%$. The time to fall to $1\%$ solves $2^{-t/8} = 0.01$, so $t = 8\log_2 100 \approx 53.15$ days. Substitution check: $y' = -\frac{\ln 2}{8}\,y_0 2^{-t/8} = k y$.

## Common Misconceptions & Pitfalls

- **"A solution is a number."** It is a function, and it comes with an interval. Example 1's formula is also defined for $t > 1$, but that branch is a different solution and does not satisfy $y(0) = 1$.
- **"A smooth equation has solutions for all time."** The theorem is local, and $y' = y^2$ blows up.
- **"An IVP always has exactly one solution."** It does, on some interval around $t_0$, when $f$ and $\partial f/\partial y$ are continuous near the initial point. Drop the second condition and Example 2 can appear.
- **"The general solution lists every solution."** It lists the family you get from the usual method. Check for solutions outside it, as the next lesson does systematically.
- **"A smaller Euler step is always safer, a larger one only less accurate."** Too large a step can make the iteration unstable, as in Example 4.
- **Checking the formula but not the initial condition.** A function can satisfy the equation and miss $y(t_0) = y_0$, so it solves a different IVP.

## Summary

A solution of a differential equation is a function on an interval that turns the equation into an identity, tested by substitution. A first-order general solution carries one constant, which an initial condition fixes. If $f$ and $\partial f/\partial y$ are continuous near $(t_0, y_0)$, the IVP has a unique solution on some interval around $t_0$, but only locally, and without the second hypothesis uniqueness can fail ($y' = 3y^{2/3}$). Slope fields show the solution curves and Euler's method follows them in steps, with error proportional to $h$ and instability for large $h$, which is why gradient descent has a step-size limit. The equation $y' = ky$ has the unique solution $y_0e^{kt}$, with doubling time or half-life $\ln 2 / \lvert k \rvert$.

## Documentation Links

- [OpenStax Calculus Volume 2, 4.1 Basics of Differential Equations](https://openstax.org/books/calculus-volume-2/pages/4-1-basics-of-differential-equations): order, general and particular solutions, initial-value problems, and verifying solutions.
- [OpenStax Calculus Volume 2, 4.2 Direction Fields and Numerical Methods](https://openstax.org/books/calculus-volume-2/pages/4-2-direction-fields-and-numerical-methods): direction fields, solution curves, equilibria, and Euler's method.
- [MIT OpenCourseWare 18.01SC, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): lecture notes, videos, and problems, including the session "Introduction to Differential Equations".
