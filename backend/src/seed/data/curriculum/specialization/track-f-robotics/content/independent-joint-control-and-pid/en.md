---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Model one joint driven by a geared DC motor, with reflected inertia and damping, and treat the rest of the arm as a disturbance on that joint.
- Implement a discrete PID loop with a named sampling period, integration rule, derivative rule and anti-windup scheme, and choose gains by pole placement.
- Show by simulation why PD alone leaves a gravity error, how the integrator and gravity feed-forward remove it, and what integrator windup does at a saturated actuator.
- Show by simulation what independent joint control ignores: the change of inertia with configuration and the coupling between joints.

## Context & Motivation

`the-manipulator-equation-inertia-coriolis-gravity` wrote the arm as one coupled equation, $M(q)\ddot q+C\dot q+g=\tau$. The simplest controller ignores most of it. Each joint gets its own loop that reads its own encoder and commands its own motor, as if it were alone. *Modern Robotics* calls this decentralized control and says it is appropriate when the dynamics are decoupled, at least approximately, as in highly geared robots without gravity. This lesson builds such a loop for the two-link arm of the previous lessons, runs it, and measures what it gets right and what it misses.

## Core Theory

### A geared joint

A DC motor produces torque $\tau_m=k_ti$ from current $i$. In the usual arrangement the amplifier runs in current mode, adjusting the voltage to obtain the commanded current, so the controller commands torque and the electrical dynamics are left out here. A gearhead with ratio $G$ turns the motor $G$ times faster than the joint and, with efficiency $\eta$, multiplies the torque: $\tau=\eta G\tau_m$. A rotor of inertia $J_m$ spinning at $G\dot q$ stores $\tfrac12G^2J_m\dot q^2$, so the joint sees a **reflected inertia** $G^2J_m$; motor-side viscous friction $b_m$ appears as $G^2b_m$ in the same way. For joint $i$ of the arm,

$$\underbrace{\big(G^2J_m+\bar M_{ii}\big)}_{J_i}\ddot q_i+G^2b_m\,\dot q_i=\eta Gk_t\,i_i-d_i,\qquad d_i=\big(M_{ii}(q)-\bar M_{ii}\big)\ddot q_i+\sum_{j\ne i}M_{ij}\ddot q_j+\big(C\dot q\big)_i+g_i(q),$$

where $\bar M_{ii}$ is a fixed nominal value. Independent joint control designs each loop for the left-hand side and treats $d_i$ as an unknown disturbance. The larger $G^2J_m$ is compared with the link inertia, the smaller $d_i$ is relative to the joint's own dynamics, which is why *Modern Robotics* says the mass matrix of a highly geared robot is nearly diagonal.

The motor values are assumptions, and $\eta=1$: $G=100$, $J_m=3.0\times10^{-5}\ \text{kg m}^2$, $b_m=1.0\times10^{-4}$ N m s/rad, $k_t=0.05$ N m/A, current limit 8 A. At the joint this gives a reflected inertia of $0.3\ \text{kg m}^2$, damping $B=1.0$ N m s/rad and a torque limit of $\pm40$ N m. The rotor of motor 2 also turns with link 1, at $\dot q_1+G\dot q_2$, which adds $J_m$ to $M_{11}$ and $GJ_m=0.003\ \text{kg m}^2$ to $M_{12}$. With the link values of `lagrangian-dynamics-of-an-open-chain-robot`, the total inertia at joint 1 is $1.557$ with the arm extended ($q_2=0$), $1.157$ at $q_2=90^\circ$ and $0.757\ \text{kg m}^2$ folded ($q_2=180^\circ$). At joint 2 it is $0.407\ \text{kg m}^2$ in every pose.

### PID, with gains by pole placement

The continuous PID law is $\tau=K_pe+K_i\int e\,dt+K_d\dot e$ with $e=q_d-q$. For a joint $J\ddot q+B\dot q=\tau$, the error dynamics with PID have the characteristic polynomial $Js^3+(B+K_d)s^2+K_ps+K_i$. Matching it to $J(s+\alpha)(s+\omega_n)^2$ gives

