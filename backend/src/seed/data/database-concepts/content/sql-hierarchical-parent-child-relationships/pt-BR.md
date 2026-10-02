---
version: 1.0
updatedAt: 2026-08-06
title: Relações Hierárquicas Pai-Filho com Self-Joins
summary: Expressar uma hierarquia pai-filho autorreferenciada com uma cadeia fixa de self-joins (um join por nível) e reconhecer onde a cadeia deixa de escalar e uma CTE recursiva assume.
---
## Objective

A forma mais simples de dados hierárquicos não é uma tabela de árvore separada: é uma única tabela com uma chave estrangeira autorreferenciada. `emp.mgr` guarda um valor de `empno` que aponta para outra linha de `emp`. Todo gerente também é funcionário, então a hierarquia inteira vive em uma tabela, e o "pai" de qualquer linha é encontrado seguindo `mgr` de volta até `empno`. Consultar essa relação significa fazer o join da tabela *com ela mesma*: um self-join expressa um nível de hierarquia (funcionário → gerente), dois self-joins expressam dois níveis (funcionário → gerente → gerente do gerente), e assim por diante; a quantidade de joins é fixada no momento em que a consulta é escrita e grava a profundidade que ela consegue enxergar. Isso funciona bem quando você sabe a profundidade e ela é pequena. Para hierarquias de profundidade arbitrária ou desconhecida, a cadeia fixa de self-joins deixa de escalar, e a técnica de CTE recursiva de [Recursive Hierarchy Queries and Tree Traversal](sql-recursive-hierarchy-queries) é a ferramenta certa.

## Use Cases

- Um organograma básico: listar cada funcionário ao lado do nome do seu gerente direto, exibido como "FORD works for JONES".
- Um organograma de dois níveis: funcionário → gerente → diretor, em que você quer os três nomes em uma linha para um relatório ou exportação.
- Uma árvore de categorias com forma conhecida e rasa: `category.parent_id` em que a taxonomia é fixa em dois níveis (departamento → subdepartamento) e a profundidade não vai mudar.
- Qualquer busca em que uma linha precisa ser exibida junto com os atributos do seu pai (um comentário mais o comentário que ele responde, uma linha de pedido mais a revisão do pedido pai) e só um salto é necessário.

## Deep Dive

### Um self-join para um nível

A tabela `emp` guarda a hierarquia em duas colunas: `empno` identifica o funcionário, `mgr` guarda o `empno` do seu gerente.

```sql
select empno, mgr
  from emp
 order by 2;

     EMPNO        MGR
---------- ----------
      7788       7566
      7902       7566
      7499       7698
      ...
      7369       7902
      7839              -- KING, a raiz: sem gerente, MGR é NULL
```

Para obter o *nome* do gerente de cada funcionário, faça o join de `emp` com uma segunda cópia dela mesma e case o `mgr` do filho com o `empno` do pai:

```sql
select a.ename || ' works for ' || b.ename as emps_and_mgrs
  from emp a, emp b
 where a.mgr = b.empno;

EMPS_AND_MGRS
------------------------------
FORD works for JONES
SCOTT works for JONES
JAMES works for BLAKE
...
SMITH works for FORD
```

Mecanicamente, isso é um produto cartesiano filtrado: `from emp a, emp b` produz toda combinação `empno`/`empno`, e `where a.mgr = b.empno` mantém só os pares em que `b` realmente é o gerente de `a`. Escrever com um `JOIN` explícito é a mesma consulta e se lê melhor:

```sql
select a.ename as employee, b.ename as manager
  from emp a
  join emp b on a.mgr = b.empno;
```

Só o operador de concatenação de strings difere entre fornecedores; o self-join em si é idêntico em todo lugar: `||` no PostgreSQL, `concat(...)` no MySQL, `+` no SQL Server.

```sql
-- MySQL
select concat(a.ename, ' works for ', b.ename) as emps_and_mgrs
  from emp a join emp b on a.mgr = b.empno;

-- SQL Server
select a.ename + ' works for ' + b.ename as emps_and_mgrs
  from emp a join emp b on a.mgr = b.empno;
```

Há uma armadilha que vale nomear: um inner join **descarta a raiz**. `KING` tem `mgr IS NULL`, e `NULL = b.empno` nunca é verdadeiro, então `KING` nunca aparece no resultado acima. Manter a raiz exige um outer join:

```sql
select a.ename as employee, b.ename as manager
  from emp a
  left join emp b on a.mgr = b.empno;

ENAME      MGR
---------- ----------
FORD       JONES
...
SMITH      FORD
KING                    -- a raiz agora aparece, com gerente NULL
```

Uma subconsulta escalar é uma formulação equivalente e tem o mesmo comportamento de preservar NULL que o left join, o que às vezes a torna a forma mais intuitiva de ler a relação:

```sql
select a.ename,
       (select b.ename from emp b where b.empno = a.mgr) as mgr
  from emp a;
```

### Dois self-joins para dois níveis

Cada nível adicional de hierarquia custa mais uma cópia da tabela na cláusula `FROM` e mais um predicado de join. O funcionário `MILLER` trabalha para `CLARK`, que trabalha para `KING`: três níveis, então três aliases e dois joins:

```sql
select a.ename as leaf,
       b.ename as branch,
       c.ename as root
  from emp a
  join emp b on a.mgr = b.empno
  join emp c on b.mgr = c.empno
 where a.ename = 'MILLER';

LEAF     BRANCH   ROOT
-------- -------- --------
MILLER   CLARK    KING
```

Formatado como o caminho de uma coluna do livro:

```sql
select a.ename || '-->' || b.ename || '-->' || c.ename
       as leaf___branch___root
  from emp a
  join emp b on a.mgr = b.empno
  join emp c on b.mgr = c.empno
 where a.ename = 'MILLER';

LEAF___BRANCH___ROOT
---------------------
MILLER-->CLARK-->KING
```

O padrão é completamente regular, e essa regularidade é exatamente o problema. Um terceiro nível é um quarto alias e um terceiro join:

```sql
select a.ename, b.ename, c.ename, d.ename
  from emp a
  join emp b on a.mgr = b.empno
  join emp c on b.mgr = c.empno
  join emp d on c.mgr = d.empno;
```

Duas coisas pioram ao mesmo tempo. Primeiro, a cadeia de joins cresce linearmente com a profundidade: `n` níveis significam `n-1` joins, `n` aliases e `n` colunas para projetar, tudo digitado à mão. Segundo, e pior, os inner joins **filtram em silêncio**: a consulta de quatro aliases acima só retorna funcionários que têm uma cadeia completa de quatro níveis de gerentes acima deles, então `MILLER` (com só três níveis) desaparece por completo. Fazer os ramos mais rasos sobreviverem significa trocar todo join por `LEFT JOIN` e depois aplicar coalesce sobre as colunas possivelmente `NULL`, e é aí que a legibilidade despenca:

```sql
select a.ename,
       coalesce(d.ename, c.ename, b.ename, a.ename) as topmost_known
  from emp a
  left join emp b on a.mgr = b.empno
  left join emp c on b.mgr = c.empno
  left join emp d on c.mgr = d.empno;
```

Passados dois ou três níveis, a cadeia de self-joins está respondendo a pergunta errada: ela só consegue expressar uma hierarquia cuja profundidade é uma constante conhecida ao escrever a consulta, e árvores reais raramente são assim. É exatamente essa lacuna que as CTEs recursivas fecham: uma consulta `WITH RECURSIVE` sobe (ou desce) a hierarquia a partir de uma linha inicial até acabarem os pais, sem nenhuma contagem de joins gravada no texto. Veja [Recursive Hierarchy Queries and Tree Traversal](sql-recursive-hierarchy-queries) para essa técnica e para a classificação em folha/ramo/raiz que decorre dela.

## Trade-offs

- **Simples e rápido para hierarquias rasas e de profundidade fixa, inútil para profundidade variável.** Um self-join de um ou dois níveis é um join comum: o planejador o enxerga como tal, um índice em `empno` (normalmente a chave primária) torna a busca uma sondagem de índice barata por linha, e não há maquinário de recursão envolvido. Mas a profundidade fica gravada no texto da consulta, então uma hierarquia que pode ter dois níveis para uma linha e seis para outra não pode ser expressa de jeito nenhum.
- **Inner joins descartam em silêncio as linhas que não alcançam a profundidade exigida.** Este é o modo de falha que morde em produção, porque produz um *resultado menor que parece correto* em vez de um erro: uma consulta de três aliases não retorna nada para um funcionário cujo gerente não tem gerente, e a raiz da árvore some de um join de um nível porque `mgr IS NULL` nunca casa. `LEFT JOIN` corrige isso, ao custo de toda coluna do pai virar anulável e toda expressão seguinte precisar de `COALESCE`.
- **A legibilidade piora a cada nível de join.** Um self-join se lê bem, dois ainda dá para acompanhar, três é uma parede de aliases de uma letra em que `c.mgr = d.empno` não dá nenhuma pista de qual nível representa. Não há sintaxe para tornar `a`/`b`/`c`/`d` autoexplicativos além de renomeá-los (`employee`, `manager`, `director`), o que ajuda, mas não impede a consulta de crescer linearmente.
- **A sintaxe é genuinamente estável; o que mudou foi o julgamento.** Um self-join é só um join com dois aliases sobre a mesma tabela; PostgreSQL, MySQL e SQL Server o suportam sem mudanças há décadas, e nada nas soluções 13.1/13.2 do livro está descontinuado. O que mudou desde a primeira edição foi a alternativa: CTEs recursivas agora estão disponíveis em todo engine relevante (o MySQL as ganhou no 8.0), então "encadear mais self-joins" é uma escolha deliberada para dados sabidamente rasos, e não a única opção para árvores mais profundas.
- **Só o operador de concatenação é uma questão de portabilidade.** `||` vs. `CONCAT()` vs. `+` diferem entre fornecedores, mas isso é um detalhe de formatação de string por cima: o join em si é portado literalmente. Selecionar as colunas do pai separadamente em vez de concatená-las evita a diferença por completo e mantém a consulta independente do engine.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 13, "Hierarchical Queries", receitas 13.1, 13.2, p. 436-444: doc
- [PostgreSQL Documentation: Joins Between Tables (self-join with table aliases)](https://www.postgresql.org/docs/current/tutorial-join.html): doc
- [MySQL Reference Manual: JOIN Clause](https://dev.mysql.com/doc/refman/8.4/en/join.html): doc
