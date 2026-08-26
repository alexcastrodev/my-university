---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

An annotation embeds supplemental metadata into source code without changing the program's semantics — it's declared with `@interface`, applied with `@Name(...)` before a declaration, and read by tools, the compiler, or your own code via reflection. Annotations are built on the `interface` mechanism: every annotation implicitly extends `java.lang.annotation.Annotation`, and its members act like read-only fields rather than methods you implement.

## Use Cases

- Marking intent for the compiler to check, like `@Override` catching a typo'd method signature that would otherwise silently become an overload instead of an override.
- Driving frameworks that scan classes at startup — dependency injection, ORM entity mapping, REST routing — where the annotation carries configuration (`@Column("user_id")`, `@RequestMapping("/users")`) read via reflection.
- Suppressing or documenting a known compiler warning at the narrowest possible scope (`@SuppressWarnings("unchecked")`) instead of disabling it project-wide.
- Building your own lightweight metadata for validation, serialization, or test frameworks — e.g. a custom `@Test` or `@NotNull` that a runner or validator inspects with `getAnnotation()`.

## Deep Dive

### Declaring an annotation and its three usage forms

An annotation type is declared like an interface, prefixed with `@`:

```java
@interface MyAnno {
    String str();
    int val() default 1;
}
```

Members look like abstract methods but behave like fields when the annotation is applied — no body, no parameters, and the return type must be a primitive, `String`, `Class`, an `enum`, another annotation, or an array of one of those.

There are three ways to apply it, and which one you write depends only on which members exist:

```java
// normal form — every member named explicitly
@MyAnno(str = "Annotation Example", val = 100)
void myMeth() { }

// single-member form — legal only if the sole member (or the only one without
// a default) is named "value"; the name is then omitted at the call site
@interface MySingle { int value(); }

@MySingle(100)
void myMeth2() { }

// marker form — zero members, presence alone is the signal
@interface MyMarker { }

@MyMarker
void myMeth3() { }
```

A member can declare a `default`, so callers only need to override the ones that differ:

```java
@interface MyAnno {
    String str() default "Testing";
    int val() default 9000;
}

@MyAnno                          // both defaults
@MyAnno(str = "Hi")               // val defaults to 9000
@MyAnno(val = 88)                 // str defaults to "Testing"
@MyAnno(str = "Hi", val = 88)     // both explicit
```

### Meta-annotations: `@Retention`, `@Target`, `@Inherited`

Meta-annotations — annotations that annotate other annotation declarations — control how and where an annotation can be used.

`@Target` restricts which kinds of declarations an annotation is legal on, using `ElementType` constants:

```java
@Target({ ElementType.FIELD, ElementType.LOCAL_VARIABLE })
@interface FieldOnly { }
```

Without an explicit `@Target`, the annotation is legal on any **declaration** — classes, methods, fields, parameters, even other annotation declarations — but not on type-use contexts (e.g. `List<@MyAnno String>`), which is rarely what you want, so it's good practice to always specify one.

`@Inherited` only affects annotations placed on class declarations: if a subclass doesn't carry the annotation itself, a lookup walks up to the superclass and returns its `@Inherited`-marked annotation instead of `null`.

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@interface Auditable { }

@Auditable
class Base { }

class Derived extends Base { }   // Derived.class.getAnnotation(Auditable.class) still finds it
```

### Retention policies: SOURCE, CLASS, RUNTIME

`@Retention`, backed by the `java.lang.annotation.RetentionPolicy` enum, decides how long an annotation survives past the source file:

| Policy | Survives compilation? | Visible to the JVM at run time? |
|---|---|---|
| `SOURCE` | No — discarded once the compiler is done (e.g. `@Override`, `@SuppressWarnings`) | No |
| `CLASS` (default if `@Retention` is omitted) | Yes, written into the `.class` file | No |
| `RUNTIME` | Yes | Yes — queryable via reflection |

```java
@Retention(RetentionPolicy.RUNTIME)
@interface MyAnno {
    String str() default "Testing";
    int val() default 9000;
}
```

Only `RUNTIME` retention makes an annotation reachable through `getAnnotation()`/`getAnnotations()` — with `SOURCE` or `CLASS` retention those calls simply return `null` or an empty array, because the JVM never loaded the annotation data in the first place.

### Reading annotations at runtime via reflection

`Class`, `Method`, `Field`, and `Constructor` all implement `AnnotatedElement`, which declares `getAnnotation()`, `getAnnotations()`, and `isAnnotationPresent()`. The pattern is always: get a `Class` object, get the member you care about, then query it.

```java
import java.lang.annotation.*;
import java.lang.reflect.*;

@Retention(RetentionPolicy.RUNTIME)
@interface MyAnno {
    String str() default "Testing";
    int val() default 9000;
}

class Meta {
    @MyAnno(str = "Annotation Example", val = 100)
    public static void myMeth() { }
}

