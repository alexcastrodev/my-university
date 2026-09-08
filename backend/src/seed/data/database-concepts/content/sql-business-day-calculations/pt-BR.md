---
version: 1.0
updatedAt: 2026-08-05
title: "Dias Úteis e Contagens de Dia da Semana em uma Faixa de Datas"
summary: Contando dias úteis entre duas datas e somando ocorrências de dia da semana ao longo de um ano; gerando uma linha por dia com generate_series, CTEs recursivas, ou uma tabela de números, e evitando a numeração de dia da semana dependente de sessão @@DATEFIRST do SQL Server.
---
## Objective

Duas perguntas relacionadas acabam sendo o mesmo problema vestindo chapéus diferentes: "quantos dias úteis existem entre essas duas datas?" e "quantas segundas-feiras caem nesse ano?" As duas são uma *contagem de dias correspondendo a um predicado dentro de uma faixa de data*, e as duas precisam do mesmo ingrediente faltante: uma forma de produzir uma linha por dia de calendário entre um início e um fim, para que o predicado tenha algo para filtrar. Nem `DATEDIFF` nem nenhum operador de subtração de data te dá isso; eles colapsam uma faixa para um único número e descartam os dias individuais. O livro resolve isso com uma tabela pivot física (`T500`, 500 linhas de inteiros) unida contra a faixa de data; motores modernos conseguem gerar as linhas na hora, mas cada um faz isso diferentemente, e o SQL Server sobrepõe uma armadilha de numeração de dia da semana dependente de localidade em cima disso.

## Use Cases

- Cálculos de SLA e prazo de entrega: "esse ticket vence cinco dias úteis a partir de quando foi aberto" ou "quantos dias úteis esse pedido de fato levou", onde sábado e domingo não podem contar contra o relógio.
- Relatórios de folha de pagamento, ponto, e agendamento que precisam do número de dias úteis em um período de pagamento ou mês, tipicamente excluindo tanto fins de semana quanto uma lista de feriados da empresa.
- Relatórios de equipe e capacidade que contam ocorrências de um dia da semana específico: quantos sábados caem no Q3, quantas segundas-feiras uma loja fica aberta esse ano, onde a resposta varia entre 52 e 53 dependendo do ano e do dia da semana.
- Checagem de sanidade de uma tabela dimensão de data ou tabela de calendário antes de uma carga de BI: uma contagem de dia da semana calculada independentemente por ano é uma forma barata de provar que a dimensão não tem dias faltando ou duplicados.

## Deep Dive

### Dias úteis entre duas datas

O formato do livro é dois passos: construir uma linha por dia na faixa, depois somar (`SUM`) um `CASE` que pontua cada dia com 1 ou 0. A fonte de linha é a tabela `T500`: uma tabela pivot guardando os inteiros de 1 a 500, unida sem predicado para que sua coluna `ID` se torne um offset adicionado à data mais antiga:

```sql
-- book's PostgreSQL solution, business days between JONES and BLAKE hiredates
select sum(case when trim(to_char(jones_hd+t500.id-1,'DAY'))
                  in ( 'SATURDAY','SUNDAY' )
                then 0 else 1
           end) as days
  from (
select max(case when ename = 'BLAKE' then hiredate end) as blake_hd,
       max(case when ename = 'JONES' then hiredate end) as jones_hd
  from emp
 where ename in ( 'BLAKE','JONES' )
       ) x,
       t500
 where t500.id <= blake_hd-jones_hd+1;
```

Dois detalhes ali são fáceis de passar batido. O `MAX` na view inline não é um agregado em nenhum sentido significativo; ele existe puramente para colapsar as duas linhas (`BLAKE` com um `jones_hd` `NULL`, `JONES` com um `blake_hd` `NULL`) em uma linha com as duas datas preenchidas, que é o que permite a consulta externa subtraí-las. E o par `+1`/`-1` é o conserto de inclusividade: `T500.ID` começa em 1, então o offset precisa ser `id-1` para a faixa incluir a data inicial, e o limite precisa ser `blake_hd-jones_hd+1` para incluir a data final. Com JONES contratado em 2006-04-02 (um domingo) e BLAKE em 2006-05-01 (uma segunda), isso são 30 dias de calendário, 9 deles fins de semana, então **21** dias úteis.

