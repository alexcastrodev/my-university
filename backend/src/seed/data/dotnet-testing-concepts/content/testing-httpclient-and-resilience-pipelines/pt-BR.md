---
version: 1.0
updatedAt: 2026-10-18
title: "Testando Código com HttpClient e Pipelines de Resiliência"
summary: Um HttpMessageHandler fake escrito à mão no último elo da cadeia real, o typed client num ServiceCollection de teste e o pipeline de Microsoft.Extensions.Http.Resilience (retry, timeout, circuit breaker) num FakeTimeProvider, contando tentativas e o que cada uma enviou.
---
## Objective

Código que chama outro serviço por HTTP tem duas partes que valem teste: o que
ele faz com cada tipo de resposta (uma cotação, um 400, um 503, um timeout,
uma chamada cancelada) e o que o pipeline de resiliência em volta dele promete
(quantas tentativas, o que cada tentativa envia, quando o circuito abre). As
duas dão para testar sem servidor e sem esperar: troque o último
`HttpMessageHandler` por um fake escrito à mão, mantenha a cadeia de handlers
real e o pipeline real, e dê ao pipeline um relógio fake. O objetivo é uma
suíte que roda em milissegundos e fica vermelha quando alguém apaga o retry,
reordena os handlers ou transforma um cancelamento em "timeout".

## Use Cases

- Provar que um typed client mapeia 4xx, 5xx, timeouts e cancelamento para os
  resultados que quem chama espera, e que um 4xx não é repetido.
- Provar que um retry envia a mesma chave de idempotência e o mesmo corpo em
  todas as tentativas.
- Testar as opções de `AddResilienceHandler` (número de retries, timeout por
  tentativa, circuit breaker) sem dormir segundos por teste.
- Testar um `DelegatingHandler` sozinho e no lugar dele na cadeia.
- Tirar um servidor stub ou uma biblioteca de mock de uma suíte de testes HTTP
  lenta.

## Deep Dive

### O fake é o último elo, escrito à mão

O `HttpClient` envia por uma cadeia de handlers. O último normalmente abre um
socket; num teste ele pode ser qualquer `HttpMessageHandler`. Um fake com
roteiro é uma fila de respostas e um registro do que cada tentativa enviou:

```csharp
internal sealed class FakeFreightApi : HttpMessageHandler
{
    private readonly ConcurrentQueue<Func<CancellationToken, Task<HttpResponseMessage>>> _script = new();
    private readonly ConcurrentQueue<SentRequest> _sent = new();

    public IReadOnlyList<SentRequest> Sent => _sent.ToArray();

    public FakeFreightApi Respond(HttpStatusCode status, string? json = null) { /* enfileira */ return this; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // ... registra a tentativa (próximas seções) ...
        if (!_script.TryDequeue(out var answer))
        {
            Assert.Fail($"Unscripted request: {request.Method} {request.RequestUri}");
        }

        return await answer(cancellationToken);
    }
}
```

O `Assert.Fail` importa. Um fake que responde 200 para tudo deixa verde "o
cliente repete um 503 até dar certo" com o retry apagado, porque a primeira
tentativa já dá certo. Roteirize exatamente as respostas que o cenário precisa
e afirme o número de tentativas:

```csharp
_api.Respond(HttpStatusCode.ServiceUnavailable).Respond(HttpStatusCode.TooManyRequests).Respond(HttpStatusCode.OK, QuoteJson);

var result = await RunAsync(_client.GetQuoteAsync(Request, Token));

Assert.AreEqual(FreightOutcome.Ok, result.Outcome);
Assert.HasCount(3, _api.Sent); // sem esta linha um fake que sempre responde 200 também passa
```

### O typed client num ServiceCollection de teste

Mantenha tudo que o registro de produção monta e troque só o handler primário.
O `AddResilienceHandler` devolve um `IHttpResiliencePipelineBuilder`, não o
`IHttpClientBuilder`, então `.ConfigurePrimaryHttpMessageHandler(...)` não pode
ser encadeado depois dele (dá erro de compilação). Por isso o método de
registro do lab devolve o builder do cliente:

```csharp
public static IHttpClientBuilder AddFreightClient(this IServiceCollection services, Uri baseAddress)
{
    var builder = services.AddHttpClient<FreightClient>(client => client.BaseAddress = baseAddress);
    builder.AddHttpMessageHandler(() => new IdempotencyKeyHandler()); // o mais externo: uma vez por chamada
    builder.AddResilienceHandler("freight", pipeline => pipeline
        .AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2, Delay = TimeSpan.FromSeconds(1) })
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5, MinimumThroughput = 4,
            SamplingDuration = TimeSpan.FromSeconds(30), BreakDuration = TimeSpan.FromSeconds(30),
        })
        .AddTimeout(TimeSpan.FromSeconds(2)));
    return builder;
}
```

