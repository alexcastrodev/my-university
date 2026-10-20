---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- State the subsumption rule and derive the subtyping rule for function types (contravariant in the argument, covariant in the result).
- Classify a type parameter as covariant, contravariant, or invariant by where it appears, and explain why mutable containers must be invariant.
- Use Java wildcards (`? extends`, `? super`) with the PECS rule, and compare them with declaration-site variance in Kotlin, Scala, and C#.
- Read bounded and F-bounded type parameters such as `<T extends Comparable<? super T>>`, and relate the Liskov substitution principle to variance.

## Context & Motivation

`algorithms-software/programming-paradigms` introduced subtype polymorphism through inheritance, and the previous concept introduced parametric polymorphism with System F. Real languages combine the two, and the combination is where most generic-API puzzlement comes from: why `List<Integer>` is not a `List<Number>`, why `Collections.copy` has two wildcards in its signature, and why `Comparable<? super T>` appears in the JDK sort methods.

**Subtyping** is a relation $S <: T$ meaning a value of type $S$ can be used wherever a $T$ is expected. Pierce's *Types and Programming Languages* develops it in the chapters on subtyping (15) and on bounded quantification (26), and Bracha, Odersky, Stoutamire, and Wadler brought it together with generics for Java 5. The rules are few, but the one for function types runs against intuition, and getting the mutable case wrong is the oldest type-safety hole in Java.

## Core Theory

### Subsumption and the basic rules

The **subsumption rule** connects the relation to typing:

$$\frac{\Gamma \vdash e : S \qquad S <: T}{\Gamma \vdash e : T}\ \text{(T-Sub)}$$

The relation is reflexive and transitive, and has a top type (`Object`, `Any`). For records (and objects viewed as records), **width subtyping** says a record with more fields is a subtype of one with fewer, and **depth subtyping** says field types may themselves be subtypes, which is safe only if the fields are never written.

### Function types: contravariant arguments

A function substitutes for another if it accepts at least what the other accepts and returns at most what the other returns:

$$\frac{T_1 <: S_1 \qquad S_2 <: T_2}{S_1 \to S_2\ <:\ T_1 \to T_2}\ \text{(S-Arrow)}$$

The argument position flips the direction (**contravariant**) and the result keeps it (**covariant**). With `Dog <: Animal`, a function `Animal -> Dog` can replace one that was promised as `Dog -> Animal`: it accepts any dog (indeed any animal) and returns a dog, which is an animal.

### Variance of type constructors

For a type constructor $F$, the parameter is **covariant** if $S <: T$ implies $F[S] <: F[T]$, **contravariant** if it implies $F[T] <: F[S]$, and **invariant** if neither holds. The rule of thumb is by position: a parameter that appears only in output positions (return types, read-only fields) can be covariant, one that appears only in input positions (method parameters) can be contravariant, and one that appears in both must be invariant. A mutable cell `Ref[T]` has `get(): T` (output) and `set(T)` (input), so it is invariant.

Java gets this wrong for arrays: `String[] <: Object[]` (arrays are covariant) although arrays are mutable. The compiler accepts `Object[] a = new String[1]; a[0] = 42;`, and the JVM must check every array store at run time and throw `ArrayStoreException`. Generics learned the lesson: `List<String>` is not a subtype of `List<Object>`.

### Use-site variance: Java wildcards

Java expresses variance where the type is used, with wildcards. `List<? extends Number>` is a list of some unknown subtype of `Number`: reading gives a `Number`, and writing is rejected (except `null`) because the actual element type is unknown. `List<? super Integer>` is a list of some unknown supertype of `Integer`: you can add an `Integer`, and reading gives only `Object`. The mnemonic is **PECS**, "Producer Extends, Consumer Super" (Bloch, *Effective Java*, Item 31): a parameter that produces values for you uses `extends`, one that consumes values from you uses `super`. Subtyping among wildcard types follows: `List<Integer> <: List<? extends Number> <: List<?>`.

### Declaration-site variance: Kotlin, Scala, C#

Other languages let the author of a generic type declare the variance once. Kotlin's `List<out E>` and C#'s `IEnumerable<out T>` are covariant, so a `List<String>` is directly a `List<Any>`. Kotlin's `Comparable<in T>` and C#'s `Action<in T>` are contravariant. The compiler checks the declaration: an `out` parameter may appear only in output positions of the type's members. Kotlin's `MutableList<E>` has to be invariant for exactly the reason above. Declaration-site variance means client code needs no wildcards; use-site variance is more flexible for a single class that has both reading and writing methods.

### Bounded and F-bounded polymorphism

**Bounded quantification** restricts a type parameter to a subtype of a bound, $\forall\alpha <: \tau.\ \sigma$, written `<T extends Number>` in Java. The bound lets the body use the bound's operations on a $T$. An **F-bounded** parameter mentions itself in its bound, as in `<T extends Comparable<T>>`: "a $T$ that can be compared with other $T$s". A more general form is `<T extends Comparable<? super T>>`, which also accepts a subclass whose comparison is inherited from a superclass. Combined with PECS, it explains the JDK signature `<T extends Object & Comparable<? super T>> T max(Collection<? extends T> coll)`.

### Behavioral subtyping

