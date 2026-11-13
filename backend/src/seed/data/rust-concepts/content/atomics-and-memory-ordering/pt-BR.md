---
version: 1.0
updatedAt: 2026-11-13
title: "Atômicos e Ordenação de Memória"
summary: O modelo de memória do Rust, herdado do C++20, medido em arm64, com a instrução que cada ordering gera (ldapr para Acquire, ldar para SeqCst, ldadd, casal, dmb), testes litmus de store buffering em que Release/Acquire ainda mostra o resultado proibido dezenas de milhares de vezes a cada 10 milhões de rodadas e SeqCst ou um fence SeqCst mostram zero, message passing em que Relaxed falha raramente e Release/Acquire ou fences nunca falham, atualizações perdidas com load seguido de store, falhas espúrias de compare_exchange_weak só em builds LL/SC, e update/try_update (1.95) com fetch_update depreciado no 1.99, no Rust 1.100.0.
---
## Objective

Uma operação atômica é indivisível; o `Ordering` dela decide o que mais fica visível junto.
Esta lição roda testes litmus em hardware arm64 de verdade e conta quantas vezes cada
resultado "impossível" aparece com `Relaxed`, `Release`/`Acquire`, `SeqCst` e fences, lê a
instrução que cada ordering vira, mede falhas espúrias de `compare_exchange_weak` e
experimenta `update`/`try_update`, estáveis desde o 1.95.

Medido com Rust 1.100.0 (edição 2024, só std), builds de release num Apple M4 Max
(14 núcleos, macOS, arm64, `hw.cachelinesize` 128, `FEAT_LSE` e `FEAT_LRCPC` informados pelo
`sysctl`). As contagens litmus variam entre execuções, então cada linha mostra as 3
execuções; um zero significa zero em todas.

## Use Cases

- Escolher o ordering de uma flag de pronto, um contador de estatística, uma inicialização
  preguiçosa ou a palavra de um lock, e registrar o porquê num comentário.
- Revisar código lock-free: `Relaxed` onde precisava de `Release`/`Acquire`, e `SeqCst`
  espalhado onde não compra nada.
- Portar código com `volatile`/`VarHandle` do Java, `Volatile`/`Interlocked` do C# ou `sync/atomic` do Go.
- Explicar um bug que nunca aparece nos runners x86 do CI e aparece em servidores ARM.
- Migrar laços com `fetch_update` (depreciado no 1.99) para `update` e `try_update`.

## Deep Dive

### Happens-before num parágrafo

A doc de atômicos diz que o Rust segue as regras do C++20, sem `consume`; Batty et al.
formalizaram o modelo do C++ de onde essas regras descendem. Dentro de uma thread, tudo
acontece na ordem do programa. Um store `Release` sincroniza com um load `Acquire` que lê o
seu valor, então tudo antes do store acontece antes de tudo depois do load; `thread::spawn`
e `join` criam a mesma aresta. `Relaxed` não cria aresta, só uma ordem única de modificação
por variável com a qual todas as threads concordam (Rust Atomics and Locks, capítulo 3).
`SeqCst` acrescenta uma ordem global de todas as operações `SeqCst`.

### O que cada ordering vira em arm64

`--emit asm` de funções de uma linha (`mov`, `cmp` e `cset` omitidos):

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

O único lugar em que `Acquire` e `SeqCst` diferem é o load: `ldapr` (o load RCpc do
`FEAT_LRCPC`) contra `ldar`. Pelas regras da Arm, um `ldapr` pode completar antes de um
`stlr` anterior em outro endereço e um `ldar` não pode; o próximo teste transforma isso em contagem.

### Litmus 1: store buffering

Testes litmus são o método do paper Herding Cats (Alglave et al.), que os rodou em chips ARM
e Power. Aqui: duas threads, milhões de rodadas, cada rodada iniciada por uma barreira de
spin, variáveis em linhas de 128 bytes separadas, zeradas depois (`src/bin/litmus.rs`):

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

Sob consistência sequencial um dos stores vem primeiro, então `r1 = 0, r2 = 0` é impossível.
Rodadas em que as duas threads leram 0, de 10 000 000, em cada uma das 3 execuções:

| store / load | instruções | r1=0, r2=0 |
|--------------|------------|------------|
| `Relaxed` / `Relaxed` | `str` / `ldr` | 210 353, 105 993, 63 775 |
| `Release` / `Acquire` | `stlr` / `ldapr` | 33 437, 71 751, 93 232 |
| `SeqCst` / `SeqCst` | `stlr` / `ldar` | 0, 0, 0 |
| `Relaxed`, `fence(SeqCst)`, `Relaxed` | `str`, `dmb ish`, `ldr` | 0, 0, 0 |
| `Release` / `Acquire`, compilado com `-C target-feature=-rcpc` | `stlr` / `ldar` | 0, 0, 0 |

`Release`/`Acquire` não proíbe esse resultado, e nesta máquina ele acontece dezenas de
milhares de vezes. A última linha é a armadilha: o mesmo código compilado sem RCpc ganha
`ldar`, e o hardware esconde o bug. O capítulo 7 do livro (2023) mostra `Acquire` virando
`ldar` em ARM64; o target `aarch64-apple-darwin` de hoje emite `ldapr`, então código que
passava antes pode falhar agora sem mudar uma linha. O livro diz que praticamente todo uso
real de `SeqCst` é esse padrão: um store que precisa ficar visível globalmente antes de um
load posterior na mesma thread (flags no estilo Dekker, "levanto a minha, confiro a sua").

### Litmus 2: message passing

A thread 0 escreve o dado e depois a flag; a thread 1 lê a flag e depois o dado. Ver a flag
sem o dado (`r1 = 1, r2 = 0`) é o bug que toda fila feita à mão ou inicialização única pode ter:

```rust
// thread 0
X.0.store(1, Relaxed); // o "dado"
if f { fence(Release) }
Y.0.store(1, st); // a "flag"
// thread 1
let r1 = Y.0.load(ld);
if f { fence(Acquire) }
let r2 = X.0.load(Relaxed);
```

| store da flag / load da flag | r1=1, r2=0 de 20 000 000 |
|------------------------------|--------------------------|
| `Relaxed` / `Relaxed` | 14, 118, 21 |
| `Release` / `Acquire` | 0, 0, 0 |
| `Relaxed` + `fence(Release)` / `fence(Acquire)` + `Relaxed` | 0, 0, 0 |

Com `Relaxed` aconteceu cerca de uma vez a cada 170 000 a 1 400 000 rodadas: raro o
bastante para passar numa suíte de testes, nada raro em volume de produção. O capítulo 7
do livro observa que o hardware x86-64 só deixa um store escorregar para depois de um load
posterior, então x86 mostra store buffering mas não este caso. Esta lição só mediu arm64.

### Fences

`fence(Release)` antes de um store `Relaxed` e `fence(Acquire)` depois de um load `Relaxed`
deram o mesmo zero que `Release`/`Acquire` na própria flag; a doc de `fence` lista os pares
fence-fence, fence-atômico e atômico-fence que sincronizam. Um fence compensa quando uma
barreira cobre muitas operações, como no exemplo do capítulo 3 do livro com um único
`fence(Acquire)` depois de checar várias flags `Relaxed`, e o `fence(SeqCst)` corrigiu o
store buffering acima com variáveis `Relaxed`. `compiler_fence` só segura o compilador,
para signal handlers na mesma thread.

### Relaxed continua atômico

Oito threads somam 5 000 000 cada num único contador (`src/bin/counter.rs`):

```text
load+store:          7457402 of 40000000
fetch_add(Relaxed)   40000000 of 40000000  1045 ms
fetch_add(SeqCst)    40000000 of 40000000  1089 ms
```

Um `load` seguido de `store` perdeu de 80 a 87% dos incrementos nas 3 execuções;
`fetch_add` é um único `ldadd` indivisível. `Relaxed` e `SeqCst` levaram de 909 a 1106 ms e
de 1089 a 1101 ms: sob contenção o custo é mover a linha de cache entre núcleos, não o ordering.

### compare_exchange vs compare_exchange_weak

A versão `weak` pode falhar mesmo quando o valor bateu. Uma falha cujo valor devolvido é
igual ao esperado é espúria (`src/bin/cas.rs`, 20 000 000 CAS bem-sucedidos):

```rust
match r {
    Ok(_) => { cur += 1; break }
    Err(actual) if actual == cur => spurious += 1,
    Err(actual) => { real += 1; cur = actual }
}
```

