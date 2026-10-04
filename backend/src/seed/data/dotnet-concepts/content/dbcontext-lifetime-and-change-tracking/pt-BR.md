---
version: 1.0
updatedAt: 2026-10-04
title: "Ciclo de Vida do DbContext e Change Tracking"
summary: Um contexto por unidade de trabalho, pooling e IDbContextFactory, os estados das entidades no change tracker e quando usar AsNoTracking.
---
## Objective

Um `DbContext` é uma unit of work: ele rastreia as entidades que você carrega,
percebe o que mudou e grava a diferença no `SaveChanges`. A maioria dos bugs do
EF Core que parecem aleatórios vem de entender mal duas coisas sobre ele.
Primeiro, quanto tempo uma instância vive e quem a compartilha, porque ele não é
thread-safe e acumula toda entidade que já viu. Segundo, o que o change tracker
faz com cada entidade, porque isso decide qual SQL é enviado, quanta memória é
retida e se uma query devolve o objeto que você já modificou.

## Use Cases

- Registrar `OrdersDbContext` numa aplicação ASP.NET Core para que cada
  requisição receba sua própria instância e nunca a compartilhe com outra.
- Usar um `DbContext` num `BackgroundService` ou num componente Blazor Server,
  onde não há escopo de requisição para tomar emprestado.
- Tornar mais barato um endpoint de listagem somente leitura, sem rastrear o que
  ele carrega.
- Entender por que uma segunda query para a mesma linha devolve a instância que
  você já alterou, e não o que está no banco.

## Deep Dive

### Um contexto por unidade de trabalho

`AddDbContext` registra o contexto como scoped, o que numa aplicação web
significa uma instância por requisição. Isso combina com a ideia de unit of
work: carregar, alterar, salvar, descartar. Um `DbContext` não é thread-safe,
então rodar duas queries ao mesmo tempo na mesma instância lança exceção:

```csharp
// Errado: duas operações no mesmo contexto ao mesmo tempo.
var a = db.Orders.ToListAsync(ct);
var b = db.Customers.ToListAsync(ct);
await Task.WhenAll(a, b); // InvalidOperationException: A second operation started on this context before a previous operation completed

// Certo: dê await em cada uma, ou entregue a cada task seu próprio contexto de uma factory.
var orders = await db.Orders.ToListAsync(ct);
var customers = await db.Customers.ToListAsync(ct);
```

### Pooling e factories

`AddDbContextPool` mantém um pool de instâncias e reinicia o estado delas entre
os usos, o que elimina o custo de construir uma por requisição. O preço é uma
regra: um contexto do pool não pode guardar estado por requisição em seus
próprios campos, porque a instância sobrevive à requisição. Para código sem
escopo, injete `IDbContextFactory<T>` e crie um contexto de vida curta onde
precisar:

```csharp
builder.Services.AddDbContextPool<OrdersDbContext>(o =>
    o.UseNpgsql(connectionString));
builder.Services.AddPooledDbContextFactory<ReportsDbContext>(o =>
    o.UseNpgsql(connectionString));

internal sealed class NightlyJob(IDbContextFactory<ReportsDbContext> factory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct); // contexto novo a cada execução
        // ... consultar e salvar
    }
}
```

Um `BackgroundService` é singleton, então injetar nele um `DbContext` scoped
falha na inicialização ou, pior, captura uma única instância pela vida inteira
da aplicação.

### O que o change tracker registra

Toda entidade rastreada tem um estado: `Detached`, `Unchanged`, `Added`,
`Modified` ou `Deleted`. Uma query que devolve entidades as inicia como
`Unchanged` e guarda um snapshot dos valores. No `SaveChanges`, o EF Core compara
cada entidade com seu snapshot (`DetectChanges`), e só as propriedades que
diferem entram no `UPDATE`:

```csharp
var order = await db.Orders.SingleAsync(o => o.Id == id, ct);
order.Rename("Rush order");        // Modified, só a coluna alterada é gravada
await db.SaveChangesAsync(ct);     // UPDATE orders SET name = @p0 WHERE id = @p1

var state = db.Entry(order).State; // Unchanged de novo depois do save
```

O tracker também faz identity resolution: pedir a mesma chave duas vezes devolve
a mesma instância, e a segunda query não sobrescreve o que você já mudou em
memória.

### Pare de rastrear quando só lê

Rastrear custa memória e CPU, porque cada entidade ganha um snapshot. Numa query
somente leitura, `AsNoTracking` pula isso, e uma projeção para um DTO pula as
entidades por completo:

```csharp
var rows = await db.Orders
    .AsNoTracking()
    .Where(o => o.CustomerId == customerId)
    .Select(o => new OrderRow(o.Id.Value, o.Status, o.Total.Amount))
    .ToListAsync(ct);
```

Para contextos de vida longa, como uma importação em lote que carrega milhares de
linhas, chame `db.ChangeTracker.Clear()` entre os lotes para que o tracker não
guarde todas as entidades até o fim.

## Trade-offs

- **Pooling reaproveita instâncias, então estado vazado vaza entre
  requisições.** Um campo atribuído ao contexto numa requisição pode ficar
  visível na seguinte.
  ```csharp
  public sealed class OrdersDbContext : DbContext
  {
      public Guid CurrentTenant { get; set; } // perigoso num contexto com pool
  }
  // Resolva o tenant a partir de um serviço scoped dentro do query filter.
  ```
- **Queries com `AsNoTracking` devolvem entidades desconectadas.** Alterá-las e
  chamar `SaveChanges` não grava nada, porque o contexto nunca as viu.
  ```csharp
  var o = await db.Orders.AsNoTracking().SingleAsync(x => x.Id == id, ct);
  o.Rename("X");
  await db.SaveChangesAsync(ct); // 0 linhas afetadas, sem erro
  ```
- **Queries sem tracking perdem a identity resolution.** Duas linhas que apontam
  para o mesmo cliente geram dois objetos `Customer` separados, a menos que você
  use `AsNoTrackingWithIdentityResolution`, que gasta parte da economia.
- **Um contexto de vida longa cresce sem limite e fica desatualizado.** Manter um
  único contexto por uma sessão inteira numa aplicação desktop ou Blazor Server
  retém toda entidade que ele já carregou e mostra dados que outros usuários
  alteraram desde então.
- **`DetectChanges` é linear no número de entidades rastreadas.** Rastrear dezenas
  de milhares de entidades deixa todo `SaveChanges` lento, outro motivo para
  processar em lotes e limpar o tracker em vez de carregar tudo de uma vez.

## Documentation Links

- [DbContext lifetime, configuration, and initialization, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/) (doc)
- [Advanced performance topics, DbContext pooling, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics) (doc)
- [Change tracking in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/change-tracking/) (doc)
- [Tracking vs. no-tracking queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/tracking) (doc)
