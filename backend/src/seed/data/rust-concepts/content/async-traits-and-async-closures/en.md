---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Since Rust 1.75 a trait can declare `async fn` and `-> impl Trait` methods (RPITIT), and
since 1.85 closures can be `async` and bounded by `AsyncFn`, `AsyncFnMut` and
`AsyncFnOnce`. Both features remove a lot of boxing, and both leave the same gap: the
future they return is anonymous, so generic code cannot say "and it is `Send`". This
lesson reproduces each compiler error you hit in a Tokio service (spawning, `dyn`,
borrowing captures) and the fix that works on stable today.

Measured with Rust 1.100.0 (edition 2024), tokio 1.54.1, trait-variant 0.1.3 and
async-trait 0.1.92 (versions from `Cargo.lock`), on an Apple M4 Max with macOS. Compiler
messages are copied from `cargo build` and trimmed to their key lines.

## Use Cases

- A repository or HTTP-client trait with `async fn` methods called from tasks that Tokio
  spawns, and a library deciding whether its public async trait promises `Send` futures.
- A plugin list (`Vec<Box<dyn Store>>`) that needs runtime dispatch over async methods.
- Retry, middleware and `for_each`-style helpers that take an async callback which
  borrows its argument or mutates captured state.

## Deep Dive

### `async fn` in a trait, and the `Send` bound problem

`async fn load(&self) -> T` in a trait desugars to `fn load(&self) -> impl Future<Output
= T>`, and impls may use either spelling. With a concrete type the compiler sees the real
future, so its auto traits leak through and spawning just works (this prints
`concrete spawn = 1`):

```rust
trait Ping { async fn ping(&self) -> u32; }
impl Ping for Pinger { async fn ping(&self) -> u32 { 1 } }
println!("concrete spawn = {}", tokio::spawn(async { Pinger.ping().await }).await.unwrap());
```

Now the same kind of trait used generically, which is what a server does:

```rust
trait HttpService {
    async fn fetch(&self, url: String) -> String;
}
fn spawn_task(service: impl HttpService + Send + Sync + 'static) {
    tokio::spawn(async move {
        let body = service.fetch("https://rust-lang.org".into()).await;
        println!("{} bytes", body.len());
    });
}
```

```text
error: future cannot be sent between threads safely
    = help: within `{async block@src/bin/b_spawn.rs:6:18: 6:28}`, the trait `Send` is not implemented for `impl Future<Output = String>`
note: future is not `Send` as it awaits another future which is not `Send`
help: `Send` can be made part of the associated future's guarantees for all implementations of `HttpService::fetch`
  2 -     async fn fetch(&self, url: String) -> String;
  2 +     fn fetch(&self, url: String) -> impl std::future::Future<Output = String> + Send;
```

`S: Send + Sync` says nothing about the future `fetch` returns. On a `pub` trait the
compiler warns earlier with ``warning: use of `async fn` in public traits is discouraged
as auto trait bounds cannot be specified`` (lint `async_fn_in_trait`, on by default).

### Fix 1: write the desugaring and add `+ Send`

```rust
pub trait HttpService: Send + Sync {
    fn fetch(&self, url: String) -> impl Future<Output = String> + Send;
}
impl HttpService for Client {
    async fn fetch(&self, url: String) -> String { // impls may still use `async fn`
        tokio::task::yield_now().await;
        format!("<html>{url}</html>")
    }
}
fn spawn_fetch(s: impl HttpService + 'static) -> tokio::task::JoinHandle<String> {
    tokio::spawn(async move { s.fetch("https://rust-lang.org".into()).await })
}
```

`spawn_fetch(Client).await` prints `<html>https://rust-lang.org</html>`. The price moves
to implementors: every impl must now produce a `Send` future, and one that keeps an `Rc`
alive across an `.await` is rejected at the impl:

```text
error: future cannot be sent between threads safely
   = help: within `impl Future<Output = String>`, the trait `Send` is not implemented for `Rc<i32>`
note: future is not `Send` as this value is used across an await
```

