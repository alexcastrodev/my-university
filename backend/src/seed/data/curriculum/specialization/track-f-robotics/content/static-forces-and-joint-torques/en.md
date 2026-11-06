---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State $\tau=J^T(q)F$ together with its hypotheses: static equilibrium, frictionless joints, rigid links, gravity handled separately, and a Jacobian and a force that refer to the same point and frame.
- Derive the relation from the principle of virtual work, then check it numerically with finite joint displacements and with moment arms.
- Add the gravity torques to the contact torques, and recognize gravity itself as $J^T$ applied to the weights of the links.
- Explain what happens at and near a singularity: forces carried by the structure, torques that no tip force can balance, and torque errors that grow into large force errors.

## Context & Motivation

`velocity-kinematics-and-the-jacobian` builds the Jacobian, the matrix that turns joint velocities into end-effector velocity, and `singularities-and-manipulability` studies the configurations where it loses rank. This lesson uses the same matrix, transposed, in the opposite direction: from a force at the end effector to the joint torques that hold it.

The question comes up whenever a robot touches something. A polishing arm presses a pad against a surface with a set force. An assembly robot pushes a peg into a hole. A robot without a force sensor can estimate the contact force from its joint torques. Each case needs the map between joint torques and end-effector force, and each case needs to know when that map stops being trustworthy.

## Core Theory

### The arm and its conventions

The running example is a planar two-link arm with revolute joints. The base frame has $x$ horizontal and $y$ vertical, upward. The angle $q_1$ is measured from the $x$ axis to link 1, counterclockwise positive; $q_2$ is the angle of link 2 relative to link 1. Vectors are columns. The link lengths are assumed values: $L_1=0.5$ m and $L_2=0.4$ m. With $s_1=\sin q_1$, $c_{12}=\cos(q_1+q_2)$ and so on, the tip position and the Jacobian of the tip's linear velocity are

$$p(q)=\begin{pmatrix}L_1c_1+L_2c_{12}\\L_1s_1+L_2s_{12}\end{pmatrix},\qquad J(q)=\frac{\partial p}{\partial q}=\begin{pmatrix}-L_1s_1-L_2s_{12}&-L_2s_{12}\\L_1c_1+L_2c_{12}&L_2c_{12}\end{pmatrix}.$$

### Virtual work

Let the arm be at rest at $q$. Joint torques $\tau$ act on the links, and the end effector presses on the environment with a force $F$; by Newton's third law the environment presses back with $-F$. A **virtual displacement** $\delta q$ is an infinitesimal change of configuration that respects the joints; it moves the tip by $\delta p=J(q)\,\delta q$. The principle of virtual work says that a frictionless mechanism is in equilibrium exactly when the total virtual work of the applied forces vanishes for every admissible displacement. The constraint forces inside the joints do no work, because a frictionless joint only resists motion that the joint does not allow. So

$$\delta W=\tau^T\delta q-F^T\delta p=\big(\tau-J^T F\big)^T\delta q=0\quad\text{for all }\delta q\quad\Longrightarrow\quad\tau=J^T(q)\,F.$$

The last step needs the components of $\delta q$ to be independent, which they are for an open chain because the joint angles are generalized coordinates. This is the proof given as Theorem 6.1 in Asada's MIT 2.12 notes. Lynch and Park reach the same equation in *Modern Robotics* by a power balance, $\tau^T\dot q=F^T V$, taken in the limit of zero velocity.

The hypotheses are part of the result:

1. **Static equilibrium.** No acceleration and, in the limit, no velocity. When the arm moves, the inertial and velocity terms of `lagrangian-dynamics-of-an-open-chain-robot` are added.
2. **Frictionless joints.** With static friction a joint can hold any torque up to its friction limit without moving, so the torque that holds a given $F$ is no longer unique.
3. **Rigid links.** A flexing link adds coordinates that $q$ does not describe.
4. **Gravity separate.** $J^TF$ is only the part that balances the contact force. Asada calls it the *equivalent joint torques* and says it does not account for gravity and friction.
5. **Same point, same frame.** $J$ must give the velocity of the point where $F$ acts, in the frame where $F$ is written. In this lesson $F$ is the force the robot applies to the environment. Some texts use the force the environment applies to the robot, which flips the sign.

