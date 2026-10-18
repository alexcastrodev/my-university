---
version: 1.0
updatedAt: 2026-10-15
title: "Construção do Modelo no EF Core: Convenções, Annotations e Fluent API"
summary: Quem vence entre convenção, data annotation e Fluent API (conferido no modelo e na migration reais), defaults com ConfigureConventions, IEntityTypeConfiguration, HasData na migration e modelos compilados.
---
## Objective

O EF Core monta o modelo a partir de três fontes de configuração: convenções que
leem suas classes, data annotations (atributos) nelas e a Fluent API em
`OnModelCreating`. Quando duas discordam, uma vence, e a regra nem sempre é
óbvia. Este conceito mostra a precedência inspecionando o modelo e a migration
reais, como aplicar um default a muitas propriedades sem quebrar essa
precedência, como manter a configuração em uma classe por entidade, como `HasData`
difere do seeding em runtime na migration gerada e quando vale gerar um modelo
compilado.

## Use Cases

- Decidir onde uma regra como "nomes têm no máximo 100 caracteres" deve morar: num
  atributo, no `OnModelCreating` ou como default para toda string.
- Explicar por que um `[MaxLength(50)]` parece ser ignorado.
- Quebrar um `OnModelCreating` de 400 linhas em algo revisável.
- Semear linhas de lookup para que viajem junto com as migrations.
- Reduzir a latência da primeira consulta de um app com um modelo muito grande.

## Deep Dive

### Convenção, annotation, Fluent API: quem vence

O EF Core registra como cada pedaço de configuração foi feito, como um
`ConfigurationSource`: `Convention`, `DataAnnotation` ou `Explicit` (Fluent API).
Uma fonte só pode ser sobrescrita por outra igual ou mais forte, então a ordem é
Fluent API sobre data annotation sobre convenção. Considere esta entidade:

```csharp
public class Product
{
    public int Id { get; set; }                  // convenção: chave primária
    public string Plain { get; set; } = "";      // convenção: obrigatória (string não nula)
    [MaxLength(50)]
    public string Annotated { get; set; } = "";  // data annotation
    [MaxLength(50)]
    public string Both { get; set; } = "";       // annotation e Fluent API discordam
    public string? Optional { get; set; }        // convenção: reference type anulável, coluna anulável
}
// OnModelCreating: modelBuilder.Entity<Product>().Property(p => p.Both).HasMaxLength(100);
```

Ler o modelo de design-time (`IDesignTimeModel`, com cast para `IConventionProperty`)
imprime o valor e a fonte de cada faceta:

```
property     maxLength  required  maxLength set by
Id           -          True      -
Plain        -          True      -
Annotated    50         True      DataAnnotation
Both         100        True      Explicit
Optional     -          False     -
```

`Both` vale 100: a Fluent API venceu o atributo. A anotação de nulidade do tipo C#
(`string?`) decidiu `Optional`, que é a convenção em ação.

### Um default para muitas propriedades, sem perder a precedência

Repetir `HasMaxLength` em toda string é ruído, então há duas formas de definir um
default. Elas se comportam de modo diferente, e a diferença é uma armadilha. A
configuração pré-convenção em `ConfigureConventions` roda antes das convenções,
mas conta como configuração explícita:

```csharp
protected override void ConfigureConventions(ModelConfigurationBuilder b)
    => b.Properties<string>().HaveMaxLength(200);
```

Rodando a mesma entidade com ela:

```
Annotated    200   Explicit      <- o [MaxLength(50)] perdeu
Both         100   Explicit      <- uma chamada Fluent posterior ainda vence
Plain        200   Explicit
Optional     200   Explicit
```

A página oficial diz isso diretamente: a configuração pré-convenção sobrescreve
todas as convenções e data annotations. Se você quer um default que as annotations
ainda possam sobrescrever, registre uma model finalizing convention, que usa o
convention builder e por isso nunca sobrescreve um atributo nem uma chamada
Fluent:

```csharp
class DefaultLength : IModelFinalizingConvention
{
    public void ProcessModelFinalizing(IConventionModelBuilder model, IConventionContext<IConventionModelBuilder> ctx)
    {
        foreach (var p in model.Metadata.GetEntityTypes()
                     .SelectMany(e => e.GetDeclaredProperties())
                     .Where(p => p.ClrType == typeof(string)))
            p.Builder.HasMaxLength(200);
    }
}
// ConfigureConventions: b.Conventions.Add(_ => new DefaultLength());
```

```
Annotated    50    DataAnnotation   <- o atributo sobrevive
Both         100   Explicit
Plain        200   Convention
Optional     200   Convention
```

Use `Properties<T>()` para uma regra que precisa valer em todo lugar (todo `Money`
usa este converter) e uma finalizing convention para um default que exceções
podem sobrescrever. Convenções customizadas chegaram no EF Core 7.

Uma armadilha prática ao experimentar: o EF Core monta o modelo uma vez por tipo
de contexto e o guarda em cache. Minha primeira execução, com uma única classe de
contexto alternada por um argumento de construtor, imprimiu resultados idênticos
em todos os modos. Cada variante precisou da sua própria subclasse de `DbContext`.

