---
version: 1.0
updatedAt: 2026-10-04
title: "Monólito Modular: Desenhando as Fronteiras dos Módulos"
summary: Projetos, visibilidade internal e um projeto de contratos por módulo como fronteira que o compilador do .NET garante, com um schema e um DbContext por módulo.
---
## Objective

Um monólito modular é uma única aplicação .NET implantável, dividida
internamente em módulos, cada um dono dos próprios dados e expondo uma
superfície pública pequena para os outros. Ele mantém a simplicidade
operacional de um processo só (um deploy, um fluxo de logs, chamadas em
memória) e ganha boa parte do desacoplamento que normalmente leva as pessoas a
microsserviços. No .NET a fronteira é desenhada com ferramentas que o
compilador já garante: projetos separados (assemblies), o modificador de acesso
`internal`, um projeto fino de contratos por módulo e um método de registro que
pertence a cada módulo. O objetivo é que um módulo possa ser lido, testado e,
um dia, extraído sem desembaraçar o resto do código.

## Use Cases

- Começar um produto cujo domínio ainda está sendo descoberto, em que dividir
  em serviços agora congelaria as fronteiras erradas em chamadas de rede.
- Desembaraçar uma aplicação ASP.NET Core em que qualquer controller alcança
  qualquer `DbSet`, de modo que uma mudança em cobrança quebra o catálogo sem
  ninguém perceber.
- Deixar vários times trabalharem no mesmo repositório com o compilador (e não
  uma página de wiki) avisando quando alguém entra no módulo de outro time.
- Preparar um módulo para ser extraído como serviço no futuro, tornando as
  dependências dele explícitas antes que exista uma rede no meio.

## Deep Dive

### Layout da solução: um módulo é um pequeno grupo de projetos

Um layout comum tem um projeto host que só compõe os módulos, e dois projetos
por módulo: um projeto público de contratos e um projeto de implementação que
deixa quase tudo `internal`.

```text
src/
  Host/                      -> ponto de entrada ASP.NET Core, liga os módulos
  Modules/
    Orders/
      Orders.Contracts/      -> público: DTOs, eventos de integração, IOrdersModule
      Orders.Core/           -> domínio, casos de uso, OrdersDbContext (internal)
    Catalog/
      Catalog.Contracts/
      Catalog.Core/
  Shared/
    Shared.Kernel/           -> mínimo: tipo Result, abstração de relógio, tipo base de evento
```

As regras de dependência são o que tornam isso um monólito modular, e não só
uma estrutura de pastas:

- `Host` referencia todos os projetos `*.Core`, apenas para chamar o método de
  registro de cada um.
- O `Core` de um módulo pode referenciar os `Contracts` de outros módulos,
  nunca o `Core` de outro módulo.
- Projetos `Contracts` não referenciam nada além de, no máximo,
  `Shared.Kernel`.

Referências entre projetos têm direção, então o compilador garante a segunda
regra por você. Se `Orders.Core.csproj` não referencia `Catalog.Core`, nada em
Orders consegue citar um repositório ou uma entidade de Catalog:

```xml
<!-- Modules/Orders/Orders.Core/Orders.Core.csproj -->
<ItemGroup>
  <ProjectReference Include="..\Orders.Contracts\Orders.Contracts.csproj" />
  <ProjectReference Include="..\..\Catalog\Catalog.Contracts\Catalog.Contracts.csproj" />
</ItemGroup>
```

Dividir um módulo em `Domain`, `Application` e `Infrastructure` é outra
decisão. Camadas dentro de um módulo são opcionais; a fronteira *entre*
módulos é a que realmente se paga.

### `internal` por padrão, `public` de propósito

Dentro de `Orders.Core`, tudo é `internal` exceto o punhado de tipos que o host
precisa chamar. Escrever `public` por hábito é o caminho de menor resistência,
então isso é uma disciplina a construir (e, mais tarde, a testar):

```csharp
namespace Orders.Core.Domain;

internal sealed class Order
{
    public Guid Id { get; private set; }
    public OrderStatus Status { get; private set; }
    // ...
}
```

A face pública do módulo mora em `Orders.Contracts`, e ela fala em DTOs, nunca
em entidades:

```csharp
namespace Orders.Contracts;

public interface IOrdersModule
{
    Task<OrderSummaryDto?> GetSummaryAsync(Guid orderId, CancellationToken ct);
}

public sealed record OrderSummaryDto(Guid Id, string Status, decimal Total);
```

A implementação de `IOrdersModule` fica em `Orders.Core` e é `internal`. Um
efeito colateral bom do grafo de projetos: um contrato não consegue vazar uma
entidade nem por acidente, porque `Orders.Contracts` não referencia
`Orders.Core`, então `Order` simplesmente não existe do ponto de vista dele.

Os testes ainda precisam dos internals. O SDK tem um item de MSBuild para
isso, sem precisar de `AssemblyInfo.cs`:

```xml
<!-- Orders.Core.csproj -->
<ItemGroup>
  <InternalsVisibleTo Include="Orders.Core.Tests" />
</ItemGroup>
```

### Cada módulo se registra sozinho

O host não deveria saber quais handlers, DbContexts ou options um módulo
precisa. Cada módulo expõe um método de extensão para serviços e outro para
endpoints (o projeto `Core` precisa de
`<FrameworkReference Include="Microsoft.AspNetCore.App" />` para usar os tipos
de roteamento):

