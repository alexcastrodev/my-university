---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Evaluate a double integral as an iterated integral over a rectangle or over a region bounded by curves, and change the order of integration by redescribing the region.
- State the hypotheses of Fubini's theorem, and recognize a case where the two iterated integrals disagree because a hypothesis fails.
- State the change-of-variables theorem with its conditions, compute a Jacobian, and derive the factor $r$ of polar coordinates.
- Evaluate $\int_{-\infty}^{\infty} e^{-x^2}\, dx$ by switching to polar coordinates, and use it to show that the Normal density integrates to 1.

## Context & Motivation

A double integral adds up a quantity spread over a region of the plane: the volume under a surface $z = f(x, y)$, or the mass of a plate whose density varies from point to point. As in `the-definite-integral-and-riemann-sums`, it is defined as a limit of sums, and it is computed by reducing it to two single integrals.

The lesson `the-normal-distribution` writes down the density $\frac{1}{\sigma\sqrt{2\pi}}e^{-(x-\mu)^2/(2\sigma^2)}$ and says only that the constant in front makes the area equal 1. That constant is not obvious, because $e^{-x^2}$ has no antiderivative that can be written with elementary functions, so the fundamental theorem of calculus cannot evaluate the integral directly. The way around it uses two dimensions: the square of the integral is a double integral over the plane, and in polar coordinates it becomes easy. The same idea gives the Box-Muller method for turning uniform random numbers into Normal ones.

## Core Theory

### Double integrals over rectangles

Split a rectangle $R = [a, b] \times [c, d]$ into small subrectangles of area $\Delta A$, pick a sample point in each, and form $\sum f(x_i^*, y_j^*)\, \Delta A$. When the sums converge to the same number as the subrectangles shrink, the limit is $\iint_R f\, dA$. It exists when $f$ is continuous on $R$, and also when $f$ is bounded and is discontinuous only along finitely many smooth curves. Where $f \ge 0$ it is the volume under the graph.

### Iterated integrals and Fubini's theorem

**Fubini's theorem (continuous case).** If $f$ is continuous on the closed rectangle $R = [a, b] \times [c, d]$, then

$$\iint_R f\, dA = \int_a^b \left(\int_c^d f(x, y)\, dy\right) dx = \int_c^d \left(\int_a^b f(x, y)\, dx\right) dy.$$

The hypotheses are a closed bounded rectangle and continuity. The version for general integrable functions (Lebesgue integral) replaces continuity by absolute integrability: if $\iint |f|\, dA < \infty$, both iterated integrals exist and equal $\iint f\, dA$. **Tonelli's theorem** covers $f \ge 0$: both iterated integrals always equal the double integral, as values in $[0, \infty]$, and no finiteness is needed.

When the hypothesis fails, the conclusion can fail. Take $f(x, y) = \dfrac{x^2 - y^2}{(x^2 + y^2)^2}$ on $(0, 1)^2$, which blows up at the origin. Since $\frac{\partial}{\partial x}\frac{x}{x^2 + y^2} = \frac{y^2 - x^2}{(x^2 + y^2)^2}$, integrating in $x$ first gives $-\frac{1}{1 + y^2}$, and then

$$\int_0^1\!\!\int_0^1 f\, dx\, dy = -\frac{\pi}{4}, \qquad \text{but} \qquad \int_0^1\!\!\int_0^1 f\, dy\, dx = +\frac{\pi}{4}.$$

Both values were confirmed numerically. The function is not absolutely integrable: $\iint |f|\, dA$ over $[\varepsilon, 1]^2$ grows by about $2.3$ each time $\varepsilon$ shrinks tenfold (it approaches $\ln 10$ per step), which is logarithmic divergence. Without absolute integrability, the order can matter.

### General regions and changing the order

A region is of **type I** if it is $a \le x \le b$, $g_1(x) \le y \le g_2(x)$ with $g_1, g_2$ continuous, and of **type II** if the roles of $x$ and $y$ are swapped. For $f$ continuous on such a region $D$,

$$\iint_D f\, dA = \int_a^b \int_{g_1(x)}^{g_2(x)} f(x, y)\, dy\, dx.$$

Swapping the order is not swapping the limits. The region has to be redescribed from the other direction, so a sketch comes first: read off the extreme values of the new outer variable, then the bounds of the inner one as functions of it.

### Change of variables and the Jacobian

Suppose $T(u, v) = (x(u, v), y(u, v))$ maps a region $S$ in the $uv$-plane onto a region $D$ in the $xy$-plane. The **Jacobian** is the determinant

$$\frac{\partial(x, y)}{\partial(u, v)} = \det\begin{pmatrix} x_u & x_v \\ y_u & y_v \end{pmatrix}.$$

**Change of variables.** If $T$ is continuously differentiable ($C^1$), one-to-one on the interior of $S$, and has a nonzero Jacobian on the interior of $S$, and if $f$ is continuous on $D$, then

$$\iint_D f(x, y)\, dA = \iint_S f\big(x(u, v), y(u, v)\big)\,\left\lvert \frac{\partial(x, y)}{\partial(u, v)} \right\rvert du\, dv.$$

