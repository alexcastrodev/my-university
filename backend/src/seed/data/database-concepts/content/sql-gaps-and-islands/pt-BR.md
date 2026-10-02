---
version: 1.0
updatedAt: 2026-08-06
title: "Lacunas e Ilhas: Valores Consecutivos e Geração de Sequências"
summary: Encontrar sequências contíguas em uma sequência numérica esparsa, reduzir cada sequência ao seu início e fim, e gerar a sequência densa que revela o que está faltando.
---
## Objective

Pegue uma sequência ordenada de números que *deveria* ser contínua (números de série, ids de nota fiscal, ids de projeto, deslocamentos em dias) e que não é. As linhas se dividem em **ilhas** (sequências de valores consecutivos) separadas por **lacunas** (os valores que ninguém inseriu). Perguntar "quais sequências são contíguas?", "onde cada sequência começa e termina?" e "quais valores estão faltando?" são três formas da mesma pergunta, e a resposta para as três vem de uma ideia: derivar uma *chave de grupo* que fica constante para toda linha dentro de uma sequência e muda em cada fronteira. O problema espelhado (você precisa da sequência densa e nenhuma tabela a contém) é um gerador de linhas, e acaba sendo a ferramenta que permite responder a metade das lacunas por anti-join. Este conceito cobre a forma genérica, puramente numérica; a instância com datas exatamente do mesmo padrão (lacunas de datas com `LEAD`, preenchimento de períodos de calendário faltantes, intervalos de datas sobrepostos) é coberta em [Date Gaps, Missing Dates, and Overlapping Ranges](sql-date-gaps-and-overlapping-ranges).

## Use Cases

- Encontrar blocos contíguos de números de série, números de ticket ou ids de estoque livres, para que uma alocação em lote entregue um intervalo sem interrupção em vez de números soltos.
- Detectar sequências seguidas: dias consecutivos de login por usuário, registros de presença consecutivos, vitórias consecutivas, leituras consecutivas acima de um limite; qualquer coisa em que "quanto tempo durou, sem interrupção" importa mais que a contagem bruta.
- Reportar quais ids estão *faltando* em uma sequência que deveria ser densa: auditar uma série de notas fiscais ou de cheques em busca de buracos que indiquem um registro perdido, cancelado ou nunca importado.
- Gerar sob demanda uma sequência densa de ids/números para uma tabela de consulta, um pivot, uma carga de dados de teste ou um parâmetro para lógica de análise de strings, sem criar e manter uma tabela física de números.
- Comprimir um resultado por linha em um por intervalo: transformar dez mil linhas consecutivas em "20001-30000", que é menor para transmitir e é a forma que um humano realmente quer ler.

## Deep Dive

### Localizando as ilhas

Comece com uma sequência que tem buracos:

```sql
create table inventory (serial_no integer);

insert into inventory values (1), (2), (3), (5), (6), (7), (8), (12), (20), (21);
```

Quatro ilhas (`1-3`, `5-8`, `12`, `20-21`) e três lacunas (`4`, `9-11`, `13-19`). A receita 10.1 do livro recorre a `LEAD` para olhar a próxima linha sem self-join, e mantém as linhas cujo sucessor é exatamente um a mais:

```sql
select serial_no
  from (
select serial_no,
       lead(serial_no) over (order by serial_no) as next_no
  from inventory
       ) t
 where next_no = serial_no + 1;
--  1, 2, 5, 6, 7, 20
```

A view inline é obrigatória, não estilística: window functions são avaliadas depois do `WHERE`, então filtrar no mesmo bloco de consulta aplicaria o `LEAD` ao que sobrevivesse ao filtro. Mas olhe a saída: `3`, `8` e `21` sumiram. Cada um é o *último* membro de uma ilha, e o teste "meu sucessor é +1" nunca pode ser verdadeiro para um último membro. Essa é exatamente a ressalva que o livro levanta sobre o `PROJ_ID 4`, e sua correção é acrescentar `LAG` e aceitar uma linha que seja consecutiva em qualquer direção:

```sql
select serial_no
  from (
select serial_no,
       lead(serial_no) over (order by serial_no) as next_no,
        lag(serial_no) over (order by serial_no) as prior_no
  from inventory
       ) t
 where next_no  = serial_no + 1
    or prior_no = serial_no - 1;
--  1, 2, 3, 5, 6, 7, 8, 20, 21   (12 excluído: uma ilha de um elemento)
```

As duas formas respondem "quais linhas estão em uma sequência", mas nenhuma diz a *qual* sequência uma linha pertence, e é essa a pergunta de que tudo o que vem depois precisa. A técnica que responde é a que o livro só alcança indiretamente na receita seguinte: subtrair um contador denso do valor.

