---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Convert points between polar $(r, \theta)$ and Cartesian $(x, y)$ form, choosing the correct quadrant for $\theta$ and explaining why a point has many polar names.
- Recognize circles, cardioids, and roses from their polar equations and rewrite a simple polar equation in Cartesian form.
- Compute the area enclosed by a polar curve with $A = \tfrac{1}{2}\int r^2\, d\theta$, state when the formula counts each point of the region exactly once, and find the area between two polar curves.
- Explain where the area element $r\, dr\, d\theta$ comes from, as preparation for double integrals in polar form.

## Context & Motivation

A grid of $x$ and $y$ values is not always the natural way to describe a shape. A circle centered at the origin needs the relation $x^2 + y^2 = a^2$ in Cartesian form, yet in terms of distance and direction it is just $r = a$. A radar sweep, the phase of a complex number, and a robot arm pivoting about a joint are all described by a distance and an angle rather than by two perpendicular offsets.

Polar coordinates give each point a distance $r$ from the origin and an angle $\theta$ measured counterclockwise from the positive $x$-axis. The price is that the description is no longer unique, and several familiar rules (area, integration limits) change form. This lesson builds the vocabulary and the single-variable area formula. The next lesson, `double-integrals-cartesian-and-polar`, uses it to integrate over regions that are awkward in $x$ and $y$. The trigonometry used here is the family reviewed in `functions-and-the-elementary-families`, and the area formula reuses the integral from `applications-area-volume-and-average-value`.

## Core Theory

### Conversion and the many names of a point

The two systems are tied together by

$$x = r\cos\theta, \qquad y = r\sin\theta, \qquad r^2 = x^2 + y^2.$$

Going from polar to Cartesian is direct substitution. Going the other way, $r = \sqrt{x^2 + y^2}$ is safe, but the angle needs care. The relation $\tan\theta = y/x$ has two solutions in every full turn, so $\theta = \arctan(y/x)$ lands in $(-\pi/2, \pi/2)$ and is wrong for every point with $x < 0$. It also fails at $x = 0$, where $y/x$ is undefined although the angle is $\pm\pi/2$. The robust rule is to pick the $\theta$ whose cosine has the sign of $x$ and whose sine has the sign of $y$. Programming languages package this as the two-argument function `atan2(y, x)`, which returns an angle in $(-\pi, \pi]$; adding $2\pi$ to a negative result gives the range $[0, 2\pi)$.

A point has infinitely many polar names. Adding any multiple of $2\pi$ to $\theta$ gives the same point, and a negative $r$ means "go the same distance in the opposite direction":

$$(r, \theta) = (r, \theta + 2\pi k) = (-r, \theta + \pi).$$

The origin is $(0, \theta)$ for every $\theta$. This non-uniqueness has a consequence for every later formula: the same curve can be traced twice, or can pass through the origin at different angles, and a formula that sums over $\theta$ will then count some points more than once.

### Three families of curves

Three equations cover most of what appears in practice.

- **Circles through the origin.** $r = 2a\cos\theta$ is the circle of radius $a$ centered at $(a, 0)$. Multiplying by $r$ gives $x^2 + y^2 = 2ax$, which is $(x - a)^2 + y^2 = a^2$. The multiplication is harmless here because the origin already lies on the curve (at $\theta = \pi/2$). The curve is traced exactly once for $\theta \in [0, \pi]$ and a second time for $\theta \in [\pi, 2\pi]$, because $r(\theta + \pi) = -r(\theta)$, so $(r(\theta + \pi), \theta + \pi)$ names the same point as $(r(\theta), \theta)$.
- **Cardioids.** $r = a(1 + \cos\theta)$ is a heart-shaped curve with a cusp at the origin. In Cartesian form, for $a = 1$, it is $(x^2 + y^2 - x)^2 = x^2 + y^2$.
- **Roses.** $r = \cos(n\theta)$ has $n$ petals when $n$ is odd and $2n$ petals when $n$ is even. For $r = \cos 2\theta$, the two petals on the $x$-axis are drawn where $\cos 2\theta > 0$, and the two on the $y$-axis come from the angles where $r < 0$, so the curve is drawn in the opposite direction there.

### Area in polar form

