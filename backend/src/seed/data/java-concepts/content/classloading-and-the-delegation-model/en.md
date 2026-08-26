---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Understand how the JVM turns a `.class` file into a live, usable type: **loading** finds the bytes and creates a `Class` object, **linking** verifies and prepares it, and **initialization** runs its static initializers — three distinct phases, triggered at different, often-surprising moments. Class loading is also delegated through a **hierarchy** of `ClassLoader` instances that, by default, always ask their parent first — a rule that exists specifically so application code cannot silently replace core JDK classes. This is the mechanism underneath the module system covered in [Java Platform Module System](/java-concepts/java-platform-module-system); JPMS changes *which* packages a loader is allowed to see, not the loading/linking/initialization pipeline itself.

## Use Cases

- Explaining why touching a `static final` constant never triggers a class's static initializer, but calling one of its static methods always does.
- Reading a stack trace that says `NoClassDefFoundError` and knowing to look for an earlier `ExceptionInInitializerError`, or a JAR that was present at compile time but is missing from the runtime classpath — instead of confusing it with `ClassNotFoundException`.
- Writing a custom `ClassLoader` to load application plugins from a directory, isolate each plugin's classes from the others, or support hot-reloading a class without restarting the JVM.
- Diagnosing a `ClassCastException` between two objects that print the exact same type name — a classic symptom of the same class having been loaded twice, by two different class loaders, in an app server or plugin system.
- Deciding whether a security- or isolation-sensitive dependency needs its own loader, versus just another entry on the application classpath.

## Deep Dive

### The three phases: loading, linking, initialization

The JVM Specification (§5.3–§5.5) splits turning a class name into a ready-to-use type into three phases. **Loading** reads the class's bytes and creates a `Class` object. **Linking** is itself three steps: verification (bytecode is structurally and type-safe), preparation (static fields get their default zero/`null` values, memory is allocated), and resolution (symbolic references to other types are optionally resolved, often lazily). **Initialization** is the one developers actually see: it runs static initializer blocks and static field assignments, and it happens lazily, on first "active use" — not at loading time:

```java
class Lazy {
    static final int MAX = 100;           // compile-time constant, inlined by javac

    static {
        System.out.println("Lazy initialized");
    }

    static void ping() {
        System.out.println("ping");
    }
}

public class Demo {
    public static void main(String[] args) {
        int max = Lazy.MAX;   // no output at all: javac inlined the literal 100
                               // into Demo's own bytecode; Lazy is never touched
        Lazy.ping();           // NOW Lazy is initialized: prints "Lazy initialized"
                               // then "ping"
    }
}
```

`MAX` is a compile-time constant expression (JLS §15.29), so the compiler copies its value directly into every call site and the referencing class never even needs to load `Lazy` to read it. A `static` *method* call, by contrast, cannot be inlined away — it forces loading, linking, and initialization of `Lazy` before the call proceeds. The same is true for `new Lazy()`, accessing a non-constant static field, or reflectively invoking a static method.

### The delegation hierarchy: bootstrap, platform, application

The default JVM ships with a small hierarchy of loaders, each with its own scope:

```java
public class LoaderChain {
    public static void main(String[] args) {
        System.out.println(String.class.getClassLoader());
        // null — String is loaded by the bootstrap loader, which has no
        // Java-side ClassLoader object at all

        System.out.println(java.sql.Driver.class.getClassLoader());
        // jdk.internal.loader.ClassLoaders$PlatformClassLoader@... —
        // a platform module (java.sql), loaded by the platform loader

        ClassLoader cl = LoaderChain.class.getClassLoader();
        while (cl != null) {
            System.out.println(cl);
            cl = cl.getParent();
        }
        // jdk.internal.loader.ClassLoaders$AppClassLoader@...      (this class)
        // jdk.internal.loader.ClassLoaders$PlatformClassLoader@... (its parent)
        // (loop ends: the platform loader's parent is bootstrap, reported as null)
    }
}
```

