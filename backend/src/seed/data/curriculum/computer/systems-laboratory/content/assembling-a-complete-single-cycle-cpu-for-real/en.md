---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Wire Lab 2's ALU, Lab 3's register file and RAM, and a new control unit into a single, complete single-cycle CPU.
- Implement the fetch-decode-execute cycle as one function run repeatedly: read an instruction from RAM at the program counter, decode its fields, execute it via the ALU and register file, and advance the program counter.
- Implement decoding for a small subset of this curriculum's own RISC-V-style ISA sufficient to run a real, if small, program.
- Verify the finished CPU by loading a hand-assembled instruction sequence into RAM and confirming the register file ends in the exact expected state after execution.

## Context & Motivation

**Assembling a Complete Single-Cycle CPU** and **The Fetch-Decode-Execute Cycle** already laid out, on paper, exactly how a datapath, an ALU, a register file, and a control unit combine into a working processor. This lab is where every earlier lab in this arc, Lab 1's gates, Lab 2's ALU, Lab 3's register file and RAM, gets wired together into that complete machine, matching MIT 6.004's own Building the Beta project and Nand2Tetris's own CPU chapter, and its own real test is not inspecting the wiring but loading a program and watching it actually run.

## Core Theory

Nothing about *why* a single-cycle design executes one full instruction per clock cycle, or *why* the control unit's job is translating an instruction's opcode into the specific control signals every other component needs, is re-derived here; both arguments already exist in `assembling-a-complete-single-cycle-cpu` and `the-control-unit`. This lab is the discipline of implementing that design against a small, concrete instruction subset and running it.

## Worked Examples

### API specification

```text
Instruction subset implemented (a small slice of the curriculum's own
RISC-V-style ISA, from a-simple-risc-v-style-isa):
  ADD  rd, rs1, rs2   # rd = rs1 + rs2
  SUB  rd, rs1, rs2   # rd = rs1 - rs2
  ADDI rd, rs1, imm   # rd = rs1 + imm
  LW   rd, offset(rs1)  # rd = RAM[rs1 + offset]
  SW   rs2, offset(rs1) # RAM[rs1 + offset] = rs2
  BEQ  rs1, rs2, offset # if rs1 == rs2: PC += offset, else PC += 4
```

### Step 1 — the control unit, translating an opcode into control signals

```python
def control_unit(opcode: int) -> dict:
    # Each entry says exactly what every other component needs to do
    # for this instruction — this IS what "control" means concretely.
    return {
        OP_ADD:  {"alu_op": "ADD", "reg_write": True,  "mem_write": False, "branch": False},
        OP_SUB:  {"alu_op": "SUB", "reg_write": True,  "mem_write": False, "branch": False},
        OP_ADDI: {"alu_op": "ADD", "reg_write": True,  "mem_write": False, "branch": False},
        OP_LW:   {"alu_op": "ADD", "reg_write": True,  "mem_write": False, "branch": False, "mem_to_reg": True},
        OP_SW:   {"alu_op": "ADD", "reg_write": False, "mem_write": True,  "branch": False},
        OP_BEQ:  {"alu_op": "SUB", "reg_write": False, "mem_write": False, "branch": True},
    }[opcode]
```

### Step 2 — one fetch-decode-execute cycle, exactly as the theory describes it

```python
def step(cpu: CPU) -> None:
    # FETCH: read the instruction the program counter currently points to
    instruction = cpu.ram.read(cpu.pc)
    opcode, rd, rs1, rs2, imm = decode_fields(instruction)  # DECODE

    ctrl = control_unit(opcode)

    # EXECUTE: the ALU runs regardless of instruction type — this is
    # exactly the single-cycle design's own defining property, every
    # instruction flows through the SAME datapath, just with different
    # control signals steering it
    operand_b = imm if opcode in (OP_ADDI, OP_LW, OP_SW) else cpu.regfile.read(rs2)
    alu_result, zero, _ = ALU(cpu.regfile.read(rs1), operand_b, ctrl["alu_op"])

    if ctrl["mem_write"]:
        cpu.ram.tick(alu_result, cpu.regfile.read(rs2), write=True)
    if ctrl["reg_write"]:
        write_value = cpu.ram.read(alu_result) if ctrl.get("mem_to_reg") else alu_result
        cpu.regfile.tick(rd, write_value, load=True)

    # advance the program counter: branch if the control unit says so
    # AND the ALU's own zero flag confirms the branch condition held
    if ctrl["branch"] and zero:
        cpu.pc += imm
    else:
        cpu.pc += 4
```

### Step 3 — a hand-assembled program, loaded and run

```python
program = [
    encode(OP_ADDI, rd=1, rs1=0, imm=5),   # r1 = r0 + 5  (r0 is hardwired to 0)
    encode(OP_ADDI, rd=2, rs1=0, imm=3),   # r2 = r0 + 3
    encode(OP_ADD,  rd=3, rs1=1, rs2=2),   # r3 = r1 + r2  ->  expect r3 = 8
]

def test_add_program_end_to_end():
    cpu = CPU()
    cpu.ram.load(address=0, words=program)
    for _ in range(len(program)):
        step(cpu)
    assert cpu.regfile.read(3) == 8, "r3 should hold 5 + 3 = 8 after running the program"
```

This is the lab's real correctness bar, not confirming each wire is connected by inspection, but loading a program no component of this arc has seen before and confirming the register file, the same one built in Lab 3, ends up in exactly the state a human tracing the program by hand would predict.

## Common Misconceptions & Pitfalls

- **"Different instructions should each get their own, separate execution path through the CPU."** The single-cycle design's whole point, made in `assembling-a-complete-single-cycle-cpu`, is the opposite: every instruction flows through the SAME datapath (the same ALU call, the same register file ports), with the control unit's signals, not a different code path, determining what actually happens; Step 2's `step` function has exactly one execution path for every opcode.
- **"Branching should update the program counter directly from the control unit."** The control unit only decides whether an instruction *could* branch (`ctrl["branch"]`); whether it actually does depends on the ALU's own zero flag from Lab 2, computed by literally subtracting the two register values being compared, exactly the coupling between control and datapath `the-fetch-decode-execute-cycle` describes.
- **"Testing individual instructions in isolation is sufficient; a multi-instruction program should work automatically if each one does."** Step 3's test specifically runs a small sequence where a later instruction (`ADD r3, r1, r2`) depends on values written by two earlier ones; a bug in how the program counter advances, or in how a written register value is actually visible to the next instruction, only surfaces once instructions run in sequence, not in isolated single-instruction tests.

## Summary

This lab wires every earlier lab in this arc, Lab 1's gates via Lab 2's ALU, Lab 3's register file and RAM, into one complete single-cycle CPU, with a control unit translating each instruction's opcode into the specific signals steering a single, shared datapath, matching `assembling-a-complete-single-cycle-cpu` and `the-fetch-decode-execute-cycle`'s own design exactly, including the coupling between the control unit's branch signal and the ALU's own zero flag. The lab's real test is not inspecting the wiring but loading a small, hand-assembled, multi-instruction program and confirming the register file ends in the exact state a human tracing the program by hand would predict.

## Documentation Links

- [MIT 6.004 — Building the Beta](https://computationstructures.org/lectures/beta/beta.html): the real project this lab's complete, wired-together CPU and its fetch-decode-execute loop are modeled on.
- [Nand2Tetris — Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): a second, independent real course covering the same complete-CPU assembly this lab implements.
