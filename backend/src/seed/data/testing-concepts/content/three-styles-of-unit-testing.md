---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn the three ways a unit test can verify that a piece of code did the right thing — checking a returned **output**, checking the resulting **state**, or checking that the SUT **communicated** with a collaborator in a certain way — and understand Khorikov's ranking of the three: output-based testing produces the highest-quality tests, state-based testing is the reasonable default for everything else, and communication-based testing (mock verification) should be reserved for the rare case.

## Use Cases

- Deciding, for a new test, which of the three styles actually fits the behavior being verified, instead of defaulting to whichever style the surrounding test class already uses.
- Recognizing why a test suite full of `verify(...)` calls tends to be the most expensive to maintain and the most prone to breaking on harmless refactors, without needing to relitigate mock fragility from scratch.
- Explaining why "just make it a pure function" is a testability argument, not only a functional-programming preference — a pure function is output-based-testable almost by definition.

## Deep Dive

### The three styles, testing the same behavior three ways

All three styles can verify the exact same piece of behavior — "add an item to a cart" — but they check three different things: the value a method returns, the state left behind afterward, or the call a method makes to a collaborator.

**Output-based**: the cart operation is a pure function. Feed it an input, check what comes back. There is no mutable state to inspect — the return value is the *only* thing the test has to verify against.

```java
static List<String> addItem(List<String> items, String item) {
    List<String> result = new ArrayList<>(items);
    result.add(item);
    return result;
}

@Test
void addingAnItemReturnsAnExtendedList() {
    List<String> updated = addItem(List.of("bread"), "milk");

    assertEquals(List.of("bread", "milk"), updated);
}
```

**State-based**: the cart is a stateful object. The operation mutates it, and the test calls a query method afterward to inspect what changed.

```java
class Cart {
    private final List<String> items = new ArrayList<>();

    void addItem(String item) {
        items.add(item);
    }

    List<String> getItems() {
        return List.copyOf(items);
    }
}

@Test
void addingAnItemUpdatesTheCartState() {
    Cart cart = new Cart();

    cart.addItem("milk");

    assertEquals(List.of("milk"), cart.getItems());
}
```

**Communication-based**: the cart doesn't hold the items itself — it delegates to a collaborator, and the only thing worth checking is whether that delegation happened correctly.

```java
interface InventoryReserver {
    void reserve(String sku);
}

class Cart {
    private final InventoryReserver reserver;

    Cart(InventoryReserver reserver) {
        this.reserver = reserver;
    }

    void addItem(String sku) {
        reserver.reserve(sku);
    }
}

@ExtendWith(MockitoExtension.class)
class CartTest {
    @Mock
    InventoryReserver reserverMock;

    @Test
    void addingAnItemReservesInventory() {
        Cart cart = new Cart(reserverMock);

        cart.addItem("SKU-42");

        Mockito.verify(reserverMock).reserve("SKU-42");
    }
}
```

Same underlying idea — "adding an item" — three different assertions: a return value, a snapshot of state, and a recorded call.

### Why output-based testing wins, and its real limitation

Resistance to refactoring comes down to how much of the production code a test is coupled to. An output-based test couples to exactly one thing: the input-to-output mapping of the method under test. It doesn't know or care how that mapping is computed internally, so almost any refactor that preserves the mapping — renaming a helper, swapping a loop for a stream, restructuring the class entirely — leaves the test green. The only way an output-based test breaks on a refactor is if the method under test is itself an implementation detail being renamed or removed, which is a much narrower failure mode than "the test happened to assert on something that changed."

Output-based tests also win on maintainability for a structural reason: they boil down to "call it, check the return value," which is almost always a couple of lines, and because the underlying code can't touch shared or out-of-process state, there's nothing extra to set up or tear down.

The catch is the constraint the Objective already named: this style only works when the code under test has no observable side effects — no writes to a field, no calls to a database, no mutation of an argument. That's a real limitation, not a style preference. A `Cart` that has to track which items are in it, an `Order` that has to persist itself, a `Controller` that has to send an email — none of those can be verified purely by their return value, because their return value isn't the point of calling them. Most object-oriented code is written specifically to cause some effect, which is exactly what output-based testing can't see.

### State-based as the default, and communication-based as the exception

For the code that output-based testing can't reach — which, in most codebases, is most of the code — state-based testing is the reasonable fallback. It still checks an *outcome*: the state of the SUT (or a collaborator, or an out-of-process dependency) after the operation ran. That's a smaller, but real, version of the same resistance-to-refactoring argument — the test doesn't know *how* `addItem` updated the list, only that the list now contains the item. The cost shows up in maintainability instead: state can be large, so verifying "did the right thing happen to the whole object" can take several assertion lines where an output-based test would need one (compare the four-line assertion block a state check on a `Comments` collection needs against the single `assertEquals` an equivalent output-based check would need). Value objects with proper equality, or small assertion helpers, can shrink that verbosity, but they don't remove the underlying size difference.

Communication-based testing — verifying that the SUT called a collaborator in a particular way, as in the `InventoryReserver` example above — should be the exception, not the default. The reasoning connects directly to why mocking implementation details makes tests fragile: a call pattern is usually not the observable behavior a caller cares about, it's how that behavior happens to be implemented today. Reach for a mock verification only when the interaction itself crosses the application's boundary and *is* the observable effect — sending an email, publishing an event, writing to an external API someone else's system relies on. Anything with more depth on that trade-off belongs to mock fragility specifically, not to this comparison.

Put side by side, across the two metrics that actually differ between the styles:

| | Output-based | State-based | Communication-based |
|---|---|---|---|
| Due diligence to stay resistant to refactoring | Low | Medium | Medium (high if overused) |
| Maintainability cost | Low | Medium | High |

(Protection against regressions and feedback speed don't meaningfully depend on the style chosen — they depend on how much code runs and how fast it runs, which any of the three can achieve.)

## Trade-offs

- **Output-based is the cheapest test to write, but it demands purity you may not have** — a method that only maps input to output is trivial to test and nearly refactor-proof, but plenty of real behavior (persisting an order, updating a cart) is defined by its side effect, not its return value, so this style simply doesn't apply there.
- **State-based verification cost scales with the size of the state you're checking** — a single-field change is nearly as cheap as an output check, but a multi-field object can force several assertion lines for one behavior:

  ```java
  assertEquals(1, article.getComments().size());
  assertEquals("Comment text", article.getComments().get(0).getText());
  assertEquals("John Doe", article.getComments().get(0).getAuthor());
  ```
  versus one line if that same comment were compared as a value object with `assertEquals(expectedComment, article.getComments().get(0))`.
- **Communication-based tests are the most expensive to keep green** — every mock needs to be set up, and every `verify(...)` locks the test to a specific call shape; mock chains (a mock returning a mock returning a mock) compound that cost fast and are a sign the design, not just the test, needs a look.
- **Overusing mocks doesn't just cost maintainability, it can hide shallowness** — a test that mocks out everything except one thin slice of the SUT can still pass while verifying almost nothing about real behavior; that's a symptom of relying on communication-based testing as a default rather than an occasional tool.
- **All three styles can appear in the same test, and that's fine** — a test can call a method, check its return value, *and* inspect the state it left behind; what matters is knowing which assertion is actually doing the work of catching a regression versus which one is just along for the ride.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 6 "Styles of Unit Testing", pp. 119-128
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/)
- [java.util.List (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html)
