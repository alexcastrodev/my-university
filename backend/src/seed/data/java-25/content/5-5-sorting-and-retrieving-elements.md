---
version: 1.0
updatedAt: 2026-05-26
---
# Sorting and Retrieving Elements

---

## Natural Order

Classes that implement `Comparable<T>` define their own natural order via `compareTo()`:

```java
public interface Comparable<T> {
    int compareTo(T other);
    // negative → this < other
    // zero     → this == other
    // positive → this > other
}
```

Built-in natural orders:

| Type | Natural order |
|------|--------------|
| `Integer`, `Long`, `Double` | Numeric ascending |
| `String` | Lexicographic (Unicode) |
| `LocalDate`, `LocalDateTime` | Chronological |
| `Character` | Unicode value |

```java
List<String> names = new ArrayList<>(List.of("Charlie", "Alice", "Bob"));
Collections.sort(names);           // [Alice, Bob, Charlie]
names.sort(null);                  // same — null uses natural order
```

---

## Comparator

`Comparator<T>` provides an external ordering without modifying the class:

```java
Comparator<String> byLength = (a, b) -> a.length() - b.length();
names.sort(byLength);   // [Bob, Alice, Charlie]
```

### Comparator Factory Methods

```java
// comparing by a key extractor
Comparator<String> byLen  = Comparator.comparingInt(String::length);
Comparator<String> byName = Comparator.naturalOrder();
Comparator<String> rev    = Comparator.reverseOrder();

// chaining
Comparator<String> byLenThenAlpha = Comparator
    .comparingInt(String::length)
    .thenComparing(Comparator.naturalOrder());

// null-safe
Comparator<String> nullsFirst = Comparator.nullsFirst(Comparator.naturalOrder());
```

```java
record Person(String name, int age) {}

List<Person> people = new ArrayList<>(List.of(
    new Person("Alice", 30),
    new Person("Bob", 25),
    new Person("Carol", 30)
));

people.sort(Comparator.comparingInt(Person::age)
                      .thenComparing(Person::name));
// [Bob(25), Alice(30), Carol(30)]
```

---

## Sorting Collections

```java
List<Integer> nums = new ArrayList<>(List.of(5, 3, 1, 4, 2));

Collections.sort(nums);                          // natural order
Collections.sort(nums, Comparator.reverseOrder()); // reverse
nums.sort(Comparator.naturalOrder());            // List.sort()
```

---

## Sorting Arrays

```java
int[] arr = {5, 3, 1, 4, 2};
Arrays.sort(arr);                     // natural order for primitives

String[] words = {"banana", "apple", "cherry"};
Arrays.sort(words);                   // natural order
Arrays.sort(words, Comparator.reverseOrder()); // reverse — Integer[] not int[]
```

---

## Binary Search

Requires the collection/array to be **sorted** first:

```java
int[] sorted = {1, 2, 3, 4, 5};
Arrays.binarySearch(sorted, 3);       // 2

List<Integer> list = new ArrayList<>(List.of(1, 2, 3, 4, 5));
Collections.binarySearch(list, 3);    // 2
Collections.binarySearch(list, 6);    // negative — not found
```

If the element is not found, the return value is `-(insertion point) - 1`.

---

## min and max

```java
List<Integer> nums = List.of(3, 1, 4, 1, 5, 9);

Collections.min(nums);                           // 1
Collections.max(nums);                           // 9
Collections.min(nums, Comparator.reverseOrder()); // 9

Arrays.stream(arr).min().getAsInt();  // stream alternative
```

---

## TreeSet and TreeMap — Always Sorted

```java
TreeSet<String> ts = new TreeSet<>(List.of("banana", "apple", "cherry"));
ts.first();         // "apple"
ts.last();          // "cherry"
ts.headSet("c");    // ["apple", "banana"] — elements < "c"
ts.tailSet("b");    // ["banana", "cherry"] — elements >= "b"
ts.subSet("a","c"); // ["apple", "banana"]

TreeMap<String, Integer> tm = new TreeMap<>(map);
tm.firstKey();      // lowest key
tm.lastKey();       // highest key
tm.floorKey("b");   // greatest key ≤ "b"
tm.ceilingKey("b"); // smallest key ≥ "b"
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `Comparable` | Implemented by the class; defines natural order |
| `Comparator` | External; passed to `sort()` / `TreeSet` / `TreeMap` |
| `binarySearch` | Array/list must be sorted; undefined result if not |
| `Collections.sort` | Stable sort (equal elements maintain relative order) |
| `TreeSet` null | Throws `NullPointerException` — no nulls allowed |
