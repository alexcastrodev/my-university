---
version: 1.0
updatedAt: 2026-05-26
---
# Sequenced Collections

---

## Overview

**Java 21** introduced three new interfaces to unify access to the first and last elements across ordered collections:

```
SequencedCollection<E>  extends  Collection<E>
SequencedSet<E>         extends  SequencedCollection<E>, Set<E>
SequencedMap<K,V>       extends  Map<K,V>
```

---

## SequencedCollection

Adds first/last access and a reversed view to any ordered `Collection`:

```java
public interface SequencedCollection<E> extends Collection<E> {
    SequencedCollection<E> reversed();
    void addFirst(E e);
    void addLast(E e);
    E getFirst();
    E getLast();
    E removeFirst();
    E removeLast();
}
```

### Implementations that now implement SequencedCollection

| Class | Order |
|-------|-------|
| `ArrayList` | Insertion order |
| `LinkedList` | Insertion order |
| `ArrayDeque` | Insertion order |
| `LinkedHashSet` | Insertion order |
| `TreeSet` | Sorted order |

```java
List<String> list = new ArrayList<>(List.of("A", "B", "C", "D"));

list.getFirst();       // "A"
list.getLast();        // "D"
list.addFirst("Z");    // ["Z","A","B","C","D"]
list.addLast("X");     // ["Z","A","B","C","D","X"]
list.removeFirst();    // "Z"
list.removeLast();     // "X"

List<String> rev = list.reversed();  // view: ["D","C","B","A"]
```

---

## SequencedSet

Same as `SequencedCollection` but without `addFirst`/`addLast` in some implementations (to maintain set uniqueness contracts). `reversed()` returns a `SequencedSet`.

```java
LinkedHashSet<Integer> set = new LinkedHashSet<>(List.of(1, 2, 3, 4, 5));

set.getFirst();   // 1
set.getLast();    // 5
set.reversed();   // reversed view: {5,4,3,2,1}
```

---

## SequencedMap

Adds first/last entry access and a reversed view to ordered maps:

```java
public interface SequencedMap<K,V> extends Map<K,V> {
    SequencedMap<K,V> reversed();
    Map.Entry<K,V> firstEntry();
    Map.Entry<K,V> lastEntry();
    Map.Entry<K,V> pollFirstEntry();
    Map.Entry<K,V> pollLastEntry();
    K firstKey();
    K lastKey();
    void putFirst(K k, V v);
    void putLast(K k, V v);
    SequencedCollection<K> sequencedKeySet();
    SequencedCollection<V> sequencedValues();
    SequencedSet<Map.Entry<K,V>> sequencedEntrySet();
}
```

### Implementations

| Class | Order |
|-------|-------|
| `LinkedHashMap` | Insertion order |
| `TreeMap` | Sorted order |

```java
LinkedHashMap<String, Integer> map = new LinkedHashMap<>();
map.put("a", 1);
map.put("b", 2);
map.put("c", 3);

map.firstEntry();   // a=1
map.lastEntry();    // c=3
map.putFirst("z", 0);   // z=0 becomes first entry
map.reversed();          // reversed view
```

---

## Before vs After Java 21

```java
// Before Java 21 — verbose and error-prone
List<String> list = new ArrayList<>(List.of("A", "B", "C"));
String first = list.get(0);
String last  = list.get(list.size() - 1);

// Java 21+ — clean and unified
String first = list.getFirst();
String last  = list.getLast();
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `getFirst()` / `getLast()` | Throw `NoSuchElementException` on empty collection |
| `reversed()` | Returns a view — mutations reflect in the original |
| `HashMap` | Does **not** implement `SequencedMap` (no defined order) |
| `HashSet` | Does **not** implement `SequencedSet` |
| Unmodifiable wrappers | `Collections.unmodifiableSequencedCollection()` etc. added in Java 21 |
