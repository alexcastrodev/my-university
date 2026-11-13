---
version: 1.0
updatedAt: 2026-11-12
title: "Por Dentro do Runtime do Tokio"
summary: Os schedulers current_thread e multi_thread, filas locais e global com work stealing medido, o LIFO slot, o orçamento cooperativo de 128 unidades com consume_budget, o driver de I/O sobre kqueue e epoll via mio, o timer de 1 ms, e o travamento medido de uma thread do runtime bloqueada com std::thread::sleep corrigido com spawn_blocking e block_in_place.
---
## Objective

Um `Runtime` do Tokio junta três serviços: um scheduler que faz poll das tasks, um driver
de I/O que transforma eventos de prontidão do sistema operacional em wakeups, e um timer.
Esta lição abre cada um no nível em que a documentação do Tokio os descreve (filas, work
stealing, o LIFO slot, o orçamento cooperativo, o driver e a roda de timers) e depois mede
a falha que mais machuca em produção: uma task que bloqueia a sua worker thread. Você vai
ver o travamento em milissegundos e as três saídas: `spawn_blocking`, `block_in_place` e
não bloquear.

Medido com Rust 1.100.0, tokio 1.54.1 (a versão atual, `features = ["full"]`) e mio 1.2.4
(do `Cargo.lock`), builds de release num Apple M4 Max (14 núcleos, macOS). Todo número
abaixo ficou estável em pelo menos 3 execuções; os que variam estão indicados.

## Use Cases

- Escolher entre `#[tokio::main]` (multi-thread) e `flavor = "current_thread"` para um
  servidor, uma CLI, um teste ou um runtime embutido numa aplicação síncrona.
- Explicar um pico de latência p99 num serviço axum ou tonic: um driver de banco
  síncrono, `std::fs`, um hash de senha ou um parse grande de JSON dentro do handler.
- Dimensionar `worker_threads` e `max_blocking_threads` num container com limite de CPU.
- Escrever um `Future` ou `Stream` à mão que não pode deixar os vizinhos famintos.
- Ler métricas do runtime e saber quais exigem `--cfg tokio_unstable`.

## Deep Dive

### Dois schedulers, e drivers que você precisa ligar

`Runtime::new()` e `#[tokio::main]` constroem o scheduler multi-thread com uma worker
por núcleo (`std::thread::available_parallelism`), ajustável com `TOKIO_WORKER_THREADS`
ou `Builder::worker_threads`:

```text
$ ./workers
#[tokio::main] workers = 14, available_parallelism = 14
$ TOKIO_WORKER_THREADS=3 ./workers
#[tokio::main] workers = 3, available_parallelism = 14
```

O scheduler current-thread roda todas as tasks na thread que chama `block_on` e não cria
workers. Um `Builder` montado à mão não liga nenhum driver, então o primeiro `sleep` ou
socket entra em pânico em tempo de execução, não de compilação:

```rust
let rt = tokio::runtime::Builder::new_current_thread().build().unwrap(); // sem enable_all()
rt.block_on(async { tokio::time::sleep(Duration::from_millis(1)).await });
```

```text
A Tokio 1.x context was found, but timers are disabled. Call `enable_time` on the runtime builder to enable timers.
A Tokio 1.x context was found, but IO is disabled. Call `enable_io` on the runtime builder to enable IO.
```

Escrever `rt.block_on(tokio::time::sleep(..))` sem o bloco `async` dá uma terceira
mensagem, enganosa (`there is no reactor running, must be called from the context of a
Tokio 1.x runtime`): o `Sleep` é criado antes de o `block_on` entrar no runtime.

### Filas das workers e work stealing

Segundo a documentação do runtime ("comportamento no momento da escrita"), cada worker tem
uma fila local de no máximo 256 tasks (o excesso move metade para a fila global). A worker
prefere a fila local, olha a global a cada `global_queue_interval` polls (31 no
current-thread; no multi-thread, uma heurística que mira 10 ms entre verificações) e,
quando as duas estão vazias, rouba metade da fila local de outra worker. Tasks criadas ou
acordadas numa worker vão para essa worker; de qualquer outra thread vão para a global.

Medido: uma task numa worker cria 32 filhas que usam CPU (5 ms de spin cada), então as 32
começam na fila local dessa worker. Os contadores de roubo exigem
`RUSTFLAGS="--cfg tokio_unstable"`:

```rust
let hs: Vec<_> = (0..32).map(|_| tokio::spawn(async {
    spin(Duration::from_millis(5));
    format!("{:?}", std::thread::current().id())
})).collect();
// depois: m.worker_steal_operations(w), m.worker_steal_count(w)
```

```text
tasks per worker thread: {"ThreadId(2)": 8, "ThreadId(3)": 8, "ThreadId(4)": 8, "ThreadId(5)": 8}
worker 0: steal_operations=3 tasks_stolen=5
worker 1: steal_operations=1 tasks_stolen=16
worker 2: steal_operations=2 tasks_stolen=14
worker 3: steal_operations=3 tasks_stolen=8
```

