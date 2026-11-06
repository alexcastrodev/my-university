---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the task, stimuli, and error measure behind Cleveland and McGill's ranking.
- Tell position on a common scale from position on non-aligned scales, and both from length, in a real chart.
- Say what Heer and Bostock's crowdsourced replication confirmed and changed, and what later studies add about individuals and tasks.
- Explain what "preattentive" means and name its limits.
- Pick a chart from the comparison it must support, and argue "never use pie charts" with evidence on both sides.

## Context & Motivation

`intuition-and-visualization-of-results` treats plotting as a check on intuition: an outlier, a skew, or a second mode shows up in a plot and hides behind a mean. That lesson says to look at the data. This one asks what the eye can read back from the marks once they are on screen, and how much error each mark type adds. Decoding error can be measured, and it depends on the encoding, the task, and the person.

## Core Theory

### Graphical perception

Heer and Bostock (2010), following Cleveland, use *graphical perception* for the ability of viewers to interpret visual encodings and so decode information in graphs. The rankings they discuss cover quantitative data. They also note a limit: variables interact, so extrapolating from isolated variables is unreliable. Position and shape are decoded largely independently, while hue and saturation are integral.

### What Cleveland and McGill measured

The design of the 1984 *JASA* study:

- **Task.** Two values on a chart are marked. The viewer estimates what percentage the smaller is of the larger.
- **Stimuli.** The position-length experiment had five judgment types, and each subject got a packet of fifty charts on individual sheets. A separate position-angle experiment used a different task format, so its results are hard to compare with the first (Heer and Bostock make this point).
- **Participants.** It was a lab study in which every subject judged every chart. Cleveland and McGill's own words, quoted by Davis et al. (2022): "each subject judged all of the experimental units in an experiment". The open replications do not repeat the head count, so that number has to come from the 1984 article.
- **Measure.** Log absolute error, then midmeans (means of the middle two quartiles) by chart, then means with bootstrapped 95% intervals:

$$\text{error}=\log_2\left(\lvert\text{judged}-\text{true}\rvert+\tfrac18\right).$$

The $\tfrac18$ handles exact answers, and the logarithm makes the scale relative.

Xu, Williams, and Wall (2023) report the hierarchy from a 1986 follow-up with isolated stimuli, from most to least accurate: position on a common scale, position on non-aligned identical scales, length, direction, angle, slope, area, volume, shading, saturation. Other summaries list a slightly different set (Nguyen et al. 2025 pair direction with slope and include curvature). Use the top of the list with more confidence than the tail, and treat each step as a claim about this task: judging the ratio of two values.

### Common scale, non-aligned scales, and length

These three are easy to blur.

| Elementary task | What the eye has | Typical design |
|---|---|---|
| Position, common scale | Marks against one shared axis | Dot plot, or bars from one baseline |
| Position, non-aligned scales | Identical scales that are offset on the page | Panels stacked vertically, each with the same y axis |
| Length | Extents with no shared start | Upper segments of a stacked bar |

The middle row is still position: the same numbers appear on each scale, and the reader carries a value from one axis to the other. The last row loses the scale altogether, because each segment starts somewhere else. Heer and Bostock label their first three judgment types as position on a common scale and types 4 and 5 as length, so on that labeling their comparison says nothing direct about non-aligned scales.

### What later work confirmed and changed

Heer and Bostock ran the proportional judgment task on Mechanical Turk with $N=50$ per chart. Subjects saw 380 by 380 pixel charts, gave a "quick visual judgment", and received \$0.05 per judgment. As a check, they first named the smaller value, and only 14 of 3,481 answers were wrong (0.4%).

| Question | Result |
|---|---|
| Ranking of types 1 to 5 | Preserved, with new values similar but not identical |
| Types 1 and 2 | Closer than in the lab, perhaps because a smaller display reduced the effect of distance |
| Types 4 and 5 (length) | More accurate than in the original, and position still significantly better |
| Pie angle and circular area, same task format | Area worse than angle, both significantly worse than position |
| Angle against length | Theory predicts angle is worse. The results do not support that |
| Rectangular area | Matches circular area on average. Aspect ratio 1 was the worst case, consistent with viewers using side lengths as a proxy |

The replication gave up control of display, lighting, and viewing distance, and the authors limit the method to experiments insensitive to those conditions.

Davis et al. (2022) ask whether the ranking holds for individuals, using 109 crowdsourced participants and 130,800 judgments on bar, pie, stacked bar, and bubble charts. Bars were best on average. But about 20 to 25% of people consistently did better with another chart, fewer than 40% are expected to share the canonical order of bar first and pie second, and expected differences across pie, bubble, and stacked bars (1 to 1.5 points) are smaller than expected differences between people (1.5 to 3 points). The authors question whether rankings are the right form for guidance, and suggest effect sizes with uncertainty.

