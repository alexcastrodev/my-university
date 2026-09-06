---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why a fixed-width 32-bit instruction requires several distinct field layouts (formats), given that different instructions carry different kinds of operands.
- Identify the R, I, S, and B instruction formats by their exact bit-field boundaries, and state which fields each format holds in common.
- Decode an instruction's opcode, funct3, and funct7 fields to determine which specific operation it encodes.
- Describe how immediates are packed into the I, S, and B formats, including why the B-type immediate bits are reordered ("scrambled") rather than stored contiguously.
- Distinguish the four addressing modes present in this ISA — register, immediate, base+displacement, and PC-relative — and state which instruction and field combination realizes each one.

## Context & Motivation

A previous concept in this discipline introduced a simple RISC-V-style instruction set: a fixed catalog of operations such as `add`, `addi`, `lw`, `sw`, and `beq`, each 32 bits wide. Fixing the instruction width to exactly 32 bits is a deliberate simplification — the fetch unit can always grab exactly four bytes from memory and know it has one complete instruction, with no variable-length parsing required. But a fixed width creates an immediate tension: `add x5, x6, x7` needs three registers, while `addi x5, x6, 10` needs two registers plus a numeric constant, and `sw x5, 8(x6)` needs two registers plus a constant offset meaning something different from an arithmetic operand. If every instruction used one rigid field layout, some instructions would waste bits they don't need while others wouldn't have room for the operands they do need. The solution used by RV32I, explained in Harris & Harris's treatment of the RISC-V instruction set, is to define a handful of different field layouts — instruction *formats* — each still exactly 32 bits wide, but each carving those bits into differently sized regions depending on what operands that family needs.

This is not merely bookkeeping. The choice of formats has hardware consequences later concepts depend on: the datapath's register file always reads its "which register" inputs from the same fixed bit positions regardless of format, and the control unit's immediate-generation logic can be built as fixed combinational hardware, as long as the format-specific bit positions are known in advance. Understanding instruction formats is really understanding a hardware design discipline: keep as many fields as possible in identical positions across formats, so the same wires and decode logic can be reused for every instruction the machine executes. This concept also introduces addressing modes — the different ways an instruction can specify where its operand data lives, whether a register's contents, a literal constant, a memory location computed from a register plus an offset, or a code location relative to the currently executing instruction. Addressing modes and formats are two sides of the same idea: the format determines which bits are available to express a mode, and the mode determines how those bits are used once decoded.

## Core Theory

### Why one format cannot fit every instruction

Every RV32I instruction is 32 bits wide, and every format reserves the lowest 7 bits, `[6:0]`, for the opcode, which broadly identifies the instruction family (arithmetic-with-registers, arithmetic-with-immediate, load, store, branch). Beyond the opcode, the remaining 25 bits are carved up differently per family:

- Register-to-register arithmetic (`add`, `sub`, `and`, `or`, `slt`) needs three registers — two sources, one destination — with no immediate, so every remaining bit pinpoints the exact operation.
- Register-plus-immediate arithmetic (`addi`) and loads (`lw`) need one destination register, one source register, and a numeric constant, leaving less room for register fields than R-type but requiring space for a constant R-type doesn't need.
- Stores (`sw`) need two source registers (address base and stored value) plus a constant offset, but no destination register — an asymmetry that forces the immediate into two separate pieces.
- Branches (`beq`) need two source registers to compare and a signed offset to a nearby instruction, but that offset is always a multiple of 2 (every instruction here is 4 bytes), freeing up one extra bit of range.

These four needs produce the four formats this concept covers: R-type, I-type, S-type, and B-type.

### The R-type format (register-register arithmetic)

| Bits | 31–25 | 24–20 | 19–15 | 14–12 | 11–7 | 6–0 |
|---|---|---|---|---|---|---|
| Field | funct7 | rs2 | rs1 | funct3 | rd | opcode |
| Width | 7 bits | 5 bits | 5 bits | 3 bits | 5 bits | 7 bits |

