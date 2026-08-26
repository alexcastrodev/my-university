---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

GraalVM is two different things wearing one name: a **JDK distribution** whose just-in-time compiler is the Graal compiler instead of HotSpot's C2, and **`native-image`**, an ahead-of-time (AOT) compiler that turns a Java application into a single self-contained native executable with no JVM to launch. The second one is why most teams install it. `native-image` buys near-instant startup and a much smaller memory footprint by doing the work at build time — but it can only do that by assuming a **closed world**: every class, method, resource and proxy that the program will ever touch has to be known when the binary is built, so reflection, dynamic proxies, JNI and resource loading need explicit metadata or they fail at run time.

## Use Cases

- Serverless / FaaS functions (AWS Lambda, Cloud Run, Azure Functions) where cold-start latency is billed and user-visible, and a 2-second JVM boot is unacceptable.
- Kubernetes services that scale to zero or scale out fast: a native pod is ready in milliseconds and holds a fraction of the RSS, so more replicas fit per node.
- Command-line tools written in Java that must feel like a shell command — no `java -jar`, no warm-up, no JRE for the user to install.
- Small container images: a statically linked native binary on a distroless or `scratch` base drops tens of megabytes of JDK from the image.
- Framework-supported native builds that make this practical on real apps: Spring Boot's AOT processing, Quarkus (designed native-image-first), Micronaut, Helidon SE.
- Short-lived batch jobs and sidecars, where the JIT never runs long enough to reach peak performance anyway, so giving it up costs nothing.
- Polyglot embedding (GraalJS, GraalPy, Truffle languages) — a secondary use, and the direction Oracle has said GraalVM's Java-independent future is heading.

## Deep Dive

### GraalVM is a JDK, and `native-image` ships inside it

A GraalVM install behaves like any other JDK — `java`, `javac`, `jar`, `jshell` all work:

```
$ sdk install java 25.0.2-graal          # or download from graalvm.org/downloads
$ java -version
java version "25.0.2" 2026-01-20
Java(TM) SE Runtime Environment Oracle GraalVM 25.0.2+9.1 (build 25.0.2+9-LTS-jvmci-b01)
Java HotSpot(TM) 64-Bit Server VM Oracle GraalVM 25.0.2+9.1 (build 25.0.2+9-LTS-jvmci-b01, mixed mode, sharing)
```

Two details that older tutorials get wrong:

```
$ gu install native-image
zsh: command not found: gu
$ native-image --version           # already there, nothing to install
```

The `gu` (GraalVM Updater) step disappeared with GraalVM for JDK 21 — `native-image` and the language runtimes are bundled in the download now. Distribution also split in two: **Oracle GraalVM** under the GraalVM Free Terms and Conditions (free for production and redistribution, though CPU updates for older lines moved to the OTN license), and **GraalVM Community Edition** under GPLv2 with Classpath Exception on GitHub. Red Hat's **Mandrel** and BellSoft's **Liberica NIK** are downstream CE-based builds; Quarkus ships against Mandrel by default.

`native-image` needs a local C toolchain, because it links a real executable:

```
# Linux (Debian/Ubuntu)
$ sudo apt-get install build-essential zlib1g-dev
# macOS
$ xcode-select --install
# Windows
$ winget install --id Microsoft.VisualStudio.2022.BuildTools
```

### From `javac` to a native executable

```java
// Hello.java
import java.time.LocalDate;

public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello on " + LocalDate.now());
    }
}
```

```
$ javac Hello.java
$ native-image Hello -o hello
========================================================================
GraalVM Native Image: Generating 'hello' (executable)...
========================================================================
[1/8] Initializing...                                    (2.8s @ 0.15GB)
[2/8] Performing analysis...                             (5.1s @ 0.55GB)
[3/8] Building universe...                               (0.6s @ 0.60GB)
[4/8] Parsing methods...                                 (0.5s @ 0.63GB)
[5/8] Inlining methods...                                (0.4s @ 0.58GB)
[6/8] Compiling methods...                               (8.2s @ 0.72GB)
[7/8] Laying out methods...                              (0.6s @ 0.70GB)
[8/8] Creating image...                                  (0.9s @ 0.66GB)
Finished generating 'hello' in 21.3s.
```

The build is slow and loud; `--silent` quiets it. The payoff is at run time:

```
$ time java Hello
Hello on 2026-08-19
real    0m0.28s

$ time ./hello
Hello on 2026-08-19
real    0m0.006s
```

