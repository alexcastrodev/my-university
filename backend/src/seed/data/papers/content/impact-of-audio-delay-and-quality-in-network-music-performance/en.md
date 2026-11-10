---
title: "Impact of Audio Delay and Quality in Network Music Performance"
summary: Eleven pairs of musicians played their own pieces between two isolated rooms while the authors changed the audio delay or the sampling rate, and their questionnaires suggest musicians cope with one-way delays up to about 40 ms and barely notice a drop from 88.2 kHz to 8 kHz.
researchArea: Computer Music
keywords: network music performance, quality of experience, audio latency, sampling rate, subjective evaluation, 5g
version: 1.0
updatedAt: 2026-11-10
---

## Abstract

Network Music Performance (NMP) refers to network-based remote collaboration when applied to music performances, such as musical education, music production and live music concerts. In NMP, the most important parameter for the Quality of Experience (QoE) of the participants is low end-to-end audio delay. Increasing delays prevent musicians' synchronization and lead to a suboptimal musical experience. Visual contact between the participants is also crucial for their experience but highly demanding in terms of bandwidth. Since audio compression induces additional coding and decoding delays on the signal path, most NMP systems rely on audio quality reduction when bandwidth is limited to avoid violating the stringent delay limitations of NMP. To assess the delay and quality tolerance limits for NMP and see if they can be satisfied by emerging 5G networks, we asked eleven pairs of musicians to perform musical pieces of their choice in a carefully controlled laboratory environment, which allowed us to set different end-to-end delays or audio sampling rates. To assess the QoE of these NMP sessions, each musician responded to a set of questions after each performance. The analysis of the musicians' responses revealed that actual musicians in delay-controlled NMP scenarios can synchronize at delays of up to 40 ms, compared to the 25-30 ms reported in rhythmic hand-clapping experiments. Our analysis also shows that audio quality can be considerably reduced by sub-sampling, so as to save bandwidth without significant QoE loss. Finally, we find that musicians rely more on audio and less on video to synchronize during an NMP session. These results indicate that NMP can become feasible in advanced 5G networks.

## Overview

Network Music Performance (NMP) means musicians playing together while connected over a network. Voice calls tolerate around 150 ms of one-way delay before a conversation feels unnatural, but music is far stricter. The number most often quoted is the Ensemble Performance Threshold of roughly 25 to 30 ms one way, and it comes mostly from experiments where people clap hands in sync over a delayed link. Musicians who use specialised NMP tools say they can play together at higher delays, and a pilot study by the same group with four pairs pointed the same way.

The question matters for system design. NMP tools usually send raw, uncompressed audio, because even Opus, which is built for low delay, adds at least 5 ms. Raw audio is expensive in bandwidth, and video competes for the same, usually narrow, uplink. If musicians accept lower audio quality, a system can save bandwidth by sampling less often, without paying the delay of a codec.

This 2025 Future Internet paper, from the Athens University of Economics and Business and the University of Central Lancashire, extends a 2021 NTMS conference paper. It tests two hypotheses: that musicians tolerate more delay with real pieces than the hand-clapping studies suggest (H1), and that sub-sampling the audio does not hurt their experience (H2).

## Contribution

- **A delay threshold measured with real music.** The authors argue that a one-way delay of 40 ms still gives an acceptable experience for rhythmic pieces, instead of the 25 to 30 ms taken from hand clapping, and that this makes NMP borderline feasible over 5G.
- **The first look at audio quality in NMP, as far as they know.** Sampling rates from 88.2 kHz (studio) down to 8 kHz (telephone) did not significantly change the musicians' ratings.
- **Audio over video.** With both channels available, musicians said they relied mostly on audio to stay in sync, even when the video arrived sooner than the audio.
- **Scale.** With 22 musicians in 11 duets, the authors present it as the largest NMP study with actual musicians and pieces that they know of.
- **A questionnaire beyond MOS.** Besides satisfaction, it asks about perceived delay, perceived synchronisation, following the partner, audio versus video focus, anxiety and irritation.
- **Practical lessons** for running similar studies (pilot first, short questionnaires, record everything), and the dataset published on GitHub.

## Methodology

