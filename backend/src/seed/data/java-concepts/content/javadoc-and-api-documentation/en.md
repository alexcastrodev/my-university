---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

If an API is to be usable, it must be documented. The Javadoc utility generates API documentation automatically from source code with specially formatted documentation comments, more commonly known as doc comments. To document an API properly, every exported class, interface, constructor, method, and field declaration should be preceded by a doc comment. In the absence of a doc comment, the best Javadoc can do is reproduce the declaration itself as the only documentation for that element — which is frustrating and error-prone for whoever has to use the API. For maintainable code, it's also worth writing doc comments for most unexported classes, interfaces, constructors, methods, and fields.

## Use Cases

- Describing a method's contract for its clients: preconditions, postconditions, and side effects.
- Documenting every parameter, return value, and exception a method can throw.
- Writing the one-line summary description that identifies an API element in generated documentation and in IDE tooltips.
- Documenting type parameters on generic classes and methods.
- Documenting enum constants and annotation type members.
- Reusing a doc comment from a supertype or interface instead of duplicating it.
- Writing package-level documentation.

## Deep Dive

### A method's contract: @param, @return, @throws

The doc comment for a method should describe succinctly the contract between the method and its client — what the method does, not how it does it (except for methods in classes designed for inheritance). It should enumerate the method's preconditions (what has to be true for a client to invoke it) and postconditions (what will be true after the invocation completes successfully). Preconditions are typically described implicitly by `@throws` tags for unchecked exceptions — each unchecked exception corresponds to a precondition violation — and can also be specified along with the affected parameters in their `@param` tags. Methods should also document any side effects: an observable change in system state that isn't obviously required to achieve the postcondition (for example, if a method starts a background thread, the documentation should say so).

To describe a method's contract fully, the doc comment should have an `@param` tag for every parameter, an `@return` tag unless the method has a `void` return type, and an `@throws` tag for every exception the method can throw, checked or unchecked. By convention:

- The text following `@param` or `@return` should be a noun phrase describing the value.
- The text following `@throws` should be the word "if" followed by a clause describing the conditions under which the exception is thrown.
- None of these phrases or clauses is terminated by a period.

```java
/**
 * Returns the element at the specified position in this list.
 *
 * <p>This method is <i>not</i> guaranteed to run in constant
 * time. In some implementations it may run in time proportional
 * to the element position.
 *
 * @param index index of element to return; must be
 *         non-negative and less than the size of this list
 * @return the element at the specified position in this list
 * @throws IndexOutOfBoundsException if the index is out of range
 *         ({@code index < 0 || index >= this.size()})
 */
E get(int index);
```

Notice the HTML tags `<p>` and `<i>` — Javadoc translates doc comments into HTML, and arbitrary HTML elements inside a doc comment end up in the generated HTML document. Also notice the word "this" in the doc comment: by convention, "this" always refers to the object on which the method is invoked, when used in the doc comment for an instance method.

### {@code} and {@literal}

The `{@code}` tag around the code fragment in the `@throws` clause above serves two purposes: it renders the fragment in code font, and it suppresses processing of HTML markup and nested Javadoc tags inside it. That second property is what allows the less-than sign (`<`) to appear in the fragment even though `<` is an HTML metacharacter — `{@code}` eliminates the need to escape HTML metacharacters, so the older `<code>` or `<tt>` HTML tags are no longer necessary in doc comments. To include a multiline code example, wrap a `{@code}` tag inside an HTML `<pre>` tag: precede the example with `<pre>{@code` and follow it with `}</pre>`.

Generated documentation must still take special action for HTML metacharacters such as `<`, `>`, and `&` that are *not* wrapped in `{@code}`. The way to get these characters into the documentation is to surround them with the `{@literal}` tag, which — like `{@code}` — suppresses processing of HTML markup and nested Javadoc tags, except that it doesn't render the text in code font:

```java
* The triangle inequality is {@literal |x + y| < |x| + |y|}.
```

This produces the documentation "The triangle inequality is |x + y| < |x| + |y|." The `{@literal}` tag could have been placed around just the less-than sign instead of the whole inequality, with the same resulting documentation — but the doc comment would have been less readable in the source. This illustrates the general principle: doc comments should be readable both in source and in generated documentation; when both can't be achieved, generated documentation readability wins.

### The summary description

