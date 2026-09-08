---
version: 1.0
updatedAt: 2026-08-05
title: "Dados Delimitados: De Linhas para Listas e de Volta"
summary: Colapsando linhas em uma string separada por vírgula com STRING_AGG/GROUP_CONCAT, dividindo uma string delimitada de volta em linhas para uma lista IN ou join, e extraindo o n-ésimo token; com as diferenças por fornecedor que ainda importam.
---
## Objective

Dado delimitado é um problema de duas direções, e as duas aparecem constantemente. Uma direção: você tem muitas linhas e precisa delas colapsadas em uma única string separada por vírgula por grupo: uma coluna de relatório, uma lista de destinatários de email, um resumo de tag. A outra direção: você tem uma única string como `'7654,7698,7782,7788'` e precisa dela de volta como linhas, para que possa alimentar uma lista `IN` ou fazer join contra uma tabela de verdade. O SQL não tem nenhuma coerção automática entre essas formas: uma vírgula dentro de aspas é só um caractere, e o motor nunca vai adivinhar que significa "lista". Todo SGBD agora vem com funções feitas sob medida para as duas direções, mas os nomes de função, sua ordem de argumento, e se sequer existem ainda diferem o suficiente para que o *idioma* seja por fornecedor mesmo quando a *ideia* é universal.

## Use Cases

- Construir uma coluna de resumo separada por vírgula para um relatório: todo nome de funcionário por departamento em uma linha, toda tag por artigo, todo endereço de email por cidade, sem empurrar a concatenação para código de aplicação.
- Aceitar um filtro multivalor de uma UI ou uma API como uma única string delimitada (um grupo de checkbox serializado para `"10,20,30"`) e transformá-lo em linhas contra as quais fazer join, em vez de construir uma lista `IN` de SQL dinâmico por concatenação de string.
- Ler um campo de uma coluna legada que armazena um registro delimitado: o terceiro segmento de um código de localização `region,site,rack`, o segundo nome em um blob `first,middle,last`, sem dividir o todo.
- Explodir uma coluna `tags` desnormalizada em linhas para que possa ser agrupada, contada, ou filtrada como dado relacional normal.

## Deep Dive

### Agregando linhas em uma lista delimitada

Transformar isto:

```
DEPTNO EMPS
------ ----------
    10 CLARK
    10 KING
    10 MILLER
    20 SMITH
    20 ADAMS
```

nisto:

```
DEPTNO EMPS
------ ------------------------------------
    10 CLARK,KING,MILLER
    20 SMITH,JONES,SCOTT,ADAMS,FORD
```

é uma função de agregado, exatamente como `SUM` ou `COUNT`: colapsa um grupo de linhas em um valor, então precisa de um `GROUP BY`.

**PostgreSQL**: `string_agg(value, delimiter)`, com a ordenação fornecida como um `ORDER BY` de agregado dentro dos parênteses:

```sql
select deptno,
       string_agg(ename, ',' order by empno) as emps
  from emp
 group by deptno;
```

**MySQL**: `GROUP_CONCAT`, que antecede o padrão e tem sua própria gramática: o delimitador chega via uma palavra-chave `SEPARATOR`, não um segundo argumento, e `DISTINCT` e `ORDER BY` são ambos embutidos na chamada:

```sql
select deptno,
       group_concat(ename order by empno separator ',') as emps
  from emp
 group by deptno;
```

**SQL Server 2017+**: `STRING_AGG(expression, separator)`, mas a ordenação é uma cláusula `WITHIN GROUP (ORDER BY ...)` *fora* dos parênteses, correspondendo a como o T-SQL escreve agregados de conjunto ordenado em geral:

```sql
select deptno,
       string_agg(ename, ',') within group (order by empno) as emps
  from emp
 group by deptno;
```

Três motores, três lugares diferentes para colocar a ordenação. Vale a pena ser pedante sobre isso porque a própria solução do livro para essa receita não é executável como impressa em nenhum deles: escreve `string_agg(ename order by empno separator, ',')` para PostgreSQL e SQL Server (misturando a palavra-chave `SEPARATOR` do MySQL em uma função que não tem tal palavra-chave, mais uma vírgula perdida), e `group_concat(ename order by empno separator, ',')` para MySQL (a mesma vírgula perdida). A prosa em volta está certa; a sintaxe é uma vítima de composição tipográfica. Use as três formas acima.

