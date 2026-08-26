---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Classic reflection (`Class.forName`, `getMethod`, `Method.invoke`) is the *inspect and call* layer. Underneath and beside it sit three deeper capabilities: `java.lang.invoke` **method handles**, which move access checking to lookup time and give the JIT something it can inline; `setAccessible(true)`, which reaches private members — and the module system wall (`InaccessibleObjectException`, `--add-opens`) that now stands in front of it; and the ability to manufacture a class that never existed in source, either from raw bytes through a `ClassLoader`, from generated source through the in-memory `javax.tools.JavaCompiler`, or — since JDK 24 — from the standard **Class-File API** in `java.lang.classfile`.

## Use Cases

- Replacing a hot `Method.invoke` call in a serializer, mapper, or expression evaluator with a cached `MethodHandle` whose access check already happened.
- Writing a test or debugging tool that has to read a private field of the class under test, and understanding why the same trick throws on `java.base` classes.
- Loading plugin classes from a location that is not on the classpath — a database blob, a network stream, a per-tenant directory — each in its own namespace so two plugins can ship a class with the same name.
- Generating high-volume accessor/adapter code at startup (framework proxies, AOP wrappers, ORM field accessors) instead of paying reflection cost on every access.
- Building or rewriting `.class` files programmatically — a bytecode-level linter, a package renamer (`javax.*` to `jakarta.*`), an instrumentation agent — with a JDK API instead of bundling ASM.
- Reading what is actually inside a `.class` file (version, attributes, annotations table) without loading the class into the JVM.

## Deep Dive

### `Method.invoke` versus a `MethodHandle`

Classic reflection finds a method by name plus an array of parameter `Class` objects, then invokes it with an `Object[]`:

```java
Method m = String.class.getMethod("substring", int.class, int.class);
String s = (String) m.invoke("Antidisestablishmentarianism", 7, 20);   // "establishment"
```

The method-handle equivalent describes the signature up front as a `MethodType` (return type first, then parameter types), looks it up through a `Lookup` object, and invokes it directly — no `Object[]`, no boxing of the `int` arguments:

```java
import java.lang.invoke.*;

MethodHandles.Lookup lookup = MethodHandles.lookup();
MethodType mt = MethodType.methodType(String.class, int.class, int.class);
MethodHandle mh = lookup.findVirtual(String.class, "substring", mt);

String s = (String) mh.invokeExact("Antidisestablishmentarianism", 7, 20);   // "establishment"
System.out.println(mh.type());   // (String,int,int)String
```

Note `findVirtual` on an instance method: the receiver becomes the *leading* argument of the handle, so the handle's type is `(String,int,int)String` even though `MethodType` only listed the two `int`s. `findStatic` has no leading receiver:

```java
MethodType ofType = MethodType.methodType(LocalDate.class, int.class, int.class, int.class);
MethodHandle of = lookup.findStatic(LocalDate.class, "of", ofType);
LocalDate d = (LocalDate) of.invokeExact(2026, 8, 19);
```

The substantive difference is *when* the access check happens. The `MethodHandles.Lookup` javadoc states it directly: access checks are applied in the factory methods of `Lookup`, when the handle is created — "a key difference from the Core Reflection API, since `java.lang.reflect.Method.invoke` performs access checking against every caller, on every call." A failed lookup throws a checked `ReflectiveOperationException` (`NoSuchMethodException`, `NoSuchFieldException`, or `IllegalAccessException`) at lookup time rather than at call time.

### `invokeExact` versus `invoke`: the cast is part of the call

`invokeExact` and `invoke` are *signature-polymorphic*: the compiler does not use their declared signature, it derives the call's symbolic type descriptor from the actual argument expressions **and the cast applied to the result**. So the cast is not cosmetic — it is part of what the JVM matches against the handle's type. Boxing the `int` arguments and dropping the `(String)` cast makes `invokeExact` fail:

```java
Object o = mh.invokeExact("Antidisestablishmentarianism", Integer.valueOf(7), Integer.valueOf(20));
// java.lang.invoke.WrongMethodTypeException: handle's method type (String,int,int)String
//   but found (String,Integer,Integer)Object
```

Plain `invoke` is the permissive sibling: on a mismatch it adapts the handle as if by `asType` — unboxing, widening, casting the return — and then calls it:

```java
String s = (String) mh.invoke("Antidisestablishmentarianism", Integer.valueOf(7), Integer.valueOf(20));
// "establishment" — invoke unboxes for you; invokeExact would not
```

Both invokers are declared `throws Throwable`, so a call site must declare or catch it:

```java
public static void main(String[] a) {
    String s = (String) mh.invokeExact("x", 1, 2);
    // error: unreported exception Throwable; must be caught or declared to be thrown
}
```

### Reaching private members: `setAccessible`, and the module wall

`Field`, `Method`, and `Constructor` all extend `AccessibleObject`, whose `setAccessible(true)` suppresses the access check for that reflective object:

```java
class Vault {
    private int code = 42;
    private String secret() { return "s3cret"; }
}

Method m = Vault.class.getDeclaredMethod("secret");
m.setAccessible(true);
System.out.println(m.invoke(new Vault()));   // s3cret

for (Field f : Vault.class.getDeclaredFields()) {
    f.setAccessible(true);                    // bye-bye "private"
    System.out.println(f.getName() + " == " + f.get(new Vault()));   // code == 42
}
```

Note `getDeclaredFields()`/`getDeclaredMethods()`, not `getFields()`/`getMethods()` — the non-`Declared` variants only return public members (including inherited ones), so a private member is not even in the array to call `setAccessible` on.

That works because `Vault` is in the same unnamed module as the caller. Aim the same code at a JDK class and the module system stops it — JEP 403 strongly encapsulated JDK internals in JDK 17, and the `--illegal-access` escape hatch was removed at the same time:

```java
Field f = String.class.getDeclaredField("value");
f.setAccessible(true);
// java.lang.reflect.InaccessibleObjectException: Unable to make field
//   private final byte[] java.lang.String.value accessible:
//   module java.base does not "opens java.lang" to unnamed module @2f490758
```

The only supported override is an explicit *open* of that specific package, on the command line or via a JAR manifest `Add-Opens` attribute:

```
$ java --add-opens java.base/java.lang=ALL-UNNAMED T1.java
ok
```

The grant is per package, per target module: `--add-opens <source-module>/<package>=<target-module>`, with `ALL-UNNAMED` meaning classpath code. A module you own declares the same thing in its own descriptor with `opens some.pkg;` (or `opens some.pkg to some.framework;`).

### Private access the method-handle way: `privateLookupIn` and `unreflect`

A plain `MethodHandles.lookup()` carries the access rights of the class that called it, so it cannot see another class's private method at all:

```java
MethodHandles.lookup().findVirtual(Vault.class, "secret", MethodType.methodType(String.class));
// java.lang.IllegalAccessException: no such method: Vault.secret()String/invokeVirtual
```

`MethodHandles.privateLookupIn` teleports a lookup into a target class, granting private access — but only if the target's module opens its package to the caller's module, which is the same rule `setAccessible` obeys:

```java
MethodHandles.Lookup priv = MethodHandles.privateLookupIn(Vault.class, MethodHandles.lookup());

MethodHandle mh = priv.findVirtual(Vault.class, "secret", MethodType.methodType(String.class));
System.out.println((String) mh.invokeExact(new Vault()));   // s3cret

VarHandle vh = priv.findVarHandle(Vault.class, "code", int.class);
System.out.println((int) vh.get(new Vault()));              // 42
```

```java
MethodHandles.privateLookupIn(String.class, MethodHandles.lookup());
// java.lang.IllegalAccessException: module java.base does not open java.lang to unnamed module @3c9d0b9d
```

There is also a bridge in the other direction: once a `Method` has had `setAccessible(true)` applied, `Lookup.unreflect` converts it into a `MethodHandle` that inherits that suppressed check — useful for migrating an existing reflection-based cache to handles incrementally:

```java
Method m = Vault.class.getDeclaredMethod("secret");
m.setAccessible(true);
MethodHandle mh = MethodHandles.lookup().unreflect(m);
System.out.println((String) mh.invokeExact(new Vault()));   // s3cret
```

### Loading a class from raw bytes with a custom `ClassLoader`

`ClassLoader` is abstract; the supported extension point is `findClass`, which must get the bytes from wherever they live and hand them to the protected `defineClass` — the only door into the JVM's class-creation machinery:

```java
class ByteDirLoader extends ClassLoader {
    private final Path dir;

    ByteDirLoader(Path dir, ClassLoader parent) { super(parent); this.dir = dir; }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        try {
            byte[] b = Files.readAllBytes(dir.resolve(name.replace('.', '/') + ".class"));
            return defineClass(name, b, 0, b.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

Each loader instance is its own namespace, which is the actual point of writing one — two web apps or two plugins can each ship `plug.Hi` without colliding:

```java
ClassLoader l1 = new ByteDirLoader(Path.of("plugins"), getClass().getClassLoader());
ClassLoader l2 = new ByteDirLoader(Path.of("plugins"), getClass().getClassLoader());

Class<?> c1 = l1.loadClass("plug.Hi");
Class<?> c2 = l2.loadClass("plug.Hi");

System.out.println(c1.getName().equals(c2.getName()));   // true  — same name
System.out.println(c1 == c2);                            // false — different runtime classes
```

`c1` and `c2` are not assignment-compatible; a cast between them throws `ClassCastException` even though the bytes are identical. Runtime identity is (loader, name), not name alone.

If the bytes just come from URLs, do not write a loader at all — `java.net.URLClassLoader` already does it:

```java
ClassLoader cl = new URLClassLoader(new URL[]{ new File("out").toURI().toURL() });
Class<?> c = Class.forName("generated.Greeter", true, cl);
```

### Generating source and compiling it in memory with `JavaCompiler`

When the thing you want at runtime is easier to express as *source*, the Compiler API (`javax.tools`, present since Java 6) will compile a `String`. Implement `SimpleJavaFileObject` to serve the source, then run the `CompilationTask` — which is also a `Callable<Boolean>`, so it can go into an `ExecutorService` if wanted:

```java
static class StringSource extends SimpleJavaFileObject {
    private final String code;

    StringSource(String className, String code) {
        super(URI.create("string:///" + className.replace('.', '/') + ".java"), Kind.SOURCE);
        this.code = code;
    }

    @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return code; }
}
```

```java
String src = """
    package generated;
    public class Greeter {
        public static String greet(String who) { return "Hello, " + who; }
    }
    """;

JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
if (compiler == null) {
    throw new IllegalStateException("No compiler in this image — fall back to reflection");
}

Callable<Boolean> task = compiler.getTask(
        null, null, null,                       // out, fileManager, diagnosticListener
        List.of("-d", "out"),                   // ordinary javac options
        null,                                   // classes for annotation processing
        List.of(new StringSource("generated.Greeter", src)));

if (task.call()) {
    ClassLoader cl = new URLClassLoader(new URL[]{ new File("out").toURI().toURL() });
    Class<?> c = Class.forName("generated.Greeter", true, cl);
    System.out.println(c.getMethod("greet", String.class).invoke(null, "world"));   // Hello, world
}
```

`ToolProvider.getSystemJavaCompiler()` returns `null` on a runtime image built without the `jdk.compiler` module, so the null check is not defensive padding — it is the documented signal to give up or fall back.

### Building and transforming `.class` files with the Class-File API

The Class-File API in `java.lang.classfile` is the JDK's own answer to ASM: it was previewed by **JEP 457 in JDK 22**, re-previewed by **JEP 466 in JDK 23**, and finalized as a standard API by **JEP 484 in JDK 24** — so on a current JDK it needs no `--enable-preview`, unlike the preview-era examples still circulating. Everything starts from `ClassFile.of()`, and the shapes it manipulates are `ClassModel` / `ClassElement` records plus `ClassDesc` and `MethodTypeDesc` from `java.lang.constant`.

Parsing is a `switch` over elements — note this reads *bytes*, never loading the class, so no static initializer runs:

```java
byte[] original = Files.readAllBytes(Path.of("Target.class"));
ClassModel model = ClassFile.of().parse(original);

System.out.println("thisClass=" + model.thisClass().asInternalName());
for (ClassElement e : model) {
    switch (e) {
        case MethodModel m -> System.out.println("Method " + m.methodName().stringValue()
                                                + m.methodType().stringValue());
        case FieldModel f  -> System.out.println("Field " + f.fieldName().stringValue());
        default            -> System.out.println("Other: " + e);
    }
}
// thisClass=Target
// Other: AccessFlags[flags=33]
// Other: ClassFileVersion[majorVersion=69, minorVersion=0]
// Other: Superclass[superclassEntry=java/lang/Object]
// Other: Interfaces[interfaces=]
// Method <init>()V
// Method work()V
// Method debugOnly()V
// Other: Attribute[name=SourceFile]
```

Building emits a class that has no source file anywhere — a class builder `clb` for the structure, a code builder `cob` for individual bytecodes:

```java
import java.lang.classfile.*;
import java.lang.constant.*;
import static java.lang.constant.ConstantDescs.*;

