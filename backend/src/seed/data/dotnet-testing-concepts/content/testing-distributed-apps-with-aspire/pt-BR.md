---
version: 1.0
updatedAt: 2026-10-29
title: "Testando aplicações distribuídas com Aspire"
summary: Suba o AppHost real num teste MSTest com DistributedApplicationTestingBuilder, espere saúde com timeout, falhe em cerca de um segundo quando um serviço cai, sobrescreva configuração, leia logs de um recurso e compare custo e escopo com WebApplicationFactory.
---
## Objective

Uma solução Aspire são vários processos, e os bugs moram entre eles: uma
referência errada, uma variável faltando, uma dependência que nunca fica
saudável. `DistributedApplicationTestingBuilder` (`Aspire.Hosting.Testing`)
roda o AppHost real num teste, cada recurso num processo com portas
aleatórias. O objetivo: um teste MSTest caixa-preta do `web` chamando o `api`
pelo nome, um timeout que falha em cerca de um segundo, overrides que chegam,
uma asserção sobre um log e uma escolha medida entre um app por classe ou por
teste. Versões: SDK 10.0.100, Aspire 13.6.4, `MSTest.Sdk` 4.5.2 no
Microsoft.Testing.Platform e `Microsoft.AspNetCore.Mvc.Testing` 10.0.14 na
comparação. Sem daemon do Docker, só recursos de projeto rodaram.

## Use Cases

- Provar que o frontend chega à API pelo service discovery.
- Fazer o CI falhar em cerca de um segundo, com o stderr, quando um serviço cai.
- Rodar o sistema inteiro com outra configuração ou uma dependência quebrada.
- Combinar poucos testes ponta a ponta com testes rápidos de `WebApplicationFactory`.

## Deep Dive

### O app e o primeiro teste

O AppHost declara dois projetos, cada um com um health check HTTP:

```csharp
var api = builder.AddProject<Projects.Shop_Api>("api")
    .WithEnvironment("Greeting", builder.Configuration["Greeting"] ?? "hello")
    .WithHttpHealthCheck("/health");

builder.AddProject<Projects.Shop_Web>("web")
    .WithReference(api).WaitFor(api).WithHttpHealthCheck("/health");
```

O `/call` do `web` chama `http://api/hello`. O projeto de teste é
`MSTest.Sdk/4.5.2` com `Aspire.Hosting.Testing` 13.6.4 e `ProjectReference`
para o AppHost, rodado pelo `dotnet test` em modo MTP (`global.json`). O
template `aspire-mstest` da documentação ainda usa MSTest 3.10.2.

```csharp
using var cts = CancellationTokenSource.CreateLinkedTokenSource(TestContext.CancellationToken);
cts.CancelAfter(TimeSpan.FromSeconds(30));
var token = cts.Token;
var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Shop_AppHost>([], token);
builder.Services.ConfigureHttpClientDefaults(http => http.AddStandardResilienceHandler());
await using var app = await builder.BuildAsync(token);
await app.StartAsync(token);
await app.ResourceNotifications.WaitForResourceHealthyAsync("api", token);
await app.ResourceNotifications.WaitForResourceAsync("web", KnownResourceStates.Running, token);

using var web = app.CreateHttpClient("web");
StringAssert.Contains(await web.GetStringAsync("/call", token), "\"from\":\"api\"");
```

```text
started after 1838 ms
api healthy, web running after 1846 ms
api endpoint http://localhost:61998/   web endpoint http://localhost:61999/
{"from":"api","greeting":"hello","pid":27127,"env":"Development"}
done after 2479 ms
passed WebReachesApiThroughServiceDiscovery (15s 773ms)
```

O DCP subiu cada serviço com `dotnet run --project ... --no-build
--no-launch-profile`, e a saída deles caiu na saída do teste. O `web` registrou
`GET http://api/hello` enviado como `GET http://localhost:61998/hello`; o
cliente do teste, uma tentativa `0` do `-standard//Standard-Retry`. O teste
passou também sem o `launchSettings.json` do AppHost (sem
`ASPIRE_ALLOW_UNSECURED_TRANSPORT`).

Running não é pronto. O `StartAsync` só retornou com o `api` saudável, porque
o `web` tem `WaitFor(api)` (`Finished waiting for resource 'api'` veio antes
de `Distributed application started`). `WaitForResourceAsync("web", Running)`
retornou 8 ms depois, cerca de meio segundo antes de o `web` registrar
`Now listening on`; a primeira requisição levou 627 ms. Como diz a
documentação, `Running` é processo iniciado; saúde é pronto. Um recurso sem
health checks conta como saudável ao ficar `Running` (XML docs).

