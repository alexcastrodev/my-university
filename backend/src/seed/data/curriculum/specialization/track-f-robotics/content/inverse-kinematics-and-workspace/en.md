---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the inverse kinematics problem and its three possible outcomes: no solution, finitely many, infinitely many.
- Solve a planar two-link arm in closed form with `atan2`, produce both elbow solutions, and state the reach condition.
- Run Newton's method on the same arm, recognize quadratic convergence, and predict how it fails when the start or the solution is at a singular configuration.
- Distinguish the reachable workspace from the dexterous workspace, derive both for a planar three-link arm, and estimate them by sampling with a named generator, seed and size.

## Context & Motivation

`the-denavit-hartenberg-convention` turned an arm into a table, and the table into a function: joint angles in, pose out. A task arrives the other way round. A camera reports where a part lies, and the controller needs joint angles that put the gripper there. That is inverse kinematics: given a desired end-effector position or pose $\mathbf x_d$, find $\mathbf q$ with $f(\mathbf q)=\mathbf x_d$.

Forward kinematics always has exactly one answer. The inverse can have none (the target is out of reach), several (the elbow can bend either way), or infinitely many (the arm has more joints than the task needs). Some arms admit a formula. For the rest there is iteration, and the iteration is Newton's method from `newtons-method`, now in several variables, with all of its failure modes in robot form.

## Core Theory

### The planar two-link arm

Take link lengths $L_1$ and $L_2$, joint angles measured counterclockwise, $\theta_1$ from the $x$ axis and $\theta_2$ relative to link 1. The tip is

$$x=L_1c_1+L_2c_{12},\qquad y=L_1s_1+L_2s_{12},$$

with $c_{12}=\cos(\theta_1+\theta_2)$. Squaring and adding removes $\theta_1$, since $x^2+y^2=L_1^2+L_2^2+2L_1L_2c_2$. So

$$c_2=\frac{x^2+y^2-L_1^2-L_2^2}{2L_1L_2},\qquad \theta_2=\operatorname{atan2}\!\big(\pm\sqrt{1-c_2^2},\,c_2\big),$$

$$\theta_1=\operatorname{atan2}(y,x)-\operatorname{atan2}\!\big(L_2s_2,\;L_1+L_2c_2\big).$$

A solution exists exactly when $\lvert c_2\rvert\le1$, that is $\lvert L_1-L_2\rvert\le\sqrt{x^2+y^2}\le L_1+L_2$. Strictly inside that annulus there are two solutions, one for each sign of $\theta_2$. On either boundary circle there is one, with the arm stretched ($\theta_2=0$) or folded ($\theta_2=\pi$). The exception is $L_1=L_2$, where the inner circle shrinks to the base and the folded arm reaches it at every $\theta_1$. `atan2` matters here: it returns the angle in the correct quadrant on $(-\pi,\pi]$, which $\arctan(y/x)$ cannot do.

Names for the two branches vary. Modern Robotics calls them "lefty" and "righty" or "elbow-up" and "elbow-down", and which is which depends on how the arm is viewed. The sign of $\theta_2$ is unambiguous, so this lesson uses it.

### Larger arms

The same pattern, decouple and use plane geometry, gives closed forms for many industrial layouts. For a planar three-link arm with a desired orientation $\phi$, subtract the last link to get the wrist point $\mathbf w=\mathbf p-L_3(\cos\phi,\sin\phi)$ and solve the two-link problem for $\mathbf w$. Six-joint arms whose last three axes meet at a point split the same way into a position problem and an orientation problem. For geometries without such a split, a numerical method is the usual tool.

### Newton's method for inverse kinematics

Let $\mathbf e(\mathbf q)=\mathbf x_d-f(\mathbf q)$ and let $J(\mathbf q)=\partial f/\partial\mathbf q$, the matrix of partial derivatives (built in general in `velocity-kinematics-and-the-jacobian`). For the two-link arm,

