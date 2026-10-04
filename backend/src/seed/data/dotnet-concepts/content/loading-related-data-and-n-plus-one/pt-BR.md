---
version: 1.0
updatedAt: 2026-10-04
title: "Carregando Dados Relacionados e o Problema N+1"
summary: Include e ThenInclude, explosão cartesiana e AsSplitQuery, N+1 com lazy loading, projeções e como ler o SQL gerado com ToQueryString.
---
## Objective

O EF Core não carrega entidades relacionadas a menos que você peça. O jeito
como você pede decide se uma página precisa de uma query, de um punhado ou de
centenas. A falha clássica é o N+1: uma query para a lista e mais uma por linha
para buscar algo relacionado. A falha oposta é um único join enorme que repete
as colunas do pai para cada filho e multiplica o número de linhas. Conhecer
`Include`, split queries, projeções e o que o lazy loading realmente faz permite
escolher o formato de propósito e provar isso lendo o SQL.

## Use Cases

- Uma lista de pedidos que precisa mostrar o nome de cada cliente sem uma query
  por linha.
- Carregar um pedido com suas linhas e o produto de cada linha num único caso de
  uso.
- Um relatório que junta duas coleções e de repente devolve milhões de linhas.
- Descobrir por que um endpoint que era rápido em desenvolvimento emite 300
  queries contra os dados de produção.

## Deep Dive

### Eager loading com Include

`Include` e `ThenInclude` adicionam os dados relacionados à mesma query como
joins, e o resultado é rastreado como um grafo:

```csharp
var order = await db.Orders
    .Include(o => o.Lines)
        .ThenInclude(l => l.Product)
    .SingleAsync(o => o.Id == id, ct);
```

Use um include filtrado quando precisar de só parte da coleção:

```csharp
var orders = await db.Orders
    .Include(o => o.Lines.Where(l => l.Quantity > 10))
    .ToListAsync(ct);
```

### Explosão cartesiana e split queries

Incluir duas coleções do mesmo pai numa query junta as duas, e o banco devolve
todas as combinações: 10 linhas vezes 10 pagamentos dá 100 linhas por pedido,
com as colunas do próprio pedido repetidas em cada uma. `AsSplitQuery` envia uma
query por coleção:

```csharp
var orders = await db.Orders
    .Include(o => o.Lines)
    .Include(o => o.Payments)
    .AsSplitQuery()
    .ToListAsync(ct);
// SELECT ... FROM orders
// SELECT ... FROM lines JOIN orders ...
// SELECT ... FROM payments JOIN orders ...
```

Uma única query dá um snapshot consistente dos dados, e uma split query dá
várias idas ao banco que podem enxergar dados diferentes se linhas mudarem no
intervalo. Envolva numa transação serializable ou snapshot quando isso importar
(o que pode custar performance), ou configure
`UseQuerySplittingBehavior` uma vez para o contexto inteiro e sobrescreva com
`AsSingleQuery` onde uma query única for melhor.

### N+1 e lazy loading

O N+1 acontece quando o código percorre um resultado e toca numa navegação que
não foi carregada:

```csharp
var orders = await db.Orders.ToListAsync(ct);          // 1 query
foreach (var o in orders)
    Console.WriteLine(o.Customer.Name);                // +1 query por pedido, se o lazy loading estiver ligado
```

Com o pacote de lazy loading proxies, cada acesso a uma navegação dispara uma
query escondida, o que deixa esse bug invisível no código. Sem lazy loading,
`o.Customer` é simplesmente `null` e você ganha um bug diferente. Os dois se
resolvem decidindo o que o caso de uso precisa e carregando isso de antemão,
com `Include` ou, melhor para leituras, com uma projeção.

### Projeções carregam exatamente o que você mostra

Um `Select` para um DTO monta uma query só com as colunas usadas, não precisa de
tracking e torna o join implícito:

```csharp
var rows = await db.Orders
    .Select(o => new OrderListItem(
        o.Id.Value,
        o.Customer.Name,
        o.Lines.Count,
        o.Lines.Sum(l => l.Quantity * l.Price.Amount)))
    .ToListAsync(ct);
```

### Leia o SQL

Não dá para raciocinar sobre o número de queries sem olhar para elas.
`ToQueryString()` mostra o SQL de uma query sem executá-la, e o log mostra o
tráfego real:

```csharp
Console.WriteLine(db.Orders.Include(o => o.Lines).ToQueryString());

// Ou registre todo comando durante o desenvolvimento:
options.LogTo(Console.WriteLine, LogLevel.Information).EnableSensitiveDataLogging();
```

Adicione um teste que conte os comandos de um endpoint importante, para que um
novo `foreach` que cause N+1 quebre o build em vez do banco de produção.

## Trade-offs

- **`Include` devolve mais do que você precisa.** Ele carrega toda coluna de
  toda linha relacionada, rastreia tudo e ainda produz um join. Para uma tela de
  lista que mostra três campos, uma projeção faz o mesmo trabalho com uma
  fração dos dados.
- **Split queries trocam correção por tamanho.** Entre a primeira e a segunda
  query outra transação pode confirmar, então os filhos podem não combinar com o
  pai que você já leu.
  ```csharp
  // Pai lido em T1, linhas lidas em T2: um pedido pode aparecer com linhas adicionadas depois de T1.
  ```
- **Split queries com paginação precisam de ordem determinística.** Cada query
  repete o `Skip` e o `Take`, então sem um `OrderBy` por uma chave única o banco
  pode escolher pais diferentes em cada query e os filhos deixam de combinar com
  a página. O EF Core 10 tornou consistente a ordenação entre as split queries,
  mas a documentação continua mandando tornar a ordenação sempre totalmente
  única.
  ```csharp
  db.Orders.Include(o => o.Lines).AsSplitQuery()
      .OrderBy(o => o.CreatedAt).ThenBy(o => o.Id) // desempate único
      .Skip(40).Take(20);
  ```
- **Lazy loading esconde o N+1 atrás de um acesso a propriedade.** É conveniente
  para ferramentas pequenas e perigoso em request handlers, onde um laço
  inocente vira centenas de idas ao banco. Prefira carregamento explícito e
  mantenha proxies fora dos modelos de domínio, pois eles exigem membros
  virtuais para funcionar.
- **Contar queries exige ferramenta.** O log de SQL é barulhento e o N+1 só fica
  óbvio com volumes realistas de dados, então teste com mais de três linhas.

## Documentation Links

- [Loading related data, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/related-data/) (doc)
- [Single vs. split queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries) (doc)
- [Eager loading of related data, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/related-data/eager) (doc)
- [Efficient querying, EF Core performance, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying) (doc)
