---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the Fitts, Welford, and Shannon formulations of the index of difficulty, and say whose each one is.
- Fit $a$ and $b$ by regression on published data, for one device and task.
- Compute index of difficulty for real target sizes, separating measured from assumed.
- State Hick's law with its formula, its experimental conditions, and what practice and compatibility do to it.
- Explain why Hick's law does not say that menus must be short, and say where each model stops applying.

## Context & Motivation

`mental-models-and-the-gulfs-of-execution-and-evaluation` described execution as a stage of action. These two models put numbers on small parts of it: how long aiming takes, and how long choosing among alternatives takes. Both came from 1950s experimental psychology, when information theory was new, and both are often stretched. The goal here is to run them correctly, and to know when they say nothing.

## Core Theory

### Fitts's experiment

Fitts (1954) ran four experiments: two reciprocal tapping tasks (a 1-oz and a 1-lb stylus), a disc transfer task, and a pin transfer task. In the tapping tasks, a participant moved a stylus back and forth between two plates as fast as possible, tapping their centers. Fitts crossed four amplitudes $A$ with four widths $W$. MacKenzie (2018) reproduces the 1-oz summary data, and reports 16 participants, with each mean built from more than 600 observations.

Fitts defined an index of difficulty in bits, by analogy with Shannon's channel capacity theorem, with distance as signal and width as noise. His central claim was that the rate $ID/MT$ stays roughly constant across difficulties.

### Three formulations

| Formulation | Index of difficulty | Source |
|---|---|---|
| Fitts | $\log_2(2A/W)$ | Fitts (1954) |
| Welford | $\log_2(A/W+0.5)$ | Welford (1960, 1968) |
| Shannon | $\log_2(A/W+1)$ | MacKenzie (1989, 1992), direct analogy with Shannon's theorem |

This lesson uses the Shannon formulation for predictions, because it cannot go negative for any positive $A/W$, unlike the other two for small $A$. Fitts's own form appears in Example 1 for comparison. The prediction equation is

$$MT=a+b\cdot ID,$$

where $a$ and $b$ come from regression on one device, task, and group of people. MacKenzie notes that this equation does not appear in Fitts's 1954 publication: Fitts divided ID by MT directly, and this regression form came later. A positive intercept can absorb costs unrelated to difficulty, such as a button press. Coefficients do not travel: his 1992 survey of device studies found indices of performance from 1.1 to 13.7 bits/s, and intercepts from $-880$ to $1030$ ms, with disagreement even for the same device.

### Effective width and throughput

Fitts's model tacitly assumes that 96% of hits land in the target. When error rates differ from 4%, the target width is replaced by an effective width $W_e$, which is $4.133\times SD$ of the endpoints. The ISO 9241-9 method, now ISO 9241-411, uses this to report **throughput** in bits/s, combining speed and accuracy. Throughput measures; the regression line predicts.

### Hick's law: formula and conditions

Hick (1952) and Hyman (1953) studied choice reaction time. In the common form, as given by Liu and colleagues (2020), whose review is the source for the experimental details below,

$$T=a+b\cdot H,\qquad H=\log_2 n\ \text{ (equally likely)},\qquad H=\sum_{i=1}^n p_i\log_2\frac{1}{p_i}.$$

Card and colleagues' textbook version uses $\log_2(n+1)$. Hick's own experiments favored the $+1$, which accounts for uncertainty about whether a stimulus will occur at all. This lesson uses $\log_2 n$ for $H$ and shows both in Example 3.

Hick's setup explains the hypotheses. Ten lamps in an irregular circle were wired to a device that lit one at random, every 5 seconds, and each finger rested on a Morse key assigned to a lamp. The participant pressed the matching key. In the first experiment, Hick was the only participant, after more than 8,000 training trials. Hyman then varied entropy through the number of stimuli, their probabilities, and sequential dependencies. So the law concerns a learned, arbitrary stimulus-response mapping, with a stimulus that arrives unpredictably and a response of negligible duration.

