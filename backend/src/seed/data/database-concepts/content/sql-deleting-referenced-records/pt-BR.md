---
version: 1.0
updatedAt: 2026-08-05
title: "Apagando Registros Referenciados de Outra Tabela"
summary: Removendo linhas identificadas por seu relacionamento com uma segunda tabela: a forma de subconsulta IN/EXISTS, a armadilha de NULL do NOT IN no caso inverso, e as três sintaxes de DELETE com join incompatíveis entre fornecedores.
---
## Objective

Apagar registros referenciados de outra tabela significa que as linhas a remover não são identificadas por nada dentro da própria tabela alvo; são identificadas por seu relacionamento com linhas em uma *segunda* tabela. "Apague todo funcionário que trabalha em um departamento que teve três ou mais acidentes" não pode ser respondido por nenhum predicado sobre `EMP` sozinha: o conjunto qualificante mora em `DEPT_ACCIDENTS`, e o `DELETE` precisa alcançar até lá. Esse alcance é o que torna isso um problema distinto de um `DELETE ... WHERE` simples: você precisa de uma subconsulta, um join, ou uma forma multi-tabela de `DELETE` específica de fornecedor, e cada uma dessas três carrega comportamento diferente de portabilidade e tratamento de NULL.

## Use Cases

- Limpeza em cascata manual quando nenhuma chave estrangeira com `ON DELETE CASCADE` existe: purgar linhas filhas ligadas a um registro pai que você está prestes a remover, ou que foi apagado há muito tempo por um processo que não fez cascata.
- Purgar linhas ligadas a um pai depreciado, fechado, ou em lista negra: funcionários em departamentos fechados, pedidos de produtos descontinuados, sessões pertencentes a contas desativadas.
- Aplicar uma regra que só um fato *derivado* consegue expressar: "departamentos com ≥ 3 acidentes", "clientes com mais de N estornos", onde o conjunto qualificante vem de um agregado sobre a tabela referenciante.
- Limpeza de órfãos, o caso inverso: apagar linhas em uma tabela filha cujo pai não existe mais na tabela de referência (`NOT IN` / `NOT EXISTS`).
- Apagar linhas em estágio em uma tabela de trabalho/fila depois que um job a jusante as registrou como processadas em uma segunda tabela.

## Deep Dive

### A subconsulta `IN`: portável, e correta nos três motores

Dada uma tabela registrando uma linha por acidente por departamento:

```sql
create table dept_accidents
( deptno        integer,
  accident_name varchar(20) );

insert into dept_accidents values (10,'BROKEN FOOT');
insert into dept_accidents values (10,'FLESH WOUND');
insert into dept_accidents values (20,'FIRE');
insert into dept_accidents values (20,'FIRE');
insert into dept_accidents values (20,'FLOOD');
insert into dept_accidents values (30,'BRUISED GLUTE');
```

os departamentos qualificantes vêm de um agregado sobre essa tabela:

```sql
select deptno
  from dept_accidents
 group by deptno
having count(*) >= 3;

-- DEPTNO
-- ------
--     20
```

e o `DELETE` alimenta esse resultado em um predicado `IN`:

```sql
delete from emp
 where deptno in ( select deptno
                     from dept_accidents
                    group by deptno
                   having count(*) >= 3 );
```

Isso roda sem modificação no PostgreSQL, MySQL, e SQL Server. Crucialmente, diferente do `DELETE` de mesma tabela na receita de remoção de duplicata, a subconsulta lê de uma tabela *diferente* daquela da qual está apagando, então o erro 1093 do MySQL (`Can't specify target table ... for update in FROM clause`) nunca dispara. O MySQL só proíbe selecionar do alvo de delete dentro de uma subconsulta; ler `dept_accidents` enquanto apaga de `emp` é perfeitamente legal. A própria documentação da Microsoft rotula esse formato como a solução "subconsulta padrão SQL-2003", e ainda é a forma mais portável de escrever a instrução hoje.

### A forma correlacionada: `EXISTS`

