---
title: "Pulse Before Sound: Reimagining Presence and Liveness in Telematic Music Performance through MIDI-Native Collaboration"
summary: Instead of streaming audio between remote musicians, the Telemidi system starts a shared pulse at every node and then sends only MIDI events, quantized or looped so that latency stops mattering to the groove.
researchArea: Computer Music
keywords: telematic music performance, midi, shared pulse, latency accepting solutions, networked music performance, practice-led research
version: 1.0
updatedAt: 2026-11-10
---

## Overview

Networked music performance over the Internet usually means streaming audio, and audio streaming hits a wall: once the delay passes about 30 milliseconds, the paper notes (citing Rofe and Reuben), a shared groove starts to fall apart. Every stage adds delay, from transduction and conversion to compression and the network path, and jitter makes it worse.

This 2026 article by Matt C. Bray (Western Australian Academy of Performing Arts, Edith Cowan University), published in the Journal of Network Music and Arts, describes a different design called Telemidi. No audio crosses the network. Every performer runs a near-identical Ableton Live session, a shared pulse is started on all nodes at the beginning of the performance, and from then on the nodes exchange only MIDI events (Note On/Off, velocity, aftertouch, Control Change, Program Change). Each node renders its own sound locally from those events. The slogan is "pulse before sound": agree on the beat first, then send intentions instead of waveforms.

The article is a practice-led, largely conceptual piece. Its evidence comes from the author's longitudinal SHOALZ series (91 improvised sessions between Perth and mostly London, 2022 to 2024) and from one intercultural event linking musicians in Muhanga, Rwanda, with pipe organs in Vancouver and Calgary. It condenses the author's 2024 PhD thesis, which most of the footnotes point to.

## Contribution

- **A MIDI-native architecture for telematic performance.** Nodes share pulse and events, not audio. MIDI messages take a few bytes each, so bandwidth is tiny (SHOALZ averaged about 27.78 events per second, with a peak of 40.22) and there is no audio encoding or decoding step.
- **A concrete synchronization recipe**, as far as the paper describes it:
  1. **Start the pulse once.** A "synchronized UTC play command" (Figure 1), described elsewhere as "explicit timing messages at the start of a performance", starts DAW playback on every node.
  2. **Let each clock free-run.** After the start, "each node's CPU clock then maintains this pulse". The pulse no longer depends on the network, so it stays "independently consistent in tempo and phase regardless of network latency".
  3. **Absorb latency on the bar grid.** Incoming MIDI is quantized to the shared grid, and loop launches are quantized to the start of the next bar. A gesture made in bar n is heard everywhere at the start of bar n+1, so delays shorter than a bar disappear from the rhythm.
  4. **Ship whole loops.** Instead of streaming each note, a node can send the complete MIDI file of a recorded loop with all its micro-timing. The first pass may be late, but "by the third time the loop plays back, it will be identical across all nodes".
  5. **Send early when you must.** In the Rwanda case, the keyboard part was sent one beat early so it would land in time on the Canadian organs.
- **A redefinition of synchrony** as "the processual alignment of intentional musical actions within a coordinated pulse framework", not the simultaneous arrival of sound at one listening point. In this view two players are in sync if their gestures sit at the right place on the shared grid, even though each one hears only local audio.
- **A theoretical framing** through the author's Latency Accepting Solutions (LAS) framework, which works with latency instead of trying to remove it, and Caroline Nevejan's YUTPA model (Time, Place, Action, Relation) for co-presence.

For a software engineer building a shared metronome for remote musicians, the takeaway is the architecture: one start event, local clocks from then on, quantization as the latency buffer, and musical content sent as small timestamped events that each site renders itself.

## Methodology

There is no controlled experiment and no technical evaluation of timing accuracy. The method is practice-led research with two case studies.

- **SHOALZ series (2022 to 2024).** 91 documented improvisation sessions with two primary performers at distributed nodes, each running a complementary Ableton Live session that sends and receives MIDI over a WAN. Sessions ran from 15 to 45 minutes. Data came from MIDI event logs and audio-visual recordings: event density (events per second) and one-way delay (OWD) between nodes, plus performers' reports of rhythmic alignment, confidence and flow.
- **Rwanda-Canada performances.** A single event with two scored pieces (a composition by Denis Bedárd merging Rwandan folk music and Western pipe organ), each played three times over about 22 minutes. A Vancouver organist played to a local metronome and led; the Calgary pipe organ hosted the network session and was played directly by the passing MIDI stream from both Rwanda and Vancouver; in Muhanga a school choir and a keyboardist played along with the incoming MIDI, heard through a software pipe organ sampler. Each node was documented with MIDI logs and audio/video.

The paper does not name the transport protocol, the software that carries MIDI over the WAN, how OWD was measured beyond mentioning traceroute distance, or how the UTC start command keeps the nodes in phase.

