---
version: 1.0
updatedAt: 2026-09-30
---
## Objective

Most Spring Boot applications start as a monolith with good intentions: packages per feature, `publishing` here, `notification` there. Six months later `notification` autowires `publishing`'s repository to run a query, `publishing` calls `notification` directly, and every change ripples across packages. The packages were organization for humans; nothing enforced them. At the other end of the spectrum, splitting into microservices buys hard boundaries at the price of a distributed system: network failures, deployment topology, distributed tracing, eventual consistency.

A **modular monolith** sits in between: one deployable, with internal boundaries that are as real as service boundaries but cost nothing at run time. Spring Modulith (by Oliver Drotbohm, current line 2.x for Spring Boot 4) is a structural toolkit for that, not a runtime framework. It derives **application modules** from your package structure, verifies in a test that modules do not form cycles or reach into each other's internals, tests one module at a time, and documents the result. This concept covers the module model and verification; events between modules and the Event Publication Registry are in `spring-modulith-events-and-publication-registry`, module tests and documentation in `spring-modulith-testing-and-documentation`.

## Use Cases

- **Keeping a growing monolith from becoming a big ball of mud.** A verification test in CI fails the build the moment one module imports another module's internal type or creates a cycle.
- **Migrating a package-by-feature codebase gradually.** Start with just the verification test (it detects cycles with zero configuration), then move internals into subpackages one module at a time. Legacy modules can be marked `OPEN` until they are cleaned up.
- **Preparing, not forcing, a microservice extraction.** A module that only talks to others through events and a narrow API is the candidate you can later extract without rewriting callers.
- **Parallel work without merge conflicts.** Two developers, two modules, clear contracts between them.
- **Making architecture reviewable.** `@ApplicationModule(allowedDependencies = ...)` in `package-info.java` turns "notification may use publishing" into a line of code that shows up in code review when someone changes it.

## Deep Dive

### Coupling and cohesion, drawn as packages

The goal is the old one: **high cohesion** (everything inside a module belongs together and serves one purpose) and **low coupling** (modules know little about each other and talk through a narrow contract). Cohesion is what belongs *inside* a boundary; coupling is what *crosses* it. In a big ball of mud, cohesion is low and coupling is high, so every change is risky. With well drawn boundaries, a fix lives in one place, you reason about one module at a time, and a module can be tested with few dependencies.

### Setup

Spring Modulith is not managed by the Spring Boot BOM; import its own BOM (2.1.x targets Boot 4.1, 2.0.x targets Boot 4.0):

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.modulith</groupId>
      <artifactId>spring-modulith-bom</artifactId>
      <version>2.1.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>org.springframework.modulith</groupId>
    <artifactId>spring-modulith-starter-core</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.modulith</groupId>
    <artifactId>spring-modulith-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

start.spring.io offers it as the "Spring Modulith" dependency and adds the BOM for you.

### A module is a package

The rule is deliberately simple: **every direct subpackage of the `@SpringBootApplication` package is an application module.**

```
com.kurz.contentmod                      <- main package
├── ContentModApplication.java
├── publishing                           <- module "publishing"
│   ├── Content.java                     <- API (public, base package)
│   ├── ContentCatalog.java              <- API
│   ├── ContentPublished.java            <- API (an event)
│   ├── PublishingService.java           <- API
│   └── internal
│       └── ContentRepository.java       <- internal, even though it is public
└── notification                         <- module "notification"
    ├── NotificationService.java
    ├── DigestService.java
    └── SubscriberRepository.java        <- package-private
```

Public types in a module's **base package** are its API. Types in any **subpackage** are internal to the module, whatever their Java visibility. The subpackage name is a convention: `internal`, `persistence`, `web`, all behave the same. Other modules may use the API; touching an internal type is a violation.

This is stronger than Java can express on its own. Package-private is the first fence and it is enforced by the compiler: once `SubscriberRepository` loses its `public` keyword, nothing outside `notification` can even import it, and Spring still finds it through component scanning. But package-private stops working as soon as a module has more than one package: `PublishingService` in `publishing` needs `ContentRepository` in `publishing.internal`, so the repository must be public, and then every other package in the application can import it too. Spring Modulith's "subpackage = internal" rule is what closes that gap.

