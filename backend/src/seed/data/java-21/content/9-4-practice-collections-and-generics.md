# Practice: Collections and Generics

> Five exercises covering what the slides in this module introduced —
> bounded wildcards, `Set`/`Map` behavior, `Map.merge`/`computeIfAbsent`,
> `ArrayDeque` as both a stack and a queue, and `Collections` utility
> methods. Try to answer before opening each explanation.

---

## Exercise 1 — What can you do with `List<? extends Number>`?

```java
List<Integer> ints = new ArrayList<>(List.of(1, 2, 3));

List<? extends Number> readers = ints;
readers.add(4);
Number n = readers.get(0);
```

Which line, if any, fails to compile?

<details>
<summary>Answer</summary>

`readers.add(4);` **fails to compile.**

`List<? extends Number>` is a "producer" — the compiler only knows the
list holds *some* subtype of `Number`, not which one. It could be a
`List<Integer>`, a `List<Double>`, anything. Since the compiler can't
prove `4` (an `Integer`) is safe to insert into whatever that unknown
subtype actually is, it refuses to compile any `add(...)` call except
`add(null)`.

`readers.get(0)` compiles fine and returns a `Number` — reading is always
safe, because every possible subtype of `Number` can be widened to
`Number`. This is the "Producer Extends" half of PECS: `extends` wildcards
are for reading, not writing.

</details>

---

## Exercise 2 — `HashSet.add()` return value and `TreeSet` ordering

```java
Set<String> hash = new HashSet<>();
boolean added1 = hash.add("A");
boolean added2 = hash.add("A");
System.out.println(added1 + " " + added2);

Set<String> tree = new TreeSet<>(List.of("banana", "apple", "cherry"));
System.out.println(tree);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
true false
[apple, banana, cherry]
```

`Set.add()` returns a `boolean` indicating whether the set actually
changed. The first `add("A")` succeeds (`true`); the second is a
duplicate, so the set is unchanged and it returns `false` — no exception,
no crash, just a `false` telling you the element was already there.

`TreeSet` ignores insertion order entirely and always iterates in
natural/comparator order — for `String`, that's lexicographic — so
`"banana", "apple", "cherry"` comes out as `[apple, banana, cherry]`
regardless of the order they were passed to the constructor.

</details>

---

## Exercise 3 — `Map.merge()` vs `Map.computeIfAbsent()`

```java
Map<String, Integer> scores = new HashMap<>();
scores.put("Alice", 10);

scores.merge("Alice", 5, Integer::sum);
scores.merge("Bob", 5, Integer::sum);
scores.computeIfAbsent("Alice", k -> 100);
scores.computeIfAbsent("Carol", k -> 100);
```

What's the final value mapped to `"Alice"`, `"Bob"`, and `"Carol"`?

<details>
<summary>Answer</summary>

- `"Alice"` → `15`
- `"Bob"` → `5`
- `"Carol"` → `100`

`merge(key, value, function)`: if the key is **present** (Alice, currently
`10`), it applies the function to combine the existing and new value —
`Integer.sum(10, 5)` = `15`. If the key is **absent** (Bob), the function
is never called at all — `merge` just puts the given value directly, so
Bob becomes `5`, not `sum` of anything.

`computeIfAbsent(key, function)`: only runs the function when the key is
**absent or mapped to `null`**. Alice already has a non-null value (`15`
by this point), so `k -> 100` never runs and Alice stays `15` — it does
**not** overwrite an existing entry the way you might expect from the
name. Carol is genuinely absent, so the function runs and Carol becomes
`100`.

</details>

---

## Exercise 4 — The same `ArrayDeque`, used as a stack and as a queue

```java
Deque<Integer> stack = new ArrayDeque<>();
stack.push(1);
stack.push(2);
stack.push(3);

Queue<Integer> queue = new ArrayDeque<>();
queue.offer(1);
queue.offer(2);
queue.offer(3);

System.out.println(stack.pop() + " " + stack.pop());
System.out.println(queue.poll() + " " + queue.poll());
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
3 2
1 2
```

Both variables are backed by the exact same class, `ArrayDeque` — the
difference is entirely which interface's methods you call on it.

`push()` inserts at the **head**; `pop()` removes from the **head** too —
that's LIFO (stack) behavior. Pushing `1, 2, 3` leaves the head order as
`3, 2, 1`, so the first two `pop()` calls return `3` then `2`.

`offer()` inserts at the **tail**; `poll()` removes from the **head** —
that's FIFO (queue) behavior. Offering `1, 2, 3` keeps them in that order
(`1` at the head), so the first two `poll()` calls return `1` then `2`.

Same underlying data structure, opposite retrieval order — purely a
function of which methods (`push`/`pop` vs. `offer`/`poll`) you choose to
call.

</details>

---

## Exercise 5 — `unmodifiableList` is a view, and `binarySearch` on unsorted input

```java
List<Integer> original = new ArrayList<>(List.of(5, 3, 1, 4, 2));
List<Integer> view = Collections.unmodifiableList(original);

original.add(6);
System.out.println(view);

int idx = Collections.binarySearch(original, 4);
System.out.println(idx);
```

What's printed for `view`? And can you trust whatever `idx` turns out to
be?

<details>
<summary>Answer</summary>

`view` prints `[5, 3, 1, 4, 2, 6]`.

`Collections.unmodifiableList` does **not** create an independent copy —
it wraps `original` in a read-only *view*. Calling a mutator directly on
`view` (like `view.add(...)`) would throw `UnsupportedOperationException`,
but mutating the **backing list** (`original.add(6)`) is completely legal
and immediately visible through the view, since they share the same
underlying data.

`Collections.binarySearch` requires the list to already be **sorted**
before you call it. `original` here is `[5, 3, 1, 4, 2, 6]` — not sorted —
so the result is explicitly **unspecified behavior** per the method's
contract. Whatever `idx` prints, it cannot be relied upon to actually be
the index of `4`; the fix is to sort the list first (e.g.
`Collections.sort(original)`) before searching it.

</details>
