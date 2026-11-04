---
version: 1.0
updatedAt: 2026-11-04
title: "Data Warehouses, Data Marts e OLAP"
summary: "Warehouses versus bancos operacionais, esquemas estrela e floco de neve, data marts e as operações OLAP de roll-up, drill-down, slice, dice e pivot, com uma nota de livro vs hoje sobre warehouses colunares em nuvem."
---
## Objetivos de Aprendizagem

- Enunciar a definição de warehouse creditada a Inmon e projetar um esquema estrela declarando seu grão.
- Distinguir o que os campos de Inmon e de Kimball recomendam, com a fonte de cada afirmação.
- Escrever roll-up, drill-down, slice, dice e pivot em SQL, notando onde as fontes divergem.
- Prever e conferir a saída de `ROLLUP`, `CUBE` e `GROUPING SETS`.
- Evitar somar uma medida não aditiva e confundir um `NULL` real com um subtotal.

## Contexto e Motivação

O passo 2 de `the-kdd-process-and-the-data-mining-task-taxonomy` cria um conjunto de dados alvo, muitas vezes a partir de um warehouse. `operational-vs-analytical-systems` explica por que a análise roda separada da produção e como o ETL a alimenta, e `column-oriented-storage-for-analytics` explica o layout de armazenamento e os cubos materializados. Esta lição acrescenta a modelagem dos dados.

Quem usa OLAP formula a pergunta e lê um agregado. Pela definição de KDD, calcular uma quantidade predefinida não é mineração, pois não há busca. Fayyad et al. traçam a mesma linha: as ferramentas OLAP apoiam a análise interativa, "but the goal of KDD tools is to automate as much of the process as possible".

## Teoria Central

### O que é um warehouse

Chaudhuri e Dayal (1997), citando *Building the Data Warehouse* de Inmon (1992), dão a definição como "subject-oriented, integrated, time-varying, non-volatile collection of data that is used primarily in organizational decision making". Os autores que a citam variam o texto, então confira a fonte antes de citar. Cada termo é um requisito:

- **Orientado a assunto**: organizado em torno de vendas ou clientes, não de uma aplicação.
- **Integrado**: várias fontes conciliadas num só conjunto de nomes e códigos.
- **Variante no tempo**: o histórico é mantido, e cada fato se liga a um período.
- **Não volátil**: carregado e lido, em vez de atualizado no lugar por transações.

### Grão, fatos e dimensões

Um modelo dimensional tem uma **tabela de fatos** com medições e **tabelas de dimensão** com o contexto. Os quatro passos do Kimball Group são: selecionar o processo de negócio, declarar o grão, identificar as dimensões, identificar os fatos. O **grão** "establishes exactly what a single fact table row represents" e vem antes das dimensões e dos fatos, porque todos precisam concordar com ele.

As medidas têm três classes, nos termos de Kimball. As **aditivas** se somam em todas as dimensões (receita). As **semiaditivas** se somam em algumas (saldo de conta, não no tempo). As **não aditivas** não se somam (razões).

### Estrela e floco de neve

Um **esquema estrela**, segundo Chaudhuri e Dayal, tem uma única tabela de fatos e uma tabela para cada dimensão. Um **esquema floco de neve** normaliza as tabelas de dimensão, com "advantages in maintaining the dimension tables", enquanto a estrela "may be more appropriate for browsing the dimensions". O Kimball Group vai além: "you should avoid snowflakes because it is difficult for business users to understand and navigate snowflakes". Os dois guardam a mesma informação (Exemplo 5).

### Data marts e as duas arquiteturas

Um **data mart** é, nas palavras de Chaudhuri e Dayal, um dos "departmental subsets focused on selected subjects". Eles acrescentam que marts saem mais rápido, mas podem trazer problemas de integração sem um modelo de negócio completo.

Inmon, com Imhoff e Sousa, escreveu *Corporate Information Factory* (1998). Uma comparação aberta é a coluna de Margy Ross de 2004. Ela é escrita do lado de Kimball, então fala por uma das partes, e os livros de Inmon são vendidos:

