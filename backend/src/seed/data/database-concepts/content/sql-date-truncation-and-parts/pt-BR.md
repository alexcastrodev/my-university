---
version: 1.0
updatedAt: 2026-08-05
title: "Truncamento de Data e Partes de Data"
summary: Decompondo uma data em status de ano bissexto, dias no ano, unidades individuais de tempo, e limites de mês; e onde EOMONTH, LAST_DAY, e DATETRUNC substituíram a aritmética manual.
---
## Objective

Quase todo relatório baseado em data é construído a partir de quatro primitivas: *esse ano é bissexto*, *quantos dias esse ano tem*, *qual é o ano/mês/hora desse timestamp*, e *onde esse mês começa e termina*. Nenhuma delas é difícil, mas nenhuma é portável também: cada motor as escreve com uma função diferente, e a resposta correta mais curta em um fornecedor é uma subconsulta aninhada em três níveis em outro. Este conceito decompõe uma data nessas peças cientes de calendário e mostra quais das técnicas manuais do livro foram desde então substituídas por um embutido dedicado.

## Use Cases

- Validar que uma data de nascimento ou data efetiva não pousa em 29 de fevereiro em um ano que não tem 29 de fevereiro: uma checagem de data construída que se comporta diferentemente (erro vs. `NULL`) em todo motor.
- Calcular uma taxa diária ou anualizada onde o denominador é dias-no-ano: 365 na maioria dos anos, 366 em um ano bissexto, e errar isso silenciosamente distorce toda cifra de juros, provisão, ou run-rate em ~0,27%.
- Gerar limites de início e fim de mês para um período de relatório: ciclos de faturamento, rollups mensais, snapshots de "no fim do mês".
- Extrair só o ano, mês, ou hora de um timestamp para dar `GROUP BY` nele, sem arrastar a precisão completa do timestamp para a chave de agrupamento.
- Agrupar timestamps de evento em períodos de calendário (`date_trunc`, `DATETRUNC`) para que uma série temporal possa ser agregada por dia/mês sem formatação de string.

## Deep Dive

### Testando ano bissexto

A técnica do livro é elegante e neutra de fornecedor em espírito: construa fevereiro do ano alvo, peça seu último dia, e checa se é o 29. As implementações divergem enormemente. Oracle e MySQL conseguem em uma chamada de função; PostgreSQL, no livro, precisa de `generate_series` para enumerar fevereiro e pegar um `MAX`; DB2 precisa de um `WITH` recursivo.

Hoje, o PostgreSQL não precisa da enumeração: `date_trunc` mais aritmética de intervalo chega diretamente ao último dia de fevereiro:

```sql
-- PostgreSQL: last day of February for the current year
select extract(day from
         date_trunc('year', current_date) + interval '2 month' - interval '1 day'
       ) = 29 as is_leap_year;
```

O MySQL mantém a solução `LAST_DAY()` do livro, mas sem a estrutura tripla de `DATE_ADD` usada para chegar a 1º de fevereiro:

```sql
-- MySQL
select day(last_day(concat(year(curdate()), '-02-01'))) = 29 as is_leap_year;
```

O SQL Server ganhou `EOMONTH()` em 2012 e `DATEFROMPARTS()` no mesmo release, que juntos substituem o truque de concatenação de string do livro por completo:

```sql
-- SQL Server 2012+
select case when day(eomonth(datefromparts(year(getdate()), 2, 1))) = 29
            then 1 else 0 end as is_leap_year;
```

**Uma correção à solução SQL Server do livro.** O livro escreve:

```sql
select coalesce(day(cast(concat(year(getdate()), '-02-29') as date)), 28);
```

com a explicação de que se o ano não for bissexto, "não existe a data 2019-02-29 … vai retornar NULL." Não é isso que o SQL Server faz. Um `CAST` simples de uma string de data inválida levanta `Msg 241, Conversion failed when converting date and/or time from character string`: a instrução falha, e `COALESCE` nunca roda. A versão que se comporta como descrito precisa de `TRY_CAST` (também SQL Server 2012), que é precisamente a função que retorna `NULL` em vez de dar erro em uma conversão falha:

