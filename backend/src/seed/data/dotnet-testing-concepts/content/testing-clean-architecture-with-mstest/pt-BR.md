---
version: 1.0
updatedAt: 2026-10-07
title: "Testando Clean Architecture com MSTest"
summary: Um projeto MSTest por camada: tabelas de domínio com DataRow, casos de uso contra uma porta fake, o contrato HTTP com WebApplicationFactory e um teste para a própria regra de dependência.
---
## Objective

Uma clean architecture com quatro projetos (`Domain`, `Application`,
`Infrastructure`, `Api`) é fácil de testar porque cada camada pede um tipo de
teste diferente, e menor, do que a camada de fora. O domínio não precisa de
setup, os casos de uso precisam de um fake de uma porta, e só a camada mais
externa precisa de um host de verdade e de um banco de verdade. O objetivo é
escrever essa suíte em MSTest: um projeto de teste por camada, o teste mais
barato que enxerga cada regra, e um teste para a própria regra de dependência,
para que a arquitetura não se erosione em silêncio.

## Use Cases

- Testar regras de negócio em milissegundos, sem banco de dados e sem servidor
  web.
- Testar casos de uso contra um fake em memória da porta do repositório, para
  que um teste que falha aponte o handler e não o EF Core.
- Testar o contrato HTTP (201, 400, 409, 404) e as constraints do banco pelo
  pipeline real, uma vez por cenário que cruza camadas.
- Quebrar o build quando alguém adiciona uma referência ao EF Core em
  `Application` ou torna um repositório `public`.
- Manter a pirâmide honesta: muitos testes de domínio rápidos, menos testes de
  aplicação, poucos testes de API.

## Deep Dive

### Um projeto de teste por camada, e as referências são a regra

Os projetos de teste espelham os projetos de código, e cada um referencia só o
que a sua camada pode ver:

```text
tests/
  Tenancy.Domain.Tests       -> referencia só o Domain.
  Tenancy.Application.Tests  -> referencia Application e Domain.
  Tenancy.Api.Tests          -> referencia os quatro (é onde as camadas se encontram).
```

Um teste de domínio não alcança o EF Core nem o HTTP por acidente, porque o
projeto não tem referência a eles. O csproj do menor deles é o setup inteiro:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.4.1" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
</ItemGroup>
<ItemGroup>
  <ProjectReference Include="..\..\src\Tenancy.Domain\Tenancy.Domain.csproj" />
</ItemGroup>
```

O MSTest roda os testes um de cada vez até o assembly optar por paralelismo. O
`dotnet new mstest` adiciona um `MSTestSettings.cs` com `[assembly:
Parallelize(Scope = ExecutionScope.MethodLevel)]`, e cada projeto de teste aqui
o mantém. O MSTest também cria uma nova instância da classe de teste para cada
método, então os campos de instância são privados de um teste e rodar métodos em
paralelo é seguro desde que nada seja `static`.

### Testes de domínio: construa, aja, confira

A classe de domínio recusa entrada inválida no construtor, então os testes são
tabelas de entradas. `[DataRow]` transforma uma tabela em um método, e cada linha
é reportada separadamente:

```csharp
[TestClass]
public sealed class TenantTests
{
    [TestMethod]
    [DataRow("acme", "acme")]
    [DataRow("  ACME-Games ", "acme-games")]
    [DataRow("A", "a")]
    public void ShouldNormalizeTheSubdomain(string input, string expected) =>
        Assert.AreEqual(expected, new Tenant(input).Subdomain);

    [TestMethod]
    [DataRow("")]
    [DataRow("-acme")]
    [DataRow("a.b")]
    [DataRow("under_score")]
    public void ShouldRejectAnInvalidSubdomain(string subdomain) =>
        Assert.ThrowsExactly<ArgumentException>(() => new Tenant(subdomain));