O teste então liga o relógio fake e a API fake:

```csharp
var services = new ServiceCollection();
services.AddSingleton<TimeProvider>(_time); // o pipeline de resiliência pega daqui
services.AddFreightClient(new Uri("http://freight.test/"))
    .ConfigurePrimaryHttpMessageHandler(() => _api); // troca só o último elo
_services = services.BuildServiceProvider();
_client = _services.GetRequiredService<FreightClient>();
```

Por que o pipeline enxerga o `_time`? O `AddResilienceHandler` registra o
pipeline pelo `AddResiliencePipeline` do Polly, e o builder do Polly preenche
`builder.TimeProvider` a partir do container quando há um `TimeProvider`
registrado (está em `PollyServiceCollectionExtensions`). Todo atraso de retry,
timeout por tentativa e duração de quebra passa a rodar no relógio fake.

Uma surpresa de compilação: com o global using de
`Microsoft.VisualStudio.TestTools.UnitTesting`, `DelayBackoffType` fica ambíguo
entre o Polly e o MSTest (CS0104), porque o MSTest 4 tem o seu para o
`[Retry]`. Escreva `Polly.DelayBackoffType` ou crie um alias.

### Conduza o relógio fake

Um `FakeTimeProvider` só anda quando o teste chama `Advance`. Um teste que só
aguarda uma chamada com atraso de retry espera até outra coisa desistir: o
`HttpClient.Timeout`, 100 segundos por padrão, que não usa `TimeProvider`. Uma
chamada de rascunho que ninguém conduziu terminou depois de 1 min 40 s com
`TaskCanceledException`. Avance em passos pequenos até a chamada completar:

```csharp
private async Task<T> RunAsync<T>(Task<T> call)
{
    await DriveAsync(call);
    Assert.IsTrue(call.IsCompleted, "The call did not complete after 50 seconds of fake time.");
    return await call;
}

private async Task DriveAsync(Task task)
{
    for (var step = 0; step < 200 && !task.IsCompleted; step++)
    {
        _time.Advance(TimeSpan.FromMilliseconds(250));
        await Task.WhenAny(task, Task.Delay(1));
    }
}
```

Passos pequenos deixam o jitter inofensivo: o retry aqui usa o backoff
exponencial padrão com jitter, e o teste não precisa saber os atrasos exatos.

O mesmo relógio morde no fim de um teste que falhou. Antes de descartar um
pipeline, o Polly espera as execuções ainda em andamento, em passos de 1
segundo no `TimeProvider` do pipeline, e desiste depois de 30 segundos (o
`ExecutionTrackingComponent` do Polly). Um teste que falhou com uma chamada
ainda pendurada fez o `ServiceProvider.Dispose()` travar para sempre, e a
execução inteira junto. A correção é descartar de forma assíncrona enquanto
conduz o relógio:

```csharp
public async ValueTask DisposeAsync() => await DriveAsync(_services.DisposeAsync().AsTask());
```

### Registre cada tentativa: o retry reusa a mensagem

A estratégia de retry envia a mesma instância de `HttpRequestMessage` de novo.
Numa execução de rascunho com três tentativas, as mensagens guardadas eram um
único objeto. Um `DelegatingHandler` que carimbava uma chave nova por
tentativa mostrou a diferença:

```text
keys at send time = 0c4c2b,70074e,4b39ac
keys read from the stored messages after the call = 4b39ac,4b39ac,4b39ac
```

Um teste que guarda as mensagens e confere depois que "todas as tentativas
tinham a mesma chave" fica verde enquanto a API recebeu três chaves
diferentes. Copie o que precisa dentro do `SendAsync`, no momento da
tentativa:

```csharp
request.Headers.TryGetValues("Idempotency-Key", out var keys);
_sent.Enqueue(new SentRequest(request.Method, request.RequestUri!.AbsolutePath, body, keys?.Single()));
```

É assim também que o teste da cadeia prova a ordem dos handlers. O handler da
chave é adicionado antes do `AddResilienceHandler`, então fica fora do retry e
roda uma vez por chamada. Registrado depois, ele roda uma vez por tentativa; a
checagem de mutação do lab o moveu e só este teste ficou vermelho:

```csharp
Assert.HasCount(3, _api.Sent);
Assert.HasCount(1, _api.Sent.Select(s => s.IdempotencyKey).Distinct());
Assert.HasCount(1, _api.Sent.Select(s => s.Body).Distinct());
```

Um `DelegatingHandler` também pode ser testado sozinho: aponte o
`InnerHandler` dele para o fake e chame-o por um `new HttpMessageInvoker(handler)`.

### Leia o corpo como o fio lê