A note on terminology: these are *logical* modules inside one classpath, not JPMS modules (`module-info.java`, see `java-platform-module-system` in Java Concepts). JPMS enforces at compile and run time but needs a separate module (usually a separate build artifact) per boundary; Spring Modulith keeps a single artifact and enforces with a test.

### Verifying the structure

```java
class ModularityTest {

    static final ApplicationModules modules = ApplicationModules.of(ContentModApplication.class);

    @Test
    void verifiesModularStructure() {
        modules.verify();
    }
}
```

`ApplicationModules.of(...)` analyzes the bytecode with ArchUnit; it does not start Spring, so the test runs in well under a second. `verify()` throws a `Violations` exception listing every problem. It checks:

- **Cycles** between modules.
- **Access to internal types** of another module.
- **Allowed dependencies**, when a module declares them.
- **Named interface** access, when a module exposes named interfaces.

Run against the "package by feature" starting point, where `PublishingService` calls `NotificationService` and `NotificationService.notifySubscribers(Content)` takes a `publishing` type, the first run reports the cycle before you have drawn a single boundary:

```
- Cycle detected: Slice notification ->
                Slice publishing ->
```

followed by every field, constructor parameter and method call that creates each edge. After moving `ContentRepository` into `publishing.internal` while `notification.DigestService` still injects it, the import still **compiles** (the class is public), and verification adds:

```
- Module 'notification' depends on non-exposed type
  com.kurz.contentmod.publishing.internal.ContentRepository within module 'publishing'!
```

That is the point of running it as a test: the compiler accepts the code, the architecture does not. IntelliJ IDEA's Spring Modulith support shows the same information in the editor (module icons in the project view, and an inspection on the offending import).

`ApplicationModules` is also a model you can query:

```java
var publishing = modules.getModuleByName("publishing").orElseThrow();

publishing.getDirectDependencies(modules).containsModuleNamed("notification"); // false once the cycle is gone
publishing.isExposed(publishing.getType("ContentRepository").orElseThrow());   // false: internal
modules.forEach(System.out::println);                                           // human-readable description
```

### Fixing the two violations

**Access to internals:** give the other module an API instead. `DigestService` does not need the repository, it needs "recent titles":

```java
// publishing/ContentCatalog.java (base package: API)
@Service
public class ContentCatalog {
    private final ContentRepository repository;       // internal, used only here
    public List<String> recentTitles(int limit) { ... }
}
```

**Cycles:** flip one of the two arrows with an event. `publishing` announces what happened and no longer knows who reacts:

```java
public Content publish(String title) {
    var content = repository.save(title);
    events.publishEvent(new ContentPublished(content));   // was: notifications.notifySubscribers(content)
    return content;
}

// notification/NotificationService.java
@EventListener   // or @ApplicationModuleListener, see the next concept
void on(ContentPublished event) { ... }
```

`notification` still depends on `publishing` (it listens to a `publishing` type), and that is fine: one direction, no cycle. A new consumer (analytics, search, webhooks) is a new listener, with no change to `publishing`.

### Declaring allowed dependencies

By default a module may depend on the API of any other module, as long as no cycle forms. To make the intended graph explicit, annotate the module's package:

```java
// notification/package-info.java
@org.springframework.modulith.ApplicationModule(
    displayName = "Notifications",
    allowedDependencies = "publishing"
)
package com.kurz.contentmod.notification;
```

Now a new dependency from `notification` on, say, `billing` fails `verify()` until someone edits this line. The syntax:

| Value | Allows |
|---|---|
| `"publishing"` | the API (base package) of `publishing` |
| `"publishing :: events"` | only the named interface `events` of `publishing` |
| `"publishing :: *"` | all named interfaces of `publishing` |
| `{}` (empty) | no dependency on other modules at all |

### Named interfaces

Sometimes a module wants to expose more than its base package, or expose different things to different consumers. A subpackage becomes a **named interface** with `@NamedInterface`:

```java
// publishing/events/package-info.java
@org.springframework.modulith.NamedInterface("events")
package com.kurz.contentmod.publishing.events;
```

Other modules may now use types in `publishing.events`, and a consumer can restrict itself to exactly that port with `allowedDependencies = "publishing :: events"`. The base package remains the module's unnamed default interface. `@NamedInterface` can also be put on individual types.

### Open modules, shared modules, other detection strategies

