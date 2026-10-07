---
version: 1.0
updatedAt: 2026-10-07
title: "Testando Domain Events com MSTest"
summary: Teste o aggregate sem infraestrutura, o interceptor do SaveChanges e o outbox em SQLite na memória, e um consumidor idempotente, com MSTest 4, fakes escritos à mão e uma checagem por mutação.
---
## Objective

Domain events vêm com quatro regras: o aggregate só registra eventos, o
interceptor os despacha antes do commit, um handler que falha não deixa nada
para trás, e um consumidor que recebe a mesma mensagem duas vezes age uma vez
só. Cada regra mora num lugar diferente, então cada uma pede um tipo diferente
de teste. O objetivo é uma suíte em MSTest que confere cada regra na camada mais
barata que consegue enxergá-la, roda em milissegundos e fica vermelha quando
alguém quebra a regra (despachar depois do commit, esquecer de limpar os
eventos), e não quando alguém renomeia um método.

## Use Cases

- Provar que fazer um pedido levanta exatamente um `OrderPlaced` com os valores
  certos, sem banco de dados e sem setup.
- Provar que um handler que lança exceção não deixa pedido nem linha de outbox
  para trás, que é a promessa de despachar antes do commit.
- Provar que um consumidor sobrevive à entrega at-least-once sem dar pontos de
  fidelidade duas vezes.
- Levar um time dos hábitos do xUnit para o MSTest (ou começar um projeto novo
  nele) sem perder a estratégia de testes.
- Pegar um refactor que move o despacho para `SavedChangesAsync` antes que ele
  chegue à produção.

## Deep Dive

### Uma regra, uma camada

Não teste tudo pelo `SaveChanges`. Ponha cada regra onde o teste é menor:

| Regra | Onde ela pode ser vista | Tipo de teste |
| --- | --- | --- |
| `Order.Place` levanta `OrderPlaced` e rejeita totais inválidos | o aggregate | teste unitário simples, sem infraestrutura |
| O interceptor despacha e limpa os eventos | o pipeline de save do EF Core | teste de integração em SQLite na memória |
| Um handler que falha desfaz o pedido e a linha do outbox | a transação | teste de integração, relendo com outro contexto |
| Uma mensagem repetida dá pontos uma vez só | a transação própria do consumidor | teste de integração, chamando o consumidor direto |

O projeto é um projeto de teste ao lado do módulo, com quatro classes de teste:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.4.1" />
  <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" Version="10.10.0" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
</ItemGroup>
```

`MSTest` é o metapacote: o framework, o adapter que deixa o `dotnet test`
encontrar os testes e o SDK de testes. O item `Using` tira o
`using Microsoft.VisualStudio.TestTools.UnitTesting;` de todo arquivo. O
`dotnet new mstest` cria o mesmo layout.

### MSTest em poucas linhas

Uma classe marcada com `[TestClass]` guarda métodos marcados com `[TestMethod]`.
O MSTest cria uma nova instância da classe para cada método de teste, então os
campos de instância são privados de um teste. O setup por teste pode ser um
construtor ou um método `[TestInitialize]`, e a limpeza pode ser `IDisposable`
ou um método `[TestCleanup]`:

```csharp
[TestClass]
public sealed class OutboxTests : IDisposable
{
    private readonly TestDatabase _database = new(); // um por teste

    public void Dispose() => _database.Dispose();    // roda depois do teste
}
```

Um construtor pode atribuir um campo `readonly`, e por isso a orientação da
Microsoft se inclina para ele. `[TestInitialize]` e `[TestCleanup]` podem ser
`async` e aceitam `[Timeout]`, o que um construtor não faz, então use-os quando
o setup precisa de await (uma classe de teste `IAsyncDisposable` também cobre a
limpeza assíncrona). Escolha um estilo por projeto; os analyzers MSTEST0019 e
MSTEST0020 podem impor essa escolha.

Mais um padrão importa: o MSTest roda os testes um de cada vez até o assembly
optar por paralelismo. O `dotnet new mstest` adiciona este arquivo, e é ele que
dá importância à regra da instância acima:

```csharp
// MSTestSettings.cs
[assembly: Parallelize(Scope = ExecutionScope.MethodLevel)]
```

### Teste o aggregate sem infraestrutura

O aggregate registra eventos numa lista, então o teste constrói, age e lê a
lista. `Assert.ContainsSingle` devolve o único elemento e
`Assert.IsInstanceOfType<T>` o devolve tipado, então as linhas seguintes leem
como a especificação:

```csharp
[TestMethod]
public void PlacingAnOrderRaisesOneOrderPlacedEvent()
{
    var order = Order.Place(CustomerId, 50m, TimeProvider.System);

    var raised = Assert.ContainsSingle(order.DomainEvents);
    var placed = Assert.IsInstanceOfType<OrderPlaced>(raised);
    Assert.AreEqual(order.Id, placed.OrderId);
    Assert.AreEqual(50m, placed.Total);
}
```

O tempo é uma entrada. `Order.Place` recebe um `TimeProvider`, então o teste
entrega um `FakeTimeProvider` do `Microsoft.Extensions.TimeProvider.Testing` e o
horário esperado é exato, não "perto de agora":

```csharp
var clock = new FakeTimeProvider(new DateTimeOffset(2026, 10, 7, 9, 30, 0, TimeSpan.Zero));
var order = Order.Place(CustomerId, 10m, clock);
var placed = Assert.IsInstanceOfType<OrderPlaced>(Assert.ContainsSingle(order.DomainEvents));
Assert.AreEqual(clock.GetUtcNow(), placed.At);
```

Os totais inválidos são um teste com duas linhas `[DataRow]`, e cada linha é
reportada separadamente:

```csharp
[TestMethod]
[DataRow(0)]
[DataRow(-5)]
public void AnOrderWithoutAPositiveTotalIsRejected(int total) =>
    Assert.ThrowsExactly<ArgumentOutOfRangeException>(
        () => Order.Place(CustomerId, total, TimeProvider.System));
