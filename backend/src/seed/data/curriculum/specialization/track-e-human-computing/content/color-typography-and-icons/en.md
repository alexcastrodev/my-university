---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Compute relative luminance and the WCAG contrast ratio by hand, and apply the 4.5:1 and 3:1 thresholds without rounding.
- Explain why WCAG luminance, a BT.601 gray value, and HSV Value disagree about the same color.
- Quote color-vision prevalence with its population, and design status colors that do not depend on hue alone.
- Separate legibility from readability, and say what the serif studies measured and what they left open.
- Decide when an icon needs a visible label, using evidence about recognition rather than slogans.

## Context & Motivation

`forms-and-input-design` covers labels and error messages. All of that fails if the text cannot be seen or the error is signaled by a hue the reader cannot separate. `grayscale-color-and-color-spaces` gave the representation: three channels, a BT.601 gray value for image processing, and HSV for separating hue from brightness. Neither of those numbers is the one a contrast check uses, which is the first thing to fix here.

The scope is sRGB screens and mostly Latin text. Each recommendation below names who it was measured on, or says that it is a convention.

## Core Theory

### Relative luminance and contrast ratio

WCAG 2.2 defines both quantities for sRGB. For an 8-bit channel $C_8$, let $c=C_8/255$ and decode it to linear light:

$$C=\begin{cases}c/12.92 & c\le 0.04045\\ \left(\dfrac{c+0.055}{1.055}\right)^{2.4} & \text{otherwise.}\end{cases}$$

Relative luminance and contrast ratio are then

$$L=0.2126R+0.7152G+0.0722B,\qquad \text{contrast}=\frac{L_1+0.05}{L_2+0.05},$$

with $L_1$ the lighter color. The ratio runs from 1 to 21.

**The threshold discrepancy.** Older copies of this formula, and many calculators, use 0.03928 instead of 0.04045. WCAG 2.2 records the change: the old value was in the definition before May 2021, and it "has no practical effect on the calculations in the context of these guidelines." For 8-bit color the effect is exactly zero: level 10 gives $c=0.03922$, below both thresholds, and level 11 gives $c=0.04314$, above both. A loop over all 256 levels finds no level where the two versions differ. Only at higher bit depth can a level fall in between.

### The thresholds

| Criterion (WCAG 2.2) | Level | Requirement |
|---|---|---|
| 1.4.1 Use of Color | A | Color is not the only visual means of conveying information |
| 1.4.3 Contrast (Minimum) | AA | Text 4.5:1, large-scale text 3:1 |
| 1.4.6 Contrast (Enhanced) | AAA | Text 7:1, large-scale text 4.5:1 |
| 1.4.11 Non-text Contrast | AA | 3:1 for parts of controls and graphics needed to identify or understand them |

Large-scale means at least 18 point, or 14 point bold. With 1pt = 1.333 CSS px, that is 24px and $14\times4/3=18.67$px, which the W3C Understanding page writes as approximately 18.5px. Inactive controls, pure decoration, and logotypes are exempt from 1.4.3.

The W3C treats the ratios as thresholds and says that computed values should not be rounded: 4.499:1 does not meet 4.5:1. The 3:1 comes from older ISO and ANSI recommendations for standard vision, and the 4.5:1 multiplies it by a contrast-sensitivity loss of roughly 1.5 associated with 20/40 acuity. So the numbers are a model of one kind of vision loss, built into a pass or fail line. Apart from the split between normal and large-scale text they ignore stroke width, and WCAG notes that very thin fonts are harder to read at low contrast.

### Color vision deficiency: numbers with a population

MedlinePlus Genetics (US National Library of Medicine) gives these figures: color vision deficiency affects an estimated 2.5 percent of people worldwide. Red-green deficiency, the most common form, occurs in about 1 in 12 men and 1 in 200 women **among populations with Northern European ancestry**. It is also common in East Asian populations and less common in almost all other populations studied. Blue-yellow deficiency affects fewer than 1 in 10,000 people worldwide.

So "8 percent of users are colorblind" misleads twice: 1 in 12 is about men, and about one ancestry group. An audience with Northern European ancestry split evenly between men and women gives $\tfrac12(\tfrac1{12}+\tfrac1{200})=4.4$ percent.

The design consequence is 1.4.1, which is about redundancy and not about banning hues. Red and green can coexist if something else separates them: a luminance difference, a shape, a word (Example 3).

### Legibility, readability, and the serif question

Here, **legibility** means how easily letters and words can be told apart, and **readability** means how easily continuous text can be read. The second adds spacing, line length, language, and the reader.

