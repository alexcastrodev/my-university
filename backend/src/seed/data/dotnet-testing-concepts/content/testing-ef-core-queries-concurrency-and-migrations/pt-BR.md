---
version: 1.0
updatedAt: 2026-10-18
title: "Testando queries, concorrência e migrations do EF Core"
summary: Em PostgreSQL de verdade, teste a tradução de queries, query filters nomeados, concorrência otimista com xmin, violação de unique como erro de domínio, migrations e drift de modelo, e conte comandos SQL para pegar N+1.
---
## Objective

Parte do comportamento do EF Core só existe entre o seu código e o banco: como
uma query LINQ vira SQL, quais linhas um query filter esconde, se dois writers
entram em conflito, como aparece uma violação de índice único, e se as
migrations constroem o schema que o modelo espera. Um provider fake roda o seu
LINQ como C#, então não vê nada disso. O objetivo é uma suíte MSTest, no
PostgreSQL de verdade do concept anterior, que confere cada uma dessas regras e
pega os bugs que um teste funcional deixa passar: uma query N+1 que devolve os
números certos, uma mudança de modelo sem migration, e um teste de concorrência
que não consegue falhar.

## Use Cases

- Provar que uma busca ignora maiúsculas no PostgreSQL, onde o `Contains` não
  ignora.
- Provar que um tenant nunca vê os pedidos de outro, mesmo quando uma query
  desliga o filtro de soft delete.
- Provar que dois usuários editando o mesmo pedido recebem um
  `DbUpdateConcurrencyException` em vez de uma sobrescrita silenciosa.
- Transformar uma violação de índice único num erro de domínio que a API pode
  mapear para 409.
- Quebrar o build quando alguém muda o modelo e esquece o
  `dotnet ef migrations add`.
- Manter uma página de listagem em um único comando SQL conforme os dados
  crescem.

## Deep Dive

### O que um fake não consegue dizer

O provider InMemory avalia queries como C# sobre listas. Uma query que o
PostgreSQL não consegue traduzir ainda roda lá:

```csharp
// Providers relacionais: InvalidOperationException, "could not be translated".
// Provider InMemory: roda e devolve a linha.
await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => db.Orders
    .Where(o => o.CustomerName.Equals("acme corp", StringComparison.OrdinalIgnoreCase))
    .ToListAsync(testContext.CancellationToken));
```

Esse teste de aprendizado é o primeiro de vários que precisam do banco de
verdade. O lab reaproveita o setup do concept anterior (um PostgreSQL do
Testcontainers por execução, um banco por classe, um `TRUNCATE` antes de cada
teste), com uma mudança: o schema vem das migrations reais.

```csharp
public static async Task<TestDatabase> CreateAsync(string name)
{
    var database = new TestDatabase(await PostgresContainer.CreateDatabaseAsync(name));
    await using var db = database.NewContext("migrations");
    await db.Database.MigrateAsync();
    return database;
}
```

O `EnsureCreated` constrói o schema a partir do modelo e esconderia uma
migration quebrada. O `MigrateAsync` o constrói do jeito que a produção recebe.

### Teste o comportamento do SQL, não o LINQ

O PostgreSQL compara strings diferenciando maiúsculas. Uma busca escrita com
`Contains` vira `LIKE '%acme%'` e não acha "ACME Corp". O módulo usa
`EF.Functions.ILike`, e o teste é o que mantém isso assim:

```csharp
// OrderQueries
db.Orders
    .Where(o => EF.Functions.ILike(o.CustomerName, $"%{term}%"))
    .OrderBy(o => o.Number)
    .Select(o => o.Number)
    .ToListAsync(cancellationToken);

// Teste
await _database.PlaceAsync(Seed.Acme, "A-1", "ACME Corp");
await _database.PlaceAsync(Seed.Acme, "A-2", "Initech");

await using var db = _database.NewContext(Seed.Acme);
var found = await new OrderQueries(db).SearchByCustomerAsync("acme", testContext.CancellationToken);

CollectionAssert.AreEqual(new[] { "A-1" }, found);
```

A query de resumo projeta uma contagem e um total por pedido. O teste dela
inclui de propósito um pedido sem linhas: o EF Core traduz o total para uma
subquery correlacionada envolvida em `COALESCE(sum(...), 0.0)`, então esse
pedido recebe `0`, e não um `NULL` que não vira `decimal`. O `ToQueryString()`
imprime o SQL quando você quiser ver.

### Query filters: teste o filtro que fica, não só o que sai

O EF Core 10 traz query filters nomeados, então uma entidade pode ter vários e
uma query pode desligar só um:

```csharp
order.HasQueryFilter(TenantFilter, o => o.TenantId == TenantId)
    .HasQueryFilter(SoftDeleteFilter, o => !o.IsDeleted);

// OrderQueries: pedidos apagados do tenant atual
db.Orders
    .IgnoreQueryFilters([OrdersDbContext.SoftDeleteFilter])
    .Where(o => o.IsDeleted)
```

