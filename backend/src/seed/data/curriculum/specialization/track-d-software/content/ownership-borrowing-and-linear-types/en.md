---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Explain linear, affine, and relevant types as type systems that drop one of the structural rules (weakening, contraction) of ordinary types.
- State Rust's ownership rules and the borrowing discipline "many readers or one writer", and predict which programs the borrow checker accepts.
- Read the common borrow-checker errors (use after move, conflicting borrows, a reference that outlives its referent) and say which bug each one prevents.
- Explain what `unsafe` is for, what RustBelt proved, and how ownership relates to separation logic.

## Context & Motivation

`computer/c-and-assembly` catalogued the memory bugs of manual management: leaks, dangling pointers, double frees, and buffer overflows. `software-distributed/programming-languages` showed the other classical answer, automatic memory management by reference counting or tracing garbage collection, which removes those bugs at the price of run-time work and less predictable latency. Both Microsoft and the Chromium project have reported that around 70% of their serious security vulnerabilities were memory-safety bugs, which is why a third answer matters: a type system that proves memory safety at compile time and leaves no run-time cost.

That third answer rests on a piece of logic from the 1980s. In Girard's **linear logic** a hypothesis is a resource that can be used exactly once, and the corresponding **substructural type systems** use the same idea for values. Rust (stable since 2015) is the first widely deployed language built around it, and its ownership and borrowing rules have influenced C++ safety guidelines and the noncopyable types added to Swift. The Rust Book chapter on ownership is the standard introduction; this concept adds the type-theoretic reading and the proof that it is sound.

## Core Theory

### Structural rules and what to drop

An ordinary type system lets you use a variable as many times as you like and ignore it if you wish. In logic terms it has three **structural rules**: *exchange* (the order of hypotheses does not matter), *weakening* (a hypothesis may be unused), and *contraction* (a hypothesis may be used more than once). Substructural systems drop some of these:

| System | Drops | Rule for each value | Typical use |
|---|---|---|---|
| Ordinary | nothing | any number of uses | most languages |
| Affine | contraction | at most once | Rust moves |
| Relevant | weakening | at least once | must-use results |
| Linear | both | exactly once | resources that must be released |

"Use once" is exactly what a resource with an owner needs: a heap allocation, a file, a lock guard, or a socket must be released once and not used afterward.

### Ownership and moves in Rust

Rust's rules are: each value has exactly one **owner**; when the owner goes out of scope the value is **dropped** (its destructor runs and its memory is freed, as with C++ RAII); and assigning or passing a value **moves** ownership, after which the old name cannot be used. Moving is the affine rule: the value can be used at most once as an owner. Plain data such as integers implements `Copy`, which permits duplication (contraction) because there is no resource to double free.

Because there is exactly one owner at any time, there is exactly one place that frees the value. That rules out double frees and use after free by construction, and it makes cleanup deterministic, with no garbage collector.

### Borrowing and the aliasing rule

Moving everything would make code unusable, so a value can be **borrowed** through a reference. There are two kinds, and the compiler enforces one rule over all references to a place at any point of the program: at any time either any number of shared references `&T` (read-only) exist, or exactly one exclusive reference `&mut T` exists, never both. In short, **aliasing XOR mutability**.

This single rule removes whole bug classes at compile time. Iterator invalidation (mutating a collection while iterating it) is rejected because the loop holds a shared borrow. Data races (two threads, one writing) are rejected because a value that crosses threads must be `Send` and shared access must be `Sync`, and the same aliasing rule applies. A reference must also never outlive the data it points to; the compiler tracks this with **lifetimes**, regions of the program during which a reference is valid. Since the 2018 edition, "non-lexical lifetimes" compute a borrow's extent from its last use rather than its enclosing block, which accepts more correct programs.

### What it does not prevent

Memory leaks are *safe* in Rust (`Rc` cycles, `mem::forget`), so the guarantee is not "everything is freed". Deadlocks, logic errors, panics, and arithmetic overflow semantics are outside it. Ownership gives memory safety and data-race freedom, not general correctness.

### `unsafe` and its soundness

Some necessary operations cannot be checked by these rules (raw pointer dereference, calling foreign code, implementing `Vec` itself). Rust lets a programmer mark a region `unsafe` and take responsibility for upholding the rules inside it. Safe types in the standard library (`Vec`, `Rc`, `Mutex`) are built that way: unsafe internals, safe interface. The RustBelt project (Jung et al., POPL 2018) gave the language a formal foundation: a core calculus, with its types interpreted in the **Iris** separation logic, in which ownership of a type corresponds to owning the memory it describes. For that calculus it proved that well-typed safe code cannot cause undefined behavior, and that a library's unsafe implementation is sound if it satisfies the semantic contract of its type. The concept on separation logic develops that reading.

