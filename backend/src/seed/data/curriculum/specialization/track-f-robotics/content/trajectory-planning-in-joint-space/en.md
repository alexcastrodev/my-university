---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Split a trajectory into a path and a time scaling, and say what a straight line in joint space does and does not give in task space.
- Solve the cubic and quintic polynomials for their boundary conditions, and compute their peak velocity, acceleration and jerk.
- Build a trapezoidal velocity profile, state its feasibility condition, and find the minimum time under velocity and acceleration limits.
- Synchronize several joints so that the slowest one sets the duration.
- Compare via-point methods by the continuity they give, and spot a missed via or an overshoot.

## Context & Motivation

Inverse kinematics gives configurations, not motion. A controller needs a target at every sample, and *Modern Robotics* (Lynch and Park, Chapter 9) opens with exactly this: during motion the controller is fed a steady stream of goal positions and velocities to track. A trajectory is that stream, and its speed sets the torques. `the-manipulator-equation-inertia-coriolis-gravity` showed that halving the duration of a motion multiplied the inertia and velocity torques by 4 while leaving gravity unchanged.

This lesson works in joint space: each joint gets a function of time, and a joint controller such as the one in `independent-joint-control-and-pid` tracks it. *Modern Robotics* contrasts this with straight lines in task space. In joint space, limits of the form $\theta_{i,\min}\le\theta_i\le\theta_{i,\max}$ form a convex set, so a straight line between two allowed configurations stays allowed. A straight line in task space can pass near a kinematic singularity, where the joint velocities may become very large, and can leave the reachable workspace between two reachable endpoints. The price of joint space is that the tool does not move along a straight line, which Example 5 measures.

All numbers below are for an assumed joint with assumed limits. Angles are in degrees and time in seconds.

## Core Theory

### Path and time scaling

*Modern Robotics* writes a trajectory as a path $\theta(s)$ with $s\in[0,1]$ and a time scaling $s(t)$ with $t\in[0,T]$. For the straight line in joint space,

$$q(t)=q_0+s(t)\,D,\qquad \dot q=\dot s\,D,\qquad \ddot q=\ddot s\,D,\qquad D=q_f-q_0.$$

If every joint uses the same $s(t)$, the joints start and stop together and the configuration stays on the straight segment between $q_0$ and $q_f$.

### Cubic polynomials

A cubic $q(t)=c_0+c_1t+c_2t^2+c_3t^3$ has four coefficients, enough for position and velocity at both ends: $q(0)=q_0$, $\dot q(0)=v_0$, $q(T)=q_f$, $\dot q(T)=v_f$. Solving the four linear equations (done with SymPy):

$$c_0=q_0,\quad c_1=v_0,\quad c_2=\frac{3D-(2v_0+v_f)T}{T^2},\quad c_3=\frac{-2D+(v_0+v_f)T}{T^3}.$$

These match equations (9.26) to (9.29) of *Modern Robotics*. From rest to rest ($v_0=v_f=0$) this is $s(\tau)=3\tau^2-2\tau^3$ with $\tau=t/T$, and

$$\dot q_{\max}=\frac{3D}{2T}\ \text{at}\ t=\tfrac T2,\qquad \ddot q(0)=\frac{6D}{T^2},\qquad \ddot q(T)=-\frac{6D}{T^2},\qquad \dddot q=-\frac{12D}{T^3}.$$

The acceleration is largest at the ends, where the joint was at rest a moment before. It jumps from $0$ to $6D/T^2$, so the jerk is infinite there, which *Modern Robotics* notes may cause vibration.

### Quintic polynomials

Six coefficients allow the accelerations at both ends to be set as well, $\ddot q(0)=a_0$ and $\ddot q(T)=a_f$. The solution keeps $c_0=q_0$, $c_1=v_0$, $c_2=a_0/2$ and

$$\begin{aligned}
c_3&=\frac{20D-(8v_f+12v_0)T-(3a_0-a_f)T^2}{2T^3},\\
c_4&=\frac{-30D+(14v_f+16v_0)T+(3a_0-2a_f)T^2}{2T^4},\\
c_5&=\frac{12D-6(v_f+v_0)T-(a_0-a_f)T^2}{2T^5}.
\end{aligned}$$