$$J=\begin{pmatrix}-L_1s_1-L_2s_{12}&-L_2s_{12}\\ L_1c_1+L_2c_{12}&L_2c_{12}\end{pmatrix},\qquad \det J=L_1L_2\,s_2.$$

Linearizing $f$ at $\mathbf q_k$ and solving for a zero error gives

$$J(\mathbf q_k)\,\Delta\mathbf q=\mathbf e(\mathbf q_k),\qquad \mathbf q_{k+1}=\mathbf q_k+\Delta\mathbf q.$$

This is the scalar iteration of `newtons-method` with the division replaced by a linear solve, as that lesson anticipates. The scalar theory carries over: near a solution where $J$ is invertible, the error is roughly squared at each step. Two hypotheses can fail in a robot-specific way. The determinant vanishes when $s_2=0$, so a start with the arm stretched or folded makes the step undefined. And if the solution itself has $s_2=0$, which happens for every target on the boundary of reach, the root is degenerate, like the double root of `newtons-method`.

Modern Robotics replaces $J^{-1}$ by the pseudoinverse $J^\dagger$ when $J$ is not square or not invertible, and notes that the iteration tends to converge to the solution closest to the initial guess, each solution having its own basin of attraction.

### Reachable and dexterous workspace

Murray, Li and Sastry define the **reachable workspace** as the set of positions the end effector reaches "at some orientation", and the **dextrous workspace** (their spelling) as the set of positions reached "with arbitrary orientation". The second is contained in the first. For a planar arm, "arbitrary orientation" means every heading $\phi$ in the plane.

For a planar three-link arm with $L_1>L_2>L_3$ and $L_1>L_2+L_3$, their Example 3.4 finds that the reachable workspace is the annulus $L_1-L_2-L_3\le r\le L_1+L_2+L_3$, and that the dexterous workspace is smaller by $2L_3$ at each edge. The reason comes straight from the wrist-point reduction: a position $\mathbf p$ works for heading $\phi$ exactly when $\mathbf p-L_3(\cos\phi,\sin\phi)$ lies in the two-link annulus $L_1-L_2\le r\le L_1+L_2$. Reachable means one heading works. Dexterous means the whole circle of radius $L_3$ around $\mathbf p$ fits inside that annulus, which gives $L_1-L_2+L_3\le r\le L_1+L_2-L_3$.

## Worked Examples

All lengths below are assumed for illustration: $L_1=1.0$ m, $L_2=0.6$ m, and in Example 4 a third link $L_3=0.3$ m. Angles are in degrees unless marked.

### Example 1: both elbow solutions in closed form

Target $(1.2,0.5)$ m, at distance $1.3$ m, inside the annulus $[0.4,1.6]$. Then $c_2=(1.44+0.25-1-0.36)/1.2=0.275$, and

```text
branch     theta1      theta2      elbow position        tip error
theta2>0   -3.7231     74.0380     (0.998, -0.065)       0
theta2<0   48.9628    -74.0380     (0.657,  0.754)       2.2e-16
```

Both satisfy the forward kinematics to rounding. They are mirror images across the line from base to target: one elbow sits below that line, the other above it. Which one a robot should use is a task decision (obstacles, joint limits, the current posture), not a kinematic one.

### Example 2: Newton's method, and which solution it finds

From $\mathbf q_0=(0,30)$ the error norms $\lVert\mathbf e_k\rVert$ in metres are

$$3.8\times10^{-1},\ 3.7\times10^{-1},\ 3.9\times10^{-2},\ 1.1\times10^{-3},\ 7.5\times10^{-7},\ 4.6\times10^{-13},\ 1.1\times10^{-16},$$

and the run lands on the $\theta_2>0$ solution. The first step barely helps, then the exponent roughly doubles, the pattern of quadratic convergence. From $\mathbf q_0=(40,-60)$ it takes four steps, $1.4\times10^{-1}$, $1.6\times10^{-2}$, $2.1\times10^{-4}$, $2.6\times10^{-8}$, $7.0\times10^{-16}$, to the $\theta_2<0$ solution. The start chose the branch.

### Example 3: Newton's method near singular configurations

