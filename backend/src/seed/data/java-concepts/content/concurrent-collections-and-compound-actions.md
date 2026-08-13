---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

`Collections.synchronizedList`/`synchronizedMap` and the classic `Vector`/`Hashtable`
make every *individual* method call thread-safe by wrapping it in a lock on the
collection itself. That guarantee stops at the method boundary: a **compound
action** — two or more calls that together must behave as one operation, such as
"put a value only if the key is absent" or "iterate every element" — is not made
atomic just because each call inside it is. This concept covers where that gap
bites (compound actions, and iterators thrown off by concurrent modification,
including through "hidden" iteration you can't see at the call site), and how
`ConcurrentHashMap` and `CopyOnWriteArrayList` close it with a different design
instead of asking callers to add more locking.

## Use Cases

- Implementing "get or create" / "put if absent" logic on a shared cache or
  registry — session stores, connection pools, memoized lookups — without a
  lost-update race between the check and the write.
- Iterating a shared collection (explicitly, or implicitly via `toString()`,
  logging, `equals()`/`hashCode()`, or `containsAll`) while another thread might
  be adding or removing elements, without risking `ConcurrentModificationException`.
- Choosing `ConcurrentHashMap` over a `synchronizedMap`-wrapped `HashMap` for any
  map that many threads read and write concurrently — caches, counters, shared
  lookup tables.
- Maintaining a listener/observer list that is fired (iterated) constantly but
  registered/unregistered rarely — `CopyOnWriteArrayList`'s sweet spot.

## Deep Dive

### 1. The compound-action trap

`Collections.synchronizedMap` locks on the map for every single call, so
`containsKey`, `get`, and `put` are each safe in isolation. Stringing several of
them together to express "look up or create" is not:

```java
Map<String, Session> sessions = Collections.synchronizedMap(new HashMap<>());

static Session getOrCreateSession(String userId) {
    if (!sessions.containsKey(userId)) {     // call #1 — safe on its own
        sessions.put(userId, new Session(userId)); // call #2 — safe on its own
    }
    return sessions.get(userId);             // call #3 — safe on its own
}
```

Each call holds the map's lock only for its own duration, then releases it. If
threads A and B both call `getOrCreateSession("alice")` and their calls interleave
between `containsKey` and `put`, both see no existing entry, both construct a new
`Session`, and both call `put` — the second `put` silently discards the first
`Session`. If `Session`'s constructor has a side effect (opens a socket,
increments a counter, sends a welcome event), that side effect now runs twice for
what the caller expected to be a once-per-user creation.

The fix from the synchronized-wrapper design is **client-side locking**: acquire
the same lock the wrapper uses — the wrapper instance itself — around the whole
compound action, not just each individual call:

```java
static Session getOrCreateSession(String userId) {
    synchronized (sessions) {               // the exact lock synchronizedMap guards each call with
        Session s = sessions.get(userId);
        if (s == null) {
            s = new Session(userId);
            sessions.put(userId, s);
        }
        return s;
    }
}
```

This works only because `Collections.synchronizedMap`/`synchronizedList` document
which lock protects the collection (the returned wrapper object) — that
documented policy is exactly what makes client-side locking possible. It also
means every other synchronized access must go through calls that use the *same*
lock, or the extra `synchronized` block accomplishes nothing.

### 2. Hidden iterators and ConcurrentModificationException

Iterating a `synchronizedList`/`synchronizedMap` still needs the same client-side
lock, because the fail-fast iterators these collections return detect concurrent
structural changes and throw `ConcurrentModificationException` — the lock has to
be held for the *entire* iteration, not just each `next()` call:

```java
List<String> names = Collections.synchronizedList(new ArrayList<>());

synchronized (names) {
    for (String n : names) {   // holding the lock for the whole loop prevents CME
        process(n);
    }
}
```

The trap is that iteration is often invisible at the call site. String
concatenation, logging, `toString()`, `equals()`/`hashCode()`, and methods like
`containsAll`/`removeAll`/`retainAll` all iterate the collection internally:

```java
public class SessionRegistry {
    private final Set<String> activeUsers = Collections.synchronizedSet(new HashSet<>());

    public void login(String userId)  { activeUsers.add(userId); }
    public void logout(String userId) { activeUsers.remove(userId); }

    public void logSnapshot() {
        // no explicit loop anywhere in this method...
        log.info("Active users: " + activeUsers); // ...but string concatenation calls
    }                                              // activeUsers.toString(), which iterates it
}
```

If `login`/`logout` run on another thread while `logSnapshot` is mid-`toString()`,
the call can throw `ConcurrentModificationException` from inside what looks like a
plain log line, with no `for` loop in sight. The farther a piece of state is from
the code that synchronizes on it, the easier it is to reach that state through an
iteration nobody remembered to guard.

### 3. ConcurrentHashMap: weakly consistent iteration, atomic compound actions

`ConcurrentHashMap`'s iterators are **weakly consistent**, not fail-fast: they
never throw `ConcurrentModificationException`, they reflect the map's state at
some point at or after the iterator was created, and `get`/reads generally never
block, even while other threads are writing.

