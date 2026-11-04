---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Derive Newton's iteration from the degree-1 Taylor polynomial and write it as a fixed-point iteration.
- State the local convergence theorem with all its hypotheses and prove the error relation $e_{k+1} = \frac{f''(\xi_k)}{2f'(x_k)}e_k^2$.
- Measure the order of convergence from the errors of a real float64 run, and locate the iteration where rounding ends the measurement.
- Break each hypothesis in turn (smoothness, a simple root, a good start, a nonzero derivative along the way) and predict what the run does.
- Explain why library root finders protect the Newton idea with a bracket.

## Context & Motivation

`sequences-and-convergence` ran Newton's iteration for $\sqrt 2$ and showed the errors $2.45\times10^{-3}$, $2.12\times10^{-6}$, $1.59\times10^{-12}$: the exponent roughly doubles each step. That lesson proved the sequence converges and observed the digits doubling. This one explains the doubling and says when it holds.

The two earlier root finders set the comparison. `bisection-and-convergence-rate` halves a bracket every step for any continuous $f$ with a sign change. `fixed-point-iteration` shrinks the error by a factor near $\lvert g'(r)\rvert$. Newton's method picks a $g$ for which that factor is zero at the root. The price is a derivative at every step and the loss of bisection's guarantee: Newton can diverge, cycle forever, or land on a root far from the one wanted.

## Core Theory

### The iteration from the tangent line

Near a current guess $x_k$, replace $f$ by its degree-1 Taylor polynomial (see `taylor-and-maclaurin-series-with-error-bounds`), which is the tangent line, and solve that line for its zero:

$$x_{k+1} = x_k - \frac{f(x_k)}{f'(x_k)}, \qquad f'(x_k)\neq 0.$$

Each iteration costs one evaluation of $f$ and one of $f'$. The Taylor lesson calls the degree-2 polynomial the local model behind Newton's method for minimization. That is this same iteration applied to the equation $f'(x)=0$, because the tangent line of $f'$ is the derivative of the quadratic model of $f$.

### Newton as a fixed-point iteration

The iteration is $x_{k+1}=g(x_k)$ with $g(x)=x-f(x)/f'(x)$. Where $f'\neq0$, the fixed points of $g$ are exactly the roots of $f$. Differentiating,

$$g'(x) = \frac{f(x)\,f''(x)}{f'(x)^2},$$

so $g'(r)=0$ at any root with $f'(r)\neq0$. A contraction factor of zero is why the convergence beats every linear rate.

### The local convergence theorem

Write $e_k = x_k - r$.

**Hypotheses.** $r$ is a root of $f$. On $I=[r-\delta,r+\delta]$, $f$ is twice continuously differentiable and $f'$ has no zero. With $C = \max_I\lvert f''\rvert \big/ \big(2\min_I\lvert f'\rvert\big)$, also $C\delta<1$.

**Conclusion.** For every $x_0\in I$ the iterates stay in $I$, $x_k\to r$, and $\lvert e_{k+1}\rvert\le C e_k^2$. If no $e_k$ is zero, then

