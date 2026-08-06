---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Where JUnit 4 had two separate extension mechanisms — runners (`@RunWith`, one per class) and rules (`@Rule` fields) — JUnit 5 unifies both into a single concept: the `Extension` API. `Extension` is a marker interface with no methods of its own; a class implements one of its sub-interfaces (`ExecutionCondition`, `BeforeEachCallback`, `ParameterResolver`, …) to hook into a specific `extension point` in the test lifecycle, and `@ExtendWith` registers it on a test class or method — the same mechanism `MockitoExtension` and `SpringExtension` already use.

## Use Cases

- Disabling a test conditionally based on environment/configuration (e.g., don't run load-sensitive tests during a "peak" business period) via `ExecutionCondition`.
- Injecting a resource into a test method's parameters (a database connection, a generated ID) without the test constructing it itself, via `ParameterResolver`.
- Running shared setup/teardown logic across many unrelated test classes by implementing `BeforeEachCallback`/`AfterEachCallback` once, instead of duplicating `@BeforeEach` methods.
- Translating a specific exception type into a different test outcome (e.g., treating a known flaky-infrastructure exception as "aborted" rather than "failed") via an exception-handling extension point.
- Understanding what `@ExtendWith(MockitoExtension.class)` or `@ExtendWith(SpringExtension.class)` actually plugs into, rather than treating them as opaque annotations.

## Deep Dive

### The five extension points

A JUnit 5 extension attaches to one of five moments in a test's lifecycle:

- **Conditional test execution** — controls whether a test runs at all (`ExecutionCondition`).
- **Life-cycle callback** — reacts to lifecycle events (`BeforeEachCallback`, `AfterEachCallback`, `BeforeAllCallback`, `AfterAllCallback`).
- **Parameter resolution** — supplies a value for a test method parameter at runtime (`ParameterResolver`).
- **Exception handling** — defines what happens when a test throws a particular exception type (`TestExecutionExceptionHandler`).
- **Test instance postprocessing** — runs right after a test instance is constructed, before any lifecycle callbacks (`TestInstancePostProcessor`).

Any of these interfaces can be implemented standalone or combined in one class; JUnit calls the registered extension automatically once its extension point is reached.

### Writing a conditional-execution extension

Implementing `ExecutionCondition` lets a test class opt in/out of running based on something external to the test itself — here, a `context.properties` file that says whether the system is in a `regular`, `low`, or `peak` load period:

```java
public class ExecutionContextExtension implements ExecutionCondition {
    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        Properties properties = new Properties();
        try {
            properties.load(ExecutionContextExtension.class
                    .getClassLoader()
                    .getResourceAsStream("context.properties"));
            String executionContext = properties.getProperty("context");
            if (!"regular".equalsIgnoreCase(executionContext) && !"low".equalsIgnoreCase(executionContext)) {
                return ConditionEvaluationResult.disabled("Test disabled outside regular and low contexts");
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        return ConditionEvaluationResult.enabled("Test enabled");
    }
}
```

Registering it on a test class is the same `@ExtendWith` used for Mockito or Spring:

```java
@ExtendWith(ExecutionContextExtension.class)
public class PassengerTest {
    @Test
    void testPassenger() {
        Passenger passenger = new Passenger("123-456-789", "John Smith");
        assertEquals("Passenger John Smith with identifier: 123-456-789", passenger.toString());
    }
}
```

When `context.properties` contains `context=peak`, every test in this class is reported as disabled with the given reason instead of running — no test code changes, only the extension's evaluation.

### Deactivating conditions when needed

Setting the `junit.jupiter.conditions.deactivate` configuration parameter to a pattern (e.g., `*` for all conditions) bypasses `ExecutionCondition` extensions entirely, forcing every test to run regardless of what any registered condition would decide — useful for a one-off "run everything" diagnostic pass.

### Extensions are composable, unlike JUnit 4 runners

Because `@ExtendWith` is repeatable, one class can combine multiple independent extension implementations, each responsible for a different concern (conditional execution, mocking, Spring context) without one having to subclass or wrap another:

```java
@ExtendWith(ExecutionContextExtension.class)
@ExtendWith(MockitoExtension.class)
class PassengerServiceTest {
    @Mock
    private PassengerRepository repository;
    // both extensions apply independently
}
```

## Trade-offs

- **`Extension` is a marker interface — the real contract lives in its sub-interfaces** — implementing `Extension` alone does nothing; the behavior comes from which specific interface (`ExecutionCondition`, `ParameterResolver`, …) a class actually implements, so picking the wrong one silently registers an extension that never triggers.
- **Conditional extensions can be globally overridden** — `junit.jupiter.conditions.deactivate=*` disables every `ExecutionCondition` in a run, which is useful for diagnostics but means a test suite's "this shouldn't run in this environment" guarantee isn't absolute if that configuration parameter is set:

```
junit.jupiter.conditions.deactivate=*
# every @ExtendWith(ExecutionCondition) now runs its test regardless of the condition
```

- **Multiple extensions on one class don't have an enforced ordering by default** — combining several `@ExtendWith` annotations composes cleanly for independent concerns, but if two extensions both need to run in a specific order (e.g., one sets up state the other depends on), that ordering has to be declared explicitly (`@Order` on registered extensions) rather than assumed from annotation order.
- **A custom extension is more code upfront than an inline `@BeforeEach`** — writing an `Extension` class pays off when the same logic is reused across many test classes, but for a one-off setup need in a single class, a plain `@BeforeEach` method remains simpler.

## Documentation Links

- [JUnit 5 User Guide — Extension Model](https://docs.junit.org/current/user-guide/#extensions) — doc
- [JUnit 5 Jupiter API — `Extension`](https://junit.org/junit5/docs/current/api/org.junit.jupiter.api/org/junit/jupiter/api/extension/Extension.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 14, "JUnit 5 extension model," pp. 263–280 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
