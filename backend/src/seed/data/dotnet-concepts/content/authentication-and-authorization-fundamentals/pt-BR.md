---
version: 1.0
updatedAt: 2026-10-15
title: "Fundamentos de Autenticação e Autorização"
summary: Esquemas e handlers, challenge versus forbid, cookie versus bearer e a mudança de redirect do .NET 10, claims, roles e policies, autorização baseada em recurso e os erros de ordem no pipeline, com o 401/403 real de cada requisição.
---
## Objective

Autenticação responde "de quem é esta requisição?" e autorização responde
"esse chamador pode fazer isto?". O ASP.NET Core separa as duas de propósito:
um **esquema** de autenticação transforma um cookie ou um header em um
`ClaimsPrincipal`, e as **policies** de autorização decidem em cima desse
principal. O objetivo é ler a configuração de segurança de um app e prever, para
qualquer requisição, se ela recebe 200, 401, 403 ou um redirect, e por quê.
Todos os status codes deste conceito vieram de requisições reais contra um app
.NET 10 (SDK 10.0.100).

## Use Cases

- Proteger uma minimal API ou um app renderizado no servidor com
  `RequireAuthorization()` e policies nomeadas, em vez de `if` espalhados pelos
  handlers.
- Escolher entre cookie (navegador no mesmo site) e bearer token (API chamada
  por outros programas), ou registrar os dois.
- Deixar o app seguro por padrão: um endpoint novo nasce fechado até alguém
  marcá-lo como público.
- Regras que dependem do dado acessado ("só o dono edita este documento"), que
  uma checagem fixa de role não consegue expressar.

## Deep Dive

### Esquemas, handlers e as três ações

`AddAuthentication` registra o serviço de autenticação, e cada chamada como
`AddCookie` ou `AddJwtBearer` registra um **esquema**: um nome ligado a um
handler e às opções dele. Segundo a visão geral de autenticação da Microsoft, o
handler tem três trabalhos:

- **Authenticate**: montar o usuário a partir da requisição (decifrar o cookie,
  validar o token) ou responder "sem resultado" ou "falha".
- **Challenge**: responder a um chamador anônimo que bateu em um recurso
  protegido. O handler de cookie redireciona para a página de login; o de JWT
  bearer devolve 401 com `WWW-Authenticate: Bearer`.
- **Forbid**: responder a quem está autenticado mas não tem permissão. O
  handler de cookie redireciona para uma página de acesso negado; o de bearer
  devolve 403.

Com um único esquema registrado, ele vira o padrão. Com vários, você define o
padrão em `AddAuthentication("...")` ou nomeia o esquema na policy; senão o
framework lança "No authenticationScheme was specified".

Um detalhe que pega quem escreve handler próprio: um `ClaimsIdentity` só conta
como autenticado se tiver um authentication type. Rodando no app, as duas linhas
abaixo imprimiram `False` e depois `True`:

```csharp
new ClaimsIdentity([new Claim(ClaimTypes.Name, "x")]).IsAuthenticated          // False
new ClaimsIdentity([new Claim(ClaimTypes.Name, "x")], "demo").IsAuthenticated  // True
```

### O app do experimento

O app abaixo usa o esquema de cookie, uma fallback policy, uma policy de role,
uma de claim, um requirement próprio e uma checagem baseada em recurso. O
endpoint `/login` autentica qualquer um que pedir: ele existe só para gerar
usuários no experimento e nunca deve ir para produção. O `PublishAot=false` está
ali porque file-based apps usam Native AOT por padrão, e sem ele o app caiu na
inicialização ao serializar o tipo anônimo devolvido por `/me`.

```csharp
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie();
builder.Services.AddSingleton<IAuthorizationHandler, MinimumAgeHandler>();
builder.Services.AddSingleton<IAuthorizationHandler, OwnerHandler>();
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("AdminOnly", p => p.RequireRole("admin"))
    .AddPolicy("Sales", p => p.RequireClaim("department", "sales"))
    .AddPolicy("Adult", p => p.AddRequirements(new MinimumAgeRequirement(18)));
var app = builder.Build();

app.MapPost("/login", async (HttpContext ctx, string name, string? role, string? dept, int? age) =>
{   // SÓ PARA DEMO: não confere senha
    var claims = new List<Claim> { new(ClaimTypes.Name, name) };
    if (role is not null) claims.Add(new(ClaimTypes.Role, role));
    if (dept is not null) claims.Add(new("department", dept));
    if (age is not null) claims.Add(new("age", age.Value.ToString()));
    await ctx.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok();
}).AllowAnonymous();
app.MapGet("/public", () => "anyone").AllowAnonymous();
app.MapGet("/fallback", () => "covered by the fallback policy");
app.MapGet("/text", () => "plain text").RequireAuthorization();
app.MapGet("/me", (ClaimsPrincipal user) => new { user.Identity!.Name, IsAdmin = user.IsInRole("admin"),
    Claims = user.Claims.Select(c => $"{c.Type}={c.Value}") }).RequireAuthorization();
app.MapGet("/admin", () => new { ok = "admin" }).RequireAuthorization("AdminOnly");
app.MapGet("/adult", () => new { ok = "adult" }).RequireAuthorization("Adult");
```