Um corpo que vem de um stream que só anda para a frente (o corpo de uma
requisição recebida sendo repassado, um download) não pode ser enviado duas
vezes. O cliente do lab o coloca em buffer:

```csharp
using var content = new StreamContent(manifest);
await content.LoadIntoBufferAsync(cancellationToken); // senão o retry encontra o stream já consumido
```

Como o fake lê o corpo decide se um teste consegue ver a diferença. Uma
execução de rascunho, com um 503 e depois um 200, contra um `StreamContent`
sem buffer sobre um stream não posicionável:

```text
fake never reads the body:        status=OK, 2 attempts
fake uses ReadAsStringAsync:      status=OK, body sent twice in full
fake uses CopyToAsync:            InvalidOperationException: The stream was already consumed. It cannot be read again.
```

O `ReadAsStringAsync` coloca o conteúdo em buffer como efeito colateral, então
o fake conserta o bug que deveria expor. O `CopyToAsync` para um
`MemoryStream` lê do jeito que um transporte lê:

```csharp
using var copy = new MemoryStream();
await request.Content.CopyToAsync(copy, cancellationToken);
body = Encoding.UTF8.GetString(copy.ToArray());
```

### 4xx, 5xx, timeout e cancelamento são respostas diferentes

Pela documentação, o retry e o circuit breaker HTTP tratam como transitórios
500 para cima, 408, 429, `HttpRequestException` e o `TimeoutRejectedException`
do Polly. Em execuções de rascunho:

| Situação | O que chegou ao código do cliente |
| --- | --- |
| 400 | a resposta 400, depois de 1 tentativa |
| 503 três vezes (2 retries) | a última resposta 503, depois de 3 tentativas |
| tentativa mais lenta que `AddTimeout(2 s)` | `Polly.Timeout.TimeoutRejectedException` |
| quem chama cancela o token | `TaskCanceledException`, sem retry |
| `HttpClient.Timeout` expira | `TaskCanceledException` com um `TimeoutException` interno |
| circuito aberto | `BrokenCircuitException`, que a estratégia de retry não repete |

O cliente do lab mapeia os quatro primeiros para `Rejected`,
`Unavailable("status 503")`, `Unavailable("timeout")` e um cancelamento
propagado. A tentativa lenta é um fake que espera no token, e três delas não
custam tempo real:

```csharp
_api.Hang().Hang().Hang(); // cada uma: await Task.Delay(Timeout.Infinite, token)
var start = _time.GetUtcNow();

var result = await RunAsync(_client.GetQuoteAsync(Request, Token));

Assert.AreEqual(FreightResult.Unavailable("timeout"), result);
Assert.IsGreaterThanOrEqualTo(TimeSpan.FromSeconds(6), _time.GetUtcNow() - start); // no relógio fake
```

Um fake lento que ignora o token (`Task.Delay(TimeSpan.FromSeconds(10))`)
continua rodando depois do timeout e gasta tempo real. Para cancelamento,
`Assert.ThrowsAsync<OperationCanceledException>` é a asserção certa porque
aceita o `TaskCanceledException` derivado;
`ThrowsExactlyAsync<OperationCanceledException>` não aceitaria. Um 200 cujo
corpo não segue o contrato também não é indisponibilidade: o
`ReadFromJsonAsync` lança `JsonException`, e o teste o espera com
`ThrowsExactlyAsync`.

### O circuito abre

Com taxa de falha 0.5 e vazão mínima 4, o breaker abre na quarta tentativa que
falha. O retry fica fora do breaker, então a primeira chamada faz três
tentativas, a primeira tentativa da segunda chamada abre o circuito, e a
terceira chamada nunca chega à API:

```csharp
var first = await RunAsync(_client.GetQuoteAsync(Request, Token));  // 3 tentativas, todas falharam
var second = await RunAsync(_client.GetQuoteAsync(Request, Token)); // a 4a falha abre o circuito
var third = await RunAsync(_client.GetQuoteAsync(Request, Token));  // nunca chega à API

Assert.AreEqual(FreightResult.Unavailable("circuit open"), third);
Assert.HasCount(4, _api.Sent);
```

Cada teste monta o próprio `ServiceProvider`, então cada um tem o próprio
breaker e testes em paralelo não abrem o circuito uns dos outros.

### Um servidor de verdade, quando precisar

Um handler fake nunca abre conexão, então não testa TLS, proxies, HTTP/2 nem
como o framework do servidor interpreta uma requisição. O WireMock.Net
(Apache-2.0) roda um servidor HTTP dentro do processo de teste: o
`WireMockServer.Start()` escutou numa porta de localhost num teste de
rascunho, e os stubs são declarados com `Given(Request.Create()...)` e
`RespondWith(Response.Create()...)`. Ele acrescenta uma dependência e uma
porta por teste, então deixe-o para poucos testes na borda.

