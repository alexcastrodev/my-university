---
version: 1.0
updatedAt: 2026-08-05
title: Gerando Calendários e Limites de Trimestres
summary: Fabricar linhas de data que nenhuma tabela guarda (uma grade completa de calendário, ou as datas de início e fim de um trimestre fiscal) com generate_series, CTEs recursivas e o GENERATE_SERIES apenas numérico do SQL Server 2022.
---
## Objective

Às vezes as datas que você precisa consultar não existem em lugar nenhum do banco. Nenhuma tabela guarda "todos os dias de 2026", e nenhuma tabela guarda "os quatro limites de trimestre do ano fiscal atual", mas uma grade de calendário, um relatório diário sem lacunas ou um consolidado trimestral precisam que essas datas existam *como linhas* antes de poderem ser agrupadas, unidas por join ou pivotadas. Gerar uma série sintética de datas é a técnica para fabricar exatamente essas linhas: escolha uma data âncora, produza N valores sucessivos a partir dela e transforme cada um em um `DATE` real com que o resto da consulta possa trabalhar. Todo engine consegue fazer isso; o que muda é se o gerador de linhas é uma função embutida ou algo que você precisa montar à mão com recursão.

## Use Cases

- Renderizar uma UI de calendário de mesa (sete colunas, uma linha por semana) direto de uma única consulta, em vez de gerar a grade no código da aplicação.
- Fazer join com todas as datas de um período para que os dias *ausentes* apareçam como linhas com `0` em vez de sumirem: o padrão de detecção de lacunas que um `GROUP BY` sobre a tabela fato sozinha nunca consegue produzir.
- Construir os limites de trimestre fiscal para relatórios a partir apenas do ano, para que as datas de início e fim dos trimestres não fiquem fixas por ano em um arquivo de configuração ou em uma expressão `CASE` que precisa ser editada todo janeiro.
- Resolver uma chave de período compacta (`20263` significando "2026 T3") no intervalo de datas semiaberto real que uma cláusula `WHERE` pode usar.
- Produzir uma tabela-guia de datas para um job de backfill ou de reprocessamento, uma linha por dia a reprocessar.

## Deep Dive

### Gerando um calendário

A receita inteira tem dois passos: retornar uma linha por dia do mês e então pivotar pelo dia da semana com `MAX(CASE ...)`, agrupando pelo número da semana. O primeiro passo é onde os engines divergem.

O **PostgreSQL** tem `generate_series` como função nativa que retorna conjuntos desde muito antes de o livro ser escrito, e ela continua sendo o gerador de linhas mais limpo dos três:

```sql
select d::date
  from generate_series(date '2026-01-01', date '2026-12-31', interval '1 day') as g(d);
```

Não há sobrecarga `generate_series(date, date, interval)`: os argumentos `date` são convertidos implicitamente para `timestamp`, então a função retorna valores `timestamp`, e o cast `::date` na saída faz um trabalho real, não cosmético. Pivotado em uma grade de calendário para o mês atual:

```sql
select to_char(d, 'IW') as wk,
       max(case extract(isodow from d) when 1 then to_char(d, 'DD') end) as mo,
       max(case extract(isodow from d) when 2 then to_char(d, 'DD') end) as tu,
       max(case extract(isodow from d) when 3 then to_char(d, 'DD') end) as we,
       max(case extract(isodow from d) when 4 then to_char(d, 'DD') end) as th,
       max(case extract(isodow from d) when 5 then to_char(d, 'DD') end) as fr,
       max(case extract(isodow from d) when 6 then to_char(d, 'DD') end) as sa,
       max(case extract(isodow from d) when 7 then to_char(d, 'DD') end) as su
  from generate_series(date_trunc('month', current_date),
                       date_trunc('month', current_date) + interval '1 month' - interval '1 day',
                       interval '1 day') as g(d)
 group by wk
 order by wk;
```

```
 wk | mo | tu | we | th | fr | sa | su
----+----+----+----+----+----+----+----
 31 |    |    |    |    |    | 01 | 02
 32 | 03 | 04 | 05 | 06 | 07 | 08 | 09
 33 | 10 | 11 | 12 | 13 | 14 | 15 | 16
 ...
```