$$K_p=J(\omega_n^2+2\omega_n\alpha),\qquad K_d=J(2\omega_n+\alpha)-B,\qquad K_i=J\alpha\omega_n^2.$$

With $\omega_n=15$ rad/s and $\alpha=5$ rad/s, and nominal inertias taken at $q_2=90^\circ$:

| Joint | $J$ ($\text{kg m}^2$) | $K_p$ (N m/rad) | $K_i$ (N m/(rad s)) | $K_d$ (N m s/rad) |
|---|---|---|---|---|
| 1 | 1.157 | 433.8 | 1301.3 | 39.48 |
| 2 | 0.407 | 152.5 | 457.5 | 13.23 |

*Modern Robotics* gives the stability conditions for this third-order loop as $K_d>-B$, $K_p>0$ and $(B+K_d)K_p/J>K_i>0$. The upper bounds on $K_i$ are 15182 and 5338 here, far above the gains used. Those conditions hold for the linear model with constant $J$ and constant disturbance, which the arm is not, so the simulations below are the real test.

### The discrete implementation

The controller runs every $T=1$ ms. *Modern Robotics* gives about 1 kHz as a typical rate for the commanded torque. At sample $k$:

```text
e      = q_des - q_k
v_hat  = (q_k - q_{k-1}) / T                    # backward difference of the measurement
v      = Kp*e + I + Kd*(qdot_des - v_hat) + tau_ff
u      = clip(v, -tau_max, +tau_max)            # actuator limit
I      = I + Ki*T*e  [+ (T/Tt)*(u - v)]         # forward Euler; bracket = back-calculation
```

The derivative acts on the measured position, not on the error, so a step in the setpoint does not produce a derivative spike; Åström and Murray's *Feedback Systems* uses the same structure in its pseudocode, together with a filtered derivative that is omitted here because the simulated sensor is ideal, with no noise and no quantization. The torque $u$ is held constant between samples. The arm, which is the full coupled model plus the motor terms, is integrated with the classical fourth-order Runge-Kutta method at a fixed step of 0.1 ms, ten steps per control period.

Sampling moves the poles. For joint 1 at its nominal inertia, the closed loop at $T=1$ ms, computed from the exact discretization of $J\ddot q+B\dot q=u$, has poles $z=0.99496,\ 0.98769,\ 0.98155$, equivalent to $s=-5.05,\ -12.39,\ -18.62$, plus a fast pole at $z=0.018$ from the backward difference: the double pole at $-15$ has split. With the same gains the loop becomes unstable at $T\approx40$ ms for the nominal inertia, at $T\approx29$ ms with the arm folded and at $T\approx49$ ms extended. The lighter configuration is the most sensitive, because the same gains act on less inertia.

### Anti-windup

When the actuator saturates, the loop is effectively open: the torque stays at the limit whatever the error does, and the integrator keeps accumulating error. When the error finally changes sign, the large integral keeps the actuator saturated, and the result is a large overshoot. *Feedback Systems* calls this integrator windup. Two remedies are used below. **Back-calculation**, the scheme of *Feedback Systems*, feeds the difference $u-v$ between the saturated and the unsaturated output back into the integrator with a tracking time constant $T_t$; the book notes that the tracking gain cannot be too large, because measurement noise would then reset the integrator. **Clamping** (conditional integration) skips the integrator update at any sample where the output is saturated and the error has the same sign as $v$, so integrating would push further into saturation.

## Worked Examples

### Example 1: gravity, the integrator, and feed-forward

The arm moves in a vertical plane ($g_0=9.81\ \text{m/s}^2$) from rest at $(-60^\circ,30^\circ)$ to $(30^\circ,90^\circ)$ along $q_d(t)=q_a+(q_b-q_a)\tfrac12(1-\cos\pi t)$ for $0\le t\le1$ s, then holds. Every variant uses the $K_p$ and $K_d$ of the table; "PD" sets $K_i=0$, and gravity feed-forward adds $\tau_{ff}=\hat g(q_d)$. Errors in degrees, joint 1 and joint 2:

```text
controller                    max |e| during move   e at t = 1.5 s      e at t = 3 s      peak |u| (N m)
PD                            3.42, 3.22            1.747, -0.713       1.746, -0.714     30.0, 9.7
PID                           2.88, 2.73            0.200, -0.003       0.000, 0.000      31.4, 10.3
PD + exact gravity ff         1.61, 1.79            0.001, 0.002        0.000, 0.000      28.4, 9.2
PD + gravity ff, m2 20% low   1.85, 2.08            0.177, -0.145       0.176, -0.147     28.7, 9.3
PID + gravity ff, m2 20% low  1.62, 1.77            0.251, 0.099        0.000, 0.000      29.5, 9.7
```

No run saturated. PD holds the arm with a steady error because, at rest, its torque $K_pe$ is nonzero only if $e$ is: *Modern Robotics* writes this for one joint as $K_p\theta_e=mgr\cos\theta$. For two joints the steady error solves $K_pe=g(q_b-e)$, and solving that with `scipy.optimize.fsolve` gives $(1.7465^\circ,\ -0.7140^\circ)$, the simulated value. The integrator removes the error, but slowly, since $e(1.5\ \text{s})$ is still $0.2^\circ$ at joint 1. Exact gravity feed-forward removes it with no integrator and halves the error during the move. With a gravity model whose $m_2$ is 20% low, feed-forward alone leaves $0.18^\circ$; adding the integrator removes it. In these runs feed-forward did the bulk of the work and the integrator corrected the model error.

### Example 2: the same gains, three inertias

Gravity off (a horizontal plane), joint 2 held at $q_2$ by its own loop, joint 1 commanded a $2^\circ$ step. The same joint-1 gains, designed for $q_2=90^\circ$, meet three different plants:

```text
q2       J at joint 1   continuous poles (rad/s)     overshoot   2% settling   joint 2 disturbed by
0 deg    1.557          -10.67 +- 8.07j, -4.67       25.4%       0.833 s       0.23 deg
90 deg   1.157          -15, -15, -5                 20.7%       0.864 s       0.09 deg
180 deg  0.757          -40.35, -7.36, -5.79         17.6%       0.892 s       0.08 deg
```

The poles listed are those of $Js^3+(B+K_d)s^2+K_ps+K_i$ with the actual $J$. Extended, the arm is heavier than the design assumed and the poles become complex; folded, it is lighter, one pole moves far left and, as the previous section showed, the sampled loop loses stability at a shorter sampling period. The link inertia alone varies by a factor of 2.75 between the extended and folded poses; the reflected rotor inertia, the same in every pose, reduces that to 2.06, which keeps the change in the transient moderate. Even the PID at the design inertia overshoots by 20.7% although its poles are real, because the PID adds zeros: the proportional and integral terms act on the error and respond to the step itself.

### Example 3: coupling

Gravity off; joint 1 moves $0^\circ\to90^\circ$ in 0.75 s along the cosine profile while joint 2 is commanded to stay at $90^\circ$. Along the desired motion, the torque that joint 1's motion imposes on joint 2, $M_{21}\ddot q_1+(C\dot q)_2$, peaks at 2.41 N m. Peak errors in degrees:

```text
controller                                                    max |e1|   max |e2|
PID only                                                      2.007      0.941
PID + per-joint feed-forward J_i qdd_d + B qd_d               0.030      0.866
PID + model feed-forward (M + M_rot) qdd_d + C qd_d + B qd_d  0.033      0.003
```

Joint 2 was told to stay still and moved almost $1^\circ$, purely because joint 1 moved. A per-joint feed-forward, still independent, fixes joint 1 and leaves joint 2 untouched, since what disturbs joint 2 comes from the other joint. Only feed-forward computed from the coupled model, which needs every joint's trajectory, removes it. That is no longer independent joint control; *Modern Robotics* calls the centralized version computed torque control. Shortening the move to 0.5 s doubled the joint-2 error to $1.89^\circ$ and drove joint 1 into the 40 N m limit.

### Example 4: windup

