# Practice: Modules

> Five exercises covering what the slides in this module introduced —
> `requires` vs. `requires transitive` (implied readability), `exports`
> vs. `exports ... to` (qualified exports), `opens` for reflective access,
> the `uses`/`provides ... with` ServiceLoader pattern, and the syntax
> rules governing `module-info.java` itself. Try to answer before opening
> each explanation.

---

## Exercise 1 — `requires` vs `requires transitive`

```java
// module com.example.api
module com.example.api {
    exports com.example.api;
}
```

```java
// module com.example.service
module com.example.service {
    requires com.example.api;          // plain requires, NOT transitive
    exports com.example.service.api;
}
```

```java
// com.example.service.api.ServiceFactory
package com.example.service.api;

import com.example.api.Widget;

public class ServiceFactory {
    public static Widget createWidget() {
        return new Widget();
    }
}
```

```java
// module com.example.client
module com.example.client {
    requires com.example.service;      // does NOT requires com.example.api
}
```

```java
package com.example.client;

import com.example.service.api.ServiceFactory;
import com.example.api.Widget;         // <-- line in question

public class Main {
    public static void main(String[] args) {
        Widget w = ServiceFactory.createWidget();
    }
}
```

Does `com.example.client` compile as written? If not, what's the minimal
fix to `module-info.java` that resolves it without touching `client`'s
own `module-info.java`?

<details>
<summary>Answer</summary>

**It does not compile.** `com.example.client` only has `requires
com.example.service;` — it never reads `com.example.api` directly, and
because `com.example.service` used a plain `requires com.example.api;`
(not `requires transitive`), that readability is **not propagated**
downstream. `import com.example.api.Widget;` and the `Widget w = ...`
declaration both fail: `client` simply cannot see the `com.example.api`
module.

The fact that `ServiceFactory.createWidget()` — a method `client` *can*
see — returns a `Widget` doesn't help; readability is checked per
consuming module, not inferred from what types happen to flow through a
method signature.

**Minimal fix (without touching `client`):** change `service`'s
directive to `requires transitive com.example.api;`. This grants
*implied readability* — any module that requires `com.example.service`
automatically reads `com.example.api` too, exactly because `service`'s
own exported API (`ServiceFactory.createWidget()`) exposes an
`com.example.api` type in its signature. That's precisely the rule of
thumb from the slides: use `requires transitive` whenever your exported
API leaks a dependency's types through parameters or return values.

