---
version: 1.0
updatedAt: 2026-08-06
title: "Subtotais e Totais Gerais: ROLLUP, CUBE e GROUPING SETS"
summary: Produzir linhas de subtotal e de total geral junto com as linhas de detalhe em uma única consulta (ROLLUP para uma hierarquia, CUBE ou GROUPING SETS para toda combinação de colunas de agrupamento) e usar GROUPING() para distinguir um NULL de subtotal fabricado de um NULL real, com o MySQL Server ainda limitado apenas ao ROLLUP.
---
## Objective

Um `GROUP BY` colapsa as linhas em uma linha por grupo, mas um relatório normalmente quer mais que isso: os números por grupo *e* os totais em que esses números se somam, em um único conjunto de resultados. As extensões de `GROUP BY` `ROLLUP`, `CUBE` e `GROUPING SETS` produzem essas linhas extras de resumo (o padrão as chama de linhas *super-agregadas*) sem nenhum self-join ou `UNION ALL`, indo de "adicione uma linha de total geral no fim" até "me dê um subtotal para toda combinação das minhas colunas de agrupamento." Como toda linha super-agregada marca suas colunas não agrupadas com `NULL`, a última peça do quebra-cabeça é a função `GROUPING()`: a única forma confiável de distinguir "este `NULL` significa *todos os departamentos*" de "este `NULL` é um `NULL` real nos dados."

## Use Cases

- Um relatório de vendas com um subtotal por região e uma única linha de total geral no fim, produzido por uma consulta em vez de uma consulta mais um rodapé calculado na aplicação.
- Uma tabulação cruzada completa (subtotais por produto, por região, por trimestre e por toda combinação dos três) alimentando uma exportação no estilo tabela dinâmica ou um dashboard que funciona como um cubo OLAP simplificado.
- Filtrar um resultado de `ROLLUP`/`CUBE` para ficar só com as linhas de detalhe (ou só com as de subtotal), para que o código da aplicação possa renderizar as duas de forma diferente, sem adivinhar a partir de `NULL`s.
- Substituir um `UNION ALL` escrito à mão de três ou quatro consultas de agregação quase idênticas: o engine lê a tabela uma vez em vez de uma vez por ramo.

## Deep Dive

### Subtotais simples: `ROLLUP` e uma linha de total geral

Comece com a agregação comum, o total de salários por cargo:

```sql
select job, sum(sal) as sal
  from emp
 group by job;

JOB          SAL
---------  -----
ANALYST     6000
CLERK       4150
MANAGER     8275
PRESIDENT   5000
SALESMAN    5600
```

`ROLLUP(job)` adiciona mais uma linha: a agregação com `job` totalmente removido do agrupamento, ou seja, o total geral.

```sql
select job, sum(sal) as sal
  from emp
 group by rollup(job);

JOB          SAL
---------  -----
ANALYST     6000
CLERK       4150
MANAGER     8275
PRESIDENT   5000
SALESMAN    5600
           29025    -- job é NULL: a linha do ROLLUP
```

`GROUP BY ROLLUP(job)` é a grafia ISO e roda sem modificação no **PostgreSQL** (9.5+) e no **SQL Server** (2008+, nível de compatibilidade 100 ou superior). O MySQL chegou lá por outro caminho: a sintaxe histórica do MySQL é o modificador final `GROUP BY job WITH ROLLUP`, e a forma padrão `GROUP BY ROLLUP(job)` está documentada a partir do MySQL 8.4; o manual do 8.0 ainda mostra só `WITH ROLLUP`.

```sql
-- MySQL 8.0: só esta grafia
select job, sum(sal) as sal from emp group by job with rollup;

-- MySQL 8.4+: a grafia ISO também funciona
select job, sum(sal) as sal from emp group by rollup(job);
```

O livro rotula a linha de total com `COALESCE(job,'TOTAL')`. Isso funciona, mas é a ferramenta errada; veja a seção de `GROUPING()` abaixo para entender por quê, e para a versão que continua correta quando o próprio `job` pode ser nulo:

```sql
select case when grouping(job) = 1 then 'TOTAL' else job end as job,
       sum(sal) as sal
  from emp
 group by rollup(job);
```

