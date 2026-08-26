---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

`jlink` is the JDK's *linker*: it takes a set of modules — JDK modules plus your own — and writes out a self-contained, runnable Java runtime image that holds only those modules and nothing else. `jdeps` is its companion analyzer: it reads compiled code and reports which modules that code actually needs, in a form `jlink` accepts directly. Together they answer a deployment question rather than a language one: instead of shipping an application and requiring a full JDK or JRE on the target machine, you ship one directory that contains a stripped-down Java plus your application, and it runs on a machine with no Java installed at all. This is the practical payoff of the [Java Platform Module System](/java-concepts/java-platform-module-system) — `jlink` only works because the JDK itself was split into modules with declared dependencies, so a dependency graph can be resolved and the unreachable parts left out.

## Use Cases

- Building a container image that carries a ~35–50 MB runtime instead of a ~380 MB JDK, cutting registry pull time and cold-start cost in CI and on autoscaling deployments.
- Shipping a desktop or CLI tool to users who must not be asked to install or manage a Java version themselves (usually via `jpackage`, which calls `jlink` internally).
- Discovering what a JAR *really* depends on with `jdeps --print-module-deps`, including whether it reaches into JDK internal APIs, before committing to a runtime module list.
- Producing per-platform runtime images for Linux, macOS, and Windows from one build machine — subject to the JMOD availability caveat below.
- Freezing a known-good runtime with baked-in JVM flags and a generated CDS archive, so startup behavior is identical everywhere the image is deployed.

## Deep Dive

### A minimal modular application

`jlink` needs modules, so the starting point is a `module-info.java` and a modular JAR. This is the only part that leans on JPMS itself — see the [module system concept](/java-concepts/java-platform-module-system) for what the directives mean.

```java
// src/demo/module-info.java
module demo {
    // java.base is implicit; nothing else is needed for this app
}
```

```java
// src/demo/com/example/demo/Hello.java
package com.example.demo;

public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello from a linked runtime, on Java "
            + System.getProperty("java.version"));
    }
}
```

Compile and package it as a modular JAR — the `module-info.class` at the JAR root is what makes it a module rather than a plain library:

```bash
javac -d mods/demo $(find src/demo -name '*.java')
jar --create --file demo.jar --main-class com.example.demo.Hello -C mods/demo .
```

### jdeps: discover the real module list

Never guess the module list. `jdeps` reads the bytecode and reports the dependencies it finds:

```bash
$ jdeps --module-path . demo.jar
demo
 [file:///home/dev/jlink-demo/./demo.jar]
   requires mandated java.base (@25.0.3)
demo -> java.base
   com.example.demo -> java.io            java.base
   com.example.demo -> java.lang          java.base
   com.example.demo -> java.lang.invoke   java.base
```

For the version you actually feed to `jlink`, use `--print-module-deps`, which prints a comma-separated, already-reduced list:

```bash
$ jdeps --print-module-deps --module-path . demo.jar
java.base
```

A realistic application prints something more like `java.base,java.logging,java.naming,java.sql,java.xml`. Two related flags matter in practice: `--list-deps` also names any JDK *internal* packages the code touches (a portability red flag), and `--ignore-missing-deps` lets the analysis finish on a dependency tree that does not fully resolve — essential for the classpath case below.

### jlink: link the image

```bash
jlink --module-path "$JAVA_HOME/jmods:." \
      --add-modules demo \
      --launcher rundemo=demo/com.example.demo.Hello \
      --strip-debug --no-header-files --no-man-pages \
      --compress=zip-6 \
      --output mini-java
```

- `--module-path` is where `jlink` looks for modules: the JDK's own `jmods` directory plus wherever your modules live. On a JDK built with JEP 493 linkable runtime support (see below) the `jmods` part is dropped — `jlink` reads the JDK modules out of the running image instead.
- `--add-modules` is the *root* set. Transitive `requires` edges are resolved automatically, which is exactly why the `jdeps` output can be pasted in verbatim.
- `--launcher name=module/mainclass` writes an executable script `bin/name`, so users never type a `java` command.
- `--compress` takes `zip-0` through `zip-9` (default `zip-6`) as of JDK 21; the old numeric `--compress=0|1|2` values are deprecated and slated for removal, so `--compress=2` in an older script should become `--compress=zip-6`.

The result is a complete runtime directory:

```bash
$ ./mini-java/bin/rundemo
Hello from a linked runtime, on Java 25.0.3

$ ./mini-java/bin/java --list-modules
demo
java.base@25.0.3

$ du -sh mini-java "$JAVA_HOME"
32M     mini-java
377M    /usr/lib/jvm/jdk-25
```

`--list-modules` is the honest audit: if a module you expected is absent, the failure will otherwise arrive as a `ClassNotFoundException` at run time, not at link time.

### Service providers are not linked in by default

Module resolution for `jlink` deliberately ignores `provides` edges. A module that is only reachable as a `ServiceLoader` provider is silently omitted:

```bash
$ ./mini-java/bin/java -m demo/com.example.demo.Hello
Exception in thread "main" java.util.NoSuchElementException   # no provider was linked
```

Two fixes, and the second is almost always the right one:

```bash
# see what providers the current module set could use
jlink --module-path "$JAVA_HOME/jmods:." --add-modules demo --suggest-providers

# link them all in (blunt: pulls in every observable provider, inflating the image)
jlink ... --bind-services --output mini-java

# or name the providers you actually want as extra roots (precise)
jlink ... --add-modules demo,com.example.demo.provider --output mini-java
```

This is the single most common cause of an image that links cleanly and then dies at run time — charset providers, JDBC drivers, logging backends, and locale data all arrive this way.

### The non-modular dependency problem

This restriction has *not* eased. Everything in the resolved graph must be a real module with a `module-info.class`. An **automatic module** — a plain JAR placed on the module path, which the runtime tolerates for `java` — is explicitly rejected by `jlink`:

```bash
$ jlink --module-path libs:mods --add-modules com.example.app --output image
Error: automatic module cannot be used with jlink: jackson.databind from
  file:///home/dev/app/libs/jackson-databind-2.19.0.jar
```

`--add-modules ALL-MODULE-PATH` does not rescue this. It only widens the *root set* to every observable module on the module path; automatic modules among them are still rejected. As of JDK 24 it also no longer defaults the module path, so the older shorthand fails outright:

```bash
$ jlink --add-modules ALL-MODULE-PATH --output image
Error: --module-path option must be specified with --add-modules ALL-MODULE-PATH
```

There are exactly two honest ways forward.

**Option A — modularize the dependency.** Generate a `module-info.java` for the offending JAR, compile it, and patch it back in. This works, and it is a maintenance burden you now own for a library you do not control:

```bash
jdeps --ignore-missing-deps --generate-module-info generated \
      --module-path libs libs/jackson-databind-2.19.0.jar
javac --patch-module jackson.databind=libs/jackson-databind-2.19.0.jar \
      --module-path libs -d patched generated/jackson.databind/module-info.java
jar --update --file libs/jackson-databind-2.19.0.jar -C patched module-info.class
```

**Option B — link only the JDK, keep the application on the classpath.** This is what nearly every real container build does, and it sidesteps modularizing the application entirely. `jdeps` analyzes the classpath, `--ignore-missing-deps` absorbs the inevitable optional dependencies, and the resulting image contains no application module at all:

```bash
$ jdeps --ignore-missing-deps --multi-release 25 --print-module-deps \
        --class-path 'libs/*' app.jar
java.base,java.logging,java.management,java.naming,java.sql

$ jlink --add-modules java.base,java.logging,java.management,java.naming,java.sql \
        --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
        --output jre

$ ./jre/bin/java -cp 'app.jar:libs/*' com.example.app.Main
```

Note `--multi-release`: without it, `jdeps` reads the pre-9 branch of a multi-release JAR and can report the wrong module set. The trade for Option B is that `--ignore-missing-deps` hides real problems as readily as spurious ones, so the resulting module list must be validated by actually running the application against the linked runtime — ideally the full test suite, not a smoke test.

### Container builds: where this pays off today

The dominant use of `jlink` in 2026 is a multi-stage image build. The JDK never reaches the final layer:

```dockerfile
FROM eclipse-temurin:25-jdk AS link
WORKDIR /build
COPY app.jar libs/ ./
RUN DEPS=$(jdeps --ignore-missing-deps --multi-release 25 \
             --print-module-deps --class-path 'libs/*' app.jar) && \
    jlink --add-modules "$DEPS" \
          --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
          --output /jre

FROM debian:trixie-slim
COPY --from=link /jre /opt/jre
COPY app.jar libs/ /opt/app/
ENTRYPOINT ["/opt/jre/bin/java", "-cp", "/opt/app/app.jar:/opt/app/libs/*", \
            "com.example.app.Main"]
```