| Questão | Corporate Information Factory (CIF) | Arquitetura de barramento de Kimball |
|---|---|---|
| Armazenamento normalizado antes do dimensional | obrigatório: um warehouse 3FN de dados atômicos | depende das fontes; nem defendido, nem proibido |
| Onde ficam os dados atômicos | no warehouse normalizado | em estruturas dimensionais |
| O que a camada dimensional guarda | resumos, por departamento | dados atômicos e resumidos, por processo de negócio |
| Como a integração acontece | pelo warehouse normalizado | por dimensões conformadas no barramento |

A coluna lista também o terreno comum: os dois querem visão corporativa desde o início e consideram problemáticos os marts independentes, o que o atalho "top-down contra bottom-up" esconde. Uma **dimensão conformada** tem os mesmos nomes de coluna e o mesmo conteúdo de domínio onde quer que apareça, o que alinha resultados de tabelas de fatos separadas num só relatório.

### Operações OLAP

| Operação | Significado aqui | Forma em SQL |
|---|---|---|
| Roll-up | subir numa hierarquia ou retirar uma dimensão | menos colunas no `GROUP BY` |
| Drill-down | o inverso, rumo ao detalhe | mais colunas no `GROUP BY` |
| Slice | fixar uma dimensão num valor | uma igualdade no `WHERE` |
| Dice | restringir duas ou mais dimensões | várias condições no `WHERE` |
| Pivot | transformar valores de linha em cabeçalhos de coluna | `PIVOT` |

**Aviso de variante.** A separação entre slice e dice acima é a da página OLAP cube da Wikipedia. Chaudhuri e Dayal tratam `slice_and_dice` como uma só operação: "reducing the dimensionality of the data, i.e., taking a projection of the data on a subset of dimensions for selected values of the other dimensions". A redação deles para roll-up também confunde: "doing a further group-by on one of the dimensions" se lê, no exemplo deles, como agregar essa dimensão, a forma com menos colunas. O roll-up do OLAP não é a palavra-chave SQL `ROLLUP`, que devolve vários níveis de agregação num só resultado.

**Os operadores SQL.** `GROUPING SETS` lista os agrupamentos a calcular. `ROLLUP (a, b, c)` dá os $n+1$ prefixos $(a,b,c),(a,b),(a),()$, então a ordem das colunas importa. `CUBE` dá todos os $2^n$ subconjuntos. Gray et al. introduziram o operador cubo e atribuem ao resultado $\prod_i(C_i+1)$ linhas para atributos de cardinalidade $C_i$, sendo `ALL` o valor extra. Em tabela esparsa, esse produto é só uma cota superior (Exemplo 3). O SQL mostra `ALL` como `NULL`, e `GROUPING()` ou `GROUPING_ID()` identifica essas linhas.

### Livro vs hoje: warehouses colunares em nuvem

Chaudhuri e Dayal (1997) descrevem o warehouse corporativo como "projected to be hundreds of gigabytes to terabytes in size", atendido por servidores ROLAP ou MOLAP com índices bitmap, índices de junção e resumos materializados. Três fontes posteriores mostram o que mudou.

- **2016, Snowflake** (Dageville et al.): disponível desde junho de 2015, guarda tabelas no Amazon S3 com os valores de cada coluna agrupados no arquivo e usa poda por mínimo e máximo em vez de índices B+-tree.
- **2020, Dremel e BigQuery** (Melnik et al.): "The industry has converged on an architecture that uses elastic compute services to analyze data in cloud storage."
- **2021, Lakehouse** (Armbrust et al., na Databricks): a arquitetura de warehouse "will wither in the coming years", substituída por sistemas sobre formatos abertos como Parquet. É a previsão de um fornecedor, não um achado.

