---
version: 1.0
updatedAt: 2026-08-06
title: "Diferenças Entre Linhas Adjacentes e Preenchendo Lacunas"
summary: Compare uma linha com sua vizinha dentro de uma partição ordenada com LEAD/LAG, e carregue o último valor conhecido adiante através de lacunas NULL com LAST_VALUE ou um FIRST_VALUE de grupo contado; mais as lacunas de portabilidade reais em expressões de offset e IGNORE NULLS.
---
## Objective

Uma família inteira de perguntas cotidianas de relatório se reduz ao mesmo formato: olhe para uma linha, depois olhe para sua *vizinha* dentro de uma partição ordenada. "Quanto menos esse funcionário ganha do que o contratado logo depois dele no mesmo departamento?" é uma subtração entre linhas adjacentes. "Qual foi o último status conhecido antes dessa linha, que não tem um?" é a mesma busca com a diferença descartada e o valor da vizinha mantido. As duas são resolvidas pelas funções de janela `LEAD`, `LAG`, `FIRST_VALUE`, e `LAST_VALUE`: sem self-join, sem subconsulta correlacionada, uma passada sobre uma partição ordenada.

## Use Cases

- Computar a lacuna de salário ou preço entre uma linha e a próxima no mesmo grupo: o próprio exemplo do livro: o `SAL` de cada funcionário menos o `SAL` do colega contratado imediatamente depois dele, por departamento.
- Deltas de período sobre período em um relatório: a receita deste mês menos a do mês passado, o headcount deste trimestre menos o do trimestre anterior, tudo particionado por região ou produto.
- Carregar um valor de "último conhecido" adiante através de linhas esparsas: uma coluna de status, um preço, uma flag de configuração que só é escrita quando *muda*, deixando `NULL` em toda linha entre elas.
- Preencher zeros (em vez de lacunas) na faixa de um relatório, onde a coisa faltante é uma *linha* inteira, não só um valor em uma linha.
- Sinalizar descontinuidades: comparar `LAG(end_date)` com o `start_date` atual para detectar onde uma faixa consecutiva quebra.

## Deep Dive

### Diferenças de linha adjacente com LEAD e LAG

`LEAD` olha para frente, `LAG` olha para trás, os dois dentro do grupo `PARTITION BY` e ao longo da sequência `ORDER BY`. A receita 10.2 do livro quer, por departamento, o salário de cada funcionário menos o salário do próximo funcionário contratado:

```sql
with next_sal_tab (deptno, ename, sal, hiredate, next_sal) as (
  select deptno, ename, sal, hiredate,
         lead(sal) over (partition by deptno order by hiredate) as next_sal
    from emp
)
select deptno, ename, sal, hiredate,
       coalesce(cast(sal - next_sal as char), 'N/A') as diff
  from next_sal_tab;
```

O funcionário contratado por último em cada departamento não tem linha "próxima", então `LEAD` retorna `NULL` e `COALESCE` substitui por `'N/A'`. Essa consulta exata roda no PostgreSQL, MySQL 8+, e SQL Server (módulo a grafia `cast(... as char)`: `varchar` no SQL Server, `char` no MySQL, `text`/`varchar` no PostgreSQL).

Note que `LEAD`/`LAG` são avaliados *depois* de `FROM` e `WHERE`. Uma função de janela não pode ser referenciada na cláusula `WHERE` do mesmo bloco de consulta, que é por que o padrão é sempre "compute a vizinha em uma view inline ou CTE, filtre na consulta externa": todo motor aplica isso.

A parte interessante é a ressalva do livro de "e se houver duplicatas". `LEAD` olha adiante exatamente uma *linha*, não um valor `ORDER BY` distinto: então cinco funcionários compartilhando um `HIREDATE` acabam se comparando entre si em vez de com a pessoa genuinamente contratada a seguir. O conserto do livro é um offset computado: contar as duplicatas, ranquear dentro delas, e dizer ao `LEAD` quão longe pular.

```sql
select deptno, ename, sal, hiredate,
       lead(sal, cnt - rn + 1) over (partition by deptno
                                         order by hiredate) as next_sal
  from (
    select deptno, ename, sal, hiredate,
           count(*)      over (partition by deptno, hiredate) as cnt,
           row_number()  over (partition by deptno, hiredate
                                   order by sal) as rn
      from emp
       ) x;
```

