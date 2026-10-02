---
version: 1.0
updatedAt: 2026-08-05
title: Moda, Mediana e Detecção de Outliers com MAD
summary: Calcular a moda, a mediana e um score de outlier por desvio absoluto mediano em SQL, e por que o PostgreSQL, o MySQL e o SQL Server precisam cada um de uma consulta diferente para isso.
---
## Objective

`AVG` e `SUM` são as únicas medidas de tendência central que o SQL dá de graça, e as duas são a ferramenta errada no momento em que os dados são assimétricos: um único salário de 5000 arrasta a média de um departamento de catorze pessoas para um lugar em que nenhum funcionário real está. A moda (o valor que aparece com mais frequência), a mediana (o valor do meio de um conjunto ordenado) e o desvio absoluto mediano (MAD, a mediana da distância de cada valor até a mediana) são as alternativas robustas, e nenhuma delas pode ser escrita como uma simples chamada de agregação em SQL portável. A moda precisa de `GROUP BY` mais um passo de ranking; a mediana precisa de uma agregação de conjunto ordenado que só alguns fornecedores oferecem; o MAD é a técnica da mediana aplicada duas vezes, empilhada em CTEs.

## Use Cases

- Encontrar o tamanho de pedido, a quantidade de itens na cesta ou o plano de assinatura mais comum: o valor que o negócio realmente vê com mais frequência, que a média vai reportar tranquilamente como 3,7 itens.
- Calcular um salário mediano, um preço mediano ou um tempo de resposta mediano que não se mexe quando alguns valores extremos entram no dataset, diferente de uma média que um único outlier pode deslocar em uma ordem de grandeza.
- Reportar latências p50/p95/p99 a partir de uma tabela de métricas, em que a mesma máquina de percentis que produz a mediana produz os números da cauda.
- Sinalizar valores de transação anômalos para revisão de fraude ou de qualidade de dados com um limite baseado em MAD, em vez de um limite por desvio padrão que os próprios outliers que você procura já inflaram.
- Filtrar leituras importadas de sensores ou medidores em busca de erros de coleta antes que cheguem a um relatório, sem precisar primeiro presumir que os dados têm distribuição normal.

## Deep Dive

### Moda: `GROUP BY` + `COUNT`, depois ranquear as contagens

A moda dos salários do `DEPTNO 20` (`800, 1100, 2975, 3000, 3000`) é `3000`. Contar as ocorrências é a metade fácil:

```sql
select sal, count(*) as cnt
  from emp
 where deptno = 20
 group by sal;
```

A metade difícil é "manter só as linhas com a maior contagem, *todas* elas." `ORDER BY cnt DESC LIMIT 1` erra isso no instante em que dois valores empatam como mais frequentes: retorna um deles em silêncio. `DENSE_RANK` é a correção portável, porque atribui o mesmo rank a contagens empatadas:

```sql
select sal
  from (
        select sal,
               dense_rank() over (order by cnt desc) as rnk
          from (
                select sal, count(*) as cnt
                  from emp
                 where deptno = 20
                 group by sal
               ) x
       ) y
 where rnk = 1;
```

A consulta interna produz `(3000, 2)`, `(800, 1)`, `(1100, 1)`, `(2975, 1)`; `DENSE_RANK` rotula `3000` com rank 1 e todo o resto com rank 2; o filtro externo mantém o rank 1. Se `800` também aparecesse duas vezes, tanto `800` quanto `3000` voltariam, o que está correto, já que um dataset pode de fato ter mais de uma moda. Isto roda sem modificação no PostgreSQL, no MySQL e no SQL Server.

O **PostgreSQL** é o único dos três com uma moda nativa, como agregação de conjunto ordenado:

```sql
select mode() within group (order by sal)
  from emp
 where deptno = 20;
```

Leia a documentação antes de usá-la: `mode()` calcula o valor mais frequente, "escolhendo arbitrariamente o primeiro se houver vários valores igualmente frequentes." É uma linha que responde uma pergunta ligeiramente diferente da consulta com `DENSE_RANK`: uma moda, sempre, empates descartados.

O **SQL Server** não tem `mode()`, mas `TOP ... WITH TIES` expressa diretamente a intenção de preservar empates e se lê melhor que o ranking aninhado:

```sql
select top 1 with ties sal, count(*) as cnt
  from emp
 where deptno = 20
 group by sal
 order by count(*) desc;
```

O **MySQL** não tem nenhum dos dois (`LIMIT 1` não tem variante `WITH TIES`), então a forma com `DENSE_RANK` acima é o idioma.

### Mediana: `PERCENTILE_CONT(0.5)`, ou um contorno com window functions

A mediana é, por definição, o percentil 50, então os fornecedores que implementam as funções de distribuição inversa do padrão SQL a entregam diretamente.

O **PostgreSQL** trata `percentile_cont` como uma *agregação* de conjunto ordenado: sem cláusula `OVER`, e ela se combina com `GROUP BY` como qualquer outra agregação:

```sql
select percentile_cont(0.5) within group (order by sal) as median_sal
  from emp
 where deptno = 20;                       -- 2975

select deptno,
       percentile_cont(0.5) within group (order by sal) as median_sal
  from emp
 group by deptno;                         -- uma mediana por departamento
```

O PostgreSQL também traz `percentile_disc(0.5)`, que retorna o primeiro valor cuja posição na ordenação alcança a fração: um valor real de linha, nunca uma interpolação.

O **SQL Server** escreve a mesma função como função analítica: ela *exige* `OVER()` e retorna a mediana repetida em toda linha, e é por isso que o `DISTINCT` abaixo não é decoração:

```sql
select distinct percentile_cont(0.5) within group (order by sal) over () as median_sal
  from emp
 where deptno = 20;
```

Desde o SQL Server 2022 também existe `APPROX_PERCENTILE_CONT`, que *é* uma agregação de verdade (sem `OVER`, utilizável com `GROUP BY`), apoiada em um sketch KLL com um limite de erro documentado de até 1,33%:

```sql
select deptno,
       approx_percentile_cont(0.5) within group (order by sal) as approx_median
  from emp
 group by deptno;
```

O **MySQL** é o ponto fora da curva, e esta é a parte da receita que vale verificar em vez de presumir. O livro foi escrito em 2020 e afirma com clareza que o MySQL não tem `PERCENTILE_CONT`. Seis anos depois, isso *ainda* é verdade: o manual de referência atual do MySQL 9.x lista exatamente dezenove funções de agregação (`AVG`, `COUNT`, `MIN`, `MAX`, `SUM`, a família `STDDEV_*`/`VAR_*`, as agregações bit a bit e de JSON), sem `MEDIAN`, sem `PERCENTILE_CONT`, sem `PERCENTILE_DISC` e sem sintaxe `WITHIN GROUP`. A lista de window functions também não mudou: `CUME_DIST`, `DENSE_RANK`, `NTILE`, `PERCENT_RANK`, `RANK`, `ROW_NUMBER`, as funções de valor, e nada de distribuição inversa. O pedido de recurso está aberto no bug tracker do MySQL desde 2018. O MariaDB tem `MEDIAN` e `PERCENTILE_CONT` desde a 10.3; o MySQL propriamente dito não acompanhou.

Então o MySQL precisa de um contorno. O livro monta um com `CUME_DIST` mais um `UNION` que tira a média do valor mais próximo de cada lado da fronteira de 0,5:

```sql
with rank_tab (sal, rank_sal) as (
  select sal, cume_dist() over (order by sal)
    from emp
   where deptno = 20
),
inter as (
  select sal, rank_sal from rank_tab where rank_sal >= 0.5
  union
  select sal, rank_sal from rank_tab where rank_sal <= 0.5
)
select avg(sal) as median_sal
  from inter;
```

Uma formulação mais enxuta da mesma ideia usa `ROW_NUMBER` e um `COUNT(*)` com janela para endereçar aritmeticamente a(s) posição(ões) do meio, o que evita o `UNION` e trata quantidades ímpares e pares de linhas em uma expressão:

```sql
with ordered as (
  select sal,
         row_number() over (order by sal) as rn,
         count(*)     over ()             as n
    from emp
   where deptno = 20
)
select avg(sal) as median_sal
  from ordered
 where rn in (floor((n + 1) / 2), ceil((n + 1) / 2));
```

