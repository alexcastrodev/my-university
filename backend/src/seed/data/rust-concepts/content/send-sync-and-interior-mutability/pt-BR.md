---
version: 1.0
updatedAt: 2026-11-13
title: "Send, Sync e Mutabilidade Interior"
summary: Send e Sync como auto traits, com uma tabela compilada de quais tipos da std os implementam, os erros E0277 reais de Rc, RefCell e Cell entre threads, a corrupção medida do contador de um Rc com um unsafe impl Send falso, UnsafeCell como única porta legal para a mutabilidade interior e o assembly que ela muda, tamanhos de Cell e RefCell e o panic de reentrância do RefCell, OnceLock e LazyLock (1.80) em corrida, envenenamento e deadlock reentrante, e unsafe impl Send e Sync escritos à mão com a pegadinha da captura disjunta da edição 2021, no Rust 1.100.0.
---
## Objective

`Send` e `Sync` estão por trás de todo erro "cannot be sent between threads safely", e a
mutabilidade interior (`Cell`, `RefCell`, `UnsafeCell`, `OnceLock`, `LazyLock`) é como o Rust
muta através de uma referência compartilhada sem perder essa checagem. Esta lição compila a
tabela de auto traits, lê erros E0277 reais, mente sobre o `Rc` para ver o contador quebrar,
dispara os modos de falha de `RefCell` e `OnceLock` e escreve `unsafe impl Send` à mão,
incluindo a pegadinha de captura em closures que faz o impl parecer ignorado.

Medido com Rust 1.100.0 (edição 2024, só std), builds de release num Apple M4 Max
(14 núcleos, macOS, arm64). Toda saída foi idêntica em pelo menos 3 execuções, salvo
quando o texto diz o contrário.

## Use Cases

- Ler um E0277 sobre `Rc`, `RefCell`, `Cell` ou ponteiro cru e escolher o substituto certo
  (`Arc`, `Mutex`, `RwLock`, um atômico) em vez de embrulhar tipos até compilar.
- Escolher entre `Cell`, `RefCell`, `Mutex<T>` e `RwLock<T>` para estado compartilhado.
- Trocar `lazy_static!` e o crate `once_cell` por `LazyLock` e `OnceLock`.
- Embrulhar um handle de FFI ou um buffer de ponteiro cru e decidir se pode cruzar threads.
- Depurar "RefCell already borrowed" em código de observer e de callback.

## Deep Dive

### Send e Sync são auto traits

`T: Send` significa que um `T` pode ser movido para outra thread; `T: Sync` significa que
`&T` pode ser compartilhado, o que é o mesmo que `&T: Send`. O Rustonomicon as chama de
traits unsafe e derivadas automaticamente: um tipo feito só de partes `Send` (`Sync`) é
`Send` (`Sync`), e as grandes exceções são ponteiros crus, `UnsafeCell` (não é `Sync`) e
`Rc`. A tabela saiu de compilar `fn check<T: Send>() {}` e `fn check<T: Sync>() {}` por tipo:

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

As regras por trás das linhas: `&T` é `Send` só se `T: Sync`. `Arc<T>` exige
`T: Send + Sync`, então `Arc<Cell<i32>>` não é nenhum dos dois. `Mutex<T>` é `Sync` quando
`T: Send` (uma thread por vez), enquanto `RwLock<T>` também exige `T: Sync` porque os
leitores compartilham o valor. `MutexGuard` não é `Send` porque, diz o Rustonomicon, as
bibliotecas de lock exigem liberá-lo na mesma thread que o adquiriu.

### Lendo os erros: primeiro o tipo raiz, depois a cadeia

```text
error[E0277]: `Rc<i32>` cannot be sent between threads safely
  = help: within `{closure@errors/e1_rc_spawn.rs:6:32: 6:39}`, the trait `Send` is not implemented for `Rc<i32>`

error[E0277]: `RefCell<i32>` cannot be shared between threads safely
  = note: if you want to do aliasing and mutation between multiple threads, use `std::sync::RwLock` instead
  = note: required for `Arc<RefCell<i32>>` to implement `Send`

error[E0277]: `Cell<i32>` cannot be shared between threads safely
  = note: required for `&Cell<i32>` to implement `Send`
```