```sql
select serial_no,
       row_number() over (order by serial_no)             as rn,
       serial_no - row_number() over (order by serial_no) as grp
  from inventory;

--  serial_no | rn | grp
--  ----------+----+-----
--          1 |  1 |   0
--          2 |  2 |   0
--          3 |  3 |   0
--          5 |  4 |   1
--          6 |  5 |   1
--          7 |  6 |   1
--          8 |  7 |   1
--         12 |  8 |   4
--         20 |  9 |  11
--         21 | 10 |  11
```

`ROW_NUMBER()` sempre aumenta exatamente um. Dentro de uma ilha, `serial_no` também aumenta exatamente um, então a diferença é constante; em uma lacuna de tamanho *n*, o valor salta à frente do contador e a diferença aumenta *n*. O número em si em `grp` não significa nada; só a sua constância importa. Ele é uma chave de grupo, e o `GROUP BY` assume a partir daí. `ROW_NUMBER() OVER (ORDER BY …)` está disponível no PostgreSQL (desde o 8.4), no MySQL 8.0+ e no SQL Server 2012+ com sintaxe e semântica idênticas, então essa expressão é portável literalmente.

### Reportando só as fronteiras

Quando toda linha carrega uma chave de grupo, reduzir cada ilha aos seus extremos é uma agregação:

```sql
select min(serial_no) as island_start,
       max(serial_no) as island_end,
       count(*)       as len
  from (
select serial_no,
       serial_no - row_number() over (order by serial_no) as grp
  from inventory
       ) t
 group by grp
 order by island_start;

--  island_start | island_end | len
--  -------------+------------+-----
--             1 |          3 |   3
--             5 |          8 |   4
--            12 |         12 |   1
--            20 |         21 |   2
```

Note que `12` aparece como uma ilha de uma linha em vez de desaparecer, que é exatamente a mudança semântica que a receita 10.3 aponta: uma linha que não faz parte de nenhuma sequência ainda é o início e o fim do seu próprio intervalo.

A própria solução do livro para a 10.3 usa uma chave de agrupamento diferente e mais geral: `LAG` para comparar com a linha anterior, um `CASE` que emite `1` em cada fronteira e `0` caso contrário, e um `SUM` acumulado sobre essas flags. Escrita para uma sequência numérica:

```sql
select grp, min(serial_no) as island_start, max(serial_no) as island_end
  from (
select serial_no,
       sum(flag) over (order by serial_no
                       rows between unbounded preceding and current row) as grp
  from (
select serial_no,
       case when lag(serial_no) over (order by serial_no) = serial_no - 1
            then 0 else 1
       end as flag
  from inventory
       ) flagged
       ) grouped
 group by grp
 order by grp;
```

Vale aprender esta forma mesmo sendo mais longa, porque o teste de fronteira vive em uma única expressão `CASE` isolada. Troque `= serial_no - 1` por qualquer outra coisa (`>= serial_no - 5` para "a até cinco de distância", `= proj_start` para a versão do livro de encadeamento de projetos, `> current_ts - interval '30 minutes'` para sessionização) e o resto da consulta não muda. O truque de `ROW_NUMBER()` menos valor tem "consecutivo significa exatamente +1" embutido na sua aritmética e não pode ser generalizado assim.

O `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` explícito também não é decoração. PostgreSQL, MySQL e SQL Server usam por padrão `RANGE UNBOUNDED PRECEDING` (equivalente a `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`) quando há um `ORDER BY` e nenhum frame é dado, e no modo `RANGE` `CURRENT ROW` significa "o último *par* da linha atual", toda linha que o `ORDER BY` ordena como equivalente. Em uma coluna de ordenação sem repetições, os dois frames concordam; em uma com empates, `RANGE` dá a toda linha empatada o mesmo total acumulado e funde em silêncio o que deveriam ser fronteiras separadas. Escreva `ROWS` por extenso em um total acumulado usado como chave de grupo e a questão nunca aparece.

As lacunas em si saem da mesma view com `LEAD`: todo lugar em que o próximo valor salta à frente é um buraco, e seus limites são os dois valores de cada lado:

```sql
select serial_no + 1 as gap_start,
       next_no - 1   as gap_end
  from (
select serial_no,
       lead(serial_no) over (order by serial_no) as next_no
  from inventory
       ) t
 where next_no > serial_no + 1;

--  gap_start | gap_end
--  ----------+---------
--          4 |       4
--          9 |      11
--         13 |      19
```

