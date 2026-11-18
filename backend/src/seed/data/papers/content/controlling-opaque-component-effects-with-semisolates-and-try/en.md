---
title: "Controlling Opaque-Component Effects with Semisolates and Try"
summary: Try runs any unmodified command in a semisolate, a partially isolated view of the current filesystem built from OverlayFS, user namespaces and optional system-call tracing, so its effects can be inspected, applied wholly or in part, discarded, stacked across runs or traced, and it does so without privileges, in any language and faster than a container.
researchArea: Operating Systems
keywords: effect control, semisolate, overlayfs, namespaces, dry run, dependency tracking, shell
version: 1.0
updatedAt: 2026-11-18
---

## Overview

Software is increasingly assembled from opaque components: commands, packages, scripts and, more and more, code suggested or run by AI agents. Running one has effects on its environment that cannot be predicted or easily undone. `npm install` changes many files, a `find -exec` suggested by an LLM can delete critical user files, and a third-party library such as node-ipc has shipped versions that modified system files. The tools at hand are coarse. Containers and virtual machines isolate everything, so the interesting effects stay inside and the component no longer sees the real environment. A built-in `--dry-run` flag exists only in some commands and each implements it differently. Language-level effect systems need the component to be written for them.

The authors, from Brown University with Stevens Institute of Technology, Columbia University and UCLA, propose the semisolate, an abstraction that executes a component in the current environment through a private view of it, and `try`, its implementation as an unprivileged, language-agnostic, higher-order command: `try cmd args` runs the command, collects its effects in a temporary directory and lets the caller decide what happens to them. The name joins semi- (partially) and isolate, since isolation is partial by design.

This OSDI 2026 paper won the Best Paper and Best Artifact awards. It follows five case studies that drive the design: reviewing risky LLM suggestions before applying them, tracking read-after-write dependencies between opaque commands for speculative parallel execution, containing third-party code such as malicious pre-commit hooks, a command-agnostic `--dry-run`, and mining partial specifications of commands from the order of their reads and writes.

Terms to keep apart: an effect is a change or access a component makes to its environment, mainly files here, a semisolate is the private view plus the collected effects, stacking means starting a command on top of effects that were collected but not yet applied, a whiteout is the marker OverlayFS leaves in the upper layer for a deleted path, and a negative dependency is a recorded access to a path that does not exist.

Worth knowing first: how OverlayFS merges an upper directory over lower ones with copy-up on write, what Linux user and mount namespaces give an unprivileged process, and what `strace` and seccomp-BPF filters do. Two sibling papers from the same group address the shell from other angles. [Ahead-of-Time Analysis of Shell Program Effects](/papers/ahead-of-time-analysis-of-shell-program-effects) predicts harmful effects before running by symbolic execution, and [RT: Regular Types for the Streaming Shell](/papers/rt-regular-types-for-the-streaming-shell) types the data flowing between commands.

## Contribution

- **Four requirements.** Effect introspection (see what a component did, in the environment it ran in), selective application (apply or roll back), effect stacking (run later commands as if earlier effects were applied, and roll back whole stacks) and further manipulation (partial application, recording for later, hiding parts of the environment). Streaming, configurable handlers and interactive-level overhead are desirable extras. Complete mediation against components that actively try to evade try is explicitly out of scope: the target is accidents, not adversaries.
- **Three stages.** Creation sets up the private view: mirror the filesystem, mirror it with subtrees hidden (`-i`, a regular expression), or start from the uncommitted state of a previous run (`-L`, which needs that run to have been stored with `-N`). Execution runs the component in the view, optionally blocking the network (`-x`) and tracing ordered filesystem accesses (`-t`). Conclusion applies (`-y`), discards (`-n`) or inspects effects one by one (`-e`) with filters (`-E`, `-I`), or stores them under a name.
- **Effect model.** An effect is a path (existing or not) with a type (read-only, write-only or read-write) and metadata on success and failure, and it covers the whole process subtree by default.
- **Implementation on Linux userspace.** An OverlayFS mount whose upper directory collects changes and whose lower directories are the real filesystem or earlier semisolates. Because OverlayFS cannot use `/` as a lower layer in this setup, `try` mounts one union per top-level directory, bind-mounts devices, and when submounts exist it flattens them with mergerfs. The component runs in new user, PID, mount and network namespaces, which give it the appearance of root without setuid. Tracing uses `strace` with a seccomp-BPF filter on path-taking calls such as `open`, `mkdir` and `unlink`, so reads and writes on open descriptors are not traced unless the user adds filters. Application walks the upper directory in preorder, handling regular files, directories (including opaque ones), symlinks and whiteouts, and uses `rename` when source and target share a filesystem.
- **Extras.** A `try-summarize` module that asks a language model for a plain-language summary of the effects and whether they touch sensitive directories, and `try-gidmapper` for directories owned by other groups. The system is open source (MIT).

## Methodology

For each use case the authors measure control (do all relevant effects get mediated), behavioral equivalence (same output, and an identical filesystem tree, checked by manual inspection and checksums of the whole tree after runs with and without try) and performance relative to plain execution and to a Docker 28.4.0 container with full isolation, which includes container creation, copying inputs in, execution, teardown and copying outputs out. The machine has 64 GB of RAM and an 8-core Intel Xeon W-2145 at 3.7 GHz, with Linux 6.1 on Debian 13.

