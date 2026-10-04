---
version: 1.0
updatedAt: 2026-10-04
title: "Aggregates, Entities e Value Objects"
summary: Records como value objects, IDs fortemente tipados, aggregate root que protege as invariantes e coleções encapsuladas, com o custo de cada escolha.
---
## Objective

O domain-driven design dá ao modelo de um módulo três blocos de construção. Uma
entity tem uma identidade que sobrevive às mudanças. Um value object não tem
identidade e é definido inteiramente pelos seus valores. Um aggregate é um
conjunto de entities e value objects com uma raiz, e a raiz é a única porta de
entrada: toda mudança passa por ela, que assim consegue impor as invariantes que
precisam valer sempre. Em C#, isso se traduz em records, setters privados e
coleções encapsuladas, o que torna estados inválidos difíceis de escrever, em
vez de apenas desencorajados.

## Use Cases

- Um `Order` que nunca pode ser feito com zero linhas ou total negativo, não
  importa qual endpoint, job ou teste o construa.
- Um valor `Money` que carrega quantia e moeda juntas, para que somar euros com
  dólares seja um erro, e não um total errado.
- Manter `CustomerId` e `OrderId` como tipos distintos, para que um método que
  recebe os dois não possa ser chamado com os argumentos trocados.
- Decidir o que pertence a um aggregate (um pedido e suas linhas) e o que apenas
  guarda uma referência por id (o cliente que fez o pedido).

## Deep Dive

### Value objects como records

Um record dá igualdade por valor, imutabilidade com `init` e cópia não
destrutiva com `with`. Coloque a validação no construtor para que nenhuma
instância inválida exista:

```csharp
public sealed record Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount, string currency)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (currency.Length != 3) throw new ArgumentException("ISO 4217 code expected.", nameof(currency));
        (Amount, Currency) = (amount, currency.ToUpperInvariant());
    }

    public Money Add(Money other) =>
        other.Currency == Currency
            ? new Money(Amount + other.Amount, Currency)
            : throw new InvalidOperationException("Currency mismatch.");
}
```

Duas instâncias de `Money(10, "EUR")` são iguais porque a igualdade do record
compara todas as propriedades. Um `record struct` evita uma alocação para
valores pequenos, ao custo de um valor padrão (`default(Money)`) que pula o
construtor e a validação.

### IDs fortemente tipados

Um `Guid` ou `int` para cada identificador deixa o compilador aceitar
`Ship(customerId, orderId)` quando a assinatura é `Ship(OrderId, CustomerId)`.
Um `record struct` de uma linha faz deles tipos diferentes sem custo:

```csharp
public readonly record struct OrderId(Guid Value)
{
    public static OrderId New() => new(Guid.NewGuid());
}

public readonly record struct CustomerId(Guid Value);

// Ship(CustomerId, OrderId) deixa de compilar quando chamado como Ship(orderId, customerId).
```

O custo aparece nas bordas: serialização JSON, binding de rotas e EF Core
precisam saber transformar o wrapper no valor interno (um value converter no EF
Core, um `JsonConverter` ou `TypeConverter` na camada web).

### A raiz do aggregate protege as invariantes

Entities expõem comportamento, não setters. O construtor é privado ou protegido,
então a única forma de criar um pedido é uma factory que checa as regras, e a
coleção de linhas é exposta como somente leitura para que ninguém adicione nela
pelas costas da raiz:

```csharp
public sealed class Order
{
    private readonly List<OrderLine> _lines = [];

    private Order() { } // para o EF Core

    public OrderId Id { get; private set; }
    public CustomerId CustomerId { get; private set; }
    public IReadOnlyList<OrderLine> Lines => _lines;
    public OrderStatus Status { get; private set; }

    public static Order Place(CustomerId customerId, IEnumerable<(ProductId Product, int Quantity, Money Price)> items)
    {
        var order = new Order { Id = OrderId.New(), CustomerId = customerId, Status = OrderStatus.Placed };
        foreach (var (product, quantity, price) in items)
            order.AddLine(product, quantity, price);
        if (order._lines.Count == 0)
            throw new DomainException("An order needs at least one line.");
        return order;
    }

    public void AddLine(ProductId product, int quantity, Money price)
    {
        if (Status != OrderStatus.Placed) throw new DomainException("Order is closed.");
        if (quantity <= 0) throw new DomainException("Quantity must be positive.");
        _lines.Add(new OrderLine(product, quantity, price));
    }
}
```

