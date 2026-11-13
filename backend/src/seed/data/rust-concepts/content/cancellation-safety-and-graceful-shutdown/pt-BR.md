---
version: 1.0
updatedAt: 2026-11-12
title: "Cancel Safety e Shutdown Gracioso"
summary: Drop como cancelamento, o que o tokio::select! faz com os ramos perdedores, JoinHandle que desanexa e abort, as listas de cancel safety da documentação do Tokio, a perda de dados medida com read_exact num loop de select! e a correção com read_buf, JoinSet, CancellationToken com child tokens, e shutdown gracioso com sinal, cancelamento em broadcast, TaskTracker e prazo, incluindo o SIGTERM que o ctrl_c não captura.
---
## Objective

Um future não tem método de cancelar: você cancela soltando (drop) o future, e ele para
no `.await` em que estava estacionado. Isso deixa timeouts e `select!` baratos, e deixa
uma classe de bugs silenciosa: o ramo que perde a corrida de um `select!` é descartado
com o trabalho pela metade. Esta lição mede o que o drop faz, perde dados de verdade com
um método que a documentação do Tokio lista como não cancel safe, corrige, e monta o
shutdown do tópico "Graceful Shutdown": detectar o sinal, propagar, esperar com prazo.

Medido com Rust 1.100.0, tokio 1.54.1 e tokio-util 0.7.20 (`features = ["rt"]`), do
`Cargo.lock`, builds de release num Apple M4 Max com macOS; sinais enviados com `kill`.
Cada programa rodou pelo menos 3 vezes com o mesmo resultado, fora os timestamps.

## Use Cases

- Um loop de conexão que faz `select!` entre frames, um timer de heartbeat e shutdown.
- Timeouts de requisição com `tokio::time::timeout`, que cancela o future interno por drop.
- Um fan-out de N tasks em que o primeiro erro precisa cancelar as outras.
- Um serviço no Kubernetes que precisa drenar o trabalho entre SIGTERM e SIGKILL.

## Deep Dive

### Soltar um future é cancelar

```rust
struct Guard(&'static str);
impl Drop for Guard { fn drop(&mut self) { println!("  drop: {}", self.0); } }
async fn step(name: &'static str, ms: u64) -> &'static str {
    let _g = Guard(name);
    println!("  {name}: started");
    sleep(Duration::from_millis(ms)).await;   // o único ponto onde pode ser cancelado
    println!("  {name}: finished");
    name
}
// 1. select! { w = step("fast", 10) => w, w = step("slow", 1_000) => w }
// 2. drop(spawn(step("detached", 50)))  3. h.abort() após 10 ms  4. retorno do main
```

```text
1. select!: the losing branch is dropped at its .await
  fast: started
  slow: started
  fast: finished
  drop: fast
  drop: slow
  winner = fast
2. dropping a JoinHandle detaches, it does not cancel
  detached: started
  detached: finished
  drop: detached
3. abort() cancels at the next .await
  aborted: started
  drop: aborted
  join result: is_cancelled = true
4. a spawned task still pending when main returns
  orphan: started
  main returns
  drop: orphan
```

`slow: finished` nunca aparece: os destrutores rodaram, o código depois do `.await` não.
As duas linhas `started` trocam de lugar entre execuções, porque o `select!` sorteia o
primeiro ramo a receber poll, a não ser que você escreva `biased;`. Uma task criada com
spawn é diferente: soltar o `JoinHandle` desanexa a task (caso 2), e só `abort()` ou o
shutdown do runtime a cancelam, como diz a documentação de `tokio::task`.

### Cancel safety, como a documentação do `select!` define

Pela documentação do `select!`: "If you have a future that has not yet completed, then
it must be a no-op to drop that future and recreate it." As listas dela (incompletas):

- Cancel safe: `recv` de `mpsc`/`broadcast`, `watch::Receiver::changed`, `TcpListener::accept`,
  `read`, `read_buf`, `write`, `write_buf`, e `StreamExt::next` em qualquer `Stream`.
