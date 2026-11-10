---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Write the manipulator equation $M(q)\ddot q+C(q,\dot q)\dot q+g(q)=\tau$ and say which parts are unique ($M$, $g$ and the vector $C\dot q$) and which part is a choice (the matrix $C$).
- Build $C$ from Christoffel symbols, and show by a run that $\dot M-2C$ is skew-symmetric for this choice and not for other valid choices.
- Separate skew-symmetry from the energy identity $\dot q^T(\dot M-2C)\dot q=0$, which every valid $C$ satisfies.
- State the physical effect of the inertia, centrifugal, Coriolis and gravity terms by simulating them one at a time, and predict how each scales with speed.

## Context & Motivation

`lagrangian-dynamics-of-an-open-chain-robot` produced the two joint torques of a planar arm as long expressions. Controllers, simulators and stability proofs need them in one standard shape, where every term has a name and a matrix. That shape is the manipulator equation. It looks unique, but one of its matrices is not, and a property used in control proofs holds only for a particular choice of it. The second half of the lesson turns each term off and on in simulation, because "Coriolis term" means little until you see what the arm does without it.

## Core Theory

### The standard form

$$M(q)\,\ddot q+C(q,\dot q)\,\dot q+g(q)=\tau.$$

$M(q)$ is the symmetric positive definite mass matrix, so $K=\tfrac12\dot q^TM\dot q$. $g(q)=\partial P/\partial q$ collects gravity. $C(q,\dot q)\dot q$ collects everything quadratic in velocity. Conventions differ between sources. *Modern Robotics* writes it first with a velocity vector, $M\ddot\theta+c(\theta,\dot\theta)+g(\theta)$, and then, as it notes is also common, with a Coriolis matrix: exactly the form above. Tedrake's *Underactuated Robotics* notes write $M\ddot q+C\dot q=\tau_g(q)+Bu$, with gravity on the right, so $\tau_g=-g$, and with a matrix $B$ that maps control inputs to generalized forces. Check the sign of the gravity term before copying formulas between the two.

For the two-link arm, with $\beta=m_2L_1l_{c2}$ and $h(q)=-\beta\sin q_2$, the velocity terms of the previous lesson are

$$C(q,\dot q)\,\dot q=\begin{pmatrix}h\,(2\dot q_1\dot q_2+\dot q_2^2)\\-h\,\dot q_1^2\end{pmatrix}.$$

*Modern Robotics* calls terms in $\dot q_i^2$ **centripetal** and terms in $\dot q_i\dot q_j$ with $i\ne j$ **Coriolis**; Asada's notes speak of the same $\dot q_i^2$ terms as **centrifugal** effects, the name used below. So joint 1 feels a Coriolis term $2h\dot q_1\dot q_2$ and a centrifugal term $h\dot q_2^2$ from joint 2, and joint 2 feels a centrifugal term $-h\dot q_1^2$ from joint 1.

### The matrix C is a choice

Only the vector $C\dot q$ is fixed by the dynamics. Any matrix that produces it is valid. Two choices for the two-link arm:

$$C=\begin{pmatrix}h\dot q_2&h(\dot q_1+\dot q_2)\\-h\dot q_1&0\end{pmatrix},\qquad C'=\begin{pmatrix}2h\dot q_2&h\dot q_2\\-h\dot q_1&0\end{pmatrix}.$$

Multiplying either by $\dot q$ gives the vector above. A third one appears in print: Tedrake's notes give a $C$ for the simple double pendulum and remark that the choice was not unique.

The first one is the **Christoffel choice**. With the Christoffel symbols of the first kind

$$\Gamma_{ijk}(q)=\tfrac12\Big(\frac{\partial M_{ij}}{\partial q_k}+\frac{\partial M_{ik}}{\partial q_j}-\frac{\partial M_{jk}}{\partial q_i}\Big),\qquad C_{ij}=\sum_k\Gamma_{ijk}\,\dot q_k,$$

