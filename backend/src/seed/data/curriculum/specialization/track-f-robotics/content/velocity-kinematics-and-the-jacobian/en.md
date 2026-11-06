---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Write the end-effector velocity as $\mathbf v=J_v(\mathbf q)\dot{\mathbf q}$ and $\boldsymbol\omega=J_\omega(\mathbf q)\dot{\mathbf q}$, and read each column of the Jacobian as the motion produced by one joint alone.
- Build the geometric Jacobian column by column from the link frames, with the revolute rule $\big(\mathbf z_{i-1}\times(\mathbf p-\mathbf o_{i-1}),\ \mathbf z_{i-1}\big)$ and the prismatic rule $(\mathbf z_{i-1},\ \mathbf 0)$.
- Check a Jacobian against central finite differences, including the angular rows, and choose the step size.
- Define the analytic Jacobian, relate it to the geometric one through the matrix $T$ of the chosen orientation angles, and say when the two coincide and when they diverge.

## Context & Motivation

Forward kinematics answers "where is the tool". Control needs "how fast does the tool move when the joints move", because motors are commanded in joint velocities and tasks are written in Cartesian ones. `inverse-kinematics-and-workspace` already used the answer inside Newton's method: the matrix of partial derivatives $J=\partial f/\partial\mathbf q$ of a planar arm. That matrix was obtained by differentiating a formula, which works for position. Orientation is different. A rotation matrix is not a vector, and its rate of change is described by an angular velocity $\boldsymbol\omega$ that is not, in general, the derivative of any three numbers. This lesson builds the Jacobian directly from the geometry of the chain, rows for $\boldsymbol\omega$ included, and checks it numerically.

## Core Theory

Conventions: classic DH frames as in `the-denavit-hartenberg-convention`, so joint $i$ moves about or along $\mathbf z_{i-1}$, whose origin is $\mathbf o_{i-1}$. All vectors are expressed in the base frame. The tool point is $\mathbf p$. The Jacobian stacks linear rows on top, $J=\begin{pmatrix}J_v\\J_\omega\end{pmatrix}$. Modern Robotics stacks them the other way, angular on top.

### Velocity kinematics is the chain rule

If $\mathbf p=\mathbf p(\mathbf q(t))$, the multivariable chain rule of `partial-derivatives-and-the-multivariable-chain-rule` gives $\dot{\mathbf p}=\sum_i(\partial\mathbf p/\partial q_i)\,\dot q_i$, one term per route from $\mathbf p$ to $t$. So column $i$ of $J_v$ is the tip velocity when joint $i$ moves at unit rate and every other joint is still. The relation is linear in $\dot{\mathbf q}$ and nonlinear in $\mathbf q$: the matrix changes with the posture.

### Building the geometric Jacobian column by column

A unit rate at a revolute joint spins everything beyond it about the axis $\mathbf z_{i-1}$ through $\mathbf o_{i-1}$. A rigid body spinning at $\boldsymbol\omega$ about an axis through $\mathbf o$ moves its point $\mathbf p$ at $\boldsymbol\omega\times(\mathbf p-\mathbf o)$. A unit rate at a prismatic joint slides everything beyond it along $\mathbf z_{i-1}$ without turning it. Hence

$$J_i=\begin{pmatrix}\mathbf z_{i-1}\times(\mathbf p-\mathbf o_{i-1})\\ \mathbf z_{i-1}\end{pmatrix}\ \text{(revolute)},\qquad J_i=\begin{pmatrix}\mathbf z_{i-1}\\ \mathbf 0\end{pmatrix}\ \text{(prismatic)}.$$

Angular velocities of a serial chain add, each joint contributing its axis times its rate, so the angular rows are just the joint axes. Every quantity needed, $\mathbf z_{i-1}$ and $\mathbf o_{i-1}$, is the third and fourth column of ${}^0T_{i-1}$, which forward kinematics already computes. In the modified convention joint $i$ sits on $\mathbf z_i$ at $\mathbf o_i$, and the same rule applies with that index.

### Naming: what "geometric" means where

