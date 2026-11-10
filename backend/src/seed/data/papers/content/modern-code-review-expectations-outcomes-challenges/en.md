---
title: "Expectations, Outcomes, and Challenges of Modern Code Review"
summary: A mixed-methods study at Microsoft, built on observation, interviews, a survey and a classification of review comments, finds that code review is less about finding defects than developers expect and more about understanding changes and sharing knowledge.
researchArea: Software Engineering
keywords: code review, empirical software engineering, program comprehension, knowledge transfer, developer experience, qualitative research
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Code review, in which a developer's change is read by others before it is merged, is standard practice in industry and open source. The older form, the formal code inspection of the 1970s, was a long synchronous meeting with a strict process and good evidence that it found defects. Modern review is informal, done in a tool, and part of everyday work, and it is not clear that the old evidence applies to it.

This ICSE 2013 paper, by Alberto Bacchelli (University of Lugano) and Christian Bird (Microsoft Research), asks what developers and managers expect from modern review, what they actually get from it, and what makes it hard.

Worth knowing first: what a pull request or change review looks like in a tool, the older idea of a code inspection, and the basic methods of qualitative research (interviews, surveys, coding of text into categories).

## Contribution

- **An exploratory study without hypotheses set in advance,** at Microsoft, across teams with different products and review cultures.
- **A comparison of expectations with outcomes.** The paper shows that the top reason to review, finding defects, is not what review mostly produces.
- **Understanding as the central challenge.** Reviewers' main difficulty is to understand the change and its context, and many mechanisms they use to do it are not supported by review tools.
- **Recommendations** for practitioners and implications for researchers and tool builders.

## Methodology

The study triangulates four sources. The authors observed 17 developers doing reviews, from 16 product teams, and interviewed them in a semi-structured way. They then classified by hand 570 comments from 200 threads of the CodeFlow review tool, sampled at random among threads with at least two comments, using card sorting. Last, they sent a survey to 165 managers and 873 programmers.

Themes emerged from the interviews through card sorting of 1,047 coherent units, and the categories were reviewed by all the researchers. An affinity diagram was used to group the categories into the main themes.

## Findings

These are the authors' reported results.

- Finding defects is the top motivation of developers and managers, but "code improvements" (better practices, removing unneeded code, readability) are the most frequent comments, with 165 of 570 (29%). Defect comments are only 78 (14%), the fourth most frequent of nine categories, and most deal with small logical problems such as corner cases.
- Reviews bring other benefits that people value, including knowledge transfer, team awareness and transparency (for example adding a mailing list as an optional reviewer so that everybody sees the change), and alternative solutions.
- Understanding is the most frequent challenge in the interviews, and the second most frequent comment category in the reviews. Reviewers who know the code and context finish faster and give more valuable feedback, and the survey indicates that finding defects is the outcome that needs the deepest understanding.
- Reviewers describe low-value reviews that focus on formatting because it is easy.
- The authors recommend not relying on review alone for quality assurance, spreading knowledge so that authors have potential reviewers, having authors give context, and offering ways to communicate synchronously.

## Critical Analysis

The study is valuable because it asks people what they do instead of assuming. It is qualitative and from one company, and the authors say so.

- **One company, one tool.** The comments come from CodeFlow and all teams are at Microsoft. The authors argue, with examples from other fields, that a deep study of one setting has value, and they triangulate sources, but the specific numbers (such as 14% defect comments) should not be taken as general.
- **Small coded sample.** The 570 comments come from 200 threads. The authors discuss whether this explains the low defect share, and conclude from the interviews and survey that it does not, but the proportions are from a sample.
- **What comments reveal is limited.** Awareness and learning are hard to see in review traces, so the evidence for them comes from what people say, which is a weaker kind of evidence than behaviour.
- **Practice has moved.** Since 2013, review tooling and automation have changed, and some of the low-level comments the paper found are now caught by linters and bots. The paper's findings on understanding are probably the part that has aged best, and that is our judgement.
- **Expectations are self-reported,** and people may state defect finding as the official reason more than it is the true one.

## Further Research

- Tools that support understanding: summaries of why a change was made, better navigation of context, and ways to show what is relevant.
- Studies of how awareness and learning actually grow from being part of reviews.
- Automating the low-level checks, so that human review time goes to design and conceptual issues.
- Replication outside Microsoft, in open source and in other review tools and cultures.
