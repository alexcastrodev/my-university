---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define the link layer's job: moving a frame across exactly one physical link, one hop, as distinct from the network layer's multi-hop, end-to-end job.
- Define framing: how a receiver knows where one frame ends and the next begins in a continuous stream of transmitted bits.
- Explain error detection via a checksum, and why a checksum can detect many, but not guarantee detection of all, bit errors.
- Explain why error detection alone does not imply error correction, and why the link layer generally leaves correction to a higher layer (or simply discards a corrupted frame).
- Connect the link layer's per-hop scope back to the layered-stack picture established at the start of this discipline.

## Context & Motivation

Every concept so far in the Network Layer cluster concerned a datagram's journey across the entire network core, potentially many hops. The link layer, covered starting with this concept, operates one level below that: it is concerned with moving a single frame across exactly one physical link — one hop, between two directly-connected nodes — and has no notion at all of the datagram's ultimate, multi-hop destination; that is squarely the network layer's job, already covered, sitting one layer above. This concept covers the two most basic link-layer jobs: framing (marking where one unit of data begins and ends on a physical medium that, at the lowest level, is just a continuous stream of bits or signal) and error detection (recognizing when noise on that physical medium has corrupted some of those bits).

## Core Theory

### The link layer's scope: one hop only

A network-layer datagram, as it crosses the network core, is encapsulated inside a link-layer frame anew at every single hop — the frame used to cross the link from host A to router R1 is a completely separate frame from the one used to cross the link from R1 to router R2, even though the same network-layer datagram is carried inside both. The link layer's job is entirely local to one physical link at a time; it has no concept of the datagram's original source or ultimate destination beyond this one hop, and it does not persist any state about a datagram once it has been handed up to the network layer at the receiving end of that one hop.

### Framing

At the physical layer, data is nothing more than a continuous stream of electrical, optical, or radio signal — there is no inherent structure marking where one meaningful unit of data ends and the next begins. Framing is the link layer's job of imposing that structure: marking frame boundaries so a receiver can correctly identify where one frame's bits end and the next frame's bits begin, typically via special bit patterns at the start and/or end of a frame, or via a frame-length field within the frame's own header specifying exactly how many bits or bytes follow.

### Error detection via checksums

Physical media are imperfect — electrical noise, signal attenuation, interference can flip bits during transmission. A checksum (in practice, often a more robust cyclic redundancy check, or CRC) is computed by the sender over the frame's actual contents and included in the frame itself; the receiver recomputes the same checksum over the received bits and compares it to the one the sender included. If the two do not match, the receiver knows with certainty that some bit error occurred somewhere in the frame during transmission. If the two do match, the receiver has strong, though not absolute, confidence the frame arrived correctly — a checksum can, in principle, fail to detect certain unlucky combinations of bit errors that happen to leave the checksum unchanged, though a well-designed checksum (particularly CRC) makes this extremely unlikely for the kinds of error patterns real physical links actually produce.

### Detection without correction

