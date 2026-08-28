---
version: 1.0
updatedAt: 2026-08-28
---
## Objective

SOLID is a mnemonic for five object-oriented design principles — Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion — that describe how to structure classes and interfaces so that a codebase stays cheap to change: each unit changes for one reason, new behavior is added rather than existing behavior edited, subtypes stay truly interchangeable with their base type, clients only depend on the methods they actually call, and high-level policy code doesn't hard-wire itself to low-level implementation details.

## Use Cases

- A class keeps changing for reasons that have nothing to do with each other (a pricing rule change and a report-format change both touch the same file) — a Single Responsibility smell.
- Adding a new case means editing a tested `if`/`else` or `switch` chain instead of adding a new implementation — an Open/Closed smell.
- A subclass overrides a method to throw or to silently change the base type's documented behavior — a Liskov Substitution smell.
- An interface implementation is full of methods that just `throw new UnsupportedOperationException()` — an Interface Segregation smell.
- A high-level class constructs its own concrete dependencies with `new` instead of receiving an abstraction — a Dependency Inversion smell.

## Deep Dive

### S — Single Responsibility Principle

A class should have one reason to change — one axis of change, ideally traceable to one stakeholder. `Invoice` below answers to two: finance (how the total is computed) and reporting (how it's stored and printed).

```java
class Invoice {
    private final List<LineItem> items;

    Invoice(List<LineItem> items) { this.items = items; }

    double total() {
        return items.stream().mapToDouble(LineItem::price).sum();
    }

    void saveToDatabase() { /* JDBC calls */ }
    void printToPdf() { /* PDF rendering */ }
}
```

Splitting persistence and printing into their own collaborators leaves `Invoice` with exactly one reason to change — how the total is computed:

```java
class Invoice {
    private final List<LineItem> items;
    Invoice(List<LineItem> items) { this.items = items; }
    double total() { return items.stream().mapToDouble(LineItem::price).sum(); }
}

class InvoiceRepository {
    void save(Invoice invoice) { /* JDBC calls */ }
}

class InvoicePrinter {
    void printToPdf(Invoice invoice) { /* PDF rendering */ }
}
```

### O — Open/Closed Principle

A module should be open for extension but closed for modification. A discount calculator built as a growing `if`/`else` chain has to be edited — and re-tested — every time a new customer tier appears:

```java
double discount(String customerType, double amount) {
    if (customerType.equals("REGULAR")) return amount * 0.95;
    else if (customerType.equals("PREMIUM")) return amount * 0.90;
    // a new tier means another branch here
    return amount;
}
```

Replacing the branch with a `DiscountPolicy` abstraction means a new tier is a new class — `discount()` itself never changes again:

```java
interface DiscountPolicy {
    double apply(double amount);
}

class RegularDiscount implements DiscountPolicy {
    public double apply(double amount) { return amount * 0.95; }
}

class PremiumDiscount implements DiscountPolicy {
    public double apply(double amount) { return amount * 0.90; }
}

double discount(DiscountPolicy policy, double amount) {
    return policy.apply(amount);
}
```

### L — Liskov Substitution Principle

A subtype must be substitutable for its base type: any code written against `Rectangle` must keep working, unmodified, when handed a `Square`. Making `Square` extend `Rectangle` by overriding both setters to keep the sides equal breaks that:

```java
class Rectangle {
    protected int width, height;
    void setWidth(int w) { this.width = w; }
    void setHeight(int h) { this.height = h; }
    int area() { return width * height; }
}

class Square extends Rectangle {
    @Override void setWidth(int w) { width = height = w; }
    @Override void setHeight(int h) { width = height = h; }
}

Rectangle r = new Square(0, 0);
r.setWidth(5);
r.setHeight(4);
System.out.println(r.area()); // 20 for a real Rectangle, but 16 here
```

The same two calls give a different answer depending on which concrete type hides behind the `Rectangle` reference — `Square` compiles as a `Rectangle` but doesn't behave like one. Modeling both as independent implementations of a narrower `Shape` abstraction avoids the false is-a relationship entirely:

```java
interface Shape {
    int area();
}

record Rectangle(int width, int height) implements Shape {
    public int area() { return width * height; }
}

record Square(int side) implements Shape {
    public int area() { return side * side; }
}
```

### I — Interface Segregation Principle

No client should be forced to depend on methods it doesn't use. A single `Worker` interface forces every implementer to answer for `eat()` and `sleep()`, even one that has no use for them:

```java
interface Worker {
    void work();
    void eat();
    void sleep();
}

class RobotWorker implements Worker {
    public void work() { /* ... */ }
    public void eat() { throw new UnsupportedOperationException(); }
    public void sleep() { throw new UnsupportedOperationException(); }
}
```

Splitting `Worker` into role interfaces lets each implementer depend only on what it actually does:

```java
interface Workable { void work(); }
interface Feedable { void eat(); }
interface Sleepable { void sleep(); }

class RobotWorker implements Workable {
    public void work() { /* ... */ }
}

class HumanWorker implements Workable, Feedable, Sleepable {
    public void work() { /* ... */ }
    public void eat() { /* ... */ }
    public void sleep() { /* ... */ }
}
```

### D — Dependency Inversion Principle

A high-level module shouldn't depend on a low-level module's concrete details — both should depend on an abstraction the high-level module owns. `OrderService` below is the policy, but it wires itself directly to a specific storage technology:

```java
class OrderService {
    private final MySqlOrderRepository repository = new MySqlOrderRepository();

    void placeOrder(Order order) {
        repository.save(order);
    }
}
```

Introducing an `OrderRepository` abstraction and injecting it inverts the dependency arrow: `MySqlOrderRepository` now depends on the interface `OrderService` defines against, not the other way around.

```java
interface OrderRepository {
    void save(Order order);
}

class OrderService {
    private final OrderRepository repository;

    OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    void placeOrder(Order order) {
        repository.save(order);
    }
}

class MySqlOrderRepository implements OrderRepository {
    public void save(Order order) { /* JDBC calls */ }
}
```

Swapping in an `InMemoryOrderRepository` for a test now requires zero changes to `OrderService`.

## Trade-offs

- **More types for the same behavior** — Single Responsibility and Interface Segregation deliberately trade one large class or interface for several small, focused ones; a single God class is one file to grep, five collaborators are several to navigate.
- **Open/Closed only pays off when the seam is right** — turning a branch into a `DiscountPolicy` abstraction is worth it only if more tiers are actually coming; guessing wrong leaves an unused abstraction sitting next to a branch that keeps growing somewhere else.
- **Liskov violations compile cleanly** — the compiler cannot catch a broken behavioral contract, only a broken type signature, so a `Square extends Rectangle` override passes every compile-time check and only breaks at the call site:

```java
Rectangle r = new Square(0, 0);
r.setWidth(5);
r.setHeight(4);
System.out.println(r.area()); // 16, not the 20 a Rectangle caller expects
```

- **Dependency Inversion doesn't remove the `new`, it relocates it** — an abstraction still needs one place, a composition root, that constructs the concrete implementation and hands it to everything else:

```java
OrderService service = new OrderService(new MySqlOrderRepository());
```

## Documentation Links

- [UnsupportedOperationException — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/UnsupportedOperationException.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
