---
version: 1.0
updatedAt: 2026-11-12
title: "Async Traits e Async Closures"
summary: async fn em traits e RPITIT (1.75), o erro de Send ao fazer spawn em código genérico e as correções com -> impl Future + Send e trait_variant::make, return type notation ainda instável, por que dyn com métodos async não é dyn compatible, boxing com async-trait ou Pin<Box<dyn Future>> medido em alocações por chamada, e async closures com AsyncFn, AsyncFnMut e AsyncFnOnce (1.85) contra closures que devolvem futures.
---
## Objective

Desde o Rust 1.75 uma trait pode declarar métodos `async fn` e `-> impl Trait` (RPITIT),
e desde o 1.85 closures podem ser `async` e limitadas por `AsyncFn`, `AsyncFnMut` e
`AsyncFnOnce`. Os dois recursos eliminam muito boxing, e os dois deixam a mesma lacuna: o
future que devolvem é anônimo, então código genérico não consegue dizer "e ele é `Send`".
Esta lição reproduz cada erro de compilação que aparece num serviço Tokio (spawn, `dyn`,
capturas emprestadas) e a correção que funciona no stable hoje.

Medido com Rust 1.100.0 (edição 2024), tokio 1.54.1, trait-variant 0.1.3 e async-trait
0.1.92 (versões do `Cargo.lock`), num Apple M4 Max com macOS. As mensagens do compilador
foram copiadas do `cargo build` e cortadas para as linhas principais.

## Use Cases

- Uma trait de repositório ou de cliente HTTP com métodos `async fn` chamados de tasks
  que o Tokio cria, e uma biblioteca decidindo se a trait pública promete futures `Send`.
- Uma lista de plugins (`Vec<Box<dyn Store>>`) que precisa de despacho em runtime.
- Helpers de retry, middleware e estilo `for_each` que recebem um callback async que
  empresta o argumento ou altera estado capturado.

## Deep Dive

### `async fn` numa trait, e o problema do bound `Send`

`async fn load(&self) -> T` numa trait vira `fn load(&self) -> impl Future<Output = T>`,
e as impls podem usar qualquer uma das grafias. Com um tipo concreto o compilador enxerga
o future real, então os auto traits vazam e o spawn simplesmente funciona (isto imprime
`concrete spawn = 1`):

```rust
trait Ping { async fn ping(&self) -> u32; }
impl Ping for Pinger { async fn ping(&self) -> u32 { 1 } }
println!("concrete spawn = {}", tokio::spawn(async { Pinger.ping().await }).await.unwrap());
```

Agora o mesmo tipo de trait usado de forma genérica, que é o que um servidor faz:

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

`Send + Sync` no serviço não diz nada sobre o future de `fetch`. Numa trait `pub` o
compilador avisa antes: ``warning: use of `async fn` in public traits is discouraged as
auto trait bounds cannot be specified`` (lint `async_fn_in_trait`, ligado por padrão).

### Correção 1: escrever o desaçucaramento e somar `+ Send`

```rust
pub trait HttpService: Send + Sync {
    fn fetch(&self, url: String) -> impl Future<Output = String> + Send;
}
impl HttpService for Client {
    async fn fetch(&self, url: String) -> String { // impls ainda podem usar `async fn`
        tokio::task::yield_now().await;
        format!("<html>{url}</html>")
    }
}
fn spawn_fetch(s: impl HttpService + 'static) -> tokio::task::JoinHandle<String> {
    tokio::spawn(async move { s.fetch("https://rust-lang.org".into()).await })
}
```

`spawn_fetch(Client).await` imprime `<html>https://rust-lang.org</html>`. O preço passa
para quem implementa: toda impl agora precisa produzir um future `Send`, e uma que mantém
um `Rc` vivo através de um `.await` é rejeitada na própria impl:

