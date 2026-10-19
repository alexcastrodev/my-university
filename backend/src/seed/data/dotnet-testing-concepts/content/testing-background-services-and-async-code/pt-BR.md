---
version: 1.0
updatedAt: 2026-10-18
title: "Testando BackgroundService, Channels e Código Assíncrono"
summary: Teste um worker com Channel e PeriodicTimer sem dormir: FakeTimeProvider, sinais com prazo, ExecuteTask e FakeLogger para ver a falha que o StopAsync esconde, e o mesmo worker dentro de um host real.
---
## Objective

Um `BackgroundService` não tem ninguém esperando o resultado dele. Ele começa
na própria thread, acorda num timer, lê de um channel e só reporta falhas pelos
logs. Um teste para ele precisa responder três perguntas que um teste unitário
comum nunca faz: quando o worker de fato rodou, como faço o tempo passar sem
esperar por ele, e como enxergo uma exceção que ninguém aguarda? O objetivo é
uma suíte MSTest que conduz o worker com um relógio fake, espera sinais em vez
de `Task.Delay`, roda em uma fração de segundo e fica vermelha quando o worker
perde um lote, morre em silêncio ou aplica trabalho cedo demais.

## Use Cases

- Testar um worker que consome um `Channel<T>` e grava em lotes periódicos, sem
  esperar intervalos reais.
- Provar que uma falha num lote é logada e tentada de novo, e que ela não mata
  o worker nem derruba o host.
- Provar o desligamento gracioso: o que já estava na fila é aplicado quando o
  host para, e completar o channel encerra o worker.
- Trocar `Thread.Sleep` e `Task.Delay` numa suíte existente que é lenta e falha
  uma vez por semana no CI.
- Fazer asserções sobre registros de log com `FakeLogger` em vez de um logger
  escrito à mão.

## Deep Dive

### O ciclo de vida que você está testando

`BackgroundService` implementa `IHostedService`. O host chama `StartAsync`, que
inicia o `ExecuteAsync` e retorna; no desligamento ele chama `StopAsync`, que
cancela o `stoppingToken` e espera o `ExecuteAsync` terminar. A task que o
`ExecuteAsync` devolveu fica exposta como `ExecuteTask`.

O .NET 10 mudou um detalhe que importa para os testes. Antes, a parte síncrona
do `ExecuteAsync` (tudo antes do primeiro `await`) rodava dentro do
`StartAsync`. Desde o .NET 10 o `ExecuteAsync` inteiro roda numa thread de
background. Uma sonda que bloqueia 200 ms antes de ligar uma flag mostrou isso:

```text
ran right after StartAsync: False, ExecuteTask null? False
ran after await: True
```

Então, depois de `await worker.StartAsync(token)`, o worker pode ainda não ter
feito nada. Qualquer asserção do teste nesse momento não diz nada sobre o
worker.

### O worker sob teste

O worker do lab lê registros `StockMovement` de um channel e os aplica num
ledger uma vez por intervalo, no máximo `MaxBatchSize` por chamada. Toda
dependência que o teste precisa controlar é parâmetro do construtor, inclusive
o relógio:

```csharp
public sealed class StockBatchWorker(
    ChannelReader<StockMovement> reader,
    IStockLedger ledger,
    TimeProvider timeProvider,
    StockBatchOptions options,
    ILogger<StockBatchWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Interval, timeProvider);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await FlushAsync(stoppingToken);
                if (reader.Completion.IsCompleted) return;
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }

        await FlushAsync(CancellationToken.None); // o host está parando: aplica o que está na fila
    }
}
```

O `FlushAsync` drena com `TryRead`, chama o ledger e, se falhar, loga um erro e
guarda o lote para o próximo tick. Isso dá cinco regras para testar: nada antes
do primeiro tick, lotes limitados a `MaxBatchSize`, lote com falha tentado de
novo, channel completado encerra o worker, e parar drena a fila.

### Espere um sinal, não o tempo

A versão quebrada de um teste de worker dorme e torce:

```csharp
await worker.StartAsync(token);
writer.TryWrite(new StockMovement("KB-01", 5));
await Task.Delay(TimeSpan.FromSeconds(6)); // maior que o intervalo, "deve bastar"
Assert.HasCount(1, ledger.Batches);
```

Custa seis segundos por teste, e num agente de CI ocupado seis segundos às vezes
não bastam. Com um `FakeTimeProvider` é pior: o `Task.Delay` do teste não mexe
no relógio fake, então o worker nunca dá tick (num teste de rascunho, zero
lotes depois de 6 segundos reais).

