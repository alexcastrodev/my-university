---
version: 1.0
updatedAt: 2026-10-28
title: "Controllers MVC, filtros e model binding"
summary: Web APIs com controllers no ASP.NET Core 10: o que o ApiController liga e como desligar, fontes e precedência do model binding, falhas de binding, over-posting com entidade versus DTO, a ordem real do pipeline de filtros, escopos e Order, ServiceFilter versus TypeFilter, filtros de exceção versus middleware, ActionResult de T e o que mudou desde o ASP.NET MVC 5, com o resultado real de cada experimento.
---
## Objective

A maioria das APIs ASP.NET Core em produção, e a maioria das vagas que pedem ASP.NET Core, ainda usa controllers: classes que herdam de `ControllerBase`, registradas com `AddControllers` e mapeadas com `MapControllers`. Elas resolvem os mesmos problemas das Minimal APIs com outra maquinaria: `[ApiController]` liga respostas 400 automáticas e inferência da fonte de binding, o model binding lê rota, query, header, form e body por meio de value providers e input formatters, e um pipeline de filtros (authorization, resource, action, exception, result) envolve cada action. Cada peça tem regras fáceis de errar: um parâmetro complexo preenchido em silêncio pela query string, um parâmetro de entidade que deixa o chamador definir `IsAdmin`, um filtro de exceção sobrescrito por um global. Este conceito roda um app de controllers e registra o que cada requisição devolveu e quais métodos de filtro rodaram, em que ordem. Razor Pages, views, Tag Helpers e view components ficam fora do escopo (são uma lição posterior). Versões usadas: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (o MVC e o `Microsoft.Extensions.Validation` estão no shared framework, nenhum pacote necessário).

## Use Cases

- Manter ou estender uma API existente baseada em controllers, que ainda é o formato mais comum de código ASP.NET Core nas empresas.
- Colocar regras transversais (auditoria, checagem de tenant, formatação de resultado) em um filtro em vez de repetir em cada action.
- Aceitar escritas com segurança: fazer o binding do body em DTOs para que o chamador não altere campos que não são dele.
- Migrar uma aplicação ASP.NET MVC 5 ou Web API 2 sabendo quais conceitos sobreviveram.

## Deep Dive

### AddControllers, MapControllers e o que o `[ApiController]` liga

```csharp
builder.Services.AddControllers();   // depois do Build(): app.MapControllers();
public record CreateItem([Required] string? Name, [Range(1, 10)] int Quantity);

[ApiController, Route("api/items")]
public class ItemsController : ControllerBase
{
    [HttpPost] public object Create(CreateItem item) => new { item, valid = ModelState.IsValid };
}
```

Adicionei um `PlainController` com a mesma action, mas sem `[ApiController]`, e um filtro global que registra cada chamada `OnXxx`. A documentação lista o que o atributo adiciona: roteamento por atributo obrigatório, respostas HTTP 400 automáticas, inferência da fonte de binding, inferência de `multipart/form-data` para `IFormFile` e problem details para status de erro.

### 400 automático com `ValidationProblemDetails`

```text
POST /api/items {"quantity":50}
400 application/problem+json; charset=utf-8 {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"One or more validation errors occurred.","status":400,"errors":{"Name":["The Name field is required."],"Quantity":["The field Quantity must be between 1 and 10."]},"traceId":"0HNPL16EJJ4JH:00000001"}
trace: OnAuthorization > OnResourceExecuting > OnResultExecuting > OnResultExecuted > OnResourceExecuted
```

A action não rodou, e nem o meu filtro de action global: a checagem é feita pelo `ModelStateInvalidFilter`, um filtro de action cujo `Order` eu li como -2000, então ele interrompe antes dos filtros com a ordem padrão 0. O corpo de exemplo da documentação ainda mostra um link `rfc7231`; o 10.0.0 escreveu `rfc9110`. Sem `[ApiController]`, nada impede a action e você precisa checar `ModelState.IsValid` por conta própria.

### Inferência da fonte de binding, `[FromBody]` e ProblemDetails

O mesmo JSON enviado aos dois controllers, depois um 404 de `NotFound()` em cada um:

```text
POST /api/items   {"name":"pen","quantity":2} -> 200 {"item":{"name":"pen","quantity":2},"valid":true}
POST /plain/items {"name":"pen","quantity":2} -> 200 {"item":{"name":null,"quantity":0},"valid":false,"errors":2}
POST /plain/items?name=pen&quantity=2         -> 200 {"item":{"name":"pen","quantity":2},"valid":true,"errors":0}
GET /api/items/0   -> 404 application/problem+json {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found","status":404,"traceId":"..."}
GET /plain/items/0 -> 404 (no content type, empty body)
```