Roughly two orders of magnitude on startup for a trivial program, because there is no JVM bootstrap, no class loading and verification, and no interpreter warm-up — the binary contains only the reachable application classes, the reachable JDK classes, and a small runtime called Substrate VM (GC, thread scheduling, etc.). For a JAR or a module, point at those instead:

```
$ native-image -jar app.jar -o app
$ native-image --module com.example.app/com.example.app.Main -o app
```

### The closed-world assumption, and what breaks

Static analysis decides what goes into the binary. Anything the analysis cannot see is not there. This program runs fine on the JVM:

```java
import java.lang.reflect.Method;

public class Reflect {
    record Greeter() { public String greet() { return "hi"; } }

    public static void main(String[] args) throws Exception {
        Class<?> c = Class.forName(args[0]);          // name only known at run time
        Method m = c.getMethod("greet");
        System.out.println(m.invoke(c.getDeclaredConstructor().newInstance()));
    }
}
```

```
$ java Reflect 'Reflect$Greeter'
hi
```

Compiled with `native-image` and no metadata, `Reflect$Greeter` was never proven reachable, so it was dropped:

```
$ ./reflect 'Reflect$Greeter'
Exception in thread "main" org.graalvm.nativeimage.MissingReflectionRegistrationError:
  The program tried to reflectively access class Reflect$Greeter without it being
  registered for runtime reflection. Add Reflect$Greeter to the reflection metadata
  to solve this problem.
```

The same failure mode hits `Proxy.newProxyInstance` (proxy classes cannot be generated at run time), `getResourceAsStream` (resources are not embedded unless declared), Java serialization, JNI-accessed members, and any library that scans the classpath. Note the flip side: when the argument is a compile-time constant, the analysis *does* see it and registers it automatically —

```java
Class<?> ok = Class.forName("java.util.ArrayList");   // constant: auto-registered, works natively
```

— which is exactly why reflection "sometimes works" in native images and produces confusing bug reports.

### Reachability metadata

Metadata is JSON shipped inside the artifact at `META-INF/native-image/<groupId>/<artifactId>/reachability-metadata.json`, so a library can declare its own needs and every downstream native build picks them up:

```json
{
  "reflection": [
    {
      "condition": { "typeReached": "com.example.App" },
      "type": "com.example.Greeter",
      "allDeclaredConstructors": true,
      "methods": [
        { "name": "greet", "parameterTypes": [] }
      ]
    },
    { "type": { "proxy": ["com.example.Service", "java.io.Serializable"] } }
  ],
  "resources": [
    { "glob": "messages/*.properties" },
    { "bundle": "com.example.Messages" }
  ],
  "jni": [
    { "type": "com.example.NativeBridge", "fields": [ { "name": "handle" } ] }
  ]
}
```

`condition.typeReached` keeps the metadata (and the classes it drags in) out of the image unless that type is actually reached. This single-file format replaced the older split `reflect-config.json` / `proxy-config.json` / `resource-config.json` / `jni-config.json` / `serialization-config.json` files, which are still accepted for compatibility.

Writing it by hand is a losing game, so collect it by running the app on the JVM with the tracing agent:

```
$ java -agentlib:native-image-agent=config-output-dir=src/main/resources/META-INF/native-image \
       -cp target/classes com.example.App
```

The agent records every reflective call, resource lookup and proxy the run performed — which means the metadata is only as complete as your test coverage of that run. To find the holes before production does, build with exact checking or downgrade the failures to warnings:

```
$ native-image --exact-reachability-metadata -cp target/classes com.example.App
$ ./app -XX:MissingRegistrationReportingMode=Warn     # log every miss instead of throwing
```

Oracle also publishes a shared repository of metadata for popular libraries (`oracle/graalvm-reachability-metadata`), which the Gradle/Maven native build plugins consume automatically.

### Build flags that decide the outcome

```
$ native-image --no-fallback -jar app.jar -o app
```

`--no-fallback` is the important one: by default, if the analysis finds features it cannot handle, `native-image` may silently emit a *fallback image* — a launcher that requires a JVM, defeating the whole exercise. `--no-fallback` turns that into a build failure instead.

```
$ native-image -Ob -jar app.jar          # quick build mode: builds much faster, slower binary
$ native-image -O3 -jar app.jar          # highest optimization for production
$ native-image --gc=G1 -jar app.jar      # G1 instead of the default Serial GC (Oracle GraalVM)
$ native-image --enable-monitoring=jfr,jvmstat,heapdump -jar app.jar
$ native-image --static --libc=musl -jar app.jar   # fully static binary for scratch/distroless
```

