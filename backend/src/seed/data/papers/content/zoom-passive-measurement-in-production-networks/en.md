---
title: "Enabling Passive Measurement of Zoom Performance in Production Networks"
summary: The authors work out which parts of Zoom's proprietary packets are readable and use them to measure bit rate, frame rate, latency and jitter from a packet capture alone, without touching the clients or servers.
researchArea: Computer Networks
keywords: zoom, packet analysis, passive measurement, rtp, sfu, video conferencing
version: 1.0
updatedAt: 2026-10-31
---

## Abstract

Video-conferencing applications impose high loads and stringent performance requirements on the network. To better understand and manage these applications, we need effective ways to measure performance in the wild. For example, these measurements would help network operators in capacity planning, troubleshooting, and setting QoS policies. Unfortunately, large-scale measurements of production networks cannot rely on end-host cooperation, and an in-depth analysis of packet traces requires knowledge of the header formats. Zoom is one of the most sophisticated and popular applications, but it uses a proprietary network protocol. In this paper, we demystify how Zoom works at the packet level, and design techniques for analyzing Zoom performance from packet traces. We conduct systematic controlled experiments to discover the relevant unencrypted fields in Zoom packets, as well as how to group streams into meetings and how to identify peer-to-peer meetings. We show how to use the header fields to compute metrics like media bit rates, frame sizes and rates, and latency and jitter, and demonstrate the value of these fine-grained metrics on a 12-hour trace of Zoom traffic on our campus network.

## Overview

A campus or an ISP that wants to know how video calls are going cannot ask the clients, and the call data a vendor offers through its API is coarse. Looking at the packets is the alternative, but Zoom uses a proprietary protocol and encrypts the media, so a packet capture of a call looks like noise to tools such as Wireshark. Earlier studies had to settle for flow-level totals, and the packet format they described had changed by the time of this study's 2021 and 2022 captures.

This IMC 2022 paper, from Princeton, reverse engineers the readable parts of Zoom's packets and builds measurements on top of them. It is also the groundwork for the same group's Scallop paper in Papers.

## Contribution

- **The structure of Zoom's packets.** Zoom wraps standard RTP and RTCP in its own headers. A type byte tells whether a packet is media, which kind (audio, video, screen sharing), and where the RTP header starts. Servers add one more layer, with direction to and from the server.
- **Evidence for an SFU.** The RTP field that counts contributing sources is always zero, so each packet carries a single source. That suggests the servers forward streams and do not mix or transcode them, which is how a selective forwarding unit behaves.
- **Peer-to-peer detection.** Two-party meetings switch to a direct connection, which the authors can find from the STUN exchange that sets it up.
- **Grouping streams into meetings.** There is no meeting identifier in the headers, so a heuristic matches copies of a stream by SSRC and RTP timestamps. It works because Zoom's SFU does not rewrite RTP timestamps or sequence numbers.
- **Metrics.** Per-media bit rate, frame size and frame rate, latency, jitter and frame delay, computed from header fields alone.
- **A Wireshark plugin** and other tools, released as open source.

## Methodology

The authors run controlled calls and look for structure in the bytes. For each packet offset they plot the values over a flow: horizontal lines are probably identifiers, diagonal lines counters or sequence numbers, and a uniform spread is encrypted. That separates the readable headers from the payload.

Metrics are checked against Zoom's own statistics, read through a custom client built on Zoom's macOS SDK, which updates about once per second. The techniques are then applied to a 12-hour packet trace of Zoom traffic on the campus network. The trace was anonymised, media payloads were removed before the researchers saw it, and the study went through the institution's ethics review.

## Findings

These are the authors' reported results.

- Frame rate can be computed in two ways, from a header field with the number of packets in a frame or from the steps of the RTP timestamp, and the authors calibrate the second against the first.
- Latency to the server, and between two campus participants through the server, can be estimated when the monitor sees a stream go to the SFU and come back as a copy for another campus participant. Zoom's SFU keeps the RTP values, so the copy is recognisable.
- Frame-level jitter computed from the packets does not match Zoom's own jitter figure, especially during congestion. The authors say this surprised them and suggest the app's number may include forward error correction or a long smoothing interval.
- Zoom retransmits lost packets up to two times, so loss shows up as duplicates and not as missing packets. About 10% of Zoom's UDP packets carry no media.

## Critical Analysis

The value of the paper is the technique, and the authors are clear that a full performance study of Zoom is left for later.

- **Fragile by nature.** The work depends on an undocumented format that Zoom is free to change, and it already had changed since earlier studies. The methods can be redone, but the field tables have a shelf life.
- **One vantage point.** A passive monitor on one campus sees only the participants on that campus. A participant who is on the call but muted with camera off sends nothing and is invisible, so meeting sizes are estimates.
- **Loss is hard to read.** Because of retransmissions, a fresh packet and a retransmitted copy cannot be told apart with certainty, so loss and reordering from sequence numbers are inexact.
- **No ground truth for meetings.** The grouping heuristic has no meeting identifier to check against.
- **Generality is argued, not shown.** The authors expect the metrics to apply to other RTP-based services such as Meet, Teams, Webex and FaceTime, but only Zoom is tested.

## Further Research

- Running the same measurements at line rate in a programmable switch, which could also act on them, for example by forwarding only some layers of a layered stream. The Scallop paper in Papers takes that road.
- Using the metrics as features to predict quality of experience, with labels collected from viewers.
- Detecting stalls by comparing frame delay with the time a frame covers.
- Applying the same approach to other proprietary protocols.
