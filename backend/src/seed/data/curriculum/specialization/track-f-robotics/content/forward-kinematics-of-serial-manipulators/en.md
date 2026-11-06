---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define forward kinematics as the map from joint coordinates to the end-effector pose, and say why it is single-valued for an open chain while its inverse is not.
- Write the forward kinematics of a planar revolute chain as a product of one transform per link, and derive the trigonometric closed form from it.
- Compute the pose of a planar 2R and 3R arm and check it three ways: the product of link transforms, the closed form, and the product-of-exponentials formula.
- Show with numbers that different joint vectors can put the tool tip at the same point, and that the 2R workspace is an annulus.
- Recognize the common implementation errors (degrees as radians, absolute instead of relative angles, link factors in the wrong order) and estimate how a joint error moves the tip.

## Context & Motivation

`homogeneous-transformations-for-robot-poses` composed poses along a chain of frames. A serial manipulator is such a chain in which each link's transform depends on a single joint variable. Forward kinematics evaluates that chain: given the joint angles reported by the encoders, where is the tool, and which way does it point? It is the first map the controller needs, and the later lessons on inverse kinematics, Jacobians, and dynamics differentiate or invert it.

Planar arms keep the geometry visible while every step stays the same as in space. The link frames here are placed by hand. `the-denavit-hartenberg-convention` replaces that with a systematic rule that works for spatial arms.

## Core Theory

### The forward kinematics map

For an $n$-joint open chain with joint vector $\theta=(\theta_1,\dots,\theta_n)$, the forward kinematics is

$$\theta\mapsto T_{0e}(\theta)\in SE(3),$$

the pose of the end-effector frame $\{e\}$ in the base frame $\{0\}$. *Modern Robotics* points out that for an open chain this pose is uniquely determined by the joint positions, while a given pose may come from several joint vectors or from none. Each joint sets one relative motion, and the chain multiplies them in order, so the map is a product and needs no solving.

### Link transforms for a planar revolute chain

Place frame $\{0\}$ at joint 1, and frame $\{i\}$ at the far end of link $i$ with its $\hat x_i$ along the link. All $\hat z$ axes point out of the plane. Joint $i$ rotates by $\theta_i$ about $\hat z$, then link $i$ carries the next frame a distance $L_i$ along the new $\hat x$:

$$T_{i-1,i}(\theta_i)=\operatorname{Rot}_z(\theta_i)\operatorname{Trans}_x(L_i)=\begin{pmatrix}\cos\theta_i&-\sin\theta_i&0&L_i\cos\theta_i\\\sin\theta_i&\cos\theta_i&0&L_i\sin\theta_i\\0&0&1&0\\0&0&0&1\end{pmatrix},$$

$$T_{0e}=T_{01}(\theta_1)\,T_{12}(\theta_2)\cdots T_{n-1,n}(\theta_n),\qquad\{e\}=\{n\}.$$

Each $\theta_i$ is relative: the angle of link $i$ measured from link $i-1$. Multiplying out, the rotations add and each link's vector is turned by the sum of the angles before it. With $\phi_i=\theta_1+\dots+\theta_i$,

$$x=\sum_{i=1}^{n}L_i\cos\phi_i,\qquad y=\sum_{i=1}^{n}L_i\sin\phi_i,\qquad\phi=\phi_n=\sum_{i=1}^{n}\theta_i.$$

For $n=3$ these are the equations of Asada's MIT 2.12 notes and of Chapter 4 of *Modern Robotics*. *Modern Robotics* places its link frames at the joints instead, $T_{01}=\operatorname{Rot}_z(\theta_1)$, $T_{12}=\operatorname{Trans}_x(L_1)\operatorname{Rot}_z(\theta_2)$, and so on, with a constant $T_{3e}=\operatorname{Trans}_x(L_3)$. By associativity it is the same product regrouped, so the end-effector pose is identical, while the intermediate frames sit at different places.

### A second formula as a cross-check

*Modern Robotics* also writes forward kinematics as a product of exponentials (PoE):

$$T_{0e}(\theta)=e^{[\mathcal S_1]\theta_1}e^{[\mathcal S_2]\theta_2}\cdots e^{[\mathcal S_n]\theta_n}M,$$

where $M$ is the end-effector pose with all joints at zero and $\mathcal S_i$ is the screw axis of joint $i$ in the base frame at that zero configuration. For the planar chain, $M$ is a pure translation by $L_1+\dots+L_n$ along $\hat x$, and joint $i$ is a rotation about $\hat z$ through the point $(L_1+\dots+L_{i-1},0,0)$, so $\mathcal S_i=(0,0,1,\,0,-(L_1+\dots+L_{i-1}),\,0)$. The derivation belongs to that book; here it serves as an independent formula, evaluated with `scipy.linalg.expm`, that must agree with the link product.

