---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the transport layer's job — process-to-process delivery — as distinct from the network layer's job — host-to-host delivery — and explain why both are needed.
- Explain multiplexing and demultiplexing via port numbers, and how a socket is identified by a combination of IP address and port.
- List UDP's service model (no reliability, no ordering, no congestion control) and explain why an application would deliberately choose it anyway.
- List TCP's service model (reliable, in-order, connection-oriented, congestion-controlled) and identify real applications that need each of those guarantees.
- Given a description of an application's requirements, justify a choice between UDP and TCP.

## Context & Motivation

The network layer, covered starting several concepts from now, gets a datagram from one host to another host — but a host runs many processes simultaneously (a browser, an email client, a game), and an arriving datagram needs to reach the correct one of them. This is the transport layer's first job: process-to-process delivery, extending the network layer's host-to-host delivery down to the granularity of an individual application. The transport layer's second job, at least for TCP, is far more involved: providing reliability, ordering, and congestion control on top of a network layer that guarantees none of these things — the network layer, as established when packet switching was introduced, makes only a best-effort delivery attempt, with no guarantee a packet arrives, arrives once, or arrives in the order it was sent. This concept introduces the two transport protocols this discipline builds out in full — UDP, which adds essentially nothing beyond process-to-process delivery, and TCP, whose reliability and congestion mechanisms occupy the next five concepts.

## Core Theory

### Process-to-process delivery: ports and sockets

Every transport-layer segment carries a source port number and a destination port number, in addition to whatever the network layer below supplies (source and destination IP addresses). A socket — the actual endpoint an application reads from and writes to — is identified by the combination of an IP address and a port number (for TCP, a full four-tuple of source IP, source port, destination IP, destination port identifies one specific connection). When a segment arrives at a host, the transport layer uses this addressing information to demultiplex it: deliver its payload to the correct socket, and therefore the correct process, among potentially many processes running on that host simultaneously. Multiplexing is the reverse operation at the sender: gathering data from multiple sockets and passing each, tagged with its own port information, down to the network layer.

### UDP: the bare minimum

UDP (User Datagram Protocol) provides essentially nothing beyond multiplexing/demultiplexing (via ports) and a basic, optional checksum for error detection. It provides no reliability (a UDP datagram can be lost with no notification to either sender or receiver), no ordering guarantee (datagrams can arrive out of the order they were sent), no connection setup (a UDP sender can simply start sending datagrams to a destination with no handshake beforehand), and no congestion control (a UDP sender can transmit at whatever rate the application chooses, without backing off in response to network congestion). This sounds, at first, like a worse protocol than TCP in every respect — but it is a real, deliberate design point applications genuinely choose.

### TCP: reliability, ordering, and congestion control

TCP (Transmission Control Protocol) provides reliable, in-order, byte-stream delivery between two processes: no byte is lost (or, if lost, it is retransmitted until it arrives), no byte arrives out of the order it was sent (or, if it does, it is buffered and reordered before being delivered to the application), and TCP additionally provides congestion control, actively reducing its own sending rate in response to detected network congestion. TCP is also connection-oriented: before any application data is exchanged, a three-way handshake (covered in the next concept) establishes a connection between the two endpoints, and the connection is explicitly torn down when communication is finished.

### Why an application would choose UDP anyway

Real-time applications — voice calls, live video, some multiplayer games — often prefer UDP specifically because TCP's reliability mechanism, retransmission, is fundamentally at odds with real-time delivery: if a voice packet is lost, retransmitting it and waiting for it to arrive is often worse for the user experience than simply skipping the lost audio and moving on, since a retransmitted-but-late voice packet is nearly useless once the conversation has moved past that moment. Similarly, TCP's congestion control can throttle a sender's rate unpredictably in response to network conditions, which is undesirable for an application that needs a steady, predictable rate more than it needs perfect reliability. DNS (already covered) also typically uses UDP, for a different reason: the overhead of a full TCP connection setup for a single small query-response exchange is considered unnecessary in the common case.

### Why most applications choose TCP

Applications where correctness matters more than a strict predictable rate — file transfer, email, most web traffic via HTTP — need every byte to arrive, arrive exactly once, and arrive in order; a web page with silently missing or scrambled bytes is simply broken, unlike a voice call that can tolerate an occasional dropped word. TCP's reliability and ordering guarantees are exactly what these applications need, and they are willing to accept TCP's variable delay (retransmission takes time) and congestion-responsive rate reduction as the cost of correctness.

