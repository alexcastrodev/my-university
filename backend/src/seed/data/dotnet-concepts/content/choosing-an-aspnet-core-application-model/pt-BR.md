---
version: 1.0
updatedAt: 2026-10-16
title: "Escolhendo um Modelo de Aplicação no ASP.NET Core"
summary: Minimal APIs, controllers, Razor Pages, MVC, Blazor, gRPC e SPA com API lado a lado, o que cada template do .NET 10 realmente gera, o que o host compartilha entre todos e onde os padrões de cada modelo ainda divergem, medido em requisições reais.
---
## Objective

"ASP.NET Core" não é um modelo de programação só, e sim um host compartilhado
com vários modelos encaixados nele: minimal APIs, controllers, Razor Pages,
views do MVC, componentes Blazor, serviços gRPC e uma SPA em JavaScript servida
ao lado de uma API. O objetivo deste conceito é escolher entre eles de
propósito: saber para que cada um serve, quanto custa em arquivos, linguagens e
comportamento em runtime, e quais partes (pipeline, DI, configuração,
autenticação) você mantém qualquer que seja a escolha. As medições de template
e as respostas HTTP abaixo saíram do SDK do .NET 10 (10.0.100).

## Use Cases

- Começar um projeto novo e decidir qual template do `dotnet new` rodar.
- Um app MVC ou Razor Pages existente que precisa de algumas páginas
  interativas, onde a pergunta é "reescrever ou adicionar componentes Blazor?".
- Um time forte em React ou Angular decidindo se o front fica em Blazor ou
  continua em JavaScript com uma API ASP.NET Core por trás.
- Tráfego entre serviços em que JSON sobre HTTP não é a única opção e gRPC
  entra na conversa.
- Um produto que também precisa de cliente desktop ou mobile e quer reaproveitar
  código C# entre eles.

## Deep Dive

### As recomendações oficiais, lidas com cuidado

A página "Choose an ASP.NET Core UI" diz que, para projetos novos, a Microsoft
recomenda Blazor, e o overview de APIs diz que, para projetos novos, recomenda
minimal APIs. Nenhuma das duas declara as alternativas obsoletas. Razor Pages e
MVC continuam descritos como modelos maduros de UI renderizada no servidor, e
controllers continuam indicados quando você precisa de extensibilidade de model
binding (`IModelBinderProvider`, `IModelBinder`), validação avançada
(`IModelValidator`), application parts ou application model, ou OData. A doc
completa que quase tudo isso pode ser construído à mão em minimal APIs, mas
controllers já trazem pronto. Ou seja, "recomendado para projetos novos" é um
padrão, não uma ordem de migração para apps que já funcionam.

### O que cada template entrega

Gerando cada template web com `dotnet new <template> --no-restore` e contando
arquivos (sem contar o Bootstrap e o jQuery copiados em `wwwroot/lib`):

```text
template     files  wwwroot/lib  projects  extra packages
web            5        0           1      none
webapi         6        0           1      Microsoft.AspNetCore.OpenApi
webapiaot      6        0           1      Microsoft.AspNetCore.OpenApi
grpc           7        0           1      Grpc.AspNetCore
mvc           18       60           1      none
webapp        19       60           1      none          (Razor Pages)
blazor        22       44           1      none          (default: Server interactivity)
blazorwasm    18       44           1      Components.WebAssembly + DevServer
```

`blazor --interactivity Auto` (ou `WebAssembly`) gerou dois projetos, o app
servidor e um projeto `.Client`, porque o código que roda no navegador precisa
ser compilado em um assembly próprio. Essa divisão é o primeiro custo visível
da renderização no cliente. Repare também que o template `webapi` do .NET 10 é
minimal API por padrão; controllers exigem `--use-controllers`.

Os `Program.cs` diferem em poucas linhas, e é justamente essa a vantagem do
host compartilhado:

```text
web       app.MapGet("/", ...)
webapi    AddOpenApi + MapOpenApi + MapGet
mvc       AddControllersWithViews + MapControllerRoute
webapp    AddRazorPages + MapRazorPages
blazor    AddRazorComponents + MapRazorComponents<App> + UseAntiforgery
grpc      AddGrpc + MapGrpcService<GreeterService>
```

Tratamento de exceção, HSTS, redirecionamento para HTTPS, `MapStaticAssets` e
autorização aparecem nos templates de UI na mesma ordem. Aprender o pipeline uma
vez rende em todos os modelos.

### Modelos convivem no mesmo host

Como todos são apenas fontes de endpoints, dá para misturar modelos num único
app. Este file-based app registra um endpoint de minimal API e um controller
com `[ApiController]`, os dois usando o mesmo singleton e o mesmo middleware:

```csharp
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddValidation();
builder.Services.AddSingleton<Clock>();
var app = builder.Build();
app.Use(async (ctx, next) => { ctx.Response.Headers["X-Pipeline"] = "shared"; await next(); });
app.MapPost("/minimal/orders", (Order o, Clock c) => TypedResults.Ok(new { o.Sku, at = c.Name }));
app.MapControllers();
app.Run();

public record Order([Required] string Sku, [Range(1, 10)] int Qty);
public class Clock { public string Name => "same singleton"; }

[ApiController, Route("controller/orders")]
public class OrdersController(Clock c) : ControllerBase
{
    [HttpPost] public IActionResult Post(Order o) => Ok(new { o.Sku, at = c.Name });
}
```