A divisão 8/8/8/8 se repetiu em 13 de 13 execuções; os contadores de roubo mudaram em
todas (uma task pode ser roubada mais de uma vez, então a soma pode passar de 32).

### O LIFO slot

Quando uma task acorda outra numa worker multi-thread, a task acordada vai para o LIFO
slot da worker e roda em seguida (o post de 2019 sobre o scheduler dá o motivo: a mensagem
ainda está no cache da CPU quando o receptor roda). A documentação do runtime lista as
proteções: o slot não pode ser roubado, o orçamento cooperativo não é reiniciado quando
ele é usado, e depois de 3 polls seguidos pelo slot ele fica desligado até uma task
normal rodar. `Builder::disable_lifo_slot` existe, mas é instável. Um ping-pong de
200 000 idas e voltas por dois `mpsc::channel(1)` em 4 workers:

```text
lifo slot on:   25 ms   lifo slot off:   40 ms   (200k round trips)
```

Mesma diferença em 6 de 6 execuções. O custo do slot é que uma task acordada pode ficar
presa atrás de uma worker ocupada (ou bloqueada) em vez de ser roubada, e por isso o
ajuste existe.

### Orçamento cooperativo

O Tokio não consegue preemptar um future. A documentação de `coop` descreve a resposta
opcional: os recursos do próprio Tokio (channels, sockets, timers) são pontos de yield que
gastam um orçamento por task quando estão prontos, e devolvem `Pending` quando ele acaba,
forçando a task a voltar para o scheduler. Num runtime current-thread, a task A espera
10 000 operações sempre prontas; a task B registra até onde A chegou quando B rodou:

```rust
match kind {
    "std::future::ready" => std::future::ready(()).await,
    "mpsc recv (tokio resource)" => { rx.recv().await.unwrap(); }
    "consume_budget" => tokio::task::consume_budget().await,
    "yield_now" => tokio::task::yield_now().await,
}
```

```text
std::future::ready           A had done 10000 iterations when B first ran
mpsc recv (tokio resource)   A had done   128 iterations when B first ran
consume_budget               A had done   128 iterations when B first ran
yield_now                    A had done     0 iterations when B first ran
```

`std::future::ready` (e qualquer future que não é do Tokio, ou um loop puro de CPU) nunca
faz yield, então B esperou as 10 000. O orçamento de 128 não está na documentação pública;
é o `Budget::initial()` no código do tokio 1.54.1, e a medição confirma. `consume_budget`
é o opt-in barato para loops longos: só faz yield quando o orçamento acaba, ao contrário de
`yield_now`, que faz yield toda vez. `task::coop::unconstrained` tira um future do
orçamento por completo.

### O driver de I/O e o timer

A documentação do runtime chama o loop de eventos de I/O de "the driver": ele move os
recursos de I/O e entrega os eventos às tasks que esperam por eles. Por baixo está o
`Poll` do mio, uma API de prontidão que a documentação do mio mapeia para epoll (Linux,
Android), kqueue (macOS, iOS, BSDs) e, com um adaptador para o modelo de conclusão, IOCP
(Windows). As linhas `KQUEUE` de `lsof -p <pid>` num processo ocioso, 3 execuções cada:

```text
Builder without enable_io:  (none)
Builder with enable_io:     3u KQUEUE, 4u KQUEUE, 5u KQUEUE
```

A documentação do runtime diz que o driver é consultado sempre que uma worker não tem nada
para rodar e a cada 61 tasks escalonadas (`event_interval`). O timer trabalha em
milissegundos inteiros (documentação de `sleep`), e o comentário do `Driver` interno de
tempo do tokio descreve uma roda hierárquica de 6 níveis com 64 slots cada (slots de 1 ms
no nível 0, até cerca de 2 anos), a partir das timing wheels de Varghese e Lauck. Medido,
100 sleeps por linha num runtime current-thread:

```text
sleep( 100 us) x100: mean 1625 us
sleep(1000 us) x100: mean 3347 us
sleep(1500 us) x100: mean 3177 us
```

As médias variaram de 1,6 a 1,8 ms e de 2,9 a 3,3 ms em 3 execuções; a única afirmação
estável é que um sleep abaixo de 1 ms nunca volta em menos de 1 ms aqui.

### Bloqueando uma worker: o travamento medido

Duas workers, uma task de heartbeat que dorme 10 ms em loop e registra o pior intervalo, e
dois jobs que chamam uma função síncrona de 300 ms (no papel de um driver de banco síncrono):

```rust
let jobs: Vec<_> = (0..2).map(|_| tokio::spawn(async move {
    let work = || std::thread::sleep(Duration::from_millis(300));
    match mode {
        "std::thread::sleep in task" => work(),
        "spawn_blocking" => tokio::task::spawn_blocking(work).await.unwrap(),
        "block_in_place" => tokio::task::block_in_place(work),
    }
})).collect();
```

