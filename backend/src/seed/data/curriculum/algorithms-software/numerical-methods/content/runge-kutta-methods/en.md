---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Derive the family of second-order explicit Runge-Kutta methods by matching a Taylor expansion, using no derivatives of $f$.
- Read a Butcher tableau, write classical RK4, and check its order conditions.
- Connect the midpoint, trapezoid-type, and RK4 methods to quadrature rules on $y'=f(t)$.
- Measure orders per evaluation, and show them dropping when the right-hand side lacks smoothness.
- Compute a stability function, and explain why higher order does not cure stiffness.
- Explain how an embedded pair controls the step size, and compare a working solver with `solve_ivp` by counting evaluations.

## Context & Motivation

The lesson `eulers-method-and-local-vs-global-error` ended with ten million steps for an error near $10^{-8}$. Raising the order is the obvious fix, and the direct route is a Taylor method: $y_{n+1}=y_n+hy'+\frac{h^2}{2}y''+\dots$. But $y''=f_t+ff_y$ demands partial derivatives of $f$, and the higher terms get worse (the expansion is the one in `taylor-and-maclaurin-series-with-error-bounds`). Often $f$ is a black box.

Runge-Kutta methods get the same order from extra evaluations of $f$ alone, by sampling it at well-chosen points inside the step and combining the slopes. The code that runs in `scipy.integrate.solve_ivp` by default is one of these.

## Core Theory

### Matching Taylor with two slopes

Try two stages, $k_1=f(t,y)$ and $k_2=f(t+\alpha h,\,y+\beta hk_1)$, with the update $y+h(b_1k_1+b_2k_2)$. For $f\in C^2$, expanding gives $k_2=f+\alpha hf_t+\beta hff_y+O(h^2)$, and the update becomes

$$y+h(b_1+b_2)f+h^2b_2(\alpha f_t+\beta ff_y)+O(h^3).$$

The exact solution has $y+hf+\frac{h^2}{2}(f_t+ff_y)+O(h^3)$. They agree through $h^2$ when

$$b_1+b_2=1,\qquad b_2\alpha=\tfrac12,\qquad b_2\beta=\tfrac12.$$

No partial derivative of $f$ is computed: the difference $k_2-k_1$ supplies it implicitly. There is one free parameter. With $b_2=1$ this is the **explicit midpoint** method, $y+hf(t+\frac h2,\,y+\frac h2k_1)$. With $b_2=\frac12$ it is the **explicit trapezoid** method, $y+\frac h2(k_1+f(t+h,\,y+hk_1))$. Names vary by book: "Heun" and "improved Euler" are attached to different members of this family, so check the formula.

### Classical RK4 and Butcher tableaus

An $s$-stage explicit method is fixed by a table: $k_i=f\big(t+c_ih,\,y+h\sum_{j<i}a_{ij}k_j\big)$ and $y_{n+1}=y_n+h\sum_ib_ik_i$. Classical RK4 has

$$\begin{array}{c|cccc} 0 & & & & \\ \frac12 & \frac12 & & & \\ \frac12 & 0 & \frac12 & & \\ 1 & 0 & 0 & 1 & \\ \hline & \frac16 & \frac13 & \frac13 & \frac16 \end{array}$$

```python
def rk4_step(f, t, y, h):
    k1 = f(t, y)
    k2 = f(t + h / 2, y + h / 2 * k1)
    k3 = f(t + h / 2, y + h / 2 * k2)
    k4 = f(t + h, y + h * k3)
    return y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
```

Order 4 needs eight algebraic conditions on the table. In exact fractions, RK4 gives $\sum b_i=1$, $\sum b_ic_i=\frac12$, $\sum b_ic_i^2=\frac13$, $\sum b_ia_{ij}c_j=\frac16$, $\sum b_ic_i^3=\frac14$, $\sum b_ic_ia_{ij}c_j=\frac18$, $\sum b_ia_{ij}c_j^2=\frac1{12}$, and $\sum b_ia_{ij}a_{jk}c_k=\frac1{24}$, all as required. Up to order 4, $s$ stages can reach order $s$. That stops there: order 5 has 17 conditions and needs six stages. This is why order 4 is such a common stopping point.

