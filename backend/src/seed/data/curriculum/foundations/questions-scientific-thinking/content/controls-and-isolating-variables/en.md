---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why a measured difference between "before" and "after" a change is not, by itself, evidence that the change caused the difference.
- Define a control (or baseline) and state what condition it must satisfy relative to the treatment being tested.
- Identify variables that must be held fixed for a comparison to isolate the effect of a single change.
- Design an A/B-style comparison, or a systems-performance comparison, that includes a proper control.
- Diagnose a described experiment as confound-prone by pointing to a specific uncontrolled variable.

## Context & Motivation

Suppose a team deploys a new caching strategy and, over the following week, observes that average response latency has dropped by 15%. It is tempting to conclude the caching strategy caused the improvement — but the conclusion doesn't actually follow from the observation alone. Traffic volume might have been lower that week; a separate deploy might have shipped in the same window; the underlying infrastructure provider might have resolved a capacity issue on its end; the day of week or time of year might carry seasonal load patterns. Any one of these, entirely unrelated to the caching change, could produce the same 15% improvement. Without something to compare against that experienced all of those same conditions except the caching change itself, "latency dropped after we deployed the change" and "the change caused latency to drop" are simply not the same claim, and treating them as if they were is the single most common way an experiment's conclusion outruns its evidence.

The fix is the control: a comparison condition that is identical to the treatment condition in every respect except the one variable under test. A control group, or a control run, or a baseline measurement is not a formality tacked onto an experiment for appearances — it is the only thing that lets a measured difference be attributed to the change under test rather than to everything else that also happened to differ. This idea predates modern experimental science by centuries in informal form, but it became methodologically central once it was recognized that any two points in time, or any two populations, differ in dozens of ways simultaneously; isolating one candidate cause requires deliberately engineering away all the others, either by holding them fixed or by making sure they apply equally to both conditions being compared.

Isolating variables is the general skill this concept is about, and controls are the concrete mechanism for doing it. The two ideas are inseparable: a control that differs from the treatment in more than the one variable under test is not actually a control, and a variable that can't be held fixed or matched across both conditions is a variable the experiment has not actually isolated, however carefully everything else was measured. This concept builds directly on *Designing a Minimal Experiment*: once the minimal set of measurements that would discriminate a hypothesis from its alternative has been identified, isolating variables is what guarantees that a measured difference in those specific measurements is actually attributable to the one thing being tested, rather than to some other difference that crept in alongside it.

## Core Theory

### What a control has to satisfy

A control is not just "a comparison" — it has to satisfy a specific condition: it must be identical to the treatment in every respect that could plausibly affect the outcome, except for the one variable under test. If the treatment is "requests served through the new caching layer, measured Tuesday afternoon," a control of "requests served through the old system, measured the previous Tuesday afternoon" is weaker than it looks, because a week has passed and anything else that changed in that week (a dependency upgrade, a shift in user behavior, a change in upstream service latency) rides along uncontrolled. A stronger control runs both conditions concurrently, splitting otherwise-identical traffic between the old and new systems at the same time, under the same load, so that the only systematic difference between the two groups is the one variable being tested. The strength of a control is a matter of degree — concurrent, randomized comparison under identical load is close to the ideal; a "before/after" comparison separated by any meaningful stretch of time is a much weaker substitute, useful only when a true concurrent control is genuinely impossible to arrange.

### Isolating a variable: holding everything else fixed

To test a single variable's effect, every other variable that could influence the outcome has to either be held constant across both conditions, or be randomized so it affects both conditions equally on average. Consider testing whether a new sorting algorithm is faster than the old one. Holding fixed means: same hardware, same input data, same system load, same compiler and JIT warm-up state, same measurement methodology — changing only which algorithm runs. If the new algorithm is tested on a quieter machine, or on a friendlier input distribution, or after a warm-up period the old algorithm's benchmark didn't get, the comparison no longer isolates the algorithm change; it isolates "the algorithm change plus whatever else differed," and the measured speedup could be entirely due to the latter. When a variable genuinely cannot be held fixed — real production traffic can't be frozen to a single fixed pattern for both runs — the standard fix is randomization: assign incoming requests to old-system or new-system treatment at random, so that any traffic-pattern differences average out across both groups rather than systematically favoring one.

### A/B testing as controlled comparison

A/B testing, familiar from product and UX work, is exactly this logic applied to a live population of users: two variants (A, the control/baseline; B, the treatment) are shown to randomly assigned, concurrent slices of the same user population, so that anything else affecting user behavior — time of day, day of week, marketing campaigns running that week, seasonal effects — hits both groups equally. If a UI redesign (variant B) shows a higher conversion rate than the current design (variant A) when both are measured over the *same* period on *randomly split* traffic, the comparison has isolated the redesign as the one differing variable. If instead B were measured only after A had already been retired — sequential rather than concurrent — the comparison reintroduces exactly the confound the earlier caching example illustrated: anything else that changed between the two measurement periods becomes indistinguishable from the effect of the redesign itself.

### Systems performance: the same logic, different setting

