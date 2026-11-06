---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Package an orientation and a position into a $4\times4$ transform $T_{ab}$ and read it as the pose of frame $\{b\}$ in frame $\{a\}$.
- Compose poses along a chain of frames by cancelling subscripts, and recognize a chain multiplied in the wrong order.
- Invert a pose with $R^T$ and $-R^Tp$, without a general matrix inverse, and explain why the shortcut fails once the matrix contains scale.
- Distinguish displacing a frame along fixed axes (pre-multiplication) from displacing it along its own axes (post-multiplication).
- Detect and repair the loss of orthonormality that long products accumulate in floating point.

## Context & Motivation

`homogeneous-coordinates-and-2d-affine-transformations` appended a 1 to each point so that translation became a matrix product, used a 0 for directions so they ignore translation, and showed that the order of a composition changes the result. `3d-transformations-and-composing-the-model-matrix` moved that to $4\times4$ matrices, including scale. Those facts are taken as known here.

Robotics uses the same matrices with two changes. The upper-left block is restricted to a rotation (no scale, no shear), which makes the inverse exact and almost free. And there are many frames at once: a robot base, a camera, a detected object, a gripper, each link of the arm. Every transform therefore carries two subscripts, and most bugs come from reading them backwards. The goal is a notation in which a wrong product looks wrong before it is run.

## Core Theory

### A pose as a 4x4 matrix

With the conventions of `rotation-matrices-and-rigid-body-orientation` (column vectors, $R_{ab}$ holding the axes of $\{b\}$ written in $\{a\}$), the pose of $\{b\}$ in $\{a\}$ is

$$T_{ab}=\begin{pmatrix}R_{ab}&p_{ab}\\0&1\end{pmatrix},$$

where $p_{ab}$ is the origin of $\{b\}$ written in $\{a\}$. These matrices form the special Euclidean group $SE(3)$, the rigid-body motions. Acting on a point with homogeneous coordinate 1, $T_{ab}$ converts coordinates in $\{b\}$ to coordinates in $\{a\}$:

$$p_a=R_{ab}p_b+p_{ab}.$$

So $T_{ab}$ has two readings, as rotations did: the pose of $\{b\}$ seen from $\{a\}$, which carries frame $\{a\}$ onto frame $\{b\}$, and the converter that carries coordinates from $\{b\}$ to $\{a\}$. The words "from" and "to" swap between the two readings. The tf2 documentation of ROS 2 warns about exactly this: transforming a frame and transforming data represented in it are, in its words, "directly inverse", and the transforms it publishes use the frame formulation.

### Composition along a chain

If $\{b\}$ is known in $\{a\}$ and $\{c\}$ in $\{b\}$, then

$$T_{ac}=T_{ab}T_{bc}=\begin{pmatrix}R_{ab}R_{bc}&R_{ab}p_{bc}+p_{ab}\\0&1\end{pmatrix}.$$

The inner subscripts cancel, $T_{ab}T_{bc}=T_{ac}$, and the product of two rigid motions is again rigid. The position part shows why order matters: $p_{bc}$ is rotated into $\{a\}$ before $p_{ab}$ is added. A chain $T_{a b}T_{bc}T_{cd}\cdots$ is legal only when each second subscript equals the next first subscript; any other product is a matrix without a meaning, even if it has the right shape.

### The inverse without a general inverse

Solving $p_a=Rp_b+p$ for $p_b$ needs only $R^{-1}=R^T$:

$$p_b=R^Tp_a-R^Tp,\qquad T^{-1}=\begin{pmatrix}R^T&-R^Tp\\0&1\end{pmatrix},\qquad T_{ba}=T_{ab}^{-1}.$$

The cost is a transpose (no arithmetic) and one $3\times3$ matrix-vector product, and the result is exact up to that product's rounding. Two shortcuts that look similar are wrong. Transposing the whole $4\times4$ matrix moves $p$ into the bottom row. Using $-p$ for the new translation forgets that $p$ is written in $\{a\}$ and the inverse needs it in $\{b\}$. The formula also depends on $R^TR=I$: a graphics model matrix $M=TRS$ with scale has an upper-left block that is not orthogonal, and then only a general inverse works.

### Displacing a frame: fixed axes or body axes

Let $T=(R,p)$ be a displacement. As with rotations, the side on which it multiplies decides the frame its axis and offset belong to (*Modern Robotics*, Section 3.3.1):

