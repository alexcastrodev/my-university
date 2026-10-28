---
version: 1.0
updatedAt: 2026-10-28
title: "Aspire: AppHost, ServiceDefaults e deployment"
summary: O que o Aspire adiciona ao ASP.NET Core: o AppHost que descreve o modelo da aplicação, as variáveis de ambiente de service discovery e OTLP que cada serviço recebe, o que o ServiceDefaults configura e por que os health endpoints só existem em Development, o dashboard com token e chave OTLP, pacotes de hosting e de cliente, e o que aspire publish gera para Docker Compose e Kubernetes, com o que cada experimento realmente mostrou.
---
## Objective

Uma solução ASP.NET Core comum com três serviços deixa com você subir cada processo, distribuir portas, copiar connection strings para cada `appsettings.json`, ligar OpenTelemetry e health checks em cada `Program.cs` e, depois, escrever à mão o arquivo do Docker Compose ou os manifestos do Kubernetes. O Aspire (antes ".NET Aspire", hoje chamado só de "Aspire") leva isso para código: um projeto AppHost é um programa C# que descreve o modelo da aplicação (quais serviços existem, o que cada um referencia, quem espera por quem), um projeto `ServiceDefaults` dá a todos os serviços a mesma configuração de telemetria, saúde e resiliência, um dashboard mostra logs, traces e métricas durante o desenvolvimento, e publishers transformam o mesmo modelo em artefatos de deployment. A documentação da Microsoft para ele mudou para aspire.dev (as páginas antigas do learn.microsoft.com redirecionam para lá), então essa é a fonte principal desta lição. Montei um AppHost real com dois recursos de projeto, rodei sem Docker, imprimi o que o consumidor recebeu, conferi os health endpoints em dois ambientes, consultei o dashboard pela CLI e gerei saídas de Docker Compose, Helm e manifesto numa pasta sem fazer deploy. Recursos de contêiner (Redis, PostgreSQL) aparecem como código que compila mas não foi executado, porque nenhum runtime de contêiner estava rodando. Versões usadas: SDK 10.0.100, Aspire 13.6.4 (`Aspire.AppHost.Sdk`, `Aspire.Hosting.AppHost`, `Aspire.Cli`, `Aspire.ProjectTemplates`, `Aspire.Hosting.Docker`, `Aspire.Hosting.Redis`, `Aspire.Hosting.PostgreSQL`, `Aspire.StackExchange.Redis`), `Aspire.Hosting.Kubernetes` 13.6.4-preview.1.26523.11 (prerelease) e, vindos do template de ServiceDefaults, `Microsoft.Extensions.Http.Resilience` 10.10.0, `Microsoft.Extensions.ServiceDiscovery` 10.10.0 e pacotes OpenTelemetry 1.17.0.

## Use Cases

- Subir uma API, um frontend e os bancos deles com um único comando, com portas e connection strings distribuídas automaticamente.
- Ver logs estruturados, traces distribuídos e métricas de todos os serviços locais num só dashboard, sem instalar um collector.
- Dar a todos os serviços de uma solução a mesma configuração de OpenTelemetry, health checks, service discovery e resiliência HTTP a partir de um projeto compartilhado.
- Gerar um primeiro arquivo do Docker Compose ou um Helm chart a partir do mesmo modelo, em vez de escrever do zero.

## Deep Dive

### O AppHost descreve, ele não atende requisições

`dotnet new aspire` (do `Aspire.ProjectTemplates` 13.6.4) criou dois projetos: `Shop.AppHost` e `Shop.ServiceDefaults`. Adicionei dois projetos web vazios, `Shop.Api` e `Shop.Web`, referenciei os dois no AppHost e escrevi o modelo:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var db = builder.AddConnectionString("orders-db");      // o valor vem da config do AppHost

var api = builder.AddProject<Projects.Shop_Api>("api")
    .WithReplicas(2);

builder.AddProject<Projects.Shop_Web>("web")
    .WithReference(api)                // dados de service discovery de "api"
    .WithReference(db)                 // ConnectionStrings__orders-db
    .WithEnvironment("API_GREETING", "hi")
    .WaitFor(api)                      // web só sobe depois de api
    .WithExternalHttpEndpoints();      // endpoint público no deploy

builder.Build().Run();
```

`Projects.Shop_Api` é um tipo gerado a partir do `ProjectReference`. O arquivo do projeto AppHost é uma única linha de SDK; o `Aspire.Hosting.AppHost` 13.6.4 veio implicitamente por ela:

```xml
<Project Sdk="Aspire.AppHost.Sdk/13.6.4">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <AspireUseCliBundle>true</AspireUseCliBundle>
  </PropertyGroup>
