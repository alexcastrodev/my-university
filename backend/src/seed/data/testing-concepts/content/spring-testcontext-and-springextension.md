---
version: 1.0
updatedAt: 2026-08-06
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

## Trade-offs

- **Loading a context is heavier than a plain unit test** — `SpringExtension` builds a real `ApplicationContext`, so these tests are integration tests, slower than a Mockito-only unit test; the TestContext framework mitigates this by caching and reusing the context across test classes with the same configuration.
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
- [JUnit in Action, 3rd Ed. — Ch. 16, "Testing Spring applications," pp. 311–336 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
