---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Derive the secant method from Newton's method and count its cost in function evaluations.
- State the formal definition of order of convergence, and tell a true order from a bound on a bracket.
- Derive the error relation $\varepsilon_{k+1}\approx C\varepsilon_k\varepsilon_{k-1}$ and, from it, the order $\phi=(1+\sqrt5)/2$.
- Measure that order from the errors of a run, and explain why float64 alone gives only a rough value.
- Compare Newton and the secant method per evaluation under a stated cost model, and break each hypothesis of the order theorem.

## Context & Motivation

`newtons-method` needs $f'$ at every step. Often no formula for it exists: $f$ may be a simulation, a solver call, or a closed library. The secant method keeps the idea of solving a line and replaces the tangent by the line through the last two points, so it needs only values of $f$.

The cost is a lower order, and the surprise is that the lower order can still win. Order per iteration is the wrong yardstick when iterations cost different amounts. This lesson makes "order" precise, derives the unusual value $1.618\ldots$, and measures it.

## Core Theory

### From Newton to the secant

Replace $f'(x_k)$ in Newton's iteration by the slope through the last two iterates:

$$x_{k+1}=x_k-f(x_k)\,\frac{x_k-x_{k-1}}{f(x_k)-f(x_{k-1})}.$$

It needs two distinct starting points, which need not surround the root. Since $f(x_{k-1})$ is already stored, each iteration costs one new evaluation, so $x_k$ costs $k$ evaluations in total for $k\ge2$. The step is undefined when $f(x_k)=f(x_{k-1})$, where the secant line is horizontal.

### Order of convergence, formally

Let $x_k\to r$ with $e_k=\lvert x_k-r\rvert\neq0$. The sequence **has order $p\ge1$ with constant $A$** if

$$\lim_{k\to\infty}\frac{e_{k+1}}{e_k^{\,p}}=A,\qquad 0<A<\infty,$$

with $A<1$ also required when $p=1$. Order 1 is linear and order 2 is quadratic. If $e_{k+1}/e_k\to0$ the convergence is superlinear, which every $p>1$ satisfies. This is an asymptotic statement about one sequence, under the hypotheses of whatever theorem produced it.

Not every convergent sequence has an order. A weaker notion only asks that $e_k\le b_k$ for some sequence $b_k$ that has order $p$. Bisection is the standard case: the bracket half-width has order 1 with constant $\tfrac12$, but the midpoint errors in general do not. On the equation of Example 1, starting from $[0,2]$, the ratio $e_{k+1}/e_k$ ranged from $0.005$ to $89.8$ within 15 steps and settled on nothing. Special cases exist: for $3x-1$ on $[0,1]$ the ratio is exactly $\tfrac12$.

If $e_{k+1}=Ae_k^{\,p}$ held exactly, then $e_k/e_{k-1}=(e_{k-1}/e_{k-2})^p$, which gives the measurement used throughout:

$$p_k=\frac{\ln(e_k/e_{k-1})}{\ln(e_{k-1}/e_{k-2})}.$$

### The error relation

Let $f[a,b]=\frac{f(b)-f(a)}{b-a}$ and $f[a,b,c]=\frac{f[b,c]-f[a,b]}{c-a}$, and write the signed error $\varepsilon_k=x_k-r$. The secant line through $x_{k-1}$ and $x_k$ is the degree-1 interpolant of $f$, so for every $x$

$$f(x)=f(x_k)+f[x_{k-1},x_k]\,(x-x_k)+f[x_{k-1},x_k,x]\,(x-x_{k-1})(x-x_k).$$

Set $x=r$, use $f(r)=0$, and note that the first two terms are the line, which vanishes at $x_{k+1}$. This gives an exact formula:

$$\varepsilon_{k+1}=\frac{f[x_{k-1},x_k,r]}{f[x_{k-1},x_k]}\;\varepsilon_k\,\varepsilon_{k-1}.$$

For $f\in C^2$, $f[a,b]=f'(\eta)$ and $f[a,b,c]=\tfrac12f''(\zeta)$ for points between the arguments. So near a simple root the fraction tends to $C=f''(r)/(2f'(r))$, the same constant as Newton's. Newton's error is proportional to $\varepsilon_k^2$; here one of the two factors is the older, larger error.

### The order is the golden ratio

