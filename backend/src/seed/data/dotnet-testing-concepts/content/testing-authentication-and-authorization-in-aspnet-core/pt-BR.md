---
version: 1.0
updatedAt: 2026-10-18
title: "Testando autenticação e autorização no ASP.NET Core"
summary: Um esquema de autenticação fake controlado por headers, 401 e 403 conferidos à parte, testes unitários de AuthorizationHandler e de policies via IAuthorizationService, JWT real assinado com chave de teste e uma auditoria de todos os endpoints.
---
## Objective

Testes de segurança falham de um jeito particular: continuam verdes. Uma suíte
que só chama a API como dono ou como admin prova que as pessoas certas entram,
e não diz nada sobre se todo o resto fica de fora. O objetivo é uma suíte
MSTest para uma API ASP.NET Core que testa autenticação e autorização pelo lado
que precisa ser recusado: um esquema de autenticação fake para que um teste
possa ser qualquer um (ou ninguém), asserções exatas de 401 e 403, testes
unitários do handler de autorização e das policies, alguns testes com JWTs
assinados de verdade para o que o fake não enxerga, e uma auditoria que falha
quando um endpoint é mapeado sem nenhuma decisão de autorização.

## Use Cases

- Provar que um usuário não consegue ler nem apagar a nota de outro, e que a
  nota continua lá depois da tentativa.
- Provar que uma policy baseada em role recusa todas as roles menos a que ela
  nomeia.
- Testar um `AuthorizationHandler` baseado em recurso em milissegundos, sem host.
- Pegar um erro de configuração do token (validade, audience, mapeamento de
  claims) antes da produção.
- Quebrar o build quando alguém adiciona um endpoint e esquece
  `RequireAuthorization()` ou `AllowAnonymous()`.

## Deep Dive

### Um esquema fake que o teste controla

A produção usa JWT bearer, e um teste não quer emitir um token para cada
request. Troque o esquema padrão por um handler que lê o chamador dos headers:

```csharp
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";
    public const string UserHeader = "X-Test-User";
    public const string RolesHeader = "X-Test-Roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserHeader, out var user) || string.IsNullOrWhiteSpace(user))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.ToString()) };
        var roles = Request.Headers[RolesHeader].ToString()
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }
}
```

Dois detalhes decidem se esse handler consegue testar alguma coisa. Sem header,
ele devolve `NoResult()`, então o request continua anônimo e a API pode
responder 401. O handler da documentação da Microsoft sempre autentica um "Test
user", o que serve quando todo teste precisa de um usuário e torna impossível
testar um 401. E a `ClaimsIdentity` recebe um tipo de autenticação
(`SchemeName`): sem ele, `IsAuthenticated` é `false` e todo request parece
anônimo.

A factory registra o esquema no `ConfigureTestServices` e o torna o padrão. Isso
roda depois do `Program.cs`, então substitui o JWT bearer para authenticate,
challenge e forbid:

```csharp
protected override void ConfigureWebHost(IWebHostBuilder builder)
{
    builder.UseSetting("Auth:SigningKey", SigningKey);

    if (useFakeAuthentication)
    {
        builder.ConfigureTestServices(services =>
            services.AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { }));
    }
}
```

O `Program.cs` se recusa a subir sem `Auth:SigningKey` e o lê antes do `Build`,
então a factory passa uma chave de teste com `UseSetting`, como no concept de
WebApplicationFactory. Dois helpers na factory deixam os testes curtos:
`Anonymous()` é um `CreateClient()` simples, e `ClientAs("bob", Roles.Moderator)`
adiciona os dois headers em `DefaultRequestHeaders`.

### 401 não é 403

401 quer dizer que a API não sabe quem você é; 403 quer dizer que ela sabe e a
resposta é não. O challenge padrão do esquema fake escreve um 401 e o forbid
padrão um 403, então os testes conseguem diferenciar os dois, e devem:

```csharp
[TestMethod]
public async Task ShouldReturn401ToAnAnonymousCaller()
{
    var response = await _api.Anonymous().GetAsync("/notes", Ct);

    Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
}

[TestMethod]
public async Task ShouldReturn403WhenAnotherUserReadsTheNote()
{
    var note = await CreateNoteAsAsync("alice", "buy milk");

    var response = await _api.ClientAs("bob").GetAsync($"/notes/{note.Id}", Ct);

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
}
```