Requisições válidas nas duas rotas devolveram `200`, o header
`X-Pipeline: shared` e `{"sku":"A1","at":"same singleton"}`. Corpos inválidos
mostraram onde os modelos ainda divergem:

```text
POST /controller/orders {"qty":50}
  400 application/problem+json; charset=utf-8
  {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"One or more
   validation errors occurred.","status":400,"errors":{...},"traceId":"..."}

POST /minimal/orders {"qty":50}
  400 application/json; charset=utf-8
  {"title":"One or more validation errors occurred.","errors":{...}}
```

O `[ApiController]` produz uma resposta ProblemDetails completa sozinho. A
validação de minimal APIs que chegou no .NET 10 devolveu só `title` e `errors`
até `AddProblemDetails()` ser registrado; depois disso passou a responder
`application/problem+json` com `type`, `status` e `traceId`, igual ao
controller. Misturar modelos funciona, mas padrões como esse são por modelo, e
o cliente enxerga a diferença.

### UI renderizada no servidor: Razor Pages e MVC

Os dois renderizam HTML no servidor a cada requisição, então o navegador recebe
a página pronta e não precisa de runtime .NET. Razor Pages organiza o código por
página (um `.cshtml` mais o seu page model), o que deixa fluxos simples de
formulário curtos. MVC organiza por controller e action e encaminha as views por
eles, o que combina com sites grandes com muitas ações sobre os mesmos recursos.
A interatividade é o JavaScript que você mesmo escrever. Ambos conseguem
hospedar componentes Razor pelo Component Tag Helper, que é o caminho para um
app existente ganhar ilhas interativas sem reescrita.

### Blazor: um modelo de componentes, vários lugares de renderização

Componentes Blazor podem renderizar estaticamente no servidor, de forma
interativa por um circuito SignalR (Server), no navegador em WebAssembly, ou
começar no servidor e trocar para WebAssembly (Auto). O conceito de render modes
mostra o custo de cada um: o circuito segura memória por usuário no servidor, o
WebAssembly baixa o runtime, e o Auto exige o layout de dois projetos medido
acima. O grande argumento é uma linguagem só e tipos compartilhados do banco ao
botão.

### SPA com API ASP.NET Core

Quando o front é React, Angular ou Vue, o ASP.NET Core vira a API (normalmente
minimal APIs) e o host de arquivos estáticos. A doc de UI lista as desvantagens
sem rodeio: mais linguagens e ferramentas, e lógica como validação tende a ser
escrita duas vezes. A vantagem é o ecossistema JavaScript e o mercado de
contratação. Chamadas do navegador vindas de outra origem precisam de CORS, e a
autenticação costuma sair de cookies para tokens ou para um backend-for-frontend.

### Serviços e clientes fora da web

gRPC (template `grpc`) usa HTTP/2 e Protocol Buffers com clientes gerados, e se
encaixa bem entre serviços que você controla, mas o navegador não chama gRPC
direto sem gRPC-Web. Processamento em background sem HTTP fica no template
`worker`. Para desktop e mobile, o .NET MAUI é a UI multiplataforma da
Microsoft, e o MAUI pode hospedar componentes Blazor (Blazor Hybrid) para
dividir UI com o app web; Avalonia e Uno Platform são alternativas de terceiros.
O lado web desses apps, de novo, é uma API.

### Um caminho curto de decisão

1. Só máquinas chamam? Minimal APIs; controllers se precisar dos recursos
   listados acima; gRPC para chamadas internas de alto volume.
2. Usuários humanos e o time escreve C#? Blazor, começando com SSR estático e
   adicionando interatividade por página.
3. App MVC ou Razor Pages existente? Mantenha e acrescente componentes onde
   fizer falta.
4. Time ou produto já comprometido com um framework JavaScript? SPA mais API.

## Trade-offs

- **Recomendado versus conhecido.** Minimal APIs e Blazor são o padrão para
  código novo, mas um time fluente em controllers entrega mais rápido com
  controllers, e a doc apoia isso explicitamente.
- **Misturar modelos.** Um host serve todos, mas cada um traz os próprios
  padrões (respostas de validação, convenções de rota, filters versus endpoint
  filters), então documente qual modelo é dono de quais rotas.
  ```text
  /api/*  minimal APIs     /admin/*  Razor Pages     /app/*  Blazor
  ```
- **Renderização no servidor versus no cliente.** Páginas renderizadas no
  servidor são baratas para o cliente e fáceis de cachear; código interativo no
  cliente exige baixar um runtime (WebAssembly) ou manter uma conexão aberta
  (circuito do Server).
- **Uma linguagem versus o melhor front de cada ecossistema.** Blazor elimina o
  modelo e a validação duplicados; uma SPA JavaScript traz um ecossistema de
  componentes maior e um build, deploy e modelo de segurança separados.
- **Peso do template.** Os templates de UI chegam com cerca de 45 a 60 arquivos
  de front copiados; os de API, com nenhum. Apague no primeiro dia o que não vai
  usar, ou vira código sem dono.

## Documentation Links

- [Choose an ASP.NET Core UI, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/choose-web-ui) (doc)
- [APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis) (doc)
- [Integrate ASP.NET Core Razor components with MVC or Razor Pages, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/integration) (doc)
- [ASP.NET Core Blazor hosting models, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hosting-models) (doc)
- [Overview for gRPC on .NET, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/) (doc)
- [What is .NET MAUI?, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/what-is-maui) (doc)