Before Java 9, this loader was called the **extension** class loader and covered `jre/lib/ext`; JPMS repurposed it into the **platform** loader, responsible for the JDK's own platform modules (`java.sql`, `java.desktop`, and similar). The **application** (a.k.a. "system") loader is the one that loads everything on the classpath or module path that your own code ships — it is what `Class.getSystemClassLoader()` returns, and the default parent for any custom loader you write.

### Parent-first delegation: why it exists, how it works

`ClassLoader.loadClass(String, boolean)` implements the default **parent-first** strategy: before a loader tries to find and define a class itself, it asks its parent to try first, all the way up to bootstrap. Only if every ancestor fails to find the class does the loader fall back to its own `findClass`. The point is protection, not convenience: it stops application code from shadowing a core class like `java.lang.String` just by shipping a same-named class on the classpath.

Even a custom loader that deliberately flips the order to *child-first* — checking itself before delegating — cannot get away with redefining a JDK-owned package, because `defineClass` itself refuses:

```java
public class ChildFirstLoader extends ClassLoader {
    public ChildFirstLoader(ClassLoader parent) { super(parent); }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        if (name.startsWith("java.")) {
            return super.loadClass(name, resolve);   // still must delegate for java.*
        }
        // child-first for everything else — try to define it ourselves before asking the parent
        try {
            return findClass(name);
        } catch (ClassNotFoundException e) {
            return super.loadClass(name, resolve);
        }
    }
}
```

If this loader tried to `defineClass("java.lang.String", bytes, 0, bytes.length)` anyway, the JVM rejects it outright:

```
java.lang.SecurityException: Prohibited package name: java.lang
```

Delegation order is a policy choice a loader can override; the ban on defining classes in protected system packages is enforced independently, at `defineClass` itself.

### Writing a custom ClassLoader: findClass, defineClass, and a plugin loader

A custom loader almost always overrides `findClass`, not `loadClass` — that keeps the parent-first delegation logic intact and only changes *where bytes come from* when delegation fails. The actual `Class` object is created with the inherited `defineClass`:

```java
public class PluginClassLoader extends ClassLoader {
    private final Path pluginDir;

    public PluginClassLoader(Path pluginDir, ClassLoader parent) {
        super(parent);
        this.pluginDir = pluginDir;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        Path classFile = pluginDir.resolve(name.replace('.', '/') + ".class");
        try {
            byte[] bytes = Files.readAllBytes(classFile);
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

```java
PluginClassLoader loader = new PluginClassLoader(Path.of("plugins/report-exporter"), 
                                                   PluginClassLoader.class.getClassLoader());
Class<?> pluginClass = loader.loadClass("com.example.plugin.ReportExporterPlugin");
Plugin plugin = (Plugin) pluginClass.getDeclaredConstructor().newInstance();
plugin.run();
```

This is the standard shape for a plugin architecture: each plugin gets its own loader, so two plugins can each depend on a different version of the same library without colliding. Creating a *fresh* `PluginClassLoader` instance and reloading the same class name is also how hot-reload works — the JVM does not "reload" a class in place; a new definition of the same name, loaded by a new loader instance, is simply a distinct `Class` object living alongside (or replacing all references to) the old one, which becomes eligible for garbage collection once nothing holds onto it.

### ClassNotFoundException vs. NoClassDefFoundError

`ClassNotFoundException` is a checked exception thrown when code explicitly *asks* to load a class by name and that name cannot be resolved — typically `Class.forName(...)` or `ClassLoader.loadClass(...)`:

```java
try {
    Class.forName("com.example.MissingPlugin");
} catch (ClassNotFoundException e) {
    // the requested class genuinely does not exist anywhere on the search path
}
```

`NoClassDefFoundError` is an unchecked `Error`, thrown when the JVM tries to load a class *implicitly* — as a side effect of running other code that references it — and that attempt fails, even though the class existed and linked fine at compile time. The most common real-world cause is a dependency JAR present at compile time but absent from the runtime classpath. A more subtle cause is a class whose static initializer already failed once:

```java
class Broken {
    static {
        if (true) throw new RuntimeException("boom");
    }
}

