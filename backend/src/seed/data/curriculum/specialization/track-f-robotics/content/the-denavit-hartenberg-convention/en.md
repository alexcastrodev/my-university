---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Name the four Denavit-Hartenberg parameters $a$, $\alpha$, $d$, $\theta$, say which one is the joint variable for a revolute and for a prismatic joint, and read each one off a drawing.
- Assign link frames step by step on a three-joint arm, including the cases of intersecting and parallel axes, and fill in the table.
- Write the link transform of the classic convention and of the modified convention, and say which convention a given source uses.
- Check forward kinematics computed from a table against a product of transforms written directly from the geometry, numerically.
- Recognize what goes wrong when a table written for one convention is fed to the formula of the other.

## Context & Motivation

`forward-kinematics-of-serial-manipulators` wrote the pose of the end effector as a product of link transforms, and `homogeneous-transformations-for-robot-poses` gave each factor its meaning: a $4\times4$ matrix that places one frame in another. Nothing in that recipe says where each link frame should sit. With frames placed freely, each link transform needs six numbers, three for position and three for orientation.

Denavit and Hartenberg (1955) proposed rules for placing the frames so that only four numbers per link remain. Modern Robotics (Lynch and Park, Appendix C) reports that they also showed four to be the minimum. The payoff is a compact table: one row per joint, one column per parameter, one moving entry per row. Murray, Li and Sastry (1994) noted that DH parameters were available for standard industrial robots and used by most commercial simulation and programming systems, and toolkits such as the Robotics Toolbox for Python still build arm models from them.

The trouble is that two incompatible versions of the rules are in common use, and both are called "DH". A table is meaningless unless you know which one wrote it.

## Core Theory

Vectors are columns, and a matrix ${}^{i-1}T_i$ gives the pose of frame $\{i\}$ in frame $\{i-1\}$, so $\mathbf p^{(i-1)}={}^{i-1}T_i\,\mathbf p^{(i)}$. Products are read left to right as motions of the current (moving) frame. Angles are positive by the right-hand rule about the named axis. Write $c_x=\cos x$ and $s_x=\sin x$.

### The idea: only x and z moves

Both conventions put a $z$ axis on every joint axis. For a revolute joint, $z$ is the axis of rotation. For a prismatic joint, $z$ points in the direction of positive travel. Between two consecutive joint axes there is a **common normal**, the line that meets both at right angles, and the $x$ axis is laid along it. With those two choices, getting from one frame to the next takes only a rotation and a translation along $x$ and a rotation and a translation along $z$. Lateral motion along $y$ is never needed, which is where the saving from six numbers to four comes from.

The four numbers are:

| parameter | name | measured |
|---|---|---|
| $a$ | link length | along the common normal, between the two joint axes |
| $\alpha$ | link twist | angle between the two joint axes, about the common normal |
| $d$ | link offset | along a joint axis, between two consecutive common normals |
| $\theta$ | joint angle | angle between two consecutive common normals, about a joint axis |

For a revolute joint $\theta$ is the variable and $a$, $\alpha$, $d$ are constants. For a prismatic joint $d$ is the variable and $\theta$ is constant. The conventions differ in which joint axis gets which frame index, and so in the order of the four motions.

### The classic convention

In the classic convention (also called standard or distal), the axis of joint $i$ is $z_{i-1}$, and frame $\{i\}$ sits at the far end of link $i$. The rules:

1. Put $z_{i-1}$ along the axis of joint $i$.
2. Put $x_i$ along the common normal from $z_{i-1}$ to $z_i$, with origin $o_i$ where that normal meets $z_i$.
3. Then $a_i$ is the distance from $z_{i-1}$ to $z_i$ along $x_i$, $\alpha_i$ the angle from $z_{i-1}$ to $z_i$ about $x_i$, $d_i$ the distance from $o_{i-1}$ to the foot of $x_i$ along $z_{i-1}$, and $\theta_i$ the angle from $x_{i-1}$ to $x_i$ about $z_{i-1}$.

The link transform is a rotation and a translation along $z_{i-1}$, then a translation and a rotation along the new $x$:

$$A_i=\mathrm{Rot}_z(\theta_i)\,\mathrm{Trans}_z(d_i)\,\mathrm{Trans}_x(a_i)\,\mathrm{Rot}_x(\alpha_i)=\begin{pmatrix}c_{\theta_i}&-s_{\theta_i}c_{\alpha_i}&s_{\theta_i}s_{\alpha_i}&a_ic_{\theta_i}\\ s_{\theta_i}&c_{\theta_i}c_{\alpha_i}&-c_{\theta_i}s_{\alpha_i}&a_is_{\theta_i}\\ 0&s_{\alpha_i}&c_{\alpha_i}&d_i\\ 0&0&0&1\end{pmatrix}.$$

