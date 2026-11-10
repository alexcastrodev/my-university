---
title: "The Global Metronome: Absolute Tempo Sync For Networked Musical Performance"
summary: Instead of sending clock ticks between musicians, every site computes the current beat from its own well-synchronized system clock, so all metronomes agree without talking to each other.
researchArea: Computer Music
keywords: global metronome, tempo synchronization, clock synchronization, gps, ntp, networked music performance
version: 1.0
updatedAt: 2026-11-10
---

## Abstract

At a time in the near future, many computers (including devices such as smart-phones) will have system clocks that are synchronized to a high degree (less than 1 ms of error). This will enable us to coordinate events across unconnected devices with a degree of accuracy that was previously impossible. In particular, high clock synchronization means that we can use these clocks to synchronize tempo between humans or sequencers with little-to-no communication between the devices. To facilitate this low-overhead tempo synchronization, we propose the Global Metronome, which is a simple, computationally cheap method to obtain absolute tempo synchronization. We present experimental results demonstrating the effectiveness of using the Global Metronome and compare the performance to MIDI clock sync, a common synchronization method. Finally, we present an open source implementation of a Global Metronome server using a GPS-connected Raspberry Pi that can be built for under $100.

## Overview

Playing rhythmic music over the Internet runs into latency. Audio from a remote player arrives late, the listener waits to play in time with what they hear, the other side does the same, and the ensemble slows down. The literature calls this tempo drag, and at high latency rhythmic playing falls apart.

A marching band has a similar problem, because sound travels roughly one foot per millisecond. Its answer is a conductor, who is seen and not heard, and in a large band several sub-conductors who follow a head conductor. This NIME 2016 paper by Reid Oda (Princeton) and Rebecca Fiebrink (Goldsmiths) applies the same idea to networked performance. Each site runs a local metronome, the sub-conductor, and every local metronome follows a virtual head conductor that "has been ticking at tempo since the Unix epoch". The players then follow their local click, and the click is in time with every other click, whatever the audio delay between sites.

The catch is that this only works if the system clocks agree, and the paper's second half is about getting clocks that good. The idea was later picked up for professional networked ensembles, which makes this the origin of the "global metronome" term.

## Contribution

- **The Global Metronome.** A metronome at tempo f (in beats per minute) is treated as a phasor that turns 2π radians every period T = 60/f seconds. Given a Unix time t in seconds, the phase of the global metronome is the fractional part of t/T, times 2π: φ_global = 2π(t/T minus floor(t/T)). A beat happens every time that fraction wraps to zero. No message is exchanged: two machines that use the same formula, the same f and clocks that agree will tick together, "automatically, with no communication between them".
- **Local offsets and tempo changes.** A client may add a phase offset θ (0 < θ < 2π), giving φ_local = [2π(t/T minus floor(t/T)) + θ] mod 2π. Performers stay in sync as long as all of them use the same f and θ. Changes to f or θ can be pre-planned or sent between players, and the paper leaves the mechanism to system developers.
- **Clock sources without route asymmetry.** The authors argue for GPS (theoretical accuracy of 14 nanoseconds, free to anyone with a receiver and a view of the sky) and, in future, LTE, whose standard requires base station clocks within 5 microseconds. Neither suffers from the path asymmetry that limits NTP over the Internet.
- **The PIGMI.** A (Raspberry) Pi Global Metronome Implementation: a Raspberry Pi 2 with a GPS expansion board, an active GPS antenna and a USB wifi dongle, for under $100, open source with a ready Raspbian image. It can click a GPIO pin as an audible metronome, act as an NTP server for its LAN, or be discovered by LANdini hosts and promoted to master timeserver.
- **Measurements** of tick offsets in several configurations, against a MIDI clock baseline.

For a software engineer the mechanism is the whole point. With MIDI clock, a master sends timing messages down a cable and slaves follow them as they arrive, so every delay or jitter on the link lands in the timing. With the Global Metronome the only thing shared is the tempo and offset, agreed in advance, and the shared time base comes from the clock discipline (GPS, or NTP/PTP from a nearby accurate server). The beat is a pure function of (t, f, θ).

## Methodology

Every test runs two audible metronomes at f = 120 bpm with θ = 0 for 30 minutes. Both audio streams are recorded, and for each tick the timing offset in milliseconds from the matching tick in the other stream is computed. PIGMI-1 and PIGMI-2 are two specific units reused across the tests.

