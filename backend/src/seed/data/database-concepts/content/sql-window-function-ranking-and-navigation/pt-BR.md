---
version: 1.0
updatedAt: 2026-08-06
title: "SQL: Ranking e Navegação entre Linhas com Window Functions"
summary: Use LEAD e LAG para ler ou deslocar o valor de uma linha vizinha, e RANK, DENSE_RANK e ROW_NUMBER para atribuir posições ordinais com três regras diferentes de tratamento de empates.
---
## Objective

Duas famílias de window functions respondem perguntas que um `SELECT` simples
não responde: *navegação* e *ranking*. `LEAD` e `LAG` navegam: alcançam uma
linha vizinha dentro de uma partição ordenada e trazem o valor dela para a
linha atual, seja para olhar adiante e ver o que acontece em seguida, seja para
deslocar uma coluna inteira N posições para cima ou para baixo. `RANK`,
`DENSE_RANK` e `ROW_NUMBER` ranqueiam: atribuem a cada linha uma posição
ordinal dentro dessa mesma partição ordenada, e a única coisa que separa as
três é o que cada uma faz quando duas linhas empatam. Nenhuma das famílias
precisa de self-join, subconsulta correlacionada ou segunda passada sobre a
tabela; as duas são uma única varredura ordenada.

## Use Cases

- Encontrar a data do *próximo* pedido de um cliente (ou a próxima contratação
  depois de um funcionário, o próximo heartbeat de um dispositivo) para que a
  linha atual possa ser comparada com o evento seguinte, ou anotada com ele.
- Deslocar uma série temporal um número fixo de linhas para cima ou para
  baixo para alinhar períodos em um relatório de comparação entre períodos: o
  valor desta semana ao lado do valor de quatro linhas atrás, sem self-join
  sobre uma chave de data calculada.
- Montar colunas "próximo maior / próximo menor" que dão a volta nas pontas de
  um conjunto de resultados, de modo que o valor "à frente" da linha do topo
  seja o da linha do fim e vice-versa.
- Ranquear vendedores por receita quando dois vendedores com números idênticos
  precisam *compartilhar* uma posição, e o caso vizinho em que toda linha deve
  receber um número distinto de qualquer jeito, porque o ranking alimenta
  paginação ou deduplicação.
- Relatórios top-N em que "os 3 primeiros" precisa significar "todos que
  empataram nas 3 primeiras posições", e não "3 linhas, escolhendo
  arbitrariamente entre os empates".

## Deep Dive

### LEAD: lendo o valor de uma linha futura

A receita 11.7 do livro pede os funcionários que ganham menos que a pessoa
contratada logo depois deles. Sem window function, isso é uma subconsulta
correlacionada procurando o menor `HIREDATE` maior que o atual; com `LEAD`, é
uma coluna:

```sql
select ename, sal, hiredate,
       lead(sal) over (order by hiredate) as next_sal
  from emp;
```

```
 ename  | sal  |  hiredate  | next_sal
--------+------+------------+----------
 SMITH  |  800 | 1980-12-17 |     1600
 ALLEN  | 1600 | 1981-02-20 |     1250
 WARD   | 1250 | 1981-02-22 |     2975
 ...
 ADAMS  | 1100 | 1983-01-12 |
```

"Futuro" é o que o `ORDER BY` dentro do `OVER` disser que é: não existe ordem
inerente em uma tabela, então a ordenação *define* a direção. A última linha
não tem sucessora, então `LEAD` retorna `NULL`.

Window functions são avaliadas depois do `WHERE`, então o filtro não pode
ficar no mesmo bloco da consulta:

```sql
-- ERROR:  window functions are not allowed in WHERE
select ename from emp where lead(sal) over (order by hiredate) > sal;
```

Envolva a consulta em uma inline view (ou CTE) e filtre por fora, o formato
que todo engine impõe:

```sql
select ename, sal, hiredate
  from (
    select ename, sal, hiredate,
           lead(sal) over (order by hiredate) as next_sal
      from emp
       ) alias
 where sal < next_sal;
```

```
 ename  | sal  |  hiredate
--------+------+------------
 SMITH  |  800 | 1980-12-17
 WARD   | 1250 | 1981-02-22
 MARTIN | 1250 | 1981-09-28
 JAMES  |  950 | 1981-12-03
 MILLER | 1300 | 1982-01-23
```

