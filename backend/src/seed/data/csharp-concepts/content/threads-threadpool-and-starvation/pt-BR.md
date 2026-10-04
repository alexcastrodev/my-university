---
version: 1.0
updatedAt: 2026-10-04
title: "Threads, ThreadPool e Starvation"
summary: Thread vs Task, foreground e background, injeção gradual de threads no ThreadPool, starvation causada por sync-over-async, LongRunning e como enxergar o problema com contadores.
---
## Objective

Um programa .NET roda em threads do sistema operacional, mas a maior parte do
código nunca cria uma. O trabalho vai para o thread pool, um conjunto
compartilhado de threads que o runtime aumenta e diminui sozinho. Isso é eficiente
até o pool ficar sem threads livres enquanto muitas requisições esperam por uma.
Aí a latência sobe, a CPU fica baixa e o serviço parece travado, embora não haja
nada de errado com o código que está preso. Este conceito cobre o que é uma
`Thread`, como o pool decide quantas threads rodar, por que bloquear em trabalho
async causa starvation e como ver isso acontecendo.

## Use Cases

- Um serviço ASP.NET Core que é rápido com carga leve e dá timeout com carga
  moderada, com a CPU quase ociosa.
- Um app de console que nunca termina porque uma thread de trabalho ainda está
  rodando.
- Decidir se um laço de longa duração (um message pump, um leitor de socket) deve
  usar `Task.Run`, `LongRunning` ou uma `Thread` própria.
- Ler a saída do `dotnet-counters` durante um incidente e saber se o thread pool é
  o gargalo.

## Deep Dive

### Uma Thread é uma thread do SO

`new Thread(...)` cria uma thread real do sistema operacional, com a própria pilha
(comumente cerca de 1 MB reservado no Windows, então criar milhares é caro). Ela é
foreground por padrão, e o processo não termina até que todas as threads
foreground tenham acabado:

```csharp
var worker = new Thread(() =>
{
    Thread.Sleep(5_000);
    Console.WriteLine("worker done");
});
// worker.IsBackground = true;  // sem esta linha, o retorno de Main não encerra o processo
worker.Start();

Console.WriteLine("main done"); // o processo continua vivo por mais uns 5 segundos
```

Definir `IsBackground = true` faz a thread morrer junto com o processo, o que é
certo para auxiliares e errado para trabalho que precisa terminar. As threads do
thread pool são sempre background, e por isso um `Task.Run` ainda em execução não
mantém o processo vivo.

Uma exceção não tratada numa `Thread` derruba o processo inteiro. Dentro de uma
`Task`, a exceção fica guardada na task e só aparece quando alguém dá await nela,
então uma task esquecida falha em silêncio:

```csharp
new Thread(() => throw new InvalidOperationException("boom")).Start(); // o processo cai
_ = Task.Run(() => throw new InvalidOperationException("boom"));       // engolida se ninguém observar
```

### O thread pool e a injeção gradual

`Task.Run`, continuações de `async`, laços `Parallel` e timers enfileiram trabalho
no mesmo pool. O pool começa com um número mínimo de threads, por padrão o número de
processadores, e cria essas sob demanda sem atraso. Acima desse mínimo ele adiciona
threads devagar, usando um algoritmo de hill climbing que tenta mais uma thread, mede
a vazão e só a mantém se a vazão melhorou. Na prática isso significa algo como uma
thread por segundo quando a demanda passa do mínimo:

```csharp
ThreadPool.GetMinThreads(out var minWorker, out var minIo);
ThreadPool.GetAvailableThreads(out var freeWorker, out var freeIo);

Console.WriteLine($"min {minWorker}, threads now {ThreadPool.ThreadCount}, " +
                  $"queued {ThreadPool.PendingWorkItemCount}");
```

O crescimento lento é proposital: evita criar centenas de threads que brigam por
poucos núcleos. É também o que transforma um pico curto de bloqueio num travamento
longo.

### Starvation por sync-over-async

Sync-over-async é chamar `.Result`, `.Wait()` ou `.GetAwaiter().GetResult()` numa
task a partir de uma thread que não pode continuar até ela terminar. Cada chamada
bloqueada mantém uma thread do pool parada, e a continuação que ela espera precisa
de uma thread do pool para rodar:

