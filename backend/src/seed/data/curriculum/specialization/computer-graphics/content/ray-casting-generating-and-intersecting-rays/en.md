---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Explain the core reversal ray tracing makes relative to rasterization: working backward from each pixel into the scene, rather than pushing triangles forward through a pipeline.
- Write the ray equation, and generate a concrete camera ray for a given pixel, reusing the camera-space geometry `the-view-matrix-and-camera-space` already built.
- Derive and solve the ray-sphere intersection quadratic equation for a concrete ray and sphere, and interpret each of its possible outcomes (no root, one root, two roots).
- State, at a high level, what changes for ray-triangle intersection instead of ray-sphere, without a full derivation.

## Context & Motivation

`the-rendering-equation-and-the-limits-of-real-time-shading` named the honest limit of the rasterization pipeline built across this discipline so far: real-time shading only ever considers direct light from a small, fixed list of named sources. Ray tracing takes a structurally different approach to rendering the same kind of scene, one that naturally supports the recursive bounces later concepts add: instead of pushing every triangle through a shared pipeline of transform-then-rasterize-then-shade, a ray tracer works backward, one ray per pixel, asking "what does the camera actually see through this exact pixel." This concept builds the minimal, real algorithm, ray generation plus ray-sphere intersection, that every ray tracer, from a weekend hobby renderer to a production film renderer, starts from, following Shirley, Black, and Hollasch's freely available Ray Tracing in One Weekend.

## Core Theory

### The ray equation and generating a camera ray

A ray is a half-line starting at an origin point and extending in a fixed direction: P(t) = origin + t * direction, for t >= 0, where direction is typically a unit vector and t is a scalar distance along the ray. For rendering, one ray is generated per pixel, starting at the camera's own position (the same position `the-view-matrix-and-camera-space` placed in world space) and pointing through that pixel's location on an imaginary image plane a fixed distance in front of the camera; a pixel nearer the center of the image plane produces a ray pointing nearly straight ahead, while a pixel near an edge produces a ray angled outward, exactly reproducing the same field-of-view effect `the-projection-matrix-perspective-and-clipping`'s frustum already defined, just computed by tracing rays outward from the camera instead of projecting geometry inward toward it.

### Ray-sphere intersection

Given a ray P(t) = O + tD (origin O, direction D) and a sphere with center C and radius r, a point on the ray lies on the sphere's surface exactly when the squared distance from that point to C equals r squared: |P(t) - C|^2 = r^2. Substituting the ray equation and expanding produces a standard quadratic equation in t:

```text
a*t^2 + b*t + c = 0, where:
a = D . D
b = 2 * D . (O - C)
c = (O - C) . (O - C) - r^2
```

The discriminant, b^2 - 4ac, decides the outcome: negative means the ray misses the sphere entirely (no real root); zero means the ray is exactly tangent (one repeated root); positive means the ray passes through the sphere, entering at the smaller root and exiting at the larger one, and a renderer keeps the smallest positive root (the first surface the ray actually hits, since a hit behind the camera, t < 0, does not count).

### Ray-triangle intersection, at a high level

Rendering an arbitrary scene needs ray-triangle intersection as well as ray-sphere, since most real geometry is triangle meshes, not spheres. The structure of the problem is the same in spirit, express the ray parametrically and solve for where it satisfies the triangle's own plane equation, then check the resulting point actually falls inside the triangle, which is exactly the same inside-test problem `triangle-rasterization-edge-functions-and-barycentric-coordinates` already solved with edge functions and barycentric coordinates, just applied in 3D to a ray-plane intersection point rather than in 2D to a screen-space pixel. This concept does not derive the full ray-triangle formula in detail, keeping the fully worked derivation to the simpler, still completely general, sphere case.

## Worked Examples

### Example 1: a ray that hits a sphere, two real roots

Ray origin O = (0, 0, 0) (the camera), direction D = (0, 0, -1) (looking straight down -Z, a unit vector). Sphere center C = (0, 0, -5), radius r = 1.