`LEAD` avança uma *linha*, não um valor distinto do `ORDER BY`; então empates
em `HIREDATE` fazem um funcionário ser comparado com um colega contratado no
mesmo dia, e não com a contratação de fato seguinte. A correção do livro é um
offset calculado (`lead(sal, cnt-rn+1)`), e esse argumento de offset é a
coisa menos portável do capítulo inteiro; ele é tratado em detalhe, com o erro
exato de cast do PostgreSQL e a restrição do MySQL a literais, em
[SQL: Diferenças entre Linhas Adjacentes](/database-concepts/sql-differences-between-adjacent-rows).

### LAG e LEAD como operador de deslocamento

A receita 11.8 dá outra leitura às mesmas duas funções: em vez de comparar com
um vizinho, *mover os valores de uma coluna* N linhas para cima ou para baixo.
Ordene por `SAL` e cada linha recebe o próximo salário maior e o próximo menor
da tabela:

```sql
select ename, sal,
       lead(sal) over (order by sal) as forward,
       lag(sal)  over (order by sal) as rewind
  from emp;
```

As pontas voltam `NULL`: o menor salário não tem nada atrás dele, e o maior
não tem nada à frente. O requisito do livro é que o resultado *dê a volta*, e
`MIN`/`MAX` com um `OVER ()` **vazio** (sem `PARTITION BY`, sem `ORDER BY`,
então a janela é o conjunto de resultados inteiro) fornece os valores para
onde dar a volta:

```sql
select ename, sal,
       coalesce(lead(sal) over (order by sal), min(sal) over ()) as forward,
       coalesce(lag(sal)  over (order by sal), max(sal) over ()) as rewind
  from emp;
```

```
 ename  | sal  | forward | rewind
--------+------+---------+--------
 SMITH  |  800 |     950 |   5000   <- rewind deu a volta para o MAX
 JAMES  |  950 |    1100 |    800
 ADAMS  | 1100 |    1250 |    950
 WARD   | 1250 |    1250 |   1100
 ...
 FORD   | 3000 |    3000 |   2975
 SCOTT  | 3000 |    5000 |   3000
 KING   | 5000 |     800 |   3000   <- forward deu a volta para o MIN
```

A distância do deslocamento é o segundo argumento, e não precisa ser 1: "três
linhas à frente, cinco para trás" é só `lead(sal,3)` e `lag(sal,5)`:

```sql
select ename, sal,
       lead(sal,3) over (order by sal) as forward,
       lag(sal,5)  over (order by sal) as rewind
  from emp;
```

Agora as *cinco* primeiras linhas têm `rewind` `NULL` e as três últimas têm
`forward` `NULL`: quanto maior o deslocamento, mais larga a faixa de `NULL` na
borda. Existe um terceiro argumento exatamente para isso, um valor padrão a
usar no lugar de `NULL`, suportado igualmente no PostgreSQL, no MySQL 8+ e no
SQL Server:

```sql
select ename, sal,
       lead(sal, 1, 0) over (order by sal) as next_sal   -- 0, e não NULL, no final
  from emp;
```

Prefira o terceiro argumento a um `COALESCE` envolvendo a chamada quando o
valor de fallback for uma constante; recorra ao `COALESCE` (como o livro faz)
quando o fallback for ele próprio um valor calculado, como `min(sal) over ()`.
Uma coisa que o terceiro argumento *não* faz é pular `NULL`s que já estão nos
dados: isso é o `IGNORE NULLS`, e o suporte dos fornecedores a ele é uma
lacuna à parte, tratada no conceito de linhas adjacentes citado acima.

### RANK vs DENSE_RANK vs ROW_NUMBER: três respostas para um empate

As três recebem uma partição ordenada e distribuem inteiros. São idênticas até
duas linhas empatarem, e aí divergem de formas que mudam os *resultados* da
consulta, não só a aparência:

```sql
select sal,
       rank()       over w as rnk,
       dense_rank() over w as dns,
       row_number() over w as rn
  from emp
window w as (order by sal);
```

