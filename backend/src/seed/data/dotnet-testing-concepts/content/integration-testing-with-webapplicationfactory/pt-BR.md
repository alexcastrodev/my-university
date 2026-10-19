---
version: 1.0
updatedAt: 2026-10-18
title: "Testes de integração no ASP.NET Core com WebApplicationFactory"
summary: Suba a API real em memória com WebApplicationFactory e MSTest, troque só o que o teste não alcança, compartilhe um host por classe sem vazar estado e confira status, Location, ProblemDetails e redirects.
---
## Objective

`WebApplicationFactory<Program>` sobe a sua aplicação ASP.NET Core de verdade
em memória: o mesmo `Program.cs`, o mesmo container de DI, os mesmos
middlewares e endpoints, com um `HttpClient` que conversa com ela sem socket. O
objetivo é escrever com ela testes de integração em MSTest que troquem só o que
um teste não alcança (um serviço externo, uma configuração), compartilhem um
host por classe sem vazar estado e confiram o que um cliente recebe de fato: o
status code, o header `Location`, o corpo JSON e o ProblemDetails de um erro.
No caminho, três hábitos que fazem um teste desses passar pelo motivo errado:
um override que chega tarde demais, um singleton que lembra do teste anterior e
um cliente que segue redirects em silêncio.

## Use Cases

- Provar que `POST /orders` responde 201 com o header `Location` e o pedido no
  corpo, passando por roteamento, model binding e serialização.
- Provar que um erro é um documento ProblemDetails com o status e o título
  certos, que é o contrato que o frontend lê.
- Trocar um cliente HTTP de outro serviço por um fake, para os testes rodarem
  sem rede.
- Rodar a API com uma configuração diferente (um limite menor, uma feature
  flag) para uma classe de teste.
- Conferir o redirect em si (302 e `Location`), não a página para onde ele leva.

## Deep Dive

### O pacote e o ponto de entrada

O projeto de teste referencia o projeto da API e um pacote:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.5.1" />
  <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.13" />
</ItemGroup>
<ItemGroup>
  <ProjectReference Include="..\..\src\Orders.Api\Orders.Api.csproj" />
</ItemGroup>
```

O `Microsoft.AspNetCore.Mvc.Testing` copia o arquivo `.deps` da API para a
saída dos testes, aponta o content root para a pasta do projeto da API (então o
`appsettings.json` é lido de lá) e fornece a `WebApplicationFactory<TEntryPoint>`,
que sobe a aplicação no `TestServer` em memória. Daí vêm dois padrões: o
ambiente é `Development` se você não definir outro, então o
`appsettings.Development.json` também é carregado, e o host só é construído
quando algo toca a factory pela primeira vez (`CreateClient`, `Services`,
`Server`).

O `TEntryPoint` costuma ser `Program`. Top-level statements compilam para uma
classe `internal`, então até o .NET 9 a API precisava de
`public partial class Program;` para o projeto de teste enxergá-la. Desde o
.NET 10 um source generator emite essa declaração, e o analyzer ASP0027 sugere
remover uma declaração explícita. O `Program.cs` do lab não tem essa linha, e
`WebApplicationFactory<Program>` compila.

### Uma factory para os testes

Herde da factory uma vez e coloque todos os overrides de teste em
`ConfigureWebHost`:

```csharp
public sealed class OrdersApiFactory : WebApplicationFactory<Program>
{
    public const int MaxQuantity = 3;

    public FakeInventory Inventory { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Orders:MaxQuantity", MaxQuantity.ToString());

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IInventoryClient>();
            services.AddSingleton<IInventoryClient>(Inventory);
        });
    }
}
```

O `ConfigureTestServices` roda depois que o `Program.cs` registrou os serviços
dele, então um registro feito ali vence. A API registra `IInventoryClient` como
um `HttpClient` tipado que aponta para outro serviço; `RemoveAll<T>()` remove
esse registro e o fake ocupa o lugar. Para uma resolução simples o último
registro já vence, mas o `RemoveAll` cobre também código que resolve
`IEnumerable<T>` ou usa `TryAdd`, e deixa a intenção explícita. O fake é uma
implementação em memória que funciona, não um mock:

```csharp
public sealed class FakeInventory : IInventoryClient
{
    public const int DefaultStock = 100;

    private readonly ConcurrentDictionary<string, int> _stock = new();

    public void SetStock(string sku, int available) => _stock[sku] = available;

