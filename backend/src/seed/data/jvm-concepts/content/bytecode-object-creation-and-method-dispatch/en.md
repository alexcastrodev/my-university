---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Understand the bytecode instructions behind everything object-oriented in Java: how `new` actually allocates and constructs an object as two separate steps, how field access splits into four opcodes depending on instance vs. static, how arrays get their own instruction family instead of reusing field access, and — most importantly — why the JVM has **five** different "call a method" instructions instead of one, each encoding a different method-resolution strategy at the bytecode level.

## Use Cases

- Reading `javap -c` output to see that `new Foo(...)` is `new` + `dup` + `invokespecial`, three instructions, not one atomic "construct" opcode.
- Explaining why `getfield`/`putfield` need an object reference on the stack but `getstatic`/`putstatic` don't.
- Diagnosing why a call you expected to be virtual shows up as `invokestatic` or `invokeinterface` in a disassembly, and what that implies about how it's dispatched.
- Understanding why `instanceof` is safe to use speculatively while `checkcast` can throw — and why the compiler inserts a `checkcast` after every generic-collection `get()` call.

## Deep Dive

### Object creation: new, dup, and invokespecial

`new` only **allocates** memory and pushes an uninitialized reference — it does not call the constructor. The compiler always follows it with `dup` (so one copy of the reference survives the constructor call for later use) and an `invokespecial` targeting `<init>`:

```java
Person person = new Person("John");
```

```
0: new           #8     // class Person — allocate, push uninitialized reference
3: dup                   // duplicate it: one copy for <init>, one to keep
4: ldc           #13     // String John
6: invokespecial #15     // Method "<init>":(Ljava/lang/String;)V — consumes one copy
9: astore_1               // the surviving copy is stored into 'person'
```

The bytecode verifier enforces that a `new`-allocated reference cannot be used — passed as an argument, stored in a field, returned — until `invokespecial <init>` has been called on it. An object literally cannot exist in a usable state before its constructor runs, and that guarantee is checked at class-load time, not at runtime.

### Field access: instance vs. static

Instance and static field access are four distinct opcodes, not one opcode with a flag — because instance access needs an object reference on the stack and static access doesn't:

```java
private String name;

public String getName() { return name; }
public void setName(String newName) { this.name = newName; }
```

```
public java.lang.String getName();
    aload_0
    getfield      #7     // Field name:Ljava/lang/String; — needs 'this' on the stack
    areturn

public void setName(java.lang.String);
    aload_0
    aload_1
    putfield      #7     // consumes both 'this' and the new value
    return
```

`getstatic`/`putstatic` skip the `aload_0` entirely — a static field belongs to the class, not to any particular instance, so there's nothing to push before the field reference.

### Arrays: creation, access, and length

Arrays get their own instruction family rather than reusing `getfield`/`putfield`, and array *creation* is split by element kind — primitives use `newarray` with a type tag, object references use `anewarray` with a class reference, and multi-dimensional arrays use `multianewarray`:

```java
int[] nums = new int[3];
nums[0] = 42;
int len = nums.length;

String[] names = new String[2];
names[0] = "a";
```

```
iconst_3
newarray       int        // primitive array: element type is a tag, not a class reference
astore_1
aload_1
iconst_0
bipush        42
iastore                    // store into a primitive int array

aload_1
arraylength                // pushes the array's length — arrays don't expose it as a field
istore_2

iconst_2
anewarray     #7           // class java/lang/String — reference array: element type is a class
astore_3
aload_3
iconst_0
ldc           #9           // String a
aastore                    // store into a reference array
```

Every primitive type has its own store/load pair (`bastore`/`baload` for byte *and* boolean, `castore`/`caload` for char, `sastore`/`saload` for short, `iastore`/`iaload` for int, `lastore`/`laload` for long, `fastore`/`faload`/`dastore`/`daload` for float/double), while every reference type — regardless of which class — shares the single `aastore`/`aaload` pair, since a reference array only ever stores pointers of a uniform size.

### instanceof vs. checkcast

Both instructions check an object's runtime type against a class reference, but they respond differently to a mismatch — `instanceof` pushes `0` and lets execution continue, `checkcast` throws `ClassCastException`:

```java
Object o = names;
if (o instanceof String[]) {
    String[] cast = (String[]) o;
    ...
}
```