`Assert.IsFalse(response.IsSuccessStatusCode)` passa para os dois, e para um
500. A diferença importa para os clientes: um 401 os manda logar de novo, um 403
não. Quando o próprio endpoint decide (autorização baseada em recurso, abaixo),
ele escolhe: `Results.Forbid()` para um usuário autenticado,
`Results.Challenge()` para um anônimo. Aqui o grupo `/notes` já exige um
usuário autenticado, então o endpoint só precisa do `Forbid`.

### Teste pelo lado que precisa ser recusado

O endpoint carrega a nota e pergunta ao serviço de autorização, porque a
decisão precisa da própria nota:

```csharp
notes.MapGet("/{id:int}", async (int id, ClaimsPrincipal user, NoteStore store, IAuthorizationService authorization) =>
{
    if (store.Find(id) is not { } note)
    {
        return Results.NotFound();
    }

    var result = await authorization.AuthorizeAsync(user, note, Policies.NoteOwner);
    return result.Succeeded ? Results.Ok(note) : Results.Forbid();
});
```

Um teste como Alice lendo a nota da Alice passa mesmo se o handler deixar todo
mundo entrar. Os testes que carregam a regra são os recusados, e numa escrita o
status é só metade da história:

```csharp
[TestMethod]
public async Task ShouldReturn403WhenAnotherUserDeletesTheNoteAndKeepIt()
{
    var note = await CreateNoteAsAsync("alice", "buy milk");

    var response = await _api.ClientAs("bob").DeleteAsync($"/notes/{note.Id}", Ct);

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    var stillThere = await _api.ClientAs("alice").GetAsync($"/notes/{note.Id}", Ct);
    Assert.AreEqual(HttpStatusCode.OK, stillThere.StatusCode);
}
```

O mesmo vale para roles. `/admin/stats` exige a policy `Admin`
(`RequireRole("admin")`). Chamar como admin prova que a porta abre; as linhas
que provam que ela fica fechada são um moderador e um usuário sem role:

```csharp
[TestMethod]
[DataRow(Roles.Moderator)]
[DataRow(null)]
public async Task ShouldReturn403OnAdminStatsToAnyoneWhoIsNotAnAdmin(string? role)
{
    var client = role is null ? _api.ClientAs("bob") : _api.ClientAs("bob", role);

    var response = await client.GetAsync("/admin/stats", Ct);

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
}
```

### Teste unitário do handler e das policies

O handler é uma classe comum. Monte o contexto que ele recebe e leia
`HasSucceeded`:

```csharp
private static async Task<bool> HandlerAllowsAsync(ClaimsPrincipal user, Note note)
{
    var requirement = new NoteOwnerRequirement();
    var context = new AuthorizationHandlerContext([requirement], user, note);

    await new NoteOwnerHandler().HandleAsync(context);

    return context.HasSucceeded;
}

[TestMethod]
public async Task TheHandlerShouldNotTreatAnAdminAsAModerator() =>
    Assert.IsFalse(await HandlerAllowsAsync(User("root", Roles.Admin), AlicesNote));
```

Isso testa o handler, não o registro: um nome de policy com erro de digitação,
ou um handler que nunca entrou no DI, continua passando. Um degrau acima, monte
o registro real numa `ServiceCollection` (a API o expõe como
`AddNotesAuthorization()`, a mesma chamada que o `Program.cs` faz) e use o
`IAuthorizationService`, ainda sem host:

```csharp
private static IAuthorizationService AuthorizationService() =>
    new ServiceCollection()
        .AddLogging()
        .AddNotesAuthorization()
        .BuildServiceProvider()
        .GetRequiredService<IAuthorizationService>();

[TestMethod]
[DataRow("alice", null, true)]
[DataRow("bob", null, false)]
[DataRow("carol", Roles.Moderator, true)]
public async Task TheNoteOwnerPolicyShouldDecideOnTheNote(string userId, string? role, bool expected)
{
    var user = role is null ? User(userId) : User(userId, role);

    var result = await AuthorizationService().AuthorizeAsync(user, AlicesNote, Policies.NoteOwner);

    Assert.AreEqual(expected, result.Succeeded);
}
```

