---
title: "Xkernel: Principled Performance Tunability of Operating System Kernels"
summary: Xkernel makes the hard-coded performance constants of a running Linux kernel changeable by eBPF policies in milliseconds, by synthesizing small state-update snippets where each constant enters machine state and by applying an update only when no thread still holds effects of the old value.
researchArea: Operating Systems
keywords: kernel tuning, perf-const, scoped indirect execution, ebpf, kprobe, live patching, side-effect safety
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Linux is full of numeric constants that shape performance: thresholds, intervals, batch sizes and scaling factors, written as macros, literals and static integers. The authors call them perf-consts. Their values were often picked by rule of thumb on the hardware of the day, and once the kernel is compiled they cannot change. The usual escapes both fall short. Turning a constant into a sysctl or sysfs knob needs a source change for each one, and live patching needs a rebuild that takes minutes.

This OSDI 2026 paper (the 20th edition, held in Seattle), from Tsinghua University, Microsoft Research and the University of Illinois Urbana-Champaign, argues for principled OS performance tunability: safe, fast and programmable updates of any perf-const in a deployed kernel, with no recompilation and no reboot.

The key terms are Scoped Indirect Execution (SIE), the mechanism; critical span (CS) and safe span (SS), the two binary regions SIE reasons about; Xk-tune, a policy program written in eBPF; and Xkernel, the Linux implementation.

Worth knowing first: kprobes and eBPF, how kernel live patching (kpatch, KLP) swaps whole functions, and the basic idea of symbolic execution. For another way to change kernel policy without a reboot, see [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), which delegates scheduling decisions to userspace agents through a dedicated kernel interface, while Xkernel targets constants in any subsystem. Xkernel's related work cites sched_ext, Syrup and PlugSched on scheduling, not ghOSt.

## Contribution

- **A goal with five requirements.** Transparent in-situ tuning on deployed kernels, programmable policies at flexible granularity (a cgroup, a device, a flow), coverage of any perf-const, millisecond-scale updates with low overhead, and safety while tuning.
- **Critical span.** It is the binary region where a constant first enters registers or memory. Xkernel rebuilds the kernel with another value and diffs the binaries to find seed instructions, then runs symbolic execution to get a state expression that holds regardless of compiler tricks such as folding or strength reduction. A linear fit over extra builds maps the transformed value back to the source value.
- **Indirections instead of patches.** Xkernel does not rewrite instructions. It synthesizes `{location, update}` pairs: JIT-compiled code reached through a kprobe that overwrites the affected state as if the new value had been used. If the span overwrites that state, the update runs inverse logic when the operation is reversible, and otherwise captures the original value before and restores it after. The kernel binary stays untouched.
- **Safe span and side-effect safety.** Forward thin slicing from the critical span finds every instruction that consumes data derived from the constant. An update is applied only when no thread is inside the safe span, which goes beyond the per-function version atomicity of live patching. For global consistency, a self-convergent transition calls stop_machine once to initialize reference counts, and entry and exit kprobes then keep them current until they reach zero. A configurable timeout reports failure.
- **Programmable policy plane.** An Xk-tune uses `xk_set` and `xk_transition_done`, and its writes to kernel state go through one kfunc, `sie_write_kernel`. Several perf-consts can be bundled into an atomic transaction, and the tools are xk-build, xk-gen, xk-load and xk-unload.

## Methodology

The runtime is about 1.7K lines of kernel C. The toolchain is about 11K lines of Python, of which about 5K do the span analysis, plus an LLVM pass for the safe span. To keep kprobe cost low, Xkernel exploits boosting and jump optimization, and adds an optimization for constants used in conditional jumps.

The evaluation machine, from CloudLab, has a 28-core Xeon Gold 5512U, 128 GB of RAM and two NVMe SSDs, and some case studies used other hardware, such as a SAS HDD and a 4-node 25 Gbps cluster. Five case studies cover the block layer, softirq handling, slab reclamation, page migration and TCP CUBIC's HyStart constants. Generality was tested on 140 perf-consts from four subsystems. Overhead was measured with microbenchmarks and with Redis under YCSB and Facebook ETC workloads, and transition time was compared with Linux KLP on a TCP backlog constant with 128 iperf3 flows. A pilot study examined 702 sysctl knobs on Ubuntu 24.04.

## Findings

These are the authors' reported results.

