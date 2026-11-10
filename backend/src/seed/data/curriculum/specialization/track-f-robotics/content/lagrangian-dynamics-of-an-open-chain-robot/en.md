---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Write the kinetic and potential energy of a two-link planar arm whose links have mass, a center of mass, and a moment of inertia, with every parameter stated as an assumed value with units.
- Apply the Euler-Lagrange equation by hand and obtain the joint torques as functions of $q$, $\dot q$ and $\ddot q$.
- Confirm the result four independent ways: symbolic differentiation with SymPy, a recursive Newton-Euler computation, a finite-difference Euler-Lagrange computation, and energy conservation in a simulation.
- Read the structure of the result: linear in $\ddot q$, quadratic in $\dot q$, trigonometric in $q$.

## Context & Motivation

`static-forces-and-joint-torques` held the arm still. Once it moves, the motors must also accelerate the links, and moving links push on each other. Two classical routes give the equations of motion. **Newton-Euler** writes $F=ma$ and the moment balance for each link, including the forces at the joints that hold the links together, and then eliminates those internal forces. **Lagrange** starts from two scalar functions, the kinetic and potential energy written in the joint angles, and the internal forces never appear. *Modern Robotics* says of the two that the resulting equations "are, and must be, identical". This lesson derives the two-link arm by Lagrange, by hand, and then checks that statement numerically.

## Core Theory

### The Euler-Lagrange equation with joint torques

Choose generalized coordinates $q\in\mathbb R^n$ that fix the configuration; for an open chain with every joint actuated, the joint angles serve. The generalized forces are the quantities $\tau$ for which $\tau^T\dot q$ is the power delivered, which here are the joint torques. With the Lagrangian $\mathcal L(q,\dot q)=K(q,\dot q)-P(q)$,

$$\tau_i=\frac{d}{dt}\frac{\partial\mathcal L}{\partial\dot q_i}-\frac{\partial\mathcal L}{\partial q_i},\qquad i=1,\dots,n.$$

Gravity enters through $P$, so $\tau$ is everything else: the motor torques, and, if they are modeled, friction and contact torques. Putting gravity both in $P$ and in $\tau$ counts it twice. The equation assumes rigid links and ideal joints whose constraint forces do no work.

### The arm and its assumed parameters

Same conventions as before: $x$ horizontal, $y$ up, $q_1$ from the $x$ axis to link 1, $q_2$ of link 2 relative to link 1, counterclockwise positive, gravity $g_0=9.81\ \text{m/s}^2$ along $-y$. Each link is modeled as a uniform slender rod, so its center of mass is at mid-length and its moment of inertia about the center of mass, for rotation in the plane, is $I=mL^2/12$. All values are assumptions chosen for the example:

| Link | Length | Mass | Center of mass from its joint | Inertia about center of mass |
|---|---|---|---|---|
| 1 | $L_1=0.5$ m | $m_1=3.0$ kg | $l_{c1}=0.25$ m | $I_1=0.0625\ \text{kg m}^2$ |
| 2 | $L_2=0.4$ m | $m_2=2.0$ kg | $l_{c2}=0.20$ m | $I_2=0.02667\ \text{kg m}^2$ |

### Kinetic energy

A rigid body moving in the plane has kinetic energy $\tfrac12m\lVert v_c\rVert^2+\tfrac12I\omega^2$: translation of the center of mass plus rotation about it. Link 1 rotates about the fixed joint: $\lVert v_{c1}\rVert^2=l_{c1}^2\dot q_1^2$ and $\omega_1=\dot q_1$. For link 2 the center of mass is at

$$p_{c2}=\begin{pmatrix}L_1c_1+l_{c2}c_{12}\\L_1s_1+l_{c2}s_{12}\end{pmatrix},\qquad \dot p_{c2}=\begin{pmatrix}-L_1s_1\dot q_1-l_{c2}s_{12}(\dot q_1+\dot q_2)\\L_1c_1\dot q_1+l_{c2}c_{12}(\dot q_1+\dot q_2)\end{pmatrix},$$

and squaring, with $s_1s_{12}+c_1c_{12}=\cos q_2$,

$$\lVert v_{c2}\rVert^2=L_1^2\dot q_1^2+l_{c2}^2(\dot q_1+\dot q_2)^2+2L_1l_{c2}c_2\,\dot q_1(\dot q_1+\dot q_2).$$

