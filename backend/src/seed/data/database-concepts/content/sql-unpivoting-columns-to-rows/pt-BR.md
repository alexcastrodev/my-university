---
version: 1.0
updatedAt: 2026-08-06
title: Despivotando Colunas em Linhas
summary: Colapsar várias colunas do mesmo tipo em uma coluna de valor mais uma coluna de rótulo, o inverso de pivotar, usando UNION ALL, uma lista LATERAL + VALUES de leitura única, ou o operador nativo UNPIVOT do SQL Server.
---
## Objective

Despivotar (o livro chama de "reverse pivoting") é o inverso de [Pivoting Rows to Columns](sql-pivoting-rows-to-columns): em vez de espalhar os valores distintos de uma coluna por colunas novas, você colapsa várias colunas que significam o mesmo *tipo* de coisa (`Q1`, `Q2`, `Q3`, `Q4`; `sales_2023`, `sales_2024`; `emp1`…`emp5`) de volta para uma coluna de valor mais uma coluna de rótulo, produzindo mais linhas e menos colunas. Você precisa disso sempre que os dados de origem guardam como colunas separadas o que deveriam ser valores de linha: uma importação de planilha, uma tabela de relatório desnormalizada, uma extração larga do sistema de outra pessoa. A forma para a qual você está indo é a "longa"/"tidy": uma linha por trio (entidade, rótulo, valor), que é o que `GROUP BY`, window functions e toda biblioteca de gráficos de fato querem consumir.

## Use Cases

- Normalizar uma importação de planilha larga `Q1,Q2,Q3,Q4` em uma linha por trimestre, para que o trimestre vire um valor pelo qual você pode filtrar, agrupar e ordenar, em vez de um nome de coluna gravado no schema.
- Transformar uma tabela com uma coluna separada por ano (`revenue_2022`, `revenue_2023`, `revenue_2024`) em uma coluna `year` de verdade, para que o eixo x de um gráfico tenha algo a que se ligar e adicionar 2025 seja um `INSERT` em vez de um `ALTER TABLE`.
- Preparar dados largos para uma ferramenta que espera formato longo/tidy: ferramentas de BI, pipelines de pandas/R e bancos de séries temporais presumem uma observação por linha.
- Colapsar várias colunas de atributos de uma entidade em uma "folha de etiquetas" de uma coluna ou em uma listagem vertical para um relatório impresso: a receita 12.4 do livro, empilhando `ENAME`/`JOB`/`SAL` um sobre o outro com uma linha em branco entre funcionários.

## Deep Dive

### A técnica do livro: produto cartesiano mais CASE

O livro nem recorre a `UNION ALL`. Dado um resultado "largo" de uma linha (aqui, uma view construída a partir do pivot da receita 12.1):

```sql
create view emp_cnts as
select sum(case when deptno = 10 then 1 else 0 end) as deptno_10,
       sum(case when deptno = 20 then 1 else 0 end) as deptno_20,
       sum(case when deptno = 30 then 1 else 0 end) as deptno_30
  from emp;

-- DEPTNO_10  DEPTNO_20  DEPTNO_30
-- ---------- ---------- ----------
--          3          5          6
```

a receita multiplica essa única linha por uma expressão de tabela com pelo menos tantas linhas quanto as colunas a transpor, e então usa `CASE` para escolher a coluna certa em cada linha gerada:

```sql
select dept.deptno,
       case dept.deptno
            when 10 then emp_cnts.deptno_10
            when 20 then emp_cnts.deptno_20
            when 30 then emp_cnts.deptno_30
       end as counts_by_dept
  from emp_cnts
  cross join (select deptno from dept where deptno <= 30) dept;

-- DEPTNO  COUNTS_BY_DEPT
-- ------  --------------
--     10               3
--     20               5
--     30               6
```

