---
title: "An Overview on Networked Music Performance Technologies"
summary: A 2016 survey that gathers what perceptual studies say about how much delay remote musicians can tolerate, breaks the one-way delay into its components, and compares the systems built to stream live music between distant players.
researchArea: Computer Music
keywords: networked music performance, latency budget, latency tolerance, clock synchronization, audio streaming, survey
version: 1.0
updatedAt: 2026-11-10
---

## Overview

Networked music performance (NMP) means musicians in different places playing together in real time, each hearing the others through a network. Unlike a video call, where a few hundred milliseconds of delay is annoying but workable, ensemble playing depends on timing at the scale of tens of milliseconds, and the network delay cannot go below the time light needs to cross the distance.

Cristina Rottondi (IDSIA, Lugano), Chris Chafe (CCRMA, Stanford), Claudio Allocchio (GARR, the Italian research network) and Augusto Sarti (Politecnico di Milano) wrote this survey for IEEE Access, published in December 2016. It pulls together three bodies of work that are usually read separately: the psychoacoustic experiments that measure how latency affects tempo and synchrony, the engineering of the audio chain from microphone to headphone, and the software frameworks that have been built for remote rehearsals, lessons and concerts.

For a software engineer who wants to keep a shared metronome in sync among several remote musicians, the paper is useful as a map. It tells you how many milliseconds you can spend, where each one goes (sound card blocks, jitter buffer, codec, fibre), which tolerance figures the literature supports, and which synchronization techniques (NTP, GPS, PLL clock recovery, resampling, a metronome stream) earlier systems used.

## Contribution

The authors describe their contribution as threefold, and the paper is organised along those lines:

- **A review of latency tolerance studies.** Section III collects the perceptual experiments of roughly the previous decade (hand clapping pairs, instrument duos, a distributed opera) and organises their results by the factor being tested: tempo, timbre and attack time, reverberation, rhythmic complexity, musical training, compensation strategies, presence of a conductor, and audio with video.
- **A decomposition of end-to-end delay.** Section IV defines the Overall One-way Source-to-Ear (OOSE) delay as a chain of twelve stages, writes it as a sum of terms, and derives a lower bound that depends only on sample rate, block size, filter length, jitter buffer size, codec delay and distance. This is the part a developer can turn directly into a budget.
- **A comparison of NMP frameworks.** Section V compares existing systems by purpose, architecture (peer to peer, client server, multicast), network span, protocol stack, supported data types and stream synchronization method.
- **A taxonomy of playing strategies under delay**, taken from Carôt and Werner: realistic interaction, master and slave, and delayed feedback (adding artificial self-delay), including the variant that relies on a metronome sounding in sync at both ends.
- **A summary of packet loss handling**, from sender side duplication, interleaving and forward error correction to receiver side concealment by insertion, interpolation and regeneration.
- **A research agenda** in Section VI that argues for treating NMP as a perceptual problem, not only a network one.

## Methodology

This is a narrative survey, not a systematic review. There is no stated search protocol, inclusion criteria or count of screened papers. The authors select work they consider representative, and a good share of it comes from their own groups: the CCRMA clapping studies (Chafe and colleagues), the feature-based analysis of packet delay (Rottondi, Sarti and colleagues) and the LOLA system (Allocchio and colleagues).

The perceptual part rests on a common experimental template that the survey describes explicitly. In all studies except the distributed opera one, two musicians sit in separate sound-isolated, usually anechoic rooms, hear each other through headphones, cannot see each other, and hear their own instrument without added delay. Delay is inserted either by a central computer or by a network emulator such as Netem on a wired LAN. Delays are constant in every study except one ([39], Rottondi et al. 2015), which draws packet delays from a normal distribution to emulate jitter. Delay conditions are randomised and hidden from the players, and most studies give a few bars of reference tempo, by an instructor or a metronome, before each trial.

The survey also explains how these studies measure results, which is useful for anyone who wants to evaluate their own system. Onsets t(n) are found manually or with a peak search, inter-onset intervals are `IOI(n) = t(n+1) - t(n)`, and tempo in BPM is `60 / IOI(n)`. From there it lists pacing (mean IOI), regularity (coefficient of variation of the IOIs), asymmetry (mean lag of one player behind the other), imprecision (standard deviation of that lag) and tempo slope (a linear fit to the tempo series, positive for speeding up and negative for slowing down). Subjective ratings and questionnaires complete the picture.

Two analytical models are summarised. One treats players as coupled oscillators that correct their frequency from a delayed phase comparison, giving a steady tempo `Ω = ω / (1 + Kτ)`, where ω is the mean of the two natural frequencies, τ the delay and K a coupling constant. The other, from Gurevich and colleagues, assumes memoryless players who react only to the last beat they heard, so the interval grows by τ every beat: `δ(n) = 60 / (60/δ + nτ)`. The survey presents it as a lower bound on real tempo, since musicians integrate over more than one beat.

The engineering part works from first principles (sampling, block processing, buffering, packetization, propagation, routing) and is then checked against the design choices of existing frameworks, which the survey summarises in a table (Table 3). Tables 1 and 3 are images in the published PDF, so this analysis relies only on what the running text states about them.

