# Services, Providers, and Consumers

---

## Overview

The **Service Loader** pattern allows modules to be loosely coupled through a service interface. A **consumer** module declares that it uses a service; one or more **provider** modules supply implementations. The binding is deferred to runtime — consumer and provider do not need to know each other at compile time.

| Role | Module directive | Responsibility |
|------|-----------------|---------------|
| Service interface | (none — just a type) | Defines the contract |
| Consumer | `uses <ServiceInterface>` | Discovers implementations via `ServiceLoader` |
| Provider | `provides <ServiceInterface> with <Impl>` | Registers one or more implementations |

---

## Defining the Service Interface

The service interface (or abstract class) is usually placed in a separate API module that both consumers and providers depend on.

```java
// Module: com.example.api
// Package: com.example.api
package com.example.api;

public interface Greeter {
    String greet(String name);
}
```

```java
// module-info.java for com.example.api
module com.example.api {
    exports com.example.api;
}
```

---

## Creating a Provider Module

```java
// Module: com.example.english
// Package: com.example.english
package com.example.english;

import com.example.api.Greeter;

public class EnglishGreeter implements Greeter {
    @Override
    public String greet(String name) {
        return "Hello, " + name + "!";
    }
}
```

```java
// module-info.java for com.example.english
module com.example.english {
    requires com.example.api;

    provides com.example.api.Greeter
        with com.example.english.EnglishGreeter;
}
```

The provider class does **not** need to be in an exported package. The `provides … with` directive registers the implementation with the module system, but nothing else needs to import it.

---

## Creating a Second Provider

```java
// Module: com.example.portuguese
package com.example.portuguese;

import com.example.api.Greeter;

public class PortugueseGreeter implements Greeter {
    @Override
    public String greet(String name) {
        return "Olá, " + name + "!";
    }
}
```

```java
// module-info.java for com.example.portuguese
module com.example.portuguese {
    requires com.example.api;

    provides com.example.api.Greeter
        with com.example.portuguese.PortugueseGreeter;
}
```

---

## Creating a Consumer Module

```java
// Module: com.example.app
package com.example.app;

import com.example.api.Greeter;
import java.util.ServiceLoader;

public class Main {
    public static void main(String[] args) {
        ServiceLoader<Greeter> loader = ServiceLoader.load(Greeter.class);

        for (Greeter greeter : loader) {
            System.out.println(greeter.greet("World"));
        }
    }
}
```

```java
// module-info.java for com.example.app
module com.example.app {
    requires com.example.api;

    uses com.example.api.Greeter;
}
```

> **Exam tip:** The consumer module must declare `uses` in its `module-info.java`, or `ServiceLoader.load()` will not find provider modules. Without `uses`, the JVM will throw `ServiceConfigurationError` at runtime.

---

## `ServiceLoader` API

```java
ServiceLoader<Greeter> loader = ServiceLoader.load(Greeter.class);

// Iterate all providers
loader.forEach(g -> System.out.println(g.greet("Java")));

// Get the first available provider
Greeter first = loader.findFirst().orElseThrow();

// Stream providers (lazy instantiation)
loader.stream()
      .map(ServiceLoader.Provider::get)
      .map(g -> g.greet("modules"))
      .forEach(System.out::println);
```

| Method | Description |
|--------|-------------|
| `ServiceLoader.load(Class<S>)` | Creates a `ServiceLoader` for service type `S` |
| `iterator()` / `forEach()` | Iterates and instantiates all providers |
| `stream()` | Returns `Stream<Provider<S>>` — providers are lazy |
| `findFirst()` | Returns `Optional<S>` with the first provider |
| `reload()` | Clears the internal cache |

---

## Provider Requirements

A provider class must satisfy one of these conditions for `ServiceLoader` to instantiate it:

1. Has a public no-argument constructor, **or**
2. Has a public static `provider()` method that returns the service type (factory method pattern).

```java
public class CachingGreeter implements Greeter {
    private CachingGreeter() { }

    public static Greeter provider() {
        return new CachingGreeter();
    }

    @Override
    public String greet(String name) {
        return "Hi, " + name + " (cached)";
    }
}
```

---

## Running the Example

```bash
# Compile all modules
javac -d out --module-source-path src \
      $(find src -name "*.java")

# Run — include both provider modules on the module path
java --module-path out \
     --add-modules com.example.english,com.example.portuguese \
     -m com.example.app/com.example.app.Main
```

Output (order may vary):

```
Hello, World!
Olá, World!
```

---

## Key Points for the Exam

- The consumer declares `uses <Interface>` in `module-info.java`.
- Each provider declares `provides <Interface> with <Impl>` — multiple implementations can be listed, comma-separated.
- The provider implementation class does not need to be in an exported package.
- `ServiceLoader.load()` only finds providers whose modules are on the module path and whose modules are in the readability graph.
- Without `uses`, `ServiceLoader` returns no providers from named modules.
- Providers are instantiated lazily when iterated (unless `stream()` + `Provider::get` forces it).

## References

- [JEP 261: Module System — Services](https://openjdk.org/jeps/261)
- [Oracle Docs — ServiceLoader (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ServiceLoader.html)