O `[ApiController]` inferiu `[FromBody]` para o parâmetro complexo. O controller comum preencheu o parâmetro com valores de form, rota e query, ignorou o JSON e ainda devolveu 200: o clássico bug do "meu body sempre chega null". A documentação lista as regras de inferência: tipos complexos registrados na DI viram `[FromServices]`, os outros tipos complexos `[FromBody]`, `IFormFile` vira `[FromForm]`, nomes presentes em um template de rota `[FromRoute]` e todo o resto `[FromQuery]`. Tipos simples nunca são inferidos do body. Um body inferido também é obrigatório:

```text
POST /api/items (no body, no Content-Type) -> 415 {"title":"Unsupported Media Type","status":415,...}
POST /api/items (empty body, application/json) -> 400 {"errors":{"":["A non-empty request body is required."],"item":["The item field is required."]},...}
```

A documentação só menciona o caso 400; sem `Content-Type` eu recebi 415 antes.

O roteamento por atributo é exigido na inicialização. Um `[ApiController]` sem `[Route]`, mapeado com `MapControllerRoute("default", "{controller}/{action}")`, lançou a exceção nessa chamada:

```text
System.InvalidOperationException: Action 'NoRouteController.Index (Lab)' does not have an attribute route. Action methods on controllers annotated with ApiControllerAttribute must be attribute routed.
```

### Desligando os comportamentos

```csharp
builder.Services.Configure<ApiBehaviorOptions>(o =>
{
    o.SuppressModelStateInvalidFilter = true;          // sem 400 automático
    o.SuppressInferBindingSourcesForParameters = true; // sem inferência
    o.SuppressMapClientErrors = true;                  // sem ProblemDetails para NotFound() etc.
});
```

```text
POST /api/items {"quantity":50}          -> 200 {"item":{"name":null,"quantity":0},"valid":false}
POST /api/items?name=pen&quantity=2      -> 200 {"item":{"name":"pen","quantity":2},"valid":true}
GET /api/items/0                         -> 404 (empty body)
```

Com a inferência desligada, o body nem foi lido (`quantity` é 0, não 50) e a action rodou com um modelo inválido. Desligue essas opções uma de cada vez e só de propósito.

### Fontes de binding e precedência

```csharp
[HttpPost("sources/{id}")]
public object Sources([FromRoute] int id, [FromQuery] string sort, [FromHeader(Name = "X-Tenant")] string tenant,
    [FromBody] CreateItem body, [FromServices] TimeProvider clock) => new { id, sort, tenant, body, clock = clock.GetType().Name };
```

```text
POST /api/items/sources/5?sort=name, X-Tenant: acme, {"name":"pen","quantity":2}
200 {"id":5,"sort":"name","tenant":"acme","body":{"name":"pen","quantity":2},"clock":"SystemTimeProvider"}
POST /api/items/form (form name=pen&quantity=3, [FromForm] CreateItem) -> 200 {"name":"pen","quantity":3}
POST /api/items (same form, inferred body) -> 415 Unsupported Media Type
```

Sem atributos, a documentação dá a ordem: campos de form, body (só com `[ApiController]`), dados de rota, query string, arquivos. Enviei o mesmo `id` de três formas para `Prec(int id)` em `/prec/{id}`:

```text
plain, POST /plain/prec/1?id=2 with form id=3 -> {"id":3}
plain, POST /plain/prec/1?id=2 without form  -> {"id":1}
api,   POST /api/items/prec/1?id=2 with form id=3 -> {"id":1}
```

Em um controller comum, um campo de form vence o valor da rota, o que importa quando o id da URL foi autorizado mas o form diz outra coisa. O `[ApiController]` fixou `id` na rota. Dois parâmetros de body falham na inicialização, a partir de `MapControllers()`:

```text
System.InvalidOperationException: Action 'TwoBodiesController.Post (Lab)' has more than one parameter that was specified or inferred as bound from request body. Only one parameter per action may be bound from body. Inspect the following parameters, and use 'FromQueryAttribute' to specify bound from query, 'FromRouteAttribute' to specify bound from route, and 'FromBodyAttribute' for parameters to be bound from body:
CreateItem a
CreateItem b
```

### Quando o binding falha: conversão, `[BindRequired]`, `[BindNever]`