O teste ingênuo apaga um pedido do tenant atual e espera vê-lo na lista. Ele
também passa com `IgnoreQueryFilters()`, que desliga todos os filtros e vaza as
linhas dos outros tenants. O teste só significa algo quando o outro tenant
também tem um pedido apagado:

```csharp
await _database.PlaceAsync(Seed.Acme, "A-1");
await _database.PlaceAsync(Seed.Globex, "G-1");
// ... apaga A-1 como acme e G-1 como globex ...

await using var check = _database.NewContext(Seed.Acme);
var deleted = await new OrderQueries(check).DeletedNumbersAsync(Ct);

CollectionAssert.AreEqual(new[] { "A-1" }, deleted);
```

O id do tenant é uma propriedade do contexto (`new OrdersDbContext(options,
"acme")`), e o EF Core o lê como parâmetro a cada execução da query, então um
único modelo atende todos os tenants.

### Concorrência otimista precisa de dois contextos

O Npgsql mapeia uma propriedade `uint` marcada como row version para a coluna
de sistema `xmin` do PostgreSQL, que muda a cada update da linha. Sem coluna
extra, sem trigger:

```csharp
public uint Version { get; private set; }

order.Property(o => o.Version).IsRowVersion();
```

Um conflito precisa de dois leitores da mesma versão. Dois contextos são dois
usuários:

```csharp
await using var first = _database.NewContext(Seed.Acme);
await using var second = _database.NewContext(Seed.Acme);
var firstCopy = await first.Orders.SingleAsync(Ct);
var secondCopy = await second.Orders.SingleAsync(Ct);

firstCopy.ChangeCustomer("ACME Ltd");
await first.SaveChangesAsync(Ct);
secondCopy.ChangeCustomer("ACME Inc");

await Assert.ThrowsExactlyAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync(Ct));
await using var check = _database.NewContext(Seed.Acme);
Assert.AreEqual("ACME Ltd", (await check.Orders.SingleAsync(Ct)).CustomerName);
```

O atalho tentador usa um contexto só: carrega, muda, salva, muda, salva. Ele
nunca entra em conflito, porque depois de cada save o contexto atualiza a versão
que rastreia. O lab mantém essa versão como teste de aprendizado, e a checagem
por mutação mostra que ela continua verde com o token de concorrência removido.

### Mapeie a violação de unique para um erro de domínio

O índice único em `(TenantId, Number)` é a garantia; o serviço transforma a
violação em algo com que quem chama consegue lidar. O filtro confere o SQLSTATE
e o nome do índice, para não engolir um erro de banco sem relação:

```csharp
catch (DbUpdateException e) when (e.InnerException is PostgresException
{
    SqlState: PostgresErrorCodes.UniqueViolation,
    ConstraintName: OrdersDbContext.UniqueOrderNumberIndex,
})
{
    db.Entry(order).State = EntityState.Detached;
    throw new DuplicateOrderNumberException(number, e);
}
```

O teste espera exatamente o tipo de domínio e lê a contagem com um contexto
novo. Um segundo teste prova que o mesmo número está livre em outro tenant, que
é o que o índice composto promete.

### Teste as próprias migrations

Dois testes cobrem as migrations. O primeiro aplica todas num banco vazio e
compara as listas:

```csharp
var connectionString = await PostgresContainer.CreateDatabaseAsync("empty_for_migrations");
var options = new DbContextOptionsBuilder<OrdersDbContext>().UseNpgsql(connectionString).Options;

await using (var db = new OrdersDbContext(options, Seed.Acme))
{
    await db.Database.MigrateAsync(testContext.CancellationToken);

    CollectionAssert.AreEqual(
        db.Database.GetMigrations().ToList(),
        (await db.Database.GetAppliedMigrationsAsync(testContext.CancellationToken)).ToList());
}
```

O segundo pega drift de modelo: uma mudança no modelo sem migration para ela. O
`HasPendingModelChanges()` (EF Core 8 em diante) compara o modelo com o snapshot
da última migration e nunca abre a conexão:

```csharp
var options = new DbContextOptionsBuilder<OrdersDbContext>().UseNpgsql("Host=unused").Options;
using var db = new OrdersDbContext(options, Seed.Acme);

Assert.IsFalse(db.Database.HasPendingModelChanges(), "Run `dotnet ef migrations add` for the model changes.");
```

Desde o EF Core 9, `Migrate` e `MigrateAsync` também lançam exceção quando o
modelo tem mudanças pendentes (`PendingModelChangesWarning`). Nesta suíte toda
classe migra o seu banco, então um modelo com drift deixa todos os testes
vermelhos, e este teste diz o motivo numa linha. O
`dotnet ef migrations has-pending-model-changes` faz a mesma checagem num passo
de CI.

### Conte os comandos para pegar N+1

Um N+1 devolve os dados certos. O teste funcional não o vê; um contador de
comandos vê. Um `DbCommandInterceptor` registra cada query:

```csharp
internal sealed class CommandCounter : DbCommandInterceptor
{
    public List<string> Commands { get; } = [];

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        Commands.Add(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Commands.Add(command.CommandText);
        return ValueTask.FromResult(result);
    }
}
```