- **Tuning potential.** Raising BLK_MAX_REQUEST_COUNT from 32 to 128 on an HDD gives 7× (read) and 54× (write) for a shuffled sequential FIO workload. Lowering it to 1 for RocksDB on NVMe gives 1.2× throughput and P50 and P75 latency 1.37× and 1.41× lower. In NGINX, a selective CUBIC policy cuts flow completion time by 81% at P99.99 for long-RTT flows and keeps parity for short ones.
- **Coverage.** Xkernel supports 139 of 140 constants (99.3%). The failure is a btrfs constant, because the enclosing symbol has several definitions and kprobe registration is rejected. The 140 constants have 367 critical spans, 48% of constants have one and 86% have fewer than five. In 82 spans the transformed value differs from the source value, all were recovered, and three needed the dual-location form.
- **Span size.** The 300 safe spans have a median of 10 instructions, and the largest has about 8K.
- **Per-trigger cost.** A baseline `vfs_write` path takes 946 cycles, and full Xkernel adds 25% with jump-optimized probes (84.2% of spans). With INT3 probes it adds 196%.
- **Trigger rate and probe count.** Slowdown is 15% for operations that do no work, 5% with 5 µs of work, 2% with 10 µs and under 1% at 20 µs. In Redis, 32 probes cost at most 4% throughput, and 128 probes cost 7% to 14%.
- **Update and transition time.** Loading a policy takes 2.7 ms against 24 ms for KLP, which also needs 7 minutes of patch generation. Median end-to-end transition is 2.8 ms against 30.4 ms. The worst load shown is 542 ms (15 safe spans), per-thread side-effect transitions stay under 10 ms, and global consistency reaches 144 ms with 16 threads.
- **Offline cost.** It averages 18 minutes per constant, and for N constants the scope table needs 2N rebuilds.
- **sysctl pilot.** Of 145 performance knobs, 96 have not changed since 2005, 20 needed bug fixes after conversion (12 years on average), and 43 more look buggy.

## Critical Analysis

The idea is neat: constants have structure that arbitrary code lacks, and the paper uses it well. It is candid about scope, and concedes several limits.

- **Layout-changing constants are out.** Array sizes and struct padding are rejected, as are constants removed by dead-code elimination.
- **Safety rests mainly on data dependencies.** Safe spans are thin slices. The authors say this suffices for "most" perf-consts, without a count, and leave control-flow analysis as a pluggable extension.
- **Offline results are tied to one build.** The scope table depends on exact source, compiler version and configuration, and must be regenerated after a kernel, module or driver update.
- **Policy is out of scope.** The paper does not choose values, sets no bounds on them, and reports a transition as failed if the code path never runs or a thread stays inside a span.

The following points are a reading of the evidence, not claims of the paper.

- **The case studies show potential, not a tuner.** Each result comes from a manual sweep or a hand-written policy on one workload and device, such as a single SSD for the 1.2× RocksDB gain. None compares with the closest existing alternative (a source change that exposes the constant, or TCP-BPF for CUBIC), so the gain is over the default only.
- **Safety is argued, not tested.** The evaluation measures spans, overhead and transition time. I found no experiment where a naive update breaks and SIE does not, nor fault injection against a safe span. The text does not say how the 140 constants were chosen, or how many ran under a workload.
- **"Millisecond-scale" spans a wide range.** The median load is 2.7 ms, yet one case takes 542 ms. The KLP comparison uses one constant and leaves out 7 minutes of patch generation, which favors KLP, so the roughly 10× gap is conservative.
- **The probes stay.** The indirection runs on every execution of the span while the Xk-tune is loaded, so the 25% to 196% per-trigger cost (measured on a deliberately short kernel path) is paid continuously. The Redis test goes up to 128 probes, but the paper does not say how many a real deployment would need.
- **Security and bookkeeping are left open.** A kfunc lets eBPF write kernel state, but I found no discussion of who may load an Xk-tune. Two numbers also differ: jump-optimized probes are 84.2% in §6.2 and 88.3% in Appendix B, and 145 and 149 sysctl knobs are checked. The text gives KLP and Xkernel medians in swapped order, but the figure labels settle it.

## Further Research

- Policies that choose values: LLM agents or ML tuners driving Xk-tunes, which the authors invite, plus safe per-constant bounds taken from RFCs or device specs.
- Control-flow-aware safe spans, support for layout-changing constants, and lower offline cost (2N rebuilds, 18 minutes per constant), for example reusing analysis across kernel versions.
- Many tuned constants at once, including their interaction with existing sysctl knobs and with other eBPF-based kernel policies.
- Validation of the safety claim by fault injection or formal checks, and a head-to-head comparison with exposing the constant at the source level.
