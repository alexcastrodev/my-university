---
version: 1.0
updatedAt: 2026-07-31
title: "Empilhando Conjuntos de Linhas: UNION, UNION ALL e a Família Ampliada de Operadores de Conjunto"
summary: Como UNION ALL empilha conjuntos de linhas verticalmente e UNION faz o mesmo deduplicando (ao custo de uma ordenação), por que as regras de quantidade e compatibilidade de tipos das colunas são idênticas no PostgreSQL, MySQL e SQL Server, e como o MySQL 8.0.31 (2022) fechou sua antiga lacuna de INTERSECT/EXCEPT, enquanto o SQL Server ainda não tem a variante ALL para nenhum dos dois.
---
## Objective

Combinar dois SELECTs verticalmente, empilhando um conjunto de linhas diretamente sobre outro em vez de juntá-los lado a lado, é uma das quatro operações de conjunto do SQL. `UNION ALL` e `UNION` são as ferramentas do dia a dia; `INTERSECT` e `EXCEPT` completam a família para perguntas do tipo "o que há em comum" e "o que é diferente". Os quatro se comportam de forma quase idêntica no PostgreSQL, no MySQL e no SQL Server hoje, mas isso não era verdade até 2022.

## Use Cases

- Combinar linhas de tabelas estruturalmente diferentes em um único relatório, por exemplo nomes de funcionários e nomes de departamentos em uma única coluna de "diretório", como no próprio exemplo do livro.
- Juntar em uma única consulta os resultados de um UNION de tabelas semelhantes (uma tabela de arquivo mais uma tabela ativa, ou tabelas de mesmo formato particionadas por região ou tenant).
- Construir um relatório de "linhas alteradas" ou "linhas faltando" entre dois conjuntos de dados sem escrever um join: `INTERSECT`/`EXCEPT` dizem diretamente o que uma subconsulta correlacionada ou um anti-join teriam que soletrar.
- Deduplicar a combinação de duas consultas como efeito colateral do `UNION`, em vez de adicionar um `DISTINCT` explícito.

## Deep Dive

### Empilhando conjuntos de linhas com UNION ALL

```sql
select ename as ename_and_dname, deptno
  from emp
 where deptno = 10
union all
select dname, deptno
  from dept;
```

`UNION ALL` acrescenta as linhas da segunda consulta diretamente às da primeira. Como em toda operação de conjunto, as duas listas de SELECT precisam coincidir em **número de colunas** e ter **tipos de dados compatíveis** coluna a coluna: essa regra é idêntica no PostgreSQL, no MySQL e no SQL Server, e cada engine rejeita uma consulta com formato divergente em tempo de parse, em vez de truncá-la ou preenchê-la silenciosamente. Os nomes das colunas do resultado vêm do primeiro SELECT.

### UNION deduplica, e paga por isso com uma ordenação ou hash

```sql
select deptno from emp
union
select deptno from dept;
```

`UNION` é `UNION ALL` mais eliminação de duplicatas, o equivalente a envolver o resultado do `UNION ALL` em um `SELECT DISTINCT` externo:

```sql
select distinct deptno
  from (
        select deptno from emp
        union all
        select deptno from dept
       ) combined;
```

Remover duplicatas não é de graça: o engine precisa ordenar ou fazer hash de todo o conjunto combinado para encontrá-las, nos três bancos. `UNION ALL` pula esse passo por completo. A regra prática que o livro declara com clareza continua valendo hoje: não recorra a `UNION` (ou `DISTINCT`) a menos que duplicatas sejam de fato possíveis e de fato indesejadas; use `UNION ALL` por padrão.

### A família ampliada: INTERSECT e EXCEPT

`INTERSECT` retorna as linhas comuns às duas consultas; `EXCEPT` retorna as linhas que estão na primeira consulta mas não na segunda. Os dois aplicam as mesmas regras de quantidade e tipo de colunas do `UNION`, e os dois deduplicam por padrão:

```sql
-- linhas presentes em EMP e em V (a alternativa com INTERSECT da receita 3.3 a um join de várias colunas)
select ename, job, sal from emp
intersect
select ename, job, sal from v;

-- departamentos sem funcionários (receita 3.4)
select deptno from dept
except
select deptno from emp;
```

> O Oracle usa um vocabulário diferente para o mesmo operador: `MINUS` em vez de `EXCEPT`. É a mesma semântica de diferença de conjuntos com outro nome, um lembrete de que "o operador do padrão SQL" e "o operador que todo fornecedor escreve do mesmo jeito" não são a mesma afirmação.

### A atualização do MySQL em 2022: INTERSECT e EXCEPT não existiam antes do 8.0.31

