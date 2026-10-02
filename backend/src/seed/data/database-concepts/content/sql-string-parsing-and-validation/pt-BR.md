---
version: 1.0
updatedAt: 2026-08-05
title: "Análise e Validação de Strings: Removendo, Separando e Verificando o Tipo de Texto"
summary: Limpar caracteres indesejados de uma string, separar dados alfanuméricos misturados em suas partes numérica e de caracteres, e provar que um valor de texto pode ser convertido, comparando o truque TRANSLATE/REPLACE do livro com as expressões regulares e os validadores orientados a tipo de hoje.
---
## Objective

Colunas reais frequentemente são mais sujas do que o tipo declarado sugere: um `varchar` que guarda `"AUD$1,200"`, uma coluna de código legada em que `"CL10AR"` junta um nome e um número de departamento em um só valor, uma importação de CSV que chegou com vírgulas soltas e marcadores de moeda embutidos nos dígitos. Antes que qualquer coisa disso possa participar de um cálculo numérico ou de negócio, ela precisa ser *limpa* (remover os caracteres que não pertencem), *separada* (tirar a parte numérica da parte de caracteres) e *validada* (provar que o texto restante pode de fato ser convertido). A resposta clássica do SQL para as três tarefas são as mesmas duas funções, `TRANSLATE` e `REPLACE`, usadas como um truque de mapeamento de caracteres; a resposta moderna, na maioria dos engines, é uma expressão regular.

## Use Cases

- Validar texto enviado por usuários ou parceiros antes de um `CAST` para `numeric`, para que uma única linha ruim não aborte a instrução inteira.
- Limpar dados importados com caracteres de formatação soltos (separadores de milhar, símbolos de moeda, espaços não separáveis) do que deveria ser uma quantidade simples.
- Separar um código legado no estilo `"SKU123"` / `"CL10AR"` em seus componentes de caracteres e numérico quando o sistema de origem nunca os separou.
- Escapar ou remover caracteres delimitadores (vírgulas, aspas) de um campo de texto antes de exportá-lo para CSV.
- Filtrar uma coluna mista para ficar só com as linhas que contêm algum número, antes de uma agregação numérica.

## Deep Dive

### Removendo caracteres indesejados de uma string

O problema do livro: remover todas as vogais de `ENAME` e todos os zeros de `SAL`. `REPLACE` resolve os zeros diretamente: um caractere, uma chamada. As vogais são o caso interessante, porque `REPLACE` só remove *uma* string de busca por chamada. O truque do livro é primeiro colapsar as cinco vogais em um único caractere sentinela arbitrário com `TRANSLATE` e depois remover esse sentinela com `REPLACE`:

```sql
-- a técnica do livro (PostgreSQL / SQL Server / Oracle / DB2)
select ename,
       replace(translate(ename,'AEIOU','aaaaa'),'a','') as stripped1,
       sal,
       replace(cast(sal as char(4)),'0','')             as stripped2
  from emp;
```

O MySQL não tem `TRANSLATE` (nem no 8.4, nem no 9.x), então o livro recorre a cinco chamadas de `REPLACE` aninhadas:

```sql
-- MySQL, a versão do livro
select ename,
       replace(replace(replace(replace(replace(
         ename,'A',''),'E',''),'I',''),'O',''),'U','') as stripped1,
       sal,
       replace(sal,0,'')                               as stripped2
  from emp;
```

**O PostgreSQL torna o `REPLACE` externo desnecessário.** Seu `translate()` é documentado assim: "Se *from* for mais longo que *to*, as ocorrências dos caracteres extras em *from* são removidas." Então um argumento `to` igual a `''` remove diretamente todo caractere de `from`, e a ida e volta pelo sentinela é pura cerimônia aqui:

```sql
-- PostgreSQL: uma chamada, sem sentinela
select translate(ename,'AEIOU','') as stripped1 from emp;
select translate('12345','143','ax');   -- 'a2x5': o '3' é simplesmente removido
```

**O `TRANSLATE` do SQL Server não consegue fazer isso.** Ele foi adicionado no SQL Server 2017 (a própria receita 6.13 do livro afirma que não é suportado, o que já estava desatualizado na publicação), mas o T-SQL exige que as duas listas coincidam: "`TRANSLATE` retorna um erro se as expressões *characters* e *translations* tiverem tamanhos diferentes." No SQL Server, o passo duplo `REPLACE(TRANSLATE(...))` do livro não é complicação: é obrigatório.

