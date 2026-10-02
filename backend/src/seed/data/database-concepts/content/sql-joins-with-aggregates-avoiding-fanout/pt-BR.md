---
version: 1.0
updatedAt: 2026-08-04
title: "Fazendo Joins ao Usar Agregações: Evitando o Fan-Out"
summary: Por que fazer o join antes de agregar pode inflar em silêncio um SUM ao contar mais de uma vez uma linha duplicada, e como corrigir isso com SUM(DISTINCT ...), pré-agregando em uma subconsulta antes do join, ou com uma window function no DB2/Oracle/SQL Server.
---
## Objective

Fazer o join de duas tabelas antes de agregar pode multiplicar em silêncio as linhas que estão sendo somadas ou contadas, não porque o join esteja errado, mas porque uma relação um-para-muitos (um funcionário, vários registros de bônus) faz cada linha do lado "um" aparecer uma vez por linha correspondente do lado "muitos". O join em si está correto; a agregação calculada por cima dele não está, porque ela soma um valor que foi duplicado como efeito colateral do join, sem nenhum erro ou aviso de que isso aconteceu.

## Use Cases

- Calcular um total (salário, receita, valor de pedido) a partir de uma tabela que também precisa ser unida a uma segunda tabela para uma agregação *diferente* (bônus, itens de pedido, tags): um caso em que um lado do join tem várias linhas correspondentes por chave.
- Auditar uma consulta de relatório ou dashboard existente que retorna um total suspeitamente grande quando comparado com uma soma direta, em uma única tabela, da mesma coluna.
- Escolher entre corrigir a duplicação com `DISTINCT`, reestruturar a consulta para agregar antes do join, ou recorrer a uma window function, com base no banco em uso e no tamanho das tabelas.

## Deep Dive

### O problema: um join um-para-muitos duplica linhas antes de a agregação rodar

`EMP_BONUS` pode ter mais de uma linha de bônus por funcionário; `MILLER` (empno 7934) tem duas:

```sql
select * from emp_bonus;

EMPNO RECEIVED          TYPE
----- ----------- ----------
 7934 17-MAR-2005          1
 7934 15-FEB-2005          2
 7839 15-FEB-2005          3
 7782 15-FEB-2005          1
```

Fazer o join de `EMP` com `EMP_BONUS` para calcular o valor do bônus de cada funcionário está correto por si só: cada linha agora mostra um par (funcionário, bônus):

```sql
select e.ename, e.sal
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10;

ENAME             SAL
---------- ----------
CLARK            2450
KING             5000
MILLER           1300
MILLER           1300
```

`MILLER` agora aparece duas vezes, uma por linha de bônus, e com ele o salário de `MILLER` também aparece duas vezes. Envolvendo isso em um `SUM` ingênuo:

```sql
select deptno,
       sum(sal) as total_sal,
       sum(bonus) as total_bonus
  from ( /* o join acima, com uma coluna de bônus acrescentada */ ) x
 group by deptno;

DEPTNO   TOTAL_SAL         TOTAL_BONUS
------ -----------         -----------
    10       10050                2135
```

`TOTAL_BONUS` (2135) está correto: cada bônus é de fato um valor distinto que deveria ser somado uma vez. `TOTAL_SAL` (10050) está errado: a soma real dos salários do departamento 10 é 8750, confirmada diretamente contra `EMP`, sem join nenhum:

```sql
select sum(sal) from emp where deptno = 10;
-- 8750
```

O salário de 1300 de `MILLER` foi contado duas vezes, uma por linha de bônus, inflando o total exatamente no valor do salário de `MILLER`.

### Correção 1: SUM(DISTINCT ...), que funciona em todo lugar

A correção mais direta: como a duplicação é *exata* (o mesmo valor de salário repetido por linha de bônus), somar só os valores distintos a desfaz:

```sql
select deptno,
       sum(distinct sal) as total_sal,
       sum(bonus) as total_bonus
  from (
select e.empno, e.ename, e.sal, e.deptno,
       e.sal * case when eb.type = 1 then .1
                    when eb.type = 2 then .2
                    else .3
               end as bonus
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10
       ) x
 group by deptno;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      8750        2135
```