- **Configuration 1 (both GPS).** Each PIGMI has its own GPS receiver and clicks by toggling a GPIO pin. Both pins go into a mixer whose master output is recorded. This tests devices with direct GPS access.
- **Configuration 2 (GPS and NTP).** Both PIGMIs use GPS. PIGMI-1 clicks via GPIO. A 2011 MacBook Pro running OS X Yosemite syncs its system clock via NTP to PIGMI-2 and computes tick times from its system clock, with audio generated in Python. This tests NTP to a low-latency, accurate timeserver.
- **Configuration 3 (GPS and LANdini).** As above, but the laptop connects to PIGMI-2 through LANdini, its system clock is not synchronized, and tick times come from LANdini's network time, with audio from SuperCollider.
- **Configuration 4 (GPS and no sync).** PIGMI-1 uses GPS, PIGMI-2 runs on its free-running internal clock, to show drift.
- **MIDI clock.** A Korg Volca Beats and a Korg Electribe ER-1, connected by a physical MIDI cable and synced by MIDI clock from a host running Ableton Live, as a reference for the jitter of commercial MIDI gear.

A linear regression is fit to each configuration's offsets over time to detect drift.

## Findings

These are the authors' reported results.

- **GPS and NTP are very accurate.** The GPS and NTP configurations show occasional spikes, generally under 3 ms, and the vast majority of offsets are under 1 ms. The figure captions rank GPS first, followed closely by NTP.
- **LANdini is on par with the MIDI drum machines**, which are themselves the worst of the synchronized setups: the MIDI devices show a bimodal offset distribution and a standard deviation five times that of the GPS and NTP setups. They still sound synchronized, which the authors take as evidence that PIGMI sync is "exceptionally accurate".
- **No sync drifts.** Configuration 4 has a mean offset of about minus 2 ms and is the only one whose regression slope is non-zero, 0.006 ms/min with p < 0.0001. All other configurations have p > 0.33, so no detectable drift.
- **Free-running clocks are bad.** As motivation, two of the authors' test computers drift by 0.7 ms per second, or 42 ms after one minute, which is audible.
- **NTP over the Internet** is described as accurate to "tens or hundreds of milliseconds", mainly because standard NTP assumes symmetric paths, while NTP over a LAN to a GPS-disciplined server is extremely accurate.

The authors see the approach as most directly useful for genres with steady tempo, such as Hip Hop and Electronic Dance Music, with audio streamed by something like JackTrip, and for rock and jazz players used to click tracks.

## Critical Analysis

The idea is simple and correct, and that is its strength: it turns tempo synchronization into clock synchronization, a solved problem with good hardware. The evaluation, though, is smaller than the claims.

- **Distance is assumed, not tested.** The captions say the devices "could be hundreds of miles apart", but all recordings come from devices feeding one mixer. The argument that distant GPS receivers sync as well as adjacent ones rests on a citation, not on a measurement.
- **The public Internet case is not measured.** NTP was only tested to a PIGMI on the same LAN. The "tens or hundreds of milliseconds" figure for Internet NTP is stated without a measurement. For an implementer the paper's own numbers point one way: keep the time source close (a GPS-disciplined server on the LAN at each site, or a phone's GPS or LTE time), and do not rely on a distant public NTP server if sub-millisecond agreement matters.
- **Small sample.** One tempo, 30 minutes per configuration, one laptop and OS, and few hardware pairs. The standard deviations appear only in a figure, so the text gives ratios and bounds, not a full table.
- **The no-sync result is subtle.** A slope of 0.006 ms/min would add well under 1 ms over 30 minutes, so most of the minus 2 ms is an initial offset, not drift. The paper does not explain how PIGMI-2's free-running clock was set at the start, and its 0.7 ms per second example (from other machines) is much larger than what PIGMI-2 shows.
- **Output latency is part of the problem.** Configuration 1 is a best case: a GPIO pin switches with almost no delay. Configurations 2 and 3 show that a laptop can still be accurate, but any implementer must schedule the click at the computed time minus the audio output latency of the device, which the formula itself does not cover.
- **Tempo changes are left open.** Because the phase depends on t/T, changing f at an arbitrary moment makes the phase jump unless θ is recomputed at the switch, and all players must switch at the same absolute time. The paper names the problem and leaves it to developers.
- **It fixes the click, not the hearing.** Each player stays on the grid, but remote audio still arrives late. Playing together with a shared click is different from reacting to each other, which the paper acknowledges by pointing to steady-tempo genres.

## Further Research

- Studying real, physically distributed performances with the Global Metronome and the human interactions that result, as the authors plan.
- Supporting more local sync methods on the PIGMI, such as Ableton Link and MIDI clock, so it can feed existing gear.
- LTE time on mobile devices, which the authors see as making phones natural Global Metronome clients.
- For ensembles that want organic tempo changes: virtual tempo controls for a human conductor, automatic beat tracking, or conductor tracking of designated musical leaders, with the Global Metronome as one component.
- Measurements across real long distances and over Internet NTP or PTP, which the paper argues for but does not run.
