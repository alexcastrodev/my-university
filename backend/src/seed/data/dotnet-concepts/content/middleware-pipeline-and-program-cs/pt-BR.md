---
version: 1.0
updatedAt: 2026-10-15
title: "O Pipeline de Middleware e o Program.cs"
summary: Use, Run e Map, o que o WebApplication adiciona sozinho, a ordem recomendada, curto-circuito, middleware por convenção versus IMiddleware e ambientes.
---
## Objective

Toda requisição HTTP no ASP.NET Core passa por uma cadeia de delegates, o
pipeline de middleware, e o `Program.cs` é onde você monta essa cadeia. A cadeia
tem ordem, cada elo pode rodar código antes e depois do próximo, e qualquer elo
pode parar a requisição ao não chamar o próximo. A maior parte dos "por que isso
não funciona" sobre redirecionamento HTTPS, CORS, autenticação, arquivos
estáticos e páginas de erro é, na verdade, sobre ordem. O objetivo é ler um
`Program.cs` como um pipeline: saber o que `Use`, `Run` e `Map` fazem, o que o
`WebApplication` adiciona por você, como um curto-circuito aparece visto de fora
e como escrever o próprio middleware sem vazar serviços scoped.

## Use Cases

- Adicionar uma regra transversal que vale para toda requisição: um correlation
  id, um cabeçalho customizado, uma chave de modo manutenção, um cronômetro.
- Decidir onde `UseExceptionHandler`, `UseHsts`, `UseCors` e a autenticação
  ficam uns em relação aos outros.
- Depurar um endpoint que nunca é alcançado porque algo antes no pipeline
  respondeu primeiro.
- Servir uma sub-aplicação diferente sob um prefixo de caminho, ou só para
  requisições que carregam um certo cabeçalho.

## Deep Dive

### Use, Run e Map

O `WebApplication` é ao mesmo tempo o host e o construtor do pipeline. Três
métodos dão forma à cadeia:

- `Use(async (ctx, next) => ...)` adiciona um middleware que decide se e quando
  chamar `next`. O que vem antes de `await next(ctx)` acontece na ida, o que vem
  depois acontece na volta.
- `Run(ctx => ...)` adiciona um delegate terminal. Ele não tem `next`, então nada
  depois dele na cadeia roda para aquela requisição.
- `Map(path, branch)` e `MapWhen(predicate, branch)` abrem um pipeline separado
  para as requisições que casam. `Map` também move o prefixo casado de `Path`
  para `PathBase`. `UseWhen` também ramifica, mas volta para a cadeia principal a
  menos que o ramo faça curto-circuito.

Aqui vai um app pequeno (file-based app, rodado com `dotnet run p.cs` no SDK
10.0.100) que registra a ordem em que cada peça roda em cada requisição:

```csharp
#:sdk Microsoft.NET.Sdk.Web
using System.Text;
var app = WebApplication.CreateBuilder(args).Build();
StringBuilder T(HttpContext c) => (StringBuilder)(c.Items["t"] ??= new StringBuilder());

app.Use(async (ctx, next) =>                         // A: mais externo, captura exceções
{
    try { await next(ctx); }
    catch (Exception ex) { ctx.Response.StatusCode = 500; await ctx.Response.WriteAsync("caught: " + ex.Message); }
});
app.Use(async (ctx, next) =>                         // B: trace
{
    T(ctx).Append("A>"); await next(ctx); T(ctx).Append("<A");
    Console.WriteLine($"TRACE {ctx.Request.Path} {T(ctx)} status={ctx.Response.StatusCode}");
});
app.Use(async (ctx, next) =>                         // C: um portão
{
    if (ctx.Request.Query.ContainsKey("deny")) { ctx.Response.StatusCode = 401; await ctx.Response.WriteAsync("denied"); return; }
    T(ctx).Append("B>"); await next(ctx); T(ctx).Append("<B");
});
app.Map("/branch", br => br.Run(c => c.Response.WriteAsync($"pathBase={c.Request.PathBase} path={c.Request.Path}")));
app.MapGet("/hello", (HttpContext ctx) => { T(ctx).Append("H"); return "hello"; });
app.MapGet("/boom", () => { throw new InvalidOperationException("kaboom"); return "x"; });
app.Run();
```

Saída real do `curl` contra ele, mais o trace no console:

```text
GET /hello          -> 200 hello                           TRACE A>B>H<B<A status=200
GET /hello?deny=1   -> 401 denied                          TRACE A><A status=401
GET /boom           -> 500 caught: kaboom
GET /branch/x       -> 200 pathBase=/branch path=/x        TRACE A>B><B<A status=200
GET /nope           -> 404 (corpo vazio)                   TRACE A>B><B<A status=404
```

A primeira linha mostra a cebola: entra por A e B, o handler `H`, sai por B e A.
A segunda mostra um curto-circuito: o portão respondeu 401 e nunca chamou `next`,
então o handler não rodou e o middleware externo ainda viu a volta. A terceira
mostra por que o tratador de exceção vem primeiro: ele é o único que envolve o
resto, e a exceção no endpoint virou um 500 controlado. A quarta mostra o `Map`
reescrevendo `Path` e `PathBase`. A última mostra que uma requisição que ninguém
trata cai para fora do fim do pipeline como 404.

### O que o WebApplication adiciona por você

