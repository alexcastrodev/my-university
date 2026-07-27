---
version: 1.0
updatedAt: 2026-07-27
---
## Objective

Understand how Spring Boot removes almost all explicit wiring from a Spring application: a single `@SpringBootApplication`-annotated class, plus a handful of *starter* dependencies on the classpath, is enough for Spring Boot to guess which beans the app needs and configure them automatically — a technique called *autoconfiguration*.

## Use Cases

- Bootstrapping a new web application without writing a `DispatcherServlet`, embedded server, or `ObjectMapper` configuration by hand — adding `spring-boot-starter-web` is enough.
- Letting the presence of a driver JAR (e.g., a JDBC driver) on the classpath decide whether a `DataSource` bean gets created, instead of wiring it manually in every project.
- Overriding one autoconfigured piece (a custom `PasswordEncoder`, a custom `ObjectMapper`) while leaving everything else on the default path — autoconfiguration backs off when you supply your own bean.
- Reasoning about a dependency in terms of the *capability* it adds (web, security, data JPA) rather than memorizing which individual libraries and versions must be declared together.

## Deep Dive

### `@SpringBootApplication` is three annotations in one

The bootstrap class needs almost no code — its power comes from a single composite annotation:

```java
package tacos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TacoCloudApplication {

  public static void main(String[] args) {
    SpringApplication.run(TacoCloudApplication.class, args);
  }
}
```

`@SpringBootApplication` combines:

- `@SpringBootConfiguration` — a specialized `@Configuration`, marking the class as a source of bean definitions.
- `@EnableAutoConfiguration` — tells Spring Boot to automatically configure beans it thinks the app needs, based on the classpath and existing bean definitions.
- `@ComponentScan` — discovers `@Component`, `@Controller`, `@Service`, etc. in the package (and sub-packages) of the annotated class.

`SpringApplication.run()` is what actually bootstraps the application context, passing the configuration class and the command-line arguments.

### Starter dependencies bundle capabilities, not just libraries

A starter (`spring-boot-starter-web`, `spring-boot-starter-data-jpa`, …) is a dependency descriptor with no library code of its own — it transitively pulls in everything needed for that capability, at versions the parent `spring-boot-starter-parent` POM has already validated together:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Adding this one dependency brings in Spring MVC, an embedded servlet container, and Jackson — without pinning a single version number in the build file. The `<parent>` element (`spring-boot-starter-parent`) is what supplies that version management; the child POM only chooses *which* starters to include.

### Autoconfiguration only acts when nothing else already did the job

Autoconfiguration classes are ordinary `@Configuration` classes, but every `@Bean` method inside them is guarded by conditional annotations — most commonly `@ConditionalOnClass` (a class must be on the classpath) and `@ConditionalOnMissingBean` (no bean of that type has been defined yet):

```java
@Configuration
@ConditionalOnClass(DataSource.class)
class DataSourceAutoConfiguration {

  @Bean
  @ConditionalOnMissingBean
  DataSource dataSource(DataSourceProperties properties) {
    return properties.initializeDataSourceBuilder().build();
  }
}
```

This is why defining your own `@Bean` of a given type is enough to opt out of the corresponding autoconfiguration — Spring Boot backs off instead of producing a duplicate or conflicting bean.

### Component scanning finds what autoconfiguration doesn't provide

Autoconfiguration handles infrastructure beans (a `DataSource`, a `PasswordEncoder`); it does not know about application-specific classes. `@ComponentScan` (bundled inside `@SpringBootApplication`) is what discovers a hand-written controller:

```java
package tacos;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class HomeController {

  @GetMapping("/")
  public String home() {
    return "home";
  }
}
```

Because `HomeController` sits in the same package as the `@SpringBootApplication` class (or a sub-package), component scanning picks it up automatically — no explicit bean registration required.

### Book vs. today

The book (5th edition, 2019) targets Spring Boot 2.0.4 and Java 8 — the Initializr screenshots show a `1.8` Java version dropdown and `javax.*` imports. Current Spring Boot (3.x) requires Java 17+ as a baseline, moved to the `jakarta.*` namespace (Jakarta EE 9+), and the Initializr's dependency list has grown accordingly (native image / GraalVM support, `spring-boot-docker-compose`, and so on). The *mechanism* described here — `@SpringBootApplication`, starters, `@ConditionalOnClass`/`@ConditionalOnMissingBean` — is unchanged; only the concrete package names and minimum Java version have moved on.

## Trade-offs

- **Convention over visibility** — autoconfiguration eliminates boilerplate, but "why is this bean here?" is genuinely harder to answer than with explicit `@Bean` methods; you have to know the conditional rules to predict the outcome for a given classpath.
- **`@ConditionalOnMissingBean` is the escape hatch** — defining your own bean of the same type is enough to override an autoconfigured one, so the framework is fully overridable, one bean at a time:

```java
@Bean
DataSource dataSource() {
  return new HikariDataSource(myCustomConfig); // autoconfigured DataSource backs off
}
```

- **JAR-first packaging is a deliberate cloud-era choice** — Spring Initializr defaults new projects to executable JAR packaging (embedded server) instead of WAR, which suits container/cloud deployment but is a mental shift for anyone used to deploying WARs to a standalone app server.

## Documentation Links

- [Spring in Action, 5th Edition (Manning, 2019) — Chapter 1: "Getting started with Spring", p. 3-18](https://www.manning.com/books/spring-in-action-fifth-edition) — doc
- [Spring Boot Reference — Using Spring Boot](https://docs.spring.io/spring-boot/reference/using/index.html) — doc
- [Spring Boot Reference — Auto-configuration](https://docs.spring.io/spring-boot/reference/using/auto-configuration.html) — doc
- [Spring Initializr](https://start.spring.io) — doc
