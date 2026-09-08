---
version: 1.0
updatedAt: 2026-08-01
title: "Anti-Joins e Joins Opcionais: Encontrando Linhas Faltantes e Adicionando Dados Sem Perder Linhas"
summary: Como LEFT JOIN + IS NULL (um anti-join) encontra linhas em uma tabela sem correspondência em outra, como o mesmo mecanismo de LEFT JOIN (ou uma subconsulta escalar na lista SELECT) adiciona dados opcionais a uma consulta já correta sem descartar linhas, e por que tanto MySQL quanto PostgreSQL reconhecem o padrão de anti-join e param de varrer cedo em vez de avaliá-lo como um join-depois-filtro ingênuo.
---
## Objective

Um `JOIN` simples só retorna linhas que correspondem nos dois lados, mas dois problemas cotidianos precisam do oposto ou de uma extensão disso: encontrar linhas que não têm *nenhuma* correspondência (um anti-join), e adicionar dados opcionais a uma consulta que já retorna as linhas certas, sem perder nenhuma delas só porque o dado extra não existe para toda linha. Os dois são resolvidos com a mesma ferramenta: `LEFT [OUTER] JOIN`, usada de duas formas diferentes.

## Use Cases

- Encontrar todo departamento com zero funcionários, para sinalizá-lo para revisão ou fechamento, sem listar números de departamento à mão.
- Auditar quais linhas pai entre duas tabelas relacionadas nunca receberam uma linha filha correspondente: dados de referência órfãos, contas expiradas sem renovação, produtos sem pedidos.
- Adicionar uma coluna de "data do último bônus" a um relatório de funcionário existente e já correto, sem transformá-lo em um inner join que silenciosamente descarta todo funcionário que nunca recebeu um bônus.

## Deep Dive

### Encontrando linhas sem correspondência: o anti-join

```sql
select d.*
  from dept d
  left outer join emp e
    on (d.deptno = e.deptno)
 where e.deptno is null
```

Um inner join em `deptno` só retornaria departamentos que *têm* pelo menos um funcionário. Trocar para um `LEFT JOIN` mantém toda linha de `dept` independentemente de correspondência, preenchendo `NULL` para colunas de `emp` onde nenhuma existe; filtrar depois por `e.deptno IS NULL` mantém só os departamentos que nunca corresponderam. Esse padrão é chamado de anti-join: outer join, depois descartar tudo que *de fato* correspondeu.

A receita 3.4 do livro (`NOT EXISTS` com uma subconsulta correlacionada) resolve exatamente o mesmo problema de um ângulo diferente: ela nunca produz o superconjunto correspondido/não correspondido de todo, ela só pergunta "existe pelo menos uma correspondência?" por linha externa. As duas retornam resultados idênticos aqui; qual usar muitas vezes é uma questão de legibilidade em vez de desempenho, embora veja os Trade-offs abaixo para onde isso não é bem a história toda.

### Adicionando dados opcionais sem perder linhas

Partindo de uma consulta que já está correta: todo funcionário com a localização de seu departamento:

```sql
select e.ename, d.loc
  from emp e, dept d
 where e.deptno = d.deptno
```

Fazer join ingenuamente com uma tabela de bônus perderia todo funcionário sem bônus, porque um inner join só mantém linhas correspondidas:

```sql
-- WRONG: silently drops employees with no bonus row
select e.ename, d.loc, eb.received
  from emp e, dept d, emp_bonus eb
 where e.deptno = d.deptno
   and e.empno = eb.empno
```

O conserto é o mesmo mecanismo `LEFT JOIN`, só que para o propósito oposto desta vez: manter toda linha da consulta já correta, e deixar a tabela adicionada contribuir `NULL` onde não tem nada a adicionar:

```sql
select e.ename, d.loc, eb.received
  from emp e join dept d
    on (e.deptno = d.deptno)
  left join emp_bonus eb
    on (e.empno = eb.empno)
 order by 2
```