### On a pure quadrature problem

If $f$ depends only on $t$, then $k_2=k_3$ for RK4, and a step becomes $\frac h6\big(f(t)+4f(t+\frac h2)+f(t+h)\big)$, a Simpson panel of `trapezoid-and-simpson-rules`. In the same way explicit midpoint becomes the midpoint rule, and explicit trapezoid becomes the trapezoid rule. On $f(t)=e^t$ with 8 steps, RK4 and composite Simpson agree to $4.4\times10^{-16}$. So what limits Simpson also limits RK4.

### Order needs a smooth right-hand side

The standard order theorem assumes enough derivatives of $f$ (for RK4, $f\in C^4$ is the usual statement), and the Lipschitz bound of the previous lesson then carries local order to global order. Fitted orders over $n=100\cdot2^k$, $k=0,\dots,7$, leaving out errors below $10^{-12}$:

```text
problem                                Euler   exp. trapezoid   RK4
y' = y cos t, t=1.5 (smooth)            1.00        2.00        4.00
y' = 1 + |y-1|, y(0)=0, t=1.5 (kink)    0.99        ~2.0        ~2.0
y' = y, then -y after 1/sqrt(2), t=1.5  1.00        1.03        0.75
y' = sqrt(1-y^2), y(0)=0, t=1           1.00        2.00        4.01
y' = sqrt(1-y^2), y(0)=0, t=pi/2        2.00        2.00        2.00
```

On the kink, RK4 is no better than a two-stage method. Those fitted slopes are 2.00 and 2.01, but read them only as about 2: the order between consecutive $n$ scatters from 0.4 to 4.9 for RK4, and more for the two-stage method. At the jump, the error depends on where the jump falls in a step, so the errors scatter too and the 0.75 is rough, around order 1. The fix there is to stop at the jump and restart: with $n$ RK4 steps on each side of the jump, doubling $n$ from 160 to 320 measures 4.01 again.

The last two rows are the same equation. Its solution is $\sin t$, infinitely smooth, yet at $t=\pi/2$ the solution reaches $y=1$, where $f$ has an infinite $y$-derivative (the code clips $1-y^2$ at 0). RK4 drops to order 2, with each doubling of $n$ dividing the error by 4. Smoothness of the solution is not enough; the method samples $f$ off the solution. The Euler entry of 2.00 is not a gain: the first-order term of its error happens to vanish at that one time.

### Stability functions

On $y'=\lambda y$ with $z=h\lambda$, every explicit method with $s=p\le4$ gives $y_{n+1}=R(z)y_n$, where $R$ is the Taylor polynomial of $e^z$ of degree $p$.

```text
method   R(z)                     real interval    imaginary interval
Euler    1 + z                    [-2, 0]          {0}
order 2  1 + z + z^2/2            [-2, 0]          {0}
RK4      1 + z + ... + z^4/24     [-2.785, 0]      [-2.828, 2.828]
```

RK4 reaches a piece of the imaginary axis, so unlike Euler it can run an undamped oscillation at a finite step. But an explicit method has a polynomial $R$, and a nonconstant polynomial is unbounded, so its stability region is bounded. Explicit methods cannot be stable for all $h$ on a stiff problem.

### Adaptive step size: embedded pairs

Two Runge-Kutta formulas of different order can share stages. The Bogacki-Shampine pair, used by SciPy's `RK23`, has

$$k_2=f(t+\tfrac h2,y+\tfrac h2k_1),\quad k_3=f(t+\tfrac{3h}4,y+\tfrac{3h}4k_2),\quad y_{n+1}=y+h\big(\tfrac29k_1+\tfrac13k_2+\tfrac49k_3\big),$$