"Serif is better on paper, sans on screen" is usually stated as a law. A clean test available as an open paper is Perea (2013). Its main result is no reliable difference: total sentence reading time was 2370 ms for serif and 2392 ms for sans serif ($p=.32$), and fixation durations and target-word measures showed no font effect. The one significant measure was the number of progressive saccades, 10.74 against 10.58 ($p=.024$), and it vanished when all saccades were counted ($p>.13$). The design matters: 24 Spanish-speaking undergraduates with normal or corrected vision read 120 one-line sentences on a screen, in 14-pt Lucida or Lucida Sans, under an eye tracker. Using one family avoids comparing Times with Helvetica, fonts that differ in much more than serifs.

Perea also reports two earlier results. Arditi and Cho (2005) built three typefaces that differed in serif size, found no significant effect in their three participants, one normally sighted and two with low vision, and concluded that the effects are "unlikely to be of significance at typical print sizes viewed under normal conditions". Moret-Tatay and Perea (2011) found no serif advantage in word identification, with sans serif if anything faster, by a median of 6 ms.

None of this compares paper with screen, or tests long continuous reading. So the honest statement is narrower than either slogan: in these same-family comparisons, under these conditions, serifs made no practical difference. Choose on tone and on how the specific font renders at the size used, and test with your readers if the stakes justify it.

### Hierarchy and spacing

Hierarchy comes from size, weight, spacing, and position. A modular scale is a convention, not a finding: a 1.25 ratio from 16px gives 16, 20, 25, 31.25, and 39.06. Its real interaction with accessibility is the large-text boundary, because crossing it changes the required ratio (Example 4).

Two criteria are often misread. **1.4.12 Text Spacing (AA)** names line height 1.5, paragraph spacing 2, letter spacing 0.12, and word spacing 0.16, all times the font size. Content "is not required to use these text spacing values". The requirement is that nothing is lost when a user overrides spacing to those values. **1.4.8 Visual Presentation (AAA)** lists a width of at most 80 characters (40 for CJK), and again it asks for a mechanism, which the browser may provide. Neither one is a typesetting rule.

### Icons: recognition is learned

The Nielsen Norman Group's 2014 article argues that a few icons (home, print, the magnifying glass for search) enjoy mostly universal recognition, that most others stay ambiguous across interfaces, and that a visible label should accompany them. That is guidance drawn from usability work, not a controlled experiment.

Two later NN/g reports add data, and they measure different things.

- **Hidden navigation, 2016.** With 179 participants on 6 live sites, hiding the main navigation lowered discoverability and raised task time and rated difficulty. Hidden menus were used in 27 percent of desktop cases, against 48 percent for visible and 50 percent for combined navigation. On mobile the figures were 57 percent for hidden and 86 percent for combined (visible was not tested on mobile). This is about hiding navigation, and it does not show that people failed to recognize the icon.
- **Recognition, 2025.** Participants shown hamburger icons in context mostly identified them as the main menu, especially in the expected top-left position and with standard styling (three stacked lines). In one example, the Dick's Sporting Goods icon was still read as a menu with the Menu label removed from the screenshot. The article gives no percentages and says it covered recognizability only, not task time or success. It also reports list and filter icons, built from lines, being read as navigation.

Taken together: recognition grows from exposure and depends on position, and being recognized does not make a hidden control as discoverable as a visible one. A rule of "always label" therefore has exceptions: a standard icon, in its conventional place, for people who know the platform, with the space cost justified. A novel icon, or a heart or star whose meaning varies by site, needs a word. Test by asking people what they expect an icon to do, and again later to check memory.

An icon-only control still needs an accessible name (1.1.1, 4.1.2), 3:1 against its background if the graphic is what identifies it (1.4.11), and a target of at least 24 by 24 CSS pixels, subject to the exceptions in 2.5.8 (AA).

## Worked Examples

### Example 1: one gray level decides a pass

Check `#767676` and `#777777` as text on white. Both are grays, so $L$ is the decoded channel.

```text
hex      C8    c         L         contrast with white
#767676  118   0.462745  0.181164  1.05/0.231164 = 4.5422
#777777  119   0.466667  0.184475  1.05/0.234475 = 4.4781
```

`#767676` passes 1.4.3 and `#777777` fails, although both would round to 4.5. Searching every gray, the lightest that passes on white is `#949494` at 3:1, `#767676` at 4.5:1, and `#595959` at 7:1. Pure red `#FF0000` on white gives 3.9985, which fails for body text and passes for large text.

### Example 2: three "brightness" numbers for one color

The first two rows are the pixels used in `grayscale-color-and-color-spaces`. The last two are pure yellow and pure blue.

```text
RGB             BT.601 gray   HSV V   WCAG L   contrast with white
(200, 50, 50)    94.85        0.784   0.1479   5.31
(50, 200, 50)   138.05        0.784   0.4222   2.22
(255, 255, 0)   225.93        1.000   0.9278   1.07
(0, 0, 255)      29.07        1.000   0.0722   8.59
```

