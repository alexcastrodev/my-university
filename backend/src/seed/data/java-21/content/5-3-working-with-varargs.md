# Working with Varargs

> **OCP Exam Topic** — Understand variable-argument (varargs) parameters: syntax, placement rules, how to pass arguments, and how varargs interact with arrays. Covered in Chapter 5 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is a Varargs Parameter?

A **varargs** (variable-length arguments) parameter lets a method accept zero or more values of the same type without the caller needing to create an array explicitly. Inside the method body, the parameter behaves exactly like an array.

### Syntax

```java
returnType methodName(Type... parameterName)
```

The `...` (three dots) immediately follows the type and must appear before the parameter name. There must be no space between the type and `...` for clarity, although the compiler permits spaces.

```java
void printAll(String... words) {
    for (String word : words) {
        System.out.println(word);
    }
}
```

---

## Calling a Varargs Method

Callers can pass arguments in three ways:

**1. Pass individual values (most common)**

```java
printAll("apple", "banana", "cherry");
```

**2. Pass an explicit array**

```java
String[] fruits = {"apple", "banana"};
printAll(fruits);
```

**3. Pass nothing (zero arguments)**

```java
printAll();    // words.length == 0 inside the method; NOT null
```

All three forms are valid for the same method signature.

---

## Varargs as an Array Inside the Method

Within the method body, the varargs parameter is a regular array. You can use `.length`, index into it, iterate with an enhanced `for` loop, and pass it to other array-expecting methods:

```java
int sum(int... numbers) {
    int total = 0;
    for (int n : numbers) {
        total += n;
    }
    return total;
}

System.out.println(sum(1, 2, 3));      // 6
System.out.println(sum(10, 20));       // 30
System.out.println(sum());             // 0
```

---

## Placement Rules

The exam tests two strict rules about where a varargs parameter may appear:

**Rule 1: Varargs must be the last parameter.**

```java
// OK — varargs is last
void log(String label, int... values) { }

// Compile error — varargs is not last
// void log(int... values, String label) { }
```

**Rule 2: Only one varargs parameter is allowed per method.**

```java
// Compile error — two varargs parameters
// void combine(String... a, String... b) { }
```

These two rules together mean a varargs parameter can only ever appear once, at the end of the parameter list.

---

## Mixing Varargs with Other Parameters

When other parameters precede the varargs parameter, callers supply those first:

```java
void format(String prefix, int... numbers) {
    System.out.print(prefix + ": ");
    for (int n : numbers) System.out.print(n + " ");
    System.out.println();
}

format("Values", 1, 2, 3);    // Values: 1 2 3
format("Empty");               // Empty:
```

---

## Null and Ambiguity Warnings

Passing `null` directly to a varargs method is legal but can be ambiguous — the compiler may warn that `null` is passed where an array is expected:

```java
printAll(null);    // legal; words == null inside method — can cause NullPointerException
```

To suppress the ambiguity, cast explicitly:

```java
printAll((String) null);          // single null element in the array
printAll((String[]) null);        // the array reference itself is null
```

The exam can ask about the difference between passing `null` as the array vs as an element.

---

## Overloading and Varargs

A method with a varargs parameter can be overloaded:

```java
void display(int n)       { System.out.println("single: " + n); }
void display(int... nums) { System.out.println("varargs, length=" + nums.length); }

display(5);         // calls display(int n) — exact match preferred over varargs
display(5, 6);      // calls display(int... nums) — only varargs matches
display();          // calls display(int... nums)
```

Java prefers an exact-match overload over the varargs version when both are applicable.

---

## Key Points to Remember

- Varargs syntax is `Type... name`; the `...` signals zero-or-more arguments.
- The varargs parameter **must be last** in the parameter list.
- Only **one** varargs parameter is allowed per method.
- Inside the method, the parameter is a plain **array**.
- Callers may pass individual values, an explicit array, or nothing at all.
- Passing `null` makes the parameter `null` (not a one-element array); use an explicit cast to control the intent.
- When an overloaded exact match exists, the compiler prefers it over the varargs variant.
