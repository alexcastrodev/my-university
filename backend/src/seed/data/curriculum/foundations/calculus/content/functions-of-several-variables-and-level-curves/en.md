---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Describe a function $f(x, y)$ through its domain, its range, its graph as a surface in three dimensions, and its level curves.
- Read a contour map: locate peaks, valleys and steep regions, and sketch the level curves of a simple formula.
- Show that a limit at a point does not exist by exhibiting two paths with different limits, and explain why agreement along many paths still does not prove that the limit exists.
- Prove that a limit exists with a squeeze bound or polar coordinates, stating exactly what makes the argument valid.
- Define continuity at a point for a function of two variables and explain why continuity in each variable separately is not enough.

## Context & Motivation

Almost nothing interesting depends on a single number. The temperature in a room depends on a position in space, the cost of a model depends on every one of its parameters, and the height of a hill depends on two coordinates. Single-variable calculus handles one input at a time. This lesson opens the multivariable half of the discipline with the object it studies, a function of several variables, and with the first tool for seeing it: the contour map. A contour map is the standard way to draw a loss function of two parameters.

Two variables are the sweet spot. Everything that is new in the multivariable setting already happens in the plane, and the plane can be drawn. What is new shows up first in limits. On the real line a point is approached from two sides. In the plane it is approached from infinitely many directions, along lines, parabolas and spirals, and a limit has to agree with all of them at once. That single change breaks several habits from `limits-intuition-and-the-formal-definition` and `continuity-and-the-intermediate-value-theorem`, and it is why `partial-derivatives-and-the-multivariable-chain-rule` is careful about its hypotheses.

## Core Theory

### Functions, domains and graphs

A function of two variables assigns one real number $f(x, y)$ to each point $(x, y)$ of a set $D \subseteq \mathbb{R}^2$, its **domain**. When only a formula is given, the domain is every pair for which the formula makes sense. For $g(x, y) = \ln(x - y^2)$ the logarithm needs $x - y^2 > 0$, so the domain is the open region $x > y^2$ to the right of a parabola, and the parabola itself is excluded. The **range** is the set of values $f$ takes.

The **graph** is the set of points $(x, y, f(x, y))$ in $\mathbb{R}^3$, a surface lying above the domain. It is faithful but hard to draw by hand, which is why we also use level curves.

### Level curves and contour maps

The **level curve** of $f$ at height $c$ is the set of points of the domain where $f(x, y) = c$. Geometrically it is the shadow, projected down onto the $xy$-plane, of the slice where the graph meets the horizontal plane $z = c$. Drawing several level curves at evenly spaced values of $c$ gives a **contour map**, the same device as a topographic map.

Reading a contour map relies on a few facts:

- Level curves of different heights never touch, because a point has only one value of $f$. (A single level curve can cross itself: for $f = x^2 - y^2$ the level $c = 0$ is the pair of lines $y = \pm x$.)
- Where the curves crowd together, $f$ changes quickly over a short distance, so the surface is steep. Where they spread out, it is flat.
- Nested closed loops usually mean a peak or a valley at the center.
- A "level curve" need not be a curve. For $f = x^2 + y^2$, the level $c = 0$ is a single point, and the level $c < 0$ is empty.

For three variables the analogue is a **level surface** $f(x, y, z) = c$.

### Limits when there are many paths

The formal definition is the one from the single-variable lesson with an interval replaced by a disk: $\lim_{(x,y) \to (a,b)} f(x, y) = L$ means that for every $\varepsilon > 0$ there is a $\delta > 0$ such that $\lvert f(x, y) - L \rvert < \varepsilon$ whenever $(x, y)$ is in the domain and $0 < \sqrt{(x-a)^2 + (y-b)^2} < \delta$.

Two consequences matter in practice.

**The two-path test.** If two paths into $(a, b)$ give different limits, or one gives none, the limit does not exist. This is a test for non-existence only. Agreement along the paths you tried proves nothing about the paths you did not try.

