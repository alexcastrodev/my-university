---
version: 1.0
updatedAt: 2026-10-05
title: "Clean Architecture em Quatro Projetos"
summary: Domain, Application, Infrastructure e Api com uma regra de dependência apontando para dentro, o que vai em cada camada, como testar cada uma e quando isso basta antes de um monolito modular.
---
## Objective

A clean architecture, na forma mais comum em .NET, divide uma aplicação em
quatro projetos por papel técnico: `Domain`, `Application`, `Infrastructure` e
`Api`. Há um único deployável, uma única área de negócio e uma regra: as
dependências de código-fonte apontam para dentro, então as regras de negócio não
sabem nada de EF Core nem de HTTP. É um passo mais simples que um monolito
modular, porque não há contratos por módulo, schemas nem fronteiras entre áreas
de negócio para manter. O objetivo é saber o que pertence a cada projeto, como as
referências entre projetos impõem a regra, como as peças são ligadas e como cada
camada é testada sozinha.

## Use Cases

- Começar uma API nova onde cada tipo de código (regras, casos de uso,
  persistência, HTTP) já tem um lugar óbvio.
- Testar regras de negócio e casos de uso em milissegundos, sem banco e sem
  servidor web.
- Trocar o SQLite pelo PostgreSQL, ou um message broker por outro, mexendo em um
  projeto só.
- Dar a quem entra no time um layout que provavelmente já viu, para achar as
  coisas sem tour.

## Deep Dive

### Quatro projetos e uma regra

Uma API multi-tenant, em que um tenant é identificado por um subdomínio
(`acme.example.com` pertence ao tenant `acme`), é um exemplo pequeno:

```text
src/
  Tenancy.Domain          -> Tenant: identidade e regras. Não referencia nada.
  Tenancy.Application     -> casos de uso e as portas que eles precisam. Referencia Domain.
  Tenancy.Infrastructure  -> EF Core, implementações de repositório. Referencia Application.
  Tenancy.Api             -> HTTP, middleware, composition root. Referencia Application e Infrastructure.
```

A regra é que um projeto interno nunca referencia um externo. O Domain não
referencia camada nenhuma, o Application referencia só o Domain, e Infrastructure
e Api apontam para dentro. Referências de projeto têm direção e o compilador as
impõe: nada em `Tenancy.Application` consegue nomear um `DbContext`, porque ele
não tem referência ao EF Core.

A parte que parece invertida é a persistência. O Application precisa guardar
tenants, mas não pode depender do código que faz isso. Então o Application
declara a interface de que precisa (uma porta), e o Infrastructure a implementa.
A seta no código-fonte aponta para dentro, mesmo que, em runtime, o Application
chame o Infrastructure.

### Domain: regras e identidade

A classe de domínio é dona do que é válido. Ela tem setters privados e um
construtor que recusa entrada inválida, então nenhuma camada consegue criar um
tenant ruim:

```csharp
public sealed partial class Tenant
{
    public Guid Id { get; private set; }
    public string Subdomain { get; private set; }

    public Tenant(string subdomain)
    {
        Id = Guid.CreateVersion7();
        Subdomain = Normalize(subdomain);
    }

    public void Rename(string subdomain) => Subdomain = Normalize(subdomain);
    // Normalize: trim, minúsculas, depois casa ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ou lança exceção
}
```

`Guid.CreateVersion7()` (desde o .NET 9) produz um id ordenado no tempo, mais
amigável a índices de banco que um versão 4 aleatório, e a entidade não precisa
de gerador de chave do banco. O projeto não tem nenhum `PackageReference`; se um
tipo do EF Core ou do ASP.NET Core aparecer aqui, a arquitetura já está
vazando.

### Application: casos de uso e portas

Um caso de uso é uma classe com um método. Ele recebe valores simples, chama o
domínio, conversa com portas e devolve um resultado que diz o que aconteceu:

```csharp
public interface ITenantRepository
{
    Task<bool> ExistsAsync(string subdomain, CancellationToken ct);
    Task<Tenant?> FindBySubdomainAsync(string subdomain, CancellationToken ct);
    Task AddAsync(Tenant tenant, CancellationToken ct);
}

public sealed class CreateTenantHandler(ITenantRepository tenants)
{
    public async Task<CreateTenantResult> HandleAsync(string subdomain, CancellationToken ct)
    {
        Tenant tenant;
        try { tenant = new Tenant(subdomain); }
        catch (ArgumentException e) { return new(CreateTenantStatus.InvalidSubdomain, Error: e.Message); }

        if (await tenants.ExistsAsync(tenant.Subdomain, ct))
            return new(CreateTenantStatus.SubdomainTaken, Error: $"Subdomain '{tenant.Subdomain}' is already taken.");

        await tenants.AddAsync(tenant, ct);
        return new(CreateTenantStatus.Created, tenant);
    }
}
```

O handler devolve `Created`, `InvalidSubdomain` ou `SubdomainTaken`, não `201`,
`400` ou `409`. Desfechos esperados são valores, não exceções, e o HTTP fica fora
da camada. Como a única coisa que ele sabe sobre armazenamento é a interface que
ele mesmo declarou, o handler é testado com um fake baseado em dicionário e sem
banco. Cada camada se registra com um método de extensão (`AddApplication`), então
a Api não lista handlers um a um.

### Infrastructure: os detalhes

