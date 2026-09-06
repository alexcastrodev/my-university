---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define a pipe as a kernel-managed, unidirectional byte stream connecting one process's output to another's input, with no shared memory visible to either process.
- Explain how the shell's `|` operator uses `pipe()`, `fork()`, and file-descriptor manipulation to connect two otherwise-unrelated programs at run time.
- Describe the pipe's fixed-size kernel buffer and what happens when a writer fills it or a reader drains it (blocking behavior).
- Distinguish a pipe (anonymous, only usable between related processes) from later concepts in this cluster that relax one or both of those restrictions.

## Context & Motivation

Every concept so far in this discipline — traps, system calls, input validation — has concerned a single process's relationship with the kernel. But real systems are built from many cooperating processes, and cooperation requires communication: one program's output needs to become another's input, a web server needs to hand a request to a worker process, a compiler's separate passes need to exchange intermediate data. `operating-systems-i` gave each process an isolated address space specifically so that one process's bugs cannot corrupt another's memory — but that very isolation means two processes have, by default, absolutely no way to exchange data at all. Interprocess communication (IPC) is the deliberate, kernel-mediated set of mechanisms that lets isolated processes communicate anyway, safely, only when and how they explicitly choose to.

The pipe is the oldest, simplest, and still most commonly used IPC mechanism on any Unix-like system — visible every time a user chains commands with `|` at a shell prompt. Understanding it precisely, including its real limitations, sets up the rest of this cluster: each subsequent IPC mechanism relaxes exactly one restriction a pipe imposes, in exchange for some added cost or complexity.

## Core Theory

### What a pipe actually is: a kernel buffer with two file descriptors

A pipe, from the kernel's perspective, is a fixed-size, in-kernel circular byte buffer with exactly two endpoints: a read end and a write end, each exposed to user-space processes as an ordinary file descriptor. Crucially, the data in a pipe's buffer is never mapped into either process's own address space the way shared memory (the next concept) will be — a process writing to a pipe hands its bytes to the kernel via the ordinary `write()` system call, and a process reading from a pipe receives bytes from the kernel via ordinary `read()`, exactly the same system calls already used for files, with the kernel doing the actual byte-shuttling in between. This is precisely why a pipe requires nothing new at the system-call level: it reuses the exact `read`/`write` interface `operating-systems-i` already established, applied to a special kind of file descriptor rather than an ordinary disk file.

### Setting up a pipe between two processes: `pipe()` before `fork()`

Because a pipe's two file descriptors only mean anything to processes that already have them open, connecting two *separate* programs requires a specific, well-defined sequence: a single process calls `pipe()`, which asks the kernel to create a new pipe and returns two file descriptors (conventionally, index 0 for the read end and index 1 for the write end) into that same process's own file-descriptor table. That process then calls `fork()` — and because a forked child inherits a copy of its parent's entire file-descriptor table, both the parent and the child now hold descriptors referring to the very same kernel pipe object. From there, one side closes its copy of the read end and keeps only the write end; the other closes its copy of the write end and keeps only the read end — and the two processes, which may have nothing else in common, now have a working, unidirectional communication channel.

```mermaid
flowchart LR
    subgraph Before fork
        P["Parent process\ncalls pipe()\nfd[0]=read, fd[1]=write"]
    end
    P -->|fork| C1["Parent after fork\nkeeps fd[1] (write)\ncloses fd[0]"]
    P -->|fork| C2["Child after fork\nkeeps fd[0] (read)\ncloses fd[1]"]
    C1 -->|write(fd1, ...)| K["Kernel pipe buffer\n(fixed size, FIFO)"]
    K -->|read(fd0, ...)| C2
```

### The shell's `|` operator: this exact mechanism, automated

When a user types `ls | wc -l` at a shell prompt, the shell performs precisely the sequence above on the user's behalf: it calls `pipe()` once, then `fork()`s twice (once per command), and in each child uses `dup2()` to make the pipe's appropriate end take over file descriptor 0 or 1 (standard input or standard output) before calling `exec()` to actually run `ls` or `wc`. Neither `ls` nor `wc` needs to know anything about pipes at all — each simply reads from its standard input or writes to its standard output, exactly as it always does, unaware that its standard descriptor has been quietly rewired to point at the other program instead of the terminal.

### Blocking behavior: what happens at the buffer's limits

