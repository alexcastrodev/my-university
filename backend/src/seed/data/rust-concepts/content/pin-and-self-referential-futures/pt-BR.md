---
version: 1.0
updatedAt: 2026-11-12
title: "Pin e Futures Autorreferenciais"
summary: Por que a máquina de estados de um async fn pode apontar para si mesma (medido em memória), a garantia de Pin e o auto trait Unpin, os erros reais do compilador ao chamar poll num future sem pin, pin! versus Box::pin, pinning estrutural e projeção com pin-project-lite (incluindo a proibição de Drop e o PinnedDrop) e o que acontece, nativamente e no Miri, quando código unsafe move um future já fixado, com o motivo do RFC 2349.
---
## Objective

`Future::poll` recebe `self: Pin<&mut Self>` porque a máquina de estados de um
`async fn` pode apontar para dentro de si mesma: um local emprestado através de
um `.await` mora no future, e a referência para ele também. Um move deixaria
essa referência no endereço antigo. `Pin` é uma promessa de biblioteca de que o
valor apontado fica no lugar até ser destruído; `Unpin` marca os tipos para os
quais a promessa não significa nada. A lição mostra a autorreferência na
memória, os erros do compilador quando o pin é esquecido, `pin!` versus
`Box::pin`, pinning estrutural com pin-project-lite e o que quebra, no Miri,
quando código unsafe mente.

Medido com Rust 1.100.0 (rustc 0ef1bc386 2026-11-09), edição 2024, Apple
Silicon (aarch64-apple-darwin, macOS), pin-project-lite 0.2.17 (Cargo.lock).
O Miri só existe no nightly, então rodou no nightly-2025-02-20 (miri
f280acf4c7).

## Use Cases

- Escrever um wrapper de `Future` ou `Stream` (timeout, métricas, retry) em
  volta de um future interno: isso é projeção de pin.
- Guardar futures de tipos diferentes juntos: `Pin<Box<dyn Future>>`.
- Chamar `poll` no mesmo future em várias voltas de um loop (`select!` em
  loop).
- Ler erros "cannot be unpinned" e escolher entre `pin!`, `Box::pin` e `Unpin`.
- Revisar código `unsafe` que chama `Pin::new_unchecked`.

## Deep Dive

### A autorreferência, na memória

```rust
let fut = async {
    let buf = [9u8; 64];
    let r = &buf; // referência a um local que mora no future
    YieldNow(false).await;
    println!("after await: r={:p} r[0]={}", r, r[0]);
};
let mut boxed = Box::pin(fut);
let start = &*boxed as *const _ as *const u8 as usize;
let size = std::mem::size_of_val(&*boxed);
println!("future on the heap: {:#x}..{:#x} ({size} bytes)", start, start + size);
let _ = boxed.as_mut().poll(&mut cx); // Pending
let _ = boxed.as_mut().poll(&mut cx); // imprime, Ready
```

```text
future on the heap: 0x101515a40..0x101515a90 (80 bytes)
after await: r=0x101515a40 r[0]=9
```

`r` aponta para o primeiro byte do future: o future guarda um ponteiro para si
mesmo. Uma struct feita à mão, `struct SelfRef { data: [u8; 16], ptr: *const
[u8; 16] }`, mostra o que um move faz: com `ptr = &data` dentro de `make()`,
`ptr` continuou `0x16ee68ee0` enquanto `&data` virou `0x16ee69040` depois do
retorno e `0x101515a20` depois de `vec![s]` (execução em debug; release fez o
mesmo). Um move copia o valor byte a byte, "without running any code to notify
that value that its address has changed" (documentação da std), então nada
corrige o ponteiro.

### O que `Pin` promete

A documentação de `std::pin`: "From the moment a value is pinned by
constructing a Pinning pointer to it, that value must remain, valid, at that
same address in memory, until its `drop` handler is called." `Pin<Ptr>` é
`#[repr(transparent)]` (mesmo layout e ABI de `Ptr`) e garante isso por
omissão: para um valor `!Unpin` não existe `DerefMut`, então código seguro
nunca obtém o `&mut T` de que `mem::swap` ou `mem::replace` precisam.
`std::mem::swap(&mut *a, &mut *b)` em dois futures fixados com `pin!` falha com
"E0596: cannot borrow data in dereference of `Pin<&mut impl Future<Output =
u32>>` as mutable" e "trait `DerefMut` is required to modify through a
dereference".

`Unpin` é o auto trait que cancela tudo isso: `Pin::new`, `get_mut` e
`DerefMut` só existem para valores `Unpin`. Quase todo tipo é `Unpin`; futures
gerados pelo compilador não são, e um campo `PhantomPinned` tira uma struct da
lista. Com `fn assert_unpin<T: Unpin>(_: &T)`, `std::future::ready(1)` passou,
enquanto um future de `async fn` e uma struct com `PhantomPinned` falharam com
"`{async fn body of work()}` cannot be unpinned" e "`PhantomPinned` cannot be
unpinned".

### `poll` num future sem pin: os erros reais

```rust
let mut fut = work();
let _ = fut.poll(&mut cx);                // build 1
let _ = Pin::new(&mut fut).poll(&mut cx); // build 2 (arquivo separado)
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

