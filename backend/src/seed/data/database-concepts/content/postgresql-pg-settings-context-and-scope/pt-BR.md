---
version: 1.0
updatedAt: 2026-07-31
title: "pg_settings do PostgreSQL: Contextos de Restart, Reload e Escopo de Sessão"
summary: Como a coluna pg_settings.context revela se mudar uma configuração exige um restart completo do postmaster, um reload via SIGHUP, ou um SET de nível superusuário/usuário, como IS DISTINCT FROM lista com segurança configurações alteradas do padrão boot_val, e como o GRANT SET/ALTER SYSTEM ON PARAMETER do PostgreSQL 15 agora permite que administradores deleguem configurações específicas de contexto superusuário a papéis não superusuário sem uma concessão completa de superusuário.
---
## Objective

`pg_settings` é a view que responde a uma pergunta que todo DBA eventualmente faz sob pressão de tempo: "se eu mudar essa configuração, o que eu realmente preciso fazer para que ela entre em vigor?" A coluna `context` codifica a resposta por configuração, desde "impossível sem recompilar" até "qualquer usuário, qualquer sessão, agora mesmo", então em vez de chutar ou reiniciar por precaução, uma consulta contra `pg_settings` dá uma resposta definitiva antes de mexer no `postgresql.conf`.

## Use Cases

- Antes de editar o `postgresql.conf`, checar se uma mudança de configuração é um reload sem downtime ou um restart que precisa ser agendado: a diferença entre `wal_level` (restart) e `log_min_duration_statement` (reload) não é adivinhável só pelo nome da configuração.
- Auditar um servidor em busca de toda configuração que foi alterada do padrão de fábrica, para reconstruir por que um banco de dados se comporta do jeito que se comporta quando quem o ajustou não está mais por perto.
- Regenerar um certificado SSL comprometido e descobrir que o PostgreSQL não tem uma opção de "reler este arquivo" no lugar para ele: `ssl_cert_file` tem `context = 'postmaster'`, então substituir o conteúdo do certificado não é suficiente; o servidor precisa reiniciar para pegar a mudança.
- Decidir se um problema de permissão pode ser resolvido concedendo um parâmetro específico a um papel, em vez de distribuir superusuário completo só para que o dono de uma aplicação possa alternar uma configuração.

## Deep Dive

### `pg_settings.context`: o que cada valor de fato permite

Em ordem de "mais difícil de mudar" a "mais fácil de mudar":

| Valor de `context` | Como é alterado |
|---|---|
| `internal` | Não é alterável de jeito nenhum: definido pelo `initdb` ou embutido na compilação. |
| `postmaster` | Só na inicialização do servidor; precisa de um restart completo. |
| `sighup` | Edite `postgresql.conf`, depois recarregue (SIGHUP / `pg_reload_conf()`): sem restart. |
| `superuser-backend` | Recarregável no arquivo, mas uma sessão já conectada não vai pegar a mudança; só conexões recém-abertas veem o novo valor. Configurável por sessão por um superusuário via `PGOPTIONS`. |
| `backend` | Mesmo comportamento de "só conexões novas" de cima, mas qualquer usuário (não só superusuário) pode defini-lo por sessão via `PGOPTIONS`. |
| `superuser` | Alterável em runtime com `SET`, mas só por um superusuário (ou um papel ao qual o parâmetro foi concedido, veja abaixo). |
| `user` | Alterável em runtime com `SET` por qualquer usuário, para sua própria sessão. |

### Encontrando configurações restart-only antes que custem uma indisponibilidade

```sql
-- List every setting that requires a full postmaster restart
SELECT name, setting
  FROM pg_settings
 WHERE context = 'postmaster';

-- Narrow that to only the ones still sitting on their shipped default —
-- i.e. candidates worth reviewing before they're needed under pressure
SELECT name, setting, boot_val
  FROM pg_settings
 WHERE context = 'postmaster'
   AND boot_val = setting;

-- Translate every non-internal context into a plain-English action
SELECT name,
       CASE context
         WHEN 'postmaster'          THEN 'Restart'
         WHEN 'sighup'              THEN 'Reload'
         WHEN 'backend'             THEN 'Reload'
         WHEN 'superuser'           THEN 'Reload / Superuser SET'
         WHEN 'superuser-backend'   THEN 'Reload / Superuser Session'
         WHEN 'user'                THEN 'Reload / User SET'
       END AS when_changed
  FROM pg_settings
 WHERE context != 'internal'
 ORDER BY when_changed;
```