### What the map does not tell you

The map is many-to-one in position. For a 2R arm the distance from the base to the tip is

$$r^2=L_1^2+L_2^2+2L_1L_2\cos\theta_2,$$

which depends only on $\theta_2$. So $\theta_2$ and $-\theta_2$ reach the same radius, and turning $\theta_1$ puts both on the same point: elbow up and elbow down. The reachable tip positions form the annulus $\lvert L_1-L_2\rvert\le r\le L_1+L_2$. A planar 3R arm has 3 joints for a 2-dimensional position, so it is redundant for position: a one-parameter family of joint vectors, one for each feasible tool angle, puts the tip on the same point.

The map is also an amplifier of joint errors. Turning joint $i$ by a small $\delta$ swings everything beyond it about that joint, so the tip moves by about $d_i\,\delta$, where $d_i$ is the distance from joint $i$ to the tip. In an extended arm the joints near the base have the longest lever arms; when the arm folds back, that can change. This is the first view of the Jacobian, which `velocity-kinematics-and-the-jacobian` builds properly.

## Worked Examples

Link lengths are assumed values in meters; angles are in degrees in the text and converted to radians before any trigonometric call.

### Example 1: a 2R arm, three ways

$L=(1.0,0.8)$, $\theta=(30°,45°)$. The script prints every frame of the chain:

```text
frame 0 (base)    x = 0.0000   y = 0.0000   heading  0.0
frame 1 (elbow)   x = 0.8660   y = 0.5000   heading 30.0
frame 2 (tip)     x = 1.0731   y = 1.2727   heading 75.0
```

$$T_{0e}=\begin{pmatrix}0.2588&-0.9659&0&1.0731\\0.9659&0.2588&0&1.2727\\0&0&1&0\\0&0&0&1\end{pmatrix}.$$

By the closed form, $x=\cos30°+0.8\cos75°=0.8660+0.2071=1.0731$ and $y=\sin30°+0.8\sin75°=0.5+0.7727=1.2727$, with heading $75°$. The link product and the closed form differ by $0$ in float64, the *Modern Robotics* grouping by $0$, and the PoE formula by $2.2\times10^{-16}$. The reach is $r=1.6647$, and $\sqrt{1+0.64+1.6\cos45°}$ gives the same.

### Example 2: two joint vectors, one tip point

The mirrored configuration has $\theta_2'=-45°$ and $\theta_1'=\theta_1+2\operatorname{atan2}(L_2\sin\theta_2,\,L_1+L_2\cos\theta_2)=69.73°$. Forward kinematics of $(69.73°,-45°)$:

```text
configuration         elbow position       tip position        heading
(30.00, 45.00)        (0.8660, 0.5000)     (1.0731, 1.2727)    75.00
(69.73, -45.00)       (0.3464, 0.9381)     (1.0731, 1.2727)    24.73
```

Same tip, different elbow, different tool heading. If the task specifies only the tip position, both are answers; if it also specifies the heading, at most one is. Choosing between such solutions is the subject of `inverse-kinematics-and-workspace`.

### Example 3: a 3R arm

Add a short third link: $L=(1.0,0.8,0.3)$, $\theta=(30°,45°,-60°)$.

```text
frame 0 (base)    x = 0.0000   y = 0.0000   heading  0.0
frame 1           x = 0.8660   y = 0.5000   heading 30.0
frame 2 (wrist)   x = 1.0731   y = 1.2727   heading 75.0
frame 3 (tip)     x = 1.3629   y = 1.3504   heading 15.0
```

$$T_{0e}=\begin{pmatrix}0.9659&-0.2588&0&1.3629\\0.2588&0.9659&0&1.3504\\0&0&1&0\\0&0&0&1\end{pmatrix}.$$

The first two frames are those of Example 1, as they must be: link 3 cannot affect what comes before it. The closed form agrees to $0$, the *Modern Robotics* grouping to $0$, and PoE to $4.4\times10^{-16}$.

Now the redundancy. The configurations below were produced by solving for a chosen tool heading at the same tip; forward kinematics confirms each one:

```text
heading asked   joint angles (deg)               tip from forward kinematics   heading
 15             ( 30.00, 45.00, -60.00)          (1.3629, 1.3504)              15.00
  0             ( 36.37, 34.84, -71.21)          (1.3629, 1.3504)               0.00
 60             ( 19.76, 50.38, -10.14)          (1.3629, 1.3504)              60.00
-45             none: the wrist point is out of reach
```

With heading $-45°$ the wrist would have to be 0.3 m back along that direction, at 1.9405 m from the base, beyond $L_1+L_2=1.8$, so no joint vector exists. Redundancy gives choices, not unlimited ones.

