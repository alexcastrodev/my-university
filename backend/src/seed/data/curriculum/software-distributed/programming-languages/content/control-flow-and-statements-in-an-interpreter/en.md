---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement `if`, `while`, and sequences of statements as ordinary AST node types with their own `eval`/`exec` branches, no different in kind from any other node.
- Distinguish an EXPRESSION (evaluates to a value) from a STATEMENT (executed for its effect, e.g. mutating an environment), and explain why this distinction matters for an interpreter's design.
- Trace a `while` loop's execution as repeated re-evaluation of its condition and body, driven entirely by ordinary recursive `eval`/`exec` calls with no special loop machinery in the interpreter itself.
- Explain why control flow needs no fundamentally new interpreter mechanism beyond what evaluating an `if` already required.
- Connect this concept's control-flow handling back to the assembly-level translation of `if`/`while`/`for` already covered in `c-and-assembly`, contrasting the two levels honestly.

## Context & Motivation

It might seem like control flow — `if`, `while`, `for` — needs some genuinely new kind of interpreter machinery: a special "loop engine," perhaps, distinct from ordinary expression evaluation. This concept's central point is that it doesn't. An `if` was already implemented, in full, back when the interpreter's core `eval` function was first built — the `IfExpr` case simply evaluates its condition and recurses into whichever branch the result selects. A `while` loop turns out to need nothing more exotic: an AST node whose `exec` (or `eval`) case re-evaluates its condition and, if true, executes its body and then RECURSES ON ITSELF — ordinary function recursion, already covered extensively, doing all the "looping" work with no extra interpreter-level construct required.

