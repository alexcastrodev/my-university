---
version: 1.0
updatedAt: 2026-08-05
title: "Lacunas de Data, Datas Faltantes, e Faixas com Sobreposição"
summary: Raciocine sobre datas como intervalos em vez de pontos: meça a lacuna para a próxima linha com LEAD, preencha buracos em uma sequência de data com um calendário gerado, e detecte faixas de data colidindo com uma condição de self-join ou os tipos de faixa nativos do PostgreSQL.
---
## Objective

Três perguntas que parecem não relacionadas acabam sendo o mesmo formato de problema: quanto tempo até o *próximo* evento em uma sequência, quais datas estão *faltando* em uma sequência que deveria ser contínua, e quais faixas de data das linhas *se sobrepõem*. As três param de tratar uma data como um ponto único e passam a tratá-la como uma ponta de um intervalo: a lacuna entre essa linha e a próxima, o buraco entre duas linhas que deveriam ser adjacentes, a colisão entre dois spans que deveriam ser disjuntos. Respondê-las precisa das mesmas três ferramentas sempre: uma função de janela para alcançar a linha vizinha, um calendário gerado para fornecer as linhas que o dado não tem, e um predicado de comparação de faixa para decidir se dois intervalos se tocam. Esse é o aquecimento com sabor de data para a técnica geral de gaps-and-islands (o mesmo raciocínio aplicado a qualquer valor ordenado, não só datas) coberta em outro lugar desta coleção.

## Use Cases

- Medir a lacuna entre eventos consecutivos por entidade: dias entre os pedidos de um cliente, horas entre duas leituras de sensor, semanas entre a data de contratação de um funcionário e a próxima contratação na empresa.
- Preencher um relatório para que todo dia, semana, ou mês mostre uma linha mesmo quando não existe dado para aquele período: uma `COUNT` de zero precisa vir de um calendário gerado, porque um `GROUP BY` sobre a tabela de fato só consegue produzir linhas para períodos que já têm dado.
- Detectar conflitos de agendamento: salas de reunião com reserva dupla, turnos de funcionário se sobrepondo, um projeto que começa antes de o anterior terminar, duas tabelas de tarifa que reivindicam a mesma janela de data efetiva.
- Validar dado de intervalo importado antes de chegar à produção: encontrar linhas cujos períodos de validade colidem com o de uma linha existente.
- Construir colunas de "dias desde a última atividade" ou "tempo até a próxima renovação" sem uma subconsulta escalar correlacionada por linha.

## Deep Dive

### A lacuna para o próximo registro: `LEAD` sobre uma janela ordenada

A receita 8.7 do livro pergunta: para todo funcionário em `DEPTNO 10`, quantos dias passaram entre sua data de contratação e a *próxima* contratação na empresa (qualquer departamento)? Antes de funções de janela isso precisava de uma subconsulta escalar correlacionada: "o menor `HIREDATE` maior do que o meu". `LEAD` diz isso diretamente:

```sql
-- PostgreSQL: date - date yields an integer number of days
select x.ename, x.hiredate, x.next_hd,
       x.next_hd - x.hiredate as diff
  from (
select e.deptno, e.ename, e.hiredate,
       lead(hiredate) over (order by hiredate) as next_hd
  from emp e
       ) x
 where x.deptno = 10;
```

A view inline **não** é cosmética. Funções de janela são avaliadas depois do `WHERE`, então empurrar `deptno = 10` para dentro da subconsulta muda a resposta: o `LEAD` então só veria as linhas do departamento 10 e reportaria a próxima contratação *dentro* do departamento, não a próxima contratação em geral. Filtre fora da janela, sempre.

Só a subtração difere entre motores: a chamada `LEAD` é idêntica:

```sql
-- MySQL: datediff(later, earlier) returns days
       datediff(x.next_hd, x.hiredate) as diff

-- SQL Server: unit comes first
       datediff(day, x.hiredate, x.next_hd) as diff
```

A armadilha na qual o livro gasta a maior parte da receita são **chaves de ordenação duplicadas**. `LEAD` avança uma *linha*, não um *valor distinto*, então cinco funcionários contratados no mesmo dia cada um vê um `next_hd` igual à sua própria `hiredate` e reporta uma lacuna de zero:

```sql
-- wrong when hiredate has duplicates: four of the five rows get diff = 0
select ename, hiredate,
       lead(hiredate) over (order by hiredate) - hiredate as diff
  from emp
 where deptno = 10;
```

O conserto do livro computa quão adiante está a próxima data distinta e passa isso como o argumento de offset do `LEAD`: `count(*)` por grupo de data menos o rank da linha dentro do grupo, mais um:

```sql
select ename, hiredate, next_hd,
       next_hd - hiredate as diff
  from (
select ename, hiredate,
       lead(hiredate, cnt - rn + 1) over (order by hiredate) as next_hd
  from (
select ename, hiredate,
       count(*)      over (partition by hiredate)                 as cnt,
       row_number()  over (partition by hiredate order by empno)  as rn
  from emp
 where deptno = 10
       ) counted
       ) offsets;
```

Essa aritmética de offset funciona nos três motores: o MySQL exige que `N` seja um literal, um marcador de parâmetro, ou uma variável, então `lead(hiredate, cnt-rn+1)` é um dos poucos lugares onde suas regras são mais estritas do que as do PostgreSQL e do SQL Server, que aceitam uma expressão arbitrária. Uma frase mais portável desvia do offset por completo liderando sobre as datas *distintas* e fazendo join de volta:

```sql
with distinct_days as (
  select hiredate,
         lead(hiredate) over (order by hiredate) as next_hd
    from (select distinct hiredate from emp where deptno = 10) d
)
select e.ename, e.hiredate, d.next_hd, d.next_hd - e.hiredate as diff
  from emp e
  join distinct_days d on d.hiredate = e.hiredate
 where e.deptno = 10;
```

`LEAD`/`LAG` em si são território assentado: PostgreSQL, MySQL 8.0+, e SQL Server 2012+ todos implementam `LEAD(expr, offset, default) OVER (PARTITION BY … ORDER BY …)` identicamente. A única diferença viva é tratamento de null: PostgreSQL 16+ e SQL Server 2022+ suportam `IGNORE NULLS`, o MySQL faz o parse e depois levanta um erro, então só `RESPECT NULLS` (o padrão) é portável.

### Preenchendo datas faltantes: gere um calendário, depois outer join

Você não consegue chegar via `GROUP BY` a uma linha que não tem dado. A pergunta da receita 9.10 (funcionários contratados por mês de 2000 a 2003, incluindo os meses com zero contratações) precisa que os doze meses de cada ano venham de algum lugar diferente de `EMP`. Gere-os, depois `LEFT JOIN`:

```sql
-- PostgreSQL: generate_series does the calendar in one line
select g.mth::date, count(e.hiredate) as num_hired
  from generate_series(
         date_trunc('year',  (select min(hiredate) from emp)),
         date_trunc('year',  (select max(hiredate) from emp)) + interval '11 months',
         interval '1 month'
       ) as g(mth)
  left join emp e
    on date_trunc('month', e.hiredate) = g.mth
 group by g.mth
 order by g.mth;
```

Note o `COUNT(e.hiredate)` do outer join, não `COUNT(*)`: em um mês sem contratações, o outer join produz uma linha de nulls, e `COUNT(*)` a contaria como 1. Contar uma coluna do lado *outer-joined* é o que transforma uma linha sem correspondência em um zero.

O MySQL não tem função geradora de conjunto, então a CTE recursiva que o livro usa ainda é a resposta lá hoje:

```sql
-- MySQL 8.0+: recursive CTE builds the month list
with recursive months (mth, end_date) as (
  select date_sub(min(hiredate), interval dayofyear(min(hiredate)) - 1 day),
         date_add(date_sub(max(hiredate), interval dayofyear(max(hiredate)) - 1 day),
                  interval 1 year)
    from emp
  union all
  select date_add(mth, interval 1 month), end_date
    from months
   where date_add(mth, interval 1 month) < end_date
)
select m.mth, count(e.hiredate) as num_hired
  from months m
  left join emp e
    on extract(year_month from m.mth) = extract(year_month from e.hiredate)
 group by m.mth
 order by m.mth;
```

O SQL Server 2022 adicionou `GENERATE_SERIES`, mas ele gera **só números**: a variante de data precisa ser construída adicionando o inteiro gerado como um intervalo:

```sql
-- SQL Server 2022+ (compatibility level 160): numeric series + DATEADD
declare @start date = (select dateadd(year, datediff(year, 0, min(hiredate)), 0) from emp);
declare @months int = (select datediff(month, min(hiredate), max(hiredate)) + 1 from emp);

select dateadd(month, g.value, @start) as mth,
       count(e.hiredate)               as num_hired
  from generate_series(0, @months - 1) as g
  left join emp e
    on datefromparts(year(e.hiredate), month(e.hiredate), 1)
     = dateadd(month, g.value, @start)
 group by dateadd(month, g.value, @start)
 order by 1;
```

Abaixo do SQL Server 2022, ou abaixo do nível de compatibilidade 160, a CTE recursiva do livro ainda é o fallback portável. Uma tabela persistida de calendário/dimensão é a terceira opção e muitas vezes a certa em um warehouse: pode ser indexada, ter join barato, e carregar colunas extras (período fiscal, flags de feriado) que nenhum gerador produz.

### Faixas de data com sobreposição: a condição de self-join, e as faixas nativas do PostgreSQL

