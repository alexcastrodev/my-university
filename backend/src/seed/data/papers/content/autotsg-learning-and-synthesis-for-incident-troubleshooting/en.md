---
title: "AutoTSG: Learning and Synthesis for Incident Troubleshooting"
summary: A study of how Microsoft on-call engineers use and rate troubleshooting guides (TSGs), followed by AutoTSG, a framework that turns a free-text guide into an executable workflow by classifying its statements with a few-shot Siamese network and parsing them with programs synthesized from examples.
researchArea: Software Engineering
keywords: troubleshooting guides, incident management, runbooks, on-call, meta-learning, program synthesis, programming by example, documentation quality
version: 1.0
updatedAt: 2026-11-22
---

## Overview

When a cloud service pages an on-call engineer, the engineer rarely starts from nothing. Teams write troubleshooting guides (TSGs), documents with commands, queries, dashboard links and plain-language instructions for recurring problems. The paper starts from the observation that TSGs are siloed, unstructured and often incomplete, so the engineer has to read them, copy and paste commands, and decide which branch applies, with the cost in effort, fatigue and human error that follows. Microsoft has more than 50,000 TSGs, used regularly by over 60,000 engineers every month.

The work has two halves. The first is an empirical study of how TSGs are used and how engineers rate them. The second is AutoTSG, a framework that tries to turn a TSG into an executable workflow, for example a Jupyter notebook, with a human still in the loop. I read the arXiv version of the paper (v1, May 2022). The published version at ESEC/FSE 2022 may differ.

## Contribution

- **A usage study.** The authors link incidents to the TSGs that engineers actually clicked through while handling them, over four months, covering about 4,800 TSGs. The number of incidents is not disclosed ("1000s").
- **A taxonomy of TSG quality.** From 428 feedback items on 394 TSGs, two authors coded the intent behind each message and built categories: Completeness, Broken Link, Correctness, Readability, User Experience, Empty, Up-to-dateness, Relevance and Other. It reuses part of an earlier documentation taxonomy and adds Empty and Broken Link.
- **Component identification.** AutoTSG converts TSGs to Markdown, splits them into statements and classifies each one into a component type (Kusto queries, PowerShell and internal script dialects, dashboard links, natural language and so on). It uses meta-learning: a Siamese network learns whether two statements are of the same type, and a statement is labeled by its nearest prototype, the mean embedding of each type's examples. This needs few labeled examples per type.
- **Component parsing.** To pull out the parts needed to run a component (command name, parameters, cluster and table of a query), it synthesizes Python parsers from a few input and output examples with programming by example (the PROSE library). For natural language, a constituency tagger first marks clauses so the synthesized parser can extract a condition and an action. Repeating parameters are handled by extracting the first one, deleting it, and repeating.

## Methodology

The usage study joins incident records to click-through data on TSG links. For time-to-mitigate (TTM) the authors keep only severity 1 and 2 incidents, because on-call engineers are paged for them at once and TTM is then a reasonable proxy for effort.

For component identification, 1,902 statements from 50 TSGs were labeled by hand into 7 component types. Natural language was capped at 200 examples to limit class imbalance, which leaves 661 labeled examples, evaluated with 5-fold cross-validation against k-nearest-neighbor and random forest baselines on bag-of-words and Word2Vec features. Parsing is tested on the 1,902 statements, with no overlap between the synthesis examples and the test data, and precision and recall are checked by hand. Coverage is measured on the 15 most used TSGs. Finally, 10 engineers out of 30 invited took part in 15-minute semi-structured interviews.

## Findings

- **TSGs are used and recur.** In 4 months, about 47, 17 and 8 percent of TSGs were linked to at least 2, 5 and 10 incidents, and six TSGs to over 100 each (the maximum is 184). About 85 percent of TSGs link to high or medium severity incidents, and only 30 TSGs link to outages.
- **Mean TTM is lower with a TSG.** For severity 1 and 2 incidents, the mean time to mitigate is about 19 hours without a TSG and about 13 with one. The text gives a severity 1 breakdown of about 36 hours with a TSG against about 2 without, which contradicts the sentence it supports, so I use only the aggregate figures.
- **Feedback is mostly negative.** Of 428 items, 367 (85.7 percent) were thumbs-down. Completeness is the most frequent category (32.24 percent), then Broken Link (13.32), Correctness (11.21), Readability (10.28), User Experience (10.05), Empty (7.24), Up-to-dateness (6.54) and Relevance (3.97). The text says the first three together are 56 percent. Agreement between the two coders was Cohen's kappa 0.907.
- **Component identification.** The Siamese approach reaches 0.89 accuracy and F1 from 0.72 to 0.98 across types. The best baseline, a random forest on bag-of-words, reaches 0.78 accuracy and 0.81 F1, and is weak on the types that share syntax (Torus, Merlin, PowerShell, with F1 from 0.40 to 0.63).
- **Parsing.** Parsers learned from 5 to 10 examples reach an average precision of 0.94 and recall of 0.91. The failure cases the authors show are forms not covered by the examples, such as a flag parameter and a pipe.
- **Coverage.** On the 15 most used TSGs, an average of 21.24 percent of all lines are correctly automatable, with a maximum of 41.2 percent. For 12 of the 15 TSGs, every line that is automatable was correctly identified and parsed. Most lines (headers, dates, links, step descriptions, contacts) are not automatable.
- **Interviews.** All 10 engineers said automation would help, and the average usefulness rating of AutoTSG was 4.2 out of 5.

## Critical Analysis

The usage data comes from real click-throughs, not from a recommender's output. It is also entirely inside one company, with incident counts withheld, and the two halves do not close the loop: nothing in the paper runs an automated TSG against a real incident and measures the result.

The points below are a reading of the paper, not claims it makes.

- **The TTM comparison is a correlation.** Incidents linked to a TSG may be the recurrent, well understood ones, and engineers click a TSG when one exists for the problem. The paper says TSGs "significantly reduce" effort, but it reports no test, and the severity 1 numbers in the text are inconsistent.
- **0.89 is a statement-typing accuracy.** It says AutoTSG labels lines correctly, not that the resulting workflow diagnoses or mitigates anything. With 21 percent of lines automatable on average, the framework automates the mechanical part of a TSG and leaves most of its judgment to a person, which is consistent with the notebook-with-human design.
- **The evaluation data is small and shaped.** Seven types and 661 examples, with natural language capped at 200, are a controlled slice. The component types are Microsoft-internal (Kusto, Jarvis, Torus, Merlin), so how well the few-shot approach transfers to another organization's tools is not shown.
- **The user study is favorable by construction.** Ten volunteers out of 30 invited, shown the authors' own output in a 15-minute interview. All ten said yes, and the paper reports no negative case.
- **Executing steps has side effects.** The paper treats automation as a gain in effort and consistency. It does not discuss what happens when an automated step changes production state. The later [StepFly](/papers/stepfly-agentic-troubleshooting-guide-automation) keeps its agent to read-only diagnostic steps and has engineers review its conclusion before any mitigation.

## Further Research

- Run converted TSGs against real or replayed incidents and compare TTM with and without automation, with a control group.
- Test transfer: train the few-shot classifier on one organization's tools and evaluate it on another's.
- Study guardrails for executing steps that change state, and when a human approval is needed.
- Use feedback signals (thumbs, broken-link reports) to drive automatic maintenance, which the authors recommend but do not build.