A versão corrigida espera exatamente o que quer ver. O ledger fake do lab
escreve cada lote num channel, que funciona como um sinal que carrega dados, e
o teste aguarda o próximo com um prazo:

```csharp
public Task ApplyAsync(IReadOnlyList<StockMovement> batch, CancellationToken cancellationToken)
{
    _calls.Writer.TryWrite(batch);
    return Interlocked.Decrement(ref _failuresLeft) >= 0
        ? Task.FromException(new InvalidOperationException("The ledger is down."))
        : Task.CompletedTask;
}

public async Task<IReadOnlyList<StockMovement>> NextCallAsync(CancellationToken cancellationToken) =>
    await _calls.Reader.ReadAsync(cancellationToken).AsTask().WaitAsync(Deadline, cancellationToken);
```

O prazo de 5 segundos só é atingido quando o teste já está falhando, então uma
execução verde não paga nada. Um `TaskCompletionSource` faz o mesmo para um
evento que acontece uma vez, e consultar uma condição em loop com prazo é o
plano B quando o código não oferece gancho nenhum.

### PeriodicTimer e FakeTimeProvider

O `PeriodicTimer` aceita um `TimeProvider` desde o .NET 8, então o
`FakeTimeProvider.Advance` de `Microsoft.Extensions.TimeProvider.Testing`
dispara os ticks dele. Dois comportamentos, ambos reproduzidos num teste de
rascunho, decidem como escrever o teste:

```text
Advance(5 s), depois cria um timer de 5 s:  tick completed: False
depois Advance(5 s) de novo:                tick completed: True
Advance(15 s) sem ninguém esperando:        a primeira espera completa na hora, a segunda não
```

Um timer criado depois do `Advance` conta a partir do novo "agora", então
avançar antes de o worker criar o timer move o tempo para ninguém. E um
`PeriodicTimer` lembra de um tick perdido, não de três. Como o `ExecuteAsync`
começa depois do `StartAsync`, o teste precisa saber quando o timer existe. O
`FakeTimeProvider` não é `sealed`, então uma subclasse pode sinalizar isso:

```csharp
internal sealed class SignalingTimeProvider : FakeTimeProvider
{
    private readonly TaskCompletionSource _timerCreated = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task TimerCreated => _timerCreated.Task;

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = base.CreateTimer(callback, state, dueTime, period);
        _timerCreated.TrySetResult();
        return timer;
    }
}
```

Com ela, um teste se lê como uma linha do tempo. Cinco movimentos, limite de
dois, um tick:

```csharp
await StartWorkerAsync(maxBatchSize: 2); // StartAsync, depois await _time.TimerCreated
Write(new StockMovement("A", 1), new StockMovement("B", 1), new StockMovement("C", 1),
      new StockMovement("D", 1), new StockMovement("E", 1));

_time.Advance(Interval);

Assert.HasCount(2, await _ledger.NextCallAsync(Token));
Assert.HasCount(2, await _ledger.NextCallAsync(Token));
Assert.HasCount(1, await _ledger.NextCallAsync(Token));
```

### "Ainda não" é a única espera real honesta

"Nada é aplicado antes do primeiro tick" é uma negativa, e uma negativa não tem
sinal. O teste ingênuo a afirma logo depois do `StartAsync`:

```csharp
await worker.StartAsync(token);
writer.TryWrite(new StockMovement("A", 1));
Assert.AreEqual(0, ledger.Calls); // verde até para um worker que aplica na chegada
```

Ele ficou verde contra um mutante que aplica cada movimento assim que chega,
porque esse worker ainda não tinha rodado. A versão do lab espera o timer
existir, move o relógio para 1 ms antes do tick, dá a um worker mal-comportado
um período de silêncio de 200 ms e então exige que a primeira chamada contenha
um movimento escrito depois desse período:

```csharp
Write(new StockMovement("KB-01", 5));
_time.Advance(Interval - TimeSpan.FromMilliseconds(1));
Assert.IsFalse(await _ledger.IsCalledWithinAsync(TimeSpan.FromMilliseconds(200), Token));
Write(new StockMovement("MS-02", -1));
_time.Advance(TimeSpan.FromMilliseconds(1));

var first = await _ledger.NextCallAsync(Token);
CollectionAssert.AreEqual(new StockMovement[] { new("KB-01", 5), new("MS-02", -1) }, first.ToArray());
```

