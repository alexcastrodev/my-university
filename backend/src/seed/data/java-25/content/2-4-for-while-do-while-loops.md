---
version: 1.0
updatedAt: 2026-05-26
---
# for, while, and do-while Loops

---

## Overview

Java has three loop constructs:

| Loop | Best for |
|------|---------|
| `for` | Known number of iterations |
| `while` | Unknown iterations, test before body |
| `do-while` | Unknown iterations, body executes at least once |

---

## Basic for Loop

```java
for (initialization; condition; update) {
    // body
}
```

```java
for (int i = 0; i < 5; i++) {
    System.out.println(i);  // 0, 1, 2, 3, 4
}
```

- **Initialization** runs once before the loop starts.
- **Condition** is checked before each iteration; if `false`, the loop ends.
- **Update** runs after each iteration.

All three parts are optional:

```java
for (;;) {
    // infinite loop
}
```

Multiple variables and updates separated by commas:

```java
for (int i = 0, j = 10; i < j; i++, j--) {
    System.out.println(i + " " + j);
}
```

> **Scope:** Variables declared in the initialization clause exist only within the loop.

---

## Enhanced for Loop (for-each)

Iterates over arrays and `Iterable` collections without an index:

```java
int[] numbers = {1, 2, 3, 4, 5};

for (int n : numbers) {
    System.out.println(n);
}
```

```java
List<String> names = List.of("Alice", "Bob", "Carol");

for (String name : names) {
    System.out.println(name);
}
```

> The loop variable is a copy — modifying it does **not** change the original array element (for primitives).

---

## while Loop

```java
while (condition) {
    // body
}
```

```java
int count = 0;
while (count < 5) {
    System.out.println(count);
    count++;
}
```

The body may never execute if the condition is `false` from the start.

---

## do-while Loop

```java
do {
    // body
} while (condition);
```

```java
int count = 0;
do {
    System.out.println(count);
    count++;
} while (count < 5);
```

The body always executes **at least once**, then the condition is checked.

```java
// Typical use: input validation
Scanner sc = new Scanner(System.in);
int value;
do {
    System.out.print("Enter a positive number: ");
    value = sc.nextInt();
} while (value <= 0);
```

---

## Comparing the Three Loops

```java
// All three print 0..4

// for
for (int i = 0; i < 5; i++) System.out.println(i);

// while
int i = 0;
while (i < 5) { System.out.println(i); i++; }

// do-while
int j = 0;
do { System.out.println(j); j++; } while (j < 5);
```

---

## Infinite Loops

```java
while (true) { /* ... */ }
for (;;)     { /* ... */ }
do { /* ... */ } while (true);
```

Use `break` to exit, or `return`/`throw` from the enclosing method.

---

## Key Rules

| Rule | Detail |
|------|--------|
| Condition type | Must be `boolean` |
| `for` scope | Init variable scoped to the loop |
| `do-while` semicolon | Required after the closing `)` |
| Enhanced `for` | Works on arrays and `Iterable` — not `Iterator` directly |
| Modifying collection | Throws `ConcurrentModificationException` in enhanced `for` |