    [TestMethod]
    public void ShouldAcceptExactly63CharactersAndRejectMore()
    {
        Assert.AreEqual(63, new Tenant(new string('a', 63)).Subdomain.Length);
        Assert.ThrowsExactly<ArgumentException>(() => new Tenant(new string('a', 64)));
    }
}
```

O teste dos 63 caracteres confere os dois lados do limite no mesmo lugar. Outro
teste confere que um `Rename` que falha mantém o subdomínio antigo, porque uma
operação que falha não pode deixar o objeto meio alterado.

### Testes de aplicação: um fake da porta

O handler depende de `ITenantRepository`, que `Application` declara. O teste
fornece uma implementação em memória que funciona, não um roteiro de chamadas
esperadas:

```csharp
internal sealed class FakeTenantRepository : ITenantRepository
{
    public List<Tenant> Stored { get; } = [];

    public Task<bool> ExistsAsync(string subdomain, CancellationToken ct) =>
        Task.FromResult(Stored.Any(t => t.Subdomain == subdomain));

    public Task<Tenant?> FindBySubdomainAsync(string subdomain, CancellationToken ct) =>
        Task.FromResult(Stored.FirstOrDefault(t => t.Subdomain == subdomain));

    public Task AddAsync(Tenant tenant, CancellationToken ct)
    {
        Stored.Add(tenant);
        return Task.CompletedTask;
    }
}
```

Os testes preenchem `Stored` antes do passo de ação e o leem depois, então
conferem o resultado (um tenant guardado, nenhum guardado) e o status que o caso
de uso devolve, não quais métodos foram chamados:

```csharp
[TestClass]
public sealed class CreateTenantHandlerTests(TestContext testContext)
{
    private readonly FakeTenantRepository _tenants = new();

    private Task<CreateTenantResult> CreateAsync(string subdomain) =>
        new CreateTenantHandler(_tenants).HandleAsync(subdomain, testContext.CancellationToken);

    [TestMethod]
    public async Task ShouldRejectASubdomainThatIsAlreadyTakenIgnoringCase()
    {
        _tenants.Stored.Add(new Tenant("acme"));

        var result = await CreateAsync("Acme");

        Assert.AreEqual(CreateTenantStatus.SubdomainTaken, result.Status);
        Assert.HasCount(1, _tenants.Stored);
    }
}
```

O MSTest entrega ao construtor o `TestContext` do teste em execução (aqui, um
construtor primário). O `CancellationToken` dele é sinalizado quando o teste
estoura o tempo ou a execução é abortada, então o handler recebe um token de
verdade em vez de `CancellationToken.None`.

Uma tabela de hosts combina mais com `[DynamicData]` do que com uma pilha de
atributos `[DataRow]`. A fonte é uma propriedade `static` de tuplas, então as
linhas são tipadas e adicionar um host é uma linha:

```csharp
public static IEnumerable<(string Host, TenantResolutionStatus Expected)> Hosts =>
[
    ("acme.example.com", TenantResolutionStatus.Found),
    ("ACME.example.com", TenantResolutionStatus.Found),
    ("ghost.example.com", TenantResolutionStatus.NotFound),
    ("localhost", TenantResolutionStatus.NoSubdomain),
];

[TestMethod]
[DynamicData(nameof(Hosts))]
public async Task ShouldResolveTheTenantFromTheFirstLabelOfTheHost(string host, TenantResolutionStatus expected)
{
    var tenants = new FakeTenantRepository();
    tenants.Stored.Add(new Tenant("acme"));

    var resolution = await new ResolveTenantHandler(tenants).HandleAsync(host, testContext.CancellationToken);

    Assert.AreEqual(expected, resolution.Status);
}
```

### Testes de API: a pilha inteira, poucas vezes

Algumas regras só existem quando as camadas estão ligadas: o status code para o
qual cada resultado é mapeado, o tenant resolvido pelo header de host, o índice
único. Para essas, suba a aplicação real com `WebApplicationFactory<Program>` (o
projeto `Api` declara `public partial class Program;` para que o projeto de
teste enxergue o ponto de entrada) e aponte-a para um arquivo SQLite que
pertence a um único teste:

```csharp
[TestClass]
[TestCategory("Integration")]
public sealed class TenantsApiTests(TestContext testContext)
{
    private string _dbFile = null!;
    private WebApplicationFactory<Program> _factory = null!;

