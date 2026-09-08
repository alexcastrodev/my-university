---
version: 1.0
updatedAt: 2026-08-05
title: "Aritmética de Data: Deslocando Datas e Medindo Intervalos"
summary: Adicionando intervalos a datas e medindo a distância entre duas datas em dias, meses, anos, ou unidades menores que um dia; e por que o SQL Server conta fronteiras de calendário onde PostgreSQL e MySQL truncam unidades decorridas.
---
## Objective

Aritmética de data tem exatamente dois verbos: **deslocar** uma data por um intervalo (me dê cinco dias, cinco meses, cinco anos a partir dessa data) e **medir** o intervalo entre duas datas em uma granularidade escolhida (quantos dias, meses, anos, horas, segundos de distância essas datas estão?). Deslocar é a metade fácil: todo motor concorda que adicionar um mês a `2024-03-31` deveria pousar em `2024-04-30`, não `2024-05-01`. Medir é onde os motores genuinamente discordam, porque "quantos meses de distância" não é uma subtração: um mês não é um número fixo de dias, então cada fornecedor precisou escolher uma regra para períodos parciais, e escolheram regras diferentes. O PostgreSQL retorna um `interval` exato e deixa você decidir como arredondá-lo; o `TIMESTAMPDIFF` do MySQL trunca em direção a zero; o `DATEDIFF` do SQL Server conta **fronteiras de calendário cruzadas**, que não é nenhuma das outras duas e é a fonte mais comum de bugs de data por um erro de um em produção.

## Use Cases

- Calcular uma data de vencimento, expiração, ou janela de retentativa N dias/meses a partir de um timestamp conhecido: termos de fatura, renovação de assinatura, expiração de token.
- Calcular a idade de alguém ou o tempo de casa de um funcionário em anos completos, onde "o aniversário já passou?" é a pergunta inteira.
- Medir tempo de SLA ou de resposta em horas e minutos entre dois timestamps: ticket aberto vs. ticket resolvido, pedido feito vs. enviado.
- Agrupar linhas por tempo decorrido (0-30 dias, 31-60, 61+) em um relatório de envelhecimento, onde os limites do bucket dependem da regra de contagem escolhida.
- Construir uma coluna de coorte de "meses desde o cadastro", onde uma regra de truncamento e uma regra de cruzamento de fronteira produzem coortes diferentes para o mesmo dado.

## Deep Dive

### Adicionando e subtraindo dias, meses, e anos

O exemplo do livro pega a `hiredate` de CLARK de `09-JUN-2006` e produz seis datas deslocadas. Todo motor consegue fazer isso; nenhum deles escreve do mesmo jeito.

**PostgreSQL**: operadores aritméticos mais um literal `interval`. Aspas simples em torno do valor do intervalo são exigidas (essa é a grafia padrão ISO):

```sql
select hiredate - interval '5 day'   as hd_minus_5d,
       hiredate + interval '5 day'   as hd_plus_5d,
       hiredate - interval '5 month' as hd_minus_5m,
       hiredate + interval '5 month' as hd_plus_5m,
       hiredate - interval '5 year'  as hd_minus_5y,
       hiredate + interval '5 year'  as hd_plus_5y
  from emp
 where deptno = 10;
```

Note uma mudança de tipo que o livro não se detém: `date + integer` continua `date` (`date '2001-09-28' + 7` → `2001-10-05`), mas `date + interval` **promove para `timestamp`** (`date '2001-09-28' + interval '1 hour'` → `2001-09-28 01:00:00`). Se uma comparação a jusante espera um `date`, faça o cast de volta.

O PostgreSQL 18 adicionou formas de função nomeada, `date_add(timestamptz, interval [, tz])` e `date_subtract(...)`. As formas de dois argumentos são exatamente equivalentes a `+` e `-`; o terceiro argumento é o interessante, porque resolve transições de horário de verão em uma zona nomeada em vez da `TimeZone` da sessão:

```sql
-- crosses the Europe/Warsaw DST boundary correctly
select date_add('2021-10-31 00:00:00+02'::timestamptz,
                '1 day'::interval,
                'Europe/Warsaw');   -- 2021-10-31 23:00:00+00, not 22:00
```