```text
GET /api/items/page?page=abc -> 400 {"errors":{"page":["The value 'abc' is not valid."]}}
GET /api/items/page          -> 200 {"page":0}
POST /api/items {"name":"pen","quantity":"abc"} -> 400 {"errors":{"item":["The item field is required."],"$.quantity":["The JSON value could not be converted to CreateItem. Path: $.quantity | LineNumber: 0 | BytePositionInLine: 30."]}}
GET /api/items/req (Req([BindRequired] int page)) -> 400 {"errors":{"page":["A value for the 'page' parameter or property was not provided."]}}
GET /api/items/req?page=0 -> 200 {"page":0}
```

Um `int` ausente vira 0 em silêncio; `[BindRequired]` distingue "ausente" de "0". O erro de JSON cita o record (`CreateItem`), não `int`, e o body que falhou acrescenta um segundo erro de "field is required". A documentação diz que `[BindRequired]`, `[BindNever]` e `[Bind]` valem só para binding de form e de value providers, não para input formatters (JSON, XML); a próxima seção mostra o que isso significa.

### Over-posting: parâmetro de entidade versus DTO

```csharp
public class User { public int Id { get; set; } public string Name { get; set; } = ""; [BindNever] public bool IsAdmin { get; set; } }

[HttpPut("{id}/entity")] public User PutEntity(int id, User user) { user.Id = id; Db[id] = user; return user; }
[HttpPut("{id}/dto")]    public User PutDto(int id, UpdateUserDto dto) { Db[id].Name = dto.Name; return Db[id]; }
public record UpdateUserDto([Required] string Name);
```

```text
GET /api/users/1                                         -> {"id":1,"name":"alice","isAdmin":false}
PUT /api/users/1/entity {"name":"mallory","isAdmin":true} -> {"id":1,"name":"mallory","isAdmin":true}
GET /api/users/1                                         -> {"id":1,"name":"mallory","isAdmin":true}
PUT /api/users/2/dto    {"name":"mallory","isAdmin":true} -> {"id":2,"name":"mallory","isAdmin":false}
PUT /api/users/3/form   name=mallory&isAdmin=true ([FromForm] User) -> {"id":3,"name":"mallory","isAdmin":false}
```

O chamador virou admin pela entidade, embora `IsAdmin` tenha `[BindNever]`: o System.Text.Json não lê atributos de binding do MVC. O `[BindNever]` só funcionou no form. O DTO não tem `IsAdmin`, então a propriedade extra do JSON foi descartada e a entidade armazenada manteve `false`; esse é o argumento de `dtos-and-the-api-contract`. Para rejeitar propriedades desconhecidas em vez de ignorá-las, defini `UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow` em `AddJsonOptions`:

```text
400 {"errors":{"dto":["The dto field is required."],"$.isAdmin":["The JSON property 'isAdmin' could not be mapped to any .NET member contained in type 'UpdateUserDto'."]}}
```

### O pipeline de filtros, rastreado

Um filtro global implementa `IAuthorizationFilter`, `IResourceFilter`, `IActionFilter`, `IExceptionFilter` e `IResultFilter`; o parâmetro da action é um tipo `IParsable<T>` cujo `TryParse` registra "model binding". Quatro requisições:

```text
ok:       OnAuthorization > OnResourceExecuting > model binding > OnActionExecuting > ACTION > OnActionExecuted(exception=none, canceled=False) > OnResultExecuting > OnResultExecuted > OnResourceExecuted
throws:   OnAuthorization > OnResourceExecuting > model binding > OnActionExecuting > ACTION throws > OnActionExecuted(exception=InvalidOperationException, canceled=False) > OnException(handled=False, result=null) > OnResourceExecuted
?block=1: OnAuthorization > OnResourceExecuting > model binding > OnActionExecuting > OnResultExecuting > OnResultExecuted > OnResourceExecuted   (409 from c.Result in OnActionExecuting)
?deny=1:  OnAuthorization   (403 from c.Result in OnAuthorization)
```

Filtros de resource envolvem o model binding, então podem interromper antes de o body ser lido (cache, feature flags). Quando a action lançou exceção, `OnActionExecuted` viu a exceção, o filtro de exceção escreveu o 500 e os filtros de result não rodaram, como diz a documentação. Um filtro de action que define `Result` pula a action e o próprio `OnActionExecuted`, mas os filtros de result ainda rodam. O resultado de um filtro de authorization pula todo o resto.

### Escopo e `Order`

`NamedFilter` é um `IAsyncActionFilter` (`before`, `await next()`, `after`), aplicado globalmente, no controller, na action e mais uma vez na action com `Order = -1`:

```text
OnAuthorization > OnResourceExecuting > action-order-minus1 before > OnActionExecuting > global before > controller before > action before > ACTION > action after > controller after > global after > OnActionExecuted(exception=none, canceled=False) > action-order-minus1 after > OnResultExecuting > OnResultExecuted > OnResourceExecuted
```

A ordem padrão é global, controller, action, com o código "after" invertido. Um `Order` menor vence o escopo: o filtro de action com -1 rodou por fora dos dois filtros globais (`Order` 0).

### Atributo versus `TypeFilter` versus `ServiceFilter`

O construtor de cada filtro incrementava um contador; enviei 3 requisições para cada endpoint:

```text
constructed before count requests: attribute=2
constructed: attribute=2, service-scoped=3, service-singleton=1, type=3, type-reusable=1
```

Um filtro atributo é um objeto construído quando o app monta seus action descriptors (duas vezes na minha execução, ambas na inicialização), compartilhado por todas as requisições, então não pode receber injeção pelo construtor. `[TypeFilter(typeof(F))]` cria `F` a cada requisição com `ObjectFactory`: `F` não precisa estar registrado, suas dependências vêm da DI e `Arguments` preenche o resto. `[ServiceFilter(typeof(F))]` resolve `F` pela DI, então o lifetime registrado decide (scoped: um por requisição; singleton: um só). `IsReusable = true` fez o `TypeFilter` criar uma única instância para todas as requisições; a documentação alerta para não combinar isso com dependências que não sejam singleton.

### Filtros de exceção versus middleware de tratamento de exceções

O `ErrorsController` tem um `IExceptionFilter` no escopo do controller que transforma `KeyNotFoundException` em 404; o app também tem `UseExceptionHandler()` com `AddProblemDetails()`, e o meu filtro global de trace (que escreve 500 se ninguém definiu um resultado):

```text
GET /x/action -> 404 {"title":"order 42","status":404}
trace: ... OnActionExecuted(exception=KeyNotFoundException, canceled=False) > ApiExceptionFilter handled KeyNotFoundException > OnException(handled=False, result=NotFoundObjectResult) > OnResourceExecuted
GET /x/action?mark=1 (filter also sets ExceptionHandled = true) -> 404 {"title":"order 42","status":404}
trace: ... OnActionExecuted(exception=KeyNotFoundException, canceled=False) > ApiExceptionFilter handled KeyNotFoundException > OnResourceExecuted
GET /x/result (IActionResult throws in ExecuteResultAsync) -> 500 application/problem+json {"title":"An error occurred while processing your request.","status":500,...}
trace: ... OnActionExecuted(exception=none, canceled=False) > OnResultExecuting > OnResultExecuted > OnResourceExecuted
```

O filtro do controller rodou primeiro, e definir só `Result` não impediu o filtro de exceção global, que poderia ter sobrescrito a resposta; `ExceptionHandled = true` impediu. Uma exceção durante a execução do result pulou todos os filtros de exceção, como diz a documentação. A documentação recomenda middleware, e filtros de exceção só quando o tratamento precisa variar por action (JSON para APIs, HTML para views). Prefira `IExceptionHandler` e problem details (`problem-details-and-global-exception-handling`): um lugar só para controllers, Minimal APIs e middleware.

### `ActionResult<T>` e `IActionResult`

```csharp
[HttpGet("typed/{id}")] public ActionResult<CreateItem> Typed(int id) => id == 0 ? NotFound() : new CreateItem("pen", id);
```

```text
GET /x/typed/1 -> 200 {"name":"pen","quantity":1}
GET /x/typed/0 -> 404 application/problem+json {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found","status":404,...}
```

Conversões implícitas deixam a action devolver `T` ou qualquer `ActionResult`, e a documentação observa que o tipo da resposta é inferido de `T`, então `[ProducesResponseType(200)]` dispensa o `Type`. `IActionResult` esconde o tipo do payload, então precisa de `[ProducesResponseType(200, Type = typeof(T))]`. Interfaces como `IEnumerable<T>` não convertem implicitamente; devolva um tipo concreto, como uma lista.

### Controllers versus Minimal APIs, mesmo endpoint

