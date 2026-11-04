---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define the directional derivative $D_{\mathbf u} f$ as a limit along a unit vector, and say why the vector must have length one.
- Prove that $D_{\mathbf u} f = \nabla f \cdot \mathbf u$ for a differentiable $f$, and name what goes wrong when $f$ is not differentiable.
- Derive from $D_{\mathbf u} f = \lVert\nabla f\rVert \cos\theta$ the directions of steepest ascent, steepest descent and zero change, including the case $\nabla f = 0$.
- Show that the gradient is perpendicular to the level curve through a point, and use it to write the tangent line.
- State the limits of "follow the negative gradient": it is a local statement, and it depends on how length is measured.

## Context & Motivation

The lesson `gradients-extending-derivatives-to-several-variables` introduces $\nabla f$ as the vector of partial derivatives and asserts two things about it: that it points in the direction of fastest increase, with its length as the rate, and that $\nabla f = 0$ marks flat points. It states them without proof, because that lesson deliberately avoids limits. This lesson earns the first claim. It also answers three questions that the informal version leaves open: what exactly is the rate of change in a direction that is *not* a coordinate axis, why the best direction is the gradient and not something else, and when the whole story stops being true.

None of this is only geometry. Gradient descent, the workhorse of model training, moves along $-\nabla f$, and the way it zigzags in narrow valleys, or overshoots with a large step, can be read directly from the facts proved below. The prerequisite is `partial-derivatives-and-the-multivariable-chain-rule`: the proof of the main formula is one application of its chain rule, and its warning about differentiability is exactly what limits the result.

## Core Theory

### The directional derivative

A partial derivative measures change along a coordinate axis. To measure it along any direction, take a **unit vector** $\mathbf u = (u_1, u_2)$ with $u_1^2 + u_2^2 = 1$ and define

$$D_{\mathbf u} f(\mathbf a) = \lim_{h \to 0} \frac{f(\mathbf a + h\mathbf u) - f(\mathbf a)}{h}.$$

Equivalently, $D_{\mathbf u} f(\mathbf a) = g'(0)$ for the one-variable function $g(t) = f(\mathbf a + t\mathbf u)$, the height profile of $f$ along the straight line through $\mathbf a$ in direction $\mathbf u$. The partials are the special cases $\mathbf u = (1, 0)$ and $\mathbf u = (0, 1)$. The unit length matters because $t$ then measures distance walked: for a vector $\mathbf v$ of length $5$, the profile $f(\mathbf a + t\mathbf v)$ runs five times faster and the "derivative" would be inflated by five.

### The formula

**Theorem.** If $f$ is differentiable at $\mathbf a$, then $D_{\mathbf u} f(\mathbf a)$ exists for every unit vector $\mathbf u$ and

$$D_{\mathbf u} f(\mathbf a) = \nabla f(\mathbf a) \cdot \mathbf u = f_x(\mathbf a)\,u_1 + f_y(\mathbf a)\,u_2.$$

*Proof.* Let $x(t) = a_1 + t u_1$ and $y(t) = a_2 + t u_2$, which are differentiable with $x' = u_1$ and $y' = u_2$. The chain rule from the previous lesson, which needs $f$ differentiable, gives $g'(0) = f_x u_1 + f_y u_2$. $\square$

The formula also has a computational reading. To get the rate along one chosen direction you do not need the whole gradient: forward-mode automatic differentiation, seeded with $\mathbf u$, returns $D_{\mathbf u} f$ in a single pass at a cost comparable to evaluating $f$ once, while forming all of $\nabla f$ that way would take one pass per coordinate.

Differentiability is a real hypothesis. Example 5 exhibits a continuous function whose directional derivatives all exist and which still violates the formula.

### Steepest ascent, with proof

Let $\theta$ be the angle between $\nabla f(\mathbf a)$ and $\mathbf u$. Since $\lVert \mathbf u \rVert = 1$,

$$D_{\mathbf u} f(\mathbf a) = \lVert \nabla f(\mathbf a) \rVert \cos\theta.$$

If $\nabla f(\mathbf a) \ne 0$, this is largest when $\cos\theta = 1$, so the maximum rate is $\lVert\nabla f\rVert$ in the direction $\nabla f / \lVert\nabla f\rVert$. It is smallest, $-\lVert\nabla f\rVert$, in the opposite direction. It is zero for the two directions at right angles to $\nabla f$. If $\nabla f(\mathbf a) = 0$, every directional derivative is $0$ and there is no preferred direction at first order.

This is the statement that the informal lesson asserts. The proof uses nothing beyond the formula and $\lvert\cos\theta\rvert \le 1$.

