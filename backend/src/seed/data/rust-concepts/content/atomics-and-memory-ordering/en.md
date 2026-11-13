---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

An atomic operation is indivisible; its `Ordering` decides what else becomes visible with
it. This lesson runs litmus tests on real arm64 hardware and counts how often each
"impossible" outcome shows up with `Relaxed`, `Release`/`Acquire`, `SeqCst` and fences, reads
the instruction each ordering becomes, measures spurious failures of
`compare_exchange_weak`, and tries `update`/`try_update`, stable since 1.95.

Measured with Rust 1.100.0 (edition 2024, std only), release builds on an Apple M4 Max
(14 cores, macOS, arm64, `hw.cachelinesize` 128, `FEAT_LSE` and `FEAT_LRCPC` reported by
`sysctl`). Litmus counts vary run to run, so each row shows all 3 runs; a zero means zero
in every run.

## Use Cases

- Picking the ordering for a ready flag, a statistics counter, a lazy init or a lock word,
  and writing down why in a comment.
- Reviewing lock-free code: `Relaxed` where `Release`/`Acquire` is needed, and `SeqCst`
  sprinkled where it buys nothing.
- Porting Java `volatile`/`VarHandle`, C# `Volatile`/`Interlocked` or Go `sync/atomic` code.
- Explaining a bug that never shows up on x86 CI runners and does on ARM servers.
- Migrating `fetch_update` loops (deprecated in 1.99) to `update` and `try_update`.

## Deep Dive

### Happens-before in one paragraph

The atomic docs say Rust follows the C++20 rules, without `consume`; Batty et al.
formalized the C++ model those rules descend from. Within one thread, everything happens
in program order. A `Release` store synchronizes with an
`Acquire` load that reads its value, so everything before the store happens before
everything after the load; `thread::spawn` and `join` create the same edge. `Relaxed`
gives no edge, only a single modification order per variable that all threads agree on
(Rust Atomics and Locks, chapter 3). `SeqCst` adds one global order of all `SeqCst`
operations.

### What each ordering becomes on arm64

`--emit asm` of one-line functions (`mov`, `cmp` and `cset` omitted):

```text
_load_relaxed    	ldr	x0, [x0]
_load_acquire    	ldapr	x0, [x0]
_load_seqcst     	ldar	x0, [x0]
_store_relaxed   	str	x8, [x0]
_store_release   	stlr	x8, [x0]
_store_seqcst    	stlr	x8, [x0]
_add_relaxed     	ldadd	x8, x0, [x0]
_add_acqrel      	ldaddal	x8, x0, [x0]
_add_seqcst      	ldaddal	x8, x0, [x0]
_cas_strong      	casal	x8, x9, [x0]
_cas_weak        	casal	x8, x9, [x0]
_fence_acquire   	dmb	ishld
_fence_release   	dmb	ish
_fence_seqcst    	dmb	ish
```

The one place `Acquire` and `SeqCst` differ is the load: `ldapr` (the RCpc load from
`FEAT_LRCPC`) versus `ldar`. Under the Arm rules an `ldapr` may complete before an earlier
`stlr` to another address and an `ldar` may not; the next test turns that into a count.

### Litmus 1: store buffering

Litmus tests are the method of the Herding Cats paper (Alglave et al.), which ran them on
ARM and Power chips. Here: two threads, millions of rounds, each round started by a spin
barrier, variables on separate 128-byte lines, reset afterwards (`src/bin/litmus.rs`):

```rust
// thread 0
X.0.store(1, st);
if f { fence(SeqCst) }
R1.0.store(Y.0.load(ld), Relaxed);
// thread 1
Y.0.store(1, st);
if f { fence(SeqCst) }
R2.0.store(X.0.load(ld), Relaxed);
```

Under sequential consistency one store comes first, so `r1 = 0, r2 = 0` is impossible.
Rounds where both threads read 0, out of 10 000 000, in each of 3 runs:

| store / load | instructions | r1=0, r2=0 |
|--------------|--------------|------------|
| `Relaxed` / `Relaxed` | `str` / `ldr` | 210 353, 105 993, 63 775 |
| `Release` / `Acquire` | `stlr` / `ldapr` | 33 437, 71 751, 93 232 |
| `SeqCst` / `SeqCst` | `stlr` / `ldar` | 0, 0, 0 |
| `Relaxed`, `fence(SeqCst)`, `Relaxed` | `str`, `dmb ish`, `ldr` | 0, 0, 0 |
| `Release` / `Acquire`, built with `-C target-feature=-rcpc` | `stlr` / `ldar` | 0, 0, 0 |

