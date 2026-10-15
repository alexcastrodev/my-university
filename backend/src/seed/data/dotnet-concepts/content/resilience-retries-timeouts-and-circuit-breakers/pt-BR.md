---
version: 1.0
updatedAt: 2026-10-15
title: "Resiliência: retries, timeouts e circuit breakers"
summary: Microsoft.Extensions.Http.Resilience (Polly v8) num HttpClient: defaults do handler padrão, retry com jitter, o perigo de repetir POST, timeout por tentativa e total, circuit breaker e hedging, com o que o servidor realmente recebeu.
---
## Objective

Uma chamada a outro serviço falha de jeitos que seu código não consegue evitar: um 503 durante um deploy, uma conexão que trava, uma dependência fora do ar por um minuto. Políticas de resiliência decidem o que acontece depois: tentar de novo, desistir cedo, parar de chamar por um tempo ou perguntar a um segundo servidor. No .NET isso é feito com o pacote `Microsoft.Extensions.Http.Resilience`, que coloca estratégias do Polly v8 num `HttpClient` criado pelo `IHttpClientFactory`. Este conceito executa cada estratégia contra um servidor local que falha sob demanda, mostra o que o servidor realmente recebeu e exibe o caso em que o padrão é perigoso (repetir um POST). Versões usadas: SDK 10.0.100, `Microsoft.Extensions.Http.Resilience` 10.11.0, que resolveu `Polly.Core` 8.4.2.

## Use Cases

- Chamar um serviço de pagamento, catálogo ou identidade que às vezes responde 503 ou estoura o tempo.
- Impedir que uma dependência lenta prenda todas as suas threads e conexões de requisição.
- Reduzir a latência de cauda de uma leitura segura perguntando a um segundo endpoint quando o primeiro está lento.
- Decidir, por cliente, quais requisições podem ser repetidas e quais não podem.

## Deep Dive

### Uma chamada adiciona um pipeline

Isto se apoia na factory do conceito de HttpClient: você encadeia no builder que o `AddHttpClient` devolve.

```text
dotnet add package Microsoft.Extensions.Http.Resilience
```

```csharp
builder.Services.AddHttpClient("orders", c => c.BaseAddress = new Uri("http://localhost:5402"))
    .AddStandardResilienceHandler();
```

A documentação diz para adicionar um único handler de resiliência por cliente e não empilhá-los. O handler padrão encadeia cinco estratégias, da mais externa para a mais interna. Li os valores reais das opções em `IOptionsMonitor<HttpStandardResilienceOptions>`:

```text
rate limiter   permits=1000 queue=0
total timeout  30 s
retry          3 retries, delay 2 s, Exponential, jitter on
circuit breaker  failure ratio 0.1, min throughput 100, sampling 30 s, break 5 s
attempt timeout  10 s
```

Isso confere com a tabela da documentação. O que o retry e o breaker tratam como falha, segundo a documentação, é um status 500 ou superior, 408 ou 429, além de `HttpRequestException` e do `TimeoutRejectedException` do Polly.

### Retries: o que realmente acontece

Contra um endpoint que sempre responde 503, um GET com os padrões fez **4 requisições** (1 mais 3 retries) e então devolveu a última resposta. Não lançou exceção: `status 503`. Os atrasos são exponenciais com jitter, então o total variou entre execuções, 6,4 s numa e 9,3 s noutra. As linhas de log do Polly mostram cada tentativa (categoria `Polly`, Warning):

```text
warn: Polly[0] Resilience event occurred. EventName: 'OnRetry', Source: 'std-default-standard//Standard-Retry', Result: '503'
fail: Polly[3] Execution attempt. ... Result: '503', Handled: 'True', Attempt: '3'
```

Com `Retry.Delay` reduzido para 100 ms e um endpoint que falha duas vezes, a terceira tentativa funcionou: `status 200 "ok after 3 attempts"` em 217 ms. O padrão também respeita `Retry-After`: a opção leu `ShouldRetryAfterHeader = True`, e um 429 com `Retry-After: 2` fez o retry esperar 2096 ms mesmo com `Retry.Delay` em 100 ms.

### O padrão perigoso: repetir um POST

A documentação diz com clareza: por padrão o handler repete todos os métodos HTTP. Enviei um POST de pedido a um endpoint que falha duas vezes:

```text
POST default:                      status 200, server hits: 3, body '{"item":"book"}' x3
POST + Retry.DisableForUnsafeHttpMethods(): status 503, server hits: 1
```

Três POSTs chegaram ao servidor, cada um com seu corpo, então um servidor que cria uma linha por POST teria criado três. `DisableForUnsafeHttpMethods()` (POST, PATCH, PUT, DELETE e CONNECT, segundo a documentação) removeu os retries. `DisableFor(HttpMethod.Post)` é a forma mais restrita. A correção real para uma escrita é torná-la idempotente no servidor, como no conceito de semântica REST, por exemplo com uma chave enviada pelo cliente que o servidor deduplica, e só então permitir retries.

### Timeouts: por tentativa versus total

