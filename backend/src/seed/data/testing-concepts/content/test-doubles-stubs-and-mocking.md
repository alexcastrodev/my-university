---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

A `test double` is a simulated object that stands in for a real collaborator — an external service, a database, or an internal component that's slow, hard to configure, or not yet built — so a test can exercise the object under test in isolation and stay fast and deterministic. The book distinguishes two strategies: a `stub` has fixed, predetermined behavior written outside the test (good for coarse-grained/integration-style tests against a whole subsystem); a `mock` has its expectations set per test and can verify how it was called (good for fine-grained unit tests). `Mockito` is the most common way to create mocks on the JVM.

## Use Cases

- Replacing a whole external subsystem (an HTTP server, a filesystem, a database) with a **stub** when the goal is a coarse-grained/integration-style test and the real environment can't be brought up in CI.
- Replacing a single collaborator with a **mock** when the goal is a fine-grained unit test that needs a precise failure message pointing at exactly what went wrong.
- Testing a component against a dependency that doesn't exist yet, by mocking the interface it will eventually implement.
- Verifying that a service under test calls a collaborator with the right arguments, without asserting anything about the collaborator's own internal behavior.
- Distinguishing, when writing a test, whether the goal is "does my class behave correctly given this collaborator's response" (unit test with a mock) vs. "do these two real classes work correctly together" (integration test, no double at all).

## Deep Dive

### Stubs vs. mocks

Both fake a dependency, but the book draws a sharp line between them: a **stub** is written outside the test with a fixed behavior — same hardcoded return value no matter which test uses it, no matter how many times. A **mock** has no behavior until the test sets expectations on it, right before exercising the code:

```
Stub pattern:  initialize stub  → execute test → verify assertions
Mock pattern:  initialize mock  → set expectations → execute test → verify assertions
```

```java
// Stub: fixed behavior, written once, reused unmodified everywhere
class StubAccountManager implements AccountManager {
    public Account findAccountForUser(String id) {
        return new Account(id, 100); // always the same, regardless of the test
    }
}
```

```java
// Mock: behavior set per test, right before use
Mockito.when(mockAccountManager.findAccountForUser("1")).thenReturn(sender);
```

The book recommends stubs for coarse-grained testing (replacing a whole external system such as an HTTP server or database) and mocks for fine-grained unit testing that needs precise, per-test control and a failure message that points at the exact expectation that broke.

### Declaring a mock with Mockito

`@Mock` (with `@ExtendWith(MockitoExtension.class)`) creates a mock object of the given type before the test runs; `Mockito.when(...).thenReturn(...)` scripts its behavior:

```java
@ExtendWith(MockitoExtension.class)
class AccountServiceTest {
    @Mock
    private AccountManager mockAccountManager;

    @Test
    void transferMovesBalanceBetweenAccounts() {
        Account sender = new Account("1", 200);
        Account beneficiary = new Account("2", 100);
        Mockito.when(mockAccountManager.findAccountForUser("1")).thenReturn(sender);
        Mockito.when(mockAccountManager.findAccountForUser("2")).thenReturn(beneficiary);

        AccountService service = new AccountService();
        service.setAccountManager(mockAccountManager);
        service.transfer("1", "2", 50);

        assertEquals(150, sender.getBalance());
        assertEquals(150, beneficiary.getBalance());
    }
}
```

`@ExtendWith(MockitoExtension.class)` is the JUnit 5 extension model's registration point — it processes the `@Mock` field before the test body runs, so `mockAccountManager` is already a working mock by the time the test executes.

### Multiple stubbed calls and strictness

By default, Mockito's strict stubbing expects every `when(...)` to be used by the test; declaring two expectations for the *same* method with different arguments (as above, `"1"` and `"2"`) is fine, but an unused stub or a stub that's never matched raises a strictness warning/error. `Mockito.lenient()` opts a specific stub out of that check:

```java
Mockito.lenient()
    .when(mockAccountManager.findAccountForUser("1"))
    .thenReturn(sender);
```

This is typically needed when a shared `@BeforeEach` sets up stubs that not every test in the class actually exercises.

### Verifying interactions

Beyond scripting return values, Mockito can assert that a method on the double was actually called, and with what arguments — useful when the collaborator has no return value to assert on (e.g., a notification sender):

```java
@Test
void transferNotifiesBothAccounts() {
    service.transfer("1", "2", 50);

    Mockito.verify(mockNotifier).notify("1", "Sent 50");
    Mockito.verify(mockNotifier).notify("2", "Received 50");
}
```

## Trade-offs

- **Stubs give more confidence, mocks give more precision** — a stub-based test exercises the real object under test against something close to a real subsystem, but a broken stub assertion often just says "wrong output," while a mock's `verify()` failure points at the exact expected call that didn't happen.
- **Mocking hides real integration bugs** — a unit test built entirely around mocks proves the unit under test calls its collaborators the way the test expects, not that the real collaborator actually behaves that way; that gap is exactly what integration tests (or a stub-based coarse-grained test) exist to close.
- **Strict stubbing catches unused mocks, at the cost of extra ceremony** — an unnecessary `when(...)` that the test never triggers fails the test under strict stubbing, which is a real signal of test drift but does mean shared setup code needs `lenient()` where not every test uses every stub:

```java
Mockito.when(mockAccountManager.findAccountForUser("3")).thenReturn(unused);
// UnnecessaryStubbingException if no test method actually calls findAccountForUser("3")
```

- **Verifying interactions couples the test to *how*, not just *what*** — `Mockito.verify(...)` locks the test to a specific method being called a specific way, so a refactor that achieves the same externally visible result through a different call sequence can break tests that were never wrong about behavior.
- **A double needs an interface (or overridable method) to attach to** — Mockito can mock concrete classes, but a design with hardcoded `new SomeDependency()` calls inside the class under test gives Mockito nothing to substitute without further refactoring (e.g., constructor/setter injection); a hand-written stub has the same requirement.
- **Hand-written stubs are hard to maintain** — the book's own caveat: a stub needs to reimplement, in simplified form, the same logic as whatever it replaces, which gets harder to keep correct as the real system's behavior evolves; each new situation typically needs its own stubbing strategy rather than a reusable one.

## Documentation Links

- [Mockito — official site](https://site.mockito.org) — doc
- [Mockito API — `Mockito` class](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 7, "Coarse-grained testing with stubs," pp. 123–137 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
- [JUnit in Action, 3rd Ed. — Ch. 8, "Testing with mock objects" (Mockito, pp. 166–169), pp. 138–170 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