From rest to rest with zero end accelerations, $s(\tau)=10\tau^3-15\tau^4+6\tau^5$, and

$$\dot q_{\max}=\frac{15D}{8T},\qquad \lvert\ddot q\rvert_{\max}=\frac{10D}{\sqrt3\,T^2}\ \text{at}\ \tau=\tfrac{3\mp\sqrt3}{6},\qquad \dddot q(0)=\frac{60D}{T^3}.$$

The acceleration now starts at zero, so it is continuous at the ends. The jerk still jumps there, from $0$ to $60D/T^3$, but it is finite. The cost is a peak velocity $25\%$ higher than the cubic's. Both closed forms agree with the `CubicTimeScaling` and `QuinticTimeScaling` functions of the *Modern Robotics* code library ($s=0.216$ and $0.16308$ at $t=0.6$, $T=2$).

### Trapezoidal velocity profiles

The trapezoid accelerates at a constant $a$ for a blend time $t_b$, cruises at $v=a\,t_b$, and decelerates at $-a$ for the last $t_b$. Position is a parabola, a line and a parabola, which is why the older name is "linear segment with parabolic blends" (LSPB). The distance covered is $v\,(T-t_b)$, so for a given $D>0$, $T$ and $a$,

$$t_b=\frac T2-\frac{\sqrt{a^2T^2-4aD}}{2a},\qquad v=a\,t_b.$$

**Feasibility.** The square root is real only if

$$a\ge\frac{4D}{T^2}.$$

At equality $t_b=T/2$, the cruise phase vanishes, and the profile is a triangle with peak velocity $2D/T$. With less acceleration, no profile of this family covers $D$ in time $T$. The cruise velocity is then always in the window $D/T<v\le2D/T$. In the normalized form of *Modern Robotics*, with $D=1$, these read $aT^2\ge4$ and $1<vT\le2$.

**Minimum time.** Given limits $v$ and $a$, the trapezoid reaches $v$ only if $v^2/a\le D$, and then

$$T=\frac Dv+\frac va.$$

Otherwise the profile is a triangle that never reaches $v$, with $T=2\sqrt{D/a}$. *Modern Robotics* notes that, for constant velocity and acceleration limits, the trapezoid that uses the largest allowed $v$ and $a$ is the fastest straight-line motion. Its acceleration jumps four times, at $0$, $t_b$, $T-t_b$ and $T$. The S-curve profile adds constant-jerk phases to remove those jumps.

### Several joints

On a straight joint-space line, joint $i$ moves $D_i$ with $\dot q_i=\dot s\,D_i$ and $\ddot q_i=\ddot s\,D_i$. The limits on $s$ are therefore

$$\dot s_{\max}=\min_i\frac{v_i}{\lvert D_i\rvert},\qquad \ddot s_{\max}=\min_i\frac{a_i}{\lvert D_i\rvert},$$

and the duration is that of a unit trapezoid with these limits. The joint that is slowest relative to its distance sets $T$, and the others are slowed to arrive with it.

### Via points

A task often specifies intermediate configurations at given times. The common methods differ in what is continuous where the segments meet:

| Method | Passes the vias | Continuous at the vias | At start and end from rest |
|---|---|---|---|
| Cubic segments with chosen via velocities | yes | velocity | acceleration jumps |
| Cubic spline (velocities solved for) | yes | acceleration | acceleration jumps |
| Quintic segments with chosen velocities and accelerations | yes | acceleration | acceleration can be 0 |
| Stop at every via | yes | velocity, which is 0 | acceleration jumps |
| Linear segments with parabolic blends | no, passes near | velocity | acceleration jumps |

*Modern Robotics* states the first row and its generalization to quintics, and notes that a via velocity left unspecified can be chosen by a heuristic from the neighboring vias. The spline row is the clamped spline of `splines`: with the end velocities fixed at zero, the whole curve comes out of one tridiagonal system, and in exchange the end accelerations are whatever that system gives. In the blend row the parabola replaces the corner, so the joint never reaches the via; the Robotics Toolbox documents this for its `mstraj` function, which says that with a blend "the via point is not actually reached".

