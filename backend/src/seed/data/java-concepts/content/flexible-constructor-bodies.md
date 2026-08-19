---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

For most of Java's history a constructor body had to *begin* with `super(...)` or `this(...)`, so validation and argument preparation had to be smuggled into a static helper method or into the argument list itself. **Flexible constructor bodies** (JEP 513, finalized in JDK 25) drop that syntactic rule: statements may now appear before the explicit constructor invocation. Those statements form the constructor's *prologue*; everything after the invocation is the *epilogue*. Prologue code runs in an *early construction context*, where it may not touch the object under construction — with one deliberate exception: it may assign fields declared in its own class that have no initializers. That exception is what lets a subclass fully initialize itself *before* a superclass constructor can observe it.

## Use Cases

- Failing fast on invalid arguments before doing the potentially wasted work of running the superclass constructor.
- Computing a non-trivial value once and using it for several superclass constructor arguments, instead of a chain of static helpers.
- Initializing subclass fields *before* `super(...)`, so a superclass constructor that calls an overridable method cannot observe them as `null` or `0`.
- Normalizing or transforming an argument (trim, parse, clamp, default) in readable statement form rather than nested inside the `super(...)` call.
- Validating a non-canonical `record` constructor's arguments before delegating to the canonical one with `this(...)`.
- Replacing the `super(..., verifyAge(age))` idiom, where a `private static` helper existed only to satisfy the old rule.

## Deep Dive

### The old restriction and the static-helper workaround

Suppose `Person` accepts any non-negative age, but an `Employee` must be 18 to 67. Under the old rule the check could only run *after* the superclass constructor:

```java
class Employee extends Person {
    Employee(int age) {
        super(age);                 // potentially unnecessary work runs first
        if (age < 18 || age > 67)
            throw new IllegalArgumentException("age out of range: " + age);
    }
}
```

To fail fast, you had to hoist the check into a `static` method and inline the call as an argument:

```java
class Employee extends Person {
    private static int verifyAge(int value) {
        if (value < 18 || value > 67)
            throw new IllegalArgumentException("age out of range: " + value);
        return value;
    }
    Employee(int age) {
        super(verifyAge(age));      // the only place code could run
    }
}
```

On JDK 25 the check is just a statement:

```java
class Employee extends Person {
    Employee(int age) {
        if (age < 18 || age > 67)
            throw new IllegalArgumentException("age out of range: " + age);
        super(age);                 // now fails fast, no helper needed
    }
}
```

This is standard language, not a preview. It compiles with a plain `javac Employee.java` — no `--enable-preview`. Targeting an older release is what fails:

```
$ javac --release 24 Fcb.java
error: flexible constructors is not supported in -source 24
  (use -source 25 or higher to enable flexible constructors)
```

### Prologue, epilogue, and the new execution order

A constructor body now has two phases. The **prologue** is the code before the explicit constructor invocation; the **epilogue** is the code after it.

```java
class D extends C {
    D() {
        // D prologue
        super();
        // D epilogue
    }
}
```

Prologues run bottom-up as the constructors are invoked, then the epilogues run top-down as they return:

```
D prologue
--> C prologue
    --> B prologue
        --> A prologue
            --> Object constructor body
        --> A epilogue
    --> B epilogue
--> C epilogue
D epilogue
```

If a constructor has no explicit invocation, an implicit `super()` is still considered to sit at the very beginning, so the whole body is epilogue and the prologue is empty. Existing code therefore behaves exactly as before.

### Initializing fields before super(...) — the safety win

The classic trap: a superclass constructor calls a method the subclass overrides, and the override reads a subclass field that has not been assigned yet.

```java
class Person {
    final int age;
    void show() { System.out.println("Age: " + age); }
    Person(int age) {
        if (age < 0) throw new IllegalArgumentException("negative age");
        this.age = age;
        show();                     // calls the override in Employee
    }
}

class Employee extends Person {
    String officeID;
    Employee(int age, String officeID) {
        super(age);
        this.officeID = officeID;   // too late — show() already ran
    }
    @Override void show() { System.out.println("Age: " + age + ", Office: " + officeID); }
}
```

`new Employee(42, "CAM-FORA")` prints `Age: 42, Office: null`. Moving the assignment into the prologue fixes it:

```java
class Employee extends Person {
    String officeID;
    Employee(int age, String officeID) {
        if (age < 18 || age > 67)
            throw new IllegalArgumentException("age out of range: " + age);
        this.officeID = officeID;   // assigned BEFORE super(...)
        super(age);
    }
    @Override void show() { System.out.println("Age: " + age + ", Office: " + officeID); }
}
```

```
Age: 42, Office: CAM-FORA
caught: age out of range: 9
```

Calling overridable methods from a constructor is still bad practice, but a subclass can now defend itself against a superclass that does it.

### Early construction context: what the prologue may not do

The prologue and the explicit invocation's argument list together form an **early construction context**. Code there must not use `this`, explicitly or implicitly. The only permitted use of the instance is a *simple assignment* to a field declared in the same class whose declaration has no initializer:

```java
public class X1 {
    int i;
    String s = "hello";
    X1() {
        i = 42;                  // OK - uninitialized declared field
        s = "goodbye";           // error: cannot assign initialized field 's'
                                 //        before supertype constructor has been called
        super();
    }
}
```

