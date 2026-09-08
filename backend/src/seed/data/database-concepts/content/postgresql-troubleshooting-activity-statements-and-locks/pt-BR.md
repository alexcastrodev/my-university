---
version: 1.0
updatedAt: 2026-08-05
title: "Troubleshooting com pg_stat_activity, pg_stat_statements e Locks"
summary: Lendo o estado de conexão ao vivo via pg_stat_activity, encontrando consultas de alta frequência (não só lentas) via pg_stat_statements, e rastreando cadeias de bloqueador-para-bloqueado com pg_locks + pg_blocking_pids(); mais o papel predefinido pg_monitor, que substitui as funções wrapper SECURITY DEFINER feitas à mão do livro.
---
## Objective

Três views embutidas respondem a quase toda pergunta de "o que o banco de dados está fazendo agora, e por que está lento?": `pg_stat_activity` (o que toda conexão está fazendo neste instante), `pg_stat_statements` (desempenho agregado de todo padrão de consulta ao longo do tempo), e `pg_locks` combinado com `pg_blocking_pids()` (quem está bloqueando quem). Nenhuma delas exige ferramental externo; fazem parte do próprio PostgreSQL, mas duas das três vêm trancadas por padrão e precisam de configuração deliberada antes de um não superusuário poder usá-las para monitoramento rotineiro.

## Use Cases

- Diagnosticar um pico súbito em conexões ativas ou duração de consulta em tempo real via `pg_stat_activity`, sem esperar os logs se atualizarem.
- Encontrar a consulta que é silenciosamente responsável por 50% da carga total do banco de dados, não porque alguma execução individual seja lenta, mas porque roda constantemente (`pg_stat_statements`, ordenada por `calls` ou tempo total).
- Rastrear exatamente qual sessão está bloqueando uma transação travada, e qual consulta ela está rodando, em vez de adivinhar só pelos sintomas (`pg_locks` + `pg_blocking_pids()`).
- Construir um dashboard de monitoramento ou uma regra de alerta que precisa de acesso de leitura a esses dados sem conceder privilégios completos de superusuário à conta de monitoramento.

## Deep Dive

### `pg_stat_activity`: o que toda conexão está fazendo agora mesmo

```sql
SELECT pid, usename, state, wait_event, query_start, query
  FROM pg_stat_activity;
```

Colunas-chave: `pid` (o process id do SO, útil para `kill`/correlacionar com `strace`), `state` (`active`, `idle`, `idle in transaction`, ou o mais alarmante `idle in transaction (aborted)`: uma transação que sofreu um erro e nunca foi revertida ou desconectada, um sintoma clássico de vazamento de conexão), `wait_event` (o que uma consulta bloqueada está esperando: um lock, I/O de disco, um worker em segundo plano), e `query`/`query_start` (a instrução atual ou mais recente e quando começou). `state_change` diz há quanto tempo uma conexão está sentada em seu estado atual: uma sessão travada em `idle in transaction` por horas é um forte sinal de um bug de aplicação mantendo uma transação aberta.

### Tornando `pg_stat_activity` e `pg_stat_statements` seguros para não superusuários

Por padrão, só um superusuário consegue ver o conteúdo completo dessas views (o texto da consulta e os detalhes de conexão ficam escondidos de outros usuários, por um bom motivo: podem vazar dados sensíveis). A técnica histórica para delegar acesso de leitura sem conceder superusuário era uma função wrapper `SECURITY DEFINER`:

```sql
CREATE OR REPLACE FUNCTION pg_stat_activity() RETURNS SETOF pg_stat_activity AS $$
    SELECT * FROM pg_stat_activity;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE ALL ON FUNCTION pg_stat_activity() FROM PUBLIC;

CREATE USER db_mon WITH PASSWORD 'somepass';
GRANT EXECUTE ON FUNCTION pg_stat_activity() TO db_mon;
```

`SECURITY DEFINER` faz a função executar com os privilégios de quem a *criou* (um superusuário), não de quem a *chama*, então uma função criada por `postgres` e depois concedida a `db_mon` deixa `db_mon` ver o conteúdo irrestrito da view através da função, sem nunca ser superusuário ele mesmo. O mesmo padrão se aplica ao pé da letra a `pg_stat_statements`.

### `pg_stat_statements`: desempenho agregado de consulta ao longo do tempo

```sql
-- one-time setup: postgresql.conf, then restart
shared_preload_libraries = 'pg_stat_statements'
```
```sql
CREATE EXTENSION pg_stat_statements;

SELECT query, calls, total_exec_time, rows
  FROM pg_stat_statements
 ORDER BY calls DESC
 LIMIT 10;
```

