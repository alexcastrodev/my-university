---
version: 1.0
updatedAt: 2026-10-28
title: "Health checks: liveness e readiness"
summary: Health checks no ASP.NET Core para Kubernetes e Container Apps: códigos de status, IHealthCheck, tags para liveness, readiness e startup, timeouts de checks travados, o check de DbContext do EF Core, o relatório JSON que não deve ser público e o erro de colocar dependências no liveness, com o que cada experimento realmente devolveu.
---
## Objective

Um orquestrador (Kubernetes, Azure Container Apps, um load balancer) não lê seus logs: ele chama uma URL a cada poucos segundos e age pelo código de status HTTP. Um 503 no endpoint errado tira uma réplica saudável de rotação ou, pior, reinicia todas as réplicas de uma vez. O ASP.NET Core traz as peças no shared framework: `AddHealthChecks()` registra checks, `MapHealthChecks` os expõe, tags e um `Predicate` os separam em endpoints de liveness, readiness e startup, e `Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore` adiciona um check de `DbContext`. Este conceito roda tudo isso num app Kestrel real e mostra o que voltou: códigos de status e corpos para cada estado, o que vira uma exceção dentro de um check, quanto tempo um check travado realmente segura a probe, o que o check do EF Core diz quando o banco não existe e por que um check de dependência na probe de liveness é uma armadilha. Versões usadas: SDK 10.0.100 (runtime do ASP.NET Core 10.0.0, que contém o middleware de health checks), `Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore` 10.0.14, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14.

## Use Cases

- Avisar ao Kubernetes ou ao Container Apps quando uma réplica terminou de subir e pode receber tráfego.
- Tirar uma instância do load balancer enquanto uma dependência sem a qual ela não funciona está fora do ar, sem reiniciá-la.
- Reiniciar um processo em deadlock ou sem recursos, e apenas isso.
- Alimentar um dashboard ou um sistema de alertas com um relatório de saúde periódico e detalhado que não fica exposto à internet.

## Deep Dive

### A configuração mínima e a resposta padrão

Duas linhas (`builder.Services.AddHealthChecks();` e `app.MapHealthChecks("/healthz");`). Sem nenhum check registrado, o app está saudável enquanto conseguir responder.

Chamei um endpoint de health com `curl -s -i`. O writer padrão envia o nome do status como texto puro e adiciona por conta própria cabeçalhos contra cache:

```text
HTTP/1.1 200 OK
Content-Type: text/plain
Cache-Control: no-store, no-cache
Expires: Thu, 01 Jan 1970 00:00:00 GMT
Pragma: no-cache

Healthy
```

A documentação diz que esses cabeçalhos são controlados por `AllowCachingResponses` (padrão `false`), então um proxy não vai servir um "Healthy" velho. A documentação também enfatiza que os checks não rodam num timer: cada requisição ao endpoint executa todos os checks que ele inclui.

### Códigos de status: Degraded continua sendo 200

Li os padrões de um `HealthCheckOptions` e de um `HealthCheckRegistration` recém-criados:

```text
ResultStatusCodes: Healthy=200, Degraded=200, Unhealthy=503
AllowCachingResponses=False, Predicate null=True
Registration Timeout=-00:00:00.0010000, FailureStatus=Unhealthy
```

O status geral é o pior entre as entradas. Um check que devolveu `Degraded` gerou `200 Degraded`, então um orquestrador que só olha o código continua mandando tráfego. Se degradado deve significar "fora de rotação" naquele endpoint, refaça o mapeamento:

```csharp
app.MapHealthChecks("/health/payments-strict", new()
{
    Predicate = r => r.Tags.Contains("toggle"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status503ServiceUnavailable,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable,
    }
});
```

```text
state degraded:  /health/payments -> 200 Degraded   /health/payments-strict -> 503 Degraded
state unhealthy: /health/payments -> 503 Unhealthy  /health/payments-strict -> 503 Unhealthy
```

### Escrevendo um IHealthCheck

Um check devolve um `HealthCheckResult` com status, descrição opcional, dados opcionais e exceção opcional. Meu check chama uma API de pagamentos downstream, com o comportamento trocado em tempo de execução:

```csharp
class ToggleCheck(IHttpClientFactory http) : IHealthCheck
{
    public static volatile string State = "healthy";   // set by a test endpoint

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var data = new Dictionary<string, object> { ["queueDepth"] = 12 };
        switch (State)
        {
            case "degraded": return HealthCheckResult.Degraded("p95 latency 900 ms", data: data);
            case "unhealthy": return HealthCheckResult.Unhealthy("payments API returned 500");
            case "failure": return new HealthCheckResult(context.Registration.FailureStatus, "payments API returned 500");
            case "throw": await http.CreateClient().GetAsync("http://localhost:5639/ping", ct); break; // nothing listens there
        }
        return HealthCheckResult.Healthy("payments API reachable", data);
    }
}
```

Registrei a mesma classe duas vezes, a segunda com `failureStatus: HealthStatus.Degraded`, e li as entradas por um writer JSON (mostrado mais adiante):

```text
state unhealthy: payments-api=Unhealthy  payments-api-degraded-on-failure=Unhealthy
state failure:   payments-api=Unhealthy  payments-api-degraded-on-failure=Degraded
state throw:     payments-api=Unhealthy  payments-api-degraded-on-failure=Degraded
                 description "Connection refused (localhost:5639)", exception HttpRequestException
```

Três regras saíram disso. `failureStatus` não sobrescreve um `HealthCheckResult.Unhealthy(...)` explícito: ele só é usado quando o check devolve `context.Registration.FailureStatus` ou lança exceção, o que confere com a documentação. Uma exceção não derruba o endpoint: vira uma entrada com a mensagem da exceção como descrição, e o log recebe uma linha `fail` com a stack trace completa (`Health check payments-api threw an unhandled exception after 19.8827ms`). E um resultado `Unhealthy` também é logado em nível de erro (`Health check startup with status Unhealthy completed after 0.3733ms`), uma vez por probe, então uma probe falhando a cada 5 segundos é barulhenta por natureza.

### Liveness, readiness e startup com tags

Tags no registro mais um `Predicate` por endpoint dão a cada probe o seu próprio conjunto de checks:

```csharp
builder.Services.AddHealthChecks()
    .AddCheck<StartupCheck>("startup", tags: ["startup", "ready"])
    .AddDbContextCheck<AppDb>(tags: ["ready", "db"])
    .AddCheck<ToggleCheck>("payments-api", tags: ["toggle"]);

app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/startup", new() { Predicate = r => r.Tags.Contains("startup") });
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") || r.Tags.Contains("toggle") });
```

`Predicate = _ => false` não executa check nenhum: liveness passa a significar "o processo responde HTTP". O check de startup lê uma flag que um `BackgroundService` liga depois de 8 segundos de aquecimento simulado. Chamei logo após subir o app e de novo depois que a flag mudou:

```text
t~0 s  /health/startup -> 503 Unhealthy   /health/ready -> 503 (startup: "startup work still running")
t~0 s  /health/live    -> 200 Healthy
t>8 s  /health/startup -> 200 Healthy     /health/ready -> 200 Healthy
```

Cada endpoint respondeu a uma pergunta diferente, e o processo esteve vivo o tempo todo.

### O erro clássico: dependências na probe de liveness

Adicionei um segundo endpoint de liveness que também inclui o check de pagamentos, do jeito que muitos apps fazem, e derrubei a dependência:

```text
state=throw (payments API down)
GET /               -> 200 ok
/health/live        -> 200 Healthy
/health/live-wrong  -> 503 Unhealthy
/health/ready       -> 503 (payments-api: "Connection refused (localhost:5639)")
```

O processo estava bem e continuava servindo as rotas que não precisam de pagamentos. O Kubernetes reinicia um container quando a liveness falha `failureThreshold` vezes seguidas (padrões: a cada 10 s, 3 falhas, ou seja, uns 30 s). Todas as réplicas chamam a mesma API de pagamentos, então todas falham em `/health/live-wrong` na mesma janela de 30 s e são reiniciadas juntas. Reiniciar não conserta a API de pagamentos, então elas voltam, falham de novo e entram em `CrashLoopBackOff`, enquanto as partidas a frio somam carga própria. Cada reinício ainda paga de novo o custo de startup (8 s de aquecimento neste app). A versão de readiness do mesmo check só tira o pod dos endpoints do Service e o devolve quando a dependência se recupera, sem reinício. Regra: liveness verifica só o que um reinício consegue consertar (o próprio processo); dependências vão para readiness, e mesmo ali só aquelas sem as quais a instância é inútil.

