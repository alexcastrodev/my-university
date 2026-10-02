---
version: 1.0
updatedAt: 2026-08-05
title: Regex e Casamento de Padrões em SQL
summary: Contar quantas vezes um caractere ou substring aparece em um valor e encontrar linhas que não seguem um padrão esperado, com as técnicas portáveis de LENGTH/REPLACE e TRANSLATE e as funções nativas de regex que cada fornecedor adicionou desde então.
---
## Objective

`LIKE 'A%'` responde "esta string começa com A" e para por aí. Duas perguntas que ele não consegue responder aparecem o tempo todo no trabalho real com dados: *quantas vezes* um caractere ou substring aparece dentro de um valor, e *quais linhas não seguem* uma forma esperada. A primeira é resolvida classicamente sem regex nenhuma: meça a string, remova o que está contando, meça de novo e divida pelo tamanho da string de busca. A segunda é o casamento negativo: `NOT LIKE`, `!~`, `NOT REGEXP`, ou o truque de `TRANSLATE` de apagar todo caractere permitido e perguntar se sobrou alguma coisa. As duas são problemas de string em que a resposta portável e a resposta moderna de cada fornecedor se distanciaram desde que o livro foi escrito.

## Use Cases

- Varreduras de qualidade de dados: sinalizar códigos de produto, SKUs ou CEPs que contêm um caractere fora do conjunto permitido, antes que cheguem a um relatório.
- Validar uma string delimitada de formato fixo contando seus delimitadores: um registro `10,CLARK,MANAGER` com qualquer coisa diferente de duas vírgulas está malformado, não importa o que os campos contenham.
- Encontrar texto estruturado mal formatado em uma coluna de texto livre: telefones, IDs ou datas digitados à mão em um campo de comentário.
- Validação de entrada dentro de uma constraint `CHECK` ou de uma consulta antes do insert, para que um valor que não segue o padrão esperado nunca chegue à tabela.
- Auditar uma coluna importada em busca de espaços soltos, caracteres de controle ou bytes não ASCII, contando quantos caracteres ficam fora de uma lista permitida.

## Deep Dive

### Contando ocorrências de um caractere ou substring

A técnica do livro não precisa de nada além de `LENGTH` e `REPLACE`: pegue o tamanho original, subtraia o tamanho da string com o alvo removido, e a diferença é quantos caracteres sumiram.

```sql
select (length('10,CLARK,MANAGER') -
        length(replace('10,CLARK,MANAGER', ',', ''))) / length(',') as cnt;
-- cnt = 2
```

A divisão por `length(',')` parece redundante para um único caractere, e é exatamente por isso que ela é esquecida e exatamente por isso que ela importa. Tire-a e uma string de busca de vários caracteres passa a contar *caracteres removidos*, não *ocorrências*:

```sql
select (length('HELLO HELLO') - length(replace('HELLO HELLO','LL',''))) / length('LL')
         as correct_cnt,
       (length('HELLO HELLO') - length(replace('HELLO HELLO','LL','')))
         as incorrect_cnt;

-- correct_cnt  incorrect_cnt
-- -----------  -------------
--           2              4
```

No SQL Server a função é `LEN`, não `LENGTH`; todo o resto é idêntico:

```sql
select (len('10,CLARK,MANAGER') -
        len(replace('10,CLARK,MANAGER', ',', ''))) / len(',') as cnt;
```

**O que mudou:** dois dos três engines agora trazem um contador nativo. O PostgreSQL 15 (2022) adicionou `regexp_count()` junto com `regexp_like()`, `regexp_instr()` e `regexp_substr()`, explicitamente "para compatibilidade com outros sistemas relacionais"; é a grafia do PostgreSQL para o `OCCURRENCES_REGEX` do padrão SQL:

```sql
-- PostgreSQL 15+
select regexp_count('10,CLARK,MANAGER', ',');      -- 2
select regexp_count('HELLO HELLO', 'LL');          -- 2, sem divisão
select regexp_count('ABCABCAXYaxy', 'A.', 1, 'i'); -- 4 (posição inicial, depois flags)
```

O SQL Server 2025 (17.x) também adicionou `REGEXP_COUNT`, junto com o resto da família `REGEXP_*`, disponível também no Azure SQL Database, no Azure SQL Managed Instance e no SQL database do Fabric, e condicionado ao nível de compatibilidade 170 do banco:

```sql
-- SQL Server 2025 / Azure SQL, nível de compatibilidade 170+
select REGEXP_COUNT('10,CLARK,MANAGER', ',');      -- 2
```

O MySQL é o que ficou para trás. Ele tem regex baseada em ICU desde o 8.0.4 (`REGEXP_LIKE()`, `REGEXP_INSTR()`, `REGEXP_REPLACE()`, `REGEXP_SUBSTR()`), mas **não tem `REGEXP_COUNT`**, e isso continua valendo até o manual do 9.x. O truque da diferença de tamanhos não é um idioma legado no MySQL; é a resposta, só com `REGEXP_REPLACE` no lugar quando o que está sendo contado é um padrão em vez de um literal:

```sql
-- MySQL 8.0.4+: conta dígitos em uma coluna, sem REGEXP_COUNT disponível
select txt,
       char_length(txt) - char_length(regexp_replace(txt, '[0-9]', '')) as digit_cnt
  from t;
```

Note `char_length`, não `length`; veja os trade-offs.

### Casamento negativo de padrões: encontrando o que não se encaixa

A forma mais simples do problema é "quais linhas contêm um caractere fora do conjunto permitido." Há duas formas de escrever isso, e elas não são equivalentes:

```sql
-- PostgreSQL: "contém pelo menos um não dígito"
select code from t where code ~ '[^0-9]';

-- PostgreSQL: "não é composto inteiramente de dígitos": também é verdadeiro para a string vazia
select code from t where code !~ '^[0-9]+$';
```

A primeira exige que exista um caractere ruim; a segunda também sinaliza `''`, porque uma string vazia não tem dígitos para ancorar. Escolha deliberadamente. O mesmo par no MySQL, em que `REGEXP`/`RLIKE`/`REGEXP_LIKE()` são sinônimos e `NOT REGEXP` é a negação:

```sql
-- MySQL 8.0.4+
select code from t where code regexp '[^0-9]';
select code from t where code not regexp '^[0-9]+$';
select code from t where regexp_like(code, '[^0-9]');   -- a mesma coisa, na forma de função
```

O SQL Server é o caso interessante, e a resposta depende da versão. Até o SQL Server 2022 **não há regex nativa**: as opções eram `LIKE`, um assembly SQLCLR ou cirurgia de string feita à mão. O que salva o `LIKE` aqui é que o `LIKE` do T-SQL é o único dos três que suporta classes de caracteres, inclusive negadas:

```sql
-- SQL Server, qualquer versão: curingas de classe de caracteres dentro do LIKE
select code from t where code like '%[^0-9]%';   -- contém um não dígito
select code from t where code not like '%[^0-9]%'; -- só dígitos
```

Esse curinga `[^...]` não tem equivalente no `LIKE` do PostgreSQL nem do MySQL (o PostgreSQL oferece `SIMILAR TO` como meio-termo). Ele é realmente útil, mas chega ao limite rápido: o `LIKE` não tem quantificadores, nem alternância, nem forma de dizer "três dígitos, depois um separador, depois três dígitos."

**O que mudou:** o SQL Server 2025 fechou a lacuna. `REGEXP_LIKE`, `REGEXP_REPLACE`, `REGEXP_SUBSTR`, `REGEXP_INSTR`, `REGEXP_COUNT`, `REGEXP_MATCHES` e `REGEXP_SPLIT_TO_TABLE` agora existem, construídos sobre a biblioteca RE2 do Google:

```sql
-- SQL Server 2025+, nível de compatibilidade 170
select code from t where REGEXP_LIKE(code, '[^0-9]') = 1;
```

A técnica baseada em `TRANSLATE` fica entre os dois mundos: remova todo caractere permitido e veja se algo sobrevive. O `TRANSLATE` do PostgreSQL apaga caracteres quando a string `to` é mais curta que a string `from`, então a lista permitida se reduz a nada:

```sql
-- PostgreSQL: qualquer coisa que sobre depois de apagar todos os dígitos é um caractere ilegal
select code from t where translate(code, '0123456789', '') <> '';
```

O SQL Server tem `TRANSLATE` desde 2017, mas ele **dá erro se as duas listas de caracteres tiverem tamanhos diferentes**, então a remoção precisa acontecer em uma segunda passada:

```sql
-- SQL Server 2017+: mapeia dígitos para espaços e depois remove os espaços
select code from t
 where replace(translate(code, '0123456789', '          '), ' ', '') <> '';
```

O MySQL não tem `TRANSLATE`: o equivalente é uma pilha de chamadas `REPLACE` aninhadas, uma por caractere, que é exatamente o ponto em que você desiste e usa `REGEXP`.

A receita 6.17 completa do livro é a versão sofisticada da mesma forma: defina o padrão A para "coisas que parecem um número de telefone", defina o padrão B para "números de telefone formatados corretamente", apague todo casamento de B e veja se sobra algum casamento de A.

```sql
-- O PostgreSQL 15+ roda isto essencialmente como impresso
select emp_id, text
  from employee_comment
 where regexp_like(text, '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}')
   and regexp_like(
         regexp_replace(text, '[0-9]{3}([-. ])[0-9]{3}\1[0-9]{4}', '***'),
         '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}');
```

