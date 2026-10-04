---
version: 1.0
updatedAt: 2026-10-04
title: "Tradução de Queries e Performance no EF Core"
summary: Onde a tradução LINQ para SQL para, compiled queries, ExecuteUpdate e ExecuteDelete, FromSql vs FromSqlRaw e paginação por keyset.
---
## Objective

Uma query LINQ no EF Core é uma árvore de expressão que o provider traduz para
SQL. O que você escreve não é o que roda: parte vira SQL, parte pode rodar no
.NET e algumas coisas não podem ser traduzidas de jeito nenhum. Problemas de
performance vêm da distância entre as duas, do overhead por query e do uso do
change tracker para um trabalho que o banco faz em um único comando. Este
conceito cobre onde a tradução termina, como reduzir o overhead, como atualizar
e apagar em massa, como escrever SQL cru sem abrir uma brecha de injection e
como paginar sem o custo de um offset crescente.

## Use Cases

- Um `Where` que chama um método C# próprio e lança "could not be translated"
  em produção, e não no teste unitário.
- Um endpoint quente que roda a mesma query milhares de vezes por segundo.
- Encerrar todas as sessões expiradas com um comando, em vez de carregar e
  apagar uma a uma.
- Uma tela de busca que precisa de uma query que o EF Core não consegue
  expressar, e por isso usa SQL cru.
- Um feed de rolagem infinita que fica mais lento quanto mais o usuário rola.

## Deep Dive

### Onde a tradução termina

Operadores que o EF Core conhece viram SQL. Qualquer outra coisa no filtro ou na
ordenação lança exceção, em vez de carregar silenciosamente a tabela e filtrar
em memória (o comportamento antigo do EF Core 2). O único lugar onde a avaliação
no cliente ainda é permitida é a projeção final:

```csharp
// Traduzido: StartsWith, Length, Contains numa lista de parâmetros.
var ok = await db.Customers.Where(c => c.Name.StartsWith("A")).ToListAsync(ct);

// Lança: IsVip é um método C# que o provider não consegue transformar em SQL.
var bad = await db.Customers.Where(c => IsVip(c)).ToListAsync(ct);

// Permitido: a projeção roda no .NET depois que as linhas chegam.
var names = await db.Customers.Select(c => Format(c.Name)).ToListAsync(ct);
```

Se você precisa rodar algo em memória, cruze a fronteira de forma explícita com
`AsEnumerable` depois de filtrar no SQL, para saber exatamente quantas linhas
cruzam:

```csharp
var vips = db.Customers
    .Where(c => c.CreatedAt > cutoff) // SQL
    .AsEnumerable()                   // fronteira: as linhas passam a ser lidas pelo .NET daqui
    .Where(IsVip)                     // em memória
    .ToList();
```

### Compiled queries

O EF Core faz cache da tradução de cada formato de query, mas toda execução
ainda percorre a árvore de expressão para achar os parâmetros e a entrada do
cache. Num caminho quente, `EF.CompileAsyncQuery` faz esse trabalho uma vez:

```csharp
private static readonly Func<OrdersDbContext, OrderId, CancellationToken, Task<Order?>> GetOrder =
    EF.CompileAsyncQuery((OrdersDbContext db, OrderId id, CancellationToken ct) =>
        db.Orders.SingleOrDefault(o => o.Id == id));

var order = await GetOrder(db, id, ct);
```

Meça antes. O ganho só é real em queries muito frequentes e simples, e deixa o
código mais difícil de ler.

### Updates e deletes em massa

`ExecuteUpdateAsync` e `ExecuteDeleteAsync` enviam um único `UPDATE` ou
`DELETE` com o filtro no `WHERE`, sem carregar entidades nem rastrear nada:

```csharp
await db.Sessions
    .Where(s => s.ExpiresAt < now)
    .ExecuteDeleteAsync(ct);

await db.Products
    .Where(p => p.CategoryId == categoryId)
    .ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, p => p.Price * 1.1m), ct);
```

Eles rodam na hora, cada um em sua própria transação a menos que você tenha
aberto uma, e ignoram o change tracker, então uma entidade rastreada já em
memória mantém seus valores antigos. O EF Core 10 deixa o update receber uma
lambda comum, o que torna chamadas condicionais de `SetProperty` muito mais
fáceis de compor do que montar uma árvore de expressão à mão.

### SQL cru, com segurança

`FromSql` recebe uma string interpolada e transforma cada valor interpolado em
parâmetro, então é seguro. `FromSqlRaw` recebe uma string simples e a executa
como está, então concatenar entrada do usuário nela é SQL injection:

```csharp
// Seguro: {term} vira parâmetro.
var rows = await db.Products
    .FromSql($"SELECT * FROM products WHERE name ILIKE {term}")
    .ToListAsync(ct);

// Perigoso: a string é concatenada antes de o EF Core vê-la.
var evil = await db.Products
    .FromSqlRaw("SELECT * FROM products WHERE name ILIKE '" + term + "'")
    .ToListAsync(ct);
```

### Paginação por keyset

`Skip(n)` faz o banco ler e descartar `n` linhas, então a página 500 custa
muito mais que a página 1. A paginação por keyset lembra a última chave vista
(aqui o par `CreatedAt` e um `Number` único) e pede o que vem depois dela, o que
um índice consegue responder diretamente:

```csharp
var page = await db.Orders
    .Where(o => o.CreatedAt < lastCreatedAt
             || (o.CreatedAt == lastCreatedAt && o.Number < lastNumber))
    .OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Number)
    .Take(20)
    .ToListAsync(ct);
```

## Trade-offs

- **`AsEnumerable` cedo demais carrega a tabela.** Colocá-lo antes do `Where`
  traz todas as linhas para o .NET e filtra lá.
  ```csharp
  db.Customers.AsEnumerable().Where(c => c.Name.StartsWith("A")); // toda linha cruza a rede
  ```
- **Operações em massa pulam o modelo de domínio.** `ExecuteUpdate` não executa
  métodos do aggregate, interceptors que olham entidades rastreadas nem checagens
  de concorrência, então regras que vivem no aggregate não são aplicadas.
- **Operações em massa deixam entidades rastreadas desatualizadas.** Uma entidade
  carregada antes da chamada ainda mostra o valor antigo, e um `SaveChanges`
  posterior pode gravá-lo de volta.
- **Paginação por offset é simples e fica mais lenta.** Ela permite "ir para a
  página 37", o que a paginação por keyset não permite, então keyset serve para
  feeds e exportações, não para paginação numerada.
- **SQL cru prende a query a um banco.** Ele também deixa de compor: acrescentar
  `Include` ou filtros a uma query que termina numa stored procedure ou usa
  `ORDER BY` por dentro nem sempre funciona, então reserve SQL cru para os casos
  que o LINQ não consegue expressar.

## Documentation Links

- [How queries work, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works) (doc)
- [Client vs. server evaluation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/client-eval) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [SQL queries, FromSql and FromSqlRaw, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/sql-queries) (doc)
- [Pagination, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/pagination) (doc)
- [What is new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