```
 sal  | rnk | dns | rn
------+-----+-----+----
  800 |   1 |   1 |  1
  950 |   2 |   2 |  2
 1100 |   3 |   3 |  3
 1250 |   4 |   4 |  4     <- empate
 1250 |   4 |   4 |  5     <- empate
 1300 |   6 |   5 |  6     <- RANK pula o 5, DENSE_RANK não
 1500 |   7 |   6 |  7
 1600 |   8 |   7 |  8
 2450 |   9 |   8 |  9
 2850 |  10 |   9 | 10
 2975 |  11 |  10 | 11
 3000 |  12 |  11 | 12    <- empate
 3000 |  12 |  11 | 13    <- empate
 5000 |  14 |  12 | 14
```

Leia a última linha: 14 funcionários, e o maior salário é ao mesmo tempo
"posição 14" (`RANK`: é a 14ª linha, e os dois empates consumiram dois números
cada), "posição 12" (`DENSE_RANK`: existem 12 salários distintos) e "linha 14"
(`ROW_NUMBER`). A receita 11.9 do livro quer que empates compartilhem um
número *sem* lacunas, que é exatamente o `DENSE_RANK`.

A consequência prática aparece quando você filtra pelo ranking. "Os 2 maiores
salários" com `RANK` retorna três funcionários, porque os dois com 3000 estão
de fato empatados em segundo:

```sql
select ename, sal
  from (select ename, sal, rank() over (order by sal desc) as rnk from emp) t
 where rnk <= 2;
```

```
 ename | sal
-------+------
 KING  | 5000
 FORD  | 3000
 SCOTT | 3000
```

A mesma consulta com `ROW_NUMBER` retorna duas linhas e descarta em silêncio
um dos funcionários empatados; qual deles depende do plano:

```sql
select ename, sal
  from (select ename, sal, row_number() over (order by sal desc) as rn from emp) t
 where rn <= 2;
```

```
 ename | sal
-------+------
 KING  | 5000
 FORD  | 3000
```

As duas consultas estão corretas; elas respondem perguntas diferentes.
`RANK`/`DENSE_RANK` respondem "quais posições", `ROW_NUMBER` responde "me dê
exatamente N linhas".

**Suporte e sintaxe nos três engines.** As cinco funções (`LEAD`, `LAG`,
`RANK`, `DENSE_RANK`, `ROW_NUMBER`), além de `NTILE`, `PERCENT_RANK` e
`CUME_DIST`, existem hoje no PostgreSQL (window functions desde a 8.4, 2009),
no MySQL (8.0, 2018) e no SQL Server (a família `RANK` desde 2005, `LAG`/`LEAD`
desde 2012). Essa universalidade é recente o bastante para importar ao ler
código antigo: um MySQL anterior à 8.0 não tinha nenhuma delas, e é por isso
que exemplos de MySQL daquela época ranqueiam com self-joins ou variáveis de
usuário. Duas diferenças de sintaxe sobrevivem:

```sql
-- ORDER BY dentro do OVER: opcional no PostgreSQL/MySQL (e sem sentido sem ele),
-- OBRIGATÓRIO no SQL Server para funções de ranking e para LAG/LEAD.
select ename, row_number() over () from emp;   -- roda no PostgreSQL, não determinístico
```

```sql
-- Uma cláusula de frame em uma função de ranking: o PostgreSQL faz o parse e ignora;
-- a gramática do T-SQL para RANK/DENSE_RANK/ROW_NUMBER não tem ROWS/RANGE.
select rank() over (order by sal rows between 1 preceding and current row) from emp;
```

## Trade-offs

- **`RANK` deixa lacunas, `DENSE_RANK` não, `ROW_NUMBER` desempata
  arbitrariamente, e a escolha muda a quantidade de linhas de uma consulta
  filtrada.** Com os salários `5000, 3000, 3000, 2975` em ordem decrescente,
  `RANK` dá `1, 2, 2, 4` (a posição 3 é consumida pelo empate), `DENSE_RANK`
  dá `1, 2, 2, 3` e `ROW_NUMBER` dá `1, 2, 3, 4`. Filtre `rank <= 2` e três
  funcionários voltam; filtre `row_number() <= 2` e um dos empatados com 3000
  é descartado sem nenhum sinal de que isso aconteceu. Escolha `RANK` para
  "posições, as lacunas têm significado", `DENSE_RANK` para "níveis
  distintos", e `ROW_NUMBER` só quando você realmente quer exatamente N
  linhas.
  ```sql
  where rnk <= 2   -- KING 5000, FORD 3000, SCOTT 3000  (3 linhas)
  where rn  <= 2   -- KING 5000, FORD 3000              (2 linhas, SCOTT sumiu em silêncio)
  ```
