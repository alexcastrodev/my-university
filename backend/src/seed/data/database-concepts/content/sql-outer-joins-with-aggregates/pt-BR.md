---
version: 1.0
updatedAt: 2026-08-04
title: Fazendo Outer Joins ao Usar Agregações
summary: Como somar corretamente uma coluna em todas as linhas de uma tabela quando uma segunda tabela, unida por join, só tem linhas correspondentes para algumas delas, usando outer join em vez de inner join e deixando a expressão CASE tratar uma correspondência NULL como zero em vez de pular a linha.
---
## Objective

A receita 3.9 cobre um join que duplica um valor somado quando a tabela unida tem *mais de uma* linha correspondente. Esta receita cobre a forma oposta do mesmo problema de espalhamento (fan-out): um inner join que **descarta** linhas por completo, porque a tabela unida não tem **nenhuma** linha correspondente para algumas chaves. Somar salários depois de fazer inner join entre funcionários e seus bônus exclui em silêncio todo funcionário que nunca recebeu bônus, não porque a soma esteja errada sobre as linhas que viu, mas porque ela nunca viu as linhas que faltam.

## Use Cases

- Calcular um total por departamento ou da empresa (salários, receita, valor de pedidos) que precisa incluir toda linha da tabela principal, mesmo quando uma segunda tabela unida (bônus, descontos, indicações) não tem linha correspondente para algumas delas.
- Auditar um relatório em que um "total" parece suspeitamente *baixo* comparado a uma soma direta só da tabela principal: o equivalente com outer join do total suspeitamente *alto* da receita 3.9.
- Escolher entre um outer join com um `CASE` ciente de NULL e uma reestruturação com pré-agregação, dependendo de a consulta precisar continuar portável entre DB2/MySQL/PostgreSQL/SQL Server ou poder depender de window functions.

## Deep Dive

### O problema: um inner join descarta em silêncio as linhas sem correspondência

Enquanto a `EMP_BONUS` da receita 3.9 tinha duas linhas de bônus para o mesmo funcionário (`MILLER`), a versão desta receita só tem linhas de bônus para `MILLER`: nenhum outro funcionário do departamento 10 tem alguma:

```sql
select * from emp_bonus;

EMPNO RECEIVED          TYPE
----- ----------- ----------
 7934 17-MAR-2005          1
 7934 15-FEB-2005          2
```

Um inner join entre `EMP` e `EMP_BONUS` só retorna linhas para funcionários que realmente aparecem em `EMP_BONUS`, o que aqui significa só `MILLER`:

```sql
select e.empno, e.ename, e.sal, e.deptno,
       e.sal * case when eb.type = 1 then .1
                    when eb.type = 2 then .2
                    else .3 end as bonus
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10;

EMPNO ENAME             SAL     DEPTNO      BONUS
----- ---------- ---------- ---------- ----------
 7934 MILLER           1300         10        130
 7934 MILLER           1300         10        260
```

Somar `sal` sobre este resultado só soma o salário de `MILLER` (duas vezes, pelo mesmo motivo da receita 3.9), enquanto `CLARK` e `KING`, que não têm linha de bônus nenhuma, nunca aparecem no resultado unido e não contribuem com nada para a soma:

```sql
select deptno,
       sum(sal) as total_sal,
       sum(bonus) as total_bonus
  from ( /* o join acima */ ) x
 group by deptno;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      2600         390
```

O resultado desejado (o salário de cada funcionário do departamento 10 contado exatamente uma vez, e o bônus total correto) é `TOTAL_SAL = 8750`, não `2600`.

### Correção 1: outer join + CASE ciente de NULL, depois SUM(DISTINCT ...)

Trocar o inner join por um `LEFT OUTER JOIN` mantém toda linha de `EMP`, tenha ou não correspondência em `EMP_BONUS`; a expressão `CASE` então precisa de mais um ramo para tratar o `NULL` resultante em `eb.type`:

```sql
select deptno,
       sum(distinct sal) as total_sal,
       sum(bonus) as total_bonus
  from (
select e.empno, e.ename, e.sal, e.deptno,
       e.sal * case when eb.type is null then 0
                    when eb.type = 1 then .1
                    when eb.type = 2 then .2
                    else .3 end as bonus
  from emp e left outer join emp_bonus eb
    on (e.empno = eb.empno)
 where e.deptno = 10
       ) x
 group by deptno;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      8750         390
```

O novo ramo `when eb.type is null then 0` é toda a diferença em relação à expressão `CASE` da receita 3.9: um funcionário sem bônus contribui com `0` para `total_bonus`, o que não afeta a soma, em vez de desaparecer do conjunto de resultados como um inner join o descartaria. `SUM(DISTINCT sal)` ainda faz o mesmo trabalho que na receita 3.9: desfaz a duplicação causada pelas duas linhas de bônus de `MILLER`.