**Antes do SQL Server 2017** não havia nenhum agregado de todo, e o workaround padrão era o truque `FOR XML PATH('')`: construir uma subconsulta que emite fragmentos `,value`, deixar o serializador XML concatená-los, depois cortar o delimitador inicial com `STUFF`:

```sql
select d.deptno,
       stuff((select ',' + e.ename
                from emp e
               where e.deptno = d.deptno
               order by e.empno
                 for xml path(''), type).value('.', 'nvarchar(max)'),
             1, 1, '') as emps
  from dept d;
```

A parte `, type).value('.', 'nvarchar(max)')` não é decoração: sem ela o serializador XML escapa `&`, `<`, e `>` para `&amp;`, `&lt;`, `&gt;`, então qualquer dado contendo esses caracteres volta corrompido. Essa sutileza é o melhor argumento único para tratar `FOR XML PATH` como legado: é uma função de string implementada por acidente em cima de um serializador XML, e herda as regras de escape do XML quer você queira ou não. No SQL Server 2017 e posterior, não há motivo para escrevê-lo.

> O nome padrão SQL:2016 para isso é `LISTAGG`, que é o que Db2 e Oracle ambos implementam (Oracle desde 11g Release 2, o que também significa que a solução Oracle do livro, um truque de consulta hierárquica com `SYS_CONNECT_BY_PATH`, já estava uma década obsoleta quando a segunda edição foi impressa). PostgreSQL, MySQL, e SQL Server todos seguiram seu próprio caminho em vez disso, então "a função padrão" não é a portável aqui.

### Dividindo uma lista delimitada em linhas

O inverso. O livro enquadra o problema precisamente: isso falha,

```sql
select ename, sal, deptno
  from emp
 where empno in ( '7654,7698,7782,7788' );
```

porque a lista `IN` contém exatamente um elemento (uma string), e `EMPNO` é numérico. O SQL não consegue ver as vírgulas como estrutura. A string precisa virar linhas primeiro.

**SQL Server 2016+**: `STRING_SPLIT` é uma função de valor de tabela; use-a em `FROM`, ou dê `CROSS APPLY` nela para dividir um valor de coluna por linha:

```sql
-- filter by a list, without building dynamic SQL
select e.ename, e.sal, e.deptno
  from emp e
  join string_split('7654,7698,7782,7788', ',') s
    on e.empno = cast(s.value as int);

-- explode a delimited column, one row per token
select p.productid, p.name, s.value as tag
  from product p
 cross apply string_split(p.tags, ',') s
 where rtrim(s.value) <> '';
```

Duas restrições a saber: `STRING_SPLIT` exige nível de compatibilidade de banco de dados 130 ou superior (a menos que `ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS` esteja definido), e o separador precisa ser um *único caractere*: ele não divide em `'~@~'`.

**PostgreSQL**: duas grafias, ambas nativas. `unnest(string_to_array(...))` funciona em toda versão suportada; `string_to_table(...)` é a forma direta que retorna conjunto, adicionada no PostgreSQL 14:

```sql
-- classic: array, then unnest
select e.ename, e.sal, e.deptno
  from emp e
  join unnest(string_to_array('7654,7698,7782,7788', ',')) as t(empno)
    on e.empno = t.empno::int;

-- PostgreSQL 14+: skip the array entirely
select * from string_to_table('7654,7698,7782,7788', ',') as t(empno);
```

Para o caso específico de "filtre por essa lista", o PostgreSQL tem uma forma mais curta que pula o join por completo: `= ANY(array)`, que é o que a maioria dos drivers PostgreSQL gera para uma lista parametrizada de qualquer forma:

```sql
select ename, sal, deptno
  from emp
 where empno = any(string_to_array('7654,7698,7782,7788', ',')::int[]);
```

**MySQL**: a única lacuna genuína. Ainda não há função de divisão nativa no MySQL 8.4 ou 9.x; `SUBSTRING_INDEX` extrai *um* token, não uma tabela. As duas abordagens que funcionam são uma CTE recursiva (MySQL 8.0+) que descasca um token por iteração:

```sql
with recursive split (rest, tok) as (
  select concat('7654,7698,7782,7788', ','), ''
  union all
  select substring(rest, instr(rest, ',') + 1),
         substring_index(rest, ',', 1)
    from split
   where rest <> ''
)
select cast(tok as unsigned) as empno
  from split
 where tok <> '';
```