```java
ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

for (String userId : sessions.keySet()) {   // safe even if another thread adds/removes
    log.info(userId);                        // concurrently — never throws CME
}
```

Because a `ConcurrentHashMap` deliberately cannot be locked for exclusive access
the way `synchronizedMap` can, client-side locking is not an option for building
new compound actions on it — so instead it exposes the common compound actions as
single atomic methods on the `ConcurrentMap` interface, plus the default methods
`Map` gained in Java 8:

```java
ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();

// "get or create" as one atomic call — no external lock needed
Session s = sessions.computeIfAbsent(userId, id -> new Session(id));

sessions.putIfAbsent(userId, new Session(userId));      // insert only if absent
sessions.replace(userId, oldSession, newSession);       // replace only if still == oldSession
sessions.remove(userId, staleSession);                  // remove only if still == staleSession
sessions.compute(userId, (id, s2) -> s2 == null ? new Session(id) : s2.touch());
sessions.merge(userId, freshSession, (old, incoming) -> old.mergeWith(incoming));
```

`putIfAbsent` on its own predates `computeIfAbsent`/`compute`/`merge`, which were
added in Java 8 as `Map` default methods and are backed by `ConcurrentHashMap`'s
own atomic implementations rather than a default that locks around two calls.

Internally, the locking strategy has changed since the class was introduced.
Rather than a fixed set of separately-locked segments, current JDKs spread
entries across many independently addressable bins in one table: inserting into
an empty bin is done with a lock-free CAS, and only a bin that already has a
colliding entry takes a lock — scoped to that bin's head node, not the whole
table or a fixed segment — while contended. That is why arbitrarily many readers
can proceed concurrently with writers and with each other, and why the concurrency
level scales with the table itself instead of a fixed number of stripes. One
consequence of that design carries over unchanged: aggregate methods like `size()`
and `isEmpty()` can only return an estimate under concurrent modification, since
by the time the count is computed it may already be stale; `mappingCount()`
returns the same kind of estimate as a `long`, for maps too large for `size()`'s
`int` result.

### 4. CopyOnWriteArrayList: reads never block, writes copy everything

`CopyOnWriteArrayList` takes the opposite trade to `ConcurrentHashMap`: every
mutation (`add`, `remove`, `set`) copies the *entire* backing array, publishes the
new array, and leaves any in-progress iteration untouched because it is still
looking at the old array. Iterators never throw `ConcurrentModificationException`
and never need a lock, because they are reading a snapshot that, by construction,
cannot change underneath them:

```java
private final List<PropertyChangeListener> listeners = new CopyOnWriteArrayList<>();

void addListener(PropertyChangeListener l) { listeners.add(l); } // copies the whole array

void fireChange(PropertyChangeEvent e) {
    for (PropertyChangeListener l : listeners) { // iterates a stable snapshot — never blocks,
        l.propertyChange(e);                      // never throws CME, even if another thread
    }                                              // registers/unregisters a listener right now
}
```

This is exactly the shape of a listener/observer list: registration and
unregistration are rare, firing an event to every listener happens constantly,
and no listener callback should be able to trigger `ConcurrentModificationException`
just because it happens to add another listener mid-notification.

## Trade-offs

- **A thread-safe collection does not make a compound action thread-safe** — every
  individual `containsKey`/`get`/`put` call on a `synchronizedMap` is safe, but a
  "check, then act" sequence built from them can still race unless the whole
  sequence is wrapped in `synchronized` on the same lock the wrapper already uses.
  ```java
  if (!map.containsKey(k)) map.put(k, v); // two safe calls, one unsafe combination
  ```
- **Iteration is easy to trigger by accident** — `toString()`, logging a
  collection, `equals()`/`hashCode()`, and bulk operations like `containsAll` all
  iterate internally, so `ConcurrentModificationException` can surface from code
  with no visible loop at all. The fix is the same client-side lock, just applied
  somewhere less obvious.
- **`ConcurrentHashMap` trades away exclusive locking for scalability** — it has no
  equivalent of locking the whole map for a multi-step atomic operation the way
  `Hashtable`/`synchronizedMap` allow; if an application genuinely needs to freeze
  the entire map for several operations in a row, `ConcurrentHashMap` cannot be a
  drop-in replacement for that one case, even though it usually is for everything
  else.
- **Weakly consistent iteration is not the same guarantee as a strong snapshot** —
  a `ConcurrentHashMap` iterator may or may not reflect a change made after it was
  created, so code that depends on seeing (or not seeing) a concurrent update
  during iteration cannot rely on either outcome; it should not be used where
  exact-point-in-time semantics matter.
- **`CopyOnWriteArrayList` is only a good trade when reads dominate writes** —
  every `add`/`remove`/`set` copies the whole backing array, so a list mutated
  frequently pays an O(n) copy on every single mutation; it fits a rarely-changed
  listener list, not a queue or buffer that's written as often as it's read.

## Documentation Links

- [ConcurrentHashMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — doc
- [ConcurrentMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentMap.html) — doc
- [CopyOnWriteArrayList — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html) — doc
- [Collections — Java SE 25 API (synchronizedMap/synchronizedList)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [ConcurrentModificationException — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html) — doc
