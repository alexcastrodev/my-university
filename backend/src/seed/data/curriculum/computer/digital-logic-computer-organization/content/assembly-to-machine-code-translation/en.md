---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe assembly-to-machine-code translation as a mechanical, one-to-one process: look up the mnemonic's opcode/funct fields, convert register names to 5-bit numbers, convert the immediate to its (possibly split) binary field, and concatenate the result into a 32-bit word.
- Translate a register-name mnemonic (e.g. `x6`) into its correct 5-bit binary register number, and explain why 5 bits is exactly enough for 32 registers.
- Convert a decimal immediate into its correctly sized two's-complement binary field, including splitting it across non-adjacent bit positions when the target format (S-type or B-type) requires it.
- Explain the two-pass assembler algorithm — building a symbol table of label addresses in the first pass, then resolving branch offsets in the second pass — and why label addresses cannot always be resolved in a single pass.
- Reverse the translation process (disassembly): given a 32-bit machine word, recover the opcode/funct fields, register numbers, and immediate, and reconstruct the original assembly mnemonic.

## Context & Motivation

The previous concept in this discipline established exactly how RV32I's 32 bits are carved up into instruction formats — R, I, S, and B — with fixed field boundaries for opcode, funct3, funct7, register numbers, and immediates. That concept answered "what does each bit position mean." This concept answers the next question: given a line of human-readable assembly such as `add x5, x6, x7`, how does that text become the specific 32-bit pattern `0x007302B3` that a CPU actually fetches from memory? The answer, perhaps surprisingly given how central assemblers are to systems programming, is that the translation is entirely mechanical — there is no creativity, no ambiguity, and no need for anything resembling the parsing complexity of a general-purpose programming language compiler. Every mnemonic maps to exactly one opcode/funct3/funct7 combination, every register name maps to exactly one 5-bit number, and every immediate maps to exactly one binary field (possibly split across non-adjacent bit ranges, as the previous concept showed for S-type and B-type). An assembler is, at its core, a lookup-and-concatenate machine, not an interpreter of meaning.

This mechanical nature matters for a very concrete reason: it is what makes an assembler trustworthy and predictable. A programmer or compiler emitting `addi x5, x6, 10` can be completely certain that the resulting machine word will be `0x00A30293` every single time, on every RV32I-compliant processor, because the mapping from mnemonic-plus-operands to bit pattern is fixed by the ISA specification, not left to an assembler's discretion the way, say, register allocation is left to a compiler's discretion. The one genuine complication in an otherwise fully mechanical process is the handling of symbolic labels used by branch instructions — a programmer writes `beq x5, x6, loop`, naming a target by a human-readable label rather than by a raw byte offset, and the assembler must first discover what address `loop` refers to before it can compute the numeric offset that actually gets encoded. This is why real assemblers, including the one implicitly described in Harris & Harris's treatment of the RISC-V toolchain and in MIT 6.004's broader treatment of translation and linking, work in two passes rather than one. Understanding this translation process in both directions — assembling text into bits, and disassembling bits back into text — is essential groundwork for the datapath and control unit concepts that follow, since those concepts are precisely about the hardware that performs the decoding half of this same correspondence, automatically and in a single clock cycle, every time an instruction is fetched.

## Core Theory

### The mechanical translation recipe

Assembling any single instruction (ignoring, for the moment, symbolic labels) follows exactly the same four-step recipe regardless of which format the instruction uses:

