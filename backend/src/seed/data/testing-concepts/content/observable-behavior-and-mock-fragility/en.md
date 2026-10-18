---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand Khorikov's precise definition of a mock (as distinct from a stub) and the exact mechanism — not a vague suspicion — by which mocks create fragile tests: it isn't mocking itself that breaks resistance to refactoring, it's mocking an interaction that is really an implementation detail rather than the system's observable behavior.

## Use Cases

- Reviewing a test that calls `verify()` on a double the test also used `when()` on, and being able to name precisely why that's an anti-pattern (verifying a stub) rather than just "it feels wrong."
- Deciding whether a new `Mockito.verify(...)` assertion belongs in a unit test by checking a single question: does this interaction cross the application's boundary and stay visible to something outside it?
- Explaining why a test suite built in the London style (mock every collaborator) tends to be far more brittle than one built in the classical style, in terms of *which* interactions each style tends to mock, not just "London uses more mocks."

## Deep Dive

### Mock vs. stub, precisely: commands and queries

A mock and a stub are both test doubles, but they exist to answer different questions. The distinction tracks the **command query separation (CQS)** principle: every method is either a *command* (produces a side effect, returns nothing) or a *query* (returns data, has no side effect).

- A **stub** emulates a query — an incoming interaction, a call the SUT makes to get data it needs.
- A **mock** emulates and lets you examine a command — an outgoing interaction, a call the SUT makes that has a side effect visible outside the SUT.

```java
// Query, incoming interaction: stubbed. The SUT is asking for data.
Database stubDatabase = mock(Database.class);
when(stubDatabase.getNumberOfUsers()).thenReturn(10);

// Command, outgoing interaction: mocked. The SUT is causing a side effect.
verify(mockEmailGateway).sendGreetingsEmail("user@example.com");
```

Both lines use the same Mockito API (see `test-doubles-stubs-and-mocking` for the mechanics of `when()`/`verify()`) — the tool doesn't care which role a double is playing. The book's point is a design rule the tool won't enforce for you: **never assert interactions with a stub.** A call from the SUT to a stub is not part of the end result the SUT produces — it's the means by which the SUT gets input, then computes the actual result. Verifying that call anyway is a classic mistake, sometimes called overspecification:

```java
@Test
void creatingAReport() {
    Database stub = mock(Database.class);
    when(stub.getNumberOfUsers()).thenReturn(10);
    ReportController sut = new ReportController(stub);

    Report report = sut.createReport();

    assertEquals(10, report.getNumberOfUsers());   // verifies the actual outcome — keep this
    verify(stub).getNumberOfUsers();                // anti-pattern: asserting an interaction with a stub
}
```

The second assertion buys nothing: `getNumberOfUsers()` was never part of what `createReport()` promises its callers. It's an intermediate step on the way to the real result, which the first assertion already covers. The `verify(stub)...` line only exists to break the test the next time `ReportController` gets its user count from anywhere else, even if the report itself is still correct.

### Observable behavior vs. implementation detail: the actual dividing line

The sibling concept `four-pillars-of-a-good-unit-test` names "coupling to implementation details instead of observable behavior" as the root cause of false positives in general terms. Here's the precise test Khorikov gives for telling the two apart: a piece of code is part of a system's **observable behavior** only if it exposes an operation or a state that helps *the client* — whoever calls this code — achieve one of the client's own goals. Everything else, however public, is an implementation detail.

Applied to a whole application, this splits every collaboration into two kinds:

- **Intra-system communication** — calls between classes inside your application. These are implementation details: the client that ultimately triggered the call (an external caller, a UI) never asked for that specific internal collaboration, only for the outcome.
- **Inter-system communication** — calls that cross the application boundary to another system. These *are* observable behavior: an outside system is watching for that call and depends on it continuing to happen the same way.

A purchase flow makes the split concrete. `CustomerController` orchestrates a domain object (`Customer`, backed by a `Store`) and an out-of-process collaborator (`EmailGateway`, a proxy to an SMTP service):

```java
public class CustomerController {
    private final EmailGateway emailGateway;

    public boolean purchase(Customer customer, Store store, Product product, int quantity) {
        boolean isSuccess = customer.purchase(store, product, quantity);
        if (isSuccess) {
            emailGateway.sendReceipt(customer.getEmail(), product.getName(), quantity);
        }
        return isSuccess;
    }
}
```

