---
version: 1.0
updatedAt: 2026-11-14
title: "Busca full-text com EF Core: SQL Server, PostgreSQL e SQLite"
summary: Quando LIKE '%x%' deixa de servir. Catálogo e índice full-text no modelo (EF Core 11), FreeText e Contains, FreeTextTable e ContainsTable com rank, tsvector e GIN no PostgreSQL, e FTS5 no SQLite executado de verdade, com bm25, triggers e a entrada do usuário que derruba o MATCH.
---
## Objective

`Where(a => a.Body.Contains("framework"))` vira `LIKE '%framework%'`. Isso varre a
tabela, ignora formas de palavra e não dá nenhuma ordem de relevância. A busca
full-text é o recurso do banco feito para esse trabalho, e o EF Core 11 deixa o lado
SQL Server muito mais utilizável: o catálogo e o índice podem morar no modelo e ser
criados por migrations, e as funções com valor de tabela `FREETEXTTABLE` e
`CONTAINSTABLE` devolvem um rank pelo qual você pode ordenar.

Este concept mostra o mesmo recurso em três engines, porque o código não é portável
entre elas: SQL Server (EF Core 11), PostgreSQL (provider Npgsql) e SQLite (FTS5 por
SQL cru). Quais partes foram executadas importa, então aqui vai. A seção de SQLite
foi **executada** no EF Core 11.0.0 com linhas reais. O SQL de SQL Server e de
PostgreSQL foi **gerado offline** (`ToQueryString()` e `GenerateCreateScript()`, sem
servidor), o que prova o que o EF gera e não o que um servidor devolve. A execução
com PostgreSQL usou o build Npgsql 11.0.0-rc.3, o mais novo no NuGet em 14 de
novembro de 2026. As regras gerais de `EF.Functions` estão em
`ef-core-functions-and-database-specific-translation`.

## Use Cases

- Uma caixa de busca sobre artigos, tickets, produtos ou documentos em que
  "framework" também deve achar "Frameworks".
- Mostrar os melhores resultados primeiro, com um score para ordenar.
- Busca por prefixo, frases exatas e "esta palavra mas não aquela".
- Combinar as palavras exatas (full-text) com o significado (vetores) em uma só
  consulta, veja `ef-core-vector-search-with-sql-server-2025`.

## Deep Dive

### SQL Server: o catálogo e o índice pertencem ao modelo

Até o EF Core 10 o catálogo e o índice full-text eram SQL escrito à mão em uma
migration. O EF Core 11 os modela:

```csharp
modelBuilder.HasFullTextCatalog("ftCatalog");

modelBuilder.Entity<Article>()
    .HasFullTextIndex(a => new { a.Title, a.Body })
    .UseKeyIndex("PK_Articles")
    .UseCatalog("ftCatalog");
```

```sql
CREATE FULLTEXT CATALOG [ftCatalog];

CREATE FULLTEXT INDEX ON [Articles]([Title], [Body])
    KEY INDEX [PK_Articles] ON [ftCatalog];
```

Duas coisas saíram de executar isso no 11.0.0:

- `UseKeyIndex` é obrigatório. Sem ele a construção do modelo falha com `Full-text
  index '{'Title'}' on entity type 'Article' does not have a KEY INDEX
  configured. SQL Server requires a KEY INDEX for every full-text index.` Segundo a
  documentação do SQL Server, o índice de chave precisa ser único, de uma só coluna e
  não anulável, e a chave primária é a escolha usual.
- **As colunas viram `nvarchar(450)`.** `Title` e `Body` são `nvarchar(max)` por
  padrão, e assim que entram no índice full-text o DDL gerado diz `nvarchar(450)`.
  Essa é a convenção do SQL Server para qualquer propriedade string indexada (um
  `HasIndex(x => x.Title)` comum faz o mesmo). Para um título é inofensivo. Para o
  corpo de um artigo é um limite silencioso de 450 caracteres. Diga o que você quer:

```csharp
e.Property(a => a.Body).HasColumnType("nvarchar(max)");
```

Com essa linha o DDL mantém `nvarchar(max)` e o mesmo `CREATE FULLTEXT INDEX`. O
componente Full-Text Search do SQL Server também precisa estar instalado no
servidor, e a disponibilidade varia por edição e hospedagem, então confira a sua.

### SQL Server: predicados que filtram

`EF.Functions.FreeText` e `EF.Functions.Contains` existem há bastante tempo. Eles
devolvem um Boolean para o `Where`:

```csharp
db.Articles.Where(a => EF.Functions.FreeText(a.Title, "entity framework"));
db.Articles.Where(a => EF.Functions.Contains(a.Title, "\"entity*\" AND \"core\""));
```

```sql
WHERE FREETEXT([a].[Title], N'entity framework')
WHERE CONTAINS([a].[Title], N'"entity*" AND "core"')
```

`FreeText` recebe palavras simples e deixa o motor expandi-las em formas de palavra.
`Contains` recebe uma condição de busca com sintaxe própria: frases entre aspas,
`AND`/`OR`/`NOT` e `*` para prefixo. Nenhum dos dois dá um score, então você não
consegue ordenar por relevância com eles.

### SQL Server: ranking com FreeTextTable e ContainsTable

As funções novas têm valor de tabela: devolvem linhas de chave e rank, e você faz o
join de volta com a sua tabela.

```csharp
var results = await db.Articles
    .FreeTextTable<Article, int>("entity framework", a => a.Title)
    .Join(db.Articles, f => f.Key, a => a.Id, (f, a) => new { a.Title, f.Rank })
    .OrderByDescending(x => x.Rank)
    .ToListAsync();
```

```sql
SELECT [a0].[Title], [f].[RANK] AS [Rank]
FROM FREETEXTTABLE([Articles], [Title], @p) AS [f]
INNER JOIN [Articles] AS [a0] ON [f].[KEY] = [a0].[Id]
ORDER BY [f].[RANK] DESC
```

`ContainsTable<Article, int>(searchCondition, column, language, topN)` tem o mesmo
formato, com a sintaxe `"entity*" AND "core"`. Os argumentos opcionais são a coluna
(`null` pesquisa todas as colunas indexadas e emite `*`), um termo de idioma e um
`topN` que o SQL Server aplica dentro da função:

```csharp
db.Articles.FreeTextTable<Article, int>("entity framework", null, "English", 5)
```

```sql
FROM FREETEXTTABLE([Articles], *, @p, LANGUAGE N'English', @p1) AS [f]
```

O tipo de resultado é `FullTextSearchResult<TKey>`, um struct com exatamente `Key` e
`Rank` (um `int`). Ele não carrega a entidade. O exemplo da documentação do EF Core
11 lê `r.Value` dele, e isso não compila no 11.0.0, então o join de volta pela chave
mostrado acima é a forma que funciona. O tipo da chave precisa ser escrito
(`<Article, int>`), porque o compilador não consegue inferi-lo.

### PostgreSQL: uma coluna tsvector e um índice GIN

O Npgsql modela a busca full-text como uma coluna `tsvector` gerada, um índice sobre
ela e operadores de consulta:

```csharp
modelBuilder.Entity<Article>()
    .HasGeneratedTsVectorColumn(a => a.SearchVector, "english", a => new { a.Title, a.Body })
    .HasIndex(a => a.SearchVector).HasMethod("GIN");

var q = EF.Functions.WebSearchToTsQuery("english", "entity framework -dapper");
db.Articles.Where(a => a.SearchVector.Matches(q))
           .OrderByDescending(a => a.SearchVector.Rank(q));
```

```sql
"SearchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "Title" || ' ' || "Body")) STORED NOT NULL
CREATE INDEX "IX_Articles_SearchVector" ON "Articles" USING GIN ("SearchVector");

WHERE a."SearchVector" @@ websearch_to_tsquery('english', 'entity framework -dapper')
ORDER BY ts_rank(a."SearchVector", websearch_to_tsquery('english', 'entity framework -dapper')) DESC
```

