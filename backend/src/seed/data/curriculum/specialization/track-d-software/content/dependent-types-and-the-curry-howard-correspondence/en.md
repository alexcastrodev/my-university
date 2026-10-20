---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- State the Curry-Howard correspondence between propositions and types, proofs and programs, and use it to translate a logical statement into a type.
- Define dependent function types ($\Pi$) and dependent pair types ($\Sigma$), and write a length-indexed vector whose `head` cannot be applied to an empty vector.
- Explain why dependent type checking needs evaluation inside types and why the language must be total.
- Compare dependent types with refinement types, contracts, and tests as ways to state specifications, with their cost.

## Context & Motivation

The previous concepts built a ladder of type systems: simply typed lambda calculus, System F (types depend on types), subtyping, and ownership. The next rung is to let types depend on **values**. `ai-theory/formal-methods` presented theorem provers and proof assistants as tools for proving programs correct, and treated the type theory under them as a black box. This concept opens it.

The key observation, due to Curry and Howard, is that the typing rules of the lambda calculus are the inference rules of a logic. A type is a proposition, a program of that type is a proof of it, and normalizing a program is simplifying a proof. Extend the types to depend on values and you get predicate logic: a type can say "a sorted list of length $n$", and a program of that type is a proof that the property holds. This is the foundation of Lean, Coq/Rocq, Agda, and Idris. The same machinery has verified a C compiler (CompCert, in Coq), a cryptographic library (HACL*, in F*), and large pieces of mathematics (Mathlib, in Lean). Wadler's "Propositions as Types" and the *Logical Foundations* volume of Software Foundations are the standard introductions.

## Core Theory

### Propositions as types

| Logic | Type theory |
|---|---|
| proposition $P$ | type $A$ |
| proof of $P$ | term (program) of type $A$ |
| $P \wedge Q$ (and) | pair type $A \times B$ |
| $P \vee Q$ (or) | sum type $A + B$ |
| $P \to Q$ (implies) | function type $A \to B$ |
| $\top$ (true) | unit type (one value) |
| $\bot$ (false) | empty type (no value) |
| $\forall x{:}A.\ P(x)$ | dependent function type $\Pi x{:}A.\ B(x)$ |
| $\exists x{:}A.\ P(x)$ | dependent pair type $\Sigma x{:}A.\ B(x)$ |
| proof simplification | evaluation (normalization) |

The simply typed lambda calculus corresponds to intuitionistic propositional logic, System F to second-order propositional logic, and dependent types to predicate logic. A proof of $P \wedge Q \to Q \wedge P$ is the function that swaps a pair. A proof of $\neg P$ is a function $P \to \bot$. There is no closed term of type $\bot$ in a consistent system, which is what "consistent" means.

### Dependent types

A **dependent function type** $\Pi x{:}A.\ B(x)$ is a function whose result type may mention the argument; a **dependent pair** $\Sigma x{:}A.\ B(x)$ is a pair whose second component's type depends on the first. The standard example is a vector indexed by its length: `Vec α n` is a list of `n` elements of type `α`. The type of `append` can say `Vec α m → Vec α n → Vec α (m + n)`, and `head` can demand `Vec α (n + 1)`, so that applying it to an empty vector is not a run-time error but a type error. A function that returns "an `x` such that `P x`" returns a $\Sigma$ pair: a witness together with a proof about it.

### Types need computation

When types contain terms, deciding whether two types are equal requires evaluating those terms: `Vec α (2 + 2)` and `Vec α 4` are the same type because `2 + 2` reduces to `4`. The type checker therefore contains an evaluator, and equality of types is **definitional equality** (equality up to computation). A proof that two expressions are equal but not by computation, such as `n + 0 = 0 + n`, has to be written out, usually by induction.

### Totality and consistency

If general recursion were allowed, `def loop : False := loop` would define a "proof" of falsity and the logic would collapse, since every proposition would be provable. Dependent type theories therefore require every function to terminate, checked by structural recursion on an inductive argument or by an explicit well-founded measure, and require inductive types to satisfy a *positivity* condition. This is the strong normalization property from System F, extended. The price is that such a language is deliberately not Turing complete; programs that must diverge (servers, interpreters) are modeled with explicit fuel or coinduction.

### Constructive proofs and induction

Proofs here are *constructive*: a proof of $\exists x.\ P(x)$ must produce an $x$, and the law of excluded middle is not derivable (Lean provides it as an explicit axiom, `Classical.em`, when you want it). A proof by induction on a natural number is a recursive function, and the termination check on it is the check that the induction is well-founded.

### Cheaper points on the same spectrum