Two acoustically and visually isolated rooms on the same floor of the university building. Each musician wears closed headphones, plays into a condenser microphone through an 8-channel mixer, and sees the partner on a 32-inch monitor. Video goes as an analog composite signal over a spare twisted pair, which avoids digital buffering. The authors measured it by filming a smartphone timer reflected through both cameras: 30 ms round trip, about 15 ms one way.

- **Scenario A (delay).** The mixers are linked by analog cables, and two Audio Research AD-340 analog delay units set the delay in each direction. Each duo plays a one-minute piece of their choice ten times, at one-way delays of 5, 12.5, 17.5, 15, 10, 0, 20, 30, 40 and 60 ms, in that order.
- **Scenario B (quality).** The audio goes through Linux PCs running the group's own software, Aretousa, over the building's Fast Ethernet with three switches, for a fixed one-way delay of about 10 ms. Only the sampling rate changes, with no compression: 44.1, 36, 28, 22, 16, 12, 8, 18, 48 and 88.2 kHz, with 16-bit linear samples, from 128 kbps to 1.411 Mbps per channel.
- **Delay measurement.** Clock synchronisation between the two ends is hard, so they measured the round trip (My Mouth to My Ear) and halve it. Since both directions are set the same, this gives the one-way Mouth to Ear delay reported in the paper.
- **Blinding.** The musicians were not told which variable changed, and the order of settings was chosen to look random. No metronome was used. Scenario A always came before Scenario B, with the same piece.
- **Questionnaire.** After every repetition, a short tablet questionnaire with 5-point Likert items. Both scenarios ask about satisfaction (PoSat, the MOS equivalent), anxiety and irritation. Scenario A adds perceived delay (PoAD), perceived synchronisation (PoSD), trying to follow (TTF) and audio or video focus. Scenario B adds perceived audio quality (PoAQ).
- **Analysis.** Ordinary least squares regression of each score against the controlled variable, treating Likert values as numbers, with 95% confidence bands and adjusted R², drawn in RStudio. Then a repeated measures ANOVA on the variables whose trends suggested a relation.

The instruments covered piano, organ, acoustic and electric guitar, electric bass, violin, flute, percussion and Greek traditional instruments such as santouri, oud, lute and bouzouki, in folk, rock, funk and classical styles.

## Findings

These are the authors' reported results, as stated in the text.

- **Synchronisation.** The PoSD regression line falls from 4.3 to 3 across the delay range. The average only drops from 3.75 to 3.5 between 30 and 40 ms, with similar spread, which the authors read as synchronisation holding up to 40 ms.
- **Perceived delay.** PoAD rises from 1.4 to 2.4, with 30 and 40 ms both very close to 2. For the six participants in duets with a pianist, it rises more steeply, from 1.5 to 3.4.
- **Satisfaction.** PoSat goes from 4 to about 3.4. The authors see no sharp threshold but a gradual decline, and call 40 ms a practical upper bound for rhythmic music. For the pianist subgroup it falls from 4.7 to just under 2.9.
- **Following the partner.** TTF rises from 2.8 to 3.9. Answers are widely spread at every delay, but at 40 and especially 60 ms more musicians report following the other.
- **Audio first.** The audio or video focus line is flat at 4.3 (5 meaning only audio), even though video had a constant 15 ms delay and audio went up to 60 ms.
- **Comfort.** Anxiety stays near 1.2 and irritation goes from 1 to 1.7, so the setup itself did not upset the participants.
- **Statistics for delay.** Repeated measures ANOVA gives p = 0.001 for PoSD, 0.013 for PoAD and 0.002 for TTF. PoSat is not significant (p = 0.819), which the authors attribute to satisfaction staying high at every delay.
- **Audio quality.** PoAQ stays close to 3 at all sampling rates and PoSat moves only from 3.2 to 3.5. Neither is significant (p = 0.371 and 0.48). The authors conclude that the sampling rate can be cut by an order of magnitude without a meaningful loss of experience, with pianists as a possibly more sensitive subgroup.
- **Tempo, from a companion study.** A separate signal-processing analysis of the same recordings found that musicians slow down as delay grows and keep a stable tempo up to 40 ms but not at 60 ms.

## Critical Analysis

