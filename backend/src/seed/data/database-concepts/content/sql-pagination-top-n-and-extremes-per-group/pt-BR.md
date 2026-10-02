---
version: 1.0
updatedAt: 2026-08-05
title: Paginação, Top-N com Empates e Extremos por Grupo
summary: Toda uma família de problemas do tipo "quais linhas, e quantas" que vai além de um LIMIT simples, como paginar resultados, amostrar uma linha a cada N, lidar com empates em uma consulta top-N e encontrar o maior/menor valor por grupo.
---
## Objective

Toda uma família de problemas do tipo "quais linhas, e quantas" fica logo depois de um simples `LIMIT 5`: entregar a um usuário a página 4 de um conjunto de resultados, amostrar uma tabela grande pegando uma linha a cada 100, retornar "os cinco maiores salários" de um jeito que trate empates como o negócio realmente quer dizer, e encontrar o maior e o menor valor *por grupo* em vez de uma vez na tabela inteira. Os quatro são, no fundo, problemas de window function: você impõe uma ordem, numera ou ranqueia as linhas segundo essa ordem e então filtra pelo número. Este conceito pressupõe a sintaxe básica de limitar linhas (`LIMIT`, `TOP`, `FETCH FIRST`) de [SQL: Limiting and Random Sampling](/database-concepts/sql-limiting-and-random-sampling) e constrói os padrões mais difíceis em cima dela.

## Use Cases

- Servir respostas de API paginadas ou uma lista de UI com botões Próximo/Anterior, em que cada clique é uma consulta separada para um intervalo diferente de linhas.
- Montar um relatório de "os 3 maiores salários por departamento" ou "produto mais vendido por categoria": extremos calculados dentro de um grupo, não globalmente.
- Verificar pontualmente uma tabela grande puxando uma linha a cada 100, para que a amostra fique espalhada por igual ao longo da ordenação em vez de concentrada no início.
- Produzir um ranking em que empates precisam dividir a posição ("duas pessoas empatadas em 2º, a próxima é a 4ª") em vez de serem desfeitos em silêncio por um critério de desempate arbitrário.
- Filtrar um conjunto de resultados para as linhas que atingem um mínimo ou máximo por partição, sem um self-join de volta a uma subconsulta de agregação.

## Deep Dive

### Paginando um conjunto de resultados

O SQL não tem noção de "primeiro", "próximo" ou "página 3": isso só existe depois que você impõe uma ordem. A técnica portável do livro numera as linhas ordenadas em uma view inline e então filtra por esse número:

```sql
-- linhas 1-5
select sal
  from (
select row_number() over (order by sal) as rn,
       sal
  from emp
       ) x
 where rn between 1 and 5;

-- linhas 6-10: a mesma consulta, outro intervalo
 where rn between 6 and 10
```

Isso roda sem alterações no PostgreSQL, no MySQL 8.0+ e no SQL Server, e essa é sua principal virtude. Na prática você usaria a sintaxe nativa de offset, e aqui os três engines de fato divergem:

```sql
-- PostgreSQL: as duas formas funcionam
select sal from emp order by sal limit 5 offset 5;
select sal from emp order by sal offset 5 rows fetch next 5 rows only;

-- MySQL: só LIMIT, em qualquer uma das grafias. Note que a ordem dos argumentos
-- da forma com dois argumentos é (offset, count), o inverso de como se lê.
select sal from emp order by sal limit 5, 5;      -- pula 5, pega 5
select sal from emp order by sal limit 5 offset 5; -- a mesma coisa

-- SQL Server: OFFSET/FETCH faz parte da cláusula ORDER BY
select sal from emp order by sal offset 5 rows fetch next 5 rows only;
```

Três regras fáceis de errar:

- **O MySQL não tem `FETCH FIRST`/`OFFSET ... FETCH`.** `LIMIT` é a única opção, então a forma ANSI não é uma escolha portável entre os três.
- **O `OFFSET`/`FETCH` do SQL Server faz parte gramaticalmente do `ORDER BY`:** você não pode escrever `OFFSET` sem um `ORDER BY`, e não pode combiná-lo com `TOP` no mesmo escopo de consulta. `FETCH NEXT n ROWS ONLY` sozinho ainda precisa de `ORDER BY ... OFFSET 0 ROWS` na frente.
- **O `ORDER BY` precisa ser sobre uma chave *única*, não qualquer coluna.** O manual do PostgreSQL é direto sobre isso: o planejador leva o `LIMIT` em conta, então valores diferentes de `LIMIT`/`OFFSET` podem produzir planos diferentes e, portanto, ordens de linhas diferentes. Paginar só com `ORDER BY sal`, em que salários se repetem, pode mostrar uma linha duas vezes ou pulá-la por completo entre páginas. Adicione um critério de desempate: `order by sal, empno`.

O PostgreSQL (13+) e o SQL Server também diferem no comportamento de empates na fronteira da página. O `FETCH` do PostgreSQL aceita `WITH TIES`; o `OFFSET ... FETCH` do SQL Server aceita apenas `ONLY` (seu `WITH TIES` fica no `TOP`), e o MySQL não tem equivalente:

```sql
-- PostgreSQL 13+: a página pode retornar mais de 5 linhas se o 5º valor empatar
select sal from emp order by sal fetch first 5 rows with ties;

-- SQL Server: WITH TIES está disponível no TOP, não no OFFSET/FETCH
select top (5) with ties sal from emp order by sal;
```

### Pulando n linhas: amostrando uma linha a cada N

Isso parece paginação, mas não é: o objetivo é uma amostra com passo fixo ao longo de todo o conjunto ordenado, não uma janela contígua. Numere as linhas e mantenha aquelas cujo número satisfaz uma condição de módulo:

```sql
-- um funcionário sim, outro não: 1º, 3º, 5º, ...
select ename
  from (
select row_number() over (order by ename) rn,
       ename
  from emp
       ) x
 where mod(rn, 2) = 1;
```

`ROW_NUMBER()` é a função certa aqui justamente porque nunca empata: ela distribui de 1 a n sem lacunas e sem repetições, mesmo quando a coluna do `ORDER BY` tem valores duplicados, então a aritmética de módulo continua exata. `RANK()` quebraria isso: com duas linhas empatadas no rank 3 e nada no rank 4, um filtro `mod(rn, 2)` descartaria ou contaria em dobro linhas em silêncio.

O operador de módulo em si é a única diferença entre fornecedores:

```sql
-- PostgreSQL, MySQL, Oracle: função MOD() (o PostgreSQL também tem o operador %)
where mod(rn, 100) = 1

-- SQL Server: operador %, sem função MOD()
where rn % 100 = 1
```

Uma linha a cada 100 para uma verificação pontual é a mesma consulta com um divisor maior. Diferente de `TABLESAMPLE` ou `ORDER BY random()`, isto é determinístico e espalhado por igual ao longo da ordenação: rodar de novo retorna as mesmas linhas, que é o que você quer quando alguém precisa revisar a amostra e você precisa que ela seja reproduzível.

### Top n registros, e o que "top n" significa quando há empates

O ingênuo `order by sal desc limit 5` responde "me dê cinco linhas." Muitas vezes essa *não* é a pergunta. "Os cinco maiores salários" normalmente significa cinco níveis salariais distintos, e se duas pessoas ganham 3000, as duas deveriam aparecer. A solução do livro usa `DENSE_RANK`:

```sql
select ename, sal
  from (
select ename, sal,
       dense_rank() over (order by sal desc) dr
  from emp
       ) x
 where dr <= 5;
```

As três funções de ranking diferem apenas em como tratam empates, e a escolha é a decisão inteira:

```sql
select ename, sal,
       row_number() over (order by sal desc) as rn,
       rank()       over (order by sal desc) as rnk,
       dense_rank() over (order by sal desc) as dr
  from emp;

-- ENAME    SAL     RN   RNK    DR
-- KING    5000      1     1     1
-- SCOTT   3000      2     2     2
-- FORD    3000      3     2     2      <- empatados; RN desfez o empate arbitrariamente
-- JONES   2975      4     4     3      <- RANK pula o 3; DENSE_RANK não
-- BLAKE   2850      5     5     4
-- CLARK   2450      6     6     5
-- ALLEN   1600      7     7     6
```

