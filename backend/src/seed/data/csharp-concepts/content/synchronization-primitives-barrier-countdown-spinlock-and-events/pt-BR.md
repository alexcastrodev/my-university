---
version: 1.0
updatedAt: 2026-11-20
title: "Primitivas de Sincronização: Barrier, CountdownEvent, SpinLock e Eventos"
summary: Barrier e a ação pós-fase, CountdownEvent como fork/join sem Task, ManualResetEventSlim e AutoResetEvent com spin, SpinLock como struct, ReaderWriterLockSlim e quando um lock simples ou um snapshot imutável ganha, e System.Threading.Lock, tudo medido, com a ponte para semáforos e spin locks de sistemas operacionais.
---
## Objective

`lock`, `Interlocked` e `SemaphoreSlim` cobrem a maior parte da coordenação entre threads, e os conceitos vizinhos ensinam essas três. O resto de `System.Threading` é uma prateleira de ferramentas especializadas: `Barrier` para algoritmos em fases, `CountdownEvent` para fork/join sem `Task`, `ManualResetEventSlim` e `AutoResetEvent` para sinalização, `SpinLock` para seções críticas minúsculas, `ReaderWriterLockSlim` para estado de leitura frequente e `System.Threading.Lock`. Cada uma pode ser mal usada de um jeito que o compilador aceita, e algumas carregam uma fama (spin lock "é mais rápido", reader-writer lock "escala") que este conceito confere medindo. Termina ligando tudo aos semáforos e spin locks dos artigos de sistemas operacionais.

Versões: .NET SDK 10.0.100, TFM `net10.0`, nenhum pacote NuGet (só o shared framework), macOS arm64 (Apple M4 Max, 14 núcleos). Uma máquina só, compartilhada com outros processos: as razões são o resultado, os números absolutos variaram até 2x entre execuções.

## Use Cases

- Uma simulação ou stencil em que todo worker precisa terminar o passo N antes de qualquer um começar o N+1 (`Barrier`).
- Espalhar um número conhecido de itens de trabalho e bloquear até todos terminarem, sem `Task` (`CountdownEvent`).
- Uma passagem de bastão entre duas threads dedicadas (`ManualResetEventSlim`).
- Um lock por nó numa estrutura enorme, segurado por nanossegundos (`SpinLock`).
- Um cache ou uma configuração lida por muitas threads e alterada raramente (`ReaderWriterLockSlim`, ou um snapshot).

## Deep Dive

### Barrier: fases, participantes e falha

Um `Barrier` faz N participantes esperarem uns pelos outros no fim de cada fase. `SignalAndWait()` bloqueia até todos chegarem, a ação pós-fase opcional roda uma vez, então todos são liberados e `CurrentPhaseNumber` avança. Quatro workers suavizaram 4000 células por 50 varreduras, com buffer duplo, trocando os buffers na ação:

```csharp
using var barrier = new Barrier(4, b => (cur, next) = (next, cur)); // uma vez por fase
// cada worker, por varredura: Step(cur, next, lo, hi); barrier.SignalAndWait();
```

```text
phases=50 actionRuns=50 distinctActionThreads=4
returns that saw the action finished: 200 of 200
parallel == sequential: True
```

A ação rodou 50 vezes, sempre antes de qualquer participante retornar, na thread de quem chegou por último. É o lugar seguro para trocar buffers ou reduzir resultados parciais, e uma ação lenta atrasa todo mundo (chamar `SignalAndWait` dentro dela lança `InvalidOperationException`). A contagem de participantes é uma promessa: 3 registrados e 2 chegando é um travamento. Com `SignalAndWait(500)` os dois retornaram `false` e a barreira continuou íntegra (`ParticipantsRemaining=3`, fase 0), então o timeout é como você detecta o worker que sumiu. Um worker que sai de vez chama `RemoveParticipant` (os outros dois então retornaram `True` e a fase foi para 1); `AddParticipant` devolve a fase em que o novo entra; o limite é 32.767 participantes (só docs). Uma exceção na ação chega a todos os participantes, e a barreira continua funcionando:

```text
phase 0, action throws: BarrierPostPhaseException(inner=InvalidOperationException: boom in action) | (same)
after the exception: phase=1; phase 1 on the same barrier: ok | ok
```