### The gradient is perpendicular to level curves

Suppose $f$ is $C^1$ and $\nabla f(\mathbf a) \ne 0$ (the same argument works for three variables, where the level set is a surface and the gradient is normal to its tangent plane). Then near $\mathbf a$ the level set $f = c$ through $\mathbf a$ is a smooth curve, a consequence of the implicit function theorem. Parametrize it as $\mathbf r(t)$ with $\mathbf r(0) = \mathbf a$ and $\mathbf r'(0) \ne 0$. Since $f(\mathbf r(t)) = c$ is constant, differentiating with the chain rule gives

$$\nabla f(\mathbf a) \cdot \mathbf r'(0) = 0.$$

So $\nabla f(\mathbf a)$ is perpendicular to the tangent of the level curve, and the tangent line is $\nabla f(\mathbf a) \cdot (\mathbf x - \mathbf a) = 0$. This matches the contour picture: moving along a contour keeps the height, and the steepest way off it is straight across. It also explains why crowded contours mean a large $\lVert\nabla f\rVert$. The hypothesis $\nabla f \ne 0$ matters: for $f = x^2 - y^2$ at the origin, $\nabla f = 0$ and the level $c = 0$ is two crossing lines, with no single tangent.

## Worked Examples

### Example 1: rates in several directions

Take $f(x, y) = x^2 + 4y^2$ at $\mathbf a = (2, 1)$, where $\nabla f = (2x, 8y) = (4, 8)$ and $\lVert\nabla f\rVert = 4\sqrt5 \approx 8.944$.

- Direction $\mathbf u = (3/5, 4/5)$: $D_{\mathbf u} f = \tfrac{12}{5} + \tfrac{32}{5} = 8.8$.
- Steepest ascent, $\mathbf u = (1, 2)/\sqrt5$: rate $4\sqrt5 \approx 8.944$, slightly above $8.8$ as it must be.
- Tangent direction $\mathbf u = (2, -1)/\sqrt5$: $D_{\mathbf u} f = (8 - 8)/\sqrt5 = 0$.

The tangent line to the level curve $x^2 + 4y^2 = 8$ is $4(x - 2) + 8(y - 1) = 0$, that is $x + 2y = 4$, with slope $-1/2$, the same slope that the implicit-slope formula of the previous lesson gave. Centered finite differences of $f$ along these directions return $8.8$, $8.944$ and $0$. The vector $\mathbf v = (3, 4)$ without normalizing would give $44$, five times too large.

### Example 2: a decreasing direction

Let $f(x, y) = x e^{y}$ at $(1, 0)$, so $\nabla f = (e^y, x e^y) = (1, 1)$. Along $\mathbf u = (3, -4)/5$, $D_{\mathbf u} f = (3 - 4)/5 = -0.2$: the function decreases. The steepest direction is $(1, 1)/\sqrt2$ with rate $\sqrt2$, and the steepest descent direction is $(-1, -1)/\sqrt2$.

### Example 3: gradient descent does not aim at the minimizer

For $f = x^2 + 4y^2$ the minimum is at the origin. From $(2, 1)$, the direction to the minimizer is $(-2, -1)$ and the steepest descent direction is $-\nabla f = (-4, -8)$. The cosine between them is $\dfrac{8 + 8}{\sqrt{80}\,\sqrt5} = 0.8$, an angle of about $37°$. The reason is the geometry above: the gradient is perpendicular to the elliptical contour, and the normal to an ellipse passes through its center only on the axes.

The step size matters too, because the gradient describes an infinitesimal move. Update $\mathbf p \leftarrow \mathbf p - \eta \nabla f(\mathbf p)$ from $(2, 1)$:

```text
eta = 0.05   f: 8, 4.68, 3.14, 2.31, 1.79, 1.42     (decreasing)
eta = 0.20   f: 8, 2.88, 1.04, 0.37, 0.13, 0.05     (decreasing faster)
eta = 0.30   f: 8, 8.48, 15.47, 30.13, 59.03, 115.70 (increasing)
```

For this $f$ the $y$-coordinate is multiplied by $1 - 8\eta$ at each step, so any $\eta > 1/4$ makes it grow. A single step of $0.3$ already moves from $(2, 1)$ to $(0.8, -1.4)$, where $f = 8.48 > 8$, even though every step started in a direction of decrease.

### Example 4: a level surface in three variables

For $f(x, y, z) = x^2 + y^2 + z^2$, the level $f = 14$ is a sphere through $(1, 2, 3)$. There $\nabla f = (2, 4, 6)$, so the tangent plane is $2(x - 1) + 4(y - 2) + 6(z - 3) = 0$, which simplifies to $x + 2y + 3z = 14$. The gradient $(2, 4, 6)$ is parallel to the radius from the origin, as the normal of a sphere should be, and $1 + 4 + 9 = 14$ confirms the plane passes through the point.

