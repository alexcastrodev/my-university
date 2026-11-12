---
version: 1.0
updatedAt: 2026-11-12
title: "O que há de novo no EF Core 11"
summary: Mapa das novidades do EF Core 11 (STS, .NET 11) com SQL lado a lado contra o EF Core 10: SQL mais enxuto, traduções novas, índice em caminho JSON, LastMigrationId, SQL Server 2025 e Cosmos DB.
---
## Objective

O EF Core 11.0.0 saiu em 10 de novembro de 2026, junto com o .NET 11. Para quem
já roda o EF Core 10, a release é quase invisível: as mesmas consultas geram SQL
mais enxuto, alguns operadores que antes lançavam exceção agora são traduzidos, e
alguns mapeamentos ganham recursos específicos de provider para SQL Server 2025 e
Cosmos DB. O custo da release está nos detalhes que mudam o comportamento sem
erro de compilação, e eles estão em
`upgrading-from-ef-core-10-to-11-breaking-changes`.

Este concept é o mapa do lado das funcionalidades. Onde o código pôde ser
executado, o texto mostra a saída real do EF Core 11.0.0 ao lado do EF Core
10.0.14 com o mesmo código. O SQL do SQL Server foi gerado offline, com
`ToQueryString()` e `GenerateCreateScript()` e sem servidor, então prova o que o
EF gera e não que um servidor aceita. O que veio só da documentação é dito como
tal.

## Use Cases

- Decidir se vale sair do LTS EF Core 10 para o STS 11 e o que se ganha.
- Ler o SQL gerado depois de um upgrade e entender por que ele encurtou.
- Trocar gambiarras no cliente (`List.Exists`, `byte[].Any()`, `string.Join`
  ordenado) por consultas que rodam no banco.
- Saber o que exige SQL Server 2025 ou Cosmos DB antes de prometer ao time.

## Deep Dive

### O básico da release

O EF Core 11 exige o .NET 11 e é uma release de suporte padrão (STS). O EF Core 10
é o LTS e fica suportado até 10 de novembro de 2028, então continuar no 10 é uma
escolha válida; `dotnet-support-lifecycle-and-choosing-a-target` explica como
escolher. O mapa anterior é `whats-new-in-ef-core-10`.

Dois detalhes da página oficial "What's new" não batem com o pacote publicado. Ela
chama o novo padrão de transações do Cosmos de `Auto`, mas os membros do enum são
`WhenNeeded`, `Always` e `Never`. E nomeia a opção de bulk como
`BulkExecutionEnabled()`, mas o método que compila é `BulkExecutionAllowed()`.
Quando a documentação e o compilador discordam, o compilador está certo.

### SQL mais enxuto, sem mudar código

O mesmo LINQ, executado nas duas versões, gera SQL diferente. O primeiro exemplo é
um split query com um include de referência e um de coleção, executado no SQLite:

```csharp
db.Blogs.Include(b => b.BlogType).Include(b => b.Posts).AsSplitQuery().ToList();
```

```sql
-- EF Core 10, segundo comando
SELECT "p"."Id", "p"."BlogId", "p"."Title", "b"."Id", "b0"."Id"
FROM "Blogs" AS "b"
INNER JOIN "BlogType" AS "b0" ON "b"."BlogTypeId" = "b0"."Id"
INNER JOIN "Posts" AS "p" ON "b"."Id" = "p"."BlogId"
ORDER BY "b"."Id", "b0"."Id"

-- EF Core 11, segundo comando
SELECT "p"."Id", "p"."BlogId", "p"."Title", "b"."Id"
FROM "Blogs" AS "b"
INNER JOIN "Posts" AS "p" ON "b"."Id" = "p"."BlogId"
ORDER BY "b"."Id"
```

O join com a navegação de referência saiu do comando filho e o `ORDER BY` não
carrega mais a chave da navegação de referência. Menos colunas para ordenar e um
join menor ajudam sem aparecer em um banco de brinquedo, então meça no seu.

Um `GroupBy` que agrega sobre uma navegação de referência perdeu a subconsulta
correlacionada (SQL Server, offline):

```sql
-- EF Core 10
SELECT [p].[BlogId] AS [Key], (
    SELECT MAX([b].[Name])
    FROM [Posts] AS [p0]
    INNER JOIN [Blogs] AS [b] ON [p0].[BlogId] = [b].[Id]
    WHERE [p].[BlogId] = [p0].[BlogId]) AS [Top]
FROM [Posts] AS [p]
GROUP BY [p].[BlogId]

-- EF Core 11
SELECT [p].[BlogId] AS [Key], MAX([b].[Name]) AS [Top]
FROM [Posts] AS [p]
INNER JOIN [Blogs] AS [b] ON [p].[BlogId] = [b].[Id]
GROUP BY [p].[BlogId]
```

