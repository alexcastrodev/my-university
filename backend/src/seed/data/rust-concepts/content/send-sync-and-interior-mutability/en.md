---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

`Send` and `Sync` sit behind every "cannot be sent between threads safely" error, and
interior mutability (`Cell`, `RefCell`, `UnsafeCell`, `OnceLock`, `LazyLock`) is how Rust
mutates through a shared reference without losing that check. This lesson compiles the
auto-trait table, reads real E0277 errors, lies about `Rc` to watch its count break,
triggers the `RefCell` and `OnceLock` failure modes, and writes `unsafe impl Send` by hand,
including the closure-capture gotcha that makes the impl look ignored.

Measured with Rust 1.100.0 (edition 2024, std only), release builds on an Apple M4 Max
(14 cores, macOS, arm64). Every output was identical across at least 3 runs unless the
text says otherwise.

## Use Cases

- Reading an E0277 about `Rc`, `RefCell`, `Cell` or a raw pointer and picking the right
  replacement (`Arc`, `Mutex`, `RwLock`, an atomic) instead of wrapping until it compiles.
- Choosing between `Cell`, `RefCell`, `Mutex<T>` and `RwLock<T>` for shared state.
- Replacing `lazy_static!` and the `once_cell` crate with `LazyLock` and `OnceLock`.
- Wrapping an FFI handle or a raw-pointer buffer and deciding if it may cross threads.
- Debugging "RefCell already borrowed" in observer and callback code.

## Deep Dive

### Send and Sync are auto traits

`T: Send` means a `T` can be moved to another thread; `T: Sync` means `&T` can be shared,
which is the same as `&T: Send`. The Rustonomicon calls them unsafe, automatically derived
traits: a type made only of `Send` (`Sync`) parts is `Send` (`Sync`), and the major
exceptions are raw pointers, `UnsafeCell` (not `Sync`) and `Rc`. This table was produced
by compiling `fn check<T: Send>() {}` and `fn check<T: Sync>() {}` once per type:

```text
type                         Send  Sync
Rc<i32>                      no    no
Arc<i32>                     yes   yes
Cell<i32>                    yes   no
RefCell<i32>                 yes   no
Mutex<Cell<i32>>             yes   yes
RwLock<Cell<i32>>            yes   no
Arc<Cell<i32>>               no    no
MutexGuard<'static, i32>     no    yes
OnceLock<i32>                yes   yes
AtomicI32                    yes   yes
&'static Cell<i32>           no    no
```

The rules behind the rows: `&T` is `Send` only if `T: Sync`. `Arc<T>` needs
`T: Send + Sync`, so `Arc<Cell<i32>>` is neither. `Mutex<T>` is `Sync` when `T: Send` (one
thread at a time), while `RwLock<T>` also needs `T: Sync` because readers share it.
`MutexGuard` is not `Send` because, says the Rustonomicon, the lock libraries require
freeing it on the acquiring thread.

### Reading the errors: root type first, then the chain

```text
error[E0277]: `Rc<i32>` cannot be sent between threads safely
  = help: within `{closure@errors/e1_rc_spawn.rs:6:32: 6:39}`, the trait `Send` is not implemented for `Rc<i32>`

error[E0277]: `RefCell<i32>` cannot be shared between threads safely
  = note: if you want to do aliasing and mutation between multiple threads, use `std::sync::RwLock` instead
  = note: required for `Arc<RefCell<i32>>` to implement `Send`

error[E0277]: `Cell<i32>` cannot be shared between threads safely
  = note: required for `&Cell<i32>` to implement `Send`
```

The third is `thread::scope` borrowing a `Cell`: no `'static` problem, only `Sync`.

### Why Rc is not Send: lie and measure

`Rc` keeps a plain, non-atomic counter. A wrapper with a false `unsafe impl Send` compiles,
and the program has undefined behavior. Eight threads each run this loop:

```rust
struct Sneaky(Rc<u64>);
unsafe impl Send for Sneaky {} // the lie

let mine = Sneaky(Rc::clone(&rc));
thread::spawn(move || {
    let mine = mine;
    for _ in 0..ROUNDS {
        black_box(Rc::clone(&mine.0));
    }
})
```

```text
Rc strong_count after join: 12 (expected 1)
Rc strong_count after join: 40 (expected 1)
```

In 46 runs the count was never 1 (range 3 to 40): updates were lost and the value leaks.
Losing them the other way frees memory still in use. `Arc` printed 1 every time.

### UnsafeCell is the only door

Mutating through `&T` is undefined behavior unless the bytes live in an `UnsafeCell`, and
the compiler rejects the obvious cast outright:

```text
error: assigning to `&T` is undefined behavior, consider using an `UnsafeCell`
2 |     unsafe { *(x as *const i32 as *mut i32) += 1 };
  = note: `#[deny(invalid_reference_casting)]` on by default
```

The reason is optimization. Read the same value twice around an opaque call:

```rust
pub fn plain(x: &i32, f: &dyn Fn()) -> i32 { let a = *x; f(); a + *x }
pub fn celled(x: &Cell<i32>, f: &dyn Fn()) -> i32 { let a = x.get(); f(); a + x.get() }
```

```text
_plain:
	ldr	w19, [x0]
	blr	x8
	lsl	w0, w19, #1
_celled:
	ldr	w20, [x0]
	blr	x8
	ldr	w8, [x19]
	add	w0, w8, w20
```

Behind `&i32` the compiler assumes nothing changes and doubles the first load; `&Cell`
forces a reload. `Cell`, `RefCell`, `Mutex`, `OnceLock` and the atomics all wrap the
`!Sync` `UnsafeCell`; the thread-safe ones opt back in with `unsafe impl Sync`.

### Cell and RefCell

`Cell<T>` never hands out a reference to its contents: values move in and out with `get`
(for `Copy`), `set`, `replace` and `take`, at zero cost. Sizes from `size_of`:

```text
Cell<i32>          4 bytes
RefCell<i32>      16 bytes
Option<&u8>        8 bytes
Option<Cell<&u8>> 16 bytes
```

The last two lines are the niche loss the `UnsafeCell` docs warn about. `RefCell<T>` hands
out real references and checks the borrow rules at runtime with a counter stored next to
the value; break them and it panics. The realistic case is re-entrancy: a listener that
subscribes while `publish` iterates the list it would push into.

```rust
fn publish(&self, msg: &str) {
    for l in self.listeners.borrow().iter() { l(self, msg); }
}
bus.subscribe(|bus, m| {
    if m == "login" {
        bus.subscribe(|_, m| println!("late listener got {m}")); // re-entrant borrow_mut
    }
});
```

```text
logger got hello
logger got login

thread 'main' (215755) panicked at src/bin/refcell_panic.rs:11:24:
RefCell already borrowed
```

The other direction prints `RefCell already mutably borrowed`, and `try_borrow_mut` returns
`Err(BorrowMutError)` instead of panicking. The usual fixes: iterate over a clone of the
list (of `Rc<dyn Fn>`), or queue subscriptions and apply them after the loop.

### OnceLock and LazyLock

`OnceLock` (1.70) and `LazyLock` (1.80) are the thread-safe `OnceCell` and `LazyCell`, and
they replace `lazy_static!` and `once_cell`. Eight threads race on
`CONFIG.get_or_init(load_config)`, where `load_config` sleeps 100 ms:

```text
init ran 1 time(s), distinct addresses: 1, per-thread ms: [107, 107, 107, 107, 107, 107, 107, 107]
```

One initializer ran and seven threads blocked on it (102 to 107 ms), in all 6 runs. The
types differ when the initializer panics or re-enters itself (3 runs each):

| case | `OnceLock` | `LazyLock` | `OnceCell` |
|------|------------|------------|------------|
| init panics, then access again | runs init again (printed 7) | panics: `LazyLock instance has previously been poisoned` | runs init again (printed 7) |
| init re-enters itself | deadlock, 0.0% CPU after 3 s | deadlock, 0.0% CPU after 3 s | panics: `reentrant init` |

The `OnceLock` docs call re-entrant init unspecified: the second row is always your bug.

### Implementing Send and Sync by hand

A type holding a raw pointer is `!Send` and `!Sync` even when it owns its data. The fix is
an `unsafe impl` whose bounds match what the type exposes, as `Box<T>` does:

```rust
struct MyBox<T> { ptr: NonNull<T> }

