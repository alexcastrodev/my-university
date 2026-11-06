---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Separate information architecture (what goes where, and what it is called) from navigation controls (how people move through it).
- Report what the breadth and depth studies measured, and explain why the "three-click rule" is not a design rule.
- Use the evidence on hidden and visible navigation without stretching it past its design.
- Choose between a modal and a non-modal dialog, and describe how they differ in a real browser.
- Say what card sorting and tree testing each produce, and analyze a small data set from each.

## Context & Motivation

`prototyping-fidelity-sketch-wireframe-mockup-prototype` asks which dimension must be real. For navigation it is often the words and the hierarchy, and you can test those with no layout at all.

Findability failures have two common causes. People may not see the control, or they may see it and not understand where it leads. Pernice and Budiu's study below concerns the first cause, and card sorting and tree testing concern the second. Swapping the menu widget will not fix a confusing hierarchy, and renaming a hierarchy will not fix a menu nobody opens.

## Core Theory

### Structure and controls

**Information architecture** (IA) is the structure of the content: the categories, their labels, and their nesting. **Navigation** is the set of interface elements that expose that structure, such as a top bar, a sidebar, breadcrumbs, or a menu. One IA can be presented through several controls.

People choose a path by predicting what lies behind a label. That prediction is usually called **information scent**. Strong scent means the label lets you judge the destination without visiting it.

### Breadth versus depth

A fixed set of items can be organized wide and shallow or narrow and deep. Larson and Czerwinski summarize D. Miller's study, in which four structures held 64 items ($2^6$, $4^3$, $8^2$, and $64^1$) and $8^2$ gave the fastest acquisition and the fewest errors. They also summarize Snowberry et al., who found that memory span did not predict performance while visual scanning did. Their own pre-tests of memory and scanning predicted nothing reliably. That matters because "seven plus or minus two" is a claim about short-term memory, not a limit on menu items, and menus are scanned more than memorized. Laubheimer (2019, NN/g) lists "no more than 7 main-navigation categories" alongside the three-click rule as a myth not supported by data.

Larson and Czerwinski's own experiment used 19 experienced web users, three structures of 512 bottom-level items built from Encarta, and search tasks on 128 items common to all three.

| Structure | Mean time (SD) | Time-outs at 5 min | Voted best |
|---|---|---|---|
| 16×32 | 36 s (16) | 2 | 2 of 19 |
| 32×16 | 46 s (26) | 3 | 11 of 19 |
| 8×8×8 | 58 s (23) | 9 | 6 of 19 |

The effect of hierarchy was significant ($F(2,36)=6.34$, $p<.01$). The 8×8×8 structure was significantly slower than both others, and 16×32 and 32×16 did not differ significantly. So in this experiment added depth hurt, and the broadest option did not win either: its mean was slower, though not reliably. Preference also disagreed with performance, since most people voted for a structure that was not the fastest on average. The authors note a weakness: an editor built the categories, and they were not user tested. These are 19 people searching one encyclopedia, so read the result as a direction, not a formula.

### The three-click rule

The rule says no page should take more than three clicks to reach. Laubheimer (2019) traces the earliest published reference he could locate to Zeldman's *Taking Your Talent to the Web* (2001), which offers no data for it.

Porter (2003) is the measurement usually cited. Using a study of 44 users attempting 620 tasks, with more than 8,000 clicks, he reports no correlation between the number of clicks and success at finding content. Users were no more likely to quit after three clicks than after 12. Successful and unsuccessful tasks had the same distribution of lengths, and the share of unsatisfied users stayed between 46% and 61% across lengths. Some users went up to 25 pages.

This is a consultancy article without statistical detail, on information-finding tasks, and it does not show that clicks are free. Porter's conclusion is that failing to find something is what bothers users, and clicks are the symptom they name. Laubheimer's alternative is strong scent, clear wayfinding, and short load times.

### Navigation patterns

Pernice and Budiu (2016, NN/g) measured hidden navigation (behind an icon such as a hamburger), visible navigation, and combo navigation (some of each). The study was a remote test with 179 participants in the UK, 99 on desktop and 80 on phones, who did 2 tasks on each of 6 live sites.

| Metric | Desktop | Phone |
|---|---|---|
| Used navigation, hidden | 27% | 57% |
| Used navigation, visible | 48% | not tested |
| Used navigation, combo | 50% | 86% |
| Slower with hidden navigation | at least 39% | 15% |