- Não cancel safe, dados podem se perder: `read_exact`, `read_to_end`, `read_to_string`, `write_all`.
- Não cancel safe porque cancelar faz perder o lugar numa fila justa: `Mutex::lock`,
  `RwLock::read`/`write`, `Semaphore::acquire`, `Notify::notified`.

Ela completa: cancelar algo inseguro nem sempre é errado; durante o shutdown, um frame
pela metade normalmente não importa.

### Perdendo dados com `read_exact` num loop de `select!`

Um writer envia 20 frames de 8 bytes iguais, cada um em duas metades separadas por 15 ms.
O leitor também conta um timer de 10 ms no mesmo `select!` (heartbeat ou checagem de prazo):

```rust
let mut buf = [0u8; 8];
loop {
    tokio::select! {
        r = rx.read_exact(&mut buf) => match r {
            Ok(_) => frames.push(buf),
            Err(_) => break, // EOF
        },
        _ = tick.tick() => ticks += 1,
    }
}
```

A correção guarda os bytes parciais fora do future, num buffer que sobrevive a todas as
iterações, e lê com `read_buf`, que é cancel safe:

```rust
let mut pending: Vec<u8> = Vec::with_capacity(64);
loop {
    tokio::select! {
        r = rx.read_buf(&mut pending) => {
            if r.unwrap() == 0 { break; }
            while pending.len() >= 8 {
                frames.push(pending[..8].try_into().unwrap());
                pending.drain(..8);
            }
        }
        _ = tick.tick() => ticks += 1,
    }
}
```

```text
read_exact frames=19 intact= 0 torn=19 ticks=34
           first torn frame: [1, 1, 1, 1, 2, 2, 2, 2]
read_buf   frames=20 intact=20 torn= 0 ticks=33
```

Contagem de frames idêntica em 5 de 5 execuções (ticks 33 ou 34). O tick ganhou com
metade do frame 1 já em `buf`; o `read_exact` descartado levou o progresso junto, e a
chamada seguinte encheu `buf` de novo a partir do offset 0. Quatro bytes sumiram, todo
frame seguinte ficou dividido entre dois, os 4 bytes finais foram jogados fora no EOF, e
nenhum erro apareceu. Pela lista acima, `StreamExt::next` sobre um
`tokio_util::codec::FramedRead` é a mesma correção com um codec de verdade.

### JoinSet: ser dono de um grupo de tasks

```rust
let mut set = JoinSet::new();
for ms in [300u64, 100, 200, 5_000] {
    set.spawn(async move { let _g = Guard(ms); sleep(Duration::from_millis(ms)).await; ms });
}
for _ in 0..3 { println!("  join_next -> {:?}", set.join_next().await.unwrap().unwrap()); }
println!("  len before drop = {}", set.len());
drop(set);
```

```text
  task 100 dropped
  join_next -> 100
  task 200 dropped
  join_next -> 200
  task 300 dropped
  join_next -> 300
  len before drop = 1
  task 5000 dropped
```

