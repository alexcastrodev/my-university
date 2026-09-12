---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a D flip-flop as a clocked, single-bit memory primitive, and explain why combinational logic alone, built from Lab 1's gates, cannot remember anything across clock cycles on its own.
- Compose flip-flops into a multi-bit register with a load-enable signal that controls whether a clock edge actually updates the stored value.
- Compose an addressable array of registers, gated through a decoder built from Lab 1's gates, into a small, working RAM.
- Verify that a register only updates on a load-enable signal, and that RAM correctly isolates writes to the addressed word without disturbing any other word.

## Context & Motivation

Every gate built in Lab 1, and every ALU built in Lab 2, is combinational: its output depends only on its current inputs, with no memory of anything that came before. **From Flip-Flops to a Register File** and **RAM Organization and Address Decoding** already made the theoretical case for what closes that gap: a clocked storage primitive, the flip-flop, that holds a value across clock cycles until deliberately told to change. This lab builds that primitive and composes it, first into a register, then into RAM, completing the second-to-last piece Lab 4's full CPU needs.

## Core Theory

Nothing about *why* combinational logic cannot remember state, or *why* a clock edge is the right moment to allow an update, is re-derived here; that argument belongs to `from-flip-flops-to-a-register-file`. This lab implements the design already worked out there: a flip-flop modeled as a small object carrying explicit state between calls (deliberately different from every gate in Labs 1 and 2, which were pure, stateless functions), and a decoder, built from ordinary combinational gates, selecting exactly one register out of many by address.

## Worked Examples

### API specification

```text
class DFlipFlop:
    def tick(self, data_in: bool, load: bool) -> bool
        # On a simulated clock edge: if load is True, stores data_in and
        # returns it; if load is False, keeps the PREVIOUS stored value
        # and returns that instead.

class Register(width: int):
    def tick(self, data_in: list[bool], load: bool) -> list[bool]

class RAM(address_bits: int, word_width: int):
    def read(self, address: list[bool]) -> list[bool]
    def tick(self, address: list[bool], data_in: list[bool], write: bool) -> None
```

### Step 1 — the D flip-flop, the one genuinely stateful primitive in this arc

```python
class DFlipFlop:
    def __init__(self):
        self._stored = False  # this IS the memory; every gate in Labs 1-2
                                # had no equivalent of this at all

    def tick(self, data_in: bool, load: bool) -> bool:
        if load:
            self._stored = data_in
        # else: _stored is left exactly as it was — this is what
        # "remembering across cycles" actually means in code
        return self._stored
```

### Step 2 — a register, N flip-flops ticking together

```python
class Register:
    def __init__(self, width: int):
        self._bits = [DFlipFlop() for _ in range(width)]

    def tick(self, data_in: list[bool], load: bool) -> list[bool]:
        return [ff.tick(bit, load) for ff, bit in zip(self._bits, data_in)]
```

### Step 3 — a decoder built from Lab 1's own gates

```python
def decoder(address: list[bool]) -> list[bool]:
    # Returns a one-hot list: exactly one True at the index matching
    # `address`'s binary value, everything else False — built entirely
    # from AND/NOT, Lab 1's own gates, nothing new introduced here.
    n = len(address)
    outputs = []
    for i in range(2 ** n):
        target_bits = to_bits(i, width=n)
        match = True
        for a_bit, t_bit in zip(address, target_bits):
            match = AND(match, a_bit if t_bit else NOT(a_bit))
        outputs.append(match)
    return outputs
```

### Step 4 — RAM: registers, gated by the decoder

```python
class RAM:
    def __init__(self, address_bits: int, word_width: int):
        self._registers = [Register(word_width) for _ in range(2 ** address_bits)]

    def read(self, address: list[bool]) -> list[bool]:
        select = decoder(address)
        idx = select.index(True)
        return self._registers[idx].tick([False] * len(self._registers[0]._bits), load=False)
        # ticking with load=False is a READ: it returns the current
        # value without changing it, reusing tick() rather than a
        # separate read path

    def tick(self, address: list[bool], data_in: list[bool], write: bool) -> None:
        select = decoder(address)
        for reg, is_selected in zip(self._registers, select):
            reg.tick(data_in, load=AND(write, is_selected))
            # every UNSELECTED register still ticks, but with load=False,
            # so it keeps its old value — this is what isolates the write
            # to exactly one addressed word
```

## Common Misconceptions & Pitfalls

- **"A register can be modeled the same way as a gate, as a pure function of its current inputs."** A gate's output depends only on its current inputs; a register's output on a given cycle depends on its *stored* value, which depends on its entire history of prior loads, which is exactly why `DFlipFlop` needs real internal state (`self._stored`) that every gate in Labs 1 and 2 deliberately had none of.
- **"Writing to RAM means calling `load=True` only on the one register being addressed and leaving the others untouched."** Step 4's `tick` calls every register on every write, but with `load` computed per-register as `write AND is_selected`; an unselected register still runs its own `tick`, just with `load=False`, which is what correctly leaves its value unchanged rather than leaving it in some undefined, un-clocked state.
- **"Reading from RAM should be a separate, non-clocked operation from writing."** Modeling a read as a `tick` call with `load=False`, as Step 4 does, keeps the same clocked-primitive discipline consistent across the whole component; treating read and write as fundamentally different mechanisms tends to introduce exactly the kind of asymmetric bug a decoder-driven design is meant to avoid.

## Summary

This lab implements the one genuinely stateful primitive this whole CPU-building arc depends on, the D flip-flop, holding a value across simulated clock cycles until a load signal permits it to change, then composes flip-flops into a register and, via a decoder built entirely from Lab 1's own combinational gates, composes registers into an addressable RAM. Correctly isolating a write to exactly the addressed word, by ticking every register on every cycle but computing each one's own `load` signal from the decoder's one-hot output, is the specific design this lab's tests verify, matching `from-flip-flops-to-a-register-file` and `ram-organization-and-address-decoding`'s own account of how sequential and combinational logic combine.

## Documentation Links

- [Nand2Tetris — Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): the real course this lab's flip-flop-to-register-to-RAM progression is modeled on.
- [MIT 6.004 — Combinational Logic Unit](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/c4/): a second, independent real course covering the decoder and address-based selection logic implemented here.