Hoje, o PostgreSQL gera as linhas ele mesmo e expressa o teste de fim de semana como aritmética de dia-da-semana em vez de correspondência de string:

```sql
-- PostgreSQL: generate_series as the row source, isodow as the predicate
select count(*) as business_days
  from (
select max(hiredate) filter (where ename = 'BLAKE') as blake_hd,
       max(hiredate) filter (where ename = 'JONES') as jones_hd
  from emp
 where ename in ('BLAKE','JONES')
       ) x
 cross join lateral generate_series(x.jones_hd, x.blake_hd, interval '1 day') as d
 where extract(isodow from d) < 6;   -- 1=Mon .. 7=Sun, so 6 and 7 are the weekend
```

`generate_series` **não tem variante nativa `date`**: as assinaturas documentadas são integer, bigint, numeric, `timestamp`, e `timestamptz`. Passar duas datas resolve para o overload `timestamp` via cast implícito, então `d` volta como um `timestamp`; adicione `::date` se quem consome precisa de uma data de verdade. `isodow` é o campo de extração certo aqui porque numera segunda 1 até domingo 7, tornando "fim de semana" um único teste `>= 6`. `dow` simples numera domingo 0 até sábado 6, e a documentação avisa explicitamente que a numeração de `to_char(..., 'D')` não corresponde a *nenhum* dos dois: ela roda de domingo 1 a sábado 7. Só `to_char(..., 'ID')` se alinha com `extract(isodow ...)`.

O MySQL não tem `generate_series` de todo, então a fonte de linha é uma CTE recursiva (disponível desde a 8.0):

```sql
-- MySQL 8.0+: recursive CTE as the row source
with recursive cal (d, stop_at) as (
  select date '2006-04-02', date '2006-05-01'
  union all
  select d + interval 1 day, stop_at from cal where d + interval 1 day <= stop_at
)
select count(*) as business_days
  from cal
 where weekday(d) < 5;   -- WEEKDAY: 0=Mon .. 6=Sun
```

Prefira `WEEKDAY()` a `DAYNAME()` aqui. `WEEKDAY()` retorna um índice fixo com segunda-igual-a-0 que nenhuma configuração de sessão consegue mover; `DAYNAME()` retorna uma string cujo idioma é controlado pela variável de sistema `lc_time_names`, então o teste `date_format(..., '%a') in ('Sat','Sun')` do livro silenciosamente para de corresponder a qualquer coisa no momento em que o servidor roda sob uma localidade não inglesa. `DAYOFWEEK()` é uma terceira numeração: 1 para domingo até 7 para sábado, seguindo a convenção ODBC, então as três funções de dia da semana do MySQL discordam entre si por design. Note também `cte_max_recursion_depth`, que "[por] padrão [...] tem um valor de 1000, fazendo a CTE terminar quando recorre além de 1000 níveis": bom para alguns anos de dias, uma parada rígida para uma década.

O SQL Server ganhou um `GENERATE_SERIES` em 2022 (16.x), mas é **só numérico**: `tinyint` até `numeric`, sem tipo de data, então ele alimenta `DATEADD` em vez de emitir datas diretamente. Também "exige que o nível de compatibilidade seja pelo menos 160", que é uma pegadinha de deployment real em bancos de dados atualizados no lugar a partir de uma versão mais antiga:

```sql
-- SQL Server 2022+ (compat level 160): numeric series + DATEADD
declare @s date = '2006-04-02', @e date = '2006-05-01';

select count(*) as business_days
  from generate_series(0, datediff(day, @s, @e)) as gs
 cross apply (select dateadd(day, gs.value, @s) as d) x
 where datediff(day, '19000101', x.d) % 7 < 5;   -- 1900-01-01 was a Monday
```