public class Demo {
    public static void main(String[] args) {
        try {
            new Broken();                      // first attempt: static init runs and throws
        } catch (ExceptionInInitializerError e) {
            System.out.println("first: " + e.getCause());
        }
        try {
            new Broken();                      // second attempt: init is NOT retried
        } catch (NoClassDefFoundError e) {
            System.out.println("second: " + e.getMessage());
            // second: Could not initialize class Broken
        }
    }
}
```

Once a class's initialization fails, the JVM marks it permanently erroneous — it never retries the static initializer, and every later attempt to use the class throws `NoClassDefFoundError` instead of re-running (and re-failing) the same code.

### ClassCastException across two loaders: identity includes the loader

The JVM's notion of "the same type" is `(fully qualified name, defining ClassLoader)`, not just the name. Load the identical `.class` bytes through two different loader instances and you get two distinct, mutually incompatible types:

```java
ClassLoader loaderA = new PluginClassLoader(pluginDir, parent);
ClassLoader loaderB = new PluginClassLoader(pluginDir, parent);

Class<?> widgetA = loaderA.loadClass("com.example.Widget");
Class<?> widgetB = loaderB.loadClass("com.example.Widget");

Object instance = widgetA.getDeclaredConstructor().newInstance();

widgetB.cast(instance);
// java.lang.ClassCastException: class com.example.Widget cannot be cast to class
//   com.example.Widget (com.example.Widget is in unnamed module of loader
//   PluginClassLoader @1b6d3586; com.example.Widget is in unnamed module of loader
//   PluginClassLoader @4f2a9c11)
```

Both classes are named `com.example.Widget`, compiled from the exact same source — the JVM still treats them as unrelated types because they were defined by different loader instances. This is the classic failure mode in application servers and OSGi-style plugin systems: a shared interface loaded once by a common ancestor works fine, but an implementation class accidentally loaded twice — once per plugin loader instead of once, shared — breaks any code that tries to cast between the two copies.

## Trade-offs

- **Breaking parent-first delegation to shadow a JDK class does not actually work** — even a child-first loader is blocked from defining a class in a protected package such as `java.lang`:

```
java.lang.SecurityException: Prohibited package name: java.lang
```

- **A live class loader keeps everything it loaded alive** — every `Class` a loader defined, and every static field those classes hold, stays reachable for as long as the loader itself is reachable. A plugin system that forgets to drop its last reference to a `PluginClassLoader` after unloading a plugin leaks the plugin's entire class graph and static state for the life of the JVM; this is a real, recurring cause of `OutOfMemoryError: Metaspace` in long-running app servers that reload plugins or web apps repeatedly.
- **The same class loaded by two loaders is two incompatible types** — a subtle, hard-to-spot bug when a "singleton" service or shared interface ends up loaded twice instead of once:

```java
widgetB.cast(instance); // ClassCastException, even though both classes are named identically
```

- **`NoClassDefFoundError` after a failed static initializer can mislead debugging** — the *first* stack trace (`ExceptionInInitializerError`, with the real cause) is the one worth keeping; every subsequent `NoClassDefFoundError: Could not initialize class ...` on the same class is just the JVM refusing to retry, and chasing it instead of the original cause wastes time.
- **Custom `defineClass` calls accept arbitrary bytecode** — a plugin loader that reads `.class` files from a writable directory is, functionally, an arbitrary-code-execution surface; verification (the "linking" phase) catches structurally malformed bytecode, but it says nothing about what a well-formed but malicious class is designed to do at runtime.
- **Lazy initialization is easy to reason about wrong** — assuming that referencing a class always runs its static initializer leads to surprises with compile-time constants, which are inlined at the call site and never trigger loading of the declaring class at all.

## Documentation Links

- [The Java Virtual Machine Specification — Chapter 5: Loading, Linking, and Initializing](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html) — doc
- [ClassLoader — Java SE 25 API Documentation](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassLoader.html) — doc