O **MySQL** é onde o livro mostra a idade com mais clareza. Em 2020, o conselho habitual era uma tabela auxiliar de pivô/números (a própria `T500` do livro), porque o MySQL não tinha nenhum gerador de linhas. O MySQL 8.0 adicionou CTEs recursivas, e hoje o próprio manual do MySQL documenta a recursão de série de datas como a forma canônica de preencher buracos de datas:

```sql
with recursive cal (dy) as (
  select date_sub(current_date, interval dayofmonth(current_date) - 1 day)
  union all
  select dy + interval 1 day
    from cal
   where dy + interval 1 day <= last_day(current_date)
)
select weekofyear(dy) as wk,
       max(case weekday(dy) when 0 then dayofmonth(dy) end) as mo,
       max(case weekday(dy) when 1 then dayofmonth(dy) end) as tu,
       max(case weekday(dy) when 2 then dayofmonth(dy) end) as we,
       max(case weekday(dy) when 3 then dayofmonth(dy) end) as th,
       max(case weekday(dy) when 4 then dayofmonth(dy) end) as fr,
       max(case weekday(dy) when 5 then dayofmonth(dy) end) as sa,
       max(case weekday(dy) when 6 then dayofmonth(dy) end) as su
  from cal
 group by wk
 order by wk;
```

A tabela auxiliar no estilo `T500` não é mais necessária para isso. Ela ainda é uma escolha legítima (veja os Trade-offs), mas não é mais a *única* opção, e código MySQL escrito antes do 8.0 que recorre a uma tabela de números deveria ser lido como "escrito para um MySQL que não tinha mais nada", e não como um design deliberado.

O **SQL Server** ganhou um `GENERATE_SERIES` nativo no SQL Server 2022 (16.x), mas leia a assinatura com cuidado, porque ela não fecha a mesma lacuna que a do PostgreSQL:

```sql
GENERATE_SERIES ( start , stop [ , step ] )
```

`start`, `stop` e `step` são `tinyint`/`smallint`/`int`/`bigint`/`decimal`/`numeric`. **Não existe sobrecarga para datas.** Ela gera números; transformar esses números em datas continua sendo com você, via `DATEADD` sobre uma âncora:

```sql
-- SQL Server 2022+ (exige nível de compatibilidade 160, ou a
-- configuração em escopo de banco ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS)
select cast(dateadd(day, value, datetrunc(month, getdate())) as date) as dy
  from generate_series(0, datediff(day, datetrunc(month, getdate()),
                                        eomonth(getdate())));
```

No SQL Server 2019 e anteriores, o `WITH` recursivo do livro continua sendo a resposta, com um acréscimo de que o livro não precisa na escala de um mês, mas que importa no momento em que você amplia o intervalo:

```sql
with cal (dy) as (
  select datetrunc(month, cast(getdate() as date))
  union all
  select dateadd(day, 1, dy)
    from cal
   where dateadd(day, 1, dy) <= eomonth(getdate())
)
select * from cal
option (maxrecursion 0);
```

### Limites de trimestre para um ano inteiro

A estrutura do livro (somar recursivamente três meses a 1º de janeiro, quatro vezes, e depois subtrair um dia para cair no fim de cada trimestre) é correta, mas faz à mão o que um gerador de séries faz de graça. Os quatro trimestres, no PostgreSQL:

```sql
select extract(quarter from q)::int                        as qtr,
       q::date                                             as q_start,
       (q + interval '3 months' - interval '1 day')::date   as q_end
  from generate_series(date_trunc('year', current_date),
                       date_trunc('year', current_date) + interval '9 months',
                       interval '3 months') as g(q);
```

```
 qtr |  q_start   |   q_end
-----+------------+------------
   1 | 2026-01-01 | 2026-03-31
   2 | 2026-04-01 | 2026-06-30
   3 | 2026-07-01 | 2026-09-30
   4 | 2026-10-01 | 2026-12-31
```

O SQL Server 2022 reduz a mesma coisa a uma série numérica mais `DATEADD`, e o `DATETRUNC`, também novo no 2022, fornece diretamente a parte de data `quarter`, em vez de exigir aritmética de meses:

```sql
declare @yr date = datetrunc(year, cast(getdate() as date));

select value + 1                                              as qtr,
       dateadd(quarter, value, @yr)                           as q_start,
       dateadd(day, -1, dateadd(quarter, value + 1, @yr))     as q_end
  from generate_series(0, 3);
```

