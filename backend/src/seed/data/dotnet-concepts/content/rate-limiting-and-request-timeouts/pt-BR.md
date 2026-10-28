---
version: 1.0
updatedAt: 2026-10-28
title: "Rate limiting e timeouts de requisição"
summary: Os middlewares de rate limiting e de request timeouts do ASP.NET Core medidos com rajadas reais: os quatro algoritmos, o 503 padrão, 429 com Retry-After, filas, políticas global e nomeadas, partições e o risco de DoS, o caso do proxy reverso, métricas e o que o cliente vê quando o tempo estoura.
---
## Objective

Uma API tem duas formas de cair que não têm nada a ver com bugs: chegam requisições demais de uma vez, ou algumas requisições demoram tanto que seguram threads, conexões e sessões de banco até não sobrar nada para ninguém. O ASP.NET Core traz um middleware para cada problema. O middleware de rate limiting (`AddRateLimiter` + `UseRateLimiter`, construído sobre `System.Threading.RateLimiting`) decide se uma requisição pode entrar, usando janela fixa, janela deslizante, token bucket ou limite de concorrência, opcionalmente por usuário, API key ou IP. O middleware de request timeouts (`AddRequestTimeouts` + `UseRequestTimeouts`) cancela `HttpContext.RequestAborted` quando um endpoint demora demais. Os dois têm padrões e armadilhas que só aparecem sob carga: um status de rejeição que você provavelmente não quer, um header `Retry-After` que alguns algoritmos nunca preenchem, partições que um atacante consegue multiplicar e um timeout que não faz nada com um handler que ignora o token. Este conceito envia rajadas reais a um servidor local e mostra quais requisições receberam 200, 429, 503 ou 504, e quando. Versões usadas: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (`System.Threading.RateLimiting` embutido, file version 10.0.25.52411) e o pacote `System.Threading.RateLimiting` 10.0.14 no exemplo do lado do cliente.

## Use Cases

- Limitar quantas vezes um cliente (usuário, API key, tenant) chama um endpoint caro, para que um consumidor pesado não deixe os outros sem nada.
- Limitar quantas requisições rodam ao mesmo tempo contra uma dependência frágil, como um endpoint de relatório que abre uma consulta grande.
- Cortar endpoints que travam numa chamada lenta ou num lock, para que respondam 504 em vez de se acumular.
- Controlar o ritmo das suas próprias chamadas a uma API de terceiros que impõe uma cota a você.

## Deep Dive

### Dois serviços, dois middlewares

Os dois recursos fazem parte do shared framework, então um projeto web não precisa de pacote. Cada um tem um registro de serviço e um middleware, e as políticas são associadas aos endpoints:

```csharp
builder.Services.AddRateLimiter(o => o.AddFixedWindowLimiter("fixed", f => { f.PermitLimit = 3; f.Window = TimeSpan.FromSeconds(10); }));
builder.Services.AddRequestTimeouts();
var app = builder.Build();
app.UseRateLimiter();
app.UseRequestTimeouts();
app.MapGet("/", () => "ok").RequireRateLimiting("fixed");
```

Os dois middlewares leem metadados do endpoint, então precisam rodar depois do roteamento. Uma minimal app adiciona `UseRouting` no início do pipeline por você; se você chamar por conta própria, coloque os dois depois dele.

### A rejeição padrão é 503 com corpo vazio

Li o valor padrão e enviei 5 requisições concorrentes para a política acima:

```text
new RateLimiterOptions().RejectionStatusCode = 503
5 concurrent, fixed 3/10s, defaults: 200 x3, 503 x2
body length of rejected: 0, retry-after present: False
```

Isso confere com a documentação. Um 503 diz a clientes e load balancers que o servidor está indisponível, o que pode disparar failover ou retries genéricos. Para "você está chamando demais" o status certo é 429, então defina isso explicitamente.

### Escrevendo 429 e Retry-After

`RejectionStatusCode` define o status; `OnRejected` roda antes de a resposta ser enviada. O lease carrega metadados, e `MetadataName.RetryAfter` vira o header:

```csharp
o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
o.OnRejected = (ctx, ct) =>
{
    if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        ctx.HttpContext.Response.Headers.RetryAfter =
            ((long)Math.Ceiling(retryAfter.TotalSeconds)).ToString(NumberFormatInfo.InvariantInfo);
    return ValueTask.CompletedTask;
};
```

Esgotei uma política por algoritmo (2 permissões, janela ou reposição de 10 s), esperei 3 segundos e enviei mais uma requisição para cada uma:

```text
/fixed 3 s into window: 429 Retry-After=10 metadata=[RETRY_AFTER]
/sliding 3 s into window: 429 Retry-After=(none) metadata=[RETRY_AFTER]
/token 3 s into window: 429 Retry-After=10 metadata=[RETRY_AFTER]
/conc rejected: 429 Retry-After=(none) metadata=[REASON_PHRASE]
```

A janela fixa respondeu 10 segundos embora restassem cerca de 7: no 10.0.0 ela informa uma janela inteira (a documentação descreve um valor baseado na próxima fronteira só para o ASP.NET Core 11, e o pacote 10.0.14 se comportou igual num teste em console). A janela deslizante lista `RETRY_AFTER` em `MetadataNames`, mas `TryGetMetadata` devolveu false. O limitador de concorrência não tem dica nenhuma, como diz a documentação. Trate a ausência da dica como algo normal.

### Janela fixa vs janela deslizante na fronteira

Os dois limitadores permitem 4 requisições a cada 4 segundos; o deslizante tem 2 segmentos de 2 segundos. Os tempos contam a partir da primeira requisição, que é quando a janela de cada limitador começa (`AddFixedWindowLimiter` vs `AddSlidingWindowLimiter` com `SegmentsPerWindow = 2`):

```text
t= 0.0s send 1: fixed [200 x1]  sliding [200 x1]
t= 3.5s send 3: fixed [200 x3]  sliding [200 x3]
t= 4.5s send 4: fixed [200 x4]  sliding [200 x1, 429 x3]
t= 6.5s send 4: fixed [429 x4]  sliding [200 x3, 429 x1]
```

A janela fixa deixou passar 7 requisições em cerca de um segundo (de t=3.5 a t=4.5), porque o contador zera na fronteira. A janela deslizante só devolveu a permissão do segmento que expirou (a requisição de t=0), e as outras 3 quando expirou o segmento que continha a rajada de t=3.5.

### Token bucket: rajadas com teto

Um token bucket começa cheio, gasta um token por requisição e adiciona `TokensPerPeriod` a cada `ReplenishmentPeriod`, nunca acima de `TokenLimit`. Com `TokenLimit = 4`, `TokensPerPeriod = 2` e período de 1 s:

```text
t=0.0s send 6: 200 x4, 429 x2  Retry-After on 429s: 1
t=1.5s send 6: 200 x2, 429 x4  Retry-After on 429s: 1
t=5.0s send 6: 200 x4, 429 x2  Retry-After on 429s: 1
```

Depois de 3,5 segundos parado o balde tinha 4 tokens, não mais: tempo ocioso não acumula crédito acima do limite. Rajadas curtas passam e a taxa sustentada fica em 2 por segundo.

### Limitador de concorrência e a fila

O limitador de concorrência conta requisições em andamento; a permissão volta quando a resposta termina. `PermitLimit = 2`, um handler que leva 1000 ms, r1 a r5 enviadas com 100 ms de intervalo:

```text
QueueLimit 0, OldestFirst:  r1:200@1042ms  r2:200@1105ms  r3:429@206ms  r4:429@303ms  r5:429@403ms
QueueLimit 2, OldestFirst:  r1:200@1003ms  r2:200@1101ms  r3:200@2004ms  r4:200@2101ms  r5:429@401ms
QueueLimit 2, NewestFirst:  r1:200@1003ms  r2:200@1102ms  r3:429@401ms  r4:200@2102ms  r5:200@2003ms
```

Sem fila, as rejeições são imediatas. Com `QueueLimit = 2`, r3 e r4 deram certo, mas levaram cerca de 2 segundos: a fila troca rejeições por latência, e o timeout do próprio cliente pode estourar antes. Com `NewestFirst` uma fila cheia despeja quem espera há mais tempo: r3 recebeu 429 em cerca de 400 ms, no momento em que r5 chegou, e r5 foi atendida antes de r4. Os limitadores baseados em tempo aceitam as mesmas opções `QueueLimit` e `QueueProcessingOrder`.

### Limitador global, políticas nomeadas e exceções

`GlobalLimiter` roda em toda requisição; políticas nomeadas rodam onde foram associadas, com `RequireRateLimiting("name")` ou `[EnableRateLimiting("name")]`; `DisableRateLimiting()` desliga as duas coisas. Combinei um limite global de 6 a cada 30 s com uma política `"strict"` de 2 a cada 30 s e imprimi as permissões globais restantes depois de cada chamada:

```csharp
o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(_ => RateLimitPartition.GetFixedWindowLimiter("all",
    _ => new FixedWindowRateLimiterOptions { PermitLimit = 6, Window = TimeSpan.FromSeconds(30) }));
o.AddFixedWindowLimiter("strict", f => { f.PermitLimit = 2; f.Window = TimeSpan.FromSeconds(30); });

app.MapGet("/a", () => "ok").RequireRateLimiting("strict");
app.MapGet("/b", [EnableRateLimiting("strict")] () => "ok");
app.MapGet("/plain", () => "ok");
app.MapGet("/free", () => "ok").DisableRateLimiting();
```

```text
[global avail 5] [global avail 4] [global avail 2] /a x3 sequential: 200 200 429
[global avail 0] /b x1 sequential: 429
[global avail 0] [global avail 0] [global avail 0] /plain x3 sequential: 429 429 429
[global avail 0] [global avail 0] [global avail 0] /free x3 sequential: 200 200 200
```

Duas surpresas. `/b` foi rejeitado na primeira chamada: uma política criada com `AddFixedWindowLimiter` é um único balde compartilhado por todos os endpoints que a usam. E cada requisição rejeitada pela política do endpoint custou duas permissões globais. O código-fonte do middleware explica: ele tenta uma aquisição sem espera nos dois limitadores e, quando a do endpoint falha, tenta de novo pelo caminho com fila, e cada tentativa pega uma permissão global que um limitador baseado em tempo não devolve.

A ordem de `UseRateLimiter` e `UseRouting` também importa. Com `app.UseRateLimiter(); app.UseRouting();` uma política de 1 permissão respondeu `200 200 200`: nenhum erro, a política do endpoint foi ignorada em silêncio porque ainda não havia endpoint selecionado. A documentação permite essa ordem só para limitadores globais.

### Partições com chaves controladas pelo atacante

Um balde único deixa um cliente consumir o limite inteiro, então limitadores particionados mantêm um limitador por chave (usuário, API key, IP). Particionei um limite de 2 por minuto por um header `X-Api-Key` sem validação e contei as chamadas da factory:

```csharp
o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    RateLimitPartition.GetFixedWindowLimiter(ctx.Request.Headers["X-Api-Key"].ToString(),
        _ => { Interlocked.Increment(ref created); return new FixedWindowRateLimiterOptions { PermitLimit = 2, Window = TimeSpan.FromMinutes(1) }; }));
```

```text
10 requests with X-Api-Key: alice -> 200 x2, 429 x8; partitions created so far: 1
2000 requests, random X-Api-Key each -> 200 x2000; partitions created: 2001
```

O cliente honesto foi limitado; um cliente que manda um valor novo a cada requisição nunca foi limitado, e o servidor criou um limitador para cada valor. Para medir o custo, criei 100000 partições com chaves GUID direto em `PartitionedRateLimiter.Create<string, string>` e esperei sem tráfego:

```text
window 60 s: 100000 distinct keys -> +64.3 MB (674 bytes per partition)
   after 15 s with no traffic: +65.9 MB over the baseline
window 1 s:  100000 distinct keys -> +64.2 MB (672 bytes per partition)
   after 15 s with no traffic: +6.5 MB over the baseline
```

Partições ociosas só são removidas depois que as permissões voltam e elas ficam paradas por um tempo, então com janela de 1 minuto nada foi liberado. Particione pelo que o servidor confia (o usuário autenticado, uma API key validada no seu armazenamento) e coloque o tráfego anônimo em poucos baldes compartilhados. A documentação alerta para o mesmo risco de DoS, inclusive com IPs de origem falsificados.

### Atrás de um proxy, RemoteIpAddress é o proxy

Particionei por `RemoteIpAddress` com 3 permissões e enviei 6 requisições da mesma máquina, cada uma com um `X-Forwarded-For` diferente:

```text
UseForwardedHeaders=False: 200 200 200 429 429 429   partition keys seen: 127.0.0.1
UseForwardedHeaders=True:  200 200 200 200 200 200   partition keys seen: 203.0.113.1 ... 203.0.113.6
'X-Forwarded-For: 198.51.100.7, 203.0.113.50' -> RemoteIpAddress 203.0.113.50
ForwardLimit=1, KnownProxies=[::1], KnownIPNetworks=[127.0.0.0/8]
```