1. **Look up the mnemonic.** The assembler consults a fixed table mapping each mnemonic (`add`, `addi`, `lw`, `sw`, `beq`, and so on) to its format (R, I, S, or B) and its fixed field values: opcode always, funct3 always, and funct7 for R-type instructions that need it.
2. **Convert register names to numbers.** Each register operand, written as a name like `x5` or `x6`, is converted to its 5-bit binary register number — `x5` becomes `00101`, `x6` becomes `00110`, and so on, simply by taking the numeric suffix and writing it in 5 bits (registers are numbered x0 through x31, and `2^5 = 32` is exactly enough to number all of them with no wasted encoding space).
3. **Convert the immediate.** Any numeric operand — an `addi` constant, a load/store offset, or a branch target distance — is converted from its decimal (or hexadecimal) source-code form into a fixed-width two's-complement binary field. For I-type this field is a contiguous 12 bits; for S-type and B-type, as the previous concept detailed, the immediate must be split (and, for B-type, reordered) across two or more non-adjacent bit ranges dictated by the format.
4. **Concatenate.** The fixed fields from step 1 and the converted fields from steps 2 and 3 are placed into their format-mandated bit positions and concatenated, most-significant bit first, into one 32-bit word.

Every RV32I instruction, no matter how it reads in assembly, is produced by this same four-step procedure — the only thing that varies between instructions is which format's field layout is used in step 4.

### Symbolic labels and the two-pass assembler

The recipe above assumes every operand is already a concrete number. But branch instructions in real assembly programs almost always name their targets with a label, not a raw offset:

```
      addi x5, x0, 0
loop: addi x5, x5, 1
      addi x6, x6, -1
      beq  x6, x0, done
      beq  x0, x0, loop
done: addi x7, x0, 1
```

When the assembler reaches the `beq x6, x0, done` line, it needs to encode a byte offset from that instruction's own address to the address labeled `done` — but at the point of reading that line, in a naive single left-to-right pass, the assembler may not yet know where `done` is (it appears later in the file), and even the address of the current instruction depends on how many bytes every preceding instruction occupied. This is why assemblers, including the toolchain conventions described in Harris & Harris and in MIT 6.004's material on translation, use two passes:

- **Pass 1 (build the symbol table):** The assembler scans the entire program from top to bottom without emitting any machine code yet, tracking a running address counter (starting at some base address, incrementing by 4 for every instruction, since every RV32I instruction is exactly 4 bytes). Whenever it encounters a label definition (a name followed by a colon, such as `loop:` or `done:`), it records that label's name together with the address the next instruction will occupy, in a symbol table.
- **Pass 2 (resolve and emit):** The assembler scans the program a second time, and this time actually performs the four-step translation recipe for every instruction. Whenever it encounters a label used as an operand (such as `done` in `beq x6, x0, done`), it looks the label up in the symbol table built during pass 1, computes the branch offset as `(target address) - (address of this branch instruction)`, and encodes that computed offset into the B-type immediate field exactly as it would encode any other numeric immediate.

Two passes are necessary specifically because a label can be used before it is defined (a "forward reference," as with `done` above) — there is no way to know the address of a not-yet-seen label without first scanning the whole program to build the complete symbol table, which is exactly what pass 1 accomplishes before pass 2 needs the information.

### Disassembly: running the recipe backward

Disassembly reverses the translation recipe exactly, field by field:

1. Extract bits `[6:0]` as the opcode, and use it to determine the instruction's format (R, I, S, or B) and narrow down the instruction family.
2. Extract `funct3` from bits `[14:12]` (and, if the format is R-type, `funct7` from bits `[31:25]`) to pin down the exact mnemonic.
3. Extract the register fields (`rd`, `rs1`, `rs2`, whichever the format provides) from their fixed bit positions and convert each 5-bit number back to a register name (`00101` becomes `x5`).
4. Extract the immediate field(s), reassembling any split or reordered pieces (S-type and B-type) into a single binary value, then interpret that value as a two's-complement signed number.
5. Reassemble the pieces into assembly-language text in the mnemonic's standard operand order.

Because every one of these mappings is a fixed, table-driven lookup with no ambiguity in either direction, disassembly is exactly as mechanical as assembly — a property that is essential for debuggers and disassembler tools, which must recover exact, unambiguous source-level meaning from raw memory contents.

## Worked Examples

