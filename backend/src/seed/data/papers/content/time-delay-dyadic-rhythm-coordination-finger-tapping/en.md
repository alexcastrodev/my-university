---
title: "Effect of time delay on performance and timing control in dyadic rhythm coordination using finger tapping"
summary: A lab study in which pairs of people keep a beat together through a fixed artificial delay, finding that 40 to 160 ms of delay made them more synchronised than no delay at all, and that the beat only held steady at about 160 ms.
researchArea: Computer Music
keywords: rhythm synchronisation, time delay, finger tapping, negative mean asynchrony, networked music performance, timing control
version: 1.0
updatedAt: 2026-11-10
---

## Overview

When musicians play together, each one hears the others a little late. Sound takes time to cross the room, the ear and the motor system add their own delays, and an instrument takes time between the movement and the note. On a network the gap grows to tens or hundreds of milliseconds. Earlier studies cited by the authors measured how much delay a duo can take: in hand-clapping experiments by Chafe et al., accuracy was best at 8 to 25 ms of delay and broke down at 55 to 66 ms; Farner et al. saw the tempo slow down above about 15 to 23 ms; Bartlette et al. found that clarinet and string duets suffered above about 100 ms. Each of those tasks mixes delay with musical context (instrument, role, rhythm), which makes it hard to tell what the delay alone does.

This paper, by Yuka Koike, Taiki Ogata, Takayuki Nozawa and Yoshihiro Miyake (Tokyo Institute of Technology and University of Toyama), strips the task down to two people tapping a finger. Each person hears only a beep triggered by the partner's tap, delayed by a fixed amount between 0 and 240 ms. The question is how accuracy, stability and tempo change with that delay, and whether people change how strongly they follow their partner.

For a software engineer building a shared metronome for remote musicians, the paper is useful mostly as evidence about the human side of the loop. It shows that people are not passive receivers of a delayed click: they learn to tap ahead of it, and a moderate constant delay can even cancel a natural tendency to rush. It does not test a network, jitter, or real music, so it describes a best case for what humans tolerate.

## Contribution

- **A clean dyadic delay experiment.** A synchronisation and continuation tapping task in which two participants first tap along with a shared metronome and then keep the beat with each other through a controlled delay, in seven conditions from 0 to 240 ms in steps of 40 ms.
- **Two views of synchrony.** The authors separate the *global* synchronisation error (gSE), the real time difference between the two people's taps that only an outside observer could see, from the *local* error (lSE), the difference between a person's tap and the delayed beep they actually hear. This distinction is what lets the paper explain why a delay can help.
- **A tolerance window much wider than in music studies.** Synchronisation between the pair was better at moderate delays than at zero delay, and the authors place the breakdown threshold between 160 and 200 ms, well above the 55 to 66 ms or about 100 ms reported for clapping and instrumental duets.
- **A model-based look at strategy.** Using the linear timing model of Kimura et al., they estimate how much each tap depends on the person's own previous interval (α), the partner's previous interval (β) and the previous local error (γ). Only β changed with the delay, and it was lowest at 80 ms.
- **An explanation built on anticipation.** They argue that negative mean asynchrony (people tap ahead of a predictable beat) together with a higher tolerance for being early than for being late is what lets both partners absorb the delay.

## Methodology

Sixteen adults took part as eight pairs (five women and eleven men, aged 24.25 ± 2.89 years). None had professional musical training. The two people sat back to back at separate desks, wore eye masks, and listened through earphones while white noise in headphones masked the sound of their own taps. An Arduino Mega 2560 read pressure sensors under the index finger and generated the beeps (500 Hz square waves lasting 100 ms), with a stated timing resolution under 1 ms.

Each trial began with 10 metronome tones at an interval of 800 ms (75 beats per minute), heard by both at once; participants joined in from the fifth tone. When the metronome stopped, each participant heard only the partner's taps, delayed by the condition's lag, and no sound for their own taps. They were told to prioritise synchronising with that feedback while keeping the metronome tempo. A trial ended after both had made 100 taps. Every pair ran four sessions with one trial per condition (28 trials in total), in randomised, counterbalanced order, after short 20-tap practice trials.

The measures were the mean absolute gSE and its standard deviation within a trial, the mean lSE and its standard deviation, and the mean inter-tap interval (ITI) and its variability. The errors were divided by the corresponding ITI because errors grow with the interval. Comparisons between delays used the Wilcoxon signed-rank test with Benjamini-Hochberg correction, and the lSE measures used a two-way mixed ANOVA (delay by participant role). For the timing model, the ITI series were detrended with a third-order polynomial and checked for stationarity with an augmented Dickey-Fuller test. Of 448 data series, 116 were non-stationary and removed. Of the 332 that remained, all but six reached an adjusted R² above 0.5.

## Findings