Diferente de `log_min_duration_statement` (que só captura consultas *lentas*), `pg_stat_statements` agrega *todo* padrão de consulta distinto (com os literais normalizados) — `calls`, tempo total de execução, linhas retornadas — independentemente da velocidade. Uma consulta que individualmente leva 2ms mas roda 50.000 vezes por segundo pode dominar a carga do servidor sem nunca disparar uma entrada de log de consulta lenta; ordenar por `calls` ou tempo total é como esse padrão de fato é encontrado. `SELECT pg_stat_statements_reset();` limpa as estatísticas acumuladas quando uma baseline nova é necessária (por exemplo, depois de um deploy).

### Encontrando o que está bloqueando o quê: `pg_locks` e `pg_blocking_pids()`

```sql
-- what's locked, and is the lock granted or waiting?
SELECT pid, locktype, mode, granted,
       relation::REGCLASS::TEXT AS locked_object
  FROM pg_locks
 WHERE relation IS NOT NULL
 ORDER BY relation, granted DESC;

-- the actual blocker → blocked relationship (PostgreSQL 9.6+)
SELECT p.pid, p.query, s.pid AS blocker_pid, s.query AS blocker_query
  FROM pg_stat_activity p
  JOIN pg_stat_activity s ON (s.pid = ANY(pg_blocking_pids(p.pid)));
```

`pg_locks` sozinha só mostra disputa por recurso (dois PIDs querendo o mesmo objeto) sem declarar causa e efeito. `pg_blocking_pids(pid)` (adicionada no PostgreSQL 9.6) fecha essa lacuna diretamente: dado o PID de um processo bloqueado, ela retorna o array de PIDs de fato bloqueando-o, que a segunda consulta une de volta contra `pg_stat_activity` para mostrar as duas consultas lado a lado: a consulta travada e a que segura o lock que ela está esperando.

## Trade-offs

- **`idle in transaction (aborted)` é invisível antes do PostgreSQL 9.2**: esse valor de `state` não existe em versões mais antigas, que só reportam `current_query` sem rastreamento de estado separado; ao fazer triagem de uma versão antiga e sem suporte do PostgreSQL, o sinal diagnóstico simplesmente não está lá.
- **`pg_stat_statements` trunca o texto da consulta e limita os padrões rastreados**: a coluna `query` mostra até 1.024 caracteres, e o módulo só lembra os primeiros N padrões de consulta distintos que vê (`pg_stat_statements.max`, com padrão de vários milhares) antes de descartar os menos usados; uma carga de trabalho com variância extremamente alta na forma das consultas (por exemplo, SQL gerado dinamicamente com literais não parametrizados) pode ultrapassar isso e perder visibilidade sobre padrões mais raros.
```sql
-- raise the tracked-pattern ceiling (requires a restart)
-- postgresql.conf: pg_stat_statements.max = 10000
```
- **Uma função wrapper `SECURITY DEFINER` é poderosa e fácil de errar**: esquecer o passo `REVOKE ALL ... FROM PUBLIC` deixa a função de privilégio elevado chamável por *qualquer* usuário autenticado, efetivamente distribuindo visibilidade em nível de superusuário sobre toda consulta no servidor por acidente.
- **Livro vs. hoje**: a dança de função wrapper `SECURITY DEFINER` para `pg_stat_activity`/`pg_stat_statements` é anterior aos **papéis predefinidos** embutidos do PostgreSQL (`pg_monitor`, `pg_read_all_stats`, `pg_read_all_settings`), introduzidos no **PostgreSQL 10**, antes da própria versão-base PostgreSQL 12 deste livro. Hoje, a configuração de função customizada inteira se reduz a uma linha: `GRANT pg_monitor TO db_mon;` concede a uma conta de monitoramento acesso de leitura completo a `pg_stat_activity`, `pg_stat_statements` e outras views de estatística diretamente, sem função wrapper, sem `REVOKE`, e sem risco de esquecer o passo de revogação. A técnica manual do livro ainda funciona e vale a pena entender (é o mesmo mecanismo de base que muitas configurações de monitoramento mais antigas ou customizadas ainda usam), mas não é o caminho atual mais simples.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 5, "Troubleshooting", recipes "Checking the pg_stat_activity view", "Checking the pg_stat_statements view", "Deciphering database locks", p. 203-215](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) - doc
- [PostgreSQL Documentation: The Statistics Collector (pg_stat_activity)](https://www.postgresql.org/docs/current/monitoring-stats.html) - doc
- [PostgreSQL Documentation: pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html) - doc
- [PostgreSQL Documentation: Predefined Roles (pg_monitor, pg_read_all_stats)](https://www.postgresql.org/docs/current/predefined-roles.html) - doc
- [PostgreSQL Documentation: pg_locks](https://www.postgresql.org/docs/current/view-pg-locks.html) - doc
