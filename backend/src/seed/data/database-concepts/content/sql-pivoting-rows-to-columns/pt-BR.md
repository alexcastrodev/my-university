---
version: 1.0
updatedAt: 2026-08-06
title: Pivotando Linhas em Colunas
summary: Remodelar linhas agrupadas em colunas com a técnica portável de CASE dentro de uma agregação, e ver onde o operador PIVOT do SQL Server e o crosstab() do PostgreSQL realmente ajudam.
---
## Objective

Pivotar é a operação de pegar valores que vivem *descendo* uma coluna (uma linha por departamento, por trimestre, por cargo) e transformá-los em colunas *ao longo* de uma única linha. É a forma que todo relatório no estilo planilha quer e a forma que quase nenhuma tabela normalizada guarda. A técnica portável é a agregação condicional: uma expressão `CASE` dentro de uma função de agregação age como um filtro por coluna, e a agregação colapsa as linhas esparsas resultantes em linhas densas. Os fornecedores oferecem sintaxe nativa (o SQL Server tem um operador `PIVOT`, o PostgreSQL tem `crosstab()` por trás da extensão `tablefunc`, o MySQL não tem nada), mas nenhuma delas remove a restrição fundamental que torna tudo isso desajeitado (você precisa nomear as colunas de saída no momento de compilar a consulta), então a forma portável `CASE`+agregação normalmente é o padrão certo.

## Use Cases

- Um relatório de vendas por trimestre: uma linha por ano, com `Q1`/`Q2`/`Q3`/`Q4` como colunas em vez de quatro linhas por ano.
- Um resumo de headcount: uma linha por departamento, com uma coluna para a contagem de cada cargo, a tabulação cruzada clássica.
- Remodelar uma tabela EAV / chave-valor (`entity`, `attribute`, `value`) de volta em um resultado largo, com uma coluna por atributo, para exibição.
- Qualquer transformação de "longo para largo" alimentando um dashboard, uma exportação CSV ou uma biblioteca de gráficos que espera uma série por coluna.

## Deep Dive

### Pivotando em uma linha por grupo

Comece pela agregação não pivotada, o número de funcionários por departamento:

```sql
select deptno, count(*) as cnt
  from emp
 group by deptno;

 DEPTNO   CNT
 ------ -----
     10     3
     20     5
     30     6
```

O alvo é uma linha com três colunas. A mecânica é uma expressão `CASE` que emite `1` para o departamento a que pertence e `0` caso contrário, envolvida em `SUM`:

```sql
select sum(case when deptno = 10 then 1 else 0 end) as deptno_10,
       sum(case when deptno = 20 then 1 else 0 end) as deptno_20,
       sum(case when deptno = 30 then 1 else 0 end) as deptno_30
  from emp;

 DEPTNO_10  DEPTNO_20  DEPTNO_30
 ---------  ---------  ---------
         3          5          6
```

Tirar a agregação torna visível o passo de "linhas para colunas" por si só: cada `CASE` é uma flag dizendo a qual coluna a linha pertence:

```sql
select deptno,
       case when deptno = 10 then 1 else 0 end as deptno_10,
       case when deptno = 20 then 1 else 0 end as deptno_20,
       case when deptno = 30 then 1 else 0 end as deptno_30
  from emp
 order by 1;

 DEPTNO  DEPTNO_10  DEPTNO_20  DEPTNO_30
 ------  ---------  ---------  ---------
     10          1          0          0
     10          1          0          0
     ...
     30          0          0          1
```

Nesse ponto a transposição já está feita; o `SUM` só colapsa a coluna de flags em um único número. Recolocar `group by deptno` produz uma matriz diagonal (a contagem do departamento 10 em `deptno_10`, zeros no resto); tirar o `GROUP BY` por completo é o que funde a diagonal em uma linha.

Há uma segunda forma que vale conhecer, porque ela generaliza melhor: agregue primeiro em uma view inline e depois use `MAX ... else null` só para tirar os `NULL`s do caminho.

