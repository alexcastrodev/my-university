---
version: 1.0
updatedAt: 2026-11-05
---
## Learning Objectives

- Trace one task through poses, inverse kinematics, a joint-space trajectory, joint torques, and a control loop, with each stage feeding the next.
- Check a stage against the one before it: forward kinematics against the inverse, torques against the trajectory, tracking against the torques.
- Size a motor from the peak torque of a planned motion, with a payload.
- Rank controller designs by the tracking error they leave, and say what each design assumes about the model.
- Find a simulation bug from physical reasoning instead of trusting a plausible number.

## Context & Motivation

Each lesson of this discipline answers one question. A pick-and-place asks all of them in order. Where is the object? Which joint angles put the tool there? How should the joints move in between? What torques does that motion demand? Can the controller deliver them? An error at an early stage is carried by every later one, and the final tracking error does not say which stage it came from.

This capstone runs one task on one arm. The arm is the planar two-link arm of `static-forces-and-joint-torques`, `lagrangian-dynamics-of-an-open-chain-robot`, `the-manipulator-equation-inertia-coriolis-gravity`, and `independent-joint-control-and-pid`. Every length, mass, motor value, and gain is an assumption from those lessons, so the numbers describe a model and no real robot. The arm moves in a vertical plane with $g_0=9.81\ \text{m/s}^2$, and everything ran in NumPy 2.5.4.

## Core Theory

### The chain of stages

| Stage | Lesson | Input | Output |
|---|---|---|---|
| Task | (given) | Object and target positions | Tool poses |
| Pose | `homogeneous-transformations-for-robot-poses` | Frames | Tool position in the base frame |
| Inverse kinematics | `inverse-kinematics-and-workspace` | Tool position | Joint angles, one per branch |
| Trajectory | `trajectory-planning-in-joint-space` | Start and end angles, duration | $q(t)$, $\dot q(t)$, $\ddot q(t)$ |
| Dynamics | `the-manipulator-equation-inertia-coriolis-gravity` | $q$, $\dot q$, $\ddot q$, payload | Torques $\tau(t)$ |
| Control | `independent-joint-control-and-pid` | $\tau$, errors | Commanded torques |

The stages are checked by running them backwards. Forward kinematics applied to the inverse's answer must return the pick position. Inverse dynamics applied to the trajectory gives the torque that, fed to the plant, must reproduce the trajectory. The control stage then tests everything at once, because an error in any earlier stage shows up as tracking error.

### Where the error can hide

A joint-space plan is straight in the joint angles and generally curved in the tool path. A torque computed from the wrong model is wrong at every sample, and a feedback loop works against it only after an error has built up. Gains tuned for one pose are tuned for the inertia of that pose. These are three separate sources of error, so a report should isolate each, as the runs below do.

## Worked Examples

### Step 1: poses and inverse kinematics

The task is to move a 1 kg part from a pick position $(0.60,\ 0.10)$ m to a place position $(0.20,\ 0.50)$ m. The arm has $L_1=0.5$ m and $L_2=0.4$ m, so both targets are inside the reach of 0.9 m, at distances 0.608 m and 0.539 m from the base. Inverse kinematics gives two solutions at each target:

```text
target   branch   q1 (deg)   q2 (deg)   fk error   det J     cond J
pick     q2 < 0     50.33     -95.74     2.8e-17   -0.1990    2.21
pick     q2 > 0    -31.40      95.74     8.3e-17    0.1990    2.21
place    q2 < 0    113.32    -107.46     5.6e-17   -0.1908    1.80
place    q2 > 0     23.08     107.46     5.6e-17    0.1908    1.80
```

Forward kinematics returns each target to rounding. Both branches are far from singular, because $\lvert\det J\rvert$ is about 0.2 and the condition number is at most 2.21. The plan uses the branch with $q_2<0$ at both ends. Switching branches mid-task would need a passage through $q_2=0$, which is a singularity, so the choice is made once. Here $\det J=L_1L_2\sin q_2$, which is why the sign of $q_2$ gives the sign of the determinant.