**The squeeze.** If $\lvert f(x, y) - L \rvert \le B(x, y)$ near $(a, b)$ and $B(x, y) \to 0$, then the limit is $L$. In polar coordinates around the point, $x - a = r\cos\theta$ and $y - b = r\sin\theta$, a limit exists and equals $L$ if $\lvert f - L \rvert \le B(r)$ with a bound $B$ that depends only on $r$ and tends to $0$. The bound must hold for every $\theta$ at once. A bound that is not uniform in $\theta$ proves nothing, and a dependence on $\theta$ that survives as $r \to 0$ (as in Example 3) shows the limit fails.

### Continuity

$f$ is **continuous** at $(a, b)$ when $(a, b)$ is in the domain, the limit at $(a, b)$ exists, and the limit equals $f(a, b)$. Sums, products and compositions of continuous functions are continuous, and quotients are continuous where the denominator is nonzero. Polynomials are therefore continuous everywhere, and rational functions are continuous on their domains.

## Worked Examples

### Example 1: domain and level curves of a hemisphere

Take $f(x, y) = \sqrt{9 - x^2 - y^2}$. The radicand must be nonnegative, so the domain is the closed disk $x^2 + y^2 \le 9$, and the range is $[0, 3]$. The graph is the upper half of a sphere of radius $3$.

Setting $f = c$ and squaring gives $x^2 + y^2 = 9 - c^2$, valid for $0 \le c \le 3$: a circle of radius $\sqrt{9 - c^2}$. At $c = 3$ it collapses to the origin, and for $c > 3$ or $c < 0$ it is empty. The point $(1, 2)$ gives $f = \sqrt{4} = 2$, so it lies on the circle of radius $\sqrt{5}$.

```text
c      radius sqrt(9 - c^2)
0      3.000
1      2.828
2      2.236
3      0.000
```

Equal steps in $c$ give growing gaps between circles: $0.17$, $0.59$, then $2.24$. The contours bunch near the rim of the disk, which is where the hemisphere is steepest.

### Example 2: an elongated bowl

Let $L(x, y) = x^2 + 4y^2$, a loss with a different sensitivity to each parameter. For $c > 0$, $L = c$ is the ellipse $x^2/c + y^2/(c/4) = 1$, with semi-axes $\sqrt{c}$ along $x$ and $\sqrt{c}/2$ along $y$. The level $c = 4$ passes through $(2, 0)$ and $(0, 1)$, and the point $(2, 1)$ sits on the level $c = 8$. The ellipses are stretched along $x$ because $y$ counts four times as much as $x$ in the formula, so the function climbs faster along $y$. The next lessons reuse this function.

### Example 3: a limit that depends on the path

Let $f(x, y) = \dfrac{xy}{x^2 + y^2}$, undefined at the origin. Along the line $y = mx$ with $x \ne 0$,

$$f(x, mx) = \frac{m x^2}{x^2 + m^2 x^2} = \frac{m}{1 + m^2}.$$

This is $0$ for $m = 0$, $1/2$ for $m = 1$, $2/5$ for $m = 2$ and $-1/2$ for $m = -1$. A value that does not depend on $x$ cannot approach a single number as $x \to 0$ for all slopes. In polar coordinates the same fact reads $f = \sin\theta\cos\theta = \tfrac12 \sin 2\theta$: the value is fixed by the direction and ignores $r$. Numerically:

```text
point            (e, e)    (e, 0)    (e, 2e)
e = 1e-1         0.5       0.0       0.4
e = 1e-3         0.5       0.0       0.4
e = 1e-6         0.5       0.0       0.4
```

The limit at $(0, 0)$ does not exist.

### Example 4: a limit that does exist

Let $f(x, y) = \dfrac{x^2 y}{x^2 + y^2}$. Since $x^2 \le x^2 + y^2$, we have $\dfrac{x^2}{x^2 + y^2} \le 1$ and so

