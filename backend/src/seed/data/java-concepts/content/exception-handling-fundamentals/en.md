---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Exception handling is Java's structured mechanism for dealing with run-time errors: instead of a method returning an error code that every caller must remember to check, a failing operation creates an exception object and *throws* it, transferring control to the nearest code that knows how to handle that specific kind of failure. The whole mechanism is built from five keywords — `try`, `catch`, `throw`, `throws`, and `finally` — and every exception, whether thrown by the JVM itself or by application code, is an object descending from `java.lang.Throwable`.

## Use Cases

- Guarding a block of code that can fail at run time (division, array access, parsing, I/O) instead of manually checking preconditions before every risky operation.
- Distinguishing recoverable, expected failure conditions (checked `Exception` subclasses) from programming bugs the caller isn't expected to plan for (unchecked `RuntimeException` subclasses).
- Guaranteeing that cleanup code (closing a file, releasing a lock) runs whether the protected code succeeds, fails, or returns early, via `finally` or try-with-resources.
- Defining a custom exception subclass to signal a failure condition specific to your own application's domain, rather than overloading a generic built-in exception.
- Preserving a low-level root cause (e.g., an I/O failure) while raising a higher-level, more meaningful exception at an API boundary, via chained exceptions.

## Deep Dive

### try/catch and control flow

Code that might fail is wrapped in a `try` block; a `catch` clause immediately after it names the exception type it knows how to handle:

```java
class Exc2 {
  public static void main(String[] args) {
    int d, a;

    try { // monitor a block of code.
      d = 0;
      a = 42 / d;
      System.out.println("This will not be printed.");
    } catch (ArithmeticException e) { // catch divide-by-zero error
      System.out.println("Division by zero.");
    }

    System.out.println("After catch statement.");
  }
}
```

Output:

```
Division by zero.
After catch statement.
```

Once `42 / d` throws, control jumps straight to the matching `catch` — the rest of the `try` block (the `println` right after the division) never runs. `catch` is not *called* the way a method is, so execution never returns to the point in the `try` block where the exception was thrown; it resumes after the whole `try`/`catch` unit. The code monitored by `try` must be a block (`{ }`) — you cannot attach `try` to a single statement.

### Multiple catch clauses and ordering

A `try` can be followed by several `catch` clauses, each for a different exception type; the first one whose type matches the thrown exception runs, and the rest are skipped:

```java
catch (ArithmeticException e) {
  System.out.println("Divide by 0: " + e);
} catch (ArrayIndexOutOfBoundsException e) {
  System.out.println("Array index oob: " + e);
}
```

Order matters: a `catch` for a supertype intercepts every subtype that would otherwise reach a more specific `catch` below it, and the compiler treats that later, now-unreachable `catch` as an error rather than silently ignoring it:

```java
class SuperSubCatch {
  public static void main(String[] args) {
    try {
      int a = 0;
      int b = 42 / a;
    } catch (Exception e) {
      System.out.println("Generic Exception catch.");
    }
    // This catch is never reached because
    // ArithmeticException is a subclass of Exception.
    catch (ArithmeticException e) { // ERROR — unreachable
      System.out.println("This is never reached.");
    }
  }
}
```

This fails to compile with an unreachable-code error. Subclasses must always be listed before their superclasses.

### Nested try statements

A `try` can sit inside the block of another `try` (directly, or indirectly through a method call). If the inner `try` has no matching `catch`, the exception propagates outward to the next enclosing `try`'s handlers, and so on, until one matches or the default handler takes over:

```java
class NestTry {
  public static void main(String[] args) {
    try {
      int a = args.length;
      int b = 42 / a; // throws if no args given

      System.out.println("a = " + a);

      try { // nested try block
        if (a == 1) a = a / (a - a);      // divide by zero
        if (a == 2) {
          int[] c = { 1 };
          c[42] = 99;                     // out-of-bounds
        }
      } catch (ArrayIndexOutOfBoundsException e) {
        System.out.println("Array index out-of-bounds: " + e);
      }

    } catch (ArithmeticException e) {
      System.out.println("Divide by 0: " + e);
    }
  }
}
```