Liu and colleagues state the result this way: choice reaction time for a simple task grows linearly with stimulus entropy, in the range of 1 to 4 bits. The slope gets shallower with higher stimulus-response compatibility and with heavier training, and with enough learning the effects of compatibility and uncertainty can be reduced almost to zero.

### What flattens Hick's law

- **Compatibility.** Hick's lights-and-keys task gave about 200 ms/bit. Pressing a key that vibrates under a finger (Leonard), or reading digits aloud (Mowbray), gave virtually no effect of uncertainty.
- **Practice.** Knight and Dagnall reported slopes falling from 73 to 23 ms/bit after two months. Seibel reported almost no difference between 31 and 1,023 alternatives after more than 75,000 trials.
- **Interfaces.** Liu and colleagues reanalyzed two selection tasks with highlighted commands, and found 32 and 8 ms/bit on a tablet, and 4 ms/bit with a mouse.

In most interfaces the mapping is highly compatible: the target is the thing you were looking for. Their conclusion is that in HCI tasks, choice reaction time can often be treated as constant.

### What Hick's law does not support

The popular reading is "keep menus short". Liu and colleagues argue that the law, taken at face value, says the opposite, because the logarithm is concave. Splitting $N$ items into pages or categories costs more, as Example 4 runs. They make that argument assuming, for its sake, that the law applies. There may be good reasons for short menus, but they lie elsewhere, in visual search above all. If a person examines items one by one, time grows linearly with $N$, and that case does favor grouping by category.

A logarithmic curve in your data does not imply Hick's law either. Hierarchical search (Landauer and Nachbar) and scrolling an alphabetical menu (Cockburn and Gutwin) can be logarithmic through a divide-and-conquer strategy.

### Where each model stops

| Situation | Fitts | Hick |
|---|---|---|
| Finger on small touch targets | Weak: use FFitts (Example 2) | Not the issue |
| Expert using shortcuts | Silent: no aiming, or no pointer | Slope near zero with practice |
| Searching for an item | Silent: the model starts once the target is known | Does not apply: linear scan is not choice reaction |
| Slow, careful movement | Weak: it models rapid aimed movement | Not the issue |
| Very easy targets | Curves up below about ID 3 in some data | Not the issue |
| Many alternatives, above about 4 bits | Not the issue | Often overestimates; the range depends on the task |
| Screen-edge targets | Mouse gains, touch does not (NN/g, 2022) | Not the issue |

The cells marked silent are this lesson's reading. The others come from the sources above.

## Worked Examples

### Example 1: regression on Fitts's 1-oz stylus data

The movement times come from Fitts (1954) as tabulated by MacKenzie (2018). Times are in ms, and $A$ and $W$ in inches.

```text
 W \ A      2     4     8    16
 0.25     392   484   580   731
 0.50     281   372   469   595
 1.00     212   260   357   481
 2.00     180   203   279   388
```

```python
import numpy as np
from scipy import stats

A = np.array([2, 4, 8, 16] * 4, float)
W = np.repeat([0.25, 0.5, 1, 2], 4)
MT = np.array([392, 484, 580, 731, 281, 372, 469, 595,
               212, 260, 357, 481, 180, 203, 279, 388], float)
We = np.array([.243, .244, .235, .247, .444, .468, .446, .468,
               .725, .812, .914, .832, 1.020, 1.233, 1.576, 1.519])

models = {"Fitts,   W ": np.log2(2 * A / W),
          "Welford, W ": np.log2(A / W + 0.5),
          "Shannon, W ": np.log2(A / W + 1),
          "Fitts,   We": np.log2(2 * A / We),
          "Shannon, We": np.log2(A / We + 1)}
for name, ID in models.items():
    f = stats.linregress(ID, MT)
    print(f"{name}  ID {ID.min():.2f}-{ID.max():.2f}  a={f.intercept:7.2f}"
          f"  b={f.slope:6.2f}  r2={f.rvalue**2:.4f}")
```

