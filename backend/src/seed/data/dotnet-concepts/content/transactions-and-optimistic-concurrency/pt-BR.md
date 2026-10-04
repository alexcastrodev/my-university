---
version: 1.0
updatedAt: 2026-10-04
title: "Transações e Concorrência Otimista no EF Core"
summary: A transação implícita do SaveChanges, concurrency tokens (rowversion e xmin), DbUpdateConcurrencyException e a retry strategy junto com transação manual.
---
## Objective

Todo `SaveChanges` já é uma transação, então a maior parte do código nunca abre
uma. O que merece atenção é o que essa transação não faz. Ela não impede que
dois usuários editem a mesma linha ao mesmo tempo, e não combina com uma retry
strategy assim que você começa a sua própria transação. A concorrência otimista
resolve o primeiro problema detectando o conflito na hora de gravar, em vez de
travar linhas enquanto o usuário pensa. A execution strategy resolve o segundo
repetindo a unidade de trabalho inteira, e não um comando isolado.

## Use Cases

- Dois funcionários abrem o mesmo pedido, e o segundo a salvar não pode
  sobrescrever em silêncio a alteração do primeiro (uma lost update).
- Salvar um pedido e suas linhas juntos, para que tudo seja gravado ou nada seja.
- Uma transação que precisa abranger um `SaveChanges` e um comando SQL cru.
- Uma conexão com o banco que cai por um segundo durante um deploy, e a
  requisição deve funcionar numa nova tentativa em vez de falhar.

## Deep Dive

### SaveChanges é uma transação

Quando um `SaveChanges` produz vários comandos (um `INSERT` para o pedido e um
por linha), o EF Core os envolve em uma única transação, então uma falha desfaz
todos. Você só abre uma transação quando a unidade de trabalho precisa de mais
de um `SaveChanges` ou mistura comandos que o EF Core não rastreia:

```csharp
await using var tx = await db.Database.BeginTransactionAsync(ct);

db.Orders.Add(order);
await db.SaveChangesAsync(ct);

await db.Database.ExecuteSqlAsync($"UPDATE stock SET reserved = reserved + {qty} WHERE sku = {sku}", ct);

await tx.CommitAsync(ct); // uma exceção antes deste ponto desfaz tudo no dispose
```

### Concurrency tokens

Um concurrency token é uma coluna cujo valor precisa estar inalterado desde que
você leu a linha. O EF Core o coloca no `WHERE` do `UPDATE` e confere quantas
linhas foram afetadas. Se a linha mudou, nenhuma linha casa e o EF Core lança
`DbUpdateConcurrencyException`:

```csharp
// UPDATE orders SET status = @p0 WHERE id = @p1 AND version = @p2;
// 0 linhas afetadas -> DbUpdateConcurrencyException
```

No SQL Server, o token natural é uma coluna `rowversion`, mapeada para uma
propriedade `byte[]`. No PostgreSQL não há esse tipo de coluna, mas toda linha
tem uma coluna de sistema `xmin` com o id da transação da última escrita, que
funciona do mesmo jeito. O provider Npgsql mapeia para `xmin` uma propriedade
`uint` configurada como row version:

```csharp
public byte[] Version { get; set; } = [];  // SQL Server: rowversion
public uint Version { get; set; }          // PostgreSQL (Npgsql): xmin

builder.Property(o => o.Version).IsRowVersion(); // a mesma chamada para os dois providers
// ou [Timestamp] na propriedade
```

Um simples `[ConcurrencyCheck]` numa propriedade comum também funciona, desde que
toda escrita a altere.

### Tratando o conflito

A exceção traz as entradas que falharam. O que fazer é uma decisão de negócio:
deixar o banco vencer, deixar o cliente vencer ou fazer merge. A reação útil mais
simples numa aplicação web é informar o conflito e deixar o usuário recarregar:

```csharp
try
{
    await db.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException ex)
{
    var entry = ex.Entries.Single();
    var current = await entry.GetDatabaseValuesAsync(ct); // null se a linha foi apagada

    if (current is null) return Results.NotFound();
    return Results.Conflict(new { message = "Someone else changed this order. Reload and try again." });
}
```

Numa API HTTP, envie o token ao cliente (um `ETag` ou um campo `version`) e exija
que ele volte junto com o update, para que o conflito seja detectado entre
requisições, e não apenas dentro de uma.

### Retry strategies e suas próprias transações

`EnableRetryOnFailure` faz o EF Core repetir comandos que falham com erros
transitórios. Uma repetição reexecuta um comando, então não consegue retomar uma
transação que você mesmo começou, e o EF Core se recusa a iniciar uma a menos
que você entregue a unidade de trabalho inteira pela execution strategy:

```csharp
builder.Services.AddDbContext<OrdersDbContext>(o =>
    o.UseNpgsql(connectionString, n => n.EnableRetryOnFailure(maxRetryCount: 3)));

var strategy = db.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await db.Database.BeginTransactionAsync(ct);
    // ... um ou mais SaveChanges, SQL cru
    await tx.CommitAsync(ct);
});
```

A lambda pode rodar mais de uma vez, então precisa ser segura para repetir: sem
efeitos colaterais fora da transação, como enviar um e-mail, dentro dela.

## Trade-offs

- **Concorrência otimista detecta, não previne.** O segundo usuário faz o
  trabalho e só então recebe um erro. Isso é certo quando conflitos são raros, e
  ruim para uma linha quente (um contador, um nível de estoque) onde as
  repetições se acumulam. Use ali um `UPDATE ... SET x = x + 1` atômico ou um
  lock.
- **Um token por aggregate.** O token vive na raiz do aggregate, então editar
  duas partes não relacionadas de um aggregate grande gera conflito. Esse é um
  motivo para manter os aggregates pequenos.
- **Um conflito é um evento de negócio, não uma exceção para engolir.** Repetir
  às cegas com os valores do cliente transforma a checagem numa escrita
  last-writer-wins e traz de volta a lost update.
  ```csharp
  await entry.ReloadAsync(ct); // o banco vence: descarta a alteração do cliente
  entry.OriginalValues.SetValues(await entry.GetDatabaseValuesAsync(ct)); // o cliente vence: mantém a alteração
  ```
- **Uma retry strategy impõe o formato da lambda.** Código que inicia uma
  transação fora do `ExecuteAsync` falha com uma exceção sobre a execution
  strategy configurada, o que surpreende quem só adicionou `EnableRetryOnFailure`
  na inicialização.
- **Repetir a unidade de trabalho repete seus efeitos colaterais.** Se a lambda
  chama um serviço externo e depois falha no commit, a nova tentativa o chama de
  novo, então chamadas externas precisam de chaves de idempotência ou ficam
  depois do commit.
- **Uma falha durante o commit deixa o resultado desconhecido.** Se a conexão cai
  enquanto a transação está confirmando, a strategy tenta de novo como se tivesse
  sido desfeita, o que pode duplicar uma linha com chave gerada pelo banco. A
  documentação sugere chaves geradas no cliente, como um `Guid` (assim a
  duplicata falha em vez de inserir duas vezes), ou verificar o resultado com
  `ExecuteInTransactionAsync` e seu delegate `verifySucceeded`.

## Documentation Links

- [Transactions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Handling concurrency conflicts, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/concurrency) (doc)
- [Connection resiliency, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency) (doc)
- [Concurrency tokens, Npgsql EF Core provider](https://www.npgsql.org/efcore/modeling/concurrency.html) (doc)
