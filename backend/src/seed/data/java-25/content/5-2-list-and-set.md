---
version: 1.0
updatedAt: 2026-05-26
---
# List and Set

---

## Collection Hierarchy (excerpt)

```
Iterable
└── Collection
    ├── List      — ordered, allows duplicates
    ├── Set       — no duplicates
    └── Queue
```

---

## List

A `List` maintains insertion order and allows duplicates and `null` values (in mutable implementations).

### Common Implementations

| Class | Backed by | Access | Insert/Delete mid |
|-------|-----------|--------|------------------|
| `ArrayList` | Array | O(1) | O(n) |
| `LinkedList` | Doubly-linked list | O(n) | O(1) at known node |

### Creating Lists

```java
// mutable
List<String> mutable = new ArrayList<>();
mutable.add("Alice");
mutable.add("Bob");

// factory — unmodifiable (no add/remove/set)
List<String> fixed = List.of("Alice", "Bob", "Carol");

// mutable copy of a fixed list
List<String> copy = new ArrayList<>(List.of("A", "B", "C"));
```

### Key List Methods

```java
List<String> list = new ArrayList<>(List.of("A", "B", "C", "B"));

list.get(1);                   // "B"
list.set(0, "Z");              // replace index 0 → ["Z","B","C","B"]
list.add(1, "X");              // insert at index 1
list.remove(0);                // remove by index
list.remove("B");              // remove first occurrence by value
list.indexOf("B");             // first index of "B"
list.lastIndexOf("B");         // last index of "B"
list.subList(1, 3);            // view, not copy
list.size();                   // number of elements
list.contains("C");            // true
list.isEmpty();                // false
Collections.sort(list);        // sorts in place
```

---

## Set

A `Set` contains no duplicates. Most implementations do not guarantee order.

### Common Implementations

| Class | Order | Null | Performance |
|-------|-------|------|-------------|
| `HashSet` | None | One `null` allowed | O(1) avg |
| `LinkedHashSet` | Insertion order | One `null` allowed | O(1) avg |
| `TreeSet` | Natural / Comparator | No `null` | O(log n) |

### Creating Sets

```java
// mutable
Set<String> mutable = new HashSet<>();
mutable.add("Alice");
mutable.add("Alice");   // duplicate ignored
System.out.println(mutable.size());   // 1

// factory — unmodifiable, no null allowed
Set<String> fixed = Set.of("Alice", "Bob", "Carol");
```

### Key Set Methods

```java
Set<Integer> set = new HashSet<>(Set.of(1, 2, 3, 4, 5));

set.add(6);          // true — added
set.add(3);          // false — already present
set.remove(2);       // true
set.contains(4);     // true
set.size();          // 5

// set operations
Set<Integer> other = new HashSet<>(Set.of(3, 4, 5, 6, 7));
set.retainAll(other);  // intersection — mutates set
set.addAll(other);     // union — mutates set
set.removeAll(other);  // difference — mutates set
```

---

## List.of() and Set.of() — Important Restrictions

| Restriction | Detail |
|-------------|--------|
| Unmodifiable | `add`, `remove`, `set` throw `UnsupportedOperationException` |
| No `null` elements | Throws `NullPointerException` |
| `Set.of()` no duplicates | Throws `IllegalArgumentException` at creation |
| Iteration order | Not guaranteed (especially `Set.of()`) |

---

## Choosing List vs Set

| Use `List` when | Use `Set` when |
|----------------|---------------|
| Order matters | Uniqueness is the constraint |
| Duplicates allowed | Fast membership test (`contains`) |
| Index-based access needed | No index access needed |
