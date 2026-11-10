---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Read a rotation matrix as the axes of one frame written in another, and check the two conditions that define it, $R^TR=I$ and $\det R=1$.
- Use the same matrix actively (rotate a vector) and passively (re-express a fixed vector in a rotated frame), and predict the sign difference.
- Compose rotations about fixed axes by pre-multiplication and about the moving body's axes by post-multiplication.
- State the ZYX Euler convention used in this track, recognize that it equals roll-pitch-yaw about fixed axes taken in the reverse order, and see a library convention give a different matrix for the same three numbers.
- Show gimbal lock as a rank loss of the map from Euler-angle rates to angular velocity, and measure what it does to the angles near the lock.

## Context & Motivation

`what-a-robot-is-classification-components-and-degrees-of-freedom` counted 6 degrees of freedom for a rigid body in space: 3 for position and 3 for orientation. Position is a vector. Orientation needs a representation, and every later computation in this track (poses, Jacobians, controllers) inherits the one chosen here.

`orthogonality-and-orthogonal-matrices` showed that a square matrix with orthonormal columns satisfies $Q^{-1}=Q^T$ and that such matrices are rotations, reflections, or combinations of the two. Robotics needs the rotations only, and needs to be explicit about four conventions that textbooks and libraries choose differently: which way a matrix acts, which frame an axis belongs to, the order of Euler angles, and the sign of an angle. Mixing two of them gives a valid-looking rotation matrix with the wrong orientation, and nothing in the matrix itself signals the mistake.

## Core Theory

### Conventions used in this track

Vectors are columns. Frames are right-handed, and a positive angle turns counterclockwise when the axis points at the viewer. Following *Modern Robotics* (Lynch and Park), $R_{sb}$ is the orientation of frame $\{b\}$ relative to frame $\{s\}$: its columns are the unit axes $\hat x_b,\hat y_b,\hat z_b$ written in $\{s\}$ coordinates. The elementary rotations are

$$R_x(\theta)=\begin{pmatrix}1&0&0\\0&c&-s\\0&s&c\end{pmatrix},\quad R_y(\theta)=\begin{pmatrix}c&0&s\\0&1&0\\-s&0&c\end{pmatrix},\quad R_z(\theta)=\begin{pmatrix}c&-s&0\\s&c&0\\0&0&1\end{pmatrix},$$

with $c=\cos\theta$, $s=\sin\theta$. The minus sign in $R_y$ sits in the lower-left corner, unlike the other two, because the cyclic order is $z\to x$ for a rotation about $y$.

### The group SO(3)

Unit columns give 3 equations and pairwise orthogonal columns give 3 more, together $R^TR=I$. Nine entries minus six constraints leave 3 free parameters, matching the count of the previous lesson. Those six constraints allow $\det R=\pm1$; requiring $\det R=+1$ keeps the right-handed frames and excludes reflections. The set of such matrices is the special orthogonal group $SO(3)$. A product of rotations is a rotation, the inverse is the transpose, a rotation preserves lengths, and in three dimensions $R_1R_2\neq R_2R_1$ in general (plane rotations do commute).

### Three uses, and active versus passive

*Modern Robotics* lists three uses of a rotation matrix: to represent an orientation, to change the frame in which a vector is written, and to rotate a vector or frame. The last two are the readings known as passive (alias) and active (alibi).

- **Active**: the vector moves, the frame stays. $v'=Rv$ gives the coordinates of the rotated vector in the same frame.
- **Passive**: the vector stays, the frame changes. If $v_b$ are the coordinates of a vector in $\{b\}$, then $v_s=R_{sb}v_b$, so the coordinates in the rotated frame are $v_b=R_{sb}^Tv_s$.

The same $R$ therefore acts with opposite sign in the two readings: rotating a vector by $+\theta$ produces the same numbers as describing the unmoved vector in a frame turned by $-\theta$. Frame changes chain by cancelling the inner subscripts, $R_{ab}R_{bc}=R_{ac}$ and $R_{ab}v_b=v_a$.

### Fixed axes and moving axes

