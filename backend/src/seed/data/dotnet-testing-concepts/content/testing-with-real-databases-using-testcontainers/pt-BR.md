---
version: 1.0
updatedAt: 2026-10-18
title: "Testando contra um banco de dados real com Testcontainers"
summary: Um container PostgreSQL por execução com Testcontainers, um banco por classe de teste, isolamento por transação, Respawn ou TRUNCATE, e testes de aprendizado que mostram o que o InMemory e o SQLite deixam passar.
---
## Objective

A própria documentação do EF Core recomenda testar contra o banco de dados que
você roda em produção, e chama o provider InMemory de "highly discouraged" como
dublê de teste. Este concept transforma esse conselho numa suíte MSTest: um
container PostgreSQL iniciado pelo Testcontainers para a execução inteira, um
banco por classe de teste, e uma estratégia de reset para que os testes nunca
vejam as linhas uns dos outros. O objetivo é uma suíte que pega o que só o banco
de verdade confere (índices únicos, tamanho de coluna, códigos de erro), roda em
segundos e falha pelo motivo certo.

## Use Cases

- Provar que um índice único ou uma coluna `varchar(20)` rejeita mesmo dados
  ruins, coisa que nem o provider InMemory nem o SQLite fazem.
- Substituir uma suíte construída sobre `UseInMemoryDatabase` que fica verde
  enquanto a produção lança exceção.
- Rodar testes de banco no CI em qualquer runner que tenha Docker, sem um
  servidor de testes compartilhado para manter limpo.
- Isolar testes que escrevem dados, tanto quando o código aceita a transação do
  teste quanto quando ele faz commit por conta própria.
- Impedir que alguns segundos de startup do container virem alguns segundos por
  teste.

## Deep Dive

### O que o EF Core recomenda, e o que ele desencoraja

O guia de testes do EF Core compara as opções. O resumo dele é curto:

| Opção | O que o guia diz |
| --- | --- |
| O seu banco de produção | Recomendado. Comece por ele; os testes podem rodar de forma confiável e rápida. |
| Repository pattern com stubs | O dublê confiável quando você precisa de um, com um custo real. |
| SQLite em memória | Um fake. Providers se comportam diferente, então passar no SQLite não garante nada. |
| Provider InMemory do EF Core | "Highly discouraged": sem transações, sem SQL cru, menos queries. |
| Mock de `DbSet` para queries | Evite. |

O guia também cita o Testcontainers como o jeito de automatizar um banco em
container. O resto deste concept é como fazer isso bem com MSTest. A teoria de
quais dependências testar de verdade (gerenciadas versus não gerenciadas) está
nos concepts de teste em Java linkados abaixo; ela vale igual para .NET.

### O fake diz sim, o banco diz não

O módulo de estoque tem um produto com um SKU único de no máximo 20 caracteres:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    var product = modelBuilder.Entity<Product>();
    product.Property(p => p.Sku).HasMaxLength(Product.SkuMaxLength); // 20
    product.Property(p => p.Name).HasMaxLength(100);
    product.HasIndex(p => p.Sku).IsUnique();
}
```

Dois testes de aprendizado fixam o que os fakes deixam passar. Os dois são
verdes, e cada um descreve um bug que uma suíte baseada no fake mandaria para
produção:

```csharp
[TestMethod]
public async Task TheInMemoryProviderAcceptsADuplicateSku()
{
    var options = new DbContextOptionsBuilder<InventoryDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options;
    await using var db = new InventoryDbContext(options);
    var service = new StockService(db);

    await service.RegisterAsync("SKU-1", "Keyboard", testContext.CancellationToken);
    await service.RegisterAsync("SKU-1", "Another keyboard", testContext.CancellationToken);

    Assert.AreEqual(2, await db.Products.CountAsync(testContext.CancellationToken));
}
```

O SQLite impõe o índice único, mas não o tamanho: um SKU de 21 caracteres é
gravado inteiro. O PostgreSQL recusa os dois, e o teste confere o erro pelo
SQLSTATE, não pela mensagem:

```csharp
var duplicate = await Assert.ThrowsExactlyAsync<DbUpdateException>(
    () => new StockService(db).RegisterAsync("SKU-1", "Another keyboard", Ct));
