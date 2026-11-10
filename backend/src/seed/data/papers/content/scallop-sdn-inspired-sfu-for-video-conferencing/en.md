---
title: "Scalable Video Conferencing Using SDN Principles"
summary: Scallop rebuilds the selective forwarding unit behind video calls as a switch program, so packet replication and layer dropping run in hardware and a small software control plane handles the rest.
researchArea: Computer Networks
keywords: sfu, video conferencing, webrtc, programmable switches, scalable video coding, rate adaptation
version: 1.0
updatedAt: 2026-10-31
---

## Overview

Services such as Google Meet and Zoom connect the people in a call through selective forwarding units (SFUs): servers that receive every participant's audio and video and relay copies to the others, adapting the quality on the way. This SIGCOMM 2025 paper, from Princeton and the University of Virginia, asks whether that job needs a general-purpose server at all.

The pressure comes from how an SFU's load grows. The number of media streams it handles grows with the square of the participants, because every incoming stream is copied to every other participant. In the authors' campus data from Zoom, a meeting of 25 people already produced more than 700 media streams at the SFU. The work sits on the latency-critical path, since every millisecond the SFU adds is added to what users feel, and the load is hard to predict. Operators end up either over-provisioning or autoscaling and risking call quality.

To see what under-provisioning does, the authors pinned the open-source Mediasoup SFU to one CPU core and kept adding participants. Video frame rate started to drop at around 60 participants, the core reached 100% CPU at around 80, and calls were effectively unusable from about 100 to 120 participants.

## Contribution

The paper's insight is that most of what an SFU does on media is what a switch already does: replicate a packet and drop some of them. In Zoom traces the servers send out exact copies of the incoming RTP packets, with only addresses and ports rewritten. When a stream is coded in layers (scalable video coding), lowering resolution or frame rate means dropping the packets of one layer, because a layer never crosses a packet boundary.

From that the authors build **Scallop**, an SFU designed like a software-defined network:

- A **data plane** in a programmable switch that replicates and forwards media packets and drops layers, at sub-millisecond latency.
- A **switch agent**, a program on the switch's own CPU, for tasks that tolerate about 10 ms: reading the receivers' feedback to choose a quality, answering connectivity checks.
- A central **controller** for the rare events: a call starting, someone joining or leaving, someone turning video on or off.

Scallop is a *true proxy* and not the usual split proxy that terminates one WebRTC connection per participant. Keeping the peer-to-peer illusion needs three mechanisms:

- Filtering the receivers' bandwidth feedback, so a sender is driven by its best-performing receiver and not by the slowest one.
- Mapping meetings onto the switch's packet replication engine with several tree layouts, moving a meeting between them as its needs change.
- Rewriting RTP sequence numbers, so the gaps left by dropped layers are not read by receivers as network loss.

## Methodology

The data plane is written in P4 for an Intel Tofino2 switch (12.8 Tbit/s). The control plane is C++. The prototype supports WebRTC with AV1 scalable video coding at three frame rates (7.5, 15 and 30 fps), and the control plane picks the layer for each receiver from its bandwidth estimates through a replaceable function.

The evaluation uses a campus testbed with clients running in headless Chrome, a 32-core server running Mediasoup as the software baseline, and replays of campus-scale Zoom traces. The traces were anonymised and reviewed under the university's ethics process.

## Findings

These are the authors' reported results, taken from the arXiv version of March 2025.

- In a ten-minute three-party call, 96.46% of the packets and 99.65% of the bytes were handled entirely in the data plane. The rest are feedback, connectivity checks and a few key frames.
- Scallop supports 7 to 210 times more meetings than the 32-core server, depending on the meeting shape. For meetings of 10 participants who all send audio and video, with the quality adapted separately for each sender and receiver, that is 4.3 thousand meetings against 192. With no rate adaptation, up to 128 thousand concurrent meetings.
- Two-party meetings are 60% of the meetings in the campus data, and since they need no replication they are the cheapest case: 533 thousand meetings against 4.8 thousand for the server.
- The latency an SFU adds falls by about a factor of 26.
- With rate adaptation, a constrained participant drops from 30 to 15 fps without freezes. The sequence-number heuristics cost some retransmissions, which the authors report stay below 20% even at very high loss rates.

## Critical Analysis

The idea is well supported as a systems argument, and the prototype is real hardware, but it is early.

- **No encryption.** WebRTC media is encrypted per connection, and Scallop implements neither that nor the integrity checks. A proxy that copies one sender's packets to many receivers needs a one-to-many key distribution instead, which the authors discuss but do not build. The capacity numbers do not include that cost.
- **Narrow codec support.** The prototype relies on AV1 layered video with its dependency descriptors. Calls that use other codecs, or simulcast (several separate encodings), are outside what was measured.
- **Heuristics that can be wrong.** Sequence-number rewriting cannot be exact under loss and reordering. The design chooses to leave extra gaps, which cost retransmissions, rather than risk duplicating a number, which freezes the decoder until a new key frame.
- **A capacity comparison, not a cost one.** The claim is more meetings per box against a 32-core software SFU. The price, power and operation of a programmable switch are not measured.
- **One SFU.** Chaining several SFUs across sites is described as a design goal but not implemented, and features that need the media itself, such as recording or transcoding, cannot run in this data plane.
- **Zoom is inferred.** What the authors say about Zoom's servers comes from packet traces. They state they do not know the architecture behind them.

The text read here is the preprint, so details of the proceedings version may differ.

## Further Research

- One-to-many key distribution and encryption in the data plane or on a smart network card.
- Several switches or sites forming one call, with the controller coordinating them.
- Other codecs and simulcast, and layer-selection policies better than the simple threshold one the authors implemented.
- How to combine a hardware forwarding path with software that needs to look inside the media.
- Whether the same split suits the other half of the problem, such as loss recovery between hops (the Tambur paper in Papers covers loss recovery on one-on-one calls).
