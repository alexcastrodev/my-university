---
version: 1.0
updatedAt: 2026-10-04
title: "Coordenando Trabalho Concorrente"
summary: Cancelamento e timeouts, throttling com SemaphoreSlim, fan-out e fan-in com Channels, TaskCompletionSource e as armadilhas do ConcurrentDictionary.GetOrAdd.
---
## Objective

Iniciar trabalho concorrente é fácil. Coordená-lo é onde moram os bugs: uma
operação que nunca para quando quem chamou desiste, cinquenta requisições
disparadas contra um serviço que aceita cinco, um resultado aguardado a partir
de um callback, um cache que executa duas vezes a mesma chamada cara. O .NET tem
um conjunto pequeno de primitivas para isso: cancellation tokens e timeouts,
`SemaphoreSlim` para throttling, `Channel<T>` para fan-out e fan-in,
`TaskCompletionSource<T>` para transformar eventos em tasks e
`Task.WhenAll`/`WhenAny` para juntar. Este conceito mostra como elas se
encaixam e onde cada uma falha em silêncio.

## Use Cases

- Abortar uma chamada downstream quando o cliente HTTP desconecta ou um prazo
  vence.
- Chamar uma API com rate limit para milhares de itens com no máximo N
  requisições em andamento.
- Dividir um job grande entre workers e juntar os resultados num só lugar.
- Esperar uma mensagem que chega depois, num callback ou evento.
- Fazer cache do resultado de uma consulta assíncrona cara por chave.

## Deep Dive

### Cancelamento e timeouts

O cancelamento é cooperativo: você passa um `CancellationToken` adiante e cada
chamada aguardada o observa. `CancelAfter` adiciona um prazo, e
`CreateLinkedTokenSource` combina o token de quem chamou com o seu próprio
timeout, de modo que qualquer um dos dois interrompe o trabalho:

```csharp
async Task<Report> BuildAsync(CancellationToken callerToken)
{
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(callerToken);
    cts.CancelAfter(TimeSpan.FromSeconds(5)); // prazo desta operação

    return await client.GetFromJsonAsync<Report>("report", cts.Token);
}
```

Quando você precisa de um timeout em volta de uma chamada que não aceita token,
`Task.WaitAsync` abandona a espera (não o trabalho):

```csharp
var result = await slowTask.WaitAsync(TimeSpan.FromSeconds(2), ct);
// lança TimeoutException após 2 segundos, mas slowTask continua rodando
```

Desde o .NET 8, `TimeProvider` permite controlar o tempo em testes: as
sobrecargas de `CancellationTokenSource` e `Task.WaitAsync` que recebem um
`TimeProvider` podem ser conduzidas por um relógio falso, em vez de esperar de
verdade.

### Throttling com SemaphoreSlim

Um semáforo limita quantas operações rodam ao mesmo tempo. Libere num `finally`,
ou uma exceção vaza uma permissão para sempre:

```csharp
var gate = new SemaphoreSlim(initialCount: 5);

var tasks = ids.Select(async id =>
{
    await gate.WaitAsync(ct);
    try { return await client.GetFromJsonAsync<Item>($"items/{id}", ct); }
    finally { gate.Release(); }
});

var items = await Task.WhenAll(tasks);
```

Isso ainda cria uma task por id de imediato, o que serve para milhares e
desperdiça para milhões. `Parallel.ForEachAsync` com `MaxDegreeOfParallelism`, ou
um channel com um número fixo de workers, limita a concorrência e a memória.

### Fan-out e fan-in com Channels

Um `Channel<T>` limitado é uma fila thread-safe com backpressure. Produtores
escrevem, um número fixo de workers lê (fan-out), e um segundo channel junta os
resultados (fan-in):

```csharp
var input = Channel.CreateBounded<int>(capacity: 100);
var output = Channel.CreateUnbounded<string>();

var workers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
{
    await foreach (var id in input.Reader.ReadAllAsync(ct))
        await output.Writer.WriteAsync(await ProcessAsync(id, ct), ct);
})).ToArray();

foreach (var id in ids) await input.Writer.WriteAsync(id, ct); // espera quando o channel está cheio
input.Writer.Complete();

await Task.WhenAll(workers);
output.Writer.Complete();
```

