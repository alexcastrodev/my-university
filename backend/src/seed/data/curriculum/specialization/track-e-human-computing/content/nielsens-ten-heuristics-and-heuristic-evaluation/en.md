---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Tell apart four things often merged: the 1990 nine heuristics, the 1994 refinement, the 2020 wording update, and the 0 to 4 severity scale.
- Run a heuristic evaluation in the order the sources give: independent inspection first, aggregation after, severity rating last.
- Compute the Nielsen and Landauer curve, state what it assumes, and show how far the formula sits from Nielsen's own measured curve.
- Show how the "best" number of evaluators moves with the detection rate, the costs, and the objective being optimized.
- Say what the method does not give you, and when a violation is not a problem.

## Context & Motivation

`usability-and-its-definition-iso-9241-11` made usability an outcome of real use, which is expensive to observe. Heuristic evaluation is a cheaper prediction: a few evaluators inspect an interface against recognized principles and list where it breaks them. Nielsen called it explicitly a "discount usability engineering" method, one that does not promise to find every problem. Moran and Gordon (2023) describe it as useful for glaring problems and for stretching a limited research budget, and they state that it cannot replace user research.

No representative user takes part in this method, so a finding is an expert's prediction until someone observes it.

## Core Theory

### Four things with one name

| Year | Item | Source |
|---|---|---|
| 1990 | Nine heuristics | Molich and Nielsen, "Improving a human-computer dialogue", CACM 33(3), 338-348 |
| 1990 | The method | Nielsen and Molich, "Heuristic evaluation of user interfaces", CHI'90, 249-256 |
| 1994 | Ten revised heuristics, from a factor analysis of 249 usability problems | Nielsen, "Enhancing the explanatory power of usability heuristics", CHI'94, 152-158, and a chapter in *Usability Inspection Methods* |
| 1994 | Severity scale | Nielsen, "Severity Ratings for Usability Problems", NN/g, November 1, 1994 |
| 2020 | Reworded definitions, new examples | NN/g page, dated April 24, 1994, last reviewed January 30, 2024 |

The citations are as NN/g gives them, and the 1990 names are those Molich lists on his site. Nielsen's note on the NN/g page says that the 2020 update slightly refined the language and that the heuristics themselves have not changed since 1994. The rewording is visible. Molich's page on the 1994 set prints "The system should always keep users informed about what is going on, through appropriate feedback within reasonable time" for the first heuristic, and NN/g now prints "The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time."

### From nine to ten

Comparing the two lists gives the table below. The mapping is a reading of the two lists, and neither source prints it.

| 1990 (Molich and Nielsen) | 1994 number and name, as NN/g titles it |
|---|---|
| 5 Provide Feedback | 1 Visibility of System Status |
| 2 Speak the User's Language | 2 Match Between the System and the Real World |
| 6 Provide Clearly Marked Exits | 3 User Control and Freedom |
| 4 Be Consistent | 4 Consistency and Standards |
| 9 Error Prevention | 5 Error Prevention |
| 3 Minimize the User's Memory Load | 6 Recognition Rather than Recall |
| 7 Provide Shortcuts | 7 Flexibility and Efficiency of Use |
| 1 Simple and Natural Dialogue | 8 Aesthetic and Minimalist Design |
| 8 Provide Good Error Messages | 9 Help Users Recognize, Diagnose, and Recover from Errors |
| (none) | 10 Help and Documentation |

Item 1 of 1990 also carried "natural and logical order", which NN/g now places under heuristic 2. For the definitions, read the NN/g page: the names above are a checklist, and the page's sentences are what you apply.

### The method

Combining Nielsen (1994) and Moran and Gordon (2023):

1. **Prepare.** Choose the set of heuristics, train the evaluators, set a scope. For a domain-dependent system, supply a usage scenario built from a task analysis, as in `user-research-interviews-personas-task-analysis`.
2. **Inspect alone.** Each evaluator works independently, typically one or two hours, going through the interface at least twice: once for the flow, once for specific elements. Nobody sees another's findings until all are done.
3. **Report each problem separately**, with the heuristic it violates. Saying that you dislike something is not a finding. Listing separately matters because a redesign can repeat a problem no one named.
4. **Aggregate and discuss.** Cluster the issues, and hold a debriefing with the design team.
5. **Rate severity** on the merged list.

The output is a list of problems, not a design. And a violation is not automatically a defect: Moran and Gordon's example is a hamburger menu that violates heuristic 6 and may still be a necessary trade-off on a small screen, which only research can settle.