O mesmo delete expressado como um `EXISTS` correlacionado: a subconsulta roda uma vez por linha candidata e só sua *existência*, não seu valor, importa:

```sql
delete from emp e
 where exists ( select 1
                  from dept_accidents da
                 where da.deptno = e.deptno
                 group by da.deptno
                having count(*) >= 3 );
```

ou, com um agregado escalar correlacionado em vez de `GROUP BY`/`HAVING`:

```sql
delete from emp e
 where ( select count(*)
           from dept_accidents da
          where da.deptno = e.deptno ) >= 3;
```

As duas rodam nos três motores. Para o caso *positivo* (`IN` / `EXISTS`) as duas formas são semanticamente idênticas e todo otimizador moderno as achata no mesmo semi-join, então a escolha é estilística. Para de ser estilística no momento em que o predicado é negado: veja abaixo.

### O caso inverso: `NOT IN` é onde NULLs mordem

Apagar linhas *não* referenciadas pela segunda tabela (limpeza de órfão) parece simétrico mas não é:

```sql
-- deletes NOTHING if dept_accidents.deptno contains even one NULL
delete from emp
 where deptno not in (select deptno from dept_accidents);
```

Se a subconsulta produz um `NULL`, `x NOT IN (...)` avalia para `NULL` em vez de `TRUE` para toda linha, e a instrução silenciosamente apaga zero linhas sem levantar um erro. O PostgreSQL documenta a regra explicitamente: "se a expressão do lado esquerdo produz null, ou se não há valores iguais do lado direito e pelo menos uma linha do lado direito produz null, o resultado do construto `NOT IN` vai ser null, não true." A mesma lógica de três valores se aplica no MySQL e SQL Server. `NOT EXISTS` não tem essa armadilha: testa existência de linha, não igualdade de valor, e uma correspondência toda-`NULL` simplesmente não existe:

```sql
delete from emp e
 where not exists ( select 1
                      from dept_accidents da
                     where da.deptno = e.deptno );
```

Recorra a `NOT EXISTS` por padrão no caso negado. A forma positiva `IN` na receita do livro é segura precisamente porque `IN` retornando `NULL` se comporta como `FALSE` para uma cláusula `WHERE`: a linha simplesmente não é apagada, que é o resultado conservador. Negação inverte essa segurança.

### `DELETE` baseado em join: três fornecedores, três sintaxes diferentes

Todo motor oferece uma forma de join como alternativa à subconsulta, e nenhum dos dois a escreve da mesma forma. O agregado precisa se mover para uma tabela derivada, porque `HAVING` não pode morar em uma condição de join.

**PostgreSQL**: `USING` introduz a relação extra; o predicado de join vai no `WHERE`:

```sql
delete from emp
      using ( select deptno
                from dept_accidents
               group by deptno
              having count(*) >= 3 ) risky
      where emp.deptno = risky.deptno;
```

**SQL Server**: uma segunda cláusula `FROM`, uma extensão T-SQL. A tabela alvo é nomeada uma vez como o alvo de delete e novamente (com apelido) no join:

```sql
delete e
  from emp as e
 inner join ( select deptno
                from dept_accidents
               group by deptno
              having count(*) >= 3 ) as risky
    on e.deptno = risky.deptno;
```

**MySQL**: o `DELETE` de múltiplas tabelas, onde as tabelas das quais apagar são listadas antes de `FROM` e o join mora depois:

```sql
delete emp
  from emp
 inner join ( select deptno
                from dept_accidents
               group by deptno
              having count(*) >= 3 ) risky
    on emp.deptno = risky.deptno;
```

O MySQL também aceita uma grafia `USING`: e é um falso amigo. Diferente do PostgreSQL, o `USING` do MySQL exige que a tabela alvo *também* apareça nas referências de tabela:

```sql
-- MySQL: target repeated after USING
delete from emp using emp inner join dept_accidents da on da.deptno = emp.deptno;

-- PostgreSQL: target must NOT be repeated after USING
delete from emp using dept_accidents da where da.deptno = emp.deptno;
```

