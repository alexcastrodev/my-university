---
version: 1.0
updatedAt: 2026-08-05
title: "Distribuição de Dados: Foreign Data Wrappers e Sharding Caseiro"
summary: Consultas entre servidores via postgres_fdw (CREATE SERVER, user mappings, foreign tables, IMPORT FOREIGN SCHEMA), construção de um esquema de sharding artesanal com um gerador de ID único empacotado em bits, e por que o Citus é o caminho mais pragmático para sharding horizontal de verdade hoje em dia.
---
## Objective

Foreign Data Wrappers permitem que o PostgreSQL trate uma tabela em um servidor completamente diferente como se fosse local (consultável, combinável em joins, às vezes até gravável) sem que a aplicação saiba que os dados não estão fisicamente por perto. `postgres_fdw` é o wrapper embutido para conversar com outros servidores PostgreSQL, e é a base tanto para acesso simples entre servidores (um servidor de relatórios consultando tabelas que moram no primário) quanto para sharding horizontal artesanal: distribuir linhas entre várias instâncias PostgreSQL construindo você mesmo a lógica de geração de ID, roteamento e gerenciamento de shards por cima das primitivas do FDW.

## Use Cases

- Consultar tabelas que moram em um servidor PostgreSQL diferente (por exemplo, uma réplica de relatórios acessando um subconjunto de tabelas do primário) sem copiar fisicamente os dados.
- Centralizar um pequeno conjunto de tabelas de referência/lookup em um servidor que muitos outros bancos consultam via foreign tables, em vez de duplicá-las em todo lugar.
- Migrar dados incrementalmente entre servidores consultando as localizações antiga e nova de forma transparente durante um período de transição.
- Construir um esquema de sharding em nível de aplicação quando uma solução completa de banco distribuído não se justifica: o caminho DIY que este livro ensina.

## Deep Dive

### Registrando um servidor PostgreSQL remoto

```sql
CREATE EXTENSION postgres_fdw;

CREATE SERVER primary_db
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'pg-primary', dbname 'pgbench');
```

`CREATE SERVER` deliberadamente omite usuário/senha: as credenciais de conexão são tratadas separadamente por user mappings, o que significa que a mesma definição de servidor pode ser compartilhada por muitos usuários locais, cada um autenticando como si mesmo do lado remoto em vez de usar uma credencial compartilhada.

### Mapeando usuários locais para credenciais remotas

```sql
CREATE USER MAPPING FOR bench_user
    SERVER primary_db
    OPTIONS (user 'bench_user', password 'testing');
```

Todo usuário local que consulta o servidor remoto precisa do seu próprio mapeamento: o PostgreSQL exige isso explicitamente (a opção de senha é obrigatória para não superusuários, especificamente para impedir que um usuário mapeado extraia credenciais silenciosamente do `.pgpass` ou de outro armazenamento automatizado de senhas). Para muitos usuários, um bloco PL/pgSQL anônimo `DO $$ ... $$` pode gerar os mapeamentos em massa em vez de um `CREATE USER MAPPING` por usuário.

### Criando e usando uma foreign table

```sql
CREATE FOREIGN TABLE pgbench_accounts (
    aid       INTEGER NOT NULL,
    bid       INTEGER,
    abalance  INTEGER,
    filler    CHAR(84)
)
SERVER primary_db
OPTIONS (table_name 'pgbench_accounts');

ANALYZE pgbench_accounts;
```

Uma foreign table declara apenas nomes de coluna/tipos/nulabilidade, sem índices ou constraints, já que esses moram no servidor remoto e o PostgreSQL não consegue aplicá-los localmente de qualquer forma. Rodar `ANALYZE` ainda importa: sem estatísticas locais, o planejador de consultas não tem ideia de quão seletivo será um filtro sobre a foreign table e pode tomar decisões ruins de ordem de join. Para muitas tabelas de uma vez, `IMPORT FOREIGN SCHEMA` evita escrever cada `CREATE FOREIGN TABLE` na mão:

```sql
IMPORT FOREIGN SCHEMA public
  FROM SERVER primary_db
  INTO public;
```

O PostgreSQL aplica a distinção entre foreign e local em todo lugar: um `DROP TABLE` simples sobre uma foreign table falha diretamente (tem que ser `DROP FOREIGN TABLE`), e `pg_class.relkind` reporta `f` em vez de `r`, então as ferramentas sempre conseguem diferenciar as duas.

### Sharding DIY: empacotando shard + tempo + sequência em um único ID

A abordagem do livro para IDs únicos entre muitos shards (a mesma técnica que o Instagram documentou publicamente para seu próprio sistema de sharding) empacota três informações em um único inteiro de 64 bits em vez de depender de uma sequência global única (que se tornaria ela mesma um gargalo e um ponto único de falha entre os shards):