- `ROW_NUMBER()`: **exatamente n linhas, empates desfeitos arbitrariamente.** Use quando a quantidade de linhas for a restrição rígida (uma página de tamanho fixo, um lote de n). Qual entre SCOTT/FORD recebe o número 2 é indefinido, a menos que você adicione um critério de desempate ao `ORDER BY`.
- `RANK()`: **empates compartilham um rank, e o próximo rank pula.** Ranking de competição: duas pessoas empatadas em 2º significa que ninguém é 3º. `where rnk <= 5` retorna no máximo cinco *posições*, mas pode retornar mais de cinco linhas.
- `DENSE_RANK()`: **empates compartilham um rank, sem lacunas.** "Os cinco níveis salariais distintos mais altos", que é o que "os cinco maiores salários" normalmente quer dizer em um relatório.

As três são window functions ANSI e funcionam de forma idêntica no PostgreSQL, no MySQL 8.0+ e no SQL Server. O ponto importante é que o filtro precisa ficar em uma consulta externa ou CTE: window functions são avaliadas depois do `WHERE`, então `where dense_rank() over (...) <= 5` é um erro de sintaxe em todos os engines.

### Maiores e menores valores, por grupo

A receita do livro encontra os extremos globais tornando o mínimo e o máximo visíveis em toda linha com uma janela `OVER()` vazia, e então filtrando:

```sql
select ename, sal
  from (
select ename, sal,
       min(sal) over () min_sal,
       max(sal) over () max_sal
  from emp
       ) x
 where sal in (min_sal, max_sal);
```

`OVER()` com uma janela vazia significa "sobre todo o conjunto de resultados", então `min_sal`/`max_sal` são os mesmos 800/5000 em toda linha: uma agregação que não colapsa as linhas. A generalização interessante está a uma palavra-chave de distância: adicione `PARTITION BY` e a mesma consulta responde "funcionário com maior e menor salário **por departamento**":

```sql
select deptno, ename, sal
  from (
select deptno, ename, sal,
       min(sal) over (partition by deptno) min_sal,
       max(sal) over (partition by deptno) max_sal
  from emp
       ) x
 where sal in (min_sal, max_sal)
 order by deptno, sal;
```

Para "top n por grupo" em vez de só o extremo, particione uma função de ranking do mesmo jeito; esse é o padrão por trás de quase todo relatório de "top 3 por categoria":

```sql
-- os três maiores salários de cada departamento
select deptno, ename, sal
  from (
select deptno, ename, sal,
       dense_rank() over (partition by deptno order by sal desc) dr
  from emp
       ) x
 where dr <= 3
 order by deptno, sal desc;
```

A alternativa anterior às window functions é uma subconsulta correlacionada, que ainda funciona em todo lugar e vale reconhecer em código mais antigo:

```sql
select deptno, ename, sal
  from emp e
 where sal = (select max(sal) from emp where deptno = e.deptno)
    or sal = (select min(sal) from emp where deptno = e.deptno);
```

Ela se lê de forma aceitável no caso de um único extremo, mas degrada muito para top-n: a subconsulta é reavaliada para cada linha externa, e estendê-la para "top 3" significa uma subconsulta de contagem (`where 3 > (select count(*) from emp e2 where e2.deptno = e.deptno and e2.sal > e.sal)`) muito mais difícil de ler que o `DENSE_RANK` particionado. A forma com window function também calcula o ranking em uma única passada pela partição, em vez de uma vez por linha.

O PostgreSQL oferece uma quarta opção especificamente para o caso de um único extremo, `DISTINCT ON`, que mantém a primeira linha de cada grupo segundo a ordenação dada:

```sql
-- só PostgreSQL: funcionário com maior salário por departamento
select distinct on (deptno) deptno, ename, sal
  from emp
 order by deptno, sal desc;
```

É conciso e rápido, mas fica limitado a uma linha por grupo e não é portável para o MySQL nem para o SQL Server.

## Trade-offs

