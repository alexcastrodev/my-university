---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define local and absolute extrema and critical points of a function of two variables, and state Fermat's theorem with its hypotheses.
- Compute the Hessian matrix and the discriminant $D = f_{xx} f_{yy} - f_{xy}^2$, and apply the second-derivative test with every hypothesis checked.
- Recognize a saddle point, compute its Hessian, and explain why the test says nothing when $D = 0$.
- Find absolute extrema of a continuous function on a closed, bounded region by comparing interior critical points with the boundary.
- Use the Hessian to confirm that the solution of the least-squares equations is a minimum.

## Context & Motivation

Optimization asks for the largest or smallest value of a quantity, and the first move in several variables is the one that `gradients-extending-derivatives-to-several-variables` describes: set $\nabla f = 0$. That lesson also warns, correctly, that a vanishing gradient only produces a *candidate*, which may be a minimum, a maximum or a saddle, and it leaves the distinguishing test out of scope. This lesson supplies it. In one variable the tool is the second-derivative test from `extrema-concavity-and-optimization`: $f'' > 0$ at a flat point means a bowl. With two variables, curvature depends on direction, so a single number $f''$ becomes a matrix of second partials, the **Hessian**, and the test reads its sign pattern.

This is also the language of machine learning, where the loss is a function of many parameters. A flat point of the loss with curvature of both signs is a saddle, where the gradient is small and gradient descent slows. Whether a model's loss has a single bottom, as in least squares with independent columns, or a landscape of competing valleys is a question about the Hessian.

## Core Theory

### Critical points and Fermat's theorem

$f$ has a **local minimum** at $(a, b)$ if $f(x, y) \ge f(a, b)$ for all $(x, y)$ near $(a, b)$, and an **absolute minimum** if this holds on the whole domain. Maxima are the reverse.

**Fermat's theorem.** If $f$ has a local extremum at an interior point $(a, b)$ and $f_x$ and $f_y$ exist there, then $f_x(a, b) = f_y(a, b) = 0$. The proof is one line: $x \mapsto f(x, b)$ has a local extremum at $a$, so its derivative $f_x(a, b)$ must vanish, and the same holds in $y$.

A **critical point** is an interior point where both partials are zero or at least one does not exist. Extrema occur only at critical points (or on the boundary), but the converse is false. The origin is critical for $f = x^2 - y^2$ and is neither a maximum nor a minimum. And points where partials fail to exist count: $f = \sqrt{x^2+y^2}$ has its minimum at the origin, where no partial derivative exists.

### The Hessian and what it measures

When the second partials are continuous, Clairaut's theorem makes the **Hessian** symmetric:

$$H = \begin{pmatrix} f_{xx} & f_{xy} \\ f_{xy} & f_{yy} \end{pmatrix}, \qquad D = \det H = f_{xx} f_{yy} - f_{xy}^2.$$

The reason it matters is the second-order Taylor expansion at a critical point. For a displacement $\mathbf h$, with the gradient term zero,

$$f(\mathbf a + \mathbf h) \approx f(\mathbf a) + \tfrac12 \mathbf h^{\top} H \mathbf h.$$

So near a critical point, $f(\mathbf a + \mathbf h) - f(\mathbf a) \approx \tfrac12 \mathbf h^{\top} H \mathbf h$. When $D \ne 0$ the sign of this quadratic form decides the behavior; when $H$ is degenerate (Example 2 has $H = 0$) it says too little. The form is positive for every $\mathbf h \ne 0$ exactly when both eigenvalues of $H$ are positive (a bowl), negative for every $\mathbf h$ when both are negative (a dome), and takes both signs when the eigenvalues have opposite signs (a saddle). Since $D$ is the product of the eigenvalues and $f_{xx} + f_{yy}$ their sum, this is a sign test.

### The second-derivative test

**Theorem.** Suppose $f$ has continuous second partials on a disk around $(a, b)$ and $\nabla f(a, b) = 0$. Then:

- if $D > 0$ and $f_{xx} > 0$, $f$ has a local minimum at $(a, b)$;
- if $D > 0$ and $f_{xx} < 0$, a local maximum;
- if $D < 0$, a saddle point: $f$ rises in some directions and falls in others;
- if $D = 0$, the test gives **no information**.