Vale internalizar a mecânica porque é a mesma que todo unpivot usa sob uma sintaxe diferente: **você precisa fabricar N linhas por linha de entrada, em que N é o número de colunas sendo transpostas.** O `CROSS JOIN` é o multiplicador de linhas; o `CASE` é o seletor de colunas. Note a restrição rígida que isso implica: você precisa saber N de antemão, e a fonte de linhas com que você faz o cross join precisa ter pelo menos N linhas. Isso não é um artefato da época do livro: todo unpivot não dinâmico em todo engine ainda exige que a lista de colunas seja escrita literalmente.

A receita 12.4 é o mesmo truque levado mais longe: colapsar *todas* as colunas em uma única coluna de saída. O livro gera o multiplicador de linhas com uma CTE recursiva e numera as cópias com `ROW_NUMBER()`:

```sql
with recursive four_rows (id) as (
  select 1
  union all
  select id + 1 from four_rows where id < 4
),
x_tab (ename, job, sal, rn) as (
  select e.ename, e.job, e.sal,
         row_number() over (partition by e.empno order by e.empno)
    from emp e
    join four_rows on 1 = 1
)
select case rn
         when 1 then ename
         when 2 then job
         when 3 then cast(sal as char(4))
       end as emps
  from x_tab;
```

A quarta linha de cada funcionário não tem ramo no `CASE`, então cai em `NULL`: essa é a linha em branco separadora deliberada entre funcionários. O `CAST` em `SAL` não é opcional: o `CASE` unifica todos os seus ramos em um único tipo, então um ramo numérico ao lado de dois ramos de string é um erro de tipo, a menos que você o converta. A CTE recursiva precisa da palavra-chave `RECURSIVE` no PostgreSQL e no MySQL; o SQL Server a omite.

### UNION ALL, e a forma LATERAL + VALUES que o substitui

A grafia moderna óbvia empilha um `SELECT` por coluna de origem:

```sql
create table quarterly_sales (
  region text, q1 numeric, q2 numeric, q3 numeric, q4 numeric
);
insert into quarterly_sales values ('NORTH', 100, 120, 90, 140),
                                   ('SOUTH',  80,  95, 110, null);

select region, 'Q1' as quarter, q1 as amount from quarterly_sales
union all
select region, 'Q2', q2 from quarterly_sales
union all
select region, 'Q3', q3 from quarterly_sales
union all
select region, 'Q4', q4 from quarterly_sales
order by region, quarter;
```

Isso é correto e portável em todo lugar, mas lê a tabela base uma vez por ramo. O plano do PostgreSQL diz isso com clareza:

```
Append
  ->  Seq Scan on quarterly_sales
  ->  Seq Scan on quarterly_sales quarterly_sales_1
  ->  Seq Scan on quarterly_sales quarterly_sales_2
  ->  Seq Scan on quarterly_sales quarterly_sales_3
```

Quatro leituras para quatro colunas. Desde o PostgreSQL 9.3, `LATERAL` dá uma forma estritamente melhor: coloque o mapeamento de coluna para linha em uma lista `VALUES` inline que referencia a linha externa, e a tabela é lida uma vez.

```sql
select qs.region, v.quarter, v.amount
  from quarterly_sales qs
  cross join lateral (values ('Q1', qs.q1),
                             ('Q2', qs.q2),
                             ('Q3', qs.q3),
                             ('Q4', qs.q4)) as v(quarter, amount)
 order by qs.region, v.quarter;

-- region | quarter | amount
-- -------+---------+--------
-- NORTH  | Q1      |    100
-- NORTH  | Q2      |    120
-- NORTH  | Q3      |     90
-- NORTH  | Q4      |    140
-- SOUTH  | Q1      |     80
-- SOUTH  | Q2      |     95
-- SOUTH  | Q3      |    110
-- SOUTH  | Q4      |
```

```
Nested Loop
  ->  Seq Scan on quarterly_sales qs
  ->  Values Scan on "*VALUES*"
```

