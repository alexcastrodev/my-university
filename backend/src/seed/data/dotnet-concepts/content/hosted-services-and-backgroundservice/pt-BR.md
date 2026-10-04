---
version: 1.0
updatedAt: 2026-10-04
title: "Hosted Services e BackgroundService"
summary: IHostedService vs BackgroundService, exceção que derruba o host, IServiceScopeFactory dentro de singleton, PeriodicTimer e graceful shutdown.
---
## Objective

Um host ASP.NET Core ou Worker Service pode rodar código de longa duração ao
lado do servidor web: um loop de polling, uma limpeza noturna, um consumidor de
fila. O bloco de construção é o `IHostedService`, e o `BackgroundService` é a
classe base de onde a maior parte do código deve partir. Os detalhes que causam
incidentes estão todos no ciclo de vida: o que acontece quando o loop lança
exceção, como um singleton chega a um `DbContext` scoped, como o startup é
atrasado por um trabalho que parece assíncrono e quanto tempo o host dá ao
serviço para parar.

## Use Cases

- Consultar uma tabela a cada 30 segundos atrás de mensagens do outbox e
  despachá-las.
- Rodar uma limpeza de sessões expiradas toda noite sem um agendador externo.
- Aquecer um cache ou checar uma dependência uma vez no startup, antes de o host
  começar a aceitar tráfego.
- Esvaziar o trabalho em andamento quando o orquestrador envia um sinal de
  término, em vez de descartá-lo.

## Deep Dive

### IHostedService e BackgroundService

`IHostedService` tem dois métodos: `StartAsync`, chamado quando o host inicia, e
`StopAsync`, chamado quando ele desliga. `BackgroundService` implementa os dois
e deixa para você um método abstrato, `ExecuteAsync(CancellationToken)`, que roda
durante toda a vida do serviço:

```csharp
internal sealed class OutboxDispatcher(
    IServiceScopeFactory scopes, ILogger<OutboxDispatcher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<OrdersDbContext>();
                await DispatchPendingAsync(db, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Outbox dispatch failed, retrying on the next tick");
            }
        }
    }
}

builder.Services.AddHostedService<OutboxDispatcher>();
```

Implemente `IHostedService` diretamente só quando precisar de comportamentos
separados de início e parada, como abrir uma conexão no `StartAsync` e fechá-la
no `StopAsync`. Fora isso, o `BackgroundService` já entrega o token de
cancelamento e o tratamento da parada.

### Uma exceção não tratada para o host

Desde o .NET 6, uma exceção que escapa do `ExecuteAsync` é registrada
em log e o host para (`BackgroundServiceExceptionBehavior.StopHost`, o padrão).
Antes disso, a exceção era engolida e o serviço parava de funcionar em silêncio
enquanto a aplicação seguia rodando. Capture dentro do loop o que você consegue
recuperar, como acima, e deixe os erros realmente fatais encerrarem o processo
para que o orquestrador o reinicie:

```csharp
builder.Services.Configure<HostOptions>(o =>
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore);
// Restaura o comportamento antigo: a falha é registrada e o host segue rodando sem o serviço.
```

### Serviços scoped a partir de um singleton

Um hosted service é um singleton, então não pode receber um `DbContext` scoped
no construtor: com a validação de escopo ligada (o padrão em Development) o host
falha na inicialização, e sem ela o serviço capturaria um único contexto pela
vida inteira da aplicação. Injete `IServiceScopeFactory` e crie um escopo para
cada unidade de trabalho, como o dispatcher acima faz, ou injete
`IDbContextFactory<T>`.

### PeriodicTimer

`PeriodicTimer` é a ferramenta certa para um loop de intervalo fixo.
`WaitForNextTickAsync` devolve `true` a cada tick, lança
`OperationCanceledException` quando o token é cancelado e devolve `false` depois
que o timer é descartado. Se uma iteração demora mais que o período, os ticks
não se acumulam: a próxima espera completa uma única vez, então as iterações
nunca se sobrepõem. Um `while` com `Task.Delay` deriva pela duração do trabalho,
e um `System.Threading.Timer` pode disparar o callback enquanto o anterior ainda
está rodando.

### Startup e graceful shutdown

O host chama `StartAsync` em cada hosted service na ordem de registro e espera
por ele. No .NET 8 e 9, um `BackgroundService` executa o `ExecuteAsync` dentro do
`StartAsync` até o primeiro `await` de verdade, então trabalho síncrono no começo
do `ExecuteAsync` bloqueia o startup de todo serviço depois dele. No .NET 10 a
documentação diz que o `ExecuteAsync` é chamado no thread pool, então esse
trabalho deixa de segurar os outros serviços. Um `StartAsync` próprio continua
bloqueando, porque os hosted services iniciam em sequência. Um `ExecuteAsync` que
cede cedo é seguro em todas as versões:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    await Task.Yield(); // deixa o host terminar de iniciar, depois faz a inicialização lenta
    await WarmUpCacheAsync(stoppingToken);
    // ... loop
}
```

No desligamento, o host cancela o `stoppingToken` e espera o `ExecuteAsync`
terminar, até `HostOptions.ShutdownTimeout`, que por padrão é de 30 segundos nas
versões atuais. Os serviços param na ordem inversa do registro. Se o seu loop
precisa de mais tempo para esvaziar, aumente o timeout e garanta que o período
de graça do próprio orquestrador (por exemplo o `terminationGracePeriodSeconds`
do Kubernetes) seja maior que ele:

```csharp
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(60));
```

## Trade-offs

- **Engolir toda exceção mantém o loop vivo e esconde um serviço travado.** Um
  catch-all que só registra pode transformar uma falha permanente (uma connection
  string errada) num loop infinito de erros, então combine com um health check ou
  uma métrica que mostre a ausência de sucesso recente.
- **Deixar quebrar é barulhento e exige quem reinicie.** Parar o host numa
  exceção não tratada é o padrão certo quando um orquestrador reinicia o
  processo, e derruba junto os endpoints web quando o trabalho em segundo plano e
  a API dividem o mesmo host.
- **Hosted services rodam no processo web.** Um loop pesado de CPU disputa o
  mesmo thread pool com o tratamento de requisições, então trabalho pesado ou que
  escala de forma independente pertence a um deployment separado de Worker
  Service.
- **Um `StartAsync` síncrono e longo atrasa a prontidão.** A aplicação não aceita
  requisições até todo hosted service ter iniciado, então trabalho lento no
  `StartAsync`, ou no começo do `ExecuteAsync` no .NET 8 e 9, aparece como deploys
  lentos.
  ```csharp
  await Task.Yield(); // no .NET 8 e 9, sem isso um warm-up de 40 segundos atrasa o host inteiro em 40 segundos
  ```
- **O timeout de shutdown é uma parada forçada.** O trabalho ainda em andamento
  quando ele expira é abandonado, então o que não pode ser perdido precisa ser
  durável (um banco ou um broker) e não existir apenas em memória.

## Documentation Links

- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [Worker Services in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/workers) (doc)
- [Generic Host, shutdown and HostOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/generic-host) (doc)
- [Breaking change: Unhandled exceptions from a BackgroundService, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/6.0/hosting-exception-handling) (doc)
- [PeriodicTimer class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.periodictimer) (doc)
