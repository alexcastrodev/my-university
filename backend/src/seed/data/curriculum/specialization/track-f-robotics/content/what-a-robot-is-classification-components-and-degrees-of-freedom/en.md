---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the ISO 8373 definition of an industrial robot as the International Federation of Robotics (IFR) reports it, and tell a robot apart from a robotic device such as a teleoperated arm.
- Name the parts of a manipulator: links, joints, actuators, transmissions, sensors, and the end effector.
- Classify manipulators by the type and arrangement of their joints: Cartesian, cylindrical, polar, SCARA, articulated, and parallel.
- Count degrees of freedom with Grübler's formula and state the hypotheses the count depends on.
- Recognize the cases where the count is wrong, and check a count with the rank of the constraint Jacobian.

## Context & Motivation

Every later lesson in this track computes something from joint variables: a pose, a velocity, a torque. Before that, two questions need answers. What kind of machine is being modeled, and how many independent numbers describe its configuration? That number, the degrees of freedom (dof), is how many joint values a controller must set, and a robot with fewer than 6 cannot place a tool at an arbitrary position and orientation in space.

The count looks like bookkeeping, and for a serial arm it is: add the freedoms of the joints. For mechanisms with closed loops the standard formula can return 0 for a linkage that visibly moves, or a negative number for one that moves with one degree of freedom. Both cases are worked below, with the numbers produced by a script.

## Core Theory

### What counts as a robot

The vocabulary standard is ISO 8373:2021. Its text is sold; the IFR publishes a free summary, which gives the definition of an industrial robot as an "automatically controlled, reprogrammable multipurpose manipulator, programmable in three or more axes, which can be either fixed in place or fixed to a mobile platform for use in automation applications in an industrial environment". Reprogrammable means the motions can be changed without altering the mechanism. A service robot, in the same summary, is a "robot in personal use or professional use that performs useful tasks for humans or equipment", and ISO 8373:2021 adds medical robots as a third category.

The IFR also reports that ISO 8373 requires "a degree of autonomy", and calls a mechanism built with robot technology that lacks some of the characteristics of a robot a robotic device. Its examples are a teleoperated remote manipulator, a haptic device, an end effector on its own, and an unpowered exoskeleton. This matches the history in Asada's MIT 2.12 notes: industrial robots grew from numerical control and from master-slave remote manipulators, and the difference from the second is that the human operator is no longer in the control loop.

Lynch and Park's *Modern Robotics* takes the mechanical view used in this track: a robot is built from rigid links connected by joints, the joints are driven by actuators, and "an essential feature of any robot is that it moves in the physical world".

### Components

- **Links**: the bodies, modeled as rigid. Real links bend a little, and real joints have elasticity, backlash, and friction; the models here ignore those effects.
- **Joints**: each connects exactly two links. The common types, with their freedoms $f$ and the constraints $c=m-f$ they impose ($m=3$ in the plane, $m=6$ in space), from Table 2.1 of *Modern Robotics*:

| Joint | $f$ | $c$ planar | $c$ spatial |
|---|---|---|---|
| Revolute (R) | 1 | 2 | 5 |
| Prismatic (P) | 1 | 2 | 5 |
| Helical (H) | 1 | n/a | 5 |
| Cylindrical (C) | 2 | n/a | 4 |
| Universal (U) | 2 | n/a | 4 |
| Spherical (S) | 3 | n/a | 3 |

- **Actuators**: usually electric motors, sometimes pneumatic or hydraulic cylinders. Motors spin fast with low torque, so a **transmission** (gears, cables, belts, chains) reduces speed and multiplies torque, at the cost of backlash, the output motion available without input motion.
- **Sensors**: joint encoders, potentiometers, or resolvers for position; tachometers for velocity; force-torque sensors; cameras, depth cameras, and laser range finders for the surroundings.
- **End effector**: the gripper or tool at the end of the chain, whose position and orientation is what most tasks specify.

### Classifying manipulators by their joints

A serial arm is named by its joint string from the base, as in *Modern Robotics*, where a SCARA is an RRRP chain. The IFR summary of ISO 8373 classifies industrial robots by mechanical structure:

| Class | Definition (IFR summary of ISO 8373) | Typical string |
|---|---|---|
| Cartesian (gantry) | three prismatic joints whose axes form a Cartesian system | PPP |
| Cylindrical | at least one rotary and one prismatic joint, forming a cylindrical system | RPP |
| Polar (spherical) | two rotary joints and one prismatic joint, forming a polar system | RRP |
| SCARA | two parallel rotary joints, compliant in a selected plane | RRP (Asada), RRRP (*Modern Robotics*) |
| Articulated | three or more rotary joints | 6R |
| Parallel (Delta) | arms with links that form a closed loop | closed chain |

The definitions are properties, not strings: the right column is a common case, not part of the standard. The first three classes mirror coordinate systems, which is how Asada's notes introduce them. An **open chain** (serial) has no loop, and in the usual design every joint is actuated; a **closed chain** has at least one loop, and often only some of its joints are actuated.

### Grübler's formula

For a rigid body, the dof is 3 in the plane and 6 in space. A mechanism's dof is the sum of the freedoms of its bodies minus the number of independent constraints. With $N$ links counting the ground, $J$ joints, and joint $i$ providing $f_i$ freedoms, Grübler's formula (Proposition 2.2 in *Modern Robotics*) is

$$\text{dof}=m(N-1)-\sum_{i=1}^{J}c_i=m(N-1-J)+\sum_{i=1}^{J}f_i.$$

For an open chain $J=N-1$, so the dof is just $\sum f_i$. The count rests on hypotheses that are easy to break without noticing:

1. Each joint connects exactly two links. Three links pinned at one point are two joints.
2. The links are rigid.
3. The joint constraints are independent. If they are not, the formula gives only a lower bound.
4. $m$ fits the motion: $m=3$ is legitimate only when every link stays in one plane.
5. The result is the dimension of the configuration space, which is neither the number of actuators nor the freedoms of the end effector.

A pose in space takes 6 numbers, so an arm needs at least 6 dof to reach arbitrary positions and orientations. *Modern Robotics* calls an arm kinematically redundant when it has more joints than the dimension of the task space, as a 7R arm does for spatial poses and a planar 3R arm does when only the tip position matters. The dof is a dimension, and says nothing about range: joint limits and link lengths decide which poses are reachable.

### Checking a count with the rank of the constraint Jacobian

The formula applies the rule dof = variables minus independent equations (Equation 2.2 in *Modern Robotics*) by counting. The same rule can be computed. Give every moving planar body three coordinates $(x,y,\phi)$, write each revolute joint as two equations (the pin seen from both bodies must be the same point), and evaluate the Jacobian $A$ of the constraints at an assembled configuration. Then

$$\text{local dof}=(\text{number of variables})-\operatorname{rank}A.$$

The rank counts only the independent constraints, which is what hypothesis 3 asks for. Two caveats: the rank describes first-order motion at that configuration, and at a singular configuration it can show more motion than the mechanism really has. So a claimed motion is confirmed by moving the mechanism and checking that the constraints stay satisfied.

## Worked Examples

### Example 1: counts that work

From the script, applying the formula:

```text
mechanism                     m   N   J   sum f   dof
planar 2R open chain          3   3   2    2       2
planar 3R open chain          3   4   3    3       3
SCARA RRRP                    6   5   4    4       4
spatial 6R open chain         6   7   6    6       6
spatial 7R open chain         6   8   7    7       7
planar four-bar               3   4   4    4       1
planar slider-crank           3   4   4    4       1
planar five-bar               3   5   5    5       2
Stewart-Gough, UPS legs       6  14  18   36       6
Stewart-Gough, SPS legs       6  14  18   42      12
Delta                         6  17  21   45      15
```

The open chains give $\sum f_i$, as expected. The four-bar needs one actuator, and the five-bar needs two, with the other three joints passive, as in the five-bar robot of Asada's notes.

The last two rows show hypothesis 5 at work. With spherical joints at both ends of each Stewart-Gough leg, the count is 12, because each leg can spin about its own axis without moving the platform; the platform still has 6. In the Delta robot, *Modern Robotics* attributes 12 of the 15 to torsion of the parallelogram links about their long axes, so the moving platform has 3: it stays parallel to the base and the Delta acts as an $x$-$y$-$z$ positioner. A planar four-bar with a constraint Jacobian computed at a crank angle of 60° (ground 2, crank 1, coupler 2, rocker 1.5, any unit) has 9 variables, rank 8, and local dof 1, which agrees with the formula.

### Example 2: a linkage that moves when the formula says it cannot

Take a parallelogram linkage with three cranks: ground pins at $(0,0)$, $(1,0)$, $(2,0)$, three cranks of length 1, and one coupler pinned to all three crank tips. Then $N=5$ and $J=6$, so

