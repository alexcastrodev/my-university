---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Name the current published WCAG version, and the status of WCAG 2.1 and the WCAG 3 draft.
- Cite success criteria by number and level, and state what WCAG 2.2 added to and removed from 2.1.
- Explain why native semantics and keyboard operation come before ARIA.
- Run axe-core on a page and read its three result groups: violations, incomplete, and passes.
- State what an automated pass, a manual review, assistive technology testing, and testing with disabled users can each establish.

## Context & Motivation

`semiotic-engineering-communicability-and-the-designers-message` treats an interface as a message from designer to user. Accessibility asks whether that message arrives at all for someone who does not see the screen, does not use a mouse, or needs text larger than the layout expected. `color-typography-and-icons` computed one requirement, the contrast ratio. This lesson places it in the whole standard, and then asks what a green test run proves.

## Core Theory

### Which document is the standard

As of November 2026 the current published version is **WCAG 2.2**, a W3C Recommendation first published on 5 October 2023 and updated on 12 December 2024. The W3C's overview lists no later Recommendation. It is also an ISO standard: the W3C says ISO/IEC 40500:2025 "is exactly the same as the October 2023 version of WCAG 2.2." Three facts about status prevent most confusion.

- WCAG 2.2 "does not deprecate or supersede WCAG 2.1". A law or contract that names 2.1 still names 2.1, although the Working Group recommends 2.2 as the new target.
- WCAG 2.2 is backward compatible by design: content conforming to 2.2 also conforms to 2.1 and 2.0.
- **WCAG 3 is not a standard.** The latest publication is a Working Draft dated 10 September 2026, whose status section says that publication "does not imply endorsement by W3C and its Members." The W3C's introduction calls it "an incomplete draft that will change" and does not expect it to be a completed standard "for a few more years". Nothing in it can be cited as a requirement today.

### Structure and conformance

WCAG 2.2 has four principles (perceivable, operable, understandable, robust), 13 guidelines, and, parsed from the published text, 86 active success criteria: 31 at Level A, 24 at AA, and 31 at AAA. The criteria are the testable layer. Level AA means satisfying all 55 at A and AA.

Conformance has five requirements: a level met in full, full pages, complete processes, only accessibility-supported ways of using technologies, and non-interference. Two consequences matter. Excluding a part of a page rules out conformance for that page, and one failing step in a checkout fails the process. Accessibility-supported means that the way a technology is used "has been tested for interoperability with users' assistive technology", so assistive technology is written into the conformance model itself.

AAA is not a sensible site-wide target: WCAG says that "it is not possible to satisfy all Level AAA success criteria for some content". It also warns that even AAA content "will not be accessible to individuals with all types, degrees, or combinations of disability". Conformance is a floor.

### What changed from 2.1 to 2.2

Nine criteria were added, and one was removed.

| New in 2.2 | Level |
|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | AA |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA |
| 2.4.13 Focus Appearance | AAA |
| 2.5.7 Dragging Movements | AA |
| 2.5.8 Target Size (Minimum) | AA |
| 3.2.6 Consistent Help | A |
| 3.3.7 Redundant Entry | A |
| 3.3.8 Accessible Authentication (Minimum) | AA |
| 3.3.9 Accessible Authentication (Enhanced) | AAA |

**Removed: 4.1.1 Parsing (Level A)**, now marked "Obsolete and removed". It existed because assistive technology once parsed HTML directly, and today it relies on the browser. The W3C FAQ adds that what used to fail 4.1.1 fails other criteria, such as 1.3.1 or 4.1.2. The old versions were annotated too: WCAG 2.1 and 2.0 now say that 4.1.1 "should be considered as always satisfied for any content using HTML or XML", although WCAG 2.2 still warns that authors bound by policy to the older versions "may need to continue to test and report 4.1.1".

The AAA criterion 2.5.5 Target Size was renamed Target Size (Enhanced), and new criteria were appended to their guidelines, so number order no longer implies level order. Comparing the two published texts shows no other criterion changing level or name: 2.4.7 Focus Visible stays at AA.

### Semantic markup and ARIA

Native elements carry a role, a name, and keyboard behavior. A `<button>` is focusable, activates with Enter and Space, and is exposed as a button. A `<div onclick>` gets none of that. This is criterion 4.1.2 Name, Role, Value (A) and 1.3.1 Info and Relationships (A) in practice: what the eye gets from layout must also exist in the markup.

ARIA can change what is exposed, and it changes nothing else. The W3C's authoring guide opens with "No ARIA is better than Bad ARIA" and calls a role "a promise": `role="button"` on a `<div>` commits the author to writing the keyboard behavior by hand.

### Keyboard access