    public void Clear() => _stock.Clear();

    public Task<int> GetAvailableAsync(string sku, CancellationToken ct) =>
        Task.FromResult(_stock.GetValueOrDefault(sku, DefaultStock));
}
```

### Sobrescreva a configuração a tempo

O `Program.cs` lê o limite uma vez, antes do `Build`, e passa o número para um
singleton. Isso é comum e legítimo, e decide qual override funciona:

```csharp
var builder = WebApplication.CreateBuilder(args);

// Lido uma vez, antes do Build: OrderRules recebe o número, não uma consulta à configuração.
var maxQuantity = builder.Configuration.GetValue("Orders:MaxQuantity", 10);

builder.Services.AddSingleton(new OrderRules(maxQuantity));
```

O `UseSetting` alcança essa leitura. O `ConfigureAppConfiguration` não: no
modelo de hospedagem mínima, as fontes que ele adiciona só ficam disponíveis
depois que a aplicação é construída, tarde demais para o código acima de
`builder.Build()`. Um teste de aprendizado fixa o comportamento:

```csharp
await using var factory = new OrdersApiFactory().WithWebHostBuilder(builder =>
    builder.ConfigureAppConfiguration((_, config) =>
        config.AddInMemoryCollection(new Dictionary<string, string?> { ["Orders:MaxQuantity"] = "1" })));

// Com limite 1 isto seria um 400. O Program.cs leu o valor antes do Build,
// então OrderRules recebeu o valor do UseSetting (3), e 2 é aceito.
var response = await factory.CreateClient()
    .PostAsJsonAsync("/orders", new PlaceOrderRequest("KB-1", 2), testContext.CancellationToken);

Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
```

O mesmo override aparece no `IConfiguration` resolvido de `factory.Services`
depois, então um endpoint que lê a configuração a cada request o enxergaria.
Valores ligados com `IOptions<T>` também são lidos tarde. Um valor lido antes
do `Build` precisa de `UseSetting` (ou de uma variável de ambiente).

A armadilha está na asserção, não só no override. Com limite 3 e um
`appsettings.json` com limite 10, um teste que pede 50 unidades recebe 400 com
qualquer um dos dois limites, então passa mesmo quando o override nunca chegou.
Teste na fronteira que o override cria:

```csharp
[TestMethod]
public async Task ShouldRejectAQuantityJustAboveTheConfiguredLimit()
{
    var response = await PlaceAsync("KB-1", OrdersApiFactory.MaxQuantity + 1);

    Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    var problem = await response.Content.ReadFromJsonAsync<HttpValidationProblemDetails>(Ct);
    var error = Assert.ContainsSingle(problem!.Errors["quantity"]);
    Assert.AreEqual("The quantity must be between 1 and 3.", error);
}
```

### Um host por classe, reset por teste

Subir um host por teste é a opção mais isolada e custa uma inicialização por
vez. O MSTest não tem `IClassFixture<T>`; um campo `static` preenchido no
`[ClassInitialize]` e descartado no `[ClassCleanup]` faz o mesmo papel
(`IClassFixture<T>` no xUnit, `[OneTimeSetUp]` no NUnit). Para um host por
assembly de teste, `[AssemblyInitialize]` e `[AssemblyCleanup]` seguem as
mesmas regras. Os dois métodos de cleanup podem ser `async Task`:

```csharp
[TestClass]
[DoNotParallelize]
public sealed class OrdersApiTests(TestContext testContext)
{
    private static OrdersApiFactory _factory = null!;

    [ClassInitialize]
    public static void StartApi(TestContext _) => _factory = new OrdersApiFactory();

    [ClassCleanup]
    public static async Task StopApi() => await _factory.DisposeAsync();

