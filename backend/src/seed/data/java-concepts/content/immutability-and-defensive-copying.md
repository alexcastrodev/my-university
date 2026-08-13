---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

An immutable class is one whose instances cannot be modified after construction — every field is fixed for the object's entire lifetime. Getting there takes more than marking fields `final`: a class only counts as immutable if nothing, including the class itself, can ever change what an instance holds. That last part is the part people miss — a class can satisfy every rule about its own fields and still be mutable from the outside, because one of its fields points at a mutable object (`java.util.Date`, an array, a `List`) that some other piece of code still holds a reference to. Closing that gap is defensive copying: copying a mutable value on the way *into* a constructor, and copying it again on the way *out* of an accessor, so no other reference into your object's state ever exists.

## Use Cases

- Small value types — a time window, a money amount, a coordinate — that should behave like `String` or `Integer`: pass them anywhere, share them freely, never worry about another piece of code changing them underneath you.
- Any constructor or setter that stores a caller-supplied `Date`, array, `List`, `Map`, or other mutable object into a field — the caller's reference has to be neutralized or it becomes a back door into your object's state.
- Any accessor that returns a field holding a mutable object — the returned reference is a second back door, this time from the *object itself* back out to the caller.
- Designing thread-safe types without synchronization: an object that truly cannot change after construction can be handed to any number of threads with no locking, because there is no mutation for threads to race on.

## Deep Dive

### The five-rule recipe for a truly immutable class

```java
public final class TimeWindow {                 // rule 2: can't be subclassed

    private final Date start;                    // rules 3 & 4: final, private
    private final Date end;

    public TimeWindow(Date start, Date end) {
        // rule 5: defensive copy on the way IN — don't store the caller's reference
        this.start = new Date(start.getTime());
        this.end = new Date(end.getTime());
        if (this.start.after(this.end)) {
            throw new IllegalArgumentException(start + " is after " + end);
        }
    }

    public Date start() {
        return new Date(start.getTime());         // rule 5: defensive copy on the way OUT
    }

    public Date end() {
        return new Date(end.getTime());
    }
    // rule 1: no setStart(...), no setEnd(...) — no mutators at all
}
```

Five rules, all present above:

1. **No mutators.** No `setStart`/`setEnd` — nothing that changes state after construction.
2. **The class can't be extended.** `final` on the class stops a subclass from adding mutator methods or overriding a method to behave as if state changed. The alternative to `final` is a private/package-private constructor plus public static factory methods — since an outside package can't extend a class with no accessible constructor, the class is *effectively* final to its clients without the keyword.
3. **All fields are `final`.** This is enforced by the compiler, not just a convention, and it's also what guarantees a reference to a freshly constructed instance is safe to hand to another thread without extra synchronization (`final` field semantics, JLS §17.5).
4. **All fields are `private`.** A `public final` field is technically safe if it holds a primitive or a reference to an immutable object, but it locks in the internal representation forever — there's no way to change it in a later version without breaking source compatibility.
5. **Exclusive access to any mutable component.** This is the rule the other four don't cover, and it's the subject of the next two sub-topics.

Rules 1–4 are what a class gets automatically from being small and disciplined. Rule 5 is the one that takes active work — and skipping it is exactly how a class that *looks* immutable turns out not to be.

### The defensive-copy attack: mutating state after construction

Take the same class, but skip rule 5 — store the caller's `Date` reference directly instead of copying it:

```java
public final class BrokenTimeWindow {
    private final Date start;
    private final Date end;

    public BrokenTimeWindow(Date start, Date end) {
        if (start.after(end)) {
            throw new IllegalArgumentException(start + " is after " + end);
        }
        this.start = start;   // stores the caller's reference — no copy
        this.end = end;
    }

    public Date start() { return start; }
    public Date end() { return end; }
}
```

Every field is `final`, the class is `final`, both fields are `private` — and it is still mutable, because the caller kept a reference to the same `Date` object that's now inside the instance:

```java
Date start = new Date();
Date end = new Date();
BrokenTimeWindow window = new BrokenTimeWindow(start, end);

end.setTime(0L);              // mutating a reference we still hold...
window.end();                 // ...changed window's internal state — no API of
                               // BrokenTimeWindow was ever called to do it
```