which is Equation (8.19) of *Modern Robotics*. For the two-link arm only $M_{11}$ and $M_{12}$ depend on $q$, through $q_2$, and SymPy applied to the assumed arm ($\beta=0.2\ \text{kg m}^2$) returns $C_{11}=-0.2\dot q_2s_2$, $C_{12}=-0.2(\dot q_1+\dot q_2)s_2$, $C_{21}=0.2\dot q_1s_2$, $C_{22}=0$, the matrix $C$ above.

### Skew-symmetry, and the weaker identity

**Proposition 8.1** of *Modern Robotics*: with $C$ defined by (8.19), $\dot M-2C$ is skew-symmetric. For the two-link arm, $\dot M=\begin{pmatrix}2h\dot q_2&h\dot q_2\\h\dot q_2&0\end{pmatrix}$, and

$$\dot M-2C=\begin{pmatrix}0&-h(2\dot q_1+\dot q_2)\\h(2\dot q_1+\dot q_2)&0\end{pmatrix},\qquad \dot M-2C'=\begin{pmatrix}-2h\dot q_2&-h\dot q_2\\h(2\dot q_1+\dot q_2)&0\end{pmatrix}.$$

The first is skew-symmetric; the second has a nonzero diagonal and is not. Tedrake's notes likewise state the property only for an appropriate choice of $C$.

A weaker statement holds for every valid $C$. Differentiate the kinetic energy and substitute the dynamics:

$$\frac{d}{dt}\Big(\tfrac12\dot q^TM\dot q\Big)=\dot q^TM\ddot q+\tfrac12\dot q^T\dot M\dot q=\dot q^T(\tau-g)+\tfrac12\dot q^T\big(\dot M-2C\big)\dot q.$$

The rate of change of kinetic energy must equal the power of the torques that are not gravity, $\dot q^T(\tau-g)$, so $\dot q^T(\dot M-2C)\dot q=0$ for every $C$ that gives the right $C\dot q$. Skew-symmetry is the stronger claim $x^T(\dot M-2C)x=0$ for every vector $x$. *Modern Robotics* uses the property in Section 11.4.2.2, to show that PD control with gravity compensation drives an arm to rest at its setpoint.

## Worked Examples

### Example 1: two valid matrices at one state

At $q=(30^\circ,45^\circ)$ and $\dot q=(1.0,\ -0.5)$ rad/s, $h=-0.14142$. Computing $\dot M$ by a central difference of $M(q)$ along $\dot q$ (step $10^{-6}$ s), independently of the formula:

```text
C        = [[ 0.0707, -0.0707], [ 0.1414, 0.0000]]
C'       = [[ 0.1414,  0.0707], [ 0.1414, 0.0000]]
Mdot     = [[ 0.1414,  0.0707], [ 0.0707, 0.0000]]
Mdot-2C  = [[ 0.0000,  0.2121], [-0.2121, 0.0000]]
Mdot-2C' = [[-0.1414, -0.0707], [-0.2121, 0.0000]]
```

Both give $C\dot q=(0.1061,\ 0.1414)$ N m, the velocity terms of Example 1 in the previous lesson.

### Example 2: the property by a run

Draw states with `numpy.random.default_rng(7)`, $q$ uniform on $[-\pi,\pi]^2$ and $\dot q$ uniform on $[-2,2]^2$ rad/s, plus a random vector $x$ from the same generator's `standard_normal(2)`, in the order $q$, $\dot q$, $x$ for each state. Again $\dot M$ comes from a central difference:

```text
state   max|S+S^T|, C   max|S+S^T|, C'   qdot'S qdot, C   qdot'S qdot, C'   x'S x, C    x'S x, C'
1       2.4e-10         0.529            6.8e-11          6.8e-11           5.4e-11     -0.174
2       1.2e-10         0.428            8.4e-11          8.4e-11           1.8e-11     -0.086
3       6.5e-11         0.058            -7.9e-14         -7.9e-14          4.5e-11     -0.051
```

Here $S=\dot M-2C$ for each choice, and the residuals near $10^{-10}$ are the finite-difference error in $\dot M$. The Christoffel $C$ passes both tests. $C'$ passes the energy identity along $\dot q$ and fails skew-symmetry for a general $x$.