### Checks lentos e timeouts

O timeout do registro é opcional. O padrão que li acima é `InfiniteTimeSpan` (`-00:00:00.0010000`), não 30 s: o valor de 30 s da documentação é `HealthCheckPublisherOptions.Timeout`, que vale só para o publisher. Medi quatro casos (o `--max-time` do curl limita o lado do cliente):

```csharp
.AddCheck("hang", new HangCheck(honorToken: true))                                    // await Task.Delay(Infinite, ct)
.AddCheck("hang-2s", new HangCheck(honorToken: true), timeout: TimeSpan.FromSeconds(2))
.AddCheck("stubborn-2s", new HangCheck(honorToken: false), timeout: TimeSpan.FromSeconds(2)) // ignores ct, 6 s
```

```text
/health/hang     (no timeout)       -> no response, curl gave up at 35.004853s
/healthz         (no Predicate)     -> no response, curl gave up at 35.002022s
/health/hang2    (2 s, honors ct)   -> 503 in 2.004987s, "A timeout occurred while running check.", TaskCanceledException
/health/stubborn (2 s, ignores ct)  -> 200 in 6.004133s, Healthy "finished"
```

Sem timeout, a probe fica pendurada enquanto o check durar, e um único check travado bloqueia o `/healthz` inteiro que o inclui. O timeout só funciona pelo `CancellationToken`: um check que ignora o token roda até o fim, e o resultado atrasado ainda é reportado como `Healthy`. Mais duas medições: quando o cliente desconecta, o middleware cancela os checks (duas probes em andamento mostraram `hanging checks in flight: 2`, e o contador voltou a 0 depois que o curl desistiu), e os checks de um endpoint rodam em paralelo (três checks de 1 s cada responderam em 1.004591s). Configure um timeout menor que o timeout da própria probe (o padrão do Kubernetes é 1 s) e sempre repasse o `ct`.

### AddDbContextCheck com EF Core

O check de `DbContext` chama `Database.CanConnectAsync()` e recebe o nome do tipo do contexto. Com SQLite, três bancos:

```csharp
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(cs));
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDb>(tags: ["ready", "db"])
    .AddDbContextCheck<AppDb>("db-query", customTestQuery: async (db, ct) =>
    {
        await db.Database.ExecuteSqlRawAsync("SELECT count(*) FROM sqlite_master", ct);
        return true;
    });
```

```text
Data Source=app.db (file absent):        AppDb Healthy, and a 0-byte app.db was created on disk
Data Source=/nonexistent-dir/app.db:     AppDb Unhealthy, description null, exception null (57 ms)
                                         db-query Unhealthy, "SQLite Error 14: 'unable to open database file'.", SqliteException
```

O check padrão reportou um banco inexistente como saudável porque abrir a conexão criou um arquivo vazio; ele prova que a conexão abre, não que o schema existe. Quando falha, não dá motivo nenhum, porque `CanConnectAsync` devolve `false` em vez de lançar exceção. Uma query customizada traz a exceção real à tona. Com um banco servidor, a documentação recomenda uma query barata como `SELECT 1`, ou só a conexão, porque uma query pesada a cada probe carrega o banco. O check de SQL Server que a documentação mostra vem do `AspNetCore.HealthChecks.SqlServer`, um pacote de terceiros que a Microsoft não mantém.

### O relatório JSON, e por que ele deve ficar privado

`ResponseWriter` substitui o corpo em texto puro:

```csharp
static Task WriteJson(HttpContext ctx, HealthReport report)
{
    ctx.Response.ContentType = "application/json; charset=utf-8";
    return ctx.Response.WriteAsync(JsonSerializer.Serialize(new
    {
        status = report.Status.ToString(),
        checks = report.Entries.Select(e => new { name = e.Key, status = e.Value.Status.ToString(),
            description = e.Value.Description, exception = e.Value.Exception?.GetType().Name, data = e.Value.Data })
    }));
}
```

```text
503 {"status":"Unhealthy","totalMs":2,"checks":[{"name":"payments-api","status":"Unhealthy","description":"Connection refused (localhost:5639)","durationMs":1,"exception":"HttpRequestException","data":{}}, ...]}
```

