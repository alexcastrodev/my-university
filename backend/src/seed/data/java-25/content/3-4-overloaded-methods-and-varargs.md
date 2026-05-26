# Overloaded Methods and var-args

---

## Method Overloading

Multiple methods in the same class can share a name if their **parameter lists differ** (number, type, or order of parameters):

```java
public class Printer {
    void print(int value)         { System.out.println(value); }
    void print(double value)      { System.out.println(value); }
    void print(String value)      { System.out.println(value); }
    void print(int x, int y)      { System.out.println(x + ", " + y); }
}
```

Return type alone is **not** sufficient to distinguish overloads — the compiler resolves calls based on the argument types at the call site.

---

## Overload Resolution Order

The compiler picks the most specific applicable method:

1. Exact match (no conversions)
2. Widening primitive conversion (`int` → `long` → `double`)
3. Autoboxing (`int` → `Integer`)
4. Varargs

```java
void go(long x)   { System.out.println("long"); }
void go(Integer x){ System.out.println("Integer"); }

go(5);  // prints "long"  — widening beats autoboxing
```

---

## var-args (Variable-Argument Methods)

A varargs parameter accepts zero or more arguments of the declared type:

```java
public int sum(int... numbers) {
    int total = 0;
    for (int n : numbers) total += n;
    return total;
}

sum();           // 0
sum(1);          // 1
sum(1, 2, 3);    // 6
sum(new int[]{4, 5}); // 9 — array is also accepted
```

### Rules

- Varargs is syntactic sugar for an array — `int... numbers` → `int[] numbers` in the method body.
- Must be the **last** parameter:

```java
void log(String level, String... messages)  { }  // valid
void log(String... messages, String level)  { }  // COMPILE ERROR
```

- Only **one** varargs parameter is allowed per method.
- A varargs method can be overloaded with a non-varargs version; the non-varargs version is preferred when applicable.

---

## Ambiguous Overloads

The compiler reports an error when two methods are equally applicable:

```java
void print(int x, String y)  { }
void print(String x, int y)  { }

print(1, "a");   // OK — matches first
print("a", 1);   // OK — matches second
print(1, 1);     // COMPILE ERROR — ambiguous
```

---

## Overloading vs Overriding

| | Overloading | Overriding |
|-|------------|-----------|
| Location | Same class (or subclass) | Subclass only |
| Signature | Must differ | Must match exactly |
| Resolved | Compile time | Runtime (polymorphism) |
| Return type | Can differ | Must be same or covariant |
| `@Override` | Not applicable | Recommended |

---

## Practical Example

```java
public class MathUtils {
    // overloaded — different parameter types
    public static int    abs(int x)    { return x < 0 ? -x : x; }
    public static double abs(double x) { return x < 0 ? -x : x; }

    // varargs
    public static int max(int first, int... rest) {
        int result = first;
        for (int n : rest) if (n > result) result = n;
        return result;
    }
}

MathUtils.abs(-5);      // int overload
MathUtils.abs(-3.14);   // double overload
MathUtils.max(3, 1, 4, 1, 5, 9);  // 9
```
