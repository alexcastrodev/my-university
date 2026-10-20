---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Explain why Hoare logic scales badly to programs with aliased pointers, and how local reasoning with a footprint fixes it.
- Read and write heap assertions: `emp`, the points-to $x \mapsto v$, and the separating conjunction $P \ast Q$ with its disjointness meaning.
- State the small axioms for heap operations and the frame rule, and use them to verify a short pointer program.
- Define an inductive predicate for linked lists, and explain how Infer's bi-abduction and Rust's ownership relate to separation logic.

## Context & Motivation

`ai-theory/formal-methods` developed Hoare logic: triples $\{P\}\ C\ \{Q\}$, rules for assignment, sequencing, conditionals, and loops with invariants. That logic works well for programs whose variables are independent. It breaks down on programs with pointers: if `x` and `y` may point to the same cell, then `{x.f = 0} y.f := 1 {x.f = 0}` is not valid, so every proof about `x` must be re-checked against every write through any other pointer, with explicit non-aliasing side conditions for each pair. The conditions grow quadratically with the number of pointers and swamp the proof.

John Reynolds, Peter O'Hearn, Samin Ishtiaq, and Hongseok Yang developed **separation logic** around 2000 to 2002, an extension of Hoare logic whose assertions describe pieces of the heap and say which pieces are disjoint. It is the basis of Meta's Infer analyzer, of the VeriFast and Viper verifiers, of the Iris framework in which the RustBelt proof was carried out, and of verified systems code in proof assistants. O'Hearn's CACM article and Reynolds's LICS 2002 paper are the standard introductions.

## Core Theory

### States and heap assertions

A program state is a **store** (variables to values) together with a **heap**, a finite partial map from addresses to values. Assertions in separation logic describe the heap:

- $\text{emp}$: the heap is empty.
- $e \mapsto v$: the heap contains exactly one cell, at address $e$, holding $v$. The notation $x \mapsto \_$ means "some value".
- $P \ast Q$ (**separating conjunction**): the heap can be split into two parts with **disjoint** addresses, one satisfying $P$ and the other $Q$. Formally, $h \models P \ast Q$ iff $h = h_1 \uplus h_2$ with $h_1$ and $h_2$ disjoint, $h_1 \models P$ and $h_2 \models Q$.
- $P \mathrel{-\!\!\ast} Q$ (the **magic wand**): extending the heap with any disjoint part satisfying $P$ yields a heap satisfying $Q$. It is used in some proofs and ignored here.
- Pure facts like $x = y$ or $x \neq \text{nil}$, which do not depend on the heap.

The key property: $x \mapsto 1 \ast y \mapsto 2$ **implies** $x \neq y$, because one cell cannot be split into two disjoint parts. Disjointness is built into the connective instead of being a side condition.

### Triples and the footprint

A separation-logic triple $\{P\}\ C\ \{Q\}$ is read in a **fault-avoiding** way: if $P$ holds before $C$ runs, then $C$ does not access any address outside the heap described by $P$ (it does not fault), and $Q$ holds afterward. $P$ therefore describes the **footprint** of $C$: exactly the memory it needs. The rules for assignments, sequencing, conditionals, and loops are those of Hoare logic.

### Small axioms and the frame rule

The heap commands have specifications that mention only the one cell they touch:

$$\{x \mapsto \_\}\ [x] := v\ \{x \mapsto v\} \qquad \{\text{emp}\}\ x := \text{alloc}()\ \{x \mapsto \_\} \qquad \{x \mapsto \_\}\ \text{dispose}(x)\ \{\text{emp}\}$$

and a read $y := [x]$ has $\{x \mapsto v\}\ y := [x]\ \{x \mapsto v \wedge y = v\}$. The rule that makes these small specifications usable is the **frame rule**:

$$\frac{\{P\}\ C\ \{Q\}}{\{P \ast R\}\ C\ \{Q \ast R\}} \quad \text{if } C \text{ does not modify any variable free in } R$$

If $C$ works correctly in the small heap $P$, it works in any larger heap $P \ast R$ and leaves the rest $R$ untouched. This is **local reasoning**: prove a specification about the footprint once and reuse it in every context. Aliasing is handled by the logic, not by hand.

### Inductive predicates for data structures

Shapes like lists and trees are defined by recursive predicates. A list segment from $x$ to $y$:

$$\text{ls}(x, y) \;\triangleq\; (x = y \wedge \text{emp}) \;\vee\; \exists v, z.\ x \mapsto (v, z) \ast \text{ls}(z, y)$$

and a complete list is $\text{list}(x) \triangleq \text{ls}(x, \text{nil})$. The $\ast$ in the recursive case says the head cell and the rest of the list occupy disjoint memory, so the list has no cycle and no sharing. Loop invariants for list-processing code are written with such predicates.

### Concurrency and tools