Grão, fatos e dimensões são ideias lógicas, então a modelagem sobrevive. Um cubo pré-calculado agora é uma opção entre várias, já que varrer poucas colunas costuma bastar. Como uma medição, não um benchmark, o DuckDB 2.0.0 num Apple M1 Pro (10 threads) gravou `SELECT d, s, sum(rev) ... GROUP BY CUBE (d, s)` numa tabela temporária, a partir de 10 milhões de linhas em memória, em cerca de 0,015 segundo. As linhas vieram de `range(10000000)`, com `d = i % 365`, `s = i % 50` e `rev = hash(i) % 100`. Essas colunas são periódicas, então só mmc(365, 50) = 3650 dos 18.250 pares ocorrem, e o resultado tem 3650 + 365 + 50 + 1 = 4066 linhas. Com `d = hash(i) % 365` e `s = hash(i + 20000000) % 50`, todos os pares ocorrem, o que dá (365 + 1)(50 + 1) = 18.666 linhas em cerca de 0,02 segundo. `column-oriented-storage-for-analytics` explica por que visões materializadas seguem úteis em consultas pesadas e repetidas.

## Exemplos Resolvidos

Toda a saída abaixo é do DuckDB 2.0.0, sobre linhas inventadas.

### Exemplo 1: uma estrela, com o grão declarado

Processo: vendas. Grão: uma linha por cliente, produto, loja e mês. Dimensões: data, loja, produto. Fatos: `qty` e `revenue`. O cliente fica na tabela de fatos como rótulo.

```sql
CREATE TABLE dim_date   (date_key INT PRIMARY KEY, month VARCHAR, quarter VARCHAR);
CREATE TABLE dim_store  (store_key INT PRIMARY KEY, city VARCHAR, region VARCHAR);
CREATE TABLE dim_product(product_key INT PRIMARY KEY, product VARCHAR, category VARCHAR);
CREATE TABLE fact_sales (date_key INT, store_key INT, product_key INT,
                         customer VARCHAR, qty INT, revenue INT);

INSERT INTO dim_date VALUES (1,'01','Q1'), (2,'02','Q1'), (4,'04','Q2'), (5,'05','Q2');
INSERT INTO dim_store VALUES (1,'Recife','NE'), (2,'Salvador','NE'), (3,'Sao Paulo','SE');
INSERT INTO dim_product VALUES (1,'Atlas','Books'), (2,'Novel','Books'), (3,'Vinyl','Music');
INSERT INTO fact_sales VALUES
  (1,1,1,'ana',1,50), (1,1,3,'bia',2,60),  (2,2,2,'ana',3,45), (2,3,1,'caio',2,100),
  (2,3,3,'caio',1,30), (4,1,2,'bia',2,30), (4,2,3,'ana',1,30), (4,3,2,'duda',4,60),
  (5,1,1,'ana',1,50), (5,3,3,'duda',3,90);

CREATE VIEW sales AS
SELECT d.month, d.quarter, s.city, s.region, p.product, p.category, f.customer, f.qty, f.revenue
FROM fact_sales f
JOIN dim_date d USING (date_key)
JOIN dim_store s USING (store_key)
JOIN dim_product p USING (product_key);
```

A visão tem 10 linhas e receita total de 545.

### Exemplo 2: `ROLLUP` ao longo de uma hierarquia

```sql
SELECT region, city, sum(revenue) AS revenue
FROM sales
GROUP BY ROLLUP (region, city)
ORDER BY region NULLS LAST, city NULLS LAST;
```

```text
region  city       revenue
NE      Recife     190
NE      Salvador   75
NE      NULL       265
SE      Sao Paulo  280
SE      NULL       280
NULL    NULL       545
```

As linhas com cidade `NULL` são subtotais: $190+75=265$. A última linha é o total: $265+280=545$. Inverter os argumentos dá totais por cidade e um total geral, sem subtotais por região, então a ordem segue a hierarquia.

### Exemplo 3: `CUBE` e `GROUPING SETS`

```sql
SELECT quarter, category, sum(revenue) AS revenue
FROM sales
GROUP BY CUBE (quarter, category)
ORDER BY quarter NULLS LAST, category NULLS LAST;
```

