---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State what ISO 9241-11 makes usability depend on, and say which edition a given wording comes from.
- List what open sources report about the 2018 revision, and recognize what they do not show, since the standard's text is sold.
- Turn effectiveness, efficiency, and satisfaction into measures on one concrete task, with a stated counting rule.
- Show with a computed example that two measures of the same sessions can rank two designs in opposite order.
- Separate the ISO model from Nielsen's five components and from the product-side characteristic in ISO/IEC 25010.

## Context & Motivation

`fitts-law-and-hicks-law` predicts the time of one pointing movement or one choice. Those models do not say whether a person got what they came for. "This app is easy to use" has the opposite problem: it is about the whole outcome, but it names no person, no goal, and no situation, so no test can fail it.

Lewis and Sauro (2020) recount that in the 1980s and 1990s the field had no agreed definition, and that ISO 9241 Part 11 was the response: first draft in 1988, first edition published on March 15, 1998, replaced in 2018. The price of precision is that usability stops being a single property. It becomes a claim about specified users, goals, and context, and that is what makes it measurable.

## Core Theory

### What the free sources show

The text of ISO 9241-11 is sold, so every wording below comes from an open source that reports it, and each source is named. Two of them print a sentence presented as the definition:

| Source | Edition | Wording as printed there |
|---|---|---|
| Speicher (arXiv, citing ISO 9241-11:1998) | 1998 | "The extent to which a product can be used by specified users to achieve specified goals with effectiveness, efficiency and satisfaction in a specified context of use." |
| W3C WAI page, updated 6 May 2016 | Names no edition; predates 2018 | "extent to which a product can be used by specified users to achieve specified goals effectively, efficiently and with satisfaction in a specified context of use" |

The two differ in the middle phrase, and only the purchased text can settle which one is literal. Treat both as reports. Neither is the 2018 sentence, and no 2018 wording is quoted here, because the sources used for the revision describe its changes without reprinting that sentence.

### What the definition demands

Read the 1998 sentence as a template with blanks. Speicher turns it into a quintuple:

$$\text{usability}\in\text{LEVEL}\times\text{PRODUCT}\times\text{USERS}\times\text{GOALS}\times\text{CONTEXT}$$

where LEVEL says whether the metrics are internal, external, or in use. His point is that "usability" names nothing until the elements have values. He quotes Brooke's remark that "Usability does not exist in any absolute sense; it can only be defined with reference to particular contexts."

Yamauchi and Ito, summarizing the 1998 edition, list what measuring requires: a description of the intended goals, a description of the context (users, tasks, equipment, environments), target values for effectiveness, efficiency, and satisfaction, and at least one measure of each. They add that the standard gives no concrete rule for choosing the measures, because the relative importance of the attributes depends on context and purpose.

### The three components in the 1998 edition

The middle column is Yamauchi and Ito's summary, and the last column is the list of examples that Lewis and Sauro report from the 1998 edition.

| Component | Sense in 1998 | Example measures |
|---|---|---|
| Effectiveness | Accuracy and completeness with which users achieve specified goals | Percentage of goals achieved; percentage of users completing a task; average accuracy of completed tasks |
| Efficiency | Resources expended in relation to that accuracy and completeness | Time to complete a task; tasks completed per unit time; monetary cost of performing the task |
| Satisfaction | Freedom from discomfort, and positive attitudes toward use | Rating scale; frequency of discretionary use; frequency of complaints |

Nothing here is a formula. Each row is a family of measures, and a study has to pick one and define it.

### What the 2018 revision changed (book versus today)

The change note in DIN's catalog record compares DIN EN ISO 9241-11:2018-11 with its 1999 German predecessor. It is written in German, and this is a translated summary:

- The title changed. Speicher's reference gives the 1998 part title as *Guidance on usability*, and the record gives *Usability: Definitions and concepts* for 2018.
- The scope widened to include systems and services.
- A wider range of goals is considered, including personal and organizational outcomes.
- Efficiency is defined in relation to the results achieved, instead of accuracy and completeness.
- Satisfaction takes a broader range of aspects into account.

The record's scope summary adds that the document explains usability as an outcome of use, and that it applies to interactive and other systems (built environments included), products, and services.