A thin sector of radius $r$ and angle $\Delta\theta$ has area $\tfrac{1}{2} r^2\, \Delta\theta$ (a fraction $\Delta\theta / 2\pi$ of the disk's $\pi r^2$). Summing these sectors and passing to the limit, as in the definite integral of `the-definite-integral-and-riemann-sums`, gives

$$A = \frac{1}{2}\int_{\alpha}^{\beta} r(\theta)^2\, d\theta.$$

The hypotheses are the ones that matter. The function $r(\theta)$ must be continuous on $[\alpha, \beta]$. The formula measures the area swept by the segment from the origin to the curve, counting a point once for every time the sweep passes over it. It therefore equals the area of the enclosed region only when every point of the region is swept exactly once, which in particular needs $\beta - \alpha \le 2\pi$ and a curve that does not retrace itself on the chosen interval. When the sweep covers part of the region twice, the integral overstates the area, as the second pitfall below shows.

For two curves, $r_{\text{out}}(\theta) \ge r_{\text{in}}(\theta) \ge 0$ on the interval, the region between them has area $\tfrac{1}{2}\int (r_{\text{out}}^2 - r_{\text{in}}^2)\, d\theta$. The outer and inner curves can swap along the way, so the interval must be split at the angles where the curves cross.

### Where the factor $r$ will come from

Take the "polar rectangle" between radii $r$ and $r + \Delta r$ and angles $\theta$ and $\theta + \Delta\theta$. It is a slice of a ring, with area $\tfrac{1}{2}\big((r + \Delta r)^2 - r^2\big)\Delta\theta = \bar r\, \Delta r\, \Delta\theta$, where $\bar r = r + \Delta r/2$ is the middle radius. Unlike a rectangle in the $xy$-plane, its area is not the product of the side increments: it also grows with $r$. This extra $r$ is the area element $dA = r\, dr\, d\theta$ that the next lesson proves with a Jacobian.

## Worked Examples

### Example 1: converting points

The point $(-1, 1)$ has $r = \sqrt{2}$. Since $x < 0$ and $y > 0$, it lies in the second quadrant, so $\theta = 3\pi/4$. The formula $\arctan(y/x) = \arctan(-1) = -\pi/4$ names the different point $(1, -1)$. In Python, `math.atan2(1, -1)` returns $2.3562 = 3\pi/4$, while `math.atan(1 / -1)` returns $-0.7854$. For $(3, -4)$, $r = 5$ and $\theta \approx -0.9273$ rad, or $5.3559$ rad on $[0, 2\pi)$.

In the other direction, $(2, 5\pi/6)$ becomes $(2\cos 5\pi/6,\ 2\sin 5\pi/6) = (-\sqrt{3}, 1)$. The name $(-2, \pi/6)$ gives $(-\sqrt{3}, -1)$, which is the point $(2, 7\pi/6)$: the negative radius flips the direction.

### Example 2: area of a cardioid

For $r = 1 + \cos\theta$ over $[0, 2\pi]$ the curve is traced once, so

$$A = \frac{1}{2}\int_0^{2\pi} (1 + \cos\theta)^2\, d\theta = \frac{1}{2}\int_0^{2\pi} \Big(1 + 2\cos\theta + \frac{1 + \cos 2\theta}{2}\Big) d\theta = \frac{1}{2}\Big(2\pi + 0 + \pi\Big) = \frac{3\pi}{2}.$$

A numerical quadrature gives $4.7124 = 3\pi/2$, and a Monte Carlo count of points with $r \le 1 + \cos\theta$ in a bounding box gives $4.714$ from $2\times 10^6$ samples (seed 1).

### Example 3: area of a four-petal rose

For $r = \cos 2\theta$, each petal is traced once on $[0, 2\pi]$. The area of all four is

$$A = \frac{1}{2}\int_0^{2\pi} \cos^2 2\theta\, d\theta = \frac{1}{2}\cdot\pi = \frac{\pi}{2},$$

so each petal has area $\pi/8$. Integrating only over $[-\pi/4, \pi/4]$ gives one petal, $\pi/8 = 0.3927$ in the numerical check.

### Example 4: area inside two circles

Find the area inside both $r = 1$ and $r = 2\cos\theta$. Setting $1 = 2\cos\theta$ gives the crossing angles $\theta = \pm\pi/3$. Near $\theta = 0$ the circle $r = 1$ is closer to the origin, and from $\pi/3$ to $\pi/2$ the circle $r = 2\cos\theta$ is closer. By symmetry about the $x$-axis,

$$A = 2\left[\frac{1}{2}\int_0^{\pi/3} 1\, d\theta + \frac{1}{2}\int_{\pi/3}^{\pi/2} 4\cos^2\theta\, d\theta\right] = \frac{2\pi}{3} - \frac{\sqrt{3}}{2} \approx 1.2284.$$

The first piece contributes $\pi/3$ and the second $\pi/3 - \sqrt{3}/2$. Numerical integration of the smaller of the two radii gives $1.2284$, and a Monte Carlo estimate ($2\times 10^6$ samples, seed 1) gives $1.2278$. A single formula over the whole interval would be wrong, because the inner curve changes at $\pi/3$.

## Common Misconceptions & Pitfalls

- **"$\theta = \arctan(y/x)$ always works."** It is correct only for $x > 0$. For $x < 0$ it is off by $\pi$, and at $x = 0$ it divides by zero (`math.atan(1 / 0)` raises `ZeroDivisionError` in Python, while `math.atan2(1, 0)` returns $\pi/2$). Use a two-argument arctangent.
- **"Integrate $\tfrac{1}{2}r^2$ over $[0, 2\pi]$ for every curve."** For $r = 2\cos\theta$ this gives $\tfrac{1}{2}\int_0^{2\pi} 4\cos^2\theta\, d\theta = 2\pi$, yet the enclosed disk has area $\pi$ (radius 1). The sweep covers the disk twice. Over $[0, \pi]$ the integral is $\pi$, the correct area. The rose $r = \cos 3\theta$ behaves the same way: it is traced once on $[0, \pi]$ (area $\pi/4$) and twice on $[0, 2\pi]$ (value $\pi/2$). By contrast, $r = \cos 2\theta$ is traced once on $[0, 2\pi]$, so there the longer interval is right. Always ask over what interval the curve closes up without repeating.
- **"Two polar curves meet where their equations are equal."** Solving $r_1(\theta) = r_2(\theta)$ can miss intersections, because a point has several names. The cardioids $r = 1 + \cos\theta$ and $r = 1 - \cos\theta$ are equal only at $\theta = \pm\pi/2$, yet both also pass through the origin, the first at $\theta = \pi$ and the second at $\theta = 0$. Check the origin and the alternative names $(-r, \theta + \pi)$ separately, and confirm with a sketch.
- **"The area element is $dr\, d\theta$."** The small polar rectangle has area about $r\, \Delta r\, \Delta\theta$. Dropping the $r$ is the most common mistake once polar coordinates enter a double integral.

## Summary

Polar coordinates describe a point by distance $r$ and angle $\theta$, linked to $(x, y)$ by $x = r\cos\theta$, $y = r\sin\theta$, and $r^2 = x^2 + y^2$. The angle must be chosen by quadrant (`atan2`), and every point has many names, including negative-$r$ ones. Circles through the origin, cardioids, and roses are the standard curves. The area swept by $r(\theta)$ is $\tfrac{1}{2}\int r^2\, d\theta$, valid as the enclosed area only when each point is swept once, and the area between curves requires splitting at crossing angles. The small polar rectangle has area $r\, \Delta r\, \Delta\theta$, the seed of the area element used in the next lesson.

## Documentation Links

- [OpenStax Calculus Volume 3, 1.3 Polar Coordinates](https://openstax.org/books/calculus-volume-3/pages/1-3-polar-coordinates): definition of polar coordinates, conversion, and the standard curves.
- [OpenStax Calculus Volume 3, 1.4 Area and Arc Length in Polar Coordinates](https://openstax.org/books/calculus-volume-3/pages/1-4-area-and-arc-length-in-polar-coordinates): the area formula and regions between polar curves.
- [MIT OpenCourseWare 18.02SC, Part A: Double Integrals](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/3.-double-integrals-and-line-integrals-in-the-plane/part-a-double-integrals/): session list on double integrals, including double integrals in polar coordinates.
