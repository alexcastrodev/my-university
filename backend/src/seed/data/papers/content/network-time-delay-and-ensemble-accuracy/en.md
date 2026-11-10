---
title: "Network Time Delay and Ensemble Accuracy: Effects of Latency, Asymmetry"
summary: A controlled clapping experiment at Stanford that measures how one-way audio delay between two isolated performers makes their shared tempo speed up, hold steady or drag.
researchArea: Computer Music
keywords: networked music performance, latency, ensemble timing, tempo drift, delay asymmetry, rhythm
version: 1.0
updatedAt: 2026-11-10
---

## Overview

Playing music together depends on timing precision of a few milliseconds, and once musicians are connected through a network, every path adds delay. The question this paper asks is simple: how much one-way delay can two people tolerate before keeping a steady beat together stops working, and is zero delay really the ideal?

Chris Chafe and Michael Gurevich, at Stanford's Center for Computer Research in Music and Acoustics (CCRMA), answer it with a deliberately stripped-down experiment. Pairs of people in two isolated rooms clap an interlocking rhythm while hearing each other only through headphones, and a computer inserts a known delay between them. The paper was presented at the AES 117th Convention in San Francisco in October 2004. It repeats a 2001 pilot study from the same group with tighter controls and more trials near zero delay, and it is the experiment usually cited when people say that ensembles stop working beyond a few tens of milliseconds.

For a software engineer building a shared metronome or a jam session for remote musicians, it gives an early, measured picture of what latency does to people who listen to each other to stay in time.

## Contribution

- **Delay as a controlled variable.** Instead of observing real Internet sessions, where delay, jitter and loss vary together, the authors fix the one-way delay for each trial between 0 and 77 ms and keep everything else constant. The longest delay corresponds to about 20 m of sound travelling through air.
- **An automatic measure of ensemble accuracy.** Clap onsets are detected per performer and turned into a tempo time series. Two numbers summarise each trial: the tempo slope (whether the pair sped up or slowed down) and the tempo jitter (how much the beat wobbled around that trend).
- **A linear model of tempo drift against delay**, with a crossing point where the pair neither speeds up nor slows down. The authors call it the ensemble accuracy "sweet spot" and place it at 11.5 ms.
- **The observation that a little delay helps.** Very short delays, including zero, made pairs speed up. This "beneficial" delay was the surprising result of the pilot study and is confirmed here.
- **First looks at asymmetric delays and at a wider tempo range**, presented as exploratory data that generate hypotheses rather than conclusions.
- **A translation into network terms.** The sweet spot is converted into a physical distance for real networks, and the authors list what IP networks add (asymmetry, jitter and packet loss) that the experiment does not cover.

## Methodology

**Participants and task.** Seventeen pairs of students and staff from Stanford were recorded, some paid with gift certificates and others taking part as part of a computer music course. No musical skill was required. Individuals were paired at random, practised the rhythm face to face, and were told only to keep it going evenly once it started, with no strategy or hints. Two sessions were discarded because the pair could not perform the rhythm, judged subjectively and confirmed by very high tempo jitter (an ANOVA separated them from the rest with p = 1.0 × 10^-8). That left 15 valid sessions and 173 trials, after 7 incomplete trials were also dropped.

**Setup.** The two performers sat in CCRMA's acoustically isolated recording and control rooms, nicknamed "San Francisco" and "New York", surrounded by absorbing panels. Each had a microphone 0.3 m in front of the chair feeding the partner's closed headphones, so nobody heard their own sound come back delayed. A single Linux PC with a 96 kHz audio interface ran custom C++ software built on the STK audio classes, applied the delays, recorded both rooms in sync as 16 bit, 96 kHz stereo, and drove the protocol. Delays were checked with an analog oscilloscope, and true 0 ms was obtained with an analog bypass around the interface.

**Trials.** Each pair did 18 trials in about 25 minutes. The first and last were calibration trials in which both clapped along to a recording instead of to each other. In every other trial one performer, chosen at random, heard a short clapped metronome at the new tempo for 5 seconds and started the rhythm; the partner heard nothing until then and joined at will. Monitoring shut off after 36 seconds. Three experiments were mixed in random order:

- **Experiment 1**, symmetric delay: 12 delays following the recurrence d(n) = n + 1 + d(n-1), which gives 0, 2, 5, 9, 14, 20, 27, 35, 44, 54, 65 and 77 ms. Each pair played each delay once, starting at 86, 90 or 94 bpm chosen at random.
- **Experiment 2**, asymmetric delay: two trials per session with a different delay in each direction.
- **Experiment 3**, starting tempo: two trials per session at 60, 80, 100 or 120 bpm, with a sparser set of symmetric delays (2, 9, 20, 35, 54 and 77 ms).

**Measurement.** An onset detector (the "amplitude surfboard" technique) time-stamped each clap to within ±0.25 ms, and a single amplitude threshold rejected stray noises in all sessions. The intervals between onsets became an instantaneous tempo series per performer, merged for the pair. Turning intervals into beats per minute needed adaptive tracking, because under heavy slowdown a slow eighth note can look like a quarter note. Tempo slope is the slope of a linear regression through the merged series; tempo jitter is the variance of the residuals of that regression.

## Findings