`websearch_to_tsquery` aceita a sintaxe que as pessoas digitam em uma caixa de busca
(frases entre aspas, `-palavra`) e, segundo a documentação do PostgreSQL, não levanta
erros de sintaxe, o que a torna a porta de entrada mais segura para texto do usuário.
O idioma ('english') decide o stemming e as stop words, e precisa casar com o idioma
do conteúdo. Tudo aqui é SQL offline.

### SQLite: FTS5, com uma tabela virtual e SQL cru

O SQLite não tem mapeamento do EF para busca full-text, mas o motor tem FTS5
embutido. A parte do EF Core é executar o seu SQL. A tabela é uma tabela FTS5 de
*conteúdo externo* que aponta para `Articles`, mantida em sincronia por três triggers
(o de update apaga a linha antiga do índice e insere a nova):

```sql
CREATE VIRTUAL TABLE ArticlesFts USING fts5(
    Title, Body, content='Articles', content_rowid='Id',
    tokenize='unicode61 remove_diacritics 2');

CREATE TRIGGER Articles_ai AFTER INSERT ON Articles BEGIN
  INSERT INTO ArticlesFts(rowid, Title, Body) VALUES (new.Id, new.Title, new.Body);
END;
CREATE TRIGGER Articles_ad AFTER DELETE ON Articles BEGIN
  INSERT INTO ArticlesFts(ArticlesFts, rowid, Title, Body)
  VALUES ('delete', old.Id, old.Title, old.Body);
END;
-- Articles_au (AFTER UPDATE): a mesma linha 'delete', depois o INSERT novo
```

Em um projeto real esse SQL vai em uma migration com `migrationBuilder.Sql(...)`,
porque o modelo nunca enxerga `ArticlesFts`. (Esta execução o criou com `ExecuteSql`
depois de `EnsureCreated`.) A consulta é um `SqlQuery<T>` sobre um join, ordenada por
`bm25`:

```csharp
public record Hit(int Id, string Title, double Score);

var hits = db.Database.SqlQuery<Hit>($"""
    SELECT a.Id AS Id, a.Title AS Title, -bm25(ArticlesFts, 10.0, 1.0) AS Score
    FROM ArticlesFts
    JOIN Articles AS a ON a.Id = ArticlesFts.rowid
    WHERE ArticlesFts MATCH {match}
    ORDER BY bm25(ArticlesFts, 10.0, 1.0)
    """).ToList();
```

`bm25` devolve um número negativo em que menor é melhor, então a consulta ordena de
forma crescente e inverte o sinal para exibir. Os dois pesos fazem um acerto em
`Title` valer dez vezes um acerto em `Body`. Com 44 artigos na tabela (quatro reais e
40 linhas de enchimento), a execução imprimiu:

| `MATCH` | Resultado (score) |
|---|---|
| `entity framework` | 1 "Entity Framework Core 11" (11.058), 3 "Dapper versus EF Core" (5.962) |
| `entit*` (prefixo) | as mesmas duas linhas, a 1 primeiro |
| `"entity framework"` (frase) | as mesmas duas linhas |
| `core NOT dapper` | só a 1 |
| `title:core` (uma coluna) | 3 (5.620), 1 (5.529) |
| `configuracao` | "Configuração do banco" (6.679), graças ao `remove_diacritics` |

Quatro comportamentos para conhecer antes de ir para produção:

- **Os triggers não são opcionais.** Uma tabela de conteúdo externo não acompanha a
  tabela para a qual aponta. Contando os acertos direto na tabela virtual
  (`SELECT count(*) FROM ArticlesFts WHERE ArticlesFts MATCH 'pasta'`), um
  `ExecuteDelete` do artigo levou a contagem de 1 para 0 com o trigger de delete no
  lugar, e de 1 para **1** sem ele. A entrada velha continua no índice, e o `JOIN` de
  volta com `Articles` é o que a esconde da consulta acima. Operações em massa como
  `ExecuteDelete` e `ExecuteUpdate` pulam o change tracker, mas não os triggers do
  banco, e por isso os triggers são a camada certa.