**Hypotheses.** $f\in C^2$ near $r$, $f(r)=0$, $f'(r)\neq0$, $f''(r)\neq0$, and $x_0\neq x_1$ are close enough to $r$. **Conclusion.** $x_k\to r$ with order $\phi=(1+\sqrt5)/2\approx1.618$ and constant $\lvert C\rvert^{\phi-1}$.

The reason shows up in a logarithm. With $y_k=\ln(\lvert C\rvert e_k)$, the relation $e_{k+1}\approx\lvert C\rvert e_ke_{k-1}$ becomes $y_{k+1}\approx y_k+y_{k-1}$, the Fibonacci recurrence. Its solutions are $y_k=\alpha\phi^k+\beta(-1/\phi)^k$. Convergence means $y_k\to-\infty$, so $\alpha<0$, the second term dies out, and $y_{k+1}/y_k\to\phi$. For the constant, suppose $e_{k+1}=Ae_k^{\,p}$. Then $e_{k-1}=(e_k/A)^{1/p}$, and substituting gives $Ae_k^{\,p}=\lvert C\rvert A^{-1/p}e_k^{\,1+1/p}$. Matching exponents gives $p^2=p+1$, and matching constants gives $A=\lvert C\rvert^{1/p}=\lvert C\rvert^{p-1}$. This argument treats $\approx$ as $=$; a full proof bounds the fraction above.

## Worked Examples

### Example 1: the order measured

Solve Kepler's equation from `newtons-method`, $f(E)=E-0.3\sin E-1$, with $x_0=1$, $x_1=1.5$. In float64, against a reference root computed to 2000 digits:

```text
k  x_k                 e_k        e_k/(e_{k-1}e_{k-2})   p_k
0  1.0                 2.881e-01
1  1.5                 2.119e-01
2  1.2785142391301476  9.577e-03  0.1569
3  1.2877773371566017  3.140e-04  0.1547                 1.104
4  1.2880917861898569  4.730e-07  0.1573                 1.901
5  1.2880913131884923  2.335e-11  0.1572                 1.526
6  1.2880913132118377  1.177e-17
```

The two-term ratio already matches $C=0.1572$. The order column does not settle: float64 gives only three clean values, $1.10$, $1.90$, $1.53$, and the $(-1/\phi)^k$ term still matters at that stage. At $k=6$ the relation predicts $1.7\times10^{-18}$, below the rounding error, and $x_6$ is simply the float nearest $r$. Then $f(x_6)=0$, $x_7=x_6$, and the formula for $x_8$ is $0/0$, so a stopping test is mandatory rather than optional. `scipy.optimize.newton(f, 1.0, x1=1.5, tol=1e-12)`, which runs the secant method when no `fprime` is given, stops after 6 iterations with a result one float away, because it writes the update differently.

The limit needs more digits, so here is the same iteration at 2000 digits:

```text
k   e_k         e_k/(e_{k-1}e_{k-2})   e_k/e_{k-1}^phi   p_k
6   1.736e-18   0.1572012              0.27676           1.6553
8   1.738e-48   0.1572012              0.30198           1.6234
10  4.757e-127  0.1572012              0.31221           1.6188
12  9.732e-333  0.1572012              0.31620           1.6181
14  3.047e-871  0.1572012              0.31774           1.6181
```

$p_k$ approaches $\phi=1.61803$ and the third column heads for $\lvert C\rvert^{\phi-1}=0.31870$, in agreement with the theorem.

### Example 2: Newton against the secant method, per evaluation

Same equation, with Newton from $x_0=1$. Counting $f$ and $f'$ as one evaluation each, and listing the error of the best iterate those evaluations can produce:

```text
evaluations   Newton     Secant (x1 = 1.5)
2             1.3e-02    9.6e-03
3                        3.1e-04
4             2.7e-05    4.7e-07
5                        2.3e-11
6             1.2e-10    1.2e-17
8             1.2e-17
```

The secant method wins here despite the lower order. The result does depend on $x_1$: with $x_1=2$ it reaches the rounding floor at 7 evaluations, and with $x_1=1.0001$ at 6.