Esse corpo revela um host e uma porta internos, as bibliotecas em uso e, com outros checks, detalhes de conexão e tamanhos de fila. É reconhecimento de terreno para um atacante e um endpoint sem autenticação que faz trabalho real sob demanda. Mantenha as probes públicas só com o status, e coloque o relatório detalhado atrás de `RequireAuthorization()` ou numa porta separada com `RequireHost`:

```csharp
app.MapHealthChecks("/health/private", new() { ResponseWriter = WriteJson }).RequireHost("*:5632");
```

```text
GET localhost:5631/health/private                         -> 404 Not Found
GET localhost:5632/health/private                         -> 200 {"status":"Healthy",...}
GET localhost:5631/health/private, Host: localhost:5632   -> 200
```

A última linha é a pegadinha: `RequireHost` compara o cabeçalho `Host`, que o cliente controla. A documentação alerta para esse spoofing e recomenda adicionar `RequireAuthorization` ou não expor essa porta fora do cluster.

### Toda probe executa todos os checks

Contei as execuções do check de pagamentos e depois mandei 100 requisições ao endpoint dele:

```text
before: payments-api ran 3 times
after 100 probes: payments-api ran 103 times
```

Não existe cache. Dez pods, três tipos de probe, uma probe a cada 5 segundos e algumas ferramentas de monitoramento somam um fluxo constante de chamadas a cada dependência que os checks tocam. Mantenha cada check barato (um ping, não uma query), deixe a liveness sem I/O e torne os endpoints de health inalcançáveis pela internet, para que ninguém os transforme num gerador de carga. Quando você precisa de resultados periódicos, um publisher executa os checks em segundo plano. Configurei `Delay = 2 s`, `Period = 5 s` (padrões lidos: `Delay=00:00:05, Period=00:00:30, Timeout=00:00:30`):

```text
publish at t=2.3s status=Healthy entries=1
publish at t=7.2s status=Healthy entries=1
publish at t=12.2s status=Healthy entries=1
```

### Mapeando para o orquestrador

No Kubernetes, `startupProbe` aponta para `/health/startup`, `livenessProbe` para `/health/live` e `readinessProbe` para `/health/ready`; enquanto a probe de startup não tiver sucesso, as outras duas não rodam. O Azure Container Apps tem os mesmos três tipos de probe. A documentação dele diz que, quando o ingress está habilitado e você não define probes, o portal adiciona probes TCP na porta de destino (startup a cada 1 s com limite de 240 falhas, readiness a cada 5 s com 48), que só provam que a porta está aberta. Defina probes HTTP apontando para os seus endpoints para ter o comportamento mostrado acima.

## Trade-offs

- **A liveness deve ser quase vazia.** Cada dependência que você adiciona a ela transforma uma queda dessa dependência num reinício de todas as réplicas.
  ```csharp
  app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
  ```
- **Readiness é uma decisão por dependência.** Se o app ainda consegue atender requisições úteis sem uma dependência (cache, API opcional), deixe essa dependência fora da readiness também, ou reporte-a como `Degraded`, que continua 200 por padrão.
- **Timeouts só funcionam se o check colaborar.** O padrão é infinito, e um check que ignora o token sobrevive ao timeout e reporta `Healthy` com atraso.
  ```csharp
  .AddCheck<PaymentsCheck>("payments", tags: ["ready"], timeout: TimeSpan.FromMilliseconds(800))
  ```
- **O check do EF Core é raso.** Ele prova que uma conexão abre, não que o schema ou os dados estão certos, e não informa motivo na falha; uma query customizada adiciona detalhe e adiciona carga.
- **Detalhes ajudam tanto o operador quanto o atacante.** Status simples nas probes, JSON só com autorização ou numa porta interna, e lembre que `RequireHost` sozinho pode ser forjado.
- **Health checks não são monitoramento.** Eles respondem "mande tráfego para cá ou não" a cada poucos segundos; tendências, latência e taxa de erro são assunto de métricas e traces.

## Documentation Links

- [Health checks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks?view=aspnetcore-10.0) (doc)
- [Health probes in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/health-probes) (doc)
- [.NET on Azure Container Apps overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/dotnet-overview) (doc)
- [Health monitoring, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/implement-resilient-applications/monitor-app-health) (doc)
