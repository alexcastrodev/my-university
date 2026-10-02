---
version: 1.0
updatedAt: 2026-07-30
title: Tratando NULLs e Casamento de Padrões em SQL
summary: Como IS NULL/IS NOT NULL e COALESCE tratam dados ausentes de forma portável entre bancos, como os curingas % e _ do LIKE casam texto parcial, e as pegadinhas de sensibilidade a maiúsculas e de índices (curingas no início vs no fim, pg_trgm) que diferem entre PostgreSQL, MySQL e SQL Server.
---
## Objective

NULL não se comporta como um valor: você não pode testá-lo com `=` ou `!=`, e transformá-lo em algo utilizável exige uma função dedicada em vez de uma comparação. Encontrar linhas por texto parcial também precisa de um operador totalmente diferente da igualdade. As duas coisas aparecem em quase toda consulta que toca dados reais e incompletos.

## Use Cases

- Filtrar linhas em que um campo opcional nunca foi preenchido (uma comissão que não se aplica a todo funcionário, um nome do meio que ninguém preencheu).
- Substituir NULL por um padrão sensato para exibição ou aritmética: uma comissão NULL não deveria quebrar uma soma, deveria contar como zero.
- Busca em texto livre ou por correspondência parcial em um recurso de pesquisa (o nome contém uma substring, o nome do arquivo termina com uma dada extensão) sem um motor de busca full-text.

## Deep Dive

### Testando NULL: IS NULL / IS NOT NULL

```sql
select * from emp where comm is null;
```

NULL nunca é igual (nem diferente) a nada, nem a ele mesmo. `comm = NULL` e `comm != NULL` são sempre desconhecidos, nunca verdadeiros, então retornam nada em silêncio em vez de dar erro. `IS NULL` / `IS NOT NULL` são a única forma correta de testá-lo.

### Substituindo NULL por um padrão: COALESCE

```sql
select coalesce(comm, 0) from emp;
```

`COALESCE` recebe um ou mais argumentos e retorna o primeiro que não é NULL: aqui, `comm` quando está preenchido, `0` caso contrário. O mesmo resultado pode ser alcançado com `CASE`:

```sql
select case when comm is not null then comm else 0 end from emp;
```

mas o `COALESCE` diz a mesma coisa com uma fração dos caracteres e, por ser SQL ANSI, funciona de forma idêntica no PostgreSQL, no MySQL e no SQL Server. O `COALESCE` também não é limitado a dois argumentos: `coalesce(nickname, first_name, 'Unknown')` retorna o primeiro valor não NULL entre quantas alternativas forem necessárias.

### Casamento de padrões com LIKE

```sql
select ename, job
  from emp
 where deptno in (10, 20)
   and (ename like '%I%' or job like '%ER');
```

`%` casa com qualquer sequência de caracteres (inclusive nenhuma); `_` casa com exatamente um caractere. Onde o `%` fica muda o casamento: `'ER%'` casa com strings que *começam* com "ER", `'%ER'` casa com strings que *terminam* com "ER", e `'%ER%'` casa com "ER" aparecendo em qualquer lugar.

## Trade-offs

- **A sensibilidade a maiúsculas do `LIKE` não é a mesma entre bancos, e nada disso é óbvio pela própria consulta.** O `LIKE` do PostgreSQL diferencia maiúsculas por padrão (use `ILIKE` lá para casamento sem diferenciar); o MySQL e o SQL Server *não* diferenciam maiúsculas por padrão, porque suas collations padrão (`utf8mb4_0900_ai_ci` no MySQL 8, `SQL_Latin1_General_CP1_CI_AS` no SQL Server, com o `_ci`/`CI` indicando case-insensitive) se aplicam às comparações em geral, não só ao `LIKE`. A mesma consulta pode se comportar diferente só por rodar contra outro banco, ou contra uma coluna com outra collation.
- **Um curinga no fim pode usar um índice; um no início não pode, e a correção para isso não é igualmente boa em todo lugar.** `LIKE 'foo%'` pode usar um índice B-tree padrão como leitura de intervalo de prefixo nos três bancos. `LIKE '%foo'` não pode: o banco não tem como buscar "termina com foo" em uma B-tree, então recorre à leitura de todas as linhas. O PostgreSQL tem uma correção feita sob medida: índices de trigramas do `pg_trgm` (`GIN`/`GiST`) de fato suportam busca arbitrária de substring/curinga no início. A ferramenta mais próxima do MySQL, `FULLTEXT` + `MATCH ... AGAINST`, é baseada em palavras/fronteiras, não em casamento real de substrings: mais fraca, e recomendada pela comunidade, não documentada como substituta do `LIKE`. O Full-Text Search do SQL Server *rejeita* explicitamente curingas no início (`CONTAINS('*foo')` não é válido, só `'foo*'` é); não há resposta nativa boa baseada em índice lá, e os contornos do mundo real são uma coluna computada invertida mais um índice, ou um motor de busca externo.
- **`COALESCE` é portável; os atalhos de cada fornecedor não são só apelidos.** O `ISNULL(a, b)` do SQL Server sempre recebe só dois argumentos (diferente dos N do `COALESCE`), infere o tipo de retorno apenas pelo *primeiro* argumento (o que pode truncar um valor em silêncio se o tipo desse argumento for mais estreito que o do segundo) e é tratado como não anulável, enquanto o `COALESCE` segue as regras comuns de precedência de tipos e continua anulável se algum argumento for. Três comportamentos diferentes escondidos atrás do que parece ser uma simples troca de nome.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 1, "Retrieving Records", receitas 1.11-1.13, p. 11-13: doc
- [PostgreSQL Documentation: Pattern Matching (LIKE, ILIKE)](https://www.postgresql.org/docs/current/functions-matching.html): doc
- [PostgreSQL Documentation: pg_trgm (trigram indexes for fast substring search)](https://www.postgresql.org/docs/current/pgtrgm.html): doc
- [MySQL Reference Manual: Collation and default collations](https://dev.mysql.com/doc/refman/8.0/en/charset-collate.html): doc
- [SQL Server Documentation: ISNULL (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/isnull-transact-sql): doc
- [PostgreSQL/ISO SQL: COALESCE](https://www.postgresql.org/docs/current/functions-conditional.html): doc
