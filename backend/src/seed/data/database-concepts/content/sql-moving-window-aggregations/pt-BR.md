---
version: 1.0
updatedAt: 2026-08-06
title: Agregações de Janela com Várias Partições e Intervalos Móveis
summary: Calcular várias agregações diferentes em nível de partição lado a lado em uma única consulta, e janelas móveis delimitadas de forma simétrica ou por intervalo de valores, em vez de por uma contagem de linhas para trás.
---
## Objective

Dois padrões de agregação com janela ficam um passo além do básico coberto em [Running Totals, Running Products, and Moving Aggregates](sql-running-totals-and-moving-aggregates): calcular várias agregações *diferentes* em nível de partição lado a lado em uma única consulta (cada linha carregando seu próprio valor, o total do seu grupo, o total do grupo pai e o total geral como colunas separadas), e janelas móveis cujo frame não é um simples "últimas N linhas" para trás, mas uma janela simétrica que olha para a frente e para trás, ou um frame medido em *valores* (90 dias, 10 dólares) em vez de em contagem de linhas. O primeiro padrão trata de empilhar cláusulas `OVER` independentes; o segundo trata do que `ROWS`, `RANGE` e `GROUPS` de fato significam quando o frame deixa de ser `UNBOUNDED PRECEDING AND CURRENT ROW`.

## Use Cases

- Um relatório em que cada linha de detalhe mostra seu próprio valor ao lado do total do departamento, do total da família de cargos e do total da empresa: três dimensões de agrupamento diferentes em uma linha, sem self-joins.
- Colunas de proporção em relação ao total e de participação no grupo pai (`sal / sum(sal) over (partition by deptno)`), em que o denominador muda por coluna mas as linhas de detalhe precisam sobreviver.
- Uma média móvel *centralizada* de 7 dias que olha três dias para trás e três para a frente, em vez da média para trás, que fica atrasada em relação à tendência que deveria descrever.
- Suavizar uma série temporal ruidosa com uma janela simétrica larga (uma média de 15 ou 31 pontos sobre leituras de sensores, amostras de latência ou conversões diárias), em que janelas para trás deslocariam cada característica para a direita.
- Relatórios de gasto nos últimos 90 dias ou de transações dentro de ±1 hora, em que a janela é um intervalo de tempo e a série tem lacunas e timestamps duplicados, então contar linhas dá a resposta errada.

## Deep Dive

### Várias definições de partição em um SELECT

Cada cláusula `OVER` em uma lista de select é independente. Nada as obriga a compartilhar um `PARTITION BY`, então uma única passada sobre `emp` pode responder três perguntas de agrupamento diferentes de uma vez:

```sql
select ename,
       deptno,
       count(*) over (partition by deptno) as deptno_cnt,
       job,
       count(*) over (partition by job)    as job_cnt,
       count(*) over ()                    as total
  from emp;
```

```
ENAME  DEPTNO DEPTNO_CNT JOB        JOB_CNT  TOTAL
------ ------ ---------- --------- -------- ------
MILLER     10          3 CLERK            4     14
CLARK      10          3 MANAGER          3     14
KING       10          3 PRESIDENT        1     14
SCOTT      20          5 ANALYST          2     14
JAMES      30          6 CLERK            4     14
```

`count(*) over ()`, com parênteses vazios, significa "o conjunto de resultados inteiro", uma única partição contendo todas as linhas. Esta consulta roda sem alterações no PostgreSQL, no MySQL 8.0+ e no SQL Server 2012+; várias cláusulas `OVER` com chaves de partição diferentes nunca foram o problema de portabilidade desta receita.

O detalhe essencial é **quando** as window functions rodam: depois de `WHERE`, `GROUP BY` e `HAVING`, sobre as linhas que sobreviverem. Adicione um filtro e `TOTAL` deixa de ser a contagem de linhas da tabela:

```sql
select ename, count(*) over () as total
  from emp
 where deptno <> 10;   -- total agora é 11, não 14
```

A mesma regra de ordem morde pelo outro lado: o resultado de uma window function não pode ser referenciado no `WHERE`, porque ele ainda não existe. A correção nos três engines é empurrar a janela para uma view inline ou CTE e filtrar fora dela; nem o PostgreSQL, nem o MySQL, nem o SQL Server têm a cláusula `QUALIFY` que alguns engines analíticos oferecem exatamente para isso:

```sql
-- não passa no parse: deptno_cnt não existe no momento do WHERE
select ename, count(*) over (partition by deptno) as deptno_cnt
  from emp
 where count(*) over (partition by deptno) > 3;

-- a forma portável
with counted as (
  select ename, deptno,
         count(*) over (partition by deptno) as deptno_cnt
    from emp
)
select * from counted where deptno_cnt > 3;
```