```text
a = D.D = 0+0+1 = 1
b = 2*D.(O-C) = 2*(0,0,-1).(0,0,5) = 2*(-5) = -10
c = (O-C).(O-C) - r^2 = (0,0,5).(0,0,5) - 1 = 25 - 1 = 24

discriminant = b^2 - 4ac = 100 - 4*1*24 = 100 - 96 = 4 (positive: 2 roots)
t = (-b +/- sqrt(4)) / (2a) = (10 +/- 2) / 2 = 6 or 4
```

The smaller positive root, t = 4, is the first surface hit: P(4) = (0,0,0) + 4*(0,0,-1) = (0, 0, -4), the point on the near side of the sphere (consistent with a sphere centered at z=-5 with radius 1, whose near surface point along this ray is at z = -5 + 1 = -4).

### Example 2: a ray that misses the sphere entirely

Same sphere, ray origin O = (2, 0, 0), same direction D = (0, 0, -1) (a parallel ray, offset 2 units to the side):

```text
a = 1
b = 2*(0,0,-1).(2,0,5) = 2*(-5) = -10
c = (2,0,5).(2,0,5) - 1 = (4+0+25) - 1 = 28

discriminant = 100 - 4*1*28 = 100 - 112 = -12 (negative: no real root)
```

A negative discriminant confirms the ray, offset 2 units from the sphere's center while the sphere's radius is only 1, misses the sphere entirely, exactly as expected geometrically.

### Example 3: a ray tangent to the sphere, one repeated root

Ray origin O = (1, 0, 0), same direction D = (0, 0, -1) (offset exactly 1 unit, matching the sphere's radius):

```text
a = 1
b = 2*(0,0,-1).(1,0,5) = 2*(-5) = -10
c = (1,0,5).(1,0,5) - 1 = (1+0+25) - 1 = 25

discriminant = 100 - 4*1*25 = 100 - 100 = 0 (exactly zero: tangent)
t = -b / (2a) = 10 / 2 = 5
```

A discriminant of exactly zero confirms the ray just grazes the sphere's surface at a single point, P(5) = (1, 0, -5), the point on the sphere directly facing this offset ray, consistent with the ray passing exactly 1 unit (the radius) from the sphere's center.

## Common Misconceptions & Pitfalls

- **"A ray tracer needs a fundamentally different notion of a camera than a rasterizer."** Camera rays are generated from the identical camera position and orientation `the-view-matrix-and-camera-space` already computed; ray tracing changes what happens after a ray leaves the camera (intersecting scene geometry directly, rather than projecting geometry toward the camera), not how the camera itself is defined.
- **"A negative discriminant is a computational error to fix."** Example 2 shows a negative discriminant correctly, honestly reports a geometric fact, this particular ray does not hit this particular sphere, exactly the outcome a ray tracer needs for every ray that flies past an object into empty space or toward a different object entirely.
- **"Any positive root works equally well as 'the' intersection point."** Example 1's two positive roots (4 and 6) are the entry and exit points of the ray through the sphere; a renderer must take the smaller one specifically, since that is the first, visible surface point from the camera's side, using the larger root would incorrectly render the sphere's far, hidden interior surface instead.

## Summary

Ray tracing works backward from each pixel: a ray is generated from the camera through that pixel using the ray equation P(t) = origin + t * direction, and finding what it hits reduces to solving a per-object intersection test, worked out here in full for a sphere as a quadratic equation in t whose discriminant classifies the ray as missing, tangent to, or passing through the object, keeping the smallest positive root as the visible hit point. Ray-triangle intersection follows the same shape of problem against real mesh geometry, reusing the same inside-triangle test `triangle-rasterization-edge-functions-and-barycentric-coordinates` already built. `bounding-volume-hierarchies-and-ray-tracing-acceleration`, next, covers the real, necessary fix for testing every ray against every object in a scene of any realistic size.

## Documentation Links

- [Shirley, Black, and Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html): the freely available book this concept's ray equation and ray-sphere intersection derivation follow directly, the canonical practitioner-facing introduction to ray tracing cited across university courses.