(The alternative fix — adding `requires com.example.api;` directly to
`client`'s own module-info.java — also works, but the prompt asked for a
fix that doesn't touch `client`.)

</details>

---

## Exercise 2 — Qualified `exports ... to` and who actually gets access

```java
// module com.example.library
module com.example.library {
    exports com.example.library.api;
    exports com.example.library.internal to com.example.testing;
}
```

```java
// module com.example.testing
module com.example.testing {
    requires com.example.library;
}
```

```java
package com.example.testing;

import com.example.library.internal.Diagnostics;   // (1)

public class DiagnosticsRunner {
    public static void run() {
        Diagnostics.dump();
    }
}
```

```java
// module com.example.consumer
module com.example.consumer {
    requires com.example.library;
}
```

```java
package com.example.consumer;

import com.example.library.internal.Diagnostics;   // (2)

public class App {
    public static void main(String[] args) {
        Diagnostics.dump();
    }
}
```

Both `com.example.testing` and `com.example.consumer` declare `requires
com.example.library;`. Do lines (1) and (2) both compile? If not, why
does requiring the module not guarantee the same package access for
both?

<details>
<summary>Answer</summary>

**Line (1) compiles; line (2) does not.**

`requires` only establishes module-level **readability** — it lets
`testing` and `consumer` see whatever `com.example.library` chooses to
export, nothing more. Package-level access is a separate, finer-grained
decision made by the exporting module's `exports` directives.

`com.example.library.internal` is exported with a qualifier: `exports
com.example.library.internal to com.example.testing;`. That restricts
compile-time visibility of that specific package to only the modules
named in the `to` list — here, exclusively `com.example.testing`. Any
module not on that list, including `com.example.consumer` (which reads
the *module* just fine but isn't on the *package's* allow-list), sees
`com.example.library.internal` as if it doesn't exist. The `import` in
`App` fails to compile for exactly the same reason an import of a
genuinely nonexistent package would fail.

This is the key distinction the slides draw: `requires` controls "can I
read this module at all," while `exports`/`exports ... to` controls
"which of that module's packages, and for whom."

</details>

---

## Exercise 3 — `opens` grants reflection, not compile-time visibility

```java
// module com.example.app
module com.example.app {
    exports com.example.app.api;
    opens com.example.app.model;      // unqualified opens — no exports
}
```

```java
// module com.example.tool
module com.example.tool {
    requires com.example.app;
}
```

```java
package com.example.tool;

import com.example.app.model.User;                     // (1)

public class Loader {
    public static void main(String[] args) throws Exception {
        Class<?> clazz = Class.forName("com.example.app.model.User"); // (2)
        var field = clazz.getDeclaredField("name");                   // (3)
        field.setAccessible(true);                                    // (4)
        System.out.println(field.get(clazz.getDeclaredConstructor().newInstance()));
    }
}
```

Which line fails to compile? If you delete just that line (the rest of
the class doesn't actually need it — `Class.forName` looks the type up
by string, and everything after that works purely through the
reflection API), does the remaining code run successfully at runtime?

<details>
<summary>Answer</summary>

**Line (1), `import com.example.app.model.User;`, fails to compile.**
`com.example.app.model` is `opens`-ed but never `exports`-ed. `opens`
grants **runtime reflective access only** — `Class.getDeclaredFields()`,
`setAccessible(true)`, and similar. It does *not* make the package
visible at compile time: no other module can `import` a type from it or
declare a variable of that type in source. Only `exports` (or `exports
... to`, if `tool` were on the list) grants that.

**With the import removed, the rest compiles and runs successfully.**
Nothing else in `Loader` references `User` as a static type — `Class
.forName(String)` resolves the class purely by its fully-qualified name
at runtime, and `getDeclaredField`, `setAccessible`, and
`getDeclaredConstructor` are all methods on `java.lang.reflect` types
declared in `java.base`, so they need no compile-time visibility into
`com.example.app.model`. At runtime, `com.example.tool` already reads
`com.example.app` (via `requires`), and `com.example.app.model` is
opened unqualified to every module, so `setAccessible(true)` succeeds
without throwing `InaccessibleObjectException`.

The takeaway: a package can be `exports`-ed, `opens`-ed, both, or
neither — each directive answers a different question ("can you `import`
it?" vs. "can you reflect into it at runtime?"), and one does not imply
the other.

</details>

---

## Exercise 4 — `uses` / `provides ... with` and the ServiceLoader pattern

```java
// module com.example.spi
module com.example.spi {
    exports com.example.spi;
}
```

```java
package com.example.spi;

public interface MessageFormatter {
    String format(String msg);
}
```

```java
// module com.example.app (the consumer)
module com.example.app {
    requires com.example.spi;
    uses com.example.spi.MessageFormatter;
}
```

```java
// module com.example.json (the provider)
module com.example.json {
    provides com.example.spi.MessageFormatter
        with com.example.json.JsonMessageFormatter;
}
```

```java
package com.example.json;

import com.example.spi.MessageFormatter;

public class JsonMessageFormatter implements MessageFormatter {
    @Override
    public String format(String msg) {
        return "{\"message\":\"" + msg + "\"}";
    }
}
```

Does `com.example.json`'s `module-info.java`, exactly as written above,
compile? Note it never depends on `com.example.app`, and its class
directly references and implements `com.example.spi.MessageFormatter`.

<details>
<summary>Answer</summary>

**It does not compile — `com.example.json` is missing `requires
com.example.spi;`.**

It's true, and central to the pattern, that a service **provider** never
needs to depend on the **consumer** module — `com.example.json` and
`com.example.app` remain fully decoupled from each other, discovered and
consumed only through `ServiceLoader` at runtime. That decoupling is the
whole point of `uses`/`provides ... with`.

But the provider *does* need a real dependency on whichever module
**declares the service interface itself** — here, `com.example.spi`.
Both the `provides com.example.spi.MessageFormatter with ...` directive
and the `JsonMessageFormatter implements MessageFormatter` declaration
reference the type `com.example.spi.MessageFormatter` directly, so
`com.example.json` needs ordinary compile-time readability of
`com.example.spi`, exactly as any other module referencing a type from
another module would. Without `requires com.example.spi;`, that type is
unreachable and both the `provides` clause and the `implements` clause
fail to compile.

Fixed version:

```java
module com.example.json {
    requires com.example.spi;
    provides com.example.spi.MessageFormatter
        with com.example.json.JsonMessageFormatter;
}
```

</details>

---

## Exercise 5 — Syntax rules for `module-info.java` itself

```java
// src/com.example.app/module-info.java
package com.example.app;

module com.example.app {
    exports com.example.app.api;
}
```

Assume this file sits exactly where a normal `module-info.java` should
— at the root of `com.example.app`'s source tree, alongside (not inside)
its package directories. Does it compile?

<details>
<summary>Answer</summary>

**No — the `package com.example.app;` statement is illegal here and the
file fails to compile.**

`module-info.java` is not a member of any package — it isn't a class or
interface at all, it's a special, singular file recognized by its exact
name (`module-info.java`) that declares the module itself. Its correct
location is literally the root of the module's source tree, sitting
alongside the top-level package directories, precisely so that it is
*outside* any package. Prefacing it with a `package` declaration
contradicts that positioning and is rejected by the compiler.

The corrected file simply omits the package statement:

```java
// src/com.example.app/module-info.java
module com.example.app {
    exports com.example.app.api;
}
```

This ties back to the two placement rules the slides emphasize: the file
must be named exactly `module-info.java`, and it must sit at the root of
the module's source directory rather than nested inside a package
folder like `com/example/app/`. A `module-info.java` found nested inside
a package directory isn't recognized as that module's descriptor at all
— `javac`'s `--module-source-path` resolution expects it as a direct
child of the module's source root, not several package levels deep.

</details>