- **Delay and drift follow a straight line.** The mean tempo slope against delay fits the linear model ŷ = 0.58 - 0.05x with r² = 0.98. The longer the delay, the stronger the slowdown, and the positive intercept confirms that pairs speed up at zero delay, as in the pilot study.
- **A sweet spot at 11.5 ms of one-way delay.** This is where the model predicts no net acceleration. Below it, 74% of performances sped up; at 14 ms and above, 85% slowed down.
- **Starting tempo did not matter in the narrow range.** An ANOVA of tempo slope across 86, 90 and 94 bpm found no significant difference (p = 0.25), and a two-way ANOVA over the 36 combinations of 12 delays and 3 tempi found no interaction between tempo and delay.
- **Long delays produce a recursive drag.** The authors describe it as "player A, waiting for player B, waiting for player A". A pure waiting model predicts a tempo of 60/(T0 + n(d - dbest)) beats per minute, which slows down faster than even the worst real trials. The recordings show performers anticipating, pushing back against the drag, or briefly ignoring each other. The longest delays usually also had high variance.
- **No built-in bias toward steadiness.** Even though the instruction was to keep the tempo even, the data do not cluster around zero drift. The authors read the sharp crossing at 11.5 ms as a sign of some still unidentified human time constant, not of a self-correcting system.
- **Asymmetry looked tolerable, but the data are thin.** Twenty-nine valid asymmetric recordings, with ratios between the two directions of 1.2 to 4.5 (short side 2 to 54 ms, long side 9 to 77 ms), gave one or two trials per condition. The authors suggest that pairs stayed locked despite asymmetry, that the longer of the two delays dominates up to about 25 ms, and that beyond that the effective delay is closer to the median of the two. They state that both hypotheses still need testing.
- **Wider tempo range.** Twenty-two valid recordings at 60 to 120 bpm showed that slower tempos sped up relative to the rest and faster ones slowed down, but the overall relation between drift and delay followed the same inverse trend.
- **In network terms**, 11.5 ms one way corresponds to a radius of about 2,400 km, assuming signals at roughly 70% of the speed of light and no routing delay. The authors also note that sensitive ensemble work seems possible over fairly long paths, giving San Francisco to Denver, at about 20 ms one way, as an example.

## Critical Analysis

- **Clapping is not music.** The task was one simple interlocking rhythm with sharp, dry sounds in rooms treated to minimise room effects. The authors themselves say reverberation almost certainly masks the effect in more natural situations by smearing the arrival of each sound. Instruments with slow attacks, melody, harmony or a conductor change what musicians listen for, so the 11.5 ms figure should not be read as a universal constant.
- **Headphones without self-monitoring.** Performers never heard their own sound come back, so they had no sense of how long the delay was, and some blamed their partner for drifting. CCRMA's real-world tests used loudspeakers and let players "hear the delay", which the paper says can even be used to advantage. Results under the two monitoring styles may differ.
- **The sample.** Fifteen usable pairs of Stanford students and staff, with no requirement of musical skill, two pairs excluded for poor performance. That is a reasonable laboratory sample, but it says little about professional ensembles, who might tolerate or compensate for delay differently.
- **Effectively one tempo.** The main result comes from 86 to 94 bpm. Experiment 3 hints that slower tempos behave differently and the asymmetry data are explicitly too sparse for prediction, so both are starting points, not results to design against.
- **Only fixed, clean delay.** Each trial had one constant delay with perfect audio. Real IP paths add jitter, packet loss and changing routes, which the authors list as open work. A system that hides jitter behind a buffer turns it into extra fixed delay, which this paper does help to budget.
- **Publication status.** This is an AES convention paper. Its first page says it was reproduced from the authors' manuscript without editing or consideration by the AES Review Board, so it was not peer reviewed in the journal sense. It is also from 2004, and the PDF still has unresolved citation markers.
- **The "25 ms threshold".** The figure popularly attributed to this work does not appear in the text as a single threshold. The paper reports a sweet spot at 11.5 ms, slowdown in most trials from 14 ms on, about 25 ms only as the edge of a hypothesis about asymmetric delays, and 20 ms as an example of a usable long path. Later studies by the same group and others, using more musicians, real instruments and different tempos, have generally refined and qualified these numbers rather than settled on one cut-off.
- **For a shared metronome.** The experiment did not test a synchronised click: the metronome only played to the initiator, before the trial. What it does show is that when two people chase each other's sound, delay above roughly 11.5 ms pulls the tempo down steadily. A design that gives each site a local click aligned to a common clock avoids the mutual waiting for the beat itself, but players would still hear each other late, and the paper offers no data on how that combination behaves.

## Further Research

- Repeating the protocol with trained musicians, real instruments and longer pieces, and with reverberant rooms instead of dry ones, as the authors plan to do for reverberation.
- Testing loudspeaker monitoring and self-echo, where performers can hear the delay, against isolated headphones.
- Collecting enough asymmetric trials to test the two asymmetry hypotheses, and adding jitter and packet loss to see how they combine with fixed delay.
- Studying a wider and denser range of tempos, since the slope of drift may depend on the beat period.
- Measuring what happens when a shared, clock-aligned metronome is added on top of mutual listening, which is the case a networked jam or practice tool actually faces.
- Explaining the 11.5 ms sweet spot through models of human tempo tracking and of how listeners decide who played first.