### Example 1: Assembling `add x5, x6, x7` step by step, to 0x007302B3

**Step 1 — look up the mnemonic.** `add` is R-type, with opcode `0110011`, funct3 `000`, funct7 `0000000`.

**Step 2 — convert registers.** `rd = x5 = 00101`, `rs1 = x6 = 00110`, `rs2 = x7 = 00111`.

**Step 3 — convert the immediate.** None — R-type carries no immediate.

**Step 4 — concatenate**, using the R-type field order `funct7 | rs2 | rs1 | funct3 | rd | opcode`:

```
funct7   rs2   rs1   funct3  rd    opcode
0000000  00111 00110 000     00101 0110011
```

Concatenated with no spaces: `00000000111001100000010100110011`. Regrouping into nibbles from the left (32 bits = 8 hex digits):

```
0000 0000 0111 0011 0000 0010 1011 0011
 0    0    7    3    0    2    B    3
```

Result: `0x007302B3` — exactly the ground-truth encoding for `add x5, x6, x7`.

### Example 2: Assembling `addi x5, x6, 10` step by step, to 0x00A30293

**Step 1 — look up the mnemonic.** `addi` is I-type, with opcode `0010011`, funct3 `000`.

**Step 2 — convert registers.** `rd = x5 = 00101`, `rs1 = x6 = 00110`.

**Step 3 — convert the immediate.** The decimal constant `10` must become a 12-bit two's-complement field. Since 10 is positive, this is simply 10 written in 12 bits: `10 = 8 + 2 = 0000 0000 1010` in binary, i.e. `000000001010`. (Had the constant been negative, e.g. -10, standard two's-complement negation — invert the bits of 10 and add 1 — would be applied within the 12-bit field before proceeding; here no negation is needed.)

**Step 4 — concatenate**, using the I-type field order `imm[11:0] | rs1 | funct3 | rd | opcode`:

```
imm[11:0]     rs1   funct3  rd    opcode
000000001010  00110 000     00101 0010011
```

Concatenated: `00000000101000110000001010010011`. Regrouping into nibbles:

```
0000 0000 1010 0011 0000 0010 1001 0011
 0    0    A    3    0    2    9    3
```

Result: `0x00A30293` — exactly the ground-truth encoding for `addi x5, x6, 10`.

### Example 3: Assembling `sw x5, 8(x6)` step by step, to 0x00532423

**Step 1 — look up the mnemonic.** `sw` is S-type, with opcode `0100011`, funct3 `010`.

**Step 2 — convert registers.** For a store, `rs1` is the base address register and `rs2` is the register holding the value being stored: `rs1 = x6 = 00110`, `rs2 = x5 = 00101`. (There is no `rd` for S-type.)

**Step 3 — convert the immediate, and split it.** The offset `8` as a 12-bit two's-complement value is `000000001000`. S-type requires this 12-bit field to be split into two pieces occupying non-adjacent bit ranges: the high 7 bits, `imm[11:5]`, and the low 5 bits, `imm[4:0]`.

```
12-bit immediate:  0000 0000 1000
bit positions:     11 10 9 8 7 6 5 4 3 2 1 0
                    0  0 0 0 0 0 0 1 0 0 0 0
imm[11:5] (7 bits, bits 11 down to 5): 0000000
imm[4:0]  (5 bits, bits 4 down to 0):  01000
```

**Step 4 — concatenate**, using the S-type field order `imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode`:

```
imm[11:5]  rs2   rs1   funct3  imm[4:0]  opcode
0000000    00101 00110 010     01000     0100011
```

Concatenated with no spaces: `00000000010100110010010000100011`. Regrouping into nibbles from the left:

```
0000 0000 0101 0011 0010 0100 0010 0011
 0    0    5    3    2    4    2    3
```