`customer.purchase(store, ...)` internally calls `store.removeInventory(...)` — but no client of `CustomerController` ever asked for "call `removeInventory` on the store." They asked for a purchase; `isSuccess` and the receipt are the only things they can observe. Compare a fragile test that mocks the intra-system call against a sound one that mocks the inter-system call:

```java
// Fragile: mocks an implementation detail
@Test
void purchaseSucceedsWhenEnoughInventory() {
    Store storeMock = mock(Store.class);
    when(storeMock.hasEnoughInventory(Product.SHAMPOO, 5)).thenReturn(true);
    Customer customer = new Customer();

    boolean success = customer.purchase(storeMock, Product.SHAMPOO, 5);

    assertTrue(success);
    verify(storeMock).removeInventory(Product.SHAMPOO, 5); // no client of Customer asked for this call
}

// Sound: mocks the true system boundary
@Test
void successfulPurchaseSendsReceipt() {
    EmailGateway mockGateway = mock(EmailGateway.class);
    CustomerController sut = new CustomerController(mockGateway);

    boolean isSuccess = sut.purchase(customer, store, product, 5);

    assertTrue(isSuccess);
    verify(mockGateway).sendReceipt("customer@example.com", "Shampoo", 5); // an SMTP server is watching for this
}
```

Renaming `removeInventory` to `decrementStock`, or having `Customer` reserve inventory through a different call sequence entirely, changes nothing a caller of `CustomerController` can observe — yet the first test breaks. The second test breaks only if the application genuinely stops sending the receipt, which is exactly the kind of change a test should catch.

### The causal chain from mock to fragility — and the boundary rule

Putting the two sections together gives the precise (not folkloric) version of "mocks cause fragile tests":

> Mocking a dependency does not, by itself, make a test fragile. A test becomes fragile when it mocks an interaction that is an **implementation detail** rather than **observable behavior** — because that interaction has no connection to any real client goal, so asserting it (via `verify()`) is coupling the test to a "how" that's free to change.

The book's operational rule follows directly: **only mock communications that cross the application boundary and whose side effects are observable by something outside your system.** An in-process call between two of your own classes never qualifies, no matter how mock-able the collaborator's interface looks. This is the same principle the sibling concept `managed-vs-unmanaged-dependencies` applies one level up, to out-of-process dependencies specifically — an unmanaged dependency (SMTP, a message bus) gets mocked because the interaction is observable behavior; a managed dependency (your own database) doesn't, because talking to it is an implementation detail. The rule here is the general form that decision is a special case of.

It also explains, precisely, why the London and classical schools of unit testing (see the sibling `test-doubles-stubs-and-mocking` for the double-creation mechanics both schools use) differ in how fragile their test suites tend to be. London-style tests mock every dependency except immutable ones — including in-process collaborators like `Store` above — so they routinely mock implementation details and pay for it in false positives. Classical-style tests reserve doubles mostly for dependencies genuinely shared across tests, which in practice means out-of-process boundaries — much closer to where mocking is actually safe.

## Trade-offs

- **Verifying a stub buys zero protection and guarantees a future false positive** — the call was never part of the end result, so the assertion can only fail when a legitimate refactor changes *how* the data was fetched, never when the actual behavior breaks:

  ```java
  verify(stubDatabase).getNumberOfUsers(); // will break on a harmless refactor, catches nothing
  ```
- **Mocking an intra-system collaborator is strictly worse than asserting the outcome you already have** — in the `storeMock` example above, `assertTrue(success)` already proves the purchase behaved correctly; the added `verify(storeMock).removeInventory(...)` only creates a second, more fragile way for the same test to fail.
- **The boundary test is "does this cross the application AND stay observable outside it," not "is this dependency external"** — an out-of-process dependency that only your own application ever talks to (a private database) is still an implementation detail and still shouldn't be mock-verified; conversely, an in-process façade that's the literal last hop before an external system's wire format is worth mocking. Technology location (in-process vs. out-of-process) is not the deciding factor — observability by an outside client is.
- **London-school suites are structurally more exposed to this failure mode than classical-school suites** — not because London mocks "more" but because it doesn't distinguish intra-system from inter-system communication when deciding what to mock, so a larger fraction of its mocks end up targeting implementation details by default.
- **"Only mock at the boundary" is a design constraint, not just a testing tip** — a class whose collaborators can't be told apart as "internal" vs. "crosses to another system" (e.g., a domain object that directly holds an `EmailGateway` reference alongside plain domain collaborators) makes this rule hard to apply consistently; keeping inter-system calls concentrated in an application-services layer (rather than scattered through domain classes) is what makes "mock only the boundary" a rule you can actually follow.

