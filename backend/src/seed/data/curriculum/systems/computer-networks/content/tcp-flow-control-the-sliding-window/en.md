---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define flow control as protecting a slow receiver from a fast sender, distinct from congestion control's protection of the network itself.
- Explain the receive window field and how the receiver computes and advertises it based on its own buffer occupancy.
- Trace how a sender's allowed sending rate adjusts as the advertised receive window shrinks or grows.
- Explain the "zero window" case and how a sender learns when a previously-full receiver buffer has drained.
- State clearly why flow control and congestion control, despite both being called "windows," solve genuinely different problems and are computed independently.

## Context & Motivation

TCP's reliable data transfer, just covered, ensures that whatever bytes are sent eventually arrive correctly and in order — but it says nothing about how *fast* a sender is allowed to send them. Two entirely separate concerns govern sending rate, and this concept covers the first: flow control, which protects the receiving application from being overwhelmed by data faster than it can consume it. The second concern — congestion control, protecting the network's shared links from being overwhelmed — is developed in the next concept. Both are, mechanically, expressed as a "window" limiting how much unacknowledged data the sender may have in flight, and it is genuinely easy to conflate the two; this concept is deliberately narrow, covering flow control alone, specifically so the distinction is clear before congestion control introduces its own, differently-motivated window.

## Core Theory

### The problem flow control solves

A TCP receiver has a finite receive buffer: incoming data is placed there as it arrives, and removed as the receiving application reads it. If a sender transmits faster than the receiving application reads, the receive buffer can fill up completely — and any further arriving data, with nowhere to be stored, would have to be dropped, precisely the kind of loss reliable data transfer works hard to avoid causing in the first place. Flow control exists specifically to prevent this: it lets the sender know how much free buffer space the receiver currently has, so the sender never transmits more unacknowledged data than the receiver can actually hold.

### The receive window field

Every TCP segment sent by the receiver back to the sender includes a receive window field, computed as the receiver's current free buffer space: `RcvWindow = RcvBuffer - (LastByteReceived - LastByteRead)`, i.e., the buffer's total capacity minus however much data is currently sitting in it, received but not yet read by the application. The sender is required to keep the amount of unacknowledged, in-flight data at or below the most recently advertised receive window — the sender's actual "in flight" allowance shrinks and grows dynamically as the receiver's buffer fills and drains.

### The zero-window problem and probing

If the receiving application stops reading entirely (perhaps it's busy with something else, or momentarily stalled), the receive buffer can fill completely, and the receiver advertises a receive window of 0 — instructing the sender to stop sending any further data until the receiver has room again. This creates a subtle problem: once the buffer drains and room becomes available again, how does the sender find out, if it has stopped sending entirely and therefore has nothing to trigger a fresh ACK carrying an updated window? TCP solves this with a persistence mechanism: the sender periodically sends a small probe segment (carrying one byte of data) specifically to elicit a fresh ACK from the receiver, which will report a nonzero window once the buffer has actually drained — without probing, a zero window could otherwise leave a connection permanently stalled even after the receiver was ready to accept more data.

## Worked Examples

### Example 1: Computing the receive window as data arrives and is read

Receiver's total buffer capacity is 8,000 bytes. Currently, 3,000 bytes have been received but not yet read by the application.

```text
RcvWindow = RcvBuffer - (LastByteReceived - LastByteRead)
          = 8,000 - 3,000
          = 5,000 bytes
```

The receiver advertises a window of 5,000 bytes, telling the sender it may have up to 5,000 bytes of unacknowledged data in flight. If the application then reads 2,000 of the buffered bytes (freeing that space), the next ACK's advertised window grows to 7,000 bytes, even with no new data having arrived — the window reflects free space, which changes both when data arrives (shrinking it) and when the application reads (growing it).

### Example 2: The buffer filling completely — a zero window

Continuing the same scenario: the sender, seeing room, sends more data, and the receiving application stops reading (busy with other work). The buffer fills entirely:

```text
RcvWindow = 8,000 - 8,000 = 0
```

The receiver advertises a window of 0. The sender must now stop sending any new application data — sending more would risk data being dropped, since the receiver genuinely has nowhere to put it.

### Example 3: Recovering from a zero window via persistence

```text
1. Receiver advertises window = 0. Sender stops sending data.
2. Time passes. The receiving application resumes reading and drains
   3,000 bytes from the buffer. The receiver now genuinely has 3,000
   bytes of free space — but has no data of its own to send, so it has
   no natural reason to send a fresh segment reporting this.
3. Sender periodically sends a 1-byte probe segment specifically to
   elicit a response.
4. Receiver responds to the probe with an ACK carrying the CURRENT
   window value: 3,000 bytes (not the stale 0 from step 1).
5. Sender, now informed the window is nonzero again, resumes sending
   application data, up to the newly-advertised 3,000-byte limit.
```

Without this periodic probing, the connection could stall indefinitely even after the receiver was genuinely ready to accept more — the probe exists purely to force a fresh window update out of an otherwise-silent receiver.

## Common Misconceptions & Pitfalls

- **"Flow control and congestion control are the same mechanism."** Flow control protects the *receiver's buffer* from being overwhelmed by the sender; congestion control (the next concept) protects the *network's shared links* from being overwhelmed by all senders collectively — they are computed independently, using different information, and a sender's actual allowed rate is the minimum of both windows, not either one alone.
- **"A shrinking receive window means the network is congested."** A shrinking receive window reflects the *receiver's* buffer filling up (the receiving application reading slower than data arrives) — it says nothing about network conditions at all, which is exactly the distinction congestion control's separate window is needed to capture.
- **"A zero window means the connection has failed."** A zero window is a normal, expected, temporary condition when a receiver's buffer is genuinely full — the persistence/probing mechanism exists specifically to recover from it gracefully once the receiver has room again, not to signal an error.
- **"The sender can send as much data as it wants as long as it doesn't exceed the receive window."** The sender's actual allowed in-flight data is capped by the *smaller* of the receive window (this concept) and the congestion window (the next concept) — satisfying flow control alone is not sufficient if the congestion window is currently more restrictive.

## Summary

Flow control protects a TCP receiver's finite buffer from being overwhelmed by a faster sender: the receiver continuously advertises its current free buffer space as a receive window, and the sender is required to keep its in-flight, unacknowledged data at or below that advertised value. When the receiving application falls behind and the buffer fills entirely, the receiver advertises a window of 0, and a periodic persistence probe from the sender is what allows the connection to recover once the receiver eventually drains its buffer and has room again. Flow control is deliberately distinct from congestion control (covered next) — one protects the receiver, the other protects the network — and a sender's real, effective sending rate is governed by whichever of the two windows is currently smaller.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of TCP flow control, the receive window, and the zero-window persistence mechanism.