Antes de 2022 (e a própria solução do livro) é uma CTE recursiva em vez disso, que precisa de `OPTION (MAXRECURSION 366)` porque "[o] padrão de todo o servidor é 100": suficiente para uma faixa de três meses, silenciosamente fatal para um ano.

O predicado de fim de semana acima deliberadamente evita `DATEPART(weekday, ...)`. Veja a próxima seção para o porquê.

Excluir feriados não muda a estrutura de forma alguma; adiciona um anti-join contra uma tabela `holidays`, que é o motivo inteiro de o livro sugerir criar uma:

```sql
select count(*) as business_days
  from generate_series('2006-04-02'::date, '2006-05-01'::date, interval '1 day') as d
 where extract(isodow from d) < 6
   and not exists (select 1 from holidays h where h.holiday_date = d::date);
```

Finalmente, se a faixa é enorme e você só precisa excluir fins de semana (sem feriados), você consegue pular a fonte de linha por completo. Em T-SQL a forma fechada idiomática é:

```sql
declare @s date = '2006-04-02', @e date = '2006-05-01';

select (datediff(day, @s, @e) + 1)
     - (datediff(week, @s, @e) * 2)
     - (case when datename(weekday, @s) = 'Sunday'   then 1 else 0 end)
     - (case when datename(weekday, @e) = 'Saturday' then 1 else 0 end);  -- 21
```

Isso funciona por causa de uma garantia documentada que é fácil de perder: "Especificar SET DATEFIRST não tem efeito no DATEDIFF. DATEDIFF sempre usa domingo como o primeiro dia da semana para garantir que a função seja determinística." `DATEDIFF(week, ...)` portanto conta fronteiras de sábado-para-domingo não importa como a sessão esteja configurada: é a única função T-SQL ciente de dia-da-semana imune ao problema descrito a seguir. As duas correções `DATENAME`, no entanto, não são imunes: são comparações de string contra um nome localizado e deveriam ser reescritas como testes `DATEDIFF(day, '19000101', @s) % 7` antes de irem para produção em um servidor multilíngue.

### Contando ocorrências de dia da semana em um ano

Mesma maquinaria, `GROUP BY` diferente. Gere todo dia no ano, resolva cada um para um dia da semana, some:

```sql
-- PostgreSQL: how many of each weekday in the current year
select to_char(d, 'FMDay') as weekday, count(*)
  from generate_series(date_trunc('year', current_date),
                       date_trunc('year', current_date) + interval '1 year' - interval '1 day',
                       interval '1 day') as d
 group by 1, extract(isodow from d)
 order by extract(isodow from d);
```

`FM` importa. Sem ele, `'Day'` e `'DAY'` são "preenchidos em branco até 9 caracteres", então `'Monday   '` e `'Friday   '` voltam com espaços à direita, que é exatamente por que o livro envolve seu `to_char(..., 'DAY')` em `trim()`. `FM` "suprime zeros à esquerda e espaços em branco à direita", fazendo o mesmo trabalho dentro da string de formato. Agrupar por `extract(isodow from d)` junto com o rótulo mantém a saída na ordem do dia da semana em vez de alfabética, e continuaria funcionando se alguém trocasse o rótulo para nomes localizados com prefixo `TM`.

O MySQL, de novo, recorre à recursão:

```sql
with recursive cal (d) as (
  select makedate(year(curdate()), 1)
  union all
  select d + interval 1 day from cal
   where year(d + interval 1 day) = year(curdate())
)
select weekday(d) as dow_mon0, dayname(d) as weekday, count(*)
  from cal
 group by weekday(d), dayname(d)
 order by weekday(d);
```

E o SQL Server, ou com `GENERATE_SERIES` na 2022+ ou a CTE recursiva do livro com um aumento explícito de `MAXRECURSION`:

```sql
-- SQL Server 2022+
declare @jan1 date = datefromparts(year(getdate()), 1, 1);

select datename(weekday, dateadd(day, gs.value, @jan1)) as weekday,
       count(*)
  from generate_series(0, datediff(day, @jan1, dateadd(year, 1, @jan1)) - 1) as gs
 group by datename(weekday, dateadd(day, gs.value, @jan1))
 order by min(datediff(day, '19000101', dateadd(day, gs.value, @jan1)) % 7);
```

Para 2026 isso retorna 53 quintas-feiras e 52 de tudo mais: 2026 começa em uma quinta-feira e não é ano bissexto, então exatamente um dia da semana ganha o 53º slot. Um ano bissexto começando em um fim de semana ganha dois dias da semana com 53.

**A armadilha do `@@DATEFIRST`.** `DATEPART(weekday, ...)` (o datepart `dw` que o livro usa) não é uma numeração fixa. A documentação é inequívoca: "para um *datepart* de **week** (**wk**, **ww**) ou **weekday** (**dw**), o valor de retorno de `DATEPART` depende do valor definido por SET DATEFIRST." A mesma data retorna sete números de dia da semana diferentes dependendo da sessão:

```sql
-- 1999-01-01 was a Friday
set datefirst 7;  select datepart(dw, '1999-01-01');  -- 6  (Sunday-first, US English default)
set datefirst 1;  select datepart(dw, '1999-01-01');  -- 5  (Monday-first, ISO)
set datefirst 3;  select datepart(dw, '1999-01-01');  -- 3  (Wednesday-first)
```

`SET DATEFIRST` tem padrão `7` (domingo) para inglês dos EUA, mas o padrão efetivo vem do idioma do login: então `where datepart(dw, order_date) in (1, 7)` é código que significa "fim de semana" no seu laptop e outra coisa em um servidor cujo idioma padrão está configurado diferentemente. Leia o valor atual com `@@DATEFIRST` se precisar saber. `DATENAME(weekday, ...)` desvia da numeração mas troca por um problema pior: seu valor de retorno "depende do ambiente de idioma definido usando SET LANGUAGE", então emite `'Samstag'` ou `'sábado'` sob um login não inglês e toda comparação de string contra `'Saturday'` silenciosamente retorna zero linhas.

O conserto portável é ancorar a aritmética em uma data conhecida em vez de confiar no estado de sessão: `DATEDIFF(day, '19000101', d) % 7` produz 0 para segunda até 6 para domingo em todo SQL Server da Terra, porque 1900-01-01 era uma segunda-feira e `DATEDIFF` é contratualmente determinístico:

```sql
select case datediff(day, '19000101', order_date) % 7
         when 5 then 'Saturday' when 6 then 'Sunday' else 'Weekday'
       end
  from orders;
```

**Contando um dia da semana específico sem gerar nenhuma linha.** Se a pergunta é só "quantos sábados caem nesse trimestre", a resposta é aritmética de forma fechada sobre o comprimento da faixa e o número ISO do dia inicial:

```sql
-- PostgreSQL: occurrences of ISO weekday :k (1=Mon .. 7=Sun) in [:s, :e]
select (( :e::date - :s::date ) + 1) / 7
     + case when (( :e::date - :s::date ) + 1) % 7
               > (7 + :k - extract(isodow from :s::date)::int) % 7
            then 1 else 0
       end;
-- s = 2026-07-01, e = 2026-09-30, k = 6  ->  13 Saturdays
```

Divisão inteira dá as semanas inteiras (cada uma contribuindo exatamente um de todo dia da semana); o `CASE` decide se a semana parcial restante alcança o dia alvo. É O(1) em vez de O(days), e completamente opaco comparado a um `generate_series` com uma cláusula `WHERE`, que é a troca.

## Trade-offs

