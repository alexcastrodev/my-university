---
version: 1.0
updatedAt: 2026-08-05
title: Totais Acumulados, Produtos Acumulados e Agregações Móveis
summary: Uma única forma de window function, SUM/AVG OVER com um ORDER BY e um frame, resolve totais acumulados, produtos acumulados, médias móveis e acumuladores que reiniciam, incluindo por que um produto acumulado não tem agregação nativa e por que o frame RANGE padrão é uma armadilha relacionada a empates.
---
## Objective

Toda uma família de problemas de relatórios numéricos se reduz à mesma frase: "percorra uma série ordenada e acumule pelo caminho." Um total acumulado acumula por adição, um produto acumulado por multiplicação, uma média móvel acumula sobre uma janela *deslizante* em vez de uma que só cresce, e um saldo que reinicia acumula até que alguma condição mande recomeçar. Os quatro são a mesma forma de window function, `<aggregate>() OVER (PARTITION BY ... ORDER BY ... <frame>)`, com uma agregação diferente, um frame diferente ou uma chave de partição diferente. Aprenda a forma uma vez e as quatro receitas deixam de ser quatro receitas.

## Use Cases

- Relatórios de receita acumulada até a data, headcount até a data ou posição de estoque, em que cada linha precisa mostrar o total *até* aquela linha em vez do total geral.
- Crescimento composto sobre uma série ordenada (retorno acumulado de uma cadeia de fatores de crescimento diários, ou probabilidade acumulada de sobrevivência de defeitos ao longo de etapas de um processo), em que o acumulador multiplica em vez de somar.
- Suavizar uma métrica diária ruidosa (vendas, taxa de erros, latência) com uma média móvel, para que a tendência fique visível apesar da volatilidade causada pelo dia da semana e por artefatos de coleta.
- Um total acumulado que reinicia por período fiscal, por cliente ou por contrato: um saldo de conta que recomeça a cada ciclo de fatura, ou um contador de uso acumulado que zera a cada fronteira de cobrança.
- Um total acumulado cujo *sinal* depende de outra coluna: o saldo de um cartão de crédito em que compras somam e pagamentos subtraem.

## Deep Dive

### 7.6: Total acumulado com `SUM() OVER (ORDER BY ...)`

A segunda edição do livro já começa direto pela forma com window function, e não sobra nada para modernizar nela. Isto roda sem alterações no PostgreSQL, no MySQL 8.0+ e no SQL Server 2012+:

```sql
select ename, sal,
       sum(sal) over (order by sal, empno) as running_total
  from emp
 order by sal;
```

O detalhe que vale internalizar é *por que* `empno` está no `ORDER BY`. Só com `order by sal`, linhas que empatam em `sal` são **pares** (peers), e o frame padrão de uma janela ordenada é `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, que, no modo `RANGE`, inclui todos os pares da linha atual. Salários empatados acabam somados juntos, e as duas linhas empatadas mostram o mesmo total, adiantado:

```sql
select empno, sal,
       sum(sal) over (order by sal, empno) as running_total1,  -- correto
       sum(sal) over (order by sal)        as running_total2   -- pares colapsam
  from emp
 order by sal;
```

`WARD` e `MARTIN` ganham 1250; em `running_total2` os dois mostram 5350 em vez de 4100 e 5350. Existem duas correções, e elas não são equivalentes:

```sql
-- correção A (a do livro): tornar o ORDER BY único, para que nenhuma linha seja par de outra
sum(sal) over (order by sal, empno)

