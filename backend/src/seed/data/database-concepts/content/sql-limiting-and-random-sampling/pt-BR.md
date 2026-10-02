---
version: 1.0
updatedAt: 2026-07-30
title: Limitando e Amostrando Aleatoriamente Resultados de Consultas
summary: Como o PostgreSQL, o MySQL e o SQL Server limitam o número de linhas que uma consulta retorna (LIMIT, TOP e o padrão ANSI FETCH FIRST, que o MySQL não suporta), como embaralhar a amostra antes de limitá-la e por que TABLESAMPLE é melhor que ORDER BY RANDOM() para tabelas grandes.
---
## Objective

Dois problemas intimamente relacionados aparecem em quase toda tarefa de SQL do dia a dia: limitar quantas linhas uma consulta retorna, e limitá-las *depois* de embaralhar a ordem das linhas, para que execuções sucessivas retornem uma amostra diferente. Todo banco de dados relevante resolve os dois, mas, diferente da maior parte do SQL, não existe uma sintaxe única que funcione em todos.

## Use Cases

- Paginar uma lista de UI ou uma resposta de API sem carregar uma tabela inteira na memória.
- Dar uma olhada rápida em algumas linhas de uma tabela grande durante uma depuração, sem esperar por um conjunto de resultados completo.
- Escolher uma amostra aleatória de linhas para uma demo, dados de seed ou uma verificação pontual que não seja enviesada pela ordem em que a tabela por acaso armazena as linhas.
- Evitar o erro clássico de tentar pegar "só a 5ª linha" com um filtro de igualdade sobre uma função de numeração de linhas, em vez de entender como essa função é de fato avaliada.

## Deep Dive

### Limitando a quantidade de linhas: LIMIT, TOP e o padrão ANSI

O PostgreSQL e o MySQL compartilham a mesma palavra-chave:

```sql
select * from emp limit 5;
```

O SQL Server coloca o limite na lista do SELECT:

```sql
select top 5 * from emp;
```

O PostgreSQL e o SQL Server (2012+) também suportam a forma do padrão ANSI SQL:2008, que se escreve igual nos dois:

```sql
select * from emp order by empno fetch first 5 rows only;
```

O MySQL **não** suporta essa forma ANSI: `LIMIT` é a única opção lá, então `FETCH FIRST` não é uma escolha portável segura entre os três bancos, apesar de ser "o padrão". Na prática, `LIMIT` e `TOP` continuam sendo o que as pessoas de fato escrevem no dia a dia; `OFFSET...FETCH` aparece mais em código de paginação gerado, ou quando o comportamento de `WITH TIES` é especificamente necessário.

> O Oracle adota uma abordagem realmente diferente: `WHERE ROWNUM <= 5` funciona, mas `WHERE ROWNUM = 5` nunca retorna uma linha. O ROWNUM é atribuído *à medida que cada linha é buscada*: a primeira linha recebe o número 1, é verificada contra a condição, e só então a próxima linha é buscada e numerada. Pedir `ROWNUM = 5` significa que toda linha antes da quinta é descartada (nunca satisfazendo `= 5`), então uma "linha cinco" que foi renumerada como "linha um" para fins de comparação nunca chega. É uma ilustração afiada de *quando* uma função de numeração é avaliada em relação às linhas que fluem pela consulta, a mesma categoria de surpresa que a ordem de avaliação entre `WHERE` e aliases de coluna.

### Embaralhando antes de limitar

O padrão é o mesmo em todo lugar: ordene por um valor aleatório e depois limite o resultado.

```sql
-- PostgreSQL
select ename, job from emp order by random() limit 5;

-- MySQL
select ename, job from emp order by rand() limit 5;

-- SQL Server
select top 5 ename, job from emp order by newid();
```

Uma constante numérica no `ORDER BY` ordena pela posição da coluna; uma chamada de função no `ORDER BY` ordena pelo *resultado* dessa função, reavaliado por linha, e é exatamente isso que transforma uma consulta determinística em uma aleatória aqui.

### Por que isso não escala, e o que substitui para tabelas grandes

`ORDER BY random()`/`rand()` precisa avaliar a função aleatória para cada linha e então ordenar todo o conjunto de resultados antes de conseguir devolver sequer 5 linhas: um full table scan mais uma ordenação O(n log n), não importa quão pequeno seja `n`. `TABLESAMPLE` evita os dois, amostrando no nível do armazenamento em vez do nível da linha:

```sql
-- PostgreSQL: amostra verdadeiramente aleatória (ainda lê todas as linhas, mas sem ordenação)
select * from emp tablesample bernoulli(10);

-- PostgreSQL: amostra mais rápida, por bloco (menos aleatória estatisticamente)
select * from emp tablesample system(10);

-- SQL Server: amostra por bloco/página
select * from emp tablesample system (10 percent);
```

O MySQL não tem equivalente a `TABLESAMPLE`: `ORDER BY rand() LIMIT n` (ou um contorno que amostra por um intervalo aleatório da chave primária) continua sendo a única opção lá, uma lacuna real de portabilidade para conhecer antes de presumir que uma técnica de amostragem funciona em todos os engines.

## Trade-offs

- **`LIMIT`/`TOP` são o que as pessoas de fato escrevem; `OFFSET...FETCH` é a forma portável que não é portável em todo lugar.** Funciona no PostgreSQL e no SQL Server, mas não no MySQL: "padrão ANSI" não significa "suportado por todo banco ainda em uso amplo".
- **`ORDER BY random()`/`rand()` troca simplicidade por custo em escala.** É uma linha e funciona com o mesmo espírito em todos os bancos, mas uma leitura completa seguida de ordenação em uma tabela grande é um custo real e mensurável: `TABLESAMPLE` é a correção, quando o banco suporta.
- **`TABLESAMPLE SYSTEM` é mais rápido que `BERNOULLI` exatamente pelo motivo que o torna menos aleatório estatisticamente:** ele amostra blocos inteiros de armazenamento em vez de linhas individuais, então as linhas dentro de um bloco amostrado não são escolhidas de forma independente. Use `SYSTEM` quando "aproximadamente N% da tabela, rápido" for suficiente; `BERNOULLI` quando a amostra precisar mesmo ser imparcial no nível da linha.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 1, "Retrieving Records", receitas 1.9 "Limiting the Number of Rows Returned" e 1.10 "Returning n Random Records from a Table", p. 8-11: doc
- [PostgreSQL Documentation: SELECT (LIMIT/OFFSET, FETCH, TABLESAMPLE)](https://www.postgresql.org/docs/current/sql-select.html): doc
- [PostgreSQL Documentation: Table Sampling Methods (BERNOULLI, SYSTEM)](https://www.postgresql.org/docs/current/tablesample-method.html): doc
- [MySQL Reference Manual: SELECT Statement (LIMIT only, no FETCH/TABLESAMPLE)](https://dev.mysql.com/doc/refman/8.0/en/select.html): doc
- [SQL Server Documentation: ORDER BY (OFFSET/FETCH)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql): doc
- [SQL Server Documentation: FROM clause (TABLESAMPLE)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql): doc