**MySQL**: mesma palavra-chave `INTERVAL`, mas o valor é **sem aspas** para intervalos numéricos simples (o MySQL desvia do padrão aqui). Aspas voltam para unidades compostas como `DAY_SECOND`:

```sql
select hiredate - interval 5 day   as hd_minus_5d,
       hiredate + interval 5 month as hd_plus_5m,
       hiredate + interval 5 year  as hd_plus_5y
  from emp
 where deptno = 10;

-- function form, identical semantics
select date_add(hiredate, interval 5 month),
       date_sub(hiredate, interval 5 month)
  from emp;

-- composite interval: quotes required
select date_add('2100-12-31 23:59:59', interval '1 1:1:1' day_second);
```

**SQL Server**: sem operadores, só `DATEADD(datepart, number, date)`. O `datepart` é uma palavra-chave pura, não uma string: `DATEADD('month', 5, hiredate)` é um erro de sintaxe.

```sql
select dateadd(day,   -5, hiredate) as hd_minus_5d,
       dateadd(month, -5, hiredate) as hd_minus_5m,
       dateadd(year,   5, hiredate) as hd_plus_5y
  from emp
 where deptno = 10;
```

A única regra que os três compartilham é o **clamping de fim de mês**. Adicionar um mês nunca rola para o mês seguinte:

```sql
-- PostgreSQL
select date '2024-03-31' + interval '1 month';   -- 2024-04-30
-- MySQL
select date_add('2024-03-31', interval 1 month); -- 2024-04-30
-- SQL Server
select dateadd(month, 1, '2024-03-31');          -- 2024-04-30
```

O que significa que aritmética de mês **não é reversível**: `2024-03-31 + 1 month - 1 month` dá `2024-03-30`, não `2024-03-31`, em todo motor. Nunca faça ida e volta com uma data através de adição de mês e espere pousar de volta onde começou.

### Dias entre duas datas

O formato do livro (duas views inline puxando as `hiredate` de WARD e ALLEN, unidas por produto cartesiano porque as duas são garantidamente de uma linha só) ainda está bom, mas a própria subtração é onde os motores se dividem.

O **PostgreSQL** subtrai datas diretamente e recebe de volta um `integer` puro:

```sql
select ward_hd - allen_hd as days
  from (select hiredate as ward_hd  from emp where ename = 'WARD')  x,
       (select hiredate as allen_hd from emp where ename = 'ALLEN') y;
```

Mas `date - date` → `integer` só vale para o tipo `date`. Subtraia dois `timestamp`s e você recebe um `interval`, não um número:

```sql
select timestamp '2001-09-29 03:00' - timestamp '2001-07-27 12:00';
-- interval: 63 days 15:00:00     <- not the integer 63
```

Essa distinção morde quando uma coluna silenciosamente muda de `date` para `timestamp` em uma migração: a consulta continua parseando, mas uma comparação como `... - ... > 30` agora compara um intervalo com um inteiro e dá erro, ou pior, um cast a jusante muda o arredondamento.

O **MySQL**: `DATEDIFF(expr1, expr2)` retorna `expr1 - expr2` em dias, e **usa só as partes de data**, descartando o horário por completo:

```sql
select datediff('2007-12-31 23:59:59', '2007-12-30');  -- 1
```

Um segundo a menos de dois dias completos, e ainda assim reporta `1`, porque está contando meias-noites, não períodos de 24 horas. Note que a ordem do argumento é data-mais-recente-primeiro: o oposto do SQL Server.

O **SQL Server**: `DATEDIFF(day, startdate, enddate)`, data inicial primeiro:

```sql
select datediff(day, allen_hd, ward_hd) as days
  from (select max(case when ename = 'WARD'  then hiredate end) as ward_hd,
               max(case when ename = 'ALLEN' then hiredate end) as allen_hd
          from emp) x;
```

Mesmo comportamento de contagem de meia-noite: `datediff(day, '2024-01-01 23:59', '2024-01-02 00:01')` é `1`, para dois minutos de tempo decorrido.

