---
version: 1.0
updatedAt: 2026-08-04
title: "Retornando Dados Faltantes das Duas Tabelas com FULL OUTER JOIN"
summary: Como retornar linhas sem correspondência dos dois lados de um join ao mesmo tempo (departamentos sem funcionários e funcionários sem departamento, simultaneamente) usando FULL OUTER JOIN onde é suportado, ou um UNION de um outer join LEFT e RIGHT onde não é (MySQL, e a sintaxe proprietária (+) do Oracle).
---
## Objective

Um outer join único já resolve "me mostre toda linha de uma tabela, correspondida com a outra onde possível", mas ele só protege *um* lado. Fazer left join de `DEPT` para `EMP` mantém todo departamento, incluindo os sem funcionários, mas um funcionário que de alguma forma não tem departamento ainda é silenciosamente descartado, porque o join só é outer de um lado. Retornar as linhas faltantes das *duas* tabelas no mesmo conjunto de resultado precisa de um mecanismo genuinamente diferente: um full outer join.

## Use Cases

- Auditar integridade referencial entre duas tabelas nas duas direções ao mesmo tempo: linhas pai sem filhos, e linhas filhas órfãs sem pai, em uma única consulta em vez de duas separadas.
- Construir um relatório combinado que precisa mostrar todo departamento (mesmo os vazios) e todo funcionário (mesmo um sem departamento atribuído, um problema de qualidade de dado que vale a pena expor em vez de esconder).
- Reconciliar dois datasets que deveriam se alinhar (um sistema de origem e uma cópia a jusante) onde "faltando de qualquer um dos lados" é em si a coisa sendo investigada.

## Deep Dive

### Por que um outer join de um lado só não é suficiente

Um `LEFT OUTER JOIN` de `DEPT` para `EMP` mantém todo departamento, incluindo o que não tem nenhum funcionário:

```sql
select d.deptno, d.dname, e.ename
  from dept d left outer join emp e
    on (d.deptno = e.deptno)

   DEPTNO DNAME          ENAME
--------- -------------- ----------
       20 RESEARCH       SMITH
       30 SALES          ALLEN
       ...
       40 OPERATIONS
```

`OPERATIONS` (departamento 40) aparece sem nenhum `ENAME`, exatamente como pretendido, mas esse join não diz nada sobre um funcionário que poderia existir sem *nenhum* departamento. Trocar para um `RIGHT OUTER JOIN` conserta essa metade do problema mas quebra a outra: recupera um funcionário sem departamento inserido deliberadamente (`YODA`), mas `OPERATIONS` desaparece do resultado, porque o join agora só está protegendo outer o lado de `EMP`. Nenhum join único, sozinho, consegue proteger as linhas sem correspondência das duas tabelas na mesma consulta.

### DB2, MySQL, PostgreSQL, SQL Server: FULL OUTER JOIN, ou um workaround com UNION

A palavra-chave explícita `FULL OUTER JOIN` retorna linhas sem correspondência dos dois lados em uma consulta:

```sql
select d.deptno, d.dname, e.ename
  from dept d full outer join emp e
    on (d.deptno = e.deptno)
```

`OPERATIONS` (sem correspondência do lado de `DEPT`) e `YODA` (sem correspondência do lado de `EMP`) ambos aparecem no mesmo conjunto de resultado, junto com toda linha normalmente correspondida. O MySQL é o único motor popular aqui sem `FULL OUTER JOIN` nativo: o fallback do livro une um `RIGHT OUTER JOIN` com um `LEFT OUTER JOIN` para obter o mesmo resultado combinado:

```sql
select d.deptno, d.dname, e.ename
  from dept d right outer join emp e
    on (d.deptno = e.deptno)
union
select d.deptno, d.dname, e.ename
  from dept d left outer join emp e
    on (d.deptno = e.deptno)
```

`UNION` puro (não `UNION ALL`) é o que torna isso correto em vez de duplicar toda linha normalmente correspondida: linhas que correspondem dos dois lados aparecem identicamente nas duas metades do union, e a deduplicação embutida do `UNION` colapsa cada par de volta para uma linha.

### Oracle: FULL OUTER JOIN padrão ANSI, ou a sintaxe proprietária (+) via UNION