Asymptotically, the number of correct digits is multiplied by $p$ per iteration, so per unit of work it is multiplied by $p^{1/w}$, where $w$ is the work of one iteration. If $f'$ costs $\theta$ times as much as $f$, Newton gets $2^{1/(1+\theta)}$ and the secant method gets $\phi$. At $\theta=1$ that is $1.414$ against $1.618$. The two are equal at $\theta=\ln2/\ln\phi-1=0.44$, so Newton is ahead only when $f'$ costs less than about 44% of $f$. Kepler's $f'$ only adds a $\cos E$ to the $\sin E$ of $f$, and if both come from one call then $\theta$ is near $0$ and Newton is ahead, even though the table above, which charges full price for $f'$, favors the secant method. The model ignores the starting phase and rounding, and it assumes both methods are in their asymptotic regime.

### Example 3: each hypothesis removed

**$f'(r)\neq0$.** For $f(x)=x^2$ the iteration is exactly $1/x_{k+1}=1/x_k+1/x_{k-1}$, again Fibonacci, so the ratio tends to $1/\phi=0.618$ and the order is 1. On $x^3-3x+2$, with double root $1$ and starts $2$ and $1.8$, the ratio reaches $0.6180$ by $k=20$, then rounding breaks it and the run freezes at $2.7\times10^{-9}$ at $k=40$, near the floor Newton hit. Per evaluation this is still better than Newton's $0.5$ per two evaluations, which is $0.707$ per evaluation.

**$f\in C^2$.** For $f(x)=x+x\sqrt{\lvert x\rvert}$ and $a,b>0$, $f[a,b,0]=1/(\sqrt a+\sqrt b)$, so $e_{k+1}\approx e_ke_{k-1}^{1/2}$ instead. The same argument gives $p=1+1/(2p)$, so $p=(1+\sqrt3)/2=1.36603$. Measured from $x_0=0.5$, $x_1=0.4$, in float64 (the root at $0$ leaves plenty of exponent range):

```text
k   e_k         e_k/(e_{k-1}e_{k-2}^(1/2))   p_k
6   8.657e-06   0.7315                       1.349
9   8.960e-14   0.9508                       1.359
13  3.609e-46   1.0002                       1.366
```

**$f''(r)\neq0$.** Removing this one speeds the method up. For $\sin x$ at $r=0$, $f[a,b,0]\approx-(a+b)/6$, so $e_{k+1}\approx\tfrac16e_ke_{k-1}^2$, and $p=1+2/p$ gives $p=2$. A 6000-digit run from $0.5$, $0.4$ gives $p_k$ of $1.961$, $2.020$, $1.990$, $2.005$, and the ratio $e_{k+1}/(e_ke_{k-1}^2)$ settles at $0.166667$. Still, by the definition above this sequence has no order. Here $y_k=\ln e_k$ plus a constant obeys $y_{k+1}=y_k+2y_{k-1}$, with roots $2$ and $-1$, and the $(-1)^k$ term never dies out relative to the constant: $e_k/e_{k-1}^2$ alternates between $0.781909$ and $0.213153$ from $k=5$ to $k=12$, with no drift. So $p_k\to2$, yet no limit $A$ exists, the same distinction drawn for bisection. The value $1.618$ is therefore a statement under its hypotheses, not a property of the method alone.

**Good starts.** For $x^2-4$ with $x_0=-3$, $x_1=3$ the two values of $f$ are equal and the first step divides by zero, although roots lie between the starts. For $\arctan x$, starts $3$, $4$ give $-13.3$, $-4.1$, $70.6$, $30.4$, $-3270$ and diverge, while $1.2$, $2$ converge. At high eccentricity ($e=0.99$, $M=0.2$), starts $0.2$, $0.3$ stay below $5$ and reach the root at $k=13$, a calmer run than Newton's excursion to $1126.7$ in `newtons-method`. That is one case: neither method is safe from a bad start.

### Example 4: a black box, where $f'$ does not exist as code

A projectile with quadratic drag obeys $\dot{\mathbf v}=-g\hat{\mathbf y}-k\lVert\mathbf v\rVert\mathbf v$, with $g=9.81$ m/s², $k=0.005$ per meter, and launch speed $100$ m/s. Find the angle $\theta$ below the maximum-range angle that lands at $250$ m. The range has no formula, so $f(\theta)=\text{range}(\theta)-250$ is one call to `scipy.integrate.solve_ivp` with `method='DOP853'`, at about 270 right-hand-side evaluations. With starts $15^\circ$ and $20^\circ$, `rtol=1e-11` and `atol=1e-13`:

```text
evaluations  theta (degrees)       f(theta) (m)
3            22.160585688          -2.93
4            22.957456986          -3.83e-01
5            23.077269499          -1.70e-02
6            23.082829199          -1.06e-04
7            23.082864214          -2.98e-08
8            23.082864223534        1.47e-10
```

Later iterates only bounce: $\lvert f\rvert$ stays between $7\times10^{-11}$ and $5\times10^{-10}$, the noise of the integrator. Rerunning with `rtol=1e-5` and `atol=1e-7` takes the same number of steps and arrives at $23.0828668^\circ$, off by $2.6\times10^{-6}$ degrees. The secant method converges just as fast to the root of the function it was given. Order describes that speed and says nothing about how accurately $f$ was computed.

### Example 5: keeping a bracket

The secant method can leave the root's neighborhood, so a tempting fix is **regula falsi**: use the same line, but replace whichever endpoint keeps a sign change. Counting the evaluation at which a point within $10^{-10}$ of $r$ is first evaluated, on Example 1's equation over $[0,2]$:

```text
bisection                      36
regula falsi                   13
scipy.optimize.brentq           7
secant (1, 1.5, no bracket)     6
```

Regula falsi is only linear here. The function is convex on the bracket, so the endpoint $2$ never moves, and the error ratio settles at $0.103$. Keeping the bracket that way gives up the superlinear order. `brentq` keeps a bracket and combines bisection with inverse quadratic interpolation, which is why it is the usual default when a sign change is known.

## Common Misconceptions & Pitfalls

- **"Order 1.618 means it is slower than Newton."** Per iteration, yes. Per evaluation it can be faster (Example 2), unless $f'$ is cheap.
- **"The starts must bracket the root."** They need not, and starts that do are not safe either: $x^2-4$ from $\pm3$ fails at the first step.
- **"The secant method is regula falsi."** Same line, different bookkeeping. Regula falsi keeps a sign change and drops to linear order (Example 5).
- **"A float64 run shows the order."** It gives a few noisy values of $p_k$. In Example 1 the ratio $e_k/(e_{k-1}e_{k-2})$ was far more informative.
- **"The order is $1.618$, always."** It requires a simple root, $C^2$, and $f''(r)\neq0$. Without those, Example 3 measured $1$ and $1.366$, and a case where $p_k\to2$ with no order at all.
- **"Bisection has order 1."** Its bracket does; its midpoint errors in general have no limiting ratio.
- **"A faster order means a more accurate answer."** Example 4 converged at full speed to a value limited by the accuracy of $f$.
- **"Keep iterating to be safe."** After convergence the denominator is pure rounding noise, or exactly zero. Stop on the step size and the residual, and cap the iterations.

## Summary

The secant method replaces $f'(x_k)$ by the slope through the last two points, so it costs one evaluation per iteration and needs no derivative. Order is defined by $e_{k+1}/e_k^{\,p}\to A$, and it is measured with $p_k$; bisection's midpoints in general have no such limit, only a bound. The exact relation $\varepsilon_{k+1}=\frac{f[x_{k-1},x_k,r]}{f[x_{k-1},x_k]}\varepsilon_k\varepsilon_{k-1}$ gives $e_{k+1}\approx\lvert C\rvert e_ke_{k-1}$, a Fibonacci recurrence for the logarithms, and so order $\phi$ with constant $\lvert C\rvert^{\phi-1}$, for a simple root of a $C^2$ function with $f''(r)\neq0$ and good starts. High-precision runs reach $1.6181$ and $0.3187$; float64 gives only a rough value. Asymptotically, per evaluation, the secant method beats Newton when $f'$ costs more than about 44% of $f$. Without the hypotheses the measured order changed to $1$ or $1.366$, $p_k$ tended to $2$ with no true order, or the run failed. When a bracket is known, `brentq` is the usual choice.

## Documentation Links

- [Fundamentals of Numerical Computation, 4.4 Interpolation-based methods](https://fncbook.com/secant): the secant method, superlinear convergence, the golden-ratio order, and inverse quadratic interpolation.
- [MIT OpenCourseWare 18.330, Chapter 4: Nonlinear equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter4/): the secant method with its error product and order argument.
- [SciPy, scipy.optimize.newton](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.newton.html): the routine that runs the secant method when no derivative is passed.
- [SciPy, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): Brent's bracketing method.
- [SciPy, scipy.optimize.bisect](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.bisect.html): the bisection routine used for the evaluation counts.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): the integrator that serves as the black-box function in Example 4.