This $(\dot{\mathbf p},\boldsymbol\omega)$ Jacobian is what many texts call the geometric Jacobian. Modern Robotics uses the name for its space and body Jacobians, which map $\dot{\mathbf q}$ to a twist, and notes in a footnote that the term has also been used for this mixed form, which it calls "hybrid". The difference is only in the linear part. The space Jacobian's linear part is the velocity $\mathbf v_s$ of the point of the moving body that is momentarily at the base origin, and $\dot{\mathbf p}=\mathbf v_s+\boldsymbol\omega\times\mathbf p$. Before comparing a Jacobian with another source, check which velocity it produces.

### The analytic Jacobian

Suppose orientation is described by three angles $\boldsymbol\phi$, for instance ZYX angles with $R=\mathrm{Rot}_z(\alpha)\,\mathrm{Rot}_y(\beta)\,\mathrm{Rot}_x(\gamma)$ (yaw, pitch, roll, about the moving axes). Differentiating $\boldsymbol\phi(\mathbf q)$ gives the **analytic Jacobian** $J_A=\partial(\mathbf p,\boldsymbol\phi)/\partial\mathbf q$. The angle rates and $\boldsymbol\omega$ are related by $\boldsymbol\omega=T(\boldsymbol\phi)\dot{\boldsymbol\phi}$, where each column of $T$ is the axis of one elementary rotation, expressed in the base frame:

$$T=\begin{pmatrix}\mathbf e_z & \mathrm{Rot}_z(\alpha)\mathbf e_y & \mathrm{Rot}_z(\alpha)\mathrm{Rot}_y(\beta)\mathbf e_x\end{pmatrix}=\begin{pmatrix}0&-s_\alpha&c_\alpha c_\beta\\0&c_\alpha&s_\alpha c_\beta\\1&0&-s_\beta\end{pmatrix},\qquad \det T=-c_\beta.$$

Therefore

$$J_A=\begin{pmatrix}I&0\\0&T(\boldsymbol\phi)^{-1}\end{pmatrix}J,$$

valid wherever $T$ is invertible. Three consequences:

- The linear rows always coincide, because both Jacobians use $\dot{\mathbf p}$ in the base frame.
- The angular rows coincide only when $T=I$. A planar arm is the standard case: its single orientation angle $\phi=\theta_1+\theta_2+\theta_3$ has $\dot\phi=\omega_z$.
- At $\beta=\pm90^\circ$, $T$ is singular and $J_A$ does not exist, even if the arm can rotate freely. This is a **representation singularity**, a property of the chosen angles, not of the robot. Every Euler-angle sequence has one, at some value of its middle angle.

The analytic Jacobian is what you need when the task is written in those angles, for example a controller that tracks a yaw-pitch-roll trajectory. The geometric one is what you need for physical questions such as tool speed, forces through $J^T$, and robot singularities.

## Worked Examples

### Example 1: the articulated arm, column by column

Use the arm and table of `the-denavit-hartenberg-convention` ($d_1=0.4$ m, $a_2=0.5$ m, $a_3=0.4$ m, assumed lengths) at $\mathbf q=(30^\circ,45^\circ,-60^\circ)$. From the frames already computed there:

```text
i   axis z_(i-1)            origin o_(i-1)            p - o_(i-1)
1   (0, 0, 1)               (0, 0, 0)                 (0.6408, 0.3700,  0.6500)
2   (0.5, -0.866, 0)        (0, 0, 0.4)               (0.6408, 0.3700,  0.2500)
3   (0.5, -0.866, 0)        (0.3062, 0.1768, 0.7536)  (0.3346, 0.1932, -0.1035)
```

Taking the cross products,

$$J=\begin{pmatrix}-0.3700&-0.2165&0.0897\\0.6408&-0.1250&0.0518\\0&0.7399&0.3864\\0&0.5&0.5\\0&-0.866&-0.866\\1&0&0\end{pmatrix}.$$

Read the columns. Joint 1 moves the tip horizontally, perpendicular to the arm, at a speed equal to the horizontal reach $r=0.7399$ m, and has no vertical effect. Joints 2 and 3 share an axis direction, so their angular columns are equal. Joint 2's linear column has vertical component $0.7399$, again the horizontal reach, because the shoulder lifts the tip in proportion to how far out it is. The same columns come from differentiating the position formula of that lesson: $\partial\mathbf p/\partial\theta_1=(-s_1r,\ c_1r,\ 0)=(-0.3700,\ 0.6408,\ 0)$.