    [TestInitialize]
    public void ResetState()
    {
        _factory.Services.GetRequiredService<OrderStore>().Clear();
        _factory.Inventory.Clear();
    }
}
```

Compartilhar o host é compartilhar os singletons dele. O `OrderStore` é uma
lista só durante a vida do host, então sem o reset um teste que lista os
pedidos também vê os pedidos dos testes que rodaram antes, e falha ou passa
conforme a ordem. O reset faz o papel do que você faria num banco real
(truncate, ou uma ferramenta como o Respawn). O `MSTestSettings.cs` do lab roda
os métodos em paralelo, e dois testes que resetam e enchem o mesmo store ao
mesmo tempo quebram um ao outro, então esta classe sai do paralelismo com
`[DoNotParallelize]`. A outra saída é dado único por teste (um SKU ou um id de
cliente novo a cada vez) e nenhum reset.

O `WithWebHostBuilder` é a saída por teste. Ele devolve uma factory nova com
host próprio, singletons próprios e a configuração extra, que é como o teste de
configuração acima muda uma configuração sem mexer no host compartilhado.
Descarte-a.

### Confira a resposta que o cliente vê

Envie o tipo de request de produção, para que uma propriedade com nome errado
não produza um 400 que o teste confunde com erro de validação:

```csharp
private Task<HttpResponseMessage> PlaceAsync(string sku, int quantity) =>
    _factory.CreateClient().PostAsJsonAsync("/orders", new PlaceOrderRequest(sku, quantity), Ct);

[TestMethod]
public async Task ShouldPlaceAnOrderAndPointToItWithTheLocationHeader()
{
    var response = await PlaceAsync("KB-1", 2);

    Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
    var order = await response.Content.ReadFromJsonAsync<Order>(Ct);
    Assert.AreEqual(new Order(order!.Id, "KB-1", 2), order);
    Assert.AreEqual($"/orders/{order.Id}", response.Headers.Location!.OriginalString);
}
```

`GetFromJsonAsync<T>` é a leitura mais curta para um 200, e lança
`HttpRequestException` ("Response status code does not indicate success: 404")
para qualquer outro status. Para um erro, pegue a resposta e leia o corpo como
ProblemDetails:

```csharp
var response = await _factory.CreateClient().GetAsync("/orders/999", Ct);

Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
Assert.AreEqual("application/problem+json", response.Content.Headers.ContentType?.MediaType);
var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(Ct);
Assert.AreEqual("Order not found", problem!.Title);
```

`ProblemDetails` fica em `Microsoft.AspNetCore.Mvc` e
`HttpValidationProblemDetails` (com o dicionário `Errors` que o
`Results.ValidationProblem` escreve) em `Microsoft.AspNetCore.Http`. Conferir o
título ou a chave do erro é o que separa "não encontrado" de um 404 que o
roteamento produziu porque a URL estava errada.

### Redirects: desligue o piloto automático

`CreateClient()` devolve um cliente com `AllowAutoRedirect = true`,
`HandleCookies = true`, até 7 redirects e `BaseAddress` `http://localhost`. O
`GET /orders/latest` responde 302 para o pedido mais novo, e o cliente padrão
segue e reporta o 200 de `/orders/{id}`. Um teste que confere 200 passa se o
endpoint redireciona, se devolve o pedido direto e, com um pedido só no store,
se redireciona para o mais antigo. Peça o redirect:

```csharp
var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

var response = await client.GetAsync("/orders/latest", Ct);

Assert.AreEqual(HttpStatusCode.Redirect, response.StatusCode);
Assert.AreEqual($"/orders/{newest.Id}", response.Headers.Location!.OriginalString);
```

A mesma opção importa para autenticação: um esquema de cookie que redireciona
para a página de login parece um 200 para um cliente que segue redirects.
(Desde o .NET 10, a autenticação por cookie responde 401 e 403 em vez de
redirecionar em endpoints de API conhecidos, como minimal APIs que leem ou
escrevem JSON.)

### TestServer, ou um Kestrel de verdade (.NET 10)

O `TestServer` processa requests em memória: sem porta, sem socket, sem TLS. É
o que você quer em quase todo teste de API. O .NET 10 adiciona `UseKestrel()` à
factory, para testes que precisam de um socket de verdade (um navegador
dirigido pelo Playwright, um cliente HTTP que você não controla):

```csharp
await using var factory = new OrdersApiFactory();
factory.UseKestrel(0); // porta 0: o sistema operacional escolhe uma porta livre
factory.StartServer();

var client = factory.CreateClient(); // http://127.0.0.1:<porta>/
var orders = await client.GetFromJsonAsync<List<Order>>("/orders", testContext.CancellationToken);
```

O `UseKestrel` precisa ser chamado antes de o host subir; depois disso ele
lança `InvalidOperationException`. Com Kestrel não existe `TestServer`, então
`factory.Server` lança `NotSupportedException`, enquanto `CreateClient()` e
`Services` continuam funcionando.

### Os testes protegem as regras?

