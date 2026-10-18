---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Spring Boot layers auto-configuration and component scanning on top of the Spring TestContext framework. The single annotation `@SpringBootTest` bootstraps a full application context for a test: it locates the Boot configuration, scans the test class's package and subpackages for beans, applies auto-configuration, and then autowires whatever the test asks for. This turns the multi-annotation setup of plain Spring (`@ExtendWith(SpringExtension.class)` + `@ContextConfiguration`) into one opinionated entry point for integration testing a Boot application.

## Use Cases

- Integration-testing a feature end to end with the real bean graph — controllers, services, repositories — loaded exactly as the app would wire them.
- Testing behavior that spans several collaborating beans (publishing a Spring event and asserting listeners reacted) where mocking everything would defeat the purpose.
- Migrating a plain Spring test to Boot: dropping `@ContextConfiguration` in favor of `@SpringBootTest`'s component scan.
- Pulling extra fixture beans into the context for a test via `@Import(SomeBuilder.class)` without polluting production configuration.
- Bridging legacy XML wiring into a Boot test with `@ImportResource` while migrating configuration to annotations/Java config.

## Deep Dive

### `@SpringBootTest` = context + component scan + auto-config

`@SpringBootTest` starts the application context the way Spring Boot would at runtime. It searches the current test class's package and its subpackages for bean definitions, so beans there are discovered and can be autowired directly into the test:

```java
@SpringBootTest
@Import(FlightBuilder.class)               // brings in the Flight + Country fixture beans
public class FlightTest {
    @Autowired
    private Flight flight;                  // discovered/imported and injected

    @Autowired
    private RegistrationManager registrationManager;  // found by component scan

    @Test
    void testFlightPassengersRegistration() {
        for (Passenger passenger : flight.getPassengers()) {
            assertFalse(passenger.isRegistered());
            registrationManager.getApplicationContext()
                .publishEvent(new PassengerRegistrationEvent(passenger));
        }
        for (Passenger passenger : flight.getPassengers()) {
            assertTrue(passenger.isRegistered());
        }
    }
}
```

No `@ExtendWith` is written here: `@SpringBootTest` is meta-annotated with `@ExtendWith(SpringExtension.class)`, so the extension is applied transitively.

### Mixing in existing configuration