```text
quarter  category  revenue
Q1       Books     195
Q1       Music     90
Q1       NULL      285
Q2       Books     140
Q2       Music     120
Q2       NULL      260
NULL     Books     335
NULL     Music     210
NULL     NULL      545
```

São $2^2=4$ conjuntos de agrupamento em $(2+1)(2+1)=9$ linhas. `GROUPING SETS` nomeia só os agrupamentos necessários, e `GROUPING()` marca a coluna agregada:

```sql
SELECT region, category, sum(revenue) AS revenue,
       GROUPING(region) AS g_region, GROUPING(category) AS g_category
FROM sales
GROUP BY GROUPING SETS ((region), (category), ())
ORDER BY g_region, g_category, region, category;
```

```text
region  category  revenue  g_region  g_category
NE      NULL      265      0         1
SE      NULL      280      0         1
NULL    Books     335      1         0
NULL    Music     210      1         0
NULL    NULL      545      1         1
```

Contando com `count(*)` e `count(DISTINCT GROUPING_ID(...))` sobre cada resultado:

```text
agrupamento                           conjuntos   linhas   produto de (C+1)
ROLLUP (quarter, region, category)    4           15       (nao e cubo)
CUBE   (quarter, region, category)    8           27       3*3*3 = 27
CUBE   (quarter, city, category)      8           33       3*4*3 = 36
```

A terceira linha fica abaixo porque só 9 das $2\cdot3\cdot2=12$ combinações de base ocorrem.

### Exemplo 4: slice, dice, drill-down, pivot

Desça do trimestre ao mês. As duas linhas de Q1 somam os 285 do trimestre:

```text
quarter  month  revenue
Q1       01     110
Q1       02     175
Q2       04     120
Q2       05     140
```

Um slice fixa uma dimensão, `WHERE quarter = 'Q1'`, agrupando pelas outras duas:

```text
region  category  revenue
NE      Books     95
NE      Music     60
SE      Books     100
SE      Music     30
```

Um dice restringe duas dimensões, `WHERE region = 'NE' AND category = 'Books'`, agrupando por trimestre e cidade:

```text
quarter  city      revenue
Q1       Recife    50
Q1       Salvador  45
Q2       Recife    80
```

Um pivot muda o layout e não os números:

```sql
PIVOT (SELECT region, quarter, revenue FROM sales)
ON quarter USING sum(revenue)
GROUP BY region
ORDER BY region;
```

```text
region  Q1   Q2
NE      155  110
SE      130  150
```

### Exemplo 5: o que não soma, e um floco de neve que soma

**Medidas não aditivas.** Clientes distintos não se somam entre trimestres, e não se tira média de médias quando os grupos têm tamanhos diferentes:

```text
quarter  customers  revenue  lines  avg_line
Q1       3          285      5      57.00
Q2       3          260      5      52.00
NULL     4          545      10     54.50

region  lines  revenue  avg_line
NE      6      265      44.17
SE      4      280      70.00
NULL    10     545      54.50

avg_of_avgs
57.08
```

O total é de 4 clientes, não $3+3$, pois ana e bia compraram nos dois trimestres. As médias regionais têm média 57,08, não 54,50, porque as regiões diferem em linhas. O conselho do Kimball Group é guardar os componentes aditivos e calcular no fim: $545/10=54{,}50$.

**A armadilha do `NULL`.** Acrescente um produto de categoria `NULL` com uma venda de 40. `COALESCE(category, 'ALL')` sobre `ROLLUP (category)`, ordenado por receita, produz duas linhas chamadas `ALL`:

```text
category  revenue
ALL       40
Music     210
Books     335
ALL       585
```

```sql
SELECT category, sum(revenue) AS revenue, GROUPING(category) AS is_total
FROM sales GROUP BY ROLLUP (category) ORDER BY is_total, category;
```

```text
category  revenue  is_total
Books     335      0
Music     210      0
NULL      40       0
NULL      585      1
```

