---
version: 1.0
updatedAt: 2026-08-02
---
## Objective

`Comparable` gives a type exactly one natural ordering, baked into the class itself. `Comparator` decouples ordering from the type entirely — a `TreeSet`/`TreeMap` (or any sort call) can be handed a different `Comparator` for every use case, and the `Collections` utility class supplies a set of static algorithms (`sort`, `shuffle`, `min`/`max`, `binarySearch`, and the `unmodifiable`/`synchronized`/`checked` view wrappers) that operate on any `Collection` without needing a matching method on the collection itself.

## Use Cases

- Sorting the same list of accounts by name in one report and by balance in another, without changing the `Account` class's own `compareTo()`.
- Sorting by last name, then by first name when last names tie — a "compare by X then by Y" chain built from two independent comparators.
- Deciding where `null` values should sort (first or last) without special-casing them in every comparator.
- Handing out a read-only or thread-safe view of an existing list to another part of a program, without copying it.
- Finding the min/max of a collection, or checking whether a sorted list contains a value, without writing the loop or binary search by hand.

## Deep Dive

### Comparator vs. Comparable

```java
class Account implements Comparable<Account> {
    String name;
    double balance;

    @Override
    public int compareTo(Account other) {
        return name.compareTo(other.name);   // the ONE natural ordering
    }
}
```

`Comparable.compareTo()` is a method the type itself implements — one fixed
ordering, used automatically by `Collections.sort()`, `TreeSet`, and `TreeMap`
when no comparator is supplied. `Comparator<T>` lives outside the type
entirely:

```java
interface Comparator<T> {
    int compare(T obj1, T obj2);
}
```

Any number of `Comparator<Account>` instances can exist side by side — one
sorting by balance, one by last name — without touching `Account` at all.

### Building comparators with comparing() and thenComparing()

Since Java 8, `Comparator` ships static/default methods that build comparators
from a key-extracting function instead of a full `compare()` implementation:

```java
Comparator<Account> byBalance = Comparator.comparing(Account::balance);
Comparator<Account> byBalanceDesc = Comparator.comparing(Account::balance).reversed();
```

`thenComparing()` chains a second comparator that only runs when the first
one reports a tie:

```java
Comparator<Account> byLastThenFirst =
    Comparator.comparing(Account::lastName)
              .thenComparing(Account::firstName);

accounts.sort(byLastThenFirst);
```

`Comparator.comparingInt()`/`comparingLong()`/`comparingDouble()` (and their
`thenComparing` equivalents) exist specifically to avoid autoboxing when the
key is a primitive.

### Handling nulls and building reverse/natural-order comparators without a class

```java
Comparator<String> naturalOrder = Comparator.naturalOrder();
Comparator<String> reverse = Comparator.reverseOrder();
Comparator<String> nullsSafe = Comparator.nullsFirst(Comparator.naturalOrder());
```

`nullsFirst()`/`nullsLast()` wrap another comparator and decide where `null`
sorts, instead of every comparator needing its own null check.

### The Collections algorithms

`Collections` is a class of static utility methods that work on any
`Collection`/`List`, independent of which concrete implementation is used:

```java
List<Integer> list = new LinkedList<>(List.of(20, -8, 8, -20));

Collections.sort(list, Collections.reverseOrder());   // 20 8 -8 -20
Collections.shuffle(list);
int min = Collections.min(list);
int max = Collections.max(list);
```

Beyond sorting and shuffling: `Collections.unmodifiableList()`/`unmodifiableSet()`/
`unmodifiableMap()` return a read-only *view* backed by the original collection
(mutating the original still shows through the view — it's not a copy);
`synchronizedList()`/`synchronizedSet()`/etc. return thread-safe wrappers (an
iterator over one must still be used inside a `synchronized` block, since
iteration itself isn't atomic); and `checkedList()`/`checkedSet()`/etc. return
a "dynamically typesafe view" that throws `ClassCastException` immediately on
an incompatible insertion, instead of letting it corrupt the collection
silently and surface later at an unrelated read.

### List.sort() — the modern entry point

`List` itself gained a default `sort(Comparator)` method in Java 8, so sorting
a list no longer requires going through `Collections`:

```java
accounts.sort(Comparator.comparing(Account::balance));
```

`List.sort()` calls `Collections.sort()` internally — the two are equivalent
in behavior, but `list.sort(cmp)` reads more directly than
`Collections.sort(list, cmp)` and is the version most current code reaches
for.

## Trade-offs

- **A type can only have one `Comparable.compareTo()`, so if two independent
  orderings are genuinely needed, a `Comparator` is the only option** — trying
  to encode a second ordering into `compareTo()` (a flag field, say) fights
  the contract instead of using the tool built for exactly this.
- **`Collections.unmodifiableList()` returns a *view*, not a defensive copy —
  callers can still be surprised.**
  ```java
  List<String> mutable = new ArrayList<>(List.of("a", "b"));
  List<String> readOnly = Collections.unmodifiableList(mutable);
  mutable.add("c");
  System.out.println(readOnly);   // [a, b, c] — the "read-only" view changed too
  ```
- **`synchronizedList()`/`synchronizedSet()` make individual method calls
  thread-safe, but iteration is not atomic on top of that** — iterating a
  synchronized list from one thread while another thread mutates it still
  needs a manual `synchronized` block around the whole iteration, or it can
  throw `ConcurrentModificationException`.
- **`checkedList()`/`checkedSet()` trade a little runtime overhead for failing
  at the point of the actual bad insertion, not later.** Worth it specifically
  when a raw type or an unsafe cast makes it possible for an incompatible
  element to sneak into an otherwise generically-typed collection — otherwise
  it's overhead with nothing to catch.

## Documentation Links

- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
- [Collections — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [List.sort() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#sort(java.util.Comparator)) — doc