E um `CAST` sem efeito sumiu. Com um value converter cujo tipo no provider já é
string, `EF.Functions.Like(u.Name, "Name%")` gerava
`WHERE CAST([u].[Name] AS nvarchar(max)) LIKE N'Name%'`, o que impede o uso de
índice; o EF Core 11 emite `WHERE [u].[Name] LIKE N'Name%'`. A leitura mais
profunda do SQL gerado está em `query-translation-and-performance`.

### Traduções que agora funcionam

Estas lançavam `InvalidOperationException` ("could not be translated") ou não
existiam no EF Core 10. Todas rodaram no EF Core 11.0.0 com SQLite, salvo onde
indicado.

- **`List<T>.Exists`** sobre uma navegação vira `WHERE EXISTS (SELECT 1 FROM ...)`.
  No EF Core 10 falha com o erro de tradução.
- **`byte[].Any()`** vira `DATALENGTH(...) > 0` no SQL Server (offline). Também
  falha no EF Core 10.
- **`FullJoin`** é traduzido para `FULL JOIN`, que o SQLite 3.53.4 executou.
- **`MaxByAsync` e `MinByAsync`** rodam em um único comando:
  `ORDER BY (SELECT COUNT(*) ...) DESC LIMIT 1`, sem passo no cliente.
- **`string.Join` ordenado sobre `GroupBy`** vira
  `group_concat("p"."Title", '|' ORDER BY "p"."Id" DESC)` no SQLite. O EF Core 10
  gerava um `LEFT JOIN` e montava o texto em memória.
- **Membros de `DateTimeOffset`**, como `UtcDateTime`, viram
  `CONVERT(datetime2, [p].[Created] AT TIME ZONE 'UTC')` no SQL Server (offline).

### Math.Max e Math.Min dependem do compatibility level

No SQL Server, o EF Core 11 assume o compatibility level 160 (SQL Server 2022)
quando você não define um. Nesse nível, `Math.Max` e `Math.Min` viram `GREATEST` e
`LEAST`:

```csharp
db.Posts.Select(p => Math.Max(p.Rating, p.Views));
```

```sql
-- EF Core 10: SELECT [p].[Rating], [p].[Views]     (o máximo é calculado no cliente)
-- EF Core 11: SELECT GREATEST([p].[Rating], [p].[Views])
-- EF Core 11 com UseCompatibilityLevel(150): volta à forma no cliente
```

Se o servidor de produção for anterior ao 2022, defina o nível explicitamente com
`UseSqlServer(cs, o => o.UseCompatibilityLevel(150))`. Esta também é uma breaking
change, tratada no concept de upgrade, e `EF.Functions.Greatest` e `Least`
existem para uso explícito.

### JSON e complex types

Índices sobre um caminho dentro de uma coluna JSON agora são gerados. Configure com
um caminho em string e o provider escreve o DDL certo:

```csharp
e.ComplexProperty(c => c.Contact, c => c.ToJson());
e.HasIndex("Contact.City");
```

```sql
-- SQLite, executado
CREATE INDEX "IX_Customers_Contact_City" ON "Customers" ("Contact" ->> 'City');

-- SQL Server, compatibility level 170 e coluna json (offline)
CREATE JSON INDEX [IX_Customers_Contact_City] ON [Customers]([Contact]) FOR (N'$.City');
```

No SQLite, um caminho sobre todos os elementos de um array é recusado na
construção do modelo (`SQLite does not support indexes over all elements of a JSON
array`); uma posição fixa, como `Items[0].Sku`, é aceita. Complex types com mapeamento
JSON também funcionam em hierarquia table-per-type agora (`EnsureCreated` funcionou
em um teste). Os detalhes de mapeamento estão em `json-columns-and-complex-types`.

### Migrations: o snapshot conhece a última migration

O snapshot do modelo gerado por `dotnet ef migrations add` na 11.0.0 contém

```csharp
// If you encounter a merge conflict in the line below, it means you need to
// discard one of the migration branches and recreate its migrations on top of
// the other branch.
public override string LastMigrationId => "20261112001413_Initial";
```

Dois branches que adicionam uma migration cada passam a conflitar nessa linha no
merge, em vez de juntar sem reclamar e produzir uma cadeia quebrada. O conflito é
o aviso desejado. Mais sobre branches em `ef-core-migrations-workflow`.

### SQL Server 2025 (SQL gerado offline)

Tudo nesta seção foi gerado com `GenerateCreateScript()` e `ToQueryString()` contra
`UseSqlServer` no compatibility level 170, sem conexão. Confira a edição e o estado
do recurso no seu servidor antes de depender dele. Um índice vetorial, um catálogo
full-text e um índice full-text podem fazer parte de uma migration:

```csharp
b.Entity<Article>().HasVectorIndex(a => a.Embedding, "IX_Articles_Embedding")
    .HasMetric("cosine").HasType("DiskANN");
b.HasFullTextCatalog("ftCatalog");
b.Entity<Article>().HasFullTextIndex(a => a.Title).UseKeyIndex("PK_Articles").UseCatalog("ftCatalog");
```

```sql
CREATE VECTOR INDEX [IX_Articles_Embedding] ON [Articles]([Embedding]) WITH (METRIC = 'cosine', TYPE = 'DiskANN');
CREATE FULLTEXT CATALOG [ftCatalog];
CREATE FULLTEXT INDEX ON [Articles]([Title]) KEY INDEX [PK_Articles] ON [ftCatalog];
```

As consultas seguem: `VectorSearch(...).WithApproximate()` vira
`SELECT TOP(@p1) WITH APPROXIMATE ... FROM VECTOR_SEARCH(...)`, e
`FreeTextTable<Article, int>` devolve linhas com `Key` e `Rank` que você junta de
volta à entidade. Uma coluna `vector` não é mais selecionada ao carregar a entidade
(`SELECT [a].[Id], [a].[Title]`); só uma projeção explícita traz `[a].[Embedding]`.
`whats-new-in-ef-core-10` tem o suporte vetorial anterior.

### Cosmos DB

Conferido na 11.0.0 sem emulador: `Database.AutoTransactionBehavior` devolve
`WhenNeeded` no provider do Cosmos, as opções expõem `BulkExecutionAllowed()`, um
complex type gera um caminho aninhado (`WHERE (c["ShippingAddress"]["City"] = "Lisbon")`)
e um `ToList()` síncrono lança `InvalidOperationException` ("Azure Cosmos DB does not
support synchronous I/O"). Que os transactional batches agrupam as escritas por
partição e o que o bulk faz em tempo de execução vêm da documentação, não de uma
execução. O concept do provider é `ef-core-nosql-cosmos-db-and-mongodb`.

### Itens menores

- `ChangeTracker.GetEntriesForState` não chama `DetectChanges`. Editar uma
  propriedade deu `0` entradas modificadas até chamar `DetectChanges()`, e então `1`.
- `RemoveDbContext<T>()` e um `AddPooledDbContextFactory<T>()` sem parâmetros
  funcionaram em um teste, o que ajuda testes de integração que trocam o banco.
- O provider do SQLite faz round trip de `Half` e passa um parâmetro `UInt128` como
  texto.
- O analisador `EF1004` avisa no build da 11.0.0 quando `ToAsyncEnumerable()` é
  chamado sobre um `IQueryable`, porque isso itera de forma síncrona. Use
  `AsAsyncEnumerable()`.
- Split queries lançam `DbQueryConcurrencyException` quando linhas mudam entre os
  comandos, em vez de devolver dados errados. Isso vem das release notes e do pull
  request; o SQLite não reproduz, então não é mostrado aqui.

## Trade-offs

- **STS contra LTS.** O EF Core 11 tem cerca de dois anos de suporte, o EF Core 10
  tem três. Um time que atualiza todo ano ganha o SQL novo; um time que quer um
  upgrade a cada três anos fica no 10.
- **SQL mais enxuto é um ganho que não dá para desligar.** O texto das consultas
  muda, então chaves de cache de plano, hints em logs e testes de snapshot sobre
  `ToQueryString()` veem strings novas. Regrave-os no upgrade.
- **Um padrão novo pode virar um requisito novo.** `GREATEST` exige SQL Server 2022.
  Com um servidor mais antigo você precisa definir o compatibility level, ou as
  consultas falham em tempo de execução e não no build.
  ```csharp
  o.UseSqlServer(cs, sql => sql.UseCompatibilityLevel(150));
  ```
- **A documentação anda na frente do pacote.** Nomes como `BulkExecutionEnabled()`
  não chegaram à release. Confira a API no editor.
- **Recursos de um só provider reduzem a portabilidade.** Índices vetoriais e
  full-text, índices JSON e batches do Cosmos não existem em todo banco, então o
  código que os usa prende o modelo a um provider.
- **Providers de terceiros atrasam.** Um provider de MongoDB, MySQL ou outros pode
  ainda mirar o EF Core 10 no dia da release. Confira o NuGet antes de se
  comprometer com o upgrade.

## Documentation Links

- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
- [Vector search, SQL Server provider, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/vector-search) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [Migrations overview, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/) (doc)
- [.NET 11 release notes, GitHub](https://github.com/dotnet/core/tree/main/release-notes/11.0) (doc)