O `AddLogging()` está ali porque o serviço de autorização padrão precisa de um
logger. O `AuthorizeAsync` tem uma sobrecarga com recurso (para `NoteOwner`) e
uma sem (para `Admin`).

### Audite todos os endpoints

O pior bug de autorização é o endpoint que ninguém testa, porque ninguém lembra
que ele existe. Testes de caminho feliz não o encontram. O sistema de
roteamento encontra: todo endpoint que a aplicação mapeou está no
`EndpointDataSource`, com os metadados dele. `RequireAuthorization()` e
`[Authorize]` adicionam `IAuthorizeData`; `AllowAnonymous()` adiciona
`IAllowAnonymous`:

```csharp
private static IReadOnlyList<RouteEndpoint> Endpoints(NotesApiFactory api) =>
    [.. api.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()];

[TestMethod]
public async Task EveryEndpointShouldRequireAuthorizationOrAllowAnonymousExplicitly()
{
    await using var api = new NotesApiFactory();

    var undecided = Endpoints(api)
        .Where(e => e.Metadata.GetMetadata<IAuthorizeData>() is null
                 && e.Metadata.GetMetadata<IAllowAnonymous>() is null)
        .Select(e => e.DisplayName)
        .ToList();

    Assert.IsEmpty(undecided, $"No authorization decision on: {string.Join(", ", undecided)}");
}
```

Um segundo teste protege a proteção: ele confere que a lista contém
`/notes/{id:int}`, `/admin/stats` e `/health`, porque uma lista vazia faria a
auditoria passar pelo motivo errado. Convenções de grupo contam: um endpoint
dentro de `MapGroup("/notes").RequireAuthorization()` carrega o metadado. O
complemento do lado da produção é `AuthorizationOptions.FallbackPolicy`, que
vale quando um endpoint não tem metadado de autorização e é `null` por padrão.
A auditoria e uma fallback policy respondem perguntas diferentes: a fallback
protege o endpoint esquecido, a auditoria obriga alguém a decidir.

### Tokens de verdade, para o que o fake não enxerga

O esquema fake nunca lê um token, então não percebe uma validade que não é
validada, uma audience errada ou uma claim mapeada para o tipo errado. Alguns
testes rodam o handler JWT bearer de produção (a factory sem o esquema fake)
com tokens assinados pela mesma chave de teste:

```csharp
private static string Token(string userId, string? role = null, string audience = NotesApiFactory.Audience,
    DateTime? expires = null)
{
    var claims = new Dictionary<string, object> { ["sub"] = userId };
    if (role is not null)
    {
        claims["role"] = role;
    }

    var now = DateTime.UtcNow;
    return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = NotesApiFactory.Issuer,
        Audience = audience,
        Claims = claims,
        IssuedAt = now.AddHours(-2),
        NotBefore = now.AddHours(-2),
        Expires = expires ?? now.AddMinutes(5),
        SigningCredentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(NotesApiFactory.SigningKey)),
            SecurityAlgorithms.HmacSha256),
    });
}
```

O `JsonWebTokenHandler` vem com o pacote
`Microsoft.AspNetCore.Authentication.JwtBearer`. Com o mapeamento de claims
padrão do handler, a claim `role` do token satisfaz `RequireRole("admin")` e
`sub` vira `ClaimTypes.NameIdentifier`, o que os testes do lab provam. Um token
que expirou há dez minutos (mais que os cinco minutos padrão de tolerância de
relógio) recebe 401 com `WWW-Authenticate: Bearer error="invalid_token",
error_description="The token expired at '...'"`, e um token para outra audience
também recebe 401. HS256 precisa de uma chave de pelo menos 256 bits, então a
chave de teste tem 32 caracteres (uma menor falha com `IDX10720`).

### Os testes protegem as regras?