Uma leitura, uma leitura de values, e o texto da consulta lista cada coluna exatamente uma vez, em vez de repetir o `FROM`/`WHERE` inteiro por ramo. A palavra-chave `LATERAL` é obrigatória aqui: sem ela a lista `VALUES` não enxerga `qs`:

```
ERROR:  invalid reference to FROM-clause entry for table "qs"
HINT:  To reference that table, you must mark this subquery with LATERAL.
```

A mesma forma está disponível no MySQL: tabelas derivadas laterais chegaram no **MySQL 8.0.14**, e o construtor de valores de tabela se escreve `VALUES ROW(...)` lá. As duas formas abaixo rodam no MySQL 8.4:

```sql
-- MySQL 8.0.19+ : construtor de valores de tabela VALUES ROW()
select qs.region, v.quarter, v.amount
  from quarterly_sales qs
  join lateral (values row('Q1', qs.q1), row('Q2', qs.q2)) as v(quarter, amount);

-- MySQL 8.0.14+ : LATERAL sobre um UNION ALL, uma leitura de quarterly_sales
select qs.region, v.quarter, v.amount
  from quarterly_sales qs
  join lateral (          select 'Q1' as quarter, qs.q1 as amount
                union all select 'Q2', qs.q2
                union all select 'Q3', qs.q3
                union all select 'Q4', qs.q4) as v;
```

A receita 12.4 do livro também se reduz bem a essa forma: a CTE recursiva que fabricava quatro linhas vira uma lista `VALUES` de quatro elementos, e o par `ROW_NUMBER()`/`CASE` desaparece por completo:

```sql
select e.empno, v.ord, v.emps
  from emp e
  cross join lateral (values (1, e.ename),
                             (2, e.job),
                             (3, e.sal::text),
                             (4, null)) as v(ord, emps)
 where e.deptno = 10
 order by e.empno, v.ord;
```

A linha explícita `(4, null)` é o separador em branco, dito diretamente em vez de implícito em um ramo de `CASE` ausente.

### O UNPIVOT nativo do SQL Server

O SQL Server é o único dos três engines com um operador de primeira classe para isso, e o tem desde o SQL Server 2005:

```sql
select VendorID, Employee, Orders
  from ( select VendorID, Emp1, Emp2, Emp3, Emp4, Emp5 from pvt ) p
 unpivot ( Orders for Employee in (Emp1, Emp2, Emp3, Emp4, Emp5) ) as unpvt;

-- VendorID  Employee  Orders
-- --------- --------- ------
--        1  Emp1           4
--        1  Emp2           3
--        1  Emp3           5
-- ...
```

`Orders` é a *coluna de valor* (onde os valores das células caem), `Employee` é a *coluna pivô* (onde os **nomes** das colunas de origem caem), e a lista `IN (...)` é o conjunto de colunas sendo transpostas. Dois comportamentos valem ser conhecidos antes de usá-lo:

- **`UNPIVOT` descarta NULLs.** A própria documentação da Microsoft diz isso com todas as letras: "valores `NULL` na entrada do `UNPIVOT` desaparecem na saída." Uma linha cujo `Q4` é `NULL` simplesmente não produz uma linha `Q4`. As formas `UNION ALL` e `LATERAL` acima a mantêm (note `SOUTH | Q4 |` com o valor vazio na saída do PostgreSQL). Se você quer a linha preservada no SQL Server, envolva o valor em `ISNULL(...)`/`COALESCE(...)` dentro da subconsulta de origem.
- **A coluna pivô é `nvarchar(128)`.** Como ela carrega *identificadores* de coluna (tipo `sysname`), a coluna de rótulo sai como `nvarchar(128)` quer você queira, quer não; o Fabric Data Warehouse nem aceita esse tipo em um `CREATE TABLE AS`, então um `CAST` é necessário lá.