</Project>
```

Nada nesse programa trata requisições. Ele monta um grafo de recursos e o entrega a um orquestrador, o Developer Control Plane (DCP), que sobe os processos. A página de pré-requisitos diz que um AppHost em C# exige o SDK do .NET 10, enquanto os serviços que ele roda podem mirar .NET 8 ou posterior, e que um runtime de contêiner (Docker Desktop ou Podman) é necessário para recursos de contêiner.

### Rodando: `dotnet run` é `aspire run`

Rodei `dotnet run --project Shop.AppHost --launch-profile http`. O perfil `http` do template não subiu:

```text
Unhandled exception. System.AggregateException: One or more errors occurred. (The 'applicationUrl' setting must be an https address unless the
'ASPIRE_ALLOW_UNSECURED_TRANSPORT' environment variable is set to true. ...)
```

Depois de adicionar `"ASPIRE_ALLOW_UNSECURED_TRANSPORT": "true"` a esse perfil (e fixar as portas dele em 5735, 5736 e 5737), ele imprimiu:

```text
AppHost:   Shop.AppHost.csproj
Dashboard: http://localhost:5735/login?t=4eb131305999fb9f9e40150e294ede80
Logs:      /Users/<me>/.aspire/logs/cli_20261028T162128_b736db6f.log
           Press CTRL+C to stop the AppHost and exit.
```

A lista de processos mostrou por que a saída parece de uma CLI: com `AspireUseCliBundle`, o `dotnet run` executou `dnx --yes aspire.cli@13.6.4 -- run --project ...`, então a CLI do Aspire foi baixada para o cache do NuGet e conduziu a execução mesmo sem eu ter instalado. Abaixo dela estavam o AppHost, dois processos `dcp`, o processo do dashboard e os três serviços:

```text
dcp          listening 5731 (api proxy), 5733 (web proxy), 5735 (dashboard), 5736 (OTLP)
Shop.AppHost listening 5737 (resource service)
Shop.Api     pid 47218 on 22015, pid 47219 on 22016    (2 replicas)
Shop.Web     pid 47225 on 22014
```

As portas do `launchSettings.json` de cada serviço (5731, 5733) viraram portas de proxy do DCP; os processos reais ganharam portas aleatórias. À parte, instalei a CLI sem root numa pasta de rascunho com `dotnet tool install Aspire.Cli --tool-path ./cli` (13.6.4). A documentação também oferece `curl -sSL https://aspire.dev/install.sh | bash` e Homebrew. O `aspire doctor` informou `Docker: installed but not running`, e `aspire ps`, `aspire describe` e `aspire stop` funcionaram contra o AppHost em execução:

```text
Name          Type       State    Health   URLs
api-feaqwaxa  Project    Running  Healthy  http://localhost:5731
api-yngunhqs  Project    Running  Healthy  http://localhost:5731
orders-db     Parameter  Running  Healthy  -
web           Project    Running  Healthy  http://localhost:5733
```

Um `kill -INT` em segundo plano não derrubou a árvore; o `aspire stop` derrubou, e depois disso todos os processos e portas tinham sumido.

### O que o consumidor recebe

O `Shop.Web` tem um endpoint que imprime o próprio ambiente. Estas são as variáveis que o AppHost injetou (seleção):

```text
API_GREETING=hi
API_HTTP=http://localhost:5731
services__api__http__0=http://localhost:5731
ConnectionStrings__orders-db=Host=db.example;Database=orders
ConnectionStrings__orders_db=Host=db.example;Database=orders
ASPNETCORE_URLS=http://localhost:22014
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5736
OTEL_EXPORTER_OTLP_HEADERS=x-otlp-api-key=70f464087b52bfbd0cde5e8e3f048cae
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_SERVICE_NAME=web
OTEL_RESOURCE_ATTRIBUTES=service.instance.id=mnymsryz
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_BLRP_SCHEDULE_DELAY=1000
OTEL_METRIC_EXPORT_INTERVAL=1000
OTEL_TRACES_SAMPLER=always_on
```

O `WithReference(api)` produziu duas formas do mesmo endereço: `services__api__http__0` (a chave de configuração `services:api:http:0`, lida pelo `Microsoft.Extensions.ServiceDiscovery`) e `API_HTTP`, uma variável simples para código que não usa o service discovery do .NET. A connection string chegou com os nomes `orders-db` e `orders_db`. Os intervalos de exportação de 1 segundo são o que a documentação de telemetria descreve: configurações para desenvolvimento local, para os dados aparecerem rápido no dashboard.

