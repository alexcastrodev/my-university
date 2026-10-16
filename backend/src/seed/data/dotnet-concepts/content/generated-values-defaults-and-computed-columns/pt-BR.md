---
version: 1.0
updatedAt: 2026-10-15
title: "Valores Gerados, Defaults e Colunas Computadas"
summary: HasDefaultValue, HasDefaultValueSql, colunas computadas e ValueGeneratedOn* com os INSERT e UPDATE reais do EF Core 10 no SQLite, a armadilha do valor sentinela, triggers versus RETURNING e o DDL do SQL Server com sequência e default nomeado.
---
## Objective

Algumas colunas recebem valor do banco e não do seu código: uma chave
autoincremento, um `DEFAULT`, uma coluna computada, uma trigger. O EF Core
precisa saber duas coisas sobre cada uma: quando não mandar valor e quando ler um
valor de volta. Este conceito mostra como `HasDefaultValue`,
`HasDefaultValueSql`, `HasComputedColumnSql`, `ValueGeneratedOnAdd` e
`ValueGeneratedOnAddOrUpdate` respondem a essas perguntas, com os `INSERT` e
`UPDATE` reais do EF Core 10 no SQLite e o DDL de SQL Server gerado para o mesmo
modelo. Row version para concorrência está no conceito de transações e não se
repete aqui.

## Use Cases

- Um `CreatedAt` preenchido pelo banco, para que todo mundo que escreve (app,
  script, job de importação) concorde sobre o relógio.
- Um `Status` com default que a migration também aplica às linhas existentes
  quando a coluna é adicionada.
- Um nome de exibição ou total calculado no banco e sempre consistente.
- Um `UpdatedAt` mantido por trigger.
- Números de pedido tirados de uma sequência compartilhada por várias tabelas.

## Deep Dive

### O modelo

```csharp
var e = modelBuilder.Entity<Account>();
e.Property(x => x.Status).HasDefaultValue("Active");
e.Property(x => x.Credits).HasDefaultValue(10);
e.Property(x => x.Bonus).HasDefaultValue(5).HasSentinel(-1);      // public int Bonus { get; set; } = -1;
e.Property(x => x.IsActive).HasDefaultValue(true);
e.Property(x => x.CreatedAt).HasDefaultValueSql("CURRENT_TIMESTAMP");
e.Property(x => x.UpdatedAt).ValueGeneratedOnAddOrUpdate();      // preenchido por trigger
e.Property(x => x.FullName).HasComputedColumnSql("FirstName || ' ' || LastName", stored: true);
```

Salvar `new Account { FirstName = "Ana", LastName = "Silva" }` manda só as
colunas que o EF Core acha que você preencheu e pede o resto de volta no mesmo
comando:

```sql
INSERT INTO "Accounts" ("FirstName", "IsActive", "LastName", "OrderNo")
VALUES (@p0, @p1, @p2, @p3)
RETURNING "Id", "Bonus", "CreatedAt", "Credits", "FullName", "Status", "UpdatedAt";
-- after save: Id=1 Status=Active Credits=10 IsActive=False Full=Ana Silva Created=2026-10-15
```

A cláusula `RETURNING` (no SQL Server é `OUTPUT`) é o caminho pelo qual os
valores gerados chegam ao seu objeto sem uma segunda consulta.

### O default do CLR é o sinal de "não preenchido"

O EF Core não distingue "não preenchi `Credits`" de "preenchi `Credits` com 0":
os dois são `0`. Por padrão ele usa o default do CLR como sentinela e deixa a
coluna fora do `INSERT` quando a propriedade tem esse valor. Inserindo
`Credits = 0, Bonus = 0, IsActive = false`:

```sql
INSERT INTO "Accounts" ("Bonus", "FirstName", "IsActive", "LastName", "OrderNo") ...
-- after save: Credits=10 IsActive=False Bonus=0
```

`Credits` ficou de fora, então o banco gravou 10 por cima de um zero
intencional. `Bonus` tem `HasSentinel(-1)` (EF Core 8 em diante) e um
inicializador `-1`, então zero vira um valor comum e só `-1` significa "use o
default". As notas do EF Core 8 também descrevem o caso do `bool`: com default
`true`, o `false` do CLR seria sempre trocado, então o EF Core 8 passou a usar o
default do banco como sentinela do bool. Por isso `IsActive` é sempre enviado: um
`bool` não preenchido é gravado como `false`, e o `DEFAULT 1` só importa para
outros escritores. Um backing field anulável é a saída geral quando não sobra
valor livre para sentinela.

### Quem gera, não como

`ValueGeneratedOnAdd` diz ao EF Core que outra coisa produz o valor; ele não
produz nenhum. Uma chave `Guid` ganha um gerador no cliente por convenção, mas um
`Guid` que não é chave marcado com `ValueGeneratedOnAdd` não ganha:

```csharp
db.Add(new Ticket());   // after Add: Id=85bd2ff5-... Ref=00000000-0000-0000-0000-000000000000
db.SaveChanges();
// INSERT INTO "Ticket" ("Id") VALUES (@p0) RETURNING "Ref";
// DbUpdateException: SQLite Error 19: 'NOT NULL constraint failed: Ticket.Ref'.
```

