---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define a kinematic singularity as a loss of rank of the Jacobian, and test for it with the determinant when $J$ is square and with singular values otherwise.
- Find the singular configurations of a planar two-link arm and of a three-joint articulated arm, and classify them as boundary or interior.
- Show with a run how joint velocities grow near a singularity, and predict their size from the smallest singular value.
- Define Yoshikawa's manipulability measure, compute it for square, wide and tall Jacobians, and say what it does not capture.
- Describe what damped least squares buys and what it costs.

## Context & Motivation

`velocity-kinematics-and-the-jacobian` built the matrix that turns joint rates into tool velocity, $\dot{\mathbf x}=J(\mathbf q)\dot{\mathbf q}$. A controller usually needs the opposite direction: the task says how the tool should move, and the controller computes the joint rates, for a square invertible $J$ by $\dot{\mathbf q}=J^{-1}\dot{\mathbf x}$. `inverse-kinematics-and-workspace` already met the trouble spot from the iteration side: at the stretched arm, $\det J=0$ and Newton's method could not take a step. This lesson looks at the same configurations from the velocity side. What exactly is lost there, how large do the joint rates get nearby, and how can "nearby" be measured with one number?

## Core Theory

### Singular means rank-deficient

Let $J$ be $m\times n$, mapping $n$ joint rates to $m$ task velocities. A configuration is **singular** when $\operatorname{rank}J(\mathbf q)$ drops below its largest value over all configurations, which is $\min(m,n)$ for an arm that is not deficient everywhere. At such a point two things happen together. Some task direction leaves the range of $J$, so no joint motion produces tool motion that way. And the null space grows, so some joint motion produces no tool motion.

For square $J$, rank loss is $\det J=0$. For a non-square $J$ there is no determinant, and the general tool is the singular value decomposition $J=U\Sigma V^T$, with $\sigma_1\ge\dots\ge\sigma_{\min(m,n)}\ge0$. The rank is the number of nonzero $\sigma_i$, and the smallest one says how close the configuration is to losing a direction. In floating point "zero" means "below a tolerance", which is what `numpy.linalg.matrix_rank` applies.

### What happens near a singularity

Near, but not at, a singularity of a square $J$, $J^{-1}$ exists and

$$\lVert\dot{\mathbf q}\rVert=\lVert J^{-1}\dot{\mathbf x}\rVert\le\frac{\lVert\dot{\mathbf x}\rVert}{\sigma_{\min}},$$

with equality when $\dot{\mathbf x}$ points along the left singular vector of $\sigma_{\min}$. So the joint rates do not blow up for every task velocity: only the component along the direction that is being lost gets amplified, by $1/\sigma_{\min}$. Task velocities that stay inside the surviving directions remain cheap.

### Two arms, their singular sets

For the planar two-link arm, $\det J=L_1L_2\sin\theta_2$: singular when the arm is stretched ($\theta_2=0$) or folded ($\theta_2=\pi$). Both lie on the workspace boundary, where `inverse-kinematics-and-workspace` found a single solution instead of two.

For the articulated arm of `the-denavit-hartenberg-convention`, with position Jacobian $J_v$ ($3\times3$),

$$\det J_v=-a_2a_3\sin\theta_3\,\big(a_2\cos\theta_2+a_3\cos(\theta_2+\theta_3)\big)=-a_2a_3\sin\theta_3\;r,$$

where $r$ is the horizontal distance from the tip to the base axis. The factor $\sin\theta_3$ is the **elbow singularity**, stretched or folded forearm, again on the boundary. The factor $r$ is the **shoulder singularity**: the tip on the vertical axis of joint 1. That one lies inside the workspace, so a straight-line task can run right through it.

### Yoshikawa's manipulability measure

A unit ball of joint rates, $\lVert\dot{\mathbf q}\rVert\le1$, maps under $J$ to an ellipsoid of task velocities with semi-axes $\sigma_i$ along the left singular vectors. Modern Robotics calls it the manipulability ellipsoid and, for a task space of dimension $m\le n$, measures its volume with

$$w(\mathbf q)=\sqrt{\det\big(J(\mathbf q)\,J(\mathbf q)^T\big)}=\sigma_1\sigma_2\cdots\sigma_m,$$

