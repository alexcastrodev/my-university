---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- State Lambert's cosine law: reflected light intensity off a perfectly matte surface is proportional to the cosine of the angle between the surface normal and the direction to the light.
- Compute that cosine as a single dot product between two unit vectors, and compute a concrete diffuse color from a light direction, a surface normal, and a surface albedo.
- Explain why a negative dot product must be clamped to zero, and what surface geometry that negative value represents physically.
- Explain, precisely, why every later shading model in this discipline is diffuse reflection plus an additional term, never a replacement for it.

## Context & Motivation

`z-buffering-and-visibility-determination` decided which fragment is visible at each pixel; this concept starts the separate job of deciding what color that fragment actually is. The simplest physically motivated answer, and the one every graphics course, including Cornell's CS4620, teaches first, is Lambertian diffuse reflection: the color a perfectly matte surface (chalk, unfinished wood, most fabric) shows under a light, which depends only on the angle between the surface and the light, not on where the viewer is standing. This is deliberately the least sophisticated real illumination model in the discipline, chosen first because every more advanced model this discipline covers adds a term on top of it rather than discarding it.

## Core Theory

### Lambert's cosine law

A perfectly diffuse (Lambertian) surface scatters incoming light equally in every outgoing direction, so the amount of light reflected toward any viewer depends only on how much light the surface actually receives, which itself depends on the angle at which light strikes it: light hitting a surface head-on delivers more energy per unit surface area than the same light hitting at a grazing angle, exactly the geometric fact behind why the noon sun feels stronger than a low, evening sun striking the ground at a shallow angle. Lambert's law states this precisely: reflected intensity is proportional to cos(theta), where theta is the angle between the surface normal (a unit vector pointing straight out of the surface) and the direction to the light source (also a unit vector).

### Computing the cosine as a dot product

For two unit vectors, the dot product equals the cosine of the angle between them directly: N . L = cos(theta), where N is the surface normal and L is the unit vector pointing from the surface point toward the light. This means Lambert's law needs no trigonometric function at all at render time, just one dot product per fragment (three multiplications and two additions), evaluated by the millions of parallel lanes `gpu-architecture-and-the-simt-execution-model` already described, once per fragment, per light.

The final diffuse color multiplies this cosine term by the surface's own albedo (its base color, how much of each color channel it reflects) and the light's own color and intensity:

```text
diffuse_color = albedo * light_color * light_intensity * max(0, N . L)
```

### Clamping to zero

When N . L is negative, the angle between the normal and the light direction exceeds 90 degrees, meaning the light is behind the surface as seen from that point (the surface is facing away from the light entirely). Physically, no light reaches that side of the surface from that light, so the diffuse contribution must be zero, not a negative color; the max(0, ...) clamp in the formula above is not a numerical convenience, it encodes this physical fact directly.

## Worked Examples

### Example 1: light directly overhead a flat surface

Surface normal N = (0, 0, 1) (pointing straight up, say the surface is a flat floor). Light direction L = (0, 0, 1) (the light is directly overhead). Albedo (0.8, 0.2, 0.2) (a muted red surface), light color and intensity both 1 (a plain white light at full strength):

```text
N . L = (0)(0) + (0)(0) + (1)(1) = 1
diffuse_color = (0.8, 0.2, 0.2) * 1 * 1 * max(0, 1) = (0.8, 0.2, 0.2)
```

The surface shows its full, unmodified albedo color, exactly as expected when light strikes it head-on.

### Example 2: light at a 45-degree angle

Same surface and albedo, but the light now comes from L = (0.707, 0, 0.707) (a unit vector at 45 degrees from the normal; note 0.707 squared times 2 equals 1, confirming it is a unit vector):

```text
N . L = (0)(0.707) + (0)(0) + (1)(0.707) = 0.707
diffuse_color = (0.8, 0.2, 0.2) * 1 * 1 * 0.707 = (0.566, 0.141, 0.141)
```

The surface is visibly dimmer than Example 1, about 70.7% as bright, exactly cos(45 degrees), even though the light's own intensity did not change; only the angle changed.

### Example 3: light behind the surface, clamped to zero

Same surface, but the light now sits below the floor, at L = (0, 0, -1) (physically impossible for a floor lit from above, but a common case for one face of a multi-sided object facing away from a light):

```text
N . L = (0)(0) + (0)(0) + (1)(-1) = -1
diffuse_color = (0.8, 0.2, 0.2) * 1 * 1 * max(0, -1) = (0.8, 0.2, 0.2) * 0 = (0, 0, 0)
```

The surface receives no diffuse light at all from this source, correctly rendered as black (from this light; a separate light or an ambient term, if present, could still contribute).

## Common Misconceptions & Pitfalls

- **"Diffuse shading depends on where the camera is standing."** It deliberately does not: Lambert's law uses only the surface normal and the light direction, never the view direction, which is exactly why the same matte surface looks equally bright from any viewing angle under a fixed light, a real, physically motivated property of perfectly diffuse materials, and the property `specular-reflection-the-phong-and-blinn-phong-models`, next, adds a genuinely view-dependent term on top of.
- **"A negative N . L means an error in the normal or light vector."** Example 3 shows this is the expected, correct signal that the light is on the far side of the surface from that point; clamping it to zero is the correct physical response, not a bug fix.
- **"Doubling the light's distance should be handled inside this cosine formula."** Lambert's law itself only governs the angular falloff; a light's intensity also falls off with distance (typically as an inverse-square term, a separate multiplicative factor this concept's `light_intensity` term stands in for), a distinct physical effect this concept does not derive in detail, since the angular term is the one every later shading concept in this discipline directly builds on.

## Summary

Lambertian diffuse reflection models the color of a perfectly matte surface as proportional to the cosine of the angle between its normal and the direction to the light, computed as a single dot product between two unit vectors, multiplied by the surface's albedo and the light's color and intensity, and clamped to zero whenever that dot product is negative (the light is behind the surface from that point). This is deliberately the simplest real illumination term in the discipline: `specular-reflection-the-phong-and-blinn-phong-models`, next, adds a view-dependent highlight term on top of exactly this diffuse term, never replacing it.

## Documentation Links

- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): a real, current university course whose "Rendering" unit covers Lambertian diffuse reflection as the foundational local illumination term this concept builds.