ClassDesc CD_Hello       = ClassDesc.of("notapackage.Hello");
ClassDesc CD_System      = ClassDesc.of("java.lang.System");
ClassDesc CD_PrintStream = ClassDesc.of("java.io.PrintStream");
MethodTypeDesc MTD_void_String      = MethodTypeDesc.of(CD_void, CD_String);
MethodTypeDesc MTD_void_StringArray = MethodTypeDesc.of(CD_void, CD_String.arrayType());

byte[] bytes = ClassFile.of().build(CD_Hello, clb -> clb
    .withFlags(ClassFile.ACC_PUBLIC)
    // every class needs a constructor; INIT_NAME is the special name "<init>"
    .withMethod(INIT_NAME, MTD_void, ClassFile.ACC_PUBLIC,
        mb -> mb.withCode(cob -> cob.aload(0)
                                    .invokespecial(CD_Object, INIT_NAME, MTD_void)
                                    .return_()))
    // public static void main(String[])
    .withMethod("main", MTD_void_StringArray,
        ClassFile.ACC_PUBLIC | ClassFile.ACC_STATIC,
        mb -> mb.withCode(cob -> cob.getstatic(CD_System, "out", CD_PrintStream)
                                    .ldc("Hello from generated bytecode")
                                    .invokevirtual(CD_PrintStream, "println", MTD_void_String)
                                    .return_())));

System.out.println("generated " + bytes.length + " bytes");   // generated 365 bytes
```

Those bytes are an ordinary class file: write them to disk for `javap`, or feed them straight to `defineClass` and call in:

```java
public class CreateLoadAndRun extends ClassLoader {   // to reach protected defineClass
    void run(byte[] bytes) throws Exception {
        Class<?> c = defineClass("notapackage.Hello", bytes, 0, bytes.length);
        c.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
        // Hello from generated bytecode
    }
}
```

The third mode is *transformation* — read a class file, emit a modified one. `ClassTransform.dropping` removes matching elements; other transforms rewrite method bodies or individual instructions, which is how a package rename or an AOP wrapper is implemented:

```java
ClassModel model = ClassFile.of().parse(original);
byte[] stripped = ClassFile.of().transformClass(model,
        ClassTransform.dropping(e -> e instanceof MethodModel m
                                     && m.methodName().equalsString("debugOnly")));

for (MethodModel m : ClassFile.of().parse(stripped).methods()) {
    System.out.println("kept: " + m.methodName().stringValue());
}
// kept: <init>
// kept: work
```

### Hidden classes: defining a class without a loader namespace

If the generated class is a one-off implementation detail — a lambda-style adapter, a compiled expression — a whole `ClassLoader` is more machinery than needed. `Lookup.defineHiddenClass` (JEP 371, JDK 15) defines a class that is not discoverable by name and can be unloaded independently of its defining loader:

```java
byte[] bytes = ClassFile.of().build(ClassDesc.of("Hi"), clb -> clb
    .withFlags(ClassFile.ACC_PUBLIC)
    .withMethod("hi", MethodTypeDesc.of(CD_String),
        ClassFile.ACC_PUBLIC | ClassFile.ACC_STATIC,
        mb -> mb.withCode(cob -> cob.ldc("hi from a hidden class").areturn())));

MethodHandles.Lookup hidden = MethodHandles.lookup().defineHiddenClass(bytes, true);
Class<?> hc = hidden.lookupClass();
System.out.println(hc.getName() + " isHidden=" + hc.isHidden());
// Hi/0x000007f00115a000 isHidden=true

MethodHandle mh = hidden.findStatic(hc, "hi", MethodType.methodType(String.class));
System.out.println((String) mh.invokeExact());   // hi from a hidden class

