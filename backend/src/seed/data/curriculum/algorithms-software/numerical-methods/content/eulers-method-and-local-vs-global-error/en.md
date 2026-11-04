---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define the local truncation error of Euler's method, and recognize the two conventions in use.
- State the global error theorem with its hypotheses, and explain why order 2 per step becomes order 1 overall.
- Measure both orders from a table, and show the global order dropping when $y''$ is unbounded.
- Read Euler's result as the exact solution of a nearby equation, which is its backward error.
- Derive the stability condition $\lvert 1+h\lambda\rvert\le1$, including complex $\lambda$, and show a real step size at which Euler blows up.
- Recognize stiffness, and see what an implicit step changes.
- Separate truncation from rounding when the step gets very small.

## Context & Motivation

The lesson `differential-equations-and-initial-value-problems` introduced the update $y_{n+1} = y_n + h f(t_n, y_n)$, saw the error at a fixed time halve with $h$, and saw the gradient-descent iteration $x_{k+1}=(1-10h)x_k$ fail for $h>0.2$. Those were observations. This lesson supplies the reasons, in three questions.

Why is the method first order when one step looks second order? When is the classical error bound useful, and when is it wildly pessimistic? And why can a perfectly smooth, slowly varying solution force a tiny step? The same three questions come back for every solver, including those in `runge-kutta-methods`.

## Core Theory

### Local truncation error

The **local truncation error** measures one step started from the exact solution:

$$\ell_{n+1} = y(t_{n+1}) - y(t_n) - h f\big(t_n, y(t_n)\big).$$

If $y\in C^2$, Taylor's theorem with $y'=f$ gives $\ell_{n+1} = \frac{h^2}{2}y''(\xi_n)$ for some $\xi_n$ in the step. Since $y''=f_t+f f_y$ along the solution, $f\in C^1$ is enough for this.

Conventions differ. Some books, including Fundamentals of Numerical Computation, define the truncation error as the residual per unit step, $\tau = \ell/h$, which is $O(h)$ for Euler. Others use $\ell$ itself, which is $O(h^2)$. Both describe the same method, so check which one a source means. This lesson uses $\ell$.

### From local to global

The **global error** is $e_n = y(t_n) - y_n$. Subtract the method from the definition of $\ell$:

$$e_{n+1} = e_n + h\big[f(t_n,y(t_n)) - f(t_n,y_n)\big] + \ell_{n+1}.$$

**Theorem.** Suppose $f$ is continuous and Lipschitz in $y$ with constant $L>0$ on $[t_0,T]\times\mathbb R$, the solution is $C^2$ with $\lvert y''\rvert\le M$ on $[t_0,T]$, and $y_0=y(t_0)$. Then for $t_n\le T$,

$$\lvert e_n\rvert \le \frac{hM}{2L}\Big(e^{L(t_n-t_0)}-1\Big).$$

The proof takes absolute values, $\lvert e_{n+1}\rvert\le(1+hL)\lvert e_n\rvert+\frac{h^2M}{2}$, unrolls the recurrence into a geometric sum, and uses $1+hL\le e^{hL}$.

Two separate things happen. About $(T-t_0)/h$ steps each inject $O(h^2)$, which loses one power of $h$. And the factor $1+hL$ lets old errors grow while they travel, which is where the exponential comes from. So global error is not simply the sum of local errors, as Example 2 shows.

An initial error adds $e^{L(t_n-t_0)}\lvert e_0\rvert$. If each step also commits a rounding error of at most $\delta$, the term $hM/2$ becomes $hM/2+\delta/h$: the truncation part shrinks with $h$, and the rounding part grows.

### Forward and backward error

Using the terms of `conditioning-and-numerical-stability`, $e_n$ is a forward error. For $y'=\lambda y$ there is also a clean backward statement. With $1+h\lambda>0$, Euler's $y_n=(1+h\lambda)^n y_0$ is the exact solution at $t_n$ of

$$y'=\mu y, \qquad \mu=\frac{\ln(1+h\lambda)}{h}=\lambda-\frac{h\lambda^2}{2}+O(h^2).$$

