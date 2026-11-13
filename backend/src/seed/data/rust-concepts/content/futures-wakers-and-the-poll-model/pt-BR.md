---
version: 1.0
updatedAt: 2026-11-12
title: "Futures, Wakers e o Modelo de Poll"
summary: A trait Future com Poll, Context e Waker, o enum de estados que o compilador gera para um async fn (medido com size_of_val e -Zprint-type-sizes), por que o tamanho do future cresce com o que atravessa o .await e onde Box::pin ajuda, um executor block_on mínimo só com std (Wake e thread park) e o travamento silencioso de um Pending sem wake, inclusive como ele se disfarça de latência sob tokio::time::timeout.
---
## Objective

Um future não faz nada até alguém chamar `poll`, que termina (`Poll::Ready`) ou
devolve `Poll::Pending` depois de providenciar, pelo `Waker` do seu `Context`,
que será chamado de novo. Um `async fn` vira uma máquina de estados em forma de
enum que guarda todo local vivo através de um `.await`; um executor é o loop
que chama `poll` e dorme até um waker disparar. A lição monta cada peça só com
std, mede tamanhos de futures e mostra o travamento silencioso de um `Pending`
sem wake.

Medido com Rust 1.100.0 (rustc 0ef1bc386 2026-11-09), edição 2024, Apple
Silicon (aarch64-apple-darwin, macOS); uma comparação usa tokio 1.54.1.

## Use Cases

- Escrever um future folha (um timer, a conclusão de um callback C) que nenhum
  runtime oferece pronto.
- Depurar uma task que trava, ou que sempre termina exatamente quando um
  timeout sem relação dispara: o clássico wakeup perdido.
- Achar futures de vários kilobytes em cadeias de chamadas profundas e saber
  onde `Box::pin` ajuda.
- Testar um future chamando `poll` à mão com `Waker::noop()`.

## Deep Dive

### A trait e um future escrito à mão

Além de `type Output`, a trait é um método só: `fn poll(self: Pin<&mut Self>,
cx: &mut Context<'_>) -> Poll<Self::Output>`. `CountDown(n)` fica pronto depois
de `n` polls; antes de cada `Pending` ele chama `wake_by_ref()`, que significa
"me chame de novo logo" (o padrão yield-now):

```rust
struct CountDown(u32);
impl Future for CountDown {
    type Output = &'static str;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.0 == 0 { return Poll::Ready("done"); }
        self.0 -= 1;
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
let mut cx = Context::from_waker(Waker::noop()); // estável desde 1.85
let mut fut = CountDown(2);
let mut fut = Pin::new(&mut fut); // ok: CountDown é Unpin
for i in 1..=3 { println!("poll {i}: {:?}", fut.as_mut().poll(&mut cx)); }
```

```text
poll 1: Pending
poll 2: Pending
poll 3: Ready("done")
```

Chamar `poll` de novo num bloco `async` já terminado deu panic com "`async fn`
resumed after completion"; a documentação de `Future` permite panic ou
travamento nesse caso, nunca UB. A Reference descreve `x.await` como um loop
que fixa o operando com `Pin::new_unchecked`, chama `poll`, sai no `Ready` e
faz `yield` no `Pending`: esse `yield` transforma o corpo numa corrotina
retomável.

### O tamanho do future é o que atravessa o `.await`

`yield_now()` é um future de 1 byte que devolve `Pending` uma vez. Cada valor é
`std::mem::size_of_val(&f())` de um `async fn` que nunca recebeu `poll`:

```rust
async fn buf_dropped_before_await() { { let b = [7u8; 1024]; black_box(&b); } yield_now().await; }
async fn buf_held_across_await() { let b = [7u8; 1024]; yield_now().await; black_box(&b); }
async fn two_phases() {
    let a = [1u8; 1024]; yield_now().await; black_box(&a);
    let b = [2u8; 2048]; yield_now().await; black_box(&b);
}
async fn two_scoped_phases() {
    { let a = [1u8; 1024]; yield_now().await; black_box(&a); }
    { let b = [2u8; 2048]; yield_now().await; black_box(&b); }
}
async fn awaits_big_child()   { buf_held_across_await().await; }
async fn awaits_boxed_child() { Box::pin(buf_held_across_await()).await; }
```