Isso reporta só as lacunas *entre* linhas existentes. Buracos antes da primeira linha ou depois da última não são visíveis para o `LEAD`, porque os limites pretendidos da sequência não estão nos dados: eles precisam ser fornecidos, que é o próximo subtópico.

### Gerando uma sequência numérica

O livro apresenta a receita 10.5 como um "gerador de fonte de linhas" e dá uma solução diferente por fornecedor, porque em 2020 só o PostgreSQL tinha uma função embutida. Isso ainda é verdade em grande parte, mas o SQL Server se juntou a ele desde então.

**PostgreSQL**: `generate_series` é uma função que retorna conjuntos, com assinatura `generate_series(start, stop [, step])` para `integer`, `bigint` e `numeric`. `step` tem padrão 1, pode ser negativo para contar para trás, e ser zero é um erro; se `start > stop` com passo positivo (ou qualquer argumento for `NULL`), você recebe zero linhas em vez de um erro:

```sql
select id from generate_series(1, 10) as g(id);         -- 1 … 10
select id from generate_series(10, 30, 5) as g(id);     -- 10, 15, 20, 25, 30
select id from generate_series(10, 1, -1) as g(id);     -- conta para trás
```

Os argumentos são expressões comuns, então os limites podem vir dos dados, e é isso que torna o gerador uma *resposta* à pergunta das lacunas, e não só uma curiosidade. Faça um anti-join da série densa contra a tabela esparsa e os valores faltantes aparecem diretamente, extremos incluídos:

```sql
select g.id as missing_serial
  from generate_series( (select min(serial_no) from inventory),
                        (select max(serial_no) from inventory) ) as g(id)
 where not exists (select 1 from inventory i where i.serial_no = g.id);
--  4, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19
```

**SQL Server 2022 (16.x)+**: `GENERATE_SERIES(start, stop [, step])` é o equivalente direto, retornando uma tabela de uma coluna chamada `value`. Duas ressalvas sobre as quais a documentação é explícita: ele exige nível de compatibilidade do banco **160** ou superior (abaixo disso o engine simplesmente informa que a função não existe, a menos que a configuração em escopo de banco `ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS` esteja ligada), e `step` tem padrão `1` quando `start < stop`, mas `-1` quando `start > stop`, o oposto do PostgreSQL, que retorna um conjunto vazio nesse caso:

```sql
select value from generate_series(1, 10);
select value from generate_series(1, 50, 5);   -- 1, 6, 11, … 46
```

**MySQL**: ainda sem função geradora no 8.4 ou no 9.x, então a CTE recursiva do livro é a resposta atual, não uma legada. Ela também é a opção mais portável, rodando sem alterações no PostgreSQL e (sem a palavra-chave `RECURSIVE`, que o T-SQL não usa) no SQL Server:

```sql
with recursive x (id) as (
  select 1
  union all
  select id + 1
    from x
   where id + 1 <= 10
)
select id from x;
```

A recursão não é de graça, e o MySQL a limita: `cte_max_recursion_depth` tem padrão **1000**, e ultrapassá-lo aborta a consulta com `ERROR 3636 (HY000): Recursive query aborted after 1001 iterations`. Aumentá-lo é uma configuração de sessão, mas para geradores grandes de tamanho fixo um cross join baseado em conjuntos de uma lista de dígitos é mais rápido e não tem limite de profundidade nenhum; essa é a "tabela pivô" que o livro menciona o tempo todo, construída inline em vez de armazenada:

```sql
with digits (d) as (
  select 0 union all select 1 union all select 2 union all select 3 union all
  select 4 union all select 5 union all select 6 union all select 7 union all
  select 8 union all select 9
)
select d3.d * 100 + d2.d * 10 + d1.d + 1 as id
  from digits d1
 cross join digits d2
 cross join digits d3
 order by id;              -- 1 … 1000, sem recursão
```

Cada `cross join digits` extra multiplica a quantidade de linhas por dez, então três joins dão mil linhas, cinco dão cem mil. Limite a saída com um `WHERE` sobre a expressão calculada em vez de gerar mais do que precisa.

## Trade-offs

- **O truque de `ROW_NUMBER()` grava no código que "consecutivo significa exatamente +1".** É a resposta correta mais curta para uma sequência densa de inteiros e a ferramenta errada no momento em que a adjacência é definida por qualquer outra coisa: um encadeamento `fim = próximo início`, uma janela de tolerância, um timeout de sessão. Esses casos precisam da forma `LAG` + `CASE` + `SUM` acumulado, em que a definição de fronteira é uma expressão editável em vez de uma identidade aritmética.
  ```sql
  -- adjacência como um predicado trocável, não embutida na subtração
  case when lag(ts) over (order by ts) > ts - interval '30 minutes'
       then 0 else 1 end
  ```