### Meses e anos entre duas datas: não é uma subtração

O próprio exemplo do livro é o aviso: a `hiredate` mais antiga em `EMP` é `17-DEC-1980`, a mais recente `12-JAN-1983`. Subtraia os anos e você recebe 3. A distância real é cerca de 25 meses: um pouco mais de 2 anos. Qualquer que seja a regra que você use precisa tratar esse período parcial deliberadamente.

**O `DATEDIFF` do SQL Server conta fronteiras de calendário cruzadas, não unidades decorridas.** Esse é o comportamento documentado, ao pé da letra: "retorna a contagem (como um valor inteiro com sinal) das fronteiras do datepart especificado cruzadas entre o startdate e enddate especificados." Dois instantes adjacentes a um décimo de microssegundo de distância retornam `1` para todo datepart, porque cruzam toda fronteira ao mesmo tempo:

```sql
select datediff(year,  '2005-12-31 23:59:59.9999999', '2006-01-01 00:00:00.0000000'); -- 1
select datediff(month, '2005-12-31 23:59:59.9999999', '2006-01-01 00:00:00.0000000'); -- 1
select datediff(day,   '2005-12-31 23:59:59.9999999', '2006-01-01 00:00:00.0000000'); -- 1
```

Aplicado a idade, esse é o bug de produção clássico:

```sql
-- born 2000-06-15, today is 2024-06-14: the birthday has NOT happened yet
select datediff(year, '2000-06-15', '2024-06-14');  -- 24  (WRONG as an age)
```

Retorna 24 porque 24 fronteiras de 1º de janeiro foram cruzadas. A pessoa tem 23. A correção padrão subtrai um quando o aniversário ainda não chegou:

```sql
select datediff(year, @dob, @today)
     - case when dateadd(year, datediff(year, @dob, @today), @dob) > @today
            then 1 else 0 end as age_in_whole_years;
```

**O `TIMESTAMPDIFF(unit, from, to)` do MySQL trunca em direção a zero**, então acerta a idade de graça. Cuidado com a ordem do argumento: ele retorna `datetime_expr2 - datetime_expr1`, o inverso do `DATEDIFF` no mesmo dialeto.

```sql
select timestampdiff(year,  '2000-06-15', '2024-06-14');  -- 23  (correct age)
select timestampdiff(month, '1980-12-17', '1983-01-12');  -- 24
select timestampdiff(month, '2003-02-01', '2003-05-01');  -- 3
```

O livro antecede recorrer a isso: sua solução DB2/MySQL calcula na mão a partir de partes de `YEAR()` e `MONTH()`, que reproduz a semântica de contagem de fronteira do SQL Server em vez de truncamento:

```sql
-- book's arithmetic: (1983-1980)*12 + (1 - 12) = 25 -- counts month boundaries
select (year(max_hd) - year(min_hd)) * 12
     + (month(max_hd) - month(min_hd)) as mnth
  from (select min(hiredate) as min_hd, max(hiredate) as max_hd from emp) x;
```

Note que as duas respostas diferem: `25` da fórmula de fronteira, `24` do `TIMESTAMPDIFF`. Nenhuma está errada: elas respondem perguntas diferentes ("quantas fronteiras de mês" vs. "quantos meses inteiros decorreram"). Escolha uma de propósito.

**O PostgreSQL não tem `months_between`**; tem `age(timestamp, timestamp)`, que retorna um intervalo *simbólico* decomposto em anos, meses, e dias em vez de uma contagem de dia plana:

```sql
select age(timestamp '2001-04-10', timestamp '1957-06-13');
-- 43 years 9 mons 27 days
```

A partir daí, extraia o que você precisa:

```sql
select extract(year from age(max_hd, min_hd)) * 12
     + extract(month from age(max_hd, min_hd)) as months,
       extract(year from age(max_hd, min_hd))  as whole_years
  from (select min(hiredate) as min_hd, max(hiredate) as max_hd from emp) x;
-- months = 24, whole_years = 2   <- truncating, like TIMESTAMPDIFF
```