The core criteria are 2.1.1 Keyboard (A), 2.1.2 No Keyboard Trap (A), 2.4.3 Focus Order (A), 2.4.7 Focus Visible (AA), and 2.4.11 Focus Not Obscured (Minimum) (AA). The test needs no tool: put the mouse away, press Tab through the page, and activate everything with Enter or Space. The W3C notes that this also serves keyboard emulators, such as speech input software and on-screen keyboards.

### Four kinds of check

| Check | Can establish | Cannot establish |
|---|---|---|
| Automated rules (axe-core) | The presence of defects a rule can detect | Conformance, or that a page is usable |
| Manual review against the criteria | Whether each criterion is met, by human judgment | How real assistive technology behaves, unless tested |
| Assistive technology testing | What one screen reader and browser pair actually exposes | That disabled users can do the task |
| Testing with disabled users | Whether real people complete real tasks | Conformance: usable for these participants is not all criteria met |

Figures on automation need their denominators. The axe-core README claims "on average 57% of WCAG issues" are found automatically, without giving the method there. The UK Government Digital Service built a page with 143 failures and ran 10 tools in 2017: 42 barriers (29 percent) were missed by all of them. The best tool found 37 percent on errors and warnings, and another reached 41 percent when prompts for manual inspection were counted. These figures measure different things, one a share of issues in the vendor's terms and the other a share of barriers planted on one test page, so neither corrects the other, and the GDS audit is dated. The W3C's summary is the stable part: "Web accessibility evaluation tools can not determine accessibility, they can only assist in doing so."

WebAIM's February 2026 scan with WAVE found detected WCAG 2 failures on 95.9 percent of one million home pages, led by low-contrast text at 83.9 percent. Only automatically detectable failures count, so WebAIM concludes that full A/AA conformance was certainly lower than 4.1 percent.

Assistive technology testing is a separate activity that an automated tool does not simulate: a person operating, for example, NVDA, JAWS, VoiceOver, or TalkBack, listening to what is announced during a task. **No screen reader was used in the examples below.** They show axe-core output, keyboard events sent by Playwright, and the browser's accessibility tree. The W3C recommends involving people with disabilities throughout a project, and warns both that user involvement alone cannot determine whether a site is accessible and that results from a couple of people do not generalize.

## Worked Examples

All runs use axe-core 4.14.0 with default options, injected by Playwright into Chrome 156. The listings are compact summaries of the `axe.run()` result.

### Example 1: a page axe can fail

```html
<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div style="font-size:32px">Checkout</div>
  <img src="chart.svg">
  <p style="color:#777777;background:#ffffff">Your order ships in 3 days.</p>
  <input type="text" placeholder="Email">
  <button><svg width="16" height="16"><circle cx="8" cy="8" r="7"/></svg></button>
</body>
</html>
```

```text
violations 8
button-name [critical] wcag2a,wcag412 nodes=1
color-contrast [serious] wcag2aa,wcag143 nodes=1
document-title [serious] wcag2a,wcag242 nodes=1
html-has-lang [serious] wcag2a,wcag311 nodes=1
image-alt [critical] wcag2a,wcag111 nodes=1
landmark-one-main [moderate] best-practice nodes=1
page-has-heading-one [moderate] best-practice nodes=1
region [moderate] best-practice nodes=4
incomplete 0
passes 9   inapplicable 75
```

Five violations are tagged with a success criterion: 4.1.2, 1.4.3, 2.4.2, 3.1.1, and 1.1.1. The other three are best-practice rules, which are advice and not WCAG failures, so "8 WCAG failures" would be wrong. `#777777` is the 4.48:1 gray from `color-typography-and-icons`.

One line is missing: the input has no `<label>`, yet `label` is among the passes, because axe's check `non-empty-placeholder` accepted the placeholder as a name. A name exists for the rule, but it disappears as soon as someone types. The rule answers a narrower question than the designer's.

### Example 2: a clean run with a real defect

The second page fixes all of the above: `lang`, a title, `<main>`, `<h1>`, a real `<label>`, `#767676`, and `alt="chart"`. It also has a payment control and a promotion on a gradient:

```html
<p class="promo">Free returns this week</p>
<div class="pay" onclick="pay()">Pay now</div>
<p id="out" role="status"></p>
```

```text
violations 0
incomplete 1
color-contrast [serious] wcag2aa,wcag143 nodes=1
    .promo ["Element's background color could not be determined due to a background gradient"]
passes 26   inapplicable 64
```

Zero violations, and the page cannot be paid by keyboard. In a real run, Tab was pressed four times, then Enter, then the mouse clicked the control.

```text
Tab sequence [ 'INPUT#email', 'BODY', 'INPUT#email', 'BODY' ]
after Enter, status= ""
after mouse click, status= "Paid"
```