Task changes the answer too. Davis et al. report that Hollands and Spence found the ranking does not necessarily explain discrimination (which is larger), and that Yuan et al. found it does not apply to comparing multiple values. Saket et al. (2018) tested five chart types on ten tasks with 180 US Mechanical Turk workers on small datasets (5 to 34 points), and effectiveness varied significantly by task. Bertini et al. (2020) argue that precise reading of two values is one task among many: a position-only dot plot can be worse for seeing the overall picture than bars or lines. In a small tactile replication, 12 university students showed a different order for tactile encodings (Xu et al. 2023).

### Preattentive processing, and its limits

Wolfe (2021) gives the working sense: before selective attention reaches an item, some processing of it has already happened, and "A preattentive feature is a property capable of guiding the deployment of attention." Wolfe and Horowitz (2017) list color, motion, orientation, and size as undoubted guiding attributes, with others such as shape as probable. Pop-out is the visible effect: search time barely grows as distractors are added.

Five limits matter for charts.

1. **Not instantaneous.** Wolfe (2021) says that earlier accounts treated this stage as essentially instantaneous and that this is "not correct". He reports that even basic color guidance takes 200 to 300 ms to be fully effective (Palmer et al. 2019).
2. **Not flat.** Pop-out slopes are near, "but typically a little greater than", 0 ms per item, and Wolfe reports that response times in basic feature searches grow with the log of set size (Lleras et al. 2020).
3. **Visible is not the same as guiding.** A half-degree tilt is easy to detect and does not guide attention. A 0° target does not pop out among 5° distractors (Wolfe 2020).
4. **Context sets the strength.** Salience rises with the target's difference from distractors and with how homogeneous the distractors are (Wolfe and Horowitz 2017). One red point pops out from gray points, and much less from a rainbow.
5. **Not every property.** Intersection type, for example, is not a basic feature, so a plus among similar shapes does not pop out.

Guidance tells the eye where to go. It does not read a value, so a highlight color can direct attention to a bar while the comparison still relies on position or length. Wolfe also warns that the term is unpopular in some circles, partly because it suggests a stage that runs for a fixed time and then ends.

### Choosing by the comparison

This table is a synthesis for this lesson, and each row is a starting point.

| The reader must | Start with | Watch for |
|---|---|---|
| Compare two or more values closely | Dots or bars on one axis, sorted | Long labels, many categories |
| Describe a trend | A line (in Zacks and Tversky, as Saket et al. report, people described trends from lines and compared values from bars) | A nominal x axis, where a line implies order |
| See a distribution | A histogram or dot plot, as in `intuition-and-visualization-of-results` | Bin width changes the shape |
| See a whole and one part | A pie or one stacked bar with few parts | Comparing many similar parts |
| Follow totals and one component | Stacked bars, with that component at the bottom | Other components become length judgments |
| Get an overview of many series | Bars or lines (Bertini et al.) | Exact reading gets harder |

### "Never use pie charts"

The evidence for the rule is real and narrow: for judging the ratio of two values, pie angle did significantly worse than position (Heer and Bostock), and bars were best on average (Davis et al.). The rule still fails in several places.

- For part-to-whole estimation, Skau and Kosara report that Simkin and Hastie found pies and bars equally suited.
- Saket et al. report that Spence and colleagues found pies beat bars when comparing combinations of proportions.
- In Saket et al.'s own study, pies matched bars and tables for Extremum, Retrieve, and several other tasks, and were less accurate for Correlation, Anomalies, and Distribution. Their pies had uniquely colored slices, which the authors think helped on one task.
- Skau and Kosara (2016) found that angle was the least important cue in pies and donuts, so "pies are bad because angle is bad" misdescribes how they are read.

So the rule holds for ranking close values, where a sorted bar chart serves better. It fails for a whole with few parts, when the point is the share of the whole.

## Worked Examples

### Example 1: reading the error scale

The measure is awkward until you invert it. Error $=0$ gives $\log_2(1/8)=-3$, the floor. An error of 1 point gives $0.17$, 3 points $1.64$, and 10 points $3.34$. The axis of Heer and Bostock's Figure 4 runs from 1.0 to 3.5, which inverts to about 1.9 and 11.2 percentage points, a rough guide since these are means of logs.

Now eight **fictional** viewers judge a true value of 40. These numbers are invented to show the arithmetic, and they are no result about any encoding:

```text
             judgments                  midmean log error   back to points
position A   41 38 40 42 39 45 40 37    0.63                1.42
angle B      50 33 45 30 47 40 28 52    3.09                8.37
```

Sort the eight log errors, drop the lowest two and the highest two, and average the rest. For A that leaves $0.17,\ 0.17,\ 1.09,\ 1.09$, whose mean is $0.63$. An exact answer contributes $-3$, and the midmean keeps such extremes from dominating.

