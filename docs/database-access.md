# The database: who can log in, and as what

The Postgres of production (stack `university-db`, `.ci/stack-db.yml`) is on `proxy_net`, the network every
other stack of the host shares. Anything that can run code in one of those containers can open a connection to it, so
who may log in is decided by Postgres, not by the network.

## The model

| Role | What it is | Where it can log in |
| --- | --- | --- |
| `postgres` | The superuser | Only through the local socket inside the container (`docker exec`). It has no line for the network. |
| `university_app` | The role of the api. It owns the database `ocp_java` and everything in it, and it has no superuser, create database, create role or replication rights. | The network `10.0.1.0/24`, database `ocp_java` only, with `scram-sha-256`. |

The line in `pg_hba.conf` (`/mnt/ssd/@docker/university/db/18/docker/pg_hba.conf`, in the data directory, so it survives a
recreated container):

```
host ocp_java university_app 10.0.1.0/24 scram-sha-256
```

Secrets, in the host `.env` (`/mnt/ssd/@docker/university/.env`):

- `UNIVERSITY_DB_PASSWORD`: the password of `university_app`. `.ci/stack.yml` builds the api's `DATABASE_URL` from it and
  the deploy stops before changing anything if it is missing.
- `UNIVERSITY_DB_ADMIN_PASSWORD`: the superuser's password, read by the image only when the data directory is empty.

## Why

Before this, `pg_hba.conf` trusted the whole network (`host all all 10.0.1.0/24 trust`) and the api logged in as the
superuser, with no password. A container on `proxy_net` could connect as `postgres` and run
`COPY (select 1) TO PROGRAM 'id'`, which executes a command as the operating system user of the database container.
That was reproduced with the production image before the change. With the model above the same container is refused
(no password, wrong password, or the superuser), and the app role, even with its password, cannot use `COPY ... PROGRAM`,
`ALTER SYSTEM`, `pg_read_file`, `CREATE ROLE` or an extension that needs a superuser.

## Rebuilding from an empty data directory

The image creates the superuser from `UNIVERSITY_DB_ADMIN_PASSWORD` and adds a `scram-sha-256` line for every address.
Then, with the data restored or empty:

```
docker exec -i <db container> psql -U postgres -d ocp_java -v app_password="$UNIVERSITY_DB_PASSWORD" < .ci/db/harden.sql
```

and replace the generic `host all all all scram-sha-256` line with the one above, then `select pg_reload_conf()`.
`harden.sql` is safe on a database that already has tables: it creates the role, makes it the owner of the database,
of every table, view, sequence and function of `public`, and nothing else changes.

## Rotating the password

1. `ALTER ROLE university_app PASSWORD '<new>'` (connections already open keep working).
2. Put the same value in the host `.env`.
3. Roll the api (`./deploy.sh`). New connections of the old tasks fail between steps 1 and 3, so do it in a quiet moment.

## Undoing it

`.ci/db/unharden.sql` gives everything back to `postgres` and drops the role. Then put the old line back in
`pg_hba.conf` (`host all all 10.0.1.0/24 trust`), run `select pg_reload_conf()`, and set the api's `DATABASE_URL` back to
`postgres://postgres@university-db_postgres:5432/ocp_java`.

## Looking at the database by hand

Inside the host, `docker exec -it <db container> psql -U postgres -d ocp_java`. From a tool on `proxy_net` (pgAdmin),
connect as `university_app` to the database `ocp_java` and set `ocp_java` as the maintenance database: the network line
allows nothing else.

## Checked

On a copy of the production schema (same image digest, same `pg_hba.conf` shape): the exposure above, the refusals, the
app role's DDL on its own tables, and `harden.sql`, `unharden.sql` and `harden.sql` again with every owner as expected (and
`lock_timeout` aborting the whole transaction when a table is busy).

The rollout was rehearsed on a populated database: api as `postgres` over trust, the whole suite, then `harden.sql` and the new
`pg_hba.conf` line with the api running, the api recreated as `university_app`, the suite again. The api stayed healthy and
nothing printed a permission error. The suite has failures of its own in that lab (about 35, mostly the papers seed and catalog
and the ordering of concept ids), the same with the superuser on a fresh database. Two search tests of `papers-catalog.spec.ts`
fail in some runs and not in others under both roles (the Meilisearch index is still building), and the discussions specs fail
on a second run over the same database because their block indexes restart at 1; both pass on a fresh state.

In production the same steps ran with a health probe every half second (191 probes, none failed). Trust never checks a password,
so after the new line the api sessions were ended to force the pool to log in again with `university_app`, and it did.