For $D > 0$ the eigenvalues share a sign, and $f_{xx}$ tells which. For $D < 0$ they have opposite signs. In $n$ variables the same logic applies to the eigenvalues of the $n \times n$ Hessian: all positive means a local minimum, all negative a local maximum, eigenvalues of both signs a saddle (even if another eigenvalue is zero), and a zero eigenvalue is inconclusive only when the nonzero ones share one sign.

### Absolute extrema on a closed region

**Extreme Value Theorem.** If $f$ is continuous on a closed and bounded set $R$, it attains an absolute maximum and an absolute minimum on $R$. Then find them by: (1) listing the interior critical points; (2) examining $f$ on the boundary, usually by parametrizing it and using one-variable calculus including the endpoints; (3) comparing all the values. Both hypotheses matter. On the open unit disk, $f = x + y$ has supremum $\sqrt2$ that is never attained, and on the whole plane $f = x + y$ has no maximum or minimum at all.

## Worked Examples

### Example 1: a saddle and a minimum

Let $f(x, y) = x^3 + y^3 - 3xy$. Then $f_x = 3x^2 - 3y$ and $f_y = 3y^2 - 3x$. Setting both to zero gives $y = x^2$ and $x = y^2$, so $x = x^4$, whose real solutions are $x = 0$ and $x = 1$. The critical points are $(0, 0)$ and $(1, 1)$. The Hessian is

$$H = \begin{pmatrix} 6x & -3 \\ -3 & 6y \end{pmatrix}.$$

At $(0, 0)$: $H = \begin{pmatrix} 0 & -3 \\ -3 & 0 \end{pmatrix}$, $D = -9 < 0$, a **saddle**. The eigenvalues are $-3$ along $(1, 1)$ and $+3$ along $(1, -1)$. This predicts what happens: on $y = x$, $f = 2t^3 - 3t^2 \approx -3t^2$ falls, while on $y = -x$, $f = 3t^2$ rises. The numbers agree:

```text
step e        f(e, e)      f(e, -e)
0.1           -0.0280       0.0300
0.01          -0.000298     0.000300
```

At $(1, 1)$: $H = \begin{pmatrix} 6 & -3 \\ -3 & 6 \end{pmatrix}$, $D = 27 > 0$ and $f_{xx} = 6 > 0$, a **local minimum** with $f(1, 1) = -1$ and eigenvalues $3$ and $9$. It is not an absolute minimum: $f(-10, 0) = -1000$, and $f$ is unbounded below. The test is a local statement.

The saddle also shows up in the contour picture. The level set $f = 0$ is $x^3 + y^3 = 3xy$, the folium of Descartes: a loop plus two unbounded branches, crossing itself at the origin. This is the situation from `directional-derivatives-and-the-direction-of-steepest-ascent` in which $\nabla f = 0$ and the level set has no single tangent.

### Example 2: when $D = 0$ decides nothing

At the origin, $x^4 + y^4$, $-x^4 - y^4$ and $x^4 - y^4$ all have $H = 0$ and $D = 0$. The first has a minimum, the second a maximum, the third a saddle (it rises along the $x$-axis and falls along the $y$-axis). The same test result covers three different behaviors, so a degenerate Hessian needs higher-order terms or a direct argument, for instance restricting $f$ to lines and curves through the point and comparing signs, as the $x$-axis and $y$-axis do for the third function. Even $f = x^2 + y^4$, with $H = \mathrm{diag}(2, 0)$, has $D = 0$ though it has a minimum.

### Example 3: least squares has one bottom

Fit a line $y = wx + b$ to the points $(0, 1)$, $(1, 3)$, $(2, 4)$ by minimizing the squared error

$$L(w, b) = \sum_i (w x_i + b - y_i)^2 = 5w^2 + 6wb + 3b^2 - 22w - 16b + 26.$$

Setting $L_w = 10w + 6b - 22 = 0$ and $L_b = 6w + 6b - 16 = 0$ (the normal equations of `least-squares-via-linear-algebra`) gives $w = 3/2$ and $b = 7/6$. The Hessian is $\begin{pmatrix} 10 & 6 \\ 6 & 6 \end{pmatrix}$, with $D = 60 - 36 = 24 > 0$ and $L_{ww} = 10 > 0$, so it is a local minimum, with eigenvalues about $1.68$ and $14.32$. The columns $(1, x_i)$ of the design matrix are independent because the $x_i$ are not all equal, which is what makes $D > 0$. Because $L$ is quadratic its Hessian is the same at every point and the second-order expansion is exact: $L(\mathbf p) = L(\mathbf p^*) + \tfrac12 \mathbf h^{\top} H \mathbf h \ge L(\mathbf p^*)$. This is an absolute minimum, with $L = 1/6$.