### Severity is a separate instrument

Nielsen's 1994 scale runs from 0 to 4:

```text
0  I don't agree that this is a usability problem at all
1  cosmetic: fix only if extra time is available
2  minor: low priority
3  major: high priority
4  usability catastrophe: imperative to fix before release
```

Severity combines frequency, impact, and persistence, and Nielsen adds market impact as a further consideration. He suggests collecting ratings after the sessions, through a questionnaire listing every merged problem, because evaluators focused on finding are poor at estimating, and each has seen only a subset. Each rates independently, in about 30 minutes. He says that one evaluator's ratings are too unreliable and that the mean of three is satisfactory for many practical purposes. He frames this as his experience, so treat it as advice, not a measured threshold.

### How many evaluators

Nielsen and Landauer's model, as Nielsen reports it, is

$$\text{ProblemsFound}(i)=N\bigl(1-(1-\lambda)^i\bigr),$$

with $N$ the total number of problems, $\lambda$ the proportion found by one evaluator, and $i$ independent evaluators. Across six case studies, $\lambda$ ranged from 19% to 51% with a mean of 34%, and $N$ from 16 to 50 with a mean of 33. The same page says that single evaluators found 35% averaged over six of his projects.

As written, the formula treats evaluators as independent, and it lets one $\lambda$ describe every evaluator and every problem. The second assumption fails on Nielsen's own data. Figure 1 of the same page shows some problems found by almost everyone and others by very few, and Nielsen (1992) reports 42% for major problems against 32% for minor ones per evaluator. $N$ is also unknown in practice: it is at best the problems known after a lot of searching.

## Worked Examples

### Example 1: the formula against the measured curve

```text
evaluators            1      2      3      5     10     15
formula, lambda=.19  19.0   34.4   46.9   65.1   87.8   95.8
formula, lambda=.34  34.0   56.4   71.3   87.5   98.4   99.8
formula, lambda=.51  51.0   76.0   88.2   97.2   99.9  100.0
```

Now read Figure 2 of Nielsen's page, the average of six case studies: about 34% at one evaluator, 74% at five, 87% at ten, 91% at fifteen (values read off the chart, so approximate). The formula at the mean $\lambda$ says 87.5% at five and 99.8% at fifteen. The two start together and then differ by about 9 to 14 points, so the formula with an average $\lambda$ is optimistic.

Two kinds of spread can cause this, and neither is in the formula. Between projects: six assumed values of $\lambda$ (0.19, 0.25, 0.30, 0.35, 0.44, 0.51, mean 0.34) average to 84.1% at five, so this explains only part of the gap. Between problems: a fit made for this lesson, not from the source, puts 58% of problems at $p=0.51$ and 42% at $p=0.106$ (mean still 0.34), and gives about 74%, 86%, and 92% at 5, 10, and 15. Many mixtures fit, so this shows only that hard problems are enough to bend the curve down.

### Example 2: the optimum moves

Nielsen's sample project has fixed cost \$4,000, \$600 per evaluator, and \$15,000 per problem found (a value that Nielsen and Landauer derived in 1993, and only problems actually fixed pay off). He reports an optimum of four evaluators, cost \$6,400, benefits \$395,000, and a ratio of 62. The page does not state $N$ and $\lambda$. The pair $N=33$, $\lambda=0.33$ reproduces those figures and the shape of his Figure 3, and that pair is an inference. With it:

```text
evaluators        1      2      3      4      5      6      7
benefit/cost    35.5   52.5   59.7   61.8   61.2   59.2   56.7
```

The best ratio moves with the assumptions, keeping $N=33$:

```text
lambda   fixed   per evaluator   best i   ratio
0.33     4,000   600             4        61.8
0.19     4,000   600             6        46.7
0.51     4,000   600             3        75.3
0.33     3,700   410             5        74.5
0.33     4,800   900             4        47.1
```

The last two rows pair the low ends and the high ends of the cost ranges Nielsen publishes. $N$ and the value per problem do not move the best ratio at all, since both only rescale the benefit. The objective does move it. In this model the fifth evaluator adds about \$32,917 of benefit for \$600, and the fourteenth still adds about \$896. Net benefit (benefit minus cost) therefore keeps rising until about 15 evaluators, far past the best ratio. "Three to five" is the answer to the ratio question, under these dollar figures, and with a formula that Example 1 showed to be optimistic. Nielsen himself says that more evaluators should be used when usability is critical or the payoff is large.

### Example 3: estimating lambda from your own results inflates it