```csharp
// Chamado numa thread do pool a cada requisição.
public IActionResult Get()
{
    var data = _client.GetStringAsync(url).Result; // bloqueia esta thread até o I/O terminar
    return Ok(data);
}
```

Com 8 núcleos, as 8 primeiras requisições simultâneas bloqueiam 8 threads. As
conclusões de I/O ficam na fila atrás delas, nenhuma thread está livre para
executá-las e o pool vai pingando novas threads no seu ritmo lento. O ASP.NET Core
não tem synchronization context, então isso não é o deadlock clássico, e sim
starvation: ela se resolve em algum momento, depois de um longo atraso. A correção é
continuar async até o topo (veja o conceito de .NET sobre internals de `Task` e
async/await):

```csharp
public async Task<IActionResult> Get()
{
    var data = await _client.GetStringAsync(url); // a thread volta ao pool enquanto espera
    return Ok(data);
}
```

### LongRunning, e por que SetMinThreads não é remédio

Um laço que roda pela vida inteira do app ocuparia uma thread do pool para sempre,
reduzindo o que o pool pode oferecer a todo o resto. `TaskCreationOptions.LongRunning`
diz ao scheduler para usar uma thread dedicada:

```csharp
var reader = Task.Factory.StartNew(
    () => ReadSocketForever(token),
    token,
    TaskCreationOptions.LongRunning,
    TaskScheduler.Default);
```

`ThreadPool.SetMinThreads` eleva o mínimo para que o pool crie threads imediatamente
até esse número. Pode encurtar um travamento, mas esconde o código bloqueante que o
causou, e as threads extras custam memória e trocas de contexto. Trate como uma
mitigação temporária enquanto você remove as chamadas bloqueantes.

### Vendo acontecer

`dotnet-counters monitor --process-id <pid> System.Runtime` mostra os números que
importam: quantidade de threads do pool, tamanho da fila e itens concluídos. Uma fila
crescendo com a contagem de threads subindo um passo de cada vez e a CPU baixa é a
assinatura da starvation:

```text
ThreadPool Thread Count     :  18
ThreadPool Queue Length     : 412
CPU Usage (%)               :   6
```

## Trade-offs

- **Uma `Thread` dedicada custa uma pilha e um recurso do SO.** É a escolha certa
  para um punhado de laços de longa duração e a errada para trabalho por requisição.
  Uma `Task` no pool reaproveita threads e custa um objeto pequeno.
- **`LongRunning` não ajuda código async.** Uma lambda `async` iniciada com
  `LongRunning` libera a thread dedicada no primeiro `await`, e o resto roda no pool
  como de costume.
  ```csharp
  // A thread dedicada termina no primeiro await. O laço continua no pool.
  Task.Factory.StartNew(async () => { while (true) await Task.Delay(1000); },
                        TaskCreationOptions.LongRunning);
  ```
- **Threads background podem ser cortadas no meio do trabalho.** Quando a última
  thread foreground termina, o processo sai e as threads background param sem
  executar blocos `finally`, então trabalho que precisa terminar exige uma thread
  foreground ou um shutdown gracioso.
- **`SetMinThreads` troca latência por memória e esconde a causa.** Elevá-lo a um
  valor grande faz o travamento sumir num teste e voltar com uma carga maior, com
  mais threads disputando os mesmos núcleos.
- **Embrulhar código bloqueante em `Task.Run` só muda o bloqueio de lugar.** Libera
  a thread da requisição tomando outra do pool, então o pool continua com starvation,
  só que mais tarde. Use APIs async de verdade para I/O e deixe `Task.Run` para
  trabalho limitado por CPU.
- **Os números mudam entre versões do runtime.** A taxa de injeção e o mínimo padrão
  são detalhes do runtime. Meça no runtime que você publica e não fixe suposições
  sobre o atraso.

## Documentation Links

- [The managed thread pool, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/the-managed-thread-pool) (doc)
- [Foreground and background threads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/foreground-and-background-threads) (doc)
- [ThreadPool.SetMinThreads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.threadpool.setminthreads) (doc)
- [TaskCreationOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcreationoptions) (doc)
- [dotnet-counters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
- [ASP.NET Core best practices, avoid blocking calls, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices#avoid-blocking-calls) (doc)