### Os testes protegem as regras?

Cada mudança abaixo foi feita sozinha no código de produção do lab, a suíte
rodou e o código foi restaurado:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| O retry não trata nada | 7 de 13, dos testes de retry ao teste do manifesto |
| Handler da chave registrado depois do `AddResilienceHandler` | só o teste "mesma chave e mesmo corpo" |
| Sem timeout por tentativa | o teste de timeout |
| Sem circuit breaker | os dois testes de circuito |
| Sem `LoadIntoBufferAsync` | o teste do manifesto em stream só de ida |
| Todo status de falha mapeado para `Unavailable` | as duas linhas `[DataRow]` do teste de 4xx |
| Cancelamento capturado e reportado como timeout | o teste de cancelamento |
| `JsonException` capturado e reportado como indisponibilidade | o teste da cotação malformada |

## Trade-offs

- **Um handler fake testa o seu código, não o HTTP.** É rápido e
  determinístico, e nunca vê um socket, um header que o servidor recusa ou um
  proxy. Mantenha alguns testes contra um servidor de verdade (WireMock.Net, ou
  a API real num container) para as bordas.
- **Fakes com roteiro são rígidos de propósito.** Falhar numa requisição fora
  do roteiro deixa os testes mais longos de escrever, e é o que impede um
  teste de retry de passar sem retry nenhum.
- **Testar o pipeline real acopla os testes às opções dele.** Mudar o
  `MaxRetryAttempts` quebra as contagens de tentativas. É essa a ideia quando
  as opções são um contrato com a API; quando não são, teste o cliente sem o
  pipeline e teste as opções num lugar só.
  O `RemoveAllResilienceHandlers()` faz isso, mas no
  Microsoft.Extensions.Http.Resilience 10.11 ele está marcado como experimental
  e o build falha até você suprimir o EXTEXP0001.
  ```csharp
  #pragma warning disable EXTEXP0001 // API experimental
  builder.RemoveAllResilienceHandlers(); // só o mapeamento do cliente, sem retries, sem relógio para conduzir
  ```
- **Um relógio fake precisa de quem o conduza.** Toda chamada passa por um
  helper que avança o tempo, e o descarte também. Esquecer isso custa 100
  segundos por chamada, ou uma execução travada.
- **Registrar cada tentativa custa um pouco de código.** Copiar corpo e
  headers por tentativa é mais do que guardar a mensagem, e é o único jeito de
  saber o que cada tentativa enviou.
- **Uma biblioteca de mock é opcional aqui.** Um fake de handler tem dez linhas
  de C# puro, lê o corpo como um transporte lê, e afirma o que foi enviado em
  vez de quais métodos foram chamados. A trilha Java testing-concepts cobre o
  trade-off geral entre fakes e mocks.

## Lab

O `FreightClient`, um typed client para uma API de frete atrás de um handler de chave de idempotência e de um pipeline de resiliência (retry, circuit breaker, timeout por tentativa), já está implementado. Sua tarefa é escrever os testes MSTest que provam as oito regras dele com um handler fake escrito à mão e um relógio fake.

**O que você vai praticar**

- Escrever um fake de `HttpMessageHandler` com roteiro, que registra cada tentativa e lê o corpo como um transporte.
- Montar um typed client num `ServiceCollection` de teste, trocando só o último elo.
- Testar retries, timeouts por tentativa e o circuit breaker num `FakeTimeProvider`, sem esperas reais.
- Diferenciar 4xx, 5xx, timeout, cancelamento e erro de contrato.

**Pré-requisitos:** HttpClient and IHttpClientFactory, Resilience: Retries, Timeouts and Circuit Breakers, Controlling Time with TimeProvider, Test Doubles: Fakes, Stubs and NSubstitute, .NET 10 SDK.

**Como funciona:** cada teste está declarado com uma dica e falha com uma mensagem `TODO-NN` até você escrevê-lo. Quatro testes têm uma versão ingênua que passa pelo motivo errado (um fake que sempre responde 200, headers lidos da mensagem reusada, um corpo que ninguém lê, uma chamada que ninguém conduz). Os TODOs opcionais cobrem a sonda do circuito e uma checagem de mutação.

## Documentation Links

- [Build resilient HTTP apps, Microsoft.Extensions.Http.Resilience, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [IHttpClientFactory with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [Polly: dependency injection, Polly docs](https://www.pollydocs.org/advanced/dependency-injection.html) (doc)
- [Polly: testing, Polly docs](https://www.pollydocs.org/advanced/testing.html) (doc)
- [HttpContent.LoadIntoBufferAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpcontent.loadintobufferasync) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [WireMock.Net, GitHub](https://github.com/wiremock/WireMock.Net) (doc)