### The modified convention

In the modified convention (also called proximal), the axis of joint $i$ is $z_i$, and frame $\{i\}$ sits at the near end of link $i$, on its own joint. The parameters keep their meanings but the twist and length that lead into joint $i$ carry the index $i-1$:

$${}^{i-1}T_i=\mathrm{Rot}_x(\alpha_{i-1})\,\mathrm{Trans}_x(a_{i-1})\,\mathrm{Rot}_z(\theta_i)\,\mathrm{Trans}_z(d_i)=\begin{pmatrix}c_{\theta_i}&-s_{\theta_i}&0&a_{i-1}\\ s_{\theta_i}c_{\alpha_{i-1}}&c_{\theta_i}c_{\alpha_{i-1}}&-s_{\alpha_{i-1}}&-d_is_{\alpha_{i-1}}\\ s_{\theta_i}s_{\alpha_{i-1}}&c_{\theta_i}s_{\alpha_{i-1}}&c_{\alpha_{i-1}}&d_ic_{\alpha_{i-1}}\\0&0&0&1\end{pmatrix}.$$

A rotation about $x$ commutes with a translation along $x$, and the same holds for $z$, so some sources write the factors as $\mathrm{Trans}_x\,\mathrm{Rot}_x\,\mathrm{Rot}_z\,\mathrm{Trans}_z$. That is the same matrix.

### Who uses which

- **Modern Robotics** (Lynch and Park), Appendix C: the modified form, with parameters $\alpha_{i-1}$, $a_{i-1}$, $d_i$, $\phi_i$ and exactly the matrix above. The book does not use the word "modified". Its main text uses the product of exponentials instead of DH.
- **Murray, Li and Sastry** (*A Mathematical Introduction to Robotic Manipulation*), Chapter 3, Section 2.3: the classic matrix, with the joint angle written $\phi_i$.
- **Robotics Toolbox for Python** documentation: classes `RevoluteDH` and `RevoluteMDH`, and a flag that is true "for modified Denavit-Hartenberg notation (eg. Craig's textbook)" and false "for standard Denavit-Hartenberg notation (eg. Siciliano, Spong, Paul)".
- **Wikipedia**, "Denavit-Hartenberg parameters": names Craig's *Introduction to Robotics* (3rd edition) as a book that uses the modified parameters.

Modern Robotics also warns that some authors put the joint axis on $x$ instead of $z$, and concludes that "it is essential to include a concise description of the link frames together with the parameter values."

### Special cases

- **Intersecting axes.** There is no common normal, so $a=0$ and $x$ is taken perpendicular to the plane of the two axes. Either of its two directions works, and the choice flips the sign of $\alpha$.
- **Parallel axes.** There are infinitely many common normals. Pick the one that zeroes the most parameters, usually $d=0$.
- **Base and tool.** The rules leave the first and last frames partly free. Choose them to zero parameters. A frame displaced sideways along $y$ cannot be reached with $x$ and $z$ motions (Modern Robotics gives a pure translation along $y$ as the example), so a tool frame is often added as one extra constant transform after the table.

## Worked Examples

### Example 1: frames on an articulated arm, step by step

The arm has a vertical base joint, a horizontal shoulder joint at height $d_1=0.4$ m, and a horizontal elbow joint parallel to the shoulder. The upper arm is $a_2=0.5$ m and the forearm, measured to the tool tip, is $a_3=0.4$ m. The lengths are assumed.

**Step 1, axes.** Joint 1 axis: vertical through the base. Joint 2 axis: horizontal, perpendicular to the plane of the arm. Joint 3 axis: parallel to joint 2, through the elbow.

**Step 2, classic $z$ axes.** $z_0$ on joint 1, pointing up. $z_1$ on joint 2 and $z_2$ on joint 3, both pointing the same way, chosen so that a positive $\theta_2$ lifts the arm. With $x_0$ pointing along the arm at $\theta_1=0$, this makes $z_1=-y_0$ at $\theta_1=0$.

**Step 3, frame 1.** $z_0$ and $z_1$ intersect at the shoulder, so $a_1=0$ and $o_1$ is the shoulder. $x_1$ must be perpendicular to both, so it is horizontal, in the plane of the arm. The angle from $z_0$ (up) to $z_1$ about $x_1$ is $+90^\circ$, since $\mathrm{Rot}_x(90^\circ)$ sends $(0,0,1)$ to $(0,-1,0)$. The shoulder is $0.4$ m up $z_0$, so $d_1=0.4$.