```sql
select coalesce(day(try_cast(concat(year(getdate()), '-02-29') as date)), 28);
```

E a versão genuinamente portável não constrói nenhuma data de todo: só faz aritmética modular no ano, que é a regra de ano bissexto ao pé da letra e roda sem modificação nos três motores:

```sql
-- PostgreSQL / MySQL / SQL Server, unchanged
select (y % 4 = 0 and y % 100 <> 0) or y % 400 = 0 as is_leap_year
  from (select 2100 as y) t;   -- 2100 is NOT a leap year: divisible by 100, not by 400
```

A regra do século é a parte que o truque de "checar fevereiro" acerta de graça e checagens de `% 4` feitas à mão erram: 1900 e 2100 não são anos bissextos, 2000 é.

### Contando os dias em um ano

O livro constrói isso diretamente sobre a ideia de ano bissexto: o número de dias em um ano é o primeiro dia do próximo ano menos o primeiro dia deste. Isso ainda funciona em todo lugar, e no PostgreSQL a subtração de data produz uma contagem de dia inteira diretamente:

```sql
-- PostgreSQL: date - date returns integer days
select (date_trunc('year', current_date) + interval '1 year')::date
     -  date_trunc('year', current_date)::date as days_in_year;
```

```sql
-- MySQL
select datediff(curr_year + interval 1 year, curr_year) as days_in_year
  from (select makedate(year(curdate()), 1) as curr_year) x;
```

```sql
-- SQL Server
select datediff(day, curr_year, dateadd(year, 1, curr_year)) as days_in_year
  from (select datefromparts(year(getdate()), 1, 1) as curr_year) x;
```

Há uma formulação mais curta que o livro não usa: o dia-do-ano de 31 de dezembro *é* o número de dias no ano, então uma única extração responde a pergunta sem nenhuma subtração de data:

```sql
select extract(doy from make_date(extract(year from current_date)::int, 12, 31));  -- PostgreSQL
select dayofyear(concat(year(curdate()), '-12-31'));                               -- MySQL
select datepart(dayofyear, datefromparts(year(getdate()), 12, 31));                -- SQL Server
```

As duas formas retornam 365 ou 366. Qual você prefere é majoritariamente gosto; a forma de subtração generaliza para "dias entre quaisquer dois aniversários", a forma de dia-do-ano é uma única chamada de função.

### Extraindo unidades de tempo

O próprio enquadramento do livro aqui se sustentou: "a maioria dos fornecedores agora adotou a função padrão ANSI para extrair partes de datas, `EXTRACT`, embora o SQL Server seja uma exceção." Isso ainda é exatamente verdadeiro em 2026: o T-SQL não tem `EXTRACT`, e `DATEPART` continua sendo o caminho.

```sql
-- PostgreSQL and MySQL: ANSI EXTRACT
select extract(year   from current_timestamp) as yr,
       extract(month  from current_timestamp) as mth,
       extract(day    from current_timestamp) as dy,
       extract(hour   from current_timestamp) as hr,
       extract(minute from current_timestamp) as min,
       extract(second from current_timestamp) as sec;
```

```sql
-- SQL Server: DATEPART, plus the YEAR/MONTH/DAY shorthands
select datepart(year,   getdate()) as yr,
       datepart(month,  getdate()) as mth,
       datepart(day,    getdate()) as dy,
       datepart(hour,   getdate()) as hr,
       datepart(minute, getdate()) as min,
       datepart(second, getdate()) as sec;
```

Duas coisas que vale a pena saber que as soluções `TO_CHAR`/`DATE_FORMAT` do livro desviam:

**O PostgreSQL mudou o tipo de retorno do `EXTRACT` na versão 14.** Costumava retornar `double precision`; agora retorna `numeric`, o que remove os problemas de perda de precisão que costumavam atingir `extract(epoch from ...)` em valores grandes. O comportamento antigo ainda é alcançável através do `date_part()`, que é a mesma operação sob um nome da era Ingres e ainda retorna `double precision`:

```sql
select pg_typeof(extract(year from current_date));   -- numeric   (PG 14+)
select pg_typeof(date_part('year', current_date));   -- double precision
```

O PG 14 também fez `EXTRACT` em um `date` *dar erro* para campos só de horário em vez de silenciosamente retornar zero.

**O `EXTRACT` do MySQL aceita unidades compostas** que nenhum outro motor tem: `YEAR_MONTH`, `DAY_MINUTE`, e afins: que empacotam múltiplos campos em um único número:

```sql
select extract(year_month from '2019-07-02 01:02:03');  -- 201907
select extract(day_minute from '2019-07-02 01:02:03');  -- 20102
```

Conveniente, e completamente não portável. O livro usa `DATE_FORMAT` para MySQL (`'%k'`, `'%i'`, `'%s'`, …), que retorna *strings*, não números: o objetivo declarado da receita é "resultados retornados como números", e `EXTRACT` entrega isso diretamente sem um cast de envolvimento.

Para agrupamento, prefira truncamento em vez de extração quando você quiser uma chave de período em vez de um componente escalar: `date_trunc` (PostgreSQL) e `DATETRUNC` (SQL Server 2022+) mantêm o resultado como uma data/timestamp, então ordena e faz faixa corretamente:

```sql
select date_trunc('month', order_date) as mth, sum(amount)   -- PostgreSQL
  from orders group by 1 order by 1;

select datetrunc(month, order_date) as mth, sum(amount)      -- SQL Server 2022+
  from orders group by datetrunc(month, order_date) order by 1;
```

Agrupar em `extract(year …), extract(month …)` te dá duas colunas inteiras que precisam ser remontadas e só ordenam corretamente se você listar as duas na ordem certa; uma data truncada é uma coluna que já ordena cronologicamente.

### Primeiro e último dia de um mês

Aqui é onde a aritmética manual do livro envelheceu mais. Sua solução SQL Server é o exemplo mais claro:

```sql
-- the book's SQL Server last-day-of-month
select dateadd(day,
               -day(dateadd(month, 1, getdate())),
               dateadd(month, 1, getdate())) as lastday;
```

Desde o SQL Server 2012, essa expressão inteira é uma chamada de função, com um offset de mês opcional embutido:

```sql
select eomonth(getdate())      as lastday,      -- end of this month
       eomonth(getdate(), -1)  as prev_lastday, -- end of last month
       eomonth(getdate(),  1)  as next_lastday; -- end of next month
```

E desde o SQL Server 2022, o primeiro dia é `DATETRUNC` em vez da dança `DATEADD(day, -DAY(...) + 1, ...)`:

```sql
select datetrunc(month, getdate()) as firstday,   -- 2022 (16.x)+
       eomonth(getdate())          as lastday;    -- 2012 (11.x)+
```

O `LAST_DAY()` do MySQL é o que o livro já usa e continua sendo a resposta certa; só a metade do primeiro dia vale a pena simplificar:

```sql
select curdate() - interval (day(curdate()) - 1) day as firstday,
       last_day(curdate())                           as lastday;
```

O PostgreSQL é a exceção: ele **não tem** embutido de último-dia-do-mês, então o `date_trunc` + `interval '1 month' - interval '1 day'` do livro ainda é a forma idiomática, e não há nada mais novo para substituí-lo:

```sql
select firstday,
       (firstday + interval '1 month' - interval '1 day')::date as lastday
  from (select date_trunc('month', current_date)::date as firstday) x;
```

**Use esses limites como uma faixa semi-aberta, não um `BETWEEN`.** `EOMONTH` retorna um `date` (meia-noite no último dia), então filtrar uma coluna `datetime2` com `BETWEEN firstday AND eomonth(...)` silenciosamente descarta toda linha com timestamp depois de 00:00:00 no dia 31. A mesma armadilha se aplica aos valores de último dia do PostgreSQL e MySQL contra uma coluna `timestamp`/`DATETIME`:

```sql
-- WRONG for timestamp columns: loses most of the last day
where order_ts between datetrunc(month, @d) and eomonth(@d)

-- RIGHT: half-open interval, no last-day calculation needed at all
where order_ts >= datetrunc(month, @d)
  and order_ts <  dateadd(month, 1, datetrunc(month, @d))
```

