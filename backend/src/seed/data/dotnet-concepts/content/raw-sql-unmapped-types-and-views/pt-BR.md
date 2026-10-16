---
version: 1.0
updatedAt: 2026-10-16
title: "SQL Bruto, Tipos Não Mapeados e Views"
summary: SqlQuery<T> para tipos fora do modelo, ExecuteSql para comandos e entidades sem chave para views e consultas no EF Core 10, com o SQL real no SQLite, o filtro global que SqlQuery ignora, o alias Value e a armadilha do ToSqlQuery que ainda cria tabela.
---
## Objective

O LINQ cobre a maioria das consultas e o `FromSql` é a saída de emergência para o
resto. Mas o `FromSql` só devolve entidades, e muitas consultas em SQL bruto não
devolvem entidades: um relatório que junta três tabelas, uma lista de ids, uma
contagem, a saída de uma view. Este conceito cobre a outra metade do SQL bruto no
EF Core 10: `SqlQuery<T>` para tipos que não estão no modelo, `ExecuteSql` para
comandos e entidades sem chave para views e para consultas que merecem morar no
modelo. Cada comportamento abaixo foi executado no SQLite; as regras de
parametrização de `FromSql` e `FromSqlRaw` estão no conceito de query translation e
não são repetidas aqui.

## Use Cases

- Uma linha de relatório (`ProductName`, `CategoryName`, `Price`) que junta tabelas
  e não corresponde a nenhuma entidade.
- Ler de uma view de banco que pertence ao time de dados.
- Uma tabela sem chave primária, como um log, que você só lê.
- Uma consulta crítica que o LINQ traduz mal, escrita à mão mas ainda composta com
  `Where` e `OrderBy`.
- Um comando em massa que não tem API no EF Core.

## Deep Dive

### Entidades com FromSql e o que ele envolve

O modelo dos exemplos é `Product` (com filtro global em `IsDeleted`) e `Category`.
O `FromSql` começa uma consulta a partir de um `DbSet` e trata o seu SQL como uma
subconsulta sobre a qual o LINQ compõe:

```csharp
var q = db.Products.FromSql($"SELECT * FROM Products WHERE Price > {min}")
    .Where(p => p.Name != "x").OrderBy(p => p.Name);
```
```sql
SELECT "p"."Id", "p"."CategoryId", "p"."IsDeleted", "p"."Name", "p"."Price"
FROM (
    SELECT * FROM Products WHERE Price > @p0
) AS "p"
WHERE NOT ("p"."IsDeleted") AND "p"."Name" <> 'x'
ORDER BY "p"."Name"
```

Três consequências aparecem nessa saída. O filtro global de consulta é adicionado
fora do seu SQL, então um `SELECT *` escrito à mão ainda esconde as linhas
apagadas. O seu SQL precisa ser válido dentro de parênteses: um ponto e vírgula no
final funciona num `ToList()` simples, mas qualquer operador composto, até
`Count()`, falhou com `near ";": syntax error`. E o `FromSql` é uma extensão só de
`DbSet<T>`; não compila depois de um `Where`. As entidades precisam de todas as
colunas mapeadas: `SELECT Id FROM Categories` falhou com "The required column 'Name'
was not present in the results". Os nomes de coluna precisam ser os mapeados, não os
nomes das propriedades, o que importa num banco legado com `HasColumnName`. O
`Include` funciona depois do `FromSql`: `.Include(p => p.Category)` devolveu "Dune
in Books".

### SqlQuery para tipos fora do modelo

`db.Database.SqlQuery<T>` devolve um `IQueryable<T>` para um tipo que o EF Core não
conhece. Para um escalar, ele lê a primeira coluna:

```csharp
var names = db.Database.SqlQuery<string>($"SELECT Name FROM Products ORDER BY Id").ToList();
```

Compor LINQ por cima exige uma regra: a coluna precisa se chamar `Value`, porque o
EF Core a referencia no SQL que acrescenta. Sem o alias o SQLite respondeu
`no such column: s.Value`; com ele:

```csharp
db.Database.SqlQuery<int>($"SELECT Id AS Value FROM Products").Where(i => i > 1)
```
```sql
SELECT "s"."Value"
FROM (
    SELECT Id AS Value FROM Products
) AS "s"
WHERE "s"."Value" > 1
```

Para linhas, dê qualquer classe ou record com propriedades correspondentes; ela não
precisa de tabela, chave nem registro:

```csharp
public class ProductRow { public string ProductName { get; set; } = ""; public string CategoryName { get; set; } = ""; public double Price { get; set; } }
public record CatCount(string Name, int Total);

db.Database.SqlQuery<ProductRow>($"""
    SELECT p.Name AS ProductName, c.Name AS CategoryName, p.Price
    FROM Products p JOIN Categories c ON c.Id = p.CategoryId
    WHERE p.IsDeleted = 0
    """).ToList();
```

O join devolveu as linhas, o record posicional `CatCount` foi preenchido pelo
construtor, e `ChangeTracker.Entries().Count()` ficou em 0: nada é rastreado. Se o
tipo tem uma propriedade que não está no resultado, a chamada falha com "The
required column 'Other' was not present in the results". O contrário, uma coluna
sem propriedade correspondente, foi ignorado em silêncio na minha execução (vieram
4 linhas), então um erro de digitação num alias pode passar despercebido até a
propriedade ser lida como nula ou zero.