`age()` trunca do mesmo jeito que `TIMESTAMPDIFF`, então `extract(year from age(dob, now()))` é uma idade correta sem termo de correção. Uma sutileza: o componente de mês parcial usa o comprimento de mês da data **mais antiga**, então `age('2004-06-01', '2004-04-30')` é `1 mon 1 day` (abril tem 30 dias), não `1 mon 2 days`.

### Segundos, minutos, e horas entre duas datas

A abordagem do livro é "encontre os dias, depois multiplique por 24, 1440, 86400." Isso só funciona quando os dois valores são datas puras sem componente de horário, que é exatamente a suposição que sua tabela `EMP` faz, e exatamente a suposição que falha em dado de timestamp real. Duas das próprias listagens do livro nessa receita também estão danificadas por transcrição: a solução MySQL usa o `datediff(day, allen_hd, ward_hd)` de três argumentos do SQL Server (o do MySQL recebe dois), e a solução SQL Server escreve um `datediff(day, allen_hd, ward_hd, hour)` de quatro argumentos que não existe. As formas corretas:

**SQL Server**: a unidade é o *primeiro* argumento, e esse é o mecanismo inteiro; não há passo de multiplicação:

```sql
select datediff(hour,   allen_hd, ward_hd) as hr,
       datediff(minute, allen_hd, ward_hd) as mi,
       datediff(second, allen_hd, ward_hd) as sec
  from (select max(case when ename = 'WARD'  then hiredate end) as ward_hd,
               max(case when ename = 'ALLEN' then hiredate end) as allen_hd
          from emp) x;
```

Contagem de fronteira se aplica a unidades menores que um dia também: `datediff(hour, '10:59:59', '11:00:00')` é `1` para um segundo de tempo decorrido. E o `DATEDIFF` retorna um `int`, que **transborda e levanta um erro** em spans longos: os tetos documentados são aproximadamente 68 anos para `second` e pouco menos de 25 dias para `millisecond`. Use `DATEDIFF_BIG` (retorna `bigint`) sempre que a unidade for `second` ou mais fina e o span não estiver rigidamente limitado:

```sql
select datediff_big(millisecond, '1970-01-01', sysdatetime());
```

**MySQL**: `TIMESTAMPDIFF` de novo, e diferente do `DATEDIFF`, ele *de fato* respeita o componente de horário:

```sql
select timestampdiff(hour,   t_open, t_closed) as hr,
       timestampdiff(minute, t_open, t_closed) as mi,
       timestampdiff(second, t_open, t_closed) as sec
  from tickets;

select timestampdiff(minute, '2003-02-01', '2003-05-01 12:05:55');  -- 128885
```

**PostgreSQL**: subtraia os timestamps para receber um `interval`, depois puxe os segundos totais com `extract(epoch from ...)` e divida. `epoch` em um intervalo é os segundos **totais** do intervalo, então isso é exato, não contado por fronteira:

```sql
select extract(epoch from (t_closed - t_open))          as sec,
       extract(epoch from (t_closed - t_open)) / 60     as mi,
       extract(epoch from (t_closed - t_open)) / 3600   as hr
  from tickets;
```

Isso produz horas fracionárias (`2.5` para duas horas e meia), que geralmente é o que um relatório de SLA de fato quer; `floor()` ou `trunc()` se você precisar de unidades inteiras. Se as colunas são `date`, não `timestamp`, a subtração dá uma contagem de dia inteira em vez disso e a multiplicação `* 24 / * 1440 / * 86400` do livro é o movimento certo: faça cast para `timestamp` primeiro se você quiser resolução menor que um dia:

```sql
select extract(epoch from (hiredate2::timestamp - hiredate1::timestamp)) / 3600 as hr;
```

Para apresentação em vez de cálculo, `justify_hours()` e `justify_interval()` normalizam um intervalo em unidades legíveis (`justify_hours(interval '50 hours 10 minutes')` → `2 days 02:10:00`): útil em saída, nunca em uma comparação, já que a justificação presume dias de 24 horas e meses de 30 dias.

## Trade-offs