-- correção B: manter a ordenação e trocar o frame para linhas físicas
sum(sal) over (order by sal rows between unbounded preceding and current row)
```

A correção A é a preferível, porque ela também torna a *ordem de saída* determinística. A correção B produz um total estritamente crescente, mas deixa a cargo do engine qual linha empatada vem primeiro, então a mesma consulta pode devolver valores diferentes por linha em execuções diferentes.

### 7.7: Produto acumulado, a agregação que não existe

Não há agregação de janela `PRODUCT()` no PostgreSQL, no MySQL nem no SQL Server: não havia em 2020, quando o livro foi escrito, e não há hoje. O truque padrão é levar o problema para o espaço logarítmico, onde multiplicação vira adição, rodar a janela `SUM` lá e exponenciar de volta:

```sql
-- PostgreSQL / MySQL
select empno, ename, sal,
       exp(sum(ln(sal)) over (order by sal, empno)) as running_prod
  from emp
 where deptno = 10;
```

```sql
-- SQL Server: não há função LN; LOG(x) com um argumento É o logaritmo natural
select empno, ename, sal,
       exp(sum(log(sal)) over (order by sal, empno)) as running_prod
  from emp
 where deptno = 10;
```

Isso funciona porque `x * y = exp(ln(x) + ln(y))`, e herda todas as propriedades do total acumulado da receita 7.6: a mesma regra de desempate no `ORDER BY`, os mesmos padrões de frame.

Também herda o domínio de `ln`: **o logaritmo de zero ou de um número negativo é indefinido**, e cada engine reage a isso de um jeito. O PostgreSQL lança `ERROR: cannot take logarithm of zero` (ou `of a negative number`) e a consulta morre. O SQL Server lança um erro de domínio. O MySQL é o perigoso: `LN(0)` e `LN(-2)` retornam `NULL` apenas com um warning, que se propaga pelo `SUM` e transforma toda linha seguinte do produto acumulado em `NULL` sem nada que pareça uma falha.

Se a série pode conter zeros mas não negativos, o contorno documentado é deslocar a entrada, já que `ln(1) = 0` é a identidade multiplicativa no espaço logarítmico:

```sql
select exp(sum(ln(sal + 1)) over (order by sal, empno)) as shifted_prod
  from emp;
```

Note que isso muda a resposta (é um produto de `x+1`, não de `x`), então só é válido quando o deslocamento faz parte do modelo de domínio (fatores de crescimento, taxas de sobrevivência), e não como um remendo numérico. Se a série de fato contém negativos, o espaço logarítmico está fora de questão: trate o sinal separadamente (acompanhe a paridade da contagem de negativos e use `abs()` dentro do `ln`) ou recorra a uma CTE recursiva que multiplica linha a linha:

```sql
with recursive rp (empno, sal, rn, running_prod) as (
  select empno, sal, rn, sal
    from (select empno, sal, row_number() over (order by sal, empno) as rn
            from emp where deptno = 10) t
   where rn = 1
  union all
  select t.empno, t.sal, t.rn, rp.running_prod * t.sal
    from (select empno, sal, row_number() over (order by sal, empno) as rn
            from emp where deptno = 10) t
    join rp on t.rn = rp.rn + 1
)
select empno, sal, running_prod from rp order by rn;
```

A forma recursiva é correta para zeros e negativos, e consideravelmente mais lenta: ela força avaliação linha a linha, enquanto `exp(sum(ln(...)))` é uma única passada de janela. O SQL Server usa a mesma consulta com `with` em vez de `with recursive`.

### 7.8: Suavização com um frame deslizante, não com uma cadeia de `LAG`s

O livro monta sua média móvel de três pontos com chamadas de `LAG` somadas e divididas por três:

```sql
-- a forma do livro
select date1, sales,
       (sales
        + lag(sales, 1) over (order by date1)
        + lag(sales, 2) over (order by date1)) / 3 as moving_average
  from sales;
```

Isso funciona, e a variante ponderada (multiplicar cada lag por um coeficiente e dividir pela soma dos coeficientes) é de fato o motivo para recorrer a `LAG`. Mas para uma média móvel *não ponderada* é o caminho mais longo, e o próprio livro acena para a alternativa: "you can also use a partition with average." Essa alternativa é um frame `ROWS` explícito, suportado de forma idêntica no PostgreSQL, no MySQL 8.0+ e no SQL Server 2012+:

```sql
select date1, sales,
       avg(sales) over (order by date1
                        rows between 2 preceding and current row) as moving_average
  from sales;
