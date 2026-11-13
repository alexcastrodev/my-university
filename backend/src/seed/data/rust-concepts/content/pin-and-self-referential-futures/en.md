---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

`Future::poll` takes `self: Pin<&mut Self>` because the state machine of an
`async fn` may point into itself: a local borrowed across an `.await` lives in
the future, and so does the reference to it. A move would leave that
reference at the old address. `Pin` is a library promise that the pointee
stays put until dropped; `Unpin` marks types for which the promise means
nothing. This lesson shows the self-reference in memory, the compiler errors
when you skip pinning, `pin!` versus `Box::pin`, structural pinning with
pin-project-lite, and what breaks, under Miri, when unsafe code lies.

Measured with Rust 1.100.0 (rustc 0ef1bc386 2026-11-09), edition 2024, Apple
Silicon (aarch64-apple-darwin, macOS), pin-project-lite 0.2.17 (Cargo.lock).
Miri is nightly-only, so it ran from nightly-2025-02-20 (miri f280acf4c7).

## Use Cases

- Writing a `Future` or `Stream` wrapper (timeout, metrics, retry) around an
  inner future: that is pin projection.
- Storing futures of different types together: `Pin<Box<dyn Future>>`.
- Polling the same future across loop iterations (`select!` in a loop).
- Reading "cannot be unpinned" errors and picking `pin!`, `Box::pin` or `Unpin`.
- Reviewing `unsafe` code that calls `Pin::new_unchecked`.

## Deep Dive

### The self-reference, in memory

```rust
let fut = async {
    let buf = [9u8; 64];
    let r = &buf; // a reference to a local that lives in the future
    YieldNow(false).await;
    println!("after await: r={:p} r[0]={}", r, r[0]);
};
let mut boxed = Box::pin(fut);
let start = &*boxed as *const _ as *const u8 as usize;
let size = std::mem::size_of_val(&*boxed);
println!("future on the heap: {:#x}..{:#x} ({size} bytes)", start, start + size);
let _ = boxed.as_mut().poll(&mut cx); // Pending
let _ = boxed.as_mut().poll(&mut cx); // prints, Ready
```

```text
future on the heap: 0x101515a40..0x101515a90 (80 bytes)
after await: r=0x101515a40 r[0]=9
```

`r` points at the first byte of the future: the future holds a pointer to
itself. A hand-made `struct SelfRef { data: [u8; 16], ptr: *const [u8; 16] }`
shows what a move does: with `ptr = &data` set inside `make()`, `ptr` stayed
`0x16ee68ee0` while `&data` became `0x16ee69040` after returning and
`0x101515a20` after `vec![s]` (debug run; release did the same). A move
copies the value byte for byte, "without running any code to notify that
value that its address has changed" (std docs), so nothing fixes the pointer.

### What `Pin` promises

The `std::pin` docs: "From the moment a value is pinned by constructing a
Pinning pointer to it, that value must remain, valid, at that same address in
memory, until its `drop` handler is called." `Pin<Ptr>` is
`#[repr(transparent)]` (same layout and ABI as `Ptr`) and enforces this by
omission: for a `!Unpin` pointee there is no `DerefMut`, so safe code never
gets the `&mut T` that `mem::swap` or `mem::replace` needs.
`std::mem::swap(&mut *a, &mut *b)` on two `pin!`ned futures fails with
"E0596: cannot borrow data in dereference of `Pin<&mut impl Future<Output =
u32>>` as mutable" and "trait `DerefMut` is required to modify through a
dereference".

`Unpin` is the auto trait that cancels all this: `Pin::new`, `get_mut` and
`DerefMut` exist only for `Unpin` pointees. Almost every type is `Unpin`;
generated futures are not, and a `PhantomPinned` field opts a struct out.
With `fn assert_unpin<T: Unpin>(_: &T)`, `std::future::ready(1)` passed while
an `async fn` future and a `PhantomPinned` struct failed with "`{async fn body
of work()}` cannot be unpinned" and "`PhantomPinned` cannot be unpinned".

### Polling an unpinned future: the real errors

```rust
let mut fut = work();
let _ = fut.poll(&mut cx);                // build 1
let _ = Pin::new(&mut fut).poll(&mut cx); // build 2 (separate file)
```

```text
error[E0599]: no method named `poll` found for opaque type `impl Future<Output = u32>` in the current scope
   = help: method `poll` found on `Pin<&mut impl Future<Output = u32>>`, see documentation for `std::pin::Pin`
   = help: self type must be pinned to call `Future::poll`, see https://rust-lang.github.io/async-book/part-reference/pinning.html