Three limits apply. Visible navigation was not tested on phones. Navigation type was a property of each live site, not assigned at random, so site differences are mixed in. And the authors note that not clicking a menu can mean people found something better. The authors conclude that hiding navigation degrades the experience more on desktop than on phones, and on desktop there is room to show it.

### Menus in code

A site's navigation menu is a set of links. An application menu is a widget of commands, as in a desktop editor, and ARIA has `menu` and `menubar` roles for it. The WAI-ARIA Authoring Practices example for site navigation avoids the `menu` role, because assistive technology expects complex functionality from it that typical site navigation does not need. It uses disclosure buttons that show and hide lists of links, and warns that its code is illustrative and must be tested with assistive technology.

### Windows and dialogs

Fessenden (2017, NN/g) defines a **mode** as a state in which the same input can have different results. Caps Lock is the everyday case. A **modal dialog** puts the system in a special mode: it disables the main content until the user responds. A **non-modal** dialog leaves the main content usable. The WAI-ARIA Authoring Practices state: "Windows under a modal dialog are inert."

Fessenden lists the costs of modality, such as interrupted work and lost context, and reserves modal dialogs for important warnings, such as when work could be lost or an action cannot be undone. This is reasoned guidance, and the article reports no controlled comparison.

### Card sorting and tree testing

In a **card sort**, participants group labeled cards in the way that makes sense to them (Tankala and Sherwin 2024, NN/g). In an open sort they invent the groups, in a closed sort the categories are predefined, and a hybrid mixes both. In a **tree test**, participants see only the bare hierarchy, with no layout or content, and must find where a given item lives (Laubheimer 2023, NN/g). Laubheimer calls card sorting generative and tree testing evaluative, and warns that newcomers often run a sort when they need a tree test.

| | Card sort | Tree test |
|---|---|---|
| Question | How do people group this content? | Can people find things in this tree? |
| Input | About 30 to 50 cards | Full tree, tasks, correct answers |
| Output | Similarity matrix, dendrogram, group names | Per-task success, other categories chosen, time, directness |
| Cannot tell you | Whether people can find anything | Why, in unmoderated form, or what tree to build instead |

**Sample size.** Nielsen (2004) reports Tullis and Wood's study: 168 people sorted cards, and random subsets were compared with the full result. The correlation of similarity scores was 0.75 at 5 users, 0.90 at 15, 0.93 at 20, 0.95 at 30, and 0.98 at 60. Tullis and Wood recommended 20 to 30 users, and Nielsen 15 from the same data. Those numbers come from one study and measure agreement with the large sample, not the quality of the resulting IA.

## Worked Examples

### Example 1: from cards to a similarity matrix

The six sorts below are invented so that the arithmetic can be followed by hand. They are not observations. Cards: T Tuition, S Scholarships, C Course catalog, E Exam calendar, L Library hours, M Campus map.

```text
P1  TS | CE | LM        P4  TS | CE | LM
P2  TS | CEL | M        P5  TS | CE | L | M
P3  TSE | C | LM        P6  TSC | E | LM
```

Similarity is the share of participants who put a pair together. C and E share a pile for P1, P2, P4, and P5, so $4/6=0.67$.

```text
     T     S     C     E     L     M
T  1.00  1.00  0.17  0.17  0.00  0.00
S  1.00  1.00  0.17  0.17  0.00  0.00
C  0.17  0.17  1.00  0.67  0.17  0.00
E  0.17  0.17  0.67  1.00  0.17  0.00
L  0.00  0.00  0.17  0.17  1.00  0.67
M  0.00  0.00  0.00  0.00  0.67  1.00
```

Average-linkage clustering on $1-\text{similarity}$ (`scipy.cluster.hierarchy.linkage`, method `average`, SciPy 1.18.1) merges T+S at distance 0, C+E and L+M at 0.333, then {T,S}+{C,E} at 0.833, and everything at 0.958. The dendrogram suggests three groups. It does not supply labels, and "T+S" is not yet a menu item.

### Example 2: testing two trees

From that sort, a team drafts two trees. Tree A has Money, Academics, Campus. Tree B has Costs, Courses, Calendar, Campus. The counts below are invented to show the analysis, with 40 different participants per tree (a between-subjects design, as Laubheimer advises). Task 1: find next semester's cost. Task 2: find the date of your final exam.

```text
tree task  success       95% Wilson        direct
A    1     31/40  0.775  [0.625, 0.877]    22/40  0.550
B    1     24/40  0.600  [0.446, 0.737]    20/40  0.500
A    2     18/40  0.450  [0.307, 0.602]     9/40  0.225
B    2     33/40  0.825  [0.681, 0.913]    29/40  0.725
```

