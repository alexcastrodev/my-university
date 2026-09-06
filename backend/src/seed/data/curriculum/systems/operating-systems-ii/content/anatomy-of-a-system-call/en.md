---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Trace a concrete system call like `write()` from a user-space library function through the trap instruction into the kernel and back.
- Explain the role of the system-call number and the system-call table in dispatching a single trap instruction to the correct kernel routine among hundreds.
- Describe how arguments and return values cross the user/kernel boundary through registers, and why the kernel cannot simply dereference a user-supplied pointer directly (foreshadowing the next concept).
- Distinguish the C library wrapper function a programmer calls from the actual system call it triggers, and explain why they are not the same thing.

## Context & Motivation

The previous concept established the trap mechanism in general — the hardware pathway from user mode to kernel mode, shared by system calls, interrupts, and exceptions. This concept makes that abstract mechanism completely concrete by tracing one real, ordinary system call from start to finish: what actually happens, instruction by instruction, when a C program calls `write(fd, buf, count)`.

This concrete trace matters because "the OS provides services like reading and writing files" is a claim every introductory treatment of operating systems makes, but very few make precise. A system call is not a function call in the ordinary sense — it crosses a hardware privilege boundary, its arguments are marshaled through registers rather than an ordinary stack frame the callee can freely inspect, and the actual kernel routine that runs is selected from among hundreds of possibilities by nothing more than a single integer. Understanding this concretely is the direct prerequisite for the next concept's central concern: why the kernel cannot simply trust any of the values it receives this way.

## Core Theory

### The C library wrapper is not the system call

When a C program calls `write(fd, buf, count)`, it is not directly invoking a kernel routine — it is calling an ordinary user-space function, typically supplied by the C standard library (glibc, musl, or similar), whose entire job is to package the call's arguments into the registers a real trap instruction expects, execute that trap instruction, and unpack the result afterward. This wrapper function is ordinary, unprivileged, user-mode code, executing exactly like any other function the program calls — the actual privilege-crossing event doesn't happen until the wrapper itself executes the trap instruction (`ecall` on RISC-V, `syscall` on x86-64). This is why "system call" refers specifically to the trap-crossing event and the kernel routine it invokes, not to the friendlier library function a C programmer directly writes in their own source code.

### The system-call number and the system-call table

A single trap instruction is all the hardware provides — it cannot, by itself, tell the kernel whether the calling program wanted to read a file, allocate memory, or terminate itself. The convention every real Unix-like kernel uses to resolve this is a system-call number: before executing the trap instruction, the library wrapper places a small integer identifying which system call is being requested into a designated register (conventionally `a7` on RISC-V in xv6, `rax` on x86-64 Linux). The kernel's trap-dispatch code, once it has determined (via the trap's cause) that this trap was a system call rather than an interrupt or an exception, reads this number and uses it as an index into a system-call table — an array of function pointers, one per system call, that the kernel populates once at boot. A Linux system, for instance, has several hundred distinct system-call numbers; xv6, being a teaching kernel, has closer to twenty — but the dispatch mechanism is identical regardless of the table's size.

### Arguments and return values cross through registers, not a shared stack

Ordinary user-space function calls pass arguments on the stack or in registers according to the platform's calling convention, and the callee can freely read the caller's stack frame if it needs to. A system call cannot rely on this, because the kernel executes on its own separate kernel stack after the trap, not on the calling process's user-mode stack — so system-call arguments are conventionally passed in a small, fixed set of general-purpose registers (following RISC-V's calling convention in xv6, arguments after the syscall number itself go in `a0` through `a6`), and the return value is placed back into `a0` before the kernel returns via `sret`. This is a deliberate, minimal interface: exactly enough registers to carry a handful of scalar arguments and one scalar result, with anything larger (a buffer of bytes to write, for instance) passed as a *pointer* to user memory in one of those registers rather than the data itself.

```mermaid
sequenceDiagram
    participant App as User program
    participant Lib as libc write() wrapper
    participant HW as Trap
    participant Kernel as Kernel syscall handler
    App->>Lib: write(fd, buf, count)
    Lib->>Lib: place syscall number in a7, args in a0-a2
    Lib->>HW: ecall
    HW->>Kernel: trap to fixed kernel entry, mode = kernel
    Kernel->>Kernel: read a7, index into syscall table
    Kernel->>Kernel: execute sys_write(fd, buf, count)
    Kernel->>HW: place return value in a0; sret
    HW->>Lib: resume in user mode, at instruction after ecall
    Lib->>App: return a0's value to caller
```