- **Tabelas minúsculas dão score zero.** Na primeira execução a tabela tinha só
  quatro linhas, cada termo aparecia em metade delas, e todo score de `bm25` saiu
  `0.000`. Scores precisam de um corpus. A ordenação acima só apareceu depois das
  linhas de enchimento.
- **`MATCH` tem sintaxe própria, e entrada ruim lança exceção.** Passar `entity AND`
  de uma caixa de busca levantou `SqliteException: SQLite Error 1: 'fts5: syntax
  error near ""'`. A correção testada é transformar o texto do usuário em uma frase,
  cercando-o de aspas duplas e dobrando qualquer aspa interna:
  `static string Quote(string s) => "\"" + s.Replace("\"", "\"\"") + "\"";`.
  `Quote("entity AND")` não devolveu linhas nem exceção, e uma entrada hostil
  (`a" OR "b`) virou a frase inofensiva `"a"" OR ""b"`. O preço é que os usuários
  perdem operadores e prefixos a menos que você os devolva por conta própria.
- **Não é `LIKE`.** `EF.Functions.Like(a.Body, "%framework%")` casou uma linha por
  substring pura em `Body`, sem ranking e sem índice. O FTS5 casou duas linhas porque
  pesquisou `Title` e `Body` e tokenizou as palavras.

O SQL Server tem o mesmo tipo de armadilha. `CONTAINS` espera uma condição de busca
válida e falha em uma malformada, enquanto `FREETEXT` é mais tolerante. Isso vem da
documentação do SQL Server e não foi executado aqui.

## Trade-offs

- **Três engines, três APIs.** Nada neste concept é portável. Um recurso que precisa
  rodar em SQL Server e PostgreSQL exige uma interface sua com duas implementações,
  ou um serviço de busca fora do banco.
- **O índice não é instantâneo em todo lugar.** O SQL Server popula um índice
  full-text com um processo próprio, então uma linha inserida agora há pouco pode não
  ser pesquisável de imediato (comportamento documentado do SQL Server, não executado
  aqui). Triggers e colunas geradas, como nos exemplos de SQLite e PostgreSQL,
  mantêm o índice transacional com a escrita.
- **O idioma faz parte do índice.** Stemming e stop words dependem do idioma que você
  configura. Um catálogo em português pesquisado com configuração em inglês funciona
  mal de jeitos que parecem "a busca é instável".
- **Scores não são comparáveis.** O rank do SQL Server, o `ts_rank` do PostgreSQL e o
  `bm25` do SQLite usam escalas diferentes, então um limite como "rank acima de 50"
  faz sentido em uma engine só. Ordene por eles, não fixe valores no código.
- **`nvarchar(450)` pode truncar ou rejeitar dados.** Revise o DDL de qualquer
  entidade que você coloque em um índice full-text.
- **Quando o banco não basta.** Tolerância a erros de digitação, facetas e sinônimos
  sobre milhões de documentos são o que engines dedicadas como Meilisearch ou
  Elasticsearch fazem, ao custo de uma segunda cópia dos dados para manter em
  sincronia (`full-text-and-vector-search-indexes`, na trilha de system design,
  compara as duas abordagens).

## Documentation Links

- [Full-text search, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/full-text-search) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [FREETEXTTABLE, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/freetexttable-transact-sql) (doc)
- [CONTAINSTABLE, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/containstable-transact-sql) (doc)
- [Full-text search, Npgsql Entity Framework Core provider](https://www.npgsql.org/efcore/mapping/full-text-search.html) (doc)
- [SQLite FTS5 extension](https://www.sqlite.org/fts5.html) (doc)
