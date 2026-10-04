---
version: 1.0
updatedAt: 2026-10-04
title: "Comunicação entre Módulos e Testes de Arquitetura"
summary: Consultas síncronas via contratos, eventos de integração com outbox para entrega confiável, e testes de arquitetura que transformam as regras de dependência em build quebrado.
---
## Objective

Depois que os módulos têm fronteiras, eles ainda precisam conversar. Um
monólito modular usa dois estilos: consultas síncronas pelo contrato público de
um módulo, quando quem chama precisa da resposta agora, e eventos de integração
assíncronos, para anunciar que algo aconteceu sem saber quem se importa. O
transactional outbox mantém esses eventos consistentes com o banco, e os
testes de arquitetura transformam as regras de dependência em build quebrado
em vez de uma convenção que as pessoas esquecem. Juntos, eles decidem se a
divisão em módulos sobrevive ao primeiro ano.

## Use Cases

- Orders precisa dos nomes e preços atuais dos produtos de Catalog para montar
  a resposta do checkout (uma consulta síncrona).
- Catalog muda um preço e Orders, Search e Notifications precisam reagir, sem
  que Catalog saiba que algum deles existe (um evento de integração).
- Garantir que um evento é publicado se, e somente se, a mudança que o causou
  foi commitada (o outbox).
- Quebrar o CI quando alguém adiciona uma referência de `Orders.Core` para
  `Catalog.Core`, ou deixa um tipo interno `public` "só por enquanto" (testes
  de arquitetura).

## Deep Dive

### Consultas síncronas pelos contratos

Quando quem chama não consegue continuar sem a resposta, chame o contrato do
outro módulo. Mantenha essas chamadas com granularidade grossa e amigáveis a
lote, para que uma página de listagem faça uma chamada com vários ids em vez de
uma chamada por linha:

```csharp
// Catalog.Contracts
public interface ICatalogModule
{
    Task<IReadOnlyDictionary<Guid, string>> GetProductNamesAsync(
        Guid[] productIds, CancellationToken ct);
}

// Catalog.Core
internal sealed class CatalogModuleApi(CatalogDbContext db) : ICatalogModule
{
    public async Task<IReadOnlyDictionary<Guid, string>> GetProductNamesAsync(
        Guid[] productIds, CancellationToken ct) =>
        await db.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, ct);
}
```

Uma regra prática útil: *consultas* síncronas entre módulos são aceitáveis;
*comandos* síncronos (Orders mandando Catalog mudar o próprio estado dentro da
mesma requisição) são um mau sinal. Eles acoplam os modos de falha dos dois
módulos e geralmente indicam que um está se metendo numa decisão que deveria
ser do outro.

### Eventos de integração com um bus em memória

Um evento de integração é um fato, nomeado no passado, definido no projeto de
contratos de quem publica:

```csharp
namespace Catalog.Contracts;

public sealed record ProductPriceChanged(
    Guid ProductId, decimal NewPrice, DateTimeOffset OccurredAt);
```

Os assinantes referenciam `Catalog.Contracts` e implementam um handler. A
dependência aponta do assinante para o publicador, então Catalog nunca fica
sabendo que Orders existe:

```csharp
// Shared.Kernel
public interface IIntegrationEventHandler<in TEvent>
{
    Task HandleAsync(TEvent @event, CancellationToken ct);
}

// Orders.Core
internal sealed class ProductPriceChangedHandler(OrdersDbContext db)
    : IIntegrationEventHandler<ProductPriceChanged>
{
    public Task HandleAsync(ProductPriceChanged e, CancellationToken ct) =>
        db.ProductPrices
            .Where(p => p.ProductId == e.ProductId)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, e.NewPrice), ct);
}

// dentro de AddOrdersModule(...)
services.AddScoped<IIntegrationEventHandler<ProductPriceChanged>, ProductPriceChangedHandler>();
```

Um bus em memória só precisa encontrar todos os handlers registrados para o
tipo do evento em tempo de execução. Passar pelo `MethodInfo` da interface
pública (em vez de `dynamic`) importa aqui, porque os handlers são tipos
`internal` que moram em outros assemblies:

```csharp
public sealed class InProcessEventBus(IServiceScopeFactory scopes) : IEventBus
{
    public async Task PublishAsync(object @event, CancellationToken ct)
    {
        var handlerType = typeof(IIntegrationEventHandler<>).MakeGenericType(@event.GetType());
        var handle = handlerType.GetMethod("HandleAsync")!;

        await using var scope = scopes.CreateAsyncScope();
        foreach (var handler in scope.ServiceProvider.GetServices(handlerType))
        {
            await (Task)handle.Invoke(handler, [@event, ct])!;
        }
    }
}
```

É mais ou menos isso que bibliotecas como o MediatR fazem para notificações em
memória. Vale saber antes de adotar uma: MediatR e MassTransit passaram as
novas versões major para licenças comerciais em 2025, então confira os termos
da licença; um bus desse tamanho muitas vezes é tudo de que um monólito
modular precisa.

### O outbox: commitar o evento junto com a mudança

Publicar logo depois do `SaveChangesAsync` tem duas janelas de falha. Se o
processo morre entre o commit e a publicação, o evento se perde para sempre.
Se você publica *antes* do commit e o commit falha, os assinantes reagiram a
uma mudança que nunca aconteceu. O transactional outbox fecha as duas janelas
gravando o evento como uma linha na mesma transação da mudança:

```csharp
internal sealed class OutboxMessage
{
    public Guid Id { get; init; }
    public required string Type { get; init; }
    public required string Payload { get; init; }
    public DateTimeOffset OccurredAt { get; init; }
    public DateTimeOffset? ProcessedAt { get; set; }

    public static OutboxMessage From(object @event) => new()
    {
        Id = Guid.CreateVersion7(),
        Type = @event.GetType().AssemblyQualifiedName!,
        Payload = JsonSerializer.Serialize(@event, @event.GetType()),
        OccurredAt = DateTimeOffset.UtcNow,
    };
}

// No caso de uso de Catalog: as duas linhas são commitadas, ou nenhuma é
product.ChangePrice(newPrice);
db.OutboxMessages.Add(OutboxMessage.From(
    new ProductPriceChanged(product.Id, newPrice, DateTimeOffset.UtcNow)));
await db.SaveChangesAsync(ct);
```

Um background service então esvazia a tabela e publica cada mensagem:

```csharp
internal sealed class CatalogOutboxDispatcher(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            var bus = scope.ServiceProvider.GetRequiredService<IEventBus>();

            var batch = await db.OutboxMessages
                .Where(m => m.ProcessedAt == null)
                .OrderBy(m => m.OccurredAt)
                .Take(50)
                .ToListAsync(stoppingToken);

            foreach (var message in batch)
            {
                var @event = JsonSerializer.Deserialize(message.Payload, Type.GetType(message.Type)!)!;
                await bus.PublishAsync(@event, stoppingToken);
                message.ProcessedAt = DateTimeOffset.UtcNow;
            }

            await db.SaveChangesAsync(stoppingToken);
        }
    }
}
```

Se o processo cair depois de publicar mas antes de salvar o `ProcessedAt`, a
mensagem é publicada de novo ao reiniciar. Esse é o acordo que o outbox faz:
**entrega pelo menos uma vez** (at-least-once), então todo handler precisa ser
idempotente. Com mais de uma instância da aplicação, dois dispatchers vão ler
as mesmas linhas, a menos que a consulta trave essas linhas
(`FOR UPDATE SKIP LOCKED` no PostgreSQL) ou que só uma instância rode o
dispatcher.

O retorno aparece na hora da extração. Trocar o `InProcessEventBus` por um
publicador de broker (RabbitMQ, Azure Service Bus, Kafka) muda o transporte,
não os módulos: os eventos, o outbox e os handlers idempotentes continuam como
estão.

### Testes de arquitetura: as regras como build quebrado

