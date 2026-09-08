---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Model a color image as three stacked discrete functions (R, G, B channels), each an independent instance of `digital-images-as-discrete-functions`'s single-channel f(x, y) sharing the same pixel grid.
- Apply the standard luminance-weighted formula to convert an RGB pixel to a single grayscale value, and explain why the weights are unequal.
- Explain, briefly and honestly, why a perceptual color space like HSV separates hue from intensity in a way plain RGB cannot, and why that separation matters for later thresholding work.

## Context & Motivation

`digital-images-as-discrete-functions` defined an image as a single discrete function f(x, y). Most real images are not single-channel: a color photograph carries three intensity values per pixel, one for red, one for green, one for blue. This concept extends the representation to that common case, and sets up two pieces of machinery, grayscale conversion and color-space intuition, that later concepts in this discipline (thresholding and segmentation, specifically) lean on without re-deriving.

This is deliberately a short, grounding concept, not a full color-science treatment. Color perception, gamut mapping, and colorimetry are genuinely their own field; this discipline only needs enough color representation to process real images through the classical pipeline (spatial filtering, edge detection, segmentation, compression) the rest of the discipline builds.

## Core Theory

### RGB as three stacked functions

A color image is three functions on the same pixel grid: f_R(x, y), f_G(x, y), f_B(x, y), each independently an instance of `digital-images-as-discrete-functions`'s single-channel image, each typically 8 bits per pixel (so a standard color pixel is 24 bits, 3 bytes). Any spatial operation this discipline defines on a single channel, a convolution kernel, an edge detector, can be applied to each of the three channels independently and the results recombined, the standard, honest way most classical techniques extend from grayscale to color, though it is worth stating plainly that processing channels fully independently ignores real correlation between them, a genuine limitation more advanced color-aware techniques address and this discipline does not pursue further.

### Grayscale conversion: why the weights are unequal

Collapsing RGB to a single grayscale intensity is not a plain average. The standard, widely used formula (ITU-R BT.601, the basis for most image libraries' default grayscale conversion) is:

```text
Gray(x,y) = 0.299 * R(x,y) + 0.587 * G(x,y) + 0.114 * B(x,y)
```

The weights are unequal because human perceptual sensitivity to luminance is unequal across wavelengths: the eye is most sensitive to green light, least to blue, and the coefficients above are chosen to match that sensitivity, so the resulting grayscale value approximates perceived brightness rather than a purely mathematical average of the three channels.

### A brief, honest look at HSV

RGB mixes color (chromaticity) and intensity (brightness) inseparably into three coupled numbers: darkening a pure red pixel changes all three of R, G, and B simultaneously. **HSV** (Hue, Saturation, Value) re-parametrizes the same color information so that Value alone carries brightness, and Hue and Saturation carry color identity, independent of how bright or dark the pixel is. This matters concretely for later work: `thresholding-and-otsus-method` operates on a single intensity channel, and segmenting "all the red objects" regardless of lighting is far more robust done on HSV's Hue channel than on RGB directly, where a shadow changes all three channel values at once. This discipline does not build out full HSV-based segmentation, but names the reason honestly rather than leaving it a mystery why some real systems prefer HSV before thresholding.

## Worked Examples

### Example 1: grayscale conversion of one pixel

An RGB pixel with R=200, G=50, B=50 (a saturated red):

```text
Gray = 0.299*200 + 0.587*50 + 0.114*50
     = 59.8 + 29.35 + 5.7
     = 94.85 ~= 95
```

Compare a plain unweighted average: (200+50+50)/3 = 100. Close in this case, but for a pure green pixel (R=50, G=200, B=50), the weighted formula gives 0.299*50+0.587*200+0.114*50 = 14.95+117.4+5.7 = 138.05, noticeably brighter than the plain average of 100, correctly reflecting that green contributes more to perceived brightness than the plain average would suggest.

### Example 2: the same scene, two channels, at a boundary pixel

Reusing `digital-images-as-discrete-functions`'s 4x4 diagonal-stripe image, but now as a color image where the stripe is pure red on a dark gray background:

```text
R channel:            G channel:            B channel:
[ 10  10 200  10]     [ 10  10  10  10]     [ 10  10  10  10]
[ 10 200  10  10]     [ 10  10  10  10]     [ 10  10  10  10]
[200  10  10  10]     [ 10  10  10  10]     [ 10  10  10  10]
[ 10  10  10 200]     [ 10  10  10  10]     [ 10  10  10  10]
```

Grayscale at the stripe pixel (2,0): Gray = 0.299*200 + 0.587*10 + 0.114*10 = 59.8+5.87+1.14 = 66.81 ~= 67, noticeably dimmer than the pure-white stripe (200,200,200) used in the original single-channel example, which would grayscale to exactly 200. This shows concretely that a colored stripe and a white stripe with the same R value do not produce the same grayscale intensity, a fact any later thresholding step on this converted image must account for.

### Example 3: HSV separating color from brightness

Two red pixels under different lighting, RGB (200, 20, 20) (bright red) and (100, 10, 10) (the same red, in shadow, half the brightness). In RGB, all three channel values differ between the two, an intensity threshold or a per-channel comparison sees them as very different pixels. Converted to HSV, both have the same Hue (approximately 0 degrees, pure red) and the same Saturation, differing only in Value. A segmentation rule based on Hue alone would correctly group both pixels as "red," regardless of the lighting difference, exactly the robustness a pure-RGB or pure-grayscale approach lacks.

## Common Misconceptions & Pitfalls

- **"Grayscale conversion is just averaging the three channels."** Example 1 shows the standard, perceptually weighted formula gives a different, more perceptually accurate result than a plain average, particularly for saturated green or blue pixels.
- **"Processing each color channel independently is exactly equivalent to processing a true color-aware image."** Stated honestly in Core Theory: independent per-channel processing ignores correlation between channels, a real, acknowledged simplification this discipline's classical techniques make, not a claim that it is lossless or ideal.
- **"HSV is a totally different, unrelated representation from RGB."** HSV is a deterministic re-parametrization of the same RGB information (a coordinate transform), not new data; the benefit is purely that it separates two things, color identity and brightness, that RGB entangles, useful for making later thresholding decisions more robust to lighting.

## Summary

A color image is three stacked discrete functions on the same pixel grid, one per RGB channel, each an instance of `digital-images-as-discrete-functions`'s single-channel representation. Converting to grayscale uses a perceptually weighted formula, not a plain average, because human brightness sensitivity varies by wavelength, and HSV re-parametrizes the same color information to separate hue from intensity, a genuine practical advantage for later segmentation work this discipline names honestly without building out in full. With representation now settled for both grayscale and color images, the next concepts turn to the first real processing operation: the convolution and correlation operation that every fixed-kernel technique in this discipline is built from.

## Documentation Links

- [Gonzalez and Woods: Digital Image Processing, 4th Edition (Pearson, 2018)](https://www.pearson.com/en-us/subject-catalog/p/Gonzalez-Digital-Image-Processing-4th-Edition/P200000003224?view=educator): the source for this concept's RGB-to-grayscale luminance weighting and its Color Image Processing chapter's treatment of HSV and related color spaces.