Quebre o código de produção de propósito, uma mudança por vez, e veja o que
fica vermelho. Estes são os resultados para a solução do lab:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| `Program.cs` monta `new OrderRules(10)` e ignora a configuração | o teste "logo acima do limite configurado" |
| A checagem do limite erra por um | o teste "logo acima do limite configurado" |
| `/orders/latest` devolve `Results.Ok(order)` em vez de redirecionar | o teste do redirect |
| `OrderStore.Latest` devolve o pedido mais antigo | o teste do redirect |
| A checagem de estoque é pulada | o teste do 409 |
| O 404 é `Results.NotFound()` sem corpo ProblemDetails | o teste do ProblemDetails |

As versões ingênuas sobrevivem às suas linhas: um teste de limite com 50
unidades passa com um 10 fixo no código, e um teste de redirect com o cliente
padrão passa quando o endpoint devolve o pedido direto. Tirar o reset do
`[TestInitialize]` deixa o teste da listagem vermelho ("Different number of
elements").

## Trade-offs

- **Host em memória, não um deploy.** O `TestServer` pula a rede, o TLS e o
  proxy reverso, então um teste prova a aplicação, não a hospedagem. Mantenha
  alguns smoke tests contra um ambiente publicado, e use `UseKestrel` só quando
  o socket de verdade for o ponto.
- **Um host compartilhado é rápido e tem memória.** Um host por classe economiza
  uma inicialização por teste, ao preço de resetar cada singleton e abrir mão do
  paralelismo naquela classe. Um host por teste (`WithWebHostBuilder` ou uma
  factory nova) é isolado e paralelo, e mais lento.
  ```csharp
  var sku = $"KB-{Guid.NewGuid():N}"; // dado único em vez de reset
  ```
- **Fakes na borda se afastam do serviço real.** O estoque fake responde na hora
  e nunca estoura o tempo. Um teste de contrato (ou um teste contra um container
  do serviço real) cobre o que o fake não cobre.
- **Overrides acoplam os testes ao `Program.cs`.** Um teste que depende de o
  `UseSetting` alcançar uma leitura antes do `Build` quebra se alguém mover essa
  leitura para `IOptions<T>`, e vice-versa. O teste de aprendizado deixa esse
  acoplamento visível.
- **Testes de integração são mais lentos que testes unitários.** Cada um passa
  por roteamento, binding e serialização. Teste as regras no domínio ou no
  handler, e deixe os testes HTTP para o contrato: status, headers, formato do
  corpo.
- **MSTest, xUnit e NUnit mudam a forma, não a substância.**
  `[ClassInitialize]` com um campo `static` é o `IClassFixture<T>` do xUnit e o
  `[OneTimeSetUp]` do NUnit. O código da factory é o mesmo nos três, como no
  concept Testing Modules in Isolation.

## Lab

A API de pedidos já está implementada: uma minimal API com validação, ProblemDetails, um serviço de estoque chamado por HTTP, um store em memória e um redirect. Sua tarefa é escrever os testes de integração em MSTest que a sobem com `WebApplicationFactory<Program>`, e descobrir onde a versão óbvia de um teste passa pelo motivo errado.

**O que você vai praticar**

- Uma factory derivada com `UseSetting` e `ConfigureTestServices`/`RemoveAll`.
- Um host por classe com `[ClassInitialize]`/`[ClassCleanup]`, e um reset por teste.
- Conferir 201 com `Location`, ProblemDetails e erros de validação.
- Um 302 com `AllowAutoRedirect = false`, e um Kestrel de verdade com `UseKestrel`.

**Pré-requisitos:** os concepts de Minimal APIs e do pipeline de middlewares, o ciclo de vida do MSTest, .NET 10 SDK.

**Como funciona:** cada método de teste já está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo. Algumas dicas avisam onde uma asserção ingênua passa pelo motivo errado. Os TODOs opcionais fixam o comportamento da configuração, sobem o Kestrel e pedem para quebrar o código de produção de propósito.

## Documentation Links

- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [WebApplicationFactory<TEntryPoint> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.testing.webapplicationfactory-1) (doc)
- [WebApplicationFactory<TEntryPoint>.UseKestrel method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.testing.webapplicationfactory-1.usekestrel) (doc)
- [What's new in ASP.NET Core in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [ASP0027: Unnecessary public Program class declaration, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/diagnostics/asp0027) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [Test execution and control in MSTest (parallelization), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
