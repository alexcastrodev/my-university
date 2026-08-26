---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

An interface used to be nothing but a list of signatures. Since Java 8 it can also carry bodies: a `default` method supplies an inherited implementation so a published interface can grow new methods without breaking classes that already implement it, and a `static` method puts a utility or factory on the interface itself instead of in a separate helper class. Java 9 added `private` interface methods so those bodies can share logic without that logic becoming public API. The cost of inheriting behavior from more than one supertype is that conflicts become possible, so the language defines exactly which method wins — and when the compiler refuses to guess and forces you to override.

## Use Cases

- Adding a method to an interface that third parties already implement, without every implementer failing to compile — the reason `Collection.stream()`, `Collection.removeIf()`, and `Iterable.forEach()` could be introduced in Java 8 at all.
- Giving an interface a small amount of derived behavior expressed purely in terms of its own abstract methods (`isEmpty()` in terms of `size()`, `describe()` in terms of a getter).
- Building combinator-style APIs where each operation returns a new instance of the interface: `Comparator.thenComparing()`, `Comparator.reversed()`, `Predicate.and()`, `Function.andThen()`.
- Putting static factory methods on the type they produce instead of in a `XxxUtils` class: `Comparator.comparing(...)`, `Comparator.naturalOrder()`, `List.of(...)`, `Map.entry(k, v)`, `Predicate.not(...)`.
- Factoring a validation or normalization step out of several default methods into one `private` helper that implementing classes cannot see or call.
- Resolving a deliberate diamond — a class that implements two interfaces which both ship a default for the same signature — by overriding and delegating with `Interface.super.method()`.

## Deep Dive

### Why default methods exist: growing a released interface

Compile an implementer against version 1 of an interface, then add a method to the interface and recompile *only the interface*:

```java
// Pipe.java, version 1
public interface Pipe { void send(String s); }

// MyPipe.java — compiled against version 1, never touched again
public class MyPipe implements Pipe {
    public void send(String s) { System.out.println("sent: " + s); }
}
```

```java
// Pipe.java, version 2 — a new method, with a body
public interface Pipe {
    void send(String s);
    default void sendAll(List<String> all) { for (String s : all) send(s); }
}
```

```
$ javac -d cls v1/Pipe.java MyPipe.java     # MyPipe.class built against v1
$ javac -d cls v2/Pipe.java                 # only the interface recompiled
$ java -cp cls Main                         # Main calls new MyPipe().sendAll(List.of("x","y"))
sent: x
sent: y
```

The stale `MyPipe.class` gained `sendAll` for free. Declare the same method abstract instead and every existing implementer stops compiling:

```java
public interface Pipe { void send(String s); void sendAll(List<String> all); }
```

```
MyPipe.java:1: error: MyPipe is not abstract and does not override abstract method sendAll(List<String>) in Pipe
public class MyPipe implements Pipe {
       ^
```

That is the whole motivation: `stream()`, `spliterator()`, `removeIf()`, and `toArray(IntFunction)` on `Collection`, and `forEach()` on `Iterable`, are all default methods, which is why adding lambdas and streams in Java 8 did not invalidate a decade of third-party `Collection` implementations.

### What an interface method may be

Four mutually exclusive shapes, and a set of modifiers that are illegal:

```java
interface Demo {
    String status();                                    // implicitly public abstract, no body
    default String greet() { return "hi " + status(); } // public, has a body, inherited
    static String label() { return "Demo"; }            // public, has a body, NOT inherited
    private String inner() { return "OK"; }             // Java 9+, has a body, not visible outside
    private static String tag() { return "d"; }         // Java 9+, static variant
}
```

Everything except a `private` member is implicitly `public`, so writing `public` on an interface method is redundant. A method without `private`, `default`, or `static` is implicitly `abstract` and must end in a semicolon; `default`, `static`, and `private` methods must have a block body. The rejected combinations:

```java
interface Bad {
    private default String a() { return "x"; }  // error: illegal combination of modifiers: private and default
    final String b();                           // error: modifier final not allowed here
    synchronized default String c() { return "y"; } // error: modifier synchronized not allowed here
    private String d();                         // error: missing method body, or declare abstract
}
```

A default method also may not be override-equivalent with a non-private method of `Object`, because every implementing class would inherit `Object`'s version anyway and silently win:

```java
interface Named { default String toString() { return "named"; } }
// error: default method toString in interface Named overrides a member of java.lang.Object
```

### Diamond inheritance of behavior

