---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Before JDK 21, "get the first element" meant something different for every collection type: `list.get(0)` for a `List`, `deque.getFirst()` for a `Deque`, and for a `LinkedHashMap` there was no direct method at all — you fell back to grabbing an iterator and calling `next()` once. JEP 431 unifies this: any collection with a defined **encounter order** — a genuine first element, last element, and a stable successor relationship between them — now implements `SequencedCollection`, `SequencedSet`, or `SequencedMap`, which add `getFirst()`/`getLast()`, `addFirst()`/`addLast()`, `removeFirst()`/`removeLast()`, and a `reversed()` view to every type that has one, instead of each collection family inventing its own partial version of the same idea.

## Use Cases

- Reading or removing the head/tail of any ordered collection — `List`, `Deque`, `LinkedHashSet`, `TreeSet` — through one consistent method name, instead of remembering which type uses `get(0)` and which uses `getFirst()`.
- Iterating a `LinkedHashMap` from most-recently-inserted to least (or vice versa) without manually reversing a key set or maintaining a separate structure — `map.reversed()` or `map.sequencedEntrySet()`.
- Implementing an LRU-eviction cache: `LinkedHashMap` already tracks insertion order, and `SequencedMap` gives you `pollFirstEntry()`/`putLast()` to manage the eviction boundary directly.
- Getting a reverse-order *view* of a list or sorted set for iteration, without the mutating `Collections.reverse(list)` or building a second, reversed copy.
- Writing generic code against `SequencedCollection<E>` that works unchanged whether the caller passes a `List`, an `ArrayDeque`, or a `LinkedHashSet`.

## Deep Dive

### The three interfaces

```java
interface SequencedCollection<E> extends Collection<E> {
    SequencedCollection<E> reversed();
    void addFirst(E e);      // optional — UnsupportedOperationException if unmodifiable
    void addLast(E e);       // optional
    E getFirst();            // NoSuchElementException if empty
    E getLast();             // NoSuchElementException if empty
    E removeFirst();         // optional
    E removeLast();          // optional
}
```

`SequencedSet<E>` extends both `Set<E>` and `SequencedCollection<E>`, and narrows `reversed()`'s return type to `SequencedSet<E>` — a reversed set is still a set. `SequencedMap<K,V>` extends `Map<K,V>` with the entry-oriented equivalents:

```java
interface SequencedMap<K,V> extends Map<K,V> {
    SequencedMap<K,V> reversed();
    Map.Entry<K,V> firstEntry();
    Map.Entry<K,V> lastEntry();
    Map.Entry<K,V> pollFirstEntry();
    Map.Entry<K,V> pollLastEntry();
    V putFirst(K k, V v);
    V putLast(K k, V v);
    SequencedSet<K>            sequencedKeySet();
    SequencedCollection<V>     sequencedValues();
    SequencedSet<Entry<K,V>>   sequencedEntrySet();
}
```

### Who gets retrofitted, and who doesn't

```
List            → SequencedCollection   (ArrayList, LinkedList, ...)
Deque           → SequencedCollection   (ArrayDeque, LinkedList, ...)
LinkedHashSet   → SequencedSet
SortedSet       → SequencedSet          (so TreeSet gets it too)
LinkedHashMap   → SequencedMap
SortedMap       → SequencedMap          (so TreeMap gets it too)
```

`HashSet` and `HashMap` are deliberately **not** retrofitted — their iteration order is an implementation detail of the hash table, not a real encounter order, so adding `getFirst()`/`getLast()` there would promise a stability the class was never designed to provide. `PriorityQueue` is excluded for the same underlying reason: iterating it does not visit elements in priority order, so a `getFirst()` that returned "the head of the iteration" would silently misrepresent what the queue actually orders by.

### Uniform access, one line each

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bo", "Cid"));
names.getFirst();          // "Ana" — no more names.get(0)
names.getLast();           // "Cid" — no more names.get(names.size() - 1)
names.addFirst("Zed");     // [Zed, Ana, Bo, Cid]

LinkedHashMap<String,Integer> scores = new LinkedHashMap<>();
scores.put("a", 1); scores.put("b", 2); scores.put("c", 3);
scores.firstEntry();        // a=1 — first inserted
scores.lastEntry();         // c=3 — last inserted
scores.putFirst("z", 0);    // moves/creates "z" as the new first entry
```

`getFirst()`/`getLast()` throw `NoSuchElementException` on an empty collection — a deliberate, checkable exception, unlike `list.get(0)` on an empty list, which throws `IndexOutOfBoundsException` for what is really the same "nothing here" condition. That difference is visible the moment you write code against `SequencedCollection<E>` generically instead of a specific `List`.

### `reversed()` is a live view, not a copy

```java
List<Integer> nums = new ArrayList<>(List.of(1, 2, 3));
List<Integer> rev = nums.reversed();
System.out.println(rev);        // [3, 2, 1]

nums.add(4);
System.out.println(rev);        // [4, 3, 2, 1] — rev reflects the mutation
```

This is the same relationship `Collections.unmodifiableList` or a `subList` has to its backing list — `reversed()` returns a genuine view backed by the original collection, so a structural change to either side is visible through the other. It replaces the older idiom of calling the mutating `Collections.reverse(list)` (which permanently reorders the original) just to iterate backwards once:

```java
// before JEP 431 — mutates the list just to read it in reverse
Collections.reverse(names);
for (String n : names) { /* ... */ }
Collections.reverse(names);           // and reverse it back