### Why passing a pointer, not the data itself, sets up the next concept

Because `buf` in `write(fd, buf, count)` is a pointer into the *calling process's own address space*, and the kernel is now executing with full hardware privilege after the trap, the kernel must somehow read `count` bytes starting at that user-supplied address — an address the kernel does not control and, critically, cannot simply trust to be valid, in-bounds, or even genuinely pointing at memory the calling process actually owns. This is exactly the concern the next concept, validating user input at the kernel boundary, takes up in full: the mere fact that a pointer arrived in a register does not make it safe to dereference.

## Worked Examples

### Example 1: xv6-style system-call dispatch, simplified

```c
// User-space library wrapper (simplified; real code is often in assembly)
int write(int fd, const void *buf, int count) {
    // place syscall number, invoke trap, retrieve result
    return syscall(SYS_write, fd, buf, count);
}

// Kernel: the system-call table
static uint64 (*syscalls[])(void) = {
    [SYS_fork]  sys_fork,
    [SYS_exit]  sys_exit,
    [SYS_write] sys_write,
    // ... one entry per supported system call
};

// Kernel: dispatch, called from the trap handler once scause
// identifies this trap as a system call (not an interrupt/exception)
void syscall_dispatch(struct trapframe *tf) {
    int num = tf->a7;               // which system call?
    if (num > 0 && num < NELEM(syscalls) && syscalls[num]) {
        tf->a0 = syscalls[num]();   // call it, store result in a0
    } else {
        tf->a0 = -1;                 // unknown syscall number
    }
}
```

### Example 2: A concrete register layout for `write(1, "hi\n", 3)`

```text
Register    Holds
----------  -------------------------------------------
a7          SYS_write's number (e.g. 16)
a0          fd = 1 (stdout)
a1          buf = 0x7ffff7a01000 (a user virtual address)
a2          count = 3

After the kernel runs sys_write and returns:
a0          3 (bytes actually written), or a negative error code
```

### Example 3: Why a made-up syscall number is safely rejected

```text
Malicious or buggy user code sets a7 = 9999 (no such syscall exists)
and executes ecall.

Kernel dispatch: 9999 >= NELEM(syscalls), so the bounds check fails.
Kernel returns -1 (or an equivalent "invalid system call" error) in a0,
WITHOUT ever calling through an uninitialized or out-of-bounds function
pointer.
```

This bounds check is a small but real instance of a much larger theme this discipline returns to explicitly in the next concept: the kernel must treat every value arriving from user mode, including something as simple as a syscall number, as untrusted input requiring validation before use.

## Common Misconceptions & Pitfalls

- **"Calling `write()` in C code directly invokes the kernel."** It calls an ordinary, unprivileged library wrapper function first; the actual privilege-crossing trap only happens inside that wrapper, when it executes the trap instruction.
- **"System-call arguments are passed the same way as ordinary function arguments, on the stack."** They are conventionally passed in a small set of designated registers, because the kernel runs on its own separate kernel stack after the trap and cannot read the user program's stack the way an ordinary callee could.
- **"The kernel receives the actual bytes being written, not a pointer."** For anything beyond a handful of scalar values, the kernel receives a pointer into the calling process's own address space and must explicitly read from that user memory itself — it does not receive a copy of arbitrarily large data through registers.
- **"Every integer placed in the syscall-number register corresponds to some valid kernel routine."** The kernel must bounds-check the syscall number before using it to index the system-call table, exactly like any other untrusted input arriving from user mode.

## Summary

A system call's real anatomy involves three distinct phases: a user-space library wrapper function (ordinary, unprivileged code) that packages arguments into registers and executes the actual trap instruction; the trap itself, crossing into kernel mode at a fixed entry point; and the kernel's own dispatch code, which reads a system-call number out of a designated register, bounds-checks it, and uses it to index a system-call table populated at boot. Arguments and the return value cross the user/kernel boundary through a small set of registers rather than a shared stack, and anything larger than a scalar value is passed as a pointer into the calling process's own address space — a pointer the kernel must treat as untrusted, which is exactly where the next concept picks up.

## Documentation Links

- [MIT 6.S081 xv6 book — Traps, Interrupts, and Drivers](https://pdos.csail.mit.edu/6.S081/2021/xv6/book-riscv-rev2.pdf) — the real syscall-table and trap-dispatch mechanics this concept's worked examples are adapted from.
- [MIT 6.S081 — Lab: System Calls](https://pdos.csail.mit.edu/6.S081/2021/labs/syscall.html) — the real assignment where students add a new system call to xv6's dispatch table.