- **`type = ApplicationModule.Type.OPEN`** turns off the internal-type check for that module (its subpackages are accessible) while keeping it in the model and in cycle detection. It is meant for legacy code being migrated: declare the module first, close it later.
- **`@Modulithic(sharedModules = "shared")`** on the application class marks modules that every module test bootstraps (common infrastructure). Keep them small.
- **`spring.modulith.detection-strategy=explicitly-annotated`** switches from "every direct subpackage" to "only packages annotated with `@ApplicationModule`" (or jMolecules `@Module`), useful when the package layout cannot follow the default. Nested modules (an `@ApplicationModule` package inside another module) have been supported since 1.3.
- **`spring.modulith.runtime.verification-enabled=true`** runs the verification at application startup as well (off by default; the test is the usual place).

### What else Spring Modulith offers

Beyond the module model: `@ApplicationModuleListener` and the **Event Publication Registry** for durable events between modules, **event externalization** to Kafka, AMQP or JMS, `@ApplicationModuleTest` for **module integration tests**, `Documenter` for **PlantUML/C4 diagrams and module canvases**, **observability** (module-scoped traces and an actuator endpoint), and **Moments**, a passage-of-time event API (`DayHasPassed`, `MonthHasPassed`, ...) for billing cycles and cleanup jobs. The sibling concepts cover events and testing.

## Trade-offs

- **Boundaries without the distributed-systems tax, and without its hard guarantees.** A module boundary is enforced by a test, not by a network. Anyone can still call a public method across modules at run time if verification is skipped, and all modules share one JVM, one database, one deployment. A memory leak in one module takes the whole application down. That is the deal: most of the design benefit of services, none of the operational isolation.
- **Verification only protects you if it runs.** The check lives in a test class. If it is not in CI, or someone marks it `@Disabled` "just for this release", the boundaries silently erode again:
  ```java
  @Test void verifiesModularStructure() { ApplicationModules.of(Application.class).verify(); }
  ```
  One line, but it has to be in the build that blocks merges.
- **"Direct subpackage = module" is opinionated.** It works beautifully for package-by-feature code and poorly for package-by-layer (`controller`, `service`, `repository` become three "modules" that all depend on each other). Adopting Spring Modulith on a layered codebase means restructuring first, or using `explicitly-annotated` detection.
- **Internal is public to Java.** Moving a type into `internal` does not stop another module from importing it; only the verification test does. IDE auto-import will happily suggest `publishing.internal.ContentRepository` to a developer in `notification`. Package-private remains the stronger tool where it is enough (single-package modules).
- **Breaking cycles with events changes the failure model.** Replacing a direct call with an event removes the cycle, but `publish()` no longer knows whether notification succeeded. With a synchronous `@EventListener` nothing changes at run time; with `@ApplicationModuleListener` it becomes asynchronous and eventually consistent, and you need the Event Publication Registry to avoid losing reactions. Not every call should become an event: a query ("give me recent titles") belongs in an API like `ContentCatalog`.
- **Shared database, separate modules.** Modules still share one schema unless you discipline table ownership yourself. Spring Modulith does not stop `notification` from writing SQL against `publishing`'s tables through its own `JdbcClient`. Treat table ownership like package ownership (one module owns each table) if you want extraction to stay possible.
- **A modular monolith is a destination, not only a step.** The path to microservices is real (extract the module whose API is only events and a few calls), but for most applications the modular monolith is the right end state: well structured, one deployment, and no network in the middle of every use case.

## Documentation Links

- [Spring Modulith Reference: Fundamentals](https://docs.spring.io/spring-modulith/reference/fundamentals.html): application modules, API vs internal packages, named interfaces, `@ApplicationModule`, detection strategies.
- [Spring Modulith Reference: Verifying Application Module Structure](https://docs.spring.io/spring-modulith/reference/verification.html): what `verify()` checks and how to customize it.
- [Spring Modulith Reference: Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html): compatibility matrix, configuration properties, artifacts.
- [Spring Modulith examples on GitHub](https://github.com/spring-projects/spring-modulith/tree/main/spring-modulith-examples): official sample applications.
- [Dan Vega: Introduction to Spring Modulith, Modular Monoliths in Spring Boot (video)](https://www.youtube.com/watch?v=xHlDyKVyvig): step by step from a package-by-feature monolith to verified modules.
- [danvega/contentmod on GitHub](https://github.com/danvega/contentmod): the video's code, one branch per step.