### Step 2: a joint-space trajectory

A quintic from rest to rest in $T=1.5$ s moves the joints by $\Delta q=(62.99^\circ,\ -11.72^\circ)$:

```text
peak joint velocity (deg/s)       78.7   14.6
peak joint acceleration (deg/s2) 161.6   30.1
minimum |det J| on the path       0.1908
largest tool deviation from the straight line: 0.076 m
```

The path stays away from singularities: its smallest $\lvert\det J\rvert$ is the value at the place configuration. The tool does not move on a straight line, because the plan is straight in joint space, and it leaves the chord between the targets by up to 7.6 cm. If the part must follow a line, for example along a conveyor, the plan has to be made in Cartesian space instead.

### Step 3: the torques the motion demands

Inverse dynamics, $\tau=M\ddot q+C\dot q+g$, is evaluated along the trajectory with the model of `the-manipulator-equation-inertia-coriolis-gravity`, with and without a 1 kg point mass at the tool tip:

```text
                   joint 1 (N m)   joint 2 (N m)
peak |tau|, no payload     15.47            3.90
peak |tau|, 1 kg payload   22.20            7.81
gravity alone at start (1 kg payload)      19.60   5.51
gravity alone at start (no payload)       13.71   2.75
```

The motor of `independent-joint-control-and-pid` is $G=100$, $k_t=0.05$ N m/A, and a current limit of 8 A, so it can deliver $G\,k_t\,I_{\max}=40$ N m at the joint. The 1 kg payload's peak of 22.2 N m fits with a margin of 1.8. At this speed the load is mostly gravity: at the start, holding the arm still with the payload takes 19.6 N m and the whole peak is 22.2.

Shortening the move shows where the limit is, between 0.6 s and 0.5 s:

```text
T (s)    peak |tau| (N m)   verdict against 40 N m
1.5          22.2           feasible
1.0          26.0           feasible
0.8          30.0           feasible
0.6          38.5           feasible
0.5          47.2           saturates
```

Peak torque grows slowly while the time shrinks, because gravity does not depend on speed. A reader who expects the torque to scale with $1/T^2$ would be looking at the inertial part only, which is the smaller one here. Below about 0.57 s the 40 N m limit is crossed and the plan has to be slower.

### Step 4: the control loop

The loop is the one of `independent-joint-control-and-pid`: $T_s=1$ ms, forward-Euler integrator, zero-order hold, and the plant integrated by RK4 at 0.1 ms. The gains come from pole placement with $\omega_n=15$ rad/s and $\alpha=5$ rad/s, on the inertia at $q_2=90^\circ$: $K_p=(433.8,\ 152.5)$, $K_i=(1301.3,\ 457.5)$, $K_d=(39.48,\ 13.23)$. The plant has the real 1 kg payload, reflected rotor inertia $G^2J_m=0.3$ kg m$^2$, and damping $G^2b_m=1.0$ N m s/rad. The tip error is the distance between the tool and the tool position of the reference, and the table lists its maximum during the move:

```text
design                                                  max tip error   max joint error
PID, no feed-forward                                        35.74 mm        2.544 deg
PID + gravity feed-forward, model without payload           15.46 mm        1.013 deg
PID + gravity feed-forward, model with payload               4.85 mm        0.456 deg
full inverse dynamics, link terms only                       1.22 mm        0.139 deg
full inverse dynamics, links + rotor, model with payload     0.06 mm        0.007 deg
full inverse dynamics, links + rotor, model without payload 12.87 mm        0.957 deg
```

Each row adds knowledge of the plant, and the error falls from 35.7 mm to 0.06 mm. Two readings matter more than the ranking.

