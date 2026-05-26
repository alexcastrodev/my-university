# Controlling Flow with Branching

> Java provides `break`, `continue`, and `return` to alter the normal top-to-bottom execution of loops and methods. Labeled versions extend these to nested loop structures.

---

## break

`break` terminates the **innermost** enclosing loop or `switch` statement immediately:

```java
for (int i = 0; i < 10; i++) {
    if (i == 5) {
        break;   // exits the for loop
    }
    System.out.println(i);
}
// Output: 0  1  2  3  4
```

Execution continues at the first statement after the terminated loop.

---

## continue

`continue` skips the **remainder of the current iteration** and moves to the next one:

```java
for (int i = 0; i < 10; i++) {
    if (i % 2 == 0) {
        continue;   // skip even numbers
    }
    System.out.println(i);
}
// Output: 1  3  5  7  9
```

In a `while` or `do-while`, `continue` jumps directly to the condition check. In a `for` loop, it jumps to the **update expression** first, then checks the condition.

---

## return

`return` exits the **current method** entirely, optionally passing a value back to the caller:

```java
static int firstNegative(int[] values) {
    for (int v : values) {
        if (v < 0) {
            return v;   // exits the method immediately
        }
    }
    return -1;   // no negative found
}
```

`return` terminates not just the loop but the entire enclosing method, which makes it the strongest of the three branching statements.

---

## Comparing break, continue, and return

| Statement | Scope terminated | Execution resumes at |
|---|---|---|
| `break` | Innermost loop or `switch` | Statement after the loop/switch |
| `continue` | Current iteration only | Next iteration (update + condition) |
| `return` | Entire method | Caller of the method |

---

## Labeled Statements

A label is an identifier followed by a colon placed before a statement. Labels are most useful on **nested loops**:

```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        System.out.println(i + "," + j);
    }
}
```

By itself, a label has no effect. Its purpose is to be the target of a labeled `break` or `continue`.

---

## break with a Label

`break <label>` exits the labeled statement, not just the innermost one:

```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        if (j == 1) {
            break outer;   // exits the OUTER for loop
        }
        System.out.println(i + "," + j);
    }
}
// Output: 0,0
```

Without the label, `break` would only exit the inner loop and the outer loop would continue.

---

## continue with a Label

`continue <label>` skips to the **next iteration of the labeled loop**, bypassing any remaining iterations of inner loops:

```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        if (j == 1) {
            continue outer;   // skip rest of inner loop, advance outer i
        }
        System.out.println(i + "," + j);
    }
}
// Output: 0,0  1,0  2,0
```

---

## Label Placement Rules

Labels can be placed on any statement, but the OCP exam focuses on loops:

```java
search:
while (condition) {
    // ...
}
```

A label must appear **immediately before** the statement it names. A `break` or `continue` referencing a label must be **lexically inside** that labeled statement — labels are not jump targets that can be reached from anywhere (Java has no `goto`).

---

## Unreachable Code

Statements immediately following an unconditional `break`, `continue`, or `return` are unreachable and cause a **compile-time error**:

```java
for (int i = 0; i < 5; i++) {
    break;
    System.out.println(i);   // compile error: unreachable statement
}
```

```java
static void example() {
    return;
    System.out.println("Never");  // compile error: unreachable statement
}
```

---

## Practical Example: Search in 2D Array

```java
int[][] grid = {
    {1, 2, 3},
    {4, 5, 6},
    {7, 8, 9}
};
int target = 5;
boolean found = false;

search:
for (int row = 0; row < grid.length; row++) {
    for (int col = 0; col < grid[row].length; col++) {
        if (grid[row][col] == target) {
            found = true;
            break search;   // stop as soon as target is found
        }
    }
}

System.out.println("Found: " + found);  // Found: true
```

Without the labeled `break`, the inner `break` would only exit the inner loop, and the outer loop would continue unnecessarily.

---

## Key Rules to Remember

- `break` and `continue` without a label always affect the **innermost** enclosing loop or `switch`
- `continue` goes to the update expression in a `for` loop, then re-checks the condition
- A labeled `break` exits the labeled statement entirely; a labeled `continue` advances to the next iteration of the labeled loop
- Labels must be placed immediately before the statement they name
- Code after an unconditional `break`, `continue`, or `return` does not compile
- Java has no `goto` — labels are only valid targets for `break` and `continue`

---

## References

- [Oracle Docs — Branching Statements (Java 21)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/branch.html)
- [Java Language Specification — §14.15 The break Statement](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.15)