O MySQL não tem `DATE_TRUNC`, então a âncora do ano vem de `MAKEDATE`, e as quatro linhas vêm de uma CTE de contagem trivial em vez de recursão sobre datas: gere os *ordinais*, derive as datas:

```sql
with recursive q (n) as (
  select 0
  union all
  select n + 1 from q where n < 3
)
select n + 1                                                                   as qtr,
       makedate(year(current_date), 1) + interval n quarter                    as q_start,
       makedate(year(current_date), 1) + interval (n + 1) quarter
                                       - interval 1 day                        as q_end
  from q;
```

Contar de `0..3` e mapear ordinais para datas é mais robusto que fazer a recursão sobre as próprias datas: o tipo do ramo recursivo é claramente `INT`, então não há chance de os ramos do `UNION ALL` discordarem de tipo, um modo de falha sobre o qual o livro alerta explicitamente na sua solução para PostgreSQL, em que somar um `interval` a um `date` gera um `timestamp` e quebra a CTE a menos que você faça `CAST` de volta.

### Limites de trimestre para um trimestre específico

O problema inverso: dado `20263` (ano de quatro dígitos, trimestre de um dígito), retornar o início e o fim desse trimestre. A sacada central do livro continua valendo (`yrq % 10` extrai o trimestre e a divisão inteira por 10 extrai o ano), mas o livro passa isso por `SUBSTR` e concatenação de strings para remontar uma data, o que vale abandonar. Todo engine agora tem uma função de "montar uma data a partir de partes inteiras", então toda a ida e volta por texto desaparece:

**PostgreSQL**, com `make_date(year, month, day)`:

```sql
select yrq,
       q_start,
       (q_start + interval '3 months' - interval '1 day')::date as q_end
  from (
select yrq,
       make_date(yrq / 10, (yrq % 10) * 3 - 2, 1) as q_start
  from (values (20261), (20262), (20263), (20264)) as v(yrq)
       ) x;
```

`yrq / 10` é divisão inteira sobre uma coluna `integer`, então `20263 / 10` é `2026`, e `(20263 % 10) * 3 - 2` é `7`, o primeiro mês do T3.

**SQL Server**, com `DATEFROMPARTS` mais `EOMONTH`:

```sql
select yrq,
       datefromparts(yrq / 10, (yrq % 10) * 3 - 2, 1)          as q_start,
       eomonth(datefromparts(yrq / 10, (yrq % 10) * 3, 1))     as q_end
  from (values (20261), (20262), (20263), (20264)) as v(yrq);
```

Isso é estritamente melhor que a solução T-SQL do livro, que montava a data concatenando `'2026' + '-' + '9' + '-1'` e convertendo a string para `datetime`: conversões de string para data são sensíveis a `SET DATEFORMAT` e ao idioma do login, então a mesma consulta pode resolver para uma data diferente em outra conexão. `DATEFROMPARTS` recebe inteiros e não tem nenhuma superfície de localidade.

**MySQL**, com `MAKEDATE` mais `INTERVAL ... QUARTER`, usando `DIV` para divisão inteira:

```sql
select yrq,
       makedate(yrq div 10, 1) + interval (yrq mod 10 - 1) quarter        as q_start,
       makedate(yrq div 10, 1) + interval (yrq mod 10) quarter
                               - interval 1 day                           as q_end
  from (select 20261 as yrq union all select 20262
        union all select 20263 union all select 20264) x;
```

Note que os três derivam `q_end` somando um trimestre inteiro e subtraindo um dia, nunca fixando "31 de março / 30 de junho / 30 de setembro / 31 de dezembro." Isso importa menos para trimestres que para meses (os tamanhos dos trimestres são fixos, a não ser pelos anos bissextos, que deslocam o T1 em um dia), mas o hábito é o ponto: derive o limite pela aritmética, para que anos bissextos e qualquer caso de borda futuro do calendário se resolvam sozinhos.

## Trade-offs