Os resultados chegam na ordem em que terminam, e soltar o set abortou a task de 5 s, como
diz a documentação ("When the `JoinSet` is dropped, all tasks in the `JoinSet` are
immediately aborted"). `join_next` é documentado como cancel safe, então pode ficar num
ramo de `select!`.

### CancellationToken: avisar "por favor, pare" para todos

```rust
let parent = CancellationToken::new();
let child = parent.child_token();
child.cancel();
let child2 = parent.child_token();
parent.cancel();
let r = parent.run_until_cancelled(sleep(Duration::from_secs(1))).await;
```

```text
  child.cancel():  parent=false child=true
  parent.cancel(): parent=true child2=true
  run_until_cancelled on a cancelled token -> None
```

Clones compartilham o mesmo estado; um `child_token` é cancelado junto com o pai, mas
cancelá-lo não afeta o pai, então dá para fechar uma conexão sem parar o servidor.
`cancelled()` é cancel safe segundo a documentação do tokio-util. Ao contrário de
`abort()`, o token só pede: a task decide onde parar e pode fazer a limpeza antes.

### Shutdown gracioso com prazo

Três workers fazem loop com `select!` entre `token.cancelled()` (um child token) e uma
unidade de trabalho de 50 ms, e depois fazem flush por 200 ms; uma quarta task ignora o
token. Depois do sinal, o main cancela, fecha o `TaskTracker` e espera no máximo 1 s:

```rust
async fn shutdown_signal() -> &'static str {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate()).expect("cannot listen for SIGTERM");
    tokio::select! {
        r = tokio::signal::ctrl_c() => { r.expect("cannot listen for SIGINT"); "SIGINT" }
        _ = term.recv() => "SIGTERM",
    }
}
let sig = shutdown_signal().await;
log(format!("{sig} received, cancelling"));
token.cancel();
tracker.close();
match timeout(Duration::from_secs(1), tracker.wait()).await {
    Ok(()) => log("all tasks finished".into()),
    Err(_) => log(format!("deadline hit, {} task(s) still running, exiting", tracker.len())),
}
```

```text
$ kill -TERM <pid>      # exit status 0
  136 ms  SIGTERM received, cancelling
  136 ms  worker 2: cancelled after 2 jobs, flushing
  136 ms  worker 1: cancelled after 2 jobs, flushing
  136 ms  worker 0: cancelled after 2 jobs, flushing
  338 ms  worker 0: flushed
  338 ms  worker 2: flushed
  338 ms  worker 1: flushed
 1138 ms  deadline hit, 1 task(s) still running, exiting
 1138 ms  stubborn task dropped
```

A task teimosa foi descartada quando o `main` retornou e o runtime desligou. Uma primeira
versão ouvia só `ctrl_c()`, como a página do Tokio: `kill -INT` funcionou, mas `kill -TERM`
encerrou o processo com exit status 143, sem log e sem flush (3 de 3 execuções). O
Kubernetes envia SIGTERM (ou o `STOPSIGNAL` da imagem) e KILL ao fim do grace period (30 s
por padrão), então um servidor que só trata SIGINT nunca drena dentro de um pod.

## Trade-offs

- **Token vs `abort()`**: `abort()` não precisa de cooperação, mas a task para em qualquer
  `.await` sem chance de flush. Um token custa um ramo de `select!` por loop e dá um ponto
  de saída limpo; deixe `abort()` (ou soltar um `JoinSet`) para o que sobrar.
- **Loop cancel safe vs task dedicada**: guardar o estado fora do future (o buffer
  `pending`) é a correção barata. Quando um passo é inseguro por natureza (`write_all`,
  `Mutex::lock`), mova-o para uma task própria e faça `select!` num channel.
- **`biased;`**: tira o sorteio e o custo do gerador aleatório, mas um ramo sempre pronto
  pode deixar os outros famintos. A documentação aconselha pôr o ramo de shutdown primeiro.
- **TaskTracker vs JoinSet**: `JoinSet` guarda todo resultado até você chamar `join_next`
  e aborta no drop. `TaskTracker` libera as tasks quando terminam, pode ser clonado e só
  espera depois de `close()`; soltá-lo não aborta nada, então use junto com um prazo.
- **Tamanho do prazo**: deixe o prazo de drenagem abaixo do grace period do orquestrador,
  com folga para o processo sair, ou o SIGKILL decide por você.
- **Trabalho bloqueante escapa do cancelamento**: closures de `spawn_blocking` e
  `block_in_place` não podem ser abortadas, e o shutdown do runtime espera por elas.
  `Runtime::shutdown_timeout` para de esperar, mas as threads continuam rodando.

## Documentation Links

- [tokio::select!: cancel safety](https://docs.rs/tokio/latest/tokio/macro.select.html): doc
- [Tópicos do Tokio: Graceful Shutdown](https://tokio.rs/tokio/topics/shutdown): doc
- [Módulo tokio::task: cancelamento](https://docs.rs/tokio/latest/tokio/task/index.html): doc
- [tokio::task::JoinSet](https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html): doc
- [tokio_util::sync::CancellationToken](https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html): doc
- [tokio_util::task::TaskTracker](https://docs.rs/tokio-util/latest/tokio_util/task/struct.TaskTracker.html): doc
- [tokio::signal::ctrl_c](https://docs.rs/tokio/latest/tokio/signal/fn.ctrl_c.html): doc
- [Kubernetes: Pod Lifecycle, término de Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): doc
