---
version: 1.0
updatedAt: 2026-08-03
title: "Comparando Duas Tabelas por Igualdade (Cardinalidade e Valores)"
summary: Use uma diferença de conjunto simétrica (EXCEPT/MINUS, ou um fallback de subconsulta correlacionada) para provar que duas tabelas ou views guardam exatamente as mesmas linhas, duplicatas inclusas.
---
## Objective

Saber que duas tabelas (ou uma tabela e uma view feita para reproduzi-la) têm os "mesmos dados" significa mais do que contagens de linha correspondentes: significa que toda linha, incluindo seu número de duplicatas, corresponde nos dois lados. Uma simples checagem de contagem de linha pode passar enquanto o dado real difere (dez linhas de cada lado ainda podem ser dez linhas *diferentes*), e uma comparação ingênua baseada em `UNION` colapsa silenciosamente duplicatas, escondendo incompatibilidades de cardinalidade. O conserto é uma **diferença de conjunto simétrica**: encontre o que está na tabela A mas não em B, combine com o que está em B mas não em A, e se esse resultado combinado for vazio, as tabelas são idênticas; caso contrário, exatamente as linhas divergentes voltam, prontas para inspeção.

## Use Cases

- Verificar que uma cópia de relatório/staging de uma tabela produzida por um job de ETL ou passo de replicação ainda corresponde exatamente à fonte, depois de uma execução.
- Confirmar que uma view, CTE, ou consulta refatorada reproduz as linhas de uma tabela existente uma a uma, incluindo quantas vezes cada linha aparece.
- Teste de regressão de uma consulta reescrita contra a consulta que ela pretende substituir: mesmo conjunto de resultado, não só um de aparência parecida.
- Pegar linhas duplicadas introduzidas por um `UNION ALL` ruim ou um join que gerou fan-out: uma diferença simples baseada em contagem de linha ou `UNION` perderia isso porque não consegue distinguir "10 linhas distintas" de "10 linhas onde uma aparece três vezes."

## Deep Dive

### Passo zero: uma checagem de sanidade de cardinalidade barata com UNION

Antes de comparar o conteúdo completo das linhas, um `UNION` trivial das duas contagens de linha é uma forma rápida de *refutar* igualdade, em qualquer SGBD:

```sql
select count(*) from emp
union
select count(*) from dept

COUNT(*)
--------
       4
      14
```

`UNION` remove duplicatas, então se as duas tabelas tivessem a mesma cardinalidade isso retornaria exatamente uma linha. Duas linhas de volta significa que as tabelas já diferem: não há necessidade de rodar a comparação completa mais cara. Mas o inverso não vale: cardinalidade correspondente *não* prova que as tabelas guardam o mesmo dado.

### PostgreSQL: diferença simétrica com EXCEPT

Dada uma view `V` feita para espelhar a tabela `EMP` (construída aqui a partir de duas metades via `UNION ALL`, incluindo uma linha deliberadamente duplicada para `WARD` para provar que a técnica também pega duplicatas, não só linhas faltantes/extras):

```sql
create view V as
select * from emp where deptno != 10
 union all
select * from emp where ename = 'WARD';
```

Compare-a com `EMP` encontrando linhas em `V` que não estão em `EMP`, e linhas em `EMP` que não estão em `V`, depois dê `UNION ALL` nas duas metades. `GROUP BY` + `COUNT(*)` dobra a própria multiplicidade da linha no que é comparado, então uma duplicata se torna parte da diferença, não algo que `EXCEPT` (que elimina duplicatas por padrão) silenciosamente descarta:

```sql
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  except
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
union all
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  except
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
```

Rodar só a primeira metade (`V EXCEPT EMP`) isoladamente retorna exatamente uma linha: a linha de `WARD` com `cnt = 2`, porque `V` a tem duas vezes e `EMP` a tem uma vez: a incompatibilidade está na *contagem*, não nos valores. A segunda metade (`EMP EXCEPT V`) retorna todo funcionário do departamento 10 mais `WARD` com `cnt = 1`, porque `EMP` tem essas linhas e `V` (construída com `deptno != 10`) não. Um resultado combinado vazio significa que os dois lados são idênticos, cardinalidade e tudo.