Copiar um `DELETE ... USING` entre os dois motores produz ou um erro de sintaxe ou, pior no PostgreSQL, um self-join acidental. O manual do PostgreSQL declara a regra diretamente: não repita a tabela alvo como um `from_item` a menos que você de fato queira um self-join.

## Trade-offs

- **`IN` é seguro aqui; `NOT IN` é o que evitar.** A forma positiva `IN` do livro degrada graciosamente quando a subconsulta contém `NULL`s: a linha simplesmente não é apagada. Inverta o predicado e o mesmo `NULL` transforma a instrução inteira em um no-op que reporta sucesso. Use `NOT EXISTS` para todo delete de anti-join, ou no mínimo adicione `where deptno is not null` dentro da subconsulta.
  ```sql
  -- reports "0 rows deleted", raises nothing, and is almost never what was meant
  delete from emp where deptno not in (select deptno from dept_accidents);
  ```
- **`EXISTS` versus `IN` é uma escolha de legibilidade, não de desempenho.** Otimizadores modernos de PostgreSQL, MySQL, e SQL Server todos reescrevem os dois em um semi-join, então a regra popular de que um é inerentemente mais rápido não vale mais. Escolha `IN` quando o conjunto qualificante é uma consulta independente que vale a pena ler por si só (como o agregado aqui é), e `EXISTS` quando a correlação com a linha externa é o ponto.
- **Formas de join podem ser mais rápidas, mas são a coisa menos portável do capítulo.** O `USING` do PostgreSQL, o segundo `FROM` do SQL Server, e o `DELETE` de múltiplas tabelas do MySQL são três extensões de fornecedor mutuamente incompatíveis para uma ideia: a própria documentação do PostgreSQL sinaliza `USING` como uma extensão não padrão, e a da Microsoft sinaliza o segundo `FROM` da mesma forma. A forma de subconsulta é o único formato que sobrevive a uma migração de banco de dados intocado.
- **Fan-out de join é inofensivo para `DELETE`, diferente de `UPDATE`.** O departamento 20 tem três linhas de acidente, então fazer join de `emp` diretamente com `dept_accidents` corresponde a cada funcionário três vezes. Um `DELETE` ainda remove cada linha exatamente uma vez, então as correspondências duplicadas custam trabalho mas não correção: o mesmo fan-out em um `UPDATE ... FROM` aplicaria uma escolhida não deterministicamente das linhas correspondentes em vez disso.
- **O `DELETE` de múltiplas tabelas do MySQL abre mão de `ORDER BY` e `LIMIT`.** As duas cláusulas são documentadas como só-de-tabela-única, então o padrão comum "apague em lotes de 10.000" não consegue ser expressado na forma de join: fazer batching de um delete entre tabelas no MySQL significa voltar para a forma de subconsulta com uma consulta interna com `LIMIT`.
- **Prévia antes de apagar.** Toda técnica acima é trivialmente convertida em um `SELECT` trocando a cláusula inicial, e o conjunto qualificante geralmente é pequeno o suficiente para inspecionar visualmente. Rodar `select * from emp where deptno in (...)` primeiro custa uma ida e volta e é a única rede de segurança real, já que nenhum desses motores consegue desfazer um `DELETE` já confirmado.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 4, "Inserting, Updating, and Deleting", recipe 4.17, p. 87-89] - doc
- [PostgreSQL Documentation: DELETE (USING clause, self-join warning, standard compatibility)](https://www.postgresql.org/docs/current/sql-delete.html) - doc
- [PostgreSQL Documentation: Subquery Expressions (IN / NOT IN null semantics)](https://www.postgresql.org/docs/current/functions-subquery.html) - doc
- [MySQL Reference Manual: DELETE Statement (multiple-table syntax, ORDER BY/LIMIT restriction)](https://dev.mysql.com/doc/refman/8.4/en/delete.html) - doc
- [Microsoft Learn: DELETE (Transact-SQL) (FROM table_source extension vs. ISO subquery)](https://learn.microsoft.com/en-us/sql/t-sql/statements/delete-transact-sql) - doc