```

Três diferenças importam. Primeiro, ampliar a janela de três para sete pontos é uma edição de um caractere (`6 preceding`), em vez de adicionar mais quatro termos de `LAG`. Segundo, a forma com `LAG` retorna `NULL` nas duas primeiras linhas, porque `NULL + 647 + 561` é `NULL`; a forma com frame de `AVG` calcula a média das linhas que existirem no frame, então a linha 1 retorna 647 e a linha 2 retorna 604, uma janela parcial em vez de um buraco. Nenhuma das duas é "a certa", mas são respostas diferentes e a escolha deve ser deliberada. Se o que você quer é um `NULL` estrito até a janela estar cheia, diga isso:

```sql
select date1, sales,
       case when count(*) over (order by date1 rows between 2 preceding and current row) = 3
            then avg(sales) over (order by date1 rows between 2 preceding and current row)
       end as moving_average
  from sales;
```

Terceiro, e esta é a armadilha recorrente: escrever `rows` aqui é obrigatório, não estilístico. `range between 2 preceding and current row` significa algo completamente diferente (uma janela de valores de duas *unidades* sobre `date1`), e no SQL Server nem chega a ser aceito: o T-SQL permite offsets numéricos apenas com `ROWS`, nunca com `RANGE`. O PostgreSQL e o MySQL aceitam frames `RANGE` com offset, o que torna um `RANGE` acidental um resultado silenciosamente errado nesses bancos, em vez de um erro de sintaxe.

### 7.15: Alterando valores dentro de um total acumulado

A versão do livro para "modificar o total acumulado com base em outra coluna" coloca uma expressão `CASE` *dentro* da agregação, de modo que o sinal de cada contribuição é decidido por linha antes mesmo de chegar ao `SUM`. Dada uma view `V` de transações de cartão de crédito em que `trx` é `'PR'` (compra) ou `'PY'` (pagamento):

```sql
select case when trx = 'PY' then 'PAYMENT' else 'PURCHASE' end as trx_type,
       amt,
       sum(case when trx = 'PY' then -amt else amt end)
         over (order by id, amt) as balance
  from V;
```

```
TRX_TYPE     AMT   BALANCE
PURCHASE     100       100
PURCHASE     100       200
PAYMENT       50       150
PURCHASE     100       250
PAYMENT      200        50
PAYMENT       50         0
```

Nada na janela mudou: continua sendo o `SUM() OVER (ORDER BY ...)` da receita 7.6. Só a *expressão que está sendo acumulada* mudou. Essa é a alavanca geral: qualquer lógica condicional que você consiga escrever em um `CASE` pode ser embutida no acumulador.

O problema relacionado, um total acumulado que **reinicia** em vez de inverter, é resolvido um nível acima, no `PARTITION BY` em vez de na expressão da agregação. A técnica é calcular uma chave de grupo que incrementa a cada reinício, usando um total acumulado da flag de reinício, e então particionar o total acumulado real por ela:

```sql
with grouped as (
  select id, amt, flag,
         sum(case when flag = 'RESET' then 1 else 0 end)
           over (order by id rows between unbounded preceding and current row) as grp
    from txn
)
select id, amt, flag, grp,
       sum(amt) over (partition by grp order by id) as running_total
  from grouped;
```

São duas window functions empilhadas: a interna transforma "uma flag que dispara de vez em quando" em "um número de grupo que incrementa a cada disparo", e a externa recomeça sua acumulação a cada novo número de grupo. Quando a fronteira de reinício pode ser derivada dos dados em vez de sinalizada (reinício por mês, por cliente), nenhuma janela interna é necessária, porque a chave de partição já existe:

```sql
-- reinicia a cada fronteira de mês
select date1, sales,
       sum(sales) over (partition by date_trunc('month', date1) order by date1)
         as month_to_date
  from sales;
