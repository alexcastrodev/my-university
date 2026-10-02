---
version: 1.0
updatedAt: 2026-08-06
title: Consultas Hierárquicas Recursivas e Travessia de Árvores
summary: Percorrer uma tabela autorreferenciada até uma profundidade arbitrária com uma CTE recursiva (visões completas da árvore, todos os descendentes de um nó e classificação em folha/ramo/raiz), além dos limites de profundidade de recursão de cada fornecedor, que decidem quando ela quebra.
---
## Objective

Uma tabela autorreferenciada (`emp.mgr` apontando para `emp.empno`, o `parent_id` de uma categoria apontando para outra categoria) codifica uma hierarquia de profundidade *desconhecida*. Uma cadeia fixa de self-joins (veja [Hierarchical Parent-Child Relationships](sql-hierarchical-parent-child-relationships)) resolve o caso raso, de profundidade conhecida: um join por nível, três joins para três níveis. Ela não resolve "desça até não sobrar nada", porque a quantidade de joins teria que ser escrita antes de você saber quão fundo os dados vão. A CTE recursiva faz exatamente isso: um **membro âncora** escolhe as linhas iniciais, um **membro recursivo** faz o join da CTE de volta com a tabela base para encontrar um nível de filhos, e o engine reexecuta o membro recursivo contra cada novo lote de linhas até ele não retornar nenhuma.

## Use Cases

- Renderizar um organograma completo (todo funcionário, indentado sob seu gerente) para uma hierarquia que tem quatro níveis hoje e seis no próximo trimestre, sem mudar a consulta.
- Encontrar todo funcionário que se reporta, direta ou indiretamente, a um determinado gerente, para uma checagem de permissão ou um relatório de "no orçamento de quem isso cai".
- Classificar uma árvore de categorias de produtos em categorias **folha** (as únicas que podem conter produtos) e categorias **ramo** (que existem só para organizar outras categorias), para que a UI saiba quais nós são selecionáveis.
- Explodir uma lista de materiais: dada uma montagem, listar todo componente e subcomponente em qualquer profundidade abaixo dela.
- Auditar uma hierarquia em busca de órfãos e múltiplas raízes antes de uma migração: linhas cujo pai não existe mais, ou uma árvore que acaba tendo três raízes em vez de uma.

## Deep Dive

### Uma visão hierárquica da tabela inteira

A tabela `EMP` do livro tem a forma canônica: `empno` é a chave, `mgr` aponta para o `empno` de outra linha, e a raiz (KING) tem `mgr IS NULL`.

```sql
create table emp (
  empno integer primary key,
  ename varchar(10),
  mgr   integer references emp(empno)
);
```

A receita 13.3 monta a árvore completa ancorando na raiz e concatenando o nome de cada funcionário ao caminho do seu gerente:

```sql
-- PostgreSQL
with recursive x (ename, empno) as (
  select cast(ename as varchar(100)), empno
    from emp
   where mgr is null                       -- membro âncora: a(s) linha(s) raiz
  union all
  select cast(x.ename || ' - ' || e.ename as varchar(100)), e.empno
    from emp e, x                          -- membro recursivo: um nível abaixo
   where e.mgr = x.empno
)
select ename as emp_tree
  from x
 order by 1;
```

```
EMP_TREE
------------------------------
KING
KING - BLAKE
KING - BLAKE - ALLEN
KING - CLARK
KING - CLARK - MILLER
KING - JONES
KING - JONES - FORD
KING - JONES - FORD - SMITH
```

Os três engines diferem apenas na concatenação de strings e em uma palavra-chave:

```sql
-- MySQL 8+: RECURSIVE é obrigatório, e || não é concatenação por padrão
with recursive x (ename, empno) as (
  select cast(ename as char(100)), empno from emp where mgr is null
  union all
  select cast(concat(x.ename, ' - ', e.ename) as char(100)), e.empno
    from emp e, x where e.mgr = x.empno
)
select ename as emp_tree from x order by 1;
```

```sql
-- SQL Server: sem a palavra-chave RECURSIVE, + para concatenar
with x (ename, empno) as (
  select cast(ename as varchar(100)), empno from emp where mgr is null
  union all
  select cast(x.ename + ' - ' + e.ename as varchar(100)), e.empno
    from emp e, x where e.mgr = x.empno
)
select ename as emp_tree from x order by 1;
```