For a joint velocity $\dot{\mathbf q}=(0.2,-0.1,0.3)$ rad/s, $J\dot{\mathbf q}=(-0.0254,\ 0.1562,\ 0.0419\ \text{m/s};\ 0.1,\ -0.1732,\ 0.2\ \text{rad/s})$.

### Example 2: checking against finite differences

Position rows: perturb one joint by $\pm h$ and take $\big(\mathbf p(\mathbf q+h\mathbf e_i)-\mathbf p(\mathbf q-h\mathbf e_i)\big)/2h$. Angular rows: the rotation matrices are not vectors, but $\dot R\,R^T$ is the skew-symmetric matrix of $\boldsymbol\omega$, so take $\dot R\approx\big(R(\mathbf q+h\mathbf e_i)-R(\mathbf q-h\mathbf e_i)\big)/2h$ and read $\boldsymbol\omega$ off the entries $(3,2)$, $(1,3)$, $(2,1)$ of $\dot RR^T$. The largest difference from the geometric $J$, over all 18 entries:

```text
h          1e-2      1e-4      1e-6      1e-8      1e-10
max diff   1.7e-05   1.7e-09   7.0e-11   ~1e-08    ~5e-07 to 9e-07
```

The central difference has truncation error of order $h^2$, which dominates on the left, and rounding error of order $\varepsilon_{\text{mach}}/h$, which dominates on the right. The last two entries are rounding noise: their digits change with how the forward kinematics is coded, only their order of magnitude is stable. The best step is near $h=10^{-6}$, about the cube root of machine precision. An off-by-one in the origins, using $\mathbf o_i$ instead of $\mathbf o_{i-1}$ (easy when switching conventions), shows up as an entry off by $0.39$, nine orders above this floor. A time-domain check agrees too: $\big(\mathbf p(\mathbf q+\dot{\mathbf q}\,\delta)-\mathbf p(\mathbf q-\dot{\mathbf q}\,\delta)\big)/2\delta$ with $\delta=10^{-6}$ s reproduces $(-0.0254,\ 0.1562,\ 0.0419)$ m/s.

The relation of the naming section also checks out here: for each column, $-\mathbf z_{i-1}\times\mathbf o_{i-1}$ (the space-Jacobian linear part) plus $\mathbf z_{i-1}\times\mathbf p$ reproduces the corresponding column of $J_v$.

### Example 3: a prismatic joint

Use the SCARA of `the-denavit-hartenberg-convention` (assumed shoulder height $0.5$ m, links $0.4$ m and $0.3$ m) at $(30^\circ,45^\circ,0.1\text{ m})$, with tip $\mathbf p=(0.4241,0.4898,0.4000)$. Axes $\mathbf z_0=\mathbf z_1=(0,0,1)$ with origins $(0,0,0)$ and $(0.3464,0.2,0.5)$, and $\mathbf z_2=(0,0,-1)$ because the quill's positive travel is down.

$$J=\begin{pmatrix}-0.4898&-0.2898&0\\0.4241&0.0776&0\\0&0&-1\\0&0&0\\0&0&0\\1&1&0\end{pmatrix}.$$

The third column is just $\mathbf z_2$ on top and zeros below: sliding moves the tool down at 1 m/s per m/s and does not turn it. Rows 4 and 5 are zero, so this arm can never tilt its tool, and the $6\times3$ matrix has rank 3 at best. Finite differences with $h=10^{-6}$ agree to $7.0\times10^{-11}$.

### Example 4: geometric versus analytic, away from any singularity

For the articulated arm at $(30^\circ,45^\circ,-60^\circ)$ the tool's ZYX angles are $(\alpha,\beta,\gamma)=(30^\circ,15^\circ,90^\circ)$: yaw equals $\theta_1$, pitch equals $-(\theta_2+\theta_3)$, roll stays $90^\circ$. So the angular rows of $J_A$ are

$$\begin{pmatrix}1&0&0\\0&-1&-1\\0&0&0\end{pmatrix},\qquad\text{while}\qquad J_\omega=\begin{pmatrix}0&0.5&0.5\\0&-0.866&-0.866\\1&0&0\end{pmatrix}.$$

Both are correct, and they answer different questions: $J_A$ gives angle rates, $J_\omega$ gives the physical spin. Finite differences of the extracted ZYX angles reproduce $T^{-1}J_\omega$ to $8.4\times10^{-11}$. The linear rows are identical.

