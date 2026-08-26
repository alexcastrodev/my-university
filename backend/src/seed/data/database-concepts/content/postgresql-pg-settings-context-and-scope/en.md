---
version: 1.0
updatedAt: 2026-07-31
---
## Objective

`pg_settings` is the one view that answers a question every DBA eventually asks
under time pressure: "if I change this setting, what do I actually have to do to
make it take effect?" The `context` column encodes the answer per-setting — from
"impossible without recompiling" down to "any user, any session, right now" — so
instead of guessing or restarting defensively, a query against `pg_settings` gives
a definitive answer before touching `postgresql.conf`.

## Use Cases

- Before editing `postgresql.conf`, checking whether a setting change is a
  zero-downtime reload or a restart that needs to be scheduled — the difference
  between `wal_level` (restart) and `log_min_duration_statement` (reload) is not
  guessable from the setting's name alone.
- Auditing a server for every setting that was changed from its shipped default,
  to reconstruct why a database behaves the way it does when the person who tuned
  it is no longer around.
- Regenerating a compromised SSL certificate and discovering that PostgreSQL has no
  in-place "reread this file" option for it — `ssl_cert_file` is `context =
  'postmaster'`, so replacing the certificate content isn't enough; the server has
  to restart to pick it up.
- Deciding whether a permission problem can be solved by granting a specific
  parameter to a role, instead of handing out full superuser just so an
  application owner can flip one setting.

## Deep Dive

### `pg_settings.context`: what each value actually permits

In order of "harder to change" to "easier to change":

| `context` value | How it's changed |
|---|---|
| `internal` | Not changeable at all — set by `initdb` or compiled in. |
| `postmaster` | Only at server start; needs a full restart. |
| `sighup` | Edit `postgresql.conf`, then reload (SIGHUP / `pg_reload_conf()`) — no restart. |
| `superuser-backend` | Reloadable in the file, but a session already connected won't pick it up — only newly-launched connections see the new value. Settable per-session by a superuser via `PGOPTIONS`. |
| `backend` | Same "new connections only" behavior as above, but any user (not just superuser) can set it per-session via `PGOPTIONS`. |
| `superuser` | Changeable at runtime with `SET`, but only by a superuser (or a role granted the parameter, see below). |
| `user` | Changeable at runtime with `SET` by any user, for their own session. |

### Finding restart-only settings before they cost an outage

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

`shared_buffers`, `max_connections`, `wal_level`, and `max_wal_senders` all land in
`context = 'postmaster'` — precisely the settings the earlier initial-tuning recipe
flagged as worth getting right before a server ever takes production traffic,
because a mistake found later costs a restart, not just an edit.

### Current vs. pending value, and comparing safely against a default

A config-file edit that hasn't been reloaded yet, or a restart-only setting that's
been edited but not applied, doesn't show up as a difference until you check for
it explicitly:

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

### Book vs today: a column and a privilege the book didn't have reason to cover

- **`pending_restart` already existed in PostgreSQL 12** (added in 9.5), so this
  isn't a version gap — but the recipe's manual `boot_val = setting` comparison
  under `context = 'postmaster'` only tells you a restart-only setting is still on
  its default. It doesn't tell you whether someone already edited the file and is
  waiting on a restart *right now*. `pending_restart` answers exactly that, and is
  worth adding to any restart-audit query the recipe's approach doesn't produce on
  its own.
- **PostgreSQL 15 added `GRANT SET ON PARAMETER` and `GRANT ALTER SYSTEM ON
  PARAMETER`**, backed by the new `pg_parameter_acl` catalog. Before 15, a setting
  with `context = 'superuser'` meant literally "only a superuser can `SET` this" —
  full superuser was the only way to delegate it. Since 15, a specific parameter
  can be granted to a non-superuser role (`GRANT SET ON PARAMETER
  track_activities TO app_owner;`), letting an admin hand out exactly one setting
  instead of the whole superuser role. The `context` column's meaning for
  `superuser`/`superuser-backend` settings is otherwise unchanged from the book's
  description — this is additive, not a redefinition.

## Trade-offs

- **The `CASE`-based translation query is a convenience, not a source of truth.**
  It collapses `context` into a human label, but the underlying `context` value
  (and, for restart-only settings, `pending_restart`) is what actually determines
  behavior — always re-check the raw column before assuming a setting is safe to
  change live.
- **`IS DISTINCT FROM` is the right tool specifically because `boot_val` can be
  NULL for some settings** (parameters with no fixed compiled-in default) — using
  `<>` there silently drops rows instead of erroring, which is a worse failure mode
  than a wrong-looking result.
- **Per-parameter grants (PostgreSQL 15+) reduce, but don't eliminate, the need
  for superuser.** Only settings someone has explicitly granted show up as
  delegable; the vast majority of `superuser`-context settings still require full
  superuser unless an admin has gone through `pg_parameter_acl` deliberately for
  that specific name.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Configuration – managing scary settings", p. 97-100 — doc
- [PostgreSQL Documentation — pg_settings](https://www.postgresql.org/docs/current/view-pg-settings.html) — doc
- [PostgreSQL Documentation — Setting Parameters (SIGHUP, ALTER SYSTEM, pg_reload_conf)](https://www.postgresql.org/docs/current/config-setting.html) — doc
- [PostgreSQL Documentation — GRANT (SET / ALTER SYSTEM ON PARAMETER)](https://www.postgresql.org/docs/current/sql-grant.html) — doc
- [PostgreSQL Documentation — pg_parameter_acl](https://www.postgresql.org/docs/current/catalog-pg-parameter-acl.html) — doc