`Release`/`Acquire` does not forbid this outcome, and on this machine it happens tens of
thousands of times. The last row is the trap: the same source compiled without RCpc gets
`ldar`, and the hardware hides the bug. Chapter 7 of the book (2023) shows `Acquire`
compiling to `ldar` on ARM64; today's `aarch64-apple-darwin` target emits `ldapr`, so code
that passed then can fail now without a line changing. The book says virtually all
real-world uses of `SeqCst` are this pattern: a store that must be globally visible before
a later load on the same thread (Dekker-style flags, "set my flag, check yours").

### Litmus 2: message passing

Thread 0 writes data, then a flag; thread 1 reads the flag, then the data. Seeing the flag
without the data (`r1 = 1, r2 = 0`) is the bug every hand-made queue or once-init can have:

```rust
// thread 0
X.0.store(1, Relaxed); // the "data"
if f { fence(Release) }
Y.0.store(1, st); // the "flag"
// thread 1
let r1 = Y.0.load(ld);
if f { fence(Acquire) }
let r2 = X.0.load(Relaxed);
```

| flag store / flag load | r1=1, r2=0 out of 20 000 000 |
|------------------------|------------------------------|
| `Relaxed` / `Relaxed` | 14, 118, 21 |
| `Release` / `Acquire` | 0, 0, 0 |
| `Relaxed` + `fence(Release)` / `fence(Acquire)` + `Relaxed` | 0, 0, 0 |

With `Relaxed` it happened about once per 170 000 to 1 400 000 rounds: rare enough to
pass a test suite, not rare at production volume. The book's chapter 7
notes that x86-64 hardware only lets a store slip after a later load, so x86 shows store
buffering but not this one. This lesson only measured arm64.

### Fences

`fence(Release)` before a `Relaxed` store and `fence(Acquire)` after a `Relaxed` load gave
the same zero as `Release`/`Acquire` on the flag itself; the `fence` docs list the
fence-fence, fence-atomic and atomic-fence pairings that synchronize. A fence pays off when
one barrier covers many operations, as in the book's chapter 3 example of one
`fence(Acquire)` after checking several `Relaxed` flags, and `fence(SeqCst)` fixed store
buffering above with otherwise `Relaxed` variables. `compiler_fence` only restrains the
compiler, for signal handlers on the same thread.

### Relaxed is still atomic

Eight threads add 5 000 000 each to one counter (`src/bin/counter.rs`):

```text
load+store:          7457402 of 40000000
fetch_add(Relaxed)   40000000 of 40000000  1045 ms
fetch_add(SeqCst)    40000000 of 40000000  1089 ms
```

A `load` followed by a `store` lost 80 to 87% of the increments in 3 runs; `fetch_add` is
one indivisible `ldadd`. `Relaxed` vs `SeqCst` took 909 to 1106 ms and 1089 to 1101 ms:
under contention the cost is moving the cache line between cores, not the ordering.

### compare_exchange vs compare_exchange_weak

The `weak` version may fail even when the value matched. A failure whose returned value
equals the expected one is spurious (`src/bin/cas.rs`, 20 000 000 successful CAS):

```rust
match r {
    Ok(_) => { cur += 1; break }
    Err(actual) if actual == cur => spurious += 1,
    Err(actual) => { real += 1; cur = actual }
}
```

| build | threads | `compare_exchange` spurious | `compare_exchange_weak` spurious |
|-------|---------|-----------------------------|----------------------------------|
| default (LSE, `casal`) | 1 | 0 | 0 |
| default (LSE, `casal`) | 4 | 0 | 0 |
| `-C target-feature=-lse` (`ldaxr`/`stlxr`) | 1 | 0 | 2, 1, 2 |
| `-C target-feature=-lse` (`ldaxr`/`stlxr`) | 4 | 0 | 5 249 005, 5 566 277, 5 325 074 |

With LSE both methods are the same `casal` instruction and never fail spuriously. With
load-linked/store-conditional, the weak version returns as soon as the `stlxr` fails: under
4 threads almost every lost race showed up once as spurious and once as real. Single
threaded, 20 000 000 CAS took 19 to 20 ms with LSE and 73 to 84 ms without. Use `_weak`
inside a loop that retries anyway; use the strong one when a single failure is acted on.

### update and try_update (1.95)

`update(set_order, fetch_order, f)` stores `f(old)` and returns `old`; `try_update` takes a
closure returning `Option` and gives `Ok(old)` or `Err(current)`. A connection-slot limiter:

```rust
fn try_acquire(in_use: &AtomicU32, max: u32, calls: &AtomicU64) -> bool {
    in_use
        .try_update(Acquire, Relaxed, |n| {
            calls.fetch_add(1, Relaxed);
            (n < max).then_some(n + 1)
        })
        .is_ok()
}
```

```text
attempts 8000000, granted 5760377, closure calls 18313851 (2.29 per attempt), peak in use 4
```

Eight threads never pushed the count past 4, and the closure ran 2.25 to 3.32 times per
attempt across 3 runs, as the docs warn ("may call the function multiple times"). Keep
the closure pure. `fetch_update` is the same operation and now warns:

```text
warning: use of deprecated method `std::sync::atomic::Atomic::<u32>::fetch_update`: renamed to `try_update` for consistency
```

The message also shows that `AtomicU32` is now an alias of the generic `Atomic<u32>`, which
you cannot name yourself yet (`generic_atomic`, E0658).

### Orderings the compiler rejects

The `invalid_atomic_ordering` lint is deny-by-default for literal orderings: "atomic stores
cannot have `Acquire` or `AcqRel` ordering", "atomic loads cannot have `Release` or `AcqRel`
ordering", and "`compare_exchange`'s failure ordering may not be `Release` or `AcqRel`". An
ordering hidden behind a variable compiles and panics at runtime:
`there is no such thing as an acquire store`.

## Trade-offs

- **`SeqCst` everywhere is not free on arm64, and not always enough**: the load becomes
  `ldar` instead of `ldapr`, while a contended `fetch_add` costs the same either way. It
  only fixes cross-variable patterns like store buffering; it does nothing for a racy
  `load` plus `store`. Choose the weakest ordering whose happens-before edge you can name.
- **`Release`/`Acquire` is the default for publishing data**: one pair fixed message
  passing (0 of 60 000 000 rounds) and is what `Mutex`, `OnceLock` and channels rely on.
- **Litmus counts are tiny**: 14 in 20 000 000 means a unit test will not find it, and a
  stronger target can hide it entirely (the `-rcpc` row). Model checking with loom explores
  the orderings instead of hoping for a bad interleaving.
- **`compare_exchange_weak`**: identical to the strong form on LSE hardware; on LL/SC it
  skips the internal retry loop, so every caller must loop. A `try_lock` that tries once
  should use the strong form.
- **`update`/`try_update` vs a hand-written CAS loop**: shorter and clearer, but the closure
  runs once per retry (2.25 to 3.32 times here), so side effects inside it multiply.
- **Book vs today**: Rust Atomics and Locks (2023) is current on the model, but its ARM64
  listings show `ldar` for `Acquire` and `ldaxr`/`stlxr` loops for read-modify-write, while
  Rust 1.100.0 on Apple silicon emits `ldapr`, `ldaddal` and `casal`. It also predates
  `update`/`try_update` (1.95) and the `fetch_update` deprecation (1.99).

## Documentation Links

- [std::sync::atomic module: memory model for atomic accesses](https://doc.rust-lang.org/std/sync/atomic/index.html): doc
- [std::sync::atomic::Ordering](https://doc.rust-lang.org/std/sync/atomic/enum.Ordering.html): doc
- [std::sync::atomic::fence](https://doc.rust-lang.org/std/sync/atomic/fn.fence.html): doc
- [std::sync::atomic::Atomic: update, try_update and compare_exchange_weak](https://doc.rust-lang.org/std/sync/atomic/struct.Atomic.html): doc
- [The Rustonomicon: Atomics](https://doc.rust-lang.org/nomicon/atomics.html): doc
- [Announcing Rust 1.95.0 (atomic update and try_update), Rust Blog](https://blog.rust-lang.org/2026/04/16/Rust-1.95.0/): doc
- [Rust Atomics and Locks, chapter 2: Atomics (Mara Bos, O'Reilly 2023)](https://marabos.nl/atomics/atomics.html): book
- [Rust Atomics and Locks, chapter 3: Memory Ordering (Mara Bos, O'Reilly 2023)](https://marabos.nl/atomics/memory-ordering.html): book
- [Rust Atomics and Locks, chapter 7: Understanding the Processor (Mara Bos, O'Reilly 2023)](https://marabos.nl/atomics/hardware.html): book
- [Alglave, Maranget and Tautschnig, Herding Cats: Modelling, Simulation, Testing, and Data Mining for Weak Memory, ACM TOPLAS 2014](https://doi.org/10.1145/2627752): paper
- [Batty et al., Mathematizing C++ Concurrency, POPL 2011](https://doi.org/10.1145/1926385.1926394): paper
