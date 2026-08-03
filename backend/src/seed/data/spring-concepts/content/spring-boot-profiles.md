---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

An application's configuration is rarely one-size-fits-all across environments —
development wants a fast, disposable embedded database and verbose logging;
production wants a real database and quiet logs. Spring profiles let both sets of
properties (and even entire beans) live in the same codebase, side by side,
switching between them based on which profile is active at runtime rather than
which properties happen to be present.

## Use Cases

- Using an embedded H2 database with `DEBUG`-level logging during development,
  while a deployed production instance uses an external MySQL database with
  `WARN`-level logging — without maintaining two separate builds.
- Loading seed/test data automatically on startup in development and QA, but
  never in production, from the same `CommandLineRunner` bean definition.
- Grouping several related profiles (a database profile, a message-queue
  profile) behind one name, so activating one flag turns on a whole
  environment's worth of configuration at once.

## Deep Dive

### The problem profiles solve: one config file, several environments

Setting configuration properties as plain environment variables works, but gets
unwieldy fast — more than one or two properties per environment turns into a lot
of manual `export` commands with no tracking or easy rollback:

```bash
% export SPRING_DATASOURCE_URL=jdbc:mysql://localhost/tacocloud
% export SPRING_DATASOURCE_USERNAME=tacouser
% export SPRING_DATASOURCE_PASSWORD=tacopassword
```

Profiles are conditional configuration: a set of beans, configuration classes,
and properties that only apply when a given profile name is active — letting the
same `application.yml` carry both a development-friendly default and a
production override, instead of choosing one or the other.

### Defining profile-specific properties: a dedicated file per profile

The most direct approach is a separate file per profile, named
`application-{profile name}.yml` (or `.properties`):

```yaml
# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://localhost/tacocloud
    username: tacouser
    password: tacopassword
logging:
  level:
    tacos: WARN
```

Only properties that differ from the default need to appear here — anything not
overridden in a profile-specific file falls back to whatever `application.yml`
itself already sets.

### Activating a profile: anywhere except application.yml's own default document

Defining profile properties does nothing until a profile is actually active.
Setting `spring.profiles.active` inside `application.yml`'s default section
technically works, but defeats the purpose — it becomes the permanent default
for every environment, not just one. The book recommends setting it outside the
properties file entirely: as an environment variable,

```bash
% export SPRING_PROFILES_ACTIVE=prod
```

or as a command-line argument when running an executable JAR:

```bash
% java -jar taco-cloud.jar --spring.profiles.active=prod
```

The property name's plural — `profiles`, not `profile` — reflects that more than
one can be active simultaneously, as a comma-separated list:

```bash
% export SPRING_PROFILES_ACTIVE=prod,audit,ha
```

### Conditionally creating beans: @Profile

Profiles aren't limited to property values — an entire `@Bean` method (or a
whole `@Configuration` class) can be restricted to specific profiles with
`@Profile`:

```java
@Bean
@Profile("dev")
public CommandLineRunner dataLoader(IngredientRepository repo,
      UserRepository userRepo, PasswordEncoder encoder) {
    // seeds the embedded database with development data
}
```

`@Profile` accepts a list (the bean is created if *any* listed profile is
active) and profile expressions with `!` to negate:

```java
@Bean
@Profile({"dev", "qa"})
public CommandLineRunner dataLoader(/* ... */) { /* ... */ }

@Bean
@Profile("!prod")
public CommandLineRunner dataLoader(/* ... */) { /* ... */ }
```

`@Profile("!prod")` reads as "create this bean unless `prod` is active" — a
common shape for anything (like seed data loading) that should run everywhere
except in production.

## Trade-offs

- **A separate `application-{profile}.yml` file per profile is the clearest
  approach, but scales into a lot of files.** For a handful of environments it
  keeps each profile's properties easy to scan in isolation; for many profiles,
  a single multi-document `application.yml` (see the book-vs-today note below)
  can be easier to review as one file, at the cost of more visual noise per
  document boundary.
- **Setting `spring.profiles.active` inside `application.yml`'s own default
  section quietly defeats the purpose of using profiles at all.** It becomes a
  fixed default baked into the deployed artifact rather than something the
  environment controls — the book is explicit that this is close to the worst
  way to activate a profile, precisely because it removes the environment's
  ability to choose.
  ```yaml
  # anti-pattern: bakes "prod" in as the default for every environment
  spring:
    profiles:
      active:
        - prod
  ```
- **`@Profile`'s negation (`!prod`) is easy to misread as "only when nothing is
  active" rather than "active unless this specific profile is."** With no
  profile active at all, a bean annotated `@Profile("!prod")` *is* created
  (since `prod` isn't active) — worth double-checking against the actual set of
  active profiles in a given environment rather than assuming from the
  annotation alone.
- **Book vs. today: the book's multi-document YAML syntax for declaring which
  section belongs to which profile no longer parses.** The book shows
  `spring.profiles: prod` under a `---`-separated document as the way to keep
  profile-specific properties inside the same `application.yml` instead of a
  separate file:
  ```yaml
  # book's syntax — no longer valid
  logging:
    level:
      tacos: DEBUG
  ---
  spring:
    profiles: prod
    datasource:
      url: jdbc:mysql://localhost/tacocloud
  ```
  Confirmed via the current Spring Boot reference: `spring.profiles` inside a
  document header has been replaced by `spring.config.activate.on-profile`,
  and the old syntax is explicitly called out as invalid in current
  documentation. The equivalent configuration today is:
  ```yaml
  logging:
    level:
      tacos: DEBUG
  ---
  spring:
    config:
      activate:
        on-profile: "prod"
  datasource:
    url: jdbc:mysql://localhost/tacocloud
  ```
  Separate `application-{profile}.yml` files (the book's other technique,
  described above) are unaffected — that mechanism is unchanged.
- **Book vs. today (new capability, not a correction): profile groups.** Since
  Spring Boot 2.4 (after this book published), `spring.profiles.group` lets one
  profile name expand into several at activation time — activating a single
  `production` profile can turn on `proddb` and `prodmq` together, instead of
  needing every individual profile name listed at the command line or in an
  environment variable:
  ```yaml
  spring:
    profiles:
      group:
        production:
          - "proddb"
          - "prodmq"
  ```
  ```bash
  # activates production, proddb, and prodmq all at once
  % java -jar app.jar --spring.profiles.active=production
  ```
  `@Profile`'s method-level and class-level behavior, and the `spring.profiles.active`
  activation mechanism itself, are otherwise unchanged since the book.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 5, "Working with configuration properties", section 5.3, p. 129-133 — doc
- [Spring Boot Reference — Profiles](https://docs.spring.io/spring-boot/reference/features/profiles.html) — doc
- [Spring Boot Reference — Externalized Configuration (Multi-Document Files, spring.config.activate.on-profile)](https://docs.spring.io/spring-boot/reference/features/external-config.html) — doc
- [Spring Framework API — @Profile](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/Profile.html) — doc