Com mais de uma coluna, `ROLLUP` é *hierárquico*: ele anda da direita para a esquerda, removendo uma coluna por vez. `ROLLUP(deptno, job)` produz exatamente três grouping sets: `(deptno, job)`, `(deptno)`, `()`, ou seja, nove linhas de detalhe, três subtotais por departamento, um total geral. Deliberadamente **não** há subtotal só por `job`; a ordem das colunas tem significado, e é isso que faz do `ROLLUP` a escolha certa para uma hierarquia de verdade (ano > trimestre > mês, região > território).

### Todas as combinações de uma vez: `CUBE`, e `GROUPING SETS` quando você quer controle

Quando as colunas não formam uma hierarquia (`deptno` e `job` são dimensões independentes), você quer o conjunto potência completo. Isso é o `CUBE`:

```sql
select deptno, job, sum(sal) as sal
  from emp
 group by cube(deptno, job);
```

`CUBE(deptno, job)` se expande nos grouping sets `(deptno, job)`, `(deptno)`, `(job)`, `()`: 2^n conjuntos para n colunas. Nove linhas de detalhe, três subtotais por departamento, cinco subtotais por cargo, um total geral: dezoito linhas a partir de uma leitura.

`GROUPING SETS` é o mesmo mecanismo com a expansão escrita à mão, o que o torna a ferramenta precisa em vez da ferramenta bruta:

```sql
-- idêntico a CUBE(deptno, job)
 group by grouping sets ((deptno, job), (deptno), (job), ());

-- o mesmo, sem o total geral
 group by grouping sets ((deptno, job), (deptno), (job));

-- subtotais só por cargo: sem rollup por departamento, mas mantendo o total geral
 group by grouping sets ((deptno, job), (job), ());
```

`ROLLUP` e `CUBE` são, formalmente, nada mais que abreviações para listas específicas de `GROUPING SETS`. Recorra a `GROUPING SETS` no momento em que quiser um relatório que não seja exatamente "hierarquia" ou "tudo."

> O PostgreSQL 14+ também aceita `GROUP BY DISTINCT ROLLUP(a, b), ROLLUP(a, c)`, que colapsa grouping sets que a expansão emitiria duas vezes. O `GROUP BY DISTINCT` do SQL Server é restrito a listas simples de colunas: não pode ser combinado com `GROUPING SETS`, `ROLLUP` ou `CUBE`, e grouping sets duplicados lá realmente produzem linhas duplicadas (`GROUP BY ((), CUBE(a,b))` retorna duas linhas de total geral).

**É aqui que o MySQL ainda genuinamente não consegue acompanhar, e isso não é um artefato da época do livro.** O manual de referência do MySQL 9.7 documenta exatamente um modificador de `GROUP BY`: `ROLLUP`. Não há `CUBE` nem `GROUPING SETS` no MySQL Server, hoje. A única exceção estreita é o serviço gerenciado **MySQL HeatWave**, em que `CUBE` é documentado como "Available in MySQL HeatWave only" e `GROUPING SETS` como "Available as of MySQL 9.6.0 only on MySQL HeatWave", e mesmo lá uma consulta com `GROUPING SETS` dá erro a menos que os dados estejam de fato carregados no cluster HeatWave. No MySQL padrão, o recurso alternativo do livro continua sendo a resposta: um `GROUP BY` por grouping set, costurados com `UNION ALL`.

```sql
-- MySQL Server: a consulta CUBE escrita por extenso
  select deptno, job, 'TOTAL BY DEPT AND JOB' as category, sum(sal) as sal
    from emp group by deptno, job
   union all
  select null, job, 'TOTAL BY JOB', sum(sal)   from emp group by job
   union all
  select deptno, null, 'TOTAL BY DEPT', sum(sal) from emp group by deptno
   union all
  select null, null, 'GRAND TOTAL FOR TABLE', sum(sal) from emp;
```

Quatro ramos significam quatro passadas sobre `emp`, contra uma para o `CUBE`: o custo de portabilidade aqui é trabalho real, não só digitação a mais. Note também que o `WITH ROLLUP` do MySQL cobre bem o caso *hierárquico*, então um relatório simples de "subtotais mais total geral" é portável entre os três engines; só o caso de todas as combinações força a reescrita com `UNION ALL`.

### Distinguindo linhas de subtotal de linhas de detalhe: `GROUPING()`