ou o truque `JSON_TABLE`: reescrever a string delimitada como um array JSON e deixar o parser JSON fazer a divisão, que geralmente é mais rápido e sempre mais curto:

```sql
select j.tok
  from json_table(
         concat('["', replace('CLARK,KING,MILLER', ',', '","'), '"]'),
         '$[*]' columns (tok varchar(50) path '$')
       ) as j;
```

A versão `JSON_TABLE` quebra se um token contém um `"` ou `\`, então é um truque, não um divisor de propósito geral, mas para o caso esmagadoramente comum de ids numéricos ou identificadores simples é a escolha pragmática.

Todas essas substituem a maquinaria de "percorrer a string" por fornecedor do livro: as tabelas pivot `(select id as pos from t10) iter` cruzadas contra a string, com aritmética `SUBSTR`/`INSTR`/`CHARINDEX` para talhar cada token. Essas soluções ainda rodam, e vale a pena lê-las uma vez para entender o que os embutidos fazem. Mas exigem uma tabela de números dimensionada para a lista possível mais longa, e nenhuma delas é o que você deveria escrever em 2026.

### Extraindo a n-ésima substring delimitada

Às vezes você não quer todos os tokens, só um: o segundo nome de `'mo,larry,curly'`. Aqui os fornecedores divergem mais.

**PostgreSQL**: `split_part` faz exatamente isso e nada mais, o que a torna a mais limpa das três:

```sql
select split_part(name, ',', 2) as sub from v;
--  larry
--  gina
```

Desde o PostgreSQL 14, `n` pode ser negativo para contar a partir do fim, que é a forma fácil de pegar um segmento final de comprimento desconhecido:

```sql
select split_part('abc,def,ghi,jkl', ',', -2);  -- ghi
```

**MySQL**: nenhum `split_part`, mas o idioma de `SUBSTRING_INDEX` aninhado é o substituto canônico e lê bem uma vez que você já o viu. A chamada interna mantém tudo à esquerda do n-ésimo delimitador; a chamada externa mantém tudo à direita do *último* delimitador nesse resultado:

```sql
select substring_index(substring_index(name, ',', 2), ',', -1) as sub
  from v;
```

Trace isso em `'mo,larry,curly'`: a chamada interna retorna `'mo,larry'`, a chamada externa pega tudo depois de sua vírgula final, dando `'larry'`.

**SQL Server 2022+**: o terceiro argumento do `STRING_SPLIT`, `enable_ordinal`, adiciona uma coluna `ordinal` com a posição baseada em 1 de cada token, que transforma "n-ésima substring" em uma cláusula `WHERE`:

```sql
select v.name, s.value as sub
  from v
 cross apply string_split(v.name, ',', 1) as s
 where s.ordinal = 2;
```

Esse é o único lugar onde a solução do livro deveria ser tratada como ativamente errada em vez de meramente datada. Sua resposta SQL Server para essa receita envolve `STRING_AGG` em torno da view inteira para amassar *as duas* linhas em uma única string, depois divide isso: porque `STRING_SPLIT` sem `enable_ordinal` não tem coluna de posição e só consegue receber um valor de cada vez. Isso tanto destrói o agrupamento por linha quanto depende da ordem de divisão, que a Microsoft explicitamente não garante: "as linhas de saída podem estar em qualquer ordem." `CROSS APPLY` mais `ordinal` é o formato correto.

No SQL Server 2019 e anterior, onde `enable_ordinal` não existe, a aritmética posicional é inevitável: anexando um delimitador final para que o último token tenha um terminador para encontrar:

```sql
select name,
       substring(name,
                 charindex(',', name) + 1,
                 charindex(',', name + ',', charindex(',', name) + 1)
                   - charindex(',', name) - 1) as sub
  from v;
