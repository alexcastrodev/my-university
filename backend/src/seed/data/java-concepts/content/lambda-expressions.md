---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

A lambda expression is an anonymous, unnamed block of code — essentially a method without a name that is never executed on its own. Instead, it supplies the implementation of the single abstract method declared by a *functional interface*, and the compiler turns it into an object implementing that interface at the point it's assigned, passed, or returned. A method reference (`ClassName::methodName`) is the closely related shorthand for the same idea when the lambda body would just call one existing method.

## Use Cases

- Passing a short, single-use piece of behavior (a comparison rule, a filter condition, a callback) as a method argument without declaring a throwaway named class.
- Replacing a hand-written functional interface (`Comparator`, a custom `Callback`) with one of the standard `java.util.function` interfaces, so the API surface doesn't grow with every new use case.
- Deferring work — a `Supplier<T>` that only computes its value if actually asked for, instead of computing it eagerly at the call site.
- Turning an existing method (static, instance, or a constructor) into a functional-interface value with `::`, when the lambda body would do nothing but forward its arguments to that method.

## Deep Dive

### Functional interfaces: the single abstract method contract

```java
interface MyNumber {
    double getValue();
}
```

`MyNumber` is a *functional interface* — sometimes called a **SAM type** (Single Abstract Method) — because it declares exactly one abstract method. A functional interface defines the *target type* of a lambda: a lambda expression can only appear where the compiler already knows which functional interface it's meant to implement (an assignment, a method argument, a `return` statement, a cast, and a few other contexts).

```java
MyNumber myNum;
myNum = () -> 123.45;                  // lambda supplies the body of getValue()
System.out.println(myNum.getValue());  // 123.45
```

Assigning the lambda doesn't run anything — it creates an instance of an anonymous class implementing `MyNumber`, with `getValue()`'s body coming from the lambda. The code only runs when `getValue()` is actually called through `myNum`. `default`, `static`, and `private` interface methods don't count toward the "one abstract method" rule, and neither do `public` methods `Object` already supplies (`equals`, `hashCode`, `toString`) — a functional interface can re-declare those without losing its status.

### Lambda syntax: expression bodies vs. block bodies

```java
() -> 123.45                  // expression body, no parameters
(n) -> (n % 2) == 0           // expression body, one parameter, type inferred
(int n) -> (n % 2) == 0       // parameter type spelled out explicitly
n -> (n % 2) == 0             // parentheses are optional for exactly one parameter
(n, d) -> (n % d) == 0        // multiple parameters, comma-separated
```

If any parameter's type is declared explicitly, *all* of them must be — `(int n, d) -> (n % d) == 0` doesn't compile. Since JDK 11, `var` is also legal in a lambda parameter list (`(var n, var d) -> ...`), which matters mainly when a parameter needs an annotation while its type is still inferred.

An **expression body** is a single expression whose value becomes the lambda's implicit return. A **block body** wraps statements in braces and needs an explicit `return`:

```java
NumericFunc factorial = (n) -> {
    int result = 1;
    for (int i = 1; i <= n; i++) result = i * result;
    return result;             // required — a block body has no implicit return
};
```

A `return` inside a lambda only exits the lambda itself; it never causes the enclosing method to return.

One syntax addition since the book's baseline: JDK 22 finalized **unnamed variables** (JEP 456, previewed as JEP 443 in JDK 21), and the underscore `_` is legal in a lambda parameter list, not just in `catch` blocks or patterns — it marks a parameter the lambda is required to declare but never uses:

```java
map.computeIfAbsent(word, _ -> new TreeSet<>());        // one unused parameter
BiFunction<Integer, Integer, Integer> ignoreBoth = (_, _) -> 42;  // both unused
```

A discarded parameter written as `_` isn't a real identifier — it can't be referenced in the body, and more than one `_` is allowed in the same parameter list (unlike a normal name, which would collide).

### Generic functional interfaces

A lambda expression itself cannot declare type parameters — it can't be generic — but the functional interface it targets can be:

```java
interface SomeFunc<T> {
    T func(T n);
}

SomeFunc<String> reverse   = (str) -> new StringBuilder(str).reverse().toString();
SomeFunc<Integer> factorial = (n) -> { int r = 1; for (int i = 1; i <= n; i++) r *= i; return r; };
```

One generic interface replaces writing a separate `StringFunc`/`NumericFunc` pair — the type argument at the declaration site (`SomeFunc<String>` vs. `SomeFunc<Integer>`) is what fixes `func`'s parameter and return type for that particular reference.

### The `java.util.function` catalogue

Because the same handful of input/output shapes recur constantly, the JDK ships them ready-made in `java.util.function`, so custom functional interfaces are only needed for shapes the standard library doesn't cover:

```java
Function<String, Integer> length   = String::length;       // T -> R
Predicate<String> isEmpty          = String::isEmpty;      // T -> boolean
Supplier<List<String>> newList     = ArrayList::new;        // () -> R
Consumer<String> print             = System.out::println;  // T -> void
BiFunction<Integer, Integer, Integer> add = Integer::sum;  // (T, U) -> R
UnaryOperator<Integer> square      = n -> n * n;            // T -> T
BinaryOperator<Integer> max        = Integer::max;          // (T, T) -> T
```

