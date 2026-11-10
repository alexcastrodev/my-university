---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- Define defect density, code churn, cyclomatic complexity, test coverage, and the five current DORA delivery metrics, and compute defect density, cyclomatic complexity, and the DORA metrics by hand from small data.
- State for each metric what it can tell you and what it cannot, with a concrete worked case where it misleads for density, complexity, and coverage.
- Quote Goodhart's law accurately, including the fact that the popular wording is not Goodhart's.
- Choose and combine metrics as signals for a team to learn from, not as targets that a team is ranked against.

## Context & Motivation

`process-maturity-cmm-cmmi-and-what-came-after` ended with a claim and a gap: process ratings say little about the product, and some practice looks at observable outcomes instead. This lesson covers the measures themselves. Each is a proxy: defect density for "how buggy", complexity for "how hard to change", coverage for "how well tested", delivery metrics for "how well the team ships". A proxy is useful only while its link to the real thing holds, and the main skill here is knowing when it breaks.

The measurable requirements from `the-iso-iec-25010-quality-model` say what quality you need; these metrics give partial evidence about whether you have it. None is a quality characteristic itself.

## Core Theory

### Defect density

Defect density is defects found divided by size, usually per thousand lines of code (KLOC). It normalizes for size, since a large module naturally has more defects. Its weaknesses sit in both terms. The numerator counts defects found, which depends on how hard anyone looked; a module nobody tests has a low density. The denominator varies with language and style. Compare densities only across similar code, under similar testing effort, over the same window.

### Code churn

Code churn measures how much a component changed over a period. Nagappan and Ball (Microsoft Research, 2005) studied it with a case study on Windows Server 2003. Their abstract reports that absolute measures of churn are poor predictors of defect density, while their set of relative churn measures is highly predictive, discriminating fault-prone from not-fault-prone binaries with an accuracy of 89.0 percent. That is the claim the abstract supports: one large system, and a predictive association. It does not show that churn causes defects.

### Cyclomatic complexity

Cyclomatic complexity counts independent paths through a module. NIST Special Publication 500-235 defines it as e - n + 2, where e and n are the edges and nodes of the control flow graph. When all decisions are binary and there are p decision predicates, it equals p + 1. The report gives the case for a limit of 10, saying overly complex modules are more prone to error and harder to understand, test, and modify, and also says the precise limit "remains somewhat controversial": McCabe's original 10 has supporting evidence and limits as high as 15 have been used successfully. It also describes one validation study whose best error-prediction threshold was far lower, and notes that McCabe originally recommended exempting a module consisting of a single multiway decision (a `switch` or `case` statement).

### Test coverage

Coverage is the share of code executed by a test run. Google's testing blog post "Code Coverage Best Practices" (2020) states the limit well: coverage "does not guarantee that the covered lines or branches have been tested correctly, it just guarantees that they have been executed by a test", while a low number does show that large areas are untested. It says there is no ideal number for all products, offers 60% as "acceptable", 75% as "commendable" and 90% as "exemplary" as general guidelines while staying away from broad top-down mandates, and warns that engineers may treat a target as a checkbox. It suggests mutation testing as a better check that tests assert something.

### Delivery metrics: the DORA five

DORA's guide lists five software delivery metrics in two groups. Throughput: change lead time (time for a change to go from committed to version control to deployed in production), deployment frequency (deployments over a period, or the time between them), and failed deployment recovery time (time to recover from a deployment that fails and needs immediate intervention). Instability: change fail rate (ratio of deployments that require immediate intervention) and deployment rework rate (ratio of deployments that are unplanned but happen because of a production incident).

This list changed. DORA's history page says the first research used four variables (deployment frequency, lead time, mean time to recover, change fail rate). In 2018 availability was added, and in 2021 became reliability, which DORA says measures operational more than delivery performance. In 2023 MTTR was renamed failed deployment recovery time, so it only counts failures caused by a software change. Deployment rework rate was introduced in the 2024 report. Any source that lists "the four DORA metrics" is describing the older set. `continuous-delivery-and-continuous-deployment` covers the practices these metrics observe.

### Goodhart's law, quoted accurately

Goodhart's own 1975 sentence, from a paper on UK monetary policy, is: "Any observed statistical regularity will tend to collapse once pressure is placed upon it for control purposes." The popular version, "When a measure becomes a target, it ceases to be a good measure", is Marilyn Strathern's 1997 paraphrase (European Review 5(3)) of Keith Hoskin's 1996 wording, "every measure which becomes a target becomes a bad measure". These attributions follow the Wikipedia article on Goodhart's law, a secondary source. DORA applies the idea directly: its guide warns that setting a metric as a goal invites gaming, that one metric alone is a pitfall, and that the metrics are for a team to improve against its own past, not to compete with other teams.

## Worked Examples

### Example 1: density reverses the ranking

Module `billing` has 42 defects in 28.0 KLOC; module `search` has 9 defects in 3.0 KLOC. By count, billing is the problem. By density, billing is 1.5 defects per KLOC and search is 3.0, twice as bad. The pooled figure, 51 defects in 31.0 KLOC, is 1.65 per KLOC, and it describes neither module. Whether search is really worse still depends on the testing effort that found its defects, which the number does not contain.