$$\lvert f(x, y) \rvert \le \lvert y \rvert \to 0.$$

By the squeeze the limit is $0$. In polar coordinates $f = r\cos^2\theta \sin\theta$, bounded by $r$ for every $\theta$ at once, which is the uniform bound the method needs. Defining $f(0, 0) = 0$ makes $f$ continuous at the origin.

### Example 5: every line agrees, the limit still fails

Let $k(x, y) = \dfrac{x y^2}{x^2 + y^4}$. On the line $y = mx$,

$$k(x, mx) = \frac{m^2 x}{1 + m^4 x^2} \to 0,$$

and on the $y$-axis $k = 0$. Every line gives $0$. Now follow the parabola $x = y^2$:

$$k(y^2, y) = \frac{y^4}{y^4 + y^4} = \frac12.$$

The numbers confirm it: at $e = 10^{-3}$ the value on $y = x$ is about $0.001$, on $y = 2x$ about $0.004$, and on $x = y^2$ exactly $0.5$. The limit does not exist. A test with lines only would have claimed it was $0$.

## Common Misconceptions & Pitfalls

- **"If the limit is the same along every line, it exists."** Example 5 is the counterexample. Straight lines are only a few of the paths into a point, so agreement along them is evidence, never a proof.
- **"Continuous in $x$ and continuous in $y$ separately means continuous."** Take the function of Example 3 and set $f(0, 0) = 0$. Then $f(x, 0) = 0$ and $f(0, y) = 0$, so both slices through the origin are continuous, yet $f$ jumps to $1/2$ along the diagonal.
- **"Polar coordinates always settle a limit."** The bound must be uniform in $\theta$. Showing that $f \to 0$ for each fixed $\theta$ is the same mistake as testing lines: Example 5 gives $0$ along every fixed ray but fails along the parabola.
- **"Level curves are always curves, and a contour map has one for every height."** Levels can be a point, empty, or an entire region (for a constant function), and a map shows only the heights you chose to draw.
- **"The domain is an interval."** It is a region of the plane, and its boundary may or may not belong to it. At a boundary point not in the domain, a limit can exist while the function stays undefined.

## Summary

A function of two variables sends each point of a region of the plane to a number. Its graph is a surface, and its level curves are the shadows of horizontal slices, drawn together as a contour map whose crowding signals steepness. Limits change character in several variables: a point is approached along infinitely many paths, so a different limit along two paths, or no limit along one, kills the limit, while existence needs a bound that holds uniformly, such as a squeeze or a polar bound independent of the angle. Checking lines alone is not enough, as $xy^2/(x^2 + y^4)$ shows. Continuity at a point means the limit exists and equals the value, and continuity in each variable separately does not imply it. Next, `partial-derivatives-and-the-multivariable-chain-rule` differentiates along the coordinate directions and asks what that does and does not guarantee.

## Documentation Links

- [OpenStax Calculus Volume 3, 4.1 Functions of Several Variables](https://openstax.org/books/calculus-volume-3/pages/4-1-functions-of-several-variables): domains, ranges, graphs, level curves and level surfaces.
- [OpenStax Calculus Volume 3, 4.2 Limits and Continuity](https://openstax.org/books/calculus-volume-3/pages/4-2-limits-and-continuity): the limit definition in the plane, path dependence, limit laws and continuity.
- [Active Calculus Multivariable, Functions of Several Variables](https://activecalculus.org/multi/S-MV-Functions.html): graphs and contour plots built through guided activities.
- [Active Calculus Multivariable, Limits](https://activecalculus.org/multi/S-mv_deriv-Limits.html): limits along paths and continuity, with activities.
- [MIT OCW 18.02SC, Unit 2 Part A: Functions of Two Variables](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/2.-partial-derivatives/part-a-functions-of-two-variables-tangent-approximation-and-optimization/): lecture sessions on graphs and on level curves and contour plots.