Este é o único ponto em que as próprias soluções do livro para MySQL revelam a idade. A receita 3.3 dá ao MySQL um `JOIN` de várias colunas como a *única* forma de encontrar linhas em comum, e a receita 3.4 dá a ele uma subconsulta `NOT IN` como a *única* forma de encontrar uma diferença de conjuntos, explicitamente porque, em 2020, o MySQL não tinha `INTERSECT` nem `EXCEPT`. Essa lacuna fechou no **MySQL 8.0.31 (GA em 2022-10-11)**, que adicionou os dois operadores com os mesmos modificadores `[ALL | DISTINCT]` que o `UNION` já tinha:

```sql
-- MySQL 8.0.31+: não precisa mais do contorno com join/subconsulta
select ename, job, sal from emp
intersect
select ename, job, sal from v;

table dept except table emp;   -- o MySQL também aceita a sintaxe enxuta TABLE t
```

Os padrões de join/subconsulta do livro não estão errados hoje (continuam funcionando), mas já não são a *única* opção, e código ou tutoriais de MySQL escritos antes do fim de 2022 que se apoiam nesses padrões devem ser lidos como "escrito para um MySQL que não conseguia fazer isso de outro jeito", e não como uma escolha de estilo.

### A lacuna que resta no SQL Server: sem variante ALL para EXCEPT/INTERSECT

Enquanto o PostgreSQL e o MySQL moderno suportam `INTERSECT ALL` e `EXCEPT ALL` (mantendo a multiplicidade das linhas em vez de colapsar para linhas distintas), a sintaxe de `EXCEPT`/`INTERSECT` do SQL Server **não tem a palavra-chave `ALL`**: só o `UNION` ganha a escolha entre `ALL` e sem `ALL` no T-SQL. Precisar de "diferença de conjuntos mantendo duplicatas conforme a multiplicidade" no SQL Server significa implementar à mão (tipicamente com `ROW_NUMBER()` particionado por valor, comparado entre os dois lados), uma lacuna de portabilidade real e ainda atual entre o SQL Server e os outros dois.

### Precedência: a única coisa em que os três concordam

`INTERSECT` tem precedência maior que `UNION`/`EXCEPT` no PostgreSQL, no MySQL e no SQL Server: `a UNION b INTERSECT c` é sempre `a UNION (b INTERSECT c)` nos três. `UNION` e `EXCEPT` em si são avaliados da esquerda para a direita. É um caso raro em que os três engines concordam exatamente, mas ainda vale colocar parênteses explícitos em consultas que misturam operações de conjunto: depender de regras de precedência decoradas em uma consulta de quatro linhas é o tipo de coisa que parece errada para a próxima pessoa mesmo quando é avaliada corretamente.

## Trade-offs

- **`UNION ALL` deveria ser o padrão; `UNION` é uma escolha deliberada e com custo.** O passo de deduplicação é uma ordenação ou hash real sobre todo o resultado combinado em todos os engines: recorra a `UNION` apenas quando duplicatas forem de fato possíveis nos dados e de fato indesejadas na saída.
- **Divergências na lista de colunas falham de forma barulhenta, não silenciosa, em todo lugar.** Quantidade de colunas errada ou tipos incompatíveis entre os dois SELECTs é um erro em tempo de parse no PostgreSQL, no MySQL e no SQL Server: não existe fornecedor em que uma divergência de formato seja preenchida ou convertida em algo que retorna dados errados em silêncio.
- **A lacuna de `INTERSECT`/`EXCEPT` do MySQL está fechada, mas só desde outubro de 2022 (8.0.31).** Código, tutoriais e, notavelmente, as próprias soluções de MySQL deste livro anteriores a essa versão recorrem a joins e subconsultas `NOT IN` não por preferência, mas porque não havia operador para usar; não leia esses contornos como o idioma moderno.
- **A ausência de `EXCEPT ALL`/`INTERSECT ALL` no SQL Server é a única lacuna real de funcionalidade que ainda resta.** O PostgreSQL e o MySQL atual suportam nativamente diferença e interseção de conjuntos preservando multiplicidade; o SQL Server exige um contorno feito à mão com `ROW_NUMBER()` para o mesmo resultado. Isso não é uma questão de livro contra os dias de hoje, é apenas uma limitação real e atual do T-SQL.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 3, "Working with Multiple Tables", receita 3.1 "Stacking One Rowset atop Another", p. 29-31: doc
- [PostgreSQL Documentation: Combining Queries (UNION, INTERSECT, EXCEPT)](https://www.postgresql.org/docs/current/queries-union.html): doc
- [MySQL Reference Manual: UNION Clause](https://dev.mysql.com/doc/refman/8.0/en/union.html): doc
- [MySQL Reference Manual: Set Operations (INTERSECT, EXCEPT, since 8.0.31)](https://dev.mysql.com/doc/refman/8.0/en/set-operations.html): doc
- [SQL Server Documentation: Set Operators: UNION (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql): doc