Sem forwarded headers, todos os clientes atrás de um proxy dividem o balde do proxy. Com `UseForwardedHeaders` (antes de `UseRateLimiter`) a chave vem do header, o que só é seguro se um proxy confiável o escreve. Os padrões confiam apenas em loopback e usam o valor mais à direita; registre seu proxy real em `KnownProxies` ou `KnownIPNetworks` e garanta que ele sobrescreve o que o cliente enviou.

### Métricas

O middleware publica no meter `Microsoft.AspNetCore.RateLimiting`. Escutei com um `MeterListener` enquanto enviava 5 requisições a uma política fixa de 3 permissões e 3 concorrentes a uma política de concorrência (1 permissão, fila 1):

```text
instrument aspnetcore.rate_limiting.active_request_leases: UpDownCounter ({request})
instrument aspnetcore.rate_limiting.queued_requests: UpDownCounter ({request})
instrument aspnetcore.rate_limiting.request_lease.duration: Histogram (s)
instrument aspnetcore.rate_limiting.request.time_in_queue: Histogram (s)
instrument aspnetcore.rate_limiting.requests: Counter ({request})
aspnetcore.rate_limiting.requests result=acquired policy=fixed: 3
aspnetcore.rate_limiting.requests result=endpoint_limiter policy=fixed: 2
aspnetcore.rate_limiting.requests result=acquired policy=conc: 2
aspnetcore.rate_limiting.requests result=endpoint_limiter policy=conc: 1
```

A tag `aspnetcore.rate_limiting.result` separa rejeições do endpoint das globais (`global_limiter`), e é nela que você cria alertas. Exporte com `.AddMeter("Microsoft.AspNetCore.RateLimiting")`.

### Request timeouts: o que o cliente vê

O middleware de timeout não faz nada até um timeout ser configurado. Defini um padrão de 1 s e alguns ajustes por endpoint:

```csharp
builder.Services.AddRequestTimeouts(o =>
{
    o.DefaultPolicy = new RequestTimeoutPolicy { Timeout = TimeSpan.FromSeconds(1) };
    o.AddPolicy("short", TimeSpan.FromMilliseconds(500));
    o.AddPolicy("custom", new RequestTimeoutPolicy { Timeout = TimeSpan.FromMilliseconds(500), TimeoutStatusCode = 503,
        WriteTimeoutResponse = ctx => ctx.Response.WriteAsync("took too long") });
});
app.MapGet("/coop", async (HttpContext ctx) => { await Task.Delay(5000, ctx.RequestAborted); return "done"; });
app.MapGet("/attr", [RequestTimeout(500)] async (HttpContext ctx) => { /* same body */ });
app.MapGet("/named", ...).WithRequestTimeout("short");     // "/custom" uses "custom"
app.MapGet("/off", ...).DisableRequestTimeout();            // 1500 ms body
```

```text
new RequestTimeoutPolicy().TimeoutStatusCode = null
/coop           -> 504 after 1048 ms, body:
/attr           -> 504 after 501 ms, body:
/named          -> 504 after 501 ms, body:
/custom         -> 503 after 501 ms, body: took too long
/off            -> 200 after 1502 ms, body: done
/cancelfeature  -> 200 after 1503 ms, body: done
```

Quando o token disparou, `Task.Delay` lançou `OperationCanceledException`, o middleware capturou a exceção e, com `TimeoutStatusCode` nulo, escreveu 504 com corpo vazio, como descreve a documentação. `/cancelfeature` chamou `ctx.Features.Get<IHttpRequestTimeoutFeature>()?.DisableTimeout()` no início, o que cancela o timeout em andamento. A documentação acrescenta que o middleware não dispara com um debugger anexado; rodei sem debugger, então teste timeouts com `dotnet run`, não com F5. E com `WithRequestTimeout(TimeSpan.FromMilliseconds(300))` mas sem `UseRequestTimeouts()`, a requisição recebeu `200 after 1503 ms`: configuração sem o middleware é ignorada em silêncio.

### Um handler que ignora o token continua rodando

O timeout cancela um token. Ele não aborta a requisição nem para o seu código:

```csharp
app.MapGet("/ignore", async () => { await Task.Delay(3000); return "done anyway"; });
app.MapGet("/catch", async (HttpContext ctx) =>
{
    try { await Task.Delay(5000, ctx.RequestAborted); return Results.Ok("done"); }
    catch (OperationCanceledException) { return Results.Ok("partial result"); }
});
```

```text
/ignore         -> 200 after 3007 ms, body: done anyway
/catch          -> 200 after 1020 ms, body: "partial result"
/ignore handler finished after 3002 ms, RequestAborted.IsCancellationRequested=True
```