| | Controllers | Minimal APIs |
|---|---|---|
| Binding | Value providers, input formatters, inferência com `[ApiController]`; form vence rota em controllers comuns | Regras fixas por parâmetro, veja `parameter-binding-and-endpoint-filters` |
| Validação | Data annotations ligadas por padrão; 400 automático com `[ApiController]` | Só depois de `AddValidation()` (`input-validation-in-minimal-apis`) |
| Filtros | Cinco estágios de filtro mais escopos global, controller e action | Só endpoint filters, por endpoint ou grupo |
| Roteamento | Rotas por atributo (`[Route]`, `[HttpGet]`) | `MapGet`, route groups |
| Testabilidade | Actions são métodos de uma classe que você instancia | Handlers são delegates; `TypedResults` os torna testáveis em unidade |

Enviei `{"quantity":50}` para `app.MapPost("/min/items", (CreateItem item) => ...)`: 200 sem validação, 400 com `ValidationProblemDetails` depois de `AddValidation()`. Uma esquisitice no 10.0.0: `GET /min/page?page=abc` (um parâmetro `int`) devolveu 400 com body vazio, mas com `AddValidation()` registrado o handler rodou mesmo assim e a resposta foi 400 com body `{"page":0}`. Para escolher entre os modelos, veja `choosing-an-aspnet-core-application-model`.

### Livro versus hoje: o que mudou desde o ASP.NET MVC 5 (exame 70-486)

- O `System.Web` não existe mais: não encontrei nenhum assembly `System.Web` carregado, e `ControllerBase.Request` é `Microsoft.AspNetCore.Http.HttpRequest`, enquanto o `Controller.Request` do MVC 5 era `System.Web.HttpRequestBase`. `Request.Query` é a coleção; `Request.QueryString` é a string crua. Fora de um controller, a documentação recomenda `IHttpContextAccessor` em vez de `HttpContext.Current`.
- A documentação de migração afirma que HTTP modules, `Global.asax.cs`, Web.config (exceto a configuração do IIS) e o ciclo de vida da aplicação deixaram de existir; modules e handlers viram middleware configurado em código (`Program.cs`), e as configurações vão para `appsettings.json`.
- MVC e Web API são um framework só: `ApiController` e `IHttpActionResult` viram `ControllerBase` e `ActionResult<T>`.
- Bundling: a documentação diz que o ASP.NET Core não tem bundling e minificação nativos (não há `BundleConfig`); use ferramentas de front-end.
- Antiforgery: `[HttpPost]` sozinho não valida nada. Meu POST de form para uma action `[FromForm]` sem token recebeu 200 com `AddControllers`. Para views, a documentação recomenda registrar `AutoValidateAntiforgeryTokenAttribute` globalmente em vez de `[ValidateAntiForgeryToken]` action por action.

## Trade-offs

- **`[ApiController]` é o padrão seguro.** Sem ele, um body JSON não preenche nada e a action roda com um modelo inválido e devolve 200.
- **Nunca faça binding de entidades.** `[BindNever]` e `[Bind]` não afetam bodies JSON; um DTO por caso de uso é a única correção confiável para over-posting.
  ```csharp
  public record UpdateUserDto([Required] string Name);   // nenhum IsAdmin para definir
  ```
- **Saiba qual fonte vence.** Em um controller comum, um campo de form sobrescreveu o id da rota; fixe valores sensíveis para segurança com `[FromRoute]`.
- **O lifetime do filtro é uma escolha.** Atributos são instâncias compartilhadas, `TypeFilter` é por requisição, `ServiceFilter` segue o registro na DI; uma dependência scoped dentro de um filtro reutilizado é bug.
- **Filtros de exceção são mais limitados que middleware.** Eles não pegam a execução do result, filtros de resource nem nada fora do MVC, e um filtro posterior pode sobrescrever seu resultado a menos que você defina `ExceptionHandled`.
- **Mais maquinaria que Minimal APIs.** Value providers, convenções e cinco estágios de filtro custam trabalho na inicialização e tempo de aprendizado; serviços novos e pequenos costumam começar com Minimal APIs, e código de controllers existente não precisa ser reescrito.

## Documentation Links

- [Create web APIs with ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/web-api/?view=aspnetcore-10.0) (doc)
- [Filters in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters?view=aspnetcore-10.0) (doc)
- [Model Binding in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/model-binding?view=aspnetcore-10.0) (doc)
- [Model validation in ASP.NET Core MVC and Razor Pages, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation?view=aspnetcore-10.0) (doc)
- [Controller action return types in ASP.NET Core web API, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/web-api/action-return-types?view=aspnetcore-10.0) (doc)
- [Migrate HTTP modules to ASP.NET Core middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/fx-to-core/areas/http-modules?view=aspnetcore-10.0) (doc)
