---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the four steps of the fetch-decode-execute cycle (fetch, decode, execute, update PC) and explain what happens to the datapath and control unit during each step.
- Explain why, in a single-cycle CPU, all four steps occur within one clock period as a single combinational settling of signals, rather than as four sequential clock ticks.
- Trace a complete cycle for an R-type instruction (add), a load instruction (lw), and a taken branch (beq), identifying which control signals are asserted and how the program counter is updated in each case.
- Explain the special role of the program counter as the single piece of state that identifies "where the machine is" in a running program, and how its update rule (PC+4, or branch target) implements sequential and non-sequential control flow.
- Justify why the fetch-decode-execute cycle, not any single instruction, is the fundamental unit of a CPU's operation, repeating unchanged billions of times per second regardless of which program is running.

## Context & Motivation

Every general-purpose computer, no matter how sophisticated its instruction set, performs a strikingly small and repetitive action, over and over, from power-on until shutdown: it looks at where it is in a program, reads the instruction stored there, figures out what that instruction means, carries it out, and decides where to look next. This loop is called the **fetch-decode-execute cycle**, and it is one of the single most important organizing ideas in all of computer architecture — arguably more important than any individual instruction, because the cycle is what turns a static list of encoded bit patterns sitting in memory into an actually running, computing machine. MIT's 6.004 course, in "Building the Beta," presents exactly this framing: a processor is not a bag of specialized circuits for each instruction, but a single uniform loop — fetch, decode, execute, repeat — whose behavior on any given pass is entirely determined by the bits of whichever instruction the program counter happens to be pointing at.

This concept builds directly on the-control-unit and the-datapath-registers-alu-and-buses. The datapath supplies the physical hardware — register file, ALU, memories, buses, and multiplexers — through which data can flow. The control unit supplies the decoding logic that looks at an instruction's opcode and funct fields and decides which settings every multiplexer and control line in that datapath should take. What has been missing is the unifying description of how these two pieces cooperate, tick after tick, to run a program from start to finish: that description is the fetch-decode-execute cycle. Once understood, the discipline converges on a single payoff, delivered in the final concept: wiring every piece built from NAND gates upward into one complete, working single-cycle CPU.

## Core Theory

### The four steps, in the abstract

The fetch-decode-execute cycle is usually described as four steps, and it is worth being precise about what each step accomplishes independent of any particular hardware implementation:

1. **FETCH.** Read the instruction word stored at the address currently held in the program counter (PC). This means presenting PC as an address to instruction memory and reading back the 32-bit instruction word found there.
2. **DECODE.** Interpret the bits of the fetched instruction. The control unit examines the opcode (and, where relevant, the funct field) to determine which instruction this is, and in turn which control signals should be asserted. Simultaneously, the register file is read: the rs1 and, for R-type and store instructions, rs2 fields of the instruction select which registers' values appear on the datapath's read-data buses.
3. **EXECUTE.** The ALU computes a result from its two operands (one always a register value, the other either a second register value or a sign-extended immediate, selected by the ALUSrc control signal). For lw and sw, this ALU result is a memory address, so a load or store additionally accesses data memory at that address. Any instruction that produces a value destined for a register (add, addi, lw, and similar) writes that value back into the register file, choosing between the ALU result and the memory read-data via the WBSel (write-back select) multiplexer.
4. **UPDATE PC.** The program counter is advanced to point at the next instruction. In the ordinary case this is simply PC+4 (the next word in memory, since each instruction is 4 bytes). If the instruction is a branch whose condition is satisfied — beq with equal operands, detected via the ALU's Zero flag — the PC is instead set to the branch target address, PC + offset, redirecting control flow away from strict sequential execution.

### Why all four steps happen within one clock period in a single-cycle machine

It is tempting to picture fetch, decode, execute, and PC-update as four separate steps happening one after another in time, each taking its own clock tick — and in some processor designs (multi-cycle or pipelined designs, covered in the follow-on Computer Architecture discipline) that is closer to true. But the CPU built in this discipline is a **single-cycle** design, and in a single-cycle design all four steps happen within a single clock period, as one continuous, uninterrupted flow of combinational logic settling to its final values.

Concretely: the datapath and control unit built in the two prior concepts are both, apart from the register file and PC register, pure combinational logic — networks of gates and multiplexers with no internal memory of their own. When the clock edge ending one cycle occurs, it latches new values into exactly two kinds of storage: the PC register (its next value, computed during the just-finished cycle) and the register file (if RegWrite is asserted, a new value into the destination register). At that instant, the newly latched PC becomes a stable input to instruction memory, which drives out the new instruction word. That word ripples through the control unit (decode), through the register file's read ports and the ALU (execute), and through data memory if needed, and finally back to the ALUSrc mux, the WBSel mux, and the PC-adder/branch-target logic — one unbroken cascade of gate delays, with no clock tick between these stages. Only once every signal has stabilized does the next clock edge arrive, latching the results and starting the cascade over. This is why the four "steps" of fetch-decode-execute are a conceptual decomposition of what happens, not four literal clock cycles: they are four regions of one combinational circuit, all settling within the span bounded by two consecutive clock edges.

