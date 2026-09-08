---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Extend homogeneous coordinates from 2D (3x3 matrices over (x, y, 1)) to 3D (4x4 matrices over (x, y, z, 1)), and write the 3D translation, rotation, and scale matrices.
- Compose scale, rotation, and translation into a single model matrix, in the conventional order, and explain why that order is the conventional one.
- Apply a full model matrix to a concrete 3D vertex and verify the result by hand.
- Explain, concretely, why non-commutativity (already shown in 2D) means the model matrix's composition order is a real design decision, not an arbitrary one.

## Context & Motivation

`homogeneous-coordinates-and-2d-affine-transformations` fixed translation for 2D points by padding to three coordinates and using 3x3 matrices; this concept does the identical thing one dimension up, padding 3D points to four coordinates (x, y, z, 1) and using 4x4 matrices, because every object in a real scene lives in three dimensions. The real, practical problem this concept solves is composition: a 3D model is typically authored around its own origin, then needs to be scaled to the right size, rotated to face the right way, and translated to its position in the world, three separate operations that a graphics pipeline needs as one matrix, applied once per vertex, not three separate multiplies. `matrices-as-linear-transformations` (`mathematics-for-computing`) already established that matrix multiplication is function composition; this concept is the direct graphics application of that fact to the single matrix, called the model matrix, every renderer builds for every object in a scene.

## Core Theory

### 3D homogeneous matrices

A 3D point (x, y, z) becomes (x, y, z, 1); a 3D direction vector becomes (x, y, z, 0), for the same reason as in 2D: only points should be affected by translation. The three basic 4x4 transformation matrices:

```text
Translation by (tx,ty,tz):      Scale by (sx,sy,sz):
| 1 0 0 tx |                    | sx 0  0  0 |
| 0 1 0 ty |                    | 0  sy 0  0 |
| 0 0 1 tz |                    | 0  0  sz 0 |
| 0 0 0 1  |                    | 0  0  0  1 |

Rotation about Z by angle t:
| cos(t) -sin(t) 0 0 |
| sin(t)  cos(t) 0 0 |
|   0       0    1 0 |
|   0       0    0 1 |
```

Rotation about the X and Y axes follow the identical pattern, with the 2x2 rotation block moved to the pair of axes being rotated around. A 3D model is now transformed by multiplying every vertex's homogeneous coordinate by whichever of these matrices apply, exactly the way `matrices-as-linear-transformations` described a matrix acting on a vector, just in a 4x4, homogeneous setting.

### Composing the model matrix: S, then R, then T

The standard convention builds the model matrix as M = T * R * S (matrices multiply right to left onto the vertex, so scale is applied first, then rotation, then translation): M * v = T * (R * (S * v)). This order is not arbitrary: scaling first, while the object is still centered at its own local origin, scales it symmetrically around that origin; if translation happened first, scaling afterward would also scale the translation offset itself, moving the object further from where it was placed. Rotating before translating, similarly, rotates the object around its own local origin rather than around wherever it happens to be sitting in the world. This is the exact same non-commutativity `homogeneous-coordinates-and-2d-affine-transformations` demonstrated numerically in 2D, now applied as a deliberate design rule rather than left as a warning.

## Worked Examples

### Example 1: scale, then rotate, then translate a single vertex

Object-space vertex v = (1, 0, 0, 1). Scale by (2, 2, 2), then rotate 90 degrees about Z, then translate by (10, 0, 0).

```text
Step 1 (scale by 2):        (1,0,0,1) -> (2,0,0,1)
Step 2 (rotate 90 about Z): (2,0,0,1) -> (0,2,0,1)
  [cos90=0, sin90=1: x' = 0*2 - 1*0 = 0; y' = 1*2 + 0*0 = 2]
Step 3 (translate by (10,0,0)): (0,2,0,1) -> (10,2,0,1)
```

Final world-space position: (10, 2, 0).

### Example 2: the same vertex, wrong order (translate before scale)

Same vertex v = (1, 0, 0, 1), same three operations, but translate first: translate by (10, 0, 0), then rotate 90 about Z, then scale by 2.

```text
Step 1 (translate by (10,0,0)): (1,0,0,1) -> (11,0,0,1)
Step 2 (rotate 90 about Z):     (11,0,0,1) -> (0,11,0,1)
Step 3 (scale by 2):            (0,11,0,1) -> (0,22,0,1)
```

Final position: (0, 22, 0), nowhere near Example 1's (10, 2, 0), and not a small numerical drift, a completely different placement: the object ends up scaled 2x further from the world origin than intended, precisely the "translation offset gets scaled too" failure the conventional S-then-R-then-T order avoids.

### Example 3: a full model matrix for an object placed at (10, 0, 0), scaled by 2, no rotation

For the simple case with no rotation, M = T * S directly, and applying M to every vertex of a unit cube centered at the object's local origin (corners at +/-0.5 on each axis) scales each corner by 2 first (corners now at +/-1.0), then shifts the whole cube by (10, 0, 0), placing the cube's world-space corners at, for example, (9, -1, -1) and (11, 1, 1), a 2x2x2 cube correctly centered at (10, 0, 0) in the world, not at (20, 0, 0) or straddling some other point.

## Common Misconceptions & Pitfalls

- **"Any order of S, R, T works as long as all three are applied eventually."** Example 2's (0, 22, 0) versus Example 1's (10, 2, 0) for the identical three operations on the identical starting vertex is a direct numeric refutation; the order changes the result, not just the path to it.
- **"Composing three 4x4 matrices at runtime, per vertex, is expensive."** In practice the model matrix M = T * R * S is computed once per object per frame (a single 4x4 * 4x4 * 4x4 multiply), then that one resulting matrix is applied to every one of the object's vertices; the composition cost does not scale with vertex count.
- **"Rotation about an arbitrary axis needs an entirely different kind of matrix."** It is still a 4x4 matrix built from the same rotation-matrix family (a linear combination of the X, Y, and Z rotation matrices' structure, via Rodrigues' rotation formula or an equivalent construction); the mechanism, a linear map plus the homogeneous translation trick, does not change.

## Summary

Extending homogeneous coordinates to three dimensions turns 3D translation, rotation, and scale into 4x4 matrices, letting a full model transform be built as one matrix, M = T * R * S, applied once per vertex. The conventional composition order, scale first, then rotate, then translate, exists for a concrete reason: it scales and rotates an object around its own local origin before placing it in the world, and Example 2 shows numerically what goes wrong (a completely different, incorrectly offset result) when that order is reversed. This model matrix is the first link in the model-view-projection chain `the-view-matrix-and-camera-space` continues next, moving a transformed vertex from world space into the camera's own frame of reference.

## Documentation Links

- [MIT 18.06: Linear Algebra (OCW course home, Gilbert Strang)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/): the linear algebra foundation for treating a sequence of matrix multiplications as function composition, reused here for the 3D, 4x4 case.
- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): a real, current university course whose "Basic Geometry & Transformations" unit builds the same 3D model-matrix composition this concept covers.