```text
buf_dropped_before_await     2
buf_held_across_await     1026
two_phases                3074
two_scoped_phases         2050
awaits_big_child          1027
awaits_boxed_child          16
```

Mesmos números em debug e release. Um buffer que morre antes do `.await` não
custa nada. `two_phases` mantém `a` no escopo durante o segundo `.await`, então
os dois arrays coexistem; fechar os escopos deixa os dois dividirem bytes
(2050). Fazer `.await` num filho embute o filho inteiro (1026 + 1), então os
tamanhos se somam ao longo da cadeia, e `Box::pin` troca o filho por um
ponteiro de 8 bytes. O lint pedantic `large_futures` do Clippy (limite padrão
de 16384 bytes) apontou um filho de 20002 bytes aqui com "help: consider
`Box::pin` on it: `Box::pin(huge())`".

### A máquina de estados por trás

A flag instável `-Zprint-type-sizes` (aqui no 1.100.0 via `RUSTC_BOOTSTRAP=1`,
aceitável para uma olhada, nunca para um build; prefixo das linhas cortado)
mostra o enum:

```text
type: `{async fn body of two_phases()}`: 3074 bytes, alignment: 1 bytes
    discriminant: 1 bytes
    variant `Unresumed`: 0 bytes
    variant `Suspend0`: 1025 bytes
        local `.a`: 1024 bytes
        local `.__awaitee`: 1 bytes, type: YieldNow
    variant `Suspend1`: 3073 bytes
        local `.a`: 1024 bytes
        local `.__awaitee`: 1 bytes, type: YieldNow
        local `.b`: 2048 bytes
    variant `Returned`: 0 bytes
    variant `Panicked`: 0 bytes
```

`Unresumed` guarda os argumentos antes do primeiro poll, cada `SuspendN` guarda
os locais vivos naquele `.await` mais o filho aguardado (`__awaitee`), e
`Returned` é o que produz o panic acima. Argumentos podem contar duas vezes:
`async fn with_arg(x: [u8; 512])` mediu 1026 bytes, porque `Suspend0` guarda o
argumento capturado (`upvar .x`) e a cópia do corpo (`local .x`).

### Context e Waker: o contrato

Pela documentação da std (o compilador não verifica nada disso): devolver
`Pending` obriga o future a guardar um clone de `cx.waker()` e acordá-lo quando
houver progresso possível, e em polls repetidos "only the `Waker` from the
`Context` passed to the most recent call should be scheduled". `Waker` é
`Send + Sync`, então uma thread de timer, um loop de epoll ou um callback C
podem acordá-lo; cada `wake()` acontece antes (happens-before) de pelo menos um
`poll` seguinte, e vários wakes podem virar um poll só. `Wake` (1.51) cria um
`Waker` a partir de um `Arc<W>` com segurança; a vtable `unsafe` de `RawWaker`
fica para executores que não podem alocar.

### Um executor mínimo: `block_on` com thread park

A documentação de `Wake` traz este executor; só o contador de polls é novo:

```rust
struct ThreadWaker(Thread);
impl Wake for ThreadWaker {
    fn wake(self: Arc<Self>) { self.0.unpark(); }
}
fn block_on<T>(fut: impl Future<Output = T>) -> T {
    let mut fut = pin!(fut);
    let waker: Waker = Arc::new(ThreadWaker(thread::current())).into();
    let mut cx = Context::from_waker(&waker);
    let mut polls = 0;
    loop {
        polls += 1;
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            println!("[block_on] ready after {polls} polls");
            return v;
        }
        thread::park(); // dorme até algum Waker chamar unpark
    }
}
```

A folha é um `Sleep` no formato do `TimerFuture` do async book: um
`Mutex<{ done, waker }>` compartilhado e uma thread criada no primeiro poll que
dorme, marca `done` e chama `waker.take().wake()`. Todo poll que devolve
`Pending` atualiza o waker guardado com `w.clone_from(cx.waker())`, que evita o
clone quando `will_wake` diz que é a mesma task. Rodando
`block_on(async { sleep(50 ms).await; sleep(20 ms).await; 7 })`:

```text
after 1st sleep: 54.687583ms
after 2nd sleep: 80.35325ms
[block_on] ready after 3 polls
value = 7, total 80.361625ms
```

Três execuções em release: sempre 3 polls (início, depois um por wake), total
de 80 a 85 ms para 70 ms de sleep; a thread estaciona, nada gira em falso. A
documentação avisa que este executor troca correção por simplicidade: um future
que use `park`/`unpark` por conta própria, ou um `block_on` aninhado, o quebra.

### `Pending` sem wake: o travamento silencioso

`YieldOnce` devolve `Pending` uma vez e depois `Ready`; `wake` decide se ele
pede para ser chamado de novo. `block_on` roda numa thread separada e a main
espera 2 s:

```rust
fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
    if self.yielded { return Poll::Ready(()); }
    self.yielded = true;
    if self.wake { cx.waker().wake_by_ref(); } // a linha que importa
    Poll::Pending
}
```

```text
wake=false: Timeout after 2s, executor thread parked forever
wake=true: completed
```

Sem erro, sem CPU, sem log: a task nunca mais recebe `poll`. No tokio (runtime
current-thread) o `YieldOnce` sem waker se esconde melhor:

```text
tokio::time::timeout(Duration::from_millis(500), YieldOnce { yielded: false }).await
=> Ok(()) after 509.945959ms
```

Três execuções: `Ok(())` depois de 508 a 511 ms, nunca `Err(Elapsed)`. O wake
do timer chama `poll` na task inteira e, segundo a documentação do tokio, "the
future is polled before the timeout is checked", então o future bugado
termina. Em produção isso parece latência presa a um timer qualquer, não um
travamento.

## Trade-offs

- **Futures sem pilha**: nada de pilha para reservar ou crescer, tamanho
  conhecido em tempo de compilação. O preço: todo byte que atravessa um
  `.await` mora no future e é copiado quando ele se move. As virtual threads do
  Java são a alternativa com pilha.
- **Coloque os filhos grandes em Box**: `Box::pin(child()).await` reduziu 1027
  bytes para 16 ao custo de uma alocação por chamada; faça isso onde o
  `large_futures` apontar, não em todo lugar.
- **Futures à mão só nas folhas**: `async fn` acerta o contrato de wake por
  construção. Um `poll` manual que esquece o waker compila, passa em testes que
  têm outra fonte de wake e trava em produção. Prefira `std::future::poll_fn`
  (1.64) ou uma primitiva pronta.
- **Regras de wake são documentação, não tipos**: tolere polls extras (wakes se
  juntam) e use `will_wake`/`clone_from` para não clonar o waker à toa.
- **`block_on` não é um runtime**: sem reactor de I/O nem roda de timers, cada
  `Sleep` consome uma thread do SO; sockets são assunto da lição do runtime
  tokio.

## Documentation Links

- [std::future::Future, Rust standard library](https://doc.rust-lang.org/std/future/trait.Future.html): doc
- [std::task::Waker, Rust standard library](https://doc.rust-lang.org/std/task/struct.Waker.html): doc
- [std::task::Wake (block_on example), Rust standard library](https://doc.rust-lang.org/std/task/trait.Wake.html): doc
- [Await expressions, The Rust Reference](https://doc.rust-lang.org/reference/expressions/await-expr.html): doc
- [Task Wakeups with Waker, Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/02_execution/03_wakeups.html): doc
- [Applied: Build an Executor, Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/02_execution/04_executor.html): doc
- [tokio::time::timeout, tokio docs](https://docs.rs/tokio/latest/tokio/time/fn.timeout.html): doc
- [Clippy lints (large_futures), Clippy 1.100.0](https://clippy.rust-lang.org/rust-1.100.0/index.html#large_futures): doc
- [Rust for Rustaceans (Jon Gjengset, No Starch Press 2021), chapter 8: Asynchronous Programming](https://nostarch.com/rust-rustaceans): book