```
aload         4
instanceof    #11    // class "[Ljava/lang/String;" — pushes 1 or 0, never throws
ifeq          51
aload         4
checkcast     #11    // same class check — throws ClassCastException instead of pushing 0
astore        5
```

This is why `instanceof` is the safe way to *probe* a type before committing to it, while an explicit cast is only safe once you already know — from an `instanceof` check, generics, or documented contract — that it will succeed.

### Method dispatch: five instructions, five resolution strategies

The JVM doesn't have one generic "call method" instruction — it has five, and the compiler picks between them based on what's statically known about the target, not just what the call looks like in source:

```java
interface Greeter { String greet(); }

public class Dispatch implements Greeter {
    public String greet() { return helper(); }
    private String helper() { return "hi"; }
    public static void call(Greeter g) { System.out.println(g.greet()); }
    public static void main(String[] args) { call(new Dispatch()); }
}
```

```
public java.lang.String greet();
    aload_0
    invokevirtual #7     // Method helper:()Ljava/lang/String; — private, called on modern javac (11+)
    areturn

public static void call(Greeter);
    ...
    invokeinterface #21,  1   // InterfaceMethod Greeter.greet — target type is the interface, not a class
    ...

public static void main(java.lang.String[]);
    new           #8
    dup
    invokespecial #32    // Method "<init>":()V — constructor, never virtual
    invokestatic  #33    // Method call — no receiver at all
```

| instruction | used for | dispatch |
|---|---|---|
| `invokestatic` | static methods | resolved at compile time — no receiver, no polymorphism |
| `invokespecial` | constructors (`<init>`) and explicit `super.method()` calls | resolved at compile time by declared type, not overridden at runtime |
| `invokevirtual` | instance methods called on a class-typed reference | resolved at runtime by the receiver's actual class (virtual dispatch) |
| `invokeinterface` | instance methods called on an interface-typed reference | resolved at runtime; carries an explicit argument count since the JVM can't assume a fixed vtable layout across unrelated implementers |
| `invokedynamic` | call sites resolved by a bootstrap method rather than the constant pool (lambdas, string concatenation since JEP 280, `invokedynamic`-based `String.join`-style construction) | resolved once, lazily, on first execution, then cached at the call site |

A detail worth correcting against older material: calling a `private` instance method from within the same class is **not** `invokespecial` on current `javac` — it compiles to `invokevirtual`, as shown in `greet()` above. Since nestmates (JDK 11), a `private` method is still only invokable from within its nest, but nothing prevents the JVM from resolving it virtually, so `javac` stopped special-casing it. `invokespecial` today means specifically "constructor, or an explicit `super` call" — both cases where virtual dispatch would be actively wrong.

## Trade-offs

- **`new` + `invokespecial` as two steps, not one** — this lets the verifier reject any use of an object reference before its constructor has run, at the cost of every object construction being a 3+ instruction sequence instead of a single atomic opcode.
- **`invokeinterface` carries an explicit argument count the other `invoke*` instructions don't** — because an interface reference could be implemented by any unrelated class with no shared vtable layout, the JVM needs that count to search the target's method table at the call site, which is part of why interface calls were historically slower than `invokevirtual` before JIT inline caching closed the gap.
- **`checkcast` fails loudly, `instanceof` fails quietly** — a mismatched `checkcast` throws immediately at the cast site, so a bad cast surfaces as a stack trace pointing exactly where the assumption broke, whereas relying on `instanceof` alone just skips the branch with no diagnostic.

```java
Object o = "not an array";
String[] arr = (String[]) o;   // checkcast throws java.lang.ClassCastException here, at this line
```

- **`invokestatic` and `invokespecial` are what makes a call non-overridable** — a `static` method or a `private`/constructor call resolved through either of these opcodes is bound at compile time by declared type, which is exactly why `static` methods can't be polymorphic and why calling an overridable-looking method from a constructor (via `invokevirtual` on `this`) can observe a subclass's fields before they're initialized.

## Documentation Links

- [Chapter 6: The Java Virtual Machine Instruction Set — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html) — doc
- [javap — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html) — doc
- [Mastering the Java Virtual Machine — Chapter 3 source code (Packt Publishing)](https://github.com/PacktPublishing/Mastering-the-Java-Virtual-Machine/tree/main/chapter-03) — doc
