---
title: "Efficient IO with io_uring"
summary: Axboe's technical note introduces io_uring, a Linux I/O interface built on two rings shared with the kernel, one for submissions and one for completions, so requests and results cross without copies and with few system calls.
researchArea: Operating Systems
keywords: io_uring, asynchronous I/O, shared ring buffers, Linux kernel, submission queue, completion queue, kernel polling, liburing
version: 1.0
updatedAt: 2026-11-19
---

## Overview

This is not a conference or journal paper. It is a technical note on the author's site (kernel.dk), shown in the PDF as "Version: 0.4, 2019-10-15". The PDF carries no author line; the attribution to Jens Axboe rests on the site, the first-person text and the `axboe@kernel.dk` address in a reference. The note was first posted in April 2019, and a follow-up from the same site says the introductory document was "updated a few times". The note is a tutorial, not a measurement study, and says it will not repeat the man pages.

Linux offers many file I/O calls, but the synchronous family (`read`, `write`, `pread`, `pwrite`, `preadv`, `pwritev`, `preadv2`, `pwritev2`) returns only when the data is ready. POSIX `aio_read` and `aio_write` are, in the author's words, usually lackluster with poor performance, and the native Linux `aio` (`io_setup`, `io_submit`, `io_getevents`) has three limits. It is async only for `O_DIRECT`, whose cache bypass and size and alignment rules rule it out for most uses. Even then submission can block (for metadata, or when the device's fixed request slots are taken), so applications still offload it. And each submission copies 64 + 8 bytes and each completion 32, 104 bytes for supposedly zero-copy I/O, with at least two system calls per I/O, "a serious slowdown" after Spectre and Meltdown.

The catalog's kernel-bypass papers attack the same cost from another side: [Arrakis](/papers/arrakis-operating-system-is-the-control-plane), [IX](/papers/ix-protected-dataplane-operating-system) and [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) take the kernel off the data path, while io_uring keeps the kernel and makes crossing it cheap. The note also speaks to [Eliminating Receive Livelock](/papers/eliminating-receive-livelock-in-an-interrupt-driven-kernel), because its polling modes trade interrupts for polling at high rates.

Worth knowing first: single-producer single-consumer ring buffers, memory barriers, `mmap` of shared memory, and `O_DIRECT` versus buffered I/O.

## Contribution

- **Why a new interface.** The author first tried to extend `aio`, found the result complex and fixing only one flaw, and started from scratch. Goals, in rising importance: easy to use and hard to misuse, extendable beyond block I/O, feature rich (no private I/O thread pools), efficient, scalable.
- **Two shared rings.** A submission queue (SQ), where the application produces and the kernel consumes, and a completion queue (CQ), where the roles reverse. Sharing removes copies and the need for shared locks, using memory ordering instead of system calls.
- **Entries.** A completion queue event (CQE) holds `user_data`, `res` and `flags`. A submission queue entry (SQE) is 64 bytes: `opcode`, `flags`, `ioprio`, `fd`, `off`, `addr`, `len`, an opcode-specific union, `user_data` and `buf_index`. The kernel does not touch `user_data`, which is copied to the CQE, commonly as the request's pointer. The SQ ring holds indexes into a separate SQE array.
- **Three system calls.** `io_uring_setup` returns a file descriptor and offsets for `mmap` of the SQ ring, CQ ring and SQE array. `io_uring_enter` submits and, in the same call, waits for completions. `io_uring_register` pre-registers files and buffers.
- **Opt-in features.** Linked and drained SQEs, timeouts, fixed files and buffers, polled I/O (`IORING_SETUP_IOPOLL`) and kernel-side submission polling (`IORING_SETUP_SQPOLL`), plus the `liburing` helper library.

## Methodology

There is no experimental method in the usual sense. The note explains the design with struct definitions and C fragments, covers memory ordering, shows `liburing` code, and ends with a short performance section that refers to a patch-series posting ([1] in the text) for details. It names the `fio` `io_uring` engine and the `t/io_uring.c` benchmark, a random-read tool, as examples to study. The performance figures are quoted in prose: the PDF has no table or figure, and does not give the hardware or the workload beyond "my test box", "my laptop" and random reads of the block device or a file.

## Findings

Mechanics the text states:

- **Rings.** Counters are free-running 32-bit integers that wrap, so the whole ring is usable with no "full" flag and its size must be a power of 2. `entries` is a power of 2 from 1 to 4096, and the CQ ring is twice the SQ ring by default. An SQE can be reused once the kernel has consumed it, so pending requests can exceed the SQ size, and the application must avoid overflowing the CQ ring.
- **Order.** Completions can arrive in any order. `IOSQE_IO_DRAIN` stalls the whole SQ until earlier requests finish. `IOSQE_IO_LINK` makes the next SQE start only after the previous one fully succeeds; an error or short read or write cancels the rest with `-ECANCELED`. Chains of any length run independently of one another.
- **Registered resources.** `IORING_REGISTER_FILES` avoids taking and dropping an atomic file reference per request. `IORING_REGISTER_BUFFERS` maps pages once for `O_DIRECT`, used with `IORING_OP_READ_FIXED` and `IORING_OP_WRITE_FIXED`.
- **Polling.** With `IOPOLL`, completions are found by calling `io_uring_enter` with `IORING_ENTER_GETEVENTS`, only read and write opcodes are legal (others give `-EINVAL`), and the CQ tail alone no longer signals completion. With `SQPOLL`, a kernel thread notices new SQEs with no `io_uring_enter` call; it sleeps after an idle period (1 second by default), sets `IORING_SQ_NEED_WAKEUP`, and the application must then wake it. `SQPOLL` is privileged (`-EPERM` otherwise).
- **Network.** Sockets work without special care and the interface is meant to cover networking, but the note describes no network opcodes. Its only network hint is `msg_flags` in the SQE union.

Numbers the text gives, all in prose (no chart reading was needed):

- Random 4 KB reads: 1.7M IOPS with polling, against a cliff at 608K for `aio`. Without polling io_uring drives about 1.2M IOPS, about twice `aio`'s for the same workload (the author calls the polled comparison unfair, since `aio` cannot poll). A note says later block-layer work moved peak per-core performance to about 1700K, "not 1620K".
- The no-op command: 12M messages per second on a laptop, 20M on the test box, bound mostly by system calls.
- Buffered I/O: the note makes no number claim. It argues that data already in the page cache is served inline, so a completion is already waiting in the CQ ring when submission returns, and it is as efficient as the regular synchronous calls.

## Critical Analysis

The note is the author's own account of his design, not a peer-reviewed study.

- **No latency, no tables.** Despite the performance section, the text has no latency numbers, no `fio` job file, no hardware description and no comparison for buffered or network I/O. It refers to "the numbers in the section above" that the PDF does not contain. Treat 1.7M, 608K, 1.2M and 12M to 20M as the author's reported figures, not reproducible results.
- **The comparison to `aio` is partial.** The author states the polling comparison is unfair; the no-polling 2x is the better figure, and it is still one test box with one workload.
- **Security is not discussed.** The only security-adjacent statement is that `SQPOLL` needs privileges. Sharing memory with the kernel, and the number of opcodes the kernel must handle, are not examined.
- **The page-cache claim has no measurement.** The text argues inline service makes io_uring as efficient as synchronous calls for cached data and a gain over a thread pool, with no figure.
- **A snapshot.** The text still says a kernel with the interface "is in the -rc stages", although its version line is dated October 2019 (the follow-up note says v5.1 had shipped). It also predates later growth: the follow-up note from the same site (which I read) says socket I/O was at first only `readv` and `writev`, and adds `sendmsg`, `recvmsg` and `accept`.

Later literature, not part of the 2019 note. The Google Security Blog post "Learnings from kCTF VRP's 42 Linux kernel exploits submissions" (Tamas Koczka, June 2023), which I read, reports that 60% of the kCTF submissions in the past year exploited io_uring, and that Google disabled it on ChromeOS and on production servers, blocks it for Android apps with seccomp-bpf, and was investigating disabling it by default on GKE Autopilot. That is a vendor's account, not a paper. I did not read the XRP paper, the Demikernel text on io_uring or any container runtime policy, so I make no claim about them here. The catalog notes for [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs) and [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) mention io_uring only as future work or a proposal.

## Further Research

- Which of the interface's costs (system calls, copies, file references, page mapping, interrupts) matters at a given device latency, measured on public hardware.
- How io_uring compares with a kernel-bypass stack such as [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) or [IX](/papers/ix-protected-dataplane-operating-system) for networking, with the same workload.
- The page-cache path against thread pools, which also touches page-cache policy work like [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf).
- The attack surface of shared rings and a growing opcode list, and sandboxing it, from sources beyond the one blog post cited here.
