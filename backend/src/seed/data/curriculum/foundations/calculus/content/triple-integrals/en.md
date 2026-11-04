---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Set up a triple integral over a box or over a solid bounded by surfaces, choosing the order of integration and writing each bound as a function of the variables outside it.
- State the conditions under which a triple integral can be evaluated in any order, and the conditions of the change-of-variables theorem in three dimensions.
- Compute a $3 \times 3$ Jacobian and derive the factors $r$ (cylindrical) and $\rho^2\sin\varphi$ (spherical), including the range of $\varphi$ that makes the factor valid.
- Compute volume and mass, and estimate a volume by Monte Carlo sampling, noting how its error scales.

## Context & Motivation

A triple integral adds up a quantity spread through a solid: the mass of a body whose density changes from point to point, the volume of a region too curved for slicing, or the position of its center of mass. With $f = 1$ it gives volume, which is the same quantity that slicing computes in `applications-area-volume-and-average-value`, now without needing a cross-section formula.

The work has two parts: describing the solid, and choosing coordinates in which that description is simple. A ball is awkward in $x, y, z$, since the bounds of $y$ depend on $x$ through a square root and the bounds of $z$ on both, but in spherical coordinates it is a box. The previous lesson, `double-integrals-cartesian-and-polar`, built the tools used here: iterated integrals, Fubini's theorem, and the Jacobian. This lesson extends each one by a dimension.

## Core Theory

### Triple integrals over boxes

For a box $B = [a, b] \times [c, d] \times [e, f]$, split it into small boxes of volume $\Delta V$, sample $f$ in each, and sum $f\,\Delta V$. The limit, if it exists, is $\iiint_B f\, dV$, and it exists when $f$ is continuous on $B$. **Fubini's theorem** then says that when $f$ is continuous on the closed box, the integral equals an iterated integral in any of the six orders of $x, y, z$. As in two dimensions, the general version needs $\iiint |f|\, dV < \infty$, and Tonelli covers $f \ge 0$. A function that fails these can give different iterated values in different orders, as the example in the previous lesson shows.

### Solid regions

A solid $E$ is **of type 1** if it lies between two surfaces above a plane region $D$:

$$E = \{(x, y, z) : (x, y) \in D,\ u_1(x, y) \le z \le u_2(x, y)\},$$

with $u_1, u_2$ continuous and $D$ a region of type I or II. For $f$ continuous on $E$,

$$\iiint_E f\, dV = \iint_D \left(\int_{u_1(x, y)}^{u_2(x, y)} f(x, y, z)\, dz\right) dA.$$

The rule for bounds is that the innermost integral may depend on the two outer variables, the middle on the outermost one, and the outermost only on constants. Two applications use this directly. The **volume** of $E$ is $\iiint_E 1\, dV$. For a density $\rho(x, y, z)$ the **mass** is $M = \iiint_E \rho\, dV$, and the $x$-coordinate of the center of mass is $\bar x = \frac{1}{M}\iiint_E x\,\rho\, dV$, with $\bar y$ and $\bar z$ alike.

### Change of variables in three dimensions

If $T(u, v, w) = (x, y, z)$ maps a solid $S$ onto $E$, the Jacobian is

$$\frac{\partial(x, y, z)}{\partial(u, v, w)} = \det\begin{pmatrix} x_u & x_v & x_w \\ y_u & y_v & y_w \\ z_u & z_v & z_w \end{pmatrix}.$$

**Change of variables.** If $T$ is $C^1$, one-to-one on the interior of $S$, and has a nonzero Jacobian on the interior of $S$, and if $f$ is continuous on $E$, then

$$\iiint_E f\, dV = \iiint_S f\big(T(u, v, w)\big)\,\left\lvert \frac{\partial(x, y, z)}{\partial(u, v, w)} \right\rvert du\, dv\, dw.$$

The determinant is the scaling factor of volume: a small $\Delta u \times \Delta v \times \Delta w$ box is sent, to first order, to a parallelepiped spanned by the three columns of the matrix, and the volume of that parallelepiped is the absolute value of the determinant times $\Delta u\,\Delta v\,\Delta w$. As in two dimensions, the exceptional points where one-to-one or nonzero fails must form a set of zero volume.

### Cylindrical coordinates

Keep $z$ and use polar coordinates in the $xy$-plane: $x = r\cos\theta$, $y = r\sin\theta$, $z = z$. The Jacobian is $r$, so $dV = r\, dz\, dr\, d\theta$. The map is one-to-one for $r > 0$ and $\theta \in [0, 2\pi)$, and the Jacobian vanishes only on the axis $r = 0$, which has zero volume. This is the choice when the solid has an axis of symmetry, as in `polar-coordinates` but lifted into space.