```text
Fitts,   W   ID 1.00-7.00  a=  12.80  b= 94.67  r2=0.9664
Welford, W   ID 0.58-6.01  a=  65.36  b=103.79  r2=0.9802
Shannon, W   ID 1.00-6.02  a=  27.69  b=111.54  r2=0.9873
Fitts,   We  ID 1.97-7.02  a= -73.19  b=108.89  r2=0.9814
Shannon, We  ID 1.57-6.04  a= -31.43  b=121.98  r2=0.9877
```

The first line reproduces MacKenzie's $MT=12.8+94.7\,ID$, and the last his re-analysis ($R^2=.9877$). All rows fit the same 16 means, so comparing them is fair. The improvement concerns the easy end: at $A=W=2$, observed 180 ms, the Fitts fit predicts 107 ms and the Shannon fit 139 ms.

The last row also shows a trap. Its intercept is negative, so the line reaches zero time at $ID\approx0.26$ bits. That is outside its data, and it warns against extrapolating. These are stylus numbers from 1954, so none of them predict a mouse or a finger today. Doubling $A/W$ from 8 to 16 adds 0.92 bits, which costs 102 ms with the Shannon slope. Halving $W$ has the same effect in the formula, although MacKenzie notes studies such as Sheridan (1979) in which narrowing the target raised time more than the equivalent increase in distance.

### Example 2: real target sizes, and where touch breaks the model

WCAG 2.2 sets 24 by 24 CSS pixels as the Level AA minimum (Success Criterion 2.5.8, which has exceptions such as sufficient spacing), and 44 by 44 for Level AAA (2.5.5). At a distance of 400 CSS pixels, chosen for this example:

```text
W = 24:  ID = log2(400/24 + 1) = 4.14 bits
W = 44:  ID = log2(400/44 + 1) = 3.33 bits     difference 0.81 bits
```

The ID is unitless, and it does not depend on a device. A time needs a slope. Take $b=200$ ms/bit, an **assumed** value near the inverse of a typical mouse throughput (MacKenzie gives about 4 to 5 bits/s). The larger target then saves about 160 ms per selection, and $a$ cancels in the difference.

For fingers, the formula itself weakens. Bi, Li, and Zhai (2013) ran a 1D task on a phone with 12 participants, using their index fingers. Each $A\times W$ condition had 16 trials.

```text
A  W     error    ID nominal  ID effective  ID FFitts  time (ms)
20 2.4    29%       3.22        2.32         2.89        432
30 2.4    38%       3.75        2.69         3.13        483
20 4.8    14%       2.37        2.07         2.34        383
30 4.8    11%       2.86        2.53         2.82        433
20 7.2     3%       1.92        1.97         2.18        367
30 7.2     6%       2.37        2.34         2.53        394
```

Sizes are in mm. Regressing their time on each index:

```text
ID nominal    T = 243.8 +  62.4 ID    R2 = 0.956
ID effective  T =  77.7 + 145.5 ID    R2 = 0.862
ID FFitts     T = 109.8 + 115.4 ID    R2 = 0.958
```

The third line matches their published fit. Their point is that a finger has an absolute imprecision that speed does not change. FFitts removes that component, $\sigma_a$, from the endpoint spread. Effective width assumes all spread is a speed choice, so it does poorly here. At 2.4 mm, effective width was more than twice the nominal width. Note that the nominal fit looks fine at $R^2=0.956$ while hiding error rates up to 38%. A time prediction says nothing about those misses.

To relate this to WCAG, **assume** 160 CSS pixels per inch: 24 px is then 3.8 mm and 44 px is 7.0 mm. These fall between the 2.4 and 4.8 mm rows and near the 7.2 mm row. This is a rough comparison across very different setups, not a test of WCAG. Their study measured isolated targets, and 2.5.8 also addresses spacing to neighbors.

### Example 3: the size of a Hick effect