Note que a versão correta não precisa de nenhuma função de último dia de todo: o problema de "limites de mês" muitas vezes se dissolve em "primeiro dia deste mês, primeiro dia do próximo mês", que todo motor computa com truncamento mais um adicional de intervalo.

## Trade-offs

- **Um embutido dedicado ganha da aritmética, mas muda o tipo de retorno.** `EOMONTH()` colapsa a expressão T-SQL de quatro funções do livro em uma chamada, e retorna `date`: o componente de horário da entrada se foi. O `LAST_DAY` do Oracle preserva o horário; o `EOMONTH` do SQL Server não. Se o código ao redor compara contra uma coluna `datetime2`, essa diferença é a diferença entre um filtro correto e um silenciosamente truncado.
  ```sql
  select eomonth(cast('2024-02-05 13:45:00' as datetime2));  -- 2024-02-29 (a date, 00:00:00)
  ```
- **`EXTRACT` é a grafia ANSI e ainda não é universal.** PostgreSQL e MySQL ambos a implementam; o SQL Server nunca a teve e ainda não tem, então qualquer consulta feita para rodar nos três precisa de `DATEPART` no ramo T-SQL. A observação do livro sobre esse ponto não envelheceu em seis anos, e não há sinal de que vá envelhecer.
- **O PostgreSQL 14 mudou o tipo de retorno do `EXTRACT` de `double precision` para `numeric`.** Isso é uma mudança de comportamento real, não um ajuste de documentação: código que alimentava `extract(epoch from …)` em colunas do tipo float, ou dependia de semântica de divisão de ponto flutuante a jusante, se comporta diferentemente através da fronteira de upgrade. `date_part()` é a válvula de escape que mantém o tipo antigo.
  ```sql
  select pg_typeof(extract(epoch from now()));      -- numeric on PG 14+, float8 before
  ```
- **Construir uma data a partir de uma string é a metade frágil do truque de ano bissexto, e todo motor falha nisso diferentemente.** O `CAST` do SQL Server levanta Msg 241 e aborta a instrução; `TRY_CAST` retorna `NULL`; o MySQL retorna `NULL` com um aviso; o PostgreSQL levanta um erro de "date field value out of range". A receita SQL Server do livro presume o comportamento de `NULL` de um `CAST` simples e está errada nesse ponto. Prefira `DATEFROMPARTS`/`MAKEDATE`/`make_date` quando as partes são conhecidamente válidas, e aritmética modular quando a pergunta é de fato "esse ano é bissexto."
- **Limites de mês computados como `primeiro…último` convidam um bug de `BETWEEN` que a forma semi-aberta não pode ter.** Um valor de último dia é meia-noite naquele dia, então `BETWEEN` contra qualquer coluna carregando um componente de horário descarta até 24 horas de dado sem nenhum erro e nenhum aviso. Computar "primeiro dia do próximo mês" em vez de "último dia deste mês" é tanto menos código quanto imune ao problema.
- **Truncamento e extração não são intercambiáveis para agrupamento.** `EXTRACT` retorna um número puro que perde a qual ano um mês pertence a menos que você também agrupe por ano; `date_trunc`/`DATETRUNC` retorna uma data/timestamp de verdade que ordena cronologicamente e faz join contra uma tabela de calendário. Recorra à extração quando você quiser um componente escalar, truncamento quando você quiser uma chave de período.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 9, "Date Manipulation", recipes 9.1, 9.2, 9.3, 9.4, p. 240-255] - doc
- [PostgreSQL Documentation: Date/Time Functions and Operators (EXTRACT, date_trunc, make_date)](https://www.postgresql.org/docs/current/functions-datetime.html) - doc
- [MySQL Reference Manual: Date and Time Functions (EXTRACT, LAST_DAY, DAYOFYEAR)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) - doc
- [Microsoft Learn: DATEPART (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql) - doc
- [Microsoft Learn: EOMONTH (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/eomonth-transact-sql) - doc
