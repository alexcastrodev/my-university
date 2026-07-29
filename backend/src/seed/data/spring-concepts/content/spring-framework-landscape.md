---
version: 1.0
updatedAt: 2026-07-29
---
## Objective

Understand how the pieces of the Spring ecosystem fit together around one core: the core Spring Framework provides dependency injection and Spring MVC; Spring Boot layers starters, autoconfiguration, and the Actuator on top; and a family of specialized projects (Spring Data, Spring Security, Spring Batch/Integration, Spring Cloud) each address one cross-cutting concern using the same underlying container.

## Use Cases

- Deciding which starter to add for a new capability (persistence, security, messaging) by recognizing which named Spring project owns that concern, instead of hunting for individual libraries.
- Reading an unfamiliar Spring codebase and placing an unfamiliar annotation or bean in context — is this core DI, a Spring Boot autoconfiguration concern, or a Spring Data/Security/Batch abstraction?
- Explaining to a teammate why "Spring" and "Spring Boot" aren't the same thing, and why almost every modern Spring project is written in Boot-centric terms even though the core framework doesn't require it.
- Scoping a project's dependencies deliberately — pulling in only the starters a service actually needs (web, security, batch) rather than treating "Spring" as a monolithic dependency.

## Deep Dive

### The core Spring Framework: DI container plus Spring MVC

Everything else in the ecosystem is built on top of the core container and its dependency injection model. The core framework also ships Spring MVC (the web framework used to handle requests) and basic JDBC support via `JdbcTemplate`:

```java
@Controller
public class HomeController {

  @GetMapping("/")
  public String home() {
    return "home";
  }
}
```

As of Spring 5.0, the core framework also introduced a second, non-blocking web framework, Spring WebFlux, built on Reactive Streams and sitting alongside Spring MVC rather than replacing it — the choice between them is made per-application, not forced by the framework.

### Spring Boot: starters, autoconfiguration, and the Actuator

Spring Boot is not a replacement for the core framework — it is an opinionated layer that removes the manual wiring the core framework would otherwise require (see the `spring-boot-autoconfiguration` concept for the mechanics). Beyond starters and autoconfiguration, Boot adds the **Actuator**, a set of production-ready endpoints exposing metrics, health checks, thread dumps, and environment properties without any code beyond a starter dependency:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

```
curl http://localhost:8080/actuator/health
# {"status":"UP"}
```

Boot has become central enough to the ecosystem that most Spring documentation and tutorials — including this one — describe things in Boot-centric terms, even for behavior that technically belongs to the core framework.

### Spring Data: repositories as interfaces, independent of the database kind

Spring Data lets a data-access layer be defined as a plain Java interface, with query behavior derived from method naming conventions rather than hand-written implementation code:

```java
public interface IngredientRepository extends CrudRepository<Ingredient, String> {
  List<Ingredient> findByType(Ingredient.Type type);
}
```

The same programming model spans relational databases (Spring Data JPA), document stores (MongoDB), and graph databases (Neo4j) — swapping the underlying store is largely a matter of swapping the Spring Data module, not rewriting the repository contract.

### Spring Security, Spring Batch/Integration, and Spring Cloud each own one cross-cutting concern

Three further projects address concerns that apply across most non-trivial applications, each with its own concept already covered in this app:

- **Spring Security** — authentication and authorization (see `spring-security-authentication-architecture`).
- **Spring Batch** — bulk, chunk-oriented data processing triggered on a schedule or on demand (see `spring-batch-chunk-processing`), as distinct from **Spring Integration**, which handles real-time, message-driven integration between systems.
- **Spring Cloud** — a collection of projects addressing microservice concerns (service discovery, configuration, resilience) that don't exist in a single-deployment-unit application.

The distinction between Spring Batch and Spring Integration is about *when* data is processed: Batch waits for data to accumulate and processes it in bulk on a trigger, while Integration reacts to each unit of data as it arrives.

### Book vs. today: the landscape has grown, the shape hasn't

The book (5th edition, 2019) targets Spring 5.0/Spring Boot 2.0, Java 8, and the `javax.*` namespace. Since then:

- Spring Boot 3.x raised the baseline to **Java 17** and completed the move from Java EE's `javax.*` packages to Jakarta EE's `jakarta.*` packages (a mechanical but breaking rename across the entire ecosystem, including Spring Security and Spring Data).
- Spring Boot 3 added first-class support for **GraalVM native image** compilation via ahead-of-time (AOT) processing, and replaced the older Actuator-only metrics model with **Micrometer Observation** (metrics + distributed tracing under one abstraction) — neither existed in the 2019 edition.
- Spring Cloud remains the standard toolkit for microservice concerns on Spring, though which sub-projects are considered current has shifted: Netflix OSS components (Hystrix, Ribbon) referenced in older material are now in maintenance mode, superseded by Resilience4j and Spring Cloud LoadBalancer.
- The ecosystem has grown a new member entirely: **Spring AI**, addressing integration with LLMs and vector stores — a category of concern that didn't exist when the book's landscape chapter was written.

The *shape* of the landscape described by the book — one core, one opinionated bootstrap layer, and specialized projects for data/security/batch/cloud concerns — is unchanged; the concrete versions, namespaces, and which sub-projects are considered current have moved on, as expected for any inventory of a live ecosystem.

## Trade-offs

- **Learning "Spring" really means learning several projects, incrementally** — the core framework, Boot, and each specialized project are separately versioned and separately documented; there is no single reference that covers all of it, and most real applications only need a subset.
- **Boot-centric thinking obscures what's optional** — because almost all tutorials assume Spring Boot, it's easy to lose track of which behavior comes from the core framework (portable to any Spring setup) versus Boot's autoconfiguration (Boot-specific).
- **Picking the wrong project for a data-processing need has real cost** — choosing Spring Batch for what is actually a real-time integration problem (or vice versa) means fighting the chosen framework's execution model instead of using it; the distinction in this Deep Dive is the deciding question to ask first.

## Documentation Links

- [Spring in Action, 5th Edition (Manning, 2019) — Chapter 1, "Getting started with Spring", Section 1.4 "Surveying the Spring landscape", p. 26-28](https://www.manning.com/books/spring-in-action-fifth-edition) — doc
- [Spring — Projects overview](https://spring.io/projects) — doc
- [Spring Boot Reference — System Requirements (Java 17 baseline)](https://docs.spring.io/spring-boot/system-requirements.html) — doc
- [Spring Boot Reference — Actuator](https://docs.spring.io/spring-boot/reference/actuator/index.html) — doc
- [Spring Framework Reference — Web on Reactive Stack (WebFlux)](https://docs.spring.io/spring-framework/reference/web-reactive.html) — doc
- [Preparing for Spring Boot 3.0 (Jakarta EE, GraalVM native, observability)](https://spring.io/blog/2022/05/24/preparing-for-spring-boot-3-0/) — doc
