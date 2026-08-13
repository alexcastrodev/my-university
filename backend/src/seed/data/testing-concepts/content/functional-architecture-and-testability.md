---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn the functional-core/imperative-shell pattern — restructuring code so all decision-making lives in pure, side-effect-free functions and a thin outer shell does nothing but gather inputs and execute the decisions — and understand exactly where this pays off in output-based testability and where it genuinely doesn't.

## Use Cases

- A class currently mixes "decide what should happen" with "make it happen" (write to a database, call an API, send an email), and every test needs a mock just to verify a decision that has nothing to do with I/O.
- Deciding how to restructure a piece of business logic so most of it can be covered by fast, mock-free output-based tests, leaving only a thin sliver for integration tests.
- Recognizing, before investing in the restructuring, that a particular piece of logic needs to read mutable state *mid-decision* and won't cleanly separate into a pure core without extra design work.

## Deep Dive

### The functional-core/imperative-shell pattern

The sibling concept on output-based testing already covers what makes a method output-based testable: no hidden inputs, no hidden outputs, same input always produces the same output. The question this concept answers is how to get *more* of a codebase into that shape when the underlying operation obviously needs to touch a side effect somewhere.

The answer is not to eliminate the side effect — every real application has to update a database or call some external system eventually. It's to stop letting the *decision* about what to do and the *execution* of that decision live in the same method. Split them:

- **Functional core** — a pure function (or a small cluster of them) that takes plain values as input and returns a plain value describing what should happen. It performs no I/O itself.
- **Imperative shell** — a thin outer layer that gathers whatever inputs the core needs, calls the core, and then executes the side effect the core decided on. It contains no business decisions of its own — just plumbing.

Here's a method that mixes both responsibilities, in the way real code usually starts out. It decides whether an overdue invoice needs a reminder email, and sends that email in the same breath:

```java
public class InvoiceReminderService {

    private final EmailClient emailClient;

    public InvoiceReminderService(EmailClient emailClient) {
        this.emailClient = emailClient;
    }

    public void remindIfOverdue(Invoice invoice, LocalDate today) {
        long daysOverdue = ChronoUnit.DAYS.between(invoice.dueDate(), today);

        if (daysOverdue > 0 && daysOverdue % 7 == 0) {
            String subject = "Invoice %s is %d days overdue".formatted(invoice.id(), daysOverdue);
            String body = "Please pay %s as soon as possible.".formatted(invoice.amount());
            emailClient.send(invoice.customerEmail(), subject, body);   // side effect
        }
    }
}
```

To unit-test this today you need a mock `EmailClient` and a `verify()` call, even though the actual thing worth testing — *is this invoice due for a reminder, and what should it say* — has nothing to do with email delivery. Pulling the decision out into its own pure method, and having it return an instruction instead of executing it, turns it into a mathematical function:

```java
public record Reminder(String to, String subject, String body) {}

public final class InvoiceReminderPolicy {

    public Optional<Reminder> decide(Invoice invoice, LocalDate today) {
        long daysOverdue = ChronoUnit.DAYS.between(invoice.dueDate(), today);

        if (daysOverdue <= 0 || daysOverdue % 7 != 0) {
            return Optional.empty();
        }

        String subject = "Invoice %s is %d days overdue".formatted(invoice.id(), daysOverdue);
        String body = "Please pay %s as soon as possible.".formatted(invoice.amount());
        return Optional.of(new Reminder(invoice.customerEmail(), subject, body));
    }
}
```

The shell shrinks to almost nothing — it has no `if`, no arithmetic, no business rule left in it at all:

```java
public final class InvoiceReminderService {

    private final InvoiceReminderPolicy policy = new InvoiceReminderPolicy();
    private final EmailClient emailClient;

    public InvoiceReminderService(EmailClient emailClient) {
        this.emailClient = emailClient;
    }

    public void remindIfOverdue(Invoice invoice, LocalDate today) {
        policy.decide(invoice, today)
              .ifPresent(reminder -> emailClient.send(reminder.to(), reminder.subject(), reminder.body()));
    }
}
```

Khorikov's own worked example follows the identical shape at a larger scale: an `AuditManager` that both decided what to write to a log file *and* wrote it, refactored into an `AuditManager` functional core that returns a `FileUpdate` instruction, and a `Persister` mutable shell whose only job is to read directory contents into memory and apply the `FileUpdate` it's handed. Same restructuring, same reason for doing it: the shell (`Persister`) ends up "trivial... no branching... all the complexity resides in" the core.

### Why the core needs zero mocks and the shell needs almost no unit tests

`InvoiceReminderPolicy.decide` is now a mathematical function — feed it an `Invoice` and a `LocalDate`, assert on the `Optional<Reminder>` it returns. No `EmailClient`, no mock, no `verify()`:

```java
@Test
void reminderIsSentOnTheSeventhDayOverdue() {
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1),
                                   new BigDecimal("250.00"), "buyer@example.com");

    Optional<Reminder> reminder = new InvoiceReminderPolicy()
        .decide(invoice, LocalDate.of(2026, 8, 8));   // exactly 7 days overdue

    assertEquals(
        Optional.of(new Reminder("buyer@example.com",
                                  "Invoice INV-42 is 7 days overdue",
                                  "Please pay 250.00 as soon as possible.")),
        reminder);
}

@Test
void noReminderOnAnOrdinaryOverdueDay() {
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1),
                                   new BigDecimal("250.00"), "buyer@example.com");

    Optional<Reminder> reminder = new InvoiceReminderPolicy()
        .decide(invoice, LocalDate.of(2026, 8, 3));   // 2 days overdue, not a multiple of 7

    assertEquals(Optional.empty(), reminder);
}
```

