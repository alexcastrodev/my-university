---
version: 1.0
updatedAt: 2026-07-30
title: "Ordenação Condicional: NULLs e Ordem Dependente de Dado em SQL"
summary: Como ordenar NULLs para uma posição específica independentemente da ordem dos valores não NULL, e como ordenar por uma chave que depende do valor de outra coluna; e por que a afirmação do livro de que o PostgreSQL precisa do mesmo workaround que MySQL/SQL Server para ordenação de NULL é simplesmente errada (o PostgreSQL tem NULLS FIRST/LAST nativo desde 2008).
---
## Objective

`ORDER BY column` só te leva até certo ponto. Dois problemas precisam de mais: ordenar NULLs para um lugar específico independentemente de como os valores não NULL ordenam, e ordenar por uma chave que depende do valor de outra coluna (ordenar vendedores por comissão, todo mundo mais por salário). Os dois são resolvidos colocando uma *expressão*, não um nome de coluna puro, no `ORDER BY`, embora quais bancos de dados precisam dessa expressão de todo difira mais do que você esperaria.

## Use Cases

- Exibir valores faltantes consistentemente por último (ou primeiro) em uma lista de UI, independentemente de como os valores não NULL por acaso ordenam.
- Construir um relatório onde a própria chave de ordenação depende da categoria de uma linha: ordenar por comissão para vendedores, por salário para todo mundo mais, em uma consulta.
- Escrever um `ORDER BY` portável que precisa se comportar igual no PostgreSQL, MySQL, e SQL Server sem três caminhos de código diferentes.

## Deep Dive

### NULLS FIRST/LAST nativo: só um dos três de fato tem isso

```sql
-- PostgreSQL
select ename, sal, comm from emp order by comm nulls last;
select ename, sal, comm from emp order by comm nulls first;
```

O PostgreSQL suporta `NULLS FIRST`/`NULLS LAST` diretamente no `ORDER BY` desde a versão **8.3, lançada em 2008**: mais de uma década antes da edição de 2020 deste livro. MySQL e SQL Server nunca tiveram sintaxe nativa equivalente; os dois ainda exigem um workaround hoje.

### O workaround portável: uma coluna flag CASE

Funciona em todo banco de dados, incluindo PostgreSQL (onde é desnecessário dado a sintaxe nativa acima):

```sql
select ename, sal, comm
  from (
select ename, sal, comm,
       case when comm is null then 0 else 1 end as is_null
  from emp
       ) x
 order by is_null desc, comm;   -- non-NULL comm ascending, NULLs last
```

Troque `is_null desc` por `is_null` (sem `desc`) para colocar NULLs primeiro em vez disso; troque `comm` por `comm desc` para inverter a ordenação dos não NULL independentemente de onde os NULLs pousam. A coluna flag controla o posicionamento de NULL; a segunda chave de ordenação controla tudo mais, e as duas são independentes uma da outra.

### O atalho do MySQL: explorando coerção booleana

O MySQL avalia `comm IS NULL` para `1` (verdadeiro) ou `0` (falso), que ordena diretamente sem precisar de um `CASE` completo:

```sql
select ename, sal, comm from emp order by comm is null, comm;   -- NULLs last
select ename, sal, comm from emp order by comm is null desc, comm;  -- NULLs first
```

Mais curto do que a forma `CASE` portável, mas se apoia em uma coerção implícita de booleano para inteiro que não é óbvia para alguém não familiarizado com o idioma: vale um comentário onde é usado.

### Ordenando por uma chave dependente de dado

A mesma ideia de "expressão em vez de nome de coluna" ordena por colunas diferentes por linha:

```sql
select ename, sal, job, comm
  from emp
 order by case when job = 'SALESMAN' then comm else sal end;
```

Vendedores ordenam por `comm`; todo mundo mais ordena por `sal`: um `ORDER BY`, uma consulta, nenhum pós-processamento ou reordenação do lado do cliente.

## Trade-offs

- **O livro trata o PostgreSQL como precisando do mesmo workaround de ordenação de NULL que MySQL e SQL Server: isso não é uma lacuna de "coisas mudaram desde 2020", é simplesmente impreciso.** O PostgreSQL tem `NULLS FIRST`/`LAST` nativo desde 2008, mais de uma década antes da segunda edição deste livro. Usar o workaround `CASE` portável no PostgreSQL ainda funciona, mas é verbosidade desnecessária para um problema que o banco de dados já resolve nativamente: recorra a `NULLS FIRST`/`LAST` lá em vez disso.
- **Uma expressão `CASE` em `ORDER BY` obscurece a intenção à primeira vista.** `order by sal` diz a um leitor exatamente o que está acontecendo; `order by case when job = 'SALESMAN' then comm else sal end` exige avaliar mentalmente a expressão por linha antes mesmo de a chave de ordenação ficar clara: vale um comentário explicando *por que* a chave de ordenação varia, não só o que o `CASE` faz.
- **O idioma `col IS NULL, col` do MySQL é conciso especificamente porque é engenhoso**: a mesma troca de qualquer one-liner que depende de uma coerção de tipo implícita: rápido de escrever, fácil de ler errado para alguém que não viu o truque antes.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 2, "Sorting Query Results", recipes 2.5-2.6, p. 21-27] - doc
- [PostgreSQL Documentation: ORDER BY Clause (NULLS FIRST/LAST, added in 8.3)](https://www.postgresql.org/docs/current/queries-order.html) - doc
- [MySQL Reference Manual: Working with NULL Values](https://dev.mysql.com/doc/refman/8.4/en/null-values.html) - doc
- [SQL Server Documentation: ORDER BY Clause (no native NULLS FIRST/LAST; CASE-based conditional sort example)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) - doc