O terceiro é um `thread::scope` emprestando um `Cell`: não há problema de `'static`, só de `Sync`.

### Por que Rc não é Send: mentir e medir

O `Rc` guarda um contador comum, não atômico. Um wrapper com um `unsafe impl Send` falso
compila, e o programa tem comportamento indefinido. Oito threads rodam cada uma este laço:

```rust
struct Sneaky(Rc<u64>);
unsafe impl Send for Sneaky {} // a mentira

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

Em 46 execuções o contador nunca deu 1 (de 3 a 40): atualizações se perderam e o valor
vaza. Perdê-las no outro sentido libera memória ainda em uso. O `Arc` imprimiu 1 sempre.

### UnsafeCell é a única porta

Mutar através de `&T` é comportamento indefinido a menos que os bytes morem num
`UnsafeCell`, e o compilador recusa o cast óbvio de saída:

```text
error: assigning to `&T` is undefined behavior, consider using an `UnsafeCell`
2 |     unsafe { *(x as *const i32 as *mut i32) += 1 };
  = note: `#[deny(invalid_reference_casting)]` on by default
```

O motivo é otimização. Leia o mesmo valor duas vezes em volta de uma chamada opaca:

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

Atrás de `&i32` o compilador assume que nada muda e dobra a primeira leitura; `&Cell`
força uma releitura. `Cell`, `RefCell`, `Mutex`, `OnceLock` e os atômicos embrulham o
`UnsafeCell`, que é `!Sync`; os thread-safe voltam a ser `Sync` com `unsafe impl Sync`.

### Cell e RefCell

`Cell<T>` nunca entrega uma referência ao conteúdo: valores entram e saem com `get`
(para `Copy`), `set`, `replace` e `take`, a custo zero. Tamanhos via `size_of`:

```text
Cell<i32>          4 bytes
RefCell<i32>      16 bytes
Option<&u8>        8 bytes
Option<Cell<&u8>> 16 bytes
```

As duas últimas linhas são a perda de niche que a doc do `UnsafeCell` avisa. `RefCell<T>`
entrega referências de verdade e confere as regras de empréstimo em runtime com um contador
guardado ao lado do valor; quebre as regras e ele entra em panic. O caso realista é a
reentrância: um listener que se inscreve enquanto `publish` itera a lista onde ele empurraria.

```rust
fn publish(&self, msg: &str) {
    for l in self.listeners.borrow().iter() { l(self, msg); }
}
bus.subscribe(|bus, m| {
    if m == "login" {
        bus.subscribe(|_, m| println!("late listener got {m}")); // borrow_mut reentrante
    }
});
```

```text
logger got hello
logger got login

thread 'main' (215755) panicked at src/bin/refcell_panic.rs:11:24:
RefCell already borrowed
```

No sentido contrário a mensagem é `RefCell already mutably borrowed`, e `try_borrow_mut`
devolve `Err(BorrowMutError)` em vez de entrar em panic. As correções usuais: iterar sobre
um clone da lista (de `Rc<dyn Fn>`), ou enfileirar inscrições e aplicá-las depois do laço.

### OnceLock e LazyLock

`OnceLock` (1.70) e `LazyLock` (1.80) são os `OnceCell` e `LazyCell` thread-safe, e
substituem `lazy_static!` e `once_cell`. Oito threads disputam
`CONFIG.get_or_init(load_config)`, onde `load_config` dorme 100 ms:

```text
init ran 1 time(s), distinct addresses: 1, per-thread ms: [107, 107, 107, 107, 107, 107, 107, 107]
```

Um inicializador rodou e sete threads bloquearam nele (102 a 107 ms), nas 6 execuções. Os
tipos diferem quando o inicializador entra em panic ou chama a si mesmo (3 execuções cada):

| caso | `OnceLock` | `LazyLock` | `OnceCell` |
|------|------------|------------|------------|
| init entra em panic, depois novo acesso | roda o init de novo (imprimiu 7) | panic: `LazyLock instance has previously been poisoned` | roda o init de novo (imprimiu 7) |
| init chama a si mesmo | deadlock, 0.0% de CPU após 3 s | deadlock, 0.0% de CPU após 3 s | panic: `reentrant init` |

A doc do `OnceLock` chama o init reentrante de não especificado: a segunda linha é sempre bug seu.

### Implementando Send e Sync à mão

Um tipo com ponteiro cru é `!Send` e `!Sync` mesmo quando é dono dos dados. A correção é
um `unsafe impl` com bounds que batem com o que o tipo expõe, como faz o `Box<T>`:

```rust
struct MyBox<T> { ptr: NonNull<T> }