- **Geração de linha é legível e capaz de tratar feriados; aritmética de forma fechada é rápida e inflexível.** Enumerar todo dia custa uma linha por dia, o que é irrelevante para um trimestre e real para uma faixa de dez anos avaliada por linha de uma tabela de um milhão de linhas. As formas aritméticas são O(1) e facilmente uma ordem de magnitude mais rápidas nesse formato, mas só conseguem expressar "fins de semana", não "fins de semana e as doze datas na nossa tabela de feriados", porque não há fórmula para uma lista arbitrária de exceções.
- **Feriados são o motivo pelo qual tabelas de calendário/dimensão de data se recusam a morrer.** Todo fornecedor agora tem uma forma de conjurar dias do nada, o que remove a justificativa original do livro para `T500`. Isso não remove o caso para uma tabela de calendário de verdade: uma vez que a definição de "dia útil" inclui feriados da empresa, variações regionais, ou meios-dias, a lista de exceção precisa ser armazenada em algum lugar, e nesse ponto fazer join contra uma tabela que já carrega uma flag `is_business_day` vence regenerar e refiltrar a faixa em toda consulta.
- **No SQL Server, numeração de dia da semana é estado de sessão, não uma constante.** `DATEPART(weekday, ...)` muda com `SET DATEFIRST` e `DATENAME(weekday, ...)` muda com `SET LANGUAGE`, então a forma natural de escrever o predicado também é a forma que quebra quando o código roda sob um login, pool de conexão, ou servidor vinculado diferente. Ancorar em `DATEDIFF(day, '19000101', d) % 7` é mais feio e correto em todo lugar; o `isodow` do PostgreSQL e o `WEEKDAY()` do MySQL são fixos por definição e não precisam dessa defesa.
- **A fonte de linha ainda é a parte menos portável da consulta.** O PostgreSQL tem `generate_series` (mas nenhum overload `date`: resolve para `timestamp`); o SQL Server 2022+ tem `GENERATE_SERIES` mas só numérico e travado atrás do nível de compatibilidade 160, então qualquer coisa mais antiga recai numa CTE recursiva com `OPTION (MAXRECURSION n)` porque o padrão de todo o servidor de 100 trunca um ano sem aviso; o MySQL só tem a CTE recursiva, limitada por `cte_max_recursion_depth` em 1000. A metade `WHERE`/`GROUP BY` dessas consultas porta limpamente entre motores; a metade `FROM` nunca porta.
- **Truncamento silencioso é o modo de falha a temer, não um erro.** O `T500` do livro limita qualquer faixa a 500 dias, o `MAXRECURSION` padrão do SQL Server a limita a 100, e o do MySQL a limita a 1000. Dois dos três produzem um *número errado menor* em vez de uma exceção (`MAXRECURSION` de fato levanta o erro 530), então uma contagem de dias úteis que silenciosamente para de crescer além de algum comprimento de faixa é o bug a observar quando um relatório que estava certo por meses de repente não está mais.
- **Extremos inclusivos-versus-exclusivos merecem uma decisão registrada por escrito.** A dança `+1`/`-1` no `WHERE t500.id <= blake_hd-jones_hd+1` do livro existe unicamente para fazer os dois extremos contarem, e toda reescrita dessas consultas precisa rederivar isso. `DATEDIFF` e subtração de data são ambos exclusivos de uma ponta; `generate_series` com limites correspondentes é inclusivo dos dois. Nada no SQL vai lembrar você qual convenção o SLA de fato quis dizer.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 8, "Date Arithmetic", recipes 8.3, 8.6, p. 210-215, 220-231] - doc
- [PostgreSQL Documentation: Date/Time Functions and Operators (`extract`, `dow` vs `isodow`)](https://www.postgresql.org/docs/current/functions-datetime.html) - doc
- [PostgreSQL Documentation: Set Returning Functions (`generate_series`)](https://www.postgresql.org/docs/current/functions-srf.html) - doc
- [MySQL Reference Manual: Date and Time Functions (`WEEKDAY`, `DAYOFWEEK`, `DAYNAME`)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) - doc
- [Microsoft Learn: SET DATEFIRST (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-datefirst-transact-sql) - doc
- [Microsoft Learn: DATEPART (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql) - doc
- [Microsoft Learn: GENERATE_SERIES (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql) - doc