## Findings

These are the author's reported results.

- **Latency figures.** SHOALZ had an average OWD of 150.244 ms over an average traceroute path of 23,963 km, mostly Perth to London. Across the series the system is said to withstand latencies "exceeding 200 milliseconds" while still producing stable pulse-based music. The Rwanda link exceeded 330 ms OWD because it used the Rwandan mobile data network.
- **Musical outcome.** Performers reported consistent rhythmic alignment and ensemble cohesion, growing confidence in coordinating without hearing the remote node, and experiences of flow, immersion and "distributed presence". They developed anticipatory strategies, triggering shared loops quantized to the next bar.
- **The one-beat trick worked by coincidence.** At 88 bpm a quarter note lasts 681.82 ms. About 330 ms from Vancouver to Muhanga plus about 330 ms back is close to that, so a part sent one beat early arrived in time. The author calls the match "serendipitous", and anticipating chords early sometimes produced unintended dissonance.
- **Audience streams were not synchronized.** Online viewers could watch Vancouver, Calgary or Muhanga, but the three streams were not aligned, which the author reads as a sign that audience output needs its own coordination.
- **Stated limits.** MIDI's 7-bit velocity and controller resolution, stuck notes when packets are lost, and the poor fit with free improvisation, ambient and other music without a steady pulse.

## Critical Analysis

The core design is sound and familiar to anyone who has built a distributed system: do not ship state continuously when you can ship a start signal plus small deterministic events, and hide latency behind a scheduling boundary (here, the next bar). For loop-based electronic music that is a practical answer, and 150 to 330 ms OWD is far beyond what audio streaming tolerates. The evidence, though, is thin for the claims made.

- **No measurement of the thing that matters.** The paper never reports how closely the nodes' pulses agree in phase, how much they drift over a 45-minute session, or how often events landed in the wrong bar. "Robust" and "stable" rest on performers' self-reports and on event density and OWD figures that say nothing about synchrony. The paper does not identify the two SHOALZ performers or say whether the author is one of them.
- **The clock question is skipped.** After the start command, "each node's CPU clock" keeps the pulse. Free-running computer clocks drift (other work in this field measures drift on the order of a millisecond per second), so over a long session two DAWs can slide apart unless something resynchronizes them. The paper does not say whether Ableton Link, NTP or anything else is used, nor how a "UTC play command" sent over a 150 ms path avoids starting nodes 150 ms apart. A UTC start only works if both machines already agree on UTC, which needs its own clock sync.
- **The session numbers do not add up.** The text gives 91 sessions with an average of "approximately 19 minutes and 45 seconds" and a total of 34 hours 54 minutes. But 91 times 19:45 is about 29 hours 57 minutes; 34:54 over 91 sessions would be an average of about 23 minutes. One of the figures is wrong.
- **"Despite this variability" refers to variability that is never shown.** Only an average OWD is given, with no spread or jitter figures, although jitter is the stated problem.
- **The loop mechanism is underexplained.** Why a loop becomes identical across nodes "by the third time" it plays is not explained (presumably a record pass, a transfer, then playback), and the latency budget for sending a whole MIDI file is not discussed.
- **The Rwanda case is a different model.** There the Rwandan musicians followed incoming MIDI instead of a local copy of a shared pulse, and the solution depended on a round trip that happened to equal one beat at 88 bpm. The paper presents it as pulse sharing "albeit far less organized", but it is really manual latency compensation that would break at another tempo or on another network.
- **Synchrony is redefined, not achieved.** Calling it synchrony when gestures sit on the same grid but each player hears only local audio is a fair design choice, yet it also means nobody hears the actual ensemble in real time. Performers react to remote gestures at least a bar late, which suits loop music and rules out tight call-and-response.

For someone building a shared metronome, the paper is useful as an architectural pattern, not as a specification. The missing pieces (common time base, start-time scheduling, drift correction, packet loss handling) have to come from elsewhere, for example GPS- or NTP-disciplined clocks, the Global Metronome approach, or Ableton Link on each LAN.

## Further Research

- Testing MIDI-native coordination across more genres, ensemble sizes and network conditions, as the author proposes, especially beyond a two-person duo.
- Hybrid designs that combine MIDI coordination with selective audio transmission.
- Higher-resolution control protocols such as Open Sound Control (OSC) in place of 7-bit MIDI, plus mechanisms against stuck notes on packet loss.
- Coordination strategies for idioms without a steady pulse, such as free improvisation and ambient music, which the author leaves as an open question.
- Synchronizing the outputs sent to remote audiences, which were unaligned in the Rwanda-Canada event.
- Objective measurement of pulse agreement and drift between nodes, which the paper does not provide and which would be needed to back its robustness claims.
