---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Disassemble a compiled x86-64 binary with `objdump` and read its instructions without access to the original C source.
- Use `gdb` to set breakpoints, step through a running binary, and inspect register and memory state at each phase of a real reverse-engineering task.
- Recognize common compiled patterns, a loop, a string comparison, a switch statement, directly in disassembled x86-64 rather than only in source-level C.
- Recover a correct input string for each phase of CMU's Bomb Lab purely from its compiled behavior, without ever seeing its source.

## Context & Motivation

**x86-64 Registers and Data Movement** and **Condition Codes and Conditional Branches** already covered, theoretically, what registers hold values, what an instruction like `cmp` or `je` actually does, and how a compiler translates a high-level `if` into conditional jumps. This lab is where those individually understood pieces have to be read together, under real pressure, against a real compiled binary with no source code available at all: CMU's own Bomb Lab, a genuinely well known, decades-used exercise in this exact skill.

## Core Theory

Nothing about *why* condition codes or conditional jumps work is re-derived here; both already exist in `condition-codes-and-conditional-branches`. This lab is the discipline of reading compiled x86-64, produced by a real compiler making its own real, sometimes surprising translation choices, rather than hand-traced instructions written to illustrate one concept cleanly.

## Worked Examples

### The task, exactly as CMU specifies it

A "binary bomb" is a Linux executable consisting of six phases. Each phase reads a line from standard input; if the line matches a hidden expected string, the phase is "defused" and the program continues to the next phase; otherwise, the bomb "explodes," printing `BOOM!!!` and terminating. The six phases increase in difficulty, later phases typically involve loops, arrays, or recursive structures the earlier phases do not.

### Step 1 — disassembling the binary that contains phase 1

```text
$ objdump -d bomb | grep -A 20 '<phase_1>:'

0000000000401234 <phase_1>:
  401234:  48 83 ec 08          sub    $0x8,%rsp
  401238:  be 00 24 40 00       mov    $0x402400,%esi
  40123d:  e8 c2 04 00 00       call   401704 <strings_not_equal>
  401242:  85 c0                test   %eax,%eax
  401244:  74 05                je     40124b <phase_1+0x17>
  401246:  e8 e9 05 00 00       call   401834 <explode_bomb>
  40124b:  48 83 c4 08          add    $0x8,%rsp
  40124f:  c3                   ret
```

Reading this directly, without any source: `%esi` is loaded with the address `0x402400` (a string constant), `strings_not_equal` is called comparing that string against the phase's own input, and `test %eax, %eax` followed by `je` (jump if equal, i.e. if the comparison result was zero) branches around the call to `explode_bomb`. The expected string is not computed at all; it is simply read directly out of the binary's data section at address `0x402400`.

### Step 2 — finding the string constant with gdb

```text
$ gdb bomb
(gdb) break phase_1
(gdb) run
(gdb) x/s 0x402400
0x402400:  "Border relations with Canada have never been better."
```

`x/s` (examine as string) reads the actual bytes at that address as a null-terminated string, exactly the value `phase_1`'s disassembly showed being compared against. Typing that exact string as the program's input defuses phase 1.

### Step 3 — a harder phase involving a loop, read structurally

```text
  401260:  b8 00 00 00 00       mov    $0x0,%eax        # eax = 0 (accumulator)
  401265:  <loop body computing something into %eax, using %ecx as a counter>
  401270:  83 c1 01             add    $0x1,%ecx         # counter += 1
  401273:  83 f9 06             cmp    $0x6,%ecx          # counter == 6 ?
  401276:  75 ed                jne    401265             # loop while counter != 6

```

This pattern, `add $0x1, reg` followed by `cmp` against a fixed bound and a conditional jump back to the loop's start, is exactly how a compiler translates an ordinary `for (i = 0; i < 6; i++)` loop into x86-64; recognizing this shape directly in disassembly, without a source-level loop to refer back to, is the specific skill this phase, and later phases with more nested structure, is built to exercise.

### Step 4 — using gdb to check a hypothesis directly, rather than guessing blind

```text
(gdb) break phase_3
(gdb) run
[input a guessed string]
(gdb) print $eax
$1 = 0
(gdb) print/x $rsp
$2 = 0x7fffffffe310
```

Printing register and memory values at a breakpoint turns a hypothesis about what a phase expects, formed by reading the disassembly, into a directly checkable fact, rather than repeatedly guessing full input strings and rerunning the whole program from the start.

## Common Misconceptions & Pitfalls

- **"Without the source code, there's no reliable way to know what a compiled function actually does."** This lab's entire premise, and CMU's own decades of using it, is the opposite: x86-64 instructions map onto recognizable, recurring patterns, string comparison, loop structure, conditional branching, that a careful reader can reconstruct the logic from directly, which is exactly the skill `x86-64-registers-and-data-movement` and `condition-codes-and-conditional-branches` exist to build toward.
- **"Just running the binary repeatedly with different guessed inputs is a viable strategy."** For a phase with any real logic beyond a single string comparison, the input space is far too large to guess blindly; Steps 1 through 3's disassembly-first approach, reading what the phase actually checks before attempting an input, is what makes each phase tractable in a reasonable amount of time.
- **"gdb is only useful for finding bugs in code you wrote yourself."** Step 4 uses it for a genuinely different purpose, checking a hypothesis about someone else's already-compiled code's behavior at a specific point, which is precisely the reverse-engineering use case this lab is built around, distinct from, but using the exact same tool as, ordinary debugging.

## Summary

This lab applies `x86-64-registers-and-data-movement` and `condition-codes-and-conditional-branches`'s theoretical content to CMU's own real, widely used Bomb Lab: disassembling a compiled binary with no source code available, reading recognizable compiled patterns (string comparisons, loops, conditional branches) directly in x86-64, and using gdb not to find a bug in one's own code but to check a hypothesis about someone else's already-compiled logic. Successfully defusing all six phases means recovering the exact hidden input strings purely from the binary's own compiled behavior, the concrete, practical payoff of the register and condition-code theory this lab's prerequisite concepts already cover.

## Documentation Links

- [CS:APP — Lab Assignments (Bomb Lab)](https://csapp.cs.cmu.edu/3e/labs.html): CMU's own, official Bomb Lab this exercise matches exactly, including its full instructor and student documentation.
- [Stanford CS107 — Guide to x86-64](https://web.stanford.edu/class/cs107/guide/x86-64.html): a real, widely used reference for reading x86-64 disassembly, covering the register and instruction-pattern conventions this lab depends on.