Não há chamada a `UseAuthentication()` nem a `UseAuthorization()`: o
`WebApplication` adiciona os dois depois do roteamento quando os serviços estão
registrados (veja o conceito do pipeline de middleware). Resultados, com `ana`
(role admin, 30 anos) e `bob` (sem role, 16 anos):

```text
anonymous  GET /public    -> 200 anyone
anonymous  GET /fallback  -> 302 Location: /Account/Login?ReturnUrl=%2Ffallback
anonymous  GET /text      -> 302 Location: /Account/Login?ReturnUrl=%2Ftext
anonymous  GET /me        -> 401 (Location header still present)
ana        GET /admin     -> 200 {"ok":"admin"}
bob        GET /admin     -> 403
bob        GET /adult     -> 403
```

Tem três lições nessa tabela. `/fallback` não tem metadado nenhum de
autorização e mesmo assim está protegido, por causa da fallback policy. 401
quer dizer "não sei quem você é" (challenge) e 403 quer dizer "sei quem você é,
e a resposta é não" (forbid). E o handler de cookie responde diferente para
`/text` e para `/me`, o que a próxima seção explica.

### Cookie versus bearer, e a mudança de redirect do .NET 10

O navegador manda o cookie sozinho, o que combina com páginas renderizadas no
servidor e front ends no mesmo site. O cookie que o app emitiu foi
`.AspNetCore.Cookies=...; path=/; samesite=lax; httponly`: o JavaScript não
consegue lê-lo, e o conteúdo é cifrado com o key ring do Data Protection, então
várias instâncias atrás de um load balancer precisam compartilhar esse key ring.
Como o navegador anexa o cookie por conta própria, endpoints autenticados por
cookie que alteram estado também precisam de proteção antiforgery. Já o bearer
token é anexado pelo chamador no header `Authorization`, o que combina com APIs
chamadas por programas e apps mobile; o conceito de JWT bearer continua daí.

Antes do .NET 10, o handler de cookie redirecionava todo challenge e todo
forbid para uma página de login ou de acesso negado, exceto em requisições XHR.
A partir do .NET 10, endpoints reconhecidos como API recebem 401 e 403. A nota
de breaking change lista quais são: actions com `[ApiController]`, minimal APIs
que leem ou escrevem JSON, endpoints que usam `TypedResults` e SignalR. Por isso
`/me` (JSON) devolveu 401 e `/text` (string simples) devolveu 302. O 401 ainda
traz o header `Location`; só o status mudou. Dá para forçar um comportamento ou
outro por endpoint, e os dois foram conferidos:

```text
.RequireAuthorization().DisableCookieRedirect()         GET /text  -> 401
.RequireAuthorization("AdminOnly").AllowCookieRedirect() GET /admin -> 302 to /Account/Login
```

### Claims, roles e policies

Uma role é uma claim do tipo `ClaimTypes.Role`; `RequireRole("admin")` e
`user.IsInRole("admin")` leem essa claim. O `/me` mostrou como as claims ficam
dentro do principal:

```text
http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name=ana
http://schemas.microsoft.com/ws/2008/06/identity/claims/role=admin
department=sales
age=30
```

Uma **policy** é uma lista de requirements, e todos precisam passar (E). Um
requirement pode ter vários handlers, e basta um chamar `Succeed` para
satisfazê-lo (OU), a não ser que algum handler chame `Fail`, que força a falha.
Um handler que não chama nenhum dos dois deixa o requirement pendente, e
pendente é falha. Por padrão todos os handlers rodam mesmo depois de uma falha
(`InvokeHandlersAfterFailure` é `true`), e a documentação avisa que a ordem
entre eles não é garantida.