## Lab

In this lab you get `TransferService` **already built and working**. Your job is to test it by applying the article's boundary rule: only mock communications that cross the application boundary and stay observable to something outside it. `Ledger` (in-process) is never mocked in this lab; `AuditGateway` (the true system boundary) is the only thing that is. The core idea is to feel that verifying internal calls makes a test fragile, while asserting the observable outcome lets it survive refactoring.

**The scenario**

A transfer debits an account and, only if that works, notifies an audit system.

- `Ledger`: an in-process collaborator that keeps balances in memory (`openAccount`, `hasSufficientFunds`, `debit`, `balanceOf`). No outside client talks to it, it is an implementation detail.
- `AuditGateway`: an interface (`logTransfer(accountId, amountCents)`) standing in for an out-of-process audit system. Something outside is really watching that call, so it is observable behavior.
- `TransferService.transfer(accountId, amountCents)`: returns `false` without touching anything when the balance is short; otherwise it debits the `Ledger`, calls `logTransfer` and returns `true`.
- `TransferServiceTest`: has only `mockAuditGateway` as a `@Mock` (with `MockitoExtension`), and a factory method `createLedgerWithBalance(...)` to implement.

**What you will do, step by step**

1. **Build a real ledger (TODO-00).** In `createLedgerWithBalance`, create a new `Ledger`, call `openAccount(accountId, startingBalanceCents)` and return it. It is a real object, never a mock, and every test goes through here.
2. **A successful transfer (TODO-01).** With `createLedgerWithBalance("acct-1", 1000)`, build `new TransferService(ledger, mockAuditGateway)`, call `transfer("acct-1", 400)` and check that it returns `true` and that `ledger.balanceOf("acct-1")` is 600, the real ledger's state. Only then `verify` `logTransfer("acct-1", 400)` on the gateway: here `verify` is legitimate because the gateway is the boundary.
3. **Insufficient balance (TODO-02).** With only 100 cents, `transfer("acct-1", 400)` returns `false` and the balance is still 100. Use `Mockito.verifyNoInteractions(mockAuditGateway)` to prove the boundary was never touched.
4. **Transfer the exact balance (TODO-03).** Avoid the tempting but fragile alternative of mocking `Ledger` and doing `verify(mockLedger).debit(...)`, because no client asked for "call `debit()`". With a real ledger of 500, do `transfer("acct-1", 500)`, check `true` and that `balanceOf("acct-1")` is 0. The test looks at the outcome, not at the internal call that produced it.

**How you know you are done**

`mvn test` is all green. You can explain why renaming `Ledger.debit()` would not break your tests, and why the `AuditGateway` `verify` is acceptable while a `Ledger` `verify` would not be.

**Optional challenges**

- **TODO-04:** with 1000 cents, do `transfer("acct-1", 100)` twice and use `Mockito.verify(mockAuditGateway, Mockito.times(2))` to confirm two calls to `logTransfer("acct-1", 100)`. Counting calls is legitimate because what is verified is the boundary.

**Prerequisites:** the `test-doubles-stubs-and-mocking` lab (Mockito `@Mock`, `when()`, `verify()`), the observable behavior and mock fragility article (mock vs stub, intra-system vs inter-system) and reading `TransferService`, `Ledger` and `AuditGateway` in `src/main/java`.

**How to run it:** clone the repository, go into `testing-concepts/observable-behavior-and-mock-fragility` and run `mvn test` (or, from the root, `mvn -pl testing-concepts/observable-behavior-and-mock-fragility test`). The factory throws `UnsupportedOperationException` and the tests start with `fail("TODO-NN: not implemented yet")`, so the red tests are your checklist.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020) — Chapter 5 "Mocks and Test Fragility", sections 5.1-5.4, pp. 92-118 — book
- [Mockito API — `Mockito` class](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html) — doc
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) — doc