```text
std::thread::sleep in task   2 jobs: 303 ms  worst heartbeat gap: 303 ms
spawn_blocking               2 jobs: 310 ms  worst heartbeat gap:  13 ms
block_in_place               2 jobs: 310 ms  worst heartbeat gap:  13 ms
```

Cinco execuções: bloqueado de 301 a 310 ms, as duas correções de 13 a 14 ms (13 ms é a base
de um sleep de 10 ms). Os jobs levam o mesmo tempo nos três casos; o que muda é se todas as
outras tasks dessas workers, incluindo o driver, congelam junto. Num runtime current-thread
basta um job bloqueante (`worst heartbeat gap: 302 ms`), `spawn_blocking` continua
resolvendo (13 ms, o pool é separado) e `block_in_place` entra em pânico dentro da task:

```text
can call blocking only when running on the multi-threaded runtime
```

### spawn, spawn_blocking, block_in_place

- `tokio::spawn`: um future no pool de workers; ele precisa chegar a um `.await` com
  frequência.
- `spawn_blocking`: uma closure num pool separado, criado sob demanda até
  `max_blocking_threads` (padrão 512), threads ociosas saem depois de 10 s; acima do limite
  as chamadas entram numa fila. `tokio::fs`, a resolução DNS de `ToSocketAddrs` e stdio já
  passam por ele. Depois de começar, não pode ser abortado, e o shutdown do runtime espera.
- `block_in_place`: transforma a worker atual numa thread de bloqueio e passa as tasks
  dela para uma nova worker, economizando uma troca de contexto. Só multi-thread, e
  qualquer outra coisa na mesma task (um irmão de `join!`) congela junto.

## Trade-offs

- **Multi-thread por padrão**: work stealing dá vazão e uma segunda worker que continua
  rodando quando uma task demora, ao custo de futures `Send + 'static` e wakeups entre
  threads. Current-thread serve para testes, CLIs e runtime embutido em código síncrono,
  mas uma chamada bloqueante para tudo (302 ms medidos acima).
- **`spawn_blocking` para trabalho de CPU**: correto para chamadas limitadas, mas 512
  threads calculando hash vão disputar os núcleos. Limite com um `Semaphore` ou mande lotes
  pesados de CPU para o rayon; loops de vida longa merecem uma `std::thread` dedicada.
- **`block_in_place` é mais barato, porém mais afiado**: não copia nada para uma closure
  nem troca de thread, mas entra em pânico no current-thread e congela os irmãos de
  `join!`/`select!` na mesma task.
- **Coop não é preempção**: só recursos do Tokio e `consume_budget` gastam orçamento. Um
  loop sobre iteradores da `std` ou futures de terceiros deixou o vizinho esperando as
  10 000 iterações acima. Coloque `consume_budget().await` ou tire o trabalho do runtime.
- **Ajustes instáveis**: contadores de roubo, de polls e `disable_lifo_slot` exigem
  `--cfg tokio_unstable` e não têm promessa de SemVer. Métricas estáveis como
  `num_workers`, `num_alive_tasks` e `global_queue_depth` cobrem o básico.
- **Granularidade do timer**: 1 ms é o piso. Para cadência abaixo de 1 ms, Tokio é a
  ferramenta errada; agrupe o trabalho ou faça spin numa thread dedicada.
- **Detalhes do scheduler mudam**: a documentação marca o tamanho das filas, os
  intervalos 31/61 e as regras do LIFO como "comportamento no momento da escrita". Ajuste
  com métricas, não com constantes copiadas desta página. A documentação também avisa que
  o runtime não conhece NUMA: a sugestão dela é vários runtimes, um por nó.

## Documentation Links

- [Módulo runtime do Tokio: comportamento detalhado do runtime](https://docs.rs/tokio/latest/tokio/runtime/index.html): doc
- [tokio::runtime::Builder](https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html): doc
- [tokio::task::coop: escalonamento cooperativo](https://docs.rs/tokio/latest/tokio/task/coop/index.html): doc
- [tokio::task::spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html): doc
- [tokio::task::block_in_place](https://docs.rs/tokio/latest/tokio/task/fn.block_in_place.html): doc
- [tokio::runtime::RuntimeMetrics](https://docs.rs/tokio/latest/tokio/runtime/struct.RuntimeMetrics.html): doc
- [mio::Poll: o seletor do sistema por plataforma](https://docs.rs/mio/latest/mio/struct.Poll.html): doc
- [Tutorial do Tokio](https://tokio.rs/tokio/tutorial): doc
- [Tópicos do Tokio: ponte com código síncrono](https://tokio.rs/tokio/topics/bridging): doc
- [Making the Tokio scheduler 10x faster, blog do Tokio (complemento)](https://tokio.rs/blog/2019-10-scheduler): doc
- [Varghese e Lauck, Hashed and hierarchical timing wheels, IEEE/ACM ToN 1997](https://doi.org/10.1109/90.650142): paper
