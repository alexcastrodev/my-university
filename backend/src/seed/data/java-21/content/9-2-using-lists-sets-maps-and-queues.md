# Using Lists, Sets, Maps, and Queues

## The Collection Hierarchy

The Java Collections Framework organizes data structures under two root interfaces:

- **`Collection<E>`** — the parent of `List`, `Set`, and `Queue`.
- **`Map<K,V>`** — a separate hierarchy; maps keys to values and does **not** extend `Collection`.

```
Iterable
  └── Collection
        ├── List       (ordered, duplicates allowed)
        ├── Set        (no duplicates)
        └── Queue      (designed for holding elements prior to processing)
              └── Deque (double-ended queue)

Map (separate hierarchy)
```

Java 21 also introduces **`SequencedCollection`** (see below).

## List

A `List` is an **ordered**, **index-based** collection that allows duplicates.

### Common Implementations

| Class | Backed by | Best for |
|-------|-----------|----------|
| `ArrayList` | Resizable array | Random access, iteration |
| `LinkedList` | Doubly-linked list | Frequent insert/remove at ends, also implements `Deque` |

### Core List Methods

```java
List<String> list = new ArrayList<>();
list.add("Alice");          // append
list.add(0, "Bob");         // insert at index 0
list.set(1, "Charlie");     // replace element at index 1
list.remove(0);             // remove by index
list.remove("Charlie");     // remove by value (first occurrence)
String name = list.get(0);  // retrieve by index
int size = list.size();     // number of elements
boolean has = list.contains("Alice");
list.sort(Comparator.naturalOrder());
```

## Set

A `Set` is a collection that **does not allow duplicates**. Attempting to add a duplicate is silently ignored (returns `false`).

### Common Implementations

| Class | Ordering | Null allowed |
|-------|----------|--------------|
| `HashSet` | No ordering guaranteed | Yes (one null) |
| `LinkedHashSet` | Insertion order | Yes (one null) |
| `TreeSet` | Natural/comparator order (sorted) | No |

```java
Set<String> hash   = new HashSet<>(List.of("C", "A", "B", "A")); // size 3
Set<String> linked = new LinkedHashSet<>(List.of("C", "A", "B")); // C, A, B
Set<String> tree   = new TreeSet<>(List.of("C", "A", "B"));       // A, B, C (sorted)

hash.add("D");
hash.remove("A");
boolean has = hash.contains("C");
```

## Map

A `Map` stores **key-value pairs**. Keys are unique; each key maps to exactly one value.

### Common Implementations

| Class | Ordering |
|-------|----------|
| `HashMap` | No ordering guaranteed |
| `LinkedHashMap` | Insertion order |
| `TreeMap` | Natural/comparator order by key (sorted) |

### Core Map Methods

```java
Map<String, Integer> scores = new HashMap<>();
scores.put("Alice", 95);
scores.put("Bob", 87);
scores.put("Alice", 99);        // replaces existing value for "Alice"

int score  = scores.get("Alice");          // 99
boolean ok = scores.containsKey("Bob");    // true
scores.remove("Bob");

// Safe retrieval — returns default if key absent
int val = scores.getOrDefault("Carol", 0); // 0

// Add only if key is absent
scores.putIfAbsent("Dave", 80);

// merge: combine existing value with new value using a function
scores.merge("Alice", 5, Integer::sum);  // 99 + 5 = 104

// computeIfAbsent: compute and store a value only if key is missing
scores.computeIfAbsent("Eve", k -> k.length()); // "Eve".length() = 3
```

### Iterating a Map

```java
Map<String, Integer> map = Map.of("a", 1, "b", 2);

// Entry set — most common
for (Map.Entry<String, Integer> entry : map.entrySet()) {
    System.out.println(entry.getKey() + " = " + entry.getValue());
}

// Keys only
for (String key : map.keySet()) { /* ... */ }

// Values only
for (int v : map.values()) { /* ... */ }
```

## Queue and Deque

A `Queue` is designed for **FIFO** (first-in, first-out) processing. A `Deque` (double-ended queue) supports insertion and removal at **both ends** and can act as both a stack and a queue.

`ArrayDeque` is the preferred general-purpose implementation. `LinkedList` also implements `Deque`.

### ArrayDeque as a Queue (FIFO)

```java
Queue<String> queue = new ArrayDeque<>();
queue.offer("first");   // add to tail — returns false if capacity limited
queue.offer("second");
queue.offer("third");

String head = queue.peek();  // view head without removing — "first"
String out  = queue.poll();  // remove and return head — "first"
```

### ArrayDeque as a Stack (LIFO)

```java
Deque<String> stack = new ArrayDeque<>();
stack.push("bottom");  // pushes to front (head)
stack.push("middle");
stack.push("top");

String top = stack.peek(); // "top" — view without removing
String pop = stack.pop();  // "top" — remove from front
```

### Queue vs Deque Method Summary

| Operation | Throws exception | Returns null/false |
|-----------|------------------|--------------------|
| Add to tail | `add(e)` | `offer(e)` |
| Remove from head | `remove()` | `poll()` |
| Inspect head | `element()` | `peek()` |
| Add to head (Deque) | `addFirst(e)` | `offerFirst(e)` |
| Remove from tail (Deque) | `removeLast()` | `pollLast()` |

Prefer the **null-returning** variants (`offer`, `poll`, `peek`) in most code to avoid unexpected exceptions.

## Immutable Collections (Java 9+)

Factory methods create **immutable**, fixed-size collections. Any attempt to add, remove, or set elements throws `UnsupportedOperationException`. Null elements are not permitted.

```java
List<String> names  = List.of("Alice", "Bob", "Carol");
Set<Integer> primes = Set.of(2, 3, 5, 7, 11);
Map<String, Integer> codes = Map.of("US", 1, "UK", 44, "DE", 49);

// Map with many entries — use Map.ofEntries
Map<String, Integer> big = Map.ofEntries(
    Map.entry("Alice", 95),
    Map.entry("Bob",   87)
);
```

`List.copyOf`, `Set.copyOf`, and `Map.copyOf` create immutable copies of existing collections.

## SequencedCollection (Java 21)

Java 21 introduces `SequencedCollection`, `SequencedSet`, and `SequencedMap` to provide a **uniform API** for collections with a defined encounter order.

```java
// SequencedCollection adds:
list.getFirst();    // equivalent to list.get(0)
list.getLast();     // equivalent to list.get(list.size() - 1)
list.addFirst(e);
list.addLast(e);
list.removeFirst();
list.removeLast();
list.reversed();    // returns a reversed view
```

`List`, `LinkedHashSet`, `TreeSet`, `LinkedHashMap`, and `TreeMap` all participate in the new sequenced interfaces. `ArrayList` and `LinkedList` gain the `getFirst()` / `getLast()` convenience methods.

## Exam Tips

- `ArrayList` provides O(1) random access; `LinkedList` provides O(1) insertion/removal at the ends.
- `TreeSet` and `TreeMap` require elements/keys to implement `Comparable` or supply a `Comparator`.
- `Map.get()` returns `null` when the key is absent — use `getOrDefault` to avoid null checks.
- `List.of()` / `Set.of()` / `Map.of()` are **immutable** and reject `null` elements.
- A `HashSet` does not guarantee iteration order; if order matters, use `LinkedHashSet` or `TreeSet`.
- `Deque` methods `push` / `pop` operate on the **head** (front), making it behave like a stack.
