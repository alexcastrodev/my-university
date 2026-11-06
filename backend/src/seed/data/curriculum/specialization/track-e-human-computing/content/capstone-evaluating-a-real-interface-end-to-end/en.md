---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Plan an evaluation that states its users, tasks, context, and what it does not cover.
- Combine task analysis, heuristic evaluation, a usability test, and a WCAG check, and say what kind of evidence each one gives.
- Separate what a tool measured, what an evaluator judged, and what only a test with people can show.
- Turn mixed findings into one prioritized list with severity, evidence, and a fix.
- Report the limits of an evaluation as plainly as its findings.

## Context & Motivation

A list of problems with no evidence behind it gets argued away, and an accessibility score with no task behind it gets mistaken for usability. This capstone applies the methods of the discipline to one real interface: the FP-Growth lesson page of this site, `https://university.kurz.fyi/computer-science/ai-theory/data-mining/fp-growth`, as it stood on 2026-11-04. Readers can open the page and repeat the checks. The site may have changed since, because an evaluation is a dated statement about one version.

The limits come first, because they shape everything below. One evaluator made one pass. No participants took part. No screen reader was run. The scope is English, the light theme, and a signed-out reader.

## Core Theory

### Four methods, four kinds of evidence

| Method | Needs | Can show | Cannot show |
|---|---|---|---|
| Task analysis (`user-research-interviews-personas-task-analysis`) | A goal and the interface | Steps, plans, long paths | Which path people choose |
| Heuristic evaluation (`nielsens-ten-heuristics-and-heuristic-evaluation`) | Several evaluators | Likely problems against known principles | Whether people hit them |
| Usability test (`usability-testing-and-the-system-usability-scale`) | Participants | Observed failures, time, ratings | Conformance |
| WCAG check (`accessibility-and-wcag`) | A tool and manual checks | Failures of named criteria | That the page is easy to use |

The methods overlap little, which is the reason to combine them. In this evaluation the tool found the blocked zoom and missed the horizontal overflow, and neither the tool nor the heuristics can say whether a reader understands the page.

### Label the evidence