Nothing about `window` was called after construction. The object's state changed anyway, because `start`/`end` inside `window` and the caller's `start`/`end` variables were, and remained, the same two `Date` objects. The fix is the constructor from the first sub-topic: copy the incoming values before storing them, so the instance ends up holding objects the caller never had a reference to in the first place —

```java
this.start = new Date(start.getTime());   // a new object; caller's reference is now irrelevant
this.end = new Date(end.getTime());
```

— and validate the *copies*, not the original arguments. If validation ran on `start`/`end` before copying, another thread could still mutate them in the gap between the check and the copy (a time-of-check/time-of-use window); copying first and validating the result closes that gap.

One more trap on the copying itself: don't make the copy by calling `start.clone()`. `Date` is not `final`, so `clone()` isn't guaranteed to return a `java.util.Date` — a hostile subclass could override `clone()` to return an instance that keeps recording itself somewhere the attacker controls. `new Date(start.getTime())` sidesteps the question entirely by only ever depending on the `long` timestamp, not on what the runtime type of `start` actually is.

### Defensive copying on the way out: accessors

The constructor fix above stops external code from reaching in. It does nothing about the accessors — if `start()` returns the field directly, the caller now holds a live reference to the exact `Date` object living inside the instance:

```java
// leaks the internal object
public Date end() {
    return end;
}

Date leaked = window.end();
leaked.setTime(0L);       // window's real internal state just changed
```

The fix mirrors the constructor: return a copy, not the field.

```java
public Date end() {
    return new Date(end.getTime());
}
```

Arrays need the identical treatment and are easy to forget, because returning an array field looks like returning a value:

```java
private final int[] scores;               // constructor already defensively copied this

public int[] scores() {
    return scores.clone();                 // NOT `return scores;`
}
```

Every non-zero-length array is mutable — there's no such thing as a `final` array whose *contents* are protected by that keyword — so any accessor that hands one back verbatim has handed out a way to rewrite the object's internals. `clone()` is fine here specifically because the field's runtime type is known exactly (`int[]`, not a subclassable reference type); it's the `Date`-style clone that's unsafe, not array cloning.

`java.time` types sidestep this entire sub-topic. `LocalDate`, `Instant`, and the rest of `java.time` are immutable — every "mutator" (`plusDays`, `withYear`, …) returns a new instance and leaves the original untouched — so a field of type `LocalDate` needs no defensive copy in the constructor and no defensive copy in the accessor: returning the field directly is safe, because there is no operation that could mutate what the caller receives. `java.util.Date` needs the copying specifically *because* it's mutable in a way `java.time` deliberately isn't.

## Trade-offs

- **A `record` gives you four of the five rules for free, but not the fifth.** Declaring a component makes its field `private` and `final` with no generated mutator, and the class is implicitly `final` — rules 1 through 4 fall out of using `record` at all. Defensive copying is still something you write yourself: a compact constructor that doesn't copy a mutable component, or an accessor that isn't overridden to return a copy, leaks exactly the way `BrokenTimeWindow` did. See `records-and-sealed-types` for how shallow a record's immutability really is.
  ```java
  record Window(Date start, Date end) {}          // no compact constructor: no defensive copy

  var d = new Date();
  var w = new Window(d, new Date());
  d.setTime(0L);                                   // mutates w.start() too — record didn't help
  ```
- **Defensive copying costs an allocation on every call, and it isn't always worth paying for.** Inside a package where the class and its caller are maintained together, or at a boundary where the API documents that it takes ownership of the argument (a "handoff" — the caller promises not to touch the object again), skipping the copy and documenting the requirement instead can be the right call. It's a decision to make deliberately, not a default to fall back on because copying is inconvenient.
- **Copy before validating, not after.** Validating the caller's original arguments and only copying afterward leaves a window in which another thread can mutate the argument between the check and the copy. Copy first, then validate the copy — as in the `TimeWindow` constructor above — and that window closes.
- **Immutability forces a new object for every distinct state**, which can be a real cost for large or frequently "changed" values — `BigInteger.flipBit` on a million-bit value allocates a whole new million-bit value for a one-bit change, whereas a mutable `BitSet` does the same conceptual edit in constant time. This is a reason some types (bulk builders, accumulators) are deliberately left mutable rather than a reason to avoid immutability for ordinary value types.

## Documentation Links

- [java.util.Date](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Date.html) — doc
- [java.time.LocalDate](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html) — doc
- [Object#clone()](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#clone()) — doc
- [JLS §17.5 — Final Field Semantics](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5) — doc