Toda linha super-agregada carrega `NULL` nas colunas que foram removidas. O mesmo vale para qualquer linha de detalhe cuja coluna de agrupamento é genuinamente `NULL` nos dados. `GROUPING(col)` desfaz a ambiguidade: retorna `1` quando o `NULL` em `col` foi fabricado por `ROLLUP`/`CUBE`/`GROUPING SETS`, e `0` caso contrário.

```sql
select deptno, job, sum(sal) as sal,
       grouping(deptno) as deptno_subtotal,
       grouping(job)    as job_subtotal
  from emp
 group by cube(deptno, job)
 order by 4, 5;

DEPTNO JOB           SAL DEPTNO_SUBTOTAL JOB_SUBTOTAL
------ --------- ------- --------------- ------------
    10 CLERK        1300               0            0   -- detalhe
    10 MANAGER      2450               0            0   -- detalhe
    ...
    10              8750               0            1   -- subtotal por DEPTNO
    20             10875               0            1
    30              9400               0            1
       CLERK        4150               1            0   -- subtotal por JOB
       ANALYST      6000               1            0
       ...
                   29025               1            1   -- total geral
```

Esse par de flags é exatamente o que "identificar as linhas que não são subtotais" precisa: as linhas de detalhe são aquelas em que toda flag é `0`:

```sql
-- só as linhas de detalhe de um resultado CUBE
select deptno, job, sum(sal) as sal
  from emp
 group by cube(deptno, job)
having grouping(deptno) = 0
   and grouping(job) = 0;
```

Precisa ser `HAVING`, nunca `WHERE`. As linhas super-agregadas ainda não existem quando o `WHERE` roda; o manual do MySQL declara a restrição sem rodeios: *"você só pode testá-los como valores NULL na lista do select ou na cláusula HAVING. Não pode testá-los como valores NULL em condições de join nem na cláusula WHERE."* A mesma ordem vale no PostgreSQL e no SQL Server.

Para rotular, as duas flags se combinam em uma máscara de bits, com o argumento mais à esquerda como o bit mais significativo. O **PostgreSQL** e o **MySQL** sobrecarregam o próprio `GROUPING()` para aceitar uma lista de colunas:

```sql
select deptno, job,
       case grouping(deptno, job)
            when 0 then 'TOTAL BY DEPT AND JOB'
            when 1 then 'TOTAL BY DEPT'        -- job foi agregado
            when 2 then 'TOTAL BY JOB'         -- deptno foi agregado
            when 3 then 'GRAND TOTAL FOR TABLE'
       end as category,
       sum(sal) as sal
  from emp
 group by cube(deptno, job)
 order by grouping(job), grouping(deptno);
```

O **SQL Server** separa as duas coisas: `GROUPING()` aceita exatamente uma coluna, e a máscara de bits de várias colunas é uma função separada, `GROUPING_ID()`:

```sql
select deptno, job,
       case grouping_id(deptno, job)
            when 0 then 'TOTAL BY DEPT AND JOB'
            when 1 then 'TOTAL BY DEPT'
            when 2 then 'TOTAL BY JOB'
            when 3 then 'GRAND TOTAL FOR TABLE'
       end as category,
       sum(sal) as sal
  from emp
 group by cube(deptno, job);
```

De qualquer forma, a concatenação de strings `CAST(grouping(x) AS CHAR(1)) || ...` por fornecedor do livro (`||` no Oracle, `+` no SQL Server, `concat()` no PostgreSQL) está obsoleta. A máscara de bits é um inteiro; compare-a como um.

Mais duas coisas que o livro antecede. O MySQL, que o texto de 2020 descreve como sem suporte a `CUBE` nem a `GROUPING`, tem `GROUPING()` desde o **MySQL 8.0.1** (e o permite no `ORDER BY` desde o 8.0.12), então o contorno com `COALESCE` que o livro prescreve para o MySQL não é mais necessário:

```sql
-- MySQL 8.0.1+
select case when grouping(job) = 1 then 'TOTAL' else job end as job,
       sum(sal) as sal
  from emp
 group by job with rollup;
```

E no SQL Server, a sintaxe `GROUP BY deptno, job WITH CUBE` que o livro usa agora é explicitamente marcada pela Microsoft como não compatível com ISO e mantida "apenas por compatibilidade retroativa"; código novo deveria usar `GROUP BY CUBE(deptno, job)`.