The angular velocity of link 2 is absolute: $\omega_2=\dot q_1+\dot q_2$, not $\dot q_2$. Collecting terms gives $K=\tfrac12\dot q^TM(q)\dot q$ with

$$\begin{aligned}M_{11}&=m_1l_{c1}^2+I_1+m_2\big(L_1^2+l_{c2}^2+2L_1l_{c2}c_2\big)+I_2,\\M_{12}&=M_{21}=m_2\big(l_{c2}^2+L_1l_{c2}c_2\big)+I_2,\\M_{22}&=m_2l_{c2}^2+I_2.\end{aligned}$$

With the values above, $M_{11}=0.8567+0.4c_2$, $M_{12}=0.1067+0.2c_2$ and $M_{22}=0.1067$, all in $\text{kg m}^2$. Only $q_2$ appears: rotating the whole arm about joint 1 does not change its inertia, while folding the elbow does. Asada's notes for MIT 2.12 read $M_{11}$ through the parallel-axis theorem: the inertia seen by joint 1 is largest with the arm extended ($q_2=0$) and smallest with it folded ($q_2=\pi$).

### Potential energy

$$P(q)=m_1g_0\,l_{c1}s_1+m_2g_0\big(L_1s_1+l_{c2}s_{12}\big).$$

### The derivation, by hand

Write $\beta=m_2L_1l_{c2}$, so that $\partial M_{11}/\partial q_2=-2\beta s_2$, $\partial M_{12}/\partial q_2=-\beta s_2$ and $M_{22}$ is constant.

**Joint 1.** $\partial\mathcal L/\partial\dot q_1=M_{11}\dot q_1+M_{12}\dot q_2$. Its time derivative brings in $\dot M_{11}=-2\beta s_2\dot q_2$ and $\dot M_{12}=-\beta s_2\dot q_2$:

$$\frac{d}{dt}\frac{\partial\mathcal L}{\partial\dot q_1}=M_{11}\ddot q_1+M_{12}\ddot q_2-2\beta s_2\dot q_1\dot q_2-\beta s_2\dot q_2^2.$$

$K$ does not depend on $q_1$, so $\partial\mathcal L/\partial q_1=-\partial P/\partial q_1$.

**Joint 2.** $\partial\mathcal L/\partial\dot q_2=M_{12}\dot q_1+M_{22}\dot q_2$, whose time derivative is $M_{12}\ddot q_1+M_{22}\ddot q_2-\beta s_2\dot q_1\dot q_2$. Now $K$ does depend on $q_2$:

$$\frac{\partial K}{\partial q_2}=\tfrac12\dot q^T\frac{\partial M}{\partial q_2}\dot q=-\beta s_2\big(\dot q_1^2+\dot q_1\dot q_2\big).$$

Subtracting, the $\dot q_1\dot q_2$ terms of joint 2 cancel, and the result is

$$\begin{aligned}\tau_1&=M_{11}\ddot q_1+M_{12}\ddot q_2-\beta s_2\big(2\dot q_1\dot q_2+\dot q_2^2\big)+(m_1l_{c1}+m_2L_1)\,g_0c_1+m_2l_{c2}\,g_0c_{12},\\ \tau_2&=M_{12}\ddot q_1+M_{22}\ddot q_2+\beta s_2\,\dot q_1^2+m_2l_{c2}\,g_0c_{12}.\end{aligned}$$

Here $\beta=0.2\ \text{kg m}^2$, and the gravity coefficients are $1.75\cdot9.81=17.17$ N m and $0.4\cdot9.81=3.924$ N m. The equations are linear in $\ddot q$, quadratic in $\dot q$ and trigonometric in $q$, which *Modern Robotics* notes holds for serial chains of revolute joints in general.

**A check against a published case.** Setting $I_1=I_2=0$, $l_{c1}=L_1$ and $l_{c2}=L_2$ turns the links into point masses at their ends. A SymPy `simplify` of the difference between these equations, so reduced, and Equation (8.9) of *Modern Robotics* returns $0$ for both joints. With $L_1=L_2=m_1=m_2=1$, the reduced $M$ is $\begin{pmatrix}3&1\\1&1\end{pmatrix}$ at $q_2=90^\circ$ and $\begin{pmatrix}1.27&0.13\\0.13&1\end{pmatrix}$ at $q_2=150^\circ$, the matrices printed in the book's Figure 8.3.

## Worked Examples