The first "sentence" of a doc comment becomes the summary description of the element it documents. In the `get(int index)` example above, the summary description is "Returns the element at the specified position in this list." The summary description must stand on its own — no two members or constructors in a class or interface should share the same summary description, which takes particular care for overloaded methods (it's often natural, but unacceptable in doc comments, to reuse the same first sentence in prose across overloads).

Be careful when the intended summary contains a period — the summary ends at the first period followed by a space, tab, or line terminator (or at the first block tag). A doc comment beginning "A college degree, such as B.S., M.S. or Ph.D." would produce the truncated summary "A college degree, such as B.S., M.S." because the period in "M.S." is followed by a space. The fix is to wrap the offending period and its surrounding text in `{@literal}` so the period is no longer followed by whitespace in the source:

```java
/**
 * A college degree, such as B.S., {@literal M.S.} or Ph.D.
 * College is a fountain of knowledge where many go to drink.
 */
public class Degree { ... }
```

The summary description should seldom be a complete sentence:

- For methods and constructors, it should be a full verb phrase (including any object) describing the action performed — e.g. `ArrayList(int initialCapacity)` — "Constructs an empty list with the specified initial capacity," or `Collection.size()` — "Returns the number of elements in this collection."
- For classes, interfaces, and fields, it should be a noun phrase describing the thing represented — e.g. `TimerTask` — "A task that can be scheduled for one-time or repeated execution by a Timer," or `Math.PI` — "The double value that is closer than any other to pi, the ratio of the circumference of a circle to its diameter."

### Generics, enums, and annotations

When documenting a generic type or method, document every type parameter with a `@param <TypeParam>` tag:

```java
/**
 * An object that maps keys to values. A map cannot contain
 * duplicate keys; each key can map to at most one value.
 *
 * (Remainder omitted)
 *
 * @param <K> the type of keys maintained by this map
 * @param <V> the type of mapped values
 */
public interface Map<K, V> {
    ... // Remainder omitted
}
```

When documenting an enum type, document the constants as well as the type and its public methods. An entire doc comment can go on one line if it's short:

```java
/**
 * An instrument section of a symphony orchestra.
 */
public enum OrchestraSection {
    /** Woodwinds, such as flute, clarinet, and oboe. */
    WOODWIND,

    /** Brass instruments, such as french horn and trumpet. */
    BRASS,

    /** Percussion instruments, such as timpani and cymbals */
    PERCUSSION,

    /** Stringed instruments, such as violin and cello. */
    STRING;
}
```

When documenting an annotation type, document any members as well as the type itself, treating members like fields (noun phrases). For the summary description of the type, use a verb phrase saying what it means for a program element to carry the annotation:

```java
/**
 * Indicates that the annotated method is a test method that
 * must throw the designated exception to succeed.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ExceptionTest {
    /**
     * The exception that the annotated test method must throw
     * in order to pass. (The test is permitted to throw any
     * subtype of the type described by this class object.)
     */
    Class<? extends Exception> value();
}
```

### Inheriting doc comments with {@inheritDoc}

Javadoc can "inherit" method comments. If an API element has no doc comment of its own, Javadoc searches for the most specific applicable doc comment, preferring interfaces over superclasses. Parts of a doc comment can also be inherited explicitly with the `{@inheritDoc}` tag, letting a class reuse doc comments from the interfaces it implements instead of copying them. This can reduce the burden of maintaining multiple, nearly identical sets of doc comments, but it is tricky to use and has some limitations.

### Thread safety, serializability, and package-level docs

Two aspects of a class's exported API that are often neglected are thread safety and serializability. Whether or not a class is thread-safe, its doc comment should document its thread-safety level. If a class is serializable, its doc comment should document its serialized form. Package-level doc comments belong in a file called `package-info.java`; in addition to the package-level doc comment, `package-info.java` can (but is not required to) contain a package declaration and package annotations.

## Trade-offs

- **Mandatory, not optional, for exported elements** — without a doc comment, Javadoc can only reproduce the raw declaration, which is frustrating and error-prone for anyone consuming the API. Treat doc comments as required for every exported class, interface, constructor, method, and field.
- **HTML metacharacters need explicit handling** — `<`, `>`, and `&` inside a doc comment must be escaped or wrapped in `{@literal}`/`{@code}`, or the generated HTML breaks.
  ```java
  * The triangle inequality is {@literal |x + y| < |x| + |y|}.
  ```
- **`@param`/`@return`/`@throws` phrasing is a convention, not enforced by the compiler** — noun phrases for `@param`/`@return`, an "if" clause for `@throws`, no trailing period. Nothing stops a doc comment from breaking this convention, but consistency is what makes generated docs predictable to read.
- **Overloaded methods can't share a summary description** — it's natural in prose to describe overloads with the same first sentence, but doc comments require each member's summary to be distinct, which takes deliberate wording.
- **`{@inheritDoc}` saves duplication but is tricky** — it lets a class reuse an interface's doc comment instead of copying it, reducing the maintenance burden of near-identical comments, but the inheritance search rules have real limitations and edge cases to be careful of.
- **Source readability vs. generated readability** — a `{@literal}` or `{@code}` span can be scoped tightly around just the problem character, or loosely around a whole phrase; the tighter scoping can read worse in source. When the two goals conflict, favor the readability of the generated documentation.

## Documentation Links

- [javadoc tool guide](https://docs.oracle.com/en/java/javase/25/javadoc/javadoc.html) — doc
- [Java SE 25 API documentation](https://docs.oracle.com/en/java/javase/25/docs/api/index.html) — doc
