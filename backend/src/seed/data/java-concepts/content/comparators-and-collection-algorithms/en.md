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

## Lab

In this lab you get `EmployeeDirectory`, which stores employees in an internal list, with the sorting and lookup methods left empty. Your job is to implement them. The core idea is to build multi-key sorts with `Comparator.comparing()`/`thenComparing()` and to understand the difference between a defensive copy and a live view returned by `Collections.unmodifiableList()`.

**The scenario**

An employee directory that must be listed in different ways without messing up its internal order.

- `Employee(firstName, lastName, salary)`: a record declared in the same file.
- `EmployeeDirectory`: holds the `employees` list, with `add()` ready.
- `sortedByLastThenFirst()` and `sortedBySalaryDescending()`: sorted lists.
- `unmodifiableView()`: read-only access to the internal list.
- `highestPaid()`: the best-paid employee.

The tests check that sorting does not change the internal order and that the view reflects additions made later.

**What you will do, step by step**

1. **Sort by last name then first name (TODO-00).** Build the comparator with `Comparator.comparing(...)` and `thenComparing(...)`, sort a copy of the list (never the internal one) and return the copy.
2. **Sort by salary descending (TODO-01).** Use `Comparator.comparingDouble(...)`, invert it with `reversed()`, sort a copy and return it.
3. **Return a read-only view (TODO-02).** Wrap the internal list with `Collections.unmodifiableList`. It is not a copy: an `add()` made later must show up in the view, and trying to change the view throws `UnsupportedOperationException`.
4. **Find the best-paid (TODO-03).** Use `Collections.max` with a salary comparator, in a single call. On an empty directory it throws `NoSuchElementException`, as the test expects.

**How you know you are done**

`mvn test` is all green. You should be able to explain the difference between copying the list (the result is frozen) and wrapping it in a view (the result follows the original), and say when each one is the right choice.

**Optional challenges**

- **TODO-04:** implement `lowestPaid()`, the same idea as `highestPaid()` in the opposite direction.

**Prerequisites:** basic Java syntax, lambdas and method references, and basic `List` usage. The project uses Java 21 and Maven.

**How to run it:** clone the repository, go into `java-concepts/comparators-and-collection-algorithms` and run `mvn test` (from the root: `mvn -pl java-concepts/comparators-and-collection-algorithms test`). The methods start out throwing `UnsupportedOperationException("Not implemented yet.")` and the `TODO-NN` comments give hints, so the red tests are your checklist.

## Documentation Links

- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
- [Collections — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [List.sort() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#sort(java.util.Comparator)) — doc