**Start on a singularity.** Starting from the zero posture $(0,0)$, the stretched arm, gives $\det J=0$, and `numpy.linalg.solve` raises `LinAlgError: Singular matrix` on the first step. The zero posture is a natural default guess, which makes this failure common.

**Start next to one.** From $(0,\ 10^{-6}\text{ rad})$ the condition number of $J$ is $4.9\times10^6$ and the first step is $\Delta\mathbf q=(-399999.5,\ 1066666.2)$ radians. The run then converges in five more steps to joint angles of about $-2.29\times10^7$ and $6.11\times10^7$ degrees, which modulo $360$ are exactly the $\theta_2>0$ solution. But the residual stalls at $6.0\times10^{-11}$ m instead of $10^{-16}$: near $1.07\times10^6$ rad, consecutive doubles are $2.3\times10^{-10}$ rad apart, so the angle itself cannot be stored more precisely. A real controller would also reject a command of thousands of turns.

**Solution on a singularity.** The target $1.6(\cos20^\circ,\sin20^\circ)$ is on the outer boundary, with unique solution $(20,0)$, where $\det J=0$. From $(10,30)$:

```text
k    theta1      theta2        |e| (m)     cond(J)    theta2_k/theta2_(k-1)
0    10.00000    30.0000000    6.0e-02     9.1e+00
1    14.29521    14.9948396    1.3e-02     1.9e+01    0.4998
2    17.18841     7.4858672    3.2e-03     3.7e+01    0.4992
5    19.64928     0.9352169    5.0e-05     3.0e+02    0.5000
10   19.98904     0.0292253    4.9e-08     9.5e+03    0.5000
23   20.00000     0.0000030    7.4e-16     9.2e+07    0.4399
```

The joint error halves at every step: linear convergence with ratio $\tfrac12$, the same ratio `newtons-method` found for a double root in one variable. The task error falls by four per step because, at the stretched arm, distance from the boundary grows with the square of $\theta_2$. That also makes the residual misleading: at $k=23$ the tip is within $7.4\times10^{-16}$ m of the target, while $\theta_2$ is still $5\times10^{-8}$ rad from its true value.

**Target out of reach.** For $1.7(\cos20^\circ,\sin20^\circ)$ no solution exists, and the best possible error is $0.1$ m. Over 30 iterations from $(10,30)$, $\lVert\mathbf e\rVert$ jumped between $0.100$ and $3.03$ m, and $\theta_2$ reached $7783$ degrees at $k=13$. Nothing in the iteration announces that the target is infeasible. Checking the reach condition first, when one is available, is cheaper.

One common remedy for the first two failures replaces the step by the damped least-squares step $J^T(JJ^T+\lambda^2I)^{-1}\mathbf e$, which stays finite when $J$ is singular. With $\lambda=0.1$ m it reached the $\theta_2>0$ solution from exactly $(0,0)$ in 11 iterations, to $3.2\times10^{-13}$ m. `singularities-and-manipulability` returns to this trade-off.

### Example 4: reachable and dexterous workspace by sampling

Add $L_3=0.3$ m. The assumptions of Murray, Li and Sastry hold ($1.0>0.6>0.3$ and $1.0>0.9$), so the exact answers are the annuli $0.1\le r\le1.9$ (reachable, area $3.6\pi=11.310$ m²) and $0.7\le r\le1.3$ (dexterous, area $1.2\pi=3.770$ m²).

**Sampling the joints.** With `rng = numpy.random.default_rng(2026)` and `Q = rng.uniform(-pi, pi, (100_000, 3))`, the tip radii ranged from $0.100011$ to $1.899999$ m, so the extremes are found. The density is another matter. Comparing each radial band's share of samples with its share of area:

```text
band (m)       0.1-0.4   0.4-0.7   0.7-1.3   1.3-1.6   1.6-1.9
samples/area   1.61      1.57      1.21      0.91      0.57
```

Uniform joint angles do not give uniform positions. The outer band, where the arm must be nearly straight, gets 57 percent of its fair share, so joint sampling is a poor way to estimate areas.

