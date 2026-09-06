---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the control unit's job as producing every control signal the datapath needs — RegWrite, ALUSrc, MemRead, MemWrite, MemToReg, Branch, and ALUControl — from an instruction's opcode (and, when needed, funct3 and funct7).
- Explain why, in a single-cycle CPU specifically, the control unit is purely combinational logic (a truth table) rather than a genuine multi-state finite state machine.
- Build and read a control-signal table listing correct signal values for R-type, `addi`, `lw`, `sw`, and `beq` instructions.
- Derive `PCSrc` as the logical AND of `Branch` and the ALU's `Zero` flag, and explain why both are required.
- Trace, for a specific instruction, exactly how its opcode (and funct3/funct7 where relevant) determines every control signal's value.

## Context & Motivation

The previous concept built the single-cycle datapath: a fixed network of buses, a register file, an ALU, data memory, and three multiplexers — ALUSrc, MemToReg (WBSel), and PCSrc — each always holding both of its candidate values ready, on every cycle, for every instruction. That concept left every mux's select line and every enable line unconnected to anything meaningful. The **control unit** closes that gap: it reads the instruction currently in the datapath — specifically its opcode, and for R-type instructions its funct3 and funct7 as well — and produces the exact combination of signal values that makes the fixed datapath perform that one instruction correctly.

This also settles a question the earlier "Finite State Machines" concept should raise: is the control unit an FSM? Harris & Harris's *Digital Design and Computer Architecture* and MIT 6.004's "Building the Beta" both address this directly. In general, control logic naturally sequences an instruction through fetch, decode, execute, and writeback, and so is modeled as an FSM that remembers what stage it is in. But in the single-cycle design built across this discipline, every instruction, regardless of type, completes entirely within one clock cycle — fetch, register read, ALU computation, memory access, and writeback all happen combinationally in the same tick, with only the register file and PC changing state, and only at the very end. Because there is never more than one implicit "state" — a fresh decision is made every cycle, with no memory of the previous one needed — this control unit has no internal state at all. It degenerates from a general state machine into a purely combinational decoder: a truth table mapping opcode bits directly to output signal bits. Later, in the Computer Architecture discipline, multi-cycle and pipelined CPUs reintroduce genuine control FSMs with real internal state, because those designs spread one instruction's work across more than one clock cycle and must remember where in that sequence they currently are.

## Core Theory

### What the control unit reads

The control unit's only inputs are bits already sitting in the fetched instruction: the 7-bit `opcode` (bits [6:0] in every format), and, for R-type instructions specifically, the 3-bit `funct3` and 7-bit `funct7`, needed because several R-type operations (`add` and `sub`, most notably) share an identical opcode and funct3 and are distinguished only by funct7. The control unit never reads register contents, memory contents, or the ALU's numeric result, with one narrow exception described below (the `Zero` flag, used only for `PCSrc`). Every other output is a pure function of the instruction's static encoding, decided the instant the instruction is fetched, before any register is read or ALU computation happens.

### The control signals this datapath needs

Each signal below corresponds to exactly one select or enable line left dangling in the previous concept's datapath:

- **RegWrite** — enables the register file's write port. Asserted for instructions writing a result back to a destination register (R-type, `addi`, `lw`); de-asserted where there is no destination register (`sw`, `beq`).
- **ALUSrc** — selects the ALU's second operand: 0 routes `rs2`'s register value; 1 routes the sign-extended immediate.
- **ALUControl** — selects which ALU operation runs this cycle (add, subtract, AND, OR, SLT), derived from opcode alone for most instructions, but from opcode, funct3, *and* funct7 together for R-type.
- **MemRead** — enables data memory's read port. Asserted only for `lw`.
- **MemWrite** — enables data memory's write port. Asserted only for `sw`.
- **MemToReg** (equivalently **WBSel**) — selects the writeback value: 0 selects the ALU's result, 1 selects data memory's read data. A "don't care" whenever `RegWrite` is 0.
- **Branch** — asserted only for `beq`, signaling "this instruction's PC decision depends on the ALU's Zero flag," independent of that flag's actual value.
- **PCSrc** — not produced directly by the opcode table, but computed downstream as `Branch AND Zero`, and it is this signal, not `Branch` alone, that drives the PCSrc mux built previously.

### The control-signal table