### Portas aleatórias, e duas execuções ao mesmo tempo

Os endpoints que o teste vê são proxies do DCP; os processos atrás deles
pegaram outras portas aleatórias (`ASPNETCORE_URLS` do `web`:
`http://localhost:30801`). Duas execuções de `dotnet test` juntas passaram em
cerca de 15,9 s, a A em 53244/53245, a B em 53238/53239. Com o argumento
`"DcpPublisher:RandomizePorts=false"` da documentação, as duas pegaram as
portas do `launchSettings.json` (5174, 5062); a segunda registrou
`Request to http://localhost:5062/health timed out` e só ficou saudável em
cerca de 11,9 s, não 2,3 s.

### Sobrescrevendo configuração: o que chega

Cada variante removeu o `web` e leu `/hello` do `api`:

| Override no teste | O `api` viu |
| --- | --- |
| `CreateAsync<...>(["Greeting=from-args"])` | `"greeting":"from-args"` |
| `CreateAsync<...>(["--Greeting=from-dashdash"])` | `"greeting":"from-dashdash"` |
| `builder.Configuration["Greeting"] = "..."` depois do `CreateAsync` | `"greeting":"hello"` (ignorado) |
| `builder.CreateResourceBuilder<ProjectResource>("api").WithEnvironment("Greeting", "from-withenv")` | `"greeting":"from-withenv"` |
| `["--environment=Testing"]` | AppHost em `Testing`, `api` ainda `"env":"Development"` |

Argumentos são configuração do AppHost, e o `AppHost.cs` já rodou quando o
`CreateAsync` retorna. Para atingir um serviço, `WithEnvironment` no resource
builder dele venceu. O ambiente do AppHost não é o ambiente dos serviços.

### Removendo um recurso, e o dashboard

`builder.Resources.Remove(builder.Resources.Single(r => r.Name == "web"))`
subiu o `api` sozinho (o modelo também listava os recursos ocultos
`api-rebuilder` e `web-rebuilder`). Remover o `api` deixou o `web` registrando
`Waiting for resource 'api' to enter the 'Running' state.` até o `StartAsync`
lançar `TaskCanceledException` no token de 30 s. A documentação avisa: não há
troca via DI; as alavancas são o modelo, os argumentos e as variáveis.

O dashboard vem desligado: `app.GetDashboardUrlAsync()` lançou
`InvalidOperationException: The dashboard is not enabled for this
application.` Passar `(options, _) => options.DisableDashboard = false` ao
`CreateAsync` devolveu `http://localhost:65130/login?t=8568...` e subiu um
processo `Aspire.Dashboard`. Reflection mostra também
`DistributedApplicationTestingBuilderOptions.EnableDashboard` (não executado);
a interface do dashboard não foi aberta.

### Lendo estado e logs no teste

```csharp
app.ResourceNotifications.TryGetCurrentState("api", out var evt);
// api state=Running health=Healthy reports=api_http_/health_200_check:Healthy

var logs = app.Services.GetRequiredService<ResourceLoggerService>();
LogLine? served = null;
await foreach (var batch in logs.WatchAsync(evt!.ResourceId).WithCancellation(token))
{
    served = batch.Where(l => l.Content.Contains("Served hello from pid"))
                  .Select(l => (LogLine?)l).FirstOrDefault();
    if (served is not null) break;
}
Assert.IsNotNull(served);
// line 11: 2026-10-29T20:46:37.7900000Z       Served hello from pid 59953
```

Duas armadilhas. `WatchAsync("api")` não trouxe nada em 5 s; os logs são
indexados pelo id da réplica (`api-ayrbxpwr`), que entregou a linha em cerca de
80 ms. E `LogLine` é uma struct: um `FirstOrDefault()` simples nunca é `null`.

### Timeouts e falhar rápido

Com `WithEnvironment("Api__Broken", "true")` o health check da API reporta
Unhealthy. O `StartAsync` rodou em segundo plano (ele bloqueia no `WaitFor`) e
o teste esperou com um token de 30 s:

```text
[30161 ms] System.OperationCanceledException: Resource 'api' failed to become healthy before the operation was cancelled.
[30161 ms] api state=Running health=Unhealthy api_http_/health_200_check:Unhealthy
[30161 ms] web state=Waiting
[30161 ms] StartAsync: System.Threading.Tasks.TaskCanceledException: A task was canceled.
```

