---
version: 1.0
updatedAt: 2026-08-03
title: "Identificando e Evitando Produtos Cartesianos"
summary: Como uma condição de join ausente ou incompleta multiplica silenciosamente a contagem de linhas em vez de dar erro, por que a contagem de linhas resultante é sempre o produto das cardinalidades de entrada, e por que a sintaxe explícita ANSI JOIN pega o erro em tempo de parse onde joins antigos por vírgula deixam rodar.
---
## Objective

Um produto cartesiano acontece quando a cláusula `FROM` de uma consulta pareia toda linha de uma tabela com toda linha de outra, porque nenhuma condição jamais restringe o pareamento a linhas correspondentes. O SQL não se recusa a rodar tal consulta; ele só retorna o produto cruzado completo, silenciosamente, que é o que torna esse erro perigoso: a consulta executa sem erro e retorna linhas de *aparência plausível*, só que muito mais delas (e muito erradas) do que pretendido.

## Use Cases

- Diagnosticar uma consulta que retorna "linhas demais" ou valores duplicados por entidade lógica: o sintoma clássico de um produto cartesiano escondido dentro de uma consulta multi-tabela de outra forma razoável.
- Revisar ou escrever qualquer consulta com mais de uma tabela na cláusula `FROM`, para checar que toda tabela de fato está unida a algo em vez de só listada.
- Usar deliberadamente um produto cartesiano (`CROSS JOIN`) para o que ele é legitimamente bom: pivotar/transpor um conjunto de resultado, gerar uma sequência de números ou datas, ou emular um loop de contagem fixa.

## Deep Dive

### O erro: filtrar uma tabela mas nunca fazer join com a outra

```sql
select e.ename, d.loc
  from emp e, dept d
 where e.deptno = 10
```

Isso parece razoável: filtra `emp` para o departamento 10, mas nunca relaciona `dept` de volta a `emp` de jeito nenhum. Toda linha de `dept` é pareada com toda linha qualificante de `emp`:

```
ENAME        LOC
----------   -------------
CLARK        NEW YORK
CLARK        DALLAS
CLARK        CHICAGO
CLARK        BOSTON
KING         NEW YORK
KING         DALLAS
KING         CHICAGO
KING         BOSTON
MILLER       NEW YORK
MILLER       DALLAS
MILLER       CHICAGO
MILLER       BOSTON
```

Só as linhas `NEW YORK` estão corretas: o departamento 10 na verdade está localizado em Nova York, então `CLARK`/`KING`/`MILLER` pareados com Dallas, Chicago, ou Boston são combinações fabricadas que por acaso se parecem com saída de consulta real.

### O conserto: uma condição de join explícita entre todo par de tabelas

```sql
select e.ename, d.loc
  from emp e, dept d
 where e.deptno = 10
   and d.deptno = e.deptno
```

Adicionar `d.deptno = e.deptno` restringe cada linha de `emp` a parear só com a única linha de `dept` correspondente, em vez de todas elas:

```
ENAME        LOC
----------   ---------
CLARK        NEW YORK
KING         NEW YORK
MILLER       NEW YORK
```

### Por que isso acontece: a contagem de linhas é o produto das duas cardinalidades

`emp` filtrado para o departamento 10 produz 3 linhas; `dept` sem nenhum filtro produz todas as 4 linhas. Sem nenhuma condição de join conectando-as, a consulta retorna todo pareamento possível: 3 × 4 = 12 linhas, exatamente o que a consulta quebrada acima produziu. Isso é mecânico, não uma coincidência: uma cláusula `FROM` de *n* tabelas sem nenhuma condição relacionando duas dessas tabelas sempre retorna o produto de suas contagens de linha, por maior que isso seja.

### A regra n−1 como uma checklist de partida

Com `n` tabelas na cláusula `FROM`, `n − 1` é o número *mínimo* de condições de join necessárias para conectar toda tabela a pelo menos outra: uma consulta de 3 tabelas precisa de pelo menos 2 condições de join, uma de 4 tabelas de pelo menos 3, e assim por diante. É um piso, não uma garantia: dependendo das chaves e relacionamentos reais envolvidos, uma consulta pode precisar de mais do que `n − 1` condições para estar totalmente correta (por exemplo, uma tabela de associação/junção precisa de sua própria condição separada para cada lado ao qual se relaciona). Trate `n − 1` como a checagem de sanidade mínima ao revisar uma consulta multi-tabela, não como prova de que a consulta está certa.

## Trade-offs

- **Um produto cartesiano é uma falha silenciosa, não uma barulhenta.** A consulta é sintaticamente válida e executa com sucesso; não há erro para pegá-la, só uma contagem de linhas e formato de resultado que parecem errados na inspeção. É exatamente por isso que vale a pena contar deliberadamente condições de join contra contagem de tabela (`n − 1`) em vez de presumir "rodou, então está certo."
- **Produtos cartesianos são uma ferramenta real e útil quando usados de propósito**: pivotar ou transpor um conjunto de resultado, gerar uma sequência de valores, ou emular um loop de contagem fixa são todos usos legítimos de um cross join intencional. O perigo é especificamente o caso *acidental* e não intencional mostrado acima, não a operação em si.
- **Joins antigos por vírgula na cláusula `FROM` colocam o fardo de correção inteiro na cláusula `WHERE`, sem nada para pegar uma omissão.** Tanto a consulta quebrada quanto a consertada deste livro usam `FROM emp e, dept d`: a única coisa separando o bug de produto cartesiano da consulta correta é uma linha dentro do `WHERE` que é fácil de perder durante edições posteriores (um refactor, um copy-paste, um merge). A orientação de estilo SQL atual entre PostgreSQL, MySQL, e SQL Server recomenda a sintaxe explícita ANSI-92 `JOIN ... ON` em vez disso, especificamente porque uma cláusula `ON` ausente é um **erro de sintaxe** que o motor se recusa a rodar, em vez de um produto cartesiano silenciosamente aceito:
  ```sql
  -- old style: a missing/deleted WHERE condition silently cross-joins
  select e.ename, d.loc from emp e, dept d where e.deptno = 10;

  -- ANSI style: omitting ON is a parse error, not a silent bug
  select e.ename, d.loc
    from emp e
    join dept d on d.deptno = e.deptno
   where e.deptno = 10;
  ```
  Isso não é tanto uma correção livro-vs-hoje quanto uma nota livro-vs-melhor-prática-atual: os exemplos de join por vírgula do livro já eram sintaxe de estilo antigo quando o livro foi escrito; `JOIN`/`ON` explícito é o padrão SQL-92 e o estilo geralmente recomendado há décadas, e essa receita é uma ilustração concreta de exatamente o modo de falha que esse estilo evita.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 3, "Working with Multiple Tables", recipe 3.8, p. 51] - doc
- [PostgreSQL Documentation: 7.2.1. Joined Tables (CROSS JOIN vs. old-style comma FROM)](https://www.postgresql.org/docs/current/queries-table-expressions.html) - doc
- [MySQL Reference Manual: JOIN Clause](https://dev.mysql.com/doc/refman/8.0/en/join.html) - doc
- [Microsoft Learn: FROM (Transact-SQL), joined tables](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql) - doc