### Example 2: the same data, three elementary tasks

Sales by region, as data for this example:

```text
       A    B    C   total
Q1    30   22   18    70
Q2    44   20   12    76
Q3    26   24   20    70
Q4    50   22    8    80
```

A stacked bar, with one character for 2 units:

```text
Q1   AAAAAAAAAAAAAAABBBBBBBBBBBCCCCCCCCC
Q2   AAAAAAAAAAAAAAAAAAAAAABBBBBBBBBBCCCCCC
Q3   AAAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCC
Q4   AAAAAAAAAAAAAAAAAAAAAAAAABBBBBBBBBBBCCCC
```

Series B is flat, 22 to 22. Its right edge moves from 52 to 72, a shift of 20 inherited from A. To judge B the reader must compare lengths with different starts. A has a shared baseline, so it is position on a common scale, and so are the totals. Give B its own baseline and the question becomes easy:

```text
Q1   ########### 22
Q2   ########## 20
Q3   ############ 24
Q4   ########### 22
```

Four vertically stacked panels with the same axis would be position on non-aligned scales: below this view in the hierarchy, and above the stacked segments. No single chart wins, since the stacked bar shows the totals directly.

### Example 3: pie or bars for one dataset

Shares, as data for this example: North 38, East 24, South 21, West 17, summing to 100.

- **"Is East bigger than South, and by how much?"** South is $21/24=87.5\%$ of East, and the slices differ by $3\times3.6^\circ=10.8^\circ$. This is a close two-value comparison, so sorted bars on one axis fit better.
- **"Do North and East together pass half?"** They reach 62%, or $223.2^\circ$. With slices starting at the top, the 180° line is a quadrant point, the kind of landmark Skau and Kosara rotated their charts to reduce. A pie answers this directly, and so does one stacked bar with a mark at 50.

The second answer is an inference from those sources, and not a tested result for this dataset.

## Common Misconceptions & Pitfalls

- **"Cleveland and McGill proved a universal ranking."** It comes from ratio judgments between two marked values, and the average hides individuals.
- **"Stacked bars are non-aligned position."** Segments above the first have no shared start, so they are read as length.
- **"Angle is worse than length."** The hierarchy lists length higher, but Heer and Bostock's direct comparison does not support it, and the original's two experiments are not comparable.
- **"Preattentive means instant."** Wolfe (2021) rejects that wording, and detection is not guidance.
- **"Never use pie charts."** A rule without a task is folklore. State the comparison.

## Summary

Cleveland and McGill asked viewers to estimate one value as a percentage of another, and scored them with log absolute error. Position on a common scale leads, position on non-aligned scales follows, and length is a different task. Heer and Bostock preserved the order of position over length and found no support for angle being worse than length. Davis et al. show many individuals departing from the average order, and other studies show it changing with the task. Preattentive features guide attention without being instantaneous or enough to read a value. A chart choice starts from the comparison.

## Documentation Links

- [Heer and Bostock (2010): Crowdsourcing Graphical Perception](https://homes.cs.washington.edu/~jheer/files/2010-MTurk-CHI.pdf): replication, and the original's task and measure.
- [Davis et al. (2022): The Risks of Ranking](https://arxiv.org/pdf/2212.10533): individual differences.
- [Xu, Williams, and Wall (2023): Let's Get Vysical](https://arxiv.org/pdf/2308.04392): the hierarchy and a tactile replication.
- [Nguyen et al. (2025): Evaluating Graphical Perception with Multimodal LLMs](https://arxiv.org/pdf/2504.04221): another list of the tasks.
- [Saket, Endert, and Demiralp (2018): Task-Based Effectiveness of Basic Visualizations](https://arxiv.org/pdf/1709.08546): five chart types across ten tasks.
- [Bertini, Correll, and Franconeri (2020): Why Shouldn't All Charts Be Scatter Plots?](https://arxiv.org/pdf/2008.11310): limits of precision.
- [Skau and Kosara (2016): Arcs, Angles, or Areas](https://kosara.net/papers/2016/Skau-EuroVis-2016.pdf): cues in pies and donuts, and earlier studies.
- [Wolfe (2021): Guided Search 6.0](https://search.bwh.harvard.edu/new/pubs/Wolfe2021_GS6.pdf): preattentive features.
- [Wolfe (2020): Visual Search](https://search.bwh.harvard.edu/new/pubs/Wolfe2020_VisualSearch_annurev-vision.pdf): guidance and search.
- [Wolfe and Horowitz (2017): Five Factors That Guide Attention](https://search.bwh.harvard.edu/new/pubs/FiveFactors_Wolfe-Horowitz_2017.pdf): guiding attributes and salience.