**Book vs today.** The Robotics Toolbox for Python now calls the trapezoid `trapezoidal` and marks the older `lspb` as deprecated. In ROS 2, the `ros2_control` joint trajectory controller (documentation for the Lyrical distribution, 2026) chooses the interpolation from what each waypoint carries: linear if only positions are given (continuous position, discouraged), cubic if velocities are given (continuous velocity), quintic if accelerations are given too (continuous acceleration).

## Worked Examples

### Example 1: one joint, three profiles

A joint moves from $0^\circ$ to $90^\circ$ in $T=2$ s. The cubic is $q=67.5t^2-22.5t^3$, the quintic $q=112.5t^3-84.375t^4+16.875t^5$, and the trapezoid uses $a=180\ ^\circ/\text{s}^2$, giving $t_b=0.2929$ s and $v=52.72\ ^\circ/\text{s}$. Sampled from the script, in degrees and seconds:

```text
  t   | cubic: q    qd     qdd   | quintic: q   qd     qdd   | trapezoid: q  qd     qdd
0.00  |   0.00   0.00  135.00    |   0.00   0.00     0.00    |   0.00   0.00  180.00
0.25  |   3.87  29.53  101.25    |   1.44  16.15   110.74    |   5.62  45.00  180.00
0.50  |  14.06  50.62   67.50    |   9.32  47.46   126.56    |  18.64  52.72    0.00
0.75  |  28.48  63.28   33.75    |  24.77  74.16    79.10    |  31.82  52.72    0.00
1.00  |  45.00  67.50    0.00    |  45.00  84.38     0.00    |  45.00  52.72    0.00
1.25  |  61.52  63.28  -33.75    |  65.23  74.16   -79.10    |  58.18  52.72    0.00
1.50  |  75.94  50.62  -67.50    |  80.68  47.46  -126.56    |  71.36  52.72    0.00
1.75  |  86.13  29.53 -101.25    |  88.56  16.15  -110.74    |  84.38  45.00 -180.00
2.00  |  90.00   0.00 -135.00    |  90.00   0.00     0.00    |  90.00   0.00 -180.00
```

On a grid of 200001 points, the cubic peaks at $67.5\ ^\circ/\text{s}$ and $135\ ^\circ/\text{s}^2$, the quintic at $84.375\ ^\circ/\text{s}$ and $129.90\ ^\circ/\text{s}^2$ (at $t=0.423$ and $1.577$ s, between the grid rows above), and the trapezoid at $52.72\ ^\circ/\text{s}$ and $180\ ^\circ/\text{s}^2$. Each trades one peak against another: the trapezoid has the lowest velocity and the highest acceleration, the quintic the opposite. The quintic's jerk runs from $-337.5$ to $675\ ^\circ/\text{s}^3$; the cubic's is $-135$ inside the motion, plus the jumps in acceleration at both ends.

### Example 2: feasibility and minimum time

Same joint and distance, with assumed limits $\lvert\dot q\rvert\le90\ ^\circ/\text{s}$ and $\lvert\ddot q\rvert\le180\ ^\circ/\text{s}^2$.

For $T=2$ s the trapezoid needs $a\ge4\cdot90/2^2=90\ ^\circ/\text{s}^2$:

```text
a (deg/s^2)   t_b (s)   v (deg/s)   note
 60           -         -           infeasible: 60 < 90
 90           1.0000    90.00       triangle, v = 2D/T
101.25        0.6667    67.50       v = 1.5 D/T
180           0.2929    52.72
360           0.1340    48.23       v tends to D/T = 45
```

The row $v=1.5\,D/T$ is the default of the Robotics Toolbox's `trapezoidal_func`; its documented example (1 to 2 in 5 s, $t_b=1.667$ s, acceleration $0.18$) matches the formula.

The minimum duration of each profile, with the binding limit:

```text
profile     T_min (s)   binding limit   peak qd   peak |qdd|
cubic       1.7321      acceleration    77.94     180.00
quintic     1.8750      velocity        90.00     147.80
trapezoid   1.5000      both            90.00     180.00
```