This is the highest-quality style the sibling concept describes: no coupling to *how* the decision got made, only to *what* it produced, so the test survives any internal refactor of `decide()` and runs in microseconds. `Reminder` being a `record` matters here too — records get `equals()`/`hashCode()` for free, so the assertion compares by value instead of by reference, which is what makes a single `assertEquals` on the whole instruction possible.

The shell, meanwhile, is now so simple that a unit test on it would mostly be re-testing `Optional.ifPresent`. What it actually needs verified is that it's wired correctly to a *real* `EmailClient` — and that's a job for a handful of integration tests, not a growing pile of unit tests:

```java
@Test
void reminderServiceActuallyDeliversTheEmail(FakeEmailClient fakeClient) {
    InvoiceReminderService service = new InvoiceReminderService(fakeClient);
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1),
                                   new BigDecimal("250.00"), "buyer@example.com");

    service.remindIfOverdue(invoice, LocalDate.of(2026, 8, 8));

    assertEquals(1, fakeClient.sentMessages().size());
}
```

One or two of these cover the wiring; the exhaustive case analysis (which days trigger a reminder, what the message says) stays entirely in the core's output-based tests, where it's cheapest to verify.

### The honest limits of functional architecture

Functional architecture is a genuine trade, not a free upgrade, and Khorikov is explicit that it comes with three real costs.

**The shell still needs some testing.** Splitting decisions from actions doesn't make the actions disappear — it concentrates them at the boundary, and that boundary still has to be verified against the real dependency it talks to. `InvoiceReminderService` above still needs the integration test shown; functional architecture reduces how much of that testing burden falls on unit tests, it doesn't reduce it to zero.

**Immutable objects have an allocation cost.** Returning a new `Reminder` (or, in the book's audit-log example, a new `FileUpdate`) instead of mutating something in place means an extra object gets created on every call. For a `LocalDate` comparison running once per invoice, that's irrelevant. In a hot path — a pricing engine re-evaluating thousands of line items per second, say — the accumulated allocation and garbage-collection pressure from constantly building new immutable instances instead of mutating existing ones is a real, measurable cost, not a theoretical one.

**Some decisions genuinely need to read mutable state mid-computation, and that breaks purity.** Suppose the reminder policy needed to check the customer's current support-ticket status before deciding whether to send anything, and that status lives in a database:

```java
// This is no longer a mathematical function: TicketRepository is a hidden,
// mutable, out-of-process input that isn't expressed as a plain value.
public Optional<Reminder> decide(Invoice invoice, LocalDate today, TicketRepository tickets) {
    ...
}
```

Passing a repository into the core reintroduces exactly the hidden input the core was built to avoid, and forfeits output-based testing for that method. The two ways out both cost something: fetch the ticket status eagerly in the shell before calling the core (keeps the core pure, but now queries the database on every invoice, even the ones that were never going to need a reminder), or add a cheap pure pre-check method the shell calls first to decide *whether* the expensive lookup is even needed (keeps the query conditional, but moves a sliver of decision-making — the "is this check necessary" call — out of the core and into the shell). Neither restores full purity; which one to pick is a genuine judgment call about where that domain draws the line, not a solved problem. Not every domain is worth forcing into this shape at all — Khorikov's own advice is to apply functional architecture where the logic is complex and important enough for the restructuring to pay for itself, and to skip it where the code is simple enough that a traditional design was never going to cause trouble.

## Trade-offs

- **A pure core buys output-based tests with zero mocks, but only for the part of the logic that stays pure** — the moment a decision needs a collaborator (a database, a clock read mid-computation) rather than a plain value, that method drops out of the functional core and the purity benefit stops applying to it specifically, not to the whole class.
- **The shell shrinks dramatically but doesn't vanish** — it still needs integration-level coverage to prove it's wired to the real dependency correctly; functional architecture changes *what kind* of test the shell needs, not whether it needs one:

  ```java
  // still worth having, even though the shell has no business logic left:
  @Test
  void serviceDeliversThroughTheRealEmailClientConfiguration() { /* integration test */ }
  ```
- **Immutability costs allocations, and that cost is invisible until it isn't** — a `Reminder` or `FileUpdate` created per call is free until the method sits in a hot path, at which point the extra object churn shows up in GC pauses or throughput numbers; the fix is measuring the actual path, not avoiding immutability everywhere pre-emptively.
- **Eager-fetch vs. conditional-check is a real fork with no universally correct answer** — pulling a database read up into the shell so the core stays pure means querying unconditionally, even for inputs that never needed the data; pushing a cheap pre-check into the core to decide whether to query at all keeps the query conditional but leaks a fragment of decision-making back into the shell. Khorikov offers both, picks neither as always-correct, and that's the honest answer.
- **Apply this strategically, not as a default** — the up-front cost is a bigger, more spread-out codebase (a policy class plus a shell class plus a value type, where one mixed method used to suffice); that cost is worth paying for logic that's complex or business-critical enough to need heavy test coverage, and not worth paying for a simple, low-stakes class that was never going to accumulate many tests either way.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 6 "Styles of Unit Testing", Sections 6.3-6.5 "Understanding functional architecture" / "Transitioning to functional architecture and output-based testing" / "Understanding the drawbacks of functional architecture", pp. 128-149 — book
- [Javadoc — java.util.Optional](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html) — doc