A forma com regex é a que se lê igual em todo lugar em que existe, e ela escala para *classes* de caracteres em vez de uma lista enumerada:

```sql
-- PostgreSQL (a flag 'g' substitui todas as ocorrências, não só a primeira)
select regexp_replace(ename, '[AEIOU]', '', 'g') as stripped1,
       regexp_replace(sal::text, '[^0-9]', '', 'g') as digits_only
  from emp;

-- MySQL 8.0.4+ (REGEXP_REPLACE substitui todas as ocorrências por padrão)
select regexp_replace(ename, '[AEIOU]', '') as stripped1 from emp;

-- SQL Server 2025 (17.x) e Azure SQL: baseado em RE2, novo nesta versão
select regexp_replace(ename, '[AEIOU]', '') as stripped1 from emp;
```

Antes do SQL Server 2025 não havia regex nativo: as opções eram um assembly CLR, ou `LIKE` com classes entre colchetes dentro de um loop `WHILE`, e é exatamente por isso que o idioma `TRANSLATE`/`REPLACE` sobreviveu tanto tempo em bases de código T-SQL.

### Separando as partes numérica e de caracteres

Dada uma única coluna que junta as duas coisas, por exemplo `SMITH800`, o livro extrai cada lado aplicando o mesmo truque de colapsar e remover duas vezes, em direções opostas:

```sql
-- PostgreSQL, a solução do livro
select replace(
         translate(data,'0123456789','0000000000'),'0','')   as ename,
       cast(
         replace(
           translate(lower(data),
                     'abcdefghijklmnopqrstuvwxyz',
                     rpad('z',26,'z')),'z','') as integer)   as sal
  from (select ename || sal as data from emp) x;
```

Leia de dentro para fora. `translate(data,'0123456789','0000000000')` mapeia todo dígito para `0`, dando `SMITH000`; `replace(...,'0','')` então remove todos eles, deixando `SMITH`. A outra direção mapeia as 26 letras para `z` (`zzzzz800`) e depois remove os `z`s, deixando `800` para converter. Funciona, e a intenção é genuinamente difícil de ler à primeira vista.

As duas metades se reduzem a uma única chamada de regex e um padrão óbvio:

```sql
-- PostgreSQL
select regexp_replace(data, '[0-9]',  '', 'g')            as ename,
       regexp_replace(data, '[^0-9]', '', 'g')::integer   as sal
  from (select ename || sal as data from emp) x;

-- MySQL 8.0.4+: a mesma consulta, e o MySQL não tem a alternativa com TRANSLATE
select regexp_replace(data, '[0-9]',  '') as ename,
       cast(regexp_replace(data, '[^0-9]', '') as unsigned) as sal
  from (select concat(ename, sal) as data from emp) x;
```

A comparação com o MySQL é a mais marcante. A solução do livro no MySQL para essa classe de problema é um *cross join com uma tabela pivô de inteiros*, percorrendo a string um caractere por vez e remontando os dígitos com `GROUP_CONCAT`: uma linha por caractere e depois um group by. `REGEXP_REPLACE`, disponível desde o MySQL 8.0.4, substitui toda essa construção por uma expressão.

Note também que `[0-9]` e `[^0-9]` são complementares, então a "separação" é exata por construção; os dois pipelines de `TRANSLATE` não têm essa garantia, e a lista de letras precisa ser escrita por extenso (e convertida para minúsculas antes) para ficar completa.

### Detectando strings que podem ser tratadas como números

A receita 6.13 do livro filtra uma coluna mista para ficar com as linhas que contêm pelo menos um dígito e depois extrai esses dígitos. O filtro é uma sondagem com `TRANSLATE` + `strpos`:

```sql
-- PostgreSQL, o predicado do livro
select mixed
  from v
 where strpos(translate(mixed,'0123456789','9999999999'), '9') > 0;
```

Mapeie todo dígito para `9` e pergunte se algum `9` aparece. O PostgreSQL moderno diz a mesma coisa com o operador `~`, e ganha um teste de *validade* ancorado de verdade (não só "contém um dígito") com o mesmo esforço:

```sql
select mixed from v where mixed ~ '[0-9]';        -- contém um dígito
select mixed from v where mixed ~ '^[0-9]+$';     -- é inteiramente composto de dígitos
select mixed from v where regexp_like(mixed, '^-?[0-9]+(\.[0-9]+)?$');
```

`regexp_like()` (junto com `regexp_count()`, `regexp_instr()` e `regexp_substr()`) chegou no PostgreSQL 15; `~`, `!~` e `regexp_replace()` existem há muito mais tempo, então a forma com operador é a escolha portável entre versões do PG.

Atenção ao que a receita do livro realmente retorna, porém: ela remove *todos* os não dígitos e concatena o que sobra, então `CL10AR` gera `10` e, como o próprio livro avisa, `99Gennick87` gera `9987`. Isso é colheita de dígitos, não validação. Se a pergunta é "posso fazer `CAST` disto?", os dois não são o mesmo teste:

```sql
-- PostgreSQL 16+: a resposta direta, com verificação de faixa incluída
select mixed,
       pg_input_is_valid(mixed, 'integer') as castable
  from v;

select pg_input_is_valid('42',           'integer');  -- t
select pg_input_is_valid('42000000000',  'integer');  -- f: casa com ^[0-9]+$, mas ainda não é um integer
```

`pg_input_is_valid(string, type)` (com seu companheiro `pg_input_error_info()`, ambos adicionados no PostgreSQL 16) pergunta à própria função de entrada do tipo se o valor é aceito, então pega overflow, escala e formato em uma chamada, algo que nenhuma regex consegue fazer, porque `^[0-9]+$` aceita tranquilamente uma string de vinte dígitos que um `integer` não comporta.

**O SQL Server** oferece `ISNUMERIC` desde sempre, e ele é a armadilha clássica. A própria documentação afirma que ele "retorna `1` para alguns caracteres que não são números, como mais (`+`), menos (`-`) e símbolos de moeda válidos como o cifrão (`$`)", e ele responde para *qualquer* tipo numérico, incluindo `money` e `float`, então `'1e5'` e `'$1'` passam enquanto um `CAST` posterior para `int` ainda falha. A proteção correta no T-SQL moderno é `TRY_CAST` / `TRY_CONVERT`, que retorna `NULL` em vez de lançar erro:

```sql
-- não confiável
select mixed from v where isnumeric(mixed) = 1;

-- a pergunta real: isto converte?
select mixed, try_cast(mixed as int) as as_int
  from v
 where try_cast(mixed as int) is not null;

-- SQL Server 2025 (17.x), nível de compatibilidade 170+ para REGEXP_LIKE
select mixed from v where regexp_like(mixed, '^[0-9]+$');
```

**O MySQL** não tem equivalente a `TRY_CAST`, e sua conversão implícita é tolerante em vez de barulhenta: um `SELECT` simples trunca e emite um warning em vez de falhar, então dados ruins passam em silêncio:

```sql
select cast('12abc' as unsigned);   -- 12, mais o warning 1292 'Truncated incorrect ... value'
select cast('abc'   as unsigned);   -- 0, mais o mesmo warning
```

Por isso a proteção com regex no MySQL não é uma preferência de estilo, é o mecanismo:

```sql
select mixed
  from v
 where regexp_like(mixed, '^-?[0-9]+$');
```

## Trade-offs

- **`TRANSLATE` é portável só no nome: a versão de cada engine se comporta de um jeito diferente nas bordas.** O PostgreSQL remove os caracteres excedentes quando `from` é mais longo que `to`, então uma remoção em uma chamada funciona; o SQL Server lança um erro quando os tamanhos não coincidem, então o passo do sentinela com `REPLACE` é obrigatório; o MySQL nem implementa `TRANSLATE`. Uma expressão de limpeza baseada em `TRANSLATE` não pode ser levada entre os três sem alterações.
  ```sql
  translate('12345','143','ax')            -- PostgreSQL → 'a2x5'
  TRANSLATE('12345','143','ax')            -- SQL Server → erro, tamanhos diferentes
  ```