Focus never reaches the control, which fails 2.1.1 (A) and, with no role exposed, 4.1.2 (A). The accessibility tree shows why, comparing `<button>` with the `<div>` on a test page, both labeled Pay now:

```text
- main:
  - button "Pay now"
  - text: Pay now
```

Replacing the `<div>` with `<button>` gives this, Tab pressed twice and then Enter:

```text
violations 0
incomplete 1
passes 27   inapplicable 63
Tab sequence [ 'INPUT#email', 'BUTTON' ]
after Enter, status= "Paid"
```

axe reports 0 violations for both pages, so its verdict does not separate the broken one from the fixed one. Two more defects survive the clean run. `alt="chart"` satisfies the `image-alt` rule while saying nothing of the data, and 1.1.1 asks for a text alternative serving the equivalent purpose. And the `incomplete` item is a question for a person: at the light end of the gradient, white on `#88CCFF` is 1.73:1.

### Example 3: how much of the standard the rules touch

Reading the tags in axe-core 4.14.0 gives 105 rules, of which 90 run by default (excluding deprecated and experimental ones). Those 90 name 21 distinct criteria, 20 of the 55 at A and AA, plus one at AAA. Some consequences:

- No rule names 2.4.7 Focus Visible, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, or 1.4.11 Non-text Contrast.
- Of the criteria new in 2.2, only 2.5.8 has a rule at all, `target-size`, and it is disabled by default.
- The rules tagged 4.1.1 are deprecated and disabled, matching the removal.
- A tag does not mean coverage. Three rules name 2.1.1, and Example 2 fails 2.1.1 with all of them silent.

This counts rules against criteria, and says nothing of what fraction of real defects is found.

### Example 4: reading a claim

Take the fictional statement "We pass axe, so we are WCAG 2.2 AA conformant." Example 2 refutes the inference. A defensible version says: "axe-core 4.14.0 reported no violations on these 12 pages on this date, and one item needs review." A conformance claim needs what section 5.3 lists (date, guideline title and URI, level, pages, technologies relied upon), and behind it a review of all 55 criteria. If a screen reader was used, say which one, in which browser, for which tasks.

## Common Misconceptions & Pitfalls

- **"Zero axe violations means accessible."** It means the enabled rules found nothing on the states tested. Example 2 cannot be paid by keyboard.
- **"Axe shows every failure it suspects as a violation."** Uncertain cases land in `incomplete`, and a report that hides them hides work.
- **"WCAG 3 replaces 2.2, so wait for it."** It is a draft, and the W3C says that the way to prepare is to meet WCAG 2.2 now.
- **"A browser accessibility tree is a screen reader test."** The tree is an input to assistive technology, and it says nothing of what a user hears or can do.

## Summary

WCAG 2.2 is the current published version, updated in December 2024, while 2.1 remains an existing standard and WCAG 3 remains a Working Draft. Compared with 2.1 it adds nine criteria and removes 4.1.1 Parsing. Native HTML provides role, name, and keyboard behavior that ARIA can only describe. An axe-core pass says that the enabled rules found no defect on the tested state: it is not conformance, and the real run above shows a page with zero violations that keyboard users cannot complete. Automated rules, manual review, assistive technology testing, and testing with disabled users answer different questions, and a report has to say which of them were done.

## Documentation Links

- [W3C (2024): Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/): the normative criteria, levels, conformance requirements, and the comparison with 2.1.
- [W3C WAI: WCAG 2 Overview](https://www.w3.org/WAI/standards-guidelines/wcag/): versions, publication dates, and the ISO relationship.
- [W3C WAI: WCAG 2 FAQ](https://www.w3.org/WAI/standards-guidelines/wcag/faq/): why 4.1.1 Parsing is obsolete, and the notes in 2.0 and 2.1.
- [W3C (2026): WCAG 3.0 Working Draft](https://www.w3.org/TR/wcag-3.0/): the current draft and its status section.
- [W3C WAI: WCAG 3 Introduction](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/): what the draft is and the expected timeline.
- [W3C WAI: ARIA Authoring Practices, Read Me First](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/): no ARIA is better than bad ARIA.
- [W3C WAI: Selecting Web Accessibility Evaluation Tools](https://www.w3.org/WAI/test-evaluate/tools/selecting/): what tools can and cannot do.
- [W3C WAI: Involving Users in Evaluating Web Accessibility](https://www.w3.org/WAI/test-evaluate/involving-users/): working with people with disabilities throughout a project.
- [axe-core on GitHub](https://github.com/dequelabs/axe-core): the rule engine, its result groups, and the 57 percent claim.
- [GDS (2017): What we found when we tested tools on the world's least-accessible webpage](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/): the audit of 10 tools on 143 planted barriers.
- [WebAIM (2026): The WebAIM Million](https://webaim.org/projects/million/): automated results for one million home pages.