### Spherical coordinates

Let $\rho \ge 0$ be the distance from the origin, $\varphi$ the angle from the positive $z$-axis, and $\theta$ the azimuth, as in polar coordinates:

$$x = \rho\sin\varphi\cos\theta, \qquad y = \rho\sin\varphi\sin\theta, \qquad z = \rho\cos\varphi.$$

The Jacobian with respect to $(\rho, \varphi, \theta)$ is $\rho^2\sin\varphi$, so $dV = \rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta$. The convention matters: this lesson, like OpenStax, uses $\varphi$ for the angle from $z$, whereas many physics texts swap the names $\theta$ and $\varphi$, so a formula from another source needs a check before use. The factor $\rho^2\sin\varphi$ is nonnegative only because $\varphi \in [0, \pi]$, and the map is one-to-one on $\rho > 0$, $0 < \varphi < \pi$, $\theta \in [0, 2\pi)$. The Jacobian is zero at $\rho = 0$ and on the $z$-axis ($\sin\varphi = 0$), a set of zero volume.

If $\varphi$ is allowed to run past $\pi$, the map stops being one-to-one. With $\varphi \in [0, 2\pi]$ the signed factor integrates to $0$ over the ball, and the absolute value covers the ball twice, giving $8\pi a^3/3$ instead of $4\pi a^3/3$.

## Worked Examples

### Example 1: a tetrahedron, in Cartesian coordinates

Let $E$ be the tetrahedron $x, y, z \ge 0$, $x + y + z \le 1$. The bounds are $0 \le x \le 1$, $0 \le y \le 1 - x$, $0 \le z \le 1 - x - y$. The volume is

$$\int_0^1\!\int_0^{1-x}\!\int_0^{1-x-y} dz\, dy\, dx = \frac{1}{6}.$$

For a density $\rho = x + y + z$ the mass is $\iiint (x + y + z)\, dV = \frac{1}{8}$, and integrating with $x$ innermost and $z$ outermost also gives $1/8$, as Fubini promises. The moment $\iiint x\,\rho\, dV = \frac{1}{30}$, so $\bar x = \frac{1/30}{1/8} = \frac{4}{15} \approx 0.2667$. With uniform density the centroid is at $x = 1/4$, so the density that grows with distance from the origin pushes the center of mass outward. All values match numerical triple quadrature.

### Example 2: cylindrical coordinates

Find the volume between $z = x^2 + y^2$ and $z = 4 - x^2 - y^2$. The surfaces meet where $r^2 = 4 - r^2$, so $r = \sqrt 2$, and

$$V = \int_0^{2\pi}\!\int_0^{\sqrt 2}\!\int_{r^2}^{4 - r^2} r\, dz\, dr\, d\theta = 2\pi\int_0^{\sqrt 2}(4 - 2r^2)\, r\, dr = 2\pi\left[2r^2 - \frac{r^4}{2}\right]_0^{\sqrt 2} = 4\pi \approx 12.5664.$$

A numerical triple integral in $x, y, z$ gives $12.56637$.

### Example 3: spherical coordinates

For a ball of radius $a$,

$$V = \int_0^{2\pi}\!\int_0^{\pi}\!\int_0^{a} \rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta = 2\pi\cdot 2\cdot\frac{a^3}{3} = \frac{4\pi a^3}{3}.$$

If the density is $k\rho$, proportional to the distance from the center, the mass is $\int_0^{2\pi}\!\int_0^\pi\!\int_0^a k\rho\cdot\rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta = k\pi a^4$.

Now the "ice cream cone": inside the unit sphere and above the cone $z = \sqrt{x^2 + y^2}$. On the cone $\cos\varphi = \sin\varphi$, so the cone is $\varphi = \pi/4$, and the solid is $0 \le \rho \le 1$, $0 \le \varphi \le \pi/4$, $0 \le \theta \le 2\pi$:

$$V = 2\pi\cdot\frac{1}{3}\int_0^{\pi/4}\sin\varphi\, d\varphi = \frac{2\pi}{3}\left(1 - \frac{\sqrt 2}{2}\right) = \frac{\pi(2 - \sqrt 2)}{3} \approx 0.6134.$$

A Cartesian triple integral over $\sqrt{x^2 + y^2} \le z \le \sqrt{1 - x^2 - y^2}$ gives $0.61343$. Dropping the Jacobian from the ball gives $\int_0^{2\pi}\!\int_0^\pi\!\int_0^1 d\rho\, d\varphi\, d\theta = 2\pi^2 \approx 19.74$ instead of $4\pi/3 \approx 4.19$ (for $a = 1$).