Sem o período de silêncio o mesmo teste ainda passava contra o mutante: o teste
escrevia os dois movimentos antes de o mutante acordar. Mantenha a espera real
curta e restrita à regra que fala de "ainda não".

### Drenando um channel

O `ChannelReader.Completion` completa quando o writer chamou `Complete` e o
último item foi lido, não antes (`completion before read: False`, `after last
read: True` num teste de rascunho). O worker confere isso depois de cada flush,
então o teste completa o writer, dá um tick e aguarda o `ExecuteTask` com
prazo:

```csharp
Write(new StockMovement("KB-01", 5), new StockMovement("MS-02", -1));
_channel.Writer.Complete();

_time.Advance(Interval);

Assert.HasCount(2, await _ledger.NextCallAsync(Token));
await worker.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(5), Token);
Assert.IsTrue(worker.ExecuteTask.IsCompletedSuccessfully);
```

Um `await worker.ExecuteTask` puro travaria a execução se o worker nunca
terminasse. O desligamento é a outra saída: `StopAsync` sem tick nenhum ainda
precisa aplicar os três movimentos da fila, porque o worker drena com
`CancellationToken.None` depois que o stopping token dispara.

### Uma exceção que ninguém aguarda

O `StopAsync` não relança o que matou o `ExecuteAsync`. Um worker que lançou
depois do primeiro `await` deu isto:

```text
StopAsync returned; status=Faulted ex=boom
```

Então "o ledger foi chamado e o `StopAsync` completou" fica verde com o worker
vivo ou morto. Olhe para o `ExecuteTask` (`IsFaulted`, `IsCompleted`, ou
`Assert.ThrowsExactlyAsync<InvalidOperationException>(() => worker.ExecuteTask!)`)
e para os logs. Dentro de um host, desde o .NET 6 uma exceção não tratada no
`ExecuteAsync` é logada e para o host
(`BackgroundServiceExceptionBehavior.StopHost`, o padrão). Capturado com
`AddFakeLogging()`, o host escreveu:

```text
Error    [Microsoft.Extensions.Hosting.Internal.Host] BackgroundService failed
Critical [Microsoft.Extensions.Hosting.Internal.Host] The HostOptions.BackgroundServiceExceptionBehavior is configured to StopHost. ...
```

Com `BackgroundServiceExceptionBehavior.Ignore` só o `Error` foi escrito e o
host continuou rodando, com um worker morto. Um teste com host pode então
provar que "um ledger com falha não derruba o host" afirmando que o
`IHostApplicationLifetime.ApplicationStopping` não foi cancelado e que não
existe registro `Critical`.

### FakeLogger e FakeLogCollector

O `Microsoft.Extensions.Diagnostics.Testing` traz o `FakeLogger<T>` para um
worker construído à mão, e `AddFakeLogging()` mais `GetFakeLogCollector()`
para um host. Um registro guarda o nível, a categoria, a exceção e a mensagem
formatada:

```csharp
var error = Assert.ContainsSingle(_logger.Collector.GetSnapshot().Where(r => r.Level == LogLevel.Error));
Assert.IsInstanceOfType<InvalidOperationException>(error.Exception);
Assert.AreEqual("Failed to apply 2 stock movements; retrying on the next tick", error.Message);
```

Afirme o log depois que a nova tentativa chegou, não logo depois da chamada que
falhou: o worker escreve o log depois que o ledger lança, na thread dele.

### Métodos de teste assíncronos no MSTest

O MSTest 4 roda métodos de teste `async Task` e `async ValueTask` (os dois
conferidos aqui). `Assert.ThrowsExactlyAsync<T>` aceita só `T`, e
`Assert.ThrowsAsync<T>` aceita também tipos derivados. O
`TestContext.CancellationToken` é o token para passar a tudo que o teste
aguarda: com `[Timeout(500, CooperativeCancellation = true)]` um teste que
demorou demais viu esse token cancelado. A documentação recomenda o
cancelamento cooperativo (analisador MSTEST0045) porque o timeout não
cooperativo deixa o teste rodando em background. No xUnit v3 o mesmo token é
`TestContext.Current.CancellationToken`.

### Os testes protegem as regras?