| build | threads | espúrias em `compare_exchange` | espúrias em `compare_exchange_weak` |
|-------|---------|--------------------------------|-------------------------------------|
| padrão (LSE, `casal`) | 1 | 0 | 0 |
| padrão (LSE, `casal`) | 4 | 0 | 0 |
| `-C target-feature=-lse` (`ldaxr`/`stlxr`) | 1 | 0 | 2, 1, 2 |
| `-C target-feature=-lse` (`ldaxr`/`stlxr`) | 4 | 0 | 5 249 005, 5 566 277, 5 325 074 |

Com LSE os dois métodos são a mesma instrução `casal` e nunca falham de forma espúria. Com
load-linked/store-conditional, a versão weak retorna assim que o `stlxr` falha: com 4
threads quase toda corrida perdida apareceu uma vez como espúria e uma vez como real. Numa
thread só, 20 000 000 CAS levaram de 19 a 20 ms com LSE e de 73 a 84 ms sem. Use `_weak`
dentro de um laço que já tenta de novo; use a forte quando uma única falha leva a uma decisão.

### update e try_update (1.95)

`update(set_order, fetch_order, f)` grava `f(old)` e devolve `old`; `try_update` recebe uma
closure que devolve `Option` e dá `Ok(old)` ou `Err(current)`. Um limitador de conexões:

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

Oito threads nunca passaram de 4, e a closure rodou de 2.25 a 3.32 vezes por tentativa nas
3 execuções, como a doc avisa ("may call the function multiple times"). Mantenha a closure
pura. `fetch_update` é a mesma operação e agora gera aviso:

```text
warning: use of deprecated method `std::sync::atomic::Atomic::<u32>::fetch_update`: renamed to `try_update` for consistency
```

A mensagem também mostra que `AtomicU32` agora é um alias do genérico `Atomic<u32>`, que
você ainda não pode nomear por conta própria (`generic_atomic`, E0658).

### Orderings que o compilador recusa

O lint `invalid_atomic_ordering` é deny por padrão para orderings literais: "atomic stores
cannot have `Acquire` or `AcqRel` ordering", "atomic loads cannot have `Release` or `AcqRel`
ordering" e "`compare_exchange`'s failure ordering may not be `Release` or `AcqRel`". Um
ordering escondido atrás de uma variável compila e entra em panic em runtime:
`there is no such thing as an acquire store`.

## Trade-offs

- **`SeqCst` em todo lugar não é de graça em arm64, nem sempre basta**: o load vira `ldar`
  em vez de `ldapr`, enquanto um `fetch_add` disputado custa o mesmo nos dois casos. Ele só
  corrige padrões entre variáveis como store buffering; não faz nada por um `load` seguido de
  `store` com corrida. Escolha o ordering mais fraco cuja aresta happens-before você sabe nomear.
- **`Release`/`Acquire` é o padrão para publicar dados**: um par corrigiu o message passing
  (0 de 60 000 000 rodadas) e é nele que `Mutex`, `OnceLock` e channels se apoiam.
- **As contagens litmus são minúsculas**: 14 em 20 000 000 quer dizer que um teste unitário
  não vai achar, e um target mais forte pode esconder de vez (a linha `-rcpc`). Model checking
  com loom explora os orderings em vez de torcer por um entrelaçamento ruim.
- **`compare_exchange_weak`**: idêntico à forma forte em hardware com LSE; em LL/SC ele pula
  o laço interno de nova tentativa, então todo chamador precisa repetir. Um `try_lock` que
  tenta uma vez só deve usar a forma forte.
- **`update`/`try_update` vs um laço de CAS escrito à mão**: mais curto e claro, mas a
  closure roda uma vez por nova tentativa (de 2.25 a 3.32 vezes aqui), então efeitos
  colaterais dentro dela se multiplicam.
- **Livro vs hoje**: Rust Atomics and Locks (2023) está atual no modelo, mas as listagens
  ARM64 dele mostram `ldar` para `Acquire` e laços `ldaxr`/`stlxr` para read-modify-write,
  enquanto o Rust 1.100.0 no Apple silicon emite `ldapr`, `ldaddal` e `casal`. Ele também é
  anterior a `update`/`try_update` (1.95) e à depreciação de `fetch_update` (1.99).

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