```sql
CREATE SEQUENCE shard.table_id_seq;

CREATE OR REPLACE FUNCTION shard.next_unique_id(shard_id INT)
RETURNS BIGINT AS $$
DECLARE
  epoch     DATE := '2020-01-01';
  epoch_ms  BIGINT;
  now_ms    BIGINT;
  next_id   BIGINT;
BEGIN
  epoch_ms := floor(extract(EPOCH FROM epoch) * 1000);
  now_ms   := floor(extract(EPOCH FROM clock_timestamp()) * 1000);
  next_id  := (now_ms - epoch_ms) << 22
            | (shard_id << 11)
            | (nextval('shard.table_id_seq') % 2048);
  RETURN next_id;
END;
$$ LANGUAGE plpgsql;
```

Layout de bits: os bits mais altos guardam milissegundos desde uma época escolhida (viável por ~140 anos), os próximos 11 bits guardam o número do shard (até 2.048 shards lógicos), e os 11 bits mais baixos guardam um valor de sequência por shard (até 2.048 IDs por milissegundo por shard). `clock_timestamp()` é usado em vez de `now()` deliberadamente: `now()` retorna o horário de início *da transação*, que seria idêntico para todo ID gerado dentro da mesma transação e arriscaria colisões; `clock_timestamp()` reflete o horário real do relógio de parede a cada chamada.

### De um gerador de ID a uma API de sharding

O livro enquadra um sistema de sharding de verdade como muito mais do que apenas a função de ID: uma implementação real precisa de uma tabela de configuração de shards, uma tabela rastreando quais tabelas da aplicação existem em quais shards, funções para construir/alterar a estrutura de cada shard de forma consistente, uma camada de mapeamento de shard lógico para físico (para que um número de shard lógico possa se mover para um servidor físico diferente sem que a aplicação saiba), e um papel (role) dedicado com escopo apenas nas permissões que essa maquinaria precisa. O gerador de ID é os 10% fáceis: a API de gerenciamento de shards em volta dele são os outros 90%.

## Trade-offs

- **A qualidade do plano de consulta de uma foreign table depende inteiramente de estatísticas que o PostgreSQL não coleta automaticamente.** Pular o `ANALYZE` depois de criar uma foreign table deixa o planejador cego quanto à seletividade e à contagem de linhas, o que pode produzir um plano tecnicamente correto mas muito ineficiente (buscando muito mais linhas remotas do que uma consulta realmente precisa) sem nenhum erro ou aviso, apenas desempenho silenciosamente ruim.
- **User mappings são por servidor e por usuário por design, o que é seguro mas não escala para "mapear todo mundo automaticamente".** O workaround do bloco anônimo para mapear em massa usuários locais para usuários remotos com nomes idênticos só funciona de forma limpa quando os nomes de usuário coincidem dos dois lados; um sistema remoto administrado por outra pessoa, com nomes de usuário diferentes, quebra essa suposição e força o mapeamento manual.
- **Sharding feito à mão dá controle total ao custo de construir (e manter) um sistema distribuído de verdade do zero.** O esquema de ID empacotado em bits é um padrão inteligente e bem compreendido, mas é apenas a camada de geração de ID: joins entre shards, rebalanceamento de shards, consistência transacional entre shards e roteamento de consultas ainda precisam ser projetados e construídos; nada disso vem de graça do FDW ou da função de ID.
```sql
-- o gerador de ID sozinho não responde perguntas como:
-- "qual servidor físico guarda o shard 42 agora?"
-- "como eu faço join de dados que moram em dois shards diferentes?"
```
- **Livro vs. hoje**: este capítulo constrói um sistema de sharding essencialmente à mão (FDW para acesso entre servidores, um gerador de ID customizado e uma API de gerenciamento de shards do zero). O **Citus**, uma extensão PostgreSQL madura e ativamente mantida (open source, com uma oferta gerenciada da Microsoft como Azure Cosmos DB for PostgreSQL), resolve a mesma classe de problema com uma fração do código customizado: `SELECT create_distributed_table('table_name', 'shard_key_column');` transforma uma tabela comum em uma distribuída, com o Citus cuidando internamente do posicionamento de shards, do roteamento de consultas e do planejamento de consultas entre shards. Para sistemas novos que precisam de sharding horizontal de verdade hoje, recorrer ao Citus (ou a uma solução Postgres distribuída madura equivalente) é geralmente o ponto de partida mais pragmático do que reimplementar a abordagem DIY deste capítulo; a técnica do livro continua valiosa para entender *o que* uma camada de sharding realmente precisa resolver, mesmo quando a implementação em si é delegada a uma extensão.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 14, "Data Distribution", p. 602-646](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) - doc
- [PostgreSQL Documentation: postgres_fdw](https://www.postgresql.org/docs/current/postgres-fdw.html) - doc
- [PostgreSQL Documentation: CREATE FOREIGN TABLE](https://www.postgresql.org/docs/current/sql-createforeigntable.html) - doc
- [PostgreSQL Documentation: IMPORT FOREIGN SCHEMA](https://www.postgresql.org/docs/current/sql-importforeignschema.html) - doc
- [Citus Documentation: What is Citus?](https://docs.citusdata.com/en/stable/get_started/what_is_citus.html) - doc