Com `n = 5`, `(n+1)/2` é `3`, então `floor` e `ceil` selecionam a linha 3 e o `AVG` tira a média de um único valor com ele mesmo: `2975`. Com `n` par, eles selecionam as duas linhas do meio e o `AVG` interpola entre elas, igualando a semântica de `PERCENTILE_CONT`. A CTE não é opcional em nenhuma das formas: nem `CUME_DIST` nem `ROW_NUMBER` podem aparecer em uma cláusula `WHERE`, então a window function precisa ser materializada um nível abaixo antes de poder ser filtrada.

### MAD: a técnica da mediana, aplicada duas vezes

A abordagem de detecção de outliers por desvio padrão (sinalizar qualquer coisa a mais de três σ da média) tem um problema de circularidade que o livro aponta explicitamente: ela presume uma distribuição normal, e tanto a média quanto σ são calculados a partir dos dados incluindo os outliers, então um único valor extremo infla exatamente o limite que deveria pegá-lo. O desvio absoluto mediano é a alternativa não paramétrica:

1. Calcule a mediana dos valores.
2. Calcule o desvio absoluto de cada valor em relação a essa mediana.
3. Calcule a mediana *desses desvios*: esse é o MAD.
4. Dê a cada valor o score `|valor − mediana| / MAD` e sinalize scores acima de ~3.

Como todo passo é uma mediana, nenhum valor extremo isolado consegue mover o limite. Na tabela `EMP` completa, o salário mediano é `1550` e o MAD é `675`; os `5000` de `KING` têm score `3450 / 675 ≈ 5,1` e são a única linha acima de 3, o que faz sentido, já que `KING` é o presidente.

O **PostgreSQL**, em que `percentile_cont` é uma agregação, encadeia de forma limpa por CTEs:

```sql
with med as (
  select percentile_cont(0.5) within group (order by sal) as median_sal
    from emp
),
dev as (
  select e.ename, e.sal, abs(e.sal - m.median_sal) as deviation
    from emp e cross join med m
),
mad as (
  select percentile_cont(0.5) within group (order by deviation) as mad
    from dev
)
select d.ename, d.sal, d.deviation / m.mad as mad_score
  from dev d cross join mad m
 where d.deviation / m.mad > 3;
```

O **SQL Server** tem a mesma forma, com `over ()` e `distinct` em cada passo de percentil, porque a forma analítica retorna uma linha por linha de entrada:

```sql
with med as (
  select distinct percentile_cont(0.5) within group (order by sal) over () as median_sal
    from emp
),
dev as (
  select e.ename, e.sal, abs(e.sal - m.median_sal) as deviation
    from emp e cross join med m
),
mad as (
  select distinct percentile_cont(0.5) within group (order by deviation) over () as mad
    from dev
)
select d.ename, d.sal, d.deviation / m.mad as mad_score
  from dev d cross join mad m
 where d.deviation / m.mad > 3;
```

No SQL Server 2022+, trocar as duas chamadas `percentile_cont(...) over ()` por `approx_percentile_cont(...)` elimina por completo a cerimônia de `distinct`/`over ()`, ao custo de uma resposta aproximada.

O **MySQL** paga duas vezes pela função ausente, já que as duas medianas precisam ser reconstruídas a partir de window functions:

```sql
with ordered as (
  select sal,
         row_number() over (order by sal) as rn,
         count(*)     over ()             as n
    from emp
),
med as (
  select avg(sal) as median_sal
    from ordered
   where rn in (floor((n + 1) / 2), ceil((n + 1) / 2))
),
dev as (
  select e.ename, e.sal, abs(e.sal - m.median_sal) as deviation
    from emp e cross join med m
),
dev_ordered as (
  select deviation,
         row_number() over (order by deviation) as rn,
         count(*)     over ()                   as n
    from dev
),
mad as (
  select avg(deviation) as mad
    from dev_ordered
   where rn in (floor((n + 1) / 2), ceil((n + 1) / 2))
)
select d.ename, d.sal, d.deviation / m.mad as mad_score
  from dev d cross join mad m
 where d.deviation / m.mad > 3;
```

> Uma correção que vale levar adiante: o `SELECT` final do livro na receita 7.16 é `abs(sal - MAD) / MAD`, comparando cada salário com a estatística de *desvio* em vez de com a mediana. O score MAD é `|valor − mediana| / MAD`, ou seja, o `deviation` já calculado dividido pelo MAD, que é o que as consultas acima usam. Nos dados de `EMP` a fórmula impressa por acaso sinaliza a mesma linha, mas ela mede a distância errada, e em dados em que a mediana e o MAD diferem mais ela não vai concordar.

