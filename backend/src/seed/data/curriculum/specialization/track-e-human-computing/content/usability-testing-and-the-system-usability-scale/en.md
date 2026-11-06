---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Plan a usability test as formative or summative, with tasks, participants, and measures to match.
- Name the think-aloud variants, and say what each costs in validity and in task time.
- Compute the discovery formula, show how the answer moves with the detection rate $p$, and state what "five users" means.
- Score the System Usability Scale correctly, including the reversed even items, and detect the usual scoring error.
- Give the source and sample of the mean of 68.

## Context & Motivation

`nielsens-ten-heuristics-and-heuristic-evaluation` predicts problems without users. A usability test watches representative users attempt representative tasks. Nielsen reduces the basic version to three steps: recruit representative users, give them representative tasks, and let them do the talking.

Lewis and Sauro (2020) separate two conceptions of usability work: detecting and eliminating problems (formative) and measuring against goals (summative). Many arguments here come from applying a number from one to the other. "Five users" is formative advice, and it says nothing on the precision of a task time or a SUS mean.

## Core Theory

### Planning a test

| Decision | Formative | Summative |
|---|---|---|
| Question | What breaks, and why? | How well does it perform against a target? |
| Sample | Few per round, then fix and retest | Larger, chosen for an interval or a comparison |
| Talk during tasks | Yes | No, if time is a measure |

Tasks shape the result. In CUE-2, Molich reports, nine teams created 51 different tasks for the same interface, with scant agreement on which tasks were critical, and Lindgaard and Chattratichart, per Sauro's timeline, showed from CUE-4 data that changing the tasks changes the problems found. A test covers the tasks you chose, not the product.

Observation changes behavior, and convenient participant pools may not represent the target users, as `human-studies-in-computing-research` explains.

### Think-aloud has variants

Think-aloud in usability descends from the protocol analysis of Ericsson and Simon. Usability practice is not the same as their procedure: Boren and Ramey documented the differences, and Wikipedia's summary is that practitioners may need to prompt more often than Ericsson and Simon would allow.

| Variant | When people talk | Strength | Cost |
|---|---|---|---|
| Concurrent | During the task | May be more complete | May interfere with the task, though some concurrent protocols showed no interference |
| Retrospective | After the task, often watching their recording | Less chance of interfering | Reliance on memory and added session time (an inference, not from the source) |
| Concurrent with probes | During the task, with neutral prompts | Reaches reasons that silence hides | Untrained prompting biases behavior |

The first two rows follow Wikipedia's summary of Kuusela and Paul, except where marked. Nielsen (2012) lists the hazards of the concurrent form: the setting is unnatural, people filter what they say, and an untrained facilitator can steer them. Pernice (2014) gives three neutral replies for moments when a participant asks something: **echo** repeats their last words as a question, **boomerang** returns the question ("What do you think?"), and **Columbo** starts a question and trails off, so they fill it in. Nielsen's success-rate article (2001) adds a trade-off that decides many plans: the extra time users spend verbalizing contaminates task time, so a think-aloud session is a poor source of time data.

### Measures

Report task success with a declared rule and time with the sessions it covers, as in `usability-and-its-definition-iso-9241-11`. Nielsen (2006) analyzed 1,520 time-on-task measures for 70 tasks and found a standard deviation of 52% of the mean, after removing excessively slow users, which supports his advice of 20 users for metrics. His later summary (2012) keeps the exceptions apart: at least 20 for quantitative studies, 15 per group for card sorting, 39 for stable eyetracking heatmaps.

### The formula behind "five users"

In Nielsen's 2000 article, the number of problems found by $n$ users is

$$N\bigl(1-(1-L)^n\bigr),$$

with $N$ the total problems and $L$ the proportion found by one user, 31% in his data, averaged across projects. Sauro's timeline records other values: Virzi $p=0.32$, Lewis (1994) $p=0.16$. The same algebra comes from the binomial: a problem that affects a proportion $p$ of users shows up at least once in $n$ independent users with probability $1-(1-p)^n$.

The hypothesis matters more than the algebra. The formula needs users from one population, the same tasks, and it treats $p$ as if one number described all problems.

### What "five users" means

**It means:** with $p=0.31$, five users have about an 84% chance of showing a given problem of that frequency at least once. Nielsen rounds this to 85%. His practical argument follows: spend a budget of 15 users on three rounds of five, because each round checks the fixes and exposes deeper issues.

**It does not mean:**

- That 85% of all problems are found. Sauro's reading is that you see most problems affecting 31% or more of that population on those tasks.
- That five suffice per product. Nielsen limits the formula to comparable users, and suggests 3 or 4 per group for two distinct groups.
- That five suffice for numbers. It concerns discovery, not comparison or estimation.
- That any one group of five is typical (Example 2).