O EF Core esperava que o banco preenchesse `Ref`, e nada no schema faz isso. Ou
você dá um default à coluna, ou liga um gerador no cliente, como a página do SQL
Server mostra para GUIDs que não são chave:

```csharp
b.Entity<Ticket>().Property(t => t.Ref).HasValueGenerator<SequentialGuidValueGenerator>();
// INSERT INTO "Ticket" ("Id", "Ref") VALUES (@p0, @p1);
```

Com datas é igual. Os providers não configuram geração para `DateTime` sozinhos;
você escolhe `HasDefaultValueSql` para a criação e algo de verdade, normalmente
uma trigger, para "última alteração".

### Colunas computadas e triggers

Mudar `LastName` faz o EF Core ler a coluna computada de volta:

```sql
UPDATE "Accounts" SET "LastName" = @p0 WHERE "Id" = @p1
RETURNING "FullName", "UpdatedAt";
-- Full=Ana Souza Updated=null
```

`FullName` está certo, mas `UpdatedAt` voltou nulo, embora uma consulta em
seguida mostrasse que a trigger tinha preenchido a coluna (`in the database:
2026`). O SQLite documenta que o `RETURNING` devolve os valores calculados antes
das triggers rodarem. A página do provider SQLite do EF Core cita triggers entre
as limitações do `RETURNING` e oferece um desligamento por tabela:

```csharp
b.Entity<Account>().ToTable(tb => tb.UseSqlReturningClause(false));
// UPDATE "Accounts" SET "LastName" = @p0 WHERE "Id" = @p1;
// SELECT "FullName", "UpdatedAt" FROM "Accounts" WHERE changes() = 1 AND "Id" = @p1;
// Full=Ana Costa Updated=2026
```

O SQL Server tem a chave equivalente, `UseSqlOutputClause(false)`, para tabelas
com trigger. Atribuir uma propriedade computada na mão é ignorado em silêncio:
`FullName = "Fake"` ficou fora do `INSERT` e o objeto voltou com
`Full=Caio Reis`.

### O que outros providers geram

O SQLite não tem sequências (está na lista de limitações do provider). Gerar o
script de SQL Server para o mesmo modelo não precisa de servidor, só de
`UseSqlServer(...)` e `Database.GenerateCreateScript()`:

```sql
CREATE SEQUENCE [OrderNumbers] START WITH 1000 INCREMENT BY 1 NO CYCLE;
CREATE TABLE [Accounts] (
    [Id] int NOT NULL IDENTITY,
    [FullName] AS [FirstName] + N' ' + [LastName] PERSISTED,
    [Status] nvarchar(max) NULL CONSTRAINT [DF_Accounts_Status] DEFAULT N'Active',
    [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
    [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
    [OrderNo] bigint NOT NULL DEFAULT (NEXT VALUE FOR OrderNumbers), ...
```

A sequência veio de `HasSequence<long>("OrderNumbers").StartsAt(1000)` mais
`HasDefaultValueSql("NEXT VALUE FOR OrderNumbers")`. A constraint de default
nomeada veio de `HasDefaultValue("Active", "DF_Accounts_Status")`, opção do EF
Core 10 para SQL Server; o mapa do EF Core 10 lista as outras mudanças da versão.
Os trechos de SQL dependem do provider: `CURRENT_TIMESTAMP` e `||` no SQLite,
`GETUTCDATE()` e `+` no SQL Server.

## Trade-offs

- **Default no banco versus inicializador em C#.** O default no banco vale para
  todo escritor e é aplicado às linhas existentes quando uma migration adiciona a
  coluna; o inicializador em C# só vale para o seu app, mas não tem a armadilha
  do sentinela.
  ```csharp
  public string Status { get; set; } = "Active"; // sempre enviado, sem surpresa no insert
  ```
- **Zero, false e vazio podem sumir.** Todo default em tipo de valor não anulável
  precisa de um sentinela livre ou de um backing field anulável, senão um `0`
  intencional vira o default.
- **Gerado significa que o EF Core espera um valor.** Marque uma propriedade como
  gerada sem um mecanismo no banco e o insert falha, ou pior, grava um default em
  silêncio.
- **Triggers e `RETURNING` não combinam.** Valores alterados por trigger ficam
  velhos em memória, a menos que você desligue `RETURNING`/`OUTPUT` naquela
  tabela, ao custo de um `SELECT` extra por linha.
- **SQL computado não é portável.** A expressão é SQL cru. Teste no SQLite não
  valida a expressão do SQL Server; gere o script para o provider real e revise.
- **Identity versus sequência versus chave no cliente.** Identity é o mais
  simples; sequência alimenta várias tabelas; GUID gerado no cliente evita ida ao
  banco ao inserir um grafo. Trocar depois é uma migração de dados.

## Documentation Links

- [Generated values, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/generated-properties) (doc)
- [What's new in EF Core 8, sentinel values and database defaults, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#sentinel-values-and-database-defaults) (doc)
- [Sequences, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/sequences) (doc)
- [SQL Server value generation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/value-generation) (doc)
- [SQLite provider: SaveChanges and the RETURNING clause, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/misc) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [The RETURNING clause, SQLite](https://sqlite.org/lang_returning.html) (doc)