### Example 5: when only the analytic Jacobian blows up

Take a three-joint wrist with $R=\mathrm{Rot}_z(q_1)\mathrm{Rot}_y(q_2)\mathrm{Rot}_z(q_3)$, all joints revolute. Its angular Jacobian has columns $\mathbf e_z$, $\mathrm{Rot}_z(q_1)\mathbf e_y$ and $\mathrm{Rot}_z(q_1)\mathrm{Rot}_y(q_2)\mathbf e_z$, confirmed by finite differences to $8\times10^{-11}$. Describe its orientation with ZYX angles and drive it toward $\mathbf q=(20^\circ,90^\circ,0)$, where the ZYX pitch reaches $90^\circ$:

```text
q2      cond(J_omega)   max |J_A entry|   ZYX rates for qdot = (0.1, 0.1, 0.1) rad/s
40*     2.75            1.1
80      1.19            5.8               (0.68, 0.10, 0.57)
89      1.018           57.3              (5.83, 0.10, 5.73)
89.9    1.0017          573               (57.40, 0.10, 57.30)
```

(* row at $q_3=30^\circ$, the others at $q_3=0$.) At $q_2=89.9^\circ$ the wrist is almost perfectly conditioned, it spins at $\lvert\boldsymbol\omega\rvert=0.173$ rad/s, and yet yaw and roll must change at about 57 rad/s each. Near pitch $90^\circ$ the yaw axis and the roll axis point in nearly opposite directions, so these two large rates nearly cancel. A controller written in ZYX angles would see a fault that the hardware does not have.

The reverse also happens. At $q_2=0$ the axes of joints 1 and 3 line up, $J_\omega$ has singular values $(1.414,1,0)$, and the wrist really cannot spin about one direction. That is a robot singularity, the subject of `singularities-and-manipulability`. The two kinds are told apart by asking which matrix loses rank: $J$ (the robot) or $T$ (the angles).

## Common Misconceptions & Pitfalls

- **"Angular velocity is the derivative of the Euler angles."** It is $T(\boldsymbol\phi)$ times that derivative. In Example 4 the two differ at an ordinary posture.
- **"The geometric and analytic Jacobians differ everywhere."** Their linear rows are always equal, and for a planar arm the angular row is equal too.
- **"A blow-up in $J_A$ means the robot is singular."** In Example 5 the wrist had condition number $1.0017$ while $J_A$ had entries of 573.
- **"Prismatic columns look like revolute ones."** They have the axis in the linear rows and zeros in the angular rows, and no cross product.
- **"Any finite-difference step works."** The error was $1.7\times10^{-5}$ at $h=10^{-2}$ and of order $10^{-6}$ at $h=10^{-10}$, against $7\times10^{-11}$ near $10^{-6}$.
- **"The geometric Jacobian is the same in every book."** Modern Robotics means a twist Jacobian, whose linear part is not $\dot{\mathbf p}$. Check the velocity before comparing numbers.

## Summary

The Jacobian maps joint rates to end-effector velocity, and its column $i$ is the motion produced by joint $i$ alone. From the link frames, a revolute joint contributes $\mathbf z_{i-1}\times(\mathbf p-\mathbf o_{i-1})$ to the linear rows and $\mathbf z_{i-1}$ to the angular rows, a prismatic joint contributes $\mathbf z_{i-1}$ and zeros. For the articulated arm and the SCARA these columns matched central differences to $7\times10^{-11}$ at the best step, $h=10^{-6}$. The analytic Jacobian differentiates a chosen set of orientation angles and equals $\operatorname{diag}(I,T^{-1})J$: same linear rows, angular rows that differ unless $T=I$ as in a planar arm, and a blow-up wherever $T$ is singular. A ZYX wrist near pitch $90^\circ$ showed angle rates of 57 rad/s while the hardware spun at $0.17$ rad/s and was well conditioned.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Chapter 5 derives the space and body Jacobians, and Section 5.1.5 defines the analytic Jacobian and relates it to the geometric one.
- [MIT OpenCourseWare 2.12, Asada, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): the Jacobian of planar arms as a differential relationship, its column interpretation, and its properties.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): Chapter 3, Section 4.1 derives end-effector velocity and the manipulator Jacobian from twists.
