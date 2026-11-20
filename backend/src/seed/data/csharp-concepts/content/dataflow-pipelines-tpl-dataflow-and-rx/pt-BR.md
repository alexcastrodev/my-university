---
version: 1.0
updatedAt: 2026-11-20
title: "Pipelines de Dataflow: TPL Dataflow e Rx"
summary: TPL Dataflow (blocos, LinkTo, BoundedCapacity, EnsureOrdered, falha e cancelamento), Rx.NET (cold e hot, operadores, schedulers, assinatura sem Dispose, sem backpressure), Task.WhenEach, LINQ assíncrono do .NET 10 e uma comparação medida com Channel, Rx e Parallel.ForEachAsync.
---
## Objective

`Channel<T>` e `Parallel.ForEachAsync` cobrem a maior parte do trabalho produtor/consumidor, mas duas bibliotecas mais
antigas ainda aparecem em código real: o TPL Dataflow (blocos ligados em pipeline, buffers limitados, estilo pull) e o
Rx.NET (`IObservable<T>`, estilo push, feito para fluxos de eventos). Este conceito monta um pipeline em Dataflow,
mostra onde o Rx difere (fontes cold e hot, schedulers, a assinatura que nunca é descartada, falta de backpressure),
cobre o `Task.WhenEach` e a mudança do LINQ assíncrono no .NET 10, e termina com um mesmo trabalho rodando em
`Channel<T>`, Dataflow, Rx e `Parallel.ForEachAsync`, medindo vazão e memória. Bases: [Channels](/dotnet-concepts/in-memory-queues-with-channels),
[Parallel.ForEachAsync](/dotnet-concepts/data-parallelism-parallel-and-plinq),
[IAsyncEnumerable](/csharp-concepts/async-streams-iasyncenumerable). Tudo em macOS arm64 (14 núcleos).

Versões: .NET SDK 10.0.100, TFM `net10.0`. `System.Threading.Tasks.Dataflow` 10.0.0.0 vindo do shared framework (sem
pacote, veja abaixo), `System.Reactive` 7.0.0, `System.Linq.Async` 7.0.1 (só para as pontes do Rx).

## Use Cases

- Um pipeline em processo com paralelismo e buffer próprios por estágio (parse, enriquecer, agrupar, gravar).
- Agrupar por quantidade antes de um insert em lote; eventos com operadores de tempo (debounce, buffer, combine latest).
- Consumir os resultados conforme cada tarefa termina, com `Task.WhenEach`.

## Deep Dive

### O Dataflow vem no framework