which it lists as $\mu_3$ and says is proportional to the ellipsoid's volume. Its notes credit Yoshikawa (1985, *International Journal of Robotics Research*) with the first quantitative formulation of manipulability, and the Robotics Toolbox for Python implements this volume as its default `"yoshikawa"` method, described as a "distance from singularity". Properties that follow from the definition:

- $w\ge0$, and $w=0$ exactly at a singularity.
- For square $J$, $w=\lvert\det J\rvert$.
- For wide $J$ ($m<n$, a redundant arm), $JJ^T$ is $m\times m$ and the formula works as written.
- For tall $J$ ($m>n$), $JJ^T$ is $m\times m$ with rank at most $n<m$, so $w=0$ at every configuration and the formula carries no information. The usual way out is to apply it to the rows the task cares about, for example $J_v$ alone. Modern Robotics separates the linear and angular ellipsoids for a related reason: the units differ. The Robotics Toolbox offers the same choice through an `axes` argument and warns that using all rows "involves adding different units".
- $w$ has units (m² for a planar position Jacobian), so its value changes with the unit of length, and comparing $w$ across robots of different size compares sizes as much as dexterity.

Other one-number measures look at shape rather than volume. Modern Robotics uses $\mu_1=\sigma_{\max}/\sigma_{\min}$, which is 1 for a round ellipsoid and grows toward a singularity. Murray, Li and Sastry list $\sigma_{\min}$ and $\sigma_{\min}/\sigma_{\max}$, and warn that the determinant can be large even when $\sigma_{\min}$ is small, because a large $\sigma_{\max}$ compensates. The two books use the symbols $\mu_1$, $\mu_2$, $\mu_3$ for different quantities.

## Worked Examples

Assumed values: two-link arm $L_1=1.0$ m, $L_2=0.6$ m; articulated arm $d_1=0.4$ m, $a_2=0.5$ m, $a_3=0.4$ m. Velocities in m/s, joint rates in rad/s.

### Example 1: approaching the stretched arm

Move the tip of the two-link arm radially outward along the $x$ axis at $0.05$ m/s toward the boundary at $r=1.6$ m, and compare with the same speed tangentially. Joint rates from $\dot{\mathbf q}=J^{-1}\dot{\mathbf x}$ on the $\theta_2>0$ branch:

```text
r (m)      theta2 (deg)   sigma_min   |qdot| radial   |qdot| tangential
1.0        107.46         0.559       0.089           0.050
1.5        42.13          0.252       0.198           0.033
1.59       13.24          0.081       0.618           0.031
1.599      4.18           0.026       1.95            0.031
1.5999     1.32           0.0081      6.17            0.031
1.59999    0.42           0.0026      19.5            0.031
```

Each tenfold step toward the boundary multiplies the radial joint rate by about $\sqrt{10}$. Differentiating $r^2=L_1^2+L_2^2+2L_1L_2\cos\theta_2$ explains it: $\dot\theta_2=-r\dot r/(L_1L_2\sin\theta_2)$, which gives $-1.826$ rad/s at $r=1.599$, and $\sin\theta_2$ shrinks like the square root of the distance to the boundary. The tangential rate, meanwhile, settles at $0.05/1.6=0.031$ rad/s: moving along the boundary circle needs only joint 1, and that direction is never lost.

### Example 2: a straight line past the shoulder singularity

Command the articulated arm's tip along the line $\mathbf p(t)=(-0.2+0.1t,\ h,\ 0.6)$ m for $0\le t\le4$ s, a constant $0.1$ m/s along $x$ that passes at horizontal distance $h$ from the base axis at $t=2$ s. The run integrates $\dot{\mathbf q}=J_v^{-1}\dot{\mathbf p}$ with the classic fourth-order Runge-Kutta method at fixed step $\Delta t$, starting from the exact inverse kinematics on the $\theta_3<0$ branch.

```text
h (m)    peak |theta1_dot|   at t (s)   min |det Jv|   max tracking error (dt = 1e-3 or 1e-4 s)
0.05     2.000               2.000      3.9e-03        below 1e-12 m
0.01     10.000              2.000      7.6e-04        below 1e-12 m
0.001    100.00              2.000      7.6e-05        below 1e-9 m
```

