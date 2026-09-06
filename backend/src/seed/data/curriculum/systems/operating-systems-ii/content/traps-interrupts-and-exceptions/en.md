---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define the trap mechanism as the single hardware pathway from user mode to kernel mode, and describe its three real sources: system calls, hardware interrupts, and exceptions.
- Distinguish these three sources by what triggers them (deliberate program request, asynchronous hardware event, synchronous program error) while explaining why the CPU handles all three through the same underlying mechanism.
- Describe what a trap frame is and why the hardware (or a minimal assembly stub) must save it before any kernel C code runs.
- Explain why a trap always jumps to a small, fixed set of kernel entry points rather than an address the trapping code supplies.

## Context & Motivation

The previous concept established that user mode cannot execute privileged instructions and cannot arbitrarily promote itself to kernel mode. But user programs legitimately need kernel services constantly — reading a file, allocating memory, waiting on I/O — and the kernel legitimately needs to regain control periodically even when a process asks for nothing at all (to preempt it after its scheduling quantum, or to service a completed disk read). Both needs are met by the same underlying hardware mechanism: the trap.

A trap is the CPU's own hardware-implemented jump from whatever code is currently executing (in whatever mode) into a kernel routine, at kernel privilege, at one of a small, fixed set of addresses the kernel established when it booted. This is the single doorway through which control ever passes from less-privileged to more-privileged execution, and understanding it precisely — what triggers it, what state it preserves, and where it lands — is the prerequisite for understanding system calls, interrupt-driven I/O, virtual memory's page faults, and virtualization's trap-and-emulate technique, all of which this discipline builds directly on this one mechanism.

## Core Theory

### Three real sources of a trap, one mechanism

Real hardware distinguishes three sources of a trap by what caused it, even though the CPU's actual response is structurally the same in each case:

1. **System calls** — a deliberate, synchronous request from user code, executed via a dedicated trap instruction (`ecall` on RISC-V, `syscall` or the older `int 0x80` on x86). The program chooses exactly when this happens.
2. **Hardware interrupts** — asynchronous events from outside the currently-running program entirely: a timer firing, a disk finishing a read, a keyboard key being pressed. These can occur at literally any instruction boundary, unrelated to what the interrupted code was doing.
3. **Exceptions** — synchronous, but *unplanned* by the program: a page fault (address translation failed), a divide-by-zero, an illegal instruction, a protection violation from the previous concept's privileged-instruction check. The program didn't ask for this, but it is a direct, immediate consequence of the instruction it just executed.

The unifying insight — the one MIT 6.S081's xv6 kernel makes explicit in its own trap-handling code — is that the CPU responds to all three with the same underlying hardware action: stop the currently executing instruction stream, save enough state to resume it later, switch to kernel mode, and jump to a kernel-defined handler. The *kernel's* trap-dispatch code then examines a cause register to decide which of the three actually happened and routes accordingly — but the hardware's own trap-entry sequence does not need three different mechanisms, just one, examined afterward.

### The trap frame: what must be saved, and by whom

Before any kernel C code can safely run, something has to preserve enough of the interrupted program's state that it can be resumed later exactly as if nothing had happened. This saved state — the program counter, the stack pointer, general-purpose registers, and the saved privilege level — is the trap frame. Some of this saving is done automatically by the hardware itself (RISC-V's trap entry, for instance, automatically saves the program counter into `sepc` and the cause into `scause`); the rest is the job of a small amount of hand-written assembly the kernel installs as its very first instructions at the trap-entry address, executed before any compiler-generated C code, precisely because an ordinary C function's own prologue would already clobber registers the trap frame needs to preserve first.

```mermaid
sequenceDiagram
    participant User as User-mode code
    participant HW as CPU hardware
    participant Asm as Kernel trap-entry assembly
    participant Kernel as Kernel C trap handler
    User->>HW: ecall / interrupt fires / exception occurs
    HW->>HW: save PC, cause; switch to kernel mode
    HW->>Asm: jump to fixed trap-entry address
    Asm->>Asm: save remaining registers into trap frame
    Asm->>Kernel: call C trap-dispatch function
    Kernel->>Kernel: examine cause; handle (syscall / interrupt / exception)
    Kernel->>Asm: return
    Asm->>Asm: restore registers from trap frame
    Asm->>HW: sret / iret
    HW->>User: resume at saved PC, back in user mode
```

### Why the jump target must be fixed, not supplied by the trapping code

A trap always lands at one of a small, fixed number of kernel-chosen addresses — configured once, at boot, in a hardware register the kernel controls (RISC-V's `stvec`, x86's Interrupt Descriptor Table base) — never at an address the trapping instruction itself specifies. This is not an arbitrary design choice: if user code could specify where its own trap landed, it could simply point that address at arbitrary code of its own choosing and execute it in kernel mode, defeating dual-mode execution entirely. By fixing the entry point in advance, at boot, before any user code ever runs, the kernel guarantees that no matter what triggered the trap, control always lands at code the kernel itself wrote and trusts.

### Interrupts versus exceptions: synchronous or not, and why it matters for resumption