Existem dois timeouts. O timeout por tentativa limita cada tentativa, e o total limita tudo, incluindo os retries. Com timeout de tentativa de 300 ms, 2 retries e total de 5 s contra um endpoint que dorme 5 s:

```text
Polly.Timeout.TimeoutRejectedException: The operation didn't complete within the allowed timeout of '00:00:00.3000000'.
server hits: 3, each logged "client aborted", 1197 ms total
```

Três consequências. A exceção é o `TimeoutRejectedException` do Polly, não `TimeoutException` (a documentação avisa disso quando você escreve seu próprio `ShouldHandle`). Uma tentativa que estourou o tempo é repetida como um 503. E o servidor viu o cliente abortar cada tentativa, então um handler que respeita `RequestAborted` para de trabalhar em vez de terminar um serviço que ninguém vai ler.

### Circuit breaker: parar de chamar

Um breaker abre depois de falhas recentes suficientes e então falha rápido sem tocar a rede. Com retries desligados, timeout de tentativa de 1 s, amostragem de 10 s, throughput mínimo 5, razão 0,5 e quebra de 3 s, oito chamadas a um endpoint sempre 503 deram:

```text
req 1..5: 503   (server hits 1..5)
req 6..8: BrokenCircuitException   (server hits stay at 5)
after 3.2 s: 200 (a probe call reached a healthy endpoint, breaker closed)
next: 200
```

As chamadas 6 a 8 nunca saíram do processo. Passado o tempo de quebra, a chamada seguinte é liberada como sonda e seu sucesso fechou o circuito. Os padrões exigem 100 requisições em 30 s antes de o breaker poder abrir, então num serviço de pouco tráfego ele praticamente nunca dispara; ajuste `MinimumThroughput` ao seu tráfego. Quem chama precisa capturar `BrokenCircuitException` e degradar (dado em cache, um erro claro) em vez de tratá-la como bug.

### Hedging: perguntar duas vezes

`AddStandardHedgingHandler` é a alternativa ao retry para latência: se a primeira requisição está lenta, envie outra sem cancelar a primeira e fique com a primeira resposta boa. A opção lida foi `Hedging.Delay = 2 s` e `MaxHedgedAttempts = 1`. Com `Delay` em 200 ms contra um endpoint cuja primeira requisição dorme 3 s:

```text
status 200 'answer from attempt 2' after 219 ms
server hits: 2, "attempt 1 cancelled after 208 ms"
```

A tentativa lenta foi cancelada quando a rápida venceu. O hedging dobra a carga sobre uma dependência lenta e pode enviar a mesma requisição duas vezes, então use só para leituras seguras e idempotentes.

### Pipelines customizados e ordem

`AddResilienceHandler("name", builder => ...)` monta o seu pipeline, e as estratégias rodam na ordem em que você as adiciona, a primeira como a mais externa. Adicionei um timeout de 1 s, depois um retry (3 tentativas, 50 ms), depois um timeout de 300 ms:

```text
TimeoutRejectedException: ... allowed timeout of '00:00:01'. | server hits: 3 | 1221 ms
```

O timeout externo limitou toda a sequência em cerca de um segundo, enquanto o interno limitou cada tentativa. Colocar as estratégias na ordem errada muda em silêncio o significado dos números.

## Trade-offs

- **Retries multiplicam a carga.** Três retries transformam uma chamada que falha em quatro, de todos os chamadores ao mesmo tempo. Mantenha poucos retries e atraso exponencial com jitter, que é o padrão.
  ```csharp
  options.Retry.MaxRetryAttempts = 2;
  ```
- **Repetir escritas é uma decisão de correção.** Desabilite os métodos inseguros ou torne o endpoint idempotente primeiro.
  ```csharp
  options.Retry.DisableForUnsafeHttpMethods();
  ```
- **Os padrões servem a serviços de tráfego médio.** Um breaker que precisa de 100 chamadas em 30 s nunca abre num cliente quieto; um timeout total de 30 s pode ser maior do que o seu próprio chamador espera.
- **Hedging troca carga por latência.** Bom para uma réplica de leitura rápida, ruim para uma dependência que já está sofrendo.
- **Um breaker move a falha, não a remove.** Você ainda precisa decidir o que o chamador vê enquanto ele está aberto.
- **Um handler por cliente.** A documentação desaconselha empilhar handlers de resiliência; para trocar um por outro, chame `RemoveAllResilienceHandlers()` antes.
  ```csharp
  services.AddHttpClient("custom").RemoveAllResilienceHandlers().AddStandardHedgingHandler();
  ```

## Documentation Links

- [Build resilient HTTP apps: Key development patterns, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [Introduction to resilient app development, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/) (doc)
- [Use the IHttpClientFactory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
- [Polly documentation: Retry strategy](https://www.pollydocs.org/strategies/retry.html) (doc)
- [Polly documentation: Circuit breaker strategy](https://www.pollydocs.org/strategies/circuit-breaker.html) (doc)
- [Polly documentation: Hedging strategy](https://www.pollydocs.org/strategies/hedging.html) (doc)
