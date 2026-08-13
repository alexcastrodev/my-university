---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

`Object.equals()`, `Object.hashCode()`, and `Object.toString()` each come with a documented contract, not just a default implementation. Overriding one without honoring its contract — or overriding `equals()` while leaving `hashCode()` alone — compiles cleanly and fails silently at runtime: broken collection lookups, objects that stop being equal to themselves under composition, unreadable log output. This concept covers what each contract actually requires and how to satisfy all three correctly.

## Use Cases

- Giving a class *logical* equality instead of the identity equality `Object` provides by default — two separate instances that represent the same value (a point, a money amount, an ID) should compare equal.
- Making a class safe to use as a `HashMap` key or `HashSet` element, where correctness depends on `equals()` and `hashCode()` agreeing with each other.
- Producing a `toString()` that turns a log line or a debugger watch expression from `Order@1a2b3c` into something a person can actually read.
- Recognizing when *not* to override `equals()` at all — classes with inherent identity (like `Thread`), or ones where a superclass's `equals()` is already correct.

## Deep Dive

### The equals() contract, and how symmetry breaks first

`Object.equals(Object)` is documented as an equivalence relation. For any non-null references `x`, `y`, `z`:

- **Reflexive** — `x.equals(x)` must be `true`.
- **Symmetric** — `x.equals(y)` must be `true` if and only if `y.equals(x)` is `true`.
- **Transitive** — if `x.equals(y)` and `y.equals(z)` are both `true`, then `x.equals(z)` must be `true`.
- **Consistent** — repeated calls to `x.equals(y)` return the same result, as long as neither object's compared state changes.
- **Non-null** — `x.equals(null)` must be `false`.

The requirement that breaks first in practice is symmetry, and the classic trigger is a subclass that adds a field the superclass's `equals()` doesn't know about:

```java
public class Point {
    private final int x, y;

    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Point p)) return false;
        return p.x == x && p.y == y;
    }
}

public class ColorPoint extends Point {
    private final Color color;

    public ColorPoint(int x, int y, Color color) {
        super(x, y);
        this.color = color;
    }

    // Broken — violates symmetry
    @Override
    public boolean equals(Object o) {
        if (!(o instanceof ColorPoint cp)) return false;
        return super.equals(o) && cp.color == color;
    }
}
```

```java
Point p = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, Color.RED);

p.equals(cp);   // true  — Point.equals only looks at x and y
cp.equals(p);   // false — ColorPoint.equals requires a ColorPoint
```

Trying to "fix" this by having `ColorPoint.equals()` fall back to a color-blind comparison when the argument is a plain `Point` restores symmetry but breaks transitivity instead — two `ColorPoint`s of different colors can each equal the same `Point` at (1, 2) without equaling each other. There's no way to add a value component in a subclass and preserve the full contract while still extending a concrete, instantiable class. The two ways out are: don't add a value component in the subclass, or don't extend — give `ColorPoint` a `Point` field (composition) instead of a `Point` superclass.

A correct `equals()` follows the same shape regardless: compare by reference first (`this == o`) as a cheap short-circuit, then use `instanceof` — which returns `false` for `null` and for the wrong type in one check, covering both the non-null requirement and the type check without a separate `null` guard:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Point p)) return false;
    return p.x == x && p.y == y;
}
```

For fields that can themselves be `null`, `Objects.equals(a, b)` does the null-safe comparison (`true` if both are `null`, otherwise `a.equals(b)`) instead of hand-rolling it per field.

### equals() and hashCode() are one contract, not two

`Object.hashCode()` is documented with its own rules, but the one that matters here is: **if two objects are equal according to `equals()`, they must return the same `hashCode()`.** Nothing in the language enforces this — a class can override `equals()` and leave `hashCode()` untouched, and it will compile without warning. What breaks is every hash-based collection built on the assumption that the two methods agree.

```java
public final class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Point p)) return false;
        return p.x == x && p.y == y;
    }
    // no hashCode() override — inherits Object's identity-based hash
}
```

```java
Map<Point, String> labels = new HashMap<>();
labels.put(new Point(1, 2), "origin-ish");