### Example 4: absolute extrema on a disk

Find the extrema of $f(x, y) = x^2 + 2y^2 - 2x$ on $x^2 + y^2 \le 4$, a closed bounded disk, so the Extreme Value Theorem applies.

*Interior.* $f_x = 2x - 2 = 0$ and $f_y = 4y = 0$ give $(1, 0)$, inside the disk, with $f = -1$.

*Boundary.* Let $x = 2\cos t$, $y = 2\sin t$ and $c = \cos t \in [-1, 1]$. Since $y^2 = 4 - 4c^2$,

$$f = 4c^2 + 8(1 - c^2) - 4c = 8 - 4c^2 - 4c.$$

Its derivative vanishes at $c = -1/2$ (value $9$), and the endpoints give $f = 0$ at $c = 1$ and $f = 8$ at $c = -1$. The interval endpoints must be tested too.

*Compare.* The values are $-1$, $9$, $0$, $8$. The absolute minimum is $-1$ at $(1, 0)$ and the absolute maximum is $9$ at $(-1, \pm\sqrt3)$, since $c = -1/2$ means $x = -1$ and $y^2 = 3$. A brute-force grid over the disk finds the same extremes.

## Common Misconceptions & Pitfalls

- **"$\nabla f = 0$ means an extremum."** Example 1 has a saddle with zero gradient. Check the sign pattern of the Hessian.
- **"$D > 0$ means a minimum."** Maxima also have $D > 0$. The sign of $f_{xx}$ separates them.
- **"$D = 0$ means a saddle."** It means the test fails, and Example 2 shows all three outcomes.
- **"A local minimum is the minimum."** The local minimum at $(1, 1)$ in Example 1 has value $-1$, yet $f$ takes values as low as $-1000$.
- **"Optimizing on a region means solving $\nabla f = 0$."** The absolute extremum often sits on the boundary, as the maximum in Example 4 does.
- **"Critical points are only where the gradient vanishes."** They include points where a partial derivative fails to exist, like the tip of a cone.
- **"Saddles are exotic."** Any critical point whose curvature has both signs is one, and gradient descent moves slowly near it because the gradient is small there.

## Summary

A critical point of $f$ is an interior point where the gradient vanishes or does not exist, and by Fermat's theorem every interior local extremum is critical, but not every critical point is an extremum. At a critical point where $f$ has continuous second partials, the Hessian decides in the usual case: $D > 0$ with $f_{xx} > 0$ gives a local minimum, $D > 0$ with $f_{xx} < 0$ a local maximum, $D < 0$ a saddle, and $D = 0$ no conclusion. The reason is that near the point $f - f(\mathbf a)$ is approximately the quadratic form $\tfrac12 \mathbf h^{\top} H \mathbf h$, whose shape is read from the eigenvalues when $D \ne 0$. The test is local, so absolute extrema on a closed bounded region come from the Extreme Value Theorem: compare interior critical points with the values on the boundary. With this the multivariable unit of derivatives is complete, and `double-integrals-cartesian-and-polar` moves on to integration over regions.

## Documentation Links

- [OpenStax Calculus Volume 3, 4.7 Maxima/Minima Problems](https://openstax.org/books/calculus-volume-3/pages/4-7-maxima-minima-problems): critical points, the discriminant test, saddle points and absolute extrema on closed regions.
- [Active Calculus Multivariable, Optimization](https://activecalculus.org/multi/S-mv_deriv-optimization.html): classifying critical points through activities with the Hessian.
- [Active Calculus Multivariable, Second-Order Partial Derivatives](https://activecalculus.org/multi/S-mv_deriv-second_order.html): second and mixed partials that build the Hessian.
- [MIT OCW 18.02SC, Unit 2 Part A: Functions of Two Variables](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/2.-partial-derivatives/part-a-functions-of-two-variables-tangent-approximation-and-optimization/): lecture sessions on optimization problems, least squares and the second derivative test.