Every other touch of the instance is rejected:

```java
public class X2 {
    int i;
    X2(int n) {
        System.out.println(this);   // error: cannot reference this before supertype constructor...
        var x = this.i;             // error: cannot reference this ...
        var y = i;                  // error: cannot reference i ...
        hashCode();                 // error: cannot reference hashCode() ...
        super();
    }
}
```

`super` is off-limits too, since the superclass fields do not exist yet:

```java
class Y3 { int i; void m() {} }
public class X3 extends Y3 {
    X3() {
        var x = super.i;   // error: cannot reference super before supertype constructor has been called
        super.m();         // error: cannot reference super ...
        super();
    }
}
```

A `return` statement is legal in the epilogue but not in the prologue:

```java
public class X5 {
    X5(int n) {
        if (n < 0) return;
        super();
    }
}
// error: 'return' not allowed before explicit constructor invocation
```

Throwing, on the other hand, is explicitly fine in the prologue — that is the whole point of fail-fast.

### Nested classes: the enclosing instance is fair game

An inner class's enclosing instance already exists before the inner instance is created, so the prologue *may* use it — by simple name or via `Outer.this`:

```java
class Outer {
    int i = 5;
    void hello() { System.out.println("Hello from outer"); }
    class Inner {
        int j;
        Inner() {
            var x = i;               // OK - field of the enclosing instance
            var y = Outer.this.i;    // OK - explicitly qualified
            hello();                 // OK - method of the enclosing instance
            super();
            this.j = x + y;          // epilogue: `this` is now usable
        }
    }
}
// prints "Hello from outer", then 10
```

The mirror case is forbidden. Inside `Outer`'s own constructor, `new Inner()` really means `this.new Inner()`, and `this` is not available yet:

```java
public class X4 {
    class Inner {}
    X4() {
        var x = new Inner();
        super();
    }
}
// error: cannot reference this before supertype constructor has been called
```

### Records and enums

A canonical record constructor still must not contain an explicit constructor invocation at all, so the prologue/epilogue split does not apply to it:

```java
public record Canon(int v) {
    public Canon(int v) {
        if (v < 0) throw new IllegalArgumentException();
        super();
        this.v = v;
    }
}
// error: invalid canonical constructor in record Canon
//   (canonical constructor must not contain explicit constructor invocation)
```

Non-canonical record constructors *do* benefit, because they delegate with `this(...)` and can now validate first:

```java
public record Range(int lo, int hi) {
    Range(int hi) {
        if (hi < 0) throw new IllegalArgumentException("negative: " + hi);
        this(0, hi);
    }
}

new Range(5);    // Range[lo=0, hi=5]
new Range(-1);   // caught: negative: -1
```

Enum constructors gain the same thing for their `this(...)` delegations; they still cannot invoke a superclass constructor.

## Trade-offs

- **The invocation must still be a top-level statement of the body** — the JVM would permit one invocation per code path, but the language grammar does not. Branching to two different `super(...)` calls is rejected, so genuinely conditional superclass selection still needs a static factory or a `this(...)` hop:

```java
public class X8 {
    X8(int n) {
        if (n > 0) { super(); } else { super(); }
    }
}
// error: explicit constructor invocation not allowed here
```

- **Not usable if you compile for an older release** — the feature is standard in JDK 25 but there is no back-porting story, so a library that still ships a JDK 21 or JDK 17 baseline cannot adopt it. That constraint bites libraries far longer than applications.

- **Fields with initializers cannot be assigned in the prologue** — the rule is about *uninitialized* declared fields, so pre-`super()` initialization is only available where you have not also written an inline initializer. Removing the initializer to enable it can be a real refactor:

```java
String s = "hello";
// in the prologue:
s = "goodbye";   // error: cannot assign initialized field 's' before supertype constructor has been called
```

- **Prologue code cannot call your own instance helpers** — a validation method has to be `static` (or moved into the prologue inline), which is exactly the constraint the old `verifyAge` idiom lived under. The win is that the *call site* no longer has to be an argument expression:

```java
hashCode();   // error: cannot reference hashCode() before supertype constructor has been called
```

- **Existing tooling assumed the old shape** — linters, formatters, style checkers, static analyzers, and syntax highlighters have long encoded "constructor invocation comes first". Some will flag correct code or mis-indent it until they catch up.

- **It makes it easier to write constructors that do too much** — the old restriction accidentally discouraged heavy constructor logic. With the restriction lifted, a constructor can grow a long prologue of validation and computation that a static factory method would express more clearly. This is a judgment call, not a rule.

## Documentation Links

- [Flexible Constructor Bodies — Java Language Updates, Release 25](https://docs.oracle.com/en/java/javase/25/language/flexible-constructor-bodies.html) — doc
- [JEP 513: Flexible Constructor Bodies (final in JDK 25)](https://openjdk.org/jeps/513) — doc
- [JEP 447: Statements before super(...) (first preview, JDK 22)](https://openjdk.org/jeps/447) — doc
- [Constructor Body — JLS 8.8.7 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.8.7) — doc
- [Constructor Invocations — JLS 8.8.7.1 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.8.7.1) — doc
