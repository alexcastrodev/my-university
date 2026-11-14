---
version: 1.0
updatedAt: 2026-11-14
title: "Busca vetorial com EF Core 11 e SQL Server 2025: exata, aproximada e híbrida"
summary: SqlVector<float>, CREATE VECTOR INDEX nas migrations, VectorDistance para busca exata, VectorSearch().Take().WithApproximate() para usar o índice, o aviso de busca sem índice, o T-SQL gerado, busca híbrida com full-text e FullJoin, e a coluna vetorial que deixa de vir com a entidade. SQL offline, sem servidor.
---
## Objective

O EF Core 10 já calculava a distância entre dois vetores em uma consulta. O EF Core
11 acrescenta a outra metade da busca vetorial no SQL Server 2025: criar um índice
vetorial a partir de uma migration, pesquisar nele com `VectorSearch()` e
`WithApproximate()`, e parar de carregar a coluna de embedding toda vez que você
carrega a entidade. Juntas, essas mudanças trocam "ordenar todas as linhas pela
distância" por "pedir ao índice os vizinhos mais próximos".

Este concept cobre o modelo, os dois tipos de busca (exata e aproximada), o aviso que
o EF emite quando você esquece o índice, filtros, busca híbrida com full-text e os
limites. Cada trecho foi compilado e executado no EF Core 11.0.0 com o .NET 11.0.100.
O SQL do SQL Server foi gerado offline com `ToQueryString()` e
`GenerateCreateScript()`, sem servidor e sem dados. Isso prova o que o EF Core gera
e não que um servidor aceita ou ranqueia bem o resultado, e não diz nada sobre
recall. O que vem só da documentação é dito como tal.
`ef-core-functions-and-database-specific-translation` trata de `EF.Functions` em
geral, e `embeddings-and-vector-search-with-vectordata` cobre como produzir os
embeddings.

## Use Cases

- Busca semântica sobre artigos, tickets ou documentos: "ache as linhas cujo
  significado é o mais próximo desta pergunta".
- Recuperação para um pipeline de RAG que já guarda os dados no SQL Server, sem um
  segundo banco só para os vetores.
- Combinar similaridade com colunas comuns, como "parecido, e publicado depois de 1
  de janeiro de 2026".
- Escolher entre uma busca exata, que sempre acerta e fica mais lenta com a tabela,
  e uma aproximada, que é rápida e pode perder um vizinho verdadeiro.

## Deep Dive

### O modelo: uma coluna vetorial e um índice vetorial

Um embedding é um `SqlVector<float>` (namespace `Microsoft.Data.SqlTypes`) mapeado
para uma coluna `vector(n)`. A dimensão não é opcional: sem ela a construção do
modelo falha com `Vector property 'Article.Embedding' was not configured with the
number of dimensions. Set the column type to 'vector(x)'...`.

```csharp
public class Article
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public DateTime PublishedOn { get; set; }
    public SqlVector<float> Embedding { get; set; }
}

protected override void OnModelCreating(ModelBuilder b)
{
    b.Entity<Article>().Property(a => a.Embedding).HasColumnType("vector(1536)");

    b.Entity<Article>()
        .HasVectorIndex(a => a.Embedding, "IX_Articles_Embedding")
        .HasMetric("cosine")
        .HasType("DiskANN");
}
```

```sql
CREATE TABLE [Articles] (
    [Id] int NOT NULL IDENTITY,
    [Title] nvarchar(max) NOT NULL,
    [PublishedOn] datetime2 NOT NULL,
    [Embedding] vector(3) NOT NULL,
    CONSTRAINT [PK_Articles] PRIMARY KEY ([Id])
);
CREATE VECTOR INDEX [IX_Articles_Embedding] ON [Articles]([Embedding])
    WITH (METRIC = 'cosine', TYPE = 'DiskANN');
```

(A execução acima usou `vector(3)` para manter a saída curta. Em código real use a
dimensão do seu modelo de embedding.) Três detalhes que foram conferidos:

- O segundo argumento de `HasVectorIndex` é o **nome do índice**. A documentação da
  prévia mostra `HasVectorIndex(b => b.Embedding, "cosine")`, e no 11.0.0 isso falha
  na construção do modelo com `Vector index ''cosine'' on entity type 'Article' must
  specify a similarity metric. Call 'HasMetric' on the vector index builder.` A
  métrica vai em `HasMetric`.
- `HasMetric` é obrigatório. `HasType` não é: sem ele o DDL simplesmente não tem a
  cláusula `TYPE` e o servidor usa o padrão dele.
- `HasVectorIndex`, `VectorSearch` e `WithApproximate` são APIs experimentais. O
  compilador reporta **EF9105** até você suprimir
  (`<NoWarn>$(NoWarn);EF9105</NoWarn>` ou um `#pragma`). É um aviso de que elas ainda
  podem mudar, então mantenha as chamadas em uma única classe de repositório.

### Busca exata: VectorDistance

O jeito do EF Core 10 continua funcionando e continua exato. Ele ordena por uma
função escalar, então o servidor calcula a distância para cada linha:

```csharp
var q = new SqlVector<float>(embeddingFromYourModel);

var nearest = await db.Articles
    .OrderBy(a => EF.Functions.VectorDistance("cosine", a.Embedding, q))
    .Take(5)
    .ToListAsync();
```

```sql
SELECT TOP(@p) [a].[Id], [a].[PublishedOn], [a].[Title]
FROM [Articles] AS [a]
ORDER BY VECTOR_DISTANCE('cosine', [a].[Embedding], @q)
```