`SignalAndWait` bloqueia uma thread: 18 participantes como jobs de `Task.Run` (14 núcleos, mínimo do pool 14) levaram 2390 ms porque o pool injetou as 4 últimas threads devagar (conceito de starvation); como tasks `LongRunning` levaram de 1 a 2 ms.

### CountdownEvent: fork/join sem Task

Um `CountdownEvent` começa com uma contagem, `Signal()` a decrementa e `Wait()` retorna em zero. Comece em 1 para a thread que faz o fork, para a contagem não chegar a zero enquanto você ainda está espalhando o trabalho:

```csharp
using var cd = new CountdownEvent(1);
for (int i = 0; i < 100; i++)
{
    cd.AddCount();                       // antes de enfileirar, nunca depois
    ThreadPool.QueueUserWorkItem(_ => { Work(); cd.Signal(); });
}
cd.Signal();                             // a contagem de quem fez o fork
cd.Wait();
```

Em zero o evento fica sinalizado para sempre, e os erros são estritos:

```text
Signal() that reaches zero returns True; IsSet=True
AddCount after zero: InvalidOperationException: The event is already signaled and cannot be incremented.
TryAddCount after zero: False
Signal past zero: InvalidOperationException: Invalid attempt made to decrement the event's count below zero.
```

`Signal` retorna `true` só na chamada que chegou a zero, `TryAddCount` é o incremento que não lança, `Reset` reaproveita o evento e `Wait` aceita timeout ou `CancellationToken`. Uma varredura recursiva de uma árvore de 8191 nós (`AddCount` para cada filho antes de o pai sinalizar) visitou os 8191. `Signal` custou 2,9 ns contra 1,8 ns do `Interlocked.Decrement`, e 1000 jobs minúsculos levaram 0,47 ms com `CountdownEvent` e 0,41 ms com `Task.Run` mais `WhenAll`. O ganho sobre as tasks não é velocidade: não há `Task` para aguardar, e threads comuns podem usá-lo. Em código `async` use `Task.WhenAll`, já que `Wait()` bloqueia.

### Eventos: ManualResetEventSlim e AutoResetEvent

Um evento é uma bandeira em que as threads esperam, e os tipos diferem no que uma espera consome:

```text
AutoResetEvent Set twice: WaitOne(0) -> True, then False
SemaphoreSlim Release twice: True, True, False
ManualResetEventSlim Set twice: True, True, True IsSet=True
```

Um evento de reset manual fica sinalizado até o `Reset()` e libera todos os que esperam. Um `AutoResetEvent` libera um e se reseta, então dois `Set` antes da espera viram um só (sinal perdido), ao contrário de um semáforo, que conta. Não existe `AutoResetEventSlim` (conferido por reflexão). `ManualResetEvent` e `AutoResetEvent` embrulham um handle do kernel; o slim gira (spin) por um instante e só então bloqueia. Passagens de bastão entre duas threads, 200.000 idas e voltas, mediana de 5:

```text
ManualResetEventSlim: default spin 0.20 us, SpinCount 0 5.83 us, SpinCount 2047 0.16 us
ManualResetEvent (kernel) 5.71 us, AutoResetEvent (kernel) 5.78 us, SemaphoreSlim 0.35 us
```

O spin ganhou por cerca de 30 vezes quando a resposta vem em microssegundos. O `SpinCount` padrão foi 35 aqui e a faixa é de 0 a 2047 (2048 lança exceção). O preço aparece quando o sinal demora. Esperando um sinal depois de `Thread.Sleep(1)`, 300 rodadas, o tempo de parede foi de 380 a 387 ms em todos, e o tempo de CPU do processo foi:

```text
default spin 29 ms, SpinCount 0 13 ms, SpinCount 2047 248 ms, kernel ManualResetEvent 11 ms
```

O spin longo gastou 8 vezes a CPU do padrão e 20 vezes a da espera no kernel. Mantenha o padrão para esperas curtas, e use `SpinCount` 0 quando as esperas forem longas ou houver mais threads esperando do que núcleos.

### SpinLock: uma struct com pontas afiadas

`SpinLock` é uma `struct` que espera em laço ocupado. Copiá-la copia o lock, e o compilador não avisa: um campo `readonly` faz cada `Enter` travar uma cópia temporária.

