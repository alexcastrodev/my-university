---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Explain why a scene defined entirely in world space still cannot be rendered without also defining a camera.
- Build a camera's own transformation matrix (its position and orientation) using the exact same rotation-and-translation machinery `3d-transformations-and-composing-the-model-matrix` already composed.
- Explain why the view matrix is the inverse of the camera's own world-space transform, and apply that inverse to a concrete world-space point.
- State precisely what "camera space" means as a coordinate system, and why every vertex needs to be re-expressed in it before projection.

## Context & Motivation

`3d-transformations-and-composing-the-model-matrix` placed one object into a shared world space using a model matrix built from scale, rotation, and translation. A full scene has many such objects, all now living in the same world-space coordinate system, but the pipeline still cannot draw any of them without answering one more question: draw them as seen from where. A camera is not a special kind of object; it is an object like any other, with a position and an orientation in world space, built with the identical translation-and-rotation matrices the previous concept just composed. This concept covers the one genuinely new idea a camera introduces: to render the scene from the camera's point of view, every vertex needs to be re-expressed relative to the camera, which means undoing the camera's own transform, not applying it.

## Core Theory

### The camera as an object, and camera space

A camera has a position (a point in world space) and an orientation (which way it is facing, and which way is "up" from its own point of view). Exactly like any modeled object, this can be captured as a 4x4 matrix, call it C, built from a rotation (the camera's orientation) and a translation (the camera's position), using the same T * R composition `3d-transformations-and-composing-the-model-matrix` established. C, applied to a point in the camera's own local space (0,0,0, the camera's own origin, looking down its own local -Z axis by convention), places that point correctly in world space, exactly the way a model matrix places an object's local-space vertices into the world.

Camera space (also called eye space or view space) is the coordinate system where the camera itself sits at the origin, looking down a fixed axis. A vertex expressed in camera space says, directly, "this point is this far to the camera's right, this far up, and this far in front," which is exactly the information the next stage, projection, needs.

### The view matrix is the camera matrix's inverse

If C moves a point from camera space into world space, then rendering the scene from the camera's viewpoint requires the opposite operation on every scene vertex: moving a world-space point into camera space, which is exactly C inverse. This inverse, called the view matrix (V = C^-1), is what actually gets applied to every vertex in the scene, after the model matrix, in the pipeline's transformation chain: a vertex goes from object space to world space via the model matrix, then from world space to camera space via the view matrix.

For a camera built purely from an orthonormal rotation matrix R and a translation t (position), the inverse has a convenient closed form that avoids a general matrix inversion: the rotation part inverts to its transpose (R^-1 = R^T, true for any orthonormal rotation matrix), and the translation part becomes -R^T * t; V = [R^T | -R^T * t]. This is the standard "look-at" construction every graphics course, including Cornell's CS4620, builds from a camera position, a target point to look at, and an up vector.

### Why "undo the camera's transform" is the correct framing

A moving camera and a moving object produce the identical visual effect from opposite sides of the same matrix: if the camera moves forward by 1 unit, every object in view should appear to move backward by 1 unit relative to the camera; applying C^-1 (the view matrix) to every vertex achieves exactly this, since undoing a forward translation is equivalent to translating everything else backward by the same amount. This is why a "moving camera" and a "moving world" are mathematically the same operation, computed from two different, equally valid starting points.

## Worked Examples

### Example 1: a camera at (0, 0, 5) looking at the origin, no rotation needed for a simple case

Camera position (0, 0, 5), looking toward the origin (0, 0, 0), up vector (0, 1, 0). Since the camera looks straight down its own -Z axis toward the origin with no tilt, its orientation matches the world axes exactly (R = identity here), so C is a pure translation by (0, 0, 5), and its inverse V is a pure translation by (0, 0, -5):

```text
C:                          V = C^-1:
| 1 0 0 0 |                 | 1 0 0  0 |
| 0 1 0 0 |                 | 0 1 0  0 |
| 0 0 1 5 |                 | 0 0 1 -5 |
| 0 0 0 1 |                 | 0 0 0  1 |
```

### Example 2: transforming a world-space point into camera space

World-space point p = (1, 1, 0, 1) (an object sitting near the origin). Apply V from Example 1:

```text
| 1 0 0  0 |   | 1 |   | 1 |
| 0 1 0  0 | * | 1 | = | 1 |
| 0 0 1 -5 |   | 0 |   | -5 |
| 0 0 0  1 |   | 1 |   | 1 |
```

Camera-space position: (1, 1, -5). This says exactly what is needed for the next stage: the point is 1 unit to the right, 1 unit up, and 5 units in front of the camera (negative Z, by the standard convention that the camera looks down -Z), a direct, usable description of the point relative to the viewer.

### Example 3: moving the camera versus moving the world, the same result

Suppose the camera instead moves from (0, 0, 5) to (0, 0, 6), one unit further back. The new view matrix translates by (0, 0, -6), and the same world point p = (1, 1, 0, 1) now transforms to (1, 1, -6): the point appears one unit further away, exactly as if the camera had stayed still and every object in the world had instead moved one unit further from the camera along Z. Both framings, "the camera moved" and "the world moved the opposite way," produce the identical camera-space coordinate, confirming the view matrix computes exactly the relative relationship that matters for rendering.

## Common Misconceptions & Pitfalls

- **"The view matrix is built the same way as a model matrix, so it can be applied directly, without inverting."** Example 1 shows the view matrix is the camera's own placement matrix inverted; applying the camera's placement matrix C directly to scene vertices (instead of its inverse) would move every object further from the camera as the camera moves forward, the opposite of the correct, expected visual effect.
- **"Camera space and world space are the same thing with different labels."** Example 2's result, (1, 1, -5), is a description relative to the camera's own position and orientation, not a restatement of the world-space coordinates (1, 1, 0); the two numbers are genuinely different because they answer different questions (where is this point in the shared world, versus where is this point relative to me).
- **"A camera needs a fundamentally different kind of matrix than a modeled object."** It does not: a camera's own transform is built with the identical rotation-and-translation composition `3d-transformations-and-composing-the-model-matrix` already established; the only new idea this concept introduces is that the camera's matrix gets inverted before use, rather than applied directly.

## Summary

A camera is an ordinary object with a position and orientation, built from the same rotation-and-translation matrices used for any modeled object, but rendering from its viewpoint requires the opposite operation: the view matrix is the camera's own placement matrix inverted, moving every scene vertex from world space into camera space, the coordinate system where the camera sits at the origin looking down a fixed axis. For a camera built from an orthonormal rotation and a translation, this inverse has a convenient closed form (R transposed, and a correspondingly adjusted translation), the standard look-at construction. This is the second link in the model-view-projection chain, and `the-projection-matrix-perspective-and-clipping` builds the third and final one next, turning a camera-space point into the standardized coordinates rasterization needs.

## Documentation Links

- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): a real, current university course whose "Basic Geometry & Transformations" unit covers camera projection systems and the view-matrix construction this concept builds.
