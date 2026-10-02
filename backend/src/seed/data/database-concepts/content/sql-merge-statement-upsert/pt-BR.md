---
version: 1.0
updatedAt: 2026-08-05
title: "Mesclando Registros: A Instrução MERGE e a Alternativa de Upsert do MySQL"
summary: Como o MERGE atualiza, apaga ou insere linhas condicionalmente em uma única instrução atômica, conforme as linhas de origem casem ou não, por que o PostgreSQL não tinha MERGE nenhum até a versão 15 (2022), dois anos depois da 2ª edição deste livro, e por que o INSERT ... ON DUPLICATE KEY UPDATE do MySQL consegue inserir ou atualizar, mas nunca apagar, na mesma instrução.
---
## Objective

`MERGE` é uma única instrução que insere, atualiza ou apaga linhas condicionalmente em uma tabela de destino, dependendo de existir ou não uma linha correspondente em uma origem (o padrão "upsert", estendido com um ramo opcional de delete): se uma linha da origem casa com uma linha já existente no destino, atualize-a, e se, depois de avaliar esse casamento, alguma condição adicional valer, apague-a em vez disso; se não houver correspondência, insira uma nova linha montada a partir da origem. A lógica de casamento é um join entre destino e origem, avaliado com cláusulas `WHEN MATCHED` / `WHEN NOT MATCHED`, em vez de uma verificação `IF EXISTS` separada mais um `UPDATE`/`INSERT`/`DELETE` escrito à mão.

## Use Cases

- Sincronizar uma tabela de resumo ou de staging (por exemplo `emp_commission`) com uma tabela de origem (`emp`) em uma passada: atualizar as linhas existentes, inserir as novas e podar as linhas que não atendem mais a uma condição de negócio, sem três instruções separadas competindo entre si.
- Jobs de ETL e de carga em lote que precisam de semântica idempotente de "inserir ou atualizar" contra uma tabela de destino identificada por uma chave natural ou substituta.
- Qualquer fluxo que hoje exige um "verificar e depois ramificar" no nível da aplicação (`SELECT` para ver se uma linha existe, depois `UPDATE` ou `INSERT`), colapsando essa corrida entre verificar e agir em uma única instrução atômica.

## Deep Dive

### A sintaxe original do livro (um único WHEN MATCHED com UPDATE...DELETE)

O exemplo da receita contra `emp_commission`/`emp` define a comissão de toda linha casada como 1000, depois a apaga se o salário do funcionário correspondente for menor que 2000, e insere diretamente as linhas sem correspondência:

```sql
merge into emp_commission ec
using (select * from emp) emp
   on (ec.empno = emp.empno)
 when matched then
      update set ec.comm = 1000
      delete where (sal < 2000)
 when not matched then
      insert (ec.empno, ec.ename, ec.deptno, ec.comm)
      values (emp.empno, emp.ename, emp.deptno, emp.comm)
```

O livro observa que o MySQL não tem `MERGE` nenhum, mas, fora isso, apresenta isto como portável para "qualquer RDBMS deste livro". Essa única cláusula `WHEN MATCHED` combinando um `UPDATE ... DELETE WHERE` em uma ação é sintaxe de Oracle/DB2: como as duas próximas seções mostram, nem o `MERGE` do PostgreSQL nem o do SQL Server aceitam essa forma combinada.

### PostgreSQL: MERGE nativo desde o PostgreSQL 15 (2022), mas sem UPDATE...DELETE combinado

O PostgreSQL **não** tinha instrução `MERGE` nenhuma quando a 2ª edição deste livro foi publicada, em dezembro de 2020; ela saiu pela primeira vez no PostgreSQL 15 (lançado em outubro de 2022), quase dois anos depois. As notas de lançamento do PostgreSQL 15 a listam diretamente em "Utility Commands": *"Add SQL MERGE command to adjust one table to match another"*, e a descrevem como parecida com `INSERT ... ON CONFLICT`, mas mais orientada a lotes (capaz de casar contra uma condição de join arbitrária, não só contra um conflito de chave única). Então a afirmação do livro de que "funciona em qualquer RDBMS deste livro" não valia de fato para o PostgreSQL na época em que foi escrita: não havia `MERGE` no PostgreSQL para rodá-la.

Agora que ele existe, o `MERGE` do PostgreSQL ainda rejeita a ação de uma cláusula `UPDATE ... DELETE WHERE` do livro: segundo a documentação, "para cada linha candidata a mudança, a primeira cláusula que for avaliada como verdadeira é executada... no máximo uma cláusula `WHEN` é executada para qualquer linha candidata a mudança." A condição de delete precisa ser uma cláusula `WHEN MATCHED` própria, verificada *antes* da cláusula de update simples, para que ela fique com a linha quando for verdadeira:

```sql
merge into emp_commission ec
using emp
   on (ec.empno = emp.empno)
when matched and emp.sal < 2000 then
     delete
when matched then
     update set comm = 1000
when not matched then
     insert (empno, ename, deptno, comm)
     values (emp.empno, emp.ename, emp.deptno, emp.comm);
```