and $k_4=f(t+h,y_{n+1})$. The third-order result $y_{n+1}$ and a second-order result built with $k_4$ differ by $E=h\big(-\frac5{72}k_1+\frac1{12}k_2+\frac19k_3-\frac18k_4\big)$. That difference estimates the local error of the second-order formula, with no extra evaluations. Since $k_4$ is the next step's $k_1$ (first same as last), each attempted step costs three evaluations, not four.

The controller scales $E$ by $\text{sc}=\text{atol}+\text{rtol}\,\max(\lvert y\rvert,\lvert y_{n+1}\rvert)$, takes a root-mean-square norm $\epsilon$ of $E/\text{sc}$, accepts if $\epsilon<1$, and sets

$$h_{\text{new}}=h\cdot\min\big(10,\ \max(0.2,\ 0.9\,\epsilon^{-1/3})\big).$$

The exponent is $-1/(q+1)$ with $q=2$, the lower order. SciPy keeps the higher-order result even though the error refers to the lower one, which is called local extrapolation. `RK45` does the same with the Dormand-Prince 5(4) pair. The documentation is precise about what is bounded: "The solver keeps the local error estimates less than atol + rtol * abs(y)." That is a per-step estimate, not the error of the final answer.

## Worked Examples

### Example 1: one RK4 step by hand

Return to $y'=t-y$, $y(0)=1$, exact solution $y=t-1+2e^{-t}$, with $h=0.5$.

$$\begin{aligned} k_1&=f(0,1)=-1,\\ k_2&=f(0.25,\,1+0.25k_1)=f(0.25,\,0.75)=-0.5,\\ k_3&=f(0.25,\,1+0.25k_2)=f(0.25,\,0.875)=-0.625,\\ k_4&=f(0.5,\,1+0.5k_3)=f(0.5,\,0.6875)=-0.1875. \end{aligned}$$

So $y_1=1+\frac{0.5}{6}(-1-1-1.25-0.1875)=0.713542$, against the exact $0.713061$, an error of $4.8\times10^{-4}$. Euler at the same step gave $0.5$, an error of $0.21$.

### Example 2: measuring the orders, and the floor

For $y'=y\cos t$, $y(0)=1$, errors at $t=2$ for $n$ steps, with the measured order in parentheses:

```text
  n     Euler             midpoint          exp. trapezoid    RK4
 10   1.482e-01         2.018e-03         1.970e-02         1.726e-05
 20   7.467e-02 (0.99)  6.303e-04 (1.68)  4.778e-03 (2.04)  1.057e-06 (4.03)
 40   3.746e-02 (1.00)  1.756e-04 (1.84)  1.174e-03 (2.03)  6.510e-08 (4.02)
 80   1.876e-02 (1.00)  4.630e-05 (1.92)  2.908e-04 (2.01)  4.034e-09 (4.01)
160   9.386e-03 (1.00)  1.189e-05 (1.96)  7.234e-05 (2.01)  2.510e-10 (4.01)
320   4.695e-03 (1.00)  3.011e-06 (1.98)  1.804e-05 (2.00)  1.565e-11 (4.00)
```

Midpoint climbs to 2 only slowly, a reminder that order is a limit. In float64, RK4 reaches $4.4\times10^{-15}$ at $n=2560$ and then wanders between $5\times10^{-15}$ and $4\times10^{-14}$ up to $n=81920$: rounding has taken over. In float32 the same loop stops improving near $n=20$, at about $10^{-6}$ apart from lucky dips, and is at $9.8\times10^{-6}$ by $n=20480$.

### Example 3: the fair comparison is per evaluation

RK4 pays four evaluations per step, so compare at equal budgets. On $y'=t-y$ at $t=2$:

```text
evaluations    Euler       midpoint      RK4
      8       7.04e-02     3.45e-02    1.06e-02
     16       3.45e-02     6.89e-03    4.29e-04
     80       6.79e-03     2.34e-04    4.90e-07
    800       6.77e-04     2.26e-06    4.55e-11
```

With 8 evaluations ($h=1$ for RK4) the advantage is small. With 800 it is seven orders over Euler. Higher order pays once $h$ is in the asymptotic range.

### Example 4: an eccentric orbit against `solve_ivp`

An orbit with eccentricity $0.9$ moves fast near the central body and slowly far away. In units with $\mu=1$, $a=1$, start at closest approach, $(x,y)=(0.1,0)$, $(v_x,v_y)=(0,\sqrt{19})$. After $t=2\pi$ the state must return exactly, so the error is the Euclidean norm of the difference. Evaluations are counted by a wrapper around $f$.

```text
method                          f calls    error after one orbit
RK4 fixed, n=2000                  8000       1.99e-02
RK4 fixed, n=10000                40000       2.50e-05
RK4 fixed, n=100000              400000       2.38e-09
RK45 rtol=1e-3,  atol=1e-6          152       2.59e+00
RK45 rtol=1e-6,  atol=1e-9          524       1.89e-02
RK45 rtol=1e-8,  atol=1e-10         974       1.22e-04
RK45 rtol=1e-10, atol=1e-12        2204       7.01e-07
RK45 rtol=1e-12, atol=1e-14        5516       4.53e-09
RK23 rtol=1e-6,  atol=1e-9         1757       4.53e-03
RK23 rtol=1e-8,  atol=1e-10        7547       4.85e-05
```

An implementation of the Bogacki-Shampine pair with SciPy's controller (including the $\max$ in the scale, its initial-step rule, and its rule of not growing $h$ right after a rejection) reproduces both `RK23` rows exactly: 567 accepted steps and 1757 evaluations at the first tolerance, and final states within $8\times10^{-11}$. The count checks by hand: $3\cdot(567+18)$ attempts plus 2 for the start.

To match the last `RK45` row, fixed RK4 needs about $n=85000$, or 340000 evaluations (error $4.4\times10^{-9}$), about 60 times as many. That gain combines higher order with adaptivity. At `rtol=1e-10`, 198 of the 365 steps fall in the $9.5\%$ of the time closest to the central body, with median $h\approx1.8\times10^{-3}$ there, about $8\times10^{-4}$ right at closest approach (the 41 steps with $r<0.11$), and a median near $0.06$ around the far side. On a problem without such contrast the gain is modest: for $y'=y\cos t$ to $t=20$, `RK45` uses 1130 evaluations and fixed RK4 uses 1704 for an error near $6\times10^{-8}$.

Two warnings are in the table. The default tolerances give a final error of 2.59 on a state of size about 4, with status 0 and no warning. And `rtol` is not the final error: `rtol=1e-8` ends with $1.2\times10^{-4}$, because local errors accumulate over the orbit.

### Example 5: stiffness with counted work

Back to $y'=-1000(y-\cos t)-\sin t$, $y(0)=1$, whose solution is $\cos t$. Fixed RK4 needs $h\le2.785/1000$:

```text
 n     z=h*lambda   f calls   error at t=1
350      -2.857      1400      4.26e+11
355      -2.817      1420      8.13e+02
360      -2.778      1440      1.05e-04
1000     -1.000      4000      9.02e-09
```

Euler's limit was $n=500$, or 500 evaluations, with error $4.6\times10^{-7}$. The higher-order method takes 1440 evaluations to be stable at all, and its error there is larger, so higher order did not help. The adaptive solvers show the same thing. With `rtol=1e-6, atol=1e-8` to $t=10$:

```text
method    f calls (counted)   nfev field   steps   LU factorizations   error
RK23           17912            17912       3981          0           2.39e-07
RK45           21362            21362       3556          0           1.92e-07
Radau            280              278         33         34           1.64e-08
BDF              258              242        106         28           1.76e-08
```