An exception is synchronous with the instruction stream — it happens as a direct, immediate, reproducible consequence of the specific instruction that caused it (dividing by zero always faults at that exact division, every time). An interrupt is asynchronous — it can occur between any two instructions, entirely unrelated to what the interrupted code happens to be doing at that moment. This distinction matters for how the trap handler decides whether and how to resume: after handling a page-fault exception, the kernel typically re-executes the exact faulting instruction (now that the needed page is resident); after handling a timer interrupt, the kernel typically resumes at the very next instruction, since nothing about the interrupted instruction itself failed.

## Worked Examples

### Example 1: A concrete RISC-V trap sequence for a system call

```text
User code:             ecall                  ; trap instruction
Hardware (automatic):  sepc  <- PC of ecall    ; save return address
                        scause <- 8            ; "environment call from U-mode"
                        mode  <- S (supervisor) ; privilege raised
                        PC    <- stvec         ; jump to fixed kernel address
Kernel asm stub:        save a0..a7, ra, sp, etc. into a per-process trap frame
Kernel C handler:       read scause -> 8, dispatch to syscall handler
                        read a7 (syscall number), a0..a2 (arguments)
                        execute the requested syscall, store result in a0
Kernel asm stub:        restore registers from trap frame
                        sret                    ; mode <- U, PC <- sepc + 4
```

Note the `+ 4`: unlike a page fault (which re-executes the same faulting instruction), a completed system call resumes at the instruction *after* `ecall`, since the call already ran to completion.

### Example 2: Distinguishing the three trap sources by their `scause` value

```text
scause value (illustrative)   Source        Synchronous?   Resumes at
-----------------------------  ------------  -------------  -----------------
8 (environment call, U-mode)   System call   Synchronous    PC of ecall + 4
13 (page fault)                 Exception     Synchronous    same faulting PC
Interrupt bit set + timer code  Interrupt     Asynchronous   next instruction
```

The kernel's single trap-dispatch function reads this one value to decide which of three entirely different handling paths to take — one hardware entry mechanism, three logically distinct outcomes.

### Example 3: What goes wrong if the trap frame is saved incorrectly

```text
Bug: kernel trap-entry assembly forgets to save register t0
     before calling the C dispatch function.

Consequence: the C dispatch function (compiled code, free to use
any register) overwrites t0 for its own purposes.

Result: when the trap returns and the user program resumes, t0
holds garbage instead of whatever value the user program had put
there before the trap fired -- a correctness bug that can appear
to happen "at random," since it only manifests when the compiler
happens to have a live value in t0 across the exact instruction
that triggered the trap.
```

This is precisely why real kernels (xv6 included) hand-write the trap-entry assembly with extreme care, saving every register the calling convention doesn't already guarantee is preserved, before any ordinary C code executes.

## Common Misconceptions & Pitfalls

- **"System calls, interrupts, and exceptions are three unrelated hardware mechanisms."** They are handled by the same underlying trap mechanism — save state, raise privilege, jump to a fixed kernel address — differing only in what triggered the trap and, consequently, in how the kernel's dispatch code responds and where execution resumes afterward.
- **"The kernel can just write ordinary C code as its very first trap-handling instructions."** The trap frame — general-purpose registers, the return address — must be saved by hand-written assembly *before* any compiler-generated C function runs, because an ordinary C function's own prologue is free to clobber registers the trap frame still needs to preserve.
- **"A trap can land at any address, as long as it's in kernel code."** It lands at one specific, kernel-chosen fixed address (or a small table of them) configured once at boot, precisely so that no trapping instruction — however triggered — can redirect control to attacker-chosen code.
- **"Exceptions and interrupts both resume at the instruction after the one that trapped."** A page-fault exception resumes by re-executing the very same faulting instruction (now that its data is resident); an interrupt resumes at the next instruction, since the interrupted instruction itself didn't fail.

## Summary

Traps are the single hardware pathway from user mode to kernel mode, used for all three of a system call (a deliberate, synchronous request), a hardware interrupt (an asynchronous event unrelated to the interrupted code), and an exception (a synchronous, unplanned fault). The hardware saves enough state — the trap frame, with help from hand-written kernel assembly that must run before any ordinary compiled code — to resume the interrupted code correctly later, and always jumps to one of a small, fixed set of kernel-chosen entry addresses, never one the trapping code itself supplies, which is precisely what keeps dual-mode execution meaningful. The kernel's own dispatch code then examines a cause value to decide which of the three actually happened and how execution should resume. Every mechanism this discipline covers next — the anatomy of a system call, virtual-machine trap-and-emulate — is built directly on this one trap mechanism.

## Documentation Links

- [OSTEP — Direct Execution](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf) — covers the trap-based transition between user and kernel mode this concept is built on.
- [MIT 6.S081 xv6 book — Traps, Interrupts, and Drivers](https://pdos.csail.mit.edu/6.S081/2021/xv6/book-riscv-rev2.pdf) — the real, concrete RISC-V trap-frame and dispatch mechanics this concept's worked examples are drawn from.
