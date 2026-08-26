---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand `var` (JEP 286, Java 10): a *local variable type inference* form where the compiler derives the variable's static type from its initializer at compile time. `var` is not dynamic typing and not a synonym for `Object` — the inferred type is fixed forever at that declaration and is enforced exactly as strictly as if you had typed it out. Its value is removing redundant type noise where the right-hand side already states the type (`var list = new ArrayList<String>();`), not saving keystrokes for their own sake.

## Use Cases

- Dropping a duplicated type name when a constructor or factory call already announces it, especially for long generic types (`var users = new ArrayList<User>();`, `var index = new ConcurrentHashMap<String, List<Order>>();`).
- Enhanced `for` loops and try-with-resources, where the declared type only repeats what is already visible on the right (`for (var entry : map.entrySet())`).
- Locals holding the result of a chained stream or builder call whose type is verbose but obvious from the surrounding lines.
- Capturing the type of an anonymous class expression — including members it declares beyond its supertype — which cannot be written out explicitly at all.

## Deep Dive

### Where `var` is allowed

`var` is legal only for *local* variables that have an initializer, plus the loop and resource variables that are locals in disguise:

```java
var greeting = "hello";                        // String
var counts = new HashMap<String, Integer>();   // HashMap<String, Integer>

for (var entry : counts.entrySet()) { }        // enhanced-for element
for (var i = 0; i < 10; i++) { }               // basic-for init clause

try (var in = Files.newInputStream(path)) { }  // try-with-resources
```

`var` is a *reserved type name*, not a keyword, so existing code that uses `var` as an identifier still compiles:

```java
int var = 3;                 // legal: var is not a keyword
var var = 3;                 // also legal, and also a terrible idea
```

### Where `var` is forbidden

Every position below is a compile error, because inference only ever runs against a local initializer.

Fields — instance or static — have no inference at all:

```java
class Account {
    var balance = 0L;        // error: 'var' is not allowed here
    static var RATE = 0.05;  // error: 'var' is not allowed here
}
```

```java
class Account {
    long balance = 0L;       // fixed: write the type
    static double RATE = 0.05;
}
```

Method parameters and return types are part of the signature, which callers compile against:

```java
var total(var amounts) { }   // error: 'var' is not allowed here (twice)
```

```java
long total(List<Long> amounts) { return 0L; }   // fixed
```

Catch clause parameters name the type being caught, which is what selects the handler:

```java
try {
    Files.readString(path);
} catch (var e) {            // error: 'var' is not allowed here
    e.printStackTrace();
}
```

```java
try {
    Files.readString(path);
} catch (IOException e) {    // fixed
    e.printStackTrace();
}
```

A declaration with no initializer gives the compiler nothing to infer from — and so does a bare array initializer, which itself needs a target type:

```java
var x;                       // error: cannot infer type for local variable x
var nums = {1, 2, 3};        // error: array initializer needs an explicit target type
```

```java
String x = null;             // fixed: declare the type
var nums = new int[] {1, 2, 3};
```

The legacy "brackets after the name" array syntax cannot combine with `var`, and neither can a compound declaration:

```java
var arr[] = new int[3];      // error: 'var' is not allowed as an element type of an array
var a = 1, b = 2;            // error: 'var' is not allowed in a compound declaration
```

```java
var arr = new int[3];        // fixed
var a = 1;
var b = 2;
```

### `var` in lambda parameters (Java 11+), all or nothing

Since Java 11 a lambda's formal parameters may use `var`, which is what lets you attach an annotation or a modifier to an otherwise implicitly typed parameter. The rule is that the parameter list must be uniform:

```java
BinaryOperator<Integer> ok = (var x, var y) -> x + y;   // fine: all var
```

```java
BinaryOperator<Integer> mixed1 = (var x, y) -> x + y;       // error: cannot mix 'var' and implicitly typed parameters
BinaryOperator<Integer> mixed2 = (var x, Integer y) -> x + y; // error: cannot mix 'var' and explicitly typed parameters
```

```java
BinaryOperator<Integer> a = (x, y) -> x + y;                 // fixed: all implicit
BinaryOperator<Integer> b = (Integer x, Integer y) -> x + y; // or all explicit
BinaryOperator<Integer> c = (var x, var y) -> x + y;         // or all var
```

A single `var` parameter also keeps its parentheses — `var x -> x` does not compile, only `(var x) -> x`.

### Inference reads the *static* type of the initializer