### Linear types beyond memory

The same discipline controls any resource with a protocol. Linear Haskell (GHC 9.0) adds a linear arrow `a %1 -> b` to a lazy functional language. Typestate designs encode "a file must be opened, then read, then closed" so that calling methods out of order is a type error. Java's `try`-with-resources is a syntactic convention that calls `close()` for you, but nothing stops code from using a resource after it is closed, and C++'s `std::unique_ptr` is movable but a moved-from object remains usable, which the compiler does not forbid.

## Worked Examples

### Example 1: use after move

**Problem:** Why does the following not compile, and which bug does that prevent?

```text
let s = String::from("hi");
let t = s;             // ownership of the heap buffer moves to t
println!("{s}");       // error[E0382]: borrow of moved value: `s`
```

**Solution:** `String` owns a heap buffer and does not implement `Copy`, so `let t = s` moves it: `s` is now invalid, and the compiler rejects the use. Had both `s` and `t` stayed usable, both would be dropped at the end of scope and free the same buffer. The C equivalent `char *q = p; free(p); free(q);` is a double free that compiles silently. To keep using the original, you either clone it explicitly (`s.clone()`, a visible cost) or borrow it (`let t = &s;`).

### Example 2: iterator invalidation

**Problem:** What happens when a loop mutates the vector it iterates?

```text
let mut v = vec![1, 2, 3];
for x in &v {                       // shared borrow of v lasts for the whole loop
    if *x == 2 { v.push(4); }       // error[E0502]: cannot borrow `v` as mutable
}                                   // because it is also borrowed as immutable
```

**Solution:** The loop holds `&v` for its entire duration, and `push` needs `&mut v`. Aliasing XOR mutability makes this a compile error. `push` may reallocate the buffer, leaving the iterator pointing at freed memory; in C++ that is undefined behavior, and in Java it is detected late at run time as a `ConcurrentModificationException`. In Rust the program never builds.

### Example 3: a reference that outlives its referent

**Problem:** Explain the error, then explain what the lifetime annotation in `longest` promises.

```text
let r;
{
    let x = 5;
    r = &x;                         // error[E0597]: `x` does not live long enough
}
println!("{r}");

fn longest<'a>(x: &'a str, y: &'a str) -> &'a str { if x.len() > y.len() { x } else { y } }
```

**Solution:** `x` is dropped at the closing brace, but `r` is used afterward, so `r` would point to dead stack memory; this is the dangling pointer of C, caught at compile time. For `longest`, `'a` says the returned reference is valid no longer than both inputs. A caller may therefore not use the result after either argument's owner has gone away. The annotation does not change run-time behavior; it is a contract that the compiler checks at every call site.

## Common Misconceptions & Pitfalls

- **"No garbage collector means no memory leaks."** Leaks are safe, and reference-counted cycles (`Rc` with back-pointers) leak. Ownership guarantees that nothing is freed twice or used after free, not that everything is eventually freed.
- **"The borrow checker is a style rule."** It is a type system with a soundness theorem. Programs it rejects include ones that are correct in a particular run but unsafe in general, which is the price of a decidable, modular check.
- **"Ownership is about memory only."** It tracks any resource: file descriptors, locks, transactions, GPU buffers. The same rules make a lock guard release the lock exactly once.
- **"`unsafe` turns the checks off."** It permits a few extra operations and makes the programmer responsible for them. The borrow checker still runs on everything else inside the block.

## Summary

Substructural type systems drop the structural rules that let ordinary values be duplicated or ignored: affine types allow at most one use, linear types exactly one. Rust applies this to memory with single ownership, moves, and a borrowing rule of many readers or one writer, checked with lifetimes at compile time. The result is memory safety and data-race freedom with deterministic cleanup and no garbage collector, though leaks and logic errors remain possible. Safe abstractions rest on `unsafe` internals, and RustBelt proved the whole arrangement sound using separation logic. The next concepts move from what a type system can guarantee to the other end of the spectrum: types rich enough to express and prove arbitrary specifications.

## Documentation Links

- [The Rust Programming Language: Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html): doc
- [Jung, Jourdan, Krebbers, Dreyer: RustBelt: Securing the Foundations of the Rust Programming Language (POPL 2018)](https://plv.mpi-sws.org/rustbelt/popl18/paper.pdf): doc
- [Bernardy et al.: Linear Haskell: Practical Linearity in a Higher-Order Polymorphic Language (POPL 2018)](https://arxiv.org/abs/1710.09756): doc