`RK23` settles at a mean step of $0.00251$, which is its stability limit: its $R(z)$ has real interval $[-2.513,0]$. The error test is what finds that limit, by rejection: over $t\in[0,1]$ it rejects 199 steps against 401 accepted. The explicit solvers are spending evaluations on stability and not on accuracy. `Radau` and `BDF` are implicit. `Radau` uses 1/76 of the evaluations of `RK45` and is about ten times more accurate here, but both implicit methods pay for LU factorizations, which matter for large systems. The `nfev` field also leaves out the $f$ calls of the finite-difference Jacobian, which is why a counting wrapper disagrees with it for those two.

## Common Misconceptions & Pitfalls

- **"RK4 is fourth order for any $f$."** Under smoothness. On a kink its fitted order was about 2, the same as a two-stage method.
- **"A smooth solution guarantees the order."** On $y'=\sqrt{1-y^2}$ up to $t=\pi/2$ the solution is $\sin t$, and RK4 has order 2.
- **"Runge-Kutta needs derivatives of $f$."** It needs only values of $f$. The order result does need $f$ to be smooth.
- **"Each extra stage adds one order."** True up to 4. Order 5 needs six stages.
- **"Compare methods per step."** RK4 costs four times what Euler costs per step. Compare per evaluation.
- **"`rtol` is the error of the answer."** It bounds a local estimate. On the orbit, `rtol=1e-8` gave $1.2\times10^{-4}$.
- **"The defaults are fine."** `rtol=1e-3` is a default, not a judgment about the problem: the orbit ended with an error of 2.59.
- **"Higher order cures stiffness."** Fixed RK4 needed 1440 evaluations where Euler needed 500. Use an implicit method.
- **"`nfev` counts everything."** It left out Jacobian evaluations for `Radau` and `BDF`.

## Summary

Runge-Kutta methods sample $f$ inside the step and combine the slopes so that the Taylor expansion of the update matches the solution's, without derivatives of $f$. Two stages give a one-parameter family of order 2, and RK4 satisfies the eight conditions for order 4 with four stages. Past order 4 the stage count grows faster than the order. On $y'=f(t)$ these methods reduce to quadrature rules, RK4 to Simpson. Measured orders of 1, 2, and 4 hold when $f$ is smooth, and fall to about 2 at a kink and about 1 at a jump. They can fall even when the solution is smooth, as on $y'=\sqrt{1-y^2}$ at $t=\pi/2$, where $f_y$ is infinite. Explicit methods have bounded stability regions, so stiffness limits them whatever the order. An embedded pair estimates the local error from shared stages and drives the step size, which on an eccentric orbit saved a factor of about 60 over fixed RK4. The tolerance bounds a local estimate, so the final error has to be checked, and work is honestly compared by counting calls to $f$.

## Documentation Links

- [Fundamentals of Numerical Computation, 6.4 Runge-Kutta methods](https://fncbook.com/rk): deriving two-stage methods, tableaus, RK4, and efficiency per evaluation.
- [Fundamentals of Numerical Computation, 6.5 Adaptive Runge-Kutta](https://fncbook.com/adaptive-rk): step size prediction, embedded formulas, Bogacki-Shampine, and the first-same-as-last property.
- [MIT OCW 18.330, Chapter 5: Methods for ordinary differential equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/a9d2bd9be098f0ada172af40379a17cc_MIT18_330S12_Chapter5.pdf): Runge-Kutta methods, order, and linear stability.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): the solver interface, tolerances, methods, and the `nfev` field.
- [SciPy, scipy.integrate.RK45](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK45.html): the Dormand-Prince 5(4) pair and local extrapolation.
- [SciPy, scipy.integrate.RK23](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK23.html): the Bogacki-Shampine 3(2) pair.
- [SciPy, scipy.integrate.Radau](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.Radau.html): the implicit Radau IIA method for stiff problems.