Two further options are worth baking in here, since the image is rebuilt on every deploy anyway: `--generate-cds-archive` produces a class-data-sharing archive inside the image for faster startup, and `--add-options` freezes JVM flags into the launcher so nobody has to remember them (`--add-options` is a plugin option, so it shows up under `jlink --list-plugins` rather than in the main `--help` output):

```bash
jlink --add-modules "$DEPS" --generate-cds-archive \
      --add-options "-XX:+UseSerialGC -Xshare:auto" \
      --output /jre
```

### Cross-platform linking, and how JEP 493 changed it

`jlink` cannot compile for another platform the way a C cross-compiler can, but it can *assemble* an image for one, because the platform-specific binaries live in the target JDK's JMOD files. Unpack the target platform's JDK and put its `jmods` on the module path; `jlink` detects the target platform from those modules:

```bash
tar xzf jdk-25_linux-x64_bin.tar.gz -C /tmp/target
jlink --module-path /tmp/target/jdk-25/jmods:mods \
      --add-modules com.example.app \
      --output linux-x64-image
```

The host JDK's `jlink` and the target JDK must be the same feature release. And there is a real 2026 catch: **JEP 493 (JDK 24) lets a JDK be built without JMOD files at all**, with `jlink` reading module content out of the run-time image instead. That build is ~35% smaller as a download, and several distributions ship it — Eclipse Temurin enabled it from JDK 24 onward, so its default tarball has no `jmods` directory. Check which mode you have:

```bash
$ jlink --help | grep -i "run-time image"
Linking from run-time image enabled
```

When that line is present, plain single-platform linking works fine with no `--module-path` entry for the JDK, but cross-linking is impossible from that download alone: the executables and native libraries for the other platform simply are not there. The fix is to fetch the target platform's separate JMODs bundle (Adoptium publishes one via its API) and point `--module-path` at it. A JMOD-less `jlink` also cannot produce an image that itself contains `jlink`.

## Trade-offs

- **There is no upgrade mechanism for a linked image** — a runtime image is a frozen copy of the JDK it was linked from. When a CVE lands in `java.base`, patching means re-linking and redeploying the whole image, not updating a JDK package. That is a non-issue for a service rebuilt on every commit and a genuine liability for software installed on customer machines, where a security update now requires a full re-download.
- **Every module in the graph must be a real module** — automatic modules are rejected outright, so a modular application with one non-modular dependency cannot be linked without either patching that dependency or abandoning module-path deployment for it:

```bash
Error: automatic module cannot be used with jlink: jackson.databind from ...
```

- **Service providers are omitted unless you say otherwise** — resolution ignores `provides`, so the image links successfully and then fails at run time on a missing charset, driver, or locale:

```bash
jlink ... --suggest-providers          # audit first
jlink ... --bind-services              # or name providers explicitly as roots
```

- **The savings are real but bounded from below** — `java.base` alone is most of the floor, so a typical server application lands around 45–70 MB rather than anything dramatically smaller. Measure before building a pipeline around it:

```bash
$ jlink --add-modules java.base --strip-debug --no-man-pages \
        --no-header-files --compress=zip-6 --output floor
$ du -sh floor
44M     floor
```

- **`--ignore-missing-deps` trades a link-time error for a run-time one** — it is unavoidable on real classpaths full of optional dependencies, but it means the module list is a hypothesis, not a proof. Only running the application against the linked image validates it.
- **Cross-platform linking is now distribution-dependent** — the old "unpack the other OS's JDK, point at its `jmods`" recipe quietly stopped working on JMOD-less JDK 24+ builds, so a build script that worked for years can break on a JDK upgrade with a confusing module-not-found error rather than a clear diagnostic.
- **For desktop distribution, `jlink` is the layer underneath, not the tool you drive** — `jpackage` runs `jlink` for you and wraps the result in a platform-native installer (`msi`, `dmg`, `deb`, `rpm`), handling the non-modular case by placing JARs in an app directory. Calling `jlink` directly is worth it for containers and for precise control; for an end-user install, reaching for it first means reimplementing `jpackage`.

## Documentation Links

- [The jlink Command — Java SE 25 Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) — doc
- [The jdeps Command — Java SE 25 Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jdeps.html) — doc
- [JEP 282: jlink: The Java Linker](https://openjdk.org/jeps/282) — doc
- [JEP 493: Linking Run-Time Images without JMODs](https://openjdk.org/jeps/493) — doc
- [Creating Runtime and Application Images with jlink — dev.java](https://dev.java/learn/jlink/) — doc