`/ignore` estourou o orçamento de 1 s, rodou 3 segundos e respondeu 200 com o token já cancelado. Um handler que captura o cancelamento decide a resposta sozinho. Passe `RequestAborted` (ou um parâmetro `CancellationToken`) para o EF Core, o `HttpClient` e toda chamada aguardável, senão o timeout é só enfeite.

### Não é o mesmo que limites do Kestrel ou HttpClient.Timeout

```text
KeepAliveTimeout=00:02:10, RequestHeadersTimeout=00:00:30, MinRequestBodyDataRate=240 B/s grace 00:00:05, MaxConcurrentConnections=null
HttpClient.Timeout 500 ms on /off: TaskCanceledException: The request was canceled due to the configured HttpClient.Timeout of 0.5 seconds elapsing.
server saw RequestAborted after 499 ms
```

Os limites do Kestrel (primeira linha, os padrões de `KestrelServerLimits`) protegem a conexão: keep-alive ocioso, headers lentos, corpos lentos. Eles não limitam quanto tempo um handler roda. Request timeouts são por endpoint e tratam do seu handler. `HttpClient.Timeout` fica do lado de quem chama (segunda linha); numa execução separada contra um handler que aguardava `Task.Delay(5000, ctx.RequestAborted)` sem request timeout, o cliente desistiu em 500 ms e o Kestrel cancelou `RequestAborted` em cerca de 500 ms (terceira linha), porque a conexão foi fechada. Timeouts e retries de chamadas de saída estão no conceito de resiliência.

### Rate limiting das suas próprias chamadas de saída

`System.Threading.RateLimiting` não depende do ASP.NET Core, mas num projeto console simples o namespace não existia (`error CS0234`) até eu adicionar o pacote; projetos web recebem do shared framework. Usei o padrão de `DelegatingHandler` do lado do cliente da documentação (`await limiter.AcquireAsync(1, ct)`, encaminhar a requisição se `lease.IsAcquired`, senão devolver um 429 local) com um `TokenBucketRateLimiter` de 4 tokens, `QueueLimit = 0` e um handler interno que conta o que chegaria à rede:

```text
10 calls: 200 x4, 429(Retry-After 1s) x6; reached the inner handler: 4
```

Seis chamadas nunca saíram do processo. Com `QueueLimit` diferente de zero elas esperariam, o que costuma ser o desejado diante de uma cota de terceiros.

## Trade-offs

- **Escolha o status code de propósito.** O 503 padrão com corpo vazio diz "servidor fora do ar", e clientes e gateways tratam isso de forma diferente de um 429.
  ```csharp
  o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
  ```
- **Retry-After é uma dica, não uma promessa.** No 10.0.0 a janela fixa informa uma janela inteira e a janela deslizante e o limitador de concorrência não informam nada, então clientes precisam do próprio backoff com teto e jitter.
- **Janelas fixas permitem rajadas dobradas.** Medido: 7 requisições em cerca de um segundo com "4 a cada 4 s". Use janela deslizante ou token bucket quando isso importa.
- **Filas trocam rejeições por latência.** Cada requisição na fila esperou uma duração inteira de handler a mais; mantenha `QueueLimit` pequeno e abaixo do timeout do cliente.
- **Chave de partição é decisão de segurança.** Headers sem validação ou IPs falsificáveis dão ao atacante partições ilimitadas (cerca de 670 bytes cada) e nenhum limite.
  ```csharp
  var key = await apiKeys.IsValidAsync(header) ? header : "anonymous";   // unknown keys share one bucket
  ```
- **Os limites são por instância.** A documentação diz que os contadores ficam em memória, então 3 instâncias com 100 por minuto permitem até 300. Um limite compartilhado precisa de um gateway ou de um limitador com armazenamento compartilhado.
- **Global mais endpoint custa mais do que parece.** Cada rejeição do endpoint levou duas permissões globais no meu teste, e uma política nomeada é um único balde para todos os seus endpoints.
- **Request timeout é cooperativo.** Ele só escreve 504 se o seu código observa o token; código que ignora o token roda até o fim e responde 200.

## Documentation Links

- [Rate limiting middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit?view=aspnetcore-10.0) (doc)
- [Request timeouts middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/timeouts?view=aspnetcore-10.0) (doc)
- [Rate limit an HTTP handler in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/http-ratelimiter) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0) (doc)
- [Announcing Rate Limiting for .NET, .NET Blog](https://devblogs.microsoft.com/dotnet/announcing-rate-limiting-for-dotnet/) (doc)