- **`ROW_NUMBER` sobre um `ORDER BY` não único é não determinístico entre
  execuções.** A Microsoft diz isso com todas as letras: não há garantia de
  que as linhas recebam o mesmo `ROW_NUMBER` a cada execução, a menos que as
  colunas de partição e de ordenação sejam únicas, e o próprio conselho da
  documentação é usar `RANK`/`DENSE_RANK` quando não forem. Uma consulta de
  paginação ou deduplicação baseada em `ROW_NUMBER()` com chave de ordenação
  não única pode retornar a mesma linha duas vezes em duas páginas, ou pular
  uma, depois de nada além de uma mudança de plano. Acrescente uma coluna de
  desempate única (normalmente a chave primária) ao `ORDER BY` da cláusula
  `OVER` em vez de confiar numa estabilidade acidental.
- **`LEAD`/`LAG` se movem por posição de linha, então os empates da coluna de
  ordenação vazam para a resposta.** `lead(sal) over (order by hiredate)`
  compara um funcionário com quem calhar de vir em seguida entre os
  contratados no mesmo dia, e não com a próxima data de contratação distinta:
  um número errado de aparência plausível, em vez de um erro. A correção com
  offset calculado (`lead(sal, cnt-rn+1)`) é o remédio padrão e, na prática, é
  código de um único fornecedor; veja o conceito de linhas adjacentes para a
  exigência de cast do PostgreSQL e a restrição do MySQL a offsets literais.
- **Os `NULL`s de borda de `LEAD`/`LAG` têm peso e precisam ser tratados de
  propósito.** Todo `lead(x, n)` deixa `n` linhas no fim de cada partição com
  `NULL`, e todo `lag(x, n)` deixa `n` no início; então deslocar por 5 apaga
  cinco linhas, não uma. Usá-los em aritmética dá `NULL`, e em uma comparação
  dá `UNKNOWN`, que um `WHERE` trata como falso: `where sal < next_sal` exclui
  em silêncio a última linha em vez de dar erro. Use o terceiro argumento para
  um fallback constante ou `COALESCE` para um calculado (`min(sal) over ()`),
  mas decida: não herde o `NULL` por acidente.
- **Ranking não é de graça: é uma ordenação por cláusula `OVER` distinta.**
  Cada combinação distinta de `PARTITION BY`/`ORDER BY` em uma consulta é uma
  ordenação própria (ou uma varredura de índice, se existir um índice
  compatível) sobre a entrada; três funções de ranking que compartilham uma
  janela custam uma ordenação, três funções com três janelas diferentes custam
  três. PostgreSQL e MySQL permitem reaproveitar uma cláusula nomeada
  `WINDOW w AS (...)` em vários itens da lista do select, o que vale tanto pela
  legibilidade quanto pelo otimizador; no SQL Server, a alavanca equivalente é
  um índice cujas colunas-chave correspondam a `PARTITION BY` seguido de
  `ORDER BY`.
- **A portabilidade é boa, mas não total, e as diferenças estão na cláusula
  `OVER`, não nas funções.** O SQL Server exige `ORDER BY` dentro do `OVER`
  para toda função de ranking e para `LAG`/`LEAD`, enquanto PostgreSQL e MySQL
  aceitam `row_number() over ()` e devolvem uma sequência não determinística.
  Uma cláusula de frame em uma função de ranking passa pelo parse e é ignorada
  no PostgreSQL, enquanto a gramática do T-SQL não tem `ROWS`/`RANGE` para
  essas funções. Nenhuma das diferenças morde com frequência, mas as duas
  mordem na hora da migração, não na hora da revisão.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 11, "Advanced Searching", receitas 11.7, 11.8, 11.9, p. 345-351: doc
- [PostgreSQL Documentation: Window Functions (row_number, rank, dense_rank, lag, lead)](https://www.postgresql.org/docs/current/functions-window.html): doc
- [MySQL Reference Manual: Window Function Descriptions (LAG/LEAD offsets, RANK/DENSE_RANK/ROW_NUMBER)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html): doc
- [Microsoft Learn: ROW_NUMBER (Transact-SQL): ORDER BY obrigatório e não determinismo em empates](https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql): doc
- [Microsoft Learn: OVER Clause (Transact-SQL): funções de ranking não aceitam ROWS ou RANGE](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql): doc
