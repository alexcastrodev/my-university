---
version: 1.1
updatedAt: 2026-08-17
---
## Objective

Spring is an IoC (inversion-of-control) container: instead of a class constructing its own collaborators, the container creates and wires them ("beans") and hands them over. Testing a Spring application therefore means loading an `ApplicationContext` and pulling wired beans into the test. JUnit 5 does this through the `Spring TestContext Framework`, activated by `@ExtendWith(SpringExtension.class)` — the same extension mechanism Mockito uses — combined with `@ContextConfiguration` to say *which* context to load and `@Autowired` to inject beans into the test class.

## Use Cases

- Verifying that beans are wired together correctly (a `Passenger` gets its `Country`) by loading the real Spring context in the test instead of constructing objects by hand.
- Testing a service that depends on other Spring-managed components, letting the container inject the whole graph into the test via `@Autowired`.
- Migrating a Spring 4 + JUnit 4 test suite (`@RunWith(SpringJUnit4ClassRunner.class)`) to Spring 5 + JUnit 5 (`@ExtendWith(SpringExtension.class)`).
- Loading a test-specific context configuration (a dedicated XML/Java config with test beans) separate from production wiring.
- Reusing one loaded context across many test methods, since the TestContext framework caches it rather than rebuilding it per test.

## Deep Dive

### The IoC container and beans

A Spring context describes objects and their dependencies; the container instantiates and wires them. The book starts with XML for clarity — a `passenger` bean whose `country` property references a `country` bean:

```xml
<bean id="passenger" class="com.manning.junitbook.spring.Passenger">
    <constructor-arg name="name" value="John Smith"/>
    <property name="country" ref="country"/>
</bean>
<bean id="country" class="com.manning.junitbook.spring.Country">
    <constructor-arg name="name" value="USA"/>
    <constructor-arg name="codeName" value="US"/>
</bean>
```

Without any test framework, you'd load that context and ask for beans by hand:

```java
ClassPathXmlApplicationContext context =
    new ClassPathXmlApplicationContext("classpath:application-context.xml");
Passenger passenger = (Passenger) context.getBean("passenger");
```

### Wiring the context into a JUnit 5 test with SpringExtension

`SpringExtension` (introduced in Spring 5) integrates the Spring TestContext framework with JUnit Jupiter. Registered with `@ExtendWith`, it reads `@ContextConfiguration` to build the context and then satisfies `@Autowired` fields on the test itself — replacing the manual `getBean(...)` calls above:

```java
@ExtendWith(SpringExtension.class)
@ContextConfiguration("classpath:application-context.xml")
public class SpringAppTest {
    @Autowired
    private Passenger passenger;   // injected by the container, not constructed here

    @Test
    public void testInitPassenger() {
        assertEquals(getExpectedPassenger(), passenger);
    }
}
```

`spring-test` supplies `SpringExtension` and `@ContextConfiguration`; `spring-context` supplies `@Autowired`. The container looks for a single bean of the autowired type — if there are two `Passenger` beans, injection is ambiguous and the context fails with `UnsatisfiedDependencyException`.

### Migrating from the JUnit 4 runner

Under JUnit 4, the same integration was a *runner*, and only one runner could be applied per class:

```java
// JUnit 4 + Spring 4
@RunWith(SpringJUnit4ClassRunner.class)
@ContextConfiguration("classpath:application-context.xml")
public class SpringAppTest { /* ... */ }
```

```java
// JUnit 5 + Spring 5 — same @ContextConfiguration, extension instead of runner
@ExtendWith(SpringExtension.class)
@ContextConfiguration("classpath:application-context.xml")
public class SpringAppTest { /* ... */ }
```

Because `@ExtendWith` is repeatable (unlike `@RunWith`), the Spring extension can now coexist with, say, Mockito's on the same class.

### Book vs. today: `@SpringJUnitConfig` and Java config

> The book (Spring 5.2, 2020) writes `@ExtendWith(SpringExtension.class)` + `@ContextConfiguration` as two separate annotations. Spring provides a composed shortcut, `@SpringJUnitConfig`, that bundles exactly those two — the modern idiom for the same wiring:

```java
@SpringJUnitConfig(locations = "classpath:application-context.xml")
public class SpringAppTest {
    @Autowired
    private Passenger passenger;
}
```

> The book also leads with XML "as a gentle introduction" and moves to annotations later; today the default is Java `@Configuration` classes (`@SpringJUnitConfig(AppConfig.class)`), with XML reserved for legacy contexts. XML remains fully supported, so the book's examples still run — they're just no longer the first choice.