Referências de projeto impedem `Orders.Core` de *compilar* contra
`Catalog.Core`, mas nada impede alguém de adicionar a referência. Testes de
arquitetura pegam isso, e também as regras mais sutis que o compilador não
consegue expressar. Com o [NetArchTest](https://github.com/BenMorris/NetArchTest)
num projeto xUnit:

```csharp
public class ModuleBoundaryTests
{
    private static readonly Assembly Orders = typeof(OrdersModule).Assembly;

    [Fact]
    public void Orders_does_not_depend_on_other_modules_internals()
    {
        var result = Types.InAssembly(Orders)
            .ShouldNot()
            .HaveDependencyOnAny("Catalog.Core", "Billing.Core")
            .GetResult();

        Assert.True(result.IsSuccessful, Describe(result));
    }

    [Fact]
    public void Only_the_module_entry_point_is_public()
    {
        var result = Types.InAssembly(Orders)
            .That().DoNotHaveName(nameof(OrdersModule))
            .And().DoNotResideInNamespace("Orders.Core.Migrations")
            .Should().NotBePublic()
            .GetResult();

        Assert.True(result.IsSuccessful, Describe(result));
    }

    private static string Describe(TestResult result) =>
        string.Join(", ", result.FailingTypeNames ?? []);
}
```

A exclusão de `Migrations` existe por um motivo real: o
`dotnet ef migrations add` gera tipos de migration `public partial class` e um
model snapshot público, e sem a exclusão o segundo teste falha em código
gerado. O [ArchUnitNET](https://github.com/TNG/ArchUnitNET) cobre o mesmo
terreno com uma linguagem de regras mais rica, se as regras crescerem além de
checagens simples de dependência.

### Quando um módulo deveria virar serviço

A extração vale a pena quando um módulo precisa de algo que o monólito não
consegue dar: escalar de forma independente (um motor de preços pesado em CPU
ao lado de um módulo CRUD leve), um ritmo de deploy diferente, um time
separado travado pelo trem de release compartilhado, ou um runtime diferente.
Se o módulo já conversa com os outros apenas por contratos e eventos com
outbox, a extração é quase mecânica: chamadas de contrato viram clientes HTTP
ou gRPC, e o bus em memória vira um broker.

## Trade-offs

- **Publicar direto em memória acopla o publicador a todos os assinantes.** Sem
  outbox, um handler que lança exceção derruba a requisição de quem publicou,
  então um bug em Orders pode impedir Catalog de mudar um preço.
  ```csharp
  product.ChangePrice(newPrice);
  await db.SaveChangesAsync(ct);
  await bus.PublishAsync(new ProductPriceChanged(product.Id, newPrice, now), ct);
  // O handler de Orders lança -> o endpoint de Catalog responde 500,
  // mesmo com a mudança de preço já commitada.
  ```
- **O outbox troca imediatismo por confiabilidade.** Os assinantes veem as
  mudanças depois do próximo tick do dispatcher, então o sistema é
  eventualmente consistente e usuários podem ver por um instante um preço
  desatualizado em Orders. Esse atraso precisa ser aceitável para o negócio,
  não só para os desenvolvedores.
- **Entrega at-least-once significa duplicatas e reordenação.** Um evento
  antigo reentregue pode sobrescrever um valor mais novo, a menos que o
  handler verifique.
  ```csharp
  await db.ProductPrices
      .Where(p => p.ProductId == e.ProductId && p.UpdatedAt < e.OccurredAt)
      .ExecuteUpdateAsync(s => s
          .SetProperty(p => p.Price, e.NewPrice)
          .SetProperty(p => p.UpdatedAt, e.OccurredAt), ct);
  // Um evento mais antigo não casa com nenhuma linha e vira no-op.
  ```
- **Testes de arquitetura só checam o que você codifica, e regras em string
  apodrecem.** Se `Catalog.Core` for renomeado para `Products.Core`, a regra
  abaixo continua passando para sempre, porque nada depende de um namespace
  que não existe mais.
  ```csharp
  .ShouldNot().HaveDependencyOn("Catalog.Core") // verdadeiro no vazio depois do rename
  // Mais seguro: derivar de um tipo, para que o rename quebre a compilação.
  .ShouldNot().HaveDependencyOn(typeof(CatalogModule).Namespace!)
  ```
- **Biblioteca ou feito à mão é uma decisão de manutenção.** Uma biblioteca
  traz pipelines, retries e integrações com brokers, junto com termos de
  licença que podem mudar debaixo de você. Um bus feito à mão são algumas
  dezenas de linhas que você controla por completo, e também algumas dezenas
  de linhas que ninguém mais mantém.

## Documentation Links

- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
- [Background tasks with hosted services, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [NetArchTest, BenMorris](https://github.com/BenMorris/NetArchTest) (doc)
- [ArchUnitNET, TNG](https://github.com/TNG/ArchUnitNET) (doc)