O Oracle aceita qualquer uma das soluções acima diretamente. Ele também tem seu próprio marcador de outer join proprietário, `(+)`, anexado à coluna no lado que deveria ser preenchido com `NULL`s quando sem correspondência, mas `(+)` não tem equivalente full-outer sozinho, então recorrer a ele aqui significa o mesmo padrão de union-de-dois-outer-joins que o MySQL precisa, só escrito com `(+)` em vez de `LEFT`/`RIGHT OUTER JOIN`:

```sql
select d.deptno, d.dname, e.ename
  from dept d, emp e
 where d.deptno = e.deptno(+)
union
select d.deptno, d.dname, e.ename
  from dept d, emp e
 where d.deptno(+) = e.deptno
```

### O que um full outer join está fazendo por baixo

Um full outer join é exatamente o union que as soluções de fallback escrevem explicitamente: rode o left outer join, rode o right outer join, dê union nos dois conjuntos de resultado juntos. A consulta com left join mantém toda linha de `DEPT` (incluindo `OPERATIONS` sem correspondência); a consulta com right join mantém toda linha de `EMP` (incluindo `YODA` sem correspondência); toda linha normalmente correspondida aparece nas duas metades e é deduplicada pelo union. `FULL OUTER JOIN` é uma abreviação para essa combinação, não um algoritmo de join fundamentalmente diferente.

## Trade-offs

- **Um full outer join (ou seu equivalente baseado em union) só consegue ser tão correto quanto a própria condição de join.** Uma condição `ON` frouxa ou incorreta ainda produz pareamentos errados nos dois lados simultaneamente: proteger contra linhas faltantes não protege contra uma chave de join que já está errada.
- **O fallback baseado em union custa uma passada de sort/dedup que um `FULL OUTER JOIN` nativo não necessariamente precisa.** `UNION` (não `UNION ALL`) precisa comparar toda linha das duas metades para remover duplicatas; em tabelas grandes, isso é overhead real que a implementação nativa de full outer join de um banco de dados muitas vezes consegue evitar rastreando diretamente linhas correspondidas/sem correspondência durante uma única passada em vez disso.
- **O MySQL ainda não tem `FULL OUTER JOIN` nativo: isso não é conselho datado de 2020, ainda é o estado atual.** Confirmado contra a documentação de referência atual do MySQL: a página da cláusula `JOIN` lista inner e left/right outer joins, sem nenhuma palavra-chave `FULL [OUTER] JOIN`. O workaround de union-de-dois-outer-joins do livro para MySQL continua sendo a única opção lá, não um artefato histórico depois substituído por uma palavra-chave nativa.
- **Livro vs. hoje (uma simplificação que o próprio livro deixa na mesa, não algo que mudou desde então): a sintaxe `(+)` do Oracle precisar do mesmo workaround de union que o MySQL é uma limitação real do `(+)`, mas o Oracle suporta a palavra-chave `FULL OUTER JOIN` ANSI simples diretamente desde o Oracle 9i (2001), um fato que o próprio texto do livro reconhece ("usuários de Oracle ainda podem usar qualquer uma das soluções anteriores") sem declarar por que alguém preferiria `(+)` aqui de todo.** Já que `(+)` não oferece nenhuma vantagem sobre a sintaxe ANSI para esse caso específico, e de fato precisa de um union de duas consultas onde `FULL OUTER JOIN` precisa de uma, há pouco motivo para uma consulta Oracle alguma vez usar a versão baseada em `(+)` dessa receita específica; a própria referência de linguagem SQL do Oracle documenta `FULL OUTER JOIN` como sintaxe de join ANSI padrão, disponível identicamente a DB2/PostgreSQL/SQL Server.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 3, "Working with Multiple Tables", recipe 3.11, p. 60-63] - doc
- [PostgreSQL Documentation: Joined Tables (FULL [OUTER] JOIN)](https://www.postgresql.org/docs/current/queries-table-expressions.html) - doc
- [MySQL Reference Manual: JOIN Clause (no native FULL OUTER JOIN)](https://dev.mysql.com/doc/refman/8.0/en/join.html) - doc
- [Oracle Database SQL Language Reference: Joins (ANSI outer join syntax since Oracle 9i)](https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/SELECT.html) - doc
