---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Testing against a real, managed database (see the sibling `managed-vs-unmanaged-dependencies` concept for why mocking it out is the wrong call) requires groundwork before the first integration test is written: the schema itself has to be reproducible and versioned, and both production code and test code need their own — different — discipline around database transactions. Getting the transaction discipline wrong in tests doesn't just make them flaky; it makes them pass when the real, production code path would have failed.

## Use Cases

- Deciding between Flyway/Liquibase-style migrations and a "compare two databases and generate a diff script" tool when setting up how a team ships schema changes.
- Reviewing a schema change that splits one column into two and recognizing that a migration tool needs a hand-written data-transformation script, not just a structural diff.
- Introducing a repository/unit-of-work split into a controller that currently opens a new database connection per call, to make a multi-step business operation atomic.
- Reviewing an integration test that reuses one `EntityManager`/JPA session across its arrange, act, and assert sections, and recognizing why that hides bugs a production code path would actually hit.

## Deep Dive

### Schema and reference data belong in source control

Treat the database schema — tables, views, indexes, stored procedures — as source code: store it in Git, not as a standalone "model database" instance that the team compares against production with a diff tool. A model database has no change history (you can't reconstruct what the schema looked like at a past point, which matters when reproducing a production bug) and becomes a second, competing source of truth alongside Git.

**Reference data is part of the schema, not regular data**, even though it lives in a table alongside rows the application does modify. The distinguishing test: if the application can modify the data, it's regular data; if only a migration can, it's reference data (an enum-like lookup table of user types, for example). Reference data ships as `INSERT` statements inside migrations, the same as structural changes.

Give every developer a separate, local database instance rather than sharing one — a shared instance means one developer's test run corrupts another's, and a non-backward-compatible schema change blocks everyone else's work simultaneously.

### Migration-based delivery beats state-based, because of data motion

```
State-based:      SQL scripts describe the desired end state; a comparison tool
                   diffs it against the live database and generates the upgrade
                   script for you. State is explicit, the migration mechanism
                   is implicit.

Migration-based:   You write each upgrade step (Flyway, Liquibase, or a
                   migration-DSL library) explicitly; the database's current
                   state is only ever reconstructed by replaying migrations
                   in order. Migrations are explicit, state is implicit.
```

The state-based approach's diff tool is good at generating a *structural* diff (add this column, drop that index) but has no idea what to do with the *data* already in the columns it's restructuring — splitting a `name` column into `first_name`/`last_name` needs a script that actually redistributes existing values, something no comparison tool can infer safely. Khorikov calls this **data motion**, and argues it dominates the trade-off in any project with real production data: state-based is fine pre-launch (when there's no real data to preserve yet), but the migration-based approach becomes necessary the moment there's data you can't just regenerate. Once on migrations: never edit a committed migration after the fact — write a new one to fix a mistake, unless the original risks real data loss.

### Production code: separate "what to update" from "whether to commit it"

```java
public class UserController {
    private final Transaction transaction;
    private final UserRepository userRepository;
    private final CompanyRepository companyRepository;

    public UserController(Transaction transaction, MessageBus messageBus, DomainLogger logger) {
        this.transaction = transaction;
        this.userRepository = new UserRepository(transaction);
        this.companyRepository = new CompanyRepository(transaction);
        // ...
    }

    public String changeEmail(long userId, String newEmail) {
        User user = userRepository.getUserById(userId);
        String error = user.canChangeEmail();
        if (error != null) return error;

        Company company = companyRepository.getCompany();
        user.changeEmail(newEmail, company);

        companyRepository.saveCompany(company);
        userRepository.saveUser(user);
        // ...

        transaction.commit();   // only reached on the happy path
        return "OK";
    }
}
```

A `Database` class that opens a fresh connection (and therefore an implicit fresh transaction) per method call means a multi-step business operation — read the user, read the company, save the company, save the user — spans several independent transactions. If the process crashes between the two saves, the company and user tables end up inconsistent with no way to roll back the first write. The fix is splitting responsibilities: **repositories** handle data access and are short-lived (created and discarded per call), while a **transaction** (or, more powerfully, a **unit of work**) spans the entire business operation and is committed only once every step has succeeded. `commit()` sits at the very end of the method precisely so any early return — a validation error, an exception — skips it and the transaction rolls back everything. Most ORMs (Hibernate/JPA's `EntityManager` is the direct analogue of the book's `DbContext`/`ISession`) already implement the unit-of-work pattern for you, additionally deferring all writes to a single flush at the end of the operation rather than issuing them incrementally.

### Tests need a stricter rule: never reuse a transaction across sections

```java
// Wrong: one EntityManager spans arrange, act, and assert:
try (var em = emf.createEntityManager()) {
    // arrange: save user + company via em
    // act: run the controller, passing em
    // assert: query user + company back out via the same em
}

// Right: a fresh EntityManager per section:
User user = createUser("user@mycorp.com", UserType.EMPLOYEE);   // own EntityManager internally
String result = execute(controller -> controller.changeEmail(user.getId(), "new@gmail.com"));  // own EntityManager
User userFromDb = queryUser(user.getId());   // own EntityManager
```

Reusing one `EntityManager`/session across a test's arrange, act, and assert sections doesn't match how the controller is actually invoked in production, where each business operation gets its own exclusive session created immediately before the call and disposed right after. The mismatch matters concretely because an ORM session commonly caches entities it has already loaded — an assert section sharing the arrange section's session can silently read back its own cached in-memory copy instead of round-tripping to the database, which means the test can pass even when the actual persisted row is wrong. The rule: **use at least three separate transactions (or units of work) per integration test — one each for arrange, act, and assert** — so the assert section is provably reading real, freshly-queried database state, not a cache.

## Trade-offs

- **A unit of work's deferred-write optimization only pays off when most of a business operation's steps genuinely need to commit together** — for a single-write operation, plain per-call transactions and a full unit-of-work abstraction cost about the same, so the added machinery is only worth it once multi-step atomicity is actually a real requirement.
- **State-based schema delivery is a legitimate, temporary choice pre-launch** — the data-motion argument against it only bites once there's real production data that can't simply be regenerated; picking migrations from day one on a pre-launch project is optional rigor, not a hard requirement yet.
- **Separate transactions per test section cost real test execution time** compared to one shared session — accept that cost deliberately, since the alternative (a passing test that doesn't match production behavior) is a false positive, one of the most expensive kinds of test failure to eventually track down.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 10 "Testing the database", Sections 10.1-10.2, pp. 230-243 — book
- [Flyway — Database migrations](https://documentation.red-gate.com/fd) — doc
- [Spring Framework — Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html) — doc
