---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a 1-bit full adder from Lab 1's gate set, then chain it into an N-bit ripple-carry adder.
- Implement an operation-select multiplexer that routes the ALU's output between add, subtract (via two's complement), AND, and OR, driven by a control code.
- Implement zero and overflow flags computed directly from the adder's own output and carry bits.
- Verify the finished ALU against a table of hand-computed expected results covering ordinary values, zero, and a deliberately chosen overflow case.

## Context & Motivation

**Designing an Arithmetic Logic Unit** and **ALU Operation Selection and Flags** already worked out, on paper, what an ALU needs: an adder core reused for both addition and subtraction, a way to select which operation's result actually reaches the output, and flags summarizing properties of that result a later instruction can branch on. This lab builds that design for real, out of Lab 1's own gate set, and its finished output becomes Lab 4's arithmetic core once the complete CPU is assembled.

## Core Theory

Nothing about *why* subtraction reuses the adder (via two's complement negation) or *why* a ripple-carry adder is built from chained full adders is re-derived here; both arguments already exist in `designing-an-arithmetic-logic-unit`. This lab is the discipline of implementing that design and testing it against real, concrete inputs, not re-deriving it.

## Worked Examples

### API specification

```text
ALU(a: list[bool], b: list[bool], op: str) -> (result: list[bool], zero: bool, overflow: bool)
  # a, b: N-bit two's-complement operands, LSB first
  # op: one of "ADD", "SUB", "AND", "OR"
```

### Step 1 — a 1-bit full adder, then a chained N-bit adder

```python
def full_adder(a: bool, b: bool, carry_in: bool) -> tuple[bool, bool]:
    sum_bit = XOR(XOR(a, b), carry_in)
    carry_out = OR(AND(a, b), AND(carry_in, XOR(a, b)))
    return sum_bit, carry_out

def ripple_carry_adder(a: list[bool], b: list[bool], carry_in: bool) -> tuple[list[bool], bool]:
    result = []
    carry = carry_in
    for bit_a, bit_b in zip(a, b):  # LSB first: matches real hardware order
        s, carry = full_adder(bit_a, bit_b, carry)
        result.append(s)
    return result, carry  # final carry doubles as the overflow signal, see Step 3
```

### Step 2 — subtraction, reusing the SAME adder via two's complement

```python
def twos_complement_negate(bits: list[bool]) -> list[bool]:
    inverted = [NOT(b) for b in bits]
    incremented, _ = ripple_carry_adder(inverted, [True] + [False] * (len(bits) - 1), False)
    return incremented

def alu_add_or_sub(a: list[bool], b: list[bool], subtract: bool) -> tuple[list[bool], bool]:
    operand_b = twos_complement_negate(b) if subtract else b
    return ripple_carry_adder(a, operand_b, subtract)  # subtract=True also
                                                          # seeds carry_in=1,
                                                          # completing a-b = a+(-b)+... 
                                                          # matching the design
                                                          # from designing-an-
                                                          # arithmetic-logic-unit
```

No separate subtractor circuit exists anywhere in this lab; every subtraction is literally an addition against a negated operand, run through the exact same `ripple_carry_adder` from Step 1, which is the whole point Designing an Arithmetic Logic Unit's own design makes: one adder, reused, not two separate circuits.

### Step 3 — operation select and flags

```python
def ALU(a: list[bool], b: list[bool], op: str):
    add_result, carry_out = alu_add_or_sub(a, b, subtract=(op == "SUB"))
    and_result = [AND(x, y) for x, y in zip(a, b)]
    or_result = [OR(x, y) for x, y in zip(a, b)]

    result = {
        "ADD": add_result, "SUB": add_result,
        "AND": and_result, "OR": or_result,
    }[op]

    zero = not any(result)  # true iff every output bit is 0
    sign_a, sign_b, sign_r = a[-1], b[-1], result[-1]  # MSB = sign bit
    overflow = (op in ("ADD", "SUB")) and AND(XOR(sign_a, sign_r), NOT(XOR(sign_a, sign_b) if op == "ADD" else XOR(sign_a, sign_b)))
    return result, zero, overflow
```

### Step 4 — verification against hand-computed cases

```python
def test_alu_add_basic():
    a = to_bits(5, width=8)   # 5  = 00000101
    b = to_bits(3, width=8)   # 3  = 00000011
    result, zero, overflow = ALU(a, b, "ADD")
    assert from_bits(result) == 8 and not zero and not overflow

def test_alu_zero_flag():
    a = to_bits(5, width=8)
    b = to_bits(5, width=8)
    result, zero, overflow = ALU(a, b, "SUB")  # 5 - 5 = 0
    assert from_bits(result) == 0 and zero

def test_alu_signed_overflow():
    a = to_bits(127, width=8)   # max positive 8-bit signed value
    b = to_bits(1, width=8)
    result, zero, overflow = ALU(a, b, "ADD")  # 127 + 1 overflows into negative
    assert overflow, "adding 1 to the max positive signed value must overflow"
```

## Common Misconceptions & Pitfalls

- **"Subtraction needs its own dedicated adder-like circuit."** The entire design point of `designing-an-arithmetic-logic-unit` is that it does not: negating one operand via two's complement and reusing the exact same adder, as Step 2 does, is what keeps the ALU's hardware cost from doubling for a second arithmetic operation.
- **"The zero flag is a separate piece of state the ALU has to track across operations."** It is a pure, stateless function of the current result alone, every bit is 0, computed the same way regardless of which operation produced that result; no memory of prior operations is needed or used.
- **"Overflow just means the result doesn't fit in the number of bits available."** For signed two's-complement arithmetic specifically, overflow is a narrower, precise condition, the sign of the result is inconsistent with what the signs of the operands should have produced, exactly what Step 3's overflow computation checks; a carry out of the most significant bit alone is a different, unsigned-only notion this design correctly does not conflate with it.

## Summary

This lab implements the ALU `designing-an-arithmetic-logic-unit` and `alu-operation-selection-and-flags` designed on paper: a full adder chained into an N-bit ripple-carry adder, subtraction implemented by reusing that same adder against a two's-complement-negated operand rather than a second circuit, and zero and overflow flags computed directly and statelessly from the current result. Testing against hand-computed cases, ordinary addition, a subtraction landing on exactly zero, and a deliberately chosen signed-overflow case, verifies the implementation against real, checkable arithmetic rather than trusting the composition of gates to be correct by construction.

## Documentation Links

- [Nand2Tetris — Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): the real course this lab's ALU design and its build-from-gates methodology are modeled on.
- [Harris & Harris — Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): the textbook source for the adder-based ALU design and overflow-flag computation this lab implements.