### Context caching and connection-pool exhaustion

Caching is what makes a large `@SpringBootTest` suite tolerable — a "same configuration" context (same `@Import`s, same `@MockitoBean`s, same `@TestPropertySource`/`properties`, same active profiles...) is built once and reused across every test class that asks for it. But "same configuration" is a stricter bar than it looks: change any of those inputs — one extra `@MockitoBean`, a different `properties = {...}` on `@SpringBootTest`, a different `@Import` — and you get a **new** cache key, hence a brand-new `ApplicationContext`, hence a brand-new `DataSource` with its own connection pool. A suite with a few hundred test classes can easily end up with two or three dozen distinct cached contexts alive at once (Spring's default cache eviction only kicks in around 32 entries).

Each of those contexts opens its own HikariCP pool at the default size (10 connections). Multiply: 30 live contexts × 10 connections = up to 300 simultaneous connections wanted from a Postgres instance whose default `max_connections` is 100. The failure that shows up is:

```
FATAL: sorry, too many clients already
```

surfacing as `FlywaySqlUnableToConnectToDbException` or `BeanCreationException: Error creating bean with name 'entityManagerFactory'` while a *later*, unrelated test class is trying to spin up its context — not from the tests that opened the earlier connections. It looks like flaky, random test failures (intermittent, position-in-the-suite-dependent, disappears when you rerun a failing class in isolation) because by the time it manifests, the actual cause (too many contexts alive at once) is several test classes back. Isolated reruns pass because the cache is cold again and only one context is competing for connections.

The fix isn't chasing the "flaky" test — it's sizing the pool for what the *test JVM* actually does with it. Each context's tests mostly run on a single thread (`MockMvc`, a repository call, a `@Transactional` service method), so a pool of 10 idle-but-reserved connections per context is pure waste multiplied by however many contexts the cache is holding:

```yaml
# application-test.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 3
      minimum-idle: 1
```

Three connections is plenty of headroom for a single-threaded test class (main thread + Flyway's migration connection at startup + the odd background thread from something like a job scheduler under test), and it turns the same 30-context worst case into ~90 connections instead of 300 — comfortably under `max_connections`. The alternative fixes are worse: raising Postgres's `max_connections` just moves the ceiling without addressing the waste, and hand-reducing the number of distinct context configurations across a few hundred tests is a much bigger refactor for the same result.

## Trade-offs

- **Loading a context is heavier than a plain unit test** — `SpringExtension` builds a real `ApplicationContext`, so these tests are integration tests, slower than a Mockito-only unit test; the TestContext framework mitigates this by caching and reusing the context across test classes with the same configuration.
- **The cache trades slow test classes for many live connection pools** — every distinct combination of `@Import`, `@MockitoBean`, and `@SpringBootTest(properties = ...)` is a new cache entry with its own `DataSource`; a large suite can hold enough contexts alive at once to exhaust the database's `max_connections`, surfacing as `FATAL: sorry, too many clients already` on an unrelated, later test class (see "Context caching and connection-pool exhaustion" above).
- **A single-bean-per-type assumption for field autowiring** — `@Autowired` by type fails when two beans of that type exist:

```java
@Autowired
private Passenger passenger; // UnsatisfiedDependencyException if the context has 2 Passenger beans
```

- **Field injection into tests is convenient but not the recommended production style** — `@Autowired` on a field reads cleanly in a test, yet Spring itself recommends constructor injection for application beans (immutability, easier standalone construction); a test can use either, but mirroring field injection everywhere carries the habit into production code where it's discouraged.
- **The context ties the test to configuration, not just code** — a bean rename or a missing `@ContextConfiguration` resource fails the test at context-load time with a wiring error rather than an assertion failure, which is a different debugging path than a pure unit test.

## Documentation Links

- [Spring TestContext Framework — Spring Framework docs](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework.html) — doc
- [`@SpringJUnitConfig` / SpringExtension — Spring testing annotations](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-junit-jupiter.html) — doc
- [Context Caching — Spring Framework testing docs](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html) — doc
- [HikariCP configuration reference (`maximum-pool-size`, `minimum-idle`)](https://github.com/brettwooldridge/HikariCP#gear-configuration-knobs-baby) — doc
- [JUnit in Action, 3rd Ed. — Ch. 16, "Testing Spring applications," pp. 311–336 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