$$T_{sb'}=T\,T_{sb}=\begin{pmatrix}RR_{sb}&Rp_{sb}+p\\0&1\end{pmatrix},\qquad T_{sb''}=T_{sb}\,T=\begin{pmatrix}R_{sb}R&R_{sb}p+p_{sb}\\0&1\end{pmatrix}.$$

Pre-multiplying rotates $\{b\}$ about an axis of the fixed frame (its origin swings around the fixed axis) and then translates by $p$ in fixed coordinates. Post-multiplying translates by $p$ along the body's own axes and then rotates about the new body axis, which leaves the new origin in place.

### Keeping R a rotation

Every product rounds, and a pose that is updated by many small increments, as in integrating a gyroscope or accumulating odometry, drifts away from $SO(3)$. The repair is to replace $R$ by $UV^T$ from its singular value decomposition $R=U\Sigma V^T$, which sets the singular values back to 1. The check is cheap: $\lVert R^TR-I\rVert$ and $\det R$.

## Worked Examples

All lengths are in meters, and the values are assumed for illustration.

### Example 1: where is the object, in the robot's base frame?

A camera $\{c\}$ is mounted 1.2 m above the base origin and 0.5 m along $\hat x_s$, looking straight down: $R_{sc}=R_x(180°)$, so $\hat z_c$ points down. A detector reports an object $\{o\}$ at $(0.1,-0.05,0.9)$ in camera coordinates, with $R_{co}=R_x(180°)R_z(30°)$. Then

$$T_{sc}=\begin{pmatrix}1&0&0&0.5\\0&-1&0&0\\0&0&-1&1.2\\0&0&0&1\end{pmatrix},\quad T_{co}=\begin{pmatrix}0.866&-0.5&0&0.1\\-0.5&-0.866&0&-0.05\\0&0&-1&0.9\\0&0&0&1\end{pmatrix},$$

$$T_{so}=T_{sc}T_{co}=\begin{pmatrix}0.866&-0.5&0&0.6\\0.5&0.866&0&0.05\\0&0&1&0.3\\0&0&0&1\end{pmatrix}.$$

The object sits at $(0.6,0.05,0.3)$, turned $30°$ about the vertical, with its $\hat z_o$ pointing up. The check is physical: 0.9 m down from a camera at 1.2 m is a height of 0.3 m. Multiplying in the wrong order, $T_{co}T_{sc}$, gives a valid rigid transform whose translation is $(0.533,-0.3,-0.3)$, below the base plane. The subscripts ($co$ then $sc$, with $o\neq s$) flag it before any number is computed.

### Example 2: inverting poses

From the formula, $T_{cs}=T_{sc}^{-1}$ has rotation $R_x(180°)$ and translation $(-0.5,0,1.2)$: seen from the camera, the base origin is 1.2 m straight ahead along $\hat z_c$ and 0.5 m along $-\hat x_c$. It agrees with `numpy.linalg.inv` to $0$ in float64, and $T_{cs}T_{sc}=I$ exactly.

For the object, $T_{os}=T_{so}^{-1}$ has rotation $R_z(-30°)$ and translation $-R_{so}^Tp_{so}=(-0.5446,\,0.2567,\,-0.3)$. Inverting each factor and reversing the order gives the same matrix, $T_{oc}T_{cs}$, to $5.6\times10^{-17}$, and `numpy.linalg.inv` agrees to $1.1\times10^{-16}$. The two wrong shortcuts, applied to $T_{so}$:

```text
naive 4x4 transpose, times T_so        "-p" shortcut, times T_so
[ 1       0       0       0.5446]      [ 1  0  0  -0.0554]
[ 0       1       0      -0.2567]      [ 0  1  0  -0.3067]
[ 0       0       1       0.3   ]      [ 0  0  1   0     ]
[ 0.5446 -0.2567  0.3     1.4525]      [ 0  0  0   1     ]
```

Neither product is the identity. The second one is the more dangerous because it keeps the shape of a pose: the rotation is right and the position is off by 31 cm.

### Example 3: a grasp along the chain

A pre-grasp pose puts the gripper $\{g\}$ 10 cm above the object along $\hat z_o$, with its approach axis $\hat z_g$ pointing down: $T_{og}=\big(R_x(180°),\,(0,0,0.10)\big)$. Then

$$T_{sg}=T_{so}T_{og}=\begin{pmatrix}0.866&0.5&0&0.6\\0.5&-0.866&0&0.05\\0&0&-1&0.4\\0&0&0&1\end{pmatrix},$$

the gripper at height 0.4 m pointing down. A corner of the object at $(0.02,0.03,0)$ in $\{o\}$ is at $(0.6023,\,0.0860,\,0.3)$ in $\{s\}$ and at $(0.02,-0.03,0.1)$ in $\{g\}$. The last value comes out the same whether it is computed as $T_{og}^{-1}$ applied in $\{o\}$ or as $T_{sg}^{-1}T_{so}$ applied in $\{o\}$, which is the chain rule $T_{gs}T_{so}=T_{go}$ checked numerically.

### Example 4: the same displacement on either side

Let $T_{sb}=\big(R_x(90°),\,(1,0,0)\big)$ and the displacement $D=\big(R_z(90°),\,(0,0,0.3)\big)$:

$$D\,T_{sb}=\begin{pmatrix}0&0&1&0\\1&0&0&1\\0&1&0&0.3\\0&0&0&1\end{pmatrix},\qquad T_{sb}D=\begin{pmatrix}0&-1&0&1\\0&0&-1&-0.3\\1&0&0&0\\0&0&0&1\end{pmatrix}.$$

In $DT_{sb}$ the origin $(1,0,0)$ swings about the fixed $\hat z_s$ to $(0,1,0)$ and rises 0.3 m along $\hat z_s$. In $T_{sb}D$ the origin moves 0.3 m along the body's $\hat z_b$, which points along $-\hat y_s$, to $(1,-0.3,0)$, and the frame turns about $\hat z_b$ in place. Same $D$, different frames, different results.

### Example 5: where the shortcut breaks, and where rounding breaks R

Take $M=\operatorname{Trans}(1,0,0)\,R_z(90°)\,\operatorname{diag}(2,2,2,1)$, a graphics model matrix with scale. Building "$[R^T,-R^Tp]$" from its blocks and multiplying by $M$ gives $\operatorname{diag}(4,4,4,1)$, not $I$; the block is not orthogonal ($\lVert R^TR-I\rVert_{\max}=3$).

Now compose $R\leftarrow R\,R_z(0.001)R_x(0.002)$ one million times, starting from $I$:

```text
precision   max|R^T R - I| after 1e3   after 1e5   after 1e6   det after 1e6
float32     2.5e-05                    1.9e-03     2.0e-02     0.9946
float64     7.4e-14                    7.6e-12     7.6e-11     1.0000000000 (error 7.6e-11)
```

In float32 the "rotation" shrinks volumes by half a percent and its inverse via $R^T$ is off by about 2%. Replacing $R$ by $UV^T$ from its SVD brings the error back below $7\times10^{-16}$ in both cases. The float64 error grows roughly linearly with the number of products, so a long-running estimator in float64 still needs the repair, only less often.

## Common Misconceptions & Pitfalls

- **"The inverse of a pose is its transpose."** Only the rotation block transposes. Example 2 shows the whole-matrix transpose failing.
- **"Inverting a pose negates the position."** The new position is $-R^Tp$, not $-p$; Example 2's error was 31 cm.
- **"$T_{ab}$ maps points from $\{a\}$ to $\{b\}$."** It takes $b$-coordinates to $a$-coordinates. Read the subscripts right to left.
- **"Any $4\times4$ transform inverts with the shortcut."** Only rigid ones. Example 5's scaled matrix returned $4I$.
- **"If every factor is right, the product is right."** Example 1's reversed product was a valid rigid transform placing the object below the table.
- **"Rotation matrices stay rotations."** In floating point they drift: $2\times10^{-2}$ after a million float32 products in Example 5.

## Summary

A homogeneous transform $T_{ab}=(R_{ab},p_{ab})$ is the pose of $\{b\}$ in $\{a\}$ and the converter from $b$-coordinates to $a$-coordinates. Poses compose along a chain by cancelling inner subscripts, $T_{ac}=T_{ab}T_{bc}$, and a product whose subscripts do not cancel is wrong even when it is a valid matrix. Because $R$ is orthogonal, the inverse is $(R^T,-R^Tp)$, exact and cheap; the whole-matrix transpose and the $-p$ shortcut are wrong, and the formula fails for matrices with scale. A displacement applied on the left uses fixed axes and on the right uses body axes. Long products drift away from $SO(3)$, measurably in float32, and an SVD restores the rotation.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): the free textbook and its videos.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Section 3.3.1 on $SE(3)$, the inverse formula, subscript cancellation, and fixed-frame versus body-frame displacement.
- [ROS 2 Jazzy documentation, tf2](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Tf2.html): a transform tree in practice, and the warning that frame and data transforms are inverses.
- [NumPy, numpy.linalg.svd](https://numpy.org/doc/stable/reference/generated/numpy.linalg.svd.html): the decomposition used to re-orthonormalize a drifted rotation.
- [NumPy, numpy.linalg.inv](https://numpy.org/doc/stable/reference/generated/numpy.linalg.inv.html): the general inverse the closed form is checked against.