Essa é a linha que não viaja. **O argumento de offset é onde os três motores genuinamente discordam:**

- **O SQL Server** é o permissivo: a documentação diz claramente que o *offset* "pode ser uma coluna, subconsulta, ou outra expressão que avalia para um inteiro positivo", e a própria referência da Microsoft até demonstra `LAG(2*c, b*(SELECT MIN(b) FROM T), -c/2.0)`. O `cnt - rn + 1` do livro funciona ao pé da letra.
- **O PostgreSQL** também aceita uma expressão por linha, mas a assinatura é `lead(anyelement, integer)`, e `count(*) over (...)` retorna `bigint`. No PostgreSQL 18 a expressão do livro falha na resolução diretamente:

  ```
  ERROR:  function lead(integer, bigint) does not exist
  HINT:  No function matches the given name and argument types.
         You might need to add explicit type casts.
  ```

  Um cast explícito conserta isso, e o offset computado então funciona exatamente como pretendido: `lead(sal, (cnt - rn + 1)::int) over (...)`.
- **O MySQL 8+** o rejeita no momento do parse, e nenhum cast ajuda. O manual é inequívoco: `N` "precisa ser um inteiro não negativo literal", e as únicas formas permitidas são um literal inteiro sem sinal, um marcador `?`, uma variável definida pelo usuário, ou uma variável local de rotina armazenada. Uma referência de coluna não está nessa lista. No MySQL a variante de tratamento de duplicata precisa ser reestruturada: tipicamente agregando cada grupo de `HIREDATE` a uma linha primeiro, depois aplicando um `LEAD(sal)` simples sobre o conjunto colapsado, ou fazendo join contra uma subconsulta `MIN(hiredate) > current`.

### Preenchendo lacunas: carregue o último valor conhecido adiante

A receita 10.4 preenche *linhas* faltantes (anos sem contratação) gerando a faixa completa de anos e fazendo outer join das contagens sobre ela, com `COALESCE(cnt, 0)` transformando as ausências em zeros. Essa estrutura ainda está correta hoje, e o `generate_series` do PostgreSQL (e uma CTE recursiva em outro lugar) torna a metade de "fornecer a faixa completa" trivial.

O problema irmão é mais sutil: as linhas *existem*, mas uma coluna é `NULL` na maioria delas porque o valor só é registrado quando muda. Preencher isso significa carregar o último valor não `NULL` adiante:

```sql
create table reading (id integer, status varchar(10));

insert into reading values (1, 'OK'), (2, null), (3, null),
                           (4, 'FAIL'), (5, null), (6, 'OK');
```

Onde `IGNORE NULLS` está disponível, isso é um one-liner: `LAST_VALUE` com o frame padrão (`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`) já significa "tudo até e incluindo eu", então ignorar nulls deixa exatamente o último valor conhecido:

```sql
-- SQL Server 2022 (16.x) and later, Azure SQL Database / MI / Edge
select id, status,
       last_value(status) ignore nulls over (order by id) as carried
  from reading;
```

**O suporte a `IGNORE NULLS` é a lacuna de fornecedor real aqui, e não está fechando.** O SQL Server só ganhou isso na **2022 (16.x)**: para `LAG`, `LEAD`, `FIRST_VALUE`, e `LAST_VALUE` igualmente (com um conserto de correção de acompanhamento no CU4). O MySQL *faz o parse* da cláusula `null_treatment` mas implementa só `RESPECT NULLS`; escrever `IGNORE NULLS` levanta um erro em vez de ser silenciosamente ignorado. O PostgreSQL não implementa a cláusula de todo: a partir do PostgreSQL 18 ainda é um erro de sintaxe simples:

```
ERROR:  syntax error at or near "nulls"
LINE 1: select lag(sal) ignore nulls over (order by hiredate) ...
```

e o manual do PostgreSQL declara diretamente que a opção `RESPECT NULLS`/`IGNORE NULLS` do padrão "não é implementada no PostgreSQL: o comportamento é sempre o mesmo do padrão da especificação."

