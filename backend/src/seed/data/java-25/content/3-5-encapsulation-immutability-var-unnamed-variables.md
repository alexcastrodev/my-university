# Encapsulation, Immutability, var, and Unnamed Variables

---

## Encapsulation

Encapsulation hides internal state and exposes controlled access through methods:

```java
public class BankAccount {
    private double balance;   // hidden state

    public double getBalance() { return balance; }

    public void deposit(double amount) {
        if (amount > 0) balance += amount;
    }

    public void withdraw(double amount) {
        if (amount > 0 && amount <= balance) balance -= amount;
    }
}
```

**Benefits:** invariants enforced in one place; internal representation can change without affecting callers.

### JavaBeans Convention

| Pattern | Example |
|---------|---------|
| Getter | `getBalance()` |
| Boolean getter | `isActive()` |
| Setter | `setBalance(double)` |

---

## Immutability

An immutable object's state cannot change after construction. To make a class immutable:

1. Declare the class `final` (prevents subclassing).
2. Declare all fields `private final`.
3. Initialise all fields in the constructor.
4. Return defensive copies of mutable fields.
5. Provide no setters.

```java
public final class Money {
    private final int cents;
    private final String currency;

    public Money(int cents, String currency) {
        this.cents    = cents;
        this.currency = currency;
    }

    public int getCents()       { return cents; }
    public String getCurrency() { return currency; }

    public Money add(Money other) {
        // returns new object rather than mutating this
        return new Money(this.cents + other.cents, this.currency);
    }
}
```

`String`, `Integer`, and all wrapper types are immutable. Records are immutable by design.

---

## var — Local Variable Type Inference

`var` lets the compiler infer the type of a local variable from the initialiser (Java 10+):

```java
var name    = "Alice";                 // inferred: String
var count   = 42;                      // inferred: int
var list    = new ArrayList<String>(); // inferred: ArrayList<String>
var entry   = map.entrySet().iterator().next(); // inferred: Map.Entry<K,V>
```

### var Restrictions

| Not allowed | Reason |
|-------------|--------|
| `var x;` | No initialiser to infer from |
| `var x = null;` | Cannot infer from null |
| Field declarations | Only local variables |
| Method parameters | Only local variables |
| Return types | Only local variables |
| `var x = {1, 2}` | Array initialiser shorthand not allowed |

```java
// Allowed
for (var entry : map.entrySet()) { }
try (var reader = new BufferedReader(...)) { }

// Not allowed
private var name = "Alice";   // compile error — fields not allowed
```

---

## Unnamed Variables (`_`)

**JEP 456** (Java 22, finalized Java 22) — Use `_` when a variable is required syntactically but the value is not needed:

```java
// catch block — exception object unused
try {
    riskyOperation();
} catch (IOException _) {
    System.out.println("IO error occurred");
}

// enhanced for — index not needed, only iteration
for (var _ : list) {
    count++;
}

// pattern matching — component not used
if (obj instanceof Point(double x, double _)) {
    System.out.println("x = " + x);
}
```

### Unnamed Patterns in switch

```java
switch (shape) {
    case Circle c    -> System.out.println("circle, r=" + c.radius());
    case Rectangle _ -> System.out.println("a rectangle");
    default          -> System.out.println("other");
}
```

> `_` cannot be read; it is write-only by design. Multiple `_` in the same scope is allowed.

---

## Key Rules Summary

| Concept | Key point |
|---------|-----------|
| Encapsulation | `private` fields + public accessors |
| Immutability | `final` class, `final` fields, defensive copies |
| `var` | Local variables only; type inferred at compile time |
| `_` | Unnamed variable; syntactic placeholder, value discarded |
