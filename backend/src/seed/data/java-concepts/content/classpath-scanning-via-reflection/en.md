---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

"Component scan" sounds like framework magic, but the mechanism is a straightforward recursive directory walk: find every compiled `.class` file under a base package, load it, and check whether it carries a marker annotation. This is literally how a minimal framework discovers its own controllers/services without any configuration file — and understanding the naive version (a Depth-First Search over `target/classes` plus `Class.forName` plus `isAnnotationPresent`) makes it obvious why real frameworks like Spring do the equivalent job differently: not because the naive approach is wrong, but because it doesn't scale cleanly to large classpaths.

## Use Cases

- Building a small plugin system that discovers implementations by annotation rather than requiring an explicit registration list.
- Writing a lightweight test harness or CLI tool that needs to find "every class annotated `@X`" without pulling in a framework.
- Understanding what a DI container's startup log line like "found N components" is actually doing underneath.
- Recognizing why component scanning has a per-package cost (`@ComponentScan(basePackages = ...)` narrows it) — it's proportional to how many `.class` files exist under the scanned root.

## Deep Dive

### A minimal DFS classpath scanner

```java
public class ClassExplorer {
    private static String BASE_PACKAGE;

    public static void explore(Class<?> mainClass) {
        BASE_PACKAGE = mainClass.getPackage().getName();
        String basePath = "target/classes/" + BASE_PACKAGE.replace(".", "/");
        File root = new File(basePath);
        searchRecursively(root, BASE_PACKAGE);
    }

    private static void searchRecursively(File directory, String currentPackage) {
        for (File file : Objects.requireNonNull(directory.listFiles())) {
            if (file.isDirectory()) {
                searchRecursively(file, currentPackage + "." + file.getName());   // descend
            } else if (file.getName().endsWith(".class")) {
                String className = currentPackage + "." + file.getName().replace(".class", "");
                try {
                    Class<?> clazz = Class.forName(className);                    // load it
                    if (clazz.isAnnotationPresent(SimpleController.class)) {       // inspect it
                        ControllersMap.registerController(clazz);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
```

Three steps per file: recurse into subdirectories (DFS, so nested package structures like `app.controllers.user` are found regardless of depth), reconstruct the fully-qualified class name from the file path, and — the actual "discovery" step — `Class.forName()` to load it followed by `isAnnotationPresent()` to check the marker annotation. Every matching class is registered into a map (interface/marker → implementation) that the rest of the framework consults at request time, instead of anything being hardcoded.

### Why `Class.forName()` is the expensive part

`Class.forName(className)` doesn't just read metadata — it **loads and initializes** the class: running static initializers, resolving the class's own dependencies, and registering it with the JVM's class loader. For a marker-annotation check that might reject 95% of scanned classes, this means paying full class-loading cost for classes that turn out not to be controllers/services at all — including any side effects those static initializers have, whether or not the class ends up being used.

### The modern alternative: reading bytecode without loading the class

```java
// Conceptually, what ASM-based scanning does instead:
ClassReader reader = new ClassReader(classBytes);   // parse .class bytes directly
reader.accept(new AnnotationVisitor() { ... }, 0);   // visit annotations without loading the class
```

Spring's `ClassPathScanningCandidateComponentProvider` (the machinery behind `@ComponentScan`) reads class metadata via ASM — a bytecode-manipulation library — instead of calling `Class.forName()` on every candidate. This means Spring can check for `@Component`/`@Service`/`@Repository`/`@Controller` by parsing the compiled bytecode's annotation table directly, without ever loading (and therefore without triggering static initializers or classloading side effects for) classes that don't match. Only classes that pass the metadata check get actually loaded into the JVM. Third-party libraries like ClassGraph or Reflections take the same underlying approach — read metadata first, load lazily — for the same reason.

## Trade-offs