Sempre chame `Complete()` no writer, ou o `ReadAllAsync` nunca termina.

### TaskCompletionSource

`TaskCompletionSource<T>` transforma "algo vai acontecer depois" numa task que
você pode aguardar, como uma resposta associada a um id de requisição:

```csharp
var tcs = new TaskCompletionSource<Reply>(TaskCreationOptions.RunContinuationsAsynchronously);
pending[requestId] = tcs;

// depois, na thread que recebe:
if (pending.TryRemove(requestId, out var waiter)) waiter.SetResult(reply);

var reply = await tcs.Task;
```

`RunContinuationsAsynchronously` importa. Sem ele, o código depois do `await`
roda inline dentro do `SetResult`, na thread que completou a task, então uma
continuação lenta bloqueia o seu laço de recepção e pode até causar deadlock num
lock que você segura.

### WhenAll, WhenAny e exceções

`await Task.WhenAll(tasks)` lança apenas a primeira exceção. As outras ficam na
propriedade `Exception` da task do `WhenAll`, então inspecione-a se precisar de
todas. `Task.WhenAny` devolve a primeira task a terminar e não cancela as
demais:

```csharp
var all = Task.WhenAll(tasks);
try { await all; }
catch { foreach (var e in all.Exception!.InnerExceptions) log.LogError(e, "task failed"); }

var first = await Task.WhenAny(primary, fallback);
```

### ConcurrentDictionary.GetOrAdd

`GetOrAdd(key, factory)` é thread-safe para o dicionário, não para a factory:
duas threads podem achar a chave ausente e rodar a factory, e um dos resultados
vence. Para uma factory cara ou com efeito colateral, guarde um `Lazy<T>` ou um
`Lazy<Task<T>>`, de modo que apenas um valor seja criado e todo mundo o
compartilhe:

```csharp
var cache = new ConcurrentDictionary<string, Lazy<Task<Product>>>();

Task<Product> GetAsync(string sku) =>
    cache.GetOrAdd(sku, s => new Lazy<Task<Product>>(() => LoadAsync(s))).Value;
```

## Trade-offs

- **Cancelamento é um pedido, não um kill.** Código que nunca checa o token, ou
  chama uma biblioteca que o ignora, continua rodando depois do cancel.
  `WaitAsync` para de esperar, mas não o trabalho por baixo, que pode vazar
  recursos.
- **Sempre descarte o CancellationTokenSource.** Uma fonte vinculada ou um timer
  sem dispose mantém registros e pode vazar, então use `using`.
- **Tasks com falha ficam com falha no cache.** Com `Lazy<Task<T>>`, uma carga que
  falhou fica guardada para todos os chamadores seguintes.
  ```csharp
  cache.TryRemove(sku, out _); // remova na falha para a próxima chamada tentar de novo
  ```
- **Throttling com semáforo não limita a memória.** Uma task por item existe de
  imediato, esperando no portão. Use um channel ou `ForEachAsync` para entradas
  muito grandes.
- **Channels ilimitados escondem um consumidor lento.** Um produtor mais rápido
  que os workers faz a fila crescer até acabar a memória. Prefira
  `CreateBounded` com um `FullMode` adequado (esperar, descartar ou descartar o
  mais antigo).
- **`WhenAny` deixa as perdedoras rodando.** Cancele-as explicitamente com um
  token compartilhado quando houver um vencedor.

## Documentation Links

- [Cancellation in managed threads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads) (doc)
- [Task.WaitAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.waitasync) (doc)
- [TimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider) (doc)
- [SemaphoreSlim, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim) (doc)
- [System.Threading.Channels, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [TaskCompletionSource, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcompletionsource-1) (doc)
- [ConcurrentDictionary.GetOrAdd, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.concurrentdictionary-2.getoradd) (doc)