Só `GROUPING()` separa a categoria desconhecida do total. As linhas extras saem antes do próximo passo.

**A mesma resposta de um floco de neve.** Divida `dim_store` em `dim_city (city_key, city, region_key)` e `dim_region (region_key, region)` e rode o `ROLLUP` do Exemplo 2 com duas junções. `EXCEPT` nas duas direções devolveu 0 linhas.

## Equívocos Comuns e Armadilhas

- **"Inmon diz warehouse, Kimball diz marts."** Pela coluna de Ross, Kimball monta modelos por processo de negócio, não por departamento, e a CIF também usa marts dimensionais.
- **"Warehouses colunares em nuvem tornaram a modelagem dimensional obsoleta."** Eles mudaram o armazenamento e a execução. O grão continua decidindo o que uma linha significa.

## Resumo

Um modelo dimensional declara seu grão e separa dimensões de fatos, e um floco de neve devolve as mesmas respostas. Marts são subconjuntos departamentais na definição de Chaudhuri e Dayal, e as arquiteturas CIF e de Kimball diferem sobretudo no armazenamento normalizado e em onde ficam os dados atômicos. As operações OLAP se traduzem em `GROUP BY`, `WHERE` e `PIVOT`. `ROLLUP` dá $n+1$ conjuntos de agrupamento e `CUBE` dá $2^n$, com $\prod_i(C_i+1)$ linhas só em dados densos. O armazenamento migrou para sistemas colunares em nuvem, e o modelo lógico ficou.

## Documentation Links

- [Chaudhuri and Dayal (1997), An Overview of Data Warehousing and OLAP Technology](https://www.cs.ubc.ca/~rap/teaching/504/2006/readings/chaudhuri-olap.pdf): a definição citando Inmon, marts, esquemas e operações OLAP.
- [Gray et al. (1997), Data Cube](https://arxiv.org/pdf/cs/0701155): o operador cubo e a cardinalidade $\prod_i(C_i+1)$.
- [Ross (2004), Differences of Opinion](https://www.kimballgroup.com/2004/03/differences-of-opinion/): barramento de Kimball contra CIF, do lado de Kimball.
- [Kimball Group, Four-Step Dimensional Design Process](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/four-4-step-design-process/): as quatro decisões de projeto.
- [Kimball Group, Grain](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/grain/): por que o grão vem antes de dimensões e fatos.
- [Kimball Group, Additive, Semi-Additive, and Non-Additive Facts](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/additive-semi-additive-non-additive-fact/): as três classes de medida.
- [Kimball Group, Snowflaked Dimensions](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/snowflake-dimension/): o argumento contra flocos de neve.
- [Kimball Group, Conformed Dimensions](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/conformed-dimension/): o que torna dimensões conformadas.
- [Wikipedia, Bill Inmon](https://en.wikipedia.org/wiki/Bill_Inmon): os livros dele, com *Corporate Information Factory*.
- [Wikipedia, OLAP cube](https://en.wikipedia.org/wiki/OLAP_cube): slice e dice como operações separadas.
- [Dageville et al. (2016), The Snowflake Elastic Data Warehouse](https://www.cs.purdue.edu/homes/csjgwang/CloudNativeDB/SnowflakeSIGMOD16.pdf): S3, arquivos colunares e poda sem índices.
- [Melnik et al. (2020), Dremel: A Decade of Interactive SQL Analysis at Web Scale](https://www.vldb.org/pvldb/vol13/p3461-melnik.pdf): armazenamento e computação separados, até o BigQuery.
- [Armbrust et al. (2021), Lakehouse](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper17.pdf): o argumento por formatos de arquivo abertos.
- [DuckDB 2.0, GROUPING SETS](https://duckdb.org/docs/2.0/sql/query_syntax/grouping_sets): `GROUPING SETS`, `ROLLUP`, `CUBE` e `GROUPING_ID`.
- [DuckDB 2.0, PIVOT statement](https://duckdb.org/docs/2.0/sql/statements/pivot): a sintaxe de pivot usada aqui.
