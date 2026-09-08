---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Explain precisely why a plain 2x2 linear matrix cannot represent translation, and what "does not fix the origin" means concretely for a moved point.
- Build the 3x3 homogeneous matrices for 2D translation, rotation, and scale, and apply each to a concrete point.
- Compose two transformations into a single matrix and show, with numbers, that the order of composition changes the result.
- Connect this fix directly to `matrices-as-linear-transformations` (`mathematics-for-computing`): what that concept proved about linear maps, and exactly which case it left unsolved.

## Context & Motivation

`matrices-as-linear-transformations` (`mathematics-for-computing`) proved that multiplying a vector by a matrix rotates, scales, or reflects it, real, useful operations for graphics. But it also implies a real limitation, stated precisely here rather than left implicit: a linear map always sends the zero vector to the zero vector (M * 0 = 0 for any matrix M), so no matrix, by itself, can move a point away from the origin without also moving the origin itself. Translation, the single most common operation in graphics, moving an object from one place to another, is not a linear transformation. Every graphics pipeline needs translation, rotation, and scale to compose into one uniform operation (the model matrix, `3d-transformations-and-composing-the-model-matrix` builds next), and that requires a real fix. This concept builds that fix: homogeneous coordinates, the standard trick, taught in every graphics course, including Cornell's CS4620, that turns translation into a matrix multiply too.

## Core Theory

### Why translation breaks linearity

A translation moves every point by a fixed offset: T(x, y) = (x + tx, y + ty). Check the defining property of a linear map, T(0) = 0: T(0, 0) = (tx, ty), which is (0, 0) only when the offset itself is zero. Translation genuinely is not linear (for any nonzero offset), so no 2x2 matrix, applied the ordinary way, can represent it. This is not a limitation of a particular matrix; it is a structural fact about what 2x2 matrices can express at all.

### The fix: homogeneous coordinates

The standard fix pads every 2D point (x, y) with a third coordinate, becoming (x, y, 1), and works with 3x3 matrices instead of 2x2 ones. A translation by (tx, ty) becomes:

```text
| 1  0  tx |   | x |   | x + tx |
| 0  1  ty | * | y | = | y + ty |
| 0  0  1  |   | 1 |   |   1    |
```

The extra row and column let the matrix add a constant offset during the multiply, something a pure 2x2 linear map could never do. Rotation and scale still work exactly as `matrices-as-linear-transformations` described, just embedded in the top-left 2x2 block of a 3x3 matrix with the last row and column left as identity:

```text
Rotation by angle theta:      Scale by (sx, sy):
| cos(t) -sin(t)  0 |         | sx  0   0 |
| sin(t)  cos(t)  0 |         | 0   sy  0 |
|   0       0     1 |         | 0   0   1 |
```

Points use a third coordinate of 1 (they can be translated); direction vectors, which should never be moved by a translation, use a third coordinate of 0, and the same translation matrix applied to a vector leaves it unchanged, since the tx and ty terms multiply against 0 instead of 1. This single convention, one extra coordinate, is what lets translation, rotation, and scale all become "multiply by a 3x3 matrix," so a pipeline never needs to special-case any of them.

### Composing transformations

Because every 2D affine transformation is now a 3x3 matrix, applying several in sequence is just matrix multiplication, and `matrices-as-linear-transformations`'s function-composition reading of matrix multiplication carries over directly: applying transformation A then transformation B to a point p is B * (A * p), which equals (B * A) * p by associativity, so B * A is the single combined matrix. Because matrix multiplication does not commute, A * B and B * A are, in general, different matrices, and applying rotation then translation is genuinely not the same as applying translation then rotation.

## Worked Examples

### Example 1: translating a point

Point p = (2, 3). Translate by (5, -1): using the matrix above with tx = 5, ty = -1:

```text
| 1  0  5  |   | 2 |   | 2 + 5  |   | 7  |
| 0  1  -1 | * | 3 | = | 3 - 1  | = | 2  |
| 0  0  1  |   | 1 |   |   1    |   | 1  |
```

Result: (7, 2), exactly the plain-arithmetic answer, now produced by a single matrix multiply.

### Example 2: rotating a point 90 degrees

Point p = (1, 0). Rotate by 90 degrees (cos 90 = 0, sin 90 = 1):

```text
| 0  -1  0 |   | 1 |   | 0*1 + (-1)*0 + 0*1 |   | 0 |
| 1   0  0 | * | 0 | = | 1*1 +   0*0  + 0*1 | = | 1 |
| 0   0  1 |   | 1 |   |         1          |   | 1 |
```

Result: (0, 1), the point on the positive x-axis correctly rotated a quarter turn to the positive y-axis.

### Example 3: order matters, translate-then-rotate vs. rotate-then-translate

Start with point p = (1, 0). Translate by (2, 0) first, then rotate 90 degrees:

```text
Step 1 (translate): (1,0) -> (3, 0)
Step 2 (rotate 90):  (3,0) -> (0, 3)
```

Now rotate 90 degrees first, then translate by (2, 0):

```text
Step 1 (rotate 90):    (1,0) -> (0, 1)
Step 2 (translate):    (0,1) -> (2, 1)
```

The two final results, (0, 3) and (2, 1), are different. This is not a computational mistake; it is the direct, concrete consequence of matrix multiplication not commuting, the exact fact `3d-transformations-and-composing-the-model-matrix` relies on when it insists on a specific order (scale, then rotate, then translate) for building a model matrix.

## Common Misconceptions & Pitfalls

- **"Homogeneous coordinates are just a notational trick with no real effect."** Example 1 through 3 show the third coordinate genuinely changes what the matrix multiply computes (it is what allows the additive offset at all); dropping it back to plain 2x2 matrices makes translation impossible to express as a matrix multiply again.
- **"A vector and a point with the same (x, y) values behave identically under these matrices."** They do not: a point uses homogeneous coordinate 1 and is translated; a direction vector uses homogeneous coordinate 0 and is not, by design, since a direction (like a surface normal or a velocity) should not shift just because the object it belongs to moved.
  ```text
  Translating point (1, 1, 1) by (5, 0): -> (6, 1, 1) (moved)
  Translating vector (1, 1, 0) by (5, 0): -> (1, 1, 0) (unchanged, tx*0 = 0)
  ```
- **"Any order of composing transformations gives the same visual result."** Example 3's numeric contradiction (0, 3) versus (2, 1) is the general case, not a special one; the correct order for a specific effect must be chosen deliberately, which is exactly why `3d-transformations-and-composing-the-model-matrix` states a fixed convention rather than leaving it arbitrary.

## Summary

A linear matrix alone cannot move a point without also moving the origin, so translation, the most common operation in graphics, is not linear and cannot be expressed by an ordinary 2x2 matrix. Homogeneous coordinates fix this by padding every 2D point with a third coordinate (1 for points, 0 for direction vectors) and using 3x3 matrices, letting translation, rotation, and scale all become the same operation: a single matrix multiply. Because matrix multiplication is function composition but does not commute, composing several transformations produces one combined matrix whose order genuinely changes the result, the exact mechanism `3d-transformations-and-composing-the-model-matrix` extends to full 3D scenes next.

## Documentation Links

- [MIT 18.06: Linear Algebra (OCW course home, Gilbert Strang)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/): the linear algebra foundation, matrix multiplication and composition, this concept builds the homogeneous-coordinates extension on top of.
- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): a real, current university course whose "Basic Geometry & Transformations" unit covers homogeneous coordinates as the standard tool for representing translation as a matrix.