Cada mudança abaixo foi feita no `StockBatchWorker` sozinha, a suíte rodou e o
arquivo foi restaurado:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| `FlushAsync` ignora `MaxBatchSize` | o teste de tamanho do lote |
| Uma falha do ledger escapa do `ExecuteAsync` | o teste de nova tentativa e o teste de host "não para" |
| O lote é limpo antes da chamada ao ledger (perdido na falha) | o teste de nova tentativa e o teste de host |
| Sem `return` depois que o channel completa | o teste de channel completado |
| Sem flush final ao parar | o teste de parada e o teste de desligamento do host |
| Flush na chegada (`WaitToReadAsync` em vez do timer) | "nada antes do primeiro tick" e os dois testes de falha |

Os dois testes ingênuos acima (afirmar logo depois do `StartAsync`, afirmar só
que o `StopAsync` completou) continuaram verdes contra os mutantes de flush na
chegada e de exceção escapando.

## Trade-offs

- **Um relógio fake testa a sua lógica, não o timer.** O `FakeTimeProvider`
  deixa os ticks exatos, que é a ideia, mas também esconde drift e falta de
  threads no pool. Mantenha um teste lento com o relógio real se o tempo em
  produção importa, e marque-o.
  ```csharp
  [TestCategory("Slow")] // roda com TimeProvider.System, fora da execução padrão
  ```
- **Testar sem host é mais barato, com host é mais fiel.** Workers montados à
  mão rodam em milissegundos e expõem o `ExecuteTask`. Só o host mostra erros de
  registro e o `BackgroundServiceExceptionBehavior`. O lab mantém seis testes
  diretos e dois com host.
- **Todo gancho para o teste é uma decisão de design.** Injetar `TimeProvider`,
  o `ChannelReader` e o ledger é bom design de qualquer forma. Um
  `SignalingTimeProvider` vive só no projeto de testes; resista a colocar
  eventos "para testes" no código de produção.
- **Prazos transformam travamentos em falhas, com um custo.** Um prazo de 5
  segundos é de graça quando verde, mas deixa uma execução vermelha mais lenta.
  Prazos mais curtos falham em agentes de CI lentos pelo motivo errado.
- **Asserções negativas precisam de espera real.** Não existe sinal para "nada
  aconteceu". Um período de silêncio curto é aceitável; uma suíte cheia deles é
  a suíte do `Task.Delay` de novo.
- **Logs viram contrato quando você os afirma.** Afirmar a mensagem exata pega
  um `{Count}` perdido, e também quebra numa reescrita inofensiva. Afirme nível e
  exceção em todo lugar, e a mensagem só onde ela importa.
- **A teoria não é específica do .NET.** Fakes versus mocks e o custo de afirmar
  detalhes de implementação estão na trilha testing-concepts; este concept só
  acrescenta o que hosting, channels e timers mudam.

## Lab

O `StockBatchWorker`, um `BackgroundService` que consome um `Channel<StockMovement>` e aplica lotes periódicos num ledger, já está implementado. Sua tarefa é escrever os testes MSTest que provam as cinco regras dele, com um relógio fake e sem `Task.Delay` usado como espera.

**O que você vai praticar**

- Conduzir um `PeriodicTimer` com `FakeTimeProvider` e saber quando o worker criou o timer.
- Esperar sinais com prazo em vez de dormir.
- Enxergar uma falha que o `StopAsync` esconde, pelo `ExecuteTask` e pelo `FakeLogger`.
- Testar a drenagem quando o channel completa e no desligamento, sem host e dentro de um generic host real.

**Pré-requisitos:** Hosted Services and BackgroundService, In-Memory Queues with Channels, Controlling Time with TimeProvider, MSTest básico, .NET 10 SDK.

**Como funciona:** cada teste está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo. Três testes têm uma versão ingênua que passa pelo motivo errado (afirmar antes de o worker rodar, não ver a exceção que o matou, dormir em vez de avançar o relógio). Os TODOs opcionais pedem para provar que o `StopAsync` esconde uma falha e para mutar o worker e ver o que a sua suíte percebe.

## Documentation Links

- [Breaking change: BackgroundService runs all of ExecuteAsync as a Task (.NET 10), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/backgroundservice-executeasync-task) (doc)
- [Breaking change: Exception handling in hosting (.NET 6), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/6.0/hosting-exception-handling) (doc)
- [Worker services in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/workers) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [System.Threading.Channels library, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [FakeLogCollector class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.logging.testing.fakelogcollector) (doc)
- [Test execution and control in MSTest (timeouts, cooperative cancellation), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
