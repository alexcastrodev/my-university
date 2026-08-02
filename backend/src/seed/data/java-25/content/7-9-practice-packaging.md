# Practice: Packaging

> Five exercises on turning code into deployable artifacts: deriving an automatic module's name from a JAR filename, the one-way readability relationship between the unnamed module and named modules, telling a modular JAR apart from a plain one, wiring `jlink`'s module path correctly, and why a service provider module must be an explicit root module to actually be discovered at runtime.

---

## Exercise 1 — Automatic Module Name Derivation

```bash
# lib/httpclient5-5.3.1.jar has no module-info.class and no
# Automatic-Module-Name entry in its MANIFEST.MF.

java --module-path lib:out \
     --add-modules httpclient5 \
     -m com.example.app/com.example.app.Main
```

Assuming `httpclient5-5.3.1.jar` is placed unmodified on the module path, is `--add-modules httpclient5` the correct module name, or will the JVM fail to resolve a module by that name?

<details>
<summary>Answer</summary>

`httpclient5` is correct — this command resolves successfully (module-name-wise; whether the rest of the graph resolves depends on other modules).

The derivation rule (from the migration slide) is:

1. Strip the **version suffix** from the filename.
2. Replace any remaining non-alphanumeric characters (except `.`) with `.`.
3. Collapse consecutive dots and strip leading/trailing dots.

Applying it to `httpclient5-5.3.1.jar`:

- The filename without `.jar` is `httpclient5-5.3.1`.
- The trailing version-looking segment is `-5.3.1` (a dash followed by a dotted numeric sequence) — only *that* trailing segment is stripped, leaving `httpclient5`.
- There are no remaining hyphens or other non-alphanumeric characters to replace, so the result is `httpclient5`.

The key subtlety is that the digit at the end of `httpclient5` is **not** part of the stripped version — the stripping only removes the trailing dash-plus-version pattern, not every digit in the name. This mirrors the slide's own example: `commons-lang3-3.13.0.jar` strips only the trailing `-3.13.0`, keeping the `3` in `lang3`, and derives `commons.lang3` — not `commons.lang`. If the JAR instead declared `Automatic-Module-Name: httpclient5` in `MANIFEST.MF`, that value would take priority over filename derivation, which is the recommended practice precisely because filename-derived names shift if the version-suffix pattern in the filename ever changes shape.

</details>

---

## Exercise 2 — Can a Named Module Read the Unnamed Module?

```java
// module-info.java
module com.example.app {
    requires java.base;
}
```

```bash
java --module-path out --class-path legacy.jar \
     -m com.example.app/com.example.app.Main
```

`legacy.jar` is on the classpath (so its classes belong to the unnamed module) and is **not** on the module path. `com.example.app.Main` calls a public method on `legacy.util.Helper`, a class inside `legacy.jar`. Does this compile and run, given only the `module-info.java` above?

<details>
<summary>Answer</summary>

No — resolving `legacy.util.Helper` from inside `com.example.app` fails, because `com.example.app` never gets read access to the unnamed module.

The readability relationship between named and unnamed modules is deliberately **one-way**: the unnamed module reads every named module (so classpath code freely uses exported JDK/application APIs, preserving backward compatibility), but there is no `requires`-style directive a named module can write in `module-info.java` to read the unnamed module back. `requires` only accepts the name of a named module, and the unnamed module has no name to write there.

The only way to grant this is the command-line escape hatch documented for migration scenarios:

```bash
java --add-reads com.example.app=ALL-UNNAMED \
     --module-path out --class-path legacy.jar \
     -m com.example.app/com.example.app.Main
```

`--add-reads com.example.app=ALL-UNNAMED` grants `com.example.app` read access to all classpath code without needing a `requires` declaration. This is explicitly called out as an escape hatch for incremental migration, not a substitute for properly declaring dependencies in `module-info.java` — the long-term fix is to move `legacy.jar` onto the module path (as a named or automatic module) rather than rely on `ALL-UNNAMED` permanently.

</details>

---

## Exercise 3 — Is This a Modular JAR?

```bash
# The team never wrote or compiled module-info.java for this project —
# only Main.java and its supporting classes were compiled.
javac -d out/classes src/com/example/app/Main.java \
                      src/com/example/app/service/*.java

jar --create --file=mods/app.jar \
    --main-class=com.example.app.Main \
    -C out/classes .

java --module-path mods -m app/com.example.app.Main
```

The team believed `app.jar` would be a modular JAR whose module is named `app`, and that `java --module-path mods -m app/com.example.app.Main` would launch it as that named module. Does the launch command actually succeed, and is `mods/app.jar` really a modular JAR?

<details>
<summary>Answer</summary>

