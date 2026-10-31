---
title: "Measuring the Performance and Network Utilization of Popular Video Conferencing Applications"
summary: A lab measurement of Zoom, Google Meet and Microsoft Teams under controlled network conditions, showing how much bandwidth each needs, how fast it recovers from a drop, how it competes, and how the screen layout changes its traffic.
researchArea: Computer Networks
keywords: video conferencing, zoom, google meet, microsoft teams, congestion control, network measurement
version: 1.0
updatedAt: 2026-10-31
---

## Overview

When schools and workplaces moved online in 2020, video conferencing applications (VCAs) became a load that networks were not sized for. This IMC 2021 paper from the University of Chicago started with a question from the authors' own city officials: what level of Internet connectivity do people need for these tools to work well? It also came as the US Federal Communications Commission was debating what counts as "broadband" (at the time 25 Mbps down and 3 Mbps up).

The paper measures three services that millions of people use and whose protocols are proprietary: Zoom, Google Meet and Microsoft Teams. Because the inside of those systems is closed, it treats them as black boxes and measures what they do on the wire and in the browser's WebRTC statistics.

## Contribution

A side-by-side comparison of the three applications along four questions:

- How much upstream and downstream bandwidth does a call need, and what happens when the link is smaller than that?
- How does a call react to a temporary drop in capacity, and how long does it take to get back to normal?
- How does a call share a link with another call, with a different application, or with a bulk TCP transfer?
- How do the number of participants and the viewing mode (speaker view, gallery, a pinned video) change the traffic?

It then draws a policy conclusion from the numbers: a 25/3 Mbps line may not be enough for two simultaneous calls.

## Methodology

The setup is two identical laptops (Ubuntu 20.04) wired to a router with a dedicated 1 Gbps symmetric Internet link. Linux traffic control shapes the link to the capacity under test. To keep the content the same in every run, the camera is replaced by a pre-recorded 720p talking-head video fed through ffmpeg, and the in-call steps are automated with PyAutoGUI. The applications and versions are fixed: Chrome 89 for Meet, Zoom client 5.6.1 and Teams client 1.4.

- **Static conditions.** Calls of 2.5 minutes, five repetitions each, with the link shaped from 0.3 Mbps to 10 Mbps in each direction.
- **Disruptions.** A temporary cut of the link to 0.25 Mbps, then the time until the bitrate is back to its normal value.
- **Competition.** A second call, another application, or an iPerf3 TCP flow shares the bottleneck.
- **Modality.** Calls with more participants, and different viewing modes.

Video quality inside the browser is read from the WebRTC statistics: frame width, quantization parameter and freezes.

## Findings

These are the authors' reported results.

- On an unconstrained link the average utilisation of the three applications varies between 0.8 and 1.9 Mbps. At a 10 Mbps uplink the average upstream use was 1.44 Mbps for the Teams desktop client, 0.95 for Meet and 0.77 for Zoom.
- After a severe cut of the uplink to 0.25 Mbps, all three needed more than 25 seconds to recover, and some as much as 50 seconds. Teams was also slow to recover from drops in downlink capacity, and degraded even for a moderate reduction to 1 Mbps.
- Competition is uneven. In constrained settings one Zoom call can take more than 75% of the available bandwidth when competing with another application such as Meet or Teams.
- More participants do not always mean more traffic. For some applications a client's use falls as the call grows, because each person's video is shown, and so sent, at a lower resolution.
- One participant's viewing mode, such as pinning a speaker, can change the upstream traffic of the other participants.
- Performance starts to degrade below about 1.5 Mbps of upstream capacity, and some applications do not compete well with TCP flows when the link is limited.

## Critical Analysis

This is a careful measurement study, and the setup is honest about its limits.

- **A snapshot.** The numbers belong to specific client versions in early 2021. These applications change often, so treat the figures as an example of the method more than as current requirements.
- **Controlled, so narrow.** Two wired laptops, one shaped link and a looped talking-head video are repeatable but simpler than real calls, which have more motion, wireless links, mobile devices and many participants. One client's Linux layout shows at most four people, which limits what a larger call can reveal.
- **Causes are inferred.** The authors link differences to congestion control, encoding and how each service's relay server adapts streams (separate qualities or layered video that the server forwards selectively, which is the job of an SFU). They cannot see inside the services, and they note some behaviours they cannot explain, such as a change in the quantization parameter at 0.3 Mbps in Meet.
- **From lab to policy.** The argument for changing the broadband definition rests on three applications measured in a lab. It is a useful data point, not a full model of household demand.

## Further Research

- More applications, platforms (phones in particular) and kinds of network impairment such as loss and variable delay, as the authors suggest.
- Larger meetings, where the relay server and its layer selection matter more than the clients do.
- Measuring the servers' side directly, so the causes of the differences are observed and not guessed. The two papers on Zoom's packet format and on Scallop in Papers go that way.