### Moments and the wrench

If the end effector also applies a moment $m_z$ about the axis normal to the plane, the angular velocity of link 2, $\dot q_1+\dot q_2$, enters the power balance with the row $J_\omega=(1,\ 1)$, so $\tau=J_v^Tf+J_\omega^Tm_z$. In space, force and moment are stacked into a six-component wrench, and *Modern Robotics* writes $\tau=J_b^T(\theta)\,\mathcal F_b$ with the body Jacobian and the wrench in the end-effector frame, or $\tau=J_s^T(\theta)\,\mathcal F_s$ with both in the space frame. The book orders the twist as angular then linear velocity, and the wrench as moment then force, so the rows match. A Jacobian whose rows are derivatives of Euler angles (an analytic Jacobian) pairs with whatever quantity makes power with Euler-angle rates. That quantity is not the physical moment, so physical moments need the geometric Jacobian.

### Gravity is the same law

Each link's weight is a force at its center of mass. Applying the virtual-work argument to the weights gives the torques that hold the arm still against gravity:

$$g(q)=-\sum_i J_{c_i}^T(q)\begin{pmatrix}0\\-m_ig_0\end{pmatrix}=\frac{\partial P}{\partial q},$$

where $J_{c_i}$ is the Jacobian of the center of mass of link $i$, $g_0$ is the gravitational acceleration and $P$ is the potential energy. The total holding torque is $\tau=g(q)+J^T(q)F$. The masses assumed for this arm are $m_1=3.0$ kg and $m_2=2.0$ kg, with centers of mass at $l_{c1}=0.25$ m and $l_{c2}=0.20$ m from their joints, and $g_0=9.81\ \text{m/s}^2$. Then

$$g(q)=\begin{pmatrix}(m_1l_{c1}+m_2L_1)\,g_0\,c_1+m_2l_{c2}\,g_0\,c_{12}\\ m_2l_{c2}\,g_0\,c_{12}\end{pmatrix}.$$

### Duality and singularities

$\tau=J^TF$ is defined for every $F$: the map from force to torque never fails. The reverse question, which tip force a given $\tau$ produces or measures, is where trouble lives. For a square nonsingular $J$, $F=J^{-T}\tau$. If $J=U\Sigma V^T$ is a singular value decomposition, then $J^{-T}=U\Sigma^{-1}V^T$: the directions that are slow for velocity (small $\sigma_i$) are the directions where a given torque buys a large force. Asada calls this the duality of differential kinematics and statics, and states the subspace version: the null space of $J^T$ is the set of tip forces that need no joint torque, because the structure carries them, and these are exactly the directions in which the tip cannot move. The range of $J^T$ is the set of torques that some tip force can balance; a torque with a component outside it cannot be held statically, and the arm moves.

For a redundant arm ($n$ joints, $n$ larger than the task dimension) $J^T$ is tall, so not every torque is in its range. *Modern Robotics* notes that such an arm is not immobilized even with its end effector fixed in place, and that dynamics is then needed to know what happens.

## Worked Examples

### Example 1: pushing on a wall

At $q=(30^\circ,60^\circ)$ link 2 points straight up, the elbow is at $(0.433,\ 0.25)$ m and the tip at $(0.433,\ 0.65)$ m. The arm pushes a wall on its right with $F=(10,\ 0)$ N, and gravity is ignored for now.

$$J=\begin{pmatrix}-0.65&-0.4\\0.433&0\end{pmatrix},\qquad \tau=J^TF=\begin{pmatrix}-6.5\\-4.0\end{pmatrix}\ \text{N m}.$$