Nem o PostgreSQL nem o MySQL têm um operador `UNPIVOT`, em nenhuma versão atual. O MySQL 8.4 responde à sintaxe com um simples erro de parse:

```
ERROR 1064 (42000): You have an error in your SQL syntax; check the manual ...
near '(amount for quarter in (q1,q2)) u'
```

Também não há recurso pendente para isso no PostgreSQL: `CROSS JOIN LATERAL (VALUES ...)` é o idioma, e é o que a própria comunidade do PostgreSQL e os guias de migração indicam a quem vem do Oracle ou do SQL Server.

## Trade-offs

- **`UNION ALL` relê a origem uma vez por coluna; `LATERAL` lê uma vez.** Com quatro colunas, é uma diferença de 4× em leituras sobre os mesmos dados, e ela cresce linearmente com o número de colunas. Em uma pequena tabela de relatório desnormalizada ninguém vai notar; em uma tabela fato larga, com uma dúzia de colunas de ano e um filtro não coberto por índice, é o custo inteiro da consulta. Os planos acima mostram isso explicitamente: `Append` sobre N `Seq Scan`s contra um único `Seq Scan` alimentando um `Values Scan`.
- **Todo ramo do unpivot precisa se unificar em um único tipo de dado, e o engine não vai fazer isso por você.** A coluna de valor tem exatamente um tipo, então misturar uma coluna `text` e uma coluna `numeric` na mesma lista é um erro, não uma conversão, e é exatamente por isso que o livro escreve `cast(sal as char(4))`:
  ```sql
  -- PostgreSQL, misturando uma coluna text e uma numeric em uma lista VALUES
  cross join lateral (values ('region', qs.region), ('q1', qs.q1)) as v(attr, val)
  -- ERROR: VALUES types text and numeric cannot be matched
  ```
  Converter para texto para compilar é a correção habitual, mas significa que a coluna de valor deixa de ser ordenável ou comparável como número mais adiante.
- **O `UNPIVOT` do SQL Server descarta em silêncio entradas NULL; as formas portáveis não.** É uma diferença semântica real, não uma preferência de sintaxe: uma linha que existe em um resultado de `UNION ALL`/`LATERAL` simplesmente não está em um resultado de `UNPIVOT`. Se o código que vem depois conta linhas, faz join pela coluna de rótulo ou espera uma forma fixa de quatro linhas por região, migrar entre as duas grafias muda a resposta.
- **A lista de colunas é sempre estática, em todo engine.** Você precisa nomear no texto da consulta cada coluna sendo transposta, então adicionar um `Q5` significa editar toda consulta de unpivot que toca a tabela. Conjuntos dinâmicos de colunas exigem montar a string SQL em tempo de execução (ou, no PostgreSQL, passar por JSON: `jsonb_each` sobre `to_jsonb(t)` despivota as colunas que existirem). Essa restrição é exatamente o motivo de o pivot *direto* ser a operação que vale evitar em primeiro lugar: dados guardados no formato longo não precisam ser despivotados.
- **A técnica `CROSS JOIN` + `CASE` do livro ainda funciona em todo lugar, mas é a mais frágil das três.** Ela acopla a corretude à cardinalidade de uma tabela não relacionada (`dept` por acaso tem linhas suficientes), recria à mão o multiplicador de linhas, e um ramo `WHEN` ausente falha como um `NULL` silencioso em vez de um erro. Use `LATERAL` primeiro, `UNION ALL` quando precisar que o SQL rode em algo mais antigo, e a forma `CROSS JOIN`/`CASE` só quando estiver lendo código que já a usa.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 12, "Reporting and Reshaping", receitas 12.3, 12.4, p. 377-382: doc
- [Microsoft Learn: Using PIVOT and UNPIVOT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-using-pivot-and-unpivot): doc
- [PostgreSQL Documentation: LATERAL Subqueries](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL): doc
- [MySQL Reference Manual: Lateral Derived Tables (8.0.14+)](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html): doc