You cannot see problems nobody found, so a team that computes $\lambda$ from its own findings divides by found problems instead of $N$. Under the formula's own assumptions, that estimate is

$$\hat\lambda=\frac{\lambda}{1-(1-\lambda)^n}.$$

With true $\lambda=0.34$ and $n=3$ evaluators, $\hat\lambda=0.477$. Plugged back in, it predicts 85.7% coverage when the true figure is 71.3%. Sauro's timeline records the same warning from Hertzum and Jacobsen (2001) for early user data.

### Example 4: severity on a merged list

The problems and ratings below are fictitious, invented for the clinic booking site of the previous lesson to show the arithmetic.

```text
problem                                       heuristic  E1 E2 E3  mean
P1 session expires and wipes the form         5           4  3  4   3.67
P3 date is DD/MM on one screen, MM/DD next    4           3  4  2   3.00
P2 "ERR_SLOT_409" when a slot was just taken  9           3  3  2   2.67
P4 hamburger menu hides "My appointments"     6           2  0  1   1.00
P5 two font weights for the same label        8           1  1  0   0.67
```

E2 alone would put P3 above P1, and E1 and E3 each tie P2 with P3. E2 also rates P4 as 0, meaning E2 does not agree it is a problem, which is the kind of disagreement to discuss: it may be the trade-off described earlier. The means give one ordering, yet a difference of 0.33 among three ratings is thin, so P3 and P2 are better read as the same tier. Nielsen ties level 4 to fixing before release, and he allows that a release with only cosmetic problems may go ahead.

## Common Misconceptions & Pitfalls

- **"Five evaluators find 75%."** That is roughly Figure 2, an average of six studies. Single projects vary, and the formula says something else again (Example 1).
- **"The ten heuristics date from 1990."** The nine do. The ten come from 1994, and the sentences on NN/g today were reworded in 2020.
- **"Severity comes with the evaluation."** It is a separate scale, and Nielsen suggests rating after the sessions.
- **"Every violation must be fixed."** Moran and Gordon say otherwise, while Nielsen warns against betting that your design is one of the few exceptions.
- **"It replaces testing with users."** Each method finds things the other misses, and domain-specific problems can be nearly impossible to find without users. The CUE studies report that usability inspections by experts reached a quality comparable to usability tests in CUE-4, and also that independent professional teams often do not reproduce one another's results.
- **"Three to five is a law."** It is the best ratio for one cost model (Example 2).

## Summary

Nine heuristics appeared in 1990, ten in 1994 after a factor analysis of 249 problems, and NN/g reworded them in 2020. Severity is a separate 0 to 4 scale, best collected after the sessions from several evaluators. The method needs independent inspection, each problem listed with its heuristic, and aggregation only at the end. The Nielsen and Landauer formula assumes one detection rate for all evaluators and problems, and with the mean rate it overstates Nielsen's own measured curve. Four evaluators is the best benefit-to-cost ratio for one sample project, and the answer moves with the detection rate, costs, and objective. A finding is a prediction, and a violation can be a justified trade-off, so heuristic evaluation complements observing users and does not replace it.

## Documentation Links

- [NN/g: 10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/): the current wording, dated April 24, 1994, last reviewed January 30, 2024, with Nielsen's note on the history.
- [Nielsen (1994): The Theory Behind Heuristic Evaluations](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/theory-heuristic-evaluations/): the procedure, the formula, the six-study curve, and the cost-benefit example.
- [Moran and Gordon (2023): How to Conduct a Heuristic Evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/): the current step-by-step guide and the hamburger menu trade-off.
- [Nielsen (1994): Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/): the 0 to 4 scale and how to collect ratings.
- [Nielsen: Characteristics of Usability Problems Found by Heuristic Evaluation](https://www.nngroup.com/articles/usability-problems-found-by-heuristic-evaluation/): detection of major and minor problems, and alternating with user testing.
- [Molich: Molich and Nielsen's heuristics (1990)](https://www.dialogdesign.dk/molich-and-nielsens-heuristics-1990/): the nine original heuristics.
- [Molich: Nielsen's heuristics (1994)](https://www.dialogdesign.dk/nielsens-heuristics-1994/): the ten heuristics, in a wording that differs from NN/g's current one.
- [Molich: CUE studies](https://www.dialogdesign.dk/cue-studies/): comparative evaluations of reproducibility among professional teams.
- [Sauro (2010): A Brief History of the Magic Number 5](https://measuringu.com/five-history/): timeline of the sample-size debate, including the inflated estimates.