    [TestInitialize]
    public void StartApi()
    {
        _dbFile = Path.Combine(Path.GetTempPath(), $"tenancy-{Guid.NewGuid():N}.db");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("ConnectionStrings:Tenancy", $"Data Source={_dbFile};Pooling=False"));
    }

    [TestCleanup]
    public async Task StopApi()
    {
        await _factory.DisposeAsync();
        File.Delete(_dbFile);
    }
}
```

Um arquivo novo e um host novo por teste evitam que os testes vejam os tenants
uns dos outros, o que importa porque eles rodam em paralelo. `Pooling=False` faz
fechar uma conexão fechar de verdade o arquivo, para que a limpeza consiga
apagá-lo. O tenant é escolhido pelo host, então um helper pequeno monta um
cliente para qualquer host:

```csharp
private HttpClient ClientFor(string host)
{
    var client = _factory.CreateClient();
    client.BaseAddress = new Uri($"http://{host}");
    return client;
}

[TestMethod]
public async Task ShouldReturn409WhenTheSubdomainIsAlreadyTaken()
{
    await CreateTenantAsync("acme");

    var again = await CreateTenantAsync("Acme");

    Assert.AreEqual(HttpStatusCode.Conflict, again.StatusCode);
}

[TestMethod]
[DataRow("ghost.localhost")]
[DataRow("localhost")]
public async Task ShouldReturn404ForCurrentWhenThereIsNoSuchTenant(string host)
{
    var response = await ClientFor(host).GetAsync("/tenants/current", testContext.CancellationToken);

    Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
}
```

Um teste contorna o handler de propósito. A checagem `ExistsAsync` do handler é
uma cortesia que produz o `409` amigável; o índice único é a garantia. O teste
adiciona um duplicado direto no `DbContext` e espera que o banco o recuse:

```csharp
db.Tenants.Add(new Tenant("acme"));
await Assert.ThrowsExactlyAsync<DbUpdateException>(() => db.SaveChangesAsync(testContext.CancellationToken));
```

### Teste a própria regra de dependência

O compilador protege a direção das referências entre projetos, mas não quais
pacotes uma camada usa nem o que um tipo público expõe. Um teste lê as
referências compiladas. Um teste sobre uma tabela de camadas mantém a regra num
só lugar, e `DynamicDataDisplayName` dá a cada linha um nome legível:

```csharp
public static IEnumerable<(Assembly Layer, string[] Forbidden)> Rules =>
[
    (Domain, ["Tenancy.", "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore"]),
    (Application, ["Tenancy.Infrastructure", "Tenancy.Api", "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore"]),
    (Infrastructure, ["Tenancy.Api"]),
];

public static string RuleName(MethodInfo method, object[] data) =>
    $"{((Assembly)data[0]).GetName().Name} must not reference {string.Join(", ", (string[])data[1])}";

