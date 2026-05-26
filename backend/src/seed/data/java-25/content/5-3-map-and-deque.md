# Map and Deque

---

## Map

A `Map` stores key-value pairs. Keys are unique; values may repeat.

### Common Implementations

| Class | Key order | Null key | Null values | Performance |
|-------|-----------|----------|-------------|-------------|
| `HashMap` | None | One allowed | Yes | O(1) avg |
| `LinkedHashMap` | Insertion order | One allowed | Yes | O(1) avg |
| `TreeMap` | Natural / Comparator | No | Yes | O(log n) |

### Creating Maps

```java
// mutable
Map<String, Integer> scores = new HashMap<>();
scores.put("Alice", 90);
scores.put("Bob", 85);

// factory — unmodifiable
Map<String, Integer> fixed = Map.of("Alice", 90, "Bob", 85);

// Map.entry / Map.ofEntries for more than 10 entries
Map<String, Integer> big = Map.ofEntries(
    Map.entry("Alice", 90),
    Map.entry("Bob", 85)
);
```

### Key Map Methods

```java
Map<String, Integer> map = new HashMap<>(Map.of("A", 1, "B", 2, "C", 3));

map.get("A");                          // 1
map.getOrDefault("Z", 0);             // 0 — key not found
map.put("D", 4);                       // insert or replace
map.putIfAbsent("A", 99);             // ignored — "A" already exists
map.remove("B");                       // removes entry
map.containsKey("C");                  // true
map.containsValue(3);                  // true
map.size();                            // number of entries

// iterating entries
for (Map.Entry<String, Integer> entry : map.entrySet()) {
    System.out.println(entry.getKey() + "=" + entry.getValue());
}

// compute helpers
map.merge("A", 10, Integer::sum);       // A → 1+10 = 11
map.computeIfAbsent("E", k -> k.length()); // E → 1
map.replaceAll((k, v) -> v * 2);        // doubles all values
```

---

## Deque

A `Deque` (double-ended queue) supports insertion and removal at both ends. It is also used as a stack.

### Common Implementations

| Class | Notes |
|-------|-------|
| `ArrayDeque` | Resizable array; no `null`; preferred stack/queue |
| `LinkedList` | Also implements `List`; allows `null` |

### Creating a Deque

```java
Deque<String> deque = new ArrayDeque<>();
```

### Deque as a Queue (FIFO)

```java
deque.offer("first");    // add to tail
deque.offer("second");
deque.offer("third");

deque.peek();            // "first" — view head, no remove
deque.poll();            // "first" — remove head
```

### Deque as a Stack (LIFO)

```java
deque.push("a");   // add to head
deque.push("b");
deque.push("c");

deque.peek();      // "c" — top of stack
deque.pop();       // "c" — remove from head
```

### Deque Method Reference

| Operation | Throws on failure | Returns null/false |
|-----------|------------------|--------------------|
| Add head | `addFirst(e)` | `offerFirst(e)` |
| Add tail | `addLast(e)` / `add(e)` | `offerLast(e)` / `offer(e)` |
| View head | `getFirst()` / `element()` | `peekFirst()` / `peek()` |
| View tail | `getLast()` | `peekLast()` |
| Remove head | `removeFirst()` / `remove()` | `pollFirst()` / `poll()` |
| Remove tail | `removeLast()` | `pollLast()` |
| Stack push | `push(e)` = `addFirst(e)` | — |
| Stack pop | `pop()` = `removeFirst()` | — |

---

## Map.of() Restrictions

| Restriction | Detail |
|-------------|--------|
| Unmodifiable | Mutations throw `UnsupportedOperationException` |
| No `null` keys or values | Throws `NullPointerException` |
| Duplicate keys | Throws `IllegalArgumentException` at creation |
| Max 10 pairs | Use `Map.ofEntries()` for more |

---

## Choosing Map vs Deque

| Use `Map` when | Use `Deque` when |
|---------------|-----------------|
| Key-value lookup | Queue or stack behaviour |
| Fast `containsKey` | FIFO processing (use `offer`/`poll`) |
| Aggregating by key | LIFO processing (use `push`/`pop`) |
