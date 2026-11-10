---
title: "Coverage Is Not Strongly Correlated with Test Suite Effectiveness"
summary: A large study on five Java programs and 31,000 test suites finds that once the number of tests is controlled, code coverage has only a low to moderate correlation with how many injected faults a suite detects.
researchArea: Software Engineering
keywords: code coverage, test suite effectiveness, mutation testing, empirical software engineering, unit testing, java
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Many teams set a coverage target, such as "80% of lines", on the reasoning that a test suite cannot find a bug in code it never runs. That reasoning is true as far as it goes. The question this paper asks is whether coverage is also a good measure of how many bugs a suite will catch, so that raising it is a good way to improve a suite.

Earlier studies disagreed. Several did not control for the size of the suite, even though coverage rises when tests are added. Most used small or synthetic programs, and many compared only suites that were "adequate" for a coverage criterion, which are rare in practice. This ICSE 2014 paper from the University of Waterloo addresses those three gaps with what the authors call the largest study of its kind at that time.

Worth knowing first: statement, decision and modified condition coverage, what mutation testing is (small changes injected in code, then checking whether the tests notice), and what a rank correlation measures.

## Contribution

- **A large empirical study** relating suite size, three kinds of coverage (statement, decision, modified condition) and effectiveness on five open-source Java systems of up to 724,000 lines.
- **Control of suite size.** The study separates the effect of coverage from the effect of simply having more tests.
- **Realistic suites.** Suites are random subsets of each project's own test suite, not only the adequate ones.
- A practical recommendation: use coverage to find under-tested code, but not as a quality target.

## Methodology

The subjects are Apache POI, Closure Compiler, HSQLDB, JFreeChart and Joda Time, chosen for size (on the order of 100,000 lines), activity, a large number of JUnit tests and an Ant build. For each, the authors generated 1,000 random test suites for each of several sizes, 31,000 in total, as strict subsets of the project's own suite.

Effectiveness is the share of mutants that a suite kills, using the PIT mutation testing tool, and it is also normalised by the number of mutants the suite covers. Mutants that the whole suite could not kill are assumed equivalent and removed. The authors compute Kendall's τ rank correlation between size, coverage and effectiveness, in three settings: size alone, coverage with size ignored, and coverage with size held constant.

## Findings

These are the authors' reported results.

- Effectiveness is moderately to very highly correlated with the number of test methods in a suite.
- When size is ignored, coverage and effectiveness are moderately to highly correlated for most programs. The exception is HSQLDB, where suites with higher coverage kill fewer mutants for each unit of code covered.
- When the number of tests is held constant, the correlation between coverage and effectiveness is generally low to moderate, and it varies from system to system.
- Decision and modified condition coverage did not give a stronger signal than statement coverage.
- The authors conclude that coverage is useful to find under-tested parts of a program, but that a fixed coverage value is unlikely to yield an effective test suite, and that the cost of stronger forms of coverage may not be justified.

## Critical Analysis

The paper became a standard reference against coverage targets. It is stronger as a warning than as a proof, and the authors discuss the limits themselves.

- **Effectiveness is a proxy.** Killing injected mutants stands in for catching real faults. Earlier work cited by the authors supports this link, but it remains an assumption, and an important one.
- **Equivalent mutants.** Up to 35% of mutants were declared equivalent because the full suite could not kill them. If developers test some kinds of faults more often, this filter could bias the result.
- **Random suites are not how people build suites.** Subsets chosen at random from a developer-written suite may behave differently from suites that people grow on purpose, and the study cannot say whether an increase in coverage by a team that tracks it helps in practice.
- **Correlation, not causation.** The authors state that nothing here shows the direction of causality.
- **Five systems, all Java.** The strength of the relationship varies across the five subjects, which the authors themselves treat as a reason not to generalise.

## Further Research

- Repeating the study with real faults, and with suites that developers wrote under a coverage goal.
- Other measures of test quality, such as how well assertions check behaviour, and combinations of such measures with coverage.
- Replication on other languages, kinds of software and test styles.
- Studies of what coverage targets do to the way teams write tests.