Subtyping in the type checker is about signatures, but substitution should also preserve behavior. Liskov and Wing's **behavioral subtyping** (the Liskov substitution principle) requires a subtype to keep a supertype's contract: it may *weaken* preconditions and *strengthen* postconditions, the same variance as function types (contravariant input, covariant output). A `Square` that extends a mutable `Rectangle` violates the contract that setting the width leaves the height unchanged.

## Worked Examples

### Example 1: which function can be passed?

**Problem:** `class Animal`, `class Dog extends Animal`. A method needs a function that, given a `Dog`, produces an `Animal`. Which of `Function<Dog, Dog>`, `Function<Animal, Dog>`, and `Function<Dog, Object>` can it accept?

**Solution:** Apply S-Arrow. The result may be any subtype of `Animal`, and the argument may be any supertype of `Dog`. `Function<Animal, Dog>` qualifies (argument `Animal :> Dog`, result `Dog <: Animal`) and so does `Function<Dog, Dog>` (result `Dog <: Animal`). `Function<Dog, Object>` does not, since its result `Object` is not an `Animal`. Java expresses this with wildcards:

```java
static void feedAll(List<Dog> dogs, Function<? super Dog, ? extends Animal> f) {
    for (Dog d : dogs) { Animal a = f.apply(d); }
}
```

The JDK's streams API uses exactly this shape: `Stream.map` takes a `Function<? super T, ? extends R>`.

### Example 2: the array hole and the generic fix

**Problem:** Predict what the compiler and the JVM do with the following.

```java
Object[] objs = new String[1];
objs[0] = 42;                          // compiles
List<Object> list = new ArrayList<String>();   // does not compile
```

**Solution:** The first two lines compile because `String[] <: Object[]`, but the store of an `Integer` into an array whose run-time type is `String[]` throws `ArrayStoreException`: the type error has moved from compile time to run time. The third line is a compile error because `List<T>` is invariant, which is what makes the generic equivalent safe: if it compiled, `list.add(42)` would silently put an `Integer` into a list of strings, discovered only later as a `ClassCastException` far from the cause.

### Example 3: `copy`, PECS, and `Comparable<? super T>`

**Problem:** Why is `static <T> void copy(List<? super T> dst, List<? extends T> src)` better than `copy(List<T> dst, List<T> src)`? And why does `max` need `Comparable<? super T>`?

**Solution:** With `T = Number`, the version without wildcards cannot accept a `List<Integer>` source, since `List<Integer>` is not a `List<Number>`. The wildcard version accepts `copy(List<Number> dst, List<Integer> src)` with `T = Integer`, because `List<Number>` is a `List<? super Integer>` and `List<Integer>` is a `List<? extends Integer>`: `src` is a producer, `dst` is a consumer. For `max`, let `Animal implements Comparable<Animal>` and `Dog extends Animal`. A `Dog` is a `Comparable<Animal>` but not a `Comparable<Dog>`. With the bound `T extends Comparable<T>`, `max(List<Dog>)` would not compile, yet comparing dogs with the inherited method is perfectly sound. `Comparable<? super T>` says "can compare two `T`s, possibly through a supertype's comparison", which accepts `Dog`.

## Common Misconceptions & Pitfalls

- **"If `Integer` is a `Number`, then `List<Integer>` is a `List<Number>`."** Only for read-only views. A mutable list is both producer and consumer, so it is invariant. Use `List<? extends Number>` for read-only access.
- **"`? extends T` means strictly a subclass."** It includes `T` itself. The wildcard is an upper bound, not a proper subtype requirement.
- **"Covariant method parameters are a convenience."** Languages that allow them (Eiffel's covariant parameters, TypeScript's bivariant method parameters) accept programs that fail at run time. TypeScript's `strictFunctionTypes` checks function-typed properties contravariantly but leaves method declarations bivariant for compatibility.
- **"Subtyping is satisfied if the signatures match."** It is satisfied for the compiler. Substituting a subclass that violates the superclass's contract still passes the type checker and fails in production; Liskov's rule is what tells you it is wrong.

## Summary

Subsumption lets a subtype stand in for a supertype. For function types the argument is contravariant and the result covariant, and the same variance governs preconditions and postconditions in behavioral subtyping. A generic parameter that is both read and written must be invariant, which is why Java generics are invariant and Java arrays (covariant, with a run-time check) are a historical hole. Java wildcards state variance at each use (PECS), Kotlin, Scala, and C# state it once at the declaration, and bounded and F-bounded parameters such as `Comparable<? super T>` let generic code use the operations of its bound. The next concept shifts from classifying values by type to controlling how many times they may be used: ownership and linear types.

## Documentation Links

- [Pierce: Types and Programming Languages (MIT Press), chapters 15 and 26](https://www.cis.upenn.edu/~bcpierce/tapl/): doc
- [The Java Tutorials: Wildcards](https://docs.oracle.com/javase/tutorial/java/generics/wildcards.html): doc
- [Kotlin documentation: Generics, declaration-site variance](https://kotlinlang.org/docs/generics.html): doc
- [Liskov, Wing: A Behavioral Notion of Subtyping (TOPLAS 1994)](https://dl.acm.org/doi/10.1145/197320.197383): doc
