---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`Object` declares a `protected native` method, `clone()`, that produces a field-for-field copy of an object without calling any constructor. `Cloneable` is the marker interface that opts a class into this mechanism — it declares no methods at all, so implementing it changes nothing about a class's API; it only flips a runtime check inside `Object.clone()`. The default copy `clone()` performs is *shallow*: primitive fields are copied by value, but any field holding a reference — a `List`, a `Map`, an array — ends up shared between the original and the clone, which is rarely what's wanted. Making a correct, deep clone means overriding `clone()` by hand, and even then the mechanism has structural problems — bypassed constructors, fragility across inheritance, and an outright conflict with `final` mutable fields — that make it a poor default for new code.

## Use Cases

- Reading legacy or JDK-internal code that still implements `Cloneable` — `ArrayList`, `HashMap`, and `Date` all do — and needing to know what `someList.clone()` actually copies and what it leaves shared.
- Cloning an array quickly: `int[] copy = original.clone();` is one of the few places the built-in mechanism is genuinely idiomatic, with no boilerplate.
- Certification-style questions (OCP) that test whether shallow-copy aliasing is understood — mutating a clone's list field and observing the original change too.
- Recognizing when a class's `clone()` override is unsafe, so it can be replaced with a copy constructor or a static factory of copy instead of trusted as-is.

## Deep Dive

### Cloneable is a marker interface — it declares no methods

```java
public interface Cloneable {
}
```

That's the entire interface — no `clone()` method, no abstract members, nothing. Implementing `Cloneable` doesn't give a class a `clone()` method or force it to write one; `clone()` already exists on every object, inherited from `Object`. What `Cloneable` actually does is purely a runtime signal: `Object.clone()`'s native implementation checks `this instanceof Cloneable` before it copies anything, and reacts differently depending on the answer.

### clone() is protected and native — skipping Cloneable throws at runtime, not compile time

```java
public class Team {
    private String name;

    public Team(String name) {
        this.name = name;
    }

    @Override
    public Team clone() throws CloneNotSupportedException {
        return (Team) super.clone();   // compiles fine — Team does NOT implement Cloneable
    }
}
```

Overriding `clone()` and widening it to `public` compiles without complaint — Java allows an override to relax access, and declaring `throws CloneNotSupportedException` satisfies the checked exception `Object#clone()` declares. The problem only shows up when it runs:

```java
new Team("Backend").clone();
// throws java.lang.CloneNotSupportedException: Team
```

`Object.clone()`'s native code performs the `instanceof Cloneable` check and throws `CloneNotSupportedException` when it fails. Nothing about the missing interface is caught by `javac` — `Team` compiles, links, and only fails the first time `clone()` actually executes.

### The default copy is shallow — reference fields end up shared

Implementing `Cloneable` fixes the exception, but `super.clone()`'s copy is still field-for-field: a reference field is copied as a reference, not as a new object.

```java
public class Team implements Cloneable {
    private String name;
    private List<String> members;

    public Team(String name, List<String> members) {
        this.name = name;
        this.members = new ArrayList<>(members);
    }

    public void addMember(String member) { members.add(member); }
    public List<String> members()        { return members; }

    @Override
    public Team clone() {
        try {
            return (Team) super.clone();
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);   // can't happen — this class implements Cloneable
        }
    }
}
```

```java
Team original = new Team("Backend", List.of("Ana"));
Team copy = original.clone();

copy.addMember("Bo");

original.members();   // ["Ana", "Bo"] — mutating the clone changed the original too
```

`super.clone()` copied the `members` field the same way it copied `name`: by value. For `name` that value is a `String` reference to an immutable object, so sharing it is harmless. For `members` the value is a reference to the *same* `ArrayList`, so `original` and `copy` are, right after cloning, two objects pointing at one mutable list. `copy.addMember("Bo")` mutates that shared list, and `original` sees the change even though nothing was ever called on it directly.

### Fixing the alias: clone the mutable field too

```java
@Override
public Team clone() {
    try {
        Team copy = (Team) super.clone();
        copy.members = new ArrayList<>(this.members);   // deep-copy the mutable field
        return copy;
    } catch (CloneNotSupportedException e) {
        throw new AssertionError(e);
    }
}
```

```java
Team original = new Team("Backend", List.of("Ana"));
Team copy = original.clone();

copy.addMember("Bo");

original.members();   // ["Ana"] — copy now owns its own List
copy.members();        // ["Ana", "Bo"]
```

This only works because `members` isn't `final` here — `copy.members = ...` is a plain field reassignment after `super.clone()` already ran. Every reference field that's mutable has to be found and re-copied this way by hand; `super.clone()` gives no help identifying which fields need it, and forgetting one reintroduces the aliasing bug silently.

### clone() never runs a constructor — invariants enforced there are skipped