Esquecer o `RECURSIVE` no MySQL não produz uma mensagem útil: o nome da CTE simplesmente não está no escopo dentro da sua própria definição, então você recebe `ERROR 1146 (42S02): Table 'x' doesn't exist`. O T-SQL, ao contrário, infere a recursão pelo fato de a CTE referenciar a si mesma; `WITH RECURSIVE` nem é sintaxe válida lá.

Carregar uma coluna `depth` explícita normalmente vale mais que o caminho concatenado, porque permite indentar, filtrar até N níveis ou perceber uma recursão descontrolada:

```sql
with recursive x (empno, ename, depth) as (
  select empno, ename, 0
    from emp
   where mgr is null
  union all
  select e.empno, e.ename, x.depth + 1
    from emp e, x
   where e.mgr = x.empno
)
select repeat('  ', depth) || ename as emp_tree, depth
  from x;
```

### Ancorando a recursão em um nó específico

A receita 13.4 é a mesma máquina com outra âncora: em vez de "comece pela raiz", comece em uma linha nomeada e desça *a partir* dela. Tudo o que a recursão alcança é descendente dessa linha.

```sql
with recursive x (ename, empno) as (
  select ename, empno
    from emp
   where ename = 'JONES'                   -- âncora: o único nó que nos interessa
  union all
  select e.ename, e.empno
    from emp e, x
   where x.empno = e.mgr                   -- e é filho de algo que já está em x
)
select ename
  from x;
```

```
ENAME
----------
JONES
SCOTT
ADAMS
FORD
SMITH
```

Note a direção do join: ela é a *única* coisa que separa "todos os descendentes" de "todos os ancestrais":

```sql
-- descendentes de JONES: filhos de linhas que já estão em x
where x.empno = e.mgr

-- ancestrais de MILLER: o gerente de linhas que já estão em x
where x.mgr = e.empno
```

A linha âncora é incluída no resultado, o que quase sempre é o que você quer para uma checagem de controle de acesso ("este gerente pode ver este registro?"), mas exige um `where depth > 0` explícito quando a pergunta é estritamente "quem se reporta *a* JONES."

### Classificando linhas como folha, ramo ou raiz

A receita 13.5 não precisa de recursão nenhuma: o tipo de um nó é decidido inteiramente pelos seus vizinhos imediatos. Uma **folha** não tem filhos, uma **raiz** não tem pai, um **ramo** tem os dois. O livro expressa isso com três subconsultas escalares correlacionadas, envolvendo cada `count(*)` em `sign()` para que o resultado seja uma flag 0/1 em vez de uma contagem bruta:

```sql
select e.ename,
       (select sign(count(*)) from emp d
         where 0 = (select count(*) from emp f
                     where f.mgr = e.empno))       as is_leaf,
       (select sign(count(*)) from emp d
         where d.mgr = e.empno
           and e.mgr is not null)                  as is_branch,
       (select sign(count(*)) from emp d
         where d.empno = e.empno
           and d.mgr is null)                      as is_root
  from emp e
 order by 4 desc, 3 desc;
```

O `sign()` faz um trabalho real ali: sem ele, `is_leaf` retornaria 14 (a contagem de linhas de `EMP`) em vez de 1. A forma moderna abandona a contagem por completo e diz o que quer dizer com `EXISTS`, o que também permite ao engine parar no primeiro filho encontrado em vez de contar todos:

```sql
select e.ename,
       case when not exists (select 1 from emp c where c.mgr = e.empno)
            then 1 else 0 end                                as is_leaf,
       case when exists (select 1 from emp c where c.mgr = e.empno)
             and e.mgr is not null
            then 1 else 0 end                                as is_branch,
       case when e.mgr is null then 1 else 0 end             as is_root
  from emp e
 order by is_root desc, is_branch desc;
```

Uma única expressão `case` muitas vezes é mais útil que três flags, já que os três estados são mutuamente exclusivos:

```sql
select ename,
       case when mgr is null then 'root'
            when not exists (select 1 from emp c where c.mgr = emp.empno)
                 then 'leaf'
            else 'branch'
       end as node_type
  from emp;
```

Tudo isso pressupõe uma **hierarquia em árvore**, em que uma raiz é marcada por `mgr IS NULL`. O livro menciona a alternativa explicitamente: uma *hierarquia recursiva* faz a raiz referenciar a si mesma (o `mgr` de KING é o próprio `empno` de KING). Esse modelo quebra tanto o teste `is_root` quanto todas as CTEs recursivas acima: a raiz vira filha de si mesma e a recursão nunca termina. Use `NULL` para raízes, a menos que algo fora do seu controle force o contrário.

### Limites de profundidade de recursão são um padrão de cada fornecedor, não uma regra do SQL

Esta é a parte das consultas hierárquicas que morde em produção, e os três engines discordam completamente:

| Engine | Limite padrão | Como sobrescrever | Erro ao estourar |
| --- | --- | --- | --- |
| PostgreSQL | nenhum | `statement_timeout` / `LIMIT` | roda até a memória ou o timeout |
| MySQL 8+ | `cte_max_recursion_depth` = 1000 | `SET SESSION`, hint `SET_VAR` | `ERROR 3636` |
| SQL Server | `MAXRECURSION` = 100 | `OPTION (MAXRECURSION n)` | `Msg 530` |

**O 100 do SQL Server é o que surpreende as pessoas**, porque é baixo o bastante para uma hierarquia real e sem bugs atingi-lo: uma árvore de categorias profunda, uma estrutura de pastas ou a explosão de uma lista de materiais. A instrução não retorna resultados parciais com um aviso; ela dá erro:

```
Msg 530, Level 16, State 1
The statement terminated. The maximum recursion 100 has been exhausted
before statement completion.
```

A correção é um hint na instrução mais externa, com `0` significando sem limite (e, portanto, sem rede de segurança):

```sql
with x (empno, ename, depth) as ( /* ... */ )
select * from x
option (maxrecursion 1000);   -- 0..32767; 0 desativa o limite por completo
```

**O 1000 do MySQL** existe pelo mesmo motivo, mas tem muito menos chance de disparar com dados reais, então quando dispara normalmente significa um ciclo, e não uma árvore profunda:

```
ERROR 3636 (HY000): Recursive query aborted after 1001 iterations.
Try increasing @@cte_max_recursion_depth to a larger value.
```

```sql
set session cte_max_recursion_depth = 100000;
-- ou, por instrução, sem mexer no estado da sessão:
select /*+ SET_VAR(cte_max_recursion_depth = 1M) */ * from x;
```

**O PostgreSQL não tem limite de profundidade nenhum**, o padrão mais permissivo e também o mais perigoso, já que um `parent_id` cíclico produz uma consulta que consome memória e espaço temporário até o `statement_timeout` matá-la. A resposta do PostgreSQL desde a **versão 14** é a cláusula `CYCLE` do padrão SQL, que acompanha as chaves visitadas e para a recursão quando vê uma duas vezes:

```sql
with recursive x (empno, ename, mgr) as (
  select empno, ename, mgr from emp where mgr is null
  union all
  select e.empno, e.ename, e.mgr from emp e, x where e.mgr = x.empno
) cycle empno set is_cycle using path
select empno, ename, is_cycle from x;
```

A cláusula companheira `SEARCH DEPTH FIRST BY ... SET ordercol` / `SEARCH BREADTH FIRST BY ...`, adicionada na mesma versão, substitui o contador `depth` feito à mão e a ordenação pela string de caminho. Nem `CYCLE` nem `SEARCH` existem no MySQL ou no SQL Server; lá, a proteção contra ciclos é o limite de profundidade mais uma coluna manual de conjunto de visitados.

Também vale saber antes de escrever o membro recursivo: tanto o MySQL quanto o SQL Server proíbem `DISTINCT`, `GROUP BY` e agregações dentro dele (o MySQL acrescenta window functions e `ORDER BY`; o SQL Server acrescenta `TOP`, `HAVING`, subconsultas e outer joins). "Agregar a árvore enquanto a percorre" não é opção em nenhum dos dois; agregue a saída da CTE na consulta externa.