// SAFETY: MyBox owns its T exclusively, so moving MyBox moves the T (needs T: Send),
// and &MyBox only gives out &T (needs T: Sync). Same bounds as Box<T>.
unsafe impl<T: Send> Send for MyBox<T> {}
unsafe impl<T: Sync> Sync for MyBox<T> {}
```

`MyBox<String>` crosses `thread::spawn`; `MyBox<Rc<i32>>` fails on `Rc<{integer}>`, since the
bound forwards the check. To opt out on stable, add a `PhantomData<*const ()>` field.

The gotcha: since edition 2021, closures capture disjoint fields. With
`unsafe impl Send for Buffer {}` in place, this still fails:

```rust
thread::spawn(move || unsafe { *b.ptr = b.len as u8 }).join().unwrap();
```

```text
error[E0277]: `*mut u8` cannot be sent between threads safely
note: required because `b.ptr` is used within this closure
```

It captured `b.ptr` (a `*mut u8`), not `b`. Starting the closure with `let b = b;` moves
the whole `Buffer` in and prints `v[0] = 16` (the `Rc` experiment's `let mine = mine;`).

## Trade-offs

- **`Cell` vs `RefCell`**: `Cell` has zero overhead and cannot panic, but only moves
  values in and out. `RefCell` gives references at the price of a borrow counter (16 bytes
  for an `i32`) and a panic that shows up in production, not in `cargo build`.
- **`Mutex<T>` vs `RwLock<T>`**: `Mutex` needs only `T: Send`, so it can protect a `Cell`
  or any `!Sync` value. `RwLock` needs `T: Send + Sync` and pays off only when reads are
  long and plentiful.
- **`LazyLock` vs `OnceLock`**: `LazyLock` is the shortest code for a static, but a panic
  in its initializer poisons it for the rest of the process. `OnceLock::get_or_init`
  retries, which suits fallible setup such as reading a config file.
- **`unsafe impl Send/Sync` is a promise the compiler cannot check**: the `Rc` experiment
  compiled and ran without a crash while corrupting its count. Write the `// SAFETY:`
  reasoning, run the tests under Miri, and forward bounds (`T: Send`) instead of writing
  unconditional impls.
- **Book vs today**: Rust Atomics and Locks (2023) chapter 1 still holds for `Send`, `Sync`
  and the cells, and its online text points to `OnceLock` (1.70), but it predates
  `LazyLock` (1.80): a lazy static hand-rolled on `OnceLock` can now be one `LazyLock`.

## Documentation Links

- [The Rustonomicon: Send and Sync](https://doc.rust-lang.org/nomicon/send-and-sync.html): doc
- [std::cell module: interior mutability](https://doc.rust-lang.org/std/cell/index.html): doc
- [std::cell::UnsafeCell](https://doc.rust-lang.org/std/cell/struct.UnsafeCell.html): doc
- [std::sync::OnceLock](https://doc.rust-lang.org/std/sync/struct.OnceLock.html): doc
- [std::sync::LazyLock](https://doc.rust-lang.org/std/sync/struct.LazyLock.html): doc
- [The Rust Reference: interior mutability](https://doc.rust-lang.org/reference/interior-mutability.html): doc
- [Announcing Rust 1.80.0 (LazyCell and LazyLock), Rust Blog](https://blog.rust-lang.org/2024/07/25/Rust-1.80.0/): doc
- [Rust Atomics and Locks, chapter 1: Basics of Rust Concurrency (Mara Bos, O'Reilly 2023)](https://marabos.nl/atomics/basics.html): book