### Example 4: agreement over many configurations

One example can agree by luck. Draw 1000 joint vectors for the 3R arm with `numpy.random.default_rng(42).uniform(-pi, pi, (1000, 3))`:

```text
max |link product - closed form| (position)   6.7e-16
max |link product - PoE|  (all 16 entries)    7.4e-15
max |link product - Modern Robotics grouping| 0.0
```

The differences are rounding, so the three formulas compute the same map.

### Example 5: workspace, sensitivity, and three classic bugs

**Workspace.** For the 2R arm, 20,000 joint pairs from `numpy.random.default_rng(0).uniform(-pi, pi, (20000, 2))` gave tip distances from $0.2000001$ to $1.7999999998$, against the annulus $[0.2,\,1.8]$. Directly, $\theta_2=0°$, $90°$, $180°$ give $r=1.8000$, $1.2806$, $0.2000$.

**Sensitivity.** Add $0.1°$ to one joint and recompute:

```text
arm   joint perturbed   tip displacement   distance joint-to-tip x 0.1 deg
2R    joint 1           2.906 mm           1.6647 m x 0.001745 = 2.906 mm
2R    joint 2           1.396 mm           0.8 m    x 0.001745 = 1.396 mm
3R    joint 1           3.349 mm           1.9186 m x 0.001745 = 3.349 mm
3R    joint 3           0.524 mm           0.3 m    x 0.001745 = 0.524 mm
```

In these configurations the same error cost 2.1 times as much at the base as at the last joint for the 2R arm, and 6.4 times as much for the 3R arm.

**Bugs.** All three run without an error message, and all three are wrong for the 2R arm of Example 1, whose correct tip is $(1.0731,1.2727)$:

```text
bug                                                tip                 heading
degrees passed to cos/sin as radians               (0.8917, -1.2983)
theta_2 used as an absolute angle                  (1.4317,  1.0657)
per-link order Trans_x(L) Rot_z(theta) instead     (1.6928,  0.4000)   75.0
```

The third keeps the correct heading, because the rotations still add to $75°$, so a check of the tool orientation alone would pass it. Checking the elbow position against the closed form catches all three.

## Common Misconceptions & Pitfalls

- **"Forward kinematics needs solving equations."** It is a product of known matrices; only the inverse problem needs solving.
- **"A tip position determines the joint angles."** Example 2 found two configurations for one 2R tip, and Example 3 found three for one 3R tip.
- **"Joint angles are the angles of the links."** They are relative angles; the link angle is the running sum $\phi_i$. Using $\theta_2$ as absolute moved the tip by 0.41 m in Example 5.
- **"The order of the two factors inside a link does not matter."** $\operatorname{Rot}_z(\theta_i)\operatorname{Trans}_x(L_i)$ and $\operatorname{Trans}_x(L_i)\operatorname{Rot}_z(\theta_i)$ give different positions with the same heading.
- **"Where the intermediate frames go changes the answer."** Example 4 showed two frame placements producing the same end-effector pose to 0.0; only the product matters.
- **"Every joint error matters equally."** Example 5: the same $0.1°$ moved the tip 3.35 mm at joint 1 and 0.52 mm at joint 3.

## Summary

Forward kinematics maps joint coordinates to the end-effector pose, and for an open chain it is a product of one transform per link, $T_{0e}=\prod_i\operatorname{Rot}_z(\theta_i)\operatorname{Trans}_x(L_i)$ for a planar revolute arm. Multiplying out gives $x=\sum L_i\cos\phi_i$, $y=\sum L_i\sin\phi_i$, $\phi=\sum\theta_i$ with the $\theta_i$ relative. For a 2R arm at $(30°,45°)$ with lengths $(1.0,0.8)$ the tip is at $(1.0731,1.2727)$; the link product, the closed form, and the product-of-exponentials formula agreed to rounding there and on 1000 random 3R configurations. The map is many-to-one: elbow-up and elbow-down share a 2R tip, a 3R arm reaches one point with many headings, and the 2R workspace is the annulus $\lvert L_1-L_2\rvert\le r\le L_1+L_2$. A joint error moves the tip by roughly its lever arm times the error, so in an extended arm the base joints matter most.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): the free textbook and its videos.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Chapter 4 on forward kinematics of open chains, the planar 3R example as a product of link transforms, and the product-of-exponentials formula.
- [MIT OCW 2.12, Chapter 4 Planar Kinematics (Asada)](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/c8828a16e71c246b78461dd0596b983f_chapter4.pdf): kinematic equations of a three-dof planar arm with relative joint angles.
- [SciPy, scipy.linalg.expm](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html): the matrix exponential used to evaluate the product-of-exponentials check.