- **`OFFSET` em profundidade é a armadilha clássica de paginação, e é comportamento documentado, não um bug.** O PostgreSQL diz isso com todas as letras: "as linhas puladas por uma cláusula `OFFSET` ainda precisam ser calculadas dentro do servidor; portanto, um `OFFSET` grande pode ser ineficiente." `OFFSET 100000 LIMIT 20` lê e descarta 100.000 linhas para retornar 20: o custo cresce linearmente com o número da página, então a página 1 é instantânea e a página 5.000 estoura o tempo. A forma com `ROW_NUMBER()` em uma subconsulta tem exatamente o mesmo problema; numerar as linhas ainda exige produzi-las.
  ```sql
  -- rápido; o planejador para depois de 20 linhas
  select * from orders order by id limit 20;
  -- lento; o engine ainda materializa 100.000 linhas que vai jogar fora
  select * from orders order by id offset 100000 limit 20;
  ```
- **A paginação por keyset (seek) é a resposta moderna, ao custo de perder o acesso aleatório a páginas.** Em vez de contar linhas a pular, lembre a chave de ordenação da última linha da página anterior e filtre a partir dela: uma leitura de intervalo indexada que custa o mesmo na página 1 e na página 5.000. É o que Stripe, GitHub e Slack expõem como cursores opacos. O preço é real: não há "pular para a página 47", não há contagem total de páginas sem um `COUNT(*)` separado, e a chave de ordenação precisa ser única (ou tornada única com um critério de desempate), então ela combina muito melhor com feeds de rolagem infinita do que com um paginador numerado.
  ```sql
  -- próxima página depois da linha (sal=2450, empno=7782)
  select * from emp
   where (sal, empno) > (2450, 7782)
   order by sal, empno
   limit 20;
  ```
- **A paginação por offset não é só lenta em profundidade, ela é incorreta sob escritas concorrentes.** Cada página é uma consulta independente; se uma linha é inserida ou apagada entre as requisições, os offsets se deslocam e o usuário vê uma linha duas vezes ou nunca a vê. A própria documentação do SQL Server detalha as condições para uma paginação estável: os dados subjacentes não podem mudar, ou todas as páginas precisam ser buscadas dentro de uma transação snapshot/serializable. A paginação por keyset é imune ao problema da janela que se desloca porque se ancora em um valor, não em uma posição.
- **Escolher a função de ranking errada produz uma resposta plausível e errada.** `ROW_NUMBER()` em um relatório de "top 5" descarta em silêncio uma de duas pessoas com o mesmo salário e ninguém percebe; `RANK()` deixa lacunas que surpreendem quem espera 1-2-3; `DENSE_RANK()` pode retornar mais de n linhas quando quem chamou presumia exatamente n. Nenhuma delas dá erro: a consulta só responde uma pergunta ligeiramente diferente da que foi feita, então a escolha precisa ser deliberada, e não por hábito.
- **As lacunas entre fornecedores aqui são estreitas, mas afiadas.** O MySQL não tem `FETCH FIRST` nem `WITH TIES`; o `OFFSET`/`FETCH` do SQL Server suporta apenas `ONLY` e não pode aparecer sem `ORDER BY` nem junto com `TOP`; o operador de módulo é `MOD()` no PostgreSQL/MySQL e `%` no SQL Server; `DISTINCT ON` é exclusivo do PostgreSQL. As window functions em si (`ROW_NUMBER`, `RANK`, `DENSE_RANK`, `MIN`/`MAX OVER`) são o denominador comum portável entre os três, o que é um bom argumento a favor da técnica de view inline do livro quando uma consulta realmente precisa rodar em todo lugar.
- **`ORDER BY` em uma coluna não única torna todas as técnicas aqui não determinísticas.** Paginação, amostragem de uma linha a cada N e o desempate do `ROW_NUMBER()` dependem de uma ordem total. Se a coluna de ordenação tem duplicatas, o engine é livre para retorná-las em qualquer ordem, e provavelmente vai escolher diferente entre duas execuções com valores diferentes de `LIMIT`/`OFFSET`. Sempre acrescente um critério de desempate único (`order by sal, empno`), mesmo quando a coluna extra não significa nada para quem lê.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 11, "Advanced Searching", receitas 11.1, 11.2, 11.5, 11.6, p. 335-345: doc
- [PostgreSQL Documentation: LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html): doc
- [MySQL Reference Manual: SELECT Statement (LIMIT offset, count)](https://dev.mysql.com/doc/refman/8.4/en/select.html): doc
- [SQL Server Documentation: ORDER BY Clause (OFFSET ... FETCH NEXT)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql): doc