The same requirement shows up in benchmarking any performance change: a control run under identical load, hardware, and configuration to the treatment run, differing only in the one change under test. A common failure mode is caused by "noisy neighbor" effects on shared infrastructure — the treatment measurement happens to land on a machine that is momentarily under less external load than the one used earlier for the baseline, and the resulting speedup is credited to the code change instead of to the quieter machine. The isolation fix, as above, is either to run both conditions concurrently on matched, dedicated hardware, or to interleave many repeated runs of each condition on the same hardware so external noise has an equal chance of affecting either one, and then compare the aggregated results rather than a single run of each.

## Worked Examples

### Example 1 — a caching strategy, controlled properly

**Setup.** The hypothesis: "the new caching layer reduces median request latency." The naive comparison ("this week with the cache vs. last week without it") confounds the caching change with everything else that differs week to week — traffic volume, unrelated deploys, external service performance.

**Proper control.** Split live production traffic randomly at the load balancer: half the requests are routed through the new caching layer (treatment), half through the existing path (control), during the *same* time window, so both groups experience the same traffic volume, the same time-of-day pattern, and the same state of every other unrelated system.

**Isolating the variable.** Everything about the two paths is identical except the presence of the cache — same downstream services, same hardware pool (or randomly distributed across the same pool), same request mix, because traffic was split randomly rather than by time. Any resulting difference in median latency between the two groups can now be attributed specifically to the caching layer, because the control experienced every other condition the treatment did.

**Result and conclusion.** If the treatment group's median latency is meaningfully lower than the control group's, measured over the same window with the same traffic characteristics, the caching layer — and not some other simultaneous factor — is the explanation, because the "some other simultaneous factor" possibility was exactly what the concurrent, randomized control was built to rule out.

### Example 2 — an algorithm benchmark, done wrong then fixed

**Setup.** A hypothesis: "the new sort implementation is faster than the old one." A first benchmarking attempt times the old implementation on a shared CI runner in the morning, and the new implementation on the same shared runner in the afternoon, and reports the afternoon run as 20% faster.

**What went wrong.** The comparison isn't isolating the algorithm at all — it isolates "the algorithm change plus whatever differed between morning and afternoon runner load," and shared CI runners are notorious for exactly this kind of variable, uncontrolled background contention. The 20% figure could be entirely, or partly, an artifact of the afternoon runner being less loaded, with the algorithm itself contributing nothing.

**Fix.** Run both implementations back-to-back, several times each, interleaved (old, new, old, new, …) on the same runner in the same short window, using the identical input data each time, and compare the aggregated timings rather than a single run of each. This holds hardware, input, and (approximately) background load fixed across both conditions, isolating the algorithm as the one thing that differs from run to run.

**Result.** Suppose the interleaved, repeated comparison now shows only a 3% difference, well within the run-to-run noise observed for either implementation individually. This reveals the original 20% figure to have been almost entirely a load-timing artifact — a control-free "before/after" measurement, not evidence about the algorithm at all. The corrected experiment, with a proper control, gives the real (and much smaller, if any) effect.

## Common Misconceptions & Pitfalls

- **"I already have a baseline — the numbers from before the change."** A baseline measured at a different time is a weak control at best, because time itself carries every other variable that might have changed alongside the one under test. A concurrent, randomized control (same time window, split population or interleaved runs) is far stronger evidence than any before/after comparison, and should be preferred whenever it's feasible.
- **"Randomizing is just for medical trials or big user-facing experiments — it doesn't apply to a small internal benchmark."** Randomization (of which run happens when, which machine gets which condition, which requests get which treatment) is a general tool for handling any variable that can't be manually held fixed, and applies just as much to a two-line benchmarking script as to a large-scale A/B test.
- **"If both groups are large enough, I don't need a control — the averages will sort themselves out."** Sample size fixes noise, not bias. A systematic difference between two non-concurrent or non-randomized groups (like the afternoon-vs-morning CI load example) does not shrink as sample size grows; it is a structural feature of how the groups were formed, and only a genuine control removes it.
- **"The control group doesn't need to be identical, just similar."** "Similar" is doing a lot of unexamined work in that sentence — the whole point of a control is that it matches the treatment on every variable that could plausibly affect the outcome. Any acknowledged difference between control and treatment, beyond the one under test, is a candidate confound (the subject of the next concept in this track) that has to be argued away, not waved past.

## Summary

A control is a comparison condition identical to the treatment in every respect except the one variable being tested, and it is the mechanism that lets a measured difference be attributed to that variable rather than to anything else that happened to differ alongside it. Isolating a variable means holding every other relevant factor fixed, or randomizing it so it affects both conditions equally, whether the setting is a live A/B test split across concurrent user traffic or a systems-performance benchmark run on shared, noisy hardware. A before/after comparison separated in time is a much weaker substitute for a concurrent, randomized control, because time carries every other variable along with it — and a large sample size fixes noise, not the kind of systematic bias an absent or weak control lets slip through unnoticed.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
- [Judea Pearl — The Book of Why (UCLA Causality Lab)](https://bayes.cs.ucla.edu/WHY/) — doc