// SAFETY: MyBox é dono exclusivo do seu T, então mover MyBox move o T (exige T: Send),
// e &MyBox só entrega &T (exige T: Sync). Mesmos bounds do Box<T>.
unsafe impl<T: Send> Send for MyBox<T> {}
unsafe impl<T: Sync> Sync for MyBox<T> {}
```

`MyBox<String>` atravessa `thread::spawn`; `MyBox<Rc<i32>>` falha em `Rc<{integer}>`, porque
o bound repassa a checagem. Para sair das traits no stable, adicione um campo `PhantomData<*const ()>`.

A pegadinha: desde a edição 2021, closures capturam campos disjuntos. Com
`unsafe impl Send for Buffer {}` no lugar, isto ainda falha:

```rust
thread::spawn(move || unsafe { *b.ptr = b.len as u8 }).join().unwrap();
```

```text
error[E0277]: `*mut u8` cannot be sent between threads safely
note: required because `b.ptr` is used within this closure
```

A closure capturou `b.ptr` (um `*mut u8`), não `b`. Começar a closure com `let b = b;` move
o `Buffer` inteiro e imprime `v[0] = 16` (é o `let mine = mine;` do experimento com `Rc`).

## Trade-offs

- **`Cell` vs `RefCell`**: `Cell` tem custo zero e não entra em panic, mas só move valores
  para dentro e para fora. `RefCell` entrega referências ao preço de um contador de
  empréstimos (16 bytes para um `i32`) e de um panic que aparece em produção, não no `cargo build`.
- **`Mutex<T>` vs `RwLock<T>`**: `Mutex` exige só `T: Send`, então protege um `Cell` ou
  qualquer valor `!Sync`. `RwLock` exige `T: Send + Sync` e só compensa quando as leituras
  são longas e numerosas.
- **`LazyLock` vs `OnceLock`**: `LazyLock` é o código mais curto para um static, mas um
  panic no inicializador o envenena pelo resto do processo. `OnceLock::get_or_init` tenta
  de novo, o que serve para setup que pode falhar, como ler um arquivo de configuração.
- **`unsafe impl Send/Sync` é uma promessa que o compilador não confere**: o experimento
  com `Rc` compilou e rodou sem crash enquanto corrompia o contador. Escreva o raciocínio no
  `// SAFETY:`, rode os testes no Miri e repasse bounds (`T: Send`) em vez de escrever
  impls incondicionais.
- **Livro vs hoje**: o capítulo 1 de Rust Atomics and Locks (2023) continua valendo para
  `Send`, `Sync` e as células, e o texto online aponta para o `OnceLock` (1.70), mas é anterior
  ao `LazyLock` (1.80): um static preguiçoso feito à mão sobre `OnceLock` agora pode ser um `LazyLock`.

## Documentation Links

- [The Rustonomicon: Send and Sync](https://doc.rust-lang.org/nomicon/send-and-sync.html): doc
- [std::cell module: interior mutability](https://doc.rust-lang.org/std/cell/index.html): doc
- [std::cell::UnsafeCell](https://doc.rust-lang.org/std/cell/struct.UnsafeCell.html): doc
- [std::sync::OnceLock](https://doc.rust-lang.org/std/sync/struct.OnceLock.html): doc
- [std::sync::LazyLock](https://doc.rust-lang.org/std/sync/struct.LazyLock.html): doc
- [The Rust Reference: interior mutability](https://doc.rust-lang.org/reference/interior-mutability.html): doc
- [Announcing Rust 1.80.0 (LazyCell and LazyLock), Rust Blog](https://blog.rust-lang.org/2024/07/25/Rust-1.80.0/): doc
- [Rust Atomics and Locks, chapter 1: Basics of Rust Concurrency (Mara Bos, O'Reilly 2023)](https://marabos.nl/atomics/basics.html): book