The method solves a nearby equation exactly, and the nearness is $O(h)$. With $\lambda=-1$ and $h=0.01$, $\mu=-1.00503$. Over a time $T$, the relative forward error is $\lvert e^{(\mu-\lambda)T}-1\rvert\approx Th\lambda^2/2$. When $1+h\lambda<0$ no real $\mu$ exists, which is the first sign of the next topic.

### Stability

Apply Euler to $y'=\lambda y$ with $\lambda\in\mathbb C$: $y_{n+1}=(1+z)y_n$ with $z=h\lambda$. The iterates stay bounded exactly when $\lvert 1+z\rvert\le1$, a disk of radius 1 centered at $-1$. This is the **stability region**. It is a property of the method applied to a test equation, and for a nonlinear $f$ or a system, it applies through the eigenvalues of the Jacobian, as a local guide.

- **Real $\lambda<0$:** the condition is $h\le2/\lvert\lambda\rvert$. The gradient-descent limit $h<0.2$ for $\lambda=-10$ is this case, with $h=0.2$ itself sitting on the boundary: bounded, not convergent.
- **Imaginary $\lambda=i\omega$:** $\lvert 1+i\omega h\rvert^2=1+\omega^2h^2>1$ for every $h>0$. The disk touches the imaginary axis only at the origin, so no step is stable for an undamped oscillation.

### Stiffness

A problem is **stiff** when stability, not accuracy, dictates the step. It is a matter of degree, not a yes-or-no property. The typical shape is a slow solution with a fast mode that has already decayed. The fast mode no longer matters to the answer, but it still sets $\lvert\lambda\rvert$, and therefore $h$.

**Backward Euler**, $y_{n+1}=y_n+hf(t_{n+1},y_{n+1})$, has $y_{n+1}=\frac{1}{1-z}y_n$, so it is stable for all $h>0$ when $\operatorname{Re}\lambda\le0$. It is still order 1. The price is solving an equation at each step, a linear system for a linear problem.

## Worked Examples

### Example 1: one step by hand

Take $y'=y\cos t$, $y(0)=1$, whose solution is $y=e^{\sin t}$. With $h=0.1$, Euler gives $y_1=1+0.1\cdot1=1.1$, while $y(0.1)=1.104987$. So $\ell_1=0.004987$. The prediction is $\frac{h^2}{2}y''(0)=0.005$, since $y''=y(\cos^2t-\sin t)$ equals 1 at $t=0$.

### Example 2: local and global orders, measured

On the same problem up to $t=2$, the table shows the largest local error over all steps, the sum of the absolute local errors, and the global error at $t=2$.

```text
  n      h       max|l|   order   sum|l|     |e_n|    order
 10  0.20000   5.314e-02         2.895e-01  1.482e-01
 20  0.10000   1.354e-02  1.97   1.468e-01  7.467e-02  0.99
 40  0.05000   3.397e-03  1.99   7.354e-02  3.746e-02  1.00
 80  0.02500   8.491e-04  2.00   3.683e-02  1.876e-02  1.00
160  0.01250   2.124e-04  2.00   1.843e-02  9.386e-03  1.00
320  0.00625   5.309e-05  2.00   9.217e-03  4.695e-03  1.00
640  0.00313   1.327e-05  2.00   4.609e-03  2.348e-03  1.00
```

Local order 2, global order 1, as the theorem says. The global error is about half the sum of the local errors: $y''$ changes sign near $t=0.67$, so local errors partly cancel, and each one is then carried by the flow. With $L=1$ and $M=e$ (the maximum of $\lvert y''\rvert$ on $[0,2]$, at $t=\pi/2$), the bound at $n=160$ is $0.109$, about 12 times the true error.

### Example 3: when the bound is useful

Take $h=0.01$ and $y'=\pm y$, $y(0)=1$. The theorem has $L=1$ in both cases, but the flows are opposite.

