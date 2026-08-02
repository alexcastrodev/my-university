# Practice: I/O

> Five exercises on this module's specific content — `Files.writeString()`
> open-option semantics and `APPEND`, the `Files.exists()` /
> `Files.notExists()` asymmetry, why `static` fields never round-trip
> through serialization, `Path.relativize()` between mismatched path
> "kinds," and the literal-`..`-retention behavior of `Path.normalize()`
> on a relative path. Try to answer before opening each explanation.

---

## Exercise 1 — `Files.writeString()` and `OpenOption` defaults

```java
Path p = Path.of("log.txt");

Files.writeString(p, "first\n");
Files.writeString(p, "second\n", StandardOpenOption.APPEND);

List<String> lines = Files.readAllLines(p);
System.out.println(lines);
```

Assuming `log.txt` does not exist beforehand, what does this print?

<details>
<summary>Answer</summary>

```
[first, second]
```

The first call, `Files.writeString(p, "first\n")`, passes **no**
`OpenOption` varargs at all. Per the method's contract, when no options
are supplied it behaves as if `CREATE`, `TRUNCATE_EXISTING`, and `WRITE`
were passed — so it creates `log.txt` and writes `"first\n"`.

The second call passes `StandardOpenOption.APPEND` explicitly. This is
the crux of the exercise: supplying *any* explicit options does not
merge them with the method's defaults — it replaces the default set
entirely. So this call opens the file with **only** `APPEND` in effect,
not `CREATE, TRUNCATE_EXISTING, WRITE`. There is no `TRUNCATE_EXISTING`
in play this time, so the existing `"first\n"` is left intact, and
`APPEND` — which implies write access on its own, without needing
`WRITE` listed alongside it — adds `"second\n"` to the end of the file.

If a reader assumes the second call's options are *added on top of* the
defaults, they'd wrongly expect `TRUNCATE_EXISTING` to still apply and
predict the file ends up containing only `"second\n"`. That's the trap.

The final file content is `"first\nsecond\n"`, and `Files.readAllLines()`
splits on line terminators (using UTF-8, the default), returning
`[first, second]` — printed by `List.toString()` with the standard
`[elem1, elem2]` bracket format.

</details>

---

## Exercise 2 — `Files.exists()` vs. `Files.notExists()`

```java
Path p = Path.of("/some/path");

boolean a = Files.exists(p);
boolean b = Files.notExists(p);

if (a == !b) {
    System.out.println("complementary");
} else {
    System.out.println("NOT complementary");
}
```

True or false: for **any** `Path p`, is it guaranteed that
`Files.exists(p) == !Files.notExists(p)` — i.e., could the `"NOT
complementary"` branch ever run?

<details>
<summary>Answer</summary>

**False — it is not guaranteed.** The `"NOT complementary"` branch can
run.

`Files.exists(Path)` returns `true` only when the file is confirmed to
exist. `Files.notExists(Path)` returns `true` only when the file is
*provably* confirmed **not** to exist. Those are not simple logical
opposites of the same check — each one requires a successful,
conclusive filesystem probe in its own direction.

If the JVM cannot determine either way — for example, the process lacks
permission to access a parent directory in the path, or an I/O error
occurs while probing — **both methods return `false`**. `exists()`
returns `false` because existence wasn't confirmed, and `notExists()`
*also* returns `false` because non-existence wasn't confirmed either.
In that case `a == !b` evaluates to `false == !false`, i.e.
`false == true`, which is `false` — so the `else` branch runs and prints
`"NOT complementary"`.