help: consider pinning the expression
10 ~     let mut pinned = std::pin::pin!(fut);
11 ~     let _ = pinned.as_mut().poll(&mut cx);

error[E0277]: `{async fn body of work()}` cannot be unpinned
   = note: consider using the `pin!` macro
           consider using `Box::pin` if you need to access the pinned value outside of the current scope
note: required by a bound in `Pin::<Ptr>::new`
```

Both errors name the two fixes; the first links the async book's pinning
chapter.

### `pin!` versus `Box::pin`

```rust
let mut tasks: Vec<Pin<Box<dyn Future<Output = u32>>>> =
    vec![Box::pin(small()), Box::pin(big())]; // big() holds 4 KiB across .await
let local = pin!(big());
let boxed = Box::pin(big());
// prints: poll of each task, then size_of_val of handle and pointee
```

```text
Ready(1) Ready(2)
pin!(big())      handle  8 bytes, future 4098 bytes (in this frame)
Box::pin(big())  handle  8 bytes, future 4098 bytes (on the heap)
Pin<Box<dyn ..>> handle 16 bytes
```

`pin!` (stable since 1.68) pins in place without allocating; its docs prefer
"local pinning", because inside an `async fn` the pinned local becomes part of
the enclosing future's state. It moves the value in (touching the original
afterwards is E0382, "use of moved value") and cannot leave the scope:
returning `pin!(work())` from a function is E0515, "cannot return value
referencing temporary value". `Box::pin` costs one allocation and gives an
owned handle to return, store, or erase to `dyn Future` (16-byte fat pointer).

### Structural pinning and projection

A wrapper that counts polls of an inner future, written naively:

```rust
struct Counted<F> { inner: F, polls: u32 }
impl<F: Future> Future for Counted<F> {
    type Output = F::Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<F::Output> {
        let this = self.get_mut();
        this.polls += 1;
        Pin::new(&mut this.inner).poll(cx)
    }
}
```

```text
error[E0277]: `F` cannot be unpinned
10 |         let this = self.get_mut();
   |                         ^^^^^^^ within `Counted<F>`, the trait `Unpin` is not implemented for `F`
help: consider further restricting type parameter `F` with trait `Unpin`
```

The suggested `F: Unpin` compiles but rejects every `async fn` future. The
real fix is projection: `inner` is *structurally* pinned (`Pin<&mut Self>`
yields `Pin<&mut F>`), `polls` is not (it yields `&mut u32`). By hand that is
`get_unchecked_mut` plus `Pin::new_unchecked`, sound only under the rules the
`std::pin` docs list: the struct is `Unpin` only if its structural fields are,
`Drop` must treat `self` as pinned, no `#[repr(packed)]`, and nothing moves
data out of a structural field. pin-project-lite generates it with no `unsafe`:

```rust
pin_project_lite::pin_project! {
    struct Counted<F> { #[pin] inner: F, polls: u32 }
}
impl<F: Future> Future for Counted<F> {
    type Output = (F::Output, u32);
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project(); // inner: Pin<&mut F>, polls: &mut u32
        *this.polls += 1;
        this.inner.poll(cx).map(|v| (v, *this.polls))
    }
}
```

```text
manual: ("ok", 3)
lite  : ("ok", 3)
```

