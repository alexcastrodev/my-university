---
version: 1.0
updatedAt: 2026-08-01
title: "Encontrando Suas Tabelas Mais Movimentadas: Estatísticas de Atividade e Bloat no PostgreSQL"
summary: Como ranquear tabelas e índices por tamanho (pg_total_relation_size), por atividade de escrita/leitura (pg_stat_user_tables, pg_stat_user_indexes), e por bloat (a extensão pgstattuple), e como as colunas last_seq_scan/last_idx_scan do PostgreSQL 16 resolvem a própria reclamação do livro de que contadores de atividade não têm timestamp associado.
---
## Objective

Antes de uma tabela ou índice virar um incidente de produção, as próprias views de estatística do PostgreSQL já conseguem dizer quais são grandes, quais estão quentes e quais estão bloated, sem nenhuma ferramenta externa necessária. Saber isso com antecedência transforma "por que o banco está lento" em uma pergunta direcionada em vez de um jogo de adivinhação.

## Use Cases

- Decidir quais tabelas merecem seu próprio tablespace ou configurações de `autovacuum` mais agressivas, com base em tamanho e volume de escrita reais em vez de achismo.
- Identificar um índice raramente usado e seguro de apagar, versus um lido constantemente e que vale a pena proteger de remoção acidental.
- Confirmar que uma tabela que todo mundo presume ser "só para logging" é na verdade a maior fonte de carga de escrita do banco inteiro.
- Medir exatamente quanto do espaço em disco de uma tabela é espaço morto reutilizável antes de decidir se ela precisa de um `VACUUM FULL`/`CLUSTER`.

## Deep Dive

### Ranqueando tabelas e índices por tamanho

```sql
SELECT oid::regclass::text AS table_name,
       pg_size_pretty(pg_total_relation_size(oid)) AS total_size
  FROM pg_class
 WHERE relkind = 'r'
   AND relpages > 0
 ORDER BY pg_total_relation_size(oid) DESC
 LIMIT 20;
```

`pg_total_relation_size` inclui os dados TOAST de uma tabela e todo índice sobre ela, então o ranking reflete o espaço real ocupado pelo objeto, não só o heap. A consulta equivalente contra `pg_index` (usando `pg_relation_size(indexrelid)`) ranqueia índices da mesma forma; índices grandes que não são chave primária são bons candidatos para revisão: um índice parcial ou uma chave composta mais seletiva pode cobrir as mesmas consultas de forma bem mais barata.

### Ranqueando por atividade de escrita

```sql
SELECT relid::regclass AS table_name,
       n_tup_ins AS inserts,
       n_tup_hot_upd + n_tup_upd AS updates,
       n_tup_del AS deletes
  FROM pg_stat_user_tables
 ORDER BY (n_tup_ins + n_tup_upd + n_tup_hot_upd + n_tup_del) DESC
 LIMIT 20;
```

Tabelas com uma taxa alta de rotatividade de linhas são as mais propensas a precisar de ajuste manual de `autovacuum`/`autoanalyze`: uma tabela que o `autovacuum` não consegue acompanhar é uma fonte constante de bloat.

### Ranqueando por atividade de leitura

```sql
SELECT relid::regclass AS table_name,
       coalesce(seq_scan, 0) AS sequential_scans,
       coalesce(idx_scan, 0) AS index_scans,
       coalesce(seq_tup_read, 0) AS table_matches,
       coalesce(idx_tup_fetch, 0) AS index_matches
  FROM pg_stat_user_tables
 ORDER BY (coalesce(seq_scan, 0) + coalesce(idx_scan, 0)) DESC,
          (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)) DESC
 LIMIT 20;
```

Uma tabela alta em scans sequenciais em relação a scans de índice ou está sem um índice útil ou tem um padrão de consulta para o qual o planejador não consegue usar um. A mesma consulta contra `pg_stat_user_indexes` (ordenada por `idx_scan`) revela o outro lado: índices que quase nunca são usados, que custam overhead de escrita sem nenhum benefício de leitura.

### Resetando contadores para medir uma taxa, não um total acumulado

```sql
SELECT pg_stat_reset();
```

Todo contador acima acumula desde a inicialização do servidor (ou o último reset) sem nenhum timestamp associado; comparar "inserts hoje" contra "inserts este ano" exige resetar primeiro ou tirar um snapshot e calcular a diferença você mesmo.

### Bloat exato com pgstattuple

```sql
CREATE EXTENSION pgstattuple;

SELECT * FROM pgstattuple('orders');
```

`pgstattuple()` realiza uma varredura completa da tabela e retorna números exatos: `dead_tuple_percent`, `free_percent`, e assim por diante. Um `free_percent` alto significa que a tabela é majoritariamente espaço vazio reutilizável e é uma forte candidata a `CLUSTER` ou `VACUUM FULL`; uma tabela que continua acumulando bloat apesar de execuções regulares de `autovacuum` vale a pena sinalizar para a equipe dona do schema, já que o conserto muitas vezes é uma mudança no padrão de acesso em nível de aplicação, não uma configuração do banco.

## Trade-offs

- **A exatidão do `pgstattuple()` custa uma varredura completa da tabela.** Em uma tabela de vários GB sob carga de produção, essa varredura em si adiciona pressão de I/O; o `pgstattuple_approx()` (disponível desde o PostgreSQL 9.5, não mencionado nesta receita) troca um pouco de precisão por uma estimativa muito mais barata, sem varredura completa, e geralmente é a melhor primeira checagem antes de recorrer à versão exata.
- **Todas essas views são por banco de dados.** Uma instância PostgreSQL com uma dúzia de bancos precisa de uma dúzia de conexões para construir um panorama completo em nível de instância; não existe uma view agregada entre bancos de dados.
- **Livro vs. hoje**: a própria reclamação do livro ("não há timestamp associado" a esses contadores, forçando um fluxo manual de reset-e-diferença para medir uma taxa) tem uma solução parcial desde o **PostgreSQL 16**: `pg_stat_user_tables` (e a view de índice equivalente) ganharam colunas `last_seq_scan` e `last_idx_scan`, dando uma resposta direta a "quando essa tabela foi varrida dessa forma pela última vez" sem resetar nada. Isso não substitui `pg_stat_reset()` para medir uma taxa de mudança, mas fecha a lacuna específica de "quão recente é essa atividade" que o livro aponta como limitação.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 3, "Minimizing Downtime", recipe "Identifying important tables", p. 100-105] - doc
- [PostgreSQL Documentation: The Cumulative Statistics System (pg_stat_user_tables, pg_stat_reset)](https://www.postgresql.org/docs/current/monitoring-stats.html) - doc
- [PostgreSQL Documentation: pgstattuple](https://www.postgresql.org/docs/current/pgstattuple.html) - doc
- [PostgreSQL 16 Release Notes: last_seq_scan/last_idx_scan added to pg_stat_*_tables](https://www.postgresql.org/docs/16/release-16.html) - doc