### SQL Server: MERGE disponível desde o SQL Server 2008, com a mesma restrição de duas cláusulas

O `MERGE` do SQL Server é anterior ao livro em mais de uma década, e a documentação da Microsoft confirma o mesmo limite do PostgreSQL: no máximo duas cláusulas `WHEN MATCHED` são permitidas, e se houver duas, a primeira precisa ter um `AND <condição>`; uma cláusula faz o `UPDATE`, a outra faz o `DELETE`. Não há como escrever `UPDATE ... DELETE WHERE` como uma única ação, então a consulta é estruturalmente idêntica à versão do PostgreSQL 15+ acima (o SQL Server também exige que a instrução termine com ponto e vírgula):

```sql
merge into emp_commission as ec
using emp
   on (ec.empno = emp.empno)
when matched and emp.sal < 2000 then
     delete
when matched then
     update set comm = 1000
when not matched then
     insert (empno, ename, deptno, comm)
     values (emp.empno, emp.ename, emp.deptno, emp.comm);
```

### MySQL: sem MERGE; INSERT ... ON DUPLICATE KEY UPDATE cobre só a metade de inserir ou atualizar

O MySQL ainda não tem instrução `MERGE`, em nenhuma versão atual (8.4/9.x). Seu upsert idiomático é `INSERT ... ON DUPLICATE KEY UPDATE`, que depende de uma violação de `UNIQUE`/`PRIMARY KEY` (não de uma condição de join) para decidir entre inserir ou atualizar:

```sql
insert into emp_commission (empno, ename, deptno, comm)
select empno, ename, deptno, 1000
  from emp
on duplicate key update comm = 1000;
```

Isso exige que `emp_commission.empno` tenha de fato uma constraint `UNIQUE` ou `PRIMARY KEY`; sem ela, o MySQL não tem violação para detectar e toda linha é inserida como nova. Também não há ramo de delete: o passo "apagar se o salário for menor que 2000" do livro precisa de uma segunda instrução, separada, executada depois:

```sql
delete ec
  from emp_commission ec
  join emp on emp.empno = ec.empno
 where emp.sal < 2000;
```

## Trade-offs

- **Nem o `MERGE` do PostgreSQL nem o do SQL Server aceitam a ação de uma cláusula `UPDATE ... DELETE WHERE` do livro.** Os dois exigem que a condição de delete seja sua própria cláusula `WHEN MATCHED AND ... THEN DELETE`, avaliada antes da cláusula simples `WHEN MATCHED THEN UPDATE` para que possa reivindicar a linha primeiro; a forma combinada do livro é sintaxe de Oracle/DB2, não um denominador comum entre engines.
  ```sql
  -- rejeitado no PostgreSQL e no SQL Server: DELETE não pode vir depois de UPDATE em um WHEN MATCHED
  when matched then
       update set comm = 1000
       delete where (sal < 2000)
  ```
- **O upsert do MySQL consegue inserir ou atualizar, mas nunca apagar, na mesma instrução.** `INSERT ... ON DUPLICATE KEY UPDATE` não tem ramo de delete nenhum, então replicar o terceiro passo do livro (apagar as linhas cujo salário ficou abaixo de 2000) exige uma segunda instrução `DELETE`, separada: duas instruções que só são atômicas juntas se forem explicitamente envolvidas em uma transação, diferente do `MERGE` de instrução única dos outros dois engines.
- **A afirmação de portabilidade do livro, "funciona em qualquer RDBMS deste livro", não valia para o PostgreSQL na época da publicação.** O PostgreSQL não tinha instrução `MERGE` até a versão 15, lançada em outubro de 2022, quase dois anos depois de esta 2ª edição (dezembro de 2020) ir para a gráfica. Quem rodasse esta receita contra um servidor PostgreSQL 12/13/14, o alvo do *PostgreSQL 12 High Availability Cookbook* da mesma época, receberia um erro de sintaxe, não um `MERGE` funcionando.
- **O casamento baseado em join do `MERGE` é mais geral que `ON CONFLICT`/`ON DUPLICATE KEY UPDATE`, mas essa generalidade não é de graça.** As próprias notas de lançamento do PostgreSQL descrevem o `MERGE` como parecido com `INSERT ... ON CONFLICT`, mas "mais orientado a lotes"; para um upsert simples de chave única sem ramo de delete, `ON CONFLICT` (PostgreSQL) ou `ON DUPLICATE KEY UPDATE` (MySQL) normalmente é a escolha mais simples e idiomática; o `MERGE` justifica sua complexidade quando a lógica de casamento é um join de verdade ou um ramo de delete é necessário, como nesta receita.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 4, "Inserting, Updating, and Deleting", receita 4.11 "Merging Records", p. 80-82: doc
- [PostgreSQL Documentation: MERGE](https://www.postgresql.org/docs/current/sql-merge.html): doc
- [PostgreSQL 15 Release Notes: Add SQL MERGE command](https://www.postgresql.org/docs/15/release-15.html): doc
- [MySQL Reference Manual: INSERT ... ON DUPLICATE KEY UPDATE Statement](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html): doc
- [Microsoft Learn: MERGE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/merge-transact-sql): doc