- **Moderate delay improves synchrony.** The mean standardised absolute gSE formed a U shape with its lowest values at 80 to 120 ms. At 0 ms and 240 ms it was significantly larger than at every delay from 40 to 160 ms, and at 200 ms it was larger than at 80 to 160 ms. The 40, 80, 120 and 160 ms conditions did not differ from one another.
- **Stability follows the same U shape.** The within-trial variability of gSE was lowest at 80 to 160 ms. It was higher at 0 ms than at 40 to 120 ms, higher at 200 ms than at 80 to 160 ms, and higher at 240 ms than at 40 to 160 ms.
- **People learn to tap ahead.** At 0 ms the mean standardised lSE was close to zero. As the delay grew, both participants tapped increasingly earlier than the beep they heard, with significant differences between every pair of conditions except 200 and 240 ms. The variability of lSE rose above 200 ms of delay.
- **Delay acts as a brake on rushing.** The mean ITI grew significantly with every step of delay. With 120 ms of delay or less, pairs sped up relative to the 800 ms metronome; above 200 ms they slowed down; at 160 ms they kept the metronome tempo accurately. The authors note that in the 160 ms condition the mean lSE was around 160 ms, so the pair stopped accelerating once each person tapped about 160 ms ahead of the partner's beep.
- **Only reliance on the partner changes.** The coefficients for one's own previous interval (α) and for the previous error (γ) did not change across delays. The coefficient for the partner's previous interval (β) was significantly lower at 80 ms than at 0, 120, 200 and 240 ms. Less following of the partner went together with better synchronisation.
- **A tolerance threshold of 160 to 200 ms** for this task, which the authors relate partly to the slow 800 ms tempo (prior clapping tasks used eighth notes of 319 to 349 ms) and to the absence of the musical context that reduces anticipation.

## Critical Analysis

- **Small sample, and pairs are the real unit.** Sixteen people in eight pairs is small. The two partners in a pair are not independent, yet most tests were run on the pooled measures without a model that accounts for pairs, so the effective sample for some comparisons may be closer to eight than to sixteen. No effect sizes or confidence intervals appear in the main text, and the actual millisecond values are in supplementary tables, not in the article.
- **The summary overstates a little.** The claim that synchronisation improved at 40 to 160 ms "compared with the other conditions" does not hold in full for accuracy: at 200 ms, gSE was only significantly worse than at 80 to 160 ms, not at 40 ms.
- **The paper disagrees with itself on stability.** The Results say gSE variability was lowest at 80 to 160 ms, while the Discussion says synchrony was most stable at 40 to 120 ms, and the caption of Figure 1b says 40 to 160 ms. The statistical comparisons listed in the Results are the most reliable reading. Two smaller slips: the Discussion points to Figure 4a for negative lSEs, which are in Figure 2a, and it says tempo was faster below 120 ms while the Results say "120 ms or less".
- **Finger tapping is not music.** The task removes melody, harmony, roles, note density and the auditory feedback of one's own action, and the participants were non-musicians. The authors themselves explain that musical context and training reduce negative mean asynchrony, which would shrink the tolerance window. The 160 to 200 ms threshold should not be read as a budget for real ensemble playing, where the cited studies found limits near 25 to 100 ms.
- **One slow tempo.** Every trial started at 800 ms per beat. The authors note that faster tempos lower delay tolerance, so the result does not transfer to faster music without new data.
- **A perfect, symmetric delay.** The lag was constant, the same in both directions, and free of jitter or packet loss. On a real network none of that is guaranteed. The paper cites work in which jitter in a metronome increases anticipation, but it did not test jitter.
- **The mechanism is inferred, not measured.** The anticipation and conscious-period-correction explanations are plausible readings of the data, but the authors did not ask participants what they perceived, and the regression model describes behaviour rather than an internal control mechanism, as they acknowledge. About a quarter of the series (116 of 448) were dropped as non-stationary before fitting the model.
- **What it suggests for networked music, carefully.** The paper's own arguments support a few lessons for a remote metronome. A small, stable delay is not automatically harmful, because people anticipate a regular beat, and zero delay with mutual following tends to rush. The tempo drifts in a predictable direction with the delay (faster when short, slower when long), so a shared clock that does not depend on the partner's audio should avoid that drift (an inference from the results, not something the paper tested). And reducing dependence on the partner went together with better results, which is consistent with the strategy of ignoring the partner that the cited ensemble studies report. Turning those observations into thresholds for a product would need tests with music, musicians and real network conditions.

## Further Research

- Repeating the task with musical context (subdivisions, rhythmic complexity, own-tap feedback) and trained musicians, to see how much the tolerance window shrinks, as the authors propose.
- Testing several metronome tempos, since the authors expect faster tempos to lower the threshold and to bring on slowing at shorter delays.
- Measuring what participants consciously notice about errors and tempo changes, to test the claim that period correction is intentional.
- Adding jitter, asymmetric delays between the two directions, and more than two players, which are the conditions a networked performance actually faces.
- Comparing the continuation task with a condition in which both players keep hearing a shared, locally synchronised metronome, which would show how much an external clock removes the drift caused by the delay (a suggestion of this review, not of the authors).
