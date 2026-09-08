---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Explain what a single primary ray finds (the nearest visible surface) and why that alone is not enough for reflections, refractions, or accurate shadows.
- Trace a shadow ray from a hit point toward a light and determine whether that point is genuinely in shadow, with a concrete occluder.
- Trace a reflection ray recursively and combine its returned color with a surface's own reflectivity, with concrete numbers.
- State, at the level of Snell's law, what a refraction ray computes differently from a reflection ray, and why ray tracing handles both with the same recursive structure.

## Context & Motivation

`bounding-volume-hierarchies-and-ray-tracing-acceleration` made finding a ray's nearest intersection fast; a single primary ray, once it finds that nearest surface, has done exactly the same job `z-buffering-and-visibility-determination` already did for rasterization, identify the nearest visible surface at a pixel. What ray tracing can do that rasterization cannot do naturally is recurse: from a hit point, cast further rays, toward lights to test for shadows, and off the surface itself to compute reflections and refractions, each one approximating one more step of the light-transport integral `the-rendering-equation-and-the-limits-of-real-time-shading` stated but real-time rasterization truncated after the first bounce. This concept builds that recursive structure.

## Core Theory

### Shadow rays

Once a primary ray finds a hit point, correctly deciding whether that point is lit requires knowing whether anything blocks the straight line between it and each light source. A shadow ray is cast from the hit point toward the light; if that ray intersects any other object before reaching the light, the point is in shadow with respect to that light (its diffuse and specular contribution from that light are both zero, per `local-illumination-lambertian-diffuse-reflection`'s own logic, since no light from that source actually reaches the point); if the shadow ray reaches the light unobstructed, the point is lit normally. This produces sharp, geometrically accurate shadows directly from the same ray-object intersection machinery `ray-casting-generating-and-intersecting-rays` already built, with no separate shadow algorithm needed.

### Reflection rays

At a reflective surface, a reflection ray is cast from the hit point in the mirror-reflection direction (the same reflection-vector formula `specular-reflection-the-phong-and-blinn-phong-models` used for the Phong highlight, R = 2(N.L)N - L, here applied to the incoming view direction rather than a light direction), and that ray is traced recursively, exactly like a primary ray, finding its own nearest hit and computing its own full shading, including its own further shadow, reflection, and refraction rays if that surface is also reflective or refractive. The final color at the original hit point blends its own local shading (diffuse plus specular, from the direct lights actually visible via shadow rays) with the recursively traced reflection color, weighted by the surface's own reflectivity.

### Refraction rays and Snell's law

A transparent, refractive surface (glass, water) bends a ray passing through it rather than bouncing it back, governed by Snell's law: n1 * sin(theta1) = n2 * sin(theta2), where n1 and n2 are the refractive indices of the two materials (roughly 1.0 for air, roughly 1.5 for common glass) and theta1, theta2 are the angles of incidence and refraction measured from the surface normal. A refraction ray is traced with the same recursive structure as a reflection ray, just in a different direction, computed from Snell's law rather than the mirror-reflection formula, and a fully transparent object typically produces both a reflection ray (some light always bounces off a transparent surface too, a real physical effect) and a refraction ray, blended together.

### Recursion depth

Since a reflection or refraction ray can itself hit another reflective or refractive surface, this process is naturally recursive, and a real renderer must cap the recursion depth (a maximum number of bounces, commonly somewhere between 4 and 50 depending on the scene and desired quality) to guarantee termination, since two facing mirrors, for instance, would otherwise bounce a ray back and forth indefinitely.

## Worked Examples

### Example 1: a shadow ray finds an occluder

Hit point P = (0, 0, -4) (on the sphere from `ray-casting-generating-and-intersecting-rays`'s Example 1), light at L_pos = (0, 10, -4) (directly above P). Shadow ray direction: normalize(L_pos - P) = normalize(0, 10, 0) = (0, 1, 0). Suppose a second, opaque object (a thin plate) sits at y = 5, directly between P and the light, and the shadow ray's intersection test against that plate returns a hit at t = 5, well before reaching the light at t = 10:

```text
Shadow ray hits an occluder at t=5, light is at t=10 (occluder is
  closer): P is in shadow with respect to this light.
Diffuse and specular contribution from this light at P: both 0,
  regardless of P's own normal or the light's own direction, per
  local-illumination-lambertian-diffuse-reflection's own logic.
```

### Example 2: a reflection ray, combined with local shading

Hit point P on a partially reflective surface, reflectivity = 0.3 (30% reflective, 70% ordinary local shading). Local shading (diffuse plus specular, from any unobstructed lights, per Example 1's logic) computes local_color = (0.6, 0.2, 0.2). A reflection ray cast from P, traced recursively, finds a nearby blue object and returns reflected_color = (0.1, 0.1, 0.8):

```text
final_color = (1 - reflectivity) * local_color + reflectivity * reflected_color
final_color = 0.7*(0.6,0.2,0.2) + 0.3*(0.1,0.1,0.8)
            = (0.42,0.14,0.14) + (0.03,0.03,0.24)
            = (0.45, 0.17, 0.38)
```

The final color shows mostly the surface's own reddish local shading, with a visible, correctly weighted tint of blue from the reflected object, exactly the visual effect a partially reflective surface should show.

### Example 3: refraction angle from Snell's law, air into glass

A ray traveling in air (n1 = 1.0) strikes a glass surface (n2 = 1.5) at an angle of incidence theta1 = 30 degrees (sin 30 = 0.5):

```text
n1 * sin(theta1) = n2 * sin(theta2)
1.0 * 0.5 = 1.5 * sin(theta2)
sin(theta2) = 0.5 / 1.5 = 0.333
theta2 = arcsin(0.333) =~ 19.5 degrees
```

The ray bends toward the normal (19.5 degrees is less than the 30-degree incidence angle), the correct, physically expected direction when light passes into a denser medium (higher refractive index); the refraction ray is then cast in this new, bent direction and traced recursively exactly like a reflection ray, just following a different, Snell's-law-derived direction.

## Common Misconceptions & Pitfalls

- **"A shadow ray needs to find the exact nearest occluder, like a primary ray does."** A shadow ray only needs to know whether any occluder exists between the hit point and the light, not which one is nearest or how far away it is; many implementations deliberately stop at the first hit found, in any order, a real, standard optimization unavailable to primary rays, which must find the specific nearest hit to shade the correct visible surface.
- **"Recursion for reflections must run until it naturally terminates on its own."** Two facing mirrors would recurse indefinitely without an explicit depth cap; every practical renderer imposes a maximum recursion depth, a deliberate, necessary engineering limit, not a sign the recursive approach is flawed.
- **"Reflection and refraction are two unrelated algorithms."** Example 2 and Example 3 use the identical recursive structure, cast a secondary ray from the hit point, trace it recursively, blend its returned color with local shading, differing only in how the secondary ray's direction is computed (the mirror-reflection formula versus Snell's law); the recursion itself is the same mechanism either way.

## Summary

A primary ray alone only finds the nearest visible surface, the same job z-buffering already does for rasterization; recursive ray tracing adds shadow rays (testing occlusion between a hit point and each light, producing sharp, geometrically accurate shadows with no separate algorithm), reflection rays (recursively tracing the mirror-reflection direction and blending the result with local shading by the surface's reflectivity), and refraction rays (the same recursive structure, following a direction computed from Snell's law instead), all capped at a finite recursion depth to guarantee termination. `rasterization-vs-ray-tracing-tradeoffs-and-real-time-hardware`, next, states honestly what this recursive capability costs relative to rasterization, and what changed recently to make it viable in real time.

## Documentation Links

- [Shirley, Black, and Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html): the freely available book whose treatment of diffuse, metal (reflective), and dielectric (refractive) materials this concept's recursive reflection and refraction structure follows.
- [Kajiya: The Rendering Equation (SIGGRAPH, 1986) : history via SIGGRAPH](https://history.siggraph.org/learning/the-rendering-equation-by-kajiya/): cited again here to make explicit that each recursive bounce this concept adds approximates one more term of the same light-transport integral real-time rasterization truncates after the first.