Rotating a frame $\{b\}$ by $R=\operatorname{Rot}(\hat\omega,\theta)$ is ambiguous until one says in which frame $\hat\omega$ is written:

$$R_{sb'}=R\,R_{sb}\quad(\hat\omega\text{ in the fixed frame }\{s\}),\qquad R_{sb''}=R_{sb}\,R\quad(\hat\omega\text{ in the body frame }\{b\}).$$

So successive rotations about fixed axes pile up on the left, and successive rotations about the body's own, moving axes pile up on the right.

### Euler angles: the ZYX convention

This track uses the **ZYX Euler angles** of *Modern Robotics* (Appendix B): starting from $\{b\}$ aligned with $\{s\}$, rotate by $\alpha$ about the body $\hat z_b$, then by $\beta$ about the new $\hat y_b$, then by $\gamma$ about the newest $\hat x_b$. Body-axis rotations post-multiply, so

$$R(\alpha,\beta,\gamma)=R_z(\alpha)R_y(\beta)R_x(\gamma)=\begin{pmatrix}c_\alpha c_\beta&c_\alpha s_\beta s_\gamma-s_\alpha c_\gamma&c_\alpha s_\beta c_\gamma+s_\alpha s_\gamma\\s_\alpha c_\beta&s_\alpha s_\beta s_\gamma+c_\alpha c_\gamma&s_\alpha s_\beta c_\gamma-c_\alpha s_\gamma\\-s_\beta&c_\beta s_\gamma&c_\beta c_\gamma\end{pmatrix}.$$

Read right to left, the same product is a rotation by $\gamma$ about the fixed $\hat x_s$, then $\beta$ about the fixed $\hat y_s$, then $\alpha$ about the fixed $\hat z_s$. *Modern Robotics* calls this the XYZ roll-pitch-yaw angles: one matrix, two physical stories. When $\cos\beta\neq0$ the angles come back as

$$\beta=\operatorname{atan2}\!\big(-r_{31},\sqrt{r_{11}^2+r_{21}^2}\big),\quad\alpha=\operatorname{atan2}(r_{21},r_{11}),\quad\gamma=\operatorname{atan2}(r_{32},r_{33}),$$

with $\beta\in[-90°,90°]$. Other texts use ZYZ, XYZ, or other orders, and libraries encode the difference in a string. In SciPy's `Rotation.from_euler`, uppercase letters mean intrinsic (body) axes and lowercase letters mean extrinsic (fixed) axes. So `'ZYX'` is the convention above, while `'zyx'` with the same three numbers is $R_x(\gamma)R_y(\beta)R_z(\alpha)$, a different rotation.

### Gimbal lock

At $\beta=\pm90°$ the first and third rotation axes line up, and the matrix depends only on $\alpha-\gamma$ (for $\beta=+90°$) or $\alpha+\gamma$ (for $\beta=-90°$). Only one combination of the first and third angles matters, so the coordinates lose a dimension. The cleanest way to see the loss is through velocities. The angular velocity in $\{s\}$ produced by angle rates is

$$\omega_s=E(\alpha,\beta)\begin{pmatrix}\dot\alpha\\\dot\beta\\\dot\gamma\end{pmatrix},\qquad E=\Big(\hat z\;\;\;R_z(\alpha)\hat y\;\;\;R_z(\alpha)R_y(\beta)\hat x\Big),$$

where each column is a rotation axis, written in $\{s\}$, at the moment its angle acts. Its determinant is $-\cos\beta$. At $\beta=\pm90°$ the third column is $\mp$ the first, $E$ has rank 2, angular velocities outside its two-dimensional range cannot be produced by any angle rates, and near the lock they need very large ones. Nothing happens to the rotation itself: $SO(3)$ looks the same everywhere, and the singularity belongs to the coordinates, as the poles belong to latitude and longitude rather than to the sphere. *Modern Robotics* notes that such singularities are unavoidable for any three-parameter representation of rotation, a reason to store orientation as a matrix or a unit quaternion (both treated in *Modern Robotics*) and to keep Euler angles for input and display.

## Worked Examples

### Example 1: checking that a matrix is a rotation

$R=R_z(30°)R_y(20°)R_x(10°)$ evaluates to

$$R=\begin{pmatrix}0.8138&-0.4410&0.3785\\0.4698&0.8826&0.0180\\-0.3420&0.1632&0.9254\end{pmatrix}.$$

In float64, $\lVert R^TR-I\rVert_F=3.2\times10^{-17}$ and $\det R=1.0000000000000002$. For $x=(1,2,2)$, $\lVert x\rVert=\lVert Rx\rVert=3$. The mirror $\operatorname{diag}(1,1,-1)$ also satisfies $F^TF=I$, but $\det F=-1$: it is orthogonal and not a rotation, and it would turn a right-handed frame into a left-handed one.

### Example 2: active and passive with the same matrix

Let $R=R_z(30°)$ and $v=(1,0,0)$.

```text
active,  R v      = ( 0.866,  0.5,  0)   the vector turned 30 degrees
passive, R^T v    = ( 0.866, -0.5,  0)   the same vector, in a frame turned 30 degrees
dot with b axes   = ( 0.866, -0.5,  0)   direct check: projections on the columns of R
```

The second component flips sign. A program that calls `R @ v` when it needed the coordinates in the new frame produces exactly this error, and the result is still a unit vector, so no length check catches it.

### Example 3: the same rotation about a fixed axis and about a body axis

Let $R_{sb}=R_z(90°)$, so the body's $\hat x_b$ points along the fixed $\hat y_s$. Apply $R_x(90°)$ both ways:

$$R_x(90°)R_{sb}=\begin{pmatrix}0&-1&0\\0&0&-1\\1&0&0\end{pmatrix},\qquad R_{sb}R_x(90°)=\begin{pmatrix}0&0&1\\1&0&0\\0&1&0\end{pmatrix}.$$

The two orientations differ. Post-multiplication turned the body about its own $\hat x_b$, which is the fixed $\hat y_s$, and the script confirms $R_{sb}R_x(90°)=R_y(90°)R_{sb}$ exactly. Rotating about a body axis equals rotating about wherever that axis currently points in the fixed frame.

### Example 4: ZYX versus zyx

With $(\alpha,\beta,\gamma)=(30°,20°,10°)$:

```text
Rz Ry Rx (this track)           scipy 'zyx' (extrinsic z, then y, then x)
[ 0.8138 -0.4410  0.3785]       [ 0.8138 -0.4698  0.3420]
[ 0.4698  0.8826  0.0180]       [ 0.5438  0.8232 -0.1632]
[-0.3420  0.1632  0.9254]       [-0.2049  0.3188  0.9254]
```

SciPy's `'ZYX'` matches $R_z R_y R_x$ to $2.2\times10^{-16}$, and `'xyz'` with the angles listed as $(\gamma,\beta,\alpha)$ matches it too, which is the roll-pitch-yaw reading. The lowercase `'zyx'` equals $R_x(\gamma)R_y(\beta)R_z(\alpha)$ and differs by up to 0.181 in an entry. The body $\hat x$ axis lands at $(0.8138,0.4698,-0.3420)$ in one and $(0.8138,0.5438,-0.2049)$ in the other, $8.9°$ apart, and the two orientations differ by a rotation of $12.0°$, from one letter case. The atan2 formulas recover $(30°,20°,10°)$ from the first matrix.

### Example 5: gimbal lock, run

With $\alpha=30°$, the singular values of $E$, and of the $9\times3$ Jacobian of the entries of $R$ with respect to $(\alpha,\beta,\gamma)$ at $\gamma=10°$ by central differences:

```text
beta     det E      singular values of E        rank   singular values of d(vec R)   rank
  0.0   -1.00e+00   1.0000  1.0000  1.0000        3     1.4142  1.4142  1.4142          3
 45.0   -7.07e-01   1.3066  1.0000  0.5412        3     1.8478  1.4142  0.7654          3
 80.0   -1.74e-01   1.4088  1.0000  0.1233        3     1.9924  1.4142  0.1743          3
 89.0   -1.75e-02   1.4142  1.0000  0.0123        3     1.9999  1.4142  0.0175          3
 89.9   -1.75e-03   1.4142  1.0000  0.0012        3     2.0000  1.4142  0.0017          3
 90.0   -6.12e-17   1.4142  1.0000  0.0000        2     2.0000  1.4142  0.0000          2
```

The determinant follows $-\cos\beta$ and the smallest singular value goes to zero, so the rank falls from 3 to 2 at $90°$. For $E$ the zero is exact. For the finite-difference Jacobian the smallest singular value at $90°$ is $3.3\times10^{-11}$, difference noise: the rank in the table uses a tolerance of $10^{-6}$, and the default tolerance of `numpy.linalg.matrix_rank` would report 3. At the lock, the angles $(10°,90°,0°)$ and $(40°,90°,30°)$ give matrices that agree to $8.3\times10^{-17}$ (same $\alpha-\gamma$), while $(40°,90°,-30°)$ differs by 0.766. SciPy's `as_euler('ZYX')` on that matrix returns $(10°,90°,0°)$ with the warning "Gimbal lock detected. Setting third angle to zero since it is not possible to uniquely determine all angles."

Near the lock the coordinates become unstable. Turn the body by $0.5°$ about its own $\hat z_b$ and extract the angles again:

```text
start (alpha, beta, gamma)   change in alpha   change in beta   change in gamma
(30, 30.0, 10)                   +0.57             -0.09            +0.28
(30, 89.0, 10)                  +24.38             -0.19           +24.37
(30, 89.9, 10)                  +69.22             -0.43           +69.22
```

The physical rotation is $0.500°$ in every row, measured as the angle of $R_1^TR_2$. A controller that interpolates or differentiates these angles near $\beta=90°$ would command fast, opposite swings of $\alpha$ and $\gamma$ for a tiny motion.

## Common Misconceptions & Pitfalls

- **"Any orthogonal matrix is a rotation."** $\operatorname{diag}(1,1,-1)$ in Example 1 is orthogonal with determinant $-1$.
- **"R rotates the vector, so R also gives its coordinates in the rotated frame."** Example 2: the passive reading needs $R^T$, and the error flips a sign without changing any length.
- **"Rotating about x is the same whichever side it multiplies on."** Example 3: the left factor uses the fixed $x$, the right factor uses the body $x$, and the results differ.
- **"ZYX means the same thing in every library."** Example 4: SciPy distinguishes `'ZYX'` and `'zyx'`, and the same three numbers produced orientations $12.0°$ apart. Write the matrix product next to the angle names.
- **"Gimbal lock is a physical state the object can get stuck in."** The orientation at $\beta=90°$ is an ordinary rotation. Only the three-angle coordinates are singular there, as Example 5's rank drop shows.

## Summary

A rotation matrix $R_{sb}$ holds the axes of $\{b\}$ written in $\{s\}$, and it is defined by $R^TR=I$ with $\det R=1$; the determinant excludes reflections. The same matrix rotates a vector actively ($Rv$) or re-expresses a fixed vector passively ($R^Tv$), and the two differ in sign. Rotations about fixed axes pre-multiply and rotations about body axes post-multiply. This track's Euler convention is ZYX, $R_z(\alpha)R_y(\beta)R_x(\gamma)$, which is also XYZ roll-pitch-yaw about fixed axes, and SciPy's `'zyx'` is a different rotation for the same numbers. At $\beta=\pm90°$ the map from angle rates to angular velocity drops from rank 3 to rank 2, and close to it a $0.5°$ turn changed two angles by $69°$. The orientation is fine; the coordinates are not.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): the free textbook and its videos.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 3.2 on rotation matrices, their three uses, and fixed versus body-frame rotation; Appendix B on ZYX Euler angles, roll-pitch-yaw, and the angle-extraction algorithm.
- [SciPy, Rotation.from_euler](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.from_euler.html): uppercase letters for intrinsic and lowercase for extrinsic sequences.
- [SciPy, Rotation.as_euler](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.as_euler.html): angle ranges, and the gimbal-lock warning that sets the third angle to zero.
- [Wikipedia, Active and passive transformation](https://en.wikipedia.org/wiki/Active_and_passive_transformation): the alibi and alias readings of the same transformation.