The inferred type is whatever the compiler statically computes for the right-hand side, not the runtime class of the value:

```java
Object o = "hello";
var copy = o;                // copy is Object, not String
copy.length();               // error: cannot find symbol 'length' on Object
```

```java
CharSequence cs = "hello";
var s = cs.toString();       // s is String — the *declared return type* of toString()
```

This is what makes the diamond gotcha bite. `new ArrayList<>()` infers its type argument from a target type; with `var` on the left there is no target type, so the only thing left is `Object`:

```java
var list = new ArrayList<>();   // infers ArrayList<Object>, not a placeholder
list.add("a");
list.add(42);                   // compiles happily — everything is an Object
String first = list.get(0);     // error: incompatible types: Object cannot be converted to String
```

```java
var list = new ArrayList<String>();   // fixed: state the type argument
List<String> other = new ArrayList<>(); // or keep the explicit type and let diamond infer
```

Two inference features that each work fine alone combine into a silent widening to `Object`.

### `var` captures anonymous class types

An anonymous class has a type that has no name, so it cannot be written in a declaration. Declaring the variable as its supertype throws that type away; `var` keeps it:

```java
Object obj = new Object() {
    void greet() { System.out.println("hi"); }
};
obj.greet();                 // error: cannot find symbol — Object has no greet()
```

```java
var obj = new Object() {
    void greet() { System.out.println("hi"); }
};
obj.greet();                 // works: obj has the anonymous class's own type
```

This is a capability `var` uniquely unlocks rather than a formatting preference. The same applies to intersection types produced by a conditional expression, which likewise have no writable name.

### `null` alone carries no type

`null` is assignable to every reference type, so it pins nothing down:

```java
var x = null;                // error: variable initializer is 'null'
```

A cast supplies the missing type, and so does any typed expression:

```java
var x = (String) null;       // fine: x is String
var y = Optional.<String>empty().orElse(null);   // fine: y is String
```

### Effectively-final capture is unchanged

Inference changes how the type is written, not how the variable behaves. A `var` local captured by a lambda or inner class must still be final or effectively final:

```java
var name = "ada";
name = "grace";                          // reassignment makes it *not* effectively final
Runnable r = () -> System.out.println(name);
// error: local variables referenced from a lambda expression must be final or effectively final
```

```java
var name = "ada";                        // never reassigned → effectively final
Runnable r = () -> System.out.println(name);   // fine
```

`var` locals can also be marked `final var` when you want the restriction stated explicitly.

## Trade-offs

- **Readability cuts both ways** — `var` is a clear win when the initializer names the type, and a clear loss when the initializer is an opaque call. In the second form the reader has to consult the method signature or lean on an IDE to answer "what is this?", which is the most commonly cited criticism of overusing `var`:

```java
var users = new ArrayList<User>();   // obvious
var result = process(input);         // what is result? nothing on this line says
```

- **Numeric literals infer `int`, silently** — an explicitly declared variable lets the compiler widen or narrow the literal against the declared type; `var` has no declared type to widen toward, so you must steer it with a suffix or a cast:

```java
long id = 0;        // widened to long by the declared type
byte flag = 5;      // narrowed to byte by the declared type
var id2 = 0;        // int — not long
var flag2 = 5;      // int — not byte
var id3 = 0L;       // fixed: the suffix carries the type
var flag3 = (byte) 5;
```

- **`var` plus diamond quietly yields `Object`** — the two inference features cancel each other out, and the mistake usually surfaces far from the declaration as a confusing compile error or a `ClassCastException` after an unchecked hop:

```java
var names = new ArrayList<>();   // ArrayList<Object>, though a List<String> was intended
names.add(42);                   // no complaint here
```

- **Zero runtime cost** — the type is resolved and baked into the class file at compile time, so `var` emits byte-for-byte the same bytecode as the explicit declaration. There is no runtime type check, no reflection, and no effect on binary compatibility of the enclosing class; assuming otherwise is a common misreading of the feature.

- **Team convention matters more than the rule** — because the language permits `var` everywhere a local is allowed, consistency has to come from a style agreement (for example: use it when the right-hand side is a constructor or a cast, avoid it for bare method calls). Without one, a codebase ends up mixing both styles line by line for no discernible reason.

## Documentation Links

- [Local Variable Type Inference — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/language/local-variable-type-inference.html) — doc
- [JEP 286: Local-Variable Type Inference](https://openjdk.org/jeps/286) — doc