Interceptors de comando são registrados por instância de contexto, então cada
teste passa um novo para o `AddInterceptors`. Duas linhas `[DataRow]` deixam o
ponto claro: um comando para 1 pedido e para 5. Um laço com uma query por pedido
manda 1 + N comandos (2 para um pedido, 6 para cinco), e os resumos que ele
devolve continuam certos:

```csharp
[TestMethod]
[DataRow(1)]
[DataRow(5)]
public async Task SummariesTakeOneCommandWhateverTheNumberOfOrders(int orders)
{
    for (var i = 1; i <= orders; i++)
    {
        await _database.PlaceAsync(Seed.Acme, $"A-{i}", "ACME Corp", new NewLine("KB", i, 1m));
    }

    var counter = new CommandCounter();
    await using var db = _database.NewContext(Seed.Acme, counter);
    var summaries = await new OrderQueries(db).SummariesAsync(testContext.CancellationToken);

    Assert.HasCount(orders, summaries);
    Assert.HasCount(1, counter.Commands, string.Join(Environment.NewLine, counter.Commands));
}
```

A mensagem imprime o SQL que rodou, então uma falha mostra o N+1 direto.

### Os testes protegem as regras?

Cada mudança abaixo foi feita sozinha no código de produção do lab:

| Mudança | Testes que falham |
| --- | --- |
| `SummariesAsync` faz uma query por pedido | as duas linhas do teste de contagem (o teste de resumo continua verde) |
| filtro `Tenant` removido | isolamento de tenant, listagem de apagados |
| `IgnoreQueryFilters()` sem nomes | listagem de apagados |
| violação de unique não traduzida | o teste do erro de domínio |
| `ILike` trocado por `Contains` | a busca sem diferenciar maiúsculas |
| propriedade nova, sem migration | os 16 (`MigrateAsync` recusa), com o `HasPendingModelChanges` apontando a causa |
| row version removida, migration adicionada | o teste com dois contextos e o teste de versão; o teste com um contexto continua verde |

## Trade-offs

- **Migrar por classe é mais lento que `EnsureCreated`.** Roda todas as
  migrations para cada classe de teste. Em troca, a suíte roda no schema que a
  produção recebe, e uma migration quebrada falha aqui primeiro.
- **Contagem de comandos é frágil de propósito.** Um upgrade do EF Core que
  divide ou junta uma query muda o número. Conte só onde o número é o requisito
  (uma página de listagem, um relatório), e imprima o SQL na mensagem.
- **O `xmin` é de graça e só existe no PostgreSQL.** Nenhuma coluna para manter,
  mas o token muda em qualquer update da linha, inclusive os que não mexeram nos
  campos que importam, então escritas sem relação no mesmo pedido também
  conflitam.
- **Traduzir erros do banco acopla o serviço ao provider.** O
  `PostgresException` e o SQLSTATE moram no serviço. É o preço de um erro de
  domínio; mantenha a tradução num lugar só.
- **Filtros nomeados são fáceis de desligar sem querer.** O
  `IgnoreQueryFilters()` sem argumentos ainda derruba todos. Um teste com dados
  em dois tenants é a proteção mais barata.
- **Estes são testes de integração.** Mantenha as regras que não precisam de
  banco (regras de preço, transições de estado) em testes unitários simples, e
  use esta suíte para o que só o banco sabe.

## Lab

Um módulo de pedidos multi-tenant com duas migrations reais já está implementado sobre PostgreSQL. Sua tarefa é escrever os testes MSTest para o que só o banco consegue mostrar: tradução de queries, query filters, concorrência, violações de unique, migrations e o número de comandos SQL.

**O que você vai praticar**

- Construir o schema de teste com `MigrateAsync` e detectar drift de modelo com `HasPendingModelChanges`.
- Testar query filters nomeados com dados em dois tenants.
- Produzir um conflito de concorrência otimista de verdade com dois contextos.
- Contar comandos SQL com um `DbCommandInterceptor` para pegar um N+1.

**Pré-requisitos:** Testing Against a Real Database with Testcontainers (concept e lab), query filters, tokens de concorrência e migrations do EF Core, .NET 10 SDK e Docker rodando na máquina.

**Como funciona:** o container, o banco por classe e o reset já estão prontos. Cada teste está declarado com uma dica e falha com `TODO-NN` até você escrevê-lo. Três armadilhas esperam por você: um N+1 que o teste funcional não vê, uma mudança de modelo sem migration, e um teste de concorrência com um contexto só que não prova nada. Os TODOs opcionais percorrem um drift de verdade e uma checagem por mutação.

## Documentation Links

- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Concurrency tokens, Npgsql EF Core provider](https://www.npgsql.org/efcore/modeling/concurrency.html) (doc)
- [Breaking changes in EF Core 9 (pending model changes), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes) (doc)
- [What's new in EF Core 8 (HasPendingModelChanges), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew) (doc)
- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [Transactions and savepoints, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