Detecting that an error occurred is not the same as knowing what the original, uncorrupted data was — a basic checksum-based scheme tells the receiver only "something is wrong with this frame," not what the correct bits should have been. The typical response, at the link layer, to a detected error is simply to discard the corrupted frame entirely, relying on a higher layer (TCP's already-covered reliable-data-transfer mechanism, for instance) to notice the missing data and trigger retransmission from the original sender — the link layer generally does not attempt to correct errors itself, though more sophisticated forward-error-correction codes that can, within limits, reconstruct the correct data from a corrupted frame do exist and are used in some specific real physical media (wireless links being a common example, since wireless is particularly error-prone), a real technique this introductory concept only names rather than developing in depth.

## Worked Examples

### Example 1: A frame boundary marked by a length field

```text
Link-layer frame header (simplified):

[ Frame length: 1500 bytes ][ Destination MAC ][ Source MAC ][ ... payload ... ]
```

The receiver reads the frame-length field first, and then knows to read exactly 1,500 bytes of payload following the header before expecting the next frame's header to begin — the length field itself is what supplies the boundary information a continuous stream of raw bits does not inherently provide.

### Example 2: A checksum catching a bit error

A sender computes a simple checksum over a frame's data by summing all the bytes (a genuine simplification of a real CRC, used here purely to illustrate the mechanism):

```text
Original data bytes: [10, 20, 30]
Checksum sent: 10 + 20 + 30 = 60

During transmission, a bit flip corrupts the second byte: 20 → 21

Receiver recomputes: 10 + 21 + 30 = 61

Receiver compares: sent checksum (60) ≠ recomputed checksum (61)
→ Error detected. Frame is discarded.
```

The receiver correctly detects that something went wrong, even though it has no way, from the checksum mismatch alone, to know that specifically the second byte was the one corrupted, or what its original correct value (20) actually was.

### Example 3: A checksum that (in principle) misses an error

Continuing the simplified sum-based checksum from Example 2, suppose instead two bytes are corrupted in a way that cancels out in the sum:

```text
Original data bytes: [10, 20, 30]
Checksum sent: 60

Two bit errors during transmission: 20 → 19, and 30 → 31
(one byte decreased by 1, another increased by 1)

Receiver recomputes: 10 + 19 + 31 = 60

Receiver compares: sent checksum (60) = recomputed checksum (60)
→ NO error detected, even though the data was actually corrupted.
```

This illustrates concretely why a checksum provides strong, but not absolute, confidence — a sufficiently unlucky, specific combination of errors can, in principle, leave a simple checksum unchanged; real protocols use more sophisticated CRC schemes specifically designed to make this kind of undetected error extremely improbable for the error patterns real physical links actually produce, though never literally impossible in a mathematically absolute sense.

## Common Misconceptions & Pitfalls

- **"The link layer knows the datagram's final destination."** It does not — the link layer's job is scoped to exactly one hop; it hands a frame's payload up to the network layer at the receiving end of that one hop, and the network layer (already covered) is what actually reasons about the datagram's ultimate, multi-hop destination.
- **"A checksum match guarantees the data is correct."** It provides strong confidence, not an absolute guarantee — certain specific, unlucky combinations of bit errors can, in principle, leave even a real checksum unchanged, though well-designed checksums make this extremely unlikely in practice.
- **"Error detection and error correction are the same thing."** Detection tells a receiver only that something is wrong; correction requires additional information (forward error correction) to actually reconstruct the correct original data — a basic checksum-based scheme provides only detection, and the typical response to a detected error is simply to discard the frame and rely on a higher layer's retransmission.
- **"Framing is only necessary for old, low-level physical media."** Every physical medium — copper, fiber, radio — delivers, at its lowest level, a stream of signal with no inherent structure; framing is a genuinely universal link-layer requirement, not something modern high-speed media have made obsolete.

## Summary

The link layer's job is scoped to exactly one hop — moving a frame across one physical link between two directly-connected nodes — genuinely distinct from the network layer's multi-hop, end-to-end job already covered. Framing imposes structure on an otherwise-unstructured stream of physical-layer bits, marking where one frame ends and the next begins, typically via special bit patterns or a length field. Error detection, via a checksum (in practice, often a more robust CRC), lets a receiver recognize when transmission noise has corrupted a frame's bits, with strong but not absolute confidence; the typical response to a detected error is simply discarding the frame, relying on a higher layer's reliability mechanism (TCP's, already covered) to notice and trigger retransmission, since detection alone does not tell a receiver what the correct original data actually was. The next concept develops what happens when many nodes must share one physical medium simultaneously — the multiple-access problem, and Ethernet's real, deployed solution to it.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of link-layer framing and error-detection techniques.
- [Stanford CS144 — Lecture Schedule ("Physical and Link layers")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture covering the physical and link layers together.
