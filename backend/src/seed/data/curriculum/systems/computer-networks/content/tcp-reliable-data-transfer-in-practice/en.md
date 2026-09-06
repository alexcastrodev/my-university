---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain TCP's use of cumulative acknowledgments, and what "cumulative" specifically means in terms of which bytes an ACK confirms.
- Describe fast retransmit: what a triple duplicate ACK indicates, and why TCP reacts to it without waiting for a timeout.
- Explain why a fixed timeout interval cannot work correctly across the Internet's real range of round-trip times, motivating adaptive timeout estimation.
- Walk through the exponentially-weighted moving average formula TCP uses to estimate RTT, and explain why a simple average of recent samples is insufficient.
- Connect this concept's concrete mechanisms back to the abstract Go-Back-N-vs-Selective-Repeat framing from reliable data transfer principles: which one does real TCP actually resemble more closely, and where does it differ?

## Context & Motivation

The three-way handshake, just covered, establishes a connection; this concept covers what happens for the remainder of that connection's life — how TCP actually decides a segment was lost and needs retransmitting, and how it decides how long to wait before concluding that. TCP's real answer to both questions is more refined than the simple "start a timer, retransmit if it expires" sketch from reliable data transfer principles: it uses cumulative acknowledgments together with a fast-retransmit shortcut that reacts to a strong signal of loss well before any timer would expire, and it computes its timeout value adaptively, from real, continuously-updated measurements of round-trip time, rather than using one fixed value that could never be simultaneously right for a connection across the same city and a connection across the globe.

## Core Theory

### Cumulative acknowledgments

TCP acknowledgments are cumulative: an ACK with acknowledgment number `n` means "I have correctly received every byte up to, but not including, byte `n`" — not merely "I received the specific segment you're asking about." If segments carrying bytes 1–500 and 501–1000 both arrive correctly, the ACK sent is for byte 1001, regardless of whether one or two segments produced that state. This has a direct, important consequence for loss: if segment carrying bytes 501–1000 is lost but a later segment carrying bytes 1001–1500 arrives, the receiver still only acknowledges up to byte 501 (the last byte it has, in order) — it cannot acknowledge bytes it hasn't received in sequence, even though it has correctly received later bytes.

### Fast retransmit: reacting to duplicate ACKs

