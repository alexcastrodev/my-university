---
title: "Salsify: Low-Latency Network Video through Tighter Integration between a Video Codec and a Transport Protocol"
summary: A real-time video system that merges the codec's rate control and the transport's congestion control into one loop, choosing for every frame an encoding that fits what the network can take right now.
researchArea: Computer Networks
keywords: real-time video, low latency, congestion control, video codec, webrtc, vp8
version: 1.0
updatedAt: 2026-10-31
---

## Overview

Video calls over the Internet are built from two modules that each run their own control loop. The transport protocol watches acknowledgements and congestion and estimates the capacity of the path. The video codec chooses a frame rate and quality so that its average bit rate follows that estimate. In WebRTC's reference implementation the transport updates the encoder about once a second.

The weakness is the gap in time scales. A cellular link can change much faster than the encoder adjusts, and a single frame that overshoots the path's capacity is sent anyway, filling a buffer or being dropped. The system then tells the encoder to pause until things clear. This NSDI 2018 paper, from Stanford, argues the two loops should be one.

## Contribution

Salsify is a design in which the codec and the transport share one control algorithm, with a clean interface between them.

- **A video-aware transport.** Its capacity estimate is based on Sprout-EWMA and accounts for the fact that a video encoder sends data in frame-sized bursts, not at "full throttle" as many transport evaluations assume.
- **A purely functional codec.** The VP8 encoder and decoder (about 11,000 lines of C++) keep no hidden state: the application passes the state in and gets it back, with `encode(state, image, quality)` and `decode(state, frame)`. At 720p the state is about 4 MiB. Because encoding has no side effects, the sender can try several encodings of a frame and keep one.
- **A per-frame choice.** For each frame the sender encodes at two quality settings from the same state, waits to learn the real sizes, and sends the one that best matches the current estimate of the network's capacity, or sends neither and skips the frame.
- **Loss recovery by choosing a source state.** After a loss, the sender encodes the next frames relative to a state the receiver has acknowledged, so they can be decoded even if the packets in between were lost. The authors relate this to Mosh's "prophylactic retransmission".
- **A test bench for black-box systems**, described below, and the code and data released as open source.

## Methodology

The bench looks, from the sender's side, like a USB webcam playing a fixed clip and, on the receiver's side, captures the display's HDMI output. It then measures the delay and the quality of every frame end to end, so commercial applications can be compared without being instrumented. Network paths are emulated by replaying the packet timings recorded on cellular networks.

Salsify (with the two encodings run serially on one core, or in parallel on two) is compared with FaceTime, Hangouts, Skype and the WebRTC reference implementation in Chrome, with and without VP9 scalable video coding. Quality is the structural similarity index (SSIM). Two user studies, a video chat and a driving game, calibrate how much delay and quality matter to the people using it.

## Findings

These are the authors' reported results.

- On an emulated AT&T LTE path, single-core Salsify had a 95th-percentile video delay of 449 ms and an SSIM of 15.4 dB. Every other system was worse on both counts. Their delay was higher by 1.2 times (Skype), 2.3 times (FaceTime), 4.2 times (Hangouts), 7.9 times (WebRTC with VP9-SVC) and 10.5 times (WebRTC), and their SSIM lower by 1.3 to 6.9 dB.
- The system wins by design and not by codec: Salsify uses a VP8 codec finalised in 2008 and an unsophisticated encoder, and still produced better quality. The authors read this as a sign that improvements to codecs alone have reached diminishing returns here, while changes to the architecture of video systems can still bring a lot.
- In this one-to-one setting, WebRTC with VP9 scalable video coding did not improve markedly over conventional WebRTC.

## Critical Analysis

The authors list limits that matter.

- **It needs a codec that exposes its state.** Conventional software and hardware codecs do not, and on power-constrained devices only hardware codecs are efficient enough. If ordinary codecs learn to hit a target frame size, the advantage of a functional codec shrinks.
- **Strongest on variable paths.** The gains are largest on rapidly changing links such as cellular ones in motion and are closer to the other systems on steadier networks.
- **A narrow comparison.** Only one-way video, with no audio, was tested, with no cross traffic in the same bottleneck queue and no real-world paths. The commercial systems were measured in 2018 and have changed since.
- **Unicast only.** Salsify targets one sender and one receiver. A call relayed by an SFU has to serve several receivers with different paths from one encoding, which is where layered video, in which a relay drops layers without re-encoding, is attractive. The paper itself notes this use of scalable coding and does not address it.

## Further Research

- Getting codecs, especially hardware ones, to expose and restore their state, as the authors hope.
- Adding audio and keeping it in sync with video at the lowest delay.
- Multi-flow and two-way calls, and calls with more than two participants.
- Mixing the per-frame approach with layered video where a server forwards streams.