$$\lim_{k\to\infty}\frac{e_{k+1}}{e_k^2}=\frac{f''(r)}{2f'(r)}.$$

**Proof.** Taylor's theorem with Lagrange remainder, expanded at $x_k$ and evaluated at $r$, gives a $\xi_k$ between them with

$$0=f(r)=f(x_k)-f'(x_k)\,e_k+\tfrac12 f''(\xi_k)\,e_k^2.$$

Dividing by $f'(x_k)$ and using $e_{k+1}=e_k-f(x_k)/f'(x_k)$ gives

$$e_{k+1}=\frac{f''(\xi_k)}{2f'(x_k)}\,e_k^2.$$

So $\lvert e_{k+1}\rvert\le Ce_k^2\le(C\delta)\lvert e_k\rvert$, which keeps the iterates in $I$ and sends the error to zero. Then $x_k$ and $\xi_k$ tend to $r$, and continuity of $f'$ and $f''$ gives the limit.

The theorem is sufficient and local. It says nothing about starts outside $I$, and "quadratic" means at least quadratic: if $f''(r)=0$ the limit is $0$ and the order can be higher. For $\sin x$ at $r=0$ the step is $x-\tan x\approx -x^3/3$, and from $x_0=0.5$ the errors are $4.6\times10^{-2}$, $3.3\times10^{-5}$, $1.2\times10^{-14}$, with $\lvert e_{k+1}\rvert/\lvert e_k\rvert^3$ going $0.370$, $0.334$, $0.333$.

### Multiple roots

If $f(x)=(x-r)^m h(x)$ with $m\ge2$, $h$ smooth and $h(r)\neq0$, then $f'(r)=0$ and the theorem does not apply. Computing the limit of $g'$ gives $g'(r)=1-\tfrac1m$, so Newton is still a contraction near $r$, but only a linear one, with ratio $\tfrac12$ for a double root. When $m$ is known, the step $x_{k+1}=x_k-m\,f(x_k)/f'(x_k)$ makes that derivative zero again.

### Stopping

Near a simple root $f(x_k)\approx f'(r)\,e_k$, so the step size estimates the error of $x_k$, not of $x_{k+1}$, which is much smaller. The residual $\lvert f(x_k)\rvert$ is a backward error: $x_k$ exactly solves $f(x)-f(x_k)=0$. Turning it into a forward error divides by $\lvert f'(r)\rvert$, which fails on flat functions. For $(x-1)^3$ at $x=1.001$ the residual is $10^{-9}$ and the error is $10^{-3}$. See `conditioning-and-numerical-stability` for that distinction. A robust loop tests the step and the residual and also caps the iteration count, because neither test fires on a cycle.

## Worked Examples

### Example 1: Kepler's equation, with the order measured

Orbit propagation solves $E-e\sin E=M$ for the eccentric anomaly $E$. Take $e=0.3$, $M=1$, so $f(E)=E-0.3\sin E-1$ and $f'(E)=1-0.3\cos E$, and start at $x_0=M$. A float64 run, with errors measured against the root computed to 80 digits, $r=1.28809131321183768\ldots$:

```text
k  x_k                  e_k         e_k/e_{k-1}^2   p_k
0  1.0                 -2.881e-01
1  1.3012752012180726   1.318e-02   0.1588
2  1.288118592417824    2.728e-05   0.1569          2.004
3  1.2880913133288192   1.170e-10   0.1572          2.000
4  1.2880913132118377  -1.177e-17
```

Here $p_k=\ln\lvert e_k/e_{k-1}\rvert\big/\ln\lvert e_{k-1}/e_{k-2}\rvert$ is the observed order. It agrees with the theorem's $2$, and the ratio agrees with $f''(r)/(2f'(r))=0.1572$. At $k=4$ the theory predicts $0.1572\,(1.17\times10^{-10})^2\approx2\times10^{-21}$, but floats near $1.29$ are $2.2\times10^{-16}$ apart. The truncation error has fallen below the rounding error, $x_4$ is the float nearest $r$, the computed $f(x_4)$ is exactly $0$, and the ratio and $p_k$ stop meaning anything. Four iterations, eight evaluations.

The theorem applies with room to spare. Everywhere $f'\ge0.7$ and $\lvert f''\rvert\le0.3$, so $C\le3/14$ and any $\delta<14/3$ qualifies. A sweep of 20,001 starts within $4.66$ of $r$ converged in at most 7 iterations each. `scipy.optimize.newton(f, 1.0, fprime=df, tol=1e-12)` returns the same float in 4 iterations.

### Example 2: dividing with only multiplication

For $f(x)=1/x-a$ the iteration simplifies to $x_{k+1}=x_k(2-ax_k)$, with no division in it. It also has an exact error law: $1-ax_{k+1}=(1-ax_k)^2$. So it converges if and only if $\lvert1-ax_0\rvert<1$, that is $0<x_0<2/a$. Global answers like this are rare. With $a=7$ and $2/a=0.2857\ldots$:

```text
x0 = 0.10   0.13   0.1417   0.142848   0.1428571422   (ratio |e_k|/e_{k-1}^2 = 7.0000)
x0 = 0.28   0.0112   0.0215   0.0398   0.0685   0.1042   0.1324   0.1421
x0 = 0.29  -0.0087  -0.0179  -0.0381  -0.0864  -0.2250  -0.8044  -6.1387
```

The first line shows the predicted constant $\lvert f''(r)/(2f'(r))\rvert=a$. The second starts inside the region, so it converges, but its first steps are nothing like quadratic. The third starts $0.01$ further along and runs off to $-\infty$.

### Example 3: losing smoothness lowers the order

Take $f(x)=x+x\sqrt{\lvert x\rvert}$. The root $0$ is simple and $f'$ is continuous with $f'(0)=1$, but $f''$ is unbounded near $0$, so $f\notin C^2$. For $x>0$ the next iterate simplifies to $\tfrac12x^{3/2}/(1+\tfrac32\sqrt x)$, which predicts order $\tfrac32$ with constant $\tfrac12$. From $x_0=0.5$:

```text
k  e_k         e_k/e_{k-1}^(3/2)   p_k
2  8.728e-03   0.3474              1.296
4  3.288e-06   0.4862              1.468
6  8.105e-14   0.5000              1.500
8  6.196e-31   0.5000              1.500
```

Remove more and convergence goes too. With $f(x)=\operatorname{sign}(x)\sqrt{\lvert x\rvert}$, whose derivative is unbounded at the root, every step is exactly $x\mapsto-x$, and $x_0=0.3$ alternates between $0.3$ and $-0.3$ forever.

### Example 4: a double root, and where rounding stops it

$f(x)=x^3-3x+2=(x-1)^2(x+2)$ has a double root at $1$. From $x_0=2$ the ratio $\lvert e_k/e_{k-1}\rvert$ reads $0.556$, $0.536$, $0.522$, and it has settled at $0.5000$ by $k=13$, the predicted $1-\tfrac12$. The observed order is $1.000$. Worse, more iterations do not rescue it. With `f = x**3 - 3*x + 2` and `df = 3*x**2 - 3`, the error reaches about $2\times10^{-8}$ at $k=26$, then turns erratic and freezes at $3.6\times10^{-9}$ at $k=30$. That exact value means little: spellings such as `x*x*x` or `3*x*x` change each evaluation by about 1 ulp, and across eight spellings of $f$ and $f'$ the freeze ranged from $1.5\times10^{-9}$ to $9.7\times10^{-9}$. Near the root $f(x)\approx3e^2$, and once $3e^2$ is near the $10^{-16}$ rounding noise of evaluating the cubic, $f$ returns noise. That happens at $e\approx10^{-8}$, about the square root of machine precision, and it comes from the problem's conditioning rather than from Newton. How $f$ is written matters far more: `(x-1)**2*(x+2)` has no such cancellation. With `df = 2*(x-1)*(x+2) + (x-1)**2` it reaches exactly $1$ at $k=54$, and other spellings of $f'$ stop within 1 ulp of $1$ a step or two earlier.

With $m=2$ known, the modified step on the factored form gives errors $1.1\times10^{-1}$, $1.9\times10^{-3}$, $6.3\times10^{-7}$, $6.7\times10^{-14}$, then $0$, with $e_k/e_{k-1}^2$ reaching $0.166$. On the expanded form the same step, with the code above, reaches $1.6\times10^{-10}$ and then jumps back to $4.8\times10^{-7}$, while `x*x*x` stops at $3.8\times10^{-11}$: the noise is now in the numerator of a large step, so the last digits depend on the spelling.

### Example 5: starting points and flat spots

In the first four cases a simple root exists and only the start is at fault.

- **Kepler at high eccentricity.** With $e=0.99$, $M=0.2$, the root is $r=1.0669973652816$. From $x_0=M=0.2$, $f'(x_0)=0.030$ and the first step lands at $6.8$. The run then visits $-34.9$, $13.3$, and $1126.7$ before converging after 19 iterations. From $x_0=\pi$ it descends monotonically in 7 iterations. The theorem covers only about $\delta\le0.42$ here, so both starts are outside it. The start at $\pi$ works for a different reason: between $r$ and $\pi$, $f'>0$ and $f''\ge0$, so the tangent lines stay below the graph and the iterates cannot overshoot $r$.
- **A cycle that attracts.** $x^3-2x+2$ from $x_0=0$ gives $0,1,0,1,\ldots$ exactly. This is not one unlucky point: $x_0=0.1$ falls onto the same cycle, and of 4001 evenly spaced starts in $[-0.5,1.5]$, 1437 end on it. The others reach the real root $-1.76929$.
- **Divergence.** For $\arctan x$, starts of size below $1.39175$ converge and larger ones diverge: $x_0=1.3$ reaches $0$, while $x_0=1.5$ gives $-1.69$, $2.32$, $-5.11$, $32.3$, $-1575$.
- **A vanishing derivative.** $\cos x$ at $x_0=0$ divides by zero. At $x_0=0.001$ the tangent is nearly flat, the first step lands at $1000.0007$, and the run converges to $637\pi/2\approx1000.597$, not to the nearest root $\pi/2$.
- **No real root.** $x^2+1$ from $x_0=0.5$ never settles; the iterates wander, reaching $\lvert x\rvert=63.7$ within 60 iterations.

### Example 6: what libraries do about it

On the $e=0.99$ problem, `scipy.optimize.newton` with `fprime` and `tol=1e-12` reproduces the runs above: 19 iterations from $0.2$ and 7 from $\pi$. `scipy.optimize.brentq` on the bracket $[0,\pi]$ with `xtol=1e-12` needs no derivative and no good start, uses 12 evaluations of $f$, and returns a value within $1.3\times10^{-13}$ of $r$. A bracket cannot be lost, which is why a common design takes a Newton step when it stays inside the bracket and a bisection step when it does not. In $n$ dimensions the division becomes a linear solve with the Jacobian at each step, which is one reason `lu-decomposition-and-partial-pivoting` matters here.

## Common Misconceptions & Pitfalls

- **"Newton's method always converges quadratically."** The guarantee is local: a simple root, a $C^2$ function, a close start. Examples 3, 4 and 5 break those hypotheses one at a time.
- **"Quadratic from the first step."** The order is a limit. In Example 2 with $x_0=0.28$ the first steps are slow, and in Example 5 the first steps move away from the root.
- **"The digits double until the answer is exact."** They double until truncation error meets rounding error, which took four steps in Example 1.
- **"A slow double root just needs more iterations."** Example 4 stops improving at about $10^{-8}$ in the expanded form, however long it runs.
- **"The theorem's $\delta$ is where Newton works."** It is where the proof works. The start at $\pi$ in Example 5 is outside it and converges anyway.
- **"A small $\lvert f(x)\rvert$ means $x$ is close to the root."** On $(x-1)^3$, a residual of $10^{-9}$ goes with an error of $10^{-3}$.
- **"It uses fewer iterations, so it is cheaper."** Each iteration evaluates $f$ and $f'$. `secant-method-and-order-of-convergence` does the comparison per evaluation.

## Summary

Newton's method solves the tangent line at each step: $x_{k+1}=x_k-f(x_k)/f'(x_k)$. As a fixed-point iteration it has $g'(r)=0$ at a simple root. Taylor's theorem turns that into $e_{k+1}=\frac{f''(\xi_k)}{2f'(x_k)}e_k^2$, so for $f\in C^2$ with $f'\neq0$ near $r$ and a start close enough, the error is squared at each step, with limiting constant $f''(r)/(2f'(r))$. A real run shows this as a ratio that settles and $p_k\approx2$, until rounding takes over. Each hypothesis matters: without $C^2$ the order fell to $\tfrac32$ or the run cycled, with $f'(r)=0$ the convergence became linear and stalled near $10^{-8}$, and with a poor start the run diverged, cycled, or found a distant root. When a bracket is available, `brentq` trades speed for a guarantee.

## Documentation Links

- [Fundamentals of Numerical Computation, 4.3 Newton's method](https://fncbook.com/newton): the iteration, the error expansion at a simple root, and the definition of quadratic convergence.
- [Fundamentals of Numerical Computation, 4.2 Fixed-point iteration](https://fncbook.com/fixed-point): the contraction argument that the fixed-point view of Newton relies on.
- [MIT OpenCourseWare 18.330, Chapter 4: Nonlinear equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter4/): bisection, Newton, the secant method, and Newton in several dimensions.
- [MIT OpenCourseWare 18.335J, Lecture 1: Square roots via Newton's method](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/resources/mit18_335js19_lec1/): Newton's iteration for square roots, with an analysis of its error and a numerical run.
- [SciPy, scipy.optimize.newton](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.newton.html): the library routine, with `fprime` for Newton and without it for the secant method.
- [SciPy, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): the bracketing root finder used for comparison.