Lewis and Sauro add two points from the revision: potential negative consequences of use (health, safety, security, privacy, trust) were added, and the revised draft no longer gave specific guidance on how to measure usability. They note that the guidance moved rather than vanished: ISO/IEC 25066 covers the report format and ISO/IEC 25022 the measures.

So a textbook that says "a product" and defines efficiency through accuracy and completeness is reporting 1998. The concepts themselves carry over: Lewis and Sauro, citing Bevan et al. (2016), say the new version retained them while extending the scope.

### Outcome of use, not a property of the artifact

Because usability is an outcome, an interface has no single usability number. `the-iso-iec-25010-quality-model` quotes the 2023 edition of that standard calling interaction capability "a prerequisite for usability": the product-side characteristic is something you build, and the effectiveness, efficiency, and satisfaction of real use are what you then observe.

Accessibility fits the same template. The W3C page observes that the definition could cover it when "specified users" includes people with a range of disabilities and the context includes assistive technologies, and that usability practice often does not consider those needs. The blanks decide who counts.

### A different model: Nielsen's five components

Nielsen's article "Usability 101" (2012, last reviewed July 15, 2026) defines usability through five quality components: learnability, efficiency, memorability, errors, and satisfaction. He separates it from utility, and he sets usefulness as usability plus utility. His efficiency means how quickly users perform tasks once they have learned the design, which is narrower than efficiency in ISO. Saying "efficiency" in a report without saying which one invites an argument about nothing.

### Measures do not stand in for one another

Sauro (2011) reports that post-test SUS scores correlate with task completion and time at around $r=0.24$, which he reads as about 6% of variance. People can hit severe problems and still give a high rating. That gives the 1998 requirement of a measure for each attribute a practical basis: one number does not reliably stand in for the others.

## Worked Examples

All numbers in this section are fictitious. They were written for this lesson to exercise the arithmetic, and no such study exists.

### Example 1: filling the blanks

```text
Product   clinic booking site, version 3
Users     adult patients booking for the first time, no training
Goal      book a general practitioner slot on a stated date and time
Context   own phone, mobile data, no help from staff
Level     in use
```

Now the three components have a referent. Success means the appointment exists with the right doctor, date, and time, and the patient received a confirmation. Saying that before the sessions matters, as Example 3 shows.

A second statement of usability, about a receptionist booking for a patient on a desktop with a headset on, uses the same product and has different users, a different goal, and a different context. A result for one says nothing direct about the other.

### Example 2: three measures, one set of sessions

Design A is a single form. Design B adds a review screen before confirming. Twelve fictitious sessions per design, with a 1 to 7 rating after the task:

```text
                               Design A   Design B
strict successes                  8/12      11/12
success rate                     66.7%      91.7%
95% Wilson interval             39-86%     65-99%
mean time, successes only       120.0 s    199.5 s
mean time, all 12 sessions     166.25 s   201.25 s
total time                     33.25 min  40.25 min
successes per minute             0.241      0.273
mean rating                       4.33       5.17
mean rating, successes only       5.25       5.27
```

Mean time among successes says A is faster by almost 80 seconds. Successes per minute of total time, the tasks-per-unit-time measure from the 1998 list, says B is ahead by about 14%, since A's three abandoned sessions (285 to 310 s) cost time and returned nothing. Both numbers are correct, and they answer different questions. Filtering to successes hides failures, so report which one you used.

The rating follows the same pattern: the gap of 0.83 points nearly disappears among successes, so it comes from the sessions that failed.

None of this proves B better. The intervals overlap heavily, and a two-sided Fisher exact test on 8/12 against 11/12 gives $p=0.32$. Twelve sessions show a direction, not a settled difference.

### Example 3: the counting rule moves effectiveness

One session in each design booked the wrong date. Nielsen's success-rate article (2001, reviewed 2021) calls a wrong date a major issue in a similar ordering task, and it describes both strict scoring and levels of partial success.

```text
                      Design A        Design B
wrong date = failure  8/12 = 66.7%    11/12 = 91.7%
wrong date = success  9/12 = 75.0%    12/12 = 100%
```