### Example 1: one state, term by term

At $q=(30^\circ,45^\circ)$, $\dot q=(1.0,\ -0.5)$ rad/s and $\ddot q=(2.0,\ 1.0)\ \text{rad/s}^2$, with $c_2=s_2=0.7071$:

$$M=\begin{pmatrix}1.1395&0.2481\\0.2481&0.1067\end{pmatrix},\qquad M\ddot q=\begin{pmatrix}2.5271\\0.6028\end{pmatrix}\ \text{N m}.$$

The velocity terms, with $\beta s_2=0.14142$: for joint 1, $-0.14142\cdot\big(2(1.0)(-0.5)+0.25\big)=0.1061$ N m; for joint 2, $0.14142\cdot1.0^2=0.1414$ N m. Gravity gives $(15.8831,\ 1.0156)$ N m. The total is

$$\tau=\begin{pmatrix}2.5271+0.1061+15.8831\\0.6028+0.1414+1.0156\end{pmatrix}=\begin{pmatrix}18.5163\\1.7599\end{pmatrix}\ \text{N m}.$$

At this slow speed gravity is most of $\tau_1$. `the-manipulator-equation-inertia-coriolis-gravity` shows how the balance shifts as the motion speeds up.

### Example 2: SymPy does the differentiation

SymPy builds the Lagrangian from positions, not from $M$, so it does not inherit a mistake made while collecting terms:

```python
t = sp.symbols('t'); q1, q2 = sp.Function('q1')(t), sp.Function('q2')(t)
x2 = L1*sp.cos(q1) + lc2*sp.cos(q1 + q2); y2 = L1*sp.sin(q1) + lc2*sp.sin(q1 + q2)
K = (m1*lc1**2*q1.diff(t)**2 + I1*q1.diff(t)**2
     + m2*(x2.diff(t)**2 + y2.diff(t)**2) + I2*(q1.diff(t) + q2.diff(t))**2) / 2
P = m1*g*lc1*sp.sin(q1) + m2*g*y2
L = K - P
tau = [sp.simplify(L.diff(qi.diff(t)).diff(t) - L.diff(qi)) for qi in (q1, q2)]
```

With all parameters kept as symbols, `sp.simplify(tau[i] - hand[i])` returns `0` for both joints, where `hand` holds the two equations above. The hand derivation is correct for every choice of masses, lengths and inertias, not only for the table.

### Example 3: an independent recursive Newton-Euler computation

Newton-Euler uses none of the energy expressions. A forward pass computes, from the base outward, each link's angular velocity and acceleration ($\dot q_1$, then $\dot q_1+\dot q_2$) and the acceleration of each center of mass, with gravity included by giving the base an upward acceleration $g_0$. A backward pass, from the tip inward, computes the force each link needs, $m_ia_{c_i}$, adds the force passed on from the next link, and takes moments about each joint to get $\tau_i$, which includes $I_i\dot\omega_i$. On three states drawn with `numpy.random.default_rng(1)` (angles uniform on $[-\pi,\pi]$, velocities on $[-3,3]$ rad/s, accelerations on $[-5,5]\ \text{rad/s}^2$, drawn in that order for each state):

```text
q (rad)           qdot (rad/s)       qddot (rad/s^2)    tau Lagrange           tau Newton-Euler
(0.074, 2.830)    (-2.135, 2.692)    (-1.882, -0.767)   (12.734756, -3.459386) (12.734756, -3.459386)
(2.059, -0.571)   (0.298, -2.835)    (2.535, 0.381)     (-3.914117, 1.050836)  (-3.914117, 1.050836)
(-1.070, 1.812)   (-1.181, -0.279)   (-3.660, -0.969)   (8.151353, 2.843422)   (8.151353, 2.843422)
```

The largest difference is $1.8\times10^{-15}$ N m, rounding error. At the state of Example 1, Newton-Euler gives $(18.51627,\ 1.75987)$ N m.

### Example 4: finite differences and energy

Two more checks need nothing but numbers.

**Euler-Lagrange by finite differences.** Code $\mathcal L(q,\dot q)$ directly from the center-of-mass velocities, approximate $\partial\mathcal L/\partial\dot q$ and $\partial\mathcal L/\partial q$ by central differences with step $10^{-4}$, and approximate $\frac{d}{dt}$ by a central difference with step $10^{-4}$ s along the path $q(t)$ that passes through the state of Example 1 with the given $\dot q$ and $\ddot q$. The result is $(18.516270,\ 1.759870)$ N m, within $3.4\times10^{-8}$ of the closed form.