No `Shop.Web` o client é registrado com um nome lógico, `AddHttpClient("api", c => c.BaseAddress = new("http://api"))`. Os logs estruturados mostram a reescrita:

```text
Start processing HTTP request GET http://api/hello
Sending HTTP request GET http://localhost:5731/hello
```

Service discovery é só configuração. Rodei os dois serviços compilados diretamente, sem o AppHost. Sem a variável, `/call` devolveu `500` depois de o retry padrão fazer 4 tentativas (`Attempt: '0'` a `'3'`):

```text
System.Net.Http.HttpRequestException: nodename nor servname provided, or not known (api:80)
```

Com `services__api__http__0=http://localhost:5738` definido à mão, o mesmo binário chegou à API. É isso que faz os arquivos de deployment gerados mais abaixo funcionarem: eles definem a mesma variável.

### Réplicas e o proxy

Seis chamadas `curl` separadas ao proxy na 5731 alternaram entre os dois processos da API (`47218, 47219, 47218, 47219, 47219, 47218`). Quatro chamadas do `Shop.Web` pelo mesmo `HttpClient` caíram todas no pid 47219, muito provavelmente porque a conexão do pool continua aberta para uma réplica só.

### ServiceDefaults: exatamente o que `AddServiceDefaults()` configura

Cada serviço chama `builder.AddServiceDefaults()` e `app.MapDefaultEndpoints()`. Li o `Extensions.cs` gerado. Ele faz isto, e nada mais (a lição de OpenTelemetry explica cada peça):

- **Logging**: `builder.Logging.AddOpenTelemetry` com `IncludeFormattedMessage = true` e `IncludeScopes = true`.
- **Métricas**: instrumentação de ASP.NET Core, HttpClient e runtime.
- **Tracing**: `AddSource(builder.Environment.ApplicationName)`, instrumentação de ASP.NET Core com um filtro que descarta requisições para `/health` e `/alive`, e instrumentação de HttpClient (a de cliente gRPC é uma linha comentada).
- **Exporter**: `UseOtlpExporter()` só quando `OTEL_EXPORTER_OTLP_ENDPOINT` está definida; Azure Monitor é um bloco comentado.
- **Health checks**: um check chamado `self`, sempre saudável, com a tag `live`.
- **Service discovery**: `AddServiceDiscovery()`, mais um `ConfigureHttpClientDefaults` que adiciona `AddStandardResilienceHandler()` e `AddServiceDiscovery()` a todo `HttpClient` (restringir os esquemas a https é uma opção comentada).
- **Endpoints**: `MapDefaultEndpoints` mapeia `/health` (todos os checks) e `/alive` (checks com a tag `live`) só `if (app.Environment.IsDevelopment())`.

Rodei a API sozinha nos dois ambientes:

```text
ASPNETCORE_ENVIRONMENT=Development: /health -> 200, /alive -> 200, /hello -> 200
ASPNETCORE_ENVIRONMENT=Production:  /health -> 404, /alive -> 404, /hello -> 200
```

O comentário do template aponta as implicações de segurança de expor health endpoints. Para um orquestrador de verdade você mesmo os mapeia, como na lição de health checks. O handler de resiliência registra log em toda chamada (`Execution attempt. Source: '-standard//Standard-Retry' ... Attempt: '0'`), e foi ele também que repetiu as chamadas que falharam acima.

### O dashboard e o endpoint OTLP dele

A URL de login carrega um token. Conferi os dois casos com `curl`:

```text
GET /login?t=wrong                              -> 302 Location: /login   (no cookie)
GET /login?t=4eb131305999fb9f9e40150e294ede80   -> 302 Location: /
    Set-Cookie: .Aspire.Dashboard.Auth.Http.shop-887c4652474c3c06=CfDJ8...
```

A documentação diz que o token é obrigatório porque o dashboard mostra dados sensíveis, como variáveis de ambiente, e que o cookie vale por três dias. O receptor OTLP na 5736 também é protegido. Enviei um `TraceService/Export` gRPC vazio:

```text
without x-otlp-api-key:          HTTP/2 401
with the key from the env var:   HTTP/2 200, grpc-status: 0
```

A documentação lista as telas: Resources (a página inicial, com um grafo de dependências), Console logs, Structured logs, Traces e Metrics. Não abri navegador; o `aspire otel` leu os mesmos dados pela API do dashboard:

```text
web: GET /env   1 span   21.45ms  OK
web: GET /call  9 spans  78.78ms  OK
```

O trace de `/call` teve 9 spans: o span de servidor no `web`, 4 spans de cliente e 4 spans de servidor nas réplicas da API.

### Integrações: pacotes de hosting e pacotes de cliente

Pacotes de hosting (`Aspire.Hosting.*`) adicionam tipos de recurso ao AppHost. Isto compilou com `Aspire.Hosting.Redis` e `Aspire.Hosting.PostgreSQL` 13.6.4, mas não rodei, porque cada `Add...` aqui é um contêiner:

```csharp
var cache = builder.AddRedis("cache");
var ordersDb = builder.AddPostgres("pg").WithDataVolume().AddDatabase("ordersdb");
builder.AddProject<Projects.Shop_Api>("api")
    .WithReference(cache).WithReference(ordersDb).WaitFor(ordersDb);
```

Pacotes de cliente (`Aspire.*`, sem `Hosting`) vão no serviço e leem a connection string que o AppHost injeta. Com o `Aspire.StackExchange.Redis` 13.6.4, `builder.AddRedisClient("cache")` registrou um health check além do client. Apontei para uma porta sem Redis:

```text
health checks: self[live], StackExchange.Redis[]
multiplexer connected=False
/health -> 503 Unhealthy
/alive  -> 200 Healthy
```

Como o check do Redis não tem a tag `live`, um Redis fora do ar deixa o serviço não pronto, mas ainda vivo. Sem connection string nenhuma, a primeira requisição que resolveu o client lançou `InvalidOperationException: No endpoints specified. Ensure a valid connection string was provided in 'ConnectionStrings:cache' or for the 'Aspire:StackExchange:Redis:ConnectionString' configuration key.`

### Publish e deploy

O `aspire publish` escreve artefatos para um compute environment declarado no modelo; o `aspire deploy` faz build, push e aplica. A documentação de deploy lista Docker Compose, Kubernetes, AKS, Azure Container Apps e Azure App Service como alvos. Com `builder.AddDockerComposeEnvironment("compose")` (`Aspire.Hosting.Docker`) adicionado ao modelo acima, `aspire publish -o publish-out` terminou em cerca de 17 ms de tempo de pipeline e escreveu `docker-compose.yaml` e `.env` sem precisar de Docker:

```text
  api:
    image: "${API_IMAGE}"
    environment:
      HTTP_PORTS: "${API_PORT}"
      ConnectionStrings__cache: "cache:6379,password=${CACHE_PASSWORD}"
      ConnectionStrings__ordersdb: "Host=pg;Port=5432;Username=postgres;Password=${PG_PASSWORD};Database=ordersdb"
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://compose-dashboard:18889"
      OTEL_SERVICE_NAME: "api"
    depends_on:
      pg:
        condition: "service_started"
  web:
    environment:
      services__api__http__0: "http://api:${API_PORT}"
```

O arquivo também tinha `cache` (`redis:8.6`), `pg` (`postgres:18.3` com um volume) e um serviço `compose-dashboard` (`mcr.microsoft.com/dotnet/nightly/aspire-dashboard:13.6`). Segredos e imagens viraram entradas vazias no `.env` (`CACHE_PASSWORD=`, `PG_PASSWORD=`, `API_IMAGE=`). Duas coisas não foram levadas: `WithReplicas(2)` não gerou nenhuma configuração de réplicas, e o `WaitFor` virou `service_started`, não uma condição de saúde. Nenhum `ASPNETCORE_ENVIRONMENT` foi definido, então os serviços rodam como Production, onde `MapDefaultEndpoints` não mapeia health endpoint nenhum.

O `aspire deploy --list-steps` mostrou o que o deploy adicionaria: `build-api`, `build-web`, `push-api`, `push-web`, `docker-compose-up-compose`. Esses passos precisam de Docker, então não os rodei. Com `AddKubernetesEnvironment("k8s")` no lugar, o publish escreveu um Helm chart (`Chart.yaml`, `values.yaml`, um Deployment, um Service e um ConfigMap por recurso, mais o dashboard). Ali o `replicas: 2` foi respeitado, mas nenhum Deployment tinha probe de liveness ou readiness. Publicar um modelo sem compute environment informou `4/4 steps succeeded` e não escreveu arquivo nenhum. O manifesto JSON antigo ainda existe: `dotnet run --project Shop.AppHost -- --publisher manifest --output-path ...` escreveu `aspire-manifest.json` (recursos `project.v0` e `parameter.v0` com placeholders como `{api.bindings.http.url}`), mas o wrapper da CLI não terminou depois disso e tive de pará-lo. O Azure Container Apps aparece na documentação de deploy como alvo de publish e de deploy (o pacote de hosting `Aspire.Hosting.Azure.AppContainers` está na 13.6.4 no NuGet); a página de deploy que li não menciona o azd, e não testei o Azure.

