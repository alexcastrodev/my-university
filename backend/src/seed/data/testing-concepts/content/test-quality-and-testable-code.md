---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

`Test quality` isn't just "tests exist" — it's whether the code is structured so tests are easy to write in the first place, and whether a `code coverage` number actually reflects meaningful checking. The book pairs a handful of testable-code principles (contracts over implementation, the Law of Demeter, favoring composition/polymorphism) with tooling (JaCoCo) to measure coverage, then places both TDD and BDD as development-cycle disciplines that produce well-tested code as a side effect of how it's written, rather than as an afterthought.

## Use Cases

- Measuring which lines/branches a test suite actually exercises with JaCoCo, integrated into a Maven/Gradle build.
- Refactoring a constructor that reaches into a large `Context`/config object for one dependency, so the class only asks for exactly what it uses.
- Preferring a constructor or setter that takes the concrete dependency a class needs, instead of a bag of unrelated state the class then has to navigate.
- Writing a failing test first (TDD's red-green-refactor) so the implementation is driven by an explicit, checkable expectation instead of tests bolted on afterward.
- Introducing BDD-style Given/When/Then scenarios so acceptance criteria are unambiguous before implementation starts.
- Using mutation testing to check whether the test suite would actually catch a deliberately introduced bug, rather than trusting a high coverage percentage at face value.

## Deep Dive

### Measuring code coverage with JaCoCo

`JaCoCo` instruments class bytecode to report which lines and branches ran during a test suite, integrated into Maven via a plugin:

```xml
<plugin>
    <groupId>org.jacoco</groupId>
    <artifactId>jacoco-maven-plugin</artifactId>
    <executions>
        <execution>
            <goals><goal>prepare-agent</goal></goals>
        </execution>
        <execution>
            <id>report</id>
            <phase>test</phase>
            <goals><goal>report</goal></goals>
        </execution>
    </executions>
</plugin>
```

The generated HTML report highlights covered lines in green and uncovered ones in red, down to individual branches within an `if` — useful for finding untested edge cases, but a high percentage only means lines *executed*, not that the right assertions ran against them.

### The Law of Demeter (Principle of Least Knowledge)

"Talk to your immediate friends, don't talk to strangers": a class should ask only for the objects it directly needs, not reach through another object to find them. This example violates it — `Car` needs to know `Context` happens to expose a `getDriver()` method:

```java
class Car {
    private Driver driver;

    Car(Context context) {
        this.driver = context.getDriver(); // reaching through Context to get Driver
    }
}
```

Testing this constructor now requires building a valid `Context` (or mocking one) just to satisfy a dependency `Car` doesn't actually use for anything except extracting `Driver`. Passing the needed object directly removes that indirection entirely:

```java
class Car {
    private Driver driver;

    Car(Driver driver) {
        this.driver = driver; // requires exactly what it needs, nothing more
    }
}
```

### Favoring composition and polymorphism over conditionals

Testable code tends to avoid long conditional chains that encode behavior differences, replacing them with polymorphism so each behavior is its own testable unit:

```java
// Harder to test in isolation: one method, growing branches
double area(Shape shape) {
    if (shape.getType() == ShapeType.CIRCLE) return Math.PI * shape.getRadius() * shape.getRadius();
    if (shape.getType() == ShapeType.RECTANGLE) return shape.getLength() * shape.getWidth();
    throw new IllegalArgumentException();
}
```

```java
// Each shape tests its own area() independently
interface Shape { double area(); }
class Circle implements Shape {
    private final double radius;
    public double area() { return Math.PI * radius * radius; }
}
```

### Test-driven development: red, green, refactor

TDD inverts the usual order: write a failing test for behavior that doesn't exist yet (**red**), write just enough code to make it pass (**green**), then clean up the implementation with the test as a safety net (**refactor**) — repeating in small steps rather than writing the whole feature before any test:

```java
// Red: this test doesn't compile/pass yet — Account.withdraw doesn't exist
@Test
void withdrawReducesBalance() {
    Account account = new Account("1", 100);
    account.withdraw(30);
    assertEquals(70, account.getBalance());
}
```

```java
// Green: minimal implementation to pass
class Account {
    private int balance;
    void withdraw(int amount) { balance -= amount; }
}
```

### Behavior-driven development

BDD builds on TDD by phrasing the test scenario in a shared, business-readable language (Given/When/Then) before either the test or the implementation exists, so the scenario itself becomes the point of agreement between developers and stakeholders:

```
Given an account with balance 100
When the customer withdraws 30
Then the account balance is 70
```

### Mutation testing

Mutation testing checks the test suite itself: a tool automatically introduces small bugs ("mutants" — flipping a `>` to `>=`, changing a `+` to `-`) into the compiled code and reruns the tests. A mutant that survives (tests still pass despite the injected bug) reveals a gap coverage alone wouldn't show — the line was *executed* by a test, but nothing actually asserted on the value that changed.

## Trade-offs

- **High line coverage doesn't mean high assertion quality** — a test that calls a method but asserts nothing meaningful about its result shows as "covered" in JaCoCo while catching nothing; mutation testing exists specifically to expose this gap.
- **Applying the Law of Demeter can mean more constructor parameters** — passing exactly what's needed instead of one context object avoids hidden coupling, but a class with many small dependencies ends up with a longer constructor signature than one that just reaches into a shared object.
- **TDD's small-steps discipline has a learning curve** — writing the test first requires knowing the shape of the API before it exists, which is a different (and initially slower) way of thinking than writing the implementation and testing it after.
- **Mutation testing is expensive to run** — because it recompiles and reruns the suite once per mutant, it doesn't fit in a fast inner dev loop the way unit tests do; it's typically a periodic or CI-only check, not a run-on-every-save tool.

## Documentation Links

- [JaCoCo — official site](https://www.jacoco.org) — doc
- [PIT (Pitest) — mutation testing for Java](https://pitest.org) — doc
- [JUnit in Action, 3rd Ed. — Ch. 6, "Test quality," pp. 101–121 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