Use `-Ob` on developer machines and CI feedback loops, `-O3` for the artifact you ship. Profile-guided optimization (`--pgo-instrument` then `--pgo`) recovers a good part of the JIT's peak-throughput advantage, but it is an Oracle GraalVM feature, not in Community Edition.

### Spring Boot: AOT processing bridges the gap

Spring's whole model — component scanning, `@Conditional` evaluation, cglib proxies, `@Value` binding — is runtime reflection, exactly what the closed world forbids. Spring Boot 3+ solves it by moving that work into the build as **Spring AOT processing**, which generates plain Java bean-registration code plus the GraalVM hint files:

```xml
<plugin>
  <groupId>org.graalvm.buildtools</groupId>
  <artifactId>native-maven-plugin</artifactId>
</plugin>
<plugin>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-maven-plugin</artifactId>
  <executions>
    <execution>
      <id>process-aot</id>
      <phase>process-classes</phase>
      <goals><goal>process-aot</goal></goals>
    </execution>
  </executions>
</plugin>
```

```
$ mvn -Pnative native:compile        # native executable in target/
$ mvn -Pnative spring-boot:build-image   # or a container image via Paketo buildpacks
$ ./gradlew nativeCompile
```

The `@Configuration`/`@Bean` pair you wrote becomes generated source under `target/spring-aot/main/sources`:

```java
public class MyConfiguration__BeanDefinitions {
    public static BeanDefinition getMyBeanBeanDefinition() {
        RootBeanDefinition beanDefinition = new RootBeanDefinition(MyBean.class);
        beanDefinition.setInstanceSupplier(BeanInstanceSupplier
                .<MyBean>forFactoryMethod(MyConfiguration.class, "myBean")
                .withGenerator(rb -> rb.getBeanFactory()
                        .getBean(MyConfiguration.class).myBean()));
        return beanDefinition;
    }
}
```

The consequence to internalize: **the bean graph is frozen at build time**. Profiles and `@ConditionalOnProperty` are evaluated during the AOT build, not on startup, so flipping a property in production cannot add a bean that was not compiled in. Your own reflection needs a `RuntimeHintsRegistrar`:

```java
public class MyHints implements RuntimeHintsRegistrar {
    @Override
    public void registerHints(RuntimeHints hints, ClassLoader cl) {
        hints.reflection().registerType(Greeter.class, MemberCategory.INVOKE_PUBLIC_METHODS);
        hints.resources().registerPattern("messages/*.properties");
    }
}
```

```java
@Configuration
@ImportRuntimeHints(MyHints.class)
class AppConfig {}
```

### Quarkus: native-image-first by design

Quarkus was built around the constraint rather than retrofitted to it. Its extensions do *build-time augmentation* — reading configuration, wiring CDI, and recording the resulting bytecode at build time — so there is little runtime reflection left for `native-image` to choke on:

```
$ ./mvnw install -Dnative
$ ./mvnw install -Dnative -Dquarkus.native.container-build=true   # build in a container
$ ./mvnw verify -Dnative                # runs @QuarkusIntegrationTest against the binary
$ quarkus build --native                # CLI equivalent
```

`quarkus.native.container-build=true` runs the build inside a Mandrel builder image, which also sidesteps the cross-compilation limitation below: it produces a Linux binary from a macOS or Windows workstation. The resulting executable reports startup in single-digit milliseconds:

```
$ ./target/getting-started-1.0.0-runner
INFO  [io.quarkus] getting-started 1.0.0 native (powered by Quarkus 3.x) started in 0.009s.
```

### The JDK's own answer: the AOT cache

Native image is not the only way to attack startup any more. Project Leyden landed an **AOT cache** in the standard JDK — JEP 483 in JDK 24, then JEP 514 (command-line ergonomics) and JEP 515 (AOT method profiling) in JDK 25. It records class loading, linking, and method profiles from a training run and replays them on later starts:

```
# JDK 24 two-step form
$ java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf -cp app.jar App
$ java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf -XX:AOTCache=app.aot -cp app.jar App

# JDK 25, one step (JEP 514)
$ java -XX:AOTCacheOutput=app.aot -cp app.jar App

# then use it
$ java -XX:AOTCache=app.aot -cp app.jar App
```