var postgres = Assert.IsInstanceOfType<PostgresException>(duplicate.InnerException);
Assert.AreEqual(PostgresErrorCodes.UniqueViolation, postgres.SqlState); // 23505
```

O SKU longo demais falha do mesmo jeito com
`PostgresErrorCodes.StringDataRightTruncation` (`22001`). O provider InMemory
tem mais uma surpresa: chamar `BeginTransactionAsync` nele lança exceção,
porque o `TransactionIgnoredWarning` que ele gera é um erro por padrão.

### Um container por execução

Um container leva segundos para subir, então suba uma vez só. O
`[AssemblyInitialize]` do MSTest roda uma vez antes de qualquer teste do
assembly; ele precisa ser `public static`, receber um `TestContext` e pode
devolver `Task`. O `[AssemblyCleanup]` correspondente faz o dispose:

```csharp
[TestClass]
public static class PostgresContainer
{
    private static PostgreSqlContainer? _container;

    [AssemblyInitialize]
    public static async Task StartAsync(TestContext testContext)
    {
        var stopwatch = Stopwatch.StartNew();
        _container = new PostgreSqlBuilder("postgres:18-alpine").Build();
        await _container.StartAsync(testContext.CancellationToken);
        testContext.WriteLine($"PostgreSQL container started in {stopwatch.ElapsedMilliseconds} ms");
    }

    [AssemblyCleanup]
    public static async Task StopAsync()
    {
        if (_container is not null)
        {
            await _container.DisposeAsync();
        }
    }
}
```

O pacote é o `Testcontainers.PostgreSql` (4.16.0 hoje). Passe a imagem para o
builder, para que um upgrade da biblioteca nunca troque a versão do seu banco
pelas suas costas. O `GetConnectionString()` devolve a connection string do
container iniciado; nada de host, porta ou senha fica fixo no código.

No xUnit, o mesmo papel é de uma fixture compartilhada entre classes (o guia do
EF Core usa `IClassFixture` com um lock); no MSTest, os métodos de nível de
assembly são o lugar natural.

### Um banco por classe de teste

Um banco dentro de um container que já está rodando custa milissegundos. Dê a
cada classe de teste o seu, e as classes podem rodar em paralelo sem se ver:

```csharp
public static async Task<string> CreateDatabaseAsync(string name)
{
    var admin = Container.GetConnectionString();
    await using (var connection = new NpgsqlConnection(admin))
    {
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    return new NpgsqlConnectionStringBuilder(admin) { Database = name }.ConnectionString;
}
```

A classe cria o seu banco no `[ClassInitialize]` e o schema com
`EnsureCreatedAsync` (o próximo concept aplica migrations de verdade):

```csharp
[ClassInitialize]
public static async Task CreateDatabaseAsync(TestContext _) =>
    _database = await TestDatabase.CreateAsync("rollback_tests");
```

Os métodos de uma classe dividem esse banco, então não podem rodar ao mesmo
tempo. O escopo de paralelismo do MSTest diz exatamente isso:

```csharp
// MSTestSettings.cs: classes em paralelo, métodos de uma classe em sequência
[assembly: Parallelize(Scope = ExecutionScope.ClassLevel)]
```

O `ExecutionScope.MethodLevel`, que o `dotnet new mstest` sugere, rodaria dois
testes da mesma classe contra as mesmas tabelas ao mesmo tempo.

### Reset 1: uma transação por teste

O isolamento mais barato é uma transação que nunca recebe commit. O teste ganha
um contexto com a transação já aberta, e o dispose do contexto faz o rollback:

```csharp
[TestInitialize]
public async Task BeginTransactionAsync()
{
    _db = _database.NewContext();
    await _db.Database.BeginTransactionAsync(testContext.CancellationToken);
}

public ValueTask DisposeAsync() => _db.DisposeAsync(); // sem commit: rollback
```

O teste então precisa ler de volta pelo mesmo contexto, e essa é a armadilha.
Uma query num contexto devolve a instância que ele já rastreia, então um teste
que não limpou o tracker passa mesmo quando nada foi salvo:

```csharp
// Quebrado: verde mesmo se ReceiveAsync esquecer o SaveChangesAsync
await service.ReceiveAsync("SKU-1", 5, Ct);
var stored = await _db.Products.SingleAsync(p => p.Sku == "SKU-1", Ct);
Assert.AreEqual(5, stored.OnHand);

// Corrigido: esquece as instâncias rastreadas, e a query lê a linha
await service.ReceiveAsync("SKU-1", 5, Ct);
_db.ChangeTracker.Clear();
var stored = await _db.Products.SingleAsync(p => p.Sku == "SKU-1", Ct);
Assert.AreEqual(5, stored.OnHand);
```

Um save que falha não envenena a transação do teste. Quando já existe uma
transação aberta, o `SaveChanges` do EF Core cria antes um savepoint e volta
para ele em caso de erro, então um teste pode esperar uma violação de unique e
continuar consultando.

Essa estratégia quebra quando o código testado não usa o contexto do teste:
código que abre o próprio contexto, a própria transação, ou roda dentro de um
host web.

### Reset 2: deixe fazer commit, depois Respawn

Quando o código precisa fazer commit de verdade, resete o banco antes de cada
teste. O Respawn (7.0.0) lê o schema uma vez e monta o comando de limpeza:

```csharp
[ClassInitialize]
public static async Task CreateDatabaseAsync(TestContext _)
{
    _database = await TestDatabase.CreateAsync("respawn_tests");
    await using var connection = new NpgsqlConnection(_database.ConnectionString);
    await connection.OpenAsync();
    _respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
    {
        DbAdapter = DbAdapter.Postgres,
        SchemasToInclude = ["public"],
    });
}