`sum(bonus)` continua sendo uma soma simples (sem distinct), porque cada valor de bônus já é único por linha; só `sal`, a coluna duplicada pelo join, precisa de `DISTINCT`. Isso funciona em todo engine convencional, mas só enquanto dois funcionários distintos nunca compartilharem legitimamente exatamente o mesmo valor de salário dentro do mesmo grupo, uma coincidência que faria o `SUM(DISTINCT ...)` descartar um deles em silêncio.

### Correção 2: pré-agregar antes do join

A correção mais robusta reestrutura a consulta para que o `SUM(sal)` vulnerável rode *antes* que o join introduza duplicatas: calcule o salário total do departamento 10 uma vez, diretamente a partir de `EMP`, e então faça o join dessa única linha pré-calculada com `EMP`/`EMP_BONUS` para o total de bônus:

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
    10      8750        2135
```

Isso funciona em todo SGBD e, diferente do `SUM(DISTINCT ...)`, não depende de os valores duplicados por acaso serem distinguíveis de linhas genuinamente diferentes que compartilham o mesmo valor: o total de salários está correto por construção, porque nunca foi unido a `EMP_BONUS`.

### Correção 3: window functions (DB2, Oracle, SQL Server)

Essas três plataformas suportam as duas correções acima, mais uma terceira: calcular cada soma como uma window function particionada por departamento, diretamente sobre as linhas unidas, e depois colapsar as duplicatas com um `DISTINCT` externo:

```sql
select distinct deptno, total_sal, total_bonus
  from (
select e.empno, e.ename,
       sum(distinct e.sal) over
           (partition by e.deptno) as total_sal,
       e.deptno,
       sum(e.sal * case when eb.type = 1 then .1
                        when eb.type = 2 then .2
                        else .3 end) over
           (partition by deptno) as total_bonus
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10
       ) x;
```

Cada `SUM ... OVER (PARTITION BY deptno)` calcula seu total sobre toda a partição do departamento 10, anexando o mesmo total a toda linha dessa partição (então as duas linhas de `MILLER` mostram `total_sal = 8750`, `total_bonus = 2135`); o `SELECT DISTINCT` externo então colapsa os totais repetidos por linha em uma linha por departamento.

## Trade-offs

- **`SUM(DISTINCT ...)` é a correção menos invasiva, mas depende de coincidência.** Ela por acaso funciona aqui porque a duplicação é exata: o mesmo valor de salário repetido pelo join. Se dois funcionários diferentes do mesmo grupo ganhassem de fato o mesmo salário, `SUM(DISTINCT sal)` contaria esse salário só uma vez para *os dois*, subestimando o total em silêncio. Use-a quando os valores da coluna duplicada forem efetivamente únicos por linha no grupo; não a use como hábito padrão.
- **Pré-agregar antes do join é mais código, mas está correto independentemente de colisões coincidentes de valores**, e com frequência também é mais rápido: o banco calcula a soma dos salários a partir de um pequeno conjunto de linhas pré-agregadas, em vez de primeiro materializar todo par (funcionário × bônus) e descartar as duplicatas depois. Para qualquer coisa além de uma consulta rápida e avulsa, esta é a correção que escala e continua correta.
- **A forma com window function é exclusiva de DB2/Oracle/SQL Server, não uma escolha portável.** O PostgreSQL e o MySQL suportam window functions amplamente (há anos), mas nenhum dos dois suporta `DISTINCT` dentro de uma função de agregação de janela (`SUM(DISTINCT col) OVER (...)`), então esta forma específica da terceira solução da receita não tem equivalente nesses dois engines; as correções com `DISTINCT` em subconsulta ou com pré-agregação antes do join são as únicas opções portáveis lá.
- **Livro vs. hoje: esta divisão entre fornecedores continua correta, não é algo que mudou.** A própria lista de e-mails do PostgreSQL tem uma proposta de patch aberta e nunca integrada (de 2020) para adicionar suporte a `DISTINCT` dentro de funções de agregação de janela; o manual de referência atual do MySQL também ainda documenta `DISTINCT` como não suportado dentro de window functions. Confirmado pela documentação atual e pelo histórico das listas de e-mail dos dois projetos: é um caso de "ainda verdade hoje", não uma afirmação desatualizada a corrigir.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 3, "Working with Multiple Tables", receita 3.9, p. 52-56: doc
- [PostgreSQL Documentation: Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html): doc
- [MySQL Reference Manual: Window Function Concepts and Syntax](https://dev.mysql.com/doc/refman/8.4/en/window-functions-usage.html): doc
- [Microsoft Learn: OVER Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql): doc