Two unrelated interfaces, each with a default for the same signature, and one class implementing both. The compiler will not pick:

```java
interface Hello { default String greet() { return "Hello"; } }
interface Howdy { default String greet() { return "Howdy"; } }

class Greeter implements Hello, Howdy { }
```

```
T1.java:3: error: types Hello and Howdy are incompatible;
class Greeter implements Hello, Howdy { }
^
  class Greeter inherits unrelated defaults for greet() from types Hello and Howdy
```

The fix is to override, which removes both inherited methods from consideration. Inside the override, `Interface.super.method()` reaches a specific superinterface's default body:

```java
class Greeter implements Hello, Howdy {
    @Override public String greet() {
        return Hello.super.greet() + " / " + Howdy.super.greet();
    }
}
// prints: Hello / Howdy
```

The same conflict is reported at the *interface* level too, so it surfaces as soon as someone writes `interface AB extends A, B` rather than waiting for a concrete class. `Interface.super` is narrowly scoped: the named interface must be a **direct** superinterface of the enclosing declaration, so you cannot reach past an intermediate interface:

```java
interface Top { default String name() { return "top"; } }
interface Mid extends Top { }

class Bot implements Mid {
    public String name() { return Top.super.name(); }
}
```

```
T6.java:3: error: not an enclosing class: Top
```

`class Bot implements Mid, Top` (or `Mid.super.name()`) compiles; there is also no syntax for an interface-super call from inside a nested or anonymous class, which is why such code is usually routed through a private method of the enclosing class.

### Abstract beats default, and a class beats both

A default method does not satisfy an abstract method of the same signature inherited from a different interface. The specification deliberately refuses to assume the two share a contract:

```java
interface A { default String greet() { return "Hello"; } }
interface B { String greet(); }

interface AB extends A, B { }
// error: interface AB inherits abstract and default for greet() from types A and B

class C implements A, B { }
// error: C is not abstract and does not override abstract method greet() in B
```

The one place the language *does* pick silently is the class hierarchy: a concrete method inherited from a superclass overrides a default method from a superinterface — informally, "class wins".

```java
interface Greet { default String greet() { return "iface"; } }
class Base { public String greet() { return "class"; } }

class Sub extends Base implements Greet {
    public static void main(String[] a) { System.out.println(new Sub().greet()); }
}
// prints: class
```

### Re-abstraction and the already-overridden rule

A subinterface has three options for a default it inherits: leave it alone, override it with a new body, or re-declare it abstract — which forces implementers to supply their own and is the standard way to defuse a conflict deliberately:

```java
interface StrictPipe extends Pipe {
    void sendAll(List<String> all);   // re-abstracted: no body, so implementers must supply one
}

class P implements StrictPipe { public void send(String s) { } }
// error: P is not abstract and does not override abstract method sendAll(List<String>) in StrictPipe
```

Diamonds are only an error when neither branch has already won. If one superinterface's default overrides the other's, the overridden one is not re-inherited and there is no ambiguity:

```java
interface Top    { default String name() { return "unnamed"; } }
interface Left  extends Top { default String name() { return "left"; } }
interface Right extends Top { }
interface Bottom extends Left, Right { }

class BotImpl implements Bottom {
    public static void main(String[] a) { System.out.println(new BotImpl().name()); }
}
// prints: left  — Right inherits name() from Top, but Left.name() already overrides it
```

### Static interface methods: factories on the type itself

A static interface method is a utility or factory that conceptually belongs to the interface, with no separate `XxxUtils` class and no risk of the helper being confused for part of the contract implementers must satisfy. `Comparator` is the canonical example, mixing static entry points with default combinators:

```java
List<String> names = new ArrayList<>(List.of("bob", "Al", "carol", "dan"));
names.sort(Comparator.comparing(String::length)         // static factory on the interface
                     .thenComparing(Comparator.naturalOrder())); // default combinator + another static
System.out.println(names);   // [Al, bob, dan, carol]
```

The catch: static interface methods are **not inherited**, by subinterfaces or by implementing classes. They must be qualified with the interface name:

```java
interface Util { static String help() { return "help"; } }
class Impl implements Util { }

class UseIt { void go() { System.out.println(Impl.help()); } }
```

```
T3.java:3: error: cannot find symbol
class UseIt { void go() { System.out.println(Impl.help()); } }
                                                 ^
  symbol:   method help()
  location: class Impl
```