The peak is exactly $v/h$. Joint 1 is the base yaw $\theta_1=\operatorname{atan2}(y,x)$, so $\dot\theta_1=(x\dot y-y\dot x)/(x^2+y^2)$, which at $x=0$ is $-v/h$. At that instant the other two joints are still: $\dot{\mathbf q}=(-10,0,0)$ for $h=0.01$. Over the whole pass $\theta_1$ turns from $177.1^\circ$ to $2.9^\circ$, and $157^\circ$ of that happens while the tip covers the $10h$ around the axis. For $h=1$ mm that is $157^\circ$ in $0.1$ s, for a tool moving at only $0.1$ m/s. The integration is not the problem: the tracking error stays near rounding level, whose exact digits depend on the implementation. The motor is the problem. If the base joint is limited to, say, 3 rad/s (an assumed figure), this path is infeasible for $h<0.033$ m.

### Example 3: damped least squares, and its price

Damped least squares replaces $J^{-1}$ by $J^T(JJ^T+\lambda^2I)^{-1}$. In singular-value terms each gain $1/\sigma_i$ becomes $\sigma_i/(\sigma_i^2+\lambda^2)$, which is at most $1/(2\lambda)$, so the joint rates stay bounded. The price is that the commanded tool velocity is no longer met exactly. Rerun Example 2 at $h=1$ mm with $\Delta t=10^{-4}$ s and position feedback, $\dot{\mathbf q}=J^T(JJ^T+\lambda^2I)^{-1}(\dot{\mathbf p}_d+K\mathbf e)$ with $K=10\ \text{s}^{-1}$:

```text
lambda (m)   peak joint rate (rad/s)   max tracking error (mm)   final theta (deg)
0            100.0                     < 0.001                   (0.3, 98.1, -145.6)
0.001        50.3                      2.2                       (0.3, 98.1, -145.6)
0.003        7.0                       1.75                      (180.3, 188.1, -145.6)
0.01         1.12                      1.58                      (180.3, 188.1, -145.6)
0.03         0.51                      1.53                      (180.3, 188.1, -145.6)
```

The peak joint rate is the largest rate of any single joint; the norm of $\dot{\mathbf q}$ at its peak agrees with it to within 0.02 rad/s in the first three rows and is $1.23$ and $0.57$ rad/s in the last two. A damping of 1 cm cuts the fastest joint's peak by a factor of 90 for a deviation of 1.6 mm near the axis, and the feedback pulls the error back to $0.011$ mm by the end. The last column shows a side effect. Without enough damping the base spins through about $177^\circ$. With $\lambda\ge3$ mm the arm instead reaches back over the base axis, $\theta_2$ passing $180^\circ$, and finishes on the other shoulder branch with the same tool position. Whether that is acceptable depends on joint limits and on what is around the robot.

### Example 4: manipulability of the two-link arm

```text
theta2 (deg)   w (m^2)   sigma_1   sigma_2   mu1 = sigma_1/sigma_2
90             0.600     1.215     0.494     2.46
120            0.520     0.877     0.593     1.48
135            0.424     0.732     0.580     1.26
45             0.424     1.580     0.269     5.88
10             0.104     1.702     0.061     27.8
1              0.0105    1.709     0.0061    279
```

Here $w=\lvert\det J\rvert=0.6\lvert\sin\theta_2\rvert$, which does not depend on $\theta_1$ (at $\theta_2=60^\circ$ it is $0.5196$ both for $\theta_1=0$ and for $\theta_1=1$ rad) and is largest at $\theta_2=\pm90^\circ$. But the roundest ellipse is elsewhere: a sweep of $\theta_2$ puts the minimum $\mu_1=1.260$ at $\theta_2\approx134.2^\circ$, where $w$ is about 28 percent lower. And $\theta_2=45^\circ$ and $135^\circ$ have the same $w=0.424$ with $\mu_1=5.88$ against $1.26$: equal volume, very different shape, the limitation Murray, Li and Sastry point out. In millimetres, the $w$ at $90^\circ$ reads $6.0\times10^5$ mm².

### Example 5: wide and tall Jacobians

**Wide.** The planar three-link arm with lengths $1.0$, $0.6$, $0.3$ m, tracking only the tip position, has a $2\times3$ $J$. There is no determinant, but $w=\sqrt{\det JJ^T}$ is defined:

```text
q (deg)          rank   sigma            w (m^2)
(0, 0, 0)        1      (2.124, 0)       0
(0, 180, 0)      1      (0.954, 0)       0
(0, 90, -90)     2      (1.554, 0.420)   0.652
(0, 90, 0)       2      (1.524, 0.623)   0.949
```

The rank drops only when the three columns are parallel, which needs the base, both joints and the tip on one line. Because $n>m$, almost every posture is regular, and the extra joint can be used to keep $w$ high.

**Tall.** The articulated arm's full $6\times3$ geometric Jacobian at $(30^\circ,45^\circ,-60^\circ)$ has singular values $(1.633,1.244,0.324)$, so it has full rank 3, yet $\det(JJ^T)$ evaluates to a number of order $10^{-50}$, zero up to rounding, as it must for a $6\times6$ matrix of rank 3. Applied to the position rows, $w_v=\lvert\det J_v\rvert=0.128$ m³, matching $a_2a_3\lvert\sin\theta_3\rvert\,r=0.5\cdot0.4\cdot0.866\cdot0.7399$. The angular rows have rank 2 at every configuration (joints 2 and 3 have parallel axes), so this arm can never control all three components of its tool's spin, and a measure on the angular rows alone would be zero everywhere: a permanent deficiency, not proximity to a singularity. Mixing rows also mixes units: expressing the linear rows in mm changes the product of the six-row singular values from $0.658$ to $1.28\times10^8$.

## Common Misconceptions & Pitfalls

- **"At a singularity every joint rate blows up."** Only the component along the lost direction does. In Example 1 the tangential motion needed $0.031$ rad/s right at the boundary.
- **"Singularities live on the workspace boundary."** The shoulder singularity of Example 2 is interior, and a straight line runs through it.
- **"$\det J=0$ is the test."** Only for square $J$. For wide or tall $J$, use the rank and the singular values.
- **"Maximizing $w$ makes the arm isotropic."** In Example 4, $w$ peaked at $90^\circ$, while the roundest ellipse was at $134^\circ$.
- **"Yoshikawa's measure works for any Jacobian."** For a tall $J$ it is identically zero. Apply it to the task rows.
- **"$w=0.6$ is good."** Only relative to the same robot, units and rows. In mm the same posture gives $6\times10^5$.
- **"Damping fixes singularities for free."** It trades joint speed for tracking error, and in Example 3 it also changed the arm's configuration branch.

## Summary

A singularity is a configuration where the Jacobian loses rank: some tool direction becomes impossible and some joint motion becomes invisible. Square Jacobians signal it with $\det J=0$, all Jacobians with a vanishing singular value. Near one, the joint rate needed for a task velocity grows like $1/\sigma_{\min}$ for the component along the lost direction, as the radial approach of Example 1 showed, while other directions stay cheap. Some singularities are interior: a line passing $h$ from the articulated arm's base axis demanded exactly $v/h$ from the base joint, 100 rad/s at $h=1$ mm. Yoshikawa's measure $w=\sqrt{\det JJ^T}$ is the volume of the velocity ellipsoid, equal to $\lvert\det J\rvert$ for square $J$, defined for wide $J$, and identically zero for tall $J$ unless restricted to the task rows. It vanishes at singularities but says nothing about the ellipsoid's shape and depends on units. Damped least squares bounds the joint rates at the cost of tracking error and, sometimes, a different configuration.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 5.3 on singularity analysis, and Section 5.4 on the manipulability ellipsoid and the measures $\mu_1$, $\mu_2$, $\mu_3$, with the credit to Yoshikawa in the chapter notes.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): Chapter 3, Sections 4.3 and 4.4, on common singular configurations and on manipulability measures built from singular values.
- [MIT OpenCourseWare 2.12, Asada, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): resolved joint velocities along a trajectory that passes near singular configurations of a two-link arm.
- [Robotics Toolbox for Python, robot superclass](https://petercorke.github.io/robotics-toolbox-python/arm_superclass.html): the `manipulability` method, its Yoshikawa, inverse-condition, minimum-singular-value and Asada options, and the `axes` choice.
- [NumPy, numpy.linalg.svd](https://numpy.org/doc/stable/reference/generated/numpy.linalg.svd.html): the singular value decomposition used for every rank and measure here.
- [NumPy, numpy.linalg.matrix_rank](https://numpy.org/doc/stable/reference/generated/numpy.linalg.matrix_rank.html): rank by counting singular values above a tolerance.