A receita 9.13 quer todo caso de um funcionário começando um projeto antes de terminar outro. Duas faixas se sobrepõem quando cada uma começa antes de a outra terminar, mas o livro escreve uma forma intencionalmente *assimétrica*:

```sql
-- book's form: b starts inside a's window
select a.empno, a.ename,
       'project ' || b.proj_id || ' overlaps project ' || a.proj_id as msg
  from emp_project a
  join emp_project b
    on a.empno = b.empno
   and a.proj_id != b.proj_id
 where b.proj_start >= a.proj_start
   and b.proj_start <= a.proj_end;
```

Isso é completo e autodeduplicante: para quaisquer duas faixas com sobreposição, o `proj_start` da que começa mais tarde necessariamente cai dentro da janela da que começa mais cedo, então cada par colidindo é reportado exatamente uma vez, e a mensagem naturalmente lê "a nova sobrepõe a antiga". Só a concatenação muda por fornecedor (`concat(...)` no MySQL, `+` no SQL Server, onde o `proj_id` inteiro também precisa de um `cast(... as varchar)` explícito porque `+` em tipos mistos é aritmética, não concatenação).

A condição simétrica de livro-texto encontra os mesmos pares mas reporta cada um duas vezes a menos que você adicione um desempate:

```sql
select a.proj_id, b.proj_id
  from emp_project a
  join emp_project b
    on a.empno = b.empno
   and a.proj_id < b.proj_id          -- the dedup half of the condition
 where a.proj_start <= b.proj_end
   and b.proj_start <= a.proj_end;
```

O PostgreSQL é a exceção aqui, e de duas formas. Primeiro, o predicado padrão SQL `OVERLAPS`, que ele implementa e MySQL e SQL Server não:

```sql
select a.proj_id, b.proj_id
  from emp_project a
  join emp_project b
    on a.empno = b.empno and a.proj_id < b.proj_id
 where (a.proj_start, a.proj_end) overlaps (b.proj_start, b.proj_end);
```

`OVERLAPS` usa semântica **semi-aberta**: `start <= t < end`, então duas faixas que só se tocam em um extremo *não* se sobrepõem. Essa é uma diferença comportamental genuína da condição `<=` do livro, não uma estilística. O projeto 7 roda de 22-JUN a 25-JUN e o projeto 10 roda de 25-JUN a 28-JUN; a comparação inclusiva do livro os reporta como sobrepostos, `OVERLAPS` não:

```sql
select (date '2005-06-22', date '2005-06-25')
       overlaps (date '2005-06-25', date '2005-06-28');   -- false
```

Segundo, o PostgreSQL tem tipos de faixa de verdade: `daterange`, `tsrange`, `tstzrange`, mais suas contrapartes multirange, com `&&` como o operador de sobreposição e inclusividade de limite explícita no construtor:

```sql
-- '[]' = both bounds inclusive, matching the book's semantics exactly
select a.proj_id, b.proj_id
  from emp_project a
  join emp_project b
    on a.empno = b.empno and a.proj_id < b.proj_id
 where daterange(a.proj_start, a.proj_end, '[]')
    && daterange(b.proj_start, b.proj_end, '[]');

select daterange(date '2005-06-22', date '2005-06-25', '[]')
    && daterange(date '2005-06-25', date '2005-06-28', '[]');   -- true
```

A notação de limite é o ponto: `'[]'` reproduz a comparação inclusiva do livro, `'[)'` reproduz `OVERLAPS`. A ambiguidade que a forma manual `start1 <= end2` deixa implícita se torna uma parte declarada do valor.

E uma vez que faixas são um tipo armazenado em vez de duas colunas soltas, o PostgreSQL consegue *prevenir* sobreposições em vez de detectá-las depois do fato, com uma constraint de exclusão apoiada em GiST:

```sql
create extension if not exists btree_gist;

create table room_reservation (
  room   text,
  during tsrange,
  exclude using gist (room with =, during with &&)
);

insert into room_reservation values ('123A', '[2010-01-01 14:00, 2010-01-01 15:00)');
insert into room_reservation values ('123A', '[2010-01-01 14:30, 2010-01-01 15:30)');
-- ERROR: conflicting key value violates exclusion constraint
--        "room_reservation_room_during_excl"
```

O PostgreSQL 18 envolve a mesma maquinaria em sintaxe temporal SQL:2011: uma chave primária cuja última coluna é checada por sobreposição em vez de igualdade, que compila exatamente para a constraint de exclusão acima:

```sql
create table room_reservation (
  room   text,
  during daterange,
  primary key (room, during without overlaps)
);
```

MySQL e SQL Server não têm equivalente de nada disso: nenhum tipo de faixa, nenhum `&&`, nenhum predicado `OVERLAPS`, nenhuma constraint de exclusão. Aplicar não sobreposição lá significa um trigger ou uma checagem em nível de aplicação, e detectar sobreposição significa o self-join do livro, que permanece exatamente tão atual nesses dois motores quanto estava em 2020.