[TestInitialize]
public async Task ResetAsync()
{
    await using var connection = new NpgsqlConnection(_database.ConnectionString);
    await connection.OpenAsync(testContext.CancellationToken);
    await _respawner.ResetAsync(connection);
}
```

Para PostgreSQL, o Respawn precisa de uma conexão aberta e roda um único
`truncate table ... cascade` sobre as tabelas que encontrou. A versão 7 consegue
inferir o adapter pela conexão, então o `DbAdapter` é opcional. Ele não
reinicia as sequences de identidade por padrão: os ids continuam crescendo entre
os testes, o que não tem problema enquanto nenhum teste fizer assert sobre um
id. Toda asserção aqui usa um contexto novo, então lê o que recebeu commit:

```csharp
await using (var db = _database.NewContext())
{
    var service = new StockService(db);
    await service.RegisterAsync("SKU-1", "Keyboard", Ct);
    await service.ReceiveAsync("SKU-1", 5, Ct);
}

await using var check = _database.NewContext();
Assert.AreEqual(5, (await check.Products.SingleAsync(Ct)).OnHand);
```

### Reset 3: TRUNCATE na mão

O Respawn poupa você de listar as tabelas. Para um schema pequeno, uma linha de
SQL faz o mesmo e ainda reinicia as sequences:

```csharp
await db.Database.ExecuteSqlRawAsync("""TRUNCATE "Products" RESTART IDENTITY CASCADE""", ct);
```

O preço é uma lista de tabelas que você precisa atualizar quando o modelo
cresce.

| Estratégia | Use quando | Cuidado com |
| --- | --- | --- |
| Transação por teste | o código aceita o contexto do teste | ler de volta sem `ChangeTracker.Clear()` |
| Respawn antes de cada teste | o código faz commit por conta própria | os ids não são reiniciados por padrão |
| `TRUNCATE` antes de cada teste | o schema é pequeno e estável | uma tabela nova que você esqueceu de listar |
| Um banco novo por teste | isolamento total vale o tempo | um `CREATE DATABASE` e um schema por teste |

### Ryuk, CI e tempo de startup

O Testcontainers sobe um segundo container, o Ryuk (o resource reaper), ao lado
do seu. Se o processo de teste morrer antes do `[AssemblyCleanup]` rodar, o Ryuk
remove o que a sessão criou. A documentação pede para não desligá-lo, exceto em
nós de CI que se limpam sozinhos, com `TESTCONTAINERS_RYUK_DISABLED=true`.

No CI o único requisito é Docker: os runners hospedados do GitHub e os agentes
hospedados pela Microsoft no Azure Pipelines já têm. O tempo de pull é o custo
da primeira execução; depois disso, num notebook com a imagem em cache, o lab
deste concept (startup do container, três bancos, onze testes) roda em cerca de
3 segundos.

Uma pegadinha local vale saber. O Testcontainers para Java pode escrever o
`~/.testcontainers.properties` com `docker.host=unix\:///var/run/docker.sock`.
A biblioteca .NET lê essa barra invertida literalmente e falha com "This
operation is not supported for a relative URI". Definir `DOCKER_HOST` passa por
cima disso.

### Os testes protegem as regras?

