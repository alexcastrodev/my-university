---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why reliable data transfer must be built on top of an unreliable channel, rather than assumed as a property the network layer already provides.
- Describe the three basic building blocks reliable data transfer is built from: acknowledgments, sequence numbers, and timers.
- Explain pipelining: sending multiple packets before waiting for acknowledgment of the first, and why it is necessary for good throughput on long-delay links.
- Distinguish Go-Back-N from Selective Repeat as two different answers to "what does the receiver do with out-of-order packets," and state the real cost/benefit tradeoff between them.
- Explain why these principles are developed in the abstract here, before being connected to TCP's actual concrete mechanism in the next several concepts.

## Context & Motivation

The previous concept established that TCP promises reliable, in-order delivery, on top of a network layer that promises neither. This concept develops, from first principles, how that promise is actually kept — not yet in TCP's specific concrete form (that comes next), but as a set of general techniques that apply to reliable data transfer over *any* unreliable channel, techniques Kurose & Ross develop incrementally as a sequence of protocols of increasing sophistication. Understanding the general problem first, before TCP's specific implementation, makes clear which parts of TCP's design are inevitable consequences of the reliability problem itself, and which are TCP-specific engineering choices.

## Core Theory

### The basic building blocks

Three mechanisms, working together, are what make reliable delivery possible over an unreliable channel:

1. **Acknowledgments (ACKs).** The receiver sends a message back to the sender confirming that specific data was received correctly. Without some form of feedback, the sender has no way to know whether anything it sent actually arrived.
2. **Sequence numbers.** Each unit of data is tagged with a number identifying its position in the overall stream. Sequence numbers let the receiver detect duplicates (if an ACK is lost and the sender retransmits, the receiver can recognize the retransmission by its sequence number) and let the receiver reorder data that arrives out of sequence.
3. **Timers.** The sender starts a timer when it sends data; if no acknowledgment arrives before the timer expires, the sender assumes the data (or its acknowledgment) was lost, and retransmits. Without a timer, a sender waiting for an ACK that will genuinely never arrive (because the original data was lost) would simply wait forever.

### Stop-and-wait: the simplest, but too slow