### Correção 2: a mesma forma com window function, estendida com o ramo de NULL

DB2, MySQL, PostgreSQL e SQL Server aceitam a reescrita equivalente com window function, de novo apenas acrescentando o ramo `is null` ao `CASE` existente:

```sql
select distinct deptno, total_sal, total_bonus
  from (
select e.empno, e.ename,
       sum(distinct e.sal) over
           (partition by e.deptno) as total_sal,
       e.deptno,
       sum(e.sal * case when eb.type is null then 0
                        when eb.type = 1 then .1
                        when eb.type = 2 then .2
                        else .3 end) over
           (partition by deptno) as total_bonus
  from emp e left outer join emp_bonus eb
    on (e.empno = eb.empno)
 where e.deptno = 10
       ) x;
```

### Correção 3: pré-agregar antes do join, sem precisar de outer join

A alternativa da receita 3.9 (calcular primeiro a soma dos salários, só a partir de `EMP`, antes de qualquer join) contorna o problema das linhas ausentes por completo, porque o total de salários nunca foi unido a `EMP_BONUS`:

```sql
select d.deptno,
       d.total_sal,
       sum(e.sal * case when eb.type = 1 then .1
                        when eb.type = 2 then .2
                        else .3 end) as total_bonus
  from emp e,
       emp_bonus eb,
       (
select deptno, sum(sal) as total_sal
  from emp
 where deptno = 10
 group by deptno
       ) d
 where e.deptno = d.deptno
   and e.empno = eb.empno
 group by d.deptno, d.total_sal;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      8750         390
```

Como `total_bonus` aqui ainda é calculado a partir de um *inner* join entre `emp`/`emp_bonus`, esta forma só soma bônus de funcionários que de fato têm um, o que está correto, já que um funcionário sem bônus não deveria contribuir com nada para `total_bonus` de qualquer forma. Nenhum ajuste de `is null`/`CASE` é necessário neste caminho, e esta consulta roda sem modificação em todo SGBD convencional.

## Trade-offs

- **A correção desta receita é um superconjunto estrito da correção da receita 3.9, não uma técnica diferente.** Trocar `INNER JOIN`/join por vírgula por `LEFT OUTER JOIN` e acrescentar um ramo `WHEN ... IS NULL THEN 0` a uma expressão `CASE` existente é toda a diferença; a mecânica de `SUM(DISTINCT ...)` e de window functions é idêntica à da receita anterior.
- **Esquecer o ramo `IS NULL` depois de trocar para um outer join é um erro realista e silencioso.** Um outer join sozinho reintroduz as linhas ausentes com `NULL` nas colunas unidas, mas uma expressão `CASE` escrita para o caso de inner join (a versão da receita 3.9, sem ramo `IS NULL`) cai no que quer que o `ELSE` final calcule para um `eb.type` `NULL`, produzindo um valor de bônus errado, e não obviamente errado, em vez de um erro.
- **Pré-agregar antes do join é, de novo, a opção que menos depende da forma do join.** Ela não precisa de outer join, de `DISTINCT` nem de um ramo de tratamento de `NULL` para o lado dos salários: é a mesma vantagem que a receita 3.9 já destacou, só que mais acentuada aqui, porque a correção com outer join exige de fato editar a expressão `CASE`, enquanto pré-agregar não exige nenhuma edição na lógica do lado dos bônus.
- **Livro vs. hoje: a lacuna de suporte a `DISTINCT` em window functions não mudou, e ainda é confirmada como atual.** Como na receita 3.9, nem o PostgreSQL nem o MySQL suportam `DISTINCT` dentro de uma função de agregação de janela (`SUM(DISTINCT col) OVER (...)`): o PostgreSQL tem uma série de patches em andamento, não integrada (com a última discussão ativa na lista de e-mails PostgreSQL hackers, ainda em aberto em 2026), para adicionar isso, e o manual de referência atual do MySQL continua documentando como não suportado. É a mesma ressalva de que só DB2/Oracle/SQL Server suportam isso, já apontada para a window function da receita 3.9, aplicando-se de forma idêntica aqui: não é uma descoberta nova, é a confirmação de que nada mudou entre as pesquisas das duas receitas.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 3, "Working with Multiple Tables", receita 3.10, p. 57-59: doc
- [PostgreSQL Documentation: Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html): doc
- [PostgreSQL mailing list: DISTINCT support inside window aggregate functions (WIP patch, still unmerged)](https://www.postgresql.org/message-id/CAN1Pwonf4waD+PWkEFK8ANLua8fPjZ4DmV+hixO62+LiR8gwaA@mail.gmail.com): doc
- [MySQL Reference Manual: Window Function Concepts and Syntax](https://dev.mysql.com/doc/refman/8.4/en/window-functions-usage.html): doc