### Uma classe de configuração por entidade

`IEntityTypeConfiguration<T>` tira as chamadas Fluent do `OnModelCreating`, e uma
única chamada acha todas:

```csharp
public class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> b)
    {
        b.ToTable("products");
        b.Property(p => p.Sku).HasMaxLength(20);
        b.HasIndex(p => p.Sku).IsUnique();
        b.Property(p => p.Price).HasColumnName("unit_price");
        b.Property(p => p.Name).HasMaxLength(150);   // Name também tem [MaxLength(100)]
    }
}

protected override void OnModelCreating(ModelBuilder mb)
    => mb.ApplyConfigurationsFromAssembly(typeof(ShopContext).Assembly);
```

Adicionar uma migration com `dotnet ef migrations add Initial` mostra o resultado
combinado das três fontes. As colunas abaixo saíram do arquivo gerado:

```csharp
migrationBuilder.CreateTable(
    name: "products",                                   // Fluent: ToTable
    columns: table => new
    {
        Id = table.Column<int>(type: "INTEGER", nullable: false)
            .Annotation("Sqlite:Autoincrement", true),  // convenção: chave int
        Name = table.Column<string>(type: "TEXT", maxLength: 150, nullable: false), // Fluent venceu [MaxLength(100)]
        Sku = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
        unit_price = table.Column<decimal>(type: "TEXT", nullable: false),
        CategoryId = table.Column<int>(type: "INTEGER", nullable: false),           // convenção: FK obrigatória
        Note = table.Column<string>(type: "TEXT", nullable: true)
    },
    constraints: table =>
    {
        table.PrimaryKey("PK_products", x => x.Id);
        table.ForeignKey("FK_products_Categories_CategoryId", x => x.CategoryId,
            principalTable: "Categories", principalColumn: "Id",
            onDelete: ReferentialAction.Cascade);       // convenção: relação obrigatória faz cascade
    });
```

Repare em dois fatos do provider. Um `decimal` é guardado como `TEXT` no SQLite, e
o `maxLength: 80` que o modelo carrega para uma propriedade `[MaxLength(80)]` nunca
chega ao `CREATE TABLE` do SQLite, que diz apenas `TEXT`. O modelo guarda o
metadado; se o banco o impõe depende do provider.

### HasData versus seeding em runtime, na migration

`HasData` faz parte do modelo, então cai na migration. `UseSeeding` é código que
roda depois do `Migrate()`, então não cai. Os dois foram configurados no mesmo
projeto:

```csharp
// CategoryConfiguration: b.HasData(new Category { Id = 1, Name = "Books" }, new Category { Id = 2, Name = "Games" });
// OnConfiguring: UseSeeding(... adiciona Category { Id = 3, Name = "Added at runtime" } se faltar ...)
```

A migration contém `InsertData` só para as linhas 1 e 2. Depois do `Migrate()` a
tabela tinha `1 Books`, `2 Games` e `3 Added at runtime`. O conceito de CRUD e
seeding cobre o trade-off entre os dois; o ângulo de construção do modelo é que
`HasData` exige valores de chave explícitos e transforma cada edição nos dados em
uma nova migration.

### Modelos compilados

`dotnet ef dbcontext optimize` gera C# que monta o modelo diretamente (cinco
arquivos para o modelo de duas entidades daqui). Você ativa com
`options.UseModel(Shop.CompiledModels.ShopContextModel.Instance)`. Com isso ligado,
minhas consultas rodaram e o `OnModelCreating` não foi chamado. A orientação
oficial é usar modelos compilados só quando o startup é lento, o que significa
modelos com centenas a milhares de entity types, e lista limitações: sem global
query filters, sem lazy loading nem proxies de change tracking, e o modelo precisa
ser regenerado à mão sempre que sua definição muda. No meu teste o `Migrate()`
ainda executou o `OnModelCreating`, porque precisa do modelo de design-time.

## Trade-offs

- **Defaults pré-convenção vencem annotations em silêncio.** Alguém adiciona
  `[MaxLength(50)]`, a coluna continua no default global e nada avisa.
  ```csharp
  b.Properties<string>().HaveMaxLength(200); // [MaxLength(50)] numa propriedade deixa de valer
  ```
  Prefira uma finalizing convention quando os atributos devem continuar funcionando.
- **Annotations colocam regras de persistência na entidade.** `[MaxLength]` e
  `[Column]` ficam legíveis ao lado da propriedade, mas acoplam uma classe de
  domínio ao EF Core, o que pesa no estilo DDD do conceito de mapeamento. Mantenha
  modelos ricos limpos e configure-os em `IEntityTypeConfiguration<T>`.
- **Convenções mudam o banco sem uma linha de código visível.** Um `int CategoryId`
  não nulo tornou a relação obrigatória e o delete em cascade. Confira a migration
  gerada, não só o C#.
  ```csharp
  public int? CategoryId { get; set; } // opcional: ClientSetNull, sem ON DELETE CASCADE no DDL
  ```
