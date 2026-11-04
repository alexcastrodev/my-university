---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Set up the area between two curves as $\int\lvert f-g\rvert$, splitting at crossings and choosing $dx$ or $dy$ to avoid splitting.
- Compute volumes from cross-sectional areas, using disks, washers, and cylindrical shells, with the radius measured from the actual axis of rotation.
- Explain the slice-approximate-sum-limit recipe and watch it converge numerically.
- Compute the average value of a function, state the Mean Value Theorem for Integrals with its hypothesis, and show a case where it fails.
- Connect the average value to sampling, Monte Carlo estimation, and mean squared error.

## Context & Motivation

`the-definite-integral-and-riemann-sums` defined the integral as a limit of sums, and `integration-by-substitution-and-by-parts` supplied tools for evaluating it. This lesson is about setting integrals up. The same recipe produces area, volume, mass, work, and expected values: cut the quantity into thin pieces, approximate each piece by something simple, add, and take the limit. Once a quantity is written as $\int(\text{something})\,dx$, the previous two lessons evaluate it.

Average value is the piece with the most reach in computing. The mean of a function over an interval is the continuous version of a mean over data: it is what a Monte Carlo estimator targets, the constant that minimizes squared error, and, applied to $f^2$ and followed by a square root, the root mean square used for signals and losses.

## Core Theory

### The recipe

Split $[a,b]$ into $n$ pieces of width $\Delta x$. On the $i$-th piece, approximate the quantity by a simple shape using the function value at a tag point, such as a rectangle, a disk, or a thin shell. Add these up to get a Riemann sum. If the quantity is additive over pieces and the approximation is accurate to first order in $\Delta x$, the limit is a definite integral. The setup is the hard part: a sketch, a representative slice, and its size.

### Area between curves

If $f$ and $g$ are continuous on $[a,b]$,

$$\text{Area} = \int_a^b \lvert f(x)-g(x)\rvert\,dx$$

When $f\ge g$ on the whole interval this is $\int(f-g)$. When the curves cross, find the crossings (solve $f=g$), split there, and integrate (top minus bottom) on each piece. Sometimes a region is simpler as a function of $y$: area $=\int(x_{\text{right}}-x_{\text{left}})\,dy$.

### Volumes by cross-sections

If a solid lies between $x=a$ and $x=b$ and $A(x)$ is the (continuous) area of its cross-section perpendicular to the $x$-axis,

$$V=\int_a^b A(x)\,dx$$

Three common cases when a region is rotated about a line:

- **Disks.** Region $0\le y\le f(x)$ about the $x$-axis: $A=\pi f(x)^2$.
- **Washers.** Region between an outer curve and an inner curve: $A=\pi(R^2-r^2)$, where $R$ and $r$ are the outer and inner distances **from the axis**. Note $R^2-r^2$, not $(R-r)^2$.
- **Shells.** Rotating a strip of width $dx$ at distance $\rho(x)$ from a vertical axis sweeps a thin cylindrical shell of volume about $2\pi\rho(x)\,h(x)\,dx$, so $V=2\pi\int\rho(x)\,h(x)\,dx$, with $h$ the height of the strip.

These formulas assume the region lies on one side of the axis. A region that straddles the axis can fold over itself when rotated: where its two sides sweep out overlapping solid, adding both counts the overlap twice. (When the two sides sit at different positions along the axis, as for $\sin x$ on $[0,2\pi]$ about the $x$-axis, nothing overlaps.)

### Average value

For $f$ integrable on $[a,b]$:

$$f_{\text{avg}}=\frac1{b-a}\int_a^b f(x)\,dx$$

This is the limit of the ordinary mean of $n$ equally spaced samples, because $\frac1n\sum f(x_i^*)=\frac1{b-a}\sum f(x_i^*)\Delta x$.

**Mean Value Theorem for Integrals.** If $f$ is **continuous** on $[a,b]$, there is a $c\in[a,b]$ with $f(c)=f_{\text{avg}}$. The reason: the average lies between the minimum and maximum of $f$ (which exist, by continuity on a closed interval), and a continuous function takes every value in between (see `continuity-and-the-intermediate-value-theorem`). Without continuity it can fail: $f=0$ on $[0,\tfrac12)$ and $f=1$ on $[\tfrac12,1]$ has average $\tfrac12$, a value $f$ never takes. The theorem says some $c$ exists, not that it is unique.

## Worked Examples

### Example 1: area between curves