## Trade-offs

- **Um dataset pode ter mais de uma moda, e todo atalho conveniente joga as extras fora.** `DENSE_RANK ... WHERE rnk = 1` e o `TOP 1 WITH TIES` do SQL Server retornam todos os valores empatados; o `mode()` do PostgreSQL e um simples `ORDER BY cnt DESC LIMIT 1` retornam exatamente um, escolhido arbitrariamente. Decida qual comportamento o relatório realmente quer antes de escolher a sintaxe: as duas consultas parecem intercambiáveis e não são.
  ```sql
  -- retorna UM valor mesmo quando dois salários empatam como mais frequentes
  select mode() within group (order by sal) from emp where deptno = 20;
  ```
- **`PERCENTILE_CONT` interpola; `PERCENTILE_DISC` retorna um valor real de linha.** Para um conjunto de tamanho par, `percentile_cont(0.5)` tira a média dos dois valores do meio e pode produzir um número que não aparece em lugar nenhum da tabela: tudo bem para um salário mediano, errado se a coluna for um id, um nível discreto ou qualquer coisa em que "um valor que existe" faça parte do contrato. Use `percentile_disc` quando a resposta precisar ser uma observação real.
- **O fator de escala do MAD é uma escolha, não uma constante entregue a você.** A razão bruta `|x − mediana| / MAD` usada acima não está na mesma escala de um z-score; a ponte convencional é multiplicar o MAD por `1,4826`, o que o torna um estimador consistente de σ para dados normalmente distribuídos, ou usar o z-score modificado de Iglewicz-Hoaglin `0,6745 · (x − mediana) / MAD` com limite de `3,5`. Fontes diferentes usam constantes e cortes diferentes, então "três desvios" não significa nada a menos que a escala seja informada junto.
- **O MAD degenera quando mais da metade dos valores é idêntica.** Se mais de 50% das linhas compartilham um valor, a mediana dos desvios é `0`, e todo score MAD vira uma divisão por zero em vez de um veredito de outlier. Colunas de baixa cardinalidade, colunas cheias de valores padrão e grupos pequenos caem nisso; proteja o divisor ou recorra a um método de intervalo interquartil.
- **A mediana ausente no MySQL é uma lacuna de portabilidade real e ainda aberta, não um artefato da época do livro.** É tentador presumir que o texto de 2020 simplesmente está desatualizado aqui, mas não está. O MySQL 9.x ainda não traz `MEDIAN`, nem `PERCENTILE_CONT`, nem sintaxe `WITHIN GROUP`, então qualquer lógica de mediana ou percentil que precise rodar tanto no MySQL quanto no PostgreSQL/SQL Server ou carrega dois textos de consulta, ou padroniza em todo lugar a forma mais lenta e verbosa com window functions. O MariaDB, notavelmente, fechou essa lacuna há anos.
- **Duas medianas significam duas ordenações completas.** Toda chamada `PERCENTILE_CONT` e todo `ROW_NUMBER() OVER (ORDER BY ...)` ordena a entrada inteira, e a receita do MAD faz isso duas vezes sobre o que é efetivamente o mesmo conjunto de linhas, mais um `CROSS JOIN` no meio. Em tabelas grandes isso é materialmente mais caro que `AVG`/`STDDEV`, que processam em uma passada; o `APPROX_PERCENTILE_CONT` do SQL Server existe justamente para trocar um erro limitado por esse custo, e vale considerá-lo quando a tabela deixar de ser pequena.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 7, "Working with Numbers", receitas 7.9, 7.10, 7.16, p. 182-187, 197-201: doc
- [PostgreSQL Documentation: Aggregate Functions (ordered-set aggregates: mode, percentile_cont, percentile_disc)](https://www.postgresql.org/docs/current/functions-aggregate.html): doc
- [Microsoft Learn: PERCENTILE_CONT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/percentile-cont-transact-sql): doc
- [MySQL Reference Manual: Aggregate Functions (still no MEDIAN or PERCENTILE_CONT as of 9.x)](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html): doc