```

`Assert.ThrowsExactly<T>` aceita só `T`. `Assert.Throws<T>` aceita também um
tipo derivado de `T`. `Place` lança `ArgumentOutOfRangeException`, então pedir
`ThrowsExactly<ArgumentException>` falha mesmo a exceção sendo uma
`ArgumentException`. Nomeie o tipo que o código realmente lança.

### Teste o interceptor com um pipeline real

Um interceptor só roda dentro do pipeline de save do EF Core, e um `DbContext`
simulado nunca o executa. Use um contexto real em SQLite na memória. Um banco
SQLite na memória é apagado quando sua conexão fecha, e cada conexão `:memory:`
ganha o próprio banco, então o teste abre uma conexão e a compartilha entre
todos os contextos que cria:

```csharp
internal sealed class TestDatabase : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public TestDatabase()
    {
        _connection.Open();
        using var db = Plain();
        db.Database.EnsureCreated();
    }

    public OrdersDbContext NewContext(DomainEventDispatcher dispatcher) =>
        new(new DbContextOptionsBuilder<OrdersDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(new DomainEventsInterceptor(dispatcher))
            .Options);

    public OrdersDbContext Plain() => NewContext(new DomainEventDispatcher());

    public void Dispose() => _connection.Dispose();
}
```

Os handlers são fakes escritos à mão. Um handler que grava o que recebe tem duas
linhas e o teste se lê sem biblioteca de mock:

```csharp
internal sealed class RecordingHandler : IDomainEventHandler<OrderPlaced>
{
    public List<OrderPlaced> Seen { get; } = [];