Class.forName(hc.getName());
// java.lang.ClassNotFoundException: Hi/0x000007f00115a000
```

The bytes must name a class in the lookup class's own package, and the returned `Lookup` is the only handle on it — which is exactly why nothing else in the JVM can link against it by name.

## Trade-offs

- **Method handles pay off when cached, not when created per call** — the cost moves to lookup time, so a handle looked up inside the method it invokes is slower than `Method.invoke`, not faster. The idiom is a `static final MethodHandle` initialized once, which is also what lets the JIT treat it as a constant and inline through it.

```java
private static final MethodHandle SUBSTRING;
static {
    try {
        SUBSTRING = MethodHandles.lookup().findVirtual(String.class, "substring",
                MethodType.methodType(String.class, int.class, int.class));
    } catch (ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
}
```

- **`invokeExact` is type-safe in a way that surprises people** — the compiler derives the call's descriptor from the argument expressions and the result cast, so an omitted cast or an accidentally boxed argument is a runtime `WrongMethodTypeException`, not a compile error:

```java
Object o = mh.invokeExact("Anti...", Integer.valueOf(7), Integer.valueOf(20));
// WrongMethodTypeException: handle's method type (String,int,int)String
//   but found (String,Integer,Integer)Object
```

- **`invoke` trades that precision for convenience** — it silently inserts `asType` conversions (boxing, widening, return casts), which is friendlier but reintroduces per-call adaptation work and hides signature drift until something throws a `ClassCastException` inside the adapter instead of at the call site.

- **Both invokers are `throws Throwable`, which infects every call site** — you either declare `throws Throwable` upward or write a catch that rethrows the legal exceptions and wraps the rest; there is no narrower checked type to catch:

```java
String s = (String) mh.invokeExact("x", 1, 2);
// error: unreported exception Throwable; must be caught or declared to be thrown
```

- **`setAccessible(true)` is a deployment dependency, not just a code smell** — the moment the target is in another module that does not open its package, the call throws and the fix lives outside the source in a JVM flag or manifest attribute that every launch script, test runner, and container image must repeat:

```java
String.class.getDeclaredField("value").setAccessible(true);
// InaccessibleObjectException: module java.base does not "opens java.lang" to unnamed module
// fix lives here instead: java --add-opens java.base/java.lang=ALL-UNNAMED ...
```

- **Breaking encapsulation binds you to another class's private names** — a private field renamed in a patch release turns into a `NoSuchFieldException` at runtime with no compiler warning first. This is why the JDK frames `setAccessible` as a facility for tool builders (IDEs, debuggers, serialization and test libraries) rather than for application code.

- **Generating classes at runtime costs startup time and observability** — generated code has no source file, so stack traces point at a class no editor can open, breakpoints have nothing to attach to, and `JavaCompiler` in particular drags a full compile into your startup path. It buys speed only if the generated accessor is called often enough to amortize the generation.

- **The Class-File API is version-coupled by design** — it tracks the class file format in the JVM Specification, so it parses and emits the format of the JDK it ships in and no newer one. That is the point (it replaces a bundled ASM copy that had to be upgraded every release), but it means a build that must emit bytecode for a *newer* target than the running JDK still needs an external library:

```java
// the class file version emitted/parsed follows the running JDK
// Other: ClassFileVersion[majorVersion=69, minorVersion=0]   // JDK 25
```

- **`JavaCompiler` may simply not be there** — `ToolProvider.getSystemJavaCompiler()` returns `null` on a `jlink`ed runtime image without `jdk.compiler`, a common shape for container deployments, so any design that depends on runtime compilation needs a real fallback path rather than an assertion.

## Documentation Links

- [MethodHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandle.html) — doc
- [MethodHandles.Lookup — access checking at lookup time (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.Lookup.html) — doc
- [MethodHandles.privateLookupIn — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.html#privateLookupIn(java.lang.Class,java.lang.invoke.MethodHandles.Lookup)) — doc
- [MethodType — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodType.html) — doc
- [AccessibleObject.setAccessible — java.lang.reflect API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AccessibleObject.html#setAccessible(boolean)) — doc
- [JEP 403: Strongly Encapsulate JDK Internals](https://openjdk.org/jeps/403) — doc
- [ClassLoader — java.lang API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassLoader.html) — doc
- [javax.tools.JavaCompiler — Compiler API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.compiler/javax/tools/JavaCompiler.html) — doc
- [java.lang.classfile package — Class-File API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/classfile/package-summary.html) — doc
- [JEP 484: Class-File API (standard in JDK 24)](https://openjdk.org/jeps/484) — doc
- [JEP 371: Hidden Classes](https://openjdk.org/jeps/371) — doc