### Example 2: counting complexity, and what splitting does

```python
def classify(orders):
    total = 0
    for o in orders:
        if o.qty <= 0:
            continue
        if o.priority:
            total += 2 * o.qty
        else:
            total += o.qty
    if total > 100:
        return "bulk"
    return "normal"
```

There are four decision predicates (one `for`, three `if`), so v = 4 + 1 = 5. Building the control flow graph by hand gives 14 edges and 11 nodes (with one exit node), and 14 - 11 + 2 = 5, the same answer. Now split the function into `subtotal` (v = 3), `weight` (v = 2), and `classify` (v = 2). Every function is now simpler, but they sum to 7, because each extra function adds one. A per-function limit passes while total complexity went up. And a chain of twelve `if`/`elif` tests has v = 13, over the limit of 10, even though it is a trivial lookup. Written as a single `switch`, that shape is the kind of module for which McCabe originally recommended an exemption.

### Example 3: 100% coverage and a bug that gets through

```python
def discount(price, is_member):
    rate = 0.1 if is_member else 0.0
    return price * (1 - rate)
```

A test that only calls `discount(100, True)` and asserts 90 reports 100% coverage (3 of 3 statements) with coverage.py 7.17.1 in branch mode, because the conditional expression sits on one line and its two outcomes are not counted as separate branches. A test that calls the function and asserts nothing reports the same 100%. Now change the guest rate from 0.0 to 0.2. Both tests still pass. Only a test that also asserts `discount(100, False) == 100` fails. Change the member rate to 0.5 and the assertion-free test still passes.

Now apply Goodhart: a mandate of "coverage must be at least 80%" is met just as well by assertion-free tests, which move the number and the safety not at all. The number can be raised without making the code any safer, which is the pattern Goodhart's law describes.

### Example 4: computing the DORA five from a log

Ten deployments between 1 and 22 October. Change lead times (commit to production) in hours: 6.0, 73.0, 20.0, 2.0, 30.5, 25.0, 21.5, 26.0, 30.0, 22.0. The median is 23.5 hours and the mean is 25.6; the median is less pulled by the 73-hour outlier. Ten deployments in about three weeks is roughly 3.3 per week. Two deployments needed immediate intervention, so change fail rate is 2 of 10, or 20%, with recovery times of 95 and 40 minutes, a median of 67.5 minutes. One further deployment was an unplanned fix made because of a production incident, so deployment rework rate is 1 of 10, or 10%. With two failures, the recovery median is nearly meaningless as a statistic. Ten rows are a demonstration of the arithmetic, not a basis for judging a team, and DORA says the metrics apply to one application or service, not to blended or compared systems.

## Common Misconceptions & Pitfalls

- **"Goodhart's law says 'when a measure becomes a target, it ceases to be a good measure'."** That wording is Strathern's 1997 paraphrase. Goodhart's own sentence concerns statistical regularities collapsing under control pressure.
- **"The four DORA metrics."** The set has been five since 2024, and one of the original four was renamed in 2023.
- **"100% coverage means the code is tested."** It means every line was executed. Example 3 shows a bug passing at 100%.
- **"Lower complexity per function means a simpler system."** Example 2 shows the total can rise when a function is split.
- **"Compare teams on delivery metrics."** DORA says the goal is a team improving against its own past.

## Summary

Defect density, churn, cyclomatic complexity, coverage, and the DORA delivery metrics are proxies, each with a known way to mislead: density depends on testing effort and size, absolute churn predicts poorly where relative churn predicts well, complexity limits are debated and can be dodged by splitting, and coverage shows execution, not checking. DORA's current set has five metrics (three of throughput, two of instability) after a 2023 rename and a 2024 addition. Goodhart's own words concern regularities collapsing under control pressure; the better-known wording is Strathern's. Use metrics as several signals a team reads about its own work, not as targets or rankings.

## Documentation Links

- [DORA: software delivery performance metrics](https://dora.dev/guides/dora-metrics/): the current five metrics with their definitions, and DORA's own warnings about targets, single metrics, and comparing teams.
- [DORA: a history of DORA's software delivery metrics](https://dora.dev/insights/dora-metrics-history/): how the set grew from four variables, including the 2021 reliability note, the 2023 rename, and the 2024 rework rate.
- [NIST SP 500-235: Structured Testing, A Testing Methodology Using the Cyclomatic Complexity Metric](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf): the definition of cyclomatic complexity, the shortcut p + 1, and the discussion of the limit of 10.
- [Nagappan and Ball (2005): Use of Relative Code Churn Measures to Predict System Defect Density](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/): the Windows Server 2003 study on absolute versus relative churn.
- [Google Testing Blog: Code Coverage Best Practices (2020)](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html): what coverage does and does not guarantee, and Google's stance on coverage targets.
- [Wikipedia: Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law): a secondary summary used for the citations of Goodhart (1975), Strathern (1997), and Hoskin (1996), to be checked against the originals.