### Fix 2: `trait_variant::make` generates both traits

For public traits the Rust blog recommends the rust-lang `trait-variant` crate:

```rust
#[trait_variant::make(SendCache: Send)]
pub trait LocalCache {
    async fn get(&self, key: u32) -> Option<String>;
}
impl SendCache for Mem {
    async fn get(&self, key: u32) -> Option<String> { Some(format!("v{key}")) }
}
// spawn_get(c: impl SendCache + Sync + 'static) spawns c.get(7); then LocalCache::get(&Mem, 9)
```

```text
Some("v7")
via LocalCache: Some("v9")
```

`SendCache` gets `-> impl Future + Send` methods, and the second line shows the generated
blanket impl: every `SendCache` type is also a `LocalCache`. The blog states the limit: a
type cannot implement the `Send` variant conditionally on its generics (middleware
wrappers). The general fix, bounding the future at the use site with
`where S::fetch(..): Send` (return type notation), still fails on 1.100 with
`error[E0658]: return type notation is experimental` (issue #109417).

### `dyn` is still out, so box the future

```rust
trait Store { async fn load(&self, id: u64) -> Option<String>; }
let stores: Vec<Box<dyn Store>> = vec![Box::new(Pg)];
```

```text
error[E0038]: the trait `Store` is not dyn compatible
2 |     async fn load(&self, id: u64) -> Option<String>;
  |              ^^^^ ...because method `load` is `async`
```

The Reference's dyn-compatibility rules forbid an opaque return type on a dispatchable
method (no `async fn`, no RPITIT): each impl's future has its own type and size, so no
vtable slot can describe it. trait-variant 0.1.3 still offers only `make`; the dynamic
dispatch the 2023 post planned for it has not shipped. The way out is to erase the future
into `Pin<Box<dyn Future + Send + '_>>`. The async-trait docs show its expansion: each
method returns exactly that and wraps the body in `Box::pin(async move { .. })`. By hand:

```rust
trait ManualStore {
    fn load(&self, id: u64) -> Pin<Box<dyn Future<Output = u64> + Send + '_>>;
}
// impl body: Box::pin(async move { id * 2 })
```

A counting `#[global_allocator]` and 1 000 000 calls per row (release build):

```text
AFIT, generic (static)       allocs/call = 0    0.7 ns/call  (checksum 999999000000)
#[async_trait] via &dyn      allocs/call = 1   16.2 ns/call  (checksum 999999000000)
manual Pin<Box<dyn Future>>  allocs/call = 1   14.7 ns/call  (checksum 999999000000)
```

Allocations were identical in 3 runs; the boxed rows ranged 14.5 to 24.0 ns. The body
is trivial on purpose: next to a database round trip, one allocation is noise.
`#[async_trait(?Send)]` drops the `Send` bound for single-threaded executors.

### Async closures and the `AsyncFn*` traits

A closure returning an `async` block cannot lend its captures to that future:

```rust
let mut countries = Vec::new();
for_each_city(|city| async {           // F: FnMut(&'static str) -> Fut
    countries.push(country_of(city).await);
}).await;
```

```text
error: captured variable cannot escape `FnMut` closure body
  = note: `FnMut` closures only have access to their captured variables while they are executing...
  = note: ...therefore, they cannot allow references to captured variables to escape
```

And `F: for<'c> FnMut(&'c str) -> Fut` rejects even a plain `async fn log_city(&str)`,
because `Fut` is one type picked by the caller and cannot depend on `'c`: rustc reports
`error[E0308]: mismatched types` ("one type is more general than the other") and
``error: implementation of `FnMut` is not general enough``. `AsyncFnMut(&str)` fixes
both, since its future may borrow the argument and the captures, and async fn items
implement it too:

```rust
async fn for_each_city(mut f: impl AsyncFnMut(&str)) {
    let owned = vec![String::from("New York"), String::from("Tokyo")];
    for c in &owned { f(c).await; }
}
let mut countries = Vec::new();
for_each_city(async |city| { countries.push(country_of(city).await); }).await;
println!("{countries:?}");
for_each_city(log_city).await;
```

```text
["country-of-New York", "country-of-Tokyo"]
log New York
log Tokyo
```

### `AsyncFn` has its own `Send` problem

Its future is an associated type you cannot name on stable, so it cannot be bounded:

```rust
fn spawn_retry<F>(f: F) where F: AsyncFn() -> u32 + Send + Sync + 'static {
    tokio::spawn(async move { f().await });
}
```

```text
error: future cannot be sent between threads safely
    = help: within `{async block@src/bin/j_asyncfn_send.rs:5:18: 5:28}`, the trait `Send` is not implemented for `<F as AsyncFnMut<()>>::CallRefFuture<'_>`
```

Adding `for<'a> F::CallRefFuture<'a>: Send` gives ``error[E0658]: use of unstable library
feature `async_fn_traits` ``, and `Box<dyn AsyncFn() -> u32>` gives ``error[E0038]: the
trait `AsyncFn` is not dyn compatible`` ("because it contains generic associated type
`CallRefFuture`"). For spawning, keep the two-parameter form, whose `Fut` is nameable:

```rust
fn spawn_retry<F, Fut>(f: F) -> tokio::task::JoinHandle<u32>
where F: Fn() -> Fut + Send + 'static, Fut: Future<Output = u32> + Send,
{ tokio::spawn(async move { let mut n = 0; for _ in 0..3 { n += f().await; } n }) }
```

## Trade-offs

- **`async fn` vs `-> impl Future + Send` in the trait**: the bare form keeps
  single-threaded impls legal but breaks generic spawning; the `Send` form is a promise
  you cannot relax later without a breaking change. Private traits can start bare; public
  traits should decide, or ship both with `trait_variant::make`.
- **Static dispatch vs boxing**: AFIT with generics costs no allocation (0.6 to 1.2 ns per
  call above) but monomorphizes per type and forbids `dyn`. Boxing costs one allocation
  per call and buys a `Vec<Box<dyn Store>>`: use it where the set of implementations is
  open at runtime.
- **async-trait vs manual boxing**: the macro handles lifetimes and `Sync` bounds; a
  hand-written `Pin<Box<..>>` drops a proc-macro dependency and shows the cost.
- **`AsyncFn*` vs `Fn() -> Fut`**: `AsyncFn*` is the right bound for callbacks awaited in
  place (borrowing captures and arguments). For callbacks whose futures you spawn,
  `Fn() -> Fut` with `Fut: Send + 'static` is the only stable way to say `Send`.
- **Waiting on the language**: return type notation (issue #109417) and nameable
  `AsyncFn` futures would remove most of these workarounds. Neither is stable in 1.100.

## Documentation Links

- [Announcing async fn and return-position impl Trait in traits, Rust Blog](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/): doc
- [Announcing Rust 1.85.0 and Rust 2024 (async closures), Rust Blog](https://blog.rust-lang.org/2025/02/20/Rust-1.85.0/): doc
- [RFC 3668: async closures](https://rust-lang.github.io/rfcs/3668-async-closures.html): doc
- [RFC 3425: return position impl Trait in traits](https://rust-lang.github.io/rfcs/3425-return-position-impl-trait-in-traits.html): doc
- [The Rust Reference: traits, dyn compatibility](https://doc.rust-lang.org/reference/items/traits.html): doc
- [std::ops::AsyncFn](https://doc.rust-lang.org/std/ops/trait.AsyncFn.html): doc
- [trait-variant crate docs](https://docs.rs/trait-variant/latest/trait_variant/): doc
- [async-trait crate docs](https://docs.rs/async-trait/latest/async_trait/): doc
- [Tracking issue for return type notation, rust-lang/rust #109417](https://github.com/rust-lang/rust/issues/109417): doc