The command does succeed in launching — but `mods/app.jar` is **not** a modular JAR, and the module the JVM resolves is not the named module the team intended.

A modular JAR is defined by containing `module-info.class` at the root of the archive. Here, `module-info.java` was never written or compiled, so nothing was ever fed into `jar --create -C out/classes .` that would produce a `module-info.class`. The resulting `app.jar` is a plain, non-modular JAR — it has an executable `Main-Class` manifest entry, but no module descriptor at all.

Placed on `--module-path`, a JAR with no module descriptor is not rejected — it is treated as an **automatic module**, with its name derived from the filename exactly as in Exercise 1: `app.jar` strips to `app`, has no version suffix or special characters to process, so the derived name is `app`. That happens to match what `-m app/com.example.app.Main` expects, so the launch succeeds — but for the wrong reason. As an automatic module, `app` exports *every* package and reads *everything* on the module path implicitly; none of the fine-grained encapsulation (`exports`, `opens`, `uses`/`provides`) the team may have been planning for a real `module-info.java` is in effect. If they later add a proper `module-info.java` with restricted `exports`, the behavior of consumers could change significantly, since today nothing is hidden.

</details>

---

## Exercise 4 — Debugging a Failing `jlink` Invocation

```bash
# Directory layout on disk:
#   mods/com.example.app.jar   (modular JAR, module com.example.app)
#   $JAVA_HOME/jmods/          (platform .jmod files)

jlink \
  --add-modules com.example.app \
  --output dist/my-app-runtime \
  --launcher run=com.example.app/com.example.app.Main
```

Both `mods/com.example.app.jar` and `$JAVA_HOME/jmods` already exist on disk. Will this `jlink` command succeed in producing `dist/my-app-runtime`?

<details>
<summary>Answer</summary>

No, it fails. `jlink` does not scan the filesystem for modules on its own — it resolves the root modules named in `--add-modules` (and their full transitive `requires` closure, which includes `java.base` for every module) exclusively against the module path supplied via `--module-path`. No `--module-path` was given here, so `jlink` has nowhere to look for `com.example.app` or for the platform modules it implicitly depends on, and it fails to resolve the module graph — merely having the files present on disk is irrelevant if they're not on the path `jlink` is told to search.

The corrected invocation must include both locations, exactly as shown in the module's own workflow example:

```bash
jlink \
  --module-path $JAVA_HOME/jmods:mods \
  --add-modules com.example.app \
  --output dist/my-app-runtime \
  --launcher run=com.example.app/com.example.app.Main
```

`$JAVA_HOME/jmods` supplies the platform modules (`java.base` and anything else `com.example.app` transitively requires), and `mods` supplies the application module itself. `--add-modules` only says *which* modules are roots to include — it does not also tell `jlink` *where* to find them.

</details>

---

## Exercise 5 — Why Doesn't `ServiceLoader` Find a Provider That's Right There?

```java
// module-info.java for com.example.app (the consumer)
module com.example.app {
    requires com.example.api;
    uses com.example.api.Greeter;
}
```

```bash
# out/ contains four already-compiled modules:
#   com.example.app, com.example.api, com.example.english, com.example.portuguese
# com.example.english and com.example.portuguese each provide Greeter.

java --module-path out \
     -m com.example.app/com.example.app.Main
```

`com.example.english` and `com.example.portuguese` are sitting right there on `--module-path`, alongside everything else. When `Main` calls `ServiceLoader.load(Greeter.class)` and iterates the result, how many `Greeter` implementations does it find?

<details>
<summary>Answer</summary>

Zero — the loop body never executes, and no error is thrown; `ServiceLoader` simply returns an empty result.

Merely being *present* on `--module-path` only makes a module **observable**; it does not put that module into the **resolved module graph** that the running application actually uses. The resolved graph is built starting from root modules — the initial module passed to `-m`/`--module`, plus anything reachable from it by following `requires` edges, plus anything explicitly named via `--add-modules`. Here, `com.example.app`'s only `requires` is `com.example.api`; it never `requires com.example.english` or `com.example.portuguese`, because service consumers are deliberately decoupled from providers at compile time — that's the entire point of `uses`/`provides`. So the two provider modules never enter the resolved graph, and `ServiceLoader.load()` — which only finds providers whose modules are on the module path *and* are already part of the readability graph — has nothing to iterate.

The fix is to force the provider modules into the graph as explicit roots, exactly as the services slide's own run command does:

```bash
java --module-path out \
     --add-modules com.example.english,com.example.portuguese \
     -m com.example.app/com.example.app.Main
```

Note that `uses com.example.api.Greeter` in `com.example.app` is necessary but not sufficient on its own — it tells the module system this consumer intends to bind to a service *if* a provider module is present in the graph, but it does not by itself pull unreferenced provider modules into that graph.

</details>