HSV Value calls the first two equal and the last two equal, yet white text passes on one of each pair and fails on the other. Value is the largest channel, so it says nothing about luminance. BT.601 ranks the colors correctly here, but it weights gamma-encoded values: 94.85 is 0.372 of full scale, against $L=0.1479$. Only the decoded luminance goes into the contrast formula.

### Example 3: a status pair that relies on hue

Take two badges, red `#D32F2F` for failed and green `#388E3C` for passed. White text passes on the red (4.98) and falls short on the green (4.12, a fail under 1.4.3 at small sizes). Against each other the contrast is only **1.21**, so luminance barely separates them, and the pair depends on hue.

One model of what is lost is the Machado, Oliveira, and Fernandes (2009) matrix from the deuteranomaly column at severity 1.0, which the paper says corresponds to dichromacy. Applied to linearized sRGB, it maps the pair to (139, 124, 40) and (134, 122, 66), with contrast 1.03. That is a simulation, not a reported experience, but it agrees with the luminance figure. There are two fixes.

- Add a non-color cue: a word ("Failed") or a distinct icon. This meets 1.4.1.
- Separate the luminance: dark red `#B71C1C` with light green `#A5D6A7` gives about 4.0, and 3.29 in the simulation.

The second fix also shows that "never use red and green together" is too strong. The defect in the first pair is equal luminance with no redundant cue.

### Example 4: where the large-text boundary falls

Heading gray `#949494` on white is 3.03:1, and body gray `#767676` is 4.54:1. Apply the boundary to the 1.25 scale.

```text
role         size     weight   large-scale?   required   #949494 (3.03)
body         16px     400      no             4.5:1      fails
lead         20px     400      no             4.5:1      fails
lead bold    20px     700      yes            3:1        passes
heading      25px     400      yes            3:1        passes
```

The same color fails at 20px and passes at 25px, and bolding moves 20px across the line because it exceeds 18.67px. A token named `muted` therefore cannot be judged in isolation: its result depends on the size and weight it is paired with.

## Common Misconceptions & Pitfalls

- **"Passing contrast means the text is readable."** It means one luminance ratio clears a line. Thin strokes, small sizes, and busy backgrounds are not in the formula.
- **"The 0.03928 formula gives wrong results."** For 8-bit colors it gives identical results. Use 0.04045 because that is the current definition.
- **"8 percent of users are colorblind."** The figure needs sex and ancestry attached.
- **"A red-green simulator proves a design works."** A simulation is a model of one deficiency at one severity. It does not replace a redundant cue or testing with people who have color vision deficiency.
- **"Hamburger studies prove the icon is not understood."** The 2016 study measured hidden navigation, and the 2025 one found the icon largely recognized.

## Summary

Contrast comes from relative luminance, computed after decoding sRGB, and it is neither a gray value nor HSV Value. The older 0.03928 threshold changes nothing for 8-bit colors. WCAG 2.2 asks for 4.5:1 for text and 3:1 for large-scale text and for meaningful non-text parts at AA, without rounding, and those numbers are a model of moderate vision loss. Prevalence needs its population. Criterion 1.4.1 forbids color as the only visual carrier of meaning, which is a rule about redundancy and not a ban on any hue. Same-family serif studies found no practical difference under their conditions, and they did not test paper against screen. Icon recognition is learned and depends on position, so a label can only be dropped for a conventional icon in a conventional place, and even then the control keeps an accessible name.

## Documentation Links

- [W3C (2024): Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/): the relative luminance and contrast ratio definitions, the note on 0.03928, and criteria 1.4.1, 1.4.3, 1.4.6, 1.4.8, 1.4.11, 1.4.12, and 2.5.8.
- [W3C: Understanding Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): point-to-pixel conversion, no rounding, and the rationale for the ratios.
- [MedlinePlus Genetics: Color vision deficiency](https://medlineplus.gov/genetics/condition/color-vision-deficiency/): prevalence by type and population.
- [Perea (2013): Why does the APA recommend the use of serif fonts?](https://www.psicothema.com/pdf/4073.pdf): the eye-movement experiment with Lucida and Lucida Sans, and its review of earlier serif studies.
- [Machado, Oliveira, and Fernandes (2009): A Physiologically-based Model for Simulation of Color Vision Deficiency](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html): the simulation matrices by severity.
- [Nielsen Norman Group (2014): Icon Usability](https://www.nngroup.com/articles/icon-usability/): which icons are widely recognized, and the case for visible labels.
- [Nielsen Norman Group (2016): Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/): the quantitative study of hidden, visible, and combined navigation.
- [Nielsen Norman Group (2025): The Hamburger-Menu Icon Today: Is it Recognizable?](https://www.nngroup.com/articles/hamburger-menu-icon-recognizability/): recognizability today, the role of position, and the limits of that study.