The curves $y=x$ and $y=x^2$ meet where $x=x^2$, at $x=0$ and $x=1$, with $x\ge x^2$ between them:

$$\int_0^1(x-x^2)\,dx=\frac12-\frac13=\frac16$$

### Example 2: curves that cross

Find the area between $y=\sin x$ and $y=\cos x$ on $[0,\pi]$. They cross where $\tan x=1$, at $x=\pi/4$ (the next crossing, $5\pi/4$, is outside). So $\cos\ge\sin$ on $[0,\pi/4]$ and $\sin\ge\cos$ on $[\pi/4,\pi]$:

$$\int_0^{\pi/4}(\cos x-\sin x)\,dx+\int_{\pi/4}^{\pi}(\sin x-\cos x)\,dx=(\sqrt2-1)+(\sqrt2+1)=2\sqrt2\approx2.8284$$

Quadrature on $\lvert\sin x-\cos x\rvert$ gives the same $2.8284$. The shortcut $\int_0^\pi(\sin x-\cos x)\,dx=2$ is a signed area and misses by about 29%.

### Example 3: choosing the variable

The region between $x=y^2$ and $y=x-2$ has crossings at $(1,-1)$ and $(4,2)$. In $y$ it is one integral:

$$\int_{-1}^{2}\big((y+2)-y^2\big)\,dy=\frac92$$

In $x$ the bottom boundary changes at $x=1$ (from the lower parabola branch $-\sqrt x$ to the line), so it needs two pieces: $\int_0^1 2\sqrt x\,dx+\int_1^4(\sqrt x-x+2)\,dx=\frac43+\frac{19}6=\frac92$.

### Example 4: a volume as a visible limit

Rotate $y=\sqrt x$, $0\le x\le4$, about the $x$-axis. Each slice is a disk of area $\pi x$, so $V=\pi\int_0^4x\,dx=8\pi\approx25.1327$. Riemann sums of the disk volumes converge to it:

```text
   n     left sum   right sum   (exact 8*pi = 25.1327)
   4     18.8496     31.4159
  16     23.5619     26.7035
  64     24.7400     25.5254
 256     25.0346     25.2309
1024     25.1082     25.1573
```

The error shrinks like $1/n$, the usual rate for left and right sums when the integrand takes different values at the two ends (here $0$ and $4\pi$). The midpoint sum is exact for every $n$ here, because the slice area $\pi x$ is linear in $x$ and the midpoint rule integrates linear functions exactly.

### Example 5: washers and shells agree

The region between $y=x$ and $y=x^2$, $0\le x\le1$. About the $x$-axis, washers with $R=x$, $r=x^2$: $\pi\int_0^1(x^2-x^4)\,dx=\frac{2\pi}{15}\approx0.41888$. About the $y$-axis, shells of radius $x$ and height $x-x^2$: $2\pi\int_0^1x(x-x^2)\,dx=\frac\pi6\approx0.52360$. Washers in $y$ (outer radius $\sqrt y$, inner radius $y$) give $\pi\int_0^1(y-y^2)\,dy=\frac\pi6$ too. Two methods, one answer.

### Example 6: an axis that is not a coordinate axis

Rotate the same region about the line $x=2$. The shell radius is the distance to the axis, $2-x$:

$$V=2\pi\int_0^1(2-x)(x-x^2)\,dx=\frac\pi2\approx1.5708$$

Washers in $y$ give the same: $\pi\int_0^1\big[(2-y)^2-(2-\sqrt y)^2\big]dy=\frac\pi2$. A Monte Carlo estimate (NumPy `default_rng(1)`, $N=4\,000\,000$ uniform points in the box $[0,4]\times[0,1]\times[-2,2]$ of volume $16$, counting points inside the solid) gave $1.5707$ with standard error about $0.0024$, consistent. Using radius $x$ by habit would give $\frac\pi6$, the volume about the $y$-axis, not this solid.

### Example 7: non-circular cross-sections

A pyramid with a square base of side $s$ and height $h$ has, at distance $x$ above the base, a square cross-section of side $s(1-x/h)$, so $V=\int_0^hs^2(1-x/h)^2dx=\frac{s^2h}3$. For $s=3$, $h=5$ this is $15$, matching quadrature.

### Example 8: average value and squared error

