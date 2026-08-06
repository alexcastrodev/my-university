---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

JUnit 5 is split into three layers so different testing engines can share one launcher: the `JUnit Platform` discovers and runs tests through a `TestEngine` API, `JUnit Jupiter` is the new programming model (annotations, assertions, extensions) plus the engine that executes it, and `JUnit Vintage` is a second engine that runs old JUnit 3/4 tests unmodified on the very same Platform — which is what makes migrating from JUnit 4 incremental instead of an all-or-nothing rewrite.

## Use Cases

- Running JUnit 5 (Jupiter) and legacy JUnit 4 (Vintage) tests in the same Maven/Gradle build, reported through one unified result set.
- Migrating a test suite from JUnit 4 to JUnit 5 module by module, keeping the untouched modules on Vintage while converted ones move to Jupiter.
- Understanding, when an IDE or Maven plugin runs "JUnit tests," which engine actually executed a given test class.
- Registering a third-party integration (Mockito, Spring) via `@ExtendWith` instead of a JUnit 4-style single-valued `@RunWith`.

## Deep Dive

### The three-layer architecture

```
JUnit Platform  (discovery + launcher API — talked to by IDEs and build tools)
   ├── JUnit Jupiter Engine  → runs @Test methods written with the JUnit 5 API
   └── JUnit Vintage Engine  → runs old JUnit 3/4 @Test methods unchanged
```

- **JUnit Platform** defines the `TestEngine` service-provider interface and the `Launcher` API. It doesn't know what a `@Test` annotation is — it just asks each registered engine "which of these classes can you run, and what happened when you ran them?"
- **JUnit Jupiter** is what most people mean by "JUnit 5": the `org.junit.jupiter.api` annotations (`@Test`, `@BeforeEach`, …), the `Assertions`/`Assumptions` classes, and the extension model. The Jupiter engine implements `TestEngine` to execute these on the Platform.
- **JUnit Vintage** implements `TestEngine` for the old `org.junit.Test` model, so a project can add both engines as dependencies and get one test run covering old and new tests together.

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.junit.vintage</groupId>
    <artifactId>junit-vintage-engine</artifactId>
    <scope>test</scope>
</dependency>
```

### Migrating from JUnit 4: a short note

> The book devotes a full chapter (Ch. 4) to migrating JUnit 4 test suites to JUnit 5 — annotation-by-annotation mapping (`@Before`/`@After` → `@BeforeEach`/`@AfterEach`, `@Category` → `@Tag`, `@RunWith` → `@ExtendWith`), and replacing `@Rule`/`@ClassRule` fields (`TemporaryFolder`, `ExpectedException`) with the `Extension` model. Few new projects start on JUnit 4 today, so this concept keeps that mapping as a short reference table rather than its own concept:

| JUnit 4 | JUnit 5 (Jupiter) |
|---|---|
| `org.junit.Test` (must be `public`) | `org.junit.jupiter.api.Test` (package-private is enough) |
| `@Before` / `@After` | `@BeforeEach` / `@AfterEach` |
| `@BeforeClass` / `@AfterClass` | `@BeforeAll` / `@AfterAll` |
| `@Ignore` | `@Disabled` |
| `@Category(SlowTests.class)` (marker interface) | `@Tag("slow")` (plain string) |
| `@RunWith(SomeRunner.class)` (single-valued) | `@ExtendWith(SomeExtension.class)` (repeatable) |
| `@Rule public ExpectedException thrown` | `assertThrows(...)` or a custom `Extension` |

A JUnit 4 `@RunWith(MockitoJUnitRunner.class)` becomes `@ExtendWith(MockitoExtension.class)` — same purpose (create `@Mock` fields before the test runs), different registration mechanism, and now stackable with other extensions on the same class.

## Trade-offs

- **Vintage keeps old tests running, but doesn't modernize them** — running JUnit 4 tests unmodified through the Vintage engine avoids a rewrite, but the team still carries two idioms (JUnit 4 `@Rule`/runners alongside JUnit 5 extensions) until each test is migrated.
- **`@RunWith` is single-valued, `@ExtendWith` is repeatable** — JUnit 4 allowed only one runner per class, forcing awkward runner composition; JUnit 5 lets a class combine multiple independent extensions:

```java
@ExtendWith(MockitoExtension.class)
@ExtendWith(SpringExtension.class) // both apply, no conflict
class MultiExtensionTest { /* ... */ }
```

- **Package-private test classes/methods work on Jupiter, not on Vintage** — a class written for the new engine can drop `public`, but the same class run through the Vintage engine (as if it were legacy JUnit 4) still needs `public` to be discovered.

## Documentation Links

- [JUnit 5 User Guide — Architecture](https://docs.junit.org/current/user-guide/#overview-what-is-junit-5) — doc
- [JUnit 5 User Guide — Migrating from JUnit 4](https://docs.junit.org/current/user-guide/#migrating-from-junit4) — doc
- [JUnit in Action, 3rd Ed. — Ch. 3, "JUnit architecture," pp. 47–62 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
- [JUnit in Action, 3rd Ed. — Ch. 4, "Migrating from JUnit 4 to JUnit 5," pp. 63–86 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