public class AnnoDemo {
    public static void main(String[] args) throws NoSuchMethodException {
        Method m = Meta.class.getMethod("myMeth");

        if (m.isAnnotationPresent(MyAnno.class)) {
            MyAnno anno = m.getAnnotation(MyAnno.class);
            System.out.println(anno.str() + " " + anno.val());  // Annotation Example 100
        }
    }
}
```

`getMethod("myMeth")` needs the `Class` objects of any parameter types too — e.g. `getMethod("myMeth", String.class, int.class)` for an overload that takes those arguments. `getAnnotation()` returns `null` (not an exception) when the annotation isn't present or lacks `RUNTIME` retention, so `isAnnotationPresent()` — or a null check — should guard the call.

An annotation can appear more than once on the same element if it's marked `@Repeatable`, pointing at a container annotation whose `value()` holds an array of it:

```java
@Retention(RetentionPolicy.RUNTIME)
@Repeatable(MyRepeatedAnnos.class)
@interface MyAnno2 {
    String str() default "Testing";
}

@Retention(RetentionPolicy.RUNTIME)
@interface MyRepeatedAnnos {
    MyAnno2[] value();
}

class Repeated {
    @MyAnno2(str = "First")
    @MyAnno2(str = "Second")
    public static void myMeth() { }
}

// reading them back:
Method m = Repeated.class.getMethod("myMeth");
for (MyAnno2 a : m.getAnnotationsByType(MyAnno2.class)) {
    System.out.println(a.str());   // First, then Second
}
```

`getAnnotation(MyRepeatedAnnos.class)` also works and returns the container holding both, but `getAnnotationsByType(MyAnno2.class)` reads through the container automatically and hands back the repeatable annotation directly.

### Built-in annotations: `@Deprecated`, `@SafeVarargs`, `@FunctionalInterface`, `@Documented`

The JDK ships several annotations that don't need a custom declaration. `@Deprecated` marks an element as obsolete and, since JDK 9, takes two optional elements that make the deprecation itself machine-readable:

```java
@Deprecated(since = "9", forRemoval = true)
public void oldMethod() { }
```

`since` records the version the element became deprecated; `forRemoval = true` signals intent to actually delete it in a future release (as opposed to a "deprecated but staying" API) — tools like `javac -Xlint:removal` and IDEs surface this distinction differently from a plain `@Deprecated`.

`@SafeVarargs` suppresses the "heap pollution" warning on a varargs method/constructor whose varargs parameter has a generic or parameterized type, asserting that the method doesn't do anything unsafe with that array — legal only on `static`/`final`/`private` methods or constructors, since overriding could break the safety guarantee. `@FunctionalInterface` documents (and has the compiler enforce) that an interface declares exactly one abstract method, so a lambda or method reference can implement it — it doesn't change behavior, but a second abstract method added later becomes a compile error instead of a silent break. `@Documented` marks an annotation so that when it's applied to an element, tools like `javadoc` include it in that element's generated documentation — without `@Documented`, the annotation is still fully functional at compile/runtime, it's just invisible in the generated API docs.

## Trade-offs

- **`RUNTIME` retention costs a small but real amount of reflection overhead every time an annotation is queried** — fine for one-time startup scanning (DI containers, test discovery), wasteful if called in a hot loop. Prefer `SOURCE` or `CLASS` retention for annotations only tools or the compiler need.
- **`getAnnotation()` returns `null` instead of throwing when the annotation is absent or has the wrong retention policy**, which silently produces a `NullPointerException` two lines later if you skip the presence check.
  ```java
  MyAnno a = m.getAnnotation(MyAnno.class);   // null if retention isn't RUNTIME
  a.val();                                     // NullPointerException, not "annotation missing"
  ```
- **Omitting `@Target` makes an annotation legal on any kind of declaration**, which reads as "attach this to anything" even when only one placement was ever intended — an easy way to end up with an annotation misapplied to a field when it was designed for methods.
- **A repeated annotation's container type is a separate declaration you must maintain in lockstep** — renaming or re-scoping the repeatable annotation without updating its `@Repeatable`-referenced container breaks compilation, not just at the use site but at the declaration itself.
- **Annotation values must be compile-time constants** (primitives, `String`, `Class` literals, enum constants, or arrays/annotations of those) — there's no way to pass a runtime-computed value, which pushes any dynamic configuration out of the annotation and into whatever reads it.

## Documentation Links

- [java.lang.annotation package — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/package-summary.html) — doc
- [Retention — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Retention.html) — doc
- [RetentionPolicy — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/RetentionPolicy.html) — doc
- [Target — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Target.html) — doc
- [Repeatable — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/annotation/Repeatable.html) — doc
- [AnnotatedElement — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html) — doc
- [Deprecated — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Deprecated.html) — doc
- [Annotations (dev.java tutorials)](https://dev.java/learn/annotations/) — doc