### A alternativa de subconsulta escalar

Uma subconsulta colocada diretamente na lista `SELECT` é uma segunda forma de parafusar dados opcionais sem tocar no join que já produz o conjunto de linhas correto:

```sql
select e.ename, d.loc,
       (select eb.received
          from emp_bonus eb
         where eb.empno = e.empno) as received
  from emp e, dept d
 where e.deptno = d.deptno
 order by 2
```

Essa forma é conveniente especificamente porque não exige nenhuma mudança em um `FROM`/`WHERE` existente e já funcionando, mas a subconsulta precisa retornar no máximo uma linha por linha externa (um valor escalar de verdade); uma subconsulta retornando mais de uma linha levanta um erro de runtime em todo banco de dados popular.

## Trade-offs

- **Anti-join (`LEFT JOIN` + `IS NULL`) e `NOT EXISTS` são duas grafias da mesma ideia, e tanto MySQL quanto PostgreSQL reconhecem isso, mas não de forma idêntica.** O próprio manual de referência do MySQL confirma que quando o teste `IS NULL` mira em uma coluna declarada `NOT NULL`, "o MySQL para de procurar por mais linhas (para uma combinação de chave em particular) depois de encontrar uma linha que corresponde à condição do `LEFT JOIN`": um short-circuit de verdade, não um join-depois-filtro ingênuo (visível na saída do `EXPLAIN` como `Using where; Not exists`). Dito isso, benchmarks independentes no MySQL geralmente ainda mostram `NOT EXISTS`/`NOT IN` se saindo melhor do que `LEFT JOIN`/`IS NULL` uma vez que a coluna comparada é anulável ou não tem um índice de suporte: a forma de anti-join é a ferramenta escolhida pela receita especificamente porque retorna colunas reais do lado não correspondido (como `dept.*` acima), não porque é garantidamente mais rápida do que `NOT EXISTS` em todo caso.
- **O filtro `IS NULL` precisa mirar em uma coluna que é genuinamente `NOT NULL` na tabela interna** (ou uma chave composta/primária): filtrar em uma coluna que ela mesma pode legitimamente ser `NULL` em linhas correspondidas de verdade descarta silenciosamente correspondências corretas junto com as verdadeiras não correspondências. Essa é a aresta afiada do anti-join: parece uma pequena adição a um outer join, mas escolher a coluna errada muda o significado da consulta inteira.
- **Uma subconsulta escalar na lista `SELECT` não muda nada sobre a correção da consulta ao redor, que é exatamente seu apelo e seu limite.** É a forma menos invasiva de adicionar um valor opcional a um relatório já correto, mas não generaliza: precisar de duas ou três colunas opcionais da mesma tabela ou de tabelas diferentes é mais naturalmente um `LEFT JOIN` por tabela do que uma pilha de subconsultas escalares.
- **Livro vs. hoje:** o planejador do PostgreSQL tem melhorado constantemente em reconhecer mais formatos de `LEFT JOIN`/`NOT IN` como anti-joins eficientes ao longo de versões principais sucessivas, com o PostgreSQL 19 (em beta no momento desta escrita) continuando essa tendência: vale a pena reconferir a saída do `EXPLAIN` em uma versão atual do PostgreSQL em vez de presumir que o formato de plano de uma versão mais antiga ainda se aplica.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 3, "Working with Multiple Tables", recipes 3.5-3.6, p. 40-43] - doc
- [MySQL Reference Manual: Outer Join Optimization](https://dev.mysql.com/doc/refman/8.4/en/outer-join-optimization.html) - doc
- [PostgreSQL Documentation: Explicit Joins (LEFT/RIGHT/FULL JOIN)](https://www.postgresql.org/docs/current/queries-table-expressions.html) - doc
- [SQL Server Documentation: Subqueries (scalar subqueries in the SELECT list)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/subqueries) - doc