This is worth stating explicitly because `c-and-assembly` already covered how `if`/`while`/`for` translate to CONDITIONAL BRANCH instructions at the machine-code level — real jumps, real comparison flags, a genuinely different mechanism (control transferring to a different instruction address) than anything at the interpreter level. Contrasting the two honestly is instructive: at the hardware level, control flow is a jump; at the tree-walking interpreter level, exactly the same control flow is ordinary function-call recursion in the HOST language (Python, in this discipline's running implementation) that the interpreter itself is written in.

## Core Theory

### Expressions vs. statements

An EXPRESSION evaluates to a value — `2 + 3`, `if x then y else z`, a function call. A STATEMENT is executed for its EFFECT — a variable assignment that mutates an environment, a `print`, a loop — and in many language designs doesn't produce a meaningful value at all (or produces a placeholder "unit" value). Some languages blur this distinction (in many functional languages, even an `if` used as a statement still technically "evaluates" to something); this discipline's interpreter keeps both `eval` (for expressions) and a parallel `exec` (for statements) to keep the distinction explicit and pedagogically clear, following the same separation Crafting Interpreters' own "Statements and State" chapter introduces.

### `while` as ordinary recursion, not a special primitive

```python
def exec(stmt, env):
    match stmt:
        case ExprStmt(expr):
            eval(expr, env)
        case WhileStmt(cond, body):
            if eval(cond, env):
                exec(body, env)
                exec(stmt, env)          # recurse on the SAME while-node — this IS the loop
        case BlockStmt(statements):
            for s in statements:
                exec(s, env)
```

Notice `exec(stmt, env)` in the `WhileStmt` case — the function calls itself again with the EXACT SAME `stmt` (the while-loop's own AST node), not a different one. Every "iteration" of the source-level loop is one more level of recursive call in the HOST language (Python) that the interpreter is implemented in. This is precisely why control flow needed no new mechanism: it's `eval`/`exec` recursion, the same recursive call structure already used everywhere else in this interpreter, simply applied to a node that happens to check its own condition again before deciding whether to recurse.

```mermaid
flowchart TB
    A["exec(WhileStmt, env)"] --> B{eval(cond, env)}
    B -->|true| C["exec(body, env)"]
    C --> D["exec(WhileStmt, env) — same node, recurse"]
    D --> B
    B -->|false| E["return — loop is done"]
```

### Contrast with the machine-code level

`c-and-assembly`'s `translating-control-flow-if-while-for` concept already showed what a `while` loop becomes at the ISA level: a labeled instruction address, a compare instruction setting condition-code flags, and a conditional branch instruction that jumps BACK to the label if the condition still holds — real control transfer to a different program-counter value, executed by dedicated CPU hardware. This concept's `while` implementation achieves the exact same source-level behavior through an entirely different mechanism: ordinary function-call recursion in whatever language the interpreter itself happens to be written in. Both are legitimate, correct implementations of "loop while a condition holds" — they simply operate at different levels of the system, one in silicon, one in host-language function calls.

## Worked Examples

### Example 1: Tracing a `while` loop counting down from 2

Source: `while (x > 0) { x = x - 1 }`, starting with `x` bound to `2`:

```text
exec(WhileStmt(cond, body), env)     [x = 2]
  eval(cond, env) = (2 > 0) = True
  exec(body, env)                     → env.define("x", 1)
  exec(WhileStmt(cond, body), env)   [recursive call, x = 1]
    eval(cond, env) = (1 > 0) = True
    exec(body, env)                   → env.define("x", 0)
    exec(WhileStmt(cond, body), env) [recursive call, x = 0]
      eval(cond, env) = (0 > 0) = False
      return                          # loop terminates, no further recursion
```

Two full iterations, each one an additional level of RECURSIVE CALL in the host interpreter — the source-level "loop" and the interpreter's own call-stack depth are directly correlated here, a genuinely different resource-usage profile from a compiled `while` loop (which reuses the exact same instruction address on every iteration, at constant stack depth).

### Example 2: Sequencing statements in a block

```text
BlockStmt([
    ExprStmt(AssignExpr("x", NumExpr(1))),
    ExprStmt(AssignExpr("y", BinaryExpr("+", VarExpr("x"), NumExpr(1)))),
])
```

`exec` on this `BlockStmt` simply iterates its list, calling `exec` on each statement in order, threading the SAME environment through each — so the second statement's `eval` of `x` correctly sees the value `1` that the first statement just bound. Sequencing, like looping, needs no special mechanism beyond "run these, one after another, sharing the same environment."

### Example 3: The honest cost, made concrete with a number

```text
A while-loop that runs 100,000 iterations, under this discipline's tree-walking
implementation, adds up to 100,000 levels of RECURSIVE exec() calls in the host
language before the first one returns — a real, measurable difference from a
compiled loop (c-and-assembly's version), which reuses ONE instruction address
100,000 times at CONSTANT stack depth, never growing the call stack at all.

Practical consequence: a sufficiently long-running loop in this style of naive
tree-walking interpreter can exhaust the HOST language's own call-stack limit
(Python's default recursion limit, for instance) — a real implementation
constraint, not a purely theoretical one.
```

Production tree-walking interpreters typically restructure loop execution as an actual host-language LOOP (not recursion) specifically to avoid this — an optimization this discipline's simplified presentation deliberately sets aside in favor of showing the cleanest possible connection between "loop" and "recursion."

## Common Misconceptions & Pitfalls

- **"An interpreter needs a fundamentally different mechanism to handle loops versus conditionals."** It doesn't — both are ordinary AST node types with their own `eval`/`exec` branch, and a `while`'s "looping" is nothing more than that branch recursing on its own node, exactly the same recursive-call technique used for every other construct in this interpreter.
- **"Since `c-and-assembly` already covered how `while` compiles to branches, this concept is redundant."** They describe genuinely different mechanisms at genuinely different levels — a labeled jump address and condition-code flags at the hardware level, versus host-language function-call recursion at the tree-walking-interpreter level — both correct, neither redundant with the other.
- **"Expressions and statements are really the same thing, just called by different names."** Many real languages do blur the line (some let an `if`-as-statement still produce a value), but the underlying distinction — evaluates to a value vs. executed for effect — is real and worth keeping explicit, which is exactly why this interpreter keeps separate `eval` and `exec` functions rather than merging them.
- **"Recursive-call-based looping is 'wrong' or a bug, since it uses stack depth proportional to iteration count."** It's a real, acknowledged cost of the simplest possible tree-walking implementation (shown honestly in Example 3), not a defect in the underlying idea of using recursion for control flow — production interpreters address it with an explicit optimization (restructuring loop execution as a host-language loop), which this discipline's introductory treatment sets aside for clarity.

## Summary

`if`, `while`, and statement sequencing require no new interpreter mechanism beyond what evaluating an `if` already introduced: each is an ordinary AST node type with its own `eval`/`exec` branch, and a `while`'s looping behavior is exactly its `exec` branch recursing on its own AST node as long as its condition holds — ordinary host-language function recursion, not a special loop construct. This mirrors, at the interpreter level, the same control-flow constructs `c-and-assembly` already showed compiling to labeled conditional-branch instructions at the machine-code level — two entirely different, both legitimate implementations of the identical source-level behavior, at two different layers of the system. The honest cost of the recursion-based approach — stack depth proportional to iteration count — is a real, acknowledged tradeoff of this discipline's simplest-possible tree-walking presentation.

## Documentation Links

- [Nystrom — Crafting Interpreters, Ch. 9 (Control Flow)](https://craftinginterpreters.com/control-flow.html) — a complete, real control-flow implementation following this exact expression/statement structure.
- [ACM/IEEE CS2013 — Programming Languages Knowledge Area](https://csed.acm.org/knowledge-areas-programming-languages-pl-cs2013-version/) — covers control-flow constructs as core language-implementation material.