### Templates e a rotatividade de versões

Com o `Aspire.ProjectTemplates` 13.6.4 instalado, o `dotnet new` listou `aspire`, `aspire-apphost`, `aspire-apphost-singlefile`, `aspire-servicedefaults`, `aspire-starter`, `aspire-ts-cs-starter` e `aspire-mstest`/`aspire-nunit`/`aspire-xunit`. Abri o pacote 9.5.2 para comparar: os mesmos nomes curtos, exceto `aspire-ts-cs-starter`, mas o AppHost dele usava `Microsoft.NET.Sdk` mais `<Sdk Name="Aspire.AppHost.Sdk" Version="9.5.2" />`, um pacote `Aspire.Hosting.AppHost` explícito e `net8.0`, e o ServiceDefaults usava OpenTelemetry 1.12.0. O comando `aspire new` também oferece starters em TypeScript e Python; as notas da versão 13.4 tornaram o AppHost em TypeScript geralmente disponível. O NuGet entregou a 13.6.4, enquanto a página de instalação ainda anunciava "Aspire 13.6.0, released September 29, 2026".

Os templates de teste são a contraparte de testes: no pacote que abri, o `aspire-xunit` referencia `Aspire.Hosting.Testing` e o exemplo dele sobe o AppHost com `DistributedApplicationTestingBuilder.CreateAsync<Projects.MyAspireApp_AppHost>()`. Uma lição irmã cobre isso.

## Trade-offs

- **É um orquestrador de tempo de desenvolvimento, não um runtime.** Em produção não existe AppHost nem DCP; o que sobra são as variáveis de ambiente e o código do ServiceDefaults que seus serviços carregam. Planeje você mesmo as probes reais, os segredos e a escala.
- **Os arquivos de deployment gerados são um começo, não o fim.** As réplicas sumiram no Compose, o `WaitFor` virou `service_started`, os deployments do Helm não tinham probes e os health endpoints só existem em Development.
- **Docker Compose ou Kubernetes puros podem bastar.** Se seus serviços já rodam a partir de um arquivo compose e você não quer um projeto C# descrevendo isso, o Aspire acrescenta uma camada para aprender e atualizar.
- **Os serviços se acoplam às convenções do Aspire.** Nomes lógicos como `http://api` e `ConnectionStrings:cache` só funcionam fora do AppHost se algo definir `services__api__http__0` e a connection string. O código em si continua sendo ASP.NET Core comum.
  ```csharp
  // funciona em qualquer lugar onde a variável esteja definida
  builder.Services.AddHttpClient("api", c => c.BaseAddress = new("http://api"));
  ```
- **O ServiceDefaults é código copiado.** O template fixou OpenTelemetry 1.17.0 no momento da criação, então você mesmo atualiza esses pacotes, como em qualquer outro projeto.
- **As versões mudam rápido.** O produto foi renomeado, o formato do projeto AppHost mudou entre 9.x e 13.x, a CLI agora conduz o `dotnet run`, e o publisher de Kubernetes ainda era um pacote preview na 13.6.4. Fixe a versão do SDK e leia as notas de versão antes de atualizar.
- **Contêineres precisam de um runtime.** Todo recurso `AddRedis`/`AddPostgres` precisa de Docker ou Podman rodando; um AppHost só com recursos de projeto roda sem eles.

## Documentation Links

- [What is Aspire?, aspire.dev](https://aspire.dev/get-started/what-is-aspire/) (doc)
- [Service defaults, aspire.dev](https://aspire.dev/fundamentals/service-defaults/) (doc)
- [Telemetry, aspire.dev](https://aspire.dev/fundamentals/telemetry/) (doc)
- [Explore the Aspire dashboard, aspire.dev](https://aspire.dev/dashboard/explore/) (doc)
- [Deploy with Aspire, aspire.dev](https://aspire.dev/deployment/deploy-with-aspire/) (doc)
- [What's new in Aspire 13.4, Microsoft Aspire blog](https://devblogs.microsoft.com/aspire/whats-new-aspire-13-4/) (doc)