Every line of a report should say where it came from. This one uses three labels: **measured** (a script or tool returned it), **judged** (an evaluator's reading of the interface), and **fictitious** (invented to show arithmetic). A measured line can still be unimportant and a judged line can still be right, but a reader has to be able to weigh them differently.

### From severity to priority

Severity on Nielsen's 0 to 4 scale combines frequency, impact, and persistence, and ratings are stronger when several evaluators give them. Priority adds cost: of two problems of equal severity, the cheap fix goes first. A requirement can override both, for example when a contract or a law asks for WCAG AA.

## Worked Examples

### Step 1: scope

- **Users:** a student reading alone, as in `what-hci-studies-users-tasks-and-context`, on a laptop or a phone.
- **Goal:** reach and read the worked examples of a lesson whose topic is known.
- **Context:** 1280 by 800 on desktop, 390 and 320 wide on a phone, signed out.
- **Not covered:** signed-in features, the dark theme, tablets, and pt-BR beyond one automated run.

### Step 2: task analysis

Hierarchical task analysis, with plans:

```text
0. Reach the worked examples of FP-Growth     Plan 0: do 1, then 2
1. Open the lesson                            Plan 1: if the name is known, 1.1; otherwise 1.2
   1.1 Search: open with Cmd+K, type "fp-growth", press Enter
   1.2 Browse: from /computer-science, open Data Mining, open FP-Growth
2. Reach the section: scroll to "Worked Examples"
```

**Measured.** Path 1.1 took 11 key actions: the chord, 9 letters, and Enter. The first result was preselected and was the right lesson. Path 1.2 took 2 clicks. Step 2 is where the cost sits:

```text
viewport     page height   "Worked Examples" at   screens to scroll
1280x800          8012 px              2410 px                 3.0
390x844          13687 px              4523 px                 5.4
```

The page has no contents list, and its `h2` elements have no `id`, so a reader can neither jump to a section nor link to one.

### Step 3: heuristic evaluation

**Judged**, by one evaluator in one pass, so the severities are one opinion, and `nielsens-ten-heuristics-and-heuristic-evaluation` explains why several evaluators find more. The evidence for each line is measured or was read from the page.

| ID | Heuristic | Observation | Severity |
|---|---|---|---|
| H1 | Visibility of system status | A signed-out reader sees a disabled "Got it!" button. The reason, "Log in to mark this concept as read", exists only in `title` and `aria-label`, and a disabled button takes no keyboard focus, while a phone has no hover | 2 |
| H2 | Consistency and standards | The phone bar's "Track" opens `/computer-science`, which the desktop sidebar calls "Computer Science", and the desktop also has a different item, "Tracks" | 1 |
| H3 | Recognition rather than recall | The flag and plus chip beside paragraphs has no visible text. Its meaning, "Start a discussion on this paragraph", is only in its accessible name, and the "Markers" switch that controls the chips does not explain them | 2 |
| H4 | Flexibility and efficiency of use | No contents list or section links in a page 3 to 5 screens from its examples | 2 |
| H5 | User control and freedom | Esc closes the search dialog, but focus lands on `body`, not on the button that opened it | 2 |

Good findings belong in the report too. Search handles the keyboard well, the shortcut hint shows `⌘K` on Apple keyboards and Ctrl elsewhere, and the sidebar shows the reader's place among the 16 lessons.

### Step 4: the usability test that was not run

No test ran for this lesson, so nothing here reports behavior. This is the plan a team would run. It is formative: five readers from the target group, concurrent think-aloud, and three tasks.

1. Find the lesson that explains lift.
2. From there, find the example that computes it and say what the number means.
3. Share the location of that example with a classmate.

Task 3 tests H4 directly. The measures are success, time, errors, and SUS. Five readers find most problems only under the assumptions of `usability-testing-and-the-system-usability-scale`, so a rare problem can still be missed.

To show the arithmetic of SUS, here are five sets of responses. **They are fictitious: nobody answered them, and no finding below uses them.**

```text
       items 1 to 10         SUS
R1     4 2 4 2 4 1 4 2 4 2   77.5
R2     3 3 3 2 3 2 4 3 3 3   57.5
R3     5 1 5 2 4 2 5 1 5 1   92.5
R4     3 2 4 3 3 3 3 2 3 4   55.0
R5     4 2 4 1 4 2 4 2 4 2   77.5
mean 72.0, s 15.7, 95% interval 52.6 to 91.4
```

Even with real answers, an interval this wide includes the often cited mean of 68, so five people could not separate this page from an average one. SUS here would add a rating, and the observations would matter more.

### Step 5: WCAG check

**Measured.** axe-core 4.14.0 ran in Chrome with the WCAG 2.0, 2.1, and 2.2 A and AA tags, on three pages at 1280 by 800:

```text
page                                         rules passed   violated
/computer-science/ai-theory/.../fp-growth              25          4
/computer-science                                      23          5
/computer-science/ai-theory/data-mining                19          3
```

On the lesson page axe also left 10 contrast results as incomplete, which need a person. The pt-BR lesson page gave the same four violated rules. The failures, joined with manual checks:

| Criterion | Level | Evidence | Found by |
|---|---|---|---|
| 1.4.4 Resize Text | AA | The viewport tag sets `maximum-scale=1, user-scalable=no` | axe |
| 1.4.3 Contrast (Minimum) | AA | `#9ca3af` on `#f9fafb`, 12 px text, 2.43:1 against 4.5:1, on 42 nodes of the lesson page | axe |
| 1.3.1 Info and Relationships | A | `ul` with `button` children; on `/computer-science`, a row role without its required parent and children | axe |
| 2.5.3 Label in Name | A | Visible text missing from the accessible name, 5 nodes | axe |
| 1.4.10 Reflow | AA | At 320 wide the page scrolls sideways by 12 px, because an inline `code` holding a long call does not wrap | Manual |

The formula gives 2.43 and axe prints 2.42, a rounding difference. Replacing the color with `#6b7280` gives 4.63:1 on the same background.

Some checks passed. `lang` is right in both languages, and all 12 Tab stops measured had an outline or a shadow in computed style, which shows that a focus style exists and not that it is visible enough. A reader tabs through 11 stops before the first content link, and there is no skip link and no `main` landmark. WCAG accepts other ways of meeting 2.4.1, headings among them, so this is recorded as a usability problem and not as a failure.

Focus also stays on `body` after search navigates to a lesson. What a screen reader announces at that moment is unknown, because none was run.

### Step 6: prioritized findings

| # | Finding | Evidence | Severity | Fix | Cost |
|---|---|---|---|---|---|
| 1 | Zoom blocked | Measured, AA | 3 | Remove the two viewport settings | One line |
| 2 | Low contrast | Measured, AA | 3 | Darken one color token | One token, then rerun |
| 3 | List and role structure | Measured, A | 3 | Move buttons inside `li`, complete the roles or use a table | Small |
| 4 | Label in name | Measured, A | 2 | Put the visible text in the accessible name | Small |
| 5 | Sideways scroll at 320 | Measured, AA | 2 | `overflow-wrap: anywhere` on inline code | One rule |
| 6 | Focus lost after search | Measured, judged | 2 | Return focus on close, move it to `h1` after navigation | Small |
| 7 | No section navigation | Measured, judged | 2 | Add `id`s and a contents list | Medium |
| 8 | Reason for "Got it!" hidden | Judged | 2 | Show the reason as text | Small |
| 9 | No skip link or `main` | Measured | 2 | Add both | Small |
| 10 | Unlabeled discussion chip | Judged | 2 | Add a visible label or a first-use hint | Small |
| 11 | "Track" and "Tracks" | Judged | 1 | Use one vocabulary | Small |

Items 1 and 2 lead because they are cheap, they affect reading itself, and they fail AA. Item 7 has the same severity as item 8 and sits above it because it affects the task from Step 2 on every long lesson, and that ordering is a judgment too. The next step is a retest: run the same scripts after the fixes and confirm that the failures are gone and nothing new appeared.

## Common Misconceptions & Pitfalls

- **"A clean axe run means the page is accessible."** axe missed the sideways scroll, the lost focus, and the 11 stops before the content. See `accessibility-and-wcag`.
- **"Heuristic evaluation replaces testing with people."** It predicts problems. Whether readers hit H3 at all is an open question here, since nobody was observed.
- **"One evaluator is enough for a real report."** It is enough to show the method. A team should merge independent passes.
- **"Invented numbers are better than none."** The SUS table above shows arithmetic and supports nothing. A report that mixed it into the findings would be false.
- **"Severity is a measurement."** It is a judgment made on a scale, which is why this report keeps the evidence next to it.
- **"Sort by severity and stop."** Without cost, a one-line fix waits behind a redesign.

## Summary

This evaluation combined four methods on one dated page, and each found what the others could not. Task analysis measured the distance to the worked examples, 3 screens on desktop and 5.4 on a phone. One heuristic pass raised five problems. The usability test was planned and not run, so its SUS table is fictitious and informs nothing. axe and manual checks found failures of five criteria at A and AA, including blocked zoom and contrast of 2.43:1. The result is one list that keeps evidence, severity, fix, and cost together, and that states its limits: one evaluator, no participants, no screen reader. The next honest step is to fix, rerun, and put the page in front of readers.

## Documentation Links

- [W3C, Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/): the success criteria and levels cited in Step 5.
- [W3C, Understanding SC 2.4.1: Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html): the accepted ways of meeting 2.4.1.
- [Deque, axe-core](https://github.com/dequelabs/axe-core): the rule engine used in Step 5.
- [Nielsen Norman Group, 10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/): the heuristics applied in Step 3.
- [Nielsen Norman Group, Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/): the 0 to 4 scale and what it combines.
- [MeasuringU, Measuring Usability with the System Usability Scale](https://measuringu.com/sus/): SUS scoring and the mean of 68.