Quebre o código de produção de propósito, uma mudança por vez, e veja o que fica
vermelho. Estes são os resultados para a solução do lab:

| Mudança | Testes que falham |
| --- | --- |
| `ReceiveAsync` não chama `SaveChangesAsync` | 4 testes, nas duas classes de isolamento |
| `.IsUnique()` removido do índice do SKU | o teste de duplicado no PostgreSQL |
| `Product.Reserve` pula a checagem de estoque | o teste de reserva |
| `HasMaxLength` removido do SKU | o teste de tamanho no PostgreSQL |
| (código de teste) reset do Respawn pulado | 2 testes, dependendo da ordem em que rodaram |

Dois resultados importam mais que a tabela. Com a primeira mudança e a linha do
`ChangeTracker.Clear()` removida, o teste de rollback fica verde de novo. E os
testes de aprendizado do InMemory e do SQLite continuam verdes em todas as
mudanças, porque esses fakes nunca conferiram a constraint.

## Trade-offs

- **Testes contra banco real precisam de Docker.** Um desenvolvedor sem Docker
  não consegue rodá-los, e a primeira execução baixa uma imagem. Marque-os
  para que os testes rápidos ainda rodem sozinhos:
  ```csharp
  [TestCategory("Integration")] // dotnet test --filter "TestCategory!=Integration"
  ```
- **Um container compartilhado é rápido e compartilhado.** Um container por
  execução economiza segundos por classe, mas qualquer estado fora de um banco
  (roles, extensions, settings) é dividido por todas as classes. Mantenha esse
  estado no schema ou no banco de cada classe.
- **Isolamento por rollback é o mais barato e o mais limitado.** Não custa nada
  por teste, mas só funciona enquanto o código aceita o contexto do teste. O
  primeiro serviço que abre a própria transação pede Respawn ou `TRUNCATE`.
- **Paralelismo por classe deixa velocidade na mesa.** Os métodos de uma classe
  rodam em sequência. Mais classes (cada uma com seu banco) ou um banco por
  teste compram mais paralelismo, ao custo de mais setup.
- **Os fakes ainda têm uso.** Um stub de repositório é o dublê certo para um
  teste de caso de uso, e o SQLite pode substituir quando Docker é impossível.
  Só não conte um teste baseado em fake como prova de que uma constraint ou uma
  query funciona.
- **Fixar a imagem é uma decisão a revisitar.** O `postgres:18-alpine` deixa as
  execuções repetíveis; atualizar a produção significa atualizar a tag nos
  testes no mesmo dia.

## Lab

Um pequeno módulo de estoque sobre PostgreSQL já está implementado. Sua tarefa é escrever os testes MSTest que o rodam contra um banco de verdade iniciado pelo Testcontainers, e manter esses testes isolados uns dos outros.

**O que você vai praticar**

- Subir um container PostgreSQL por execução com `[AssemblyInitialize]` e descartá-lo no `[AssemblyCleanup]`.
- Criar um banco por classe de teste e rodar as classes em paralelo.
- Isolar testes com uma transação por teste e com o Respawn.
- Mostrar, com testes de aprendizado, o que o provider InMemory e o SQLite deixam passar.

**Pré-requisitos:** MSTest Fundamentals: Lifecycle and TestContext, EF Core básico, .NET 10 SDK e Docker rodando na máquina.

**Como funciona:** cada método de teste e de ciclo de vida está declarado com uma dica e falha com `TODO-NN` até você escrevê-lo. Alguns testes só provam algo se você fizer o assert no lugar certo: depois do `ChangeTracker.Clear()` ou com um contexto novo, e com a classe inteira rodando, não um teste sozinho. Os TODOs opcionais adicionam um reset com `TRUNCATE` e uma checagem por mutação.

## Documentation Links

- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [Testing against your production database system, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/testing-with-the-database) (doc)
- [Transactions and savepoints, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [Test execution and control in MSTest (parallelization), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [PostgreSQL module, Testcontainers for .NET](https://dotnet.testcontainers.org/modules/postgres/) (doc)
- [Resource Reaper, Testcontainers for .NET](https://dotnet.testcontainers.org/api/resource_reaper/) (doc)
- [Custom configuration, Testcontainers for .NET](https://dotnet.testcontainers.org/custom_configuration/) (doc)
- [Respawn, GitHub](https://github.com/jbogard/Respawn) (doc)