```csharp
class MinimumAgeHandler : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, MinimumAgeRequirement req)
    {
        if (int.TryParse(ctx.User.FindFirst("age")?.Value, out var age) && age >= req.Age)
            ctx.Succeed(req);
        return Task.CompletedTask;   // sem Succeed: requirement fica pendente, bob leva 403
    }
}
```

A escolha da policy segue os metadados: sem metadado, vale a fallback policy
(que por padrão é `null`, ou seja, aberto); `RequireAuthorization()` sem nome
usa a default policy (usuário autenticado); uma policy nomeada substitui as
duas. `AllowAnonymous()` tira o endpoint da regra. A fallback policy só se
aplica a requisições que chegam ao middleware de autorização, então arquivos
estáticos servidos antes dele no pipeline ficam de fora.

### Autorização baseada em recurso

"Só o dono lê este documento" depende de um dado que o endpoint carrega, então
não cabe em um atributo. Injete `IAuthorizationService` e passe o recurso:

```csharp
app.MapGet("/doc/{owner}", async Task<Results<Ok<string>, ForbidHttpResult>>
    (string owner, ClaimsPrincipal user, IAuthorizationService authz) =>
{
    var result = await authz.AuthorizeAsync(user, owner, new OwnerRequirement());
    return result.Succeeded ? TypedResults.Ok(owner) : TypedResults.Forbid();
}).RequireAuthorization();

class OwnerHandler : AuthorizationHandler<OwnerRequirement, string>   // registrado como IAuthorizationHandler
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, OwnerRequirement req, string owner)
    {
        if (ctx.User.Identity?.Name == owner) ctx.Succeed(req);
        return Task.CompletedTask;
    }
}
```

Com `TypedResults` o endpoint conta como API: o anônimo recebeu 401, o `bob`
pedindo o documento da `ana` recebeu 403 e o próprio documento, 200. A primeira
versão usava `Results.Ok(...)` e `Results.Forbid()`, e a mesma requisição
proibida devolveu um 302 para `/Account/AccessDenied`, porque o endpoint não foi
reconhecido como API.

### Erros de ordem e de registro

Se você mesmo chama os middlewares, a ordem é `UseRouting`,
`UseAuthentication`, `UseAuthorization`. Trocar os dois últimos compilou, subiu
e devolveu 401 para `/me` mesmo com cookie válido: a autorização rodou antes de
alguém ler o cookie. Deixar de fora tanto `AddAuthentication` quanto
`AddAuthorization` também sobe normalmente e falha a cada requisição com 500:
"Endpoint HTTP: GET /me contains authorization metadata, but a middleware was
not found that supports authorization." Nenhum dos dois erros aparece no build,
então teste um endpoint protegido com e sem credencial.

## Trade-offs

- **Fallback policy versus opt-in.** Seguro por padrão protege todo endpoint
  novo, mas health checks e páginas de login precisam de `AllowAnonymous()`
  explícito, e arquivos estáticos antes do middleware de autorização continuam
  públicos.
- **Roles versus policies.** `RequireRole` é rápido, mas espalha nomes de role
  pelos endpoints. Policies nomeadas deixam a regra em um lugar só.
  ```csharp
  .RequireAuthorization("AdminOnly")   // a regra muda uma vez, não em cada endpoint
  ```
- **Cookie versus bearer.** Cookies são automáticos, `HttpOnly` e simples para
  navegador, mas trazem CSRF e o compartilhamento de chaves do Data Protection.
  Bearer tokens evitam CSRF, mas o cliente precisa guardá-los e anexá-los.
- **Um cookie válido sobrevive a uma conta desativada.** Segundo a documentação
  de cookies, o cookie é a única fonte de identidade até expirar. O evento
  `ValidatePrincipal` pode reconsultar o cadastro, com custo em toda
  requisição.
- **Redirect versus status code.** O .NET 10 decide por endpoint a partir dos
  metadados. Um endpoint que devolve `IResult` simples continua redirecionando;
  marque com `DisableCookieRedirect()` ou use `TypedResults` se o cliente espera
  401/403.
- **Checagem por recurso custa uma consulta.** `IAuthorizationService` com a
  entidade carregada é preciso, mas o endpoint precisa carregar o dado antes de
  decidir, e ainda cabe escolher entre 403 e um 404 que não revela que o recurso
  existe.

## Lab

