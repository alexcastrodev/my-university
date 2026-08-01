# Practice: Lambdas and Functional Interfaces

> Five exercises covering what the slides in this module introduced —
> effectively-final capture, SAM counting, method reference types,
> `Function.andThen`/`compose`, and `Predicate` short-circuiting. Try to
> answer before opening each explanation.

---

## Exercise 1 — Capturing a loop variable

```java
List<Runnable> tasks = new ArrayList<>();
for (int i = 0; i < 3; i++) {
    tasks.add(() -> System.out.println("Task " + i));
}
```

Does this compile?

<details>
<summary>Answer</summary>

**No** — compile error: `i` is not effectively final.

`i` is reassigned by `i++` on every iteration of the loop, so it's mutated
over its lifetime — the opposite of "assigned exactly once." A lambda can
only capture local variables that are effectively final, so this fails to
compile with a message like *"local variables referenced from a lambda
expression must be final or effectively final."*

The standard fix is copying the value into a **fresh** local variable
inside the loop body before creating the lambda:

```java
for (int i = 0; i < 3; i++) {
    int taskNum = i;   // a brand-new variable each iteration
    tasks.add(() -> System.out.println("Task " + taskNum));
}
```

`taskNum` *is* effectively final — even though it's declared inside a
loop that runs multiple times, each iteration gets its own instance of
`taskNum`, assigned exactly once and never reassigned within that
instance's own scope.

</details>

---

## Exercise 2 — Does this satisfy `@FunctionalInterface`?

```java
@FunctionalInterface
interface Calculator {
    int compute(int a, int b);

    default int square(int a) { return compute(a, a); }

    static Calculator adder() { return (a, b) -> a + b; }

    @Override
    String toString();
}
```

Does this compile as a valid functional interface?

<details>
<summary>Answer</summary>

**Yes.** Only `compute(int, int)` counts as the single abstract method
(SAM):

- `square` is a `default` method — doesn't count.
- `adder` is `static` — doesn't count.
- `toString()` is abstract, but it merely re-declares a public method
  already defined on `Object`. Every implementation inherits `toString()`
  from `Object` regardless, so it doesn't count toward the SAM total
  either.

Total abstract methods that matter for the SAM rule: **1**
(`compute`) — valid.

</details>

---

## Exercise 3 — Identifying a method reference's type and result

```java
BiFunction<String, String, Integer> cmp1 = String::compareTo;
System.out.println(cmp1.apply("apple", "banana"));

String prefix = "Hello";
Function<String, String> cmp2 = prefix::concat;
System.out.println(cmp2.apply(", World"));
```

Which kind of method reference is each one, and what's printed?

<details>
<summary>Answer</summary>

```
-1
Hello, World
```

`String::compareTo` is an **instance method on an arbitrary object of a
particular type** (type 3) — the *first* `BiFunction` argument becomes the
object the method is called on, and the second becomes `compareTo`'s
parameter. So `cmp1.apply("apple", "banana")` really runs
`"apple".compareTo("banana")`. `compareTo` returns the difference between
the first differing characters' codes — `'a'` (97) vs. `'b'` (98) — giving
`-1`.

`prefix::concat` is an **instance method on a particular, already-captured
object** (type 2) — it always calls `concat` on that one specific `"Hello"`
instance, no matter what. `cmp2.apply(", World")` runs
`"Hello".concat(", World")`, giving `"Hello, World"`.

</details>

---

## Exercise 4 — `andThen` vs. `compose`

```java
Function<Integer, Integer> times2 = n -> n * 2;
Function<Integer, Integer> plus3  = n -> n + 3;

Function<Integer, Integer> a = times2.andThen(plus3);
Function<Integer, Integer> b = times2.compose(plus3);

System.out.println(a.apply(5));
System.out.println(b.apply(5));
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
13
16
```

`times2.andThen(plus3)` runs `times2` **first**, then feeds its result
into `plus3`: `5 * 2 = 10`, then `10 + 3 = 13`.

`times2.compose(plus3)` runs `plus3` **first** (on the original argument),
then feeds *that* result into `times2`: `5 + 3 = 8`, then `8 * 2 = 16`.

`andThen` reads left-to-right in the order you called it; `compose`
reverses it — the function you call `compose` *on* runs last, and the
argument to `compose` runs first.

</details>

---

## Exercise 5 — Does `Predicate.and()` short-circuit?

```java
Predicate<String> notNull = s -> s != null;
Predicate<String> isLong  = s -> s.length() > 5;

Predicate<String> safe = notNull.and(isLong);

System.out.println(safe.test(null));
System.out.println(safe.test("hi"));
```

Does `safe.test(null)` throw a `NullPointerException`?

<details>
<summary>Answer</summary>

**No** — prints `false`, no exception.

`Predicate.and()` short-circuits exactly like `&&`: it only evaluates the
second predicate if the first one returns `true`. `notNull.test(null)`
returns `false` immediately, so `isLong.test(null)` — which would throw a
`NullPointerException` calling `.length()` on `null` — is never evaluated
at all.

`safe.test("hi")` also prints `false`, but for an ordinary reason this
time: `notNull` passes (`"hi"` isn't null), so `isLong` *does* run —
`"hi".length()` is `2`, which is not greater than `5`.

The general lesson: composing predicates with `and`/`or` preserves the
same short-circuit guarantees as `&&`/`||`, which is exactly why ordering
a null-check predicate first (as here) is a safe, idiomatic pattern.

</details>
