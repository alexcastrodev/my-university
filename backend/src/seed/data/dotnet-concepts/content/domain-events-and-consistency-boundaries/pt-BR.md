---
version: 1.0
updatedAt: 2026-10-04
title: "Domain Events e Fronteiras de Consistência"
summary: Eventos levantados pelo aggregate, despachados por um interceptor do SaveChanges, a diferença para integration events e a regra de um aggregate por transação.
---
## Objective

Um domain event registra algo que aconteceu dentro de um aggregate, nomeado na
linguagem do negócio: `OrderPlaced`, `PaymentCaptured`. Levantar eventos a
partir do aggregate mantém a regra "quando X acontece, Y deve se seguir" fora do
código que disparou X. A pergunta mais difícil é quando as reações rodam.
Dentro da mesma transação, elas compartilham sua atomicidade e suas falhas.
Depois do commit, são eventualmente consistentes e precisam de uma garantia de
entrega. Escolher entre as duas é uma decisão sobre fronteiras de consistência,
e o aggregate é a fronteira.

## Use Cases

- Fazer um pedido precisa reservar estoque, mas Orders não deve saber como o
  inventário funciona (um domain event tratado na mesma transação ou depois
  dela).
- Uma mudança de preço precisa chegar a Search e Notifications em outros
  módulos (um domain event traduzido em um integration event).
- Atualizar um modelo de leitura ou enviar um e-mail só se o pedido foi mesmo
  confirmado.
- Explicar a um product owner por que os pontos de fidelidade do cliente
  aparecem alguns segundos depois do pedido, e não no mesmo instante.

## Deep Dive

### Levante eventos a partir do aggregate

O aggregate registra eventos numa lista em vez de publicá-los. Ele não conhece
handlers, um bus nem o banco de dados:

```csharp
public abstract class AggregateRoot
{
    private readonly List<IDomainEvent> _events = [];
    public IReadOnlyList<IDomainEvent> DomainEvents => _events;
    protected void Raise(IDomainEvent e) => _events.Add(e);
    public void ClearDomainEvents() => _events.Clear();
}

public sealed record OrderPlaced(OrderId OrderId, CustomerId CustomerId, DateTimeOffset At) : IDomainEvent;

// Dentro de Order.Place(...), depois que as invariantes passam:
order.Raise(new OrderPlaced(order.Id, customerId, clock.GetUtcNow()));
```

O evento é um fato no passado, imutável, e carrega ids e os valores de que os
handlers precisam, não entities vivas.

### Despache a partir de um interceptor do SaveChanges

Um `SaveChangesInterceptor` do EF Core enxerga todo save, então o código da
aplicação nunca precisa lembrar de publicar. O tracker já sabe quais aggregates
mudaram, então colete os eventos deles ali:

```csharp
internal sealed class DomainEventsInterceptor(IDomainEventDispatcher dispatcher) : SaveChangesInterceptor
{
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData data, InterceptionResult<int> result, CancellationToken ct = default)
    {
        if (data.Context is null) return result;

        var aggregates = data.Context.ChangeTracker.Entries<AggregateRoot>()
            .Select(e => e.Entity)
            .Where(a => a.DomainEvents.Count > 0)
            .ToList();

        var events = aggregates.SelectMany(a => a.DomainEvents).ToList();
        aggregates.ForEach(a => a.ClearDomainEvents());

        foreach (var e in events)
            await dispatcher.DispatchAsync(e, ct); // roda antes do commit, na mesma unidade de trabalho

        return result;
    }
}
```

Despachar em `SavingChangesAsync` (antes do commit) significa que handlers que
escrevem no mesmo `DbContext` caem na mesma transação: ou tudo é salvo, ou nada. O EF Core chama o interceptor
antes de executar `DetectChanges`, então entidades que um handler adiciona ou
altera ali entram no mesmo save.
Despachar em `SavedChangesAsync` (depois do commit) significa que o dado já é
durável, mas uma queda entre o commit e o despacho perde o evento.

### Domain events vs integration events

