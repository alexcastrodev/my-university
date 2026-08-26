---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Beyond "does JUnit run this test," the book lays out the vocabulary teams use to talk about testing scope and technique: **unit**, **integration**, **system**, and **acceptance** tests differ in how much of the application they exercise, while **black-box** and **white-box** testing differ in whether the test relies on implementation knowledge at all. Neither axis is JUnit-specific, but both shape how a JUnit test suite should be organized.

## Use Cases

- Deciding whether a failing scenario belongs in a unit test (one class, collaborators replaced), an integration test (several real, collaborating objects), or a system test (the whole integrated application).
- Writing acceptance tests as Given/When/Then scenarios that a non-developer stakeholder can read and confirm matches the business requirement.
- Choosing black-box tools (Selenium, an HTTP client hitting an endpoint) when only the functional specification is available and the implementation isn't finished yet.
- Choosing white-box tests when covering specific execution paths (a particular branch, a particular exception) that only someone who knows the implementation would think to target.
- Explaining to a team why "100% unit test coverage" doesn't by itself prove the system works end to end — that's what integration/system/acceptance tests are for.

## Deep Dive

### Unit, integration, system, and acceptance tests

The book scopes each test type by how much of the real system participates:

```java
// Unit test: one class, one collaborator replaced by a double
@Test
void transferMovesBalanceBetweenAccounts() {
    AccountService service = new AccountService();
    service.setAccountManager(mockAccountManager); // double, not the real thing
    service.transfer("1", "2", 50);
    assertEquals(150, sender.getBalance());
}
```

```java
// Integration test: real, collaborating objects, no doubles
@Test
void customerIsAssignedToOfferOnce() {
    Customer customer = new Customer("1");
    Offer offer = new Offer("economy");
    offer.addCustomer(customer);           // real Offer, real Customer
    assertTrue(customer.getOffers().contains(offer));
}
```

**System** testing runs the complete, integrated application to check it meets its specified requirements as a whole — closer to end-to-end than to any single class. **Acceptance** testing is the broadest: it checks the application does the right thing from the business's point of view, often phrased with `Given`/`When`/`Then`:

```
Given that there is an economy offer,
When we have a regular customer,
Then we can add them to and remove them from the offer.

Given that there is an economy offer,
When we have a VIP customer,
Then we can add them to the offer but not remove them from it.
```

### Black-box testing

A black-box test has no knowledge of the system's internals — it treats the system as a sealed box with a known input/output contract, verified purely through the external interface. It only needs the functional specification, which typically exists early in a project, so black-box testing can start before implementation details are settled. Tools like Selenium drive a web UI exactly the way a user would, without knowing what's behind it:

```java
@Test
void loginFormAcceptsValidCredentials() {
    driver.get("https://app.example.com/login");
    driver.findElement(By.id("username")).sendKeys("alice");
    driver.findElement(By.id("password")).sendKeys("secret");
    driver.findElement(By.id("submit")).click();
    assertEquals("Welcome, alice", driver.findElement(By.id("greeting")).getText());
}
```

### White-box testing

White-box (or glass-box) testing uses knowledge of the implementation to target specific execution paths, so the same Given/When/Then scenario above becomes a test written against the actual API by someone who knows `Customer`/`Offer` cooperate through `addCustomer`/`removeCustomer`:

```java
@Test
void vipCustomerCannotBeRemovedFromOffer() {
    Offer offer = new Offer("economy");
    Customer vip = new Customer("2", CustomerType.VIP);
    offer.addCustomer(vip);
    assertThrows(UnsupportedOperationException.class, () -> offer.removeCustomer(vip));
}
```

White-box tests can be written earlier than black-box GUI tests (no UI needed) and can cover many more execution paths, but they require the implementer's knowledge of the API to write in the first place.

## Trade-offs

- **Broader scope means slower, flakier tests** — a unit test with doubles runs in milliseconds and fails for one reason; a system or acceptance test exercises real infrastructure and can fail for reasons unrelated to the feature being tested (network hiccup, shared test data).
- **Black-box tests need a finished-enough UI, white-box tests don't** — a black-box Selenium test can't run until there's a page to drive, while a white-box test against the service layer can start as soon as the API exists, independent of the GUI.
- **White-box coverage requires implementation knowledge that goes stale** — a white-box test written against today's internal API structure can break on a refactor that doesn't change any externally visible behavior, which a black-box test of the same scenario would not.
- **Acceptance tests read like documentation, but aren't free** — Given/When/Then scenarios communicate intent well to non-developers, yet still need real step implementations wired to the actual system to be more than prose.

## Documentation Links

- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) — doc
- [Selenium — official site](https://www.selenium.dev) — doc
- [JUnit in Action, 3rd Ed. — Ch. 5, "Software testing principles," pp. 87–98 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