### Example 5: where the formula fails

Let $q(x, y) = \dfrac{x^2 y}{x^2 + y^2}$ with $q(0, 0) = 0$, the function that `functions-of-several-variables-and-level-curves` showed to be continuous at the origin. For a unit vector $\mathbf u$, $q(h\mathbf u) = h\,u_1^2 u_2$, so

$$D_{\mathbf u} q(0, 0) = u_1^2 u_2.$$

Every directional derivative exists. But both partials at the origin are $0$ (take $\mathbf u = (1, 0)$ and $(0, 1)$), so the formula would predict $D_{\mathbf u} q = 0$ for all $\mathbf u$. For $\mathbf u = (1, 1)/\sqrt2$ the true value is $1/(2\sqrt2) \approx 0.354$. The largest rate is $2\sqrt3/9 \approx 0.385$ at $\mathbf u = (\sqrt{2/3}, \sqrt{1/3})$, a direction the "gradient" $(0, 0)$ knows nothing about. The map $\mathbf u \mapsto u_1^2 u_2$ is not linear in $\mathbf u$, which is the signature of a function that is not differentiable. A simpler case is the cone $f = \sqrt{x^2 + y^2}$: at the vertex the profile along any line is $g(t) = \lvert t\rvert$, so the two-sided limit defining $D_{\mathbf u} f$ does not exist (the one-sided rate is $1$ in every direction), and no gradient exists.

## Common Misconceptions & Pitfalls

- **"Any direction vector will do."** The formula needs $\lVert\mathbf u\rVert = 1$. For another vector $\mathbf v$, normalize first, or you get $\lVert\mathbf v\rVert$ times the true rate.
- **"If all directional derivatives exist, the gradient formula holds."** Example 5 is a continuous function where it does not. Existence of the limits in every direction is weaker than differentiability.
- **"$D_{\mathbf u} f = 0$ means $\nabla f = 0$."** It also happens for every direction perpendicular to the gradient, which are exactly the tangents to the level curve.
- **"The gradient points at the maximum or minimum."** It gives the best local direction. Example 3 shows it deviating by about $37°$ from the direction of the minimizer.
- **"Steepest does not depend on the coordinates."** It is steepest per unit of Euclidean length in the coordinates you chose. Substituting $v = 2y$ turns $x^2 + 4y^2$ into $x^2 + v^2$, whose gradient at $(2, 2)$ is $(4, 4)$. In the original variables this is the displacement $(dx, dy) = (4, 2)$, not the direction $(4, 8)$ of $\nabla f$. Rescaling variables changes the direction, which is why feature scaling changes how gradient methods behave.
- **"The gradient lives on the surface."** It is a vector in the plane of the inputs, not a tangent vector of the graph.

## Summary

The directional derivative $D_{\mathbf u} f$ is the slope of $f$ along the line through a point in the unit direction $\mathbf u$. For a differentiable $f$ it equals $\nabla f \cdot \mathbf u = \lVert\nabla f\rVert\cos\theta$, which proves that the gradient gives the direction of fastest increase with rate $\lVert\nabla f\rVert$, that $-\nabla f$ gives the fastest decrease, and that directions perpendicular to $\nabla f$ keep $f$ constant to first order, so $\nabla f$ is normal to the level curve. The proof is the chain rule, and the hypotheses are real: without differentiability, directional derivatives can exist and violate the formula, and with $\nabla f = 0$ there is no direction to choose. As a method, steepest descent is local and coordinate dependent, and it does not aim at the minimizer. This is the tool the next lesson, `critical-points-and-the-second-derivative-test`, uses to ask what happens where the gradient vanishes.

## Documentation Links

- [OpenStax Calculus Volume 3, 4.6 Directional Derivatives and the Gradient](https://openstax.org/books/calculus-volume-3/pages/4-6-directional-derivatives-and-the-gradient): directional derivatives, the gradient, steepest ascent and the gradient normal to level curves.
- [Active Calculus Multivariable, Directional Derivatives and the Gradient](https://activecalculus.org/multi/S-mv_deriv-directional.html): activities building the directional derivative and the gradient from slopes along lines.
- [MIT OCW 18.02SC, Unit 2 Part B: Chain Rule, Gradient and Directional Derivatives](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/2.-partial-derivatives/part-b-chain-rule-gradient-and-directional-derivatives/): lecture sessions on the gradient and directional derivatives.