R-type carries no immediate at all: every bit identifies registers or the operation. `rs1` and `rs2` are the two 5-bit source register numbers (5 bits addresses all 32 registers, x0 through x31), `rd` is the 5-bit destination, and `funct3` with `funct7` disambiguates which operation is performed, since the opcode alone (`0110011` for every R-type instruction here) is shared across all of them.

### The I-type format (immediate arithmetic and loads)

| Bits | 31–20 | 19–15 | 14–12 | 11–7 | 6–0 |
|---|---|---|---|---|---|
| Field | imm[11:0] | rs1 | funct3 | rd | opcode |
| Width | 12 bits | 5 bits | 3 bits | 5 bits | 7 bits |

I-type replaces R-type's `rs2` and `funct7` fields with a single contiguous 12-bit immediate at bits `[31:20]`. Because `rs1`, `funct3`, `rd`, and `opcode` sit in the same positions as in R-type, decode logic never needs to special-case R-type versus I-type when reading `rs1` or `rd` — only the immediate-vs-`rs2`/`funct7` region differs. The immediate is sign-extended to 32 bits before use, giving a range of -2048 to +2047. `addi` (opcode `0010011`, funct3 `000`) and `lw` (opcode `0000011`, funct3 `010`) are both I-type: for `addi` the immediate is added directly to `rs1`; for `lw` it is a byte offset added to `rs1` to form a memory address.

### The S-type format (stores)

| Bits | 31–25 | 24–20 | 19–15 | 14–12 | 11–7 | 6–0 |
|---|---|---|---|---|---|---|
| Field | imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode |
| Width | 7 bits | 5 bits | 5 bits | 3 bits | 5 bits | 7 bits |

`sw` (opcode `0100011`, funct3 `010`) has no destination register — the value stored comes from `rs2`, and the address comes from `rs1` plus the immediate. The bit positions `[11:7]` that hold `rd` in R-type and I-type are repurposed in S-type to hold the low 5 bits of the immediate, since there is no `rd` for a store to produce. The remaining high 7 bits go into bits `[31:25]`, exactly where R-type keeps `funct7`. The immediate is thus split into two non-adjacent pieces, `imm[11:5]` and `imm[4:0]`, reassembled by concatenation when decoding: `imm[11:0] = instruction[31:25] : instruction[11:7]`. This split exists purely so `rs1`, `rs2`, and `funct3` remain in the same positions as every other format.

### The B-type format (branches) and the immediate scramble

| Bits | 31 | 30–25 | 24–20 | 19–15 | 14–12 | 11–8 | 7 | 6–0 |
|---|---|---|---|---|---|---|---|---|
| Field | imm[12] | imm[10:5] | rs2 | rs1 | funct3 | imm[4:1] | imm[11] | opcode |
| Width | 1 bit | 6 bits | 5 bits | 5 bits | 3 bits | 4 bits | 1 bit | 7 bits |