**Energy conservation.** With $\tau=0$ and no friction, $E=\tfrac12\dot q^TM\dot q+P$ must stay constant. Solving $M\ddot q=-(\text{velocity terms})-g(q)$ with `scipy.integrate.solve_ivp`, method `DOP853`, `rtol=1e-10`, `atol=1e-12`, from rest at $q=(0,0)$ (arm horizontal, $E=0$) for 5 s, the arm falls and swings irregularly, and $\lvert E-E_0\rvert$, evaluated at 5001 evenly spaced times, stays below $2\times10^{-8}$ J. Energy conservation also exposes a wrong model. Replace $2\dot q_1\dot q_2$ with $\dot q_1\dot q_2$ in $\tau_1$, a factor that is easy to drop by hand, and the same simulation drifts by $18.6$ J. A model that passes the energy test can still be wrong in terms that do no work, which is why the other three checks are run as well.

## Common Misconceptions & Pitfalls

- **"Link 2 rotates at $\dot q_2$."** Its absolute angular velocity is $\dot q_1+\dot q_2$. Using $\dot q_2$ drops $I_2$ from $M_{11}$ and $M_{12}$.
- **"Add $m\,l_c^2$ to the inertia about the joint."** Use the inertia about the center of mass together with $\tfrac12m\lVert v_c\rVert^2$, or the inertia about a fixed axis alone. Mixing the two counts the same mass twice.
- **"$\partial\mathcal L/\partial q_1$ has velocity terms."** $K$ depends only on $q_2$, so for joint 1 only gravity remains. All the velocity terms of $\tau_1$ come from differentiating $M(q)$ in time.
- **"Lagrange and Newton-Euler give different dynamics."** They give the same torques (Example 3, to $10^{-15}$). They differ in how the work is organized and what it costs, not in the answer.
- **"The mass matrix is constant."** $M_{11}$ goes from $1.2567$ at $q_2=0$ to $0.4567\ \text{kg m}^2$ at $q_2=\pi$, a factor of 2.75.
- **"Energy is conserved, so the model is right."** The energy test catches errors that create or destroy energy, as the dropped factor of 2 did, but not every error.

## Summary

For a planar two-link arm with distributed links, the Lagrangian $\tfrac12\dot q^TM(q)\dot q-P(q)$ and the Euler-Lagrange equation give, by hand, $\tau_1=M_{11}\ddot q_1+M_{12}\ddot q_2-\beta s_2(2\dot q_1\dot q_2+\dot q_2^2)+g_1$ and $\tau_2=M_{12}\ddot q_1+M_{22}\ddot q_2+\beta s_2\dot q_1^2+g_2$, with $\beta=m_2L_1l_{c2}$. For the assumed arm, $M_{11}=0.8567+0.4c_2$, $M_{12}=0.1067+0.2c_2$, $M_{22}=0.1067\ \text{kg m}^2$ and $\beta=0.2\ \text{kg m}^2$. SymPy agreed symbolically, a recursive Newton-Euler computation agreed to $1.8\times10^{-15}$, a finite-difference Euler-Lagrange computation agreed to $3.4\times10^{-8}$, and the free motion conserved energy to within $2\times10^{-8}$ J while a model with one dropped factor of 2 drifted by 18.6 J. With point masses the result reduces to Equation (8.9) of *Modern Robotics*.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 8.1 states the Euler-Lagrange equations with external forces, derives the point-mass 2R arm (Equation 8.9) and the general form with the mass matrix; Section 8.1.4 compares the Lagrangian and Newton-Euler routes.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 7: Dynamics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter7/): Newton-Euler and Lagrangian equations of the two-link arm with link inertias, and the physical meaning of each coefficient.
- [SymPy tutorial, Calculus](https://docs.sympy.org/latest/tutorials/intro-tutorial/calculus.html): symbolic derivatives with `diff` and simplification, the operations used in Example 2.
- [SymPy, Kane's Method and Lagrange's Method (API)](https://docs.sympy.org/latest/modules/physics/mechanics/api/kane_lagrange.html): the `LagrangesMethod` class, which generates equations of motion from a Lagrangian and generalized coordinates, an alternative to differentiating in code as in Example 2.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): the initial value solver and the `DOP853` method used for the energy check.