```sql
select max(case when deptno = 10 then empcount else null end) as deptno_10,
       max(case when deptno = 20 then empcount else null end) as deptno_20,
       max(case when deptno = 30 then empcount else null end) as deptno_30
  from (
        select deptno, count(*) as empcount
          from emp
         group by deptno
       ) x;
```

Aqui `MIN` funcionaria igualmente bem: com exatamente um valor não `NULL` por grupo, a escolha da agregação é arbitrária. Essa ideia de "agregação como removedora de `NULL`" é o truque essencial do caso de várias linhas abaixo.

O PostgreSQL (9.4+) oferece uma grafia mais limpa da mesma coisa via a cláusula `FILTER` do padrão SQL, que tira a condição da expressão de valor e a coloca na própria agregação:

```sql
-- PostgreSQL: FILTER (WHERE ...) em vez de CASE dentro da agregação
select count(*) filter (where deptno = 10) as deptno_10,
       count(*) filter (where deptno = 20) as deptno_20,
       count(*) filter (where deptno = 30) as deptno_30
  from emp;
```

`FILTER` é SQL padrão, mas não é amplamente implementado: o PostgreSQL e o SQLite o têm; o MySQL e o SQL Server não, então `CASE` dentro da agregação continua sendo a grafia portável.

**O operador `PIVOT` nativo do SQL Server.** O T-SQL é o único engine convencional com um operador relacional dedicado para isso. Ele fica na cláusula `FROM` e recebe uma agregação e um `FOR <coluna> IN (<lista de valores>)`:

```sql
select 'headcount' as metric, [10], [20], [30]
  from (
        select deptno, empno
          from emp
       ) as src
 pivot (
        count(empno) for deptno in ([10], [20], [30])
       ) as pvt;
```

Note o que é `IN ([10], [20], [30])`: a mesma lista fixa de valores das três expressões `CASE`, só escrita uma vez em vez de três. `PIVOT` é açúcar sintático sobre a agregação condicional, não uma operação mais capaz; a própria documentação da Microsoft o apresenta exatamente assim ("mais fácil e mais legível que... uma série complexa de instruções `SELECT...CASE`"). Dois comportamentos a ter em mente: qualquer coluna não nomeada na subconsulta ou na cláusula `PIVOT` vira um agrupamento implícito, e é por isso que o `select deptno, empno` inline é deliberadamente estreito; e `NULL`s na coluna de valor são ignorados pela agregação.

**O `crosstab()` do PostgreSQL.** O PostgreSQL não tem a palavra-chave `PIVOT`. Em vez disso, ele traz uma função que retorna conjuntos, `crosstab()`, no módulo contrib `tablefunc`:

```sql
create extension tablefunc;   -- extensão confiável: não precisa de superusuário

select *
  from crosstab(
         'select ''headcount''::text, deptno, count(*)::int
            from emp
           group by deptno
           order by 1, 2',
         'select unnest(array[10, 20, 30])'
       ) as ct(metric text, deptno_10 int, deptno_20 int, deptno_30 int);
```

A forma com dois argumentos recebe uma consulta de *origem* que retorna `row_name, category, value` (nessa ordem, ordenada por `1`) e uma consulta de *categorias* listando as colunas. A lista de colunas de saída ainda precisa ser escrita por extenso na cláusula `AS ct(...)`: a função retorna `setof record`, então o PostgreSQL não consegue inferir a forma. O SQL é passado como **literal de string**, o que significa nenhum reaproveitamento de plano, nenhum binding de parâmetros, e erros que aparecem em tempo de execução em vez de em tempo de parse. Para três colunas, a versão com `CASE`/`FILTER` é claramente melhor; o `crosstab()` se justifica principalmente quando a consulta de categorias faz um trabalho real (um `generate_series(1,12)` para meses, por exemplo) e quando a entrada é realmente esparsa.

O **MySQL** não tem equivalente a nenhum dos dois. A agregação condicional é a única opção, tanto no 8.x quanto no 9.x.

### Pivotando em um número fixo de linhas

A técnica anterior colapsa tudo em uma linha, o que é exatamente o errado quando os valores pivotados não são agregações, mas uma lista. Considere dispor os funcionários sob uma coluna por cargo:

```
CLERKS  ANALYSTS  MGRS    PREZ  SALES
------  --------  -----   ----  ------
MILLER  FORD      CLARK   KING  TURNER
JAMES   SCOTT     BLAKE         MARTIN
ADAMS             JONES         WARD
SMITH                           ALLEN
```

Recorrer à técnica de uma linha aqui falha, e falha em silêncio:

```sql
select max(case when job = 'CLERK'     then ename else null end) as clerks,
       max(case when job = 'ANALYST'   then ename else null end) as analysts,
       max(case when job = 'MANAGER'   then ename else null end) as mgrs,
       max(case when job = 'PRESIDENT' then ename else null end) as prez,
       max(case when job = 'SALESMAN'  then ename else null end) as sales
  from emp;

 CLERKS  ANALYSTS  MGRS   PREZ  SALES
 ------  --------  -----  ----  -----
 SMITH   SCOTT     JONES  KING  WARD
```

Uma linha, e treze dos catorze funcionários sumiram em silêncio. O `MAX` fez seu trabalho; o problema é que "seu trabalho" era escolher um único nome por coluna, quando o que se queria era "remover os `NULL`s sem descartar nada."

A correção é dar à agregação algo pelo qual agrupar que torne cada par `JOB`/`ENAME` único. `ROW_NUMBER()` particionado pela coluna pivô fornece exatamente isso:

```sql
select job,
       ename,
       row_number() over (partition by job order by ename) as rn
  from emp;

 JOB        ENAME    RN
 ---------  ------   --
 ANALYST    FORD      1
 ANALYST    SCOTT     2
 CLERK      ADAMS     1
 CLERK      JAMES     2
 CLERK      MILLER    3
 CLERK      SMITH     4
 MANAGER    BLAKE     1
 ...
```

`rn` é a linha de saída a que um valor pertence; o `CASE` escolhe a coluna de saída. Agrupe por `rn` e cada `MAX` agora vê exatamente um valor não `NULL` por grupo, então ele remove `NULL`s em vez de descartar dados:

```sql
select max(case when job = 'CLERK'     then ename else null end) as clerks,
       max(case when job = 'ANALYST'   then ename else null end) as analysts,
       max(case when job = 'MANAGER'   then ename else null end) as mgrs,
       max(case when job = 'PRESIDENT' then ename else null end) as prez,
       max(case when job = 'SALESMAN'  then ename else null end) as sales
  from (
        select job,
               ename,
               row_number() over (partition by job order by ename) as rn
          from emp
       ) x
 group by rn;

 CLERKS  ANALYSTS  MGRS   PREZ  SALES
 ------  --------  -----  ----  ------
 MILLER  FORD      CLARK  KING  TURNER
 JAMES   SCOTT     BLAKE        MARTIN
 ADAMS             JONES        WARD
 SMITH                          ALLEN
```

A quantidade de linhas da saída é o tamanho da maior partição: quatro, porque `CLERK` e `SALESMAN` têm quatro membros cada. Usar `MIN` em vez de `MAX` dá um resultado idêntico; com um valor por grupo, a escolha é arbitrária.

A forma bem mais comum deste problema é uma chave de agrupamento real em vez de um número de linha sintético: um relatório de vendas com uma linha por ano e uma coluna por trimestre. Aí o `GROUP BY` é a própria chave e nenhuma window function é necessária:

```sql
select extract(year from order_date) as yr,
       sum(case when extract(quarter from order_date) = 1 then amount else 0 end) as q1,
       sum(case when extract(quarter from order_date) = 2 then amount else 0 end) as q2,
       sum(case when extract(quarter from order_date) = 3 then amount else 0 end) as q3,
       sum(case when extract(quarter from order_date) = 4 then amount else 0 end) as q4
  from orders
 group by extract(year from order_date)
 order by yr;
```

É a mesma receita de uma linha com um `GROUP BY` recolocado: a coluna de agrupamento decide quantas linhas saem, e as expressões `CASE` decidem as colunas. O `PIVOT` do SQL Server também expressa esta variante nativamente, já que qualquer coluna deixada na subconsulta e não consumida pela cláusula `PIVOT` vira uma coluna de agrupamento implícita:

```sql
select yr, [1] as q1, [2] as q2, [3] as q3, [4] as q4
  from (
        select year(order_date) as yr,
               datepart(quarter, order_date) as qtr,
               amount
          from orders
       ) as src
 pivot (
        sum(amount) for qtr in ([1], [2], [3], [4])
       ) as pvt
 order by yr;
```

O que o `PIVOT` não consegue fazer é o caso de `ROW_NUMBER()` acima: pivotar uma *lista* de valores em vez de uma agregação deles. Ali, o `ROW_NUMBER()` ainda precisa ser calculado na consulta interna antes que o `PIVOT` possa agrupar por ele, e a essa altura a forma com agregação condicional deixa de ser significativamente mais longa.

## Trade-offs

- **A lista de colunas precisa ser conhecida quando a consulta é escrita.** Toda técnica aqui (`CASE`, `FILTER`, `PIVOT`, `crosstab()`) exige enumerar literalmente os valores do pivot. A forma do resultado no SQL é fixada em tempo de parse, então uma consulta não consegue ganhar uma coluna porque um novo departamento apareceu. Produzir um pivot realmente dinâmico significa gerar o texto SQL (na aplicação, ou em SQL dinâmico com `sp_executesql`) e prepará-lo de novo, com todas as consequências de injeção e de cache de planos que isso implica.
- **`PIVOT` é açúcar exclusivo do SQL Server, não capacidade extra.** Ele compila para a mesma agregação condicional e ainda precisa da lista literal `IN (...)`, então adotá-lo compra legibilidade ao custo de portabilidade. Ele também tem bordas silenciosas: colunas não listadas na subconsulta de origem viram chaves implícitas de `GROUP BY`, então um `select *` perdido na consulta interna muda em silêncio o agrupamento e, portanto, os resultados.
- **`crosstab()` custa uma extensão e abre mão da verificação estática.** Ele precisa de `CREATE EXTENSION tablefunc`, o que é uma decisão de implantação em um Postgres gerenciado, e recebe sua consulta como literal de string: sem binding de parâmetros, sem reaproveitamento de plano, erros de sintaxe em tempo de execução. A lista de colunas de saída ainda precisa ser declarada na cláusula `AS ct(...)`, então ele nem compra a liberdade de não nomear as colunas.
- **Pivots largos escalam mal em texto de consulta e em custo.** Doze meses, cinquenta estados ou cem SKUs de produto significam essa mesma quantidade de expressões `CASE` na lista do select, cada uma avaliada por linha de entrada. Passada uma certa largura, o pivot normalmente sai mais barato na aplicação ou na camada de relatórios, e o SQL fica impossível de revisar muito antes de ficar lento.
- **`MAX`/`MIN` como removedores de `NULL` descartam dados em silêncio se a chave de agrupamento estiver errada.** O modo de falha na receita de várias linhas retorna uma única linha de aparência plausível em vez de um erro: a consulta é válida, só falta a maior parte dos dados. Qualquer pivot que não esteja agregando uma medida real precisa de uma chave de agrupamento que torne cada célula única, e vale verificar que a quantidade de linhas da saída coincide com a maior partição em vez de confiar nela.
- **`SUM(CASE ... else 0)` e `MAX(CASE ... else null)` produzem células vazias diferentes.** A primeira gera `0` onde nenhuma linha casou, a segunda gera `NULL`. Para um relatório de contagens, `0` está certo; para uma célula de "nenhum dado coletado", `NULL` está certo, e colapsar a distinção é um bug comum de relatórios. O `PIVOT` do SQL Server sempre gera `NULL` para células vazias, então é preciso um `COALESCE` explícito na lista do select externo para reproduzir o comportamento do `else 0`.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 12, "Reporting and Reshaping", receitas 12.1, 12.2, p. 369-377: doc
- [Microsoft Learn: Using PIVOT and UNPIVOT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-using-pivot-and-unpivot): doc
- [PostgreSQL Documentation: tablefunc (crosstab)](https://www.postgresql.org/docs/current/tablefunc.html): doc
- [PostgreSQL Documentation: Aggregate Expressions (FILTER clause)](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES): doc