- **Vários lugares podem configurar a mesma faceta.** A última chamada explícita
  vence, então um `HasMaxLength` no `OnModelCreating` depois do
  `ApplyConfigurationsFromAssembly` pode sobrescrever a classe de configuração.
  Mantenha cada faceta em um só lugar.
- **O mapeamento varia por provider.** `decimal` virou `TEXT` no SQLite, e lá os
  tamanhos não são impostos. Um teste no SQLite não prova o formato da coluna no
  SQL Server.
- **Modelos compilados ficam desatualizados.** Mude o modelo e esqueça de rodar
  `dotnet ef dbcontext optimize`, e o app roda com o formato antigo. Regenere no
  build, e pule o recurso para modelos pequenos.

## Lab

Neste lab você vê quem vence quando uma convenção, uma data annotation e a Fluent API discordam, e organiza a configuração do modelo com `IEntityTypeConfiguration<T>`, uma convenção de finalização do modelo e `HasData`. Você recebe `Product` e `Category` mapeados só por convenções e atributos, e os pontos de configuração estão vazios, com comentários `TODO`. A ideia central é que o modelo do EF Core é um conjunto de metadados em camadas (convenção, atributo, Fluent API), e os testes inspecionam esses metadados em vez de abrir um banco de servidor.

**O cenário**

Uma loja tem produtos e categorias, e o modelo precisa de nomes de tabela e coluna, tamanhos, índices, conversão de enum e dados iniciais.

- `Entities.cs`: `Product` (com `[MaxLength(50)]` em `Name`, `Sku`, `Price`, um enum `Status`, `CachedLabel`) e `Category` (com `[MaxLength(50)]` em `Slug`).
- `Configurations.cs`: `ProductConfiguration` e `CategoryConfiguration`, ambas `IEntityTypeConfiguration<T>`.
- `ShopDbContext.cs`: `OnModelCreating`, `ConfigureConventions` e a `DefaultStringLengthConvention` (uma `IModelFinalizingConvention`).
- `ShopDbOptions.cs`: as opções do contexto, com SQLite em memória.

Os testes lêem os metadados do modelo (`IModel`) e também criam o banco com `EnsureCreated` para ver o `HasData` e o índice único funcionando.

**O que você vai fazer, passo a passo**

1. **Tabela e tamanho (TODO-00).** Em `ProductConfiguration`, mapeie `Product` para a tabela `products` e permita 120 caracteres em `Name`. Como `Name` também tem `[MaxLength(50)]`, descubra quem vence (a Fluent API).
2. **Sku único (TODO-01).** Limite `Sku` a 20 caracteres e crie um índice único.
3. **Coluna de preço (TODO-02).** Guarde `Price` na coluna `unit_price` com precisão 18 e escala 2.
4. **Fora do modelo (TODO-03).** Ignore `CachedLabel`, um valor só de runtime.
5. **Aplicar as configurações (TODO-04).** Em `OnModelCreating`, aplique todas as `IEntityTypeConfiguration<T>` do assembly.
6. **Convenção de tamanho (TODO-05 e TODO-06).** Em `DefaultStringLengthConvention`, dê 200 caracteres a toda propriedade string pelo construtor de convenção (`property.Builder.HasMaxLength`), para que atributos e Fluent ainda possam sobrescrever. Registre-a em `ConfigureConventions` e armazene `ProductStatus` como texto.
7. **Dados iniciais (TODO-07).** Em `CategoryConfiguration`, use `HasData` para duas categorias: Id 1 "Books" (slug "books") e Id 2 "Games" (slug "games"). `HasData` exige chaves explícitas.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar por que `Category.Slug` continua com 50 caracteres mesmo com a convenção de 200, e por que `Category` continua na tabela `Categories` enquanto `Product` vai para `products`.

**Desafios opcionais**

- **TODO-08:** em `ShopDbOptions`, um `UseSeeding` que adiciona uma terceira categoria em runtime. Compare com `HasData`: só `HasData` entra numa migration.
- **TODO-09:** uma check constraint `CK_products_price` para que `unit_price` não seja negativo.
- **TODO-10:** em `PreConventionShopDbContext`, defina o tamanho padrão com `Properties<string>().HaveMaxLength` e veja o que acontece com o `[MaxLength(50)]` de `Category.Slug`.

**Pré-requisitos:** noções de EF Core (`DbContext`, `DbSet`, a ideia de migrations), atributos como `[MaxLength]` e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os testes usam SQLite em memória, sem servidor. Os pontos a preencher são comentários `TODO-NN` dentro de `Configurations.cs`, `ShopDbContext.cs` e `ShopDbOptions.cs`, e cada teste vermelho aponta o que ainda falta.

## Documentation Links

- [Creating and configuring a model, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/) (doc)
- [Model bulk configuration, ConfigureConventions and custom conventions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/bulk-configuration) (doc)
- [Entity properties, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/entity-properties) (doc)
- [Data seeding, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/data-seeding) (doc)
- [Compiled models, advanced performance topics, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#compiled-models) (doc)
- [EF Core tools reference, dotnet ef, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