The five groups are: five ChatGPT-generated scripts distilled from LLM workflows (touching 10,000 files, compressing files, searching 100 directories of 10,000 files, scanning a 10-million-line log, sorting 10 million lines); five Koala shell programs with many dependencies (covid, nlp, spell, unixfun, ci-cd) for dependency tracking; five projects whose pre-commit hooks do filesystem and network work, including a code-injection attack that exfiltrates data (LinOTP, kibble, frogmouth, okteto, uv-metrics); five commands with a native dry-run (git clean, patch, rename, rsync, stow); and five commands whose specifications are mined (`ls`, `cp`, `rm`, `sed`, `xargs`, exploring 11, 100, 40, 1,408 and 3 configurations). Three Rust microbenchmarks break down try's own overhead.

## Findings

These are the authors' reported results.

- **Control and equivalence.** In all five groups try mediated the relevant effects and gave the same results and filesystem state as plain execution. The exceptions are small: two dry-run benchmarks differed, one because `rename` prints a different representation and one because `rsync`'s native dry-run omits effects in a `--log-file` that try captures.
- **Overall performance.** Over plain execution try costs 1.0 to 8.3 times, and against Docker with full isolation it is 1.1 to 225.7 times faster. The authors give no geometric mean because each case study needs different flags.
- **LLM scripts.** 1.1 to 1.9 times over plain, and 1.3 to 225.7 times faster than Docker. The outliers are tasks that write only to standard output or to one large file, where try pays one creation and one copy-up and Docker pays the full setup and teardown.
- **Dependency tracking.** 1.0 to 1.7 times over plain, with tracing cost growing with the number of effects (more visible for interpreted components like a Python script than for coreutils), and 1.1 to 18.7 times faster than Docker. Try found all true dependencies, and applying them afterwards with stacking gave correct results.
- **Third-party code.** Up to 1.3 times over plain, 1.4 to 4.2 times faster than Docker. With `-i` excluding `/etc/passwd`, try mediated all effects except the injected append to that file, and the changes the hooks should make were committed correctly.
- **Dry run.** Try is 4.9 to 82.6 times slower than the native dry-run modes (0.26 s against 0.03 s on average), as expected since it executes the real work and then discards it, while being general.
- **Specification mining.** The inferred specifications match or extend PaSh's hand-written ones, and in three cases reveal effects the original omitted. For instance `cp` is marked side-effectful there but behaves purely in the evaluated scenarios. Try costs 1.7 to 8.3 times over plain and is 1.6 to 2.2 times faster than Docker.
- **Where the time goes.** A trivial `echo` takes 165 ms, 25% in creating the overlay (42 ms), 22% in directories (37 ms), 16% in unmounting devices (26 ms) and 11% in mounting them (19 ms). These costs stay roughly constant for longer runs, and creating 10,000 small files spends 6.3 s of 11 s in namespace exit, where try walks the upper directory.
- **Adoption.** The authors report use in research and production at several organizations. The out-of-order execution engine hS and the incrementalization system Incr use try to build dependency graphs and revoke effects, with speedups of up to 9.3 times for the first. Users discard effects when a command writes outside the expected subtree, when `chmod +x *` touches more than intended and after mistyped `pip` and `cpanm` runs, one selectively committed only the best training checkpoint, a teaching assistant shielded the machine from student submissions, and students wrapped agent sessions.

## Critical Analysis

The paper states several limits itself.

- **User namespaces change behavior.** Processes cannot interact with other users or switch UID, they bypass write permissions as namespace root, the PID and signal isolation cannot be turned off, and pseudo-filesystems and physical devices are hard to handle. Selective application can produce an inconsistent set of updates (a file without its directory), which try warns about like `mv` does.
- **Scope of effects.** Filesystem effects are the focus, with optional extensions for network and streams. Adversarial, try-aware components are out of scope.
- **Dry-run is slower by design.** The authors acknowledge it as the price of generality.

The following points are a reading of the evidence, not claims of the paper.

- **The Docker comparison sets the ratio.** The baseline includes container creation and copying inputs in and outputs out, which is one way to use Docker, and the largest ratios (up to 225.7 times) come from tasks where try does almost nothing. For long-running jobs the fixed setup cost on both sides amortizes and the ratio shrinks to the low end of the range. A Docker setup that bind-mounts the working tree would be another baseline.
- **No external users study.** Equivalence is checked on 25 selected workloads, and adoption is shown by anecdotes and testimonials from colleagues, students and affiliated projects, not a controlled study of whether people catch more mistakes.
- **Non-filesystem effects stay out of reach.** For an agent that sends an email or calls an API, try offers network blocking and read-only observation but no way to roll the action back, so it protects the local disk, which the students' experience also shows.
- **The tracing is path-based.** Dependencies come from path-taking syscalls filtered by seccomp, so communication through already-open descriptors, shared memory or sockets between processes is invisible unless the user adds filters, and the specification miner depends on that view.
- **A dependency on kernel features.** It needs unprivileged user namespaces and OverlayFS, which the authors say most modern distributions enable by default, and it relies on extra components (mergerfs when submounts exist, strace for tracing).
- **Large writes pay for copy-up.** The first modification of a big file copies it to the upper layer, which the paper notes for its `logs` benchmark, so workloads that rewrite large files in place may behave differently from small-file ones.

## Further Research

- Capturing and compensating non-filesystem effects, such as network requests, with the same stacking and selective application.
- Reducing the fixed setup and exit costs, for example when many small files accumulate in the upper layer.
- Smarter handling of partial application, with consistency checks across dependent effects.
- Combining semisolates with static analysis of the same script and with typed streams, and using the effect traces to derive specifications automatically at larger scale.