`beq` (opcode `1100011`, funct3 `000`) is structurally close to S-type — comparing two registers with no destination register — but carries a branch offset rather than a store address offset. Because every instruction here is 4 bytes and branch targets land on instruction boundaries, the offset is always a multiple of 2: bit 0 is always 0 and never stored, so only 12 significant offset bits (`imm[12:1]`) are encoded, giving a signed range of roughly -4096 to +4094 bytes from only 12 stored bits. Rather than storing those bits contiguously, the designers reordered them: `imm[12]` (the sign bit) goes into bit 31, the same position the sign bit occupies in I-type and S-type immediates, so one shared sign-extension circuit works regardless of format. `imm[11]` goes into bit 7, `imm[10:5]` goes into bits `[30:25]` (matching `imm[11:5]`'s S-type position), and `imm[4:1]` goes into bits `[11:8]` (matching the low 4 bits of `imm[4:0]` in S-type). This is a wiring optimization, not a random scramble: it lets one immediate-extraction circuit handle I-type, S-type, and B-type immediates with shared wiring plus a small multiplexer. Decoding reassembles the 13-bit signed offset as `imm[12] : imm[11] : imm[10:5] : imm[4:1] : 0`, the trailing 0 restoring the bit never stored.

### Opcode, funct3, and funct7: the decoding scheme

The opcode alone only narrows an instruction to a family (all R-type ALU operations share opcode `0110011`). Within a family, `funct3` (3 bits) provides finer selection, and for R-type, `funct7` (7 bits) further disambiguates operations sharing the same opcode and funct3, such as `add` and `sub`.

| Instruction | opcode | funct3 | funct7 |
|---|---|---|---|
| add | 0110011 | 000 | 0000000 |
| sub | 0110011 | 000 | 0100000 |
| and | 0110011 | 111 | (n/a) |
| or | 0110011 | 110 | (n/a) |
| slt | 0110011 | 010 | (n/a) |
| addi | 0010011 | 000 | — |
| lw | 0000011 | 010 | — |
| sw | 0100011 | 010 | — |
| beq | 1100011 | 000 | — |

`add` and `sub` share both opcode and funct3, distinguished only by funct7 — so the control unit (a later concept) must inspect all three fields together to identify an instruction, not the opcode alone.

### Addressing modes in this ISA

An addressing mode is a rule for how an instruction's operand fields locate the actual data it operates on. This ISA exhibits four:

- **Register addressing**: the operand is simply a named register's contents. All three R-type operands (`rs1`, `rs2`, `rd`) use register addressing — the data lives in the register file entries the fields name.
- **Immediate addressing**: the operand is a constant encoded directly in the instruction, with no memory or register lookup needed. `addi`'s 12-bit immediate is used this way — sign-extended and used directly as an addition operand.
- **Base+displacement (base+offset) addressing**: the effective memory address is a constant offset (the immediate) added to a base register's contents. Both `lw` and `sw` use this mode: `lw x5, 8(x6)` computes its address as `x6 + 8`, and `sw x5, 8(x6)` computes it the same way, storing `x5`'s value there.
- **PC-relative addressing**: the target is computed relative to the currently executing instruction's address (the program counter, PC) rather than as an absolute address. `beq`'s branch target is `PC + offset`, letting the same compiled branch work correctly wherever the program is loaded, since the target is a distance from "here," not a fixed address.

## Worked Examples

### Example 1: Laying out every field of the R-type instruction `add x5, x6, x7`

`add` computes `x5 = x6 + x7`. Its fields, using the R-type table above:

| Field | Bits | Value | Binary |
|---|---|---|---|
| funct7 | 31–25 | 0000000 (add) | 0000000 |
| rs2 | 24–20 | x7 | 00111 |
| rs1 | 19–15 | x6 | 00110 |
| funct3 | 14–12 | 000 (add) | 000 |
| rd | 11–7 | x5 | 00101 |
| opcode | 6–0 | R-type ALU | 0110011 |

Concatenating from bit 31 down to bit 0: `0000000 00111 00110 000 00101 0110011`. Removing spaces: `00000000111001100000010100110011`, regrouped into hex nibbles: `0000 0000 0111 0011 0000 0010 1011 0011` = `0x007302B3` — the ground-truth encoding for `add x5, x6, x7`.

### Example 2: Mapping every field of `lw x5, 8(x6)` to its bit positions

`lw x5, 8(x6)` loads the word at address `x6 + 8` into `x5`. This is I-type, since it needs one destination register, one base register, and an immediate.

| Field | Bits | Value | Binary |
|---|---|---|---|
| imm[11:0] | 31–20 | 8 | 000000001000 |
| rs1 | 19–15 | x6 | 00110 |
| funct3 | 14–12 | 010 (word load) | 010 |
| rd | 11–7 | x5 | 00101 |
| opcode | 6–0 | load | 0000011 |

Concatenating: `000000001000 00110 010 00101 0000011` → `00000000100000110010001010000011` → grouped into hex nibbles: `0000 0000 1000 0011 0010 0010 1000 0011` = `0x00832283`, matching the ground-truth encoding.

### Example 3: Computing an effective address and a branch target

**Base+displacement effective address.** Suppose register `x6` holds the value 1000 (a byte address). Executing `lw x5, 8(x6)` computes its effective address as:

```
effective_address = x6 + imm = 1000 + 8 = 1008
```

The CPU reads the 4 bytes at address 1008 into `x5`. The same computation, with the same fields, produces the target address for `sw x5, 8(x6)` — only the direction of data movement differs; the address arithmetic is identical.

**PC-relative branch target.** Suppose the `beq` instruction is located at address 100, and its (already reassembled, sign-extended) B-type immediate decodes to -4. The branch target is:

```
target = PC + offset = 100 + (-4) = 96
```

If the branch condition (`x_rs1 == x_rs2`) is true, the next instruction fetched comes from address 96 instead of the sequential address 104; if false, execution falls through to 104. This is why the offset must be added to the current PC rather than treated as an absolute address: the same instruction, placed at a different address, would still branch 4 bytes earlier, because "4 bytes earlier" is what the encoded offset means.

## Common Misconceptions & Pitfalls

- **"Every RISC-V instruction has the same field layout."** They do not — only the opcode field, bits `[6:0]`, sits in the same position across every format. R, I, S, and B carve up the remaining 25 bits differently based on what operands that family needs.
- **"The B-type immediate bits are stored in a random scrambled order for no reason."** The reordering is deliberate: it keeps the sign bit at bit 31 and other bits in the same positions used by S-type, so the same sign-extension and shifting circuitry serves I-type, S-type, and B-type immediates with minimal extra multiplexing.
- **"A branch offset of, say, 8 means jump 8 instructions."** It means jump 8 bytes — since every instruction here is 4 bytes, an offset of 8 skips exactly 2 instructions. Confusing byte offsets with instruction counts is a common source of off-by-a-factor-of-4 errors.
- **"Store instructions have a destination register (`rd`) like loads do."** They do not — `sw` writes to memory, so S-type has no `rd` field; the bit positions where `rd` sits in R-type or I-type instead hold part of the immediate.
- **"funct3 alone is always enough to identify an R-type operation."** Not always — `add` and `sub` share opcode `0110011` and funct3 `000`; only funct7 (`0000000` versus `0100000`) tells them apart. Decode logic that ignores funct7 will conflate them.
- **"PC-relative and base+displacement addressing are the same thing because both add an offset to something."** They use different base values: base+displacement (`lw`/`sw`) adds an offset to a general-purpose register to compute a data address, while PC-relative addressing (`beq`) adds it to the program counter to compute a code address, making branch targets independent of where the program is loaded.

## Summary

Because a fixed 32-bit instruction width must still express operand lists as different as "three registers" (R-type), "two registers plus a 12-bit constant" (I-type), "two registers plus a constant with no destination" (S-type), and "two registers plus a signed, always-even branch offset" (B-type), RV32I defines exactly these four formats, each carving the same 32 bits differently while keeping shared fields such as `opcode`, `rs1`, `rs2`, and `funct3` in identical positions wherever possible to simplify decode hardware. The opcode narrows an instruction to a family, and funct3 (and, for R-type, funct7) narrows further to the exact operation, with `add` and `sub` as the canonical example of operations distinguished only by funct7. Immediates are packed contiguously in I-type but split in S-type, and further reordered in B-type, purely so the sign bit and other bits stay in fixed positions shared across formats — a real wiring economy, not an arbitrary choice. Layered on these formats are this ISA's four addressing modes: register (R-type operands), immediate (`addi`'s constant), base+displacement (`lw`/`sw`'s `rs1 + offset` effective address), and PC-relative (`beq`'s `PC + offset` branch target). The next concept, assembly-to-machine-code translation, builds directly on these formats to show how assembly is mechanically converted into the 32-bit patterns worked out here.

## Documentation Links

- [Harris & Harris — Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3) — the primary reference for the RISC-V R/I/S/B instruction formats, field layouts, and the immediate-encoding scheme used throughout this concept.
- [ACM/IEEE CS2013 — Architecture and Organization Knowledge Area](https://csed.acm.org/knowledge-areas-architecture-and-organization-ar-cs2013-version/) — curriculum guidelines covering instruction formats and addressing modes as core Architecture and Organization topics.