The setup is careful about what it controls: analog paths, measured delays, a constant and low video delay, and musicians playing their own music. The conclusions, though, lean further than the data can carry.

- **Small and clustered sample.** 22 musicians is large for this literature, but it is 11 duets, and the two answers from one duo come from the same performance, so they are not independent. The paper reports "22 samples" in its ANOVA tables and does not say how this pairing was handled. The pianist subgroup that carries several claims has only six people.
- **The main QoE metric is not significant.** The authors call PoSat the most critical variable, and its ANOVA gives p = 0.819. The 40 ms conclusion rests on PoSD and on reading small differences between two delay points. Also, the only setting between 40 and 60 ms is none: the authors admit they did not test delays in that range, so "at least 40 ms" (Conclusions) and "practical upper bound" of 40 ms (Section 5.1) describe the same gap in opposite ways.
- **No significance is not evidence of no effect.** H2 is declared supported and the null N2 rejected because p > 0.05. That reasoning is backwards: a non-significant result in a small sample shows a lack of evidence, not equivalence, and no equivalence test is reported. The ratings near 3 even at 88.2 kHz also hint that the questionnaire, the headphones or the lack of a reference sample may not discriminate quality well. Methods such as MUSHRA, which the authors plan for future work, compare against a hidden reference.
- **Order effects.** Scenario A runs 0, 20, 30, 40 and 60 ms in its last five repetitions, so the highest delays always come last, after up to nine plays of the same piece. Fatigue, boredom or practice can then be mixed up with delay. Scenario B always follows Scenario A with the same piece, adding ten more repetitions. The paper calls the sequence apparently random, but it is the same fixed sequence for every duo.
- **Statistical reporting.** The adjusted R² values (0.89, 0.86, 0.96) are high for scattered individual Likert answers, which suggests the fit was done on per-setting means, but the paper does not say. Irritation has adjusted R² = 0.96 and is still left out of the ANOVA as showing no correlation with delay. Two pairs of captions repeat the same values (0.17 for Figures 13 and 15, 0.03 for Figures 14 and 16), which looks like a copy error. The text also says Likert values are "not ordinal" where it means not interval, and the ANOVA tables label the p-value row "p = 0.05".
- **Small inconsistencies.** The text places pianists in duets 1, 2 and 5, but Table 3 lists organ, not piano, for duet 5. The text says the pianist subgroup shows "a more noticeable upward trend" for audio quality, while its figure has adjusted R² = 0.03. The abstract writes the hand-clapping range as 25 to 30 ms, while the related work quotes Schuett's threshold as 20 to 30 ms.
- **Lab, not network.** Scenario A has no jitter, no packet loss and no network at all, just analog cables and delay boxes. Scenario B uses a quiet LAN. Real networks, and 5G in particular, add variable delay that NMP software has to absorb with buffers, which adds more delay. The 5G argument rests on the group's own measurement of a median one-way delay slightly over 40 ms within a commercial non-standalone cell, a median, with the remaining processing still to be added.
- **Who played what.** Musicians chose their own pieces, which is realistic but means tempo and rhythmic difficulty vary freely between duos. No metronome, no tempo control, and no data on the musicians' level or experience, beyond the remark that they had never done remote performance. Results from Greek folk and rock duets may not hold for fast, tightly locked styles or for larger ensembles. The pianist explanation (longer, more formal training) is a guess the data cannot test.
- **Bandwidth claim.** Sub-sampling removes everything above half the sampling rate, so 8 kHz keeps only up to 4 kHz. That this did not bother most musicians in a timing task is interesting, but it says little about performances meant for an audience.

## Further Research

- Studying how instrument, style and tempo affect tolerance to delay, which the authors say needs many more experiments, ideally by other groups repeating the same setup.
- Combining delay and sampling rate in one design, so MANOVA or factor analysis can reveal interactions between the two that separate scenarios cannot show.
- Adding compressed audio with Opus, measured with PEAQ and possibly MUSHRA, and weighing the codec's added delay against the bandwidth it saves.
- Analysing the recorded videos with machine learning emotion recognition from facial features.
- Testing the 40 ms figure over real 5G standalone networks, with the jitter and loss that the lab removed.