- **Limites de recursão são um teto real, e os dois engines que precisam de recursão têm um teto baixo.** O `MAXRECURSION` padrão do SQL Server é **100** (configurável de `0` a `32767`, em que `0` significa ilimitado); o `cte_max_recursion_depth` do MySQL tem padrão **1000**. As receitas do livro geram no máximo 31 linhas, então nenhum dos limites aparece lá, mas no momento em que você amplia a mesma consulta de um mês para um ano, o SQL Server falha de cara e reverte a instrução em vez de retornar linhas parciais.
  ```sql
  -- 365 iterações contra um limite padrão de 100: erro, nenhuma linha
  with cal (dy) as (
    select cast('2026-01-01' as date)
    union all
    select dateadd(day, 1, dy) from cal where dy < '2026-12-31'
  )
  select count(*) from cal;              -- acrescente: option (maxrecursion 0)
  ```
- **O `GENERATE_SERIES` do SQL Server 2022 diminui a distância para o PostgreSQL, mas não a elimina.** Ele é apenas numérico (não existe sobrecarga para datas), então toda série de datas ainda passa por um `DATEADD` sobre uma data âncora, e ele ainda exige nível de compatibilidade 160 do banco (ou a configuração em escopo `ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS`). Uma instância atualizada mas deixada em um nível de compatibilidade menor simplesmente informa que a função não existe.
- **A série de datas do PostgreSQL retorna `timestamp` em silêncio, não `date`.** Passar argumentos `date` resolve para a sobrecarga de `timestamp`, então os resultados carregam um componente de hora; esqueça o `::date` e você recebe timestamps à meia-noite que são comparados e unidos a uma coluna `date` por um cast implícito em toda linha. A forma com CTE recursiva tem a versão mais afiada do mesmo problema: `date + interval` gera `timestamp`, então os dois ramos do `UNION ALL` discordam de tipo e a CTE não é construída, a menos que o ramo recursivo seja convertido de volta.
  ```sql
  select pg_typeof(d) from generate_series(date '2026-01-01', date '2026-01-02',
                                           interval '1 day') as g(d);
  -- timestamp without time zone
  ```
- **Gerar datas sob demanda compra conveniência e abre mão da ajuda do otimizador.** Uma função que retorna conjuntos ou uma CTE recursiva não tem estatísticas, nem índices, e tem uma estimativa de cardinalidade padrão fixa, então uma série grande gerada e unida a uma tabela fato pode produzir um plano mal formado. Uma tabela de calendário persistida (`dim_date`) não tem glamour, mas tem estatísticas reais, pode ser indexada e, de forma decisiva, tem onde guardar os atributos que a aritmética não consegue derivar: feriados, dias úteis de negociação, um ano fiscal que não começa em janeiro, períodos de varejo 4-4-5. Derive quando o calendário for puramente aritmético; materialize no momento em que regras de negócio entram nele.
- **O truque de módulo `YYYYQ` é acoplado ao formato da entrada, sem nenhuma validação embutida.** `yrq % 10` e `yrq / 10` só estão corretos porque o ano tem exatamente quatro dígitos e o trimestre exatamente um; dê à mesma expressão um valor `YYYYMM` como `202609` e ela calcula o ano 20260, trimestre 9, mês 25, o que dá erro em alguns engines e, pior, avança em silêncio para outro ano em outros. Nada na consulta rejeita um trimestre `0`, `5` ou `9`, então uma constraint `CHECK` ou uma proteção explícita pertence a todo lugar em que essas chaves entram no sistema.
- **O pivot do calendário é lógica de apresentação vivendo em SQL, e a numeração de semanas não é portável.** `MAX(CASE ...)` agrupado por semana produz uma grade, mas cada engine numera a semana de um jeito: `IW`/`isodow` do PostgreSQL são ISO-8601 (começando na segunda), `WEEKOFYEAR`/`WEEKDAY` do MySQL seguem convenções próprias, e `datepart(week, ...)` e `DATETRUNC(week, ...)` do T-SQL se dobram ao `@@DATEFIRST` da sessão. Uma grade que renderiza corretamente em um engine pode se deslocar uma linha em outro sem nenhum erro.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 9, "Date Manipulation", receitas 9.7, 9.8, 9.9, p. 268-293: doc
- [PostgreSQL Documentation: Set Returning Functions (generate_series)](https://www.postgresql.org/docs/current/functions-srf.html): doc
- [MySQL Reference Manual: WITH (Common Table Expressions), recursive date series and cte_max_recursion_depth](https://dev.mysql.com/doc/refman/8.4/en/with.html): doc
- [Microsoft Learn: GENERATE_SERIES (Transact-SQL), SQL Server 2022+](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql): doc