Moment arms confirm it. A horizontal force at height $0.65$ m above joint 1 produces a moment $-0.65\cdot10$ about joint 1, and the tip is $0.4$ m above joint 2, giving $-0.4\cdot10$. Both are clockwise, so both torques are negative: rotating a vertical link 2 clockwise moves its tip to the right, into the wall.

Now check virtual work with finite displacements. Take a direction $u$ in joint space ($u=(0.6894,\ -0.7244)$, the vector `numpy.random.default_rng(0).standard_normal(2)` normalized to length 1), move $q$ to $q+\varepsilon u$ with the exact forward kinematics, and compare the work $\tau^T(\varepsilon u)$ with $F^T\big(p(q+\varepsilon u)-p(q)\big)$:

```text
epsilon   joint work      tip work        relative difference
1e-1      -1.5837e-01     -1.6852e-01     -6.4e-02
1e-2      -1.5837e-02     -1.5940e-02     -6.5e-03
1e-3      -1.5837e-03     -1.5847e-03     -6.5e-04
1e-4      -1.5837e-04     -1.5838e-04     -6.5e-05
```

The difference shrinks in proportion to $\varepsilon$, which is what "equal to first order" means: the finite displacement adds a second-order term from the curvature of $p(q)$, and the virtual displacement leaves it out. A central difference of $F^Tp(q)$ in each joint direction, with step $10^{-6}$, gives $(-6.5,\ -4.0)$ to the printed precision, the same vector as $J^TF$.

### Example 2: adding gravity

At the same configuration, $c_{12}=\cos 90^\circ=0$, so link 2's weight passes through joint 2 and $g_2=0$. Joint 1 carries both links:

$$g(q)=\begin{pmatrix}(3.0\cdot0.25+2.0\cdot0.5)\cdot9.81\cdot\cos30^\circ\\0\end{pmatrix}=\begin{pmatrix}14.87\\0\end{pmatrix}\ \text{N m},\qquad \tau=g(q)+J^TF=\begin{pmatrix}8.37\\-4.00\end{pmatrix}\ \text{N m}.$$

Two independent computations give the same $g(q)$: the sum $-\sum_iJ_{c_i}^T(0,-m_ig_0)$ and a central-difference gradient of $P(q)=m_1g_0l_{c1}s_1+m_2g_0(L_1s_1+l_{c2}s_{12})$ both return $(14.8675,\ 0)$. Gravity and the wall partly cancel at joint 1. A motor sized from the contact force alone, or from gravity alone, would be sized wrong.

### Example 3: walking into the stretched singularity

Fix $q_1=0$ and bring the elbow toward $q_2=0$, where the arm lies straight along $x$ and $J=\begin{pmatrix}0&0\\0.9&0.4\end{pmatrix}$ has rank 1. The table gives the singular values of $J$, the torques for a 10 N push along $x$ (along the arm) and along $y$ (across it), the largest $F_x$ allowed by a torque limit $\lvert\tau_i\rvert\le20$ N m, and the worst-case force error caused by a torque uncertainty of $\pm0.5$ N m on each joint (from static friction or from a torque sensor), computed as the largest $\lVert J^{-T}\delta\tau\rVert$ over the corners of that box:

```text
q2      sigma_1   sigma_2   tau for Fx=10 N   tau for Fy=10 N   max Fx (N)   force error (N)
0 deg   0.9849    0         (0, 0)            (9.0, 4.0)        unbounded    unbounded
1 deg   0.9848    0.0035    (-0.07, -0.07)    (9.0, 4.0)        2865         186
5 deg   0.9840    0.0177    (-0.35, -0.35)    (8.98, 3.98)      574          37
30 deg  0.9515    0.1051    (-2.0, -2.0)      (8.46, 3.46)      100          6.3
90 deg  0.6986    0.2863    (-4.0, -4.0)      (5.0, 0.0)        50           2.4
```

Four things happen as $\sigma_2\to0$.