Quando a mesma especificação se repete em várias colunas, a cláusula `WINDOW` dá um nome a ela uma vez. O PostgreSQL a tem há anos, o MySQL desde o 8.0 e o SQL Server desde o **2022 (16.x)**, e só com nível de compatibilidade do banco 160 ou superior, que é a única ressalva de implantação que vale lembrar:

```sql
select ename, deptno, job,
       count(*) over d as deptno_cnt,
       sum(sal)  over d as deptno_sal,
       count(*) over j as job_cnt,
       count(*) over () as total
  from emp
window d as (partition by deptno),
       j as (partition by job);
```

Isto deliberadamente *não* é `GROUP BY ... WITH ROLLUP` nem `GROUPING SETS`. Esses produzem linhas extras de resumo e colapsam o detalhe; a forma com janela mantém todas as linhas de detalhe e pendura as agregações nelas como colunas. Escolha pelo formato da saída: rollup para um relatório com linhas de subtotal, janelas para um relatório em que cada linha precisa do seu próprio contexto.

### Frames que olham para a frente, e frames medidos em valores

O conceito irmão cobre `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`, uma janela para trás. Duas extensões importam.

**Frames simétricos.** O fim de um frame pode ser `n FOLLOWING`, o que torna uma média móvel centralizada uma mudança de uma linha:

```sql
-- média centralizada de 7 dias: 3 para trás, o atual, 3 para a frente
select date1, sales,
       avg(sales) over (order by date1
                        rows between 3 preceding and 3 following) as centered_avg
  from sales;
```

Isto é frame `ROWS` padrão e funciona de forma idêntica no PostgreSQL, no MySQL 8.0+ e no SQL Server 2012+; a própria documentação de `OVER` da Microsoft usa `ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING` como exemplo canônico. O frame pode até ficar inteiramente de um lado da linha atual (`ROWS BETWEEN 7 PRECEDING AND 4 PRECEDING`); as únicas regras estruturais são que o início não pode ser `UNBOUNDED FOLLOWING`, o fim não pode ser `UNBOUNDED PRECEDING`, e o fim não pode vir antes do início na lista de opções.

Nas bordas da série o frame é *parcial*, não `NULL`: a primeira linha do exemplo acima faz a média de quatro valores (ela mesma mais três à frente), não sete. Se uma janela completa for obrigatória, condicione à contagem de linhas do próprio frame:

```sql
select date1, sales,
       case when count(*) over w = 7 then avg(sales) over w end as centered_avg
  from sales
window w as (order by date1 rows between 3 preceding and 3 following);
```

**Frames delimitados por valor.** A receita de padrão de gastos do livro pede a soma dos salários de todos contratados nos 90 *dias* anteriores: um intervalo de tempo, não uma contagem de linhas. Isso é `RANGE` com offset, e é aqui que a matriz de fornecedores do livro envelheceu:

```sql
-- PostgreSQL 11+
select hiredate, sal,
       sum(sal) over (order by hiredate
                      range between interval '90 days' preceding
                                and current row) as spending_pattern
  from emp;
```

```sql
-- MySQL 8.0+
select hiredate, sal,
       sum(sal) over (order by hiredate
                      range between interval 90 day preceding
                                and current row) as spending_pattern
  from emp;
```

O livro manda o **PostgreSQL** para uma subconsulta escalar aqui, com o argumento de que ele não tinha `RANGE` com offset. Isso já estava desatualizado na impressão: o PostgreSQL **11** (outubro de 2018) implementou a sintaxe completa de frames do SQL:2011 (`RANGE` com offset, o modo de frame `GROUPS` e `EXCLUDE`), cerca de dois anos antes de a segunda edição sair. Qualquer PostgreSQL com suporte hoje tem isso.

O **SQL Server** é aquele em que o conselho do livro ainda vale, e não por acaso. A limitação documentada do T-SQL é inequívoca, e continua presente na documentação do SQL Server 2025: *"Você não pode usar `RANGE` com `<unsigned value specification> PRECEDING` ou `<unsigned value specification> FOLLOWING`."* No SQL Server, `RANGE` aceita apenas `UNBOUNDED PRECEDING`, `CURRENT ROW` e `UNBOUNDED FOLLOWING`. Então uma janela de 90 dias precisa da subconsulta correlacionada (ou do self-join equivalente) que o livro dá:

```sql
-- SQL Server: sem RANGE com offset, então o frame vira um predicado
select e.hiredate,
       e.sal,
       (select sum(d.sal)
          from emp d
         where d.hiredate between dateadd(day, -90, e.hiredate)
                              and e.hiredate) as spending_pattern
  from emp e
 order by 1;
```