Result: `0x00532423` — exactly the ground-truth encoding for `sw x5, 8(x6)`. Notice that reassembling the two immediate pieces back into one 12-bit value — `imm[11:5]` concatenated with `imm[4:0]`, i.e. `0000000` followed by `01000`, giving `000000001000` = 8 — recovers the original offset exactly, confirming the split was lossless.

## Common Misconceptions & Pitfalls

- **"Assembling an instruction requires understanding what the program is trying to do."** It does not — assembly is purely mechanical, mnemonic-and-operand-to-bit-pattern translation with a fixed lookup table. An assembler never needs to reason about a program's intent; it only needs the mnemonic table, the format's field layout, and the operand values, exactly as shown in the worked examples above.
- **"A negative immediate is encoded by just writing a minus sign into the bit pattern somewhere."** There is no sign bit stored separately from the value — negative immediates are encoded using two's-complement representation within the fixed-width immediate field (12 bits for I-type and S-type, 13 bits reassembled for B-type), so the "sign" is simply whatever value the most-significant bit of that field happens to hold once the two's-complement conversion is performed.
- **"The two-pass assembler runs twice because it's checking its own work."** The second pass is not a verification pass — it is necessary because pass 1's sole job is to discover label addresses (building the symbol table), and pass 2 cannot correctly compute a forward-referenced branch offset like `beq x6, x0, done` until that complete symbol table already exists. A single pass cannot both discover a later label's address and use that address in an earlier instruction's encoding at the same time.
- **"Disassembly is fundamentally harder or less certain than assembly."** Given a fixed, unambiguous instruction set like RV32I, disassembly is exactly as mechanical as assembly — every opcode/funct3/funct7 combination maps back to exactly one mnemonic, with no guesswork required, precisely because the ISA was designed so that no two distinct instructions share an identical set of format-plus-opcode-plus-funct fields.
- **"Splitting the S-type or B-type immediate into pieces changes its numeric value."** It does not — splitting (and, for B-type, reordering) only changes where the bits are physically stored within the 32-bit word; reassembling the pieces in the correct order, as Example 3 demonstrates by concatenating `imm[11:5]` and `imm[4:0]` back together, always recovers the exact original value.
- **"Register numbers in machine code are ASCII text like 'x5'."** They are not — `x5` is purely an assembly-language convenience; the machine code only ever contains the 5-bit binary number 5 (`00101`), with no trace of the letter 'x' or any textual representation anywhere in the encoded instruction.

## Summary

Translating an assembly instruction into its 32-bit machine-code equivalent is a fully mechanical, four-step process: look up the mnemonic's format and fixed opcode/funct fields, convert each register name to its 5-bit number, convert each immediate to its fixed-width two's-complement binary field (splitting and reordering it across non-adjacent bit positions exactly when the S-type or B-type format demands it), and concatenate every field into its format-mandated bit position to produce one 32-bit word — a recipe verified field-by-field in this concept's worked examples for `add`, `addi`, and `sw`, each producing exactly its ground-truth hex encoding. The one wrinkle in an otherwise table-driven process is symbolic branch labels, which real assemblers resolve using a two-pass algorithm: pass 1 builds a symbol table of label addresses by scanning the whole program without emitting code, and pass 2 performs the actual translation, computing each branch's numeric offset from that already-complete symbol table. Disassembly is simply this same recipe run in reverse, extracting fixed-position fields and mapping them back to mnemonics, register names, and signed immediates with no ambiguity. The next concepts in this discipline — the datapath and the control unit — build directly on this correspondence, since they are the hardware that performs exactly this same decoding, automatically, every time an instruction is fetched from memory.

## Documentation Links

- [Harris & Harris — Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3) — the primary reference for the RISC-V instruction encoding rules and toolchain conventions that this concept's translation recipe follows.
- [MIT 6.004 — OCW Syllabus](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/syllabus/) — course syllabus for Computation Structures, whose units on translation and linking motivate the mechanical, table-driven view of assembly-to-machine-code translation used in this concept.