```

A chamada `date_trunc` é do PostgreSQL; o MySQL escreve `date_format(date1, '%Y-%m')` e o SQL Server `datefromparts(year(date1), month(date1), 1)`. A sintaxe de janela ao redor é idêntica nos três.

## Trade-offs

- **`EXP(SUM(LN(x)))` não é um produto acumulado: é um produto acumulado para entradas estritamente positivas.** Zeros e negativos estão fora do domínio do logaritmo, e os três engines discordam sobre quão alto eles avisam disso: o PostgreSQL e o SQL Server lançam um erro, o MySQL retorna `NULL` com um warning que contamina silenciosamente todas as linhas seguintes. No MySQL o modo de falha é um relatório cheio de `NULL`s que um job noturno vai entregar sem reclamar.
  ```sql
  -- MySQL: nenhum erro, apenas NULL desta linha em diante
  select exp(sum(ln(v)) over (order by id)) from (select 1 id, 0 v) t;
  ```
- **O frame padrão é `RANGE`, não `ROWS`, e essa diferença só aparece quando os dados têm empates.** `SUM(x) OVER (ORDER BY d)` inclui todos os pares da linha atual, então um total acumulado sobre uma coluna de ordenação não única salta à frente em cada empate. O bug é invisível em dados de teste com valores distintos e aparece na primeira vez que a produção tem duas linhas no mesmo dia: coloque um critério de desempate único no `ORDER BY` e a questão desaparece por completo.
- **Escrever `RANGE` quando você queria `ROWS` falha de forma diferente em cada fornecedor.** O SQL Server rejeita offsets numéricos com `RANGE` em tempo de parse, então o erro é pego; o PostgreSQL e o MySQL aceitam frames `RANGE` com offset e calculam sem reclamar uma média sobre uma janela de valores quando a intenção era uma janela de linhas. O engine mais rígido é o que ajuda você aqui.
- **A chave de partição por grupo de reinício é elegante e genuinamente difícil de ler.** Duas window functions empilhadas, em que o `SUM` interno conta transições da flag para fabricar um número de grupo, é um idioma conhecido que ninguém adivinha na primeira leitura: ele precisa de um comentário ou de uma CTE bem nomeada (`grouped`, `reset_groups`) todas as vezes. Comparado com um loop procedural, é dramaticamente mais rápido e dramaticamente menos óbvio.
- **Uma janela parcial e uma janela `NULL` são respostas diferentes para "suavização".** Um `AVG` sobre `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` calcula a média de uma linha na linha 1 e de duas na linha 2, enquanto a forma com cadeia de `LAG` retorna `NULL` até existirem três valores. Nenhuma está errada, mas um gráfico construído sobre a primeira começa silenciosamente com um ponto mais ruidoso e calculado de outra forma: decida explicitamente em vez de herdar o que o seu idioma por acaso entrega.
- **Window functions precisam de uma ordenação, e a ordenação é o custo.** Todo total acumulado é uma ordenação `PARTITION BY` e depois `ORDER BY` sobre a entrada; quando ela transborda para o disco, domina a consulta. Os três fornecedores resolvem isso do mesmo jeito: um índice cujas colunas-chave iniciais coincidem com as colunas do `PARTITION BY` seguidas pelas colunas do `ORDER BY`, nessa ordem, permitindo ao engine ler as linhas já ordenadas em vez de ordená-las.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 7, "Working with Numbers", receitas 7.6, 7.7, 7.8, 7.15, p. 178-182, 196-197: doc
- [PostgreSQL Documentation: Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html): doc
- [MySQL Reference Manual: Window Function Frame Specification](https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html): doc
- [Microsoft Learn: OVER Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql): doc