This is a different bargain: an ordinary JVM, so reflection, dynamic classloading, agents and full observability all still work, and the win is a fraction of native image's — tens of percent off startup, not two orders of magnitude, and no reduction in memory footprint or image size. When "startup is a bit slow" is the problem, reach for the AOT cache first; when "a container must be live in 10 ms and hold 40 MB" is the requirement, that is native image territory.

## Trade-offs

- **Startup and footprint vs. peak throughput** — the JIT profiles the running program and can out-optimize an AOT binary on a long-lived, hot server loop; a native image starts at its final speed but never gets faster. PGO narrows the gap:

```
$ native-image --pgo-instrument -jar app.jar -o app-inst   # Oracle GraalVM only
$ ./app-inst ...                                            # produces default.iprof
$ native-image --pgo=default.iprof -jar app.jar -o app
```

- **The closed world is a real constraint, not a tuning knob** — any library that reflects over names computed at run time needs metadata, and you discover the gap at run time rather than at build time:

```
$ ./app
org.graalvm.nativeimage.MissingReflectionRegistrationError: The program tried to
  reflectively access class com.example.Greeter without it being registered for
  runtime reflection.
```

- **Silent fallback images** — without `--no-fallback` a "successful" build can hand you a binary that still needs a JVM, so the deployment quietly loses every benefit you built it for:

```
$ native-image --no-fallback -jar app.jar     # fail the build instead of degrading
```

- **Build cost moves onto CI** — `native-image` takes minutes and gigabytes of RAM where `javac` takes seconds, and it runs per target platform. Budget for it, and keep `-Ob` for the inner loop:

```
$ native-image -Ob -jar app.jar    # quick build: much faster build, slower binary
```

- **One binary per OS and architecture** — there is no write-once-run-anywhere any more; a macOS build does not run on Linux, and `native-image` does not cross-compile, so Linux artifacts come from a Linux machine or a builder container:

```
$ ./mvnw install -Dnative -Dquarkus.native.container-build=true   # Linux binary from any host
```

- **Tests must run against the binary** — passing JVM unit tests prove nothing about the native artifact, since the failures are metadata failures that only exist after compilation. Native test runs (`mvn -PnativeTest test`, `./gradlew nativeTest`, `./mvnw verify -Dnative`) are the only way to catch them, and they are far slower than JVM tests.

- **Observability and tooling are reduced** — no dynamic attach, no `-javaagent`, and profilers, APM agents and bytecode-instrumenting libraries generally do not work. JFR, jvmstat and heap dumps are available, but only if you compiled them in with `--enable-monitoring`, which is a build-time decision you cannot revisit on a running production process.

- **Framework-shaped, not free-form** — build-time bean graphs mean configuration that used to be a runtime property flip becomes a rebuild; Spring evaluates profiles and `@ConditionalOnProperty` during AOT processing, so a native image cannot be reconfigured into a different application the way a JVM deployment can.

- **Editions and strategic direction** — the best throughput features (PGO, G1 in native images, advanced obfuscation) are Oracle GraalVM only, while Community Edition and its downstream builds (Mandrel, Liberica NIK) carry the rest. Oracle has also discontinued the optional Graal JIT it shipped in Oracle JDK 23/24, pointing those users at C2 and the JDK's AOT cache, and has said GraalVM's roadmap is decoupling from the Java release train to focus on the polyglot runtimes — worth factoring into a long-term bet, even though Native Image itself is actively developed.

## Documentation Links

- [Native Image — GraalVM Reference Manual](https://www.graalvm.org/latest/reference-manual/native-image/) — doc
- [Reachability Metadata — GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/metadata/) — doc
- [Collect Metadata with the Tracing Agent — GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/metadata/AutomaticMetadataCollection/) — doc
- [Graal JIT Compiler (Java on GraalVM) — GraalVM Reference Manual](https://www.graalvm.org/latest/reference-manual/java/) — doc
- [Download GraalVM — editions and licensing](https://www.graalvm.org/downloads/) — doc
- [Introducing GraalVM Native Images — Spring Boot Reference](https://docs.spring.io/spring-boot/reference/packaging/native-image/introducing-graalvm-native-images.html) — doc
- [Building a Native Executable — Quarkus Guides](https://quarkus.io/guides/building-native-image) — doc
- [JEP 514: Ahead-of-Time Command-Line Ergonomics](https://openjdk.org/jeps/514) — doc