Tudo que fala com o mundo externo mora aqui. O mapeamento do EF é uma classe de
configuração, então a entidade de domínio não tem atributos:

```csharp
internal sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Subdomain).HasMaxLength(63).IsRequired();
        builder.HasIndex(t => t.Subdomain).IsUnique();
    }
}

internal sealed class TenantRepository(TenancyDbContext db) : ITenantRepository
{
    public Task<bool> ExistsAsync(string subdomain, CancellationToken ct) =>
        db.Tenants.AnyAsync(t => t.Subdomain == subdomain, ct);
    // ... AsNoTracking nas leituras, SaveChangesAsync no AddAsync
}
```

O EF Core preenche um `Tenant` pelo construtor e pelos setters privados, então a
entidade mantém suas invariantes. O índice único é a garantia real: o
`ExistsAsync` do handler dá um `409` amigável, e o índice fecha a corrida entre
duas requisições concorrentes. Repositório e configuração são `internal`; a
camada expõe só `AddInfrastructure(connectionString)`. Sair do SQLite para o
PostgreSQL muda este projeto (o pacote e o `UseNpgsql`) e mais nada.

### Api: traduzir e compor

A camada mais externa é a única que conhece HTTP e a única que conhece todas as
outras. Ela transforma resultados em status codes e devolve DTOs, nunca
entidades:

```csharp
group.MapPost("/", async (CreateTenantRequest request, CreateTenantHandler handler, CancellationToken ct) =>
{
    var result = await handler.HandleAsync(request.Subdomain, ct);
    return result.Status switch
    {
        CreateTenantStatus.Created => Results.Created($"/tenants/{result.Tenant!.Id}", new TenantDto(...)),
        CreateTenantStatus.SubdomainTaken => Results.Conflict(result.Error),
        _ => Results.BadRequest(result.Error),
    };
});
```

Resolver o tenant atual a partir do header host é um middleware desta camada que
chama um `ResolveTenantHandler` e guarda a resposta num `ITenantContext` scoped.
O `Program.cs` é o composition root: `AddApplication()`,
`AddInfrastructure(connectionString)` e depois o pipeline.

### Testando cada camada, e a própria regra

- **Testes de Domain** não precisam de setup: `new Tenant("ACME ")` e assert.
- **Testes de Application** usam um `ITenantRepository` falso.
- **Testes de API** rodam a pilha toda com `WebApplicationFactory` e um arquivo
  SQLite temporário, uma vez por cenário que atravessa camadas.
- **Testes de dependência** leem as referências compiladas e falham se uma
  camada interna aponta para fora:

```csharp
Assert.DoesNotContain(typeof(Tenant).Assembly.GetReferencedAssemblies().Select(a => a.Name!),
    name => name.StartsWith("Tenancy.") || name.StartsWith("Microsoft.EntityFrameworkCore"));
```

Uma referência de projeto não usada não é gravada nos metadados do assembly,
então esse teste dispara quando o código realmente usa um tipo da camada errada,
que é o momento que importa.

### Quando isso basta, e quando não

Uma área de negócio, um time e um domínio que cabe na cabeça: quatro projetos
bastam, e há pouco motivo para ir além. Sinais de que foi superado são uma
segunda área de negócio com dados e regras próprios, um projeto `Domain` em que
dois grupos de classes nunca mudam juntos e times se atropelando. Nesse ponto
cada área vira um módulo com seu contrato, que é o monolito modular, e um módulo
pode manter esse formato de quatro camadas por dentro.

## Trade-offs

- **Cerimônia para operações simples.** Um CRUD puro ainda passa por um
  controller, um handler, um repositório e uma chamada do EF. Para um recurso
  fino são quatro arquivos onde um bastaria; as camadas compensam quando há
  regras a proteger.
- **Camadas por papel técnico fazem as features cruzarem projetos.** Adicionar
  "suspender um tenant" toca Domain, Application, Infrastructure e Api. Vertical
  slices agrupam por feature, ao custo de um layout menos uniforme.
- **Um repositório sobre o EF Core é discutível.** O `DbContext` já é unit of
  work e repositório. A porta se justifica quando expressa uma pergunta de
  domínio (`ExistsAsync`) e esconde o formato da query, e vira ruído quando
  repassa `IQueryable` ou espelha todo método do `DbSet`.
  ```csharp
  IQueryable<Tenant> Query(); // vaza comportamento do EF para todo chamador
  ```
- **`Application` vira o depósito.** Sem disciplina ele junta helpers, DTOs e
  "services" que só repassam chamadas. Mantenha-o em casos de uso e nas portas
  de que precisam.
- **A regra é imposta por referência, não por visibilidade.** Nada impede uma
  classe pública na `Api` de alcançar um tipo do `Infrastructure`; o compilador
  só guarda a direção. Mantenha implementações `internal` e adicione testes de
  dependência.
- **Result types versus exceções é questão de estilo.** Devolver um status
  mantém falhas esperadas visíveis na assinatura, mas adiciona um tipo de
  resultado por caso de uso. Exceções são mais curtas e servem para casos
  realmente excepcionais.

## Documentation Links

- [Common web application architectures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) (doc)
- [Architectural principles, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles) (doc)
- [Guid.CreateVersion7, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.guid.createversion7) (doc)
- [Creating and configuring a model, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/) (doc)
- [Clean Architecture, Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) (doc)