## Trade-offs

- **O limite de profundidade que dispara em produção quase nunca é o que você testou.** O padrão `MAXRECURSION 100` do SQL Server é baixo o bastante para dados reais o ultrapassarem, e ele faz a instrução inteira falhar em vez de truncar: uma árvore de categorias que cresce um nível além de 100 transforma um relatório que funcionava em `Msg 530`. O 1000 do MySQL e a ausência de limite do PostgreSQL significam que a mesma consulta, portada sem mudanças, tem três modos de falha diferentes. Defina o limite explicitamente para qualquer coisa que rode sobre uma hierarquia cuja profundidade você não controla.
  ```sql
  select * from x option (maxrecursion 0);   -- ilimitado: sem erro, sem rede de segurança
  ```
- **Um ciclo na autorreferência transforma uma CTE recursiva em um loop infinito.** Nada no schema impede `A.parent = B` e `B.parent = A`, a menos que você tenha adicionado uma constraint ou trigger para isso, e um `UPDATE` ruim basta. A cláusula `CYCLE` do PostgreSQL (14+) trata isso direito; o MySQL e o SQL Server dependem do limite de profundidade como disjuntor acidental, o que significa que o sintoma é um erro pouco útil de "recursão máxima esgotada" em vez de "seus dados têm um loop."
- **CTEs recursivas percorrem a árvore de novo a cada consulta, e esse custo é por leitura.** Para uma hierarquia com muita leitura (um menu de categorias renderizado a cada carregamento de página, uma checagem de permissão a cada requisição), uma closure table materializada (uma linha por par ancestral/descendente) ou uma coluna de caminho materializado transforma a travessia em uma única busca indexada. A troca é amplificação de escrita e o fardo de manter a estrutura desnormalizada correta quando os nós se movem; a recursão é o padrão certo até o volume de leitura provar o contrário.
- **A classificação folha/ramo/raiz não precisa de recursão, e escrevê-la de forma recursiva é um erro real de desempenho.** O tipo do nó depende só dos vizinhos imediatos, então `EXISTS` contra a mesma tabela responde em uma passada. A forma `sign(count(*))` do livro está correta, mas conta todos os filhos antes de colapsar para 0/1; `EXISTS` para no primeiro casamento.
  ```sql
  -- conta todos os filhos só para descobrir "pelo menos um"
  (select sign(count(*)) from emp d where d.mgr = e.empno)
  -- para no primeiro filho
  case when exists (select 1 from emp d where d.mgr = e.empno) then 1 else 0 end
  ```
- **A coluna de caminho concatenado trunca em silêncio.** Fazer cast para `varchar(100)` na âncora fixa a largura da coluna para toda a recursão, então um ramo profundo produz um caminho cortado em vez de um erro na maioria das configurações, e o corte parece um caminho legítimo mais curto. Dimensione o cast para o ramo mais profundo que você possa ter de forma plausível, ou carregue arrays de `empno` / uma coluna `depth` separada em vez de se apoiar em uma string formatada.
- **O membro recursivo é o lugar mais restrito do SQL.** Sem `DISTINCT`, sem `GROUP BY`, sem agregações no MySQL ou no SQL Server; o MySQL também proíbe window functions e `ORDER BY`, o SQL Server também proíbe `TOP`, `HAVING`, subconsultas e outer joins. Qualquer coisa analítica precisa acontecer na consulta externa, sobre a saída completa da CTE, o que significa que o instinto de "somar a subárvore enquanto desço", vindo de código procedural, precisa ser reestruturado em "materialize a subárvore e depois agregue."

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 13, "Hierarchical Queries", receitas 13.3, 13.4, 13.5, p. 444-458: doc
- [PostgreSQL Documentation: WITH Queries (Common Table Expressions), including SEARCH and CYCLE](https://www.postgresql.org/docs/current/queries-with.html): doc
- [MySQL Reference Manual: WITH (Common Table Expressions) and cte_max_recursion_depth](https://dev.mysql.com/doc/refman/8.4/en/with.html): doc
- [Microsoft Learn: WITH common_table_expression (Transact-SQL), recursive CTE guidelines and MAXRECURSION](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql): doc