## Findings

**Tolerance ranges reported by the perceptual studies.** The introduction quotes a commonly cited threshold of 20 to 30 ms one way, equated with 8 to 9 m of acoustic distance, the traditional limit for keeping a common tempo without a conductor. The detailed review then refines it:

- Below 10 to 15 ms, every study reports a positive tempo slope: pairs speed up, attributed to the natural tendency to anticipate a beat.
- From 10 to 15 ms up to 20 to 25 ms, tempo is stable and close to the reference, ratings are positive, and latency is barely noticed.
- From 20 to 25 ms up to 50 to 60 ms, delay becomes clearly perceptible, players slow down, ratings fall, and imprecision and asymmetry (flat below 25 to 30 ms) start rising.
- Above 60 ms the performance is heavily impaired and judged barely tolerable; regularity within a single part degrades markedly above 60 to 80 ms.
- At very high delay some players switch to "auto-pilot", ignoring the partner: one study finds the largest tempo variation at 50 to 100 ms and less variation, though lower tempo, above 100 ms.

**What moves those ranges.** Faster tempos lower the tolerance: in [39], drummers and bassists playing quarter notes tolerated about 40 ms on average at 60 BPM but only about 15 ms at 120 BPM. Noisy or bright timbres (high spectral entropy, flatness or centroid) were more prone to slowing down above 35 ms. Slow attacks slowed the tempo more than sharp ones, but gave better synchrony. Trained musicians decelerated more than non-musicians, while non-musicians were less synchronised. With asymmetric delays, the survey states that the effect is dominated by the larger of the two directions. Adding self-delay at one side raised acceptance to 65 ms in one study and 190 ms in another (although self-delay above 30 ms felt "unnatural"); self-delay on both sides gave at most 80 ms and was rejected by many subjects. In master and slave playing, where the leader ignores the follower, delays up to about 100 to 200 ms can be tolerated. A conductor gave a common cue and, counterintuitively, tempo rose at high delays.

**The one-way delay budget.** The survey writes the OOSE delay as

`Dtot = 2(Da + Dc + Ds) + Db + Dp + Dt + Dq`

where the factor 2 counts the sound card and codec on both sender and receiver, and the terms are:

- **Da, conversion:** one sample period, 20.83 µs at 48 kHz, plus any filter.
- **Dc, codec:** at least 20 ms for MP3 style codecs, which is why they are considered unusable; 4 to 8 ms for low-delay codecs (Opus, ULD, Wavpack). Several frameworks send uncompressed audio to make Dc zero.
- **Ds, sound card block:** `P / R` for a block of P samples (typically a multiple of 64). Small blocks cut delay but raise interrupt rate and OS overhead; a general purpose OS adds up to a few ms of scheduling noise.
- **Db, jitter buffer:** with B blocks and playback starting at half full, `B·P / (2R)`. This is where network jitter and clock drift are absorbed; too small gives under-runs (gaps), too large adds delay.
- **Dp, propagation:** `L / cm`, with signal speed about 0.8c in copper and 0.7c in fibre, about 5 µs per km.
- **Dt, transmission, and Dq, router processing and queuing:** Dq depends on topology, congestion and operator policy and is usually modelled as a random variable.