When the receiver gets a segment out of order (as in the previous paragraph's example — bytes 1001–1500 arriving while 501–1000 is still missing), it re-sends an ACK for byte 501 again — a duplicate ACK, since the receiver already sent that exact same acknowledgment number once before. If the sender sees three duplicate ACKs for the same byte in a row (the original ACK plus two more duplicates — a triple duplicate ACK), this is treated as strong evidence that a specific segment was lost, since it means at least two segments arrived safely after the missing one, which is unlikely to happen by pure random reordering rather than genuine loss. TCP's fast retransmit reacts to this signal immediately, retransmitting the missing segment without waiting for its timer to expire — often significantly faster than a timeout-based recovery would be, since three duplicate ACKs can arrive well within a single round-trip time.

### Why a fixed timeout cannot work

The Internet connects hosts that might be on the same local network (round-trip time under a millisecond) or on opposite sides of the planet (round-trip time of a few hundred milliseconds). A single fixed timeout value cannot be correct for both: a timeout tuned for the local case would trigger constant, unnecessary retransmissions on the long-distance connection (declaring loss for segments that are simply still in flight, given the longer real round-trip time), while a timeout tuned for the long-distance case would leave the local connection waiting far too long to notice a genuine loss. TCP instead measures round-trip time for each individual connection and computes its timeout adaptively from those measurements.

### Adaptive RTT estimation

TCP samples the actual round-trip time (`SampleRTT`) for individual segments, and maintains a smoothed estimate, `EstimatedRTT`, updated with each new sample via an exponentially-weighted moving average:

```text
EstimatedRTT = (1 - α) × EstimatedRTT + α × SampleRTT
```

with `α` typically set to 0.125 (giving recent samples meaningful weight while still smoothing out noise from any single unusually fast or slow sample). TCP also tracks the *variability* of RTT samples (`DevRTT`, a measure of how much SampleRTT tends to deviate from EstimatedRTT), and sets its actual timeout interval as `EstimatedRTT + 4 × DevRTT` — a wider margin when RTT has been fluctuating a lot recently, and a tighter margin when it has been stable, rather than using EstimatedRTT alone as the timeout.

### Why not just a simple average

A simple, unweighted average of all past RTT samples would respond very slowly to a genuine, sustained change in network conditions (a route change, sudden congestion) — an old average built from hundreds of samples would barely move in response to a handful of new samples showing a different real RTT. The exponentially-weighted moving average, by contrast, always gives newer samples a fixed proportional weight (`α`) relative to the existing estimate, so it tracks a genuine, sustained shift in real RTT much more responsively, while still smoothing out the noise of any single anomalous sample.

## Worked Examples

### Example 1: Cumulative ACK with an out-of-order arrival

Bytes 1–500 arrive and are acknowledged (ACK=501). Then bytes 1001–1500 arrive (bytes 501–1000 lost in transit). Then bytes 1501–2000 arrive.

```text
After 1-500 arrives:      ACK=501  (all bytes up to 501 received)
After 1001-1500 arrives:  ACK=501  (duplicate — 501 is still the
                                     highest IN-ORDER byte received;
                                     1001-1500 is out of order and
                                     cannot be acknowledged past 501)
After 1501-2000 arrives:  ACK=501  (duplicate again — same reason)
```

Three ACKs for byte 501 in a row (the original plus two duplicates) is exactly the triple-duplicate-ACK signal that triggers fast retransmit — the sender infers bytes 501–1000 were lost and retransmits them immediately, without waiting for a timeout.

### Example 2: Computing EstimatedRTT with the EWMA formula

Starting `EstimatedRTT = 100` ms, `α = 0.125`. A new `SampleRTT` of 140 ms is measured.

```text
EstimatedRTT = (1 - 0.125) × 100 + 0.125 × 140
             = 0.875 × 100 + 0.125 × 140
             = 87.5 + 17.5
             = 105 ms
```

A single higher sample (140 ms) nudges the estimate up only modestly (from 100 to 105 ms), rather than jumping all the way to 140 — this damping is the direct, intended effect of weighting the new sample by only `α = 0.125`, protecting the estimate from over-reacting to one noisy measurement while still moving in the right direction.

### Example 3: Comparing fast retransmit's timing against a timeout

A connection has EstimatedRTT of 100 ms and a computed timeout of roughly 250 ms (EstimatedRTT plus a margin for DevRTT). A segment is lost, but the two segments sent immediately after it arrive successfully and trigger duplicate ACKs.

```text
Fast retransmit path: the triple duplicate ACK can arrive back at the
  sender in roughly one round-trip time after the lost segment (≈100 ms),
  since it only requires two more segments to be sent, received, and
  acknowledged.

Timeout path (if fast retransmit did not exist): the sender would have
  to wait the full ≈250 ms timeout interval before concluding the segment
  was lost and retransmitting.
```

Fast retransmit can recover from this specific kind of loss more than twice as fast as waiting for a timeout would — a real, quantifiable difference that matters directly for throughput on any connection experiencing occasional loss.

## Common Misconceptions & Pitfalls

- **"A duplicate ACK always means a specific segment was lost."** A single duplicate ACK can also result from ordinary network reordering delivering an out-of-order segment without any actual loss — this is exactly why TCP waits for *three* duplicate ACKs (a much stronger, though not absolute, signal of genuine loss) rather than reacting to just one.
- **"TCP acknowledges each segment individually, by segment number."** TCP's acknowledgment number is cumulative and byte-oriented — it names the next byte the receiver expects in sequence, not a specific segment's identity, which is exactly why an out-of-order arrival produces a duplicate of the previous ACK rather than a new, distinct acknowledgment.
- **"A longer timeout is always safer than a shorter one."** A timeout that's too long delays legitimate retransmission after a real loss, hurting throughput; a timeout that's too short triggers unnecessary retransmissions for segments that are simply still in flight — DevRTT-based adaptive timeout exists precisely to find a value calibrated to each connection's actual, currently-observed variability, rather than erring permanently toward either extreme.
- **"The EWMA formula treats all past samples equally."** It does not — each new sample is weighted by `α` relative to the accumulated estimate, meaning older samples' influence decays geometrically over time; this is a deliberate design choice favoring responsiveness to genuine, sustained change over strict historical accuracy.

## Summary

TCP's cumulative acknowledgments confirm "everything up to this byte, in order" rather than acknowledging individual segments, which means an out-of-order arrival produces a duplicate of the previous acknowledgment rather than a new one — and three such duplicates in a row (a triple duplicate ACK) is treated as a strong signal of loss, triggering fast retransmit well before any timer would expire. Because round-trip time varies enormously across real connections, TCP computes its retransmission timeout adaptively, from an exponentially-weighted moving average of measured round-trip times (EstimatedRTT) plus a variability-based margin (DevRTT), rather than using one fixed value that could never be correct for both a same-city connection and a transcontinental one. Together, fast retransmit and adaptive timeout estimation are TCP's concrete, real-world instantiation of the abstract sequence-number-and-timer machinery introduced in reliable data transfer principles — closer in spirit to Selective Repeat's per-segment tracking than to Go-Back-N's blanket retransmission, though TCP's cumulative-ACK design means it does not buffer and selectively acknowledge out-of-order data quite as cleanly as a textbook Selective Repeat protocol would.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of TCP's cumulative ACKs, fast retransmit, and adaptive RTT/timeout estimation.