While migrating, a Boot test can still consume beans defined the old way. `@ImportResource` pulls in an XML context; `@EnableAutoConfiguration` (implied by `@SpringBootTest`, but shown here explicitly in the book's migration step) triggers Boot's auto-configuration:

```java
@SpringBootTest
@EnableAutoConfiguration
@ImportResource("classpath:application-context.xml")  // legacy XML beans
class RegistrationTest {
    @Autowired
    private RegistrationManager registrationManager;   // still autowired
}
```

This is the "gentle migration" path: keep the XML beans working under Boot, then move them to Java config incrementally.

### Book vs. today: test slices instead of always loading everything

> The book (Spring Boot 2.x, 2020) reaches for `@SpringBootTest` for its examples, loading the whole context each time. Spring Boot also ships **test slices** — annotations that load only the beans for one layer, making tests much faster and more focused:

```java
@WebMvcTest(CountryController.class)   // only the web layer (controllers, MVC infra)
class CountryControllerTest { /* no service/repository beans loaded */ }

@DataJpaTest                            // only JPA repositories + an embedded DB
class PassengerRepositoryTest { /* controllers/services not loaded */ }
```

> Reach for `@SpringBootTest` when you genuinely need the full context (true end-to-end integration); reach for a slice when you're testing one layer. The book's approach still works — it's just heavier than necessary for single-layer tests.

## Trade-offs

- **Full-context tests are the slowest kind** — `@SpringBootTest` boots the entire application, so a suite of them is far slower than sliced or unit tests; the context is cached and reused across classes with identical configuration, but a full context is still expensive to build the first time.
- **Component scan depends on package placement** — `@SpringBootTest` scans the test class's package and subpackages, so a bean defined outside that tree is silently not found and autowiring fails:

```java
@Autowired
private RegistrationManager registrationManager; // fails if the bean lives outside the scanned package tree
```

- **Convenience hides what's loaded** — because one annotation pulls in auto-configuration and a full scan, it's easy to depend on a bean you didn't realize was there, making the test's true dependency surface larger and more fragile than a slice that loads a known, minimal set.
- **`@MockBean` has moved on** — the book replaces real beans with `@MockBean`; since Spring Boot 3.4 / Spring Framework 6.2, `@MockBean` and `@SpyBean` are deprecated in favor of `@MockitoBean` and `@MockitoSpyBean` (now part of the framework, not Boot):

```java
// book (Boot 2.x)         →   today (Boot 3.4+ / Framework 6.2+)
// @MockBean                    @MockitoBean
private CountryRepository countryRepository;
```

## Lab

In this lab you get a Spring Boot application **already built and working** (`OrderService`, `InventoryService`, `InventoryListener` and `GreetingController`) and two test classes with methods that fail on purpose. Your job is to write two different kinds of test against the same application: a full-context `@SpringBootTest` and a narrow `@WebMvcTest` slice. The core idea is to see for yourself when each one is the right tool: the slice is cheap and tests one layer in isolation, while the full context is the only one that proves the beans really collaborate.

**The scenario**

Placing an order updates the stock, but without one bean calling the other.

- `OrderService.placeOrder(order)`: only publishes an `OrderPlacedEvent`. It never talks to `InventoryService`.
- `InventoryListener`: an `@EventListener` that reacts to the event and calls `InventoryService.reserve(...)`. It runs synchronously on the publishing thread, so by the time `placeOrder` returns the stock has already changed.
- `InventoryService`: in-memory stock (`widget` at 100 and `gadget` at 50). `reserve` throws `IllegalArgumentException` for an unknown product and `IllegalStateException` when stock is short.
- `GreetingController`: `GET /greeting` returns "Hello, Kurz!" and has no collaborators.
- `OrderPlacingIntegrationTest` (`@SpringBootTest`) and `GreetingControllerSliceTest` (`@WebMvcTest(GreetingController.class)`) are the tests to complete.

**What you will do, step by step**

1. **Prove the chain end to end (TODO-00).** In `OrderPlacingIntegrationTest`, call `orderService.placeOrder(new Order("widget", 10))` and check that `inventoryService.getStock("widget")` is now 90. It only works because the full context wires event, listener and service as the same instances you autowired. A `@WebMvcTest` slice would not even load `InventoryListener`.
2. **Prove the cumulative effect (TODO-01).** Place two orders of 5 units of "gadget" and check the stock going from 50 to 45 and then to 40. This shows state changed by one bean is seen by another, because they all share the same cached context.
3. **Test the endpoint through the slice (TODO-03).** In `GreetingControllerSliceTest`, do `GET /greeting` with `MockMvc`, check `status().isOk()` and the body "Hello, Kurz!" with `content().string(...)`.
4. **Prove what the slice does not load (TODO-04).** Check that `applicationContext.getBeanNamesForType(InventoryService.class)` has length 0. The controller does not depend on the service, so the slice never loads it: choosing between `@SpringBootTest` and a slice is not only about speed, it is about which beans end up under test.

**How you know you are done**

`mvn test` is all green. You can explain why the stock test would make no sense with a mock `InventoryService`, and why the slice tests only one layer but starts much faster.

**Optional challenges**

- **TODO-02:** check that `orderService.placeOrder(new Order("unknown", 1))` throws `IllegalArgumentException`. Since `@EventListener` is synchronous by default, the exception from `reserve` travels back through `publishEvent(...)` to your call.

**Prerequisites:** the Spring REST API Testing with MockMvc lab (`@WebMvcTest`, `MockMvc`) and reading `OrderService`, `InventoryService`, `InventoryListener`, `OrderPlacedEvent` and `GreetingController` in `src/main/java` before writing any test.

**How to run it:** clone the repository, go into `testing-concepts/spring-boot-testing` and run `mvn test` (or, from the root, `mvn -pl testing-concepts/spring-boot-testing test`). The test methods start with `fail("TODO-NN: not implemented yet")`, so the red tests are your checklist.

## Documentation Links

- [Testing Spring Boot Applications — Spring Boot reference](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html) — doc
- [Test slices auto-configuration (`@WebMvcTest`, `@DataJpaTest`, …)](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) — doc
- [`@MockitoBean` / `@MockitoSpyBean` (replaces `@MockBean`) — Spring Framework](https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 17, "Testing Spring Boot applications," pp. 337–357 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