`Util.help()` is the only valid form. (This is the opposite of a class's static method, which *is* inherited and can be called through a subclass name.)

### Private interface methods: shared bodies, unchanged API

Two default methods that need the same helper logic had, before Java 9, only bad options: duplicate the code, or add a public method nobody was supposed to call. A `private` interface method solves it — instance or static, body required, never inherited, never overridable:

```java
interface Sized {
    int size();

    default boolean isEmpty()  { return checked() == 0; }
    default String describe()  { return "size=" + checked(); }

    private int checked() {                          // shared by both defaults
        int n = size();
        if (n < 0) throw new IllegalStateException("negative size: " + n);
        return n;
    }

    private static String tag() { return "Sized"; }  // private static variant
    static String label() { return tag() + " interface"; }
}

class Bag implements Sized {
    public int size() { return 3; }
    public static void main(String[] a) {
        Bag b = new Bag();
        System.out.println(b.isEmpty() + " " + b.describe() + " " + Sized.label());
    }
}
// prints: false size=3 Sized interface
```

`checked()` and `tag()` are invisible to `Bag` and to every other implementer, so the interface's published surface is still `size()`, `isEmpty()`, `describe()`, and `label()`:

```java
class Impl2 implements Demo { void go() { System.out.println(inner()); } }
```

```
T4.java:2: error: cannot find symbol
  symbol:   method inner()
  location: class Impl2
```

Because a private interface method is never inherited, it also cannot override anything — the language guarantees that only public interface methods participate in overriding.

### Bodies do not break functional interfaces

Only the abstract method count decides whether an interface is functional, so `default`, `static`, and `private` methods can be added freely to a lambda target:

```java
@FunctionalInterface
interface Tx {
    String apply(String in);                                       // the single abstract method

    default Tx andThen(Tx next) { return in -> next.apply(apply(in)); }
    static Tx identity() { return in -> in; }
    private static String tag() { return "Tx"; }
}

Tx up = String::toUpperCase;
System.out.println(up.andThen(s -> s + "!").apply("hi"));  // HI!
System.out.println(Tx.identity().apply("z"));              // z
```

This is exactly how `Function`, `Predicate`, and `Comparator` stay usable as lambda targets while carrying a dozen combinators each.

## Trade-offs

- **A default method is inherited silently, and a superclass method silently beats it.** Adding a default to an interface can change nothing at all for an implementer that already inherits a same-signature concrete method from its superclass — the class wins, and no warning is issued:

```java
interface Greet { default String greet() { return "iface"; } }
class Base { public String greet() { return "class"; } }
class Sub extends Base implements Greet { }
new Sub().greet();   // "class" — the default never runs
```

- **The cost of a diamond lands on the implementer, not the interface author.** Two libraries that independently add a default for the same signature turn any class implementing both into a compile error it must fix itself:

```java
class Greeter implements Hello, Howdy { }
// error: class Greeter inherits unrelated defaults for greet() from types Hello and Howdy
```

- **`Interface.super` reaches only direct superinterfaces, and not from nested classes.** There is no way to invoke a grand-superinterface's default body, so a deep hierarchy leaves you re-implementing rather than delegating:

```java
class Bot implements Mid { public String name() { return Top.super.name(); } }
// error: not an enclosing class: Top   (Mid sits between Bot and Top)
```

- **Interface bodies still cannot hold state or touch `Object`'s methods.** A default method may only compute from the interface's own abstract methods, and `equals`/`hashCode`/`toString` are off limits entirely:

```java
interface Named { default String toString() { return "named"; } }
// error: default method toString in interface Named overrides a member of java.lang.Object
```

- **Interfaces with bodies blur the line they used to draw.** A reader can no longer assume "interface" means "signatures only", and the design question of how much behavior belongs in an interface versus a skeletal abstract class or a wrapper is now a judgment call rather than a language constraint.

## Documentation Links

- [Java Language Specification — 9.4, Interface Method Declarations](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4) — doc
- [Java Language Specification — 9.4.1, Inheritance and Overriding](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4.1) — doc
- [Java Language Specification — 9.4.1.3, Inheriting Methods with Override-Equivalent Signatures](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4.1.3) — doc
- [Java Language Specification — 8.4.8.4, Inheriting Methods with Override-Equivalent Signatures (classes)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.8.4) — doc
- [Java Language Specification — 15.12.1, Determine Type to Search (TypeName.super)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.12.1) — doc
- [JEP 213: Milling Project Coin — private interface methods in Java 9](https://openjdk.org/jeps/213) — doc
- [Default Methods and Static Methods — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/defaultmethods.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