```csharp
namespace Orders.Core;

public static class OrdersModule
{
    public static IServiceCollection AddOrdersModule(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<OrdersDbContext>(options =>
            options.UseNpgsql(
                configuration.GetConnectionString("Main"),
                npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "orders")));

        services.AddScoped<IOrdersModule, OrdersModuleApi>();
        services.AddScoped<PlaceOrderHandler>();
        return services;
    }

    public static IEndpointRouteBuilder MapOrdersEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/orders").WithTags("Orders");
        group.MapPost("/", PlaceOrderEndpoint.HandleAsync);
        group.MapGet("/{id:guid}", GetOrderEndpoint.HandleAsync);
        return app;
    }
}
```

`OrdersModuleApi`, `PlaceOrderHandler` e as classes de endpoint são todas
`internal`; registrá-las de dentro do próprio assembly funciona normalmente. O
host continua sendo uma lista curta de módulos:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddOrdersModule(builder.Configuration)
    .AddCatalogModule(builder.Configuration);

var app = builder.Build();

app.MapOrdersEndpoints();
app.MapCatalogEndpoints();

app.Run();
```

### Posse dos dados: um schema e um DbContext por módulo

Um módulo é dono das próprias tabelas. A forma mais simples de deixar isso
visível é um schema de banco por módulo e um `DbContext` que só conhece esse
schema:

```csharp
internal sealed class OrdersDbContext(DbContextOptions<OrdersDbContext> options)
    : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("orders");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(OrdersDbContext).Assembly);
    }
}
```

Junto com a chamada `MigrationsHistoryTable(..., "orders")` no registro, cada
módulo também ganha o próprio histórico de migrations, então Orders e Catalog
evoluem seus schemas de forma independente.

A regra que vem daí é rígida: nada de join entre módulos e nada de ler tabelas
de outro módulo. Este é o atalho que um `AppDbContext` único e compartilhado
torna possível:

```csharp
// Dentro de Orders, com um DbContext compartilhado que mapeia todas as tabelas
var lines = await db.OrderLines
    .Where(l => l.OrderId == orderId)
    .Join(db.Products, l => l.ProductId, p => p.Id,
          (l, p) => new { l.Quantity, p.Name })
    .ToListAsync(ct);
```

E a versão que respeita a fronteira, perguntando ao Catalog pelo contrato dele:

```csharp
// OrdersDbContext só mapeia tabelas de Orders; Catalog responde via ICatalogModule
var lines = await db.OrderLines
    .Where(l => l.OrderId == orderId)
    .ToListAsync(ct);

var names = await catalog.GetProductNamesAsync(
    lines.Select(l => l.ProductId).Distinct().ToArray(), ct);
```

Duas consultas em vez de uma é o preço. Quando esse preço é alto demais num
caminho quente, a resposta usual é Orders manter uma pequena cópia local dos
dados de produto que precisa, atualizada pelos eventos de Catalog (assunto do
próximo conceito), em vez de voltar a ler o schema de Catalog.

### Onde as fronteiras vazam na prática

- **O shared kernel vira um segundo monólito.** `Shared.Kernel` começa com um
  tipo `Result` e termina guardando entidades "que dois módulos precisam".
  Mantenha ali só coisas sem significado de negócio.
- **Um `AppDbContext` para tudo.** É o jeito mais rápido de desfazer a divisão
  em módulos, porque qualquer módulo consulta qualquer tabela.
- **Contratos que espelham entidades.** Um DTO com as mesmas vinte
  propriedades da entidade acopla o consumidor ao modelo interno do produtor
  tanto quanto referenciar a entidade acoplaria.
- **Helpers estáticos e singletons em `Shared`** que guardam estado de um
  módulo e são lidos por outro: uma dependência invisível que o grafo de
  projetos não enxerga.

## Trade-offs

- **O número de projetos cresce rápido.** Dois ou três projetos por módulo
  vezes uma dúzia de módulos é uma solução grande, com builds mais lentos e
  mais cerimônia. Uma variante mais leve é um projeto por módulo em que os
  únicos tipos `public` são os contratos; a fronteira se mantém, mas todo
  consumidor passa a referenciar o assembly inteiro do módulo e as
  dependências de pacote dele, de forma transitiva.
- **`internal` é uma cerca de compilação, não uma fronteira de segurança.**
  Reflection, `InternalsVisibleTo` e um friend assembly "temporário" passam
  direto por ela, e o build continua verde.
  ```csharp
  // Orders.Core/AssemblyInfo.cs, adicionado "só para destravar o relatório"
  [assembly: InternalsVisibleTo("Reporting.Core")]
  // Reporting agora consegue construir OrdersDbContext direto. A fronteira acabou.
  ```
- **Um único banco físico convida a transações entre módulos.** Como todos os
  schemas estão no mesmo banco, é tecnicamente possível compartilhar uma
  conexão e uma transação entre os DbContexts de dois módulos. Funciona hoje e
  vira uma transação distribuída no dia em que um módulo for extraído, então
  vale tratar isso como proibido desde o começo.
- **Fronteiras se desgastam em silêncio.** Nada no runtime reclama quando uma
  nova referência de projeto cruza a linha de um módulo. Sem testes de
  arquitetura no CI (próximo conceito), o layout acima se degrada um pull
  request razoável de cada vez.
- **Chamadas em memória escondem custos de sistema distribuído.** Uma chamada
  via `IOrdersModule` não tem latência, falha parcial nem problema de
  versionamento. A extração traz os três de uma vez, então um módulo cujos
  chamadores dependem de chamadas síncronas e frequentes é mais difícil de
  extrair do que o grafo de projetos limpo sugere.

## Documentation Links

- [Common web application architectures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) (doc)
- [The internal keyword, C# reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/internal) (doc)
- [Friend assemblies (InternalsVisibleTo), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/friend) (doc)
- [Route groups in minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers#route-groups) (doc)
- [Modular Monolith with DDD, kgrzybek (implementação de referência)](https://github.com/kgrzybek/modular-monolith-with-ddd) (doc)