Going from 4 to 32 options adds 3 bits under $\log_2 n$, or 2.72 under $\log_2(n+1)$. Multiply the 3 bits by reported slopes:

```text
Hick, lights and keys      ~200 ms/bit    600 ms
Knight and Dagnall, early    73 ms/bit    219 ms
Knight and Dagnall, late     23 ms/bit     69 ms
Mouse command selection       4 ms/bit     12 ms
```

These slopes come from different tasks, so this is a sense of scale and not one comparison. Unequal probabilities reduce the cost too. For 8 items with frequencies proportional to $1/i$ (a Zipf shape, assumed here), $H=2.62$ bits versus 3.00 for equal frequencies.

### Example 4: 32 items, three layouts

Following Liu and colleagues, compare one page, 4 random pages of 8, and 4 categories of 8. Take the law as given, and use **assumed** $a=0.2$ s and $b=0.15$ s/bit. Then add a second model: a linear scan at an **assumed** 0.25 s per item, stopping at the target and ignoring the time to change pages.

```text
Layout              Hick form                      Hick    Scan
One page of 32      a + 5b                         0.95 s  16.5 items  4.13 s
4 random pages      2.5(a + 3b)                    1.63 s  16.5 items  4.13 s
4 categories of 8   2a + 5b                        1.15 s   7.0 items  1.75 s
```

The Hick column favors one flat page. The scan column favors categories, assuming that the person knows which category to choose. So "split the menu" follows from search, and not from Hick's law.

Now add pointing to compare a novice and an expert. Take a vertical menu with items of height $h$, the pointer starting just above the first item, so $A=i\,h$ and $W=h$, with $ID=\log_2(i+1)$ and targets equally likely. Using the assumed $b=200$ ms/bit, the assumed scan rate, and no intercept:

```text
n     mean ID    expert: pointing    novice: scan + pointing
8     2.31        462 ms             1587 ms
16    3.02        604 ms             2729 ms
32    3.83        767 ms             4892 ms
```

This is a teaching construction with assumed constants, not a measurement. Its shape is the lesson: for the expert, who already knows the position, doubling the list adds about 150 ms, while for the novice, search dominates.

## Common Misconceptions & Pitfalls

- **"Hick's law says menus should be short."** It concerns choice reaction, and taken literally it favors one long list.
- **"Fitts's law gives the time for this button."** Only with $a$ and $b$ measured for that device, task, and population.

## Summary

Fitts's law predicts aimed movement time with $MT=a+b\,ID$, here in MacKenzie's Shannon form, $\log_2(A/W+1)$. Coefficients belong to a device and task, and effective width corrects for errors. For small touch targets, FFitts models the finger's absolute imprecision. Hick's law relates choice reaction time to entropy in simple, trained tasks, from about 1 to 4 bits, and compatibility and practice can flatten it to near zero. It does not support short menus: that case rests on visual search, which neither model covers.

## Documentation Links

- [MacKenzie (2018): Fitts' Law](https://www.yorku.ca/mack/hhci2018.html): handbook chapter with Fitts's 1-oz data, formulations, effective width, throughput, and a touch study.
- [MacKenzie (1992): Fitts' Law as a Research and Design Tool in HCI](https://www.yorku.ca/mack/hci1992.html): formulations, reanalysis, known problems, and the across-study comparison.
- [Liu et al. (2020): How Relevant is Hick's Law for HCI?](https://hal.science/hal-02867301/document): authors' version, covering the experiments, limits, reanalysis, and design argument.
- [Bi, Li, and Zhai (2013): FFitts Law](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41645.pdf): the dual-distribution hypothesis, the touch experiments, and the data in Example 2.
- [Budiu (2022): Fitts's Law and Its Applications in UX](https://www.nngroup.com/articles/fitts-law/): practical implications, including screen edges on mouse and touch.
- [W3C: Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): the Level AA criterion, its exceptions, and its intent.
- [W3C: Understanding SC 2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html): the Level AAA criterion.