A documentação recomenda timeout em toda espera para o teste não travar; uma
dependência presa custa o token inteiro. Com `Api__CrashOnStart=true` a API
lança exceção na subida. Aguardar o `StartAsync` antes, como o template faz,
custou os 30 s (o `web` fica `Waiting`), mesmo com `DefaultWaitBehavior` em
`StopOnResourceUnavailable` nas `ResourceNotificationServiceOptions`. Correr a
subida contra uma espera que para na falha levou cerca de um segundo:

```csharp
var start = app.StartAsync(token);   // aguardado depois, no caminho feliz
await app.ResourceNotifications.WaitForResourceHealthyAsync(
    "api", WaitBehavior.StopOnResourceUnavailable, token);
```

```text
[1134 ms] Aspire.Hosting.DistributedApplicationException: Stopped waiting for resource 'api' to become healthy because it failed to start.
[1134 ms] api state=Finished exit=134
[1138 ms] log 0 err=True: ... Unhandled exception. System.InvalidOperationException: Api:CrashOnStart is set, refusing to start.
[2371 ms] disposed; start task status: Canceled
```

`ResourceLoggerService.GetAllAsync(id)` devolveu essa linha do stderr para a
mensagem de falha. Os XML docs explicam o padrão (`WaitOnResourceUnavailable`):
a espera continua caso o recurso reinicie.

### Um app por classe, ou um por teste

Cinco testes chamando `/call`, três execuções de cada, levaram 16,3, 16,7 e
15,9 s com um app do `[ClassInitialize]`, e 74,6, 77,4 e 74,4 s com um app
novo por teste. A subida não era o custo (cerca de 1,5 s até o `StartAsync`,
2,2 s até saudável); o `StopAsync` levou cerca de 13 s em toda execução. Com
debug ligado, o DCP reportou `Could not stop the Executable` com
`"timed out waiting for process to stop"` para o `api` antes de terminar.
Compartilhar é o padrão `[ClassInitialize]`/`[ClassCleanup]` da documentação.

### Limpeza, exit codes e containers

Após cada execução um `dcp run-controllers` ficou visível por cerca de 1 s;
depois `pgrep -fl 'dcp|Shop\.|Aspire.Dashboard'` não imprimiu nada e o `lsof`
não mostrou porta escutando. Execuções verdes saíram com 0; um teste falho
deu `Exit code: 2`. Containers não rodaram. Para `AddRedis("cache")`, a
documentação diz que `app.GetConnectionStringAsync("cache")` deixa o teste
conferir dados direto, e que descartar o app limpa os containers.

### Testes com Aspire vs WebApplicationFactory

| | `DistributedApplicationTestingBuilder` | `WebApplicationFactory<Program>` |
| --- | --- | --- |
| Escopo | o modelo inteiro do AppHost | um app ASP.NET Core |
| Processos | AppHost no teste, DCP e um por recurso | só o processo de teste |
| Rede | sockets reais, proxies do DCP, portas aleatórias | `TestServer` em memória |
| Mudar comportamento | args, variáveis, edição do modelo; sem acesso à DI | `ConfigureTestServices`, fakes |
| Containers | sim, com um runtime de containers (não executado) | não (use Testcontainers) |
| 5 testes, host compartilhado | cerca de 16 s | cerca de 0,8 a 1 s |
| 5 testes, host por teste | cerca de 75 s | cerca de 1 a 1,2 s |

## Trade-offs

- **Realismo custa segundos por app.** Cerca de 15 s cada aqui, quase tudo no
  desligamento. Fiação com Aspire, regras com `WebApplicationFactory`.
- **Toda espera precisa de token, e a ordem importa.** O `StartAsync` bloqueia
  no `WaitFor`, então uma dependência que caiu custa o timeout inteiro, a não
  ser que o teste corra contra ela com `StopOnResourceUnavailable`.
- **Apps compartilhados compartilham estado.** Um app por classe foi cerca de
  4,6 vezes mais rápido, e cada teste vê o que os anteriores gravaram.
- **Containers precisam de runtime no CI.** `AddRedis` ou `AddPostgres`
  exigem Docker ou Podman; um modelo só com projetos rodou sem nenhum.

## Documentation Links

- [Testing overview, aspire.dev](https://aspire.dev/testing/overview/) (doc)
- [Write your first test, aspire.dev](https://aspire.dev/testing/write-your-first-test/) (doc)
- [Manage the AppHost in tests, aspire.dev](https://aspire.dev/testing/manage-app-host/) (doc)
- [Access resources in tests, aspire.dev](https://aspire.dev/testing/accessing-resources/) (doc)
- [Testing in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