No `net10.0` ele não é um pacote. Referenciar `System.Threading.Tasks.Dataflow` 10.0.15 gerou o aviso NU1510 ("will
not be pruned ... likely unnecessary") e o assembly carregado em tempo de execução veio de
`Microsoft.NETCore.App/10.0.0`. A documentação diz que ele está incluído no .NET 6 e posteriores; o pacote serve para
.NET Framework e .NET Standard.

### Um pipeline: produtor, transformação paralela, consumidor

```csharp
var buffer = new BufferBlock<int>(new DataflowBlockOptions { BoundedCapacity = 4 });
var transform = new TransformBlock<int, int>(
    async i => { await Task.Delay(i % 5 == 0 ? 40 : 5); return i * i; },  // todo 5o item é lento
    new ExecutionDataflowBlockOptions
        { MaxDegreeOfParallelism = 4, BoundedCapacity = 4, EnsureOrdered = ordered });
var sink = new ActionBlock<int>(async v => { arrivals.Add(v); await Task.Delay(5); },
    new ExecutionDataflowBlockOptions { BoundedCapacity = 4 });
var link = new DataflowLinkOptions { PropagateCompletion = true };
buffer.LinkTo(transform, link); transform.LinkTo(sink, link);
for (int i = 0; i < 40; i++) await buffer.SendAsync(i);
buffer.Complete(); await sink.Completion;
```

```text
EnsureOrdered=True: 371 ms, max concurrent transforms 4, produced-but-not-consumed peak 11, arrivals 0,1,2,3,4,5,...
EnsureOrdered=False: 250 ms, max concurrent transforms 4, produced-but-not-consumed peak 10, arrivals 1,3,2,4,6,8,...
```

Três execuções concordaram em até 5 ms. Por padrão a saída mantém a ordem da entrada, então um item lento segura os
rápidos atrás dele (371 ms contra 250 ms, e o item 0 chegou em décimo). Desligue a ordenação só se a ordem não importar.

### BoundedCapacity é o backpressure

`BoundedCapacity` limita o que um bloco guarda (na fila, em processamento e a saída pronta esperando o próximo bloco).
Com 4 em cada um dos três blocos, o produtor nunca ficou mais de 11 itens à frente. Com o bloco cheio, `Post` e
`SendAsync` diferem:

```text
Post into BoundedCapacity=3 with a slow consumer: accepted 3, rejected 7
SendAsync of 10 items: producer was held for 362 ms (waited for room)
Default (unbounded) block: Post x1000 all accepted, InputCount right after = 1000
```

`Post` devolve `false` e o item se perde se você não conferir; `SendAsync` espera por espaço. O padrão é ilimitado
(a mesma armadilha de um channel ilimitado).

### Conclusão, falhas e cancelamento

`PropagateCompletion = true` repassa conclusão, falha e cancelamento ao próximo bloco; sem ele o bloco seguinte nunca
termina.

```text
a fault chain: AggregateException -> AggregateException -> InvalidOperationException
no PropagateCompletion: t2 RanToCompletion; a2 completed within 500 ms? False
ActionBlock faulted on item 2: handled 2 of 10, status Faulted
try/catch inside delegate: ok 6, failed 4, status RanToCompletion
cancel: t5 Canceled, a5 Canceled, transformed 10 of 100, input left 0
```

Uma exceção que escapa do delegate falha o bloco de vez: os itens na fila (8 de 10) são descartados e só o
`Completion` avisa; depois disso o `Post` devolve `false`. Cada repasse embrulha a exceção em mais um
`AggregateException`, então use `Flatten()` ou `GetBaseException()`. Para continuar depois de um item ruim, capture
dentro do delegate. No cancelamento, passe o token nas opções de todos os blocos; o que está em andamento termina e a
fila é descartada.

### Os outros blocos

```text
after TriggerBatch: [1,2,3,4,5] [6,7,8,9,10] [11,12]   (12 posted, batch size 5)
BroadcastBlock, 20 messages: fast target got 20, slow target (30 ms per item) got 5: 0,5,10,15,19; late target got: c
```

- `BatchBlock<T>(5)` emite arrays de 5; a sobra espera `TriggerBatch()` ou `Complete()` (use um timer se não puder
  esperar).
- `BroadcastBlock<T>` oferece cada mensagem a todos os destinos mas guarda só a última: o destino lento viu 5 de 20 e
  um assinante tardio recebeu só `c`: é um bloco de "valor atual", não uma fila de fan-out.
- `BatchBlock` não guloso, `JoinBlock`, `TransformManyBlock`: só na documentação.

### Rx: push, e cold ou hot decide quem roda o produtor

```text
cold: 2 subscribers, producer ran 2 times
Publish().RefCount(): producer ticks 5; A saw [0,1,2,3,4], late B saw [2,3,4]
hot Subject: early [1,2,3], late [3]
```

Um observable cold (`Observable.Create`, `Interval`, `Range`) inicia o produtor por assinante. Um hot (`Subject<T>`)
existe por conta própria e quem assina tarde perde os valores anteriores. `Publish().RefCount()` compartilha uma fonte
cold; `ReplaySubject(2)` reenvia os dois últimos (o assinante tardio recebeu `[2,3]`).

### Operadores e schedulers do Rx

```text
Throttle(60ms) over a,b,c (15 ms apart), d, e,f: emitted c@90 d@230 f@370
CombineLatest(1,2 | x | 3 | y): 2x 3x 3y
main: thread 1; Range subscriber ran on thread 1 (synchronous); Interval tick on thread 5 (pool)
```

`Throttle` é um debounce: emite o último valor depois de um período de silêncio (`c`, `d`, `f`), não limita taxa.
`CombineLatest` espera os dois lados, então o `1` nunca aparece. `Range` roda síncrono na thread que assina,
`Interval` em uma thread do pool; `ObserveOn` move os callbacks e `SubscribeOn` move a assinatura, por isso um app de
UI coloca `ObserveOn` com o scheduler da UI logo antes de tocar num controle. O `TestScheduler` (`Microsoft.Reactive.Testing`) é só documentação.

### A assinatura que nunca é descartada

`Observable.Interval(10 ms).Subscribe(_ => widget.Ticks++)`, depois as referências à assinatura e ao `widget` são
largadas e o `GC.Collect()` roda três vezes:

```text
subscription dropped without Dispose: after GC the widget is STILL ALIVE (rooted by the timer), ticks 10 then 21
subscription disposed: ticks at 100 ms = 0; after GC the widget is collected
100000 short-lived subscribers, never disposed: retained 59345 KB, 100 x OnNext took 47 ms
100000 short-lived subscribers, disposed: retained 8 KB, 100 x OnNext took 0 ms
```

Quem segura o callback e o que ele captura é o timer do scheduler, não a sua variável. Em um `Subject` de vida longa
(ou um evento embrulhado com `FromEventPattern`) cada assinatura esquecida também continua na lista de observadores.
Descarte no `Dispose`, guarde as assinaturas em um `CompositeDisposable`, ou encerre o fluxo com `TakeUntil(stop)`.

### O Rx não tem backpressure, o IAsyncEnumerable puxa

Um produtor rápido de 200.000 itens, o mesmo consumidor lento, contando os itens produzidos e ainda não consumidos:

```text
Rx Range(200000).ObserveOn(slow consumer): max items waiting = 199455
IAsyncEnumerable pull, same slow consumer: max items waiting = 0
Channel.CreateBounded(100), same slow consumer: max items waiting = 100
```

O `ObserveOn` separa os lados com uma fila ilimitada, então o push nunca desacelera o produtor. O `await foreach` só
produz quando pedem, e um channel limitado bloqueia o produtor no limite escolhido. O Rx serve para fontes que você
não consegue pausar (cliques, sensores); o pull serve para uma fonte sua que pode ultrapassar o consumidor. As pontes
(`ToAsyncEnumerable()`, `ToObservable()`) não estão no `System.Reactive` 7.0.0: não compilaram até o
`System.Linq.Async` 7.0.1 ser referenciado.

### Task.WhenEach (.NET 9)

`await foreach (var t in Task.WhenEach(tasks))` entrega cada tarefa assim que ela termina:

```text
  WhenEach yielded the 50 ms task at 50 ms   (then 100, 200, 300 ms)
  task faulted: bad one (enumeration kept going)
  n= 10000: WhenEach     20 ms      4 MB allocated | WhenAny loop    268 ms    404 MB allocated
  n= 40000: WhenEach     53 ms     20 MB allocated | WhenAny loop   4410 ms   6139 MB allocated
```

As tarefas voltam na ordem de conclusão, e uma tarefa com falha é entregue, não lançada: a exceção aparece
no `await t` e o laço continua. O padrão antigo chama `WhenAny` e remove a concluída a cada volta, o que é quadrático (mesmas somas).

### O .NET 10 traz LINQ assíncrono

O `System.Linq.AsyncEnumerable.dll` está no shared framework do .NET 10: `Where`, `Select` e `ToListAsync` em
`IAsyncEnumerable<T>` não precisam de pacote (uso em [Async Streams](/csharp-concepts/async-streams-iasyncenumerable)).
Um projeto que ainda referencia o pacote antigo, mesmo código (`Where`, `Select`, `ToListAsync`, `SelectAwait`):

```text
System.Linq.Async 6.0.1 and 6.0.3: error CS0121 (ambiguous call) on Where and ToListAsync
System.Linq.Async 7.0.1: builds; SelectAwait warns CS0618 ("Use Select ... additional CancellationToken argument")
```

Atualize para 7.0.0 ou superior (como diz a página de breaking changes do .NET 10) ou remova a referência; os callbacks
do `SelectAwait` viram `Select` com `CancellationToken`.

### Escolhendo, com um trabalho medido

Um trabalho, quatro implementações, cada uma em seu próprio processo, 5 execuções, medianas (faixa entre parênteses).
Os itens são produzidos rápido e carregam uma carga (1 KB na CPU, 4 KB no I/O); a concorrência é 14 (CPU) ou 100
(I/O). A versão Rx precisa de `Observable.FromAsync(() => Task.Run(...))` para o trabalho sair da thread que assina, e
de `Merge(maxConcurrent)` para limitá-lo. Os quatro deram o mesmo checksum.

Trabalho de CPU (200.000 itens, alguns microssegundos de hash cada):

| Abordagem | ms | itens/s | MB alocados | pico de itens em voo |
|---|---|---|---|---|
| `Channel<T>` limitado a 1000, 14 workers | 460 (356 a 498) | 434.783 | 200 | 1.015 |
| Dataflow `ActionBlock`, limitado a 1000 | 377 (365 a 386) | 530.504 | 200 | 1.001 |
| `Parallel.ForEachAsync` sobre `Enumerable.Range` | 558 (452 a 650) | 358.423 | 213 | 14 |
| Rx `Select` + `Merge(14)` | 1063 (1015 a 1201) | 188.147 | 417 | 78.461 |

Trabalho de I/O (20.000 itens, `Task.Delay(10)` cada, ideal cerca de 2000 ms), como ms, MB alocados, pico de itens em
voo, pico de heap em MB: `Channel<T>` 2329, 84, 1.101, 29; Dataflow 2347, 90, 1.001, 24; `Parallel.ForEachAsync` 2398,
87, 100, 7,5; Rx 2400, 110, 19.800, 186.

Quando o trabalho é uma espera, as quatro ficam a cerca de 3% uma da outra: a escolha é memória e formato, não
velocidade. Na CPU, Channel e Dataflow ficaram dentro do ruído, o `ForEachAsync` foi mais lento, e o Rx levou de 2 a 3
vezes mais tempo e alocou o dobro, com dezenas de milhares de itens criados antes de ficarem prontos (pico de heap de
302 MB), porque o `Range` emite tudo de uma vez e nada empurra de volta. O pico de heap é amostrado e inclui lixo.

| Se você precisa de | Escolha |
|---|---|
| Uma fila entre produtores e consumidores, o código mais simples | `Channel<T>` |
| Um laço sobre coleção ou stream com teto de concorrência | `Parallel.ForEachAsync` (menos memória acima) |
| Vários estágios, paralelismo por estágio, lotes, saída ordenada | Dataflow |
| Operadores de tempo sobre eventos que você não consegue pausar | Rx |

### Livro vs hoje

- **Dataflow** vive no `dotnet/runtime` (`src/libraries/System.Threading.Tasks.Dataflow`) e vem no framework. Em
  2026-11-20 a pasta tinha 9 commits desde 2025-11-20 e 21 desde 2024-11-20, quase todos mudanças gerais do repositório
  (analyzers, polyfills, CI); a única correção de comportamento foi uma corrida no `WriteOnceBlock` (#123435, fev. de
  2026). O pacote ganha uma versão por release de manutenção (10.0.9 a 10.0.15 mensais, 11.0.0 em 2026-11-10). Mantido,
  sem crescer. Material da era do .NET 4.5 o apresenta como o jeito de montar pipelines; hoje channels e
  `Parallel.ForEachAsync` cobrem o comum.
- **Rx**: o `dotnet/reactive` não está arquivado, teve commits no dia desta checagem (17 desde 2025-11-20, 47 desde
  2024-11-20) e lançou a 7.0.0 em 2026-07-17 (RC em 2026-06-18; a 6.1.0 foi em 2025-10-03). Não tem alvo `net10.0`
  (usa `net8.0`).
- **Sinais de adoção, não vagas de emprego.** Downloads totais no NuGet (incluem restaurações transitivas):
  `System.Threading.Channels` 1,66 B, Dataflow 898 M, `System.Reactive` 469 M, `System.Linq.Async` 404 M. Busca de código
  no GitHub, arquivos C#: `using System.Reactive.Linq` 62.080; `Channel.CreateBounded` 22.496; `Parallel.ForEachAsync`
  13.872; `ActionBlock<` 3.960; `Task.WhenEach` 415 (o Rx é forte em UI, não separado aqui). Vagas: não medidas.

## Trade-offs

- **O Dataflow é verboso.** Opções em cada bloco e `AggregateException` aninhada dão mais cerimônia que um channel com
  workers; o ganho é capacidade por estágio, ordenação e lotes. A ordenação custou 371 ms contra 250 ms.
- **Limite todo bloco e use `SendAsync`** (7 de 10 chamadas de `Post` foram rejeitadas acima). Um bloco com falha
  descarta a fila, então capture por item dentro do delegate e vigie o `Completion`.
- **O Rx empurra o problema para o consumidor.** Push sem backpressure enfileirou 199.455 itens; use para eventos, não
  para uma fonte finita e rápida que você controla, e descarte toda assinatura (59 MB retidos caso contrário). O
  `Throttle` faz debounce; para limitar taxa use `Sample` ou um token bucket.
- **O Rx é um segundo vocabulário**, e o `System.Linq.Async` abaixo da 7.0 não compila no .NET 10.

## Documentation Links

- [Dataflow (Task Parallel Library), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/dataflow-task-parallel-library) (doc)
- [Walkthrough: Implement a producer-consumer dataflow pattern, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/how-to-implement-a-producer-consumer-dataflow-pattern) (doc)
- [DataflowLinkOptions.PropagateCompletion, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.dataflow.dataflowlinkoptions.propagatecompletion) (doc)
- [Rx.NET repository, GitHub](https://github.com/dotnet/reactive) (doc)
- [Introduction to Rx.NET, introtorx.com](https://introtorx.com/) (doc)
- [Task.WhenEach, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.wheneach) (doc)
- [Breaking change: System.Linq.AsyncEnumerable in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/asyncenumerable) (doc)
- [AsyncEnumerable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.asyncenumerable) (doc)