**The structure takes the load.** At $q_2=0$ a push along the arm needs zero torque: $(10,0)$ is in the null space of $J^T$. The links work in compression, like a column, and the joints feel nothing about their axes.

**Some torques cannot be balanced.** The range of $J^T$ at $q_2=0$ is the line spanned by $(0.9,\ 0.4)$. The torque $(1,\ 0)$ is not on it; the least-squares tip force leaves a torque residual of $(-0.16,\ 0.37)$ N m that nothing balances, so the arm cannot stay put.

**Force is cheap along the lost direction.** At $q_2=1^\circ$ a 20 N m limit allows a 2865 N push along the arm, 57 times more than at $q_2=90^\circ$. This is the mechanical advantage of a nearly straight linkage. The required torque also changes sign across the singularity: at $q_2=-1^\circ$ the same push needs $(+0.07,\ +0.07)$ N m, so a controller holding a large axial force near $q_2=0$ has to know on which side the elbow is.

**Force estimates break.** Reading the contact force from joint torques uses $J^{-T}$, whose largest gain is $1/\sigma_2$: 3.5 at $q_2=90^\circ$, 282 at $q_2=1^\circ$. A torque uncertainty of $\pm0.5$ N m, harmless at $90^\circ$ (2.4 N of force error), becomes 186 N at $1^\circ$. A force estimated from joint torques is therefore least reliable along the directions where the arm is strongest.

## Common Misconceptions & Pitfalls

- **"$J^TF$ is the motor torque."** It is the part that balances the contact force. Gravity, friction and, during motion, the dynamic terms are added; in Example 2 gravity was larger than the contact term at joint 1.
- **"Near a singularity the arm is weak."** It is weak across the lost direction for motion and very strong along it for force: 2865 N against 50 N in Example 3. What fails is the ability to choose the force freely and to measure it.
- **"$F=J^{-T}\tau$ always works."** It needs $J$ square and nonsingular. At a singularity some torques have no balancing force, and for a redundant arm $J^T$ is not square.
- **"The sign takes care of itself."** $F$ is the force on the environment here. Using the force on the robot without changing the sign gives torques that push the wrong way.
- **"Any Jacobian will do."** $J$ must belong to the point where the force acts and be written in the frame of $F$. An analytic Jacobian built from Euler-angle rates does not map physical moments.
- **"Static means the formula is exact."** With static friction the holding torque lies in a band $\lvert\tau-J^TF\rvert\le\tau_f$ per joint, and Example 3 shows how far that band reaches in force space near a singularity.

## Summary

At static equilibrium with frictionless joints and rigid links, the joint torques that balance an end-effector force are $\tau=J^T(q)F$, where $J$ is the Jacobian of the contact point in the frame of $F$ and $F$ is the force the robot applies. Virtual work gives the result in one line, and finite displacements confirm it to first order: the relative difference fell from $6.4\times10^{-2}$ to $6.5\times10^{-5}$ as $\varepsilon$ went from $10^{-1}$ to $10^{-4}$. Gravity is the same law applied to the weights, $g(q)=\partial P/\partial q$, and is added to the contact torques. The map from force to torque is always defined; the map back, $J^{-T}$, has gain $1/\sigma_{\min}$. At the stretched singularity a force along the arm needs no torque, some torques have no balancing force, a 20 N m limit buys thousands of newtons along the arm, and a $\pm0.5$ N m torque error turns into a 186 N force error one degree away.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 5.2 derives $\tau=J^T\mathcal F$ from a power balance for body and space wrenches, and Section 5.3 treats singularities and the wrenches a robot can resist without moving.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 6: Statics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter6/): free-body diagrams of the links, the virtual-work proof of the equivalent joint torques, and the duality of differential kinematics and statics.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): the Jacobian of the planar two-link arm used in the statics chapter.
- [NumPy, numpy.linalg.svd](https://numpy.org/doc/stable/reference/generated/numpy.linalg.svd.html): the singular value decomposition used for the singular values and for $J^{-T}$.