- **Contagem de fronteira vs. truncamento é uma escolha semântica, não um detalhe de implementação.** O `DATEDIFF` do SQL Server conta fronteiras de calendário cruzadas; o `TIMESTAMPDIFF` do MySQL e o `age()` do PostgreSQL truncam unidades inteiras decorridas. Portar uma consulta entre eles por busca-e-substituição mecânica muda a resposta, silenciosamente, e geralmente só para linhas perto de uma fronteira, o que significa que passa em todo teste escrito com datas redondas.
  ```sql
  -- same question, two engines, different answers
  -- SQL Server: datediff(year, '2000-06-15', '2024-06-14')      -> 24
  -- MySQL:      timestampdiff(year, '2000-06-15', '2024-06-14') -> 23
  ```
- **"Dias entre" quase nunca significa períodos de 24 horas.** O `DATEDIFF` do MySQL descarta partes de horário completamente e o `DATEDIFF(day, ...)` do SQL Server conta meias-noites; só o `timestamp - timestamp` do PostgreSQL te dá tempo decorrido verdadeiro, e devolve um `interval` em vez de um número, forçando você a dizer o que quis dizer. Qualquer que seja o motor em que você esteja, decida explicitamente se "3 dias" significa três meias-noites ou setenta e duas horas antes de escrever a comparação.
- **Aritmética de mês é lossy e não reversível em todo motor.** O clamping de fim de mês é universal e correto, mas significa que adicionar e depois subtrair um mês não retorna a data original. Qualquer agendador que avança uma data recorrente por `+ 1 month` repetido a partir do *valor computado anterior* vai fazer uma data de cobrança derivar do dia 31 permanentemente; ancore cada ocorrência à data original em vez disso.
  ```sql
  select date '2024-01-31' + interval '1 month' + interval '1 month';
  -- 2024-03-29, not 2024-03-31
  ```
- **O tipo de retorno `int` do `DATEDIFF` é um teto real, não teórico.** Contar `second` entre duas datas transborda além de aproximadamente 68 anos e `millisecond` além de 25 dias, e o SQL Server levanta um erro em vez de dar wraparound. Qualquer duração em granularidade de milissegundo sobre uma faixa ilimitada precisa de `DATEDIFF_BIG`; o `extract(epoch from ...)` do PostgreSQL retorna `numeric` e não tem penhasco comparável.
- **O padrão "dias × 24 × 1440 × 86400" do livro presume colunas `DATE` puras.** É exatamente certo para a tabela `EMP` contra a qual foi escrito e exatamente errado para dado `timestamp`/`datetime2`, onde descarta o componente de horário antes de multiplicar. Motores modernos todos oferecem uma função direta parametrizada por unidade (`DATEDIFF(hour, ...)`, `TIMESTAMPDIFF(HOUR, ...)`, `extract(epoch from ...) / 3600`): recorra a essas em vez de escalar uma contagem de dia à mão.
- **Fusos horários e horário de verão transformam "adicione um dia" em duas respostas diferentes.** Adicionar `interval '1 day'` a um `timestamptz` através de uma transição de horário de verão desloca o horário de relógio de parede; adicionar `interval '24 hours'` não desloca. O `date_add(ts, interval, 'Europe/Warsaw')` do PostgreSQL 18 existe precisamente para que você consiga nomear a zona em que o ajuste deveria ser resolvido: uma distinção que o livro, trabalhando em exemplos só de `DATE`, nunca precisa fazer.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 8, "Date Arithmetic", recipes 8.1, 8.2, 8.4, 8.5, p. 205-220] - doc
- [PostgreSQL Documentation: Date/Time Functions and Operators (interval arithmetic, age(), EXTRACT, date_add)](https://www.postgresql.org/docs/current/functions-datetime.html) - doc
- [MySQL Reference Manual: Date and Time Functions (DATE_ADD, DATEDIFF, TIMESTAMPDIFF)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) - doc
- [Microsoft Learn: DATEDIFF (Transact-SQL): datepart boundaries crossed](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql) - doc
- [Microsoft Learn: DATEADD (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/dateadd-transact-sql) - doc
- [Microsoft Learn: DATEDIFF_BIG (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-big-transact-sql) - doc
