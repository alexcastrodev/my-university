---
version: 1.0
updatedAt: 2026-05-26
---
# Multi-catch and Custom Exceptions

---

## Multi-catch

A single `catch` block can handle multiple exception types with `|`:

```java
try {
    process();
} catch (IOException | SQLException e) {
    log("Data error: " + e.getMessage());
}
```

- The variable `e` is implicitly **final** inside a multi-catch block — it cannot be reassigned.
- The types must not be in an inheritance relationship (would be a compile error):

```java
catch (IOException | FileNotFoundException e) { }  // COMPILE ERROR — FileNotFoundException extends IOException
```

---

## Rethrowing with Precise Type Inference

When a caught exception is rethrown and the compiler can determine its precise type, the `throws` declaration can be more specific:

```java
void process() throws IOException, SQLException {
    try {
        riskyOperation();
    } catch (Exception e) {
        log(e);
        throw e;   // compiler infers IOException | SQLException, not Exception
    }
}
```

---

## Custom Checked Exception

Extend `Exception` (or a checked subclass):

```java
public class InsufficientFundsException extends Exception {

    private final double amount;

    public InsufficientFundsException(double amount) {
        super("Insufficient funds: need " + amount + " more");
        this.amount = amount;
    }

    public double getAmount() { return amount; }
}
```

Usage:

```java
void withdraw(double amount) throws InsufficientFundsException {
    if (amount > balance) throw new InsufficientFundsException(amount - balance);
    balance -= amount;
}
```

---

## Custom Unchecked Exception

Extend `RuntimeException`:

```java
public class ConfigurationException extends RuntimeException {

    public ConfigurationException(String message) {
        super(message);
    }

    public ConfigurationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

The two-argument form preserves the original cause (useful for wrapping lower-level exceptions).

---

## Exception Chaining

Wrapping one exception inside another preserves the root cause:

```java
try {
    Files.readString(path);
} catch (IOException e) {
    throw new ConfigurationException("Cannot read config file", e);  // e is the cause
}
```

```java
catch (ConfigurationException e) {
    System.out.println("Cause: " + e.getCause());
}
```

---

## Best Practices

| Practice | Reason |
|----------|--------|
| Catch specific types first | Avoid swallowing unexpected exceptions |
| Include the cause when wrapping | Preserves the full root-cause chain |
| Use checked exceptions for recoverable conditions | Forces callers to handle them |
| Use unchecked for programming errors | `IllegalArgumentException`, `IllegalStateException` |
| Never catch `Throwable`/`Error` in normal code | JVM errors should propagate |

---

## Common Standard Exceptions to Know

| Exception | Type | Thrown when |
|-----------|------|------------|
| `NullPointerException` | Unchecked | Dereferencing `null` |
| `ArrayIndexOutOfBoundsException` | Unchecked | Array index out of range |
| `ClassCastException` | Unchecked | Invalid downcast |
| `ArithmeticException` | Unchecked | Division by zero (integers) |
| `IllegalArgumentException` | Unchecked | Invalid method argument |
| `IllegalStateException` | Unchecked | Object in wrong state |
| `UnsupportedOperationException` | Unchecked | Operation not supported |
| `IOException` | Checked | I/O failure |
| `FileNotFoundException` | Checked | File does not exist |
| `NumberFormatException` | Unchecked | `Integer.parseInt("abc")` |
| `StackOverflowError` | Error | Infinite recursion |