Você não escreve `UseRouting` nem `UseEndpoints` num `Program.cs` moderno. Pela
documentação, o `WebApplication` adiciona `UseDeveloperExceptionPage` primeiro
quando o ambiente é `Development`, adiciona `UseRouting` no início se você não o
chamou e existem endpoints, adiciona autenticação e autorização logo depois do
roteamento quando esses serviços estão registrados, e adiciona o middleware de
endpoints no **fim** do pipeline. Seu middleware, portanto, roda entre o
roteamento e os endpoints.

Duas consequências observáveis. Primeiro, o endpoint selecionado já é conhecido
pelo seu middleware, mesmo sem `UseRouting` explícito:

```text
Cabeçalho escrito por um Use() colocado antes de qualquer Map, para GET /hello:
X-Endpoint-Before-UseRouting: HTTP: GET /hello          (para /nope e /branch/x: null)
```

É isso que permite à autorização e ao CORS ler os metadados do endpoint.
Segundo, como o middleware de endpoints fica no fim de tudo, um `app.Run(...)`
terminal registrado no meio do `Program.cs` engole tudo. Com um `Run` genérico
escrito antes do `app.Run()` final, uma requisição a `/hello` devolveu
`terminal: nothing matched` e `/boom` devolveu 200: os endpoints e o trabalho do
tratador de exceção sumiram sem nenhum erro.

### A ordem recomendada

A orientação documentada para as peças embutidas é, do mais externo ao mais
interno: tratamento de exceção (e HSTS em produção), redirecionamento HTTPS,
arquivos estáticos, roteamento, CORS, autenticação, autorização e só então os
seus endpoints. O raciocínio é uma regra curta: coloque o que pode falhar ou
fazer curto-circuito barato o mais cedo que ele conseguir enxergar o que precisa.
O tratamento de exceção vem primeiro porque precisa envolver o resto. Arquivos
estáticos vêm antes da autenticação para que imagens não paguem a checagem de
token. O CORS roda depois do roteamento (ele lê metadados do endpoint) e antes da
autenticação, para que um preflight rejeitado não vire um 401. A autenticação
precede a autorização porque a segunda precisa do usuário que a primeira montou.

### Escrevendo o seu: convenção versus IMiddleware

Há dois formatos. O middleware por convenção é uma classe com construtor que
recebe `RequestDelegate` e um método `InvokeAsync(HttpContext, ...)`. Ele é
criado **uma vez**, então os parâmetros do construtor precisam ser seguros para
singleton. Serviços scoped vão em `InvokeAsync`, que é resolvido por requisição:

```csharp
class ConventionMiddleware(RequestDelegate next, ILogger<ConventionMiddleware> log)
{
    public async Task InvokeAsync(HttpContext ctx, Clock clock)   // Clock é scoped
    {
        ctx.Response.Headers["X-Clock-Scope"] = clock.Id.ToString("N")[..6];
        await next(ctx);
    }
}
app.UseMiddleware<ConventionMiddleware>();
```

O formato baseado em factory implementa `IMiddleware`, é resolvido do container a
cada requisição e por isso pode receber serviços scoped no construtor. Ele
precisa ser registrado, e esquecer isso falha por requisição, não na
inicialização:

```text
(sem AddScoped<StampMiddleware>)  GET /env -> 500 caught: No service for type 'StampMiddleware' has been registered.
```

Duas regras valem para os dois. Não mude o status code nem cabeçalhos depois que
a resposta começou (`Response.HasStarted`), e não chame `next` depois de ter
escrito a resposta.

### Ambientes e launch settings

O nome do ambiente vem de `ASPNETCORE_ENVIRONMENT`, e sem ele o padrão é
`Production`; a execução acima imprimiu `Production` para
`app.Environment.EnvironmentName`. O `Properties/launchSettings.json` é um
arquivo de ferramenta: `dotnet run` e a IDE o leem para definir variáveis de
ambiente e URLs, e um app publicado não o usa. Veja o conceito de configuração
para saber como o ambiente escolhe o `appsettings.{Environment}.json`. No
`Program.cs`, use `app.Environment.IsDevelopment()` para ramos como a página de
exceção do desenvolvedor, e deixe o comportamento de produção como o caminho
incondicional.

## Trade-offs

- **A ordem é estado global num arquivo só.** Mover o `UseCors` uma linha muda
  todos os endpoints, e nada deixa de compilar.
  ```csharp
  app.UseAuthentication();
  app.UseCors();            // depois da autenticação: um preflight sem credenciais recebe 401
  ```
- **Um `Run` terminal no meio esconde tudo abaixo dele, inclusive os
  endpoints.** Reserve-o para ramos dentro de `Map`, não para o pipeline
  principal.
- **Lambdas inline são rápidas, mas não reutilizáveis e difíceis de testar.**
  Passando de poucas linhas, uma classe por convenção com `InvokeAsync` pode ser
  testada com um `HttpContext` falso.
- **O middleware por convenção é criado uma vez.** Injetar um serviço scoped no
  construtor ou falha na inicialização ou captura uma instância pela vida toda
  do app; use parâmetros de `InvokeAsync` ou `IMiddleware`.
- **Middleware vale para toda requisição, endpoint filter para um endpoint.**
  Use middleware para preocupações do host inteiro e um endpoint filter quando a
  lógica depende dos argumentos tipados de um handler.

## Documentation Links

- [ASP.NET Core Middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) (doc)
- [Write custom ASP.NET Core middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/write) (doc)
- [WebApplication and WebApplicationBuilder in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/webapplication) (doc)
- [Use multiple environments in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/environments) (doc)
- [Factory-based middleware activation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/extensibility) (doc)