With zero command-line args, the *outer* `try` throws (dividing by `args.length`, which is `0`); with one arg, the inner `try` throws a divide-by-zero that it doesn't catch, so it's caught by the outer `catch(ArithmeticException e)`; with two args, the inner `try` throws an out-of-bounds exception that its own `catch` handles directly.

### throw, throws, and the checked/unchecked split

`throw` raises an exception explicitly — either one you just constructed, or one you caught and want to pass along (rethrow):

```java
class ThrowDemo {
  static void demoproc() {
    try {
      throw new NullPointerException("demo");
    } catch (NullPointerException e) {
      System.out.println("Caught inside demoproc.");
      throw e; // rethrow the exception
    }
  }

  public static void main(String[] args) {
    try {
      demoproc();
    } catch (NullPointerException e) {
      System.out.println("Recaught: " + e);
    }
  }
}
```

Every `Throwable` sits under one of two branches: `Exception`, for conditions a program is expected to catch and handle (the branch you subclass for your own exceptions), and `Error`, for JVM/run-time environment failures (like `StackOverflowError`) that normal code isn't expected to catch. Within `Exception`, `RuntimeException` and its subclasses are **unchecked** — the compiler never forces you to catch or declare them, because they typically signal a programming bug (bad array index, `null` dereference, division by zero). Every other `Exception` subclass is **checked**: if a method can throw one and doesn't catch it, the method must declare it with `throws`, or the code fails to compile:

```java
// This program contains an error and will not compile.
class ThrowsDemo {
  static void throwOne() {
    System.out.println("Inside throwOne.");
    throw new IllegalAccessException("demo"); // checked exception, not declared
  }
  public static void main(String[] args) {
    throwOne();
  }
}
```

Declaring the checked exception on `throwOne()` and handling it in `main` fixes it:

```java
class ThrowsDemo {
  static void throwOne() throws IllegalAccessException {
    System.out.println("Inside throwOne.");
    throw new IllegalAccessException("demo");
  }
  public static void main(String[] args) {
    try {
      throwOne();
    } catch (IllegalAccessException e) {
      System.out.println("Caught " + e);
    }
  }
}
```

### finally: guaranteed cleanup

A `finally` block always runs after its `try`/`catch` finishes, no matter how it finishes — normal completion, an uncaught exception propagating out, or an explicit `return`:

```java
class FinallyDemo {
  static void procA() { // exception propagates out of the method
    try {
      System.out.println("inside procA");
      throw new RuntimeException("demo");
    } finally {
      System.out.println("procA's finally");
    }
  }

  static void procB() { // return from inside a try block
    try {
      System.out.println("inside procB");
      return;
    } finally {
      System.out.println("procB's finally");
    }
  }

  static void procC() { // try block runs normally, no error
    try {
      System.out.println("inside procC");
    } finally {
      System.out.println("procC's finally");
    }
  }
}
```

All three exit paths run their `finally` block before actually leaving: `procA`'s `finally` executes on the way out as the `RuntimeException` propagates, `procB`'s runs before the `return` actually hands control back to the caller, and `procC`'s runs even though nothing went wrong. `finally` is optional, but every `try` needs at least one `catch` or a `finally`.

### Custom exception subclasses

Defining your own exception is just subclassing `Exception` (or one of its subclasses) — there's nothing to implement, the type itself is what makes it usable in `throw`/`catch`:

```java
class MyException extends Exception {
  private int detail;

  MyException(int a) {
    detail = a;
  }

  public String toString() {
    return "MyException[" + detail + "]";
  }
}

class ExceptionDemo {
  static void compute(int a) throws MyException {
    System.out.println("Called compute(" + a + ")");
    if (a > 10)
      throw new MyException(a);
    System.out.println("Normal exit");
  }

  public static void main(String[] args) {
    try {
      compute(1);
      compute(20);
    } catch (MyException e) {
      System.out.println("Caught " + e);
    }
  }
}
```

`MyException` overrides `toString()` (inherited from `Throwable` through `Exception`) so that `println(e)` and string concatenation print a clean, tailored message instead of the default `ClassName: message` format.

### Chained exceptions: preserving the root cause