```

Isso está bom para um `n` fixo e pequeno. Não generaliza para "o n-ésimo token" com `n` como um parâmetro, que é exatamente por que a coluna ordinal foi adicionada.

## Trade-offs

- **O MySQL trunca o agregado silenciosamente; o SQL Server dá erro; o PostgreSQL não se importa.** `GROUP_CONCAT` respeita `group_concat_max_len`, cujo padrão é **1024 bytes**: exceda isso e o resultado é silenciosamente cortado, produzindo uma string que parece válida e está errada. O SQL Server adota a abordagem oposta: `STRING_AGG` retorna `nvarchar(4000)`/`varchar(8000)` a menos que a entrada já seja um tipo MAX, e transbordar levanta o erro 9829, "STRING_AGG aggregation result exceeded the limit of 8000 bytes": ruidoso, mas significa que você precisa lembrar `convert(nvarchar(max), col)` para qualquer lista que possa ficar longa. O `text` do PostgreSQL não tem teto prático aqui. Dos três modos de falha, o do MySQL é o perigoso porque nada te avisa.
  ```sql
  -- MySQL: raise it per session, or accept truncation at 1024 bytes
  set session group_concat_max_len = 1048576;
  -- SQL Server: convert first, or hit error 9829
  select string_agg(convert(nvarchar(max), ename), ',') from emp;
  ```
- **Ordem de divisão não é garantida, então "o n-ésimo token" precisa de um ordinal explícito, não uma ordem de linha que você por acaso observou.** A Microsoft declara diretamente que a saída do `STRING_SPLIT` "pode estar em qualquer ordem"; o `unnest` do PostgreSQL por acaso preserva a ordem do array mas você ainda deveria escrever `WITH ORDINALITY` se a posição importa, porque isso torna a dependência visível em vez de implícita. O mesmo se aplica na outra direção: um `string_agg`/`GROUP_CONCAT` sem um `ORDER BY` explícito produz uma string cuja ordem de elemento pode mudar entre execuções, formatos de plano, ou depois de uma mudança de paralelismo: e uma coluna de relatório que se reordena entre execuções é um relatório de bug esperando para acontecer.
  ```sql
  -- position is data, so ask for it
  select tok, n
    from unnest(string_to_array('a,b,c', ',')) with ordinality as t(tok, n);
  ```
- **Dividir uma coluna delimitada armazenada anula todo índice sobre ela.** Usar essas funções em um *parâmetro* está tudo bem e muitas vezes é ótimo: substitui o antipadrão real de concatenar uma lista `IN` de SQL dinâmico. Usá-las em uma *coluna*, porém, significa que toda consulta que filtra por um token precisa dividir toda linha primeiro: nenhum índice em uma coluna `tags varchar(400)` consegue ajudar a responder "quais produtos têm a tag `bike`". Se essa consulta roda com frequência, a coluna delimitada é um problema de normalização a consertar com uma tabela de junção, não um problema de string a otimizar.
- **Não há uma grafia portável, só uma ideia portável.** Toda direção desse problema precisa de um nome de função, ordem de argumento, e posição de cláusula diferentes em cada um dos três motores, e o MySQL ainda não tem nenhuma divisão nativa de valor de tabela de todo na 9.x, então sua resposta é estruturalmente diferente (uma CTE recursiva ou uma ida e volta JSON) em vez de só nomeada diferentemente. Código que precisa rodar em mais de um motor deveria empurrar essa lógica atrás de uma fronteira consulta-por-dialeto em vez de caçar um subconjunto comum.
- **Tokens vazios e NULL se comportam diferentemente em todo lugar, e as diferenças são silenciosas.** `string_agg` e `GROUP_CONCAT` ambos pulam entradas NULL por completo, incluindo o separador, então um grupo de cinco linhas com dois NULLs produz três elementos, não cinco com lacunas. `STRING_SPLIT` *mantém* substrings de comprimento zero quando delimitadores são adjacentes, que é por que os exemplos da Microsoft todos carregam um `WHERE rtrim(value) <> ''`. `split_part` retorna uma string vazia, não NULL, para um `n` fora de faixa. Nenhuma dessas levanta nada; elas só mudam suas contagens de linha.
  ```sql
  -- SQL Server: 'a,,b' yields three rows, one of them empty
  select value from string_split('a,,b', ',');
  ```

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 6, "Working with Strings", recipes 6.10, 6.11, 6.14, p. 132-136, 153-160] - doc
- [PostgreSQL Documentation: Aggregate Functions (string_agg)](https://www.postgresql.org/docs/current/functions-aggregate.html) - doc
- [PostgreSQL Documentation: String Functions and Operators (split_part, string_to_array, string_to_table)](https://www.postgresql.org/docs/current/functions-string.html) - doc
- [MySQL Reference Manual: Aggregate Function Descriptions (GROUP_CONCAT, group_concat_max_len)](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html) - doc
- [Microsoft Learn: STRING_AGG (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-agg-transact-sql) - doc
- [Microsoft Learn: STRING_SPLIT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-split-transact-sql) - doc