```csharp
readonly SpinLock _s = new(false);   // errado: cada chamada trava uma cópia
SpinLock _s = new(false);            // certo: campo mutável, nunca copiado
bool taken = false;
try { _s.Enter(ref taken); n++; } finally { if (taken) _s.Exit(); }
```

```text
readonly SpinLock field: expected 8000000, got 1826699
non-readonly SpinLock field: expected 8000000, got 8000000
copy.IsHeld=True original.IsHeld=False
```

Passe-a por `ref` e nunca a guarde em campo `readonly` (a documentação diz o mesmo). O `lockTaken` é obrigatório, e um que já esteja `true` lança `ArgumentException`. O `enableThreadOwnerTracking` (ligado em `new SpinLock()`) registra o dono:

```text
tracked, recursive Enter: LockRecursionException
tracked, Exit from another thread: SynchronizationLockException; still held: True
untracked, recursive TryEnter(100ms): False
untracked, IsHeldByCurrentThread: InvalidOperationException
untracked, Exit from another thread: no exception; still held: False
```

Sem rastreamento, uma thread que reentra no próprio lock só estoura o tempo (com `Enter` giraria para sempre, não executado) e um `Exit` perdido libera o lock de outra thread. O rastreamento é caro (`SpinLock(true)` 16,4 Mops/s contra 121,7 numa thread), então é ferramenta de depuração.

É mais rápido? Threads incrementando um contador dentro do lock por 250 ms, mais trabalho fixo dentro (sozinho: 0, 22 e 451 ns). Milhões de operações por segundo, mediana de 5, com 1, 8 e 28 threads (14 núcleos):

```text
                     counter++ only        + 22 ns work         + 451 ns work
threads              1      8     28       1      8     28      1     8    28
lock(object)     248.6  143.8  140.6    39.8   25.3   25.4    2.2   1.6   1.6
lock(Lock)       250.0  119.8  113.6    41.4   25.4   26.3    2.2   1.6   1.6
SpinLock(false)  121.7  117.5  110.0    44.8   44.3   43.5    2.2   2.2   2.2
Interlocked      542.2   31.7   16.3
```

Com a seção quase vazia, o `lock` venceu o `SpinLock` (248,6 contra 121,7 numa thread). O `SpinLock` só ganhou com trabalho dentro: 1,75 vez com 22 ns, 1,4 vez com 451 ns, estável até com 28 threads em 14 núcleos. A vazão total nunca passou a de uma thread, porque um lock serializa. A medida de justiça (8 threads, 500 ms, milhares de operações por thread, ordenado, 22 ns de trabalho) mostra como a vantagem é construída:

```text
lock(Lock)       1103 1185 1473 1593 1633 1740 2132 2160
SpinLock(false)     0    0    0  105 1144 1833 6598 11548
```

Uma thread monopoliza o `SpinLock` e três não fizeram nenhum trabalho. O `lock` foi mais justo aqui, mas com 451 ns cinco das suas threads fizeram 1 mil operações cada contra 429 mil da melhor. Nenhum dos dois promete justiça. A documentação limita o `SpinLock` a retenções extremamente curtas e manda não bloquear, não chamar código virtual, não alocar e não segurar dois dentro dele.

### ReaderWriterLockSlim: modos e regras

Leitura é compartilhada, escrita é exclusiva, e a leitura atualizável (upgradeable) é compartilhada com leitores mas pertence a uma thread só, e pode virar escrita. Quatro threads segurando 50 ms cada: `lock` 206 ms, leitura 52 ms, escrita 207 ms, upgradeable 205 ms, e um upgradeable mais três leitores 53 ms. As regras de recursão, medidas:

```text
NoRecursion: read then read, read then upgradeable, write then read: LockRecursionException
NoRecursion: read then write: LockRecursionException: ... prone to deadlocks ... use an upgrade lock
NoRecursion: upgradeable then write: ok
SupportsRecursion: read then read: ok; write then read: ok; read then write: LockRecursionException
```