`IReadOnlyList<OrderLine>` só esconde os métodos que modificam no tipo, então
quem chama ainda pode fazer um cast de volta para `List<OrderLine>`. Para uma
garantia forte, devolva `_lines.AsReadOnly()`, que embrulha a lista numa visão
somente leitura.

### C# 14: valide na propriedade com `field`

A partir do C# 14, um accessor de propriedade pode usar a palavra-chave `field`
para o backing field gerado pelo compilador, então um setter pode validar sem
declarar um campo privado à mão. Isso combina com o estado do aggregate, que
precisa continuar válido a cada mudança:

```csharp
public string Name
{
    get;
    private set => field = string.IsNullOrWhiteSpace(value)
        ? throw new DomainException("Name is required.")
        : value.Trim();
}
```

### Onde o aggregate termina

Referencie outros aggregates por id, nunca por objeto. `Order` guarda um
`CustomerId`, não um `Customer`. Isso mantém cada aggregate pequeno o bastante
para ser carregado e salvo como uma unidade, e combina com a fronteira de
transação: um aggregate por transação, com consistência eventual entre
aggregates (veja o conceito Domain Events and Consistency Boundaries).

## Trade-offs

- **IDs fortemente tipados acrescentam cerimônia em todo lugar em que o ID
  cruza uma fronteira.** Todo serializer, model binder e mapeamento de ORM
  precisa conhecê-los, e esquecer um produz erro em runtime, não de compilação.
  ```csharp
  // Sem um converter, o EF Core não consegue mapear OrderId e falha ao montar o modelo.
  builder.Property(o => o.Id).HasConversion(id => id.Value, value => new OrderId(value));
  ```
- **Um value object `record struct` pode ser criado num estado inválido.**
  `default(Money)` tem `Currency` nulo e nunca executou o construtor, e arrays
  ou `new Money[3]` estão cheios deles.
  ```csharp
  Money zero = default;   // Amount 0, Currency null
  zero.Add(new Money(5, "EUR")); // "Currency mismatch", porque null != "EUR"
  ```
  Use um `record` class selado quando valores padrão inválidos forem um risco
  real.
- **Aggregates ricos brigam com CRUD genérico.** Um aggregate que expõe
  comportamento e esconde setters não combina com um fluxo de "mapear este DTO
  na entity", então telas simples podem ser mais fáceis como queries e commands
  simples que pulam o modelo de domínio.
- **Aggregates grandes viram gargalo de concorrência.** Se `Order` contém também
  todos os envios e todas as tentativas de pagamento, dois usuários mexendo em
  partes não relacionadas conflitam na mesma versão de linha. Divida o aggregate
  quando edições concorrentes de partes diferentes forem normais.
- **`field` é uma palavra-chave contextual.** Uma classe que já tem um membro
  chamado `field` muda de significado ao migrar para o C# 14, então escreva
  `@field` ou `this.field` para manter o significado antigo.
- **Expor uma interface somente leitura não é imutabilidade.** Um
  `IReadOnlyList<T>` ainda aponta para a mesma lista mutável, então um cast
  quebra a garantia. Trate isso como sinal de intenção, não como fronteira de
  segurança.

## Documentation Links

- [Domain model design, Microsoft Learn (.NET microservices architecture)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model) (doc)
- [Implement value objects, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/implement-value-objects) (doc)
- [Records, C# reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Design the microservice domain model, aggregates and root entities, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice) (doc)
- [The field keyword, C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/field) (doc)