$$\text{dof}=3(5-1-6)+6=0,$$

a rigid structure. With the cranks at 60° the constraint Jacobian is $12\times12$:

```text
                      variables  equations  rank  local dof  smallest singular value
parallelogram             12         12      11       1           4.9e-17
third pin at (2,-0.5)     12         12      12       0           2.5e-02
```

The rank is 11, so one constraint is dependent and the local dof is 1. The null vector has equal rates for the three crank angles and a coupler velocity of $(-0.866,0.5)$ per radian with no rotation: the cranks turn together and the coupler translates. The motion is finite, not only first-order: with the cranks at 20°, 100°, and 150° and the coupler translated to match, the largest constraint residual is 0.0 in float64. Moving the third ground pin to $(2,-0.5)$ (so that crank is 1.4547 long at 69.90°, still assembled) makes the constraints independent, the rank becomes 12, and the linkage is rigid, as Grübler predicted for the generic case. The formula's 0 was a lower bound, exactly as hypothesis 3 warns.

### Example 3: the same four-bar, counted in space

Build the four-bar of Example 1 in three dimensions with all four revolute axes parallel to $z$. With $m=6$:

$$\text{dof}=6(4-1-4)+4=-2.$$

A negative count suggests a structure that cannot move, yet this is the same physical four-bar. The spatial constraint Jacobian has 18 variables (6 per moving link) and 20 equations (3 for the coincident point and 2 for parallel axes at each joint):

```text
variables 18   equations 20   rank 17   local dof 1
```

Three of the 20 equations are implied by the others, because parallel axes already keep every link in the plane. The four-bar moves with 1 dof, and $-2$ was again only a lower bound. Restricting to the plane removes 9 variables and 12 equations, and the 3 extra equations are exactly the dependent ones, which is why the planar count was right.

## Common Misconceptions & Pitfalls

- **"Number of joints equals dof."** In closed chains, some joints are passive: the five-bar of Example 1 has 5 joints and 2 dof, and the Delta's 15 count includes 12 internal twists.
- **"Grübler's formula gives the dof."** It gives the dof only when the constraints are independent; otherwise it is a lower bound. Example 2 gave 0 for a mechanism with 1 dof.
- **"A negative count means the mechanism cannot move."** Example 3 gave $-2$ for a four-bar that moves.
- **"Six dof means any pose is reachable."** Dof counts dimensions. Reach and joint limits decide which poses are reachable, and the singular configurations studied later restrict how the arm can move near some of them.
- **"A planar-looking mechanism can always be counted with $m=3$."** Only if every link stays in the plane. Counted with $m=6$, Example 3 shows how the two counts relate.
- **"A teleoperated arm is a robot."** In the vocabulary the IFR reports from ISO 8373, a teleoperated remote manipulator is listed as a robotic device, not a robot.

## Summary

ISO 8373, as summarized by the IFR, defines an industrial robot as an automatically controlled, reprogrammable manipulator programmable in three or more axes, and calls mechanisms that lack some characteristic of a robot, such as teleoperated manipulators, robotic devices. A manipulator is made of rigid links and joints, driven by actuators through transmissions, measured by sensors, and finished by an end effector. Classes follow the joints: Cartesian, cylindrical, polar, SCARA, articulated, and parallel. Grübler's formula $m(N-1-J)+\sum f_i$ counts the dimension of the configuration space when every joint connects two links, the links are rigid, $m$ fits the motion, and the constraints are independent. When they are not, it is only a lower bound: a parallelogram linkage counted 0 and moved with 1, and a four-bar counted in space gave $-2$ and also moved with 1. The rank of the constraint Jacobian, confirmed by actually moving the mechanism, catches both.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): the free textbook, its videos, and software used throughout this track.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): Chapter 1 on robot components, and Chapter 2 on degrees of freedom, joint types, Grübler's formula, and its failure cases.
- [IFR, Industrial Robots](https://ifr.org/industrial-robots): the ISO 8373:2021 definition of an industrial robot and the classification by mechanical structure.
- [IFR, Service Robots](https://ifr.org/service-robots): the ISO 8373 definitions of service robot, degree of autonomy, and robotic device.
- [MIT OCW 2.12 Introduction to Robotics, lecture notes (Asada)](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/pages/lecture-notes/): the origins of industrial robots, joint primitives, coordinate-system robot types, and parallel linkages.