On $[0,\pi]$, $\sin$ has average $\frac2\pi\approx0.63662$. The equation $\sin c=\frac2\pi$ has two solutions, $c\approx0.6901$ and $2.4515$. Averaging $\sin$ at $n$ midpoints gives $0.65328$ ($n=4$), $0.63764$ ($16$), $0.63668$ ($64$), $0.636620$ ($1024$). Averaging at random points is Monte Carlo integration: $0.6443$ ($n=100$), $0.6305$ ($10^4$), $0.63676$ ($10^6$), converging more slowly and erratically, at rate about $1/\sqrt n$.

Which single constant $c$ best approximates $f(x)=x^2$ on $[0,1]$ in mean squared error? Expanding,

$$\text{MSE}(c)=\int_0^1(x^2-c)^2\,dx=c^2-\tfrac23c+\tfrac15$$

which is minimized at $c=\tfrac13=f_{\text{avg}}$, with minimum $\tfrac4{45}\approx0.0889$. Numerically $c=0.2$ gives $0.1067$ and $c=0.5$ gives $0.1167$. In general, the average value is the least-squares constant. The root mean square of $\sin$ over a period is $\sqrt{1/2}=0.7071$, since the mean of $\sin^2$ is $\tfrac12$.

## Common Misconceptions & Pitfalls

- **Integrating $f-g$ across a crossing.** That gives signed area. Split at the crossings or integrate $\lvert f-g\rvert$ (Example 2).
- **Radius equals $x$.** The radius is the distance to the axis of rotation. About $x=2$ it is $2-x$ (Example 6).
- **Washer area as $\pi(R-r)^2$.** It is $\pi(R^2-r^2)$.
- **Mixing methods.** Shells go with $dx$ for a vertical axis and washers with $dy$. Writing a shell radius together with a washer area in one integral gives nonsense.
- **Average of the endpoints.** For $\sin$ on $[0,\pi]$ the mean of $f(0)$ and $f(\pi)$ is $0$, while $f_{\text{avg}}=0.6366$. For linear $f$ the two agree; in general they do not.
- **Believing the average is always attained.** Continuity guarantees a point where $f$ equals the average, but without it the value can be missed (Core Theory). Continuity is sufficient, not necessary: $f$ equal to $0$, $1$, $2$ on the three thirds of $[0,1]$ has average $1$ and attains it. The point is generally not the midpoint of the interval.
- **Rotating a region that crosses the axis** and adding both halves. The halves can overlap, and then the overlap is counted twice.

## Summary

Setting up an integral means slicing, approximating each slice by a simple shape, adding, and taking the limit. For area, integrate top minus bottom, splitting at crossings (or integrate $\lvert f-g\rvert$), and switch to $y$ if that avoids a split. For volume, integrate cross-sectional area: $\pi f^2$ for disks, $\pi(R^2-r^2)$ for washers, and $2\pi\rho h$ for shells, with all radii measured from the axis, and the region on one side of it. A left or right Riemann sum of the slice volumes converges to the exact volume, as the $8\pi$ table shows. The average value $\frac1{b-a}\int_a^bf$ is the limit of sample means, equals $f(c)$ for some $c$ when $f$ is continuous (and may fail otherwise), and is the constant that minimizes mean squared error. The next lesson, `improper-integrals`, extends the integral to unbounded intervals and integrands.

## Documentation Links

- [OpenStax Calculus Volume 1, 6.1 Areas between Curves](https://openstax.org/books/calculus-volume-1/pages/6-1-areas-between-curves): integrating with respect to x or y, and regions with crossing curves.
- [OpenStax Calculus Volume 1, 6.2 Determining Volumes by Slicing](https://openstax.org/books/calculus-volume-1/pages/6-2-determining-volumes-by-slicing): slicing, disks, and washers.
- [OpenStax Calculus Volume 1, 6.3 Volumes of Revolution: Cylindrical Shells](https://openstax.org/books/calculus-volume-1/pages/6-3-volumes-of-revolution-cylindrical-shells): the shell method and when to choose it.
- [OpenStax Calculus Volume 1, 5.3 The Fundamental Theorem of Calculus](https://openstax.org/books/calculus-volume-1/pages/5-3-the-fundamental-theorem-of-calculus): the Mean Value Theorem for Integrals and the average value of a function.
- [Active Calculus, 6.2 Using definite integrals to find volume](https://activecalculus.org/single/sec-6-2-volume.html): volumes from slices, disks, and washers.
- [MIT OCW 18.01SC, Unit 3 Part C](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-3-the-definite-integral-and-its-applications/part-c-average-value-probability-and-numerical-integration/): lectures on average value and numerical integration.