Evidence on this comes on different scales, so the numbers below are not comparable. Faulkner (2003), as reported by Straub (2004), tested 60 users of a web time sheet and drew 100 random subsets per size: five users averaged 85% of the problems the 60 revealed, ranging from 55% to nearly 100%; ten averaged 95% with a low of 82%. Spool and Schroeder (2001), in the same report, found 35% with the first five, and Sauro notes that their users had open-ended tasks across up to four websites. Each denominator is different, and none is the true $N$.

### The System Usability Scale

SUS is a ten-item questionnaire with five response options, created by John Brooke in 1986 as a "quick and dirty" instrument, per Sauro (2011). Odd items are positive and even items are negative. The first two are "I think that I would like to use this system frequently" and "I found the system unnecessarily complex".

Scoring, per Sauro: for odd items subtract 1 from the response, for even items subtract the response from 5, add the ten contributions, and multiply by 2.5. Each contribution runs from 0 to 4, so the sum runs from 0 to 40 and the score from 0 to 100, in steps of 2.5.

**Not a percentage.** A SUS of 68 is arithmetically 68% of the maximum, yet it sits at about the 50th percentile. Reading it as 68% suggests "above average" when it is the average, so Sauro advises reporting a percentile. He cites an example: 74 is near the 70th.

**The 68.** It comes from Sauro's database: he reports over 5,000 users across 500 evaluations, and the mean of those studies is 68 (the 2011 article; a 2013 article says scores from 500 products). It is an average of what was tested, a mix of system types, not a passing grade. Sauro's own grading places 68 in a C. Bangor et al. (2008), as Sauro (2018) reports, used other cut points: acceptable above about 70, not acceptable below about 50, marginal in between. He also reports scores about 11% higher for repeat website users than first-time ones, and for software users with five or more years of experience than for those with 0 to 3.

**Not diagnostic.** Sauro notes that SUS does not say what is wrong, which is why it pairs with observation. He also reports a modest correlation with completion and time, about $r=0.24$, and that items 4 and 10 form a learnability dimension.

## Worked Examples

### Example 1: how the answer moves with $p$

```text
percent of problems of frequency p seen at least once
users      1     3     5     8    10    15    20
p=.05    5.0  14.3  22.6  33.7  40.1  53.7  64.2
p=.10   10.0  27.1  41.0  57.0  65.1  79.4  87.8
p=.16   16.0  40.7  58.2  75.2  82.5  92.7  96.9
p=.31   31.0  67.1  84.4  94.9  97.6  99.6  99.9
p=.50   50.0  87.5  96.9  99.6  99.9 100.0 100.0
```

Five users give 84.4% at Nielsen's $p$, 58.2% at Lewis's, and 22.6% for problems affecting one user in twenty. Strictly reaching 85% takes 6 users at $p=0.31$, 11 at $p=0.16$, 19 at $p=0.10$, and 189 at $p=0.01$. Sauro quotes 5, 18, and 189 for 31%, 10%, and 1%, rounding 84.4% and 84.99% up.

### Example 2: when problems differ

Assume, with no study behind it, a product with 40 problems: ten each at $p=0.6$, $0.31$, $0.1$, and $0.02$. Mean $p$ is $0.2575$, so the formula at the mean predicts 77.4% with five users. Averaging the formula over the actual problems gives 58.5%, a gap of 19 points that comes only from the spread: 99% of the frequent problems are found, and 10% of the rare ones.

For the variation between tests, draw `ps = numpy.array([.6]*10 + [.31]*10 + [.1]*10 + [.02]*10)` and `hits = numpy.random.default_rng(245).random((10000, n, 40)) < ps`, then take `hits.any(axis=1).mean(axis=1)`, with a fresh generator for each $n$.

```text
users   mean found   lowest   5th pct   95th pct   highest
5       58.5%        35.0%    50.0%     67.5%      77.5%
10      70.2%        52.5%    62.5%     77.5%      92.5%
15      76.2%        60.0%    67.5%     85.0%      92.5%
```

A single test of five found as few as 35% and as many as 77.5%.

### Example 3: scoring SUS

The five respondents below are fictitious, invented to exercise the arithmetic. No system was tested.

```python
def sus(r):
    odd = sum(r[i] - 1 for i in range(0, 10, 2))   # items 1, 3, 5, 7, 9
    even = sum(5 - r[i] for i in range(1, 10, 2))  # items 2, 4, 6, 8, 10
    return 2.5 * (odd + even)
```

```text
       items 1 to 10        score   no reversal (wrong)
R1     4 2 4 2 4 2 4 2 4 2   75.0   50.0
R2     5 1 5 2 4 2 5 1 4 2   87.5   52.5
R3     3 3 3 3 3 2 4 3 3 3   55.0   50.0
R4     4 2 3 2 4 3 4 2 3 3   65.0   50.0
R5     2 4 2 4 3 4 3 4 2 4   30.0   55.0
mean                         62.5   51.5
```