This is exactly why the API exposes two separate methods instead of one
boolean-returning `exists()`: `!Files.exists(p)` is **not** a safe
substitute for `Files.notExists(p)` when you need to positively confirm
absence (e.g., before deciding it's safe to create a file at that path).
Code that treats them as strict complements is relying on an assumption
the API explicitly does not guarantee.

</details>

---

## Exercise 3 — `static` fields and serialization

```java
class Counter implements Serializable {
    private static final long serialVersionUID = 1L;

    static int instancesCreated = 0;
    private final int id;

    Counter() {
        instancesCreated++;
        this.id = instancesCreated;
    }
}
```

```java
Counter a = new Counter();   // instancesCreated -> 1, a.id = 1
Counter b = new Counter();   // instancesCreated -> 2, b.id = 2

byte[] bytes;
try (var baos = new ByteArrayOutputStream();
     var oos = new ObjectOutputStream(baos)) {
    oos.writeObject(b);
    bytes = baos.toByteArray();
}

Counter.instancesCreated = 100;   // mutate the static field after serializing b

Counter restored;
try (var ois = new ObjectInputStream(new ByteArrayInputStream(bytes))) {
    restored = (Counter) ois.readObject();
}

System.out.println(restored.id);
System.out.println(Counter.instancesCreated);
```

What's printed by the two `println` calls?

<details>
<summary>Answer</summary>

```
2
100
```

`id` is a regular (non-`static`, non-`transient`) instance field, so it
is part of `b`'s serialized state exactly as captured at the moment
`writeObject()` ran: `b.id` was `2` at that point, and deserialization
restores instance fields directly from the byte stream (no constructor
call, since `Counter`'s only superclass is `Object`). So
`restored.id == 2`.

`instancesCreated` is `static` — it belongs to the `Counter` **class**,
not to any individual instance. Serialization only ever captures
per-object instance state; a `static` field is never written to the
stream when an instance is serialized, and — critically — it is
**never touched at all** during deserialization either, in either
direction. `ObjectInputStream.readObject()` has no mechanism to assign
static fields; it only populates the fields of the new instance it
allocates.

So the explicit `Counter.instancesCreated = 100;` line — executed
*after* `b` was serialized but *before* `restored` is deserialized — is
the only thing that determines the value printed on the second line.
Deserializing `restored` has zero effect on it. Whatever the currently
loaded `Counter` class's static state happens to be at the moment you
read it is what you get; it is completely decoupled from whatever value
existed at serialization time. This is why `static` fields can't be
used to carry meaningful per-object history through a serialized
stream — only `id`'s value survived the round trip, `instancesCreated`
did not.

</details>

---

## Exercise 4 — `relativize()` and mismatched path "kinds"

```java
Path from = Path.of("/data/reports/2024");
Path to   = Path.of("/data/archive/2024/summary.txt");
System.out.println(from.relativize(to));

Path relFrom = Path.of("reports/2024");
System.out.println(relFrom.relativize(to));
```

Does this compile? If so, what happens when it runs — what prints, and
does execution reach the end?

<details>
<summary>Answer</summary>

It compiles fine — `relativize()` does not declare any checked
exception. At runtime, the first `println` succeeds and prints:

```
../../archive/2024/summary.txt
```

`relativize()` walks both paths' name elements from the root looking
for the longest shared prefix. `from` = `[data, reports, 2024]` and
`to` = `[data, archive, 2024, summary.txt]` share only the first
element, `data` — `reports` and `archive` diverge immediately. The
result is built from: one `..` for each of `from`'s remaining elements
past the shared prefix (`reports`, `2024` → two `..`), followed by
`to`'s remaining elements past the shared prefix (`archive`, `2024`,
`summary.txt`). Concatenated: `../../archive/2024/summary.txt`.

The second `println` never completes — it throws `IllegalArgumentException`
at runtime (`"'other' is different type of Path"` or equivalent,
depending on JDK version), so execution stops there and nothing more is
printed after the first line. `relativize()` requires both paths to be
the same "kind": both absolute, or both relative. `relFrom` (`"reports/2024"`)
is relative, while `to` (`/data/archive/2024/summary.txt`) is absolute —
there is no well-defined answer to "how do I get from a relative
location to an absolute one" without knowing what the relative path is
relative *to*, so the method refuses to guess and throws instead of
returning a nonsensical result.

</details>

---

## Exercise 5 — `normalize()` and unresolvable `..` on a relative path

```java
Path p = Path.of("/opt/app/../app/config/./settings.yaml");
System.out.println(p.normalize());

Path rel = Path.of("logs/../../backup");
System.out.println(rel.normalize());
```

What's printed by each `println`?

<details>
<summary>Answer</summary>

```
/opt/app/config/settings.yaml
../backup
```

`normalize()` is purely lexical — it eliminates `.` elements and
resolves `..` against the immediately preceding name element, without
touching the filesystem at all.

For `p`, working left to right: `opt`, then `app`, then `..` cancels
the `app` just pushed, leaving `opt`; then `app` again, `config`, `.`
(dropped — it never contributes a name element), and finally
`settings.yaml`. The result is `/opt/app/config/settings.yaml`.

For `rel`, the same left-to-right resolution applies, but this path has
**no root** — it's relative. Processing `logs` then `..` cancels `logs`
cleanly, leaving nothing accumulated yet. The *second* `..` has nothing
left to cancel: because the path has no root component to bound it,
`normalize()` cannot simply discard an unmatched `..` (doing so would
silently change what the path refers to once resolved against some
working directory). Per `Path`'s contract, a `..` that cannot be
eliminated because there is no preceding name element **and no root**
is retained literally at the front of the result instead of being
dropped. Processing then continues with `backup`, giving a final result
of `../backup` — one `..` remains because only one of the two could
actually be resolved away.

Contrast this with an *absolute* path: there, a leading `..` past the
root would be meaningless (you can't go above the filesystem root), so
`normalize()` on an absolute path never leaves a dangling `..` in the
result the way it can for a relative one.

</details>