The simplest reliable protocol sends one packet, waits for its acknowledgment, and only then sends the next packet. This works correctly, but wastes an enormous amount of potential throughput on any link with significant round-trip time: the sender is idle, waiting, for almost the entire round-trip time after every single packet, transmitting for only a tiny fraction of the available time. On a link with a large bandwidth-delay product (the product of the link's rate and its round-trip propagation delay — already introduced conceptually when delay was covered), stop-and-wait can leave the vast majority of the link's actual capacity completely unused.

### Pipelining: sending multiple packets before waiting

The fix is pipelining: allowing multiple packets to be in flight — sent but not yet acknowledged — simultaneously, rather than waiting for each one's acknowledgment before sending the next. This keeps the link busy transmitting new data during the round-trip time that would otherwise be spent idle, waiting. Pipelining, however, immediately raises a new question that stop-and-wait never had to answer: what should the receiver do if packet 3 is lost but packets 4 and 5, sent afterward, arrive successfully? Two real, different answers to this question define two named protocol families.

### Go-Back-N

In Go-Back-N, the receiver only accepts packets in order — the receiver discards any packet that arrives out of order (even if it arrived correctly) and only acknowledges the highest in-order sequence number it has received so far. If packet 3 is lost, packets 4 and 5, even though they arrived correctly, are discarded by the receiver, because the receiver is only willing to deliver data to the application in strict sequence. When the sender's timer for packet 3 expires, it retransmits not just packet 3 but every packet from 3 onward — hence "go back N" — since the sender cannot be sure the receiver kept any of them. This is simple for the receiver (no buffering of out-of-order data needed) at the cost of potentially significant wasted retransmission, especially with a large pipeline and a single early loss.

### Selective Repeat

In Selective Repeat, the receiver buffers out-of-order packets that arrive correctly rather than discarding them, and individually acknowledges each correctly-received packet. If packet 3 is lost but packets 4 and 5 arrive successfully, the receiver buffers 4 and 5 and acknowledges them individually; when the sender retransmits only packet 3 (having detected specifically that packet 3's acknowledgment never arrived), the receiver can then deliver 3, 4, and 5 to the application in order, without needing 4 and 5 to be resent. This is more efficient in terms of retransmission (only the actually-lost packet is resent) at the cost of a more complex receiver, which must buffer and manage potentially several out-of-order packets simultaneously.

## Worked Examples

### Example 1: Stop-and-wait's wasted capacity, with real numbers

A link has a transmission rate of 1 Gbps and a round-trip time of 30 ms. A stop-and-wait sender transmits a 1,000-byte (8,000-bit) packet, then waits for its acknowledgment before sending the next.

```text
Transmission time for one packet = 8,000 bits / 1,000,000,000 bits/sec
                                  = 0.000008 seconds = 8 microseconds

Total time per packet (transmit + wait for ACK) ≈ 8 microseconds
                                                    + 30 milliseconds
                                                  ≈ 30.008 milliseconds

Utilization = transmission time / total time
            = 8 microseconds / 30,008 microseconds
            ≈ 0.00027, or about 0.027%
```

Stop-and-wait uses roughly 0.027% of this link's actual capacity — the other 99.97% of the time, the link sits idle while the sender waits for an acknowledgment that takes 30 ms round-trip to arrive. This is the concrete, numeric justification for pipelining: without it, a fast link with meaningful round-trip delay is almost entirely wasted.

### Example 2: Go-Back-N vs. Selective Repeat when packet 3 is lost

Sender transmits packets 1 through 5 in a pipeline; packet 3 is lost in transit, packets 1, 2, 4, and 5 arrive correctly.

```text
Go-Back-N:
  Receiver accepts 1, 2 (in order). Packet 3 never arrives. Packets 4
  and 5 arrive but are DISCARDED (out of order — receiver is waiting
  for 3). Sender's timer for packet 3 expires; sender retransmits
  packets 3, 4, AND 5 (everything from the lost packet onward).
  Total retransmitted: 3 packets (3, 4, 5), even though 4 and 5 had
  already arrived successfully once.

Selective Repeat:
  Receiver accepts 1, 2 (in order), and separately BUFFERS 4 and 5
  (out of order but correctly received), sending individual ACKs for
  each. Sender's timer for packet 3 expires; sender retransmits ONLY
  packet 3. Receiver now has 3 (just arrived), 4, and 5 (already
  buffered) and delivers all three, in order, to the application.
  Total retransmitted: 1 packet (just 3).
```

The same single lost packet costs 3 retransmissions under Go-Back-N but only 1 under Selective Repeat — a real, quantifiable difference in retransmission efficiency, at the cost of Selective Repeat's more complex receiver-side buffering logic.

### Example 3: Why a timer alone (without sequence numbers) is not enough

Suppose a protocol used only timers and acknowledgments, with no sequence numbers. A sender transmits packet A, and its ACK is delayed (not lost — just slow) past the timer's expiration. The sender, having received no ACK in time, retransmits A. Now suppose the original ACK for A finally arrives, followed shortly by the ACK for the retransmitted copy of A. Without a sequence number distinguishing "this is packet A" from "this is a duplicate", the receiver has no way to recognize that it received A twice, and — depending on what the protocol does with a "second" arrival of what it thinks is new data — could deliver A's payload to the application twice. Sequence numbers are what let the receiver recognize a retransmission as a duplicate of something already received, rather than genuinely new data.

## Common Misconceptions & Pitfalls

- **"Pipelining means giving up reliability for speed."** Pipelining changes how packets are transmitted (multiple in flight at once) but not whether reliability is achieved — Go-Back-N and Selective Repeat are both fully reliable protocols; they differ only in how efficiently they recover from loss, not in whether they ultimately guarantee delivery.
- **"Go-Back-N is simply a worse protocol than Selective Repeat in every way."** Go-Back-N's simplicity (no out-of-order buffering needed at the receiver) is a real, legitimate engineering advantage in contexts where implementation simplicity matters more than minimizing retransmission overhead — the tradeoff is genuine, not one-sided.
- **"A timer expiring always means the original data was lost."** A timer expiring means no acknowledgment arrived in time — this could mean the original data was lost, or that the data arrived fine but its acknowledgment was lost or simply delayed past the timeout. The sender cannot distinguish these cases from the timeout alone, which is exactly why sequence numbers are needed to correctly handle a possible duplicate delivery.
- **"These principles are TCP-specific."** They are general reliable-data-transfer principles that apply to any protocol built over an unreliable channel — TCP is one concrete, real-world instantiation of them (developed in the next several concepts), but the same building blocks (ACKs, sequence numbers, timers, pipelining, and a choice between Go-Back-N-style and Selective-Repeat-style loss recovery) recur in other reliable protocols outside networking entirely.

## Summary

Reliable data transfer over an unreliable channel is built from three basic tools: acknowledgments (feedback that data arrived), sequence numbers (distinguishing new data from retransmitted duplicates, and enabling reordering), and timers (detecting an ACK that never arrives, however that happened). Stop-and-wait, the simplest correct protocol, wastes an enormous fraction of a link's capacity on any connection with meaningful round-trip delay, which motivates pipelining — allowing multiple unacknowledged packets in flight simultaneously. Pipelining raises the question of what a receiver does with out-of-order arrivals after a loss: Go-Back-N discards anything out of order and retransmits everything from the lost packet onward (simple receiver, more retransmission); Selective Repeat buffers out-of-order arrivals and retransmits only the specific lost packet (more retransmission-efficient, more complex receiver). These are general principles, developed independent of any specific protocol — the next concept connects them directly to TCP's actual, concrete mechanism.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's incremental development of reliable data transfer protocols (rdt1.0 through rdt3.0, then pipelining, Go-Back-N, and Selective Repeat).