Um domain event é interno ao módulo e pode carregar tipos ricos. Um integration
event é um contrato público entre módulos, então é versionado e carrega apenas
primitivos. Um handler no módulo dono traduz um no outro, e a tradução escreve
no outbox na mesma transação:

```csharp
internal sealed class OrderPlacedHandler(OrdersDbContext db) : IDomainEventHandler<OrderPlaced>
{
    public Task HandleAsync(OrderPlaced e, CancellationToken ct)
    {
        db.OutboxMessages.Add(OutboxMessage.From(
            new OrderPlacedIntegrationEvent(e.OrderId.Value, e.CustomerId.Value, e.At)));
        return Task.CompletedTask; // salvo junto com o pedido pelo SaveChanges externo
    }
}
```

Como a linha do outbox é salva junto com o pedido, o integration event existe
se, e somente se, o pedido existe. O dispatcher que lê o outbox é tratado no
conceito Module Communication and Architecture Tests.

### Um aggregate por transação

A regra por trás de tudo isso: uma transação muda um aggregate. Quando uma
operação de negócio precisa mudar dois (fazer um pedido também dá pontos ao
cliente), a segunda mudança acontece numa transação separada, disparada por um
evento. Isso torna o sistema eventualmente consistente entre aggregates, e a
pergunta de design vira "por quanto tempo isso pode ficar fora de sincronia, e
o que o usuário vê nesse meio-tempo?".

```csharp
// Tratado em sua própria transação, depois que OrderPlaced foi confirmado e entregue.
public async Task HandleAsync(OrderPlacedIntegrationEvent e, CancellationToken ct)
{
    var customer = await db.Customers.FindAsync([new CustomerId(e.CustomerId)], ct);
    customer!.RegisterOrder(new OrderId(e.OrderId));
    await db.SaveChangesAsync(ct);
}
```

## Trade-offs

- **Handlers dentro da transação acoplam as falhas.** Um handler que lança
  exceção desfaz o pedido, então um bug nos pontos de fidelidade pode bloquear o
  checkout.
  ```csharp
  await dispatcher.DispatchAsync(e, ct); // lança -> o SaveChanges nunca confirma o pedido
  ```
  Mantenha nos handlers dentro da transação só o trabalho que realmente pertence
  à mesma fronteira de consistência, e mova o resto para trás do outbox.
- **Despacho depois do commit pode perder eventos.** Publicar em
  `SavedChangesAsync` sem um outbox significa que uma queda depois do commit
  deixa o pedido salvo e o evento perdido, sem nada para tentar de novo.
- **Handlers que chamam `SaveChanges` reentram no interceptor.** Um handler que
  salva dentro de `SavingChangesAsync` aciona o interceptor de novo, então
  eventos levantados ali são despachados recursivamente.
  ```csharp
  // Mais seguro: handlers só adicionam ao contexto, e o único SaveChanges externo confirma tudo.
  db.OutboxMessages.Add(message); // sem SaveChanges aqui
  ```
- **A consistência eventual vaza para a interface.** Depois que o pedido é feito,
  o saldo de pontos pode atrasar, então as telas ou leem da fonte da verdade
  naquele momento ou aceitam e comunicam o atraso.
- **Eventos podem virar o grafo de chamadas escondido.** Com muitos handlers por
  evento, o fluxo de um caso de uso fica espalhado por vários arquivos e difícil
  de seguir num debugger. Mantenha pequeno o número de reações por evento e
  nomeie-as pelo que fazem.

## Lab

Neste lab você levanta eventos de domínio a partir de um agregado, despacha esses eventos de um interceptor de `SaveChanges` do EF Core dentro da mesma transação, traduz o evento em uma linha de outbox e consome o evento de integração em outra transação, de forma idempotente. Você recebe o `DbContext`, o dispatcher e os tipos de evento prontos, mas a lógica de negócio está vazia: o pedido não levanta nada, o interceptor não despacha nada e o handler e o consumidor lançam `NotImplementedException`. A ideia central é a fronteira de consistência: o que precisa ser atômico com o pedido entra na mesma transação, e o que mora em outro agregado acontece depois, na sua própria transação.