- **`Class.forName()`-per-file scanning has real side effects, not just a performance cost** — loading a class runs its static initializers, so a naive scanner can trigger code (a static block that opens a resource, registers something globally, or throws) purely as a side effect of checking whether the class is annotated, even for classes that turn out not to match.
```java
class NotAController {
    static { System.out.println("side effect on scan, even though this isn't a controller"); }
}
// A Class.forName()-based scanner prints this line just by walking past the file —
// an ASM-based scanner reading bytecode metadata directly would not.
```
- **DFS-over-`target/classes` only works for exploded classpaths, not packaged JARs** — walking a `File` tree assumes classes exist as loose `.class` files on disk; a production deployment running from a fat JAR has no such directory to walk, which is one reason real scanners (Spring's included) resolve classpath entries generically (JAR URLs, module paths) rather than assuming a filesystem directory.
- **Reflection-based discovery trades startup time for zero configuration** — no XML/properties file lists which classes are controllers, which is convenient, but the entire classpath (or scanned base packages) has to be walked at startup to find out; narrowing `@ComponentScan(basePackages = ...)` to the smallest sufficient package list directly reduces this cost, same principle as the naive scanner's `BASE_PACKAGE` constant.

## Lab

In this lab you get five support classes already written and you implement `ComponentScanner`, the part of a container that filters candidates and instantiates the survivors. The core idea is to separate two independent questions that frameworks like Spring ask at startup, "does this type implement interface X?" and "does this type carry annotation Y?", and to finish by turning a `Class` object into a live instance.

**The scenario**

The scanner receives a `List<Class<?>>` of candidates and answers what a container asks when it boots. Discovering that list (walking directories and jars) is left out on purpose: the filtering and instantiating mechanics are the same.

- `Notifier.java`: an interface with one `notify(String)` method.
- `Component.java`: a marker annotation, retained at run time.
- `EmailNotifier.java`: implements `Notifier` AND has `@Component`.
- `SmsNotifier.java`: implements `Notifier`, but does NOT have the annotation.
- `LegacyHelper.java`: has `@Component`, but does NOT implement `Notifier`.
- `ComponentScanner.java`: what you implement.

The three candidates cover every combination on purpose. Checking the interface and checking the annotation are independent tests, and the tests catch a scanner that conflates them.

**What you will do, step by step**

1. **Filter by interface (TODO-00).** In `findImplementations()`, return the classes in `candidates` that implement `targetInterface`, not including the interface itself, preserving input order. The tool is `Class.isAssignableFrom()`. Mind the direction: it is the interface that asks whether it can be assigned from the candidate class.
2. **Filter by annotation (TODO-01).** In `findAnnotated()`, return the classes annotated with `annotationType`, also in order, using `Class.isAnnotationPresent()`.
3. **Instantiate (TODO-02).** In `instantiateAll()`, create one instance of each class with `getDeclaredConstructor().newInstance()` and return them in the same order. This is how a container turns metadata into objects.

**How you know you are done**

`mvn test` is all green. You should be able to explain why `SmsNotifier` shows up in one filter and `LegacyHelper` in the other, and why neither is in the intersection.

**Optional challenges**

- **TODO-03:** implement `findAnnotatedImplementations()`, returning only the candidates that implement the interface AND carry the annotation. Try building it on top of the two methods you already wrote.

**Prerequisites:** basic Java syntax, interfaces and annotations.

**How to run it:** clone the repository, go into `java-concepts/classpath-scanning-via-reflection` and run `mvn test` (or, from the root, `mvn -pl java-concepts/classpath-scanning-via-reflection test`). The scanner methods start by throwing `UnsupportedOperationException("Not implemented yet.")` with hints in the `TODO-NN` comments, so the red tests are your checklist.

## Documentation Links

- [Class.forName() — java.lang API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html#forName(java.lang.String)) — doc
- [AnnotatedElement.isAnnotationPresent() — java.lang.reflect API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AnnotatedElement.html#isAnnotationPresent(java.lang.Class)) — doc
- [Spring Framework Reference — Classpath Scanning and Managed Components](https://docs.spring.io/spring-framework/reference/core/beans/classpath-scanning.html) — doc
- [ASM — a Java bytecode manipulation and analysis framework](https://asm.ow2.io/) — doc