Sometimes the exception a method must throw isn't the actual root cause — chained exceptions let you attach an underlying cause to the exception you throw, via `Throwable(String, Throwable)` / `Throwable(Throwable)` constructors, or `initCause()` when the cause wasn't set at construction time:

```java
class ChainExcDemo {
  static void demoproc() {
    // create an exception
    NullPointerException e =
      new NullPointerException("top layer");

    // add a cause
    e.initCause(new ArithmeticException("cause"));

    throw e;
  }

  public static void main(String[] args) {
    try {
      demoproc();
    } catch (NullPointerException e) {
      // display top level exception
      System.out.println("Caught: " + e);
      // display cause exception
      System.out.println("Original cause: " + e.getCause());
    }
  }
}
```

`getCause()` returns `null` if no cause was ever set, and a cause can be attached only once per exception — a second `initCause()` call throws `IllegalStateException`, and calling it at all is unnecessary (and rejected) if the cause was already supplied through a constructor. Chains can run arbitrarily deep, but an overly long chain is usually a sign the layering is too deep to be useful.

### Modern additions: multi-catch and try-with-resources (Java 7+)

Everything above is essentially unchanged since Java 1.0. JDK 7 added two features that trim boilerplate around that original mechanism. Multi-catch lets one `catch` clause handle several unrelated exception types with a shared handler, separated by `|`:

```java
class MultiCatch {
  public static void main(String[] args) {
    int a = 10, b = 0;
    int[] vals = { 1, 2, 3 };

    try {
      int result = a / b; // generates an ArithmeticException
      // vals[10] = 19;   // would generate an ArrayIndexOutOfBoundsException
    } catch (ArithmeticException | ArrayIndexOutOfBoundsException e) {
      System.out.println("Exception caught: " + e);
    }

    System.out.println("After multi-catch.");
  }
}
```

Each multi-catch parameter is implicitly `final`. Try-with-resources automates closing anything that implements `AutoCloseable`, replacing a manual `finally { resource.close(); }` block:

```java
try (BufferedReader br = new BufferedReader(new FileReader("test.txt"))) {
  String line = br.readLine();
  System.out.println(line);
} catch (IOException e) {
  System.out.println("I/O error: " + e);
}
```

`br` is declared inside the `try`'s parentheses, and the JVM closes it automatically when the block exits — normally or via an exception — without an explicit `finally`.

## Trade-offs

- **Checked exceptions push a decision onto every caller** — a checked exception on a method's `throws` clause forces every caller up the chain to either catch it or re-declare it, which is exactly the compile-time safety net that keeps call sites honest about failure — but on a large API surface it also means a low-level implementation detail can ripple through unrelated layers of the call stack as boilerplate `throws` clauses or empty `catch` blocks.
- **Catching broadly (`Exception` or `Throwable`) trades precision for convenience** — a single broad `catch` is fewer lines, but it also silently absorbs bugs the code never anticipated:
  ```java
  try {
      riskyOperation();       // meant to guard an ArithmeticException
  } catch (Exception e) {     // also swallows an unrelated NullPointerException bug
      log("operation failed");
  }
  ```
- **Multi-catch parameters are implicitly final** — sharing one handler across types means that handler can't treat the parameter as a mutable local:
  ```java
  catch (IOException | SQLException e) {
      e = null; // error: multi-catch parameter e is implicitly final
  }
  ```
- **try-with-resources avoids the exception-masking a manual `finally`-close can cause** — if the `try` block throws and a manual `close()` inside `finally` throws too, the original exception is lost, replaced by the one from `close()`; try-with-resources instead keeps the original exception and attaches the close failure as a suppressed exception, reachable via `getSuppressed()`.
- **Exceptions are not a general control-flow tool** — throwing and catching costs more than a plain conditional (constructing a `Throwable` captures a stack trace), and using exceptions to route ordinary, expected outcomes makes the logic harder to follow than an `if`/`return` would; reserve them for conditions that are genuinely exceptional.

## Documentation Links

- [Exception (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html) — doc
- [Throwable (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html) — doc
- [The try-with-resources Statement — The Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html) — doc
- [Chapter 11. Exceptions — The Java Language Specification](https://docs.oracle.com/javase/specs/jls/se21/html/jls-11.html) — doc