**O cenário**

Quando um `Order` é feito, duas coisas devem acontecer: um evento de integração para outros módulos e pontos de fidelidade para o cliente. As duas vivem em agregados diferentes, então não podem dividir uma transação.

O fluxo é:

- `Order.Place`: levanta OrderPlaced (o agregado só registra)
- `Interceptor`: antes do commit, despacha os eventos dos agregados rastreados
- `OrderPlacedHandler`: mesma transação: adiciona um OutboxMessage ao lado do pedido
- `LoyaltyConsumer`: transação própria, depois do commit: dá pontos ao Customer

- `Model.cs`: `Order.Place` (a implementar) e `Customer` com `AwardPoints`.
- `Events.cs` (pronto): `AggregateRoot`, `OrderPlaced`, `OrderPlacedIntegrationEvent`, `OutboxMessage` e `ProcessedMessage` (a caixa de entrada).
- `Dispatching.cs`: `DomainEventDispatcher` (pronto) e `DomainEventsInterceptor` (a implementar).
- `Handlers.cs`: `OrderPlacedHandler` e `LoyaltyConsumer` (a implementar).

Os testes usam SQLite em memória e abrem vários contextos na mesma conexão, para ver o que foi mesmo gravado.

**O que você vai fazer, passo a passo**

1. **Levantar o evento (TODO-00).** Em `Order.Place`, rejeite total menor ou igual a zero com `ArgumentOutOfRangeException`. Senão, crie o pedido (`Guid.CreateVersion7()`) e faça `Raise` de um `OrderPlaced`, usando `clock.GetUtcNow()`. O agregado só registra, nunca publica.
2. **Despachar antes do commit (TODO-01).** Em `SavingChangesAsync`, colete os eventos de todo `AggregateRoot` rastreado (`ChangeTracker.Entries<AggregateRoot>()`), limpe-os primeiro (senão um segundo `SaveChanges` despacha de novo) e chame `dispatcher.DispatchAsync` para cada um.
3. **Escrever o outbox (TODO-02).** Em `OrderPlacedHandler`, traduza o evento para um `OrderPlacedIntegrationEvent` (um único `Guid` novo como `MessageId` e id da linha) e adicione um `OutboxMessage` a `db.OutboxMessages`, sem chamar `SaveChanges`: o `SaveChanges` externo grava pedido e linha juntos.
4. **Consumir uma vez (TODO-03).** Em `LoyaltyConsumer`, abra um contexto com `newContext()`, dê os pontos ao cliente (crie-o se não existir) e registre um `ProcessedMessage(e.MessageId, Name)` na mesma transação. Se já estiver lá, ignore a mensagem.

**Como saber que terminou**

`dotnet test` fica verde. Preste atenção nos três testes que conferem o que NÃO está no banco depois de uma falha ou de uma entrega duplicada. Você deve conseguir explicar por que um handler que lança desfaz o pedido, por que não há linha de outbox sem pedido e por que a mesma mensagem entregue duas vezes dá pontos só uma vez.

**Desafios opcionais**

- **TODO-04:** mova o despacho para `SavedChangesAsync` (depois do commit). Qual teste falha, e qual falha você nunca veria em teste (uma queda entre o commit e o despacho)?
- **TODO-05:** faça o `OrderPlacedHandler` chamar `db.SaveChangesAsync()`. O que acontece com os eventos, e por que o interceptor precisa limpá-los antes?
- **TODO-06:** registre o handler `Exploding` só para `OrderPlaced` e mova o trabalho de fidelidade para um handler dentro da transação. O que uma queda do serviço de fidelidade faz com o checkout agora?

**Pré-requisitos:** agregados e EF Core básico, `SaveChangesInterceptor` e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada ponto a preencher lança `NotImplementedException` com um comentário `TODO-NN` explicando o passo, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Domain events: design and implementation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Design a microservice domain model, aggregates and consistency, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model) (doc)
- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