**Step 4, frame 2.** $z_1\parallel z_2$, so the common normal is chosen along the upper arm: $x_2$ points from shoulder to elbow, $o_2$ is the elbow, $a_2=0.5$, $\alpha_2=0$, $d_2=0$.

**Step 5, tool frame.** $o_3$ at the tip, $x_3$ along the forearm, $z_3\parallel z_2$: $a_3=0.4$, $\alpha_3=0$, $d_3=0$.

| $i$ | $a_i$ (m) | $\alpha_i$ | $d_i$ (m) | $\theta_i$ |
|---|---|---|---|---|
| 1 | $0$ | $90^\circ$ | $0.4$ | $\theta_1$ |
| 2 | $0.5$ | $0$ | $0$ | $\theta_2$ |
| 3 | $0.4$ | $0$ | $0$ | $\theta_3$ |

At $\theta=(0,0,0)$ the product gives a tip at $(0.9,0,0.4)$: arm horizontal, stretched along $x_0$, as the frames were drawn. At $\theta=(30^\circ,45^\circ,-60^\circ)$:

$${}^0T_3=A_1A_2A_3=\begin{pmatrix}0.8365&0.2241&0.5&0.6408\\0.4830&0.1294&-0.8660&0.3700\\-0.2588&0.9659&0&0.6500\\0&0&0&1\end{pmatrix}.$$

### Example 2: checking the table against a direct product

The check must not reuse the table. Describe the same arm by its physical motions: turn about the vertical by $\theta_1$, rise $d_1$, pitch up by $\theta_2$ (a rotation about $-y$), move $a_2$ along the arm, pitch by $\theta_3$, move $a_3$:

$$T_{\text{dir}}=\mathrm{Rot}_z(\theta_1)\,\mathrm{Trans}_z(d_1)\,\mathrm{Rot}_y(-\theta_2)\,\mathrm{Trans}_x(a_2)\,\mathrm{Rot}_y(-\theta_3)\,\mathrm{Trans}_x(a_3).$$

At the same angles its last column is $(0.6408,0.3700,0.6500)$, which also matches the plane-geometry formula $\big(c_1r,\ s_1r,\ d_1+a_2s_2+a_3s_{23}\big)$ with $r=a_2c_2+a_3c_{23}=0.7399$. The rotation parts differ, and $T_{\text{dir}}^{-1}\,{}^0T_3=\mathrm{Rot}_x(90^\circ)$: the direct frame keeps its $y$ axis on the joint axis, the DH frame puts $z$ there. That offset is a choice of tool frame, so it must be the same at every configuration. With `rng = numpy.random.default_rng(5)` and 1000 configurations drawn from `rng.uniform(-pi, pi, (1000, 3))`, the largest entry of $\lvert{}^0T_3-T_{\text{dir}}\mathrm{Rot}_x(90^\circ)\rvert$ was $2.2\times10^{-16}$. With the sign of $\alpha_1$ flipped to $-90^\circ$, the same test fails at once: positive $\theta_2$ now lowers the arm, and at the example angles the tip lands at height $0.15$ m instead of $0.65$ m.

### Example 3: the same arm in the modified convention

Now $z_i$ sits on joint $i$. Frame $\{1\}$ has $z_1$ vertical (joint 1) with its origin at shoulder height. Frame $\{2\}$ has $z_2$ on the shoulder axis, at the shoulder. Frame $\{3\}$ has $z_3$ on the elbow axis, at the elbow. The tip needs one more constant row, since no joint lives there.

| $i$ | $\alpha_{i-1}$ | $a_{i-1}$ (m) | $d_i$ (m) | $\theta_i$ |
|---|---|---|---|---|
| 1 | $0$ | $0$ | $0.4$ | $\theta_1$ |
| 2 | $90^\circ$ | $0$ | $0$ | $\theta_2$ |
| 3 | $0$ | $0.5$ | $0$ | $\theta_3$ |
| tool | $0$ | $0.4$ | $0$ | $0$ |

The final pose equals the classic ${}^0T_3$ to $2.2\times10^{-16}$ on the same 1000 configurations. The intermediate frames do not agree, and that is the visible difference between the conventions:

```text
frame   classic origin            classic z          modified origin           modified z
{1}     (0, 0, 0.4)  shoulder     shoulder axis      (0, 0, 0.4)               vertical (joint 1)
{2}     (0.306, 0.177, 0.754)     elbow axis         (0, 0, 0.4)  shoulder     shoulder axis
{3}     (0.641, 0.370, 0.650) tip elbow axis         (0.306, 0.177, 0.754)     elbow axis
```