Os dois erros citam as duas correções; o primeiro aponta para o capítulo de
pinning do async book.

### `pin!` versus `Box::pin`

```rust
let mut tasks: Vec<Pin<Box<dyn Future<Output = u32>>>> =
    vec![Box::pin(small()), Box::pin(big())]; // big() guarda 4 KiB através do .await
let local = pin!(big());
let boxed = Box::pin(big());
// imprime: o poll de cada task, depois size_of_val do handle e do valor
```

```text
Ready(1) Ready(2)
pin!(big())      handle  8 bytes, future 4098 bytes (in this frame)
Box::pin(big())  handle  8 bytes, future 4098 bytes (on the heap)
Pin<Box<dyn ..>> handle 16 bytes
```

`pin!` (estável desde 1.68) fixa no lugar sem alocar; a documentação prefere
"local pinning", porque dentro de um `async fn` o local fixado passa a fazer
parte do estado do future que o contém. Ele move o valor para dentro (usar o
original depois é E0382, "use of moved value") e não sai do escopo: devolver
`pin!(work())` de uma função é E0515, "cannot return value referencing
temporary value". `Box::pin` custa uma alocação e entrega um handle próprio
para devolver, guardar ou apagar para `dyn Future` (fat pointer de 16 bytes).

### Pinning estrutural e projeção

Um wrapper que conta os polls de um future interno, escrito de forma ingênua:

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

O bound `F: Unpin` sugerido compila, mas rejeita todo future de `async fn`. A
correção de verdade é projeção: `inner` é fixado *estruturalmente*
(`Pin<&mut Self>` dá `Pin<&mut F>`), `polls` não (dá `&mut u32`). À mão isso é
`get_unchecked_mut` mais `Pin::new_unchecked`, correto só sob as regras que a
documentação de `std::pin` lista: a struct só é `Unpin` se os campos
estruturais forem, o `Drop` precisa tratar `self` como fixado, nada de
`#[repr(packed)]` e nada pode mover dados para fora de um campo estrutural. O
pin-project-lite gera isso sem `unsafe`:

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

(`work()` faz `.await` em dois yields, então são três polls.) A macro também
impõe as regras: `Counted<F>` é `Unpin` exatamente quando `F` é, e um
`impl Drop` comum falha com "E0119: conflicting implementations of trait
`MustNotImplDrop`". A limpeza vai em `impl<F> PinnedDrop for Counted<F> { fn
drop(this: Pin<&mut Self>) { .. } }` dentro da macro, que rodou e imprimiu
`polled 3 times`.

### Por que `Pin` existe: quebrando a promessa

`Pin::new_unchecked` é `unsafe` porque quem chama promete que o valor nunca
mais se move. Este programa chama `poll` num future (criando a
autorreferência), move o future para fora do stack frame e chama `poll` de
novo:

```rust
fn start(cx: &mut Context<'_>) -> impl Future<Output = u8> + use<> {
    let mut fut = make(); // async { let buf = [9u8; 64]; let r = &buf; yield.await; r[0] }
    let _ = unsafe { Pin::new_unchecked(&mut fut) }.poll(cx);
    fut // movido enquanto guarda um ponteiro para este frame
}
let mut fut = start(&mut cx);
clobber(); // escreve 0xAA por cima do frame morto
let out = unsafe { Pin::new_unchecked(&mut fut) }.poll(&mut cx);
```

```text
native (debug and release): second poll: Ready(170) (expected Ready(9))
miri: error: Undefined Behavior: constructing invalid value at .<coroutine-state(3)>.<captured-var(1)>: encountered a dangling reference (use-after-free)
```

170 é `0xAA`: o future leu um stack frame morto e nada travou. O Miri para
antes, em `let mut fut = start(..)`: o valor devolvido já carrega uma
referência pendente. O RFC 2349 escolheu um tipo de biblioteca em vez de um
trait embutido `?Move` porque esse bound "ended up 'infecting' many different
APIs where it wasn't relevant"; com `Pin`, só as APIs que precisam de
imobilidade aderem, e código seguro nunca consegue fazer o move acima.

## Trade-offs

- **`pin!` ou `Box::pin`**: `pin!` é de graça mas preso ao frame; `Box::pin`
  custa uma alocação e pode ser devolvido, guardado ou virar `dyn`. Use `pin!`
  por padrão e `Box` nas fronteiras de API.
- **Um bound `Unpin` é a saída fácil**: `F: Future + Unpin` libera `Pin::new` e
  `get_mut`, mas empurra `Box::pin` para todo chamador com um future de
  `async fn`. Bibliotecas costumam projetar.
- **pin-project-lite versus pin-project**: não ter dependências de proc-macro
  é, nas palavras da documentação, "the only reason to use this crate" (sem
  ganho se você já puxa o syn). Faltam tuple structs, `Unpin` customizado e
  mensagens de erro úteis; o pin-project tem os três.
- **`!Unpin` contamina**: uma struct que guarda um future de `async fn` por
  valor vira `!Unpin`, e quem a usa também precisa fixá-la.
- **Pin é um contrato, não uma verificação**: o programa quebrado acima
  "funcionou" nativamente com um valor errado. Rode código que usa
  `new_unchecked` ou `map_unchecked_mut` no Miri.

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