Tedrake's double-pendulum matrix, taken as printed, with point masses $m_1=m_2=1$ and lengths $l_1=l_2=1$ (his angles are measured from the downward vertical, which changes gravity but not $M$ or $C$), at $q=(0.3,\ 0.8)$ rad and $\dot q=(1.0,\ -0.5)$ rad/s, gives

$$\dot M-2C=\begin{pmatrix}0.7174&2.5107\\-0.7174&0.7174\end{pmatrix},\qquad \dot q^T(\dot M-2C)\dot q=3.7\times10^{-11}.$$

Its $C\dot q=(0.538,\ 0.717)$ matches the Christoffel form of the same model, so the matrix is valid, satisfies the energy identity, and is not skew-symmetric.

### Example 3: one term at a time

All runs use the assumed arm of the previous lesson, $g_0=0$ (motion in a horizontal plane) unless stated, and `scipy.integrate.solve_ivp` with `DOP853`, `rtol=1e-10`, `atol=1e-12`.

**Inertia: pushing one joint moves the other.** At rest at $q=(0,\ 90^\circ)$, apply $\tau=(2,\ 0)$ N m. Then $M=\begin{pmatrix}0.8567&0.1067\\0.1067&0.1067\end{pmatrix}$ and $\ddot q(0)=M^{-1}\tau=(2.667,\ -2.667)\ \text{rad/s}^2$: joint 2 accelerates backward with no torque of its own, as link 1's acceleration drags the base of link 2 sideways. After 0.2 s, $q_2=86.79^\circ$. With the off-diagonal entries of $M$ set to zero and everything else kept, $q_2=89.92^\circ$.

**Centrifugal: spinning joint 1 flings the elbow open.** Drive joint 1 at a constant $\dot q_1=3$ rad/s and leave joint 2 free ($\tau_2=0$), starting at $q_2=90^\circ$ at rest. With $\ddot q_1=0$, joint 2 obeys $M_{22}\ddot q_2=h\dot q_1^2$, negative for $q_2$ in $(0,\pi)$. The elbow swings open, passes the straight position $q_2=0$ at $t=0.451$ s, and swings to $-90^\circ$ on the other side, like a pendulum whose "gravity" is the centrifugal field. With the velocity terms removed, $q_2$ stays at $90^\circ$. Holding the elbow at $90^\circ$ instead takes $\tau_2=\beta\sin q_2\,\dot q_1^2=0.2\cdot1\cdot9=1.8$ N m.

**Coriolis: folding the elbow speeds up the shoulder.** Drive joint 2 from $30^\circ$ to $150^\circ$ at $\dot q_2=2$ rad/s (1.047 s) and leave joint 1 free ($\tau_1=0$) with $\dot q_1(0)=1$ rad/s. As the elbow folds, $M_{11}$ falls from 1.203 to 0.510 $\text{kg m}^2$. Since $M$ does not depend on $q_1$ and $\tau_1=0$, the momentum $p_1=(M\dot q)_1$, the angular momentum about joint 1, must be conserved:

```text
velocity terms in tau_1     qdot_1 at end (rad/s)   p_1 start   p_1 end
both (full model)           3.716                   1.7628      1.7628
Coriolis 2h qd1 qd2 only    2.358                   1.7628      1.0700
centrifugal h qd2^2 only    1.858                   1.7628      0.8148
none                        1.000                   1.7628      0.3772
```

Only the full model conserves $p_1$. This is the effect *Modern Robotics* compares to a spinning skater who pulls in her arms. Neither part alone conserves $p_1$: the Coriolis part alone gives about half of the speed-up and the centrifugal part alone about a third, and the two do not simply add, because each one changes $\dot q_1$ and with it the other.

**Gravity: what has to be held.** Now $g_0=9.81\ \text{m/s}^2$, at rest with the arm horizontal, $q=(0,0)$. With $\tau=0$ the arm starts with $\ddot q=(-26.16,\ 38.42)\ \text{rad/s}^2$ and after 0.2 s is at $(-27.99^\circ,\ 35.31^\circ)$. With $\tau=g(q)$, which is $(21.09,\ 3.92)$ N m at this pose, the simulated arm stays at $(0,0)$ for 2 s with zero velocity.