The reason is the local linear approximation from `partial-derivatives-and-the-multivariable-chain-rule`: a small $\Delta u \times \Delta v$ rectangle is sent to nearly a parallelogram of area $\lvert\det\rvert\, \Delta u\, \Delta v$. For the linear map $x = (u + v)/2$, $y = (u - v)/2$ the determinant is $-1/2$, so areas are halved and the factor is $1/2$.

For **polar coordinates**, $x = r\cos\theta$ and $y = r\sin\theta$ give

$$\frac{\partial(x, y)}{\partial(r, \theta)} = \det\begin{pmatrix} \cos\theta & -r\sin\theta \\ \sin\theta & r\cos\theta \end{pmatrix} = r,$$

so $dA = r\, dr\, d\theta$, the factor previewed in `polar-coordinates`. The map from $[0, R] \times [0, 2\pi]$ to the disk of radius $R$ breaks the hypotheses on the boundary: the whole segment $r = 0$ lands on the origin, the rays $\theta = 0$ and $\theta = 2\pi$ coincide, and $r = 0$ makes the Jacobian vanish. These sets have zero area, and the theorem needs only the interior, so for continuous $f$ the integral is unchanged.

A hypothesis that does matter is one-to-one. Let $\theta$ run over $[0, 4\pi]$ and the unit disk is covered twice: $\int_0^{4\pi}\int_0^1 r\, dr\, d\theta = 2\pi$, twice the true area $\pi$.

### Unbounded regions

An integral over the whole plane is a limit, as in `improper-integrals`: integrate over a disk or square that grows, then let it grow without bound. For $f \ge 0$ the result does not depend on which growing family is used. For a function that changes sign, absolute integrability is the safe requirement.

## Worked Examples

### Example 1: choosing the order on a rectangle

Evaluate $\iint_R x e^{xy}\, dA$ on $R = [0, 1] \times [0, 2]$. The integrand is continuous on a closed rectangle, so either order is allowed. Integrating $y$ first is easy:

$$\int_0^2 x e^{xy}\, dy = e^{2x} - 1, \qquad \int_0^1 (e^{2x} - 1)\, dx = \frac{e^2 - 3}{2} \approx 2.1945.$$

Integrating $x$ first needs integration by parts and gives $\frac{(y - 1)e^y + 1}{y^2}$, a harder second step. Symbolic evaluation in both orders gives $(e^2 - 3)/2$, and numerical quadrature gives $2.19453$.

### Example 2: an integral that only works after swapping

Evaluate $\int_0^1\!\int_x^1 e^{y^2}\, dy\, dx$. The inner integral is $\frac{\sqrt\pi}{2}(\operatorname{erfi}(1) - \operatorname{erfi}(x))$, not elementary. The region is $0 \le x \le y \le 1$, a triangle. Described the other way, $0 \le y \le 1$ and $0 \le x \le y$, so

$$\int_0^1\!\int_0^y e^{y^2}\, dx\, dy = \int_0^1 y e^{y^2}\, dy = \frac{e - 1}{2} \approx 0.8591.$$

Numerical quadrature of the original form returns $0.85914$.

### Example 3: volume under a paraboloid

Find the volume between $z = 4 - x^2 - y^2$ and the plane $z = 0$. The surface meets the plane at $r = 2$, so $D$ is the disk $r \le 2$ and

$$V = \int_0^{2\pi}\!\int_0^2 (4 - r^2)\, r\, dr\, d\theta = 2\pi\left[2r^2 - \frac{r^4}{4}\right]_0^2 = 8\pi \approx 25.1327.$$

A numerical double integral over the disk in $x, y$ gives $25.13274$. Dropping the Jacobian, $\int_0^{2\pi}\int_0^2 (4 - r^2)\, dr\, d\theta$, gives $32\pi/3 \approx 33.51$, which is wrong.

### Example 4: the Gaussian integral

Let $I = \int_{-\infty}^{\infty} e^{-x^2}\, dx$. Then

$$I^2 = \int_{-\infty}^{\infty} e^{-x^2}\, dx \int_{-\infty}^{\infty} e^{-y^2}\, dy = \iint_{\mathbb{R}^2} e^{-(x^2 + y^2)}\, dA.$$

The step from a product to a double integral is Fubini in the Tonelli form: the integrand is positive, so no finiteness is assumed. Evaluate the double integral as the limit of integrals over the disk $D_R$ of radius $R$ (allowed because the integrand is nonnegative). On $D_R$ polar coordinates apply, with $e^{-(x^2+y^2)} = e^{-r^2}$ continuous:

$$\iint_{D_R} e^{-(x^2 + y^2)}\, dA = \int_0^{2\pi}\!\int_0^R e^{-r^2}\, r\, dr\, d\theta = 2\pi\cdot\frac{1 - e^{-R^2}}{2} = \pi\big(1 - e^{-R^2}\big) \to \pi.$$

The extra factor $r$ is what makes the inner integral elementary: $r\, e^{-r^2}$ has the antiderivative $-\tfrac{1}{2}e^{-r^2}$. So $I^2 = \pi$, and since $I > 0$, $I = \sqrt\pi \approx 1.77245$, which numerical quadrature confirms. Squares exhaust the plane too, and give the same limit:

```text
R   disk: pi(1 - e^-R^2)   square [-R,R]^2: pi erf(R)^2
1   1.9859                 2.2310
2   3.0841                 3.1123
3   3.1412                 3.1415     (pi = 3.1416)
```

**Back to the Normal density.** Substituting $u = (x - \mu)/(\sigma\sqrt 2)$, so $dx = \sigma\sqrt 2\, du$,

$$\int_{-\infty}^{\infty} e^{-(x - \mu)^2/(2\sigma^2)}\, dx = \sigma\sqrt{2}\int_{-\infty}^{\infty} e^{-u^2}\, du = \sigma\sqrt{2\pi}.$$

Dividing by $\sigma\sqrt{2\pi}$ produces total area 1, which is the constant in `the-normal-distribution`. For $\mu = 175$ and $\sigma = 7$ a numerical integral gives $17.5464 = 7\sqrt{2\pi}$. This derives the normalizing constant; why the bell shape arises in the first place is the Central Limit Theorem's job.

### Example 5: Box-Muller

If $X, Y$ are independent standard Normals, their joint density is $\frac{1}{2\pi}e^{-(x^2 + y^2)/2}$. In polar form the density becomes $\frac{1}{2\pi}e^{-r^2/2}\, r\, dr\, d\theta$: the angle is uniform on $[0, 2\pi)$, and $R$ has distribution function $1 - e^{-r^2/2}$. Inverting that gives $R = \sqrt{-2\ln U_1}$ and $\Theta = 2\pi U_2$ for uniform $U_1, U_2$, and $X = R\cos\Theta$, $Y = R\sin\Theta$. In a run of $10^6$ pairs (seed 7) the sample variances were $0.9986$ and $0.9980$, the correlation was $-0.00003$, and the fraction with $\lvert X\rvert \le 1$ was $0.6826$ against the exact $0.6827$.

## Common Misconceptions & Pitfalls

- **"Fubini always lets you swap the order."** It needs continuity on a closed rectangle (or absolute integrability, or $f \ge 0$). The example with $-\pi/4$ and $+\pi/4$ shows the order changing the answer.
- **"Swapping the order means swapping the limits."** The new bounds come from the region's picture, not from exchanging numbers.
- **"Polar coordinates only change $dx\, dy$ into $dr\, d\theta$."** The area element is $r\, dr\, d\theta$, and in Example 3 the missing $r$ changed the answer from $8\pi$ to $32\pi/3$. Also check that the angle range covers the region once. A circle not centered at the origin, such as $x^2 + y^2 \le 2x$, becomes $0 \le r \le 2\cos\theta$ with $-\pi/2 \le \theta \le \pi/2$.
- **"The scaling factor is the Jacobian determinant itself."** The determinant can be negative because it records orientation, but the factor is its absolute value. The linear map above has determinant $-1/2$ and factor $1/2$.

## Summary

A double integral is a limit of sums, evaluated as an iterated integral when Fubini applies: continuity on a closed rectangle, or absolute integrability, or a nonnegative integrand (Tonelli). Without those, the two orders can disagree, as $\pm\pi/4$ shows. On general regions the order is changed by redescribing the region. A change of variables needs a $C^1$ map that is one-to-one on the interior and has a nonzero Jacobian there, and it multiplies the integrand by $\lvert\partial(x, y)/\partial(u, v)\rvert$; for polar coordinates that is $r$. With it, $\iint e^{-(x^2 + y^2)}\, dA = \pi$ gives $\int e^{-x^2}\, dx = \sqrt\pi$, the normalizing constant $\sigma\sqrt{2\pi}$ of the Normal density, and the Box-Muller sampler.

## Documentation Links

- [OpenStax Calculus Volume 3, 5.1 Double Integrals over Rectangular Regions](https://openstax.org/books/calculus-volume-3/pages/5-1-double-integrals-over-rectangular-regions): Riemann-sum definition and Fubini's theorem for continuous functions.
- [OpenStax Calculus Volume 3, 5.2 Double Integrals over General Regions](https://openstax.org/books/calculus-volume-3/pages/5-2-double-integrals-over-general-regions): type I and type II regions and changing the order of integration.
- [OpenStax Calculus Volume 3, 5.3 Double Integrals in Polar Coordinates](https://openstax.org/books/calculus-volume-3/pages/5-3-double-integrals-in-polar-coordinates): polar rectangles, the factor $r$, and an exercise on the Gaussian integral.
- [OpenStax Calculus Volume 3, 5.7 Change of Variables in Multiple Integrals](https://openstax.org/books/calculus-volume-3/pages/5-7-change-of-variables-in-multiple-integrals): the Jacobian and the change-of-variables theorem with its hypotheses.
- [MIT OpenCourseWare 18.02SC, Part A: Double Integrals](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/3.-double-integrals-and-line-integrals-in-the-plane/part-a-double-integrals/): sessions on double integrals, exchanging the order, polar coordinates, and change of variables.
