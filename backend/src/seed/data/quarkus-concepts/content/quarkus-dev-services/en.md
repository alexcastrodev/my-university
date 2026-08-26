---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Dev Services is Quarkus's answer to "I added a database dependency, now I have to go install and configure a database before I can even run the app." When an extension like `quarkus-datasource-postgresql` is on the classpath and no connection URL is configured, Quarkus automatically launches a matching Testcontainers container, wires the datasource to it, and tears it down when the app stops — with zero test or dev-mode boilerplate.

## Use Cases

- Running `quarkus:dev` on a fresh checkout with no local Postgres/Kafka/Redis install — the container just appears.
- Integration tests that need a real database (not H2, not mocks) without a Testcontainers `@Container` field and lifecycle management in every test class.
- Bootstrapping a database with schema extensions (like PostGIS) or seed data before Hibernate or Flyway ever touches it, via an init script that runs with elevated privileges.
- Sharing one container across several services in a multi-module dev session instead of each spinning up its own.

## Deep Dive

### The activation rule

Dev Services activates when an extension is present **and** the corresponding external connection property is absent:

```properties
# no quarkus.datasource.jdbc.url set -> Dev Services starts a Postgres container automatically
```

The moment you set `quarkus.datasource.jdbc.url` (or the `%prod` profile is active), Dev Services steps aside and your explicit config takes over — the same `application.properties` works unchanged from a laptop through to a real production datasource.

### Choosing the container image

```properties
quarkus.datasource.devservices.image-name=docker.io/library/postgres:18
quarkus.datasource.devservices.port=5432
```

Without `port` set, Quarkus picks a random free host port so multiple dev sessions don't collide.

### Init scripts, including privileged ones

A classpath SQL script can run against the freshly-started container before the app connects — the privileged variant runs with an elevated account, which matters for statements like `CREATE EXTENSION` that a normal application user can't run:

```properties
quarkus.datasource.devservices.init-script-path=db/init.sql
quarkus.datasource.devservices.init-privileged-script-path=db/setup-extensions.sql
```

```sql
-- db/setup-extensions.sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

This is exactly how a Postgres Dev Services container becomes a working PostGIS container with no manual `docker run` step — the privileged script installs the extension the moment the container is up, before Hibernate creates the schema.

### Turning it off, or reusing across restarts

```properties
# global kill switch
quarkus.devservices.enabled=false

# per-service kill switch
quarkus.datasource.devservices.enabled=false
```

By default a container is torn down when the dev session or test run ends. Opting into reuse keeps it running across restarts (faster iteration, at the cost of state carrying over between runs):

```properties
quarkus.datasource.devservices.reuse=true
```

```properties
# ~/.testcontainers.properties
testcontainers.reuse.enable=true
```

### Sharing one container across services

```properties
quarkus.kafka.devservices.shared=true
quarkus.kafka.devservices.service-name=kafka
```

With `shared=true`, Quarkus looks for a running container labeled `quarkus-dev-service-kafka` with a matching service name before starting a new one — useful when several microservices in the same dev environment all want "a Kafka," not one each.

## Trade-offs

- **Zero production footprint, by design** — Dev Services logic lives entirely in Quarkus's build-time `deployment` modules; it does not ship in the production artifact, so there's no risk of a stray container-launching code path reaching prod.
- **A default 60-second startup timeout can bite on a slow machine or a large image** — a container that takes longer to pull or initialize fails the whole app startup unless you raise it explicitly:
```properties
quarkus.devservices.timeout=120
```
- **Reuse trades reproducibility for speed** — with `reuse=true`, a test run can inherit state (rows, schema drift) left over from a previous run, since "Quarkus will not reset the state of the database between runs unless you explicitly configure it to." Fine for fast local iteration, risky for CI where a clean slate matters.
- **It's a development/test convenience, not a deployment tool** — the container it starts is genuinely ephemeral infrastructure; nothing about Dev Services helps you run Postgres in production, and reaching for it there is a category error.

## Documentation Links

- [Dev Services guide — Quarkus](https://quarkus.io/guides/dev-services) — doc
