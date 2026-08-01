# Practice: Collections

> Five exercises covering what this module's slides introduced —
> the `SequencedCollection` API's live-view semantics, which built-in
> types actually implement the new `Sequenced*` interfaces, array
> covariance and `ArrayStoreException`, the `Comparator` overloads of
> `Arrays.sort`/`binarySearch`, and `TreeSet`'s half-open navigation
> methods. Try to answer before opening each explanation.

---

## Exercise 1 — Is `reversed()` a snapshot or a live view?

```java
List<Integer> nums = new ArrayList<>(List.of(1, 2, 3));
List<Integer> rev = nums.reversed();
System.out.println(rev);

nums.addLast(4);
System.out.println(rev);

System.out.println(rev.getFirst());
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
[3, 2, 1]
[4, 3, 2, 1]
4
```

`ArrayList` implements `SequencedCollection` (via `List`), so
`nums.reversed()` compiles and returns `List<Integer>` — `List` overrides
`reversed()` with a covariant return type instead of the raw
`SequencedCollection<E>`. At the moment it's created, `rev` shows `nums`
in the opposite encounter order: `[3, 2, 1]`.

The key rule is that **`reversed()` returns a view, not a copy** — `rev`
is backed by the exact same underlying data as `nums`. When
`nums.addLast(4)` mutates the original list to `[1, 2, 3, 4]`, that
structural change is immediately visible through `rev`, which now
reflects the new reversed order `[4, 3, 2, 1]`. This bidirectional
backing is explicit in the JDK docs: structural changes to either the
original or the reversed view show up in both.

`rev.getFirst()` then simply returns the current head of that view,
`4` — the newest element added to the *tail* of `nums`.

</details>

---

## Exercise 2 — Which of these actually implement `Sequenced*`?

```java
SequencedMap<String, Integer> lhm = new LinkedHashMap<>();
lhm.put("a", 1);
lhm.put("b", 2);
lhm.putFirst("z", 0);
System.out.println(lhm.firstKey());

SequencedMap<String, Integer> hm = new HashMap<>();
```

Does each declaration compile? If so, what does `firstKey()` print?

<details>
<summary>Answer</summary>

The `LinkedHashMap` declaration **compiles** and prints `z`.
`LinkedHashMap` implements `SequencedMap` (its iteration order is a
well-defined insertion order), so assigning it to a `SequencedMap<String,
Integer>` reference is legal. `putFirst("z", 0)` inserts `"z"` as the
*first* entry regardless of when it was added, so `firstKey()` — the key
of the first entry — returns `"z"`.

The `HashMap` declaration **fails to compile**: `incompatible types:
HashMap<String,Integer> cannot be converted to SequencedMap<String,
Integer>`. `HashMap` makes no ordering guarantee at all, so per this
module's slide it deliberately does **not** implement `SequencedMap` —
there is no meaningful "first" or "last" entry to expose. The same
distinction holds one level down: `LinkedHashSet` implements
`SequencedSet`, but plain `HashSet` does not implement `SequencedSet` for
the identical reason.

</details>

---

## Exercise 3 — Array covariance and `ArrayStoreException`

```java
Object[] objects = new String[3];
objects[0] = "hello";
objects[1] = 42;
System.out.println(objects[0]);
```

Does this compile? If so, what happens when it runs?

<details>
<summary>Answer</summary>

It **compiles**, but **throws `ArrayStoreException` at line 3**
(`objects[1] = 42;`) before the `println` ever runs.

Arrays are **covariant**: `String[]` is a subtype of `Object[]`, so
`Object[] objects = new String[3];` is legal — `objects` is a
compile-time `Object[]` reference pointing at an actual `String[]` on
the heap. `objects[0] = "hello";` succeeds because a `String` is a
perfectly valid element for that real, underlying `String[]`.

`objects[1] = 42;` compiles too — the compiler only checks that `42`
(auto-boxed to `Integer`) is assignable to the *declared* element type
`Object`. But arrays also carry their actual runtime component type, and
every array store is checked against it. Since the object backing
`objects` is really a `String[]`, storing an `Integer` into it violates
that runtime type and throws `ArrayStoreException` — the exact trade-off
the module's slide calls out under "Covariance." This is precisely the
unsafe hole that generics' invariance (`List<String>` is *not* a
`List<Object>`) was designed to close at compile time instead.

</details>

---

## Exercise 4 — `Arrays.sort` with a `Comparator`, and `binarySearch`'s insertion point

```java
int[] primitives = {5, 3, 1, 4, 2};
Arrays.sort(primitives, Comparator.reverseOrder());

Integer[] boxed = {5, 3, 1, 4, 2};
Arrays.sort(boxed, Comparator.reverseOrder());
System.out.println(Arrays.toString(boxed));

int[] sortedAsc = {10, 20, 30, 40};
System.out.println(Arrays.binarySearch(sortedAsc, 25));
```

Which line fails to compile? For the remaining two `println`s, taken on
their own, what do they print?

<details>
<summary>Answer</summary>

`Arrays.sort(primitives, Comparator.reverseOrder());` **fails to
compile.** There is no `Arrays.sort(int[], Comparator)` overload —
`Comparator`-based sorting only exists for the object-array overload
`Arrays.sort(T[] a, Comparator<? super T> c)`. A primitive `int[]` has no
reference type to parameterize a `Comparator<T>` with, so it only ever
sorts in natural (ascending numeric) order via `Arrays.sort(int[])`. To
sort primitives in reverse you'd have to sort ascending and then reverse
manually, or use a boxed `Integer[]` instead — which is exactly what the
next block does.

Taken independently of the compile error above, the remaining statements
would print:

```
[5, 4, 3, 2, 1]
2
```

`Arrays.sort(boxed, Comparator.reverseOrder())` works because `boxed` is
`Integer[]`, an object array, so `[5, 4, 3, 2, 1]` results.

`Arrays.binarySearch(sortedAsc, 25)` searches `{10, 20, 30, 40}` for `25`,
which isn't present. Per the method's contract, a "not found" result is
`-(insertion point) - 1`, where the insertion point is the index `25`
would need to keep the array sorted — between `20` (index 1) and `30`
(index 2), so insertion point `2`. That gives `-(2) - 1 = -3`.

</details>

---

## Exercise 5 — `TreeSet`'s half-open navigation views

```java
TreeSet<Integer> ts = new TreeSet<>(Set.of(10, 20, 30, 40, 50));

System.out.println(ts.headSet(30));
System.out.println(ts.tailSet(30));
System.out.println(ts.subSet(20, 40));
System.out.println(ts.first() + " " + ts.last());
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
[10, 20]
[30, 40, 50]
[20, 30]
10 50
```

`TreeSet` always iterates in natural order regardless of how elements
were passed in — `Set.of(10, 20, 30, 40, 50)` makes no ordering promise,
but the `TreeSet` constructor sorts them on entry, so the underlying
order is `10, 20, 30, 40, 50` no matter what.

`headSet(30)` returns every element **strictly less than** the bound —
`30` itself is excluded — giving `[10, 20]`.

`tailSet(30)` is the mirror image: every element **greater than or equal
to** the bound, so `30` *is* included — `[30, 40, 50]`.

`subSet(20, 40)` combines both rules as a half-open range `[20, 40)`:
inclusive of `20`, exclusive of `40` — `[20, 30]`.

`first()`/`last()` simply return the smallest and largest elements in
sorted order, `10` and `50`. None of this relies on insertion order at
all, which is the whole point of choosing a `TreeSet` over a `HashSet`
or `LinkedHashSet` when a sorted view of the data is what you need.

</details>
