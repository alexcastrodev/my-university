---
version: 1.0
updatedAt: 2026-10-04
title: "Filas em Memória com Channels"
summary: Channel<T> bounded, BoundedChannelFullMode, producer no endpoint e consumer no BackgroundService, drenagem no shutdown e o que se perde num restart.
---
## Objective

Às vezes um endpoint tem um trabalho que não deveria atrasar a resposta: enviar
um e-mail de confirmação, redimensionar uma imagem, chamar uma API lenta de um
parceiro. O `Channel<T>` de `System.Threading.Channels` é a fila em processo
feita para isso. Um producer escreve itens, um consumer os lê de forma
assíncrona, e o channel cuida da espera sem locks nem polling. As duas decisões
que importam são o que acontece quando o producer é mais rápido que o consumer
(capacidade limitada e um full mode) e o que você aceita perder, porque um
channel vive em memória e desaparece com o processo.

## Use Cases

- Um endpoint `POST /orders` que responde `202 Accepted` e deixa um serviço em
  segundo plano enviar o e-mail de confirmação.
- Suavizar uma rajada de eventos de entrada para que uma chamada lenta a jusante
  os processe no seu próprio ritmo.
- Fan-out para alguns consumers que compartilham uma fila de itens de trabalho.
- Entradas de telemetria ou auditoria que são úteis, mas aceitáveis de descartar
  sob carga.

## Deep Dive

### Um channel bounded

`Channel.CreateBounded<T>` dá uma capacidade à fila. Quando ela está cheia, o
`FullMode` decide o que quem escreve experimenta:

```csharp
var channel = Channel.CreateBounded<EmailJob>(new BoundedChannelOptions(capacity: 1000)
{
    FullMode = BoundedChannelFullMode.Wait, // WriteAsync espera por espaço
    SingleReader = true,                    // um consumer: permite ao channel pular parte da sincronização
    SingleWriter = false,                   // muitas requisições escrevem ao mesmo tempo
});
```

Os modos são `Wait` (quem escreve espera, o que dá backpressure), `DropWrite` (o
item novo é descartado), `DropNewest` (o item mais recentemente enfileirado é
descartado) e `DropOldest` (o item enfileirado há mais tempo é descartado).
`SingleReader` e `SingleWriter` são promessas: se você as declara e as quebra, o
comportamento é indefinido, então declare-as só quando for estruturalmente
verdade.

`Channel.CreateUnbounded<T>` não tem limite, o que significa que um consumer
lento deixa a fila crescer até o processo ficar sem memória.

### Producer no endpoint

Registre o channel como singleton e entregue cada lado ao código que precisa
dele, para que o endpoint só consiga escrever e o worker só consiga ler:

```csharp
builder.Services.AddSingleton(channel);
builder.Services.AddSingleton(sp => sp.GetRequiredService<Channel<EmailJob>>().Writer);
builder.Services.AddHostedService<EmailWorker>();

app.MapPost("/orders", async (PlaceOrder cmd, OrdersModule orders,
    ChannelWriter<EmailJob> queue, CancellationToken ct) =>
{
    var id = await orders.PlaceAsync(cmd, ct);

    if (!queue.TryWrite(new EmailJob(id)))          // cheio: decida, não bloqueie a requisição para sempre
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    return Results.Accepted($"/orders/{id}");
});
```

`TryWrite` retorna imediatamente com `false` quando um channel `Wait` está cheio,
e `WriteAsync` espera por espaço (até o token cancelar). Num endpoint HTTP,
falhar rápido com um status claro costuma ser melhor que segurar a requisição.

### Consumer num BackgroundService

`Reader.ReadAllAsync` devolve um `IAsyncEnumerable<T>` que entrega os itens
conforme chegam e termina quando o writer é completado e a fila esvazia:

```csharp
internal sealed class EmailWorker(
    Channel<EmailJob> channel, IServiceScopeFactory scopes, ILogger<EmailWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in channel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<IEmailSender>().SendAsync(job, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Email job {Id} failed", job.OrderId);
            }
        }
    }
}
```

Para rodar vários consumers, inicie vários loops sobre o mesmo reader e deixe
`SingleReader` como `false`. Capturar dentro do loop importa: um item ruim não
pode encerrar o `await foreach` e parar o worker inteiro.

### Completando o channel e drenando no shutdown

`Writer.Complete()` diz que nenhum item novo será escrito. Os readers continuam
recebendo os itens já enfileirados, e o `ReadAllAsync` termina depois do último.
No desligamento, complete o writer e espere o consumer terminar o que está na
fila. Para isso, o consumer não pode ler com o `stoppingToken`, porque o
`BackgroundService` o cancela assim que o `StopAsync` roda e o loop terminaria
com itens sobrando:

```csharp
// No ExecuteAsync: lê até o channel ser completado e esvaziar.
await foreach (var job in channel.Reader.ReadAllAsync(CancellationToken.None)) { /* ... */ }

public override async Task StopAsync(CancellationToken cancellationToken)
{
    channel.Writer.Complete();                      // sem itens novos
    if (ExecuteTask is { } running)
        await running.WaitAsync(cancellationToken); // drena, limitado pelo timeout de shutdown
    await base.StopAsync(cancellationToken);
}
```

O `cancellationToken` recebido pelo `StopAsync` é o prazo de shutdown do host,
então a drenagem fica limitada por `HostOptions.ShutdownTimeout`. O que ainda
estiver na fila quando ele expirar é perdido.

## Trade-offs

- **A fila existe só em memória.** Um restart, uma queda ou um deploy perde todo
  item enfileirado, e o endpoint já disse `202` ao cliente. Tudo que precisa ser
  entregue exige um armazenamento durável (uma tabela de outbox ou um broker), e
  o channel serve apenas para acordar o worker.
- **Bounded ou unbounded é uma decisão de memória.** Um channel unbounded nunca
  rejeita trabalho e acaba esgotando a memória com um consumer lento. Um bounded
  devolve a sobrecarga ao producer, que é a falha mais segura.
- **Cada `FullMode` perde algo diferente.** `Wait` não perde nada e desacelera o
  producer, enquanto os modos `Drop*` perdem itens em silêncio a menos que você os
  observe.
  ```csharp
  Channel.CreateBounded<Metric>(options, dropped => log.LogWarning("Dropped {Metric}", dropped.Name));
  // A sobrecarga com o callback itemDropped informa o que os modos de descarte jogam fora.
  ```
- **`SingleReader` e `SingleWriter` são promessas sem verificação.** Elas deixam o
  channel mais rápido, e declarar `SingleWriter = true` enquanto várias
  requisições escrevem ao mesmo tempo funciona num teste rápido e quebra sob carga
  real.
- **A fila fica em um único processo.** Com várias réplicas, cada uma tem seu
  próprio channel, então não há ordem compartilhada, não há divisão de carga entre
  instâncias e não há visibilidade de quanto trabalho está esperando no total.
- **Um item que falha não é repetido.** O worker acima registra e segue em
  frente, então retries e um armazenamento de dead-letter ficam por sua conta, que
  é o ponto em que uma biblioteca de jobs duráveis se justifica.

## Documentation Links

- [Channels, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [BoundedChannelFullMode enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.channels.boundedchannelfullmode) (doc)
- [Queue background tasks with a hosted service, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/queue-service) (doc)
- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