Não existe deadlock silencioso de upgrade entre dois leitores: ler e depois escrever é recusado nas duas políticas. A saída é `EnterUpgradeableReadLock`, checar, depois `EnterWriteLock`. Um segundo upgradeable espera (`TryEnter...(100)` deu `false`) enquanto um leitor entra. O deadlock que sobra é o comum: uma thread em modo upgradeable segurava outro lock e chamou `TryEnterWriteLock(500)` enquanto um leitor esperava por esse lock, e voltou `false` depois de 503 ms, então use timeouts ao misturar locks. Escritores têm prioridade, uma política de justiça que a documentação descreve: o leitor 1 segurou o lock até 302 ms, um escritor entrou na fila aos 52 ms e o leitor 2 chegou aos 102 ms, e a ordem foi leitor 1 sai (302), escritor entra (302), escritor sai (406), leitor 2 entra (408). O padrão é `NoRecursion`, que a documentação recomenda. Faça o dispose do lock junto com o dono.

### ReaderWriterLockSlim: quando compensa, e as alternativas

Um dicionário de 1000 chaves em cinco implementações: `lock(Lock)`, `ReaderWriterLockSlim`, um `Dictionary` copy-on-write (uma cópia por escrita, leitura por referência volatile), um `ImmutableDictionary` trocado por compare-and-swap e um `ConcurrentDictionary`. 8 threads, Mops/s, mediana de 5, com trabalho feito dentro de cada leitura:

```text
reads%  work     lock    RWLS     COW   Immutable  Concurrent
100%    0 ns     4.88   45.61  1852.55     221.20     1869.44
 99%    0 ns     6.40   43.59    45.97     126.32      351.89
 90%    0 ns    10.48   19.84     4.85      23.86      132.20
 50%    0 ns    17.13   10.45     1.02       5.02       42.29
 90%  154 ns     4.44    2.22     4.18      22.34       50.58
 99%  1.8 us     0.42    1.71     3.87       3.94        4.03
```

O reader-writer lock só ganhou do `lock` quando uma leitura segurava por cerca de 1,8 us (4 vezes com 99% de leituras), e perdeu com 90% de leituras de 154 ns e com 50% de leituras sem trabalho. Pegar o lock de leitura escreve em estado compartilhado, então as leituras não escalam: 94 Mops/s com 2 threads caíram para 45 com 8. Os stores copy-on-write leem sem escrever e escalam (de 572 para 1852 Mops/s indo de 2 para 8 threads), mas uma escrita copia: o `Dictionary` simples caiu para 4,85 com 90% de leituras, enquanto o `ImmutableDictionary` (cópia só do caminho) manteve 23,86 e passou o reader-writer lock. Para uma configuração trocada poucas vezes por hora, troque uma referência imutável; para atualizações por chave use `ConcurrentDictionary`; deixe o `ReaderWriterLockSlim` para leituras de microssegundos em dados grandes demais para copiar. As células de `lock` sob contenção são ruidosas (8 threads, 100% de leituras: 43,3 numa execução completa, 4,88 na seguinte), então confie só nas razões grandes.

### System.Threading.Lock

A instrução `lock` só usa o tipo novo quando o tipo em tempo de compilação do alvo é `Lock`. A prova, por `IsHeldByCurrentThread`:

```text
lock(Lock): gate.IsHeldByCurrentThread=True
lock((object)gate): gate.IsHeldByCurrentThread=False, Monitor.IsEntered=True
```

Um cast troca em silêncio para `Monitor`, e o compilador avisa `CS9216: A value of type 'System.Threading.Lock' converted to a different type will use likely unintended monitor-based locking`. `EnterScope()` dá um escopo descartável, o lock é reentrante, `TryEnter(50)` deu `false` para uma segunda thread, e `Exit` sem ser o dono, inclusive de outra thread, lança `SynchronizationLockException` (o conceito de locks chama esse estado de indefinido; no .NET 10 aqui lançou exceção). `Monitor.Wait` num `Lock` segurado por `Enter` lança a mesma, então esperas por condição ainda pedem um objeto comum. Velocidade: 200 milhões de iterações sem contenção, 3 rodadas: `lock(object)` 4,5 ns, `lock(Lock)` de 3,6 a 4,1 ns. Sob contenção não houve ganho (tabela acima: 119,8 contra 143,8 Mops/s com 8 threads e um contador puro, igual dentro de 3% com trabalho real). Use `Lock` pela intenção e pelo aviso CS9216, não por vazão.

### Pontes: sistemas operacionais

