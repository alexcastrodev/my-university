---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

`Behavior-driven development` (BDD), originated by Dan North, extends TDD by writing the specification in business-readable language rather than test code. `Cucumber` is the most common BDD tool on the JVM: scenarios are written in `Gherkin` (plain-English `Given`/`When`/`Then` steps) in `.feature` files that stakeholders can read, and each step is bound to a Java `step definition` method (`@Given`/`@When`/`@Then`). Cucumber runs the feature, executes the matching steps, and reports each scenario's pass/fail — turning acceptance criteria into living, executable specifications.

## Use Cases

- Capturing acceptance criteria as scenarios that non-technical stakeholders (product owners, testers) can read and even help write.
- Turning the `Given`/`When`/`Then` structure you already use to label unit tests into first-class, executable specifications.
- Keeping requirements permanently in sync with the code, because an out-of-date scenario fails the build.
- Driving development of a feature top-down from its business behavior, complementing bottom-up TDD unit tests.
- Providing a shared, ubiquitous language between business and engineering so acceptance tests become a communication instrument.

## Deep Dive

### The Gherkin feature file

Scenarios live in a `.feature` file under `src/test/resources`. Each step begins with a keyword; the text is plain English:

```gherkin
Feature: Passengers Policy
  The company follows a policy of adding and removing passengers,
  depending on the passenger type and the flight type

  Scenario: Economy flight, regular passenger
    Given there is an economy flight
    When we have a regular passenger
    Then you can add and remove him from an economy flight
    And you cannot add a regular passenger to an economy flight more than once
```

### Binding steps to Java code

Each Gherkin step is matched to a step-definition method annotated with `@Given`/`@When`/`@Then`. The method holds the actual JUnit assertions:

```java
public class PassengerPolicy {
    private Flight economyFlight;
    private Passenger regularPassenger;

    @Given("there is an economy flight")
    public void thereIsAnEconomyFlight() {
        economyFlight = new EconomyFlight("1");
    }

    @When("we have a regular passenger")
    public void weHaveARegularPassenger() {
        regularPassenger = new Passenger("Mike", false);
    }

    @Then("you can add and remove him from an economy flight")
    public void youCanAddAndRemoveHimFromAnEconomyFlight() {
        assertTrue(economyFlight.addPassenger(regularPassenger));
        assertTrue(economyFlight.removePassenger(regularPassenger));
    }
}
```

Cucumber matches each Gherkin line to the annotation text, injects any captured parameters, and runs the steps in order for every scenario.

### Book vs. today: this chapter's tooling is the most dated in the book

> The BDD chapter (2020) uses a **long-obsolete Cucumber**, so almost none of its wiring compiles today. Three concrete changes:

> **1. `info.cukes` → `io.cucumber`.** The book depends on `info.cukes:cucumber-java:1.2.5`. That groupId was abandoned years ago; modern Cucumber (7.x) is `io.cucumber`, and the step-definition imports moved from `cucumber.api.java.en.*` to `io.cucumber.java.en.*`:

```xml
<!-- book (dead) -->            <!-- today -->
<groupId>info.cukes</groupId>   <groupId>io.cucumber</groupId>
<artifactId>cucumber-java</artifactId>  <!-- + cucumber-junit-platform-engine -->
```

> **2. `@RunWith(Cucumber.class)` → the JUnit 5 Platform.** The book literally says "there is no Cucumber JUnit 5 extension at the moment of writing" and uses the JUnit 4 runner. That's no longer true — `cucumber-junit-platform-engine` plus `junit-platform-suite` run features natively on JUnit 5:

```java
// book (JUnit 4)                          // today (JUnit 5 Platform Suite)
@RunWith(Cucumber.class)                    @Suite
@CucumberOptions(features="classpath:features")   @IncludeEngines("cucumber")
public class CucumberTest { }               @SelectClasspathResource("features")
                                            public class RunCucumberTest { }
```

> **3. Anchored regex → Cucumber Expressions.** The book writes step patterns as anchored regex (`@Given("^there is an economy flight$")`). Modern Cucumber defaults to Cucumber Expressions, so the plain string (`@Given("there is an economy flight")`) is enough — with typed placeholders like `{int}`/`{string}` when you need to capture values.

> **JBehave (Ch. 21.3) is a niche alternative.** The book also covers JBehave as a second BDD tool; today Cucumber dominates the JVM BDD space, so JBehave is worth knowing exists but rarely the default choice for a new project.

## Trade-offs

- **A readable spec layer costs an extra indirection** — every scenario needs feature text *and* glue code, and a typo mismatch between the Gherkin line and the `@Given` string yields an "undefined step" instead of a clear failure:

```java
@Given("there is an economy flight")     // step text
// feature says "Given there is a economy flight" → undefined step, scenario skipped
```

- **BDD pays off only when non-developers actually read the scenarios** — if engineers write and read the feature files alone, Gherkin is pure overhead over plain JUnit tests; the value is the shared language with stakeholders, not the syntax.
- **Step reuse can create hidden coupling** — sharing step definitions across features keeps them DRY but means one step's state/setup can leak between scenarios, making failures hard to localize.
- **Feature files are another artifact to keep current** — they're executable, so they can't silently rot, but a large scenario suite is real maintenance, and over-specifying trivial behavior in Gherkin is slower to change than a unit test.

## Documentation Links

- [Cucumber — official documentation](https://cucumber.io/docs/cucumber/) — doc
- [Gherkin reference — Cucumber docs](https://cucumber.io/docs/gherkin/reference/) — doc
- [`cucumber-junit-platform-engine` (JUnit 5 integration) — GitHub](https://github.com/cucumber/cucumber-jvm/blob/main/cucumber-junit-platform-engine/README.md) — doc
- [JUnit in Action, 3rd Ed. — Ch. 21, "Behavior-driven development with JUnit 5," pp. 437–470 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