For R2, the contributions are 4, 4, 4, 3, 3, 3, 4, 4, 3, 3, which sum to 35, and $35\times2.5=87.5$. The last column subtracts 1 from every item. Positive and negative wording then cancel, and everybody lands near 50 whatever they thought, here from 50 to 55. Sauro reports that 11% of researchers mis-scored the SUS by forgetting to reverse the even items, and that these errors still produce valid-looking scores.

Straight-lining hides too. A respondent who answers 5 to everything scores 50, as does one answering all 3s or all 1s, so agreeing with both positive and negative items looks like a neutral score.

### Example 4: what five scores can say

The fictitious sample has mean 62.5 and standard deviation 21.8. With $t_{0.975,4}=2.776$, the 95% interval is $62.5\pm27.1$, or 35.4 to 89.6. Against 68, a one-sample $t$ test gives $p=0.60$.

Lewis and Sauro give 17.7 as a typical SUS standard deviation. At that value, an interval of $\pm10$ needs 15 respondents and $\pm5$ needs 51, using the iterative $t$ computation. To show a mean 10 points above a benchmark (one-tailed, 95% confidence, 80% power), their table gives 21, and the same computation reproduces it.

Completion rates behave the same way. Five successes of five have a 95% Wilson interval of 56.6% to 100%, and 20 of 20 starts at 83.9%. `aggregation-variability-and-reporting` argues for reporting such variability alongside any mean.

## Common Misconceptions & Pitfalls

- **"Five users find 85% of the problems."** The figure needs $p=0.31$, one population, and the same tasks, and it counts the problems frequent enough to appear.
- **"68 is the passing grade."** It is a mean of a particular database. Bangor's bands and Sauro's grades are different ways to read it.
- **"Talking aloud has no effect on the data."** It affects time at least, so do not report think-aloud times as benchmarks.

## Summary

Think-aloud comes in concurrent, retrospective, and probed forms, and talking contaminates task time. The formula $1-(1-p)^n$ makes "five users" true for one population, one set of tasks, and problems near $p=0.31$: at $p=0.10$ five users give 41%, and mixed frequencies give much less than the mean suggests. Five is a good round size and a poor sample for numbers. SUS adds odd-item scores minus 1 and 5 minus even-item scores, then multiplies by 2.5. It is not a percentage, and its average of 68 comes from Sauro's database of about 500 studies.

## Documentation Links

- [Nielsen (2000): Why You Only Need to Test with 5 Users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/): the formula, the 31% value, and the case for several small rounds.
- [Nielsen (2012): How Many Test Users in a Usability Study?](https://www.nngroup.com/articles/how-many-test-users/): the exceptions, and the case for more studies over more users.
- [Nielsen (2006): Quantitative Studies, How Many Users to Test?](https://www.nngroup.com/articles/quantitative-studies-how-many-users/): variability of task time and the 20-user advice.
- [Nielsen (2012): Thinking Aloud, the #1 Usability Tool](https://www.nngroup.com/articles/thinking-aloud-the-1-usability-tool/): the method, its benefits, and its hazards.
- [Nielsen (2001): Success Rate, the Simplest Usability Metric](https://www.nngroup.com/articles/success-rate-the-simplest-usability-metric/): why verbalizing contaminates task time.
- [Pernice (2014): Talking with Participants During a Usability Test](https://www.nngroup.com/articles/talking-to-users/): echo, boomerang, and Columbo.
- [Wikipedia: Think aloud protocol](https://en.wikipedia.org/wiki/Think_aloud_protocol): origins, concurrent and retrospective variants, and the Boren and Ramey critique, with references.
- [Sauro (2010): Why you only need to test with five users (explained)](https://measuringu.com/five-users/): what the binomial does and does not say.
- [Sauro (2010): A Brief History of the Magic Number 5](https://measuringu.com/five-history/): timeline of the debate with values of $p$.
- [Straub (2004): Enough is enough... but five probably isn't](https://www.humanfactors.com/newsletters/enough_is_enough.html): report of Faulkner (2003) and of Spool and Schroeder (2001).
- [Molich: CUE studies](https://www.dialogdesign.dk/cue-studies/): tasks created by different teams, and reproducibility of evaluations.
- [Sauro (2011): Measuring Usability with the System Usability Scale](https://measuringu.com/sus/): items, scoring, the mean of 68, and its sample.
- [Sauro (2013): 10 Things to Know About the System Usability Scale](https://measuringu.com/10-things-sus/): scoring errors, the all-positive version, and effects of experience.
- [Sauro (2018): 5 Ways to Interpret a SUS Score](https://measuringu.com/interpret-sus-score/): percentiles, grades, adjectives, and acceptability bands.
- [Lewis and Sauro (2022): Sample Sizes for Comparing SUS to a Benchmark](https://measuringu.com/sample-sizes-for-sus-benchmark-tests/): the typical standard deviation and the benchmark sample table.