(`work()` awaits two yields, so three polls.) The macro also enforces the
rules: `Counted<F>` is `Unpin` exactly when `F` is, and a plain `impl Drop`
fails with "E0119: conflicting implementations of trait `MustNotImplDrop`".
Cleanup goes in `impl<F> PinnedDrop for Counted<F> { fn drop(this: Pin<&mut
Self>) { .. } }` inside the macro, which ran and printed `polled 3 times`.

### Why `Pin` exists: breaking the promise

`Pin::new_unchecked` is `unsafe` because the caller promises the value never
moves again. This program polls a future (creating the self-reference), moves
it out of the stack frame, and polls again:

```rust
fn start(cx: &mut Context<'_>) -> impl Future<Output = u8> + use<> {
    let mut fut = make(); // async { let buf = [9u8; 64]; let r = &buf; yield.await; r[0] }
    let _ = unsafe { Pin::new_unchecked(&mut fut) }.poll(cx);
    fut // moved while holding a pointer into this frame
}
let mut fut = start(&mut cx);
clobber(); // writes 0xAA over the dead frame
let out = unsafe { Pin::new_unchecked(&mut fut) }.poll(&mut cx);
```

```text
native (debug and release): second poll: Ready(170) (expected Ready(9))
miri: error: Undefined Behavior: constructing invalid value at .<coroutine-state(3)>.<captured-var(1)>: encountered a dangling reference (use-after-free)
```

170 is `0xAA`: the future read a dead stack frame and nothing crashed. Miri
stops earlier, at `let mut fut = start(..)`: the returned value already holds
a dangling reference. RFC 2349 chose a library type over a built-in `?Move`
trait because that bound "ended up 'infecting' many different APIs where it
wasn't relevant"; with `Pin`, only APIs that need immovability opt in, and
safe code can never produce the move above.

## Trade-offs

- **`pin!` or `Box::pin`**: `pin!` is free but scoped to the frame; `Box::pin`
  costs an allocation and can be returned, stored or made `dyn`. Default to
  `pin!`, box at API boundaries.
- **An `Unpin` bound is the easy way out**: `F: Future + Unpin` unlocks
  `Pin::new` and `get_mut`, but pushes `Box::pin` onto every caller holding an
  `async fn` future. Libraries usually project instead.
- **pin-project-lite versus pin-project**: no proc-macro dependencies is, in
  its docs' words, "the only reason to use this crate" (no gain if you already
  pull in syn). It lacks tuple structs, custom `Unpin` and useful error
  messages; pin-project has all three.
- **`!Unpin` is contagious**: a struct storing an `async fn` future by value
  is `!Unpin`, so its users must pin it too.
- **Pin is a contract, not a check**: the broken program above "worked"
  natively with a wrong value. Run code that uses `new_unchecked` or
  `map_unchecked_mut` under Miri.

## Documentation Links

- [Module std::pin, Rust standard library](https://doc.rust-lang.org/std/pin/index.html): doc
- [std::pin::Pin, Rust standard library](https://doc.rust-lang.org/std/pin/struct.Pin.html): doc
- [std::pin::pin! macro, Rust standard library](https://doc.rust-lang.org/std/pin/macro.pin.html): doc
- [std::marker::Unpin, Rust standard library](https://doc.rust-lang.org/std/marker/trait.Unpin.html): doc
- [RFC 2349: Pin, The Rust RFC Book](https://rust-lang.github.io/rfcs/2349-pin.html): doc
- [Pinning, Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/part-reference/pinning.html): doc
- [pin-project-lite 0.2.17, docs.rs](https://docs.rs/pin-project-lite/latest/pin_project_lite/): doc
- [Miri, rust-lang/miri](https://github.com/rust-lang/miri): doc
- [Rust for Rustaceans (Jon Gjengset, No Starch Press 2021), chapter 8: Asynchronous Programming](https://nostarch.com/rust-rustaceans): book
