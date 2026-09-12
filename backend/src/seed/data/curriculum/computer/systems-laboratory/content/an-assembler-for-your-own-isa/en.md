---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a two-pass assembler: a first pass building a symbol table mapping labels to addresses, and a second pass translating each mnemonic instruction into the exact bit pattern Lab 4's CPU decodes.
- Explain why label resolution genuinely requires two passes rather than one, using a forward branch as the concrete, motivating case.
- Implement encoding for the same small instruction subset Lab 4's control unit understands, matching its exact field layout.
- Verify correctness end-to-end: assemble a source program, load the assembler's own output directly into Lab 4's CPU, and confirm it runs correctly with no hand-encoding involved anywhere in the pipeline.

## Context & Motivation

Lab 4's test program was hand-assembled, each instruction's exact bit pattern computed by a human before ever reaching the CPU. This lab closes that gap, and closes this discipline's whole CPU-building arc, by writing the tool that makes Lab 4's CPU actually usable without a human doing that translation by hand: a real assembler, matching **Assembly to Machine Code Translation**'s own account of the process.

## Core Theory

Nothing about *why* assembly-to-machine-code translation is fundamentally a substitution problem, mnemonics for opcodes, register names for register numbers, labels for addresses, is re-derived here; that argument belongs to `assembly-to-machine-code-translation`. This lab implements it, and specifically implements the one part a naive, single-pass approach cannot handle correctly: a branch instruction referencing a label that has not been defined yet in the source, a forward reference.

## Worked Examples

### API specification

```text
assemble(source: str) -> list[int]
  # source: assembly text, one instruction or label per line
  # returns: a list of 32-bit encoded instructions, in program order,
  #          ready to load DIRECTLY into the CPU's RAM via cpu.ram.load()
```

### Step 1 — why one pass is not enough: the forward-reference problem

```text
      ADDI r1, r0, 0        # address 0:  r1 = 0 (loop counter)
loop: ADDI r1, r1, 1        # address 4
      BEQ  r1, r2, done     # address 8:  "done" hasn't been seen in the
                              #             source text yet at this point
      BEQ  r0, r0, loop     # address 12
done: ADD  r3, r1, r1       # address 16: THIS is where "done" is defined
```

Translating `BEQ r1, r2, done` requires knowing `done`'s address, 16, but a single left-to-right pass reaches that `BEQ` line before it has ever seen the `done:` label at all. This is not a corner case, forward branches (skip past a loop body, jump past an else clause) are extremely common in real programs, which is exactly why every real assembler, and this lab's own, uses two passes.

### Step 2 — pass one: build the symbol table, without encoding anything yet

```python
def build_symbol_table(lines: list[str]) -> dict[str, int]:
    symbols = {}
    address = 0
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            label, _, rest = line.partition(":")
            symbols[label.strip()] = address
            line = rest.strip()
            if not line:
                continue  # a label on its own line, no instruction after it
        address += 4  # every instruction in this ISA is exactly 4 bytes
    return symbols
```

### Step 3 — pass two: encode, now with EVERY label already resolved

```python
def assemble(source: str) -> list[int]:
    lines = source.splitlines()
    symbols = build_symbol_table(lines)  # pass one, complete, before pass two starts

    encoded = []
    address = 0
    for raw_line in lines:
        line = strip_label(raw_line).strip()
        if not line or line.startswith("#"):
            continue
        mnemonic, *operands = tokenize(line)
        if mnemonic == "BEQ":
            rs1, rs2, target_label = operands
            offset = symbols[target_label] - address  # NOW resolvable,
                                                         # since pass one
                                                         # already ran
            encoded.append(encode(OP_BEQ, rs1=reg(rs1), rs2=reg(rs2), imm=offset))
        else:
            encoded.append(encode_ordinary(mnemonic, operands))
        address += 4
    return encoded
```

### Step 4 — the real, end-to-end correctness test

```python
def test_assembler_output_runs_correctly_on_lab4_cpu():
    source = """
        ADDI r1, r0, 0
    loop:
        ADDI r1, r1, 1
        ADDI r2, r0, 5
        BEQ  r1, r2, done
        BEQ  r0, r0, loop
    done:
        ADD  r3, r1, r1
    """
    machine_code = assemble(source)  # THIS lab's own output

    cpu = CPU()  # Lab 4's CPU, completely unmodified
    cpu.ram.load(address=0, words=machine_code)
    for _ in range(20):  # more than enough steps to reach "done"
        step(cpu)

    assert cpu.regfile.read(3) == 10, "loop should count to 5, then r3 = 5+5 = 10"
```

No hand-encoded instruction appears anywhere in this test; the assembler's own output, given nothing but readable assembly text containing a forward-referenced label, is what Lab 4's unmodified CPU actually executes, which is the real, end-to-end proof this lab's two-pass design works.

## Common Misconceptions & Pitfalls

- **"A single pass can handle forward references by just skipping them and coming back later."** This is, in effect, reinventing a second pass under a different name; the clean, standard structure Step 2 and Step 3 use, completing the entire symbol table before encoding a single instruction, avoids the bookkeeping complexity of tracking which specific instructions still need a later patch-up.
- **"Encoding should be able to happen at the same time as reading the source, to save a pass over the file."** For a program with any forward branch at all, this is not simply an optimization tradeoff, it produces an assembler that is straightforwardly incorrect on exactly the loop-and-conditional patterns real programs use constantly, as Step 1's concrete example shows.
- **"Testing the assembler means checking its encoded output byte-for-byte against expected values."** That is a reasonable unit-level check, but Step 4's end-to-end test, feeding the assembler's output directly into Lab 4's unmodified CPU and checking the resulting register state, is what actually closes the loop this whole arc has been building toward, source text in, correct final CPU state out, with no manual translation step anywhere in between.

## Summary

This lab closes the CPU-building arc by implementing a real, two-pass assembler: a first pass building a complete symbol table of every label's address before any instruction is encoded, and a second pass translating each mnemonic into the exact bit pattern Lab 4's CPU decodes, with forward-referenced branch targets, the concrete case a single pass cannot handle correctly, resolved because the symbol table is already complete by the time encoding begins. The lab's real correctness proof is end-to-end: assembly source text, containing a loop with a forward branch, assembled by this lab's own code and run, unmodified, on Lab 4's CPU, producing exactly the final register state a human tracing the program by hand would predict.

## Documentation Links

- [Nand2Tetris — Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): the real course whose own assembler project this lab's two-pass design is modeled on.
- [Harris & Harris — Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): the textbook source for the instruction encoding this lab's assembler produces, matching Lab 4's own decoding logic.