## Trade-offs

- **`ROLLUP` é linear, `CUBE` é exponencial, e os engines impõem um teto.** `ROLLUP` sobre n colunas gera n+1 grouping sets; `CUBE` gera 2^n. O SQL Server limita uma cláusula `ROLLUP`/`CUBE`/`GROUPING SETS` a 32 expressões e a **4.096 grouping sets no total**, então `CUBE(a1, ..., a13)` falha de cara com 8.192 conjuntos. Fazer o cubo de "só mais uma dimensão" dobra tanto o trabalho quanto a quantidade de linhas; `GROUPING SETS` com as poucas combinações que alguém vai de fato ler normalmente é a resposta melhor.
- **A ausência de `CUBE`/`GROUPING SETS` no MySQL é uma lacuna de portabilidade viva, não uma nota de rodapé histórica.** Seis anos depois do livro, o MySQL Server 9.7 ainda documenta `ROLLUP` como seu único modificador de `GROUP BY`; `CUBE` e (a partir do 9.6.0) `GROUPING SETS` existem apenas no serviço gerenciado HeatWave. Qualquer relatório de todas as combinações que precise rodar no MySQL padrão precisa da reescrita com `UNION ALL`, com uma leitura da tabela por ramo em vez de uma para a consulta inteira.
- **`COALESCE` para rotular linhas de total é um bug esperando por uma coluna que aceita nulo.** `COALESCE(job,'TOTAL')` não consegue distinguir a linha do `ROLLUP` de um funcionário cujo `job` é genuinamente `NULL`; os dois recebem o rótulo `TOTAL`, e os salários dele são lidos como um total que não é. `GROUPING(job) = 1` é o único teste que responde a pergunta que de fato está sendo feita.
  ```sql
  -- mente se alguma linha de emp tiver job IS NULL
  select coalesce(job,'TOTAL') as job, sum(sal) from emp group by rollup(job);
  ```
- **`GROUPING()` vive em `SELECT`/`HAVING`/`ORDER BY` e em nenhum outro lugar.** As linhas super-agregadas são materializadas depois que o `WHERE` já rodou, então filtrá-las exige `HAVING` (ou envolver a consulta inteira em uma tabela derivada). Recorrer a `WHERE job IS NOT NULL` para descartar as linhas de total não expressa a intenção e ainda remove em silêncio linhas de detalhe legítimas.
- **A máscara de bits de várias colunas tem outra grafia no SQL Server.** O PostgreSQL e o MySQL deixam `GROUPING(a, b)` retornar uma máscara combinada; o `GROUPING()` do T-SQL é estritamente de uma coluna, e a máscara fica em `GROUPING_ID()`. O teste de uma coluna `GROUPING(col) = 1` é portável entre os três; o `CASE` sobre uma máscara não é, e precisa da edição de uma palavra por engine.
- **Um conjunto de resultados agora mistura duas granularidades, e o código que vem depois precisa se importar com isso.** Um resultado de `ROLLUP` deixa de ser uma relação limpa de linhas comparáveis: reagregá-lo, fazer join com ele ou jogá-lo em um gráfico sem filtrar por `GROUPING()` conta cada valor em dobro. O `GROUP BY` também não impõe ordem, então o layout de "total geral no fim" só acontece se você escrever o `ORDER BY` (tipicamente `ORDER BY GROUPING(...)`) que o coloca lá.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 12, "Reporting and Reshaping", receitas 12.12, 12.13, 12.14, p. 397-412: doc
- [PostgreSQL Documentation: GROUPING SETS, CUBE, and ROLLUP](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUPING-SETS): doc
- [MySQL Reference Manual: GROUP BY Modifiers (WITH ROLLUP, GROUPING())](https://dev.mysql.com/doc/refman/8.4/en/group-by-modifiers.html): doc
- [MySQL HeatWave User Guide: GROUP BY Modifiers (CUBE and GROUPING SETS, HeatWave only)](https://dev.mysql.com/doc/heatwave/en/mys-hw-group-by-modifiers.html): doc
- [Microsoft Learn: GROUP BY (Transact-SQL): ROLLUP, CUBE, GROUPING SETS](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-group-by-transact-sql): doc