- **Regex é dramaticamente mais legível, mas não está disponível em todo lugar em que a técnica do livro está.** `[^0-9]` expressa a intenção em quatro caracteres, enquanto `REPLACE(TRANSLATE(...))` precisa de duas chamadas aninhadas e um sentinela arbitrário. Essa legibilidade só pode ser comprada no PostgreSQL (há muito tempo), no MySQL 8.0.4+ (baseado em ICU, substituindo a antiga biblioteca de Henry Spencer) e no SQL Server 2025 / Azure SQL (baseado em RE2, com `REGEXP_LIKE` ainda condicionado ao nível de compatibilidade 170 do banco). No SQL Server 2022 e anteriores, o idioma `TRANSLATE`/`REPLACE` ainda é a resposta, não um hábito legado.
- **Listas enumeradas de caracteres deixam passar, em silêncio, qualquer coisa fora do ASCII.** O argumento `'abcdefghijklmnopqrstuvwxyz'` do livro cobre 26 letras e nada mais: `JOSÉ1200`, `MÜLLER300` ou qualquer nome cirílico ou CJK deixa resíduo na metade "numérica" e então quebra o `CAST`. Classes de caracteres de regex (`[[:alpha:]]` no PostgreSQL, `\p{L}` no engine ICU do MySQL) são definidas sobre categorias Unicode e não têm esse ponto cego.
- **Mas classes de dígitos com suporte a Unicode cortam para o outro lado: prefira `[0-9]` a `\d` quando um `CAST` vem em seguida.** No ICU, `\d` casa com toda a categoria Unicode `Nd`, então dígitos arábico-índicos ou de largura total passam no teste de "é um número" e depois falham na conversão mesmo assim. Escrever a faixa ASCII explicitamente mantém o predicado de validação e o tipo de destino de acordo.
- **Um teste de validade com regex não é um teste de validade de tipo.** `^[0-9]+$` aceita `'42000000000'`, que nenhuma coluna `integer` comporta, e rejeita `'1e5'` ou `'1_000'`, que alguns tipos aceitam. Onde o engine oferece uma verificação orientada a tipo (`pg_input_is_valid()` no PostgreSQL 16+, `TRY_CAST` no SQL Server), use-a em vez de reescrever à mão a gramática do tipo em um padrão; o `ISNUMERIC` do SQL Server é o exemplo de alerta de uma função embutida que responde a uma pergunta *diferente* e mais frouxa do que a que você fez.
- **Em escala, as duas abordagens leem tudo, e regex custa mais por linha.** `TRANSLATE` é uma única passada linear pela string contra um mapa de caracteres; uma regex precisa compilar um padrão e rodar um matcher, e é por isso que o MySQL expõe `regexp_time_limit` e `regexp_stack_limit` para limitá-la. Mais importante, nenhuma das formas é sargable: qualquer `WHERE regexp_like(col, ...)` ou `WHERE strpos(translate(col, ...), '9') > 0` lê todas as linhas. Se o predicado de limpeza roda com frequência, materialize-o: uma coluna gerada/calculada, ou um índice de expressão do PostgreSQL sobre o valor limpo.
  ```sql
  -- PostgreSQL: indexe a forma limpa uma vez em vez de recalculá-la a cada consulta
  create index on v ((regexp_replace(mixed, '[^0-9]', '', 'g')));
  ```

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 6, "Working with Strings", receitas 6.4, 6.5, 6.13, p. 110-116, 147-153: doc
- [PostgreSQL Documentation: String Functions and Operators (translate, regexp_replace)](https://www.postgresql.org/docs/current/functions-string.html): doc
- [PostgreSQL Documentation: Pattern Matching (POSIX regular expressions, `~`, regexp_like)](https://www.postgresql.org/docs/current/functions-matching.html): doc
- [PostgreSQL Documentation: System Information Functions (pg_input_is_valid, pg_input_error_info)](https://www.postgresql.org/docs/current/functions-info.html): doc
- [MySQL Reference Manual: Regular Expressions (REGEXP_LIKE, REGEXP_REPLACE, ICU engine)](https://dev.mysql.com/doc/refman/8.4/en/regexp.html): doc
- [Microsoft Learn: TRANSLATE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/translate-transact-sql): doc
- [Microsoft Learn: ISNUMERIC (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/isnumeric-transact-sql): doc
- [Microsoft Learn: Regular Expressions Functions (Transact-SQL), SQL Server 2025](https://learn.microsoft.com/en-us/sql/t-sql/functions/regular-expressions-functions-transact-sql): doc