`Predicate` adds default methods (`and`, `or`, `negate`) for composing conditions, and `Function` adds `andThen`/`compose` for chaining — both build a new lambda out of two existing ones instead of writing a combined body by hand. Primitive-specialized variants (`IntFunction`, `IntPredicate`, `ToIntFunction`, `IntUnaryOperator`, ...) exist purely to avoid autoboxing `int`/`long`/`double` through `Integer`/`Long`/`Double` on every call.

### Variable capture and the effectively-final rule

A lambda can freely read and write an instance or `static` field of its enclosing class, and it has access to the enclosing instance's `this` (a lambda doesn't get a `this` of its own). A *local* variable from the enclosing scope is different: it can be read, but only if it is **effectively final** — never reassigned after its first assignment, whether or not it's actually declared `final`.

```java
int num = 10;
MyFunc myLambda = () -> System.out.println("num is " + num);  // fine — num never changes
```

```java
int num = 10;
MyFunc myLambda = () -> System.out.println("num is " + num);
num++;   // compile error: local variables referenced from a lambda expression
         // must be final or effectively final
```

The restriction exists because the lambda may outlive the stack frame that declared `num` — capturing a snapshot of the value is safe, capturing a variable that could change underneath the lambda is not.

### Method references: four kinds

A method reference (`::`) is a way to point at an existing method or constructor without calling it — evaluated in a target-type context, it produces an instance of the compatible functional interface, exactly like a lambda would.

```java
// 1. static method reference — ClassName::methodName
outStr = stringOp(MyStringOps::strReverse, inStr);

// 2. bound instance method reference — objRef::methodName (object fixed at the reference)
MyStringOps strOps = new MyStringOps();
outStr = stringOp(strOps::strReverse, inStr);

// 3. unbound instance method reference — ClassName::instanceMethodName
//    the functional interface's first parameter supplies the invoking object,
//    the rest map to the method's own parameters: func(a, b) compiles as a.sameTemp(b)
int matches = counter(highTemps, HighTemp::sameTemp, highTemps[0]);

// 4. constructor reference — ClassName::new (and Type[]::new for arrays)
MyFunc<Integer> myClassCons = MyClass::new;
MyClass<Integer> mc = myClassCons.func(100);
MyArrayCreator<MyClass> arrCreator = MyClass[]::new;
MyClass[] twoElements = arrCreator.func(2);
```

A superclass method can also be referenced explicitly with `super::name` or `TypeName.super::name` (the second form when the enclosing type implements more than one interface declaring `name`). Method references to generic methods or generic classes can carry an explicit type argument right after the `::` (`MyArrayOps::<Integer>countMatching`), though it's usually inferred and rarely needs to be written out.

### Overload resolution and ambiguity

Because a lambda has no type of its own — only the target type the context assigns it — passing one to an overloaded method can be ambiguous when two overloads accept different functional interfaces that happen to have the identical method shape:

```java
interface Sayable { void say(); }
interface Doable  { void doIt(); }

void run(Sayable s) { s.say(); }
void run(Doable d)  { d.doIt(); }

run(() -> System.out.println("hi"));   // compile error: reference to run is ambiguous
```

`Sayable` and `Doable` are both "no parameters, returns void," so the no-arg lambda is compatible with either overload and the compiler has no basis to prefer one. A cast picks the target type explicitly and resolves it: `run((Sayable) () -> System.out.println("hi"));`.

## Trade-offs

- **Effectively-final capture is enforced at compile time, not left to convention.** A local variable a lambda reads can never be reassigned anywhere in its scope, inside the lambda or out — this is what makes the capture safe, but it forecloses patterns (an accumulator loop variable, a mutable counter) that would work fine in a named inner class holding a field.
  ```java
  int total = 0;
  Runnable r = () -> System.out.println(total);
  total++;   // compile error: total is no longer effectively final
  ```
- **Two functional interfaces with the same method shape make an overload call ambiguous**, because the lambda itself carries no type to disambiguate with — only an explicit cast to the intended interface resolves it (see the `Sayable`/`Doable` example above).
- **A lambda's checked exceptions must already be declared on the functional interface's abstract method** — the lambda can't introduce a checked exception the interface didn't promise.
  ```java
  interface DoubleNumericArrayFunc { double func(double[] n); }  // no throws clause

  DoubleNumericArrayFunc average = (n) -> {
      if (n.length == 0) throw new EmptyArrayException();  // compile error unless
      // ...                                                // func() declares "throws EmptyArrayException"
  };
  ```
- **A lambda is harder to debug than a named method.** Stack traces show a synthetic frame name like `lambda$main$0` instead of a descriptive method name, and several lambdas on the same source line give a debugger nothing to distinguish them by — extracting a non-trivial lambda body into a named method (and referencing it with `::`) often pays for itself the first time it needs a breakpoint.

## Documentation Links

- [java.util.function — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/package-summary.html) — doc
- [Function — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Function.html) — doc
- [Predicate — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Predicate.html) — doc
- [Supplier — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Supplier.html) — doc
- [Java Language Specification — Section 15.27, Lambda Expressions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.27) — doc
- [JEP 456: Unnamed Variables & Patterns](https://openjdk.org/jeps/456) — doc