Gravity on, joint 2 at $0^\circ$, joint 1 steps from hanging ($-90^\circ$) to horizontal ($0^\circ$). The proportional term alone asks for $433.8\cdot\pi/2=681$ N m, so the motor saturates at 40 N m. With $T_i=K_p/K_i=0.333$ s:

```text
scheme                       peak q1   lowest q1 after peak   within 0.5 deg after   time saturated   max integral (N m)
no anti-windup               67.5 deg  -47.9 deg              2.79 s                 1.81 s           513
back-calculation, Tt = Ti    15.6 deg  0.0 deg                1.30 s                 0.37 s           142
back-calculation, Tt = Ti/10 0.0 deg   0.0 deg                1.26 s                 0.15 s           21.1
clamping                     4.3 deg   0.0 deg                0.95 s                 0.30 s           48.9
```

Without anti-windup the integral climbs to 513 N m while the arm is still rising, and the arm swings $67.5^\circ$ past the target and then $47.9^\circ$ below it. In every scheme the integral ends at 21.09 N m, which is $g_1(0,0)$: the integrator has learned the gravity torque that feed-forward would have supplied. The faster tracking time removed the overshoot entirely in this simulation; with a noisy sensor that choice would have to be weighed against the noise warning above, which an ideal sensor cannot show. Joint 2, never commanded to move, deviated by up to $4.6^\circ$ without anti-windup and $2.2^\circ$ to $3.6^\circ$ with it.

## Common Misconceptions & Pitfalls

- **"Each joint is a separate system."** Example 3 moved a joint that was commanded to stay still. The independence is a design choice, not a property of the arm.
- **"Gains tuned in one pose work in all poses."** The inertia at joint 1 changed by a factor of 2 between poses, which moved the poles and the sampling period at which the loop goes unstable.
- **"The integrator is the cure for gravity."** It works, slowly. Feed-forward of a gravity model does most of the work, and the integrator cleans up the model error. *Modern Robotics* notes that in practice many robot controllers use $K_i=0$ "since stability is paramount".
- **"Saturation is the actuator's problem."** It breaks the loop, and the integrator turns a saturation into a 67.5° overshoot without anti-windup.
- **"Continuous gains carry over unchanged."** Sampling at 1 ms already split the double pole, and the same gains destabilize the folded arm at about 29 ms.

## Summary

Independent joint control treats each joint as a geared motor driving the inertia $G^2J_m+\bar M_{ii}$, and puts everything else, gravity, coupling and the change of $M_{ii}$, into a disturbance. A discrete PID at $T=1$ ms with forward-Euler integration, a backward-difference derivative of the measurement and gains placed at $-5$, $-15$, $-15$ rad/s tracked a 1 s move to within $2.9^\circ$ and removed the steady error that PD left ($1.75^\circ$ at joint 1); gravity feed-forward removed it without an integrator and halved the tracking error. Saturation without anti-windup produced a $67.5^\circ$ overshoot, and back-calculation or clamping cut it to $0^\circ$ to $15.6^\circ$. What the method ignores showed up directly: the same gains gave different poles in different poses, and a joint commanded to stay still moved by almost $1^\circ$ when its neighbor moved, an error that only model-based feed-forward across joints removed.

## Documentation Links

- [Modern Robotics, Lynch and Park (2017 preprint PDF)](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 8.9 models geared DC motors and the reflected inertia $G^2I_{rotor}$; Section 11.4 covers single-joint PID with its stability conditions and pseudocode, feed-forward, decentralized control, and computed torque.
- [Feedback Systems, Åström and Murray (2008), complete PDF](http://www.cds.caltech.edu/~murray/books/AM08/pdf/am08-complete_22Feb09.pdf): Chapter 10 on PID control, including integrator windup, anti-windup by back-calculation, derivative filtering, setpoint weighting and a computer implementation.
- [MIT OCW 2.12 Introduction to Robotics, Asada, Chapter 2: Actuators and Drive Systems](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter2/): DC motors, gear reduction, and the effective inertia and damping reflected to a single joint axis.
- [SciPy, scipy.linalg.expm](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html): the matrix exponential used for the exact discretization behind the sampled poles.