```text
            y' = y (growing)                y' = -y (decaying)
 T    |e_n|     rel. error   bound      |e_n|     rel. error   bound
 1   1.35e-02    0.0050     2.3e-02    1.85e-03    0.0050     8.6e-03
 5   3.64e+00    0.025      1.1e+02    1.67e-04    0.025      7.4e-01
10   1.07e+03    0.048      2.4e+06    2.23e-06    0.049      1.1e+02
20   4.59e+07    0.095      1.2e+15    1.97e-10    0.096      2.4e+06
```

For the growing case the exponential is real: the absolute error grows along with the solution, though the bound is still far too large by $T=20$. For the decaying case, the bound says $2.4\times10^6$ when the error is $2\times10^{-10}$. It cannot see the flow contracting, because a Lipschitz constant has no sign. The relative errors agree with the backward-error estimate $Th/2$, which is $0.1$ at $T=20$. For $\lambda=-1$, $\lvert e^{(\mu-\lambda)T}-1\rvert=0.0958$, matching the table.

### Example 4: a stiff problem and a real blow-up

Consider $y'=-1000(y-\cos t)-\sin t$, $y(0)=1$. The exact solution is $y=\cos t$, as substitution confirms, and nearby solutions are $\cos t+Ce^{-1000t}$. The solution varies on a scale of order 1, yet $\lambda=-1000$, so Euler needs $h\le0.002$, which is $n\ge500$ steps to reach $t=1$. Errors at $t=1$:

```text
   n       h     1-1000h   explicit Euler   backward Euler
  10   0.10000   -99.000      4.52e+15         2.84e-05
 100   0.01000    -9.000      1.33e+90         2.72e-06
 400   0.00250    -1.500      3.42e+64         6.77e-07
 476   0.00210    -1.101      7.62e+13         5.69e-07
 490   0.00204    -1.041      3.33e+02         5.53e-07
 500   0.00200    -1.000      4.59e-07         5.42e-07
1000   0.00100    +0.000      2.70e-07         2.71e-07
2000   0.00050    +0.500      1.35e-07         1.35e-07
```

The initial condition is exact and $y$ is smooth, and still $h=0.0021$ gives $7.6\times10^{13}$: the local truncation error of each step seeds a mode amplified by $1.1$ per step. The threshold is sharp. Once stable, explicit and backward Euler have about the same accuracy here (compare $n=1000$), so the step limit is not about accuracy. Backward Euler already gets $2.8\times10^{-5}$ with $n=10$, where explicit Euler is hopeless.

### Example 5: energy in a simulated spring

Physics simulations integrate oscillators, and $x''=-x$ is the simplest: $x'=v$, $v'=-x$, with eigenvalues $\pm i$. Euler multiplies the energy $x^2+v^2$ by exactly $1+h^2$ at each step, so the energy grows for every $h$:

```text
  h     T    energy after T (start 1)    (1+h^2)^(T/h)
0.1    10           2.7048                  2.7048
0.01   10           1.1052                  1.1052
0.1   100       20959.2                  20959.2
0.01  100           2.7181                  2.7181
```

A spring in such a simulation gains energy from nothing. A small change fixes the drift: update $v_{n+1}=v_n-hx_n$ first, then $x_{n+1}=x_n+hv_{n+1}$. This semi-implicit (symplectic) Euler keeps the energy between $0.952$ and $1.053$ up to $T=100$ at $h=0.1$, and is still first order.

### Example 6: when the order drops

The theorem asks for bounded $y''$. Take $y'=1/\sqrt{1-t}$, $y(0)=0$, with solution $y=2-2\sqrt{1-t}$, so $y(1)=2$. Here $y''$ and $f$ are unbounded at $t=1$, though the method never evaluates $f$ there. Each row quadruples $n$:

```text
    n     |e_n|     order
  100   1.410e-01
  400   7.177e-02   0.49
 1600   3.620e-02   0.49
 6400   1.818e-02   0.50
```

The order is $1/2$. A milder failure leaves Euler unharmed. Take $y'=y$ up to $t=1/\sqrt2$ and $y'=-y$ after it, integrated to $t=1.5$. One step per run straddles the jump, with local error $O(h)$ instead of $O(h^2)$. That is one bad step, so the errors scatter but the fitted order over $n=100\cdot2^k$, $k=0,\dots,9$, is still $0.99$. The fit varies with these choices: other end times, or the opposite sign order, give values from $0.91$ to $1.20$.

