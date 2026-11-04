---
title: "CORFU: A Shared Log Design for Flash Clusters"
summary: CORFU organizes a cluster of flash units as one shared log that clients read and append to directly, using a sequencer to hand out positions, client-driven chain replication to write them and sealed projections to survive failures.
researchArea: Distributed Systems
keywords: shared log, flash storage, state machine replication, chain replication, sequencer, reconfiguration, strong consistency
version: 1.0
updatedAt: 2026-11-03
---

## Overview

A shared log gives a distributed system one total order of events that every client can read and extend. This paper from Microsoft Research Silicon Valley and UC San Diego argues that flash makes the idea practical at data center scale, because the body of the log can serve fast, contention-free random reads while the tail takes fast sequential writes.

Partitioned stores spread data over many independent logs, so strong operations stay inside one partition. A log on one replicated server keeps the total order, but its append rate stops at that server's bandwidth. CORFU maps each log position to flash pages on different units and leaves the mapping and the writing to clients, so the design "decouples ordering from I/O". The paper relates this to [Paxos](/papers/paxos-made-simple): each replica chain acts as a consensus engine, and CORFU "scales SMR throughput by partitioning over time, not space".

Worth knowing first: replicated state machines, chain replication, view changes, and flash itself, where each erase wears the medium.

## Contribution

- **Projections.** Each client holds a read-only map that assigns ranges of the log to extents on flash units, by default round-robin.
- **An off-path sequencer.** A networked counter hands out log positions as tokens, so appends run as fast as tokens are issued, not as fast as any one unit writes. The paper calls it "merely an optimization", not required for safety or progress.
- **Client-driven chain replication.** Clients write replicas in a fixed order on write-once pages, so one of two contending writers gets an error at the first unit. A write counts only when the last unit has it, which tolerates f failures with f + 1 replicas.
- **Hole filling.** When a client crashes holding a token, others complete its append or mark the position as junk.
- **Reconfiguration.** Patterned after Vertical Paxos: a client seals the current epoch on the affected units, then writes the new projection to the next slot of an auxiliary, which only one proposer can win.
- **A narrow contract for flash units.** Write-once pages, a seal command and an infinite address space backed by a hash map. All CORFU functionality runs on clients.

## Methodology

The main deployment has 32 Intel X25-V drives on 16 servers in two racks, plus 44 client processes on 22 machines, all on 1 Gbps links. Appends are mirrored across racks and reads go to the local replica.

Throughput runs emulate SSD writes to avoid burning out the drives; reads come from real SSDs. A separate prototype, an FPGA with two SSDs acting as a pair of flash units, is accessed by a single client. Reconfiguration runs seal all drives, as an upper bound, and use a networked file share as the auxiliary.

## Findings

These are the authors' reported results.

- Read and append throughput grow proportionally with the number of drives. The cluster reaches 400K 4KB reads per second, and appends stop at around 180K per second, the limit of the user-space sequencer and somewhat below the 200K of the abstract.
- On the FPGA unit, reads take under 0.5 ms, appends finish within 750 microseconds and fills within 650 microseconds. The unit draws around 15 W, against 250 W for one server.
- On 32 drives, median sealing takes around 5 ms and the auxiliary write 25 ms more.
- CORFU-Store, a key-value store, runs 40K 10-key multi-gets and 20K 10-key multi-puts per second with 4KB values. Small multi-puts are limited by its map-service and, beyond 4 keys, by the log.
- CORFU-SMR, a state machine replication library, executes 70K 512-byte commands per second with 10 replicas. With more replicas, clients no longer keep up with the log.
- At these rates CORFU can wear out 1 TB of MLC flash in around 4 months, which the authors consider acceptable given a $3K cluster of drives.

## Critical Analysis

The architecture is the lasting result: separating ordering from I/O moves the append limit away from storage bandwidth. The headline numbers need more care.

Limits the paper states itself:

- **Contention shrinks but remains.** A slow client racing a hole-filler is two writers on one position, so the sequencer "does not eliminate it entirely".
- **Playback is expensive.** N replicas at T commands per second cost N * T log reads, and CORFU-SMR stops at the clients, not at the log.

Points that follow from reading the evaluation:

- **Appends at 180K per second never reached flash.** Writes were emulated, so that figure tests protocol, network and sequencer, not durable flash at that rate.
- **30 ms is not the outage.** Sealing and the auxiliary write start after detection. In the failure run the appending client first waits a 1-second timeout, and the time to rebuild a replacement replica is not reported.
- **Scale and efficiency were not shown together.** Cluster numbers come from server-attached SSDs, power and latency numbers from one FPGA unit. The conclusion speaks of flash chips attached directly to the network, while the prototype puts SATA SSDs behind an FPGA.
- **Comparisons are argued, not run.** No experiment tests CORFU against a Paxos implementation, a server-hosted PCI-e drive or the Hyder log design.
- **One figure disagrees with the paper's own formula.** A k-key multi-put costs k + 1 appends, so 10 keys at 180K appends per second gives about 16K, below the 20K in the introduction. Figure 9 stops at 8 keys.
- **Failure handling is only partly exercised.** The evaluated auxiliary is a file share, and no run measures throughput with crashing clients, although the authors call holes the most common failure mode.

The follow-up paper, [Tango](/papers/tango-distributed-data-structures-over-a-shared-log), reports a rebuilt sequencer at around 570K requests per second (the sequencer alone), which suggests that the 180K ceiling came from the implementation.

## Further Research

- Ways to play the log without every replica reading every entry, since that is where CORFU-SMR stopped scaling.
- How far one sequencer can go, and what should replace it when it saturates.
- Cluster-scale evaluation of network-attached units, with sustained durable appends and measured wear.
- Throughput under realistic rates of crashing and slow clients, including how holes are detected.