## Worked Examples

### Example 1: Demultiplexing with a concrete four-tuple

A host is running a web server (listening on port 80) and simultaneously has an open connection to a DNS server (using port 53) from an earlier lookup. A segment arrives:

```text
Source IP: 203.0.113.5     Destination IP: this host's IP
Source port: 51222          Destination port: 80
```

The host's transport layer examines the destination port (80) and delivers this segment's payload to the process listening on port 80 — the web server — regardless of any other traffic simultaneously arriving for port 53. For TCP specifically, the full four-tuple (source IP, source port, destination IP, destination port) distinguishes this one connection from any other TCP connection the same web server might have open to different clients, or even multiple connections from the very same client IP address on different source ports.

### Example 2: Choosing UDP vs. TCP for three real applications

```text
Application            Choice   Why
----------------------  -------  ------------------------------------------
Live voice call         UDP      A late, retransmitted audio packet is
                                  nearly worthless — better to skip a lost
                                  packet and keep the conversation moving
                                  at a steady rate than to pause for
                                  retransmission.

File download           TCP      Every byte must arrive, correctly and in
                                  order — a corrupted or missing byte
                                  makes the downloaded file broken, not
                                  just imperfect.

DNS query               UDP      A single small request/response exchange;
                                  the overhead of TCP's connection setup
                                  is unnecessary for the common case of one
                                  query fitting in one small datagram.
```

### Example 3: What TCP's guarantee actually costs, concretely

Consider a TCP connection where packet 3 of 5 is lost in transit. TCP's reliability mechanism (developed in the concepts that follow) detects this loss and retransmits packet 3, and the receiving application does not see packet 4 or 5 until packet 3 has been successfully retransmitted and received — TCP buffers packets 4 and 5, withholding them from the application, specifically to preserve in-order delivery. A UDP-based application, receiving the equivalent five datagrams with the third one lost, would simply receive datagrams 1, 2, 4, 5 — out of order relative to datagram 3's absence, immediately, with no waiting — because UDP makes no promise to reorder or wait for anything.

## Common Misconceptions & Pitfalls

- **"UDP is simply an inferior, older version of TCP."** UDP is a deliberate design point for applications where TCP's reliability and ordering guarantees actively work against the application's real goals (steady real-time delivery over strict correctness) — it is not lesser, it is different, chosen for genuinely different requirements.
- **"A port number identifies a host."** A port number identifies a specific process (or, more precisely, a socket) on a host — an IP address identifies the host itself; the two together identify where, specifically, on that host a segment should be delivered.
- **"TCP guarantees a message arrives quickly."** TCP guarantees a message eventually arrives, correctly and in order — it makes no promise whatsoever about how quickly, and in fact can introduce significant delay when retransmission or congestion control kicks in, which is precisely why real-time applications often prefer UDP instead.
- **"The transport layer routes packets across the network."** Routing is entirely the network layer's job, covered starting several concepts later in this discipline; the transport layer's job is process-to-process delivery on top of whatever host-to-host delivery the network layer already provides — a genuinely different, higher-layer concern.

## Summary

The transport layer extends the network layer's host-to-host delivery down to process-to-process delivery, using port numbers to multiplex and demultiplex segments to the correct socket on a host. UDP provides essentially nothing beyond this addressing — no reliability, no ordering, no congestion control — and is deliberately chosen by real-time and low-overhead applications (voice, video, DNS) precisely because TCP's guarantees would work against their actual needs. TCP provides reliable, in-order, connection-oriented, congestion-controlled byte-stream delivery, at the cost of variable delay from retransmission and rate reduction, and is the right choice for applications where correctness matters more than strict timing (file transfer, email, most Web traffic). The next five concepts develop TCP's actual mechanisms — reliable data transfer, the handshake, retransmission and RTT estimation, flow control, and congestion control — each building directly on the service model established here.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of transport-layer multiplexing/demultiplexing and the UDP/TCP service models.
- [Stanford CS144 — Lecture Schedule ("Transport & reliability")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture introducing the transport layer's reliability problem immediately after the application layer.
