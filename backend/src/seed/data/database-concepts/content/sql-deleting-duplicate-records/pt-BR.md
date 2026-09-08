---
version: 1.0
updatedAt: 2026-08-05
title: "Apagando Registros Duplicados"
summary: Como manter arbitrariamente uma linha por grupo de duplicata e apagar o resto com MIN(id) NOT IN, por que o MySQL ainda rejeita uma subconsulta de DELETE que lê sua própria tabela alvo, e como ROW_NUMBER() sobre uma CTE oferece uma alternativa mais portável, embora não com sintaxe idêntica, entre PostgreSQL, MySQL, e SQL Server.
---
## Objective

Apagar registros duplicados significa: para cada grupo de linhas que compartilham o mesmo valor em alguma coluna (um `NAME`, um email, uma chave natural que nunca foi tornada única), manter arbitrariamente exatamente uma linha e remover o resto. "Arbitrariamente" importa aqui: as linhas em um grupo de duplicata são indistinguíveis pela coluna que define a duplicata, então qualquer coluna de desempate (tipicamente a chave primária) é usada só para escolher *qual* sobrevive, não porque uma linha é mais "correta" do que outra.

## Use Cases

- Limpar linhas importadas duas vezes por um job em lote, uma chamada de API retentada, ou uma carga de CSV que rodou sem uma checagem de unicidade.
- Deduplicar uma tabela antes de adicionar uma constraint ou índice `UNIQUE` que o dado existente de outra forma violaria.
- Manutenção pontual de qualidade de dado: colapsar linhas quase idênticas em uma única canônica por grupo antes de uma migração ou um relatório.

## Deep Dive

### A técnica clássica: manter a linha com o menor id

Dada uma tabela `dupes` onde várias linhas compartilham o mesmo `name`:

```sql
create table dupes (id integer, name varchar(10));

insert into dupes values (1, 'NAPOLEON');
insert into dupes values (2, 'DYNAMITE');
insert into dupes values (3, 'DYNAMITE');
insert into dupes values (4, 'SHE SELLS');
insert into dupes values (5, 'SEA SHELLS');
insert into dupes values (6, 'SEA SHELLS');
insert into dupes values (7, 'SEA SHELLS');
```

a abordagem do livro agrupa pela coluna que define a duplicata, escolhe o `id` mínimo por grupo para manter, e apaga tudo mais:

```sql
delete from dupes
 where id not in ( select min(id)
                      from dupes
                     group by name );
```

Isso roda como está no PostgreSQL e SQL Server: os dois permitem que a subconsulta de um `DELETE` referencie a mesma tabela da qual está apagando. **Não** roda no MySQL, que o rejeita com o erro 1093, `Can't specify target table 'dupes' for update in FROM clause`: o MySQL ainda se recusa, hoje, a deixar a subconsulta de um `DELETE` ler diretamente da tabela da qual está apagando.

### A restrição de mesma tabela do MySQL e o workaround de tabela derivada

O conserto do livro envolve a subconsulta ofensora em uma tabela derivada extra:

```sql
delete from dupes
 where id not in
       ( select min(id)
           from (select id, name from dupes) tmp
          group by name );
```

O otimizador do MySQL materializa o `(select id, name from dupes) tmp` interno em um conjunto de resultado descartável antes de o `DELETE` externo rodar, então no momento em que `MIN(id)` o agrupa, não é mais "a mesma tabela" no que diz respeito à checagem de mesma tabela: é um resultado derivado anônimo. Isso ainda é exatamente como o MySQL se comporta a partir da 8.4/9.x: a restrição sobre referenciar o alvo de delete dentro de uma subconsulta simples não foi levantada, e o envolvimento em tabela derivada ainda é a forma documentada de contorná-la (o próprio manual do MySQL adicionalmente sugere uma abordagem de troca de tabela: construir uma cópia filtrada com `INSERT ... SELECT`, depois `RENAME TABLE` para o lugar, como uma alternativa para deletes muito grandes em tabelas InnoDB).

Uma coisa que *de fato* mudou desde o livro: o MySQL 8.0 adicionou suporte a uma cláusula `WITH` antes de `DELETE`, então uma CTE consegue fornecer valores para uma instrução `DELETE`. Isso não remove a restrição de mesma tabela, no entanto: veja a próxima seção.

### Uma alternativa mais portável: `ROW_NUMBER()` sobre uma CTE

Uma técnica mais nova, arguivelmente mais legível, substitui `MIN(id) NOT IN` por uma função de janela `ROW_NUMBER()` particionada pela coluna que define a duplicata: a linha `1` em cada partição é a que fica, tudo numerado mais alto é uma duplicata para apagar. Os três motores suportam funções de janela e CTEs hoje, mas cada um tem uma regra diferente para até onde um `DELETE` consegue alcançar dentro de uma CTE construída sobre a mesma tabela:

**PostgreSQL**: uma CTE não é ela mesma uma relação atualizável, então o `DELETE` ainda precisa de uma cláusula `USING` para fazer join de volta a ela:

```sql
with ranked as (
  select id, row_number() over (partition by name order by id) as rn
    from dupes
)
delete from dupes
      using ranked
      where dupes.id = ranked.id
        and ranked.rn > 1;
```

**SQL Server**: unicamente entre os três, uma CTE construída diretamente sobre a tabela alvo consegue ter linhas apagadas *diretamente*, porque a função de janela é avaliada dentro da CTE, não dentro do próprio `DELETE`:

```sql
with ranked as (
  select id, row_number() over (partition by name order by id) as rn
    from dupes
)
delete from ranked where rn > 1;
```

**MySQL**: CTEs usadas por um `DELETE` são materializadas antes de a instrução rodar, então referenciar a tabela alvo *dentro* da definição da CTE está tudo bem. O que ainda não é permitido é apagar diretamente de uma CTE que carrega o resultado de uma função de janela, porque a restrição do padrão SQL sobre funções de janela se aplica aqui também: elas podem aparecer em uma subconsulta da qual um `DELETE` lê, mas não nas linhas que um `DELETE`/`UPDATE` de fato está modificando. Então o MySQL precisa da forma `IN`, uma camada removida da CTE:

```sql
with ranked as (
  select id, row_number() over (partition by name order by id) as rn
    from dupes
)
delete from dupes
      where id in (select id from ranked where rn > 1);
```

A versão `ROW_NUMBER()` lê da mesma forma nos três motores (uma função de janela computando "qual cópia é essa" por grupo), o que torna mais fácil carregar um modelo mental entre PostgreSQL, MySQL, e SQL Server do que memorizar as peculiaridades próprias de cada motor em torno de `MIN(id) NOT IN`: a técnica do livro permanece completamente válida, mas a forma CTE é a que vale a pena usar primeiro hoje.

## Trade-offs

- **`NOT IN` silenciosamente não apaga nada se a subconsulta alguma vez retornar um `NULL`.** `x NOT IN (a, NULL)` avalia para `UNKNOWN`, não `TRUE`, para toda linha: então se `MIN(id)` pudesse alguma vez produzir um `NULL` (uma coluna `id` que permite `NULL`s, ou uma subconsulta mais complexa que por acaso inclui um), o `DELETE` inteiro silenciosamente apaga zero linhas em vez de dar erro. As formas `NOT EXISTS`/anti-join e a abordagem `ROW_NUMBER()` não têm essa armadilha, porque nunca comparam contra um conjunto que poderia conter um `NULL`.
  ```sql
  -- if any id in the derived set is NULL, this deletes nothing at all
  delete from dupes where id not in (select min(id) from dupes group by name);
  ```
- **"Qual linha sobrevive" é arbitrário por design, mas a coluna de desempate ainda precisa existir e ser determinística.** As duas técnicas se baseiam em `id` (via `MIN(id)` ou `ORDER BY id` dentro de `ROW_NUMBER()`) especificamente porque `id` é garantidamente único: agrupar/particionar só por `name` não consegue distinguir duas linhas duplicadas, então *alguma* outra coluna precisa desempatar, ou a escolha de qual cópia manter se torna genuinamente não determinística entre execuções.
- **O workaround de tabela derivada do MySQL é uma restrição real, ainda necessária, não um artefato da era do livro.** É tentador presumir que uma restrição de subconsulta de mesma tabela como essa teria sido levantada nos mais de dez anos desde que o MySQL primeiro a documentou, mas não foi: o MySQL 8.4/9.x ainda levanta o erro 1093 na forma original de uma subconsulta do livro, e ainda precisa ou do envolvimento extra em tabela derivada ou da forma `IN (SELECT ... FROM cte)` mostrada acima.
- **Portabilidade vem ao custo de uma pequena diferença de sintaxe por motor.** A técnica `ROW_NUMBER()` lê identicamente entre PostgreSQL, MySQL, e SQL Server no nível da CTE, mas a forma da própria instrução `DELETE` ainda difere (`USING` vs. `DELETE FROM cte` direto vs. `WHERE id IN (...)`): não existe uma única consulta que roda sem modificação nos três, só um modelo mental compartilhado para construir a certa por motor.

## Documentation Links

- [Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020), Chapter 4, "Inserting, Updating, and Deleting", recipe 4.16, p. 85-87] - doc
- [PostgreSQL Documentation: DELETE (USING clause)](https://www.postgresql.org/docs/current/sql-delete.html) - doc
- [MySQL Reference Manual: DELETE Statement (same-table subquery restriction, WITH clause support)](https://dev.mysql.com/doc/refman/8.4/en/delete.html) - doc
- [MySQL Reference Manual: Window Function Restrictions](https://dev.mysql.com/doc/refman/8.4/en/window-function-restrictions.html) - doc
- [Microsoft Learn: WITH common_table_expression (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql) - doc