O `\1` do padrão B é uma backreference: o separador que `([-. ])` capturou precisa reaparecer, então `989-387-4321` é válido e `989-387.5359` não é. O MySQL também roda isto, com a barra invertida duplicada, porque os literais de string do MySQL tratam `\` como caractere de escape (`'...\\1...'`).

O SQL Server 2025 **não consegue** rodar isto. O RE2 é um engine de autômato de tempo linear e, por design, não suporta backreferences nem lookaround. O padrão B precisa ser reescrito como alternância explícita, um ramo por separador:

```sql
-- SQL Server 2025: sem \1 disponível, enumere os separadores
select emp_id, text
  from employee_comment
 where REGEXP_LIKE(text, '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}') = 1
   and REGEXP_LIKE(
         REGEXP_REPLACE(text,
           '[0-9]{3}-[0-9]{3}-[0-9]{4}|[0-9]{3}\.[0-9]{3}\.[0-9]{4}|[0-9]{3} [0-9]{3} [0-9]{4}',
           '***'),
         '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}') = 1;
```

## Trade-offs

- **O truque da diferença de tamanhos é portável, mas copia cada string em que toca.** `REPLACE` materializa um novo valor para cada linha antes que os tamanhos possam ser comparados, então contar um delimitador em uma coluna `text` larga são duas leituras completas dos dados mais uma alocação por linha. Um `regexp_count` nativo percorre a string uma vez. Nenhum dos dois é sargable (os dois forçam uma leitura completa, sejam quais forem os índices da coluna), então a escolha é puramente sobre custo por linha, não sobre caminho de acesso.
- **`LENGTH`, `LEN` e `CHAR_LENGTH` são três funções diferentes com nomes parecidos, e duas delas vão dar uma contagem errada em silêncio.** O `LEN` do SQL Server ignora espaços no final, o que quebra o truque exatamente quando o caractere contado *é* um espaço; o `LENGTH` do MySQL retorna bytes, não caracteres, o que o quebra com qualquer entrada multibyte.
  ```sql
  -- SQL Server: 'a  b  ' tem quatro espaços, LEN informa dois
  select len('a  b  ') - len(replace('a  b  ', ' ', ''));               -- 2  (errado)
  select datalength('a  b  ') - datalength(replace('a  b  ', ' ', '')); -- 4  (certo, varchar)

  -- MySQL: use CHAR_LENGTH, nunca LENGTH, em colunas utf8mb4
  select length('café'), char_length('café');                           -- 5, 4
  ```
- **Um casamento negativo nunca retorna linhas `NULL`, o oposto do que uma consulta de qualidade de dados quer.** `NULL NOT LIKE '%x%'` é `UNKNOWN`, não `TRUE`, então uma consulta de "encontre os valores malformados" pula silenciosamente toda linha em que a coluna é `NULL`, justamente as linhas com mais chance de serem um problema. Todo predicado de casamento negativo precisa de um `OR col IS NULL` explícito, a menos que a coluna seja `NOT NULL`.
  ```sql
  select code from t where code not like '%[^0-9]%' or code is null;
  ```
- **A regex do SQL Server 2025 não é um substituto direto para padrões do PostgreSQL ou do MySQL.** O RE2 troca backreferences e lookaround por uma garantia de casamento em tempo linear, então qualquer padrão que dependa de `\1`, `(?=...)` ou `(?<!...)` (incluindo o próprio padrão B desta receita) precisa ser reestruturado em alternância. Ele também ignora deliberadamente as collations do SQL, então `REGEXP_LIKE` e `LIKE` podem discordar sobre as mesmas duas strings em uma coluna insensível a maiúsculas ou a acentos.
- **"Não casa com o padrão bom" e "casa com um padrão ruim" são perguntas diferentes, e é no texto livre que a diferença morde.** A estrutura de dois padrões do livro existe justamente porque um campo de comentário contém prosa arbitrária: um ingênuo `NOT REGEXP '<telefone válido>'` sinalizaria toda linha que simplesmente não contém um telefone. Estreitar o universo primeiro (padrão A) e depois subtrair os casos aceitáveis (padrão B) é a parte da receita que sobrevive a toda mudança de sintaxe.
- **Suporte a regex agora é a norma, então recorrer a ele é defensável, mas as versões mínimas são reais.** `regexp_count` precisa do PostgreSQL 15+, as funções `REGEXP_*` precisam do MySQL 8.0.4+, e o SQL Server precisa do 2025 com nível de compatibilidade 170 ou do Azure SQL. Em qualquer coisa mais antiga, as formas `LENGTH`/`REPLACE` e `LIKE '%[^0-9]%'` desta receita não são um recurso de estilo; são a única coisa que roda.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 6, "Working with Strings", receitas 6.3, 6.17, p. 109-110, 164-167: doc
- [PostgreSQL Documentation: Pattern Matching (LIKE, SIMILAR TO, POSIX regex, regexp_count)](https://www.postgresql.org/docs/current/functions-matching.html): doc
- [MySQL Reference Manual: Regular Expressions (REGEXP, RLIKE, REGEXP_LIKE, no REGEXP_COUNT)](https://dev.mysql.com/doc/refman/8.4/en/regexp.html): doc
- [Microsoft Learn: LIKE (Transact-SQL), including the [ ] and [^] wildcards](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/like-transact-sql): doc
- [Microsoft Learn: Work with Regular Expressions in SQL Server 2025 (RE2-based REGEXP_* functions)](https://learn.microsoft.com/en-us/sql/relational-databases/regular-expressions/overview): doc