Full dependent types are the most expressive and the most expensive option. **Refinement types** (Liquid Haskell, F*) attach a decidable predicate to a base type, `{v : Int | v > 0}`, and discharge the obligations with an SMT solver, as in `ai-theory/formal-methods`. **Contracts** (Eiffel, JML, Dafny) check specifications at run time or statically. **Tests** check examples only. In ordinary languages, "make illegal states unrepresentable" with a sealed hierarchy or a validated record is the same instinct at small scale. The more you want the type checker to prove, the more proof you write.

## Worked Examples

### Example 1: a logical statement as a program

**Problem:** Prove, in Lean 4, that $p \wedge q \to q \wedge p$, and read it as a program.

```text
theorem and_swap (p q : Prop) : p ∧ q → q ∧ p :=
  fun h => ⟨h.2, h.1⟩
```

**Solution:** The proposition `p ∧ q → q ∧ p` is a function type from a pair to a pair. The proof takes the evidence `h` of `p ∧ q`, takes its second component `h.2 : q` and first component `h.1 : p`, and builds a new pair. It is the program `swap : A × B → B × A`. The proof checker accepts it because the term has the stated type, with no separate "proof checking" step beyond type checking.

### Example 2: length-indexed vectors

**Problem:** Define vectors whose type records their length, a total `head`, and a `map` that provably preserves the length.

```text
inductive Vec (α : Type) : Nat → Type where
  | nil  : Vec α 0
  | cons : {n : Nat} → α → Vec α n → Vec α (n + 1)

def Vec.head {α : Type} {n : Nat} : Vec α (n + 1) → α
  | .cons x _ => x

def Vec.map {α β : Type} {n : Nat} (f : α → β) : Vec α n → Vec β n
  | .nil       => .nil
  | .cons x xs => .cons (f x) (Vec.map f xs)
```

**Solution:** `nil` has length 0 and `cons` adds one. `head` accepts only `Vec α (n + 1)`, so it needs no case for `nil`: the compiler sees that a vector of length `0` cannot be of length `n + 1`, and `Vec.head .nil` fails to type check, rather than throwing at run time as Java's `List.getFirst()` does on an empty list (`NoSuchElementException`). In `map`, the declared result `Vec β n` is checked against both branches: `nil` gives length 0 and `cons` gives `(n' + 1)`, so a `map` that dropped or duplicated an element would be rejected.

### Example 3: a proof by induction is a recursive function

**Problem:** Prove that $0 + n = n$ for all natural numbers $n$ (this is not true by computation, because addition recurses on its second argument, so `n + 0` reduces to `n` but `0 + n` does not).

```text
theorem zero_add' : (n : Nat) → 0 + n = n
  | 0     => rfl
  | n + 1 => congrArg Nat.succ (zero_add' n)
```

**Solution:** The base case `0 + 0 = 0` holds by computation (`rfl`, reflexivity of equality). In the step, `0 + (n + 1)` reduces by the definition of addition to `Nat.succ (0 + n)`, and the recursive call `zero_add' n` proves `0 + n = n`. Applying `congrArg Nat.succ` to that equation gives `Nat.succ (0 + n) = Nat.succ n`, which is the goal. The proof is a recursive function calling itself on a smaller argument, and the termination checker verifies that the recursion is on a structurally smaller `n`: circular reasoning would be rejected.

## Common Misconceptions & Pitfalls

- **"Dependent types just move checks to compile time."** They do more: a proof must exist for every use, including the cases the program never reaches. Where a run-time check can say "this input is bad", a type has to rule it out or the caller must supply evidence.
- **"If it type checks, the program is correct."** It is correct *with respect to the stated type*. A wrong specification (a `sort` whose type forgets to require a permutation of the input) verifies fine. Specifications need as much review as code.
- **"Curry-Howard says every program is a proof."** Only in a terminating, consistent type theory. A Java method that loops forever has the type `int` and proves nothing.
- **"These systems are only for mathematicians."** CompCert, HACL*, and verified file systems and cryptography show industrial uses, but the cost is high: proof engineering is often several times the size of the program, and proofs break when the code is refactored.

## Summary

Under the Curry-Howard correspondence, propositions are types, proofs are programs, implication is the function type, conjunction is the pair, and evaluation is proof simplification. Letting types depend on values adds $\Pi$ and $\Sigma$ types, which correspond to universal and existential quantification, and lets a type like `Vec α (n + 1)` rule out whole classes of run-time errors. Type checking then needs evaluation inside types, and consistency forces totality, so these languages are deliberately not Turing complete. Refinement types, contracts, and tests sit at cheaper points on the same spectrum of how much a specification is checked. The next concept returns to the analysis of ordinary programs, which are partial and imperative, with abstract interpretation.

## Documentation Links

- [Theorem Proving in Lean 4](https://lean-lang.org/theorem_proving_in_lean4/): doc
- [Wadler: Propositions as Types (Communications of the ACM, 2015)](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf): doc
- [Software Foundations, Volume 1: Logical Foundations](https://softwarefoundations.cis.upenn.edu/lf-current/index.html): doc