// JDK 21+ — no mutation, no need to reverse back
for (String n : names.reversed()) { /* ... */ }
```

### An LRU cache using SequencedMap directly

```java
class LruCache<K,V> extends LinkedHashMap<K,V> {
    private final int capacity;
    LruCache(int capacity) { super(16, 0.75f, true); this.capacity = capacity; }

    void put2(K k, V v) {
        if (containsKey(k)) putLast(k, v);      // move to most-recently-used position
        else {
            put(k, v);
            if (size() > capacity) pollFirstEntry();   // evict the least-recently-used entry
        }
    }
}
```

`LinkedHashMap`'s third constructor argument (`accessOrder = true`) already reorders entries on `get()`; `SequencedMap`'s `putLast`/`pollFirstEntry` give the eviction and re-insertion logic a direct, named API instead of relying on `LinkedHashMap`'s own `removeEldestEntry()` override hook.

## Trade-offs

- **This is a pure addition, not a replacement.** No existing method was deprecated or removed — `list.get(0)` still works exactly as before; `SequencedCollection` only adds a second, more general way to say the same thing, which matters when writing code generic across `List`/`Deque`/`LinkedHashSet` rather than when working with one concrete type you already know.
- **The exclusion of `HashSet`/`HashMap`/`PriorityQueue` is a feature, not a gap.** Retrofitting them would have made a promise about iteration stability none of the three can actually keep — if you need first/last semantics, the fix is switching to `LinkedHashSet`/`LinkedHashMap`/an actual sorted structure, not asking why `HashMap` lacks `firstEntry()`.
- **A `reversed()` view being live, not a copy, is a real behavior to design around.** Passing a `list.reversed()` view somewhere that later mutates the original list changes what the view yields on its next read — usually the desired behavior for a live report, a bug if the caller assumed a snapshot; take an explicit copy (`new ArrayList<>(list.reversed())`) when a frozen order is what's actually needed.
- **This lands on top of the existing type hierarchy, so a type already had partial coverage before JDK 21** — `Deque` already had `getFirst()`/`addFirst()` etc. long before `SequencedCollection` existed; JEP 431 didn't add new behavior to `Deque`, it gave that already-existing shape a name and extended the same shape to `List`, `LinkedHashSet`, and the map side, which previously had nothing comparable.

## Lab

In this lab you get `SequencedOps`, a utility class with five methods left to implement, each isolating one mechanic of Java 21's sequenced collections. Your job is to use the new `SequencedCollection` and `SequencedMap` methods in place of the old tricks. The core idea is that "first", "last" and "reversed" are now part of the contract, so you can write generic code over any collection with a defined order.

**The scenario**

Lists, deques, `LinkedHashSet` and ordered maps now share the same end operations.

- `firstOrThrow`: the first element of a list, with the right exception when it is empty.
- `addToFront`: insert at the start of any `SequencedCollection`.
- `reversedView`: a live, reversed view of a list.
- `firstValueOrNull`: the value of a `SequencedMap`'s first entry.
- `recordMostRecent`: an LRU helper over a `LinkedHashMap`.
- `SequencedOpsTest`: includes tests with `ArrayList`, `ArrayDeque`, `LinkedHashSet`, `LinkedHashMap` and `TreeMap`.

**What you will do, step by step**

1. **First element with the right exception (TODO-00).** In `firstOrThrow`, use the `SequencedCollection` method that throws `NoSuchElementException` on an empty list. `list.get(0)` throws `IndexOutOfBoundsException` for the same condition, and that is not what the test expects.
2. **Generic code (TODO-01).** In `addToFront`, write only against the `SequencedCollection` contract, with no concrete type, so the same method works unmodified with `ArrayList`, `ArrayDeque` and `LinkedHashSet`.
3. **A view, not a copy (TODO-02).** In `reversedView`, return the reversed view that `SequencedCollection` itself declares. A structural change made through the original list must show up in the view, and vice versa.
4. **Direct first entry (TODO-03).** In `firstValueOrNull`, use the `SequencedMap` method for the first entry, with no iterator or walk over `keySet`/`values`, and return `null` if the map is empty. It must work even with a `TreeMap`.
5. **LRU with `putLast` and `pollFirstEntry` (TODO-04).** In `recordMostRecent`, if the key is already present, update its value and move it to the end; otherwise insert it as the last entry. Then, if the map goes over `capacity`, remove the entry at the front (the least recently used).

**How you know you are done**

`mvn test` is all green. Reread the `reversedView` tests and confirm that a mutation on one side shows up on the other. You should be able to explain why a live view is dangerous when you wanted a snapshot.

**Optional challenges**

- **TODO-05:** implement `frozenReversedCopy`, which returns a reversed copy that does not reflect later changes to the list: the fix for when a live view is the wrong tool.

**Prerequisites:** basic collections (`List`, `Deque`, `LinkedHashMap`) and Java 21.

**How to run it:** clone the repository, go into `java-concepts/sequenced-collections` and run `mvn test` (or, from the root, `mvn -pl java-concepts/sequenced-collections test`). The methods throw `UnsupportedOperationException` until you implement them, so the red tests show what is left.

## Documentation Links

- [JEP 431: Sequenced Collections](https://openjdk.org/jeps/431) — doc
- [SequencedCollection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html) — doc
- [SequencedMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedMap.html) — doc
- [SequencedSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedSet.html) — doc
- [Creating Sequenced Collections, Sets, and Maps — Oracle Java SE 25 documentation](https://docs.oracle.com/en/java/javase/25/core/creating-sequenced-collections-sets-and-maps.html) — doc