A pipe's kernel buffer has a fixed, finite capacity (commonly a small number of kilobytes on real systems). If a writer produces data faster than a reader consumes it, the buffer eventually fills, and the kernel makes the writer's `write()` call block — the writing process is descheduled (using the same blocking mechanism `operating-systems-i`'s condition variables rely on internally) until the reader drains enough space to accept more. Symmetrically, if a reader tries to read from an empty pipe whose write end is still open, its `read()` call blocks until data arrives. If the write end is closed and the buffer is empty, `read()` instead returns immediately, signaling end-of-file — precisely the mechanism that lets `wc -l` know `ls`'s output has genuinely finished, rather than merely paused.

### The real limitation this cluster's next concepts relax

A pipe is deliberately restrictive in two specific ways: it is *anonymous*, meaning only processes that already share a common ancestor (and therefore inherited the same file descriptor through `fork()`) can use it — there is no way for two arbitrary, unrelated processes to discover and connect to the same pipe after the fact — and it is a *byte stream*, with no built-in notion of message boundaries; a reader has no way to know where one writer's logical "message" ends and the next begins, purely from the pipe mechanism itself. Both limitations motivate the mechanisms this cluster covers next.

## Worked Examples

### Example 1: Implementing `ls | wc -l` by hand in C

```c
int fd[2];
pipe(fd);                          // fd[0] = read end, fd[1] = write end

if (fork() == 0) {                 // child: runs "ls"
    close(fd[0]);                  // don't need the read end
    dup2(fd[1], STDOUT_FILENO);    // ls's stdout now IS the pipe's write end
    close(fd[1]);
    execlp("ls", "ls", NULL);
}

if (fork() == 0) {                 // second child: runs "wc -l"
    close(fd[1]);                  // don't need the write end
    dup2(fd[0], STDIN_FILENO);     // wc's stdin now IS the pipe's read end
    close(fd[0]);
    execlp("wc", "wc", "-l", NULL);
}

close(fd[0]); close(fd[1]);        // parent doesn't need either end
wait(NULL); wait(NULL);
```

Neither `ls` nor `wc` was written with any awareness of pipes — the redirection happens entirely through file-descriptor manipulation before `exec()` replaces each child's memory image.

### Example 2: A concrete blocking trace

```text
Pipe buffer capacity: 64 KB (illustrative)

Writer produces data faster than reader consumes:
  t=0    Writer writes 64 KB.  Buffer: full.
  t=1    Writer attempts to write 1 more byte -> BLOCKS.
  t=2    Reader reads 10 KB.   Buffer: 54 KB full, 10 KB free.
  t=3    Writer's blocked write() unblocks, writes up to 10 KB,
         then blocks again if it still has more to send.

Reader reaches an empty buffer, write end still open:
  Reader's read() BLOCKS until more data arrives or the pipe closes.

Reader reaches an empty buffer, write end now closed:
  Reader's read() returns 0 immediately (end-of-file), not blocking.
```

### Example 3: Why an anonymous pipe cannot connect two unrelated, already-running processes

```text
Process A (PID 501, started an hour ago, no shared ancestor with B)
Process B (PID 830, started just now by a different user)

Neither process has ever called fork() with the other as parent/child,
so neither inherited a shared pipe file descriptor from a common
ancestor. There is no `pipe()` call that could retroactively connect
them -- the file descriptors a pipe returns are only meaningful within
the process (and its fork()-descendants) that created them.
```

This is exactly the gap message queues and sockets (later in this cluster) are designed to close, each in a different way.

## Common Misconceptions & Pitfalls

- **"A pipe copies data directly from one process's memory into another's."** The kernel mediates every byte through its own internal buffer via ordinary `read`/`write` system calls; at no point is either process's memory directly visible to the other, unlike the shared-memory mechanism covered next.
- **"Any two processes on the system can communicate via a pipe if they both know its file descriptor number."** A pipe's file descriptors are only meaningful within the process that created it and any descendants that inherited them through `fork()` — there is no way for an unrelated process to attach to an existing anonymous pipe after the fact.
- **"A pipe has unlimited capacity; a fast writer can always get ahead of a slow reader."** The kernel's pipe buffer has a fixed, finite size; once full, the writer's `write()` call blocks until the reader makes room, which is precisely the back-pressure mechanism that keeps a fast producer from overwhelming a slow consumer's memory.
- **"`read()` returning 0 from a pipe means an error occurred."** It signals end-of-file — the write end has been closed and the buffer is empty — which is the normal, expected way a reader learns that no more data is coming.

## Summary

A pipe is a kernel-managed, fixed-capacity, unidirectional byte-stream buffer, exposed to user processes as an ordinary pair of file descriptors and manipulated with the same `read`/`write` system calls already used for files. Connecting two separate programs, as the shell's `|` operator does automatically, requires calling `pipe()` before `fork()`, so that both resulting processes inherit descriptors referring to the same underlying kernel object, then closing the unused end on each side. The kernel's fixed buffer size gives pipes a natural, built-in flow-control mechanism: a full buffer blocks the writer, an empty one (with the write end still open) blocks the reader, and a closed write end signals end-of-file. A pipe's two real limitations — it only connects processes with a common ancestor, and it carries an undifferentiated byte stream with no message boundaries — are exactly what shared memory, message queues, and sockets, covered next in this cluster, each relax in a different way.

## Documentation Links

- [UC Berkeley CS162 — Course Schedule](https://cs162.org/) — covers pipes and sockets as the IPC mechanisms this cluster builds from.
- [MIT 6.S081 — Lab: Unix Utilities](https://pdos.csail.mit.edu/6.S081/2021/labs/util.html) — the real assignment implementing a pipe-based shell utility in xv6.