### Example 4: how the terms scale with speed

Move from $(-60^\circ,30^\circ)$ to $(60^\circ,120^\circ)$ along $q(t)=q_a+(q_b-q_a)\tfrac12\big(1-\cos(\pi t/T)\big)$, with gravity, and evaluate each term along the path (2001 samples). Peak magnitudes in N m:

```text
duration T    |M qdd| j1, j2    |C qd| j1, j2    |g| j1, j2      |tau| j1, j2
1.0 s         14.60,  3.72      4.35,  2.11      19.18,  3.92    26.59,  7.21
0.5 s         58.42, 14.88      17.39,  8.43     19.18,  3.92    70.40, 18.28
```

Halving the duration doubles every velocity and quadruples every acceleration, so the inertia and velocity terms grow by exactly 4 while gravity, which depends only on $q$, does not change. In this motion gravity is the largest term at $T=1$ s and inertia is the largest at $T=0.5$ s, and the velocity terms grow with the square of the speed.

## Common Misconceptions & Pitfalls

- **"$C$ is a unique matrix."** Only $C\dot q$ is unique. Example 1 had two valid matrices, and Tedrake's notes print a third.
- **"$\dot M-2C$ is always skew-symmetric."** Only for the Christoffel choice (or another choice built to have the property). $C'$ and Tedrake's matrix fail in Example 2.
- **"$\dot q^T(\dot M-2C)\dot q=0$ proves skew-symmetry."** It holds for every valid $C$, because it is energy balance.
- **"Coriolis and centrifugal effects are fictitious, so they cost nothing."** In joint coordinates they are real torque demands: 1.8 N m to hold the elbow in Example 3.
- **"The off-diagonal of $M$ is small enough to ignore."** A torque on joint 1 alone accelerated joint 2 at $-2.67\ \text{rad/s}^2$.
- **"Gravity is the big term."** Only at low speed. In Example 4, halving the duration made the inertia term at joint 1 three times the gravity term.
- **"The signs are standard."** Some sources put gravity on the right as $\tau_g=-g$.

## Summary

The manipulator equation $M\ddot q+C\dot q+g=\tau$ puts the dynamics in a standard form in which $M$, $g$ and the vector $C\dot q$ are fixed but the matrix $C$ is not. The Christoffel choice $C_{ij}=\sum_k\Gamma_{ijk}\dot q_k$ makes $\dot M-2C$ skew-symmetric, as the runs confirmed to the finite-difference error of $10^{-10}$, while an equally valid $C'$ and the $C$ printed in Tedrake's notes are not. Every valid $C$ satisfies $\dot q^T(\dot M-2C)\dot q=0$, which is energy balance. Simulated one at a time, the inertia coupling moved a joint that had no torque, the centrifugal term flung a free elbow open while joint 1 spun, the velocity terms sped the shoulder from 1.0 to 3.7 rad/s as the elbow folded, conserving angular momentum, which neither the Coriolis nor the centrifugal part did alone, and gravity was cancelled exactly by $\tau=g(q)$. Halving a motion's duration multiplied the inertia and velocity terms by 4 and left gravity unchanged.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 8.1 names centripetal and Coriolis terms, defines the Christoffel symbols and the Coriolis matrix (8.19), and proves Proposition 8.1; Section 11.4.2.2 uses it in a stability argument.
- [Underactuated Robotics, Tedrake, Multi-Body Dynamics](https://underactuated.mit.edu/multibody.html): the manipulator equations with gravity on the right-hand side, the double-pendulum example with a non-unique $C$, and the skew-symmetry property for an appropriate $C$.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 7: Dynamics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter7/): a physical interpretation of each term of the two-link equations, including centrifugal and Coriolis effects.
- [SciPy, scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): the integrator used for the one-term-at-a-time simulations.