### The PC as the thread of control

The program counter deserves special emphasis because it is the one piece of state, above all the rest, that captures "where the machine is" in a running program at any given moment. Everything else in the machine — register values, memory contents — is data the program operates on. The PC alone identifies which instruction comes next, and therefore which control signals will be asserted, which registers will be read and written, and which memory locations will be touched, on the following cycle. A sequential program, with no branches, simply advances PC by 4 every cycle, working straight down through consecutive instruction memory addresses. A branch instruction is the mechanism by which a program can escape strict linear execution: when its condition holds, the PC is redirected to some other address entirely, and the cycle picks up again from there exactly as if that address had always been next. This is the entire mechanism, at the hardware level, underlying loops, conditionals, and function calls in every programming language ultimately compiled down to this ISA: all of them reduce, at the bottom, to instructions that either leave PC to advance normally or redirect it.

### The cycle repeats, unchanged, billions of times a second

The remarkable thing about the fetch-decode-execute cycle is its total uniformity: the datapath and control unit do not know or care whether they are running the first instruction of a program or the ten-billionth. Every clock period, unconditionally, the same four-step cascade happens: whatever instruction PC currently names gets fetched, decoded, executed, and PC gets updated. A processor running at 3 gigahertz executes this identical cycle roughly three billion times every second, and the apparent complexity of a running operating system, browser, or game is nothing more than an extraordinarily long, fast sequence of passes through this one unchanging loop, with each pass's specific behavior determined entirely by whichever instruction bits happen to be sitting at the current PC.

## Worked Examples

### Example 1: One full cycle for `add x7, x5, x6`

Using the shared sample program, suppose PC currently holds `0x08`, and registers already hold `x5 = 5` and `x6 = 10` from the two preceding `addi` instructions.

**Fetch.** PC (`0x08`) is presented to instruction memory, which returns the instruction word encoding `add x7, x5, x6` — an R-type instruction naming rs1 = x5, rs2 = x6, rd = x7.

**Decode.** The control unit reads the opcode/funct fields, recognizes an R-type add, and asserts: RegWrite = 1, ALUSrc = 0 (the second ALU operand is a register, not an immediate), ALUControl = add, MemRead = 0, MemWrite = 0, WBSel = ALU result, Branch = 0. Simultaneously the register file's two read ports are driven by rs1 = x5 and rs2 = x6, producing read-data values 5 and 10.

**Execute.** The ALUSrc mux selects the register-sourced value 10 as the ALU's second operand, alongside 5 as the first operand. The ALU, configured by ALUControl to perform addition, computes 5 + 10 = 15. No data memory access occurs, since MemRead = MemWrite = 0. The WBSel mux selects the ALU result (15) as the value to write back.

**Update PC.** Branch = 0, so PCSrc selects PC+4 regardless of the ALU's Zero flag. PC becomes `0x08 + 4 = 0x0C`.

**Clock edge.** RegWrite = 1, so on the next clock edge, x7 is latched with value 15; PC is latched with value `0x0C`. State after this cycle: x5 = 5, x6 = 10, x7 = 15, PC = `0x0C`.

### Example 2: One full cycle for `lw x8, 0(x0)`

PC now holds `0x10`. From the previous instruction (`sw x7, 0(x0)`), mem[0] = 15.

**Fetch.** Instruction memory returns the `lw x8, 0(x0)` word: opcode = load, rs1 = x0, rd = x8, immediate offset = 0.

**Decode.** The control unit recognizes a load and asserts: RegWrite = 1, ALUSrc = 1 (second ALU operand is the sign-extended immediate), ALUControl = add (address computation is always an addition), MemRead = 1, MemWrite = 0, WBSel = memory data, Branch = 0. The register file's read port for rs1 = x0 returns 0 (x0 is hardwired to zero).

**Execute.** The ALU computes the effective address: 0 (from x0) + 0 (immediate) = 0. Since MemRead = 1, data memory is read at address 0, returning the stored value: 15. The WBSel mux, configured to "memory data," selects this value (15), not the ALU result, as the value destined for the register file.

**Update PC.** Branch = 0, so PC becomes `0x10 + 4 = 0x14`.

**Clock edge.** x8 is latched with 15; PC is latched with `0x14`. State after this cycle: x7 = 15, x8 = 15, mem[0] = 15, PC = `0x14`.

### Example 3: One full cycle for the taken branch `beq x7, x8, +8`

PC now holds `0x14`. From the two previous instructions, x7 = 15 and x8 = 15.

**Fetch.** Instruction memory returns the `beq x7, x8, +8` word: opcode = branch, rs1 = x7, rs2 = x8, immediate offset = 8.