Uniqueness matters too. For $y'=3y^{2/3}$ with $y(0)=0$, the case in `differential-equations-and-initial-value-problems`, Euler stays at $0$ for every $h$, because $f(0)=0$. That is one valid solution, and $y=t^3$ is another, which no step size will find. Starting from $y_0=10^{-6}$ instead, 1000 steps reach $1.016$ at $t=1$, against the exact $1.0303$ for that start. The theorem does not apply: $f$ is not Lipschitz at $0$.

### Example 7: rounding takes over

For $y'=-y$, $y(0)=1$, to $t=1$, compare the same loop in float32 and float64. The truncation estimate is $e^{-1}h/2$.

```text
        n     float32 error   float64 error   truncation
     1000       1.840e-04       1.840e-04      1.839e-04
    10000       1.889e-05       1.839e-05      1.839e-05
    30000       6.041e-06       6.131e-06      6.131e-06
   100000       4.264e-07       1.839e-06      1.839e-06
   300000       3.506e-05       6.131e-07      6.131e-07
  1000000       2.565e-05       1.839e-07      1.839e-07
```

Until $n=30000$ float32 tracks the truncation. Then rounding, not $h$, decides. The value at $n=100000$ is lucky cancellation, not a real gain, and more steps make the result worse. In float64 the truncation line continues to at least $n=10^7$ ($1.839\times10^{-8}$). With Euler's first-order rate, reaching that accuracy takes ten million steps, which is the practical reason for `runge-kutta-methods`.

## Common Misconceptions & Pitfalls

- **"Local error $O(h^2)$ means the answer is second-order accurate."** The steps add up: the global order is 1.
- **"Global error is the sum of the local errors."** Errors are carried and scaled by the flow. Example 2 has a sum twice the error, and Example 3 has decaying problems forgetting old errors.
- **"The bound $e^{LT}$ predicts the error."** It is a worst case. For decaying solutions it can be off by 16 orders of magnitude.
- **"A smooth solution allows a large step."** Accuracy would, stability does not. Example 4 is $\cos t$.
- **"A stable step is an accurate step."** On $x''=-x$ there is no stable $h$ at all, and on $y'=-y$ with $h=1.9$ the iterates are bounded but flip sign.
- **"Implicit methods are more accurate."** Backward Euler has the same order, and in Example 4 the same error at $n=1000$. What it gains is stability.
- **"Smaller $h$ is always better."** Example 7.

## Summary

Euler's method commits a local error of $h^2y''/2$ per step. If $f$ is Lipschitz and $y''$ is bounded, the global error is $O(h)$, with a factor $e^{LT}$ that describes worst-case growth and can be far too large when the flow contracts. Both orders were measured (2.00 and 1.00), and the global order fell to $1/2$ with unbounded $y''$. For $y'=\lambda y$ the method solves a nearby equation exactly, with backward error $O(h)$. Stability requires $\lvert1+h\lambda\rvert\le1$, which rules out every $h$ for pure oscillation and forces $h\le0.002$ on a problem whose solution is $\cos t$: at $h=0.0021$ the result was $7.6\times10^{13}$. Such stiff problems call for implicit steps. Rounding sets a floor, and in float32 it arrives around $n=10^5$.

## Documentation Links

- [Fundamentals of Numerical Computation, 6.2 Euler's method](https://fncbook.com/euler): local truncation error, global error, and the convergence theorem.
- [Fundamentals of Numerical Computation, 11.3 Absolute stability](https://fncbook.com/absstab-diffusion): the test equation and stability regions.
- [Fundamentals of Numerical Computation, 11.4 Stiffness](https://fncbook.com/stiffness): linearization, and problems whose step is set by stability.
- [MIT OCW 18.330, Chapter 5: Methods for ordinary differential equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/a9d2bd9be098f0ada172af40379a17cc_MIT18_330S12_Chapter5.pdf): Euler and Runge-Kutta methods, convergence, and linear stability.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): the production solvers, explicit and implicit, with notes on stiff problems.
