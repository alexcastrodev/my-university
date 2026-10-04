---
version: 1.0
updatedAt: 2026-10-04
title: "Testando Módulos em Isolamento"
summary: Hospedar um único módulo com banco real, trocar os outros módulos por fakes dos contratos, testar eventos sem sleep e manter poucos testes da aplicação completa.
---
## Objective

Um monólito modular só compensa se dá para testar um módulo sem subir a
aplicação inteira. O objetivo é um teste que inicia um único módulo com o banco
de dados real, troca todos os outros módulos por fakes dos seus contratos e
verifica o comportamento pelo endpoint ou contrato público. Isso mantém o ciclo
de feedback curto, prova que o módulo realmente é independente e faz uma
dependência escondida de outro módulo falhar alto no teste, e não em produção.

## Use Cases

- Verificar que Orders calcula o total de um checkout corretamente sem iniciar
  Catalog, Payments ou Notifications.
- Rodar os testes de persistência de Orders contra um schema PostgreSQL real, em
  vez de um provider em memória que esconde diferenças de SQL.
- Checar que Orders publica `OrderPlaced` quando um pedido é confirmado, e que
  trata com segurança um `ProductPriceChanged` reentregue.
- Manter um pequeno conjunto de testes de ponta a ponta que sobem todos os
  módulos, para que erros de ligação (um registro faltando, um nome de schema
  errado) ainda sejam pegos.

## Deep Dive

### Hospede um módulo, simule o resto

Cada módulo expõe um método de registro. Um host de teste chama só esse método
e registra fakes para os contratos que o módulo consome:

```csharp
public sealed class OrdersFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICatalogModule>();
            services.AddSingleton<ICatalogModule>(new FakeCatalog(
                (Guid.Parse("11111111-1111-1111-1111-111111111111"), "Keyboard", 49.90m)));
        });
}
```

O fake implementa o contrato, não o módulo real, então um teste só consegue
depender do que Orders tem permissão de depender. Se Orders lê escondido uma
tabela de Catalog, o fake não consegue satisfazer isso e o teste falha.

### Um banco real por classe de teste

Use um container descartável para o schema do módulo. A documentação do EF Core
chama o provider em memória de altamente desencorajado para testes: ele não
traduz queries para SQL e não suporta transações nem SQL cru, então pode
passar testes que falhariam no PostgreSQL:

```csharp
public sealed class OrdersDb : IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public string ConnectionString => _pg.GetConnectionString();

    public Task InitializeAsync() => _pg.StartAsync();
    public Task DisposeAsync() => _pg.DisposeAsync().AsTask();
}
```

Compartilhe o container entre os testes de uma classe (`IClassFixture<T>` do
xUnit) e limpe os dados entre os testes, em vez de pagar a inicialização de um
container a cada teste. Os retornos `Task` acima são do xUnit v2; no xUnit v3,
`InitializeAsync` e `DisposeAsync` retornam `ValueTask`.

### Testando eventos sem dormir

Com um outbox, a entrega acontece no próximo ciclo do dispatcher, então fazer a
asserção logo depois da requisição gera corrida. Não use `Task.Delay`. Ou você
invoca o dispatcher diretamente no teste, ou consulta o resultado observável
com um prazo limite:

```csharp
await orders.PlaceOrderAsync(request);
await dispatcher.RunOnceAsync(CancellationToken.None); // esvazia o outbox agora

var published = fakeBus.Published.OfType<OrderPlaced>().Single();
Assert.Equal(request.CustomerId, published.CustomerId);
```

Para o lado receptor, chame o handler diretamente com o mesmo evento duas vezes
e verifique que o estado é idêntico, o que cobre a entrega at-least-once.

### Mantenha poucos testes da aplicação completa

Testes isolados não enxergam a ligação entre módulos. Mantenha uma suíte
pequena que sobe o host real com todos os módulos e executa os fluxos
principais: fazer um pedido, mudar um preço, ver a atualização chegar. Rode-a
com menos frequência (no merge, não a cada save) e mantenha-a pequena o
suficiente para que ninguém seja tentado a pulá-la.

## Trade-offs

- **Fakes podem se afastar do módulo real.** Um `ICatalogModule` falso que
  devolve um produto que o real rejeitaria deixa os testes de Orders verdes pelo
  motivo errado.
  ```csharp
  // O fake aceita qualquer id. O GetProductNamesAsync real omite ids
  // desconhecidos, então Orders precisa tratar a chave ausente, e este fake
  // nunca exercita isso.
  public Task<IReadOnlyDictionary<Guid, string>> GetProductNamesAsync(Guid[] ids, CancellationToken ct) =>
      Task.FromResult<IReadOnlyDictionary<Guid, string>>(ids.ToDictionary(id => id, _ => "Any"));
  ```
  Adicione alguns testes para a implementação real do contrato, para que o
  comportamento do fake tenha algo contra o que ser conferido.
- **Containers tornam os testes honestos e mais lentos.** Um container
  PostgreSQL acrescenta segundos de inicialização e exige Docker no CI. A
  documentação do EF Core recomenda testar contra o sistema de banco real e
  chama o provider em memória de altamente desencorajado, porque ele se
  comporta de forma diferente exatamente onde importa (tradução de queries,
  transações, SQL cru) e, na prática, não é mais rápido que um banco local.
- **Fixtures compartilhadas vazam estado entre testes.** Reusar um container
  por classe é mais rápido, mas um teste que deixa linhas para trás pode quebrar
  o seguinte de um jeito que depende da ordem de execução.
  ```csharp
  public async Task InitializeAsync() =>
      await db.Database.ExecuteSqlRawAsync("TRUNCATE orders.orders, orders.order_lines CASCADE");
  // Limpe no InitializeAsync (antes de cada teste), não só no Dispose.
  ```
- **O isolamento esconde bugs de integração.** Se todo teste usa fakes, um evento
  renomeado ou um schema divergente entre publicador e assinante vai para
  produção com tudo verde. A suíte da aplicação completa existe exatamente para
  isso, e removê-la para economizar tempo de CI remove o único teste que enxerga
  as costuras.

## Documentation Links

- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [Testcontainers for .NET](https://dotnet.testcontainers.org/) (doc)
- [Shared context between tests (class fixtures), xUnit.net](https://xunit.net/docs/shared-context) (doc)
- [Testing without your production database system, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