**Sampling the plane.** With a fresh `numpy.random.default_rng(2026)`, draw 200,000 points uniformly in the square $[-2,2]^2$ (area 16 m²). For each point test 360 evenly spaced headings: the heading works if the wrist point falls in the two-link annulus $[0.4,1.6]$. A point is reachable if some heading works and dexterous if all 360 do.

```text
                points    area estimate (m^2)   exact    std. error   sampled radii (m)
reachable       141,102   11.288                11.310   0.016        0.10002 to 1.89996
dexterous        47,053    3.764                 3.770   0.015        0.70000 to 1.29999
```

Both estimates are within 1.5 standard errors of the exact areas. The 360-heading grid can only overestimate the dexterous set, since a point could fail at a heading between grid lines, but here the sampled radii stay inside $[0.7,1.3]$. Along the $x$ axis, the share of headings that work is $0.42$ at $r=0.2$, $0.70$ at $0.5$, $1.00$ at $1.0$, $0.58$ at $1.5$ and $0.25$ at $1.8$. A gripper that must approach from any side has only the middle band, a third of the reachable area.

## Common Misconceptions & Pitfalls

- **"Inverse kinematics has one answer."** Example 1 has two, and both are exact. Joint limits and obstacles choose between them.
- **"Newton's method finds the nearest solution."** It often does, but Example 3 started $10^{-6}$ rad from one posture and ended millions of degrees away.
- **"The zero posture is a safe initial guess."** For this arm it is singular, and the solver stops on the first step.
- **"A tiny residual means the joints are right."** At the boundary the residual was $7.4\times10^{-16}$ m with a joint error of $5\times10^{-8}$ rad, and convergence was linear, not quadratic.
- **"Non-convergence means a bad start."** It can mean an unreachable target. Check reach before iterating.
- **"The reachable workspace is where the robot can work."** For a task that needs every approach direction, only the dexterous workspace counts, here a third of the reachable area.
- **"Sampling joints uniformly samples the workspace uniformly."** The outer band received 0.57 of its share.

## Summary

Inverse kinematics asks for joint values that produce a given pose, and may have no, several or infinitely many answers. For a two-link arm the law of cosines and `atan2` give both elbow solutions whenever $\lvert L_1-L_2\rvert\le r\le L_1+L_2$, and wrist-point decoupling extends this to many larger arms. Newton's method solves $J\Delta\mathbf q=\mathbf e$ at each step, converges quadratically from a good start, and picks the solution by its basin. It breaks at singular configurations: a stretched start gives a singular matrix, a nearly stretched one a step of $10^6$ rad, a target on the boundary linear convergence with ratio $\tfrac12$, and an unreachable target no convergence at all. The reachable workspace counts positions reached at some orientation, the dexterous workspace those reached at every orientation. For lengths $1.0$, $0.6$, $0.3$ m they are the annuli $[0.1,1.9]$ and $[0.7,1.3]$, which plane sampling with a fixed seed reproduced to within 0.2 percent of area.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 2.5 defines task space and workspace, and Chapter 6 covers the two-link closed form, the Newton-Raphson iteration with the pseudoinverse, and basins of attraction.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): Chapter 3, Section 2.4 defines the reachable and dextrous workspaces and works out Example 3.4 for a planar three-link arm.
- [MIT OpenCourseWare 2.12, Asada, Chapter 4: Planar Kinematics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter4/): inverse kinematics of planar arms, with the elbow-up and elbow-down solutions.
- [NumPy, numpy.arctan2](https://numpy.org/doc/stable/reference/generated/numpy.arctan2.html): the four-quadrant arctangent and its output range.
- [NumPy, numpy.linalg.solve](https://numpy.org/doc/stable/reference/generated/numpy.linalg.solve.html): the linear solve used at each Newton step, and the error it raises on a singular matrix.
- [NumPy, random Generator](https://numpy.org/doc/stable/reference/random/generator.html): `default_rng` and the `uniform` sampler used for the workspace estimates.
