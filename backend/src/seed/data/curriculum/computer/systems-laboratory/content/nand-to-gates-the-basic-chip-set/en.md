---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a NAND primitive and compose it into NOT, AND, OR, and XOR gates, verifying each against its own complete truth table.
- Implement a 2-to-1 multiplexer (MUX) from the gates above, and explain why a MUX is the component every later control-logic decision in this arc reduces to.
- Design a small test harness that checks a gate's output against every row of its truth table automatically, rather than spot-checking a few inputs by hand.
- Explain why building gates out of a single primitive, rather than treating AND/OR/NOT as separately given, matters for what comes later in this lab arc.

## Context & Motivation

**NAND as a Universal Gate** already made the theoretical case: every other logic gate is expressible using NAND alone, a real, mathematically complete result, not a curiosity. This lab is where that proof stops being an argument on paper and starts being code that actually runs, composing a single NAND primitive into a small chip set, NOT, AND, OR, XOR, and a multiplexer, each one verified mechanically against its full truth table. This is the first lab of this discipline's CPU-building arc, and every later lab, the ALU in Lab 2, the register file and RAM in Lab 3, the complete CPU in Lab 4, is built entirely out of the gates assembled here, exactly the sequence Nand2Tetris's own Build a Modern Computer course follows.

## Core Theory

Nothing about *why* NAND is universal is re-derived here, that argument belongs to `nand-as-a-universal-gate`; this lab is the discipline of turning it into working, tested code. A gate here is modeled simply, as a pure function from a fixed number of boolean inputs to a boolean output, composed from calls to more primitive gates, exactly mirroring how a real hardware description language expresses combinational logic.

## Worked Examples

### API specification

```text
NAND(a: bool, b: bool) -> bool          # the ONLY given primitive
NOT(a: bool) -> bool                     # built from NAND alone
AND(a: bool, b: bool) -> bool            # built from NAND/NOT
OR(a: bool, b: bool) -> bool             # built from NAND/NOT
XOR(a: bool, b: bool) -> bool            # built from AND/OR/NOT
MUX(a: bool, b: bool, sel: bool) -> bool # returns a if sel==0, else b
```

### Step 1 — the one given primitive

```python
def NAND(a: bool, b: bool) -> bool:
    return not (a and b)  # the platform's own "and"/"not" here stand in
                            # for a real transistor-level NAND gate; every
                            # OTHER gate below is built using ONLY this
                            # function, never Python's built-in and/or/not
```

### Step 2 — NOT and AND, built from NAND alone

```python
def NOT(a: bool) -> bool:
    return NAND(a, a)  # NAND(a,a) = not(a and a) = not(a)

def AND(a: bool, b: bool) -> bool:
    return NOT(NAND(a, b))  # NAND is "not AND"; NOT-ing it undoes that
```

### Step 3 — OR and XOR, composed from what already exists

```python
def OR(a: bool, b: bool) -> bool:
    return NAND(NOT(a), NOT(b))  # De Morgan's law, built as circuitry,
                                    # not just asserted as an algebra fact

def XOR(a: bool, b: bool) -> bool:
    return AND(OR(a, b), NOT(AND(a, b)))  # true iff exactly one input is true
```

### Step 4 — the multiplexer, the component everything later reduces to

```python
def MUX(a: bool, b: bool, sel: bool) -> bool:
    return OR(AND(a, NOT(sel)), AND(b, sel))
```

### Step 5 — a test harness that checks the FULL truth table, not a few cases

```python
def check_truth_table(gate_fn, expected: dict, arity: int):
    import itertools
    for inputs in itertools.product([False, True], repeat=arity):
        got = gate_fn(*inputs)
        want = expected[inputs]
        assert got == want, f"{gate_fn.__name__}{inputs}: got {got}, want {want}"

check_truth_table(XOR, {
    (False, False): False, (False, True): True,
    (True, False): True,   (True, True): False,
}, arity=2)
```

## Common Misconceptions & Pitfalls

- **"Using Python's built-in `and`/`or`/`not` inside these functions is a harmless shortcut."** It defeats the entire point: the lab's claim is that every gate is expressible in NAND alone, and reaching for a different, already-given primitive anywhere in the implementation, even once, breaks that claim silently, since the code will still pass its own tests while no longer demonstrating what it is meant to demonstrate.
- **"Spot-checking a gate on one or two inputs is enough before moving to the next one."** A gate's definition is its complete truth table; a bug that only shows up on one specific, untested input combination (a common source of real errors in a hand-composed OR or XOR) survives undetected until a much later lab, where it is far harder to trace back to its actual source.
- **"The multiplexer is just one more gate among several, no more important than the others."** Every later lab in this arc, the ALU's operation-select logic, the register file's write-enable logic, the CPU's own instruction decoding, is built out of multiplexers choosing between signals based on a control bit; understanding it here, at its simplest, pays off directly in every lab that follows.

## Summary

This lab turns `nand-as-a-universal-gate`'s theoretical proof into working, individually tested code: a single NAND primitive composed step by step into NOT, AND, OR, XOR, and a multiplexer, each verified against its complete truth table rather than spot-checked. This chip set is the literal foundation every later lab in this arc builds on, Lab 2's ALU, Lab 3's register file and RAM, and Lab 4's complete CPU all reduce, ultimately, to compositions of the gates assembled here.

## Documentation Links

- [Nand2Tetris — Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): the real course this lab and its entire CPU-building arc are modeled on, beginning with exactly this NAND-to-gates progression.
- [MIT 6.004 — Combinational Logic Unit](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/c4/): a second, independent real course covering the same combinational-logic foundations this lab implements.