    public Task HandleAsync(OrderPlaced e, OrdersDbContext db, CancellationToken ct)
    {
        Seen.Add(e);
        return Task.CompletedTask;
    }
}
```

Dois testes então fixam o interceptor: ele despacha os eventos dos aggregates
rastreados, e os limpa para que um segundo save não os despache de novo:

```csharp
[TestMethod]
[TestCategory("Integration")]
public async Task EventsAreClearedSoASecondSaveDoesNotDispatchThemAgain()
{
    var recorder = new RecordingHandler();
    await using var db = _database.NewContext(new DomainEventDispatcher().Register(recorder));
    var order = Order.Place(CustomerId, 10m, TimeProvider.System);
    db.Orders.Add(order);

    await db.SaveChangesAsync();
    await db.SaveChangesAsync();

    Assert.HasCount(1, recorder.Seen);
    Assert.IsEmpty(order.DomainEvents);
}
```

### Confira o que foi confirmado, não o que o contexto guarda

Um contexto que falhou ao salvar ainda rastreia o pedido que tentou salvar.
Conferir por ele pode passar pelo motivo errado. Releia o resultado com um
contexto diferente sobre a mesma conexão:

```csharp
[TestMethod]
[TestCategory("Integration")]
public async Task AHandlerThatThrowsRollsBackTheOrder()
{
    await using (var db = _database.NewContext(new DomainEventDispatcher().Register(new ExplodingHandler())))
    {
        db.Orders.Add(Order.Place(CustomerId, 10m, TimeProvider.System));
        await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    await using var check = _database.Plain(); // um contexto novo lê o banco
    Assert.AreEqual(0, await check.Orders.CountAsync());
}
```

A regra do outbox tem o mesmo formato, e a ordem dos handlers faz o trabalho. O
handler do outbox roda primeiro e adiciona sua linha, depois o handler que
explode aborta o save, e nem o pedido nem a linha podem existir no fim:

```csharp
var dispatcher = new DomainEventDispatcher().Register(new OrderPlacedHandler()).Register(new ExplodingHandler());
// ... salva, espera InvalidOperationException e, num contexto novo:
Assert.AreEqual(0, await check.OutboxMessages.CountAsync());
Assert.AreEqual(0, await check.Orders.CountAsync());
```

### Teste o consumidor sem esperar

O consumidor roda depois do commit, em sua própria transação. O teste não sobe
um worker nem faz polling no outbox: ele monta a mensagem e chama o consumidor.
Isso elimina o `Thread.Sleep` e a instabilidade que vem com ele:

```csharp
public LoyaltyConsumerTests(TestContext testContext)
{
    _testContext = testContext;
    _consumer = new LoyaltyConsumer(_database.Plain);
}

[TestMethod]
public async Task ADuplicateDeliveryOfTheSameMessageAwardsPointsOnlyOnce()
{
    var message = Message(42m);

    await _consumer.HandleAsync(message, _testContext.CancellationToken);
    await _consumer.HandleAsync(message, _testContext.CancellationToken);

    await using var check = _database.Plain();
    Assert.AreEqual(42, (await check.Customers.SingleAsync()).Points);
    Assert.AreEqual(1, await check.ProcessedMessages.CountAsync());
}
```

O MSTest entrega ao construtor o `TestContext` do teste em execução. O
`CancellationToken` dele é sinalizado quando o teste estoura o tempo ou a
execução é abortada, então passá-lo ao código testado, em vez de
`CancellationToken.None`, interrompe o trabalho que o teste iniciou.

### Os testes protegem as regras?

Uma suíte verde diz que os testes concordam com o código, não que notariam um
bug. Quebre o código de produção de propósito, uma mudança por vez, e veja o que
fica vermelho. Estes são os resultados para esta suíte:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| O interceptor para de limpar os eventos | o teste do "segundo save" |
| `Order.Place` não valida o total | as duas linhas `[DataRow]` |
| O despacho vai para `SavedChangesAsync` (depois do commit) | o teste de rollback e os dois testes do outbox |
| `OrderPlacedHandler` chama `SaveChangesAsync` por conta própria | o teste "sem linha de outbox quando o save falha" |
| `LoyaltyConsumer` ignora o inbox | o teste de entrega duplicada |

Uma mudança que deixa tudo verde é um teste faltando. A marcação
`[TestCategory("Integration")]` também deixa rodar uma fatia:
`dotnet test --filter "TestCategory=Integration"` roda os testes de banco, e
`--filter "TestCategory!=Integration"` roda só os testes do aggregate.

## Trade-offs

- **SQLite na memória é um fake, não o seu banco.** A orientação do próprio EF
  Core é que os providers se comportam de forma diferente (por exemplo, o SQLite
  compara strings diferenciando maiúsculas de minúsculas e o SQL Server, por
  padrão, não), então um teste pode passar no SQLite e falhar em produção. Ela
  recomenda testar contra o sistema de banco de dados real quando possível,
  usando containers como o Testcontainers. Aqui a única linha que muda é o
  provider dentro do `TestDatabase`, mas cada teste passa a precisar de um banco
  isolado, o que custa tempo.
  ```csharp
  .UseNpgsql(connectionString) // os mesmos testes, num PostgreSQL real subido pelo Testcontainers
  ```
- **Fakes escritos à mão custam linhas; mocks custam estabilidade.** Um fake
  precisa de ajuste quando a interface muda. Um mock que verifica chamadas amarra
  o teste a como o código funciona, então um refactor inofensivo o quebra.
  Confira resultados que você enxerga (o que o recorder recebeu, o que o banco
  guarda), como no concept de Java sobre comportamento observável.
- **Paralelo por opt-in é rápido até algo ser compartilhado.** O paralelismo por
  método é seguro enquanto o estado vive em campos de instância. Um banco
  `static` transforma a suíte numa suíte instável. Use `[DoNotParallelize]` para
  o raro teste que precisa rodar sozinho.
  ```csharp
  private static readonly TestDatabase Shared = new(); // compartilhado por testes que rodam ao mesmo tempo
  ```
- **Reler com um segundo contexto dá mais código.** É também o único jeito de
  saber o que foi confirmado. Um helper como `Plain()` reduz isso a uma linha.
- **Construtor ou `[TestInitialize]` é questão de estilo.** Construtores dão
  campos `readonly`; `[TestInitialize]` dá `async` e `[Timeout]`. Estilos
  misturados num projeto tornam o ciclo de vida mais difícil de ler.
- **MSTest e xUnit ensinam a mesma estratégia.** `[TestMethod]` é `[Fact]`,
  `[DataRow]` é `[InlineData]`, e os dois criam uma instância por teste. A
  estratégia daqui (uma regra, uma camada, reler o que foi confirmado) vale
  quando o time usa xUnit, como no concept Testing Modules in Isolation.
- **Nenhum teste enxerga uma queda.** A janela entre o commit e um despacho
  depois do commit não pode ser reproduzida por um teste unitário. Os testes
  acima mostram que o desenho sem essa janela (despachar antes do commit, linha
  do outbox na mesma transação) se comporta como prometido.

## Documentation Links

- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
- [MSTest TestContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-testcontext) (doc)
- [Test execution and control in MSTest (parallelization), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [In-memory databases, Microsoft.Data.Sqlite, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/in-memory-databases) (doc)
