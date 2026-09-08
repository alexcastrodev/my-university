---
version: 1.0
updatedAt: 2026-08-06
title: "Agrupando Dados em Buckets e Histogramas de Texto"
summary: Dividindo um conjunto de resultado em buckets de tamanho fixo com ROW_NUMBER e CEILING versus um número fixo de buckets com NTILE, depois renderizando a distribuição como um histograma de texto horizontal ou vertical.
---
## Objective

Existem duas perguntas diferentes escondidas atrás de "divida esse conjunto de resultado em grupos." Uma fixa o *tamanho* de cada bucket: todo bucket guarda exatamente cinco linhas, e quantos buckets isso leva é o que for necessário. A outra fixa a *contagem* de buckets: exatamente quatro buckets, cada um guardando o mais próximo possível de uma parcela igual das linhas que o dado permite. A primeira é um `ROW_NUMBER()` dividido e arredondado para cima; a segunda é precisamente para o que `NTILE(n)` foi inventado. Uma vez que as linhas estão agrupadas, a forma mais barata de *observar* a distribuição resultante sem sair do prompt SQL é um histograma de texto: uma linha por categoria com uma string de caracteres `*` repetidos (horizontal), ou uma pilha pivotada de linhas onde cada linha de saída é uma camada das barras (vertical).

## Use Cases

- Dividir uma lista ordenada em páginas de exatamente N itens para processamento em lote: entregar a cada worker um bloco contíguo de 500 linhas, deixando o número de blocos decorrer da contagem de linhas.
- Dividir salários em exatamente 4 buckets de quartil (ou 10 decis, ou 100 percentis) para relatório de percentil, onde a *contagem* de bucket é a parte fixa do requisito e o tamanho do bucket é o que o dado der.
- Calcular a média de uma métrica por bucket para revelar uma tendência que a variabilidade por linha esconde: a própria motivação do livro para uma contagem de bucket predefinida.
- Um histograma rápido e informal de console ou saída de log de contagens de pedido por categoria, em uma sessão psql/sqlcmd ou no stdout de um cron job, onde montar um gráfico de verdade é mais esforço do que a pergunta merece.

## Deep Dive

### Buckets de tamanho fixo: ranquear, dividir, arredondar para cima

O truque inteiro é que `ROW_NUMBER()` transforma uma ordenação arbitrária em um contador denso 1..N, e aritmética inteira sobre esse contador é tudo que um número de bucket sempre foi. Para ter grupos de cinco:

```sql
select ceiling(row_number() over (order by empno) / 5.0) as grp,
       empno,
       ename
  from emp
 order by grp, empno;

 GRP  EMPNO  ENAME
 ---  -----  ------
   1   7369  SMITH
   1   7499  ALLEN
   1   7521  WARD
   1   7566  JONES
   1   7654  MARTIN
   2   7698  BLAKE
   ...
   3   7934  MILLER
```

As linhas 1-5 dividem para `0.2 … 1.0`, todas as quais arredondam para `1`; as linhas 6-10 caem em `(1, 2]` e arredondam para `2`; as quatro linhas restantes formam um bucket final curto. O número de buckets nunca é declarado em lugar nenhum da consulta; é `ceiling(rowcount / 5)`, emergente do dado.

Duas notas de portabilidade que o livro sinaliza, ambas ainda exatamente verdadeiras:

- **`CEIL` não é universal, `CEILING` é.** PostgreSQL e MySQL aceitam as duas grafias; SQL Server só tem `CEILING`. Escrever `CEILING` em todo lugar não custa nada e remove a diferença.
- **O `5.0` é estrutural.** `row_number()` retorna `bigint`, e `bigint / 5` é divisão *inteira* nos três motores: ela trunca, então as linhas 1-4 cairiam no bucket 0 e a numeração inteira mudaria. O `.0` força divisão numérica antes de `CEILING` ver isso.

Se você preferir ficar em aritmética inteira e pular a ida e volta numérica por completo, a forma baseada em zero é equivalente e não tem literal decimal para esquecer:

```sql
select (row_number() over (order by empno) - 1) / 5 + 1 as grp,
       empno, ename
  from emp;
```

### Um número predefinido de buckets: `NTILE(n)` nativamente

Esse é o enquadramento inverso: a contagem de bucket é fixa, os tamanhos de bucket são o que sobrar, e não precisa de nenhuma aritmética. `NTILE` é uma função de janela padrão e está presente no PostgreSQL, SQL Server, e MySQL 8.0+ há anos; a 2ª edição do livro já a dá como *a* solução ("simples agora que a função NTILE está amplamente disponível"), sem nenhum fallback feito à mão. Essa avaliação só ficou mais segura desde então:

```sql
select ntile(4) over (order by empno) as grp,
       empno,
       ename
  from emp;

 GRP  EMPNO  ENAME
 ---  -----  ------
   1   7369  SMITH
   1   7499  ALLEN
   1   7521  WARD
   1   7566  JONES     -- bucket 1: 4 rows
   2   7654  MARTIN
   ...                 -- bucket 2: 4 rows
   3   7839  KING
   ...                 -- bucket 3: 3 rows
   4   7900  JAMES
   4   7902  FORD
   4   7934  MILLER    -- bucket 4: 3 rows
```

Quatorze linhas em quatro buckets não divide igualmente, e a regra de distribuição vale a pena conhecer precisamente porque *não* é aleatória. O SQL Server a documenta por completo: "se o número de linhas em uma partição não for divisível por *integer_expression*, isso causa grupos de dois tamanhos que diferem por um membro. Grupos maiores vêm antes de grupos menores na ordem especificada pela cláusula `OVER`." O PostgreSQL a redige como "dividindo a partição da forma mais igual possível", e o MySQL não a explica em prosa de todo, mas os três implementam a mesma regra, e a própria saída do livro confirma isso: os buckets 1 e 2 recebem quatro linhas, os buckets 3 e 4 recebem três.

A consequência: tamanhos de bucket nunca diferem por mais de um, e as linhas extras sempre vão para a *frente*. Se sua ordenação é `ORDER BY sal DESC`, isso significa que o quartil superior é o que é preenchido.

Uma diferença de fornecedor no próprio argumento: o SQL Server aceita qualquer *expressão* `int`/`bigint`, incluindo uma variável, então `NTILE(@n)` funciona. O MySQL restringe `N` a uma constante literal, um marcador de parâmetro `?`, uma variável definida pelo usuário, ou uma variável local de rotina armazenada, e `NTILE(NULL)` é rejeitado diretamente em vez de retornar `NULL`.

```sql
-- the practical quartile query
select deptno,
       ntile(4) over (order by sal desc) as sal_quartile,
       ename, sal
  from emp;
```

### Histogramas horizontais: `COUNT(*)` alimentando um repetidor de string

Um histograma horizontal é um `GROUP BY` cujo agregado é alimentado a uma função de repetição de string em vez de ser impresso como um número. Cada categoria é uma linha, e a barra cresce da esquerda para a direita:

```sql
-- PostgreSQL
select deptno,
       repeat('*', count(*)::int) as cnt
  from emp
 group by deptno
 order by deptno;

 DEPTNO  CNT
 ------  ------
     10  ***
     20  *****
     30  ******
```

O nome da função é a única coisa que muda por motor:

```sql
-- MySQL
select deptno, repeat('*', count(*)) as cnt
  from emp group by deptno;

-- SQL Server
select deptno, replicate('*', count(*)) as cnt
  from emp group by deptno;

-- the book's LPAD variant, portable to PostgreSQL/MySQL/Oracle
select deptno, lpad('*', count(*)::int, '*') as cnt
  from emp group by deptno;
```

Aquele cast `::int` nas versões PostgreSQL não é cosmético, e o aviso do livro sobre isso ainda é atual. `count(*)` retorna `bigint`, `repeat` e `lpad` são declarados como `repeat(text, integer)` e `lpad(text, integer [, text])`, e o cast `bigint → integer` do PostgreSQL é *só de atribuição*, não implícito: então a resolução de função simplesmente falha:

```
ERROR:  function repeat(unknown, bigint) does not exist
HINT:   No function matches the given name and argument types.
```

MySQL e SQL Server ambos coagem a contagem silenciosamente, então essa é uma frustração exclusiva do PostgreSQL.

`REPEAT`/`REPLICATE` dizem o que fazem; `LPAD` só produz uma barra porque o caractere de padding e o caractere semente por acaso são o mesmo `*`, o que é um pequeno trocadilho em vez de intenção. Recorra a `REPEAT`/`REPLICATE` primeiro. Dois casos de borda que vale a pena saber quando a contagem pode ser zero ou negativa (possível uma vez que você está somando uma coluna com sinal em vez de contar linhas): o `REPEAT` do MySQL retorna uma string vazia para `count < 1`, enquanto o `REPLICATE` do SQL Server retorna `NULL` para um argumento negativo.

### Histogramas verticais: pivot `ROW_NUMBER()` + `MAX()`, e a armadilha de ordenação de NULL

Girar as barras 90 graus significa que cada linha de saída é uma *camada* através de todas as categorias, então a técnica é um pivot. `ROW_NUMBER()` particionado por categoria numera cada `*` dentro de sua barra; `MAX()` agrupado por esse número colapsa as colunas esparsas por categoria em uma única linha por camada:

```sql
select max(deptno_10) as d10,
       max(deptno_20) as d20,
       max(deptno_30) as d30
  from (
        select row_number() over (partition by deptno order by empno) as rn,
               case when deptno = 10 then '*' end as deptno_10,
               case when deptno = 20 then '*' end as deptno_20,
               case when deptno = 30 then '*' end as deptno_30
          from emp
       ) x
 group by rn
 order by 1 desc, 2 desc, 3 desc;

 D10  D20  D30
 ---  ---  ---
            *
       *    *
       *    *
  *    *    *
  *    *    *
  *    *    *
```

A consulta interna produz uma linha por funcionário com um `*` em exatamente uma das três colunas e `NULL` nas outras duas. Agrupar por `rn` coloca a camada 1 de todos os três departamentos em uma linha, a camada 2 na próxima, e assim por diante; `MAX()` escolhe o valor não `NULL` de cada coluna porque `MAX` ignora `NULL`s.

**A direção do `ORDER BY` depende do motor, e essa é a única coisa que vai silenciosamente renderizar seu gráfico de cabeça para baixo.** Uma barra vertical precisa ter seus vazios (`NULL`s) no *topo* para parecer que cresce de baixo, o que significa que a ordenação precisa colocar `NULL`s primeiro:

- **PostgreSQL** (e Oracle) ordenam `NULL`s *por último* em `ASC`, então `DESC` é necessário, como escrito acima.
- **SQL Server e MySQL** ordenam `NULL`s *primeiro* em `ASC`, então esses motores querem um `order by 1, 2, 3` simples. Isso é exatamente o comentário entre parênteses do livro de "usuários de SQL Server não deveriam usar `DESC`."

O PostgreSQL deixa você parar de adivinhar declarando isso diretamente, que é o que você quer em uma consulta que outra pessoa vai ler:

```sql
-- PostgreSQL: intent is explicit, no reliance on the engine's default
 order by 1 nulls first, 2 nulls first, 3 nulls first;
```

MySQL e SQL Server não têm nenhuma cláusula `NULLS FIRST`/`NULLS LAST` no `ORDER BY` de todo, então nesses motores o padrão de fato é o mecanismo, e o workaround quando você precisa da outra direção é uma expressão como `ORDER BY (d10 IS NULL) DESC` (MySQL) ou `ORDER BY CASE WHEN d10 IS NULL THEN 0 ELSE 1 END` (SQL Server).

Note também que as colunas de categoria são fixas no código: `deptno_10`, `deptno_20`, `deptno_30`. A *forma* de um histograma vertical depende do número de categorias distintas, e a lista de coluna de uma instrução SQL é fixa no momento do parse, então não há como fazer isso se adaptar a novos departamentos sem gerar o SQL. Essa limitação é estrutural, não uma lacuna em nenhum motor em particular.

