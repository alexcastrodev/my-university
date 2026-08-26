---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

The Java platform has a well-established set of naming conventions, many of which are contained in The Java Language Specification. Naming conventions fall into two categories: typographical (how an identifier is capitalized and punctuated) and grammatical (what part of speech — noun, verb, adjective — an identifier's name takes, based on what it represents). Both matter: an API that violates the typographical conventions may be difficult to use, and an implementation that violates them may be difficult to maintain — in both cases, violations can confuse and irritate other programmers and cause faulty assumptions that lead to errors.

## Use Cases

- Naming a new package so it won't collide with other organizations' packages and clearly signals ownership.
- Naming a class, interface, enum, or annotation type so its role is obvious at a glance.
- Deciding whether a method name should start lowercase, get a `get`/`is`/`has` prefix, or read as a plain noun or verb phrase.
- Naming a `static final` field correctly as a constant versus naming an ordinary instance field.
- Choosing short, conventional names for local variables and generic type parameters without sacrificing clarity.
- Naming a boolean-returning method or boolean field so callers can tell at the call site what `true` means.
- Naming a type-conversion or static-factory method so its behavior is predictable from its name alone.

## Deep Dive

### Typographical conventions

There are only a handful of typographical naming conventions, covering packages, classes, interfaces, methods, fields, and type variables. You should rarely violate them, and never without a very good reason.

**Packages** should be hierarchical with components separated by periods. Components should consist of lowercase alphabetic characters and, rarely, digits. The name of any package used outside your organization should begin with your organization's Internet domain name with the top-level domain first, for example `edu.cmu`, `com.sun`, `gov.nsa`. The standard libraries and optional packages, whose names begin with `java` and `javax`, are exceptions to this rule — users must not create packages whose names begin with `java` or `javax`.

The remainder of a package name should consist of one or more components describing the package. Components should be short, generally eight or fewer characters. Meaningful abbreviations are encouraged, for example `util` rather than `utilities`. Acronyms are acceptable, for example `awt`. Components should generally consist of a single word or abbreviation.

Many packages have names with just one component in addition to the Internet domain name. Additional components are appropriate for large facilities whose size demands they be broken up into an informal hierarchy — for example `javax.swing` has a rich hierarchy of subpackages such as `javax.swing.plaf.metal`, although there is no linguistic support for package hierarchies as such.

**Classes and interfaces**, including enum and annotation type names, should consist of one or more words, with the first letter of each word capitalized, for example `Timer` or `FutureTask`. Abbreviations are to be avoided, except for acronyms and certain common abbreviations like `max` and `min`. There is little consensus on whether acronyms should be uppercase or have only their first letter capitalized — while uppercase may be more common, a strong argument favors capitalizing only the first letter: even if multiple acronyms occur back-to-back, you can still tell where one word starts and the next ends. Compare `HTTPURL` to `HttpUrl`.

**Methods and fields** follow the same typographical conventions as class and interface names, except that the first letter should be lowercase, for example `remove` or `ensureCapacity`. If an acronym occurs as the first word of a method or field name, it should be lowercase.

The sole exception concerns **constant fields**, whose names should consist of one or more uppercase words separated by the underscore character, for example `VALUES` or `NEGATIVE_INFINITY`. A constant field is a `static final` field whose value is immutable: if a `static final` field has a primitive type or an immutable reference type, it's a constant field (enum constants qualify). A `static final` field with a mutable reference type can still be a constant field if the referenced object itself is immutable. Constant fields constitute the only recommended use of underscores.

**Local variables** have similar typographical conventions to member names, except that abbreviations are permitted, as are individual characters and short sequences of characters whose meaning depends on the context in which the variable occurs, for example `i`, `xref`, `houseNumber`.

**Type parameter names** usually consist of a single letter. Most commonly it's one of five: `T` for an arbitrary type, `E` for the element type of a collection, `K` and `V` for the key and value types of a map, and `X` for an exception. A sequence of arbitrary types can be `T, U, V` or `T1, T2, T3`.

Quick-reference table:

| Identifier Type | Examples |
|---|---|
| Package | `com.google.inject`, `org.joda.time.format` |
| Class or Interface | `Timer`, `FutureTask`, `LinkedHashMap`, `HttpServlet` |
| Method or Field | `remove`, `ensureCapacity`, `getCrc` |
| Constant Field | `MIN_VALUE`, `NEGATIVE_INFINITY` |
| Local Variable | `i`, `xref`, `houseNumber` |
| Type Parameter | `T`, `E`, `K`, `V`, `X`, `T1`, `T2` |

### Grammatical conventions

Grammatical naming conventions are more flexible and more controversial than typographical conventions. There are no grammatical naming conventions to speak of for packages.

**Classes**, including enum types, are generally named with a singular noun or noun phrase, for example `Timer`, `BufferedWriter`, or `ChessPiece`. **Interfaces** are named like classes, for example `Collection` or `Comparator`, or with an adjective ending in `able` or `ible`, for example `Runnable`, `Iterable`, or `Accessible`. Because annotation types have so many uses, no single part of speech predominates — nouns, verbs, prepositions, and adjectives are all common, for example `BindingAnnotation`, `Inject`, `ImplementedBy`, or `Singleton`.

**Methods that perform an action** are generally named with a verb or verb phrase (including its object), for example `append` or `drawImage`.

**Methods that return a boolean** usually have names that begin with `is` or, less commonly, `has`, followed by a noun, noun phrase, or any word or phrase that functions as an adjective, for example `isDigit`, `isProbablePrime`, `isEmpty`, `isEnabled`, or `hasSiblings`.

**Methods that return a non-boolean function or attribute** of the object on which they're invoked are usually named with a noun, a noun phrase, or a verb phrase beginning with `get`, for example `size`, `hashCode`, or `getTime`. There is a vocal contingent claiming that only the `get`-prefixed form is acceptable, but there's little basis for this claim — the first two forms usually lead to more readable code, for example:

```java
if (car.speed() > 2 * SPEED_LIMIT)
    generateAudibleAlert("Watch out for cops!");
```

The `get`-prefixed form is mandatory if the class containing the method is a Bean, and advisable if you're considering turning the class into a Bean later. There is also strong precedent for the `get` form when the class contains a method to set the same attribute — in that case the two methods should be named `getAttribute` and `setAttribute`.

A few method names deserve special mention:

- Methods that **convert the type of an object**, returning an independent object of a different type, are often called `toType`, for example `toString`, `toArray`.
- Methods that **return a view** whose type differs from that of the receiving object are often called `asType`, for example `asList`.
- Methods that **return a primitive with the same value** as the object on which they're invoked are often called `typeValue`, for example `intValue`.
- Common names for **static factories** are `valueOf`, `of`, `getInstance`, `newInstance`, `getType`, and `newType`.

**Field names** are less well established and less important than those for classes, interfaces, and methods, since well-designed APIs expose few if any fields. `boolean` fields are often named like boolean accessor methods with the initial `is` omitted, for example `initialized`, `composite`. Fields of other types are usually named with nouns or noun phrases, such as `height`, `digits`, or `bodyStyle`. Grammatical conventions for local variables are similar to those for fields, but even weaker.

To summarize: internalize the standard naming conventions and learn to use them as second nature. The typographical conventions are straightforward and largely unambiguous; the grammatical conventions are more complex and looser. As The Java Language Specification puts it, "These conventions should not be followed slavishly if long-held conventional usage dictates otherwise." Use common sense.

## Trade-offs

- **Consistency vs. rigidity** — naming conventions should rarely be violated and never without a very good reason, since violating an API's conventions can make it hard to use, and violating an implementation's conventions can make it hard to maintain; but the JLS itself notes these conventions "should not be followed slavishly if long-held conventional usage dictates otherwise," so judgment still applies at the edges.
- **`get`-prefix debate** — some claim only `get`-prefixed accessor names are acceptable, but noun-only or verb-phrase names (`size`, `hashCode`, `getTime`) often read more naturally in conditional expressions; the `get` form becomes mandatory only when the class is a JavaBean or is likely to become one, or when a paired setter already uses `setAttribute`.
  ```java
  if (car.speed() > 2 * SPEED_LIMIT)
      generateAudibleAlert("Watch out for cops!");
  ```
- **Acronym casing has no consensus** — uppercase acronyms (`HTTPURL`) are common, but capitalizing only the first letter (`HttpUrl`) keeps word boundaries readable even when acronyms sit back-to-back; the book favors the latter but acknowledges there's no settled answer.
- **Underscores are constant-field-only** — constant fields (`static final` with a primitive or immutable reference type) use `UPPER_CASE_WITH_UNDERSCORES`, but this is the sole recommended use of underscores anywhere in the typographical conventions; using them elsewhere (regular fields, methods, classes) breaks convention.

## Documentation Links

- [Java SE 25 API Documentation](https://docs.oracle.com/en/java/javase/25/docs/api/index.html) — doc