```java
public class Team implements Cloneable {
    private static int instancesCreated = 0;

    private final String id;
    private String name;

    public Team(String name) {
        this.name = name;
        this.id = "team-" + (++instancesCreated);   // invariant: every Team gets a fresh, unique id
    }

    @Override
    public Team clone() {
        try {
            return (Team) super.clone();
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

```java
Team original = new Team("Backend");
Team copy = original.clone();

copy.id.equals(original.id);   // true — copy got original's id verbatim, no new one was minted
```

`instancesCreated` isn't incremented by the clone, and `id` isn't regenerated — `super.clone()` copies whatever `id` already held. The line `this.id = "team-" + (++instancesCreated)` only runs inside `new Team(...)`, and a clone never goes through `new`. Any logic a constructor is relied on to enforce — assigning an id, registering the instance somewhere, validating arguments — is silently bypassed for every clone.

### Fragile across inheritance: the chain only works if every subclass cooperates

```java
public class ProjectTeam extends Team {
    private String projectCode;

    public ProjectTeam(String name, List<String> members, String projectCode) {
        super(name, members);
        this.projectCode = projectCode;
    }

    @Override
    public ProjectTeam clone() {
        // does NOT call super.clone() — builds a fresh instance through the constructor instead
        return new ProjectTeam(name(), members(), projectCode);
    }
}
```

This compiles and even "looks" reasonable, but it breaks the pattern `Team.clone()` relies on: it goes back through the constructor (reintroducing the id-regeneration problem, just for this subclass), and any code further down the hierarchy that expects `super.clone()` to have produced a byte-for-byte `Object.clone()` copy of its own fields gets something else instead. Nothing enforces that every override in a hierarchy calls `super.clone()` with the covariant return type — one subclass that doesn't breaks the chain for every class beneath it, and the compiler gives no warning either way.

### final mutable fields can't be deep-copied inside clone()

```java
public class Team implements Cloneable {
    private final List<String> tags;

    public Team(List<String> tags) {
        this.tags = new ArrayList<>(tags);
    }

    @Override
    public Team clone() {
        try {
            Team copy = (Team) super.clone();
            copy.tags = new ArrayList<>(this.tags);   // does not compile
            return copy;
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

```
error: cannot assign a value to final variable tags
            copy.tags = new ArrayList<>(this.tags);
                ^
```

`super.clone()` already assigned `tags` once — by copying the reference shallowly — and `tags` is `final`, so `clone()` cannot reassign it to a deep copy afterward. The only ways out are to drop `final` from `tags` (losing the guarantee the field never changes after construction) or accept the shared, aliasable reference `super.clone()` produced. Either way, the field can't be both `final` and safely deep-cloned inside `clone()`.

## Trade-offs

- **`clone()` forces exception and cast boilerplate onto every override, where a copy constructor needs none.** `Object#clone()` is declared to throw the checked `CloneNotSupportedException`, so an implementer that can never actually hit it still has to catch it and rethrow as something unchecked:
  ```java
  catch (CloneNotSupportedException e) { throw new AssertionError(e); }
  // vs. a copy constructor, which needs no try/catch at all:
  public Team(Team other) { this.name = other.name; this.members = new ArrayList<>(other.members); }
  ```
- **Cloning skips the constructor entirely, so invariants enforced there don't run on a clone** — shown above with the `id` field never being regenerated. Any class that relies on its constructor for validation or setup has to duplicate that logic inside `clone()`, or accept that clones may not satisfy it.
- **The mechanism only stays correct if every class in an inheritance chain calls `super.clone()`** — one subclass that builds a fresh instance with `new` instead breaks the chain for everything under it, and nothing in the language catches the mistake.
- **A `final` mutable field cannot be deep-copied inside `clone()`** — `super.clone()` already assigned it once, and reassigning a `final` field afterward is a compile error, so the field is stuck sharing a reference with the original:
  ```java
  copy.tags = new ArrayList<>(this.tags);
  // error: cannot assign a value to final variable tags
  ```
- **Arrays are the one place `clone()` is genuinely idiomatic.** `array.clone()` returns a covariantly-typed, independent copy with none of the boilerplate above — `int[] copy = original.clone();` is simpler than any hand-written alternative, precisely because arrays have no constructor to bypass and no subclassing to worry about.
- **A copy constructor or a static factory of copy is the preferable default for ordinary classes.** `new Team(existing)` or `Team.copyOf(existing)` both go through the real constructor — invariants run, `final` fields can be assigned freely because it's the constructor doing the assigning, and no `Cloneable`, no cast, and no cooperation from subclasses is required. See "Immutable Classes and Defensive Copying" for how to copy a mutable field safely on the way in, and "Static Factory Methods and the Builder Pattern" for the naming conventions a copy-producing factory method should follow.

## Documentation Links

- [Object#clone()](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#clone()) — doc
- [Cloneable](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Cloneable.html) — doc
- [CloneNotSupportedException](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/CloneNotSupportedException.html) — doc