The trapezoid needs $v^2/a=45\le90$, so it cruises, with $t_b=0.5$ s. Without the velocity limit, the triangle would take $2\sqrt{90/180}=1.414$ s but would peak at $127.3\ ^\circ/\text{s}$. The cubic at $T=1.5$ s would need $240\ ^\circ/\text{s}^2$, beyond the limit.

### Example 3: three joints, one duration

Joints move $D=(90,-45,30)^\circ$ with assumed limits $v=(90,60,120)\ ^\circ/\text{s}$ and $a=(180,90,240)\ ^\circ/\text{s}^2$. Alone, each could finish in $1.5$, $1.417$ and $0.707$ s (joint 3 as a triangle). Together, $\dot s_{\max}=\min(1,\,1.333,\,4)=1\ \text{s}^{-1}$ and $\ddot s_{\max}=\min(2,\,2,\,8)=2\ \text{s}^{-2}$, so $T=1+0.5=1.5$ s. The peaks are $(90,-45,30)\ ^\circ/\text{s}$ and $(180,-90,60)\ ^\circ/\text{s}^2$: joint 1 is at both its limits, joint 2 at its acceleration limit, joint 3 far below both.

### Example 4: four via points, six methods

One joint passes $0,30,70,60^\circ$ at $t=0,1,2,3$ s, starting and ending at rest. The segment slopes are $30$, $40$ and $-10\ ^\circ/\text{s}$. The via-velocity rule used here (one simple heuristic, not the only one) takes the average of the two neighboring slopes when they have the same sign and zero when the joint reverses, which gives $35$ at $t=1$ and $0$ at $t=2$.

With these velocities, the first cubic segment is $q=55t^2-25t^3$: at $t=1$ it gives $30^\circ$, $35\ ^\circ/\text{s}$, and acceleration $110-150=-40\ ^\circ/\text{s}^2$, while the next segment starts at $+100$. The clamped spline has the pieces $40t^2-10t^3$, $30+50t+10t^2-20t^3$ and $70+10t-50t^2+30t^3$, local time in each, and SciPy's `CubicSpline` with `bc_type=((1, 0.0), (1, 0.0))` agrees with them to $3\times10^{-14}$. Methods C and D are quintic segments; D takes its via velocities and accelerations from the spline and sets the end accelerations to 0. Method F uses straight segments with parabolic blends of half-width $t_b=0.2$ s centered on each via, so it starts at $t=-0.2$ and ends at $t=3.2$.

```text
method                              q at t=1,2     qd at t=1,2   qdd jump at t=1   qdd jump at t=2   qdd at start   peak |qd|   peak |qdd|
A cubic, rule velocities            30, 70         35, 0         -40 -> 100        -170 -> -60       110            53.5        170.0
B clamped cubic spline              30, 70         50, 10        none (20)         none (-100)       80             51.7        100.0
C quintic, rule velocities, qdd 0   30, 70         35, 0         none (0)          none (0)          0              61.7        166.4
D quintic, spline values            30, 70         50, 10        none (20)         none (-100)       0              51.7        101.0
E cubic, stop at every via          30, 70         0, 0          -180 -> 240       -240 -> -60       180            60.0        240.0
F lines with parabolic blends       30.5, 67.5     35, 15        blend: 25         blend: -125       75             40.0        125.0
```

The spline (B) is smooth inside but goes past the data: its velocity at $t=2$ is $+10\ ^\circ/\text{s}$, so the joint keeps rising to $70.535^\circ$ at $t=2.111$ before returning, while A, with zero velocity at the reversal, never exceeds $70^\circ$. C buys continuous acceleration by forcing it to zero at every via, and pays with a peak jerk inside the segments of $1560\ ^\circ/\text{s}^3$ against $660$ for D. Only C and D start and stop without an acceleration step. Stopping at every via (E) is the simplest and needs the largest acceleration. F misses each interior via by $\Delta v\,t_b/4$, where $\Delta v$ is the change of slope: $(40-30)(0.2)/4=0.5^\circ$ at $t=1$ and $(-10-40)(0.2)/4=-2.5^\circ$ at $t=2$. Its lower peaks are not a fair win, because it takes $3.4$ s instead of $3$.