For two threads working on disjoint memory, **concurrent separation logic** (O'Hearn, Brookes, 2004) gives a simple rule: from $\{P_1\}\ C_1\ \{Q_1\}$ and $\{P_2\}\ C_2\ \{Q_2\}$ derive $\{P_1 \ast P_2\}\ C_1 \parallel C_2\ \{Q_1 \ast Q_2\}$. Data-race freedom follows from disjointness. Ownership of a cell can also be transferred to or from a lock.

Tools build on this in different ways. **Infer** (Meta) introduced **bi-abduction** at scale: given a procedure body, it infers a precondition (the *anti-frame*, the memory the procedure needs that the caller must provide) and a postcondition, plus the *frame* that is left untouched. Each procedure gets a summary that is reused at its call sites, which makes the analysis compositional and fast enough to run on code changes. Its current Pulse checker keeps the same compositional design and finds null dereferences, use-after-free, and leaks in C, C++, Objective-C, and Java. **VeriFast** and **Viper** are verifiers in which users annotate code with separation-logic specifications, and the Prusti tool uses Viper for Rust. **Iris** embeds higher-order concurrent separation logic in the Coq proof assistant.

### Relation to ownership types

A points-to $x \mapsto v$ says that the current thread *owns* the cell at $x$, and $\ast$ says that two owned things are disjoint. This is the logic behind single-owner moves in Rust: giving a value away is giving up its assertion. **Fractional permissions** (Boyland) refine it: $x \mapsto_{1/2} v \ast x \mapsto_{1/2} v$ is shared read-only access, and only full ownership $x \mapsto_1 v$ allows a write, which is the "many readers or one writer" rule of the previous borrow-checker concept expressed in a logic.

## Worked Examples

### Example 1: why the frame rule removes aliasing side conditions

**Problem:** Show that `[x] := 1` leaves a second cell `y` unchanged, without a hand-written side condition `x ≠ y`.

**Solution:** The small axiom gives $\{x \mapsto 0\}\ [x] := 1\ \{x \mapsto 1\}$. Apply the frame rule with $R = y \mapsto 9$ (no variable is modified by the command, so the side condition holds): $\{x \mapsto 0 \ast y \mapsto 9\}\ [x] := 1\ \{x \mapsto 1 \ast y \mapsto 9\}$. The precondition already implies $x \neq y$, because $\ast$ requires disjoint cells. The postcondition says that `y` still holds 9. If instead the caller passes `x` and `y` that might be the same cell, the precondition $x \mapsto 0 \ast y \mapsto 9$ is simply not satisfied by that heap, and the verification of the call fails.

### Example 2: freeing a linked list

**Problem:** Verify that the loop frees every node and leaves an empty heap.

```text
// {list(x)}
while (x != nil) {
    t := x.next;       // read the next pointer of the node at x
    dispose(x);        // free the node
    x := t;
}
// {emp}
```

**Solution:** Take the invariant $\text{list}(x)$. On entry it holds. Inside the loop $x \neq \text{nil}$, so unfolding the second disjunct gives $\exists v, t.\ x \mapsto (v, t) \ast \text{list}(t)$. The read gives $t$ the next pointer, `dispose` consumes the cell $x \mapsto \_$ and leaves $\text{list}(t)$ by the frame rule, and the assignment `x := t` re-establishes $\text{list}(x)$. On exit $x = \text{nil}$, so $\text{list}(x)$ unfolds to $\text{emp}$. The proof also rules out a double free: after `dispose(x)` the assertion for that cell is gone, so a second `dispose` of it would have no footprint to run on and would fail verification, and a list with a cycle would not satisfy $\text{list}(x)$ in the first place.

### Example 3: bi-abduction on a method

**Problem:** What does Infer-style analysis infer for `void setVal(Node n) { n.next.val = 1; }`?

**Solution:** Executing `n.next.val = 1` from an empty assumption fails: it needs to read the field `next` of `n` and write the field `val` of the node it points to. Abduction records these missing resources as the inferred precondition: $n \mapsto \{\text{next}: m\} \ast m \mapsto \{\text{val}: \_\}$ for some `m`. The postcondition is $n \mapsto \{\text{next}: m\} \ast m \mapsto \{\text{val}: 1\}$. This summary is stored. At a call site where the argument is known to have `next == null`, the caller cannot supply $m \mapsto \{\text{val}: \_\}$ because there is no node `m`, so the analysis reports a possible null pointer dereference there, without re-analyzing `setVal`. Any part of the caller's heap not mentioned in the summary is the *frame*, which is preserved by the frame rule.

## Common Misconceptions & Pitfalls

- **"$P \ast Q$ is just $P \wedge Q$ for different variables."** $P \wedge Q$ says both hold of the *same* heap. $P \ast Q$ says they hold of *disjoint parts* of the heap, which also gives non-aliasing.
- **"The frame rule is always applicable."** It needs the side condition that the command modifies no variable free in the frame $R$. Heap contents are protected by $\ast$, but variables are not.
- **"Separation logic is a tool for C only."** The logic applies to any language with mutable shared state: Java and Objective-C in Infer, Rust in RustBelt and Prusti, and concurrent data structures in Iris.
- **"Rust makes separation logic unnecessary."** Rust's borrow checker is a fixed, automatic instance of its ideas (ownership, disjointness). Separation logic is the general setting in which that instance, and the `unsafe` code beneath it, is proved correct.

## Summary

Hoare logic needs non-aliasing side conditions for every pair of pointers, which does not scale. Separation logic adds heap assertions, the points-to $x \mapsto v$ and the separating conjunction $P \ast Q$ for disjoint parts, with fault-avoiding triples that describe a command's footprint. Small axioms for heap commands plus the frame rule give local reasoning: prove a specification about the footprint and extend it to any context. Inductive predicates such as $\text{list}(x)$ describe data structures, concurrent separation logic gives a rule for threads on disjoint memory, and bi-abduction in Infer infers footprints automatically. Ownership types are a restricted, automatic form of the same idea. The next concept moves from proving to testing, where the program's inputs are generated rather than reasoned about: coverage-guided fuzzing.

## Documentation Links

- [Reynolds: Separation Logic: A Logic for Shared Mutable Data Structures (LICS 2002)](https://www.cs.cmu.edu/~jcr/seplogic.pdf): doc
- [O'Hearn: Separation Logic (Communications of the ACM, 2019)](https://dl.acm.org/doi/10.1145/3211968): doc
- [Infer documentation: Separation Logic and Bi-abduction](https://fbinfer.com/docs/separation-logic-and-bi-abduction): doc
- [Software Foundations, Volume 6: Separation Logic Foundations](https://softwarefoundations.cis.upenn.edu/slf-current/index.html): doc