Ignoring Dq and Dt, the survey gives the lower bound `Dtot >= 2((1 + F + P)/R + Dc) + B·P/(2R) + L/cm`, with F the filter length in samples, and plots it for F = 100, B = 8 and L = 1000 km. Working that formula by hand with R = 48 kHz and no codec (this arithmetic is ours, not the paper's): P = 64 gives about 6.9 + 5.3 + 4.8 = 17 ms, P = 128 gives about 25 ms, and P = 256 gives about 41 ms. Block size and buffer depth, not distance, dominate at 1000 km, and router queuing still comes on top. The memoryless model gives a feel for what happens when that budget is blown: at 90 BPM with τ = 20 ms, after ten beats the lower bound has fallen to about 69 BPM (again our arithmetic).

**Packet loss.** On very clean academic networks, with losses of 10^-6 to 10^-8 and jitter below 1 ms, LOLA applies no correction at all. Otherwise receiver side concealment works best below 15% loss and for 4 to 40 ms packets; inserting silence is only acceptable for 4 to 16 ms packets and degrades past 2% loss; overlap-add patching degrades beyond 20 ms gaps or 3% loss.

**Architectures and protocols.** Peer to peer meshes send and receive N - 1 streams per participant, which collides with consumer uplinks of a few Mb/s when each stream is hundreds of kb/s. Client server designs mix at a central node, so each client handles one stream each way, at the cost of an extra hop and server load; NetFPGA, the Click router and Netmap are compared as ways to avoid kernel and user space copies at the server. Multicast, for instance over information-centric networks, limits uplink to one stream but sends everyone the same mix. Every framework in the comparison uses UDP for media, some add RTP/RTCP for timestamps and sequence numbers, and SIP and HTTP over TCP handle sessions and control. The network span is limited to a few thousand km. Video codecs from telemedicine and cinema usually exceed 60 ms.

**Synchronizing clocks and the beat.** Sound cards with nominally equal sample rates drift, causing buffer under-runs and over-runs over minutes. The survey lists the techniques used: timestamps plus a master clock recovered with a phase-locked loop (via RTP/RTCP or NTP), NTP accuracy of about 0.2 ms on a LAN but up to a few ms over a WAN, GPS or CDMA time signals with accuracy of tens of microseconds, affordable GPS time servers (the "global metronome" of Oda and Fiebrink), adjusting the reference clock from the offset between remote and local audio callbacks (used in Soundjack and JamBerry), MIDI Clock at 24 pulses per quarter note from a server, resampling at `Rr = (R̂M·PS) / (R̂S·PM)` from estimated master and slave rates, and a metronome sent as its own data stream from the server or a peer (DIAMOUSES). For a shared click, the closest recipe in the paper is the delayed feedback variant: each player adds a self-delay equal to the one-way network delay and follows a metronome that sounds in perfect sync at both ends, which the authors warn is hard because of local clock drift.

**Systems named in the text** include LOLA (low latency audio and video, uncompressed, built for research networks), JackTrip (CCRMA, UDP with redundancy), Soundjack, JamBerry (a Raspberry Pi device), DIAMOUSES, MusiNet and the llcon project. The comparison table itself is an image in the PDF, so this list only covers systems the prose mentions.

## Critical Analysis

- **Written before the field changed.** The paper dates from 2016. It predates 5G, the wide availability of low-delay fibre to the home, and the 2020 pandemic, when tools such as Jamulus (whose predecessor llcon is cited only as a URL), JackTrip in its newer forms, SonoBus and browser based systems went from research niche to everyday use for choirs and bands. Results from that large real-world deployment, with many more than two players, are of course absent.
- **The perceptual evidence is narrow.** Almost every experiment pairs two people in anechoic rooms with headphones, no visual contact and a constant inserted delay. Only one study models jitter, only one involves more than two performers (the opera), and the survey itself notes that a full assessment of video and of audio and video misalignment remains to be done. The ranges are robust for duos chasing each other's clicks and much less so for larger ensembles or real rooms.
- **Inconsistencies in the text.** The 20 to 30 ms threshold is equated with 8 to 9 m of air, but at roughly 343 m/s those times correspond to about 7 to 10 m, so 8 to 9 m matches only the middle of the range. The letter B is used both for the buffer size in blocks and, a few lines later, for network bandwidth (which was called C just before). The three compensation strategies are said to be "enumerated in Section I" while they appear in Section II-B, and the same sentence says all works address all three strategies while only two studies test self-delay. The transmission delay formula is garbled in the published text.
- **Asymmetry is simplified.** The survey says asymmetric delays are dominated by the larger direction, citing Chafe and Gurevich 2004. That paper presents this only as a hypothesis from sparse data, valid up to about 25 ms, and suggests something closer to the median beyond that. The survey drops both the caveat and the second half.
- **The budget is a lower bound.** Equation 4 drops router queuing and transmission time, which on the public Internet are exactly the variable terms that force larger jitter buffers. The plotted example also assumes 1000 km of straight fibre, whereas real routes are longer than geographic distance. A reader should treat the curve as the best case.
- **Self-citation and vantage point.** Several of the core results and systems come from the authors' own groups (CCRMA clapping studies, the 2015 feature analysis, LOLA on GARR). That is natural for a survey written by the people who built the field, but the selection is not systematic and the comparison of frameworks is descriptive, with no measured latency figures under common conditions.
- **Gaps relevant to a shared metronome.** The synchronization section lists mechanisms but gives almost no numbers on how well they keep a beat aligned over time, and it does not discuss IEEE 1588 PTP, the tempo and phase sharing approach later popularised by tools like Ableton Link, or interval based systems such as NINJAM that deliberately delay everything by a whole musical measure. Its own perceptual review shows a local, clock-aligned click avoids the mutual waiting but leaves players hearing each other late; the paper does not study that combination directly.

## Further Research

- Running perceptual studies with larger ensembles, realistic rooms, jitter and packet loss, rather than constant delay between two isolated players, as the authors themselves call for.
- Measuring how a shared metronome aligned to a common clock (NTP, GPS or PTP) interacts with delayed audio from other players, including how much clock offset between sites is audible.
- Comparing frameworks under identical network conditions and publishing measured OOSE delay per stage, so the lower bound of equation 4 can be checked against practice.
- Testing adaptive jitter buffers and drift compensation by resampling against the under-run and over-run artefacts the survey describes.
- Studying how musicians adapt over time, including the age and familiarity effects the authors mention anecdotally, and whether training raises tolerance.
- Following the authors' proposed agenda: content-aware metrics beyond tempo slope, the role of video frame rate and resolution, prediction of a partner's playing ("robotic musicianship"), and an ontology to organise NMP knowledge.
- Revisiting the numbers with post-2020 data from mass use of NMP tools over consumer broadband and 5G.