`ToQueryString()` imprime o parâmetro `@q` como o nome do tipo CLR
(`Microsoft.Data.SqlTypes.SqlVector`1[System.Single]`), que é um limite desse
método. O comando real envia um vetor. Repare que o índice vetorial não participa:
isso é uma varredura, e é a ferramenta certa para alguns milhares de linhas, para
testes e como verdade de referência quando você mede uma busca aproximada.

### Busca aproximada: VectorSearch, Take e WithApproximate

`VectorSearch` é uma função com valor de tabela sobre o `DbSet`. Ela devolve
`VectorSearchResult<T>`, um struct com a entidade em `Value` e a distância em
`Distance`. Acrescentar `Take(n).WithApproximate()` diz ao SQL Server para usar o
índice:

```csharp
var hits = await db.Articles
    .VectorSearch(a => a.Embedding, q, "cosine")
    .OrderBy(r => r.Distance)
    .Take(5)
    .WithApproximate()
    .Select(r => new { r.Value.Title, r.Distance })
    .ToListAsync();
```

```sql
SELECT TOP(@p1) WITH APPROXIMATE [a].[Id], [a].[PublishedOn], [a].[Title], [v].[Distance]
FROM VECTOR_SEARCH(
    TABLE = [Articles] AS [a],
    COLUMN = [Embedding],
    SIMILAR_TO = @p,
    METRIC = 'cosine'
) AS [v]
ORDER BY [v].[Distance]
```

Sem `WithApproximate()` a mesma consulta tem `SELECT TOP(@p1)` e roda como uma busca
exata por força bruta sobre a mesma função. As regras que o EF aplica, cada uma vista
como `InvalidOperationException` no 11.0.0:

- `VectorSearch` só existe em um `DbSet<T>`, então precisa ser o primeiro operador da
  consulta. Filtros vêm depois dele e se referem à entidade como `r.Value`.
- `WithApproximate()` precisa vir depois de `Take()`: `WithApproximate() must be
  called after Take() to specify the number of results.`
- `Skip(5).Take(5).WithApproximate()` é rejeitado (`Use Take().WithApproximate().Skip()
  instead, or remove Skip()`). A ordem aceita envolve a consulta aproximada em um
  subselect e aplica o `OFFSET` por fora, então a paginação é uma janela sobre os
  `n` primeiros, não uma busca mais profunda.

### O aviso de quem esquece o índice

Como a forma exata compila e devolve linhas corretas, o erro é fácil de cometer e
demora a ser notado. O EF registra um aviso para ele:

```text
warn: SqlServerEventId.VectorSearchWithoutApproximateIndexWarning[30006] (Microsoft.EntityFrameworkCore.Query)
      The query uses 'VectorSearch' on property 'Embedding' of entity type 'Article',
      but 'WithApproximate()' was not specified. The query will perform an exact
      brute-force search instead of using a vector index. Call 'WithApproximate()'
      after 'Take()' to use the vector index for better performance.
```

O aviso só existe quando o modelo declara um índice vetorial naquela coluna. Sem
`HasVectorIndex` no modelo, nada é registrado, porque não há índice que a consulta
pudesse ter usado. Se você quer mesmo força bruta em algum lugar, ignore o evento;
se nunca quer, transforme-o em erro e seus testes pegam a chamada que faltou:

```csharp
options.ConfigureWarnings(w => w.Throw(SqlServerEventId.VectorSearchWithoutApproximateIndexWarning));
// InvalidOperationException: An error was generated for warning
// 'Microsoft.EntityFrameworkCore.Query.VectorSearchWithoutApproximateIndexWarning': ...
```

`Throw` foi executado no 11.0.0 e falha como mostrado. O evento fica em
`Microsoft.EntityFrameworkCore.Diagnostics`.

### Combinando similaridade com filtros comuns

Os filtros vão depois de `VectorSearch`, sobre `r.Value`:

```csharp
db.Articles
    .VectorSearch(a => a.Embedding, q, "cosine")
    .Where(r => r.Value.PublishedOn >= new DateTime(2026, 1, 1))
    .OrderBy(r => r.Distance)
    .Take(5)
    .WithApproximate();
```

O EF coloca o `WHERE` no mesmo `SELECT` de `TOP(@p1) WITH APPROXIMATE`:

```sql
SELECT TOP(@p1) WITH APPROXIMATE ... FROM VECTOR_SEARCH(...) AS [v]
WHERE [a].[PublishedOn] >= '2026-01-01T00:00:00.0000000'
ORDER BY [v].[Distance]
```

O que o SQL Server faz com isso uma execução offline não mostra: se o predicado
estreita os candidatos antes de o índice ser pesquisado ou apara os `n` mais
próximos depois decide se você pode receber menos de `n` linhas. A documentação do
SQL Server para `VECTOR_SEARCH` é a autoridade. Teste com um filtro muito seletivo
nos seus dados e conte as linhas.

### Busca híbrida: full-text mais vetor

A busca vetorial encontra significado, e a full-text encontra as palavras exatas,
então combinar as duas cobre os dois casos. O formato é o da documentação do EF Core
11: pegue os `k` melhores de cada lista, faça `FullJoin` entre elas para que uma
linha encontrada por um lado só sobreviva, e calcule uma pontuação combinada. Esta
versão compila e é traduzida no 11.0.0 (a metade full-text está em
`full-text-search-with-ef-core`):

```csharp
int k = 60;
var results = db.Articles
    .FreeTextTable<Article, int>("entity framework", null, null, k)
    .Join(db.Articles, f => f.Key, a => a.Id, (f, a) => new { Article = a, f.Rank })
    .FullJoin(
        db.Articles.VectorSearch(a => a.Embedding, q, "cosine")
            .OrderBy(r => r.Distance).Take(k).WithApproximate(),
        f => f.Article.Id,
        v => v.Value.Id,
        (f, v) => new
        {
            Article = f != null ? f.Article : v.Value,
            FullTextRank = f == null ? null : (int?)f.Rank,
            VectorDistance = v.Value == null ? null : (double?)v.Distance
        })
    .Select(x => new
    {
        x.Article.Title,
        Score = (x.FullTextRank == null ? 0.0 : 1.0 / (k + x.FullTextRank.Value))
              + (x.VectorDistance == null ? 0.0 : 1.0 / (k + x.VectorDistance.Value))
    })
    .OrderByDescending(x => x.Score)
    .Take(10);
```

O SQL é uma instrução só, com a função full-text à esquerda e a busca aproximada
como tabela derivada à direita:

```sql
FROM FREETEXTTABLE([Articles], *, @p, @p1) AS [f]
INNER JOIN [Articles] AS [a0] ON [f].[KEY] = [a0].[Id]
FULL JOIN (
    SELECT TOP(@p3) WITH APPROXIMATE [a1].[Id], ..., [v].[Distance]
    FROM VECTOR_SEARCH(TABLE = [Articles] AS [a1], COLUMN = [Embedding],
        SIMILAR_TO = @p2, METRIC = 'cosine') AS [v]
    ORDER BY [v].[Distance]
) AS [v0] ON [a0].[Id] = [v0].[Id]
```

Duas correções ao exemplo da documentação, achadas ao compilá-lo. A linha
`vs == null` não compila porque `VectorSearchResult<T>` é um struct (erro CS0019),
então o teste acima é `v.Value == null`. E `FreeTextTable` aqui precisa do tipo da
chave explícito (`<Article, int>`), porque o compilador não consegue inferi-lo.

A pontuação é decisão sua. A documentação cita a ideia de reciprocal rank fusion, que
é definida sobre a **posição** de uma linha em cada lista (1, 2, 3). O exemplo
alimenta a fórmula com o score de rank do full-text e com a distância vetorial, então
o que ele calcula é uma heurística de mistura e não a fórmula de livro. Os dois
números também correm em direções opostas (um rank full-text maior é melhor, uma
distância maior é pior). Escolha uma combinação e julgue-a com consultas cujas
respostas certas você conhece.

### O embedding deixa de vir com a entidade

O EF Core 11 deixa as colunas `SqlVector<T>` fora do `SELECT` quando materializa uma
entidade:

```csharp
db.Articles.OrderBy(a => a.Title).ToList();
// SELECT [a].[Id], [a].[PublishedOn], [a].[Title] FROM [Articles] AS [a] ORDER BY [a].[Title]

db.Articles.Select(a => new { a.Id, a.Embedding }).ToList();
// SELECT [a].[Id], [a].[Embedding] FROM [Articles] AS [a]
```

Um embedding de 1.536 floats tem cerca de 6 KB, então uma página de 50 artigos deixa
de arrastar 300 KB de números que você nunca lê. A documentação informa um ganho de
nove vezes contra um banco local e de cerca de vinte e duas vezes contra um Azure SQL
remoto no benchmark dela (números da documentação, não medidos aqui). A coluna
continua funcionando em `WHERE`, `ORDER BY`, `VectorDistance` e `VectorSearch`. O que
convém lembrar é o outro lado: uma entidade carregada assim tem `Embedding` no valor
padrão, que significa "não carregado" e não "vazio no banco". Para ler o vetor,
projete-o explicitamente.

## Trade-offs

- **Exata contra aproximada.** A exata sempre acerta e custa tempo proporcional à
  tabela. A aproximada é rápida e pode pular um vizinho verdadeiro. Para saber com que
  frequência, rode as mesmas perguntas das duas formas e compare os `n` primeiros. O
  EF não vai dizer.
- **Experimental dos dois lados.** A documentação marca `VECTOR_SEARCH` e índices
  vetoriais como experimentais no SQL Server, e o EF marca a API com EF9105. Planeje
  para um renome, esconda as chamadas em um lugar só e confira os requisitos de prévia
  da sua edição do SQL Server na documentação do servidor.
- **O schema fica preso ao modelo de embedding.** `vector(1536)` é uma decisão sobre
  um modelo. Trocar para um modelo com outras dimensões significa uma nova coluna, um
  novo índice e refazer o embedding da tabela inteira.
- **Só SQL Server 2025 e Azure SQL.** `VectorSearch` e `HasVectorIndex` são extensões
  do provider SQL Server. Um modelo que as usa não roda no SQLite, e o PostgreSQL tem
  outro caminho (pgvector pelo provider Npgsql, não coberto aqui).
- **SQL offline não é relevância.** `ToQueryString()` prova a tradução. Só um servidor
  real com embeddings reais prova que os resultados são bons.
- **A pontuação híbrida é decisão de produto.** Os dois rankings não compartilham a
  escala, então qualquer fórmula que os una precisa ser ajustada e testada como
  qualquer outra configuração de relevância.

## Documentation Links

- [Vector search, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/vector-search) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [VECTOR_SEARCH, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/functions/vector-search-transact-sql) (doc)
- [CREATE VECTOR INDEX, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-vector-index-transact-sql) (doc)
- [FREETEXTTABLE, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/freetexttable-transact-sql) (doc)
