# Writing while Loops

> The `while` and `do-while` loops repeat a block of code as long as a boolean condition holds. They are the right tool when the number of iterations is not known in advance.

---

## The while Loop

A `while` loop evaluates its condition **before** each iteration. If the condition is `false` on the very first check, the body never runs:

```java
int count = 0;

while (count < 5) {
    System.out.println("count = " + count);
    count++;
}
// Prints: count = 0, 1, 2, 3, 4
```

**Execution flow:**
1. Evaluate the condition
2. If `true`, execute the body and go to step 1
3. If `false`, exit the loop

---

## Zero-Iteration Example

Because the condition is checked first, a `while` loop can execute zero times:

```java
int x = 10;

while (x < 5) {           // false immediately
    System.out.println(x);
}
System.out.println("Done");  // runs immediately
```

This is a key difference from `do-while`.

---

## The do-while Loop

A `do-while` loop evaluates its condition **after** each iteration. The body always executes **at least once**:

```java
int count = 0;

do {
    System.out.println("count = " + count);
    count++;
} while (count < 5);
// Prints: count = 0, 1, 2, 3, 4
```

Note the semicolon after the closing condition — it is **required**.

### Guaranteed One-Time Execution

```java
int input = 10;

do {
    System.out.println("Body always runs once: " + input);
} while (input < 5);   // condition is false, but body already ran
// Output: Body always runs once: 10
```

---

## Comparing while vs do-while

| Feature | `while` | `do-while` |
|---|---|---|
| Condition check | Before each iteration | After each iteration |
| Minimum iterations | 0 | 1 |
| Body runs when condition starts false | No | Yes (once) |
| Trailing semicolon required | No | Yes |

---

## Common Use Cases

**Reading user input until valid:**

```java
Scanner scanner = new Scanner(System.in);
String input;

do {
    System.out.print("Enter a non-empty string: ");
    input = scanner.nextLine();
} while (input.isEmpty());
```

**Waiting for a condition to become true:**

```java
int retries = 0;
boolean success = false;

while (!success && retries < 3) {
    success = attemptConnection();
    retries++;
}
```

---

## Infinite Loop Risk

If the condition never becomes `false`, the loop runs forever. This is sometimes intentional (server event loops) but is usually a bug:

```java
// BUG: count is never incremented
int count = 0;
while (count < 5) {
    System.out.println(count);
    // forgot: count++;
}
```

Common causes of unintentional infinite loops:

| Cause | Example |
|---|---|
| Forgetting to update the loop variable | `while (i < 10) { doWork(); }` |
| Updating the wrong variable | `while (i < 10) { j++; }` |
| Condition can never be `false` | `while (true) { }` without a `break` |

---

## Intentional Infinite Loops

An explicit `while (true)` loop is acceptable when an internal `break` or `return` provides the exit:

```java
while (true) {
    String line = readLine();
    if (line == null) {
        break;   // exit when input is exhausted
    }
    process(line);
}
```

---

## Variable Scope Inside Loops

Variables declared inside a loop body are created and destroyed each iteration:

```java
while (condition) {
    int temp = compute();   // new variable each iteration
    System.out.println(temp);
}
// temp is not accessible here
```

Variables declared before the loop are accessible inside it and retain their value between iterations:

```java
int sum = 0;
int i = 1;

while (i <= 10) {
    sum += i;
    i++;
}
System.out.println(sum);  // 55
```

---

## Key Rules to Remember

- `while` checks the condition before the body — zero iterations are possible
- `do-while` checks the condition after the body — the body always runs at least once
- The semicolon after `} while (condition)` is mandatory in `do-while`
- The condition must be a `boolean` expression
- Always ensure the loop variable moves toward the exit condition to avoid infinite loops

---

## References

- [Oracle Docs — The while and do-while Statements (Java 21)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/while.html)
- [Java Language Specification — §14.12 The while Statement](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.12)
