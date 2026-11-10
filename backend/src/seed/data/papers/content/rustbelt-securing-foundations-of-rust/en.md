---
title: "RustBelt: Securing the Foundations of the Rust Programming Language"
summary: The first machine-checked proof of safety for a realistic subset of Rust, built so that each library that uses unsafe code gets a precise condition to meet in order to count as a sound extension of the language.
researchArea: Programming Languages
keywords: rust, memory safety, ownership, separation logic, type soundness, unsafe code
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Rust promises the low-level control of C++ with the memory and thread safety of a high-level language, and it does this with an ownership-based type system that rules out data races and use-after-free at compile time. The promise was widely believed but not proven. The difficulty is that the safe part of Rust is not self-contained: standard libraries such as `Rc`, `RefCell` and `Mutex` are written with `unsafe` code inside, and the type system treats their interfaces as safe. Soundness bugs had in fact been found, in the type system and in libraries.

This POPL 2018 paper, by researchers at MPI-SWS and Delft, gives a formal and machine-checked account of how those pieces fit together and of what it takes for a library with unsafe internals to be safe to use.

Worth knowing first: Rust's ownership and borrowing (including lifetimes), what `unsafe` allows, the idea of type soundness (well-typed programs do not go wrong), and a rough sense of what a program logic such as separation logic is.

## Contribution

- **λRust**, a core language of the authors' design, in continuation-passing style, that formalizes the central features of Rust: ownership, borrowing, lifetimes and lifetime inclusion, modeled after the compiler's intermediate representation (MIR).
- **A semantic soundness proof.** Types are interpreted as predicates in a program logic (a logical relation), instead of using the usual syntactic "progress and preservation" method, which does not work when safe and unsafe code mix.
- **A verification condition for unsafe code.** For any library, the semantic meaning of its interface says exactly what its unsafe implementation has to prove. That makes the result extensible.
- **A lifetime logic** to reason about borrows, built on the Iris framework.
- **Verified libraries.** Proofs, in the Coq proof assistant, for λRust versions of `Arc`, `Rc`, `Cell`, `RefCell`, `Mutex`, `RwLock`, `mem::swap`, `thread::spawn`, `rayon::join` and `take_mut`.

## Methodology

The proof has three parts. First, the typing rules of λRust are shown sound when read semantically (the fundamental theorem of logical relations). Second, an adequacy result: a closed program that is semantically well typed has no undefined behavior. Third, for each library with unsafe code, a proof that its implementation satisfies the predicate that its interface gives it.

To model borrowing, the authors define a lifetime logic that supports the idea that a lifetime can end and give back ownership, and a new way of proving lifetime inclusion for lifetimes that are not yet known to be active, which they found necessary for types like `RefCell` and `RwLock`. All of this is formalized and checked in Coq.

## Findings

These are the authors' reported results.

- The safety proof holds for λRust, and extends to the verified libraries without changing the core proof.
- The verification work uncovered and led to the fix of a previously unknown soundness bug in Rust's standard library (the paper points to a separate report for the details). The model also handles functions that are correct for subtle reasons, such as `Ref::map`, whose signature had to change from the initial design to be sound. The authors take this as evidence that the model is realistic enough to be useful.
- The type system already covers features that Rust itself was still sketching, such as non-lexical lifetimes.

## Critical Analysis

The paper is a landmark, and it is also honest about what it leaves out. Reading these limits is part of using the result.

- **A subset of Rust.** λRust omits traits, proper support for type-polymorphic functions and unsized types. A proof about a model is only as good as the fit between the model and the real compiler, and Rust has no official formal semantics to measure that fit.
- **Simplified concurrency.** The memory model has non-atomic and sequentially consistent atomic operations only. The relaxed atomics that libraries such as `Arc` use in practice are not modeled. This is also the case for trait objects and for stack unwinding on panic.
- **Cost of the method.** Each new unsafe library needs its own proof by experts in a proof assistant, so the approach does not scale to the whole ecosystem by itself, and it is a tool for library authors and not for everyday Rust programmers.
- **What is proven is safety, not correctness.** A verified `Mutex` is safe to use; the proof does not say that programs built on it are free of deadlocks or logic errors.
- **Destruction.** The proofs cover the destructors of the verified libraries but not automatic destruction, which had already caused problems.

## Further Research

- Modeling relaxed memory, trait objects and panics, and bringing λRust closer to MIR.
- Verifying more of the standard library and popular crates, with tool support that lowers the proof effort.
- Automated checking that an unsafe block meets its verification condition.
- Using the same style of semantic safety proofs for other languages that mix safe and unsafe code.