First, a model error costs more than the controller can repair. Forgetting the payload costs 12.9 mm even with the full model, because the feed-forward then asks for the torque of a lighter arm. Second, the rotor terms are not small: leaving out $G^2J_m=0.3$ and the damping raises the error from 0.06 to 1.22 mm, about 20 times, because the rotor inertia is 26% of the nominal inertia of joint 1 and 74% of that of joint 2 (0.3 against 1.157 and 0.407 kg m$^2$). The best row leaves 0.06 mm, not zero. The loop samples at 1 ms and holds the torque between samples, and that residual was not isolated further.

### Step 5: a derivative term that is right for a setpoint and wrong on a trajectory

The derivative term of `independent-joint-control-and-pid` is written on the error, $K_d(\dot q_d-\dot q)$, and it has a variant that takes the derivative of the measurement only, $-K_d\dot q$. The variant avoids a spike when a setpoint jumps and is correct when $\dot q_d=0$. On a trajectory it opposes the motion with a torque $K_d\dot q$, which at the peak speed of joint 1 is $39.48\times1.37\approx54$ N m. The same loop with exact feed-forward, run both ways:

```text
derivative term                       max tip error   max joint error
on the error, Kd (qd_dot - q_dot)          0.063 mm        0.007 deg
on the measurement, -Kd q_dot             36.81 mm         3.803 deg
```

An open-loop run of the same exact feed-forward, with no feedback, reached the end of the trajectory to within $0.03^\circ$, so the model and the feed-forward are consistent and the loop is what moves the result. The wrong variant gives a plausible 37 mm. Only a case with a known answer, here the open-loop run, shows that it is wrong.

## Common Misconceptions & Pitfalls

- **"If the end points are right, the task is right."** The tool left its straight path by 7.6 cm. Targets say nothing about the path between them.
- **"A bigger gain fixes tracking."** Gains do not remove a model error: the table shows 12.9 mm remaining with the right gains and a wrong payload. Higher gains eventually meet the sampling limit of `independent-joint-control-and-pid`.
- **"Gravity compensation is a refinement."** It was the largest single step, 35.7 to 15.5 mm, and with the right payload it brought the error to 4.9 mm.
- **"Peak torque scales with $1/T^2$."** Only the inertial part does. Gravity here dominates, so 1.5 s to 0.8 s moved the peak from 22.2 to 30.0 N m.
- **"A simulation that runs is a simulation that is right."** Step 5's wrong loop ran and gave a plausible error. Check the controller against a case with a known answer, such as open-loop feed-forward.
- **"One configuration's gains fit the arm."** The gains used the inertia at $q_2=90^\circ$. Along this path $q_2$ stays near $-96^\circ$ to $-107^\circ$, so the mismatch is small. A task that folds the elbow would see the inertia move by 2 or more, as in `independent-joint-control-and-pid`.

## Summary

One pick-and-place goes through six stages, and each one is checked against its neighbor. Inverse kinematics returned the targets to rounding and left both branches far from singular. The quintic joint-space plan took 1.5 s and left a straight line by 7.6 cm. Inverse dynamics asked for at most 22.2 N m against a 40 N m limit. In the control loop the error fell from 35.74 mm to 0.06 mm as the controller learned the plant, from gravity alone to links, rotor, and payload, and a missing payload cost 12.9 mm. A derivative term that is correct for a setpoint and wrong for a trajectory showed up only against a case with a known answer. The values depend on assumed lengths, masses, and gains, so they illustrate the method and do not describe a robot.

## Documentation Links

- [Lynch and Park, Modern Robotics: 9.3 Polynomial via-point trajectories](https://modernrobotics.northwestern.edu/nu-gm-book-resource/9-3-polynomial-via-point-trajectories/): the polynomial time scalings used in Step 2.
- [Asada (2005), MIT OCW 2.12, Chapter 7: Dynamics](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter7/): the manipulator equation behind Step 3.
- [Asada (2005), MIT OCW 2.12, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): the Jacobian and singularities checked in Step 1.
- [Tedrake, Underactuated Robotics: Multi-Body Dynamics](https://underactuated.mit.edu/multibody.html): the manipulator equation and the choice of the matrix $C$.