Trocar por `ROWS BETWEEN 90 PRECEDING AND CURRENT ROW` não é uma correção: significa "as últimas 90 linhas", o que, para uma série de datas de contratação com lacunas e datas duplicadas, é uma pergunta diferente com uma resposta diferente. `RANGE` também trata os pares como uma unidade: os dois funcionários contratados em 03-DEC-2011 mostram os mesmos 11700, porque `CURRENT ROW` no modo `RANGE` significa "todas as linhas que compartilham o meu valor de ordenação."

O terceiro modo de frame, `GROUPS`, conta *grupos de pares* em vez de linhas ou valores ("o grupo de pares desta linha mais os dois anteriores"), que é a ferramenta certa para "três datas distintas para trás" em uma série com várias linhas por data. O PostgreSQL o suporta; o MySQL 8.4 e o SQL Server 2025 ainda não, e não há reescrita curta: emulá-lo significa `dense_rank()` em uma subconsulta e depois uma janela com frame `ROWS` ou `RANGE` sobre esse rank.

## Trade-offs

- **Cada especificação de janela distinta é potencialmente uma ordenação própria.** Window functions que compartilham um `PARTITION BY`/`ORDER BY` idêntico têm a garantia de ver a mesma ordem de linhas e são calculadas em uma passada; especificações diferentes podem exigir cada uma um passo de ordenação adicional. Uma lista de select com `partition by deptno`, `partition by job` e `over ()` é conveniente, mas não é de graça: são três definições de janela, e o plano vai mostrar isso. Um índice cujas colunas iniciais coincidem com o `PARTITION BY` e depois o `ORDER BY` elimina uma dessas ordenações, nunca todas.
- **Window functions rodam depois do `WHERE`, o que muda o "total geral" e impede filtrar pelo resultado.** `count(*) over ()` conta as linhas que sobreviveram aos predicados, não as linhas da tabela: um relatório filtrado para uma região informa em silêncio a contagem dessa região como o total da empresa. E como o valor não existe no momento do `WHERE`, filtrar por ele exige uma CTE ou view inline nos três engines; não há `QUALIFY` no PostgreSQL, no MySQL nem no SQL Server para encurtar isso.
- **`RANGE` com offset é portável entre PostgreSQL e MySQL, mas simplesmente não existe no SQL Server.** É uma limitação real e atual do T-SQL, não um artefato da época do livro: `PRECEDING`/`FOLLOWING` com offset só é válido com `ROWS`, então qualquer janela de intervalo de tempo no SQL Server recorre a uma subconsulta correlacionada ou self-join, uma leitura por linha onde os outros dois engines fazem uma única passada ordenada.
- **Frames simétricos vazam o futuro, e isso é uma questão de corretude, não de estilo.** Uma média móvel centralizada no dia *t* é calculada a partir dos dias *t+1*..*t+3*, então não pode ser produzida em tempo real, e usá-la como feature em um modelo de previsão é viés de antecipação (lookahead bias) na forma mais pura. É a escolha certa para gráficos retrospectivos e a errada para qualquer coisa que depois será avaliada contra dados que ela já viu.
- **Frames parciais nas bordas são silenciosos, não barulhentos.** Uma média `ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING` retorna um valor já na primeira linha (média de quatro pontos em vez de sete), então o início e o fim de uma série suavizada são sistematicamente mais ruidosos que o meio, sem nada que os marque. Condicionar a `count(*) over w` torna as janelas incompletas `NULL` e explícitas.
- **`ROWS`, `RANGE` e `GROUPS` respondem três perguntas diferentes, e só uma delas é sobre contagem de linhas.** Em uma série com lacunas ou valores de ordenação duplicados, os três dão resultados diferentes, e o erro é silencioso no PostgreSQL e no MySQL, onde os três passam no parse. Pergunte em qual unidade está a pergunta de negócio (linhas, valores ou valores distintos) antes de escrever o frame, porque a consulta vai rodar de qualquer jeito.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 12, "Reporting and Reshaping", receitas 12.18, 12.19, p. 420-429: doc
- [PostgreSQL Documentation: Window Function Calls (frame_clause: ROWS, RANGE, GROUPS, EXCLUDE)](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS): doc
- [MySQL Reference Manual: Window Function Frame Specification](https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html): doc
- [Microsoft Learn: OVER Clause (Transact-SQL): ROWS or RANGE and its limitations](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql): doc
- [Microsoft Learn: WINDOW clause (Transact-SQL), SQL Server 2022+](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-window-transact-sql): doc