**Decode.** The control unit recognizes a branch and asserts: RegWrite = 0 (branches never write a register), ALUSrc = 0 (the ALU compares two register values directly), ALUControl = subtract (equality is tested via subtraction — the ALU computes rs1 minus rs2, and Zero is asserted exactly when the result is zero), MemRead = 0, MemWrite = 0, Branch = 1. The register file's two read ports return 15 and 15.

**Execute.** The ALU computes 15 − 15 = 0, and because the result is exactly zero, the ALU's Zero flag is asserted (Zero = 1). No data memory access occurs.

**Update PC.** PCSrc is computed as (Branch AND Zero); here Branch = 1 and Zero = 1, so PCSrc selects the branch-target path: PC + offset = `0x14 + 8 = 0x1C`, rather than PC + 4.

**Clock edge.** RegWrite = 0, so no register is written. PC is latched with `0x1C`. State after this cycle: x7 = 15, x8 = 15, mem[0] = 15, PC = `0x1C` — control has jumped past whatever instruction, if any, sits at `0x18`.

The table below summarizes all three cycles side by side:

| Cycle | PC before | Instruction | Key control signals | ALU result / Zero | PC after |
|---|---|---|---|---|---|
| 3 | 0x08 | add x7, x5, x6 | RegWrite=1, ALUSrc=0, ALUControl=add | 15 | 0x0C |
| 5 | 0x10 | lw x8, 0(x0) | RegWrite=1, ALUSrc=1, MemRead=1, WBSel=mem | addr=0, mem[0]=15 | 0x14 |
| 6 | 0x14 | beq x7, x8, +8 | Branch=1, ALUControl=subtract | 0, Zero=1 | 0x1C (taken) |

## Common Misconceptions & Pitfalls

- **"Fetch, decode, execute, and PC-update are four separate clock cycles."** In this single-cycle CPU they are not four ticks of the clock; they are four conceptual stages of one continuous combinational signal path that fully settles within a single clock period, with exactly one clock edge per instruction latching the results. Multi-cycle and pipelined designs, covered later in Computer Architecture, do split these stages across multiple clock cycles — but that is a different, more elaborate design, not the machine built here.
- **"The control unit decides what to do after the ALU has already computed something."** Decode and execute do not happen in that temporal order as separate clock ticks; the control unit's signals (ALUSrc, ALUControl, and so on) are combinational functions of the opcode alone, and must be stable before or exactly as the ALU's inputs arrive, since the ALU's own inputs depend on those very control signals. All of it settles together within one clock period.
- **"The PC only ever advances by 4."** PC+4 is the default, used by every non-branching instruction and by branches whose condition fails, but a taken branch overrides this default entirely, redirecting the PC to an arbitrary computed target address — precisely the mechanism that implements loops and conditionals at the hardware level.
- **"Every instruction touches the same hardware in the same way."** Different instructions assert entirely different subsets of control signals — an add never asserts MemRead or MemWrite, a lw asserts MemRead but not MemWrite, a beq asserts neither and never asserts RegWrite — even though the fetch step and the general shape of the datapath cascade are identical for all instructions.
- **"The fetch-decode-execute cycle is a simplification real CPUs abandon."** It is not abandoned; it is elaborated. Even deeply pipelined, out-of-order superscalar processors still, at bottom, fetch instructions from wherever the (possibly speculative) instruction pointer indicates, decode them, execute them, and retire results in program order — the cycle described here is the conceptual skeleton every more sophisticated CPU design still respects.

## Summary

The fetch-decode-execute cycle is the single repeating loop — fetch the instruction at the address named by the program counter, decode its opcode to determine control signals and read the needed registers, execute it through the ALU (and data memory, for loads and stores), and update the program counter to the next instruction's address — that every CPU performs, unconditionally and unchanged, every clock period from power-on to shutdown. In the single-cycle machine built here, all four stages are not sequential clock ticks but four regions of one uninterrupted combinational cascade that fully settles within a single clock period, with one clock edge per instruction latching the new PC value and, when applicable, a new register-file value. The program counter is the one piece of state that identifies the machine's current position in the running program, defaulting to PC+4 for sequential flow but jumping to a computed branch target whenever a taken conditional branch's Zero-flag condition is satisfied — the exact hardware mechanism underlying every loop and conditional in every higher-level program ultimately compiled down to this instruction set. Having established precisely how one instruction is carried out from start to finish, the final concept in this discipline assembles every piece built so far — gates, ALU, registers, memory, datapath, and control unit — into one complete, working single-cycle CPU and runs a real program through it, cycle by cycle.

## Documentation Links

- [MIT 6.004 — Building the Beta](https://computationstructures.org/lectures/beta/beta.html) — presents the fetch-decode-execute loop as the uniform organizing principle of the Beta processor's single-cycle implementation.
- [Harris & Harris — Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3) — develops the single-cycle datapath and control signals whose combinational settling implements fetch, decode, execute, and PC-update within one clock period.