Classic frame $\{i\}$ is on joint $i+1$, modified frame $\{i\}$ is on joint $i$. Anything indexed by frame, such as a center of mass or an inertia written "in frame 2", changes meaning between the two.

### Example 4: a prismatic joint, and mixing conventions

A SCARA-type arm has two vertical revolute joints and a vertical prismatic joint that moves the tool down. Assume a shoulder height $0.5$ m and link lengths $0.4$ m and $0.3$ m. In the classic convention $z_2$ points down along the travel, so $\alpha_2=180^\circ$, and the variable sits in the $d$ column:

| $i$ | $a_i$ (m) | $\alpha_i$ | $d_i$ (m) | $\theta_i$ |
|---|---|---|---|---|
| 1 | $0.4$ | $0$ | $0.5$ | $\theta_1$ |
| 2 | $0.3$ | $180^\circ$ | $0$ | $\theta_2$ |
| 3 | $0$ | $0$ | $d_3$ | $0$ |

At $(30^\circ,45^\circ,0.1\text{ m})$ the tip is $(0.4241,0.4898,0.4000)$, which is $\big(0.4c_1+0.3c_{12},\ 0.4s_1+0.3s_{12},\ 0.5-d_3\big)$. The modified table, rows $(0,0,0.5,\theta_1)$, $(0,0.4,0,\theta_2)$, $(180^\circ,0.3,d_3,0)$, gives the same pose to $1.1\times10^{-16}$ over 1000 random configurations from the same generator.

Now the common mistake. Feed the classic table of Example 1 into the modified formula at $(30^\circ,45^\circ,-60^\circ)$: the tip comes out at $(0.5365,-0.4000,0.6364)$, $0.78$ m from the true $(0.6408,0.3700,0.6500)$. The modified table fed to the classic formula is off by $1.16$ m. Neither error raises an exception, since both results are valid rigid transforms. Only a check against an independent computation, as in Example 2, catches it.

## Common Misconceptions & Pitfalls

- **"A DH table describes the robot."** It describes the robot plus a convention plus a set of frame choices. Without the convention, the same numbers placed the tip $0.78$ m away in Example 4.
- **"$a_i$ is the length of link $i$."** It is the distance between two joint axes along their common normal. Modern Robotics points out that it "does not necessarily correspond to the actual length of the physical link".
- **"The table is unique."** At intersecting and parallel axes, and at the base and tool, the rules leave choices. Two correct tables for the same arm can differ in signs and zeros.
- **"Classic and modified differ by a shift of index."** The index shifts, the order of the factors changes, and the frames move to different joints (Example 3). The final pose agrees only if the tool row is handled.
- **"Any frame can be a DH frame."** A sideways offset along $y$ cannot be expressed, so tools are often attached with one extra fixed transform.

## Summary

The Denavit-Hartenberg rules put a $z$ axis on every joint and an $x$ axis on every common normal, which reduces each link transform to four parameters: link length $a$, twist $\alpha$, offset $d$ and joint angle $\theta$, with $\theta$ variable for a revolute joint and $d$ variable for a prismatic one. The classic convention puts joint $i$ on $z_{i-1}$ and uses $\mathrm{Rot}_z\mathrm{Trans}_z\mathrm{Trans}_x\mathrm{Rot}_x$. The modified convention puts it on $z_i$ and uses $\mathrm{Rot}_x\mathrm{Trans}_x\mathrm{Rot}_z\mathrm{Trans}_z$. Modern Robotics and Craig use the modified form, Murray, Li and Sastry, Spong, Siciliano and Paul the classic one, according to the sources above. On a three-joint articulated arm both tables reproduced a direct product of transforms to $2.2\times10^{-16}$, while a table read with the wrong formula missed by $0.78$ m without any warning.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Appendix C assigns DH frames, defines the four parameters with the modified indexing, and shows a transform that DH parameters cannot express.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): Chapter 3, Section 2.3 gives the classic DH link transform and relates DH parameters to the product of exponentials.
- [Robotics Toolbox for Python, Denavit-Hartenberg models](https://petercorke.github.io/robotics-toolbox-python/arm_dh.html): link classes for standard and modified DH, their link transforms, and which textbooks use each.
- [Wikipedia, Denavit-Hartenberg parameters](https://en.wikipedia.org/wiki/Denavit%E2%80%93Hartenberg_parameters): the classic and modified matrices side by side, and the books that use the modified form.