| Instruction type | opcode | RegWrite | ALUSrc | MemRead | MemWrite | MemToReg (WBSel) | Branch | ALUControl |
|---|---|---|---|---|---|---|---|---|
| R-type (`add`/`sub`/`and`/`or`/`slt`) | 0110011 | 1 | 0 (register) | 0 | 0 | 0 (ALU result) | 0 | funct3+funct7 select ADD/SUB/AND/OR/SLT |
| `addi` | 0010011 | 1 | 1 (immediate) | 0 | 0 | 0 (ALU result) | 0 | ADD |
| `lw` | 0000011 | 1 | 1 (immediate) | 1 | 0 | 1 (memory data) | 0 | ADD |
| `sw` | 0100011 | 0 | 1 (immediate) | 0 | 1 | X (don't care) | 0 | ADD |
| `beq` | 1100011 | 0 | 0 (register) | 0 | 0 | X (don't care) | 1 | SUB |

Every row is a fixed, unconditional response to a fixed opcode value — exactly what makes the control unit purely combinational: implementable as ordinary decode logic (one AND/OR network per output signal) with no memory of previous cycles.

### ALUControl in more depth: when funct3 and funct7 matter

For every instruction except R-type, `ALUControl` is a direct function of opcode alone — `addi`, `lw`, `sw` all need ordinary addition, so opcode alone selects ADD; `beq` always needs subtraction, so opcode alone selects SUB. R-type is the one case where opcode alone is insufficient, because a single opcode (0110011) is shared by `add`, `sub`, `and`, `or`, and `slt`. The control unit resolves this by feeding funct3 and funct7 into ALUControl decode logic specifically for R-type: funct3 = 000 with funct7 = 0000000 selects ADD, funct3 = 000 with funct7 = 0100000 selects SUB, funct3 = 111 selects AND, funct3 = 110 selects OR, and funct3 = 010 selects SLT. No other instruction type needs funct3 or funct7 consulted at all.

### PCSrc = Branch AND Zero

`Branch` and `Zero` come from entirely different hardware — `Branch` from the control unit's opcode decode, purely static; `Zero` from the ALU, computed dynamically from actual register values this cycle — and `PCSrc = Branch AND Zero`. Both inputs are genuinely required. `Branch` alone is insufficient because `Zero` can be asserted for reasons unrelated to branching: an R-type subtraction that happens to produce zero also asserts Zero, purely as a side effect. If `PCSrc` were wired to `Zero` alone, `sub x5, x6, x6` (always zero) would incorrectly redirect the PC even though no branch is executing; `Branch` gates this off, forcing `PCSrc = 0` whenever `Branch = 0` regardless of `Zero`. `Zero` alone is equally insufficient: `beq`'s semantics is "branch only if equal," and equality is exactly what Zero reports once ALUControl is set to SUB (rs1 − rs2 = 0 if and only if rs1 = rs2); without consulting Zero, branching could never be conditional. Once computed, `PCSrc = 0` selects PC + 4 at the PCSrc mux, `PCSrc = 1` selects PC + offset. For every non-branch instruction, `Branch = 0` forces `PCSrc = 0` unconditionally, so the PC always simply advances by 4.

### Why this control unit has no states: a decoder, not an FSM

An FSM, as covered earlier in this discipline, is defined by states, a next-state function, and an output function that may depend on the current state. This control unit has exactly one implicit "state" — decode-this-instruction's-opcode — that never depends on the previous instruction. Its output depends only on the current instruction's bits, with no next-state function feeding anything forward; each cycle's outputs are computed fresh, exactly like a read-only lookup table. This is a direct consequence of the single-cycle design: because every instruction completes fully within one clock cycle, the control unit never needs to remember it is midway through a `lw` versus midway through an `add` — by the next edge, the previous instruction is entirely finished. Multi-cycle designs, which spread one instruction's fetch, decode, memory access, and writeback across several cycles to allow a slower clock and hardware reuse, and pipelined designs, which overlap multiple instructions' partial execution simultaneously, both genuinely need a control unit with real internal state, because "which part of which instruction is happening right now" is no longer decidable from the current instruction's bits alone. That distinction belongs to the Computer Architecture discipline; within this single-cycle CPU, the combinational-decoder view is completely accurate.

## Worked Examples

### Example 1: Deriving the control-signal row for an R-type instruction

Goal: derive every signal for `add x5, x6, x7` (opcode 0110011, funct3 000, funct7 0000000). The opcode identifies an R-type ALU instruction. RegWrite = 1, since R-type always writes a result into `rd`. ALUSrc = 0, since R-type carries no immediate field at all — every bit is spent on registers and function codes — so the ALU's second operand must be a register value. MemRead = MemWrite = 0, since data memory is never touched. MemToReg = 0, since the writeback value is the ALU's sum, not memory data. Branch = 0, so PCSrc = Branch AND Zero = 0 regardless of the ALU's Zero flag this cycle. ALUControl: because the opcode is R-type, funct3 and funct7 must both be consulted; funct3 = 000 with funct7 = 0000000 selects ADD (versus funct7 = 0100000, which would select SUB for the identical funct3, distinguishing `add` from `sub`). Resulting row matches the R-type row in the table above.

### Example 2: Deriving and contrasting the rows for `lw` and `sw`

**`lw x5, 8(x6)`** (opcode 0000011): RegWrite = 1, since the loaded word is written into `rd`. ALUSrc = 1, since the ALU must add `rs1` to the sign-extended immediate to compute the effective address, not add two registers. MemRead = 1, since the point of this instruction is reading memory at the computed address. MemWrite = 0. MemToReg = 1, since the value written back must be data memory's output, not the ALU's own address computation. Branch = 0. ALUControl = ADD.

**`sw x5, 8(x6)`** (opcode 0100011): RegWrite = 0 — the S-type format has no `rd` field at all (those bits hold part of the immediate instead), so there is no destination register. ALUSrc = 1, identical reasoning to `lw`: the same base-plus-offset address arithmetic. MemRead = 0. MemWrite = 1, since the point of this instruction is writing `rs2`'s value into memory at the computed address. MemToReg = don't-care, since RegWrite = 0 already guarantees nothing is written back. Branch = 0. ALUControl = ADD, exactly as for `lw`.

**Contrast:** ALUSrc and ALUControl are identical because both compute the same address arithmetic from the same field layout. RegWrite flips from 1 to 0 because a load produces a destination-register result while a store does not. MemRead and MemWrite are exact opposites, reflecting data moving in opposite directions. MemToReg is meaningfully 1 for `lw` but simply irrelevant for `sw`, since RegWrite already guarantees no writeback mux output is ever latched.

### Example 3: Deriving the row for `beq` and explaining the taken/not-taken decision

`beq x5, x6, offset` (opcode 1100011): RegWrite = 0, since `beq` produces no register result — like `sw`, the B-type format has no `rd` field. ALUSrc = 0, since `beq` compares two register values directly (`rs1` against `rs2`); the offset is used separately, by the branch-target adder, not by the ALU. MemRead = MemWrite = 0. MemToReg = don't-care, exactly as for `sw`. Branch = 1 — the one instruction type in this ISA that asserts it, signaling "this instruction's next-PC decision depends on Zero." ALUControl = SUB, so the ALU computes `rs1 − rs2` and its Zero flag reports whether the two operands are equal.

The taken/not-taken decision itself happens downstream, via `PCSrc = Branch AND Zero`. Because Branch = 1 here, PCSrc collapses to simply the ALU's Zero flag: if `rs1` and `rs2` hold equal values, Zero = 1, so PCSrc = 1, and the PCSrc mux selects the branch-target adder's PC + offset, redirecting execution. If they differ, Zero = 0, so PCSrc = 0 despite Branch being asserted, and execution falls through to PC + 4. The control unit's only responsibility is guaranteeing Branch = 1 and ALUControl = SUB for `beq`; the actual taken/not-taken outcome is decided dynamically, per execution, by the ALU's Zero flag alone.

## Common Misconceptions & Pitfalls

- **"The control unit reads register or memory contents to decide."** It does not, with the single exception of the ALU's Zero flag feeding PCSrc. Every signal in the table above is a pure function of the instruction's static bits, decided before any register is even read.
- **"The control unit is always a genuine FSM with several states."** In this single-cycle design it is not — every instruction completes in one cycle, so the control unit needs no memory of previous cycles and degenerates to combinational decode logic. Multi-cycle and pipelined CPUs, covered later, do require genuine control FSMs.
- **"Branch alone is enough to redirect the PC."** It is not — `Branch` only signals "this decision depends on Zero"; redirection only happens when `Branch AND Zero` is 1. An R-type subtraction that happens to produce zero must never redirect the PC, which is why `Branch` must gate `Zero` rather than being replaced by it.
- **"funct3 alone always determines ALUControl for R-type."** It does not for every case — `add` and `sub` share opcode and funct3, and are distinguished only by funct7. Ignoring funct7 for R-type cannot tell them apart.
- **"A 'don't care' signal is electrically undefined."** It means the value cannot affect correctness, not that nothing is output — the mux still produces something every cycle for `sw` and `beq`, it simply is never latched because RegWrite = 0.
- **"Every instruction needs a wholly distinct combination of all seven signals."** Several share values — `addi`, `lw`, and `sw` all share ALUSrc = 1 and ALUControl = ADD, since they share the same underlying need of computing rs1 plus an immediate.

## Summary

The control unit is the combinational decoder that reads an instruction's opcode (and, for R-type, its funct3 and funct7) and produces every control signal the single-cycle datapath needs — RegWrite, ALUSrc, ALUControl, MemRead, MemWrite, MemToReg, and Branch — turning the datapath's dangling select and enable lines into a correctly executing instruction. Because every instruction completes within exactly one clock cycle, the control unit needs no memory of previous cycles, so it degenerates from the general finite-state-machine model into a pure truth table from instruction bits to output signals, a simplification specific to single-cycle designs that multi-cycle and pipelined control units, covered later in Computer Architecture, do not get to make. The control-signal table shows `lw` and `sw` sharing address-computation signals while diverging on RegWrite, MemRead, and MemWrite, and shows `beq` uniquely asserting Branch and selecting SUB so that the ALU's dynamically computed Zero flag, ANDed with the statically decoded Branch signal, safely decides whether the PC is redirected or simply advances by 4. With both the datapath and its control fully specified, the next concept assembles them into the complete fetch-decode-execute cycle that repeats every clock tick.

## Documentation Links

- [MIT 6.004 — Building the Beta](https://computationstructures.org/lectures/beta/beta.html) — a complete worked derivation of a single-cycle control unit's signal set from an instruction's opcode fields, using the same decode-and-drive-the-datapath methodology covered in this concept.
- [Harris & Harris — Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3) — the primary reference for the single-cycle RISC-V control unit, its control-signal table, and the PCSrc = Branch AND Zero decision covered throughout this concept.