### Example 4: Monte Carlo volume of a ball

When a region has no convenient description, sample it. Draw $N$ points uniformly in the cube $[-1, 1]^3$ (volume 8) and count the fraction $\hat p$ that land inside the unit ball. Then $8\hat p$ estimates $4\pi/3 = 4.18879$. The standard error is $8\sqrt{p(1 - p)/N}$ with $p = \pi/6$, which is $3.9955/\sqrt N$. One run (seed 2026) gave:

```text
N        estimate   abs error   std error
10^3     4.2640     0.0752      0.1264
10^4     4.1808     0.0080      0.0400
10^5     4.1632     0.0256      0.0126
10^6     4.1878     0.0010      0.0040
```

A single run fluctuates around that scale: the error at $N = 10^5$ is two standard errors. Averaged over 300 runs (seeds 0 to 299), the root-mean-square error at $N = 10^4$ was $0.0408$, close to the predicted $0.0400$. The error shrinks like $1/\sqrt N$ whatever the dimension, but the constant depends on the problem. A grid with 100 points per axis needs $100^3 = 10^6$ evaluations in three dimensions and $100^{10}$ in ten, while Monte Carlo can still be run in ten. There the unit ball fills only about $0.25\%$ of its bounding cube, and $10^6$ samples (seed 5) gave $2.51$ against the exact $\pi^5/120 = 2.55$, a standard error of $0.05$.

## Common Misconceptions & Pitfalls

- **"Spherical coordinates only need $d\rho\, d\varphi\, d\theta$."** The volume element is $\rho^2\sin\varphi\, d\rho\, d\varphi\, d\theta$. The $\rho^2$ reflects that a shell's area grows with the square of its radius, and the $\sin\varphi$ that circles of latitude shrink toward the poles. Cylindrical coordinates need the factor $r$.
- **"Any angle range will do."** The map must be one-to-one on the interior. $\varphi$ belongs in $[0, \pi]$ and $\theta$ in a window of length $2\pi$; a larger range double-covers the solid.
- **"Cylindrical and spherical coordinates mean the same angles everywhere."** The geometric angles are the same, but the names differ among books: physics texts often call the angle from the $z$-axis $\theta$ and the azimuth $\varphi$. Write down which angle is which before using a table of formulas.
- **"The bounds of the outer integral can depend on the inner variables."** An inner variable cannot appear in the limits of an outer integral. If a bound refers to $z$, then $z$ must be integrated outside that integral, and the region has to be redescribed.
- **"Monte Carlo converges faster than a grid because it is random."** It converges at the rate $1/\sqrt N$, which is slow, and its advantage is that this rate does not worsen with the dimension (the constant in front can).

## Summary

A triple integral is a limit of sums over small boxes. For a continuous integrand on a closed box, Fubini lets the six orders agree, and the general theorems need absolute integrability or a nonnegative integrand. Solids of type 1 are described by a base region and two surfaces. Under a $C^1$ map that is one-to-one on the interior with a nonzero Jacobian there, the integrand picks up the absolute value of the $3 \times 3$ determinant: $r$ for cylindrical coordinates and $\rho^2\sin\varphi$ for spherical coordinates, valid for $\varphi \in [0, \pi]$. Volume and mass are the standard uses. When a region resists description, random sampling gives an estimate whose error falls like $1/\sqrt N$ in any dimension.

## Documentation Links

- [OpenStax Calculus Volume 3, 5.4 Triple Integrals](https://openstax.org/books/calculus-volume-3/pages/5-4-triple-integrals): triple integrals over boxes and general regions, Fubini's theorem, and applications.
- [OpenStax Calculus Volume 3, 5.5 Triple Integrals in Cylindrical and Spherical Coordinates](https://openstax.org/books/calculus-volume-3/pages/5-5-triple-integrals-in-cylindrical-and-spherical-coordinates): the two coordinate systems and their volume elements.
- [OpenStax Calculus Volume 3, 5.7 Change of Variables in Multiple Integrals](https://openstax.org/books/calculus-volume-3/pages/5-7-change-of-variables-in-multiple-integrals): the Jacobian determinant and the change-of-variables theorem.
- [MIT OpenCourseWare 18.02SC, Part A: Triple Integrals](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/4.-triple-integrals-and-surface-integrals-in-3-space/part-a-triple-integrals/): sessions on triple integrals in rectangular, cylindrical, and spherical coordinates.
