---
version: 1.0
updatedAt: 2026-10-04
title: "Mapeando o Domínio com o EF Core"
summary: Owned types vs complex types, value converters, construtor privado e backing fields, e quando usar um repository em vez do DbContext direto.
---
## Objective

Um modelo de domínio rico tem setters privados, construtor privado, value
objects e coleções escondidas atrás da raiz. O EF Core consegue persistir tudo
isso sem transformar o modelo num saco anêmico de propriedades públicas, mas só
se o mapeamento for configurado de propósito. Este conceito cobre as
ferramentas de mapeamento que importam para DDD (owned types, complex types,
value converters, backing fields e construtores privados) e a pergunta
recorrente sobre envolver ou não o `DbContext` num repository.

## Use Cases

- Persistir um value object `Money` como duas colunas (`Amount`, `Currency`) na
  linha do pedido, sem uma tabela própria.
- Mapear `OrderId` e outros IDs fortemente tipados para uma coluna `uuid`
  simples.
- Carregar um `Order` por um construtor privado e preencher sua lista privada
  `_lines`, sem nunca expor um setter público.
- Escolher entre `IOrderRepository` e injetar `OrdersDbContext` diretamente num
  command handler.

## Deep Dive

### Owned types e complex types

Os dois mapeiam um value object para colunas da tabela do dono. Eles diferem na
semântica de identidade. Um owned type ainda é uma entity por dentro: tem uma
chave oculta, é rastreado por referência e pode ficar em tabela própria ou em
uma coluna JSON. Um complex type (EF Core 8 em diante) não tem identidade
nenhuma, é rastreado por valor, e duas propriedades podem ter valores iguais
sem serem "a mesma" instância. Esse segundo comportamento é mais próximo do que
um value object significa:

```csharp
// Complex type: semântica de valor, sem chave oculta.
builder.ComplexProperty(o => o.Total, m =>
{
    m.Property(x => x.Amount).HasColumnName("total_amount").HasPrecision(18, 2);
    m.Property(x => x.Currency).HasColumnName("total_currency").HasMaxLength(3);
});

// Owned type: semântica de referência, pode ser coleção com tabela própria.
builder.OwnsMany(o => o.Lines, l =>
{
    l.WithOwner().HasForeignKey("OrderId");
    l.Property<int>("Id");
    l.HasKey("Id");
    l.Property(x => x.Quantity);
});
```

O EF Core 10 fechou duas lacunas que empurravam as pessoas para owned types:
complex types agora podem ser opcionais (um `Address?` anulável) e podem ser
mapeados para uma única coluna JSON. Um complex type opcional ainda precisa
declarar pelo menos uma propriedade obrigatória, para o EF Core distinguir um
valor `null` de um cujas propriedades são todas `null`.

Use um complex type para um único value object que só é substituído por
inteiro (`Money`, `Address`). Use um owned type, ou uma entity de verdade,
quando a parte tem ciclo de vida próprio, como as linhas de um pedido que são
adicionadas e removidas ao longo do tempo.

### Value converters

Quando o value object embrulha um único valor, um converter o mapeia para uma
coluna. É assim que IDs fortemente tipados, enums guardados como string e
wrappers simples são persistidos:

```csharp
builder.Property(o => o.Id)
    .HasConversion(id => id.Value, value => new OrderId(value))
    .ValueGeneratedNever(); // o domínio cria o id, não o banco

builder.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);
```

`ValueGeneratedNever()` importa: por convenção, o EF Core trata uma chave `Guid`
como gerada na inclusão e usa uma chave diferente do default para decidir se
uma entity desconectada é nova ou já está armazenada. Declarar que o domínio é
dono da chave elimina esse palpite.

### Construtores privados e backing fields

O EF Core materializa uma entity por qualquer construtor que consiga usar,
inclusive um privado sem parâmetros, e depois atribui as propriedades mesmo
quando o setter é privado. Para coleções, diga a ele para usar o campo, de modo
que o `IReadOnlyList` público da raiz nunca precise ser gravável:

```csharp
builder.Navigation(o => o.Lines)
    .HasField("_lines")
    .UsePropertyAccessMode(PropertyAccessMode.Field);
```

Por convenção o EF Core já encontra `_lines` para uma propriedade `Lines`, mas
ser explícito documenta a intenção e sobrevive a um rename de qualquer um dos
nomes.

### Repository ou DbContext?

O `DbContext` já implementa a unit of work e funciona como um repository por
aggregate (`db.Orders`). Um repository por cima dele só se justifica quando faz
algo que o contexto não faz:

```csharp
// Vale a pena: carrega o aggregate inteiro e esconde a cadeia de Include.
public interface IOrderRepository
{
    Task<Order?> GetAsync(OrderId id, CancellationToken ct);
    void Add(Order order);
}

internal sealed class OrderRepository(OrdersDbContext db) : IOrderRepository
{
    public Task<Order?> GetAsync(OrderId id, CancellationToken ct) =>
        db.Orders.Include(o => o.Lines).SingleOrDefaultAsync(o => o.Id == id, ct);

    public void Add(Order order) => db.Orders.Add(order);
}
```

Para escritas, um repository pequeno por raiz de aggregate mantém "sempre
carregar o aggregate inteiro" num só lugar. Para leituras (listas, busca,
relatórios), pule-o e consulte o `DbContext` com projeções direto para DTOs,
porque um repository que devolve aggregates é o formato errado para um modelo
de leitura.

## Trade-offs

- **Owned types escondem uma identidade que você não modelou.** Uma coleção
  `OwnsMany` ganha uma chave shadow, e substituir a coleção inteira gera deletes
  e inserts para cada item em vez de updates.
  ```csharp
  order.ReplaceLines(newLines); // apaga todas as linhas antigas, insere todas as novas
  ```
  Se as linhas têm significado próprio (auditoria, links de outras tabelas),
  modele-as como entities.
- **Complex types não podem ser consultados nem rastreados como entities.** Não
  há `DbSet<Money>`, nem foreign key para um, e um complex type usado como value
  object é melhor mantido imutável, então mudá-lo significa atribuir um novo
  valor (o EF Core ainda rastreia as mudanças por propriedade).
  ```csharp
  order.Total = order.Total with { Amount = 20m }; // ok: substitui o valor
  order.Total.Amount = 20m;                        // não compila: Money não tem setters
  ```
- **Converters podem atrapalhar a tradução de queries.** Um value converter que
  chama código arbitrário nem sempre pode ser traduzido para SQL, então comparar
  uma propriedade convertida num `Where` pode falhar ou forçar avaliação no
  cliente.
  ```csharp
  db.Orders.Where(o => o.Id == id)      // ok, o converter se aplica ao parâmetro
  db.Orders.Where(o => o.Id.Value == x) // pode falhar: Value não é uma propriedade mapeada
  ```
- **Um repository genérico esconde o que você precisa.** `IRepository<T>` com
  `GetAll()` devolvendo `IQueryable<T>` vaza o ORM, e um que devolve
  `IEnumerable<T>` carrega a tabela inteira. Um repository específico por raiz
  de aggregate é menor e honesto sobre o que carrega.
- **Mapeamento privado é invisível para o compilador.** Renomeie `_lines` e o
  EF Core cai silenciosamente em outro modo de acesso ou falha na inicialização,
  então cubra o mapeamento com um teste que salva e recarrega um aggregate.

## Documentation Links

- [Owned entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/owned-entities) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#value-objects-using-complex-types) (doc)
- [What is new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Value conversions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/value-conversions) (doc)
- [Backing fields, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/backing-field) (doc)
- [Implement the infrastructure persistence layer with Entity Framework Core, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-implementation-entity-framework-core) (doc)