labels.get(new Point(1, 2)); // null — not "origin-ish"
```

Both `Point` instances are equal by `equals()`, but each carries its own identity-derived `hashCode()`, so `put()` and `get()` almost certainly land in different buckets — and even in the rare case they collide, `HashMap` caches each entry's hash and skips the `equals()` check entirely when the hashes don't match. The lookup fails without throwing anything; it just silently doesn't find what's obviously "there."

A correct `hashCode()` follows a simple recipe: start from a nonzero constant, and for every field also used in `equals()`, fold it in with `result = 31 * result + fieldHash`:

```java
@Override
public int hashCode() {
    int result = 17;
    result = 31 * result + x;
    result = 31 * result + y;
    return result;
}
```

`java.util.Objects` provides a shortcut that does the same folding for any number of fields, at a small varargs/boxing cost:

```java
@Override
public int hashCode() {
    return Objects.hash(x, y);
}
```

The rule that actually matters for correctness is narrower than "hash every field": every field read by `equals()` must be read by `hashCode()` too. Leaving one out risks equal objects hashing differently; including a field `equals()` ignores just adds noise. Whichever fields go in, `hashCode()` must derive them the same way every time the object is unchanged — see Consistency in the `equals()` contract above — otherwise a mutable field used in the hash breaks lookups the moment it's mutated after insertion (see the hash-bucket mechanics in the HashMap concept for what that looks like on the bucket side).

### toString(): what Object gives you, and why it's not enough

`Object.toString()`'s default implementation returns the class name, `@`, and the hex hash code — `Point@7229724f`. It's not wrong, just useless: it tells you nothing about *which* point this is. `toString()` is invoked automatically by `println`, string concatenation, `String.format`/`printf`, `assert` messages, and most debuggers — so a class that never overrides it produces unreadable output in every one of those places without anyone having to ask for it:

```java
System.out.println("Failed to connect: " + phoneNumber);
// no override: Failed to connect: PhoneNumber@1a2b3c
// overridden:  Failed to connect: (707) 867-5309
```

Overriding it is a two-part decision: what to put in the string, and whether to document its *format* as part of the class's API. Documenting an exact format (as `BigInteger` and `BigDecimal` do) gives callers a stable, parseable representation — and it's worth pairing with a static factory or constructor that parses it back. Leaving the format unspecified keeps the freedom to change it later, at the cost of callers having no textual contract to rely on. Either way, the class should still expose the underlying data through real accessors — a `toString()` output is a poor substitute for an API, and parsing it back defeats the point of writing structured code in the first place.

```java
/**
 * Returns this point's coordinates, formatted as "(x, y)".
 */
@Override
public String toString() {
    return "(" + x + ", " + y + ")";
}
```

### Records: the same three methods, generated correctly

A `record` generates `equals()`, `hashCode()`, and `toString()` for every component automatically, and generates them *consistently with each other* by construction — there's no way to end up with a record whose `equals()` and `hashCode()` disagree, because both are derived from the same component list by the compiler, not written by hand twice:

```java
record Point(int x, int y) {}

Point a = new Point(1, 2);
Point b = new Point(1, 2);
a.equals(b);      // true  — structural equality over every component
a.hashCode() == b.hashCode(); // true — always, for equal records
a.toString();     // "Point[x=1, y=2]"
```

For a plain value type, this replaces the entire recipe above with zero hand-written code. It doesn't replace judgment, though — the `ColorPoint`-style symmetry problem still applies if a record is compared against a differently-shaped type, and the "own reference vs. mutable content" caveat around record fields still applies to whatever's inside. General record mechanics (compact constructors, sealed hierarchies with records) are covered in the Records and Sealed Types concept; this is just the equals/hashCode/toString angle.

## Trade-offs

- **`instanceof` vs. `getClass()` in `equals()` trades symmetry for substitutability.** An `instanceof` check lets a subclass compare equal to its superclass (as long as the subclass adds no value component), which is what the `Point`/`ColorPoint` example above needed to avoid. A `getClass()` check sidesteps that specific symmetry problem by requiring an exact type match — but it then breaks the Liskov substitution principle for harmless subclasses that add no state at all (e.g. one that just counts how many instances were created), because such a subclass instance can never equal an otherwise-identical superclass instance.
  ```java
  // getClass()-based equals: exact type match only
  @Override
  public boolean equals(Object o) {
      if (o == null || o.getClass() != getClass()) return false;
      Point p = (Point) o;
      return p.x == x && p.y == y;
  }
  // a Set<Point> built with new Point(...) instances will never
  // report true for contains() on an equal CounterPoint instance,
  // even though CounterPoint adds no comparable state
  ```
- **Overriding `equals()` without `hashCode()` compiles without error or warning.** Nothing in the type system links the two methods, so the mistake only shows up as a collection silently misbehaving at runtime, not as a build failure.
  ```java
  Set<Point> seen = new HashSet<>();
  seen.add(new Point(1, 2));
  seen.add(new Point(1, 2)); // equal by equals(), but no hashCode() override
  seen.size(); // 2, not 1 — the "duplicate" landed in a different bucket
  ```
- **A `hashCode()` that ignores the contract's third clause is still legal, just bad.** Returning a constant satisfies "equal objects have equal hash codes" — trivially, since every object has the same hash — but it collapses every bucket into one, turning average O(1) hash-table operations into O(n).
  ```java
  @Override
  public int hashCode() { return 42; } // legal, atrocious
  ```
- **Specifying `toString()`'s exact format is a one-way door.** It gives callers something stable to parse and log against, but once published and depended on, changing it is a breaking change — the same way changing a public method signature would be. Leaving the format unspecified keeps that freedom but means anyone who parses the output anyway is relying on an explicitly undocumented detail.

## Documentation Links

- [Object — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html) — doc
- [Objects — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html) — doc
- [Record — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html) — doc