Neste lab você recebe uma API em que os endpoints já existem, mas não há segurança nenhuma: todo endpoint protegido responde `500` porque nenhum serviço de autenticação ou autorização está registrado. O seu trabalho é ligar o esquema de cookie, uma fallback policy, policies por role, por claim e por requisito customizado, e uma checagem baseada em recurso. A ideia central é conseguir prever, para cada requisição, se ela recebe 200, 401, 403 ou um redirect, e explicar por quê.

**O cenário**

O endpoint `/login` assina qualquer um sem senha (só para demonstração, nunca deve ir para produção), para os testes criarem `ana` (role `admin`, departamento `sales`, 30 anos) e `bob` (16 anos) com um cookie de verdade. Sem Docker e sem provedor de identidade externo. Tudo vive em `Program.cs` e `Requirements.cs`.

- `/public`, `/fallback`, `/text`, `/text-401`, `/me`: endpoints para comparar anônimo, fallback policy e política padrão.
- `/admin`, `/sales`, `/adult`: endpoints para as policies nomeadas.
- `/doc/{owner}`: usa `IAuthorizationService` para checar se o usuário é o dono do documento.
- `Requirements.cs`: `MinimumAgeRequirement` com o `MinimumAgeHandler`, e `OwnerRequirement` com o `OwnerHandler` (baseado em recurso).

O `/fallback` não tem metadados de propósito: só a fallback policy pode protegê-lo.

**O que você vai fazer, passo a passo**

1. **Registrar os serviços (TODO-00 e TODO-01).** Registre a autenticação com o esquema de cookie como padrão e registre `MinimumAgeHandler` e `OwnerHandler` como `IAuthorizationHandler` singleton.
2. **Fechar tudo por padrão (TODO-02).** Use `AddAuthorizationBuilder` e defina uma fallback policy que exige usuário autenticado, para que um endpoint sem metadado de autorização continue fechado.
3. **Criar as policies nomeadas (TODO-03).** `AdminOnly` (role `admin`), `Sales` (claim `department` igual a `sales`) e `Adult` (um `MinimumAgeRequirement` de 18).
4. **Assinar com uma identidade autenticada (TODO-04).** Em `/login`, uma identidade só conta como autenticada se tiver um tipo de autenticação. Crie-a com o nome do esquema de cookie e faça o sign-in do principal.
5. **Abrir e fechar endpoints (TODO-05, TODO-06 e TODO-07).** Deixe `/public` anônimo, exija usuário autenticado (a política padrão, sem nome) em `/text` e `/me`, e faça `/text-401` exigir autenticação mas responder 401 em vez de redirecionar para a tela de login.
6. **Anexar as policies (TODO-08).** Proteja `/admin`, `/sales` e `/adult` com a policy de mesmo nome.
7. **Escrever os handlers (TODO-09 e TODO-10).** `MinimumAgeHandler` lê a claim `age` e chama `context.Succeed(requirement)` quando ela é um número maior ou igual a `requirement.Age`; senão não faz nada (um requisito não atendido vira 403). `OwnerHandler` tem sucesso só quando o `Identity.Name` do usuário é igual ao recurso (o dono do documento).

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir olhar para qualquer endpoint e dizer 200, 401, 403 ou redirect, e explicar a diferença entre autenticação (quem é você) e autorização (o que pode fazer). Repare quais endpoints redirecionam para `/Account/Login` e quais respondem 401, e por quê, e por que um usuário sem a claim `age` recebe 403 em `/adult`.

**Desafios opcionais**

- **TODO-11:** adicione `/admin-redirect`, protegido por `AdminOnly`, que continua redirecionando um anônimo para o login mesmo devolvendo JSON (`AllowCookieRedirect`).
- **TODO-12:** nos testes, troque o esquema de cookie por um esquema de teste que autentica a partir de um header `X-Test-User` (`ConfigureTestServices`), para um teste não precisar chamar `/login`.

**Pré-requisitos:** Minimal APIs básicos, ordem dos middlewares (lab do pipeline) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. No estado inicial os endpoints protegidos respondem 500 e os testes falham, com cada TODO marcado em comentário em `Program.cs` e `Requirements.cs`.

## Documentation Links

- [Overview of ASP.NET Core Authentication, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/) (doc)
- [Policy-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies) (doc)
- [Authentication and authorization in minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/security) (doc)
- [Resource-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resource-based) (doc)
- [Use cookie authentication without ASP.NET Core Identity, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie) (doc)
- [Cookie login redirects are disabled for known API endpoints, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/10/cookie-authentication-api-endpoints) (doc)