### Oracle: a mesma ideia com MINUS

O `MINUS` do Oracle é o mesmo operador sob um nome diferente: mesmo formato `GROUP BY`/`COUNT(*)`, mesmo `UNION ALL` simétrico das duas direções:

```sql
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  minus
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
union all
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  minus
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
```

### Onde EXCEPT/MINUS não estão disponíveis: NOT EXISTS correlacionado

O livro apresenta isso como o fallback de MySQL/SQL Server para motores sem nenhum operador de diferença de conjunto de todo: construir o mesmo `cnt` por linha em uma view inline em cada lado, depois usar um `NOT EXISTS` correlacionado para encontrar linhas em um lado sem nenhuma linha correspondente (todas as colunas *e* `cnt`) no outro, dar `UNION ALL` nas duas direções:

```sql
select *
  from (
       select e.empno, e.ename, e.job, e.mgr, e.hiredate,
              e.sal, e.comm, e.deptno, count(*) as cnt
         from emp e
        group by empno, ename, job, mgr, hiredate, sal, comm, deptno
       ) e
 where not exists (
       select null
         from (
              select v.empno, v.ename, v.job, v.mgr, v.hiredate,
                     v.sal, v.comm, v.deptno, count(*) as cnt
                from v
               group by empno, ename, job, mgr, hiredate, sal, comm, deptno
              ) v
        where v.empno   = e.empno   and v.ename = e.ename
          and v.job     = e.job     and v.hiredate = e.hiredate
          and v.sal     = e.sal     and v.deptno = e.deptno
          and v.cnt     = e.cnt
          and coalesce(v.mgr, 0)  = coalesce(e.mgr, 0)
          and coalesce(v.comm, 0) = coalesce(e.comm, 0)
       )
union all
select *
  from (
       select v.empno, v.ename, v.job, v.mgr, v.hiredate,
              v.sal, v.comm, v.deptno, count(*) as cnt
         from v
        group by empno, ename, job, mgr, hiredate, sal, comm, deptno
       ) v
 where not exists (
       select null
         from (
              select e.empno, e.ename, e.job, e.mgr, e.hiredate,
                     e.sal, e.comm, e.deptno, count(*) as cnt
                from emp e
               group by empno, ename, job, mgr, hiredate, sal, comm, deptno
              ) e
        where e.empno   = v.empno   and e.ename = v.ename
          and e.job     = v.job     and e.hiredate = v.hiredate
          and e.sal     = v.sal     and e.deptno = v.deptno
          and e.cnt     = v.cnt
          and coalesce(e.mgr, 0)  = coalesce(v.mgr, 0)
          and coalesce(e.comm, 0) = coalesce(v.comm, 0)
       )
```

`COALESCE` é exigido em `mgr` e `comm` especificamente porque essas colunas são anuláveis em `emp`, e a lógica de três valores do SQL faz `NULL = NULL` desconhecido (nunca verdadeiro) em um predicado de igualdade simples: sem ele, duas linhas que são genuinamente idênticas, ambas com uma comissão `NULL`, nunca corresponderiam e apareceriam como uma falsa diferença.

### Livro vs. hoje: a cobertura de EXCEPT/MINUS se ampliou desde 2020

Três coisas mudaram desde que essa receita foi escrita:

- **O MySQL adicionou `EXCEPT`/`INTERSECT` nativos na 8.0.31 (outubro de 2022).** O fallback de `NOT EXISTS` correlacionado que o livro prescreve para o MySQL era a única opção em 2020; hoje o MySQL 8.0.31+ consegue rodar o mesmo padrão `EXCEPT` + `GROUP BY`/`COUNT(*)` mostrado acima para o PostgreSQL, e tanto `INTERSECT`/`EXCEPT` suportam um modificador `DISTINCT`/`ALL` (padrão `DISTINCT`), igual ao `UNION`.
- **O SQL Server de fato tem `EXCEPT`/`INTERSECT` nativos desde o SQL Server 2005**, bem antes da 2ª edição de 2020 deste livro. Agrupar SQL Server com MySQL sob "precisa do workaround de subconsulta correlacionada" já era evitável no momento da escrita; no SQL Server a consulta baseada em `EXCEPT` (a solução PostgreSQL/DB2 da receita) funciona como está, sem `NOT EXISTS` necessário.
- **O Oracle 21c adicionou `MINUS ALL`** (e `EXCEPT ALL`/`INTERSECT ALL` como sinônimos), deixando o `MINUS` comparar linhas como um multiset de verdade diretamente. No Oracle 21c+ e no PostgreSQL (que suporta `EXCEPT ALL` há muito tempo), a contabilidade manual `GROUP BY ... COUNT(*) as cnt` na receita acima não é mais estritamente necessária: `MINUS ALL`/`EXCEPT ALL` já trata uma linha duplicada como uma diferença por si só:

  ```sql
  -- Oracle 21c+ / PostgreSQL: cardinality-aware diff without manual COUNT(*)
  (select * from v minus all select * from emp)
  union all
  (select * from emp minus all select * from v)
  ```

  A abordagem `GROUP BY`/`COUNT(*)` do livro ainda funciona em todo lugar e vale a pena saber independentemente, já que é a única opção em motores sem uma variante `ALL` do operador de diferença de conjunto.

## Trade-offs

- **Uma checagem de contagem de linha baseada em `UNION` é um pré-filtro barato, não uma prova de igualdade.** Ela só consegue refutar igualdade (contagens diferentes voltaram); duas tabelas com a mesma contagem ainda podem guardar linhas completamente diferentes, então é uma saída antecipada rápida, não um substituto para a comparação completa.
- **O agrupamento de "MySQL e SQL Server" juntos da receita já era uma simplificação excessiva em 2020, não só algo que o tempo mudou.** O SQL Server suporta `EXCEPT`/`INTERSECT` nativamente desde 2005; só o MySQL de fato precisava do fallback de subconsulta correlacionada, e só até a versão 8.0.31 (2022).
- **O passo manual de `GROUP BY ... COUNT(*) as cnt` existe puramente para tornar `EXCEPT`/`MINUS` (que descartam duplicatas por padrão) ciente de cardinalidade.** Onde uma variante `ALL` está disponível (`EXCEPT ALL` no PostgreSQL, `MINUS ALL` no Oracle 21c+), é redundante: o próprio operador já trata a entrada como um multiset:
  ```sql
  -- functionally equivalent to the GROUP BY/COUNT(*) version above, on
  -- engines with an ALL variant
  select * from v except all select * from emp;
  ```
- **`COALESCE` em colunas anuláveis é fácil de esquecer e falha silenciosamente, não ruidosamente**: uma consulta incompatível ainda roda e retorna um resultado, ela só silenciosamente trata duas linhas que só diferem em uma coluna `NULL` vs `NULL` como diferentes, inflando a diferença com falsos positivos em vez de levantar um erro.
- **O fallback `NOT EXISTS` correlacionado tem formato O(n²) sem um índice de suporte** na lista completa de coluna de chave de join, já que toda linha externa reescaneia a tabela derivada interna; nos motores que ainda precisam dessa forma (ou em qualquer motor, para tabelas muito grandes) vale a pena checar a saída do `EXPLAIN` antes de presumir que escala do mesmo jeito que `EXCEPT`/`MINUS`.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 3, "Working with Multiple Tables", recipe 3.7, p. 44-50] - doc
- [MySQL Reference Manual: Set Operations with UNION, INTERSECT, and EXCEPT](https://dev.mysql.com/doc/refman/8.0/en/set-operations.html) - doc
- [Microsoft Learn: EXCEPT and INTERSECT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-except-and-intersect-transact-sql) - doc
- [PostgreSQL Documentation: 7.4. Combining Queries (UNION, INTERSECT, EXCEPT)](https://www.postgresql.org/docs/current/queries-union.html) - doc
- [Oracle Database SQL Language Reference: The UNION [ALL], INTERSECT, MINUS Operators](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/The-UNION-ALL-INTERSECT-MINUS-Operators.html) - doc