### Example 5: a straight line in joint space is not straight in task space

A planar 2R arm with assumed link lengths $L_1=L_2=1$ m and relative joint angles, as in `forward-kinematics-of-serial-manipulators`, has its tip at $(\cos\theta_1+\cos(\theta_1+\theta_2),\ \sin\theta_1+\sin(\theta_1+\theta_2))$. Moving along the joint line from $(0^\circ,90^\circ)$ to $(90^\circ,0^\circ)$ takes the tip from $(1,1)$ to $(0,2)$:

```text
 s      theta (deg)      tip (m)            distance from the straight tip segment (m)
0.00    (0.0, 90.0)      (1.0000, 1.0000)   0.0000
0.25    (22.5, 67.5)     (0.9239, 1.3827)   0.2168
0.50    (45.0, 45.0)     (0.7071, 1.7071)   0.2929
0.75    (67.5, 22.5)     (0.3827, 1.9239)   0.2168
1.00    (90.0, 0.0)      (0.0000, 2.0000)   0.0000
```

The tip bulges $0.293$ m away from the straight line, the largest deviation on a fine grid. A different time scaling would change when the tip is at each point, not where the points are.

## Common Misconceptions & Pitfalls

- **"Any $T$ works for a trapezoid if the acceleration is high enough."** The condition is $a\ge4D/T^2$; Example 2 shows $a=60$ failing for $T=2$.
- **"The quintic is gentler in every way."** Its peak velocity is $25\%$ higher than the cubic's (Example 1), so a velocity-limited joint takes longer with it (Example 2).
- **"A cubic spline is the smoothest choice, so it is the best."** It overshot the data by $0.535^\circ$ in Example 4, and with zero end velocities it still starts with an acceleration step.
- **"Continuous acceleration means low jerk."** Method C is continuous in acceleration and had the largest jerk inside the segments, $1560\ ^\circ/\text{s}^3$.
- **"A blended via point is passed exactly."** The joint passes near it, here off by $\Delta v\,t_b/4$.

## Summary

A joint-space trajectory is a straight path in configuration space plus a time scaling. The cubic fits position and velocity at both ends, peaks at $1.5D/T$ and $6D/T^2$, and starts with an acceleration step. The quintic also fixes the end accelerations, which removes that step at the price of a peak velocity of $15D/(8T)$. The trapezoid exists only when $a\ge4D/T^2$, cruises at $t_b\,a$ with $t_b=T/2-\sqrt{a^2T^2-4aD}/(2a)$, and with the largest allowed $v$ and $a$ it is, as *Modern Robotics* notes, the fastest straight-line motion. With several joints, the most constrained one sets the duration. Through via points, cubic segments give continuous velocity, splines and quintic segments continuous acceleration, and parabolic blends give continuous velocity but miss the via.

## Documentation Links

- [Modern Robotics, Lynch and Park (preprint PDF)](https://hades.mech.northwestern.edu/images/2/25/MR-v2.pdf): Chapter 9, path and time scaling, polynomial and trapezoidal time scalings, S-curves and via-point cubics.
- [Modern Robotics book resources, 9.3 Polynomial via point trajectories](https://modernrobotics.northwestern.edu/nu-gm-book-resource/9-3-polynomial-via-point-trajectories/): video and transcript on cubic via-point interpolation, including leaving the via velocities free and matching velocity and acceleration.
- [Modern Robotics code library](https://github.com/NxRLab/ModernRobotics): `CubicTimeScaling`, `QuinticTimeScaling` and `JointTrajectory`.
- [Robotics Toolbox for Python: Trajectories](https://petercorke.github.io/robotics-toolbox-python/arm_trajectory.html): `quintic`, `trapezoidal` and `mstraj`, with the note that blended via points are not reached.
- [ros2_control: joint trajectory controller, trajectory representation](https://control.ros.org/lyrical/doc/ros2_controllers/joint_trajectory_controller/doc/trajectory.html): linear, cubic and quintic interpolation chosen from the waypoint fields.
- [SciPy: CubicSpline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.CubicSpline.html): boundary conditions, including fixed end slopes.