```text
error: future cannot be sent between threads safely
   = help: within `impl Future<Output = String>`, the trait `Send` is not implemented for `Rc<i32>`
note: future is not `Send` as this value is used across an await
```

### Correção 2: `trait_variant::make` gera as duas traits

Para traits públicas, o blog do Rust recomenda o crate `trait-variant`, da rust-lang:

```rust
#[trait_variant::make(SendCache: Send)]
pub trait LocalCache {
    async fn get(&self, key: u32) -> Option<String>;
}
impl SendCache for Mem {
    async fn get(&self, key: u32) -> Option<String> { Some(format!("v{key}")) }
}
// spawn_get(c: impl SendCache + Sync + 'static) faz spawn de c.get(7); depois LocalCache::get(&Mem, 9)
```

```text
Some("v7")
via LocalCache: Some("v9")
```

`SendCache` ganha métodos `-> impl Future + Send`, e a segunda linha mostra a impl
genérica gerada: todo tipo `SendCache` também é `LocalCache`. O blog aponta o limite: um
tipo não consegue implementar a variante `Send` condicionalmente aos seus genéricos
(wrappers de middleware). A correção geral, limitar o future no ponto de uso com
`where S::fetch(..): Send` (return type notation), ainda falha no 1.100 com
`error[E0658]: return type notation is experimental` (issue #109417).

### `dyn` continua fora, então faça boxing do future

```rust
trait Store { async fn load(&self, id: u64) -> Option<String>; }
let stores: Vec<Box<dyn Store>> = vec![Box::new(Pg)];
```

```text
error[E0038]: the trait `Store` is not dyn compatible
2 |     async fn load(&self, id: u64) -> Option<String>;
  |              ^^^^ ...because method `load` is `async`
```

As regras de dyn compatibility da Reference proíbem tipo de retorno opaco num método
despachável (nada de `async fn` nem RPITIT): o future de cada impl tem tipo e tamanho
próprios, então nenhuma entrada de vtable consegue descrevê-lo. O trait-variant 0.1.3
ainda oferece só `make`; o despacho dinâmico que o post de 2023 planejava para ele não
saiu. A saída é apagar o future em `Pin<Box<dyn Future + Send + '_>>`. A documentação do
async-trait mostra a expansão: cada método devolve exatamente isso e embrulha o corpo em
`Box::pin(async move { .. })`. À mão:

```rust
trait ManualStore {
    fn load(&self, id: u64) -> Pin<Box<dyn Future<Output = u64> + Send + '_>>;
}
// corpo da impl: Box::pin(async move { id * 2 })
```

Um `#[global_allocator]` que conta alocações e 1 000 000 de chamadas por linha (release):

```text
AFIT, generic (static)       allocs/call = 0    0.7 ns/call  (checksum 999999000000)
#[async_trait] via &dyn      allocs/call = 1   16.2 ns/call  (checksum 999999000000)
manual Pin<Box<dyn Future>>  allocs/call = 1   14.7 ns/call  (checksum 999999000000)
```

As alocações foram idênticas em 3 execuções; as linhas com boxing variaram de 14,5 a
24,0 ns. O corpo é trivial de propósito: perto de uma ida ao banco, uma alocação é ruído.
`#[async_trait(?Send)]` tira o bound `Send` para executores de uma thread só.

### Async closures e as traits `AsyncFn*`

Uma closure que devolve um bloco `async` não consegue emprestar as capturas a esse future:

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

E `F: for<'c> FnMut(&'c str) -> Fut` rejeita até um simples `async fn log_city(&str)`,
porque `Fut` é um único tipo escolhido por quem chama e não pode depender de `'c`: o rustc
reporta `error[E0308]: mismatched types` ("one type is more general than the other") e
``error: implementation of `FnMut` is not general enough``. `AsyncFnMut(&str)` resolve os
dois, porque o future dele pode emprestar o argumento e as capturas, e itens async fn
também o implementam:

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

### `AsyncFn` tem o seu próprio problema de `Send`

O future dele é um tipo associado que não pode ser nomeado no stable, então não aceita bound:

```rust
fn spawn_retry<F>(f: F) where F: AsyncFn() -> u32 + Send + Sync + 'static {
    tokio::spawn(async move { f().await });
}
```

```text
error: future cannot be sent between threads safely
    = help: within `{async block@src/bin/j_asyncfn_send.rs:5:18: 5:28}`, the trait `Send` is not implemented for `<F as AsyncFnMut<()>>::CallRefFuture<'_>`
```

Somar `for<'a> F::CallRefFuture<'a>: Send` dá ``error[E0658]: use of unstable library
feature `async_fn_traits` ``, e `Box<dyn AsyncFn() -> u32>` dá ``error[E0038]: the trait
`AsyncFn` is not dyn compatible`` ("because it contains generic associated type
`CallRefFuture`"). Para spawn, mantenha a forma com dois parâmetros, cujo `Fut` tem nome:

```rust
fn spawn_retry<F, Fut>(f: F) -> tokio::task::JoinHandle<u32>
where F: Fn() -> Fut + Send + 'static, Fut: Future<Output = u32> + Send,
{ tokio::spawn(async move { let mut n = 0; for _ in 0..3 { n += f().await; } n }) }
```

## Trade-offs

- **`async fn` vs `-> impl Future + Send` na trait**: a forma pura mantém impls de uma
  thread só legais, mas quebra spawn genérico; a forma com `Send` é uma promessa que não
  dá para relaxar depois sem quebrar a API. Traits privadas podem começar puras; traits
  públicas precisam decidir, ou entregar as duas com `trait_variant::make`.
- **Despacho estático vs boxing**: AFIT com genéricos não aloca (0,6 a 1,2 ns por chamada
  acima), mas monomorfiza por tipo e proíbe `dyn`. Boxing custa uma alocação por chamada
  e compra um `Vec<Box<dyn Store>>`, útil quando as implementações só se conhecem em runtime.
- **async-trait vs boxing manual**: a macro cuida de lifetimes e bounds `Sync`; um
  `Pin<Box<..>>` escrito à mão elimina uma dependência de proc macro e deixa o custo à vista.
- **`AsyncFn*` vs `Fn() -> Fut`**: `AsyncFn*` é o bound certo para callbacks aguardados no
  lugar (emprestando capturas e argumentos). Para callbacks cujos futures você manda para
  spawn, `Fn() -> Fut` com `Fut: Send + 'static` é o único jeito estável de dizer `Send`.
- **Esperando a linguagem**: return type notation (issue #109417) e futures de `AsyncFn`
  com nome eliminariam a maior parte destes contornos. Nenhum dos dois é estável no 1.100.

## Documentation Links

- [Announcing async fn and return-position impl Trait in traits, blog do Rust](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/): doc
- [Announcing Rust 1.85.0 and Rust 2024 (async closures), blog do Rust](https://blog.rust-lang.org/2025/02/20/Rust-1.85.0/): doc
- [RFC 3668: async closures](https://rust-lang.github.io/rfcs/3668-async-closures.html): doc
- [RFC 3425: return position impl Trait in traits](https://rust-lang.github.io/rfcs/3425-return-position-impl-trait-in-traits.html): doc
- [The Rust Reference: traits, dyn compatibility](https://doc.rust-lang.org/reference/items/traits.html): doc
- [std::ops::AsyncFn](https://doc.rust-lang.org/std/ops/trait.AsyncFn.html): doc
- [Documentação do crate trait-variant](https://docs.rs/trait-variant/latest/trait_variant/): doc
- [Documentação do crate async-trait](https://docs.rs/async-trait/latest/async_trait/): doc
- [Issue de acompanhamento da return type notation, rust-lang/rust #109417](https://github.com/rust-lang/rust/issues/109417): doc