[TestMethod]
[DynamicData(nameof(Rules), DynamicDataDisplayName = nameof(RuleName))]
public void ALayerShouldNotReferenceWhatIsOutsideItsRing(Assembly layer, string[] forbidden)
{
    var references = layer.GetReferencedAssemblies().Select(a => a.Name!).ToList();

    var violations = references.Where(r => forbidden.Any(r.StartsWith)).ToList();

    Assert.IsEmpty(violations, $"{layer.GetName().Name} references {string.Join(", ", violations)}");
}
```

Uma falha se lê "Tenancy.Application must not reference
Microsoft.EntityFrameworkCore" em vez de "linha 2". Um segundo teste protege a
proteção: se `Application` perdesse a referência ao `Domain`, as regras não
casariam com nada e passariam pelo motivo errado, então `Assert.Contains("Tenancy.Domain",
references)` mantém a tabela honesta. Uma referência que nada usa não é
registrada no assembly compilado, então esses testes disparam quando o código
realmente usa um tipo da camada errada. Bibliotecas como NetArchTest ou
ArchUnitNET expressam regras mais ricas, como no concept Module Communication
and Architecture Tests.

### Cada camada percebe uma quebra?

Quebre o código de produção de propósito, uma mudança por vez, e veja qual
projeto fica vermelho. Estes são os resultados para esta suíte:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| `Tenant.Normalize` para de converter para minúsculas | linhas do domínio, o teste de aplicação "já usado ignorando maiúsculas", os testes de API de criação e de 409 |
| `CreateTenantHandler` pula o `ExistsAsync` | o teste de aplicação "já usado" e o teste de API do 409 |
| O endpoint devolve `Results.Ok` em vez de `Results.Conflict` | só o teste de API do 409 |
| `.IsUnique()` é removido do mapeamento | só o teste do índice único |
| `TenantRepository` vira `public` | só o teste "tipos de persistência continuam internal" |
| `Tenancy.Application` usa o EF Core | a linha de Application da regra de dependência |

A quebra aparece na camada dona da regra (e muitas vezes de novo nas camadas
acima dela), e uma mudança que não deixa nada vermelho é um teste faltando.
Nesta suíte o projeto de domínio roda 14 testes em dezenas de milissegundos, o de
aplicação 8, e o de API 12 em cerca de meio segundo, que é o formato da
pirâmide.

## Trade-offs

- **Um fake precisa de manutenção; um mock precisa de cuidado.** Quando
  `ITenantRepository` ganha um método, o fake precisa implementá-lo. Um mock que
  verifica chamadas quebraria num refactor inofensivo do handler. O fake mantém
  os testes em resultados, ao preço de uma classe pequena por porta.
- **Testes de API sobem um host, então mantenha poucos.** Cada um inicia a
  aplicação e um arquivo de banco. Uma factory compartilhada é mais rápida, mas
  então os testes dividem tenants e precisam de dados únicos, e uma factory
  `static` compartilhada por testes paralelos é a fonte usual de instabilidade.
  ```csharp
  var subdomain = $"t{Guid.NewGuid():N}"[..20]; // único por teste quando o banco é compartilhado
  ```
- **SQLite é um substituto do seu banco de verdade.** O teste do índice único
  prova que o mapeamento tem um índice, não que o PostgreSQL o impõe do mesmo
  jeito. A orientação do EF Core é testar contra o sistema de banco de dados
  real quando der, com containers como o Testcontainers. Migrar para o
  PostgreSQL muda o `AddInfrastructure` e a connection string que a factory
  recebe; o corpo dos testes continua igual.
- **Testar cada camada e também a API duplica algumas conferências.** O 409 é
  conferido no teste do handler e de novo por HTTP. É de propósito: o primeiro
  prova a regra, o segundo prova a ligação. Mantenha o segundo tipo pequeno.
- **Testes por reflexão só enxergam o que foi compilado.** Uma referência não
  usada é invisível para o `GetReferencedAssemblies`, e as regras são strings que
  apodrecem quando um projeto é renomeado. O teste que protege a proteção e uma
  regra que falha alto ajudam, e uma biblioteca como o NetArchTest cobre mais.
- **Espelhar as camadas dobra a contagem de projetos.** Três projetos de teste
  para quatro de código dão mais manutenção do que um. Em troca, as referências
  de cada projeto de teste impõem o que os testes dele podem tocar. Um projeto
  com todas as referências é mais simples e deixa um teste de domínio alcançar o
  EF Core.

## Documentation Links

- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [MSTest TestContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-testcontext) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [Connection strings, Microsoft.Data.Sqlite, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/connection-strings) (doc)