O substituto portável é um **carry-forward de grupo contado**: uma `COUNT` corrente da coluna não `NULL` incrementa só nas linhas que *têm* um valor, então age como um id de grupo onde toda lacuna pertence à última linha populada acima dela. Agrupe por isso, depois pegue `FIRST_VALUE`:

```sql
select id, status,
       first_value(status) over (partition by grp order by id) as carried
  from (
    select id, status,
           count(status) over (order by id) as grp
      from reading
       ) t;
```

```
 id | status | carried
----+--------+---------
  1 | OK     | OK
  2 |        | OK
  3 |        | OK
  4 | FAIL   | FAIL
  5 |        | FAIL
  6 | OK     | OK
```

Isso roda sem mudanças no PostgreSQL, MySQL 8+, e SQL Server, e não depende de nada mais exótico do que o comportamento padrão do `COUNT` de pular `NULL`s.

Um atalho tentador que está *errado*: recorrer a um agregado sobre o frame corrente, por exemplo `max(status) over (order by id rows between unbounded preceding and current row)`. Isso retorna o maior valor visto até agora, não o mais recente: no dado acima produz `OK` para toda linha, incluindo as linhas 4 e 5 onde a resposta real é `FAIL`. O truque de grupo contado é o que de fato significa "último", não "maior".

## Trade-offs

- **`LEAD`/`LAG` avançam por posição de linha, não por valor de ordenação distinto.** Essa é a armadilha na qual o livro gasta a maior parte da receita 10.2, e é fácil perder de vista porque dados de amostra arrumados raramente têm empates. Se a coluna `ORDER BY` tem duplicatas, "a próxima linha" é uma das pares empatadas, não o próximo valor genuinamente diferente: e a consulta retorna um número de aparência plausível mas errado em vez de um erro.
- **O conserto de offset computado para empates é a coisa menos portável do capítulo.** O SQL Server aceita uma expressão arbitrária, o PostgreSQL aceita uma com um cast explícito `::int`, o MySQL só aceita um literal ou uma variável. Uma consulta escrita em torno de um offset `LEAD` computado é efetivamente código de fornecedor único, e no MySQL precisa de uma solução estruturalmente diferente em vez de um ajuste de sintaxe.
- **`IGNORE NULLS` lê lindamente e está disponível em exatamente um dos três motores.** O SQL Server 2022+ o tem; o MySQL dá erro nele; o PostgreSQL não faz o parse dele. O padrão `FIRST_VALUE` de grupo contado é mais código e lê menos obviamente, mas é a versão que você de fato consegue colocar em uma base de código que visa mais de um banco de dados.
- **O frame padrão de `LAST_VALUE` surpreende as pessoas, nas duas direções.** O padrão é `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, então `LAST_VALUE` significa "o valor na *minha* linha", não "o valor no fim da partição": que é exatamente o que você quer para carry-forward, e exatamente o que você não quer quando está buscando um máximo de partição. Para o último você precisa escrever `RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING` (ou usar `FIRST_VALUE` com um `ORDER BY` invertido).
- **Preencher *linhas* faltantes e preencher *valores* faltantes parecem iguais mas precisam de maquinaria diferente.** Nenhuma função de janela consegue inventar uma linha que não está na tabela: um ano com zero contratações precisa de uma faixa gerada e um outer join (a estrutura real da receita 10.4). Funções de janela só ajudam uma vez que uma linha existe e uma coluna nela está vazia. Diagnosticar qual dos dois você tem é o primeiro passo, não um detalhe de implementação.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 10, "Working with Ranges", recipes 10.2, 10.4, p. 317-323, 326-330] - doc
- [PostgreSQL Documentation: Window Functions (lag, lead, first_value, last_value; RESPECT/IGNORE NULLS not implemented)](https://www.postgresql.org/docs/current/functions-window.html) - doc
- [MySQL Reference Manual: Window Function Descriptions (LAG/LEAD literal offset, null_treatment restrictions)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) - doc
- [Microsoft Learn: LAG (Transact-SQL): expression offsets and IGNORE NULLS (SQL Server 2022+)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lag-transact-sql) - doc
- [Microsoft Learn: LAST_VALUE (Transact-SQL): IGNORE NULLS and default frame behavior](https://learn.microsoft.com/en-us/sql/t-sql/functions/last-value-transact-sql) - doc