For a clinic, a patient who arrives on the wrong day has not reached the goal, so strict scoring fits. For another product, a minor slip could count. The rule belongs in the plan, written before the data exist, because after seeing 12/12 nobody argues for the stricter one.

### Example 4: from a vague requirement to a testable one

"The booking flow must be easy to use" cannot fail. Using the blanks from Example 1:

```text
For first-time adult patients on their own phones, without help:
  effectiveness  at least 85% book the correct slot (strict rule)
  efficiency     at least 0.25 successes per minute of total time
  satisfaction   mean post-task rating of at least 5 out of 7
```

The targets are choices for this fictitious clinic, not values from any standard. Design B's 91.7% clears the first target, yet its Wilson lower bound is 64.6%, so twelve sessions cannot show that the true rate reaches 85%. With 18 of 20 the rate is 90%, and the interval is still 69.9% to 97.2%. Nielsen's usual advice of 20 users per design for metrics (2001) is a rule of thumb for a reasonably tight interval, and a proportion near a demanding target can need more. Sample size is taken up in `usability-testing-and-the-system-usability-scale`.

## Common Misconceptions & Pitfalls

- **"This product has high usability."** Without users, goals, and context the sentence has no truth value. Example 1 shows two different statements about one product.
- **"ISO 9241-11 says how to measure usability."** As summarized by Yamauchi and Ito, the 1998 edition gives no rule for choosing measures, and Lewis and Sauro report that measurement guidance left the revised draft for other standards.
- **"Efficiency is task time."** Time is one measure. Example 2 shows that time and successes per minute can point in opposite directions.
- **"The definition I read in a book is the current one."** If it says only "a product", it reports the first edition or follows it.
- **"Nielsen and ISO define the same thing."** They share a name and overlap in part. ISO's efficiency and Nielsen's are not interchangeable.
- **"Satisfaction follows from good performance."** Sauro's correlation of about 0.24 argues against assuming it.

## Summary

ISO 9241-11 ties usability to specified users, goals, and context of use, and judges it through effectiveness, efficiency, and satisfaction. The 1998 wording speaks of a product. Per DIN's change note, the 2018 edition extended the scope to systems and services, widened the goals, redefined efficiency against results achieved, and broadened satisfaction, and Lewis and Sauro report that measurement guidance moved to other standards. The sold text holds the literal wording, so open sources are reports and must be labeled by edition. Each component becomes a measure only with a counting rule fixed in advance. Measures can disagree on the same sessions, and small samples show a direction more often than a verdict.

## Documentation Links

- [DIN Media: DIN EN ISO 9241-11:2018-11](https://www.dinmedia.de/de/norm/din-en-iso-9241-11/279590417): catalog record in German with the scope summary and the change note against the 1999 edition.
- [Lewis and Sauro (2020): Where Did the ISO 9241 Definition of Usability Come From, and Where Is It Going?](https://measuringu.com/iso-9241/): history of Part 11, the 1998 example measures, and changes reported for the revision.
- [W3C WAI: Accessibility, Usability, and Inclusion](https://www.w3.org/WAI/fundamentals/accessibility-usability-inclusion/): a quoted wording of the definition and its relation to accessibility.
- [Speicher: What is Usability?](https://arxiv.org/abs/1502.06792): the 1998 wording and the quintuple that fills its blanks.
- [Yamauchi and Ito: A Method of Evaluating Effect of QoS Degradation](https://arxiv.org/abs/1502.03612): section 3.2 summarizes the three components and what measurement requires in ISO 9241-11:1998.
- [Nielsen: Usability 101](https://www.nngroup.com/articles/usability-101-introduction-to-usability/): the five quality components and the relation of usability to utility.
- [Nielsen: Success Rate, the Simplest Usability Metric](https://www.nngroup.com/articles/success-rate-the-simplest-usability-metric/): strict scoring and levels of partial success.
- [Nielsen: Usability Metrics](https://www.nngroup.com/articles/usability-metrics/): success, time, errors, and satisfaction as basic measures, and why metrics need more users.
- [Sauro (2011): Measuring Usability with the System Usability Scale](https://measuringu.com/sus/): the modest correlation between SUS and task performance.