`shared_buffers`, `max_connections`, `wal_level` e `max_wal_senders` todos caem em `context = 'postmaster'`: precisamente as configurações que a receita anterior de ajuste inicial apontou como valendo a pena acertar antes de um servidor sequer receber tráfego de produção, porque um erro descoberto mais tarde custa um restart, não só uma edição.

### Valor atual vs. pendente, e comparando com segurança contra um padrão

Uma edição de arquivo de configuração que ainda não foi recarregada, ou uma configuração restart-only que foi editada mas não aplicada, não aparece como diferença até você checar isso explicitamente:

```sql
-- Has this setting been edited in the file but not yet applied?
SELECT name, setting, pending_restart
  FROM pg_settings
 WHERE pending_restart;

-- Every setting whose current value differs from its shipped default —
-- using IS DISTINCT FROM instead of <> / != because boot_val can be NULL
-- for some settings, and NULL <> NULL evaluates to NULL (excluding the row),
-- not TRUE
SELECT name, setting
  FROM pg_settings
 WHERE boot_val IS DISTINCT FROM setting;

-- short_desc / extra_desc as an inline reminder of *why* a setting exists,
-- without leaving the psql session to check the docs
SELECT name, setting, short_desc
  FROM pg_settings
 WHERE name = 'random_page_cost';
```

### Livro vs. hoje: uma coluna e um privilégio que o livro não tinha motivo para cobrir

- **`pending_restart` já existia no PostgreSQL 12** (adicionada na 9.5), então isso não é uma lacuna de versão, mas a comparação manual `boot_val = setting` da receita sob `context = 'postmaster'` só diz que uma configuração restart-only ainda está no padrão. Ela não diz se alguém já editou o arquivo e está esperando por um restart *agora mesmo*. `pending_restart` responde exatamente isso, e vale a pena adicionar a qualquer consulta de auditoria de restart que a abordagem da receita não produz sozinha.
- **O PostgreSQL 15 adicionou `GRANT SET ON PARAMETER` e `GRANT ALTER SYSTEM ON PARAMETER`**, apoiados pelo novo catálogo `pg_parameter_acl`. Antes da 15, uma configuração com `context = 'superuser'` significava literalmente "só um superusuário pode dar `SET` nisso": superusuário completo era a única forma de delegar. Desde a 15, um parâmetro específico pode ser concedido a um papel não superusuário (`GRANT SET ON PARAMETER track_activities TO app_owner;`), permitindo que um admin distribua exatamente uma configuração em vez do papel de superusuário inteiro. O significado da coluna `context` para configurações `superuser`/`superuser-backend` é, fora isso, inalterado em relação à descrição do livro; isso é aditivo, não uma redefinição.

## Trade-offs

- **A consulta de tradução baseada em `CASE` é uma conveniência, não uma fonte de verdade.** Ela reduz `context` a um rótulo em português claro, mas o valor bruto de `context` (e, para configurações restart-only, `pending_restart`) é o que de fato determina o comportamento; sempre reconfira a coluna bruta antes de assumir que uma configuração é segura de mudar ao vivo.
- **`IS DISTINCT FROM` é a ferramenta certa especificamente porque `boot_val` pode ser NULL para algumas configurações** (parâmetros sem um padrão fixo embutido na compilação): usar `<>` ali descarta linhas silenciosamente em vez de dar erro, o que é um modo de falha pior do que um resultado que parece errado.
- **Concessões por parâmetro (PostgreSQL 15+) reduzem, mas não eliminam, a necessidade de superusuário.** Só configurações que alguém concedeu explicitamente aparecem como delegáveis; a vasta maioria das configurações de contexto `superuser` ainda exige superusuário completo, a menos que um admin tenha passado deliberadamente pelo `pg_parameter_acl` para aquele nome específico.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 3, "Minimizing Downtime", recipe "Configuration – managing scary settings", p. 97-100] - doc
- [PostgreSQL Documentation: pg_settings](https://www.postgresql.org/docs/current/view-pg-settings.html) - doc
- [PostgreSQL Documentation: Setting Parameters (SIGHUP, ALTER SYSTEM, pg_reload_conf)](https://www.postgresql.org/docs/current/config-setting.html) - doc
- [PostgreSQL Documentation: GRANT (SET / ALTER SYSTEM ON PARAMETER)](https://www.postgresql.org/docs/current/sql-grant.html) - doc
- [PostgreSQL Documentation: pg_parameter_acl](https://www.postgresql.org/docs/current/catalog-pg-parameter-acl.html) - doc