## Trade-offs

- **`LEAD` avança uma linha, não um valor distinto: duplicatas silenciosamente produzem uma lacuna de zero.** Esse é o modo de falha mais propenso a chegar em produção sem ser notado, porque a consulta retorna linhas e nenhum erro; os números só estão errados para toda data duplicada. Ou passe um offset computado (`lead(hiredate, cnt-rn+1)`) ou lidere sobre uma subconsulta `DISTINCT` e faça join de volta.
  ```sql
  -- five employees hired the same day: four report diff = 0
  lead(hiredate) over (order by hiredate) - hiredate
  ```
- **Funções de janela são avaliadas depois do `WHERE`, então a view inline é estrutural.** Mover o filtro para dentro da subconsulta é uma edição de uma linha que silenciosamente muda a pergunta de "próxima contratação na empresa" para "próxima contratação nesse departamento": parece uma simplificação e na verdade é uma consulta diferente.
- **Geração de calendário é o passo menos portável dos três.** O `generate_series` do PostgreSQL faz isso em uma expressão; o `GENERATE_SERIES` do SQL Server 2022 emite só números e precisa de `DATEADD` por cima, mais nível de compatibilidade 160; o MySQL não tem gerador de todo e ainda precisa da CTE recursiva do livro, limitada por `cte_max_recursion_depth` (padrão de 1000 níveis: suficiente para alguns anos de meses, não suficiente para uma década de dias sem aumentá-lo).
  ```sql
  set session cte_max_recursion_depth = 5000;  -- ~13 years of daily rows
  ```
- **Semântica de faixa inclusiva e semi-aberta discordam sobre extremos que se tocam, e nada te avisa.** A comparação `start <= end` do livro conta uma faixa terminando 25-JUN e uma começando 25-JUN como sobrepostas; `OVERLAPS` e um `daterange` `'[)'` não. Qual está correto depende inteiramente de se a data final significa "o último dia incluído" ou "o primeiro dia excluído": decida isso uma vez, por coluna, e codifique, porque uma convenção mista em um schema produz bugs de erro-por-um que só aparecem em linhas adjacentes.
- **Detecção de sobreposição via self-join é quadrática dentro de cada partição.** Toda linha é comparada contra toda outra linha para o mesmo funcionário, sala, ou recurso; com alguns projetos por funcionário isso é gratuito, com dezenas de milhares de intervalos em uma partição não é. O PostgreSQL consegue indexar a comparação com um índice GiST em uma coluna de faixa e tornar `&&` um scan de índice de verdade; MySQL e SQL Server não têm nenhum operador de sobreposição indexável, então um índice composto em `(entity, start_date)` mais uma janela de tempo limitada na cláusula `WHERE` é a única palanca disponível.
- **Detectar sobreposições e preveni-las são problemas diferentes, e só o PostgreSQL resolve o segundo declarativamente.** Uma constraint de exclusão (ou a chave temporal `WITHOUT OVERLAPS` do PostgreSQL 18) rejeita a linha conflitante no momento do insert, sob concorrência, sem uma janela de corrida; a checagem `SELECT`-depois-`INSERT` em nível de aplicação à qual MySQL e SQL Server estão limitados tem uma lacuna entre a checagem e a escrita que duas sessões concorrentes eventualmente vão encontrar.
- **A condição de sobreposição assimétrica do livro é um recurso, não um descuido.** `b.proj_start between a.proj_start and a.proj_end` retorna uma linha por par colidindo e identifica qual faixa começou mais tarde, onde a forma simétrica `a.start <= b.end and b.start <= a.end` retorna as duas ordens e precisa de um predicado extra `a.id < b.id` para deduplicar. Recorra à forma simétrica só quando você genuinamente quiser o par nas duas direções.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 8, "Date Arithmetic", recipe 8.7, p. 231-237; Chapter 9, "Date Manipulation", recipes 9.10, 9.13, p. 293-311] - doc
- [PostgreSQL Documentation: Range Types (daterange, && overlap operator, exclusion constraints)](https://www.postgresql.org/docs/current/rangetypes.html) - doc
- [PostgreSQL Documentation: Date/Time Functions and Operators (OVERLAPS predicate)](https://www.postgresql.org/docs/current/functions-datetime.html) - doc
- [PostgreSQL Documentation: Set Returning Functions (generate_series)](https://www.postgresql.org/docs/current/functions-srf.html) - doc
- [MySQL Reference Manual: Window Function Descriptions (LEAD, LAG)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) - doc
- [Microsoft Learn: LEAD (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lead-transact-sql) - doc
- [Microsoft Learn: GENERATE_SERIES (Transact-SQL, SQL Server 2022+)](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql) - doc