Quebre o código de produção de propósito, uma mudança por vez. Estes são os
resultados para a solução do lab:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| A policy `Admin` vira `RequireAuthenticatedUser()` | as duas linhas não-admin do teste de 403, o teste unitário da policy de admin |
| `NoteOwnerHandler` aprova qualquer usuário | os dois testes HTTP de 403, dois testes do handler, a linha `bob` do teste da policy |
| `NoteOwnerHandler` esquece o moderador | o teste do moderador apagando, o teste do handler para moderador, a linha `carol` |
| `GET /notes/{id}` devolve `Challenge()` em vez de `Forbid()` | o teste de 403 "outro usuário lê" |
| Um novo `MapGet("/notes-export", ...)` sem autorização | só a auditoria de endpoints |
| `ValidateLifetime = false` | só o teste do token expirado |
| `DELETE` responde 204 sem remover a nota | o teste do moderador apagando (ele relê a nota) |

A suíte que só chama como dono e como admin passa nas três primeiras linhas. Só
a auditoria enxerga o endpoint esquecido, e só um token de verdade enxerga a
validade.

## Trade-offs

- **Um esquema fake testa autorização, não autenticação.** É rápido e deixa um
  teste ser qualquer um, e nunca valida uma assinatura, uma expiração ou uma
  audience. Mantenha um punhado de testes com token real para a configuração do
  handler de produção.
- **Tokens reais precisam de uma chave que os testes conheçam.** Essa chave
  precisa vir da configuração, então a API não pode fixá-la no código, e a chave
  de teste nunca pode ser uma chave de produção. Contra um provedor de
  identidade externo, a alternativa é um token de um tenant de teste, mais lento
  e dependente da rede.
- **Testes unitários de handlers não veem a ligação.** Um handler correto e
  nunca registrado passa nos testes unitários. Os testes via
  `IAuthorizationService` pegam o registro, e os testes HTTP pegam um endpoint
  que esquece de chamá-lo.
- **A auditoria é uma regra sobre metadados, não sobre segurança.** Um endpoint
  com `AllowAnonymous()` passa mesmo que não devesse ser público. Ela obriga uma
  decisão; revisar a decisão continua sendo trabalho humano.
- **Headers que se passam por usuários só existem nos testes.** O handler fake
  fica no projeto de teste e só a factory o registra. Colocar um esquema desses
  na API "para desenvolvimento local" é uma porta dos fundos.
- **Status codes exatos acoplam os testes ao contrato.** Escolher 404 em vez de
  403 para a nota de outro usuário (para esconder que ela existe) é uma mudança
  de design legítima que quebra estes testes de propósito. É o contrato sendo
  revisado, não fragilidade de teste.

## Lab

A API de notas já está implementada com autenticação JWT bearer, uma policy `Admin` baseada em role e uma policy `NoteOwner` baseada em recurso, com handler próprio. Sua tarefa é escrever os testes MSTest que provam quem entra e quem fica de fora, e uma auditoria que pega o endpoint que ninguém lembrou.

**O que você vai praticar**

- Um esquema de autenticação fake guiado por headers, registrado na factory.
- Asserções exatas de 401 e 403, pelo lado que precisa ser recusado.
- Testes unitários de um `AuthorizationHandler` e das policies via `IAuthorizationService`.
- Uma auditoria de endpoints sobre o `EndpointDataSource` e (opcional) JWTs reais assinados com uma chave de teste.

**Pré-requisitos:** o concept Authentication and Authorization Fundamentals, o concept e o lab Integration Testing ASP.NET Core with WebApplicationFactory, .NET 10 SDK.

**Como funciona:** cada método de teste já está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo. As dicas apontam os testes que uma suíte de caminho feliz nunca escreve. Os TODOs opcionais adicionam tokens reais e pedem para quebrar o código de produção de propósito.

## Documentation Links

- [Integration tests in ASP.NET Core (mock authentication), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [Resource-based authorization in ASP.NET Core MVC, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/security/authorization/resource-based) (doc)
- [Policy-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies) (doc)
- [AuthorizationOptions.FallbackPolicy property, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authorization.authorizationoptions.fallbackpolicy) (doc)
- [Configure JWT bearer authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication) (doc)
- [What's new in ASP.NET Core in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