Fisher's exact test gives $p=.147$ for Task 1 and $p=.00096$ for Task 2. In these invented data, A's lead on Task 1 could be noise, while B's lead on Task 2 is not. Tree B wins that task despite departing from the sort's three groups, which shows why a sort's output is an input to a tree, not the tree. The low directness of Tree A on Task 2 is the next thing to investigate, since in a real study it would mean people wandered before settling.

### Example 3: the rule against Larson's data

Count one selection per level to reach a bottom-level item: three in 8×8×8 and two in either two-level structure.

```text
structure  leaves  minimum clicks  obeys 3-click rule  mean time
16×32      512     2               yes                 36 s
32×16      512     2               yes                 46 s
8×8×8      512     3               yes                 58 s
```

All three obey the rule, so it cannot separate them, yet the 8×8×8 structure was slowest and had 9 of the 14 time-outs. This compares minimum paths, and a real search can take many more.

### Example 4: modal behavior in a browser

Two dialogs were opened in Chrome 156 with `<dialog>`, one with `show()` and one with `showModal()`. A real mouse click landed on a button behind the dialog, and then Esc was pressed.

```text
method       click reached button   still open after Esc
show()       yes                    yes
showModal()  no                     no
```

`showModal()` gives you inertness and Esc handling without extra code, as MDN documents. Use the modal form for "Delete this project? This cannot be undone." Use the non-modal form for a find-and-replace panel, where the user must keep reading and editing the document behind it.

## Common Misconceptions & Pitfalls

- **"Everything must be within three clicks."** No published data supports the number, and Example 3 shows it cannot separate structures with different measured times.
- **"Menus should have at most seven items."** That misapplies a short-term memory result. Larson's fastest structure had 16 top-level items.
- **"Wider is always better."** The flattest structure lost in both studies above: $8^2$ beat $64^1$ in D. Miller's, and 32×16 had a slower mean than 16×32 in Larson's. Very deep structures did poorly too.
- **"A card sort gives us the IA."** Laubheimer (2023) says it does not usually produce the exact scheme to follow. People make catch-all piles they would avoid in a real menu.
- **"The tree test passed, so navigation is fine."** It tests the hierarchy alone, with no layout, search, or page content. A label that works in the tree can still sit behind a menu nobody opens.
- **"Hamburger menus are always wrong."** The evidence favors showing navigation where there is room. On phones, the study compared hidden with combo only, so it does not show that visible navigation would fit.

## Summary

Information architecture is the structure and its labels, and navigation is how the interface exposes them. In the menu and web studies reviewed here, very deep structures hurt search and the broadest one did not automatically win, and neither "three clicks" nor "seven items" holds up: the first has no supporting data, and the second misapplies a memory result. Hidden navigation reduced use and slowed tasks in a 179-person study, more on desktop. A modal dialog makes everything else inert, so reserve it for decisions that deserve the interruption. Card sorting generates groupings, with a similarity matrix as its output, and tree testing evaluates a hierarchy, with success and directness per task as its output.

## Documentation Links

- [Larson, Czerwinski (1998): Web Page Design](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/chi98_webdesign.pdf): the 512-item breadth and depth experiment and its review of menu studies.
- [Porter (2003): Testing the Three-Click Rule](https://articles.centercentre.com/three_click_rule/): 44 users, 620 tasks, click counts against success and satisfaction.
- [Laubheimer (2019): The 3-Click Rule](https://www.nngroup.com/articles/3-click-rule/): origin of the rule and better practices.
- [Pernice, Budiu (2016): Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/): results on hidden, visible, and combo navigation.
- [Tankala, Sherwin (2024): Card Sorting](https://www.nngroup.com/articles/card-sorting-definition/): definition, variations, analysis, and limits.
- [Laubheimer (2023): Tree Testing](https://www.nngroup.com/articles/tree-testing/): method, metrics, and the contrast with card sorting.
- [Nielsen (2004): Card Sorting, How Many Users to Test](https://www.nngroup.com/articles/card-sorting-how-many-users-to-test/): report of the Tullis and Wood subsampling study.
- [Fessenden (2017): Modal and Nonmodal Dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/): definitions, costs, and guidelines.
- [WAI-ARIA APG: Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): inert content and keyboard behavior.
- [WAI-ARIA APG: Disclosure Navigation Menu](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/): site navigation without the menu role.
- [MDN: The dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog): `show()`, `showModal()`, and closing behavior.