## Trade-offs

- **`NTILE` garante contagem de bucket, não igualdade de bucket, e o desequilíbrio é carregado na frente.** Quando as linhas não dividem igualmente, buckets diferem em tamanho por exatamente um e os maiores vêm primeiro na ordem do `OVER`. Para 14 linhas em 4 buckets isso é um inofensivo 4/4/3/3, mas para 5 linhas em 4 buckets é 2/1/1/1: o bucket 1 guarda o dobro do que o bucket 4 guarda. Qualquer relatório que compara *totais* de bucket em vez de *médias* de bucket vai ler essa distorção como um sinal real quando é um artefato da contagem de linha.
- **`NTILE` também divide empates entre fronteiras de bucket.** Ele numera por posição, não por valor, então duas linhas com `sal` idêntico podem cair em quartis diferentes dependendo só de como o `ORDER BY` desempatou. Se seu requisito é genuinamente "todo mundo com o mesmo salário recebe o mesmo bucket", `NTILE` é a função errada e você quer `PERCENT_RANK()`/`CUME_DIST()` com fronteiras de faixa explícitas em vez disso.
- **Tamanho fixo vs. contagem fixa é uma decisão de modelagem real, não uma preferência de sintaxe.** Trabalho de lote/paginação quer *tamanho* fixo (o orçamento de memória de um worker é por bloco, e uma contagem de bloco variável é aceitável); relatório estatístico quer *contagem* fixa (quartis precisam ser quartos, e um número variável de quartis não faz sentido). Escolher o enquadramento errado produz uma consulta que funciona e responde a pergunta errada.
- **Histogramas horizontais leem melhor; verticais cabem mais categorias mal.** Uma barra horizontal tem comprimento efetivamente ilimitado (uma barra de contagem 20.000 só precisa de um divisor de escala), e adicionar uma categoria é mais uma linha. Um histograma vertical é limitado pela altura do terminal para a barra mais alta *e* pela lista de coluna fixa no código para o número de categorias, e precisa de um pivot mais uma regra de ordenação de `NULL` por motor além disso. Vertical parece mais um gráfico; horizontal é o que você deveria usar por padrão.
- **Além de uma consulta rápida de debug, uma ferramenta de gráfico de verdade ganha em todo eixo.** Um histograma de texto não tem rótulos de eixo, nenhuma escala, nenhuma forma de representar uma contagem que excede a largura do terminal sem enganar silenciosamente, e é construído a partir de uma suposição de fonte de largura fixa que quebra no momento em que a saída pousa em uma página web ou um email de fonte proporcional. Ele ganha seu lugar em uma sessão psql, no log de um cron job, ou em um bloco de código do Slack; assim que a saída tem uma audiência humana que vai olhar duas vezes, as contagens pertencem a um gráfico de verdade e o SQL deveria só retornar números.
- **A lista de coluna do pivot vertical não consegue ser guiada por dado.** Adicionar um departamento significa editar a consulta: o número de colunas `CASE` é fixo no momento do parse. O `crosstab()` do PostgreSQL (da extensão `tablefunc`) move o pivot para uma função mas ainda exige que você declare a lista de coluna de saída, então muda onde a fixação no código mora sem removê-la.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 12, "Reporting and Reshaping", recipes 12.7, 12.8, 12.9, 12.10, p. 386-394] - doc
- [PostgreSQL Documentation: Window Functions (`ntile`)](https://www.postgresql.org/docs/current/functions-window.html) - doc
- [PostgreSQL Documentation: String Functions (`repeat`, `lpad`)](https://www.postgresql.org/docs/current/functions-string.html) - doc
- [MySQL Reference Manual: Window Function Descriptions (`NTILE`)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) - doc
- [MySQL Reference Manual: String Functions (`REPEAT`, `LPAD`)](https://dev.mysql.com/doc/refman/8.4/en/string-functions.html) - doc
- [SQL Server Documentation: NTILE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/ntile-transact-sql) - doc
- [SQL Server Documentation: REPLICATE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/replicate-transact-sql) - doc