- **Duplicatas estilhaçam ilhas em silêncio com `ROW_NUMBER()`.** Duas linhas com o mesmo valor recebem números de linha diferentes, então suas chaves de grupo diferem e uma ilha é reportada como duas. `DENSE_RANK()` dá aos valores empatados o mesmo contador e restaura o invariante, mas só se as duplicatas forem realmente intencionais; se não forem, deduplique antes em vez de mascará-las.
  ```sql
  serial_no - dense_rank() over (order by serial_no) as grp
  ```
- **No MySQL a subtração é sensível à ordem e falha em tempo de execução, não de parse.** `ROW_NUMBER()` gera um inteiro sem sinal, e a regra do MySQL é que uma subtração com um operando sem sinal produz um resultado sem sinal; então, no momento em que a diferença ficaria negativa, você recebe `ERROR 1690 (22003): BIGINT UNSIGNED value is out of range`. Escrever os operandos na outra ordem, ou agrupar ids que começam em zero ou abaixo, basta para disparar isso. Faça o cast explicitamente em vez de depender da ordem em que você por acaso digitou.
  ```sql
  -- explode no MySQL assim que row_number() passar de serial_no
  row_number() over (order by serial_no) - serial_no
  -- portável
  cast(row_number() over (order by serial_no) as signed) - serial_no
  ```
- **O frame padrão da janela é `RANGE`, e `RANGE` funde pares.** Os três engines usam por padrão `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` quando há `ORDER BY` sem cláusula de frame, e `CURRENT ROW` ali significa o *último par* da linha atual. Uma chave de grupo por total acumulado sobre uma coluna com empates atribui, portanto, o mesmo grupo a linhas que deveriam ter começado um novo: uma resposta errada sem erro. `ROWS` custa quatro palavras a mais e elimina essa classe inteira de bug.
  ```sql
  sum(flag) over (order by serial_no
                  rows between unbounded preceding and current row)
  ```
- **Gerar a sequência é o passo menos portável, e as restrições são reais, não históricas.** O `generate_series` do PostgreSQL é uma expressão; o `GENERATE_SERIES` do SQL Server precisa do 2022 mais o nível de compatibilidade 160; o MySQL não tem nada e precisa de uma CTE recursiva limitada por `cte_max_recursion_depth` (padrão 1000). Portabilidade aqui significa ou escrever a CTE recursiva em todo lugar e abrir mão da forma concisa, ou ramificar por engine.
  ```sql
  set session cte_max_recursion_depth = 100000;  -- MySQL, antes de um gerador grande
  ```
- **Filtrar só com `LEAD` descarta em silêncio a última linha de cada ilha.** O predicado "o próximo valor é +1" nunca é verdadeiro para o último membro de uma sequência, então a receita ingênua retorna ilhas com uma linha a menos e não retorna ilhas de um elemento. Se isso é um bug ou o requisito é uma questão de julgamento real (a própria discussão do livro sobre o `PROJ_ID 4` existe justamente porque as duas leituras são defensáveis), mas deveria ser uma decisão, não um acidente.
- **Intervalos comprimem a saída, e a compressão perde colunas de nível de linha.** Reduzir a `MIN`/`MAX` por grupo transforma dez mil linhas em uma, que é exatamente o ponto, mas qualquer atributo por linha que varie dentro da ilha precisa ser agregado ou descartado. Decida de antemão se quem consome quer o intervalo ou as linhas; produzir os dois significa rodar o agrupamento duas vezes, ou manter a chave de grupo nas linhas de detalhe e fazer join de volta.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 10, "Working with Ranges", receitas 10.1, 10.3, 10.5, p. 313-317, 323-333: doc
- [PostgreSQL Documentation: Set Returning Functions (generate_series)](https://www.postgresql.org/docs/current/functions-srf.html): doc
- [PostgreSQL Documentation: Window Function Calls (default RANGE frame, peer rows)](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS): doc
- [MySQL Reference Manual: WITH (Common Table Expressions, recursion and cte_max_recursion_depth)](https://dev.mysql.com/doc/refman/8.4/en/with.html): doc
- [MySQL Reference Manual: Out-of-Range and Overflow Handling (unsigned subtraction)](https://dev.mysql.com/doc/refman/8.4/en/out-of-range-and-overflow.html): doc
- [Microsoft Learn: GENERATE_SERIES (Transact-SQL, SQL Server 2022+)](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql): doc
- [Microsoft Learn: OVER Clause (Transact-SQL, ROWS/RANGE default frame)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql): doc
