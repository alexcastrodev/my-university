# Interacting with Users

> Console I/O in Java involves the three standard streams (`System.in`, `System.out`, `System.err`) and the higher-level `Console` class. The OCP exam tests when each is appropriate, the unique capabilities of `Console` (especially `readPassword`), and how to use `Scanner` for interactive input.

---

## The Three Standard Streams

Java exposes the operating system's standard I/O channels as static fields on `java.lang.System`.

| Field | Type | Direction | Purpose |
|---|---|---|---|
| `System.in` | `InputStream` | Input | Reading from the keyboard / stdin |
| `System.out` | `PrintStream` | Output | Normal program output / stdout |
| `System.err` | `PrintStream` | Output | Error and diagnostic messages / stderr |

```java
System.out.println("Normal output");
System.err.println("Something went wrong!");  // typically appears in red in IDEs

// Redirecting — you can replace these streams
System.setOut(new PrintStream(new FileOutputStream("/tmp/out.log")));
System.setErr(new PrintStream(new FileOutputStream("/tmp/err.log")));
System.setIn(new FileInputStream("/tmp/input.txt"));
```

`System.out` and `System.err` are both `PrintStream` instances and behave identically in terms of API. The difference is purely semantic: `System.err` is for diagnostics, and shells/containers can redirect them independently.

---

## Flushing Output

`System.out` may buffer output. Use `flush()` to force buffered data to the terminal, especially when prompting for input without a trailing newline.

```java
System.out.print("Enter your name: ");
System.out.flush();   // ensure prompt is visible before blocking on read
```

`println()` flushes automatically on `PrintStream` when auto-flush is enabled (the default for `System.out`).

---

## Reading from `System.in` with `Scanner`

`Scanner` is the most convenient way to read structured input from the console.

```java
Scanner sc = new Scanner(System.in);

System.out.print("Enter your age: ");
int age = sc.nextInt();

System.out.print("Enter your name: ");
sc.nextLine();   // consume leftover newline after nextInt()
String name = sc.nextLine();

System.out.printf("Hello, %s! You are %d years old.%n", name, age);
```

> **Important:** After calling `nextInt()`, `nextDouble()`, or similar typed methods, the line terminator is left in the buffer. Call `sc.nextLine()` to consume it before the next `nextLine()` call.

```java
// Safe pattern: read everything as lines, then parse
System.out.print("Enter a number: ");
int n = Integer.parseInt(sc.nextLine().trim());
```

---

## The `Console` Class

`java.io.Console` provides a higher-level API for interacting with the terminal. Its key advantage is `readPassword()`, which reads input without echoing characters to the screen.

```java
Console console = System.console();

if (console == null) {
    throw new IllegalStateException(
        "No console available — run from a terminal, not an IDE");
}

String username = console.readLine("Username: ");
char[] password = console.readPassword("Password: ");

// Process credentials...

// Clear the password from memory as soon as possible
java.util.Arrays.fill(password, '\0');
```

`readPassword()` returns `char[]` rather than `String` for a security reason: `String` objects are immutable and interned, meaning the plaintext password could linger in the heap. With `char[]`, you can explicitly zero out the array.

---

## `Console` vs. `Scanner`

| Feature | `Console` | `Scanner(System.in)` |
|---|---|---|
| Available in IDEs | No (returns `null`) | Yes |
| Masking password input | Yes (`readPassword`) | No |
| Formatted prompts | Yes (`readLine(fmt, args)`) | No (use `System.out.print`) |
| Parsing typed values | No (returns `String`) | Yes (`nextInt`, `nextDouble`, …) |
| Thread-safe | Yes | No |

Use `Console` when you need secure password input in a production terminal application. Use `Scanner` for general interactive programs and test environments.

---

## Console Formatting

`Console` provides `printf` and `format` methods (they are identical) for formatted output:

```java
Console console = System.console();
console.printf("Processing file %d of %d...%n", current, total);
console.format("Result: %.2f%n", result);
```

`readLine` also accepts a format string for the prompt:

```java
String city = console.readLine("Enter city for %s: ", "weather report");
```

---

## Practical Pattern: Defensive Console Access

Since `System.console()` returns `null` in many environments (redirected I/O, IDEs, CI pipelines), always guard against null before using it:

```java
public static String promptForInput(String prompt) {
    Console console = System.console();
    if (console != null) {
        return console.readLine(prompt);
    }
    // Fallback for non-interactive environments
    System.out.print(prompt);
    return new Scanner(System.in).nextLine();
}
```

---

## Key Rules Summary

- `System.out` is for normal output; `System.err` is for errors — they can be redirected independently.
- `System.console()` returns `null` when not connected to a real terminal (IDE, redirected I/O).
- `readPassword()` returns `char[]` and suppresses echo — the recommended way to handle passwords.
- After `nextInt()` / `nextDouble()`, always consume the trailing newline with `nextLine()`.
- Zero out `char[]` password arrays after use to minimize exposure in memory.

---

## References

- [Oracle Docs — Console](https://docs.oracle.com/en/java/docs/api/java.base/java/io/Console.html)
- [Oracle Docs — System](https://docs.oracle.com/en/java/docs/api/java.base/java/lang/System.html)
- OCP Study Guide, Chapter 14 — I/O