Isto é o vocabulário dos sistemas operacionais. O sistema THE ([Dijkstra](/papers/the-structure-of-the-the-multiprogramming-system)) introduziu P e V: `SemaphoreSlim.Wait` e `Release`. O "semáforo privado" dele, esperado por um só processo, é um evento, e o `AutoResetEvent` é esse sinal binário (por isso dois `Set` colapsam). `Barrier` e `CountdownEvent` são um contador mais uma espera, o que um monitor (um lock com `Wait` e `Pulse`) constrói. O spin lock é o problema do multiprocessador que o THE não tinha. [Mellor-Crummey e Scott](/papers/algorithms-for-scalable-synchronization-on-shared-memory-multiprocessors) mostram que girar sobre uma bandeira compartilhada inunda o sistema de memória, e o lock MCS resolve com uma fila em que cada espera gira na sua própria bandeira, em ordem FIFO. O `SpinLock` não é isso: a medida de justiça mostra threads que nunca entraram. A barreira em árvore deles é o primo escalável do contador do `Barrier`.

## Trade-offs

- **As primitivas especializadas são de nicho, e os números dizem isso.** Arquivos que casam na busca de código do GitHub (C#, 2026-11-20, estimativas arredondadas que incluem forks): `Interlocked` 470k, `ConcurrentDictionary` 359k, `SemaphoreSlim` 180k, `AutoResetEvent` 66k, `ManualResetEventSlim` 62k, `Channel.CreateBounded` 22k, `ReaderWriterLockSlim` 21k, `CountdownEvent` 20k, `SpinLock` 9k, `new Barrier(` 6k, `new Lock()` 5k. O código novo é quase todo `lock`, `SemaphoreSlim`, `Channel<T>` e `Interlocked`; `new Barrier(` aparece em cerca de 3% dos arquivos em que aparece `SemaphoreSlim`.
- **Livro vs hoje.** Material mais antigo recomenda `SpinLock` por velocidade, `ReaderWriterLockSlim` para qualquer mapa de leitura frequente e `ManualResetEvent` como padrão. Aqui o `SpinLock` perdeu em seções minúsculas e ganhou de 1,4 a 1,75 vez só por ser injusto, o reader-writer lock perdeu para o `lock` em leituras curtas, e os eventos do kernel foram 30 vezes mais lentos que o slim.
- **Gire só quando a espera for curta.** O spin economizou 5,6 us por passagem, mas `SpinCount` 2047 gastou 8 vezes a CPU do padrão em sinais atrasados.
  ```csharp
  var e = new ManualResetEventSlim(false, spinCount: 0); // aqui as esperas são longas
  ```
- **Uma barreira é um comboio.** Cada fase anda na velocidade do participante mais lento, e um participante ausente trava os demais. Use timeout e `RemoveParticipant`, e prefira `Parallel.For` quando as fases são só laços.
- **`CountdownEvent` é estrito.** Lança exceção quando a contagem é zero, então código que adiciona trabalho tarde precisa segurar uma contagem (o 1 extra) ou usar `TryAddCount`.
- **`ReaderWriterLockSlim` é uma escolha medida.** Escreva a versão com `lock`, meça com o tempo real de leitura e considere um snapshot primeiro.
- **Sem promessa de justiça.** `lock`, `SpinLock` e o reader-writer lock mostraram starvation ou prioridade para escritores. Se todo chamador precisa progredir, use uma fila.
- **Uma máquina macOS.** A diferença entre `SpinLock` e `lock` pode ser outra no Linux x64 (não medido): refaça a medição no hardware de destino antes de trocar um lock.

## Documentation Links

- [Overview of synchronization primitives, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/overview-of-synchronization-primitives) (doc)
- [Barrier class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.barrier) (doc)
- [How to synchronize concurrent operations with a Barrier, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/how-to-synchronize-concurrent-operations-with-a-barrier) (doc)
- [BarrierPostPhaseException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.barrierpostphaseexception) (doc)
- [CountdownEvent class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.countdownevent) (doc)
- [ManualResetEventSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.manualreseteventslim) (doc)
- [AutoResetEvent class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.autoresetevent) (doc)
- [SpinLock struct, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.spinlock) (doc)
- [How to use SpinLock for low-level synchronization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/how-to-use-spinlock-for-low-level-synchronization) (doc)
- [ReaderWriterLockSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim) (doc)
- [Lock class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lock) (doc)
- [lock statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock) (doc)
- [ImmutableInterlocked class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutableinterlocked) (doc)
