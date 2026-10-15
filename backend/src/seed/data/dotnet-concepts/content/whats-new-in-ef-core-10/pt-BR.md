---
version: 1.0
updatedAt: 2026-10-15
title: "O que há de novo no EF Core 10"
summary: Mapa das novidades do EF Core 10 (LTS, .NET 10): complex types e JSON, ExecuteUpdate, filtros nomeados, coleções parametrizadas, LeftJoin, segurança, SQL Server e Cosmos DB, cada uma com o conceito que aprofunda.
---
## Objective

O EF Core 10 saiu em novembro de 2025 como release de suporte de longo prazo
(LTS), e a página "What's new" lista dezenas de itens entre providers, modelagem,
consultas e segurança. Este conceito é um mapa, não um tutorial: agrupa as
mudanças principais, diz em poucas linhas o que cada uma faz e aponta o conceito
desta track que aprofunda. O que ainda não tem conceito próprio é só descrito aqui.

Ao terminar você deve saber quais mudanças podem afetar um upgrade, quais são
recursos opcionais e onde ler em seguida.

## Use Cases

- Planejar a migração do EF Core 8 ou 9 para o 10 e decidir o que testar primeiro.
- Revisar um pull request que usa uma API nova, como um filtro de consulta nomeado.
- Explicar ao time quais novidades exigem SQL Server 2025 ou Azure SQL e quais
  funcionam em qualquer provider.
- Achar o conceito certo sem ler a página inteira de release.

## Deep Dive

### O básico da release

A página oficial informa que o EF Core 10 exige o SDK do .NET 10 para compilar e
o runtime do .NET 10 para executar, e que não roda em versões anteriores do .NET
nem no .NET Framework. É uma release LTS com suporte até 10 de novembro de 2028.
O modelo de suporte e como escolher o target está em
`dotnet-support-lifecycle-and-choosing-a-target`.

### Modelagem: complex types e JSON

Os complex types foram a maior evolução. Agora aceitam valores opcionais (o tipo
precisa de pelo menos uma propriedade obrigatória), mapeamento para coluna JSON
com `ToJson` e structs do .NET (coleções de structs ainda não são suportadas). A
página explica por que complex types são melhores que owned entities para table
splitting e JSON: semântica de valor, comparação por conteúdo, atribuição que
copia. Quem usa owned types nesses casos é aconselhado a migrar.

No SQL Server 2025 e no Azure SQL, o tipo nativo `json` vira o padrão quando você
configura `UseAzureSql` ou compatibility level 170 ou maior. Colunas JSON em
`nvarchar` já existentes passam a `json` na próxima migration, a menos que você
opte por não mudar. Veja `json-columns-and-complex-types` para os detalhes e
`mapping-the-domain-with-ef-core` para value objects em geral.

### Atualizações: ExecuteUpdate

Duas mudanças tocam o `ExecuteUpdateAsync`. Ele pode referenciar colunas JSON e
as propriedades dentro delas, mas só quando os tipos são mapeados como complex
types. E agora aceita uma lambda comum no lugar de uma expression tree, então um
`SetProperty` condicional é um `if` normal. O lado JSON está em
`json-columns-and-complex-types`; o update em lote em geral está em
`query-translation-and-performance` e `ef-core-crud-operations-and-seeding`.

### Consultas

- **Filtros de consulta nomeados.** `HasQueryFilter` recebe um nome, e
  `IgnoreQueryFilters` pode desligar só alguns filtros por consulta. Soft delete
  e filtro de tenant passam a conviver na mesma entidade. Veja
  `global-and-named-query-filters`.
- **Coleções parametrizadas.** O novo padrão envia cada elemento como um
  parâmetro escalar próprio e completa a lista com valores repetidos para limitar
  a quantidade de textos SQL distintos. A estratégia muda globalmente com
  `UseParameterizedCollectionMode` ou por consulta com `EF.Constant`. A página
  descreve isso; o conceito mais próximo é `query-translation-and-performance`.
- **`LeftJoin` e `RightJoin`.** Os operadores LINQ do .NET 10 são reconhecidos
  pelo EF Core e traduzidos para `LEFT JOIN` e `RIGHT JOIN`. A sintaxe de query
  ainda não consegue expressá-los. Também coberto em
  `query-translation-and-performance`.
- **Split queries.** A ordenação agora é consistente entre as consultas de uma
  chamada com `AsSplitQuery`. Veja `loading-related-data-and-n-plus-one`.
- Itens menores incluem traduções novas como `DateOnly.ToDateTime()` e nomes de
  parâmetro mais simples (`@city` no lugar de `@__city_0`).

### Segurança

Constantes embutidas no SQL, por exemplo via `EF.Constant`, são ocultadas nos
logs como `?`, a não ser que o log de dados sensíveis esteja ligado. Um analyzer
avisa quando você concatena strings dentro do `FromSqlRaw`. Logging está em
`ef-core-logging-query-tags-and-diagnostics` e SQL cru em
`query-translation-and-performance`.

### SQL Server e Azure SQL

Além do tipo `json`, o EF Core 10 suporta o tipo `vector` por meio de
`SqlVector<float>` e da função `VectorDistance`, disponíveis no Azure SQL Database
e no SQL Server 2025. `HasDefaultValueSql` aceita um nome de constraint, e
`UseNamedDefaultConstraints` nomeia todas; com migrations existentes, a próxima
renomeia todas as default constraints. Ainda não há conceito aprofundado sobre
busca vetorial nesta track.

### Cosmos DB

Busca full-text (`EnableFullTextSearch`, `IsFullTextIndex`, `FullTextContains` e
funções relacionadas), busca híbrida com `Rrf`, busca vetorial saindo do preview
com `IsVectorProperty` e `IsVectorIndex`, e propriedades obrigatórias que
materializam um valor padrão quando um documento antigo não as tem. A escolha
entre armazenamento relacional e de documentos está em
`ef-core-ado-net-dapper-and-nosql`.

### Migrations e outros itens

O EF Core 10 deixa de envolver todas as migrations pendentes em uma única
transação, revertendo uma mudança do EF Core 9. Veja
`applying-migrations-in-production` e `ef-core-migrations-workflow`. O SQLite
também permite desligar o AUTOINCREMENT.

## Trade-offs

- **Mapa não é guia.** Cada resumo omite ressalvas que o conceito aprofundado
  cobre, como os limites do mapeamento JSON. Siga o link antes de adotar um recurso.
- **Padrões mudaram sem aviso.** O tipo de coluna `json`, o preenchimento de
  parâmetros e as transações por migration podem alterar o comportamento sem
  nenhuma edição de código. Leia a página de breaking changes e rode as migrations
  em uma cópia.
- **Vários recursos dependem do provider.** Vector, `json` nativo e a busca do
  Cosmos não existem em todo banco, então o código que os usa é menos portável.
- **Prefira complex types para value objects novos.** Owned entities ainda
  funcionam, mas a página direciona JSON e table splitting para complex types, e o
  `ExecuteUpdate` sobre JSON exige complex types.
- **Filtros nomeados criam regras a lembrar.** Mais filtros significam mais
  lugares onde uma consulta pode retornar menos do que você espera sem avisar.

## Documentation Links

- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Breaking changes in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/breaking-changes) (doc)
- [Vector search, SQL Server provider, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/vector-search) (doc)
- [Full-text search, Cosmos DB provider, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/full-text-search) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
