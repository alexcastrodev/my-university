---
title: "Tambur: Efficient loss recovery for videoconferencing via streaming codes"
summary: A way to protect one-on-one video calls from bursts of packet loss, sending parity with every frame so it can be used for as long as the frames still have time to play, with the amount of redundancy tuned by a small learned model.
researchArea: Computer Networks
keywords: videoconferencing, forward error correction, streaming codes, burst loss, video freezes, quality of experience
version: 1.0
updatedAt: 2026-10-31
---

## Overview

A video call has about 150 ms to deliver each frame, and compressed frames depend on earlier ones, so losing even one packet can stop a frame from being shown and freeze the picture for several frames. There are two ways to recover: ask for a retransmission, which works only if the round trip is short, or send redundancy up front with forward error correction (FEC), which always costs bandwidth that could have carried video.

The common FEC is a block code, such as the Reed-Solomon code Microsoft Teams uses within each frame. This NSDI 2023 paper, from Carnegie Mellon and Microsoft, shows from real call logs that losses in calls arrive in bursts that often span several frames, a pattern for which block codes waste bandwidth. It focuses on one-on-one calls.

## Contribution

- **An analysis of packet-loss traces from about 9,700 Teams calls**, the first the authors know of that checks whether streaming codes fit real videoconferencing losses. It finds that bursts are frequent, that they are often but not always followed by a stretch of frames with no loss, and that the production code spends a lot of bandwidth to recover in time.
- **Tambur, a streaming code for video.** Streaming codes are a theoretical family that recovers the packets of a burst one after another, each by its own playback deadline, and uses every parity packet that arrives before the deadline of the last lost frame, where a block code recovers everything at the earliest deadline and wastes the later parity. Tambur adapts the theory to video: it sets a bandwidth overhead per frame, copes with frames of varying sizes and with losses of only some packets of a frame, and tolerates losses in the stretch right after a burst. It also encodes the frame sizes, which the decoder needs.
- **A predictor of overhead.** A simple machine-learning model with one extra bit of feedback from the receiver decides how much redundancy each frame gets, so the overhead follows the network.
- **A benchmark platform and open-source code.** A C++ implementation (using the Jerasure 2.0 and GF-Complete libraries) of Tambur and of the baselines, integrated with a one-on-one videoconferencing emulator.

## Methodology

First, a trace-driven simulation on the Teams logs: a random sample of calls over two weeks, keeping the roughly 9,700 traces (16% of the total) with at least two losses, since Teams turns FEC on only after the first loss. One week was held out for testing. Each trace holds the size, sequence number and send and receive times of every packet, limited to the last minute of the call.

Then an end-to-end test over an emulated network. Tambur is compared with Block-Within (a block code within each frame, modelled on Teams) and Block-Multi (a block code across several frames). Two variants of Tambur are included: one that matches Block-Within's bandwidth overhead and one that trades some recovery for less overhead.

## Findings

These are the authors' reported results.

- In the traces the mean packet loss is 7% (1.7% over all Teams traces), and 38.4% of loss instances span more than one video frame.
- In simulation, Tambur recovers 26.5% more frames than Block-Within while using 35.1% less bandwidth for redundancy.
- On the emulated network, Tambur reduces the frequency of freezes by 26% and their cumulative duration by 29%, compared with the better of the two block-code baselines. Against Block-Within it has 78% fewer freezes.
- Tambur's freezes, when they happen, are not shorter: its median freeze lasts longer than Block-Within's, and the lower total comes from having far fewer of them.

## Critical Analysis

The study is carefully done and its main limits are stated.

- **One-on-one calls only.** The design and evaluation do not cover group calls, where an SFU sits in the middle. Whether to repair losses on each hop or end to end is not addressed.
- **Selected traces.** The analysis keeps calls with at least two losses and only the last minute of each. It shows how streaming codes help in calls that are already losing packets, not the average experience of a call.
- **Our own baselines.** Block-Within imitates Teams' scheme but is the authors' implementation, and the end-to-end results come from an emulator, not a deployment.
- **Freezes are one metric.** The paper shows a trade-off: the variants that save bandwidth recover less. How freeze counts map to what users feel is left to other studies.
- **Cost beyond bandwidth.** The code adds encoding and decoding work and one feedback bit. Hardware offload is named as future work.

## Further Research

- Group calls, and where in an SFU-based path the redundancy should be added or repaired.
- Other quality metrics and a better learned model of how much overhead to use.
- Hardware offload of the encoding and decoding.
- Mixing FEC and retransmissions in a call whose round-trip time changes.