O `SqlQuery` parte de `db.Database`, não de um `DbSet`, então nenhum filtro global
de consulta se aplica. O mesmo `SELECT Name FROM Products` devolveu
`Dune,Emma,Lego,Old` pelo `SqlQuery<string>` e `Dune,Emma,Lego` pelo `FromSql`,
porque `Old` está apagado logicamente. Relatórios escritos com `SqlQuery` precisam
repetir à mão as condições de tenant e de soft delete.

A documentação também descreve classes `[ComplexType]` aninhadas em resultados do
`SqlQuery` (colunas chamadas `Address_City`). Na minha execução no 10.0.13 isso
falhou com "appears to be a navigation to another entity type", então eu não
contaria com isso ainda.

### ExecuteSql para comandos

O `ExecuteSql` roda um comando que não devolve linhas e retorna a contagem de
linhas afetadas; valores interpolados viram parâmetros como no `FromSql`:

```csharp
var n = db.Database.ExecuteSql($"UPDATE Products SET Price = Price * 1.1 WHERE CategoryId = {cat.Id}");
// n == 2
```

Prefira `ExecuteUpdate` ou `ExecuteDelete` quando o LINQ consegue expressar a
mudança, porque continuam tipados. O `ExecuteSql` é para o que o LINQ não diz, e
para DDL como o `CREATE VIEW` de que a próxima seção precisa.

### Views e consultas como entidades sem chave

Quando a mesma consulta bruta é usada várias vezes, coloque-a no modelo como uma
entidade sem chave. Uma view é o caso comum:

```csharp
b.Entity<CategoryStat>().HasNoKey().ToView("v_category_stats");
```
```sql
SELECT "v"."AvgPrice", "v"."CategoryId", "v"."CategoryName", "v"."ProductCount"
FROM "v_category_stats" AS "v"
WHERE "v"."ProductCount" > 1
```

Agora `db.CategoryStats.Where(...)` compõe como em qualquer entidade, e os
resultados não são rastreados. `db.CategoryStats.Add(...)` seguido de `SaveChanges`
lança "Unable to track an instance of type 'CategoryStat' because it does not have
a primary key", que é o desenho: tipos sem chave são somente leitura. Mapear com
`ToView` também deixa o tipo fora do schema: o `EnsureCreated` criou `Categories` e
`Products` e nenhuma tabela para a view. A view em si é sua para criar, numa
migration com `migrationBuilder.Sql(...)`. Uma tabela sem chave primária é mapeada
do mesmo jeito com `HasNoKey().ToTable(...)`.

Um tipo sem chave também pode ser definido por uma consulta no modelo:

```csharp
b.Entity<ExpensiveItem>().HasNoKey().ToSqlQuery("SELECT Name, Price FROM Products WHERE Price > 25");
```

Há uma armadilha. Só com `ToSqlQuery`, o script de criação gerado pelo EF Core
10.0.13 ainda continha um `CREATE TABLE` para o tipo sem chave (um tipo `Item` de
uma propriedade gerou `CREATE TABLE "Items" ("Name" TEXT NOT NULL)`), porque o
mapeamento de tabela padrão permaneceu. Acrescentar `.ToTable((string?)null)` o
removeu, e o `EnsureCreated` não criou tabela para `ExpensiveItem`. Confira a
migration de qualquer tipo mapeado assim antes de ele chegar a um banco de verdade.

### Stored procedures

O SQLite não tem stored procedures, então esta parte vem da documentação e não foi
executada aqui. `FromSql($"EXECUTE dbo.GetMostPopularBlogs")` funciona para
procedures que devolvem colunas de entidade, mas o SQL Server não consegue compor
sobre uma chamada de procedure; coloque `AsEnumerable()` ou `AsAsyncEnumerable()`
logo depois do `FromSql` para o EF Core não tentar envolvê-la numa subconsulta. Uma
procedure que devolve um formato próprio passa pelo `SqlQuery<T>` do mesmo modo.

## Trade-offs

- **SQL bruto é um contrato com o schema que nada verifica.** Uma coluna renomeada
  falha em runtime, na primeira execução. Mantenha as consultas ao lado de testes
  que rodam contra o provider real.
  ```csharp
  db.Database.SqlQuery<ProductRow>($"SELECT ...").ToList(); // teste cada consulta uma vez
  ```
- **`SqlQuery` ignora filtros globais.** É a ferramenta certa para relatórios e a
  errada para qualquer coisa que precise respeitar soft delete ou multi-tenancy, a
  menos que você acrescente a condição.
- **Tipos sem chave são somente leitura de propósito.** Sem rastreamento, sem
  `SaveChanges`, sem relacionamentos em que sejam o principal. Use para ler e
  mantenha as escritas em entidades de verdade.
- **Views tiram lógica da aplicação.** O time de banco pode mudar uma view sem
  release, e o seu modelo só descobre em runtime. No EF Core um tipo com `ToView`
  não faz parte do schema que ele cria, então a definição da view precisa da sua
  própria migration.
- **SQL específico de provider.** A regra do alias `Value` é a mesma em todo
  provider, mas o resto do texto é dialeto. Um modelo testado só no SQLite não
  prova a versão para SQL Server ou PostgreSQL.

## Documentation Links

- [SQL queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/sql-queries) (doc)
- [Keyless entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/keyless-entity-types) (doc)
- [What's new in EF Core 8, raw SQL queries for unmapped types, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#raw-sql-queries-for-unmapped-types) (doc)
- [Entity types, view mapping, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/entity-types#view-mapping) (doc)
- [Managing migrations, arbitrary changes via raw SQL, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/managing#arbitrary-changes-via-raw-sql) (doc)
