---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

The JDK has shipped a logging API since Java 1.4 — `java.util.logging` (JUL), with `Logger`, `Level`, `Handler`, and `Formatter` — yet almost no real-world Java code calls it directly. Libraries can't know which logging framework the *application* using them wants, so the ecosystem settled on a two-layer split: **SLF4J** (Simple Logging Facade for Java) is the API your code and every library call, and a separate **binding** decides at runtime which backend actually writes the line — usually **Logback**, sometimes **Log4j 2**, occasionally JUL itself. Get the facade/backend split wrong and you get either silence (no binding present) or the infamous "multiple bindings" warning (more than one present); get it right and you can swap Logback for Log4j 2 in a dependency change, with zero code changes anywhere in the call graph.

## Use Cases

- Any service or library code: call `LoggerFactory.getLogger(YourClass.class)` and log through SLF4J, never through a concrete backend's API directly, so callers of your library aren't forced onto your logging choice.
- Structured, correlatable logs in a multi-request or multi-tenant service — request IDs, user IDs, trace IDs attached to every line for a given request without threading a parameter through every method.
- Spring Boot applications, where SLF4J + Logback is the default stack (`spring-boot-starter-logging`) and most of the work is *configuring* it, not calling it.
- Migrating an old codebase off `java.util.logging` or Log4j 1.x without touching call sites, by swapping the binding underneath SLF4J.
- Diagnosing why a library's log output never appears, or why it appears twice — almost always a classpath/binding problem, not a code problem.
- Auditing a dependency tree for the Log4j 2 JNDI vulnerability class (Log4Shell) and understanding why "just use SLF4J" doesn't automatically make you safe.

## Deep Dive

### The facade: SLF4J

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public void place(Order order) {
        log.info("Placing order {} for customer {}", order.id(), order.customerId());
        try {
            // ...
        } catch (PaymentException e) {
            log.error("Payment failed for order {}", order.id(), e);
        }
    }
}
```

Two details that matter more than they look:

- **`{}` placeholders, not string concatenation.** `log.info("Placing order {} for customer {}", id, custId)` only builds the final string if the `INFO` level is actually enabled. `log.info("Placing order " + id + "...")` builds the string every time, whether or not anything logs it — a real cost in a hot path at a disabled level.
- **The last argument, when it's a `Throwable`, becomes the stack trace**, not a `{}` substitution. `log.error("Payment failed for order {}", order.id(), e)` logs the message with `order.id()` filled in *and* prints `e`'s full stack trace beneath it — one call, both pieces.

Levels are `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` — no `FATAL` (SLF4J deliberately left it out; a logging call was never going to be what terminates the JVM).

### The binding: how SLF4J finds an implementation

SLF4J 2.x resolves its backend via `ServiceLoader`, not classpath scanning for magic class names. Add exactly one binding artifact and it's found automatically:

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>slf4j-api</artifactId>
  <version>2.0.17</version>
</dependency>
<dependency>
  <groupId>ch.qos.logback</groupId>
  <artifactId>logback-classic</artifactId>
  <version>1.5.18</version>
</dependency>
```

`logback-classic` *is* an SLF4J provider — Logback was written by SLF4J's own author as the reference implementation, so no adapter layer sits between them. Log4j 2 needs one: `log4j-slf4j2-impl` bridges SLF4J calls into Log4j 2's engine.

Two or more bindings on the classpath produce SLF4J's own diagnostic at startup, listing every one found — a real, common failure mode in projects with several transitive dependencies each pulling in their own logging stack, and the fix is always to exclude all but one.

### Bridging legacy logging into SLF4J

A dependency written against `java.util.logging`, Log4j 1.x, or Apache Commons Logging doesn't call SLF4J — it calls its own API, and by default that output lands somewhere else entirely (or nowhere). SLF4J ships bridge modules that intercept those calls and redirect them:

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>jul-to-slf4j</artifactId>
</dependency>
```

```java
// once, at application startup
java.util.logging.LogManager.getLogManager().reset();
org.slf4j.bridge.SLF4JBridgeHandler.install();
```

After this, a call into `java.util.logging.Logger` is routed through SLF4J and out through whatever binding you actually configured — so a single Logback config controls every log line in the process, regardless of which API a given library was written against.

### Configuring the backend: Logback

Logback reads `logback.xml` from the classpath. A minimal, real config:

```xml
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
    </encoder>
  </appender>

  <logger name="com.example.app" level="DEBUG"/>

  <root level="INFO">
    <appender-ref ref="STDOUT"/>
  </root>
</configuration>
```

`root` is the fallback level and appender set for every logger; a named `<logger>` overrides it for that package/class prefix — so third-party libraries can stay at `INFO` while your own code runs at `DEBUG`, in the same process, without a code change.

### Structured context: MDC

The Mapped Diagnostic Context attaches key/value pairs to every log line emitted on the current thread, without passing them as a parameter through every method call — the standard way to get a request ID or trace ID onto every line of a request's logs:

```java
import org.slf4j.MDC;

public void handle(HttpServletRequest req) {
    MDC.put("requestId", req.getHeader("X-Request-Id"));
    try {
        log.info("Handling request");     // requestId is available to the pattern below
        // ... business logic, more log.info/warn/error calls ...
    } finally {
        MDC.clear();                       // mandatory: thread-local, and threads get reused
    }
}
```

```xml
<pattern>%d{HH:mm:ss.SSS} [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
```

The `finally { MDC.clear(); }` is not optional cleanup — MDC is thread-local, and in a pooled executor a thread that skips the clear will attach the *previous* request's ID to the *next* request's logs.

### The JDK's own answer: java.util.logging

JUL is still there, requires no dependency, and is configured via a `logging.properties` file (or `-Djava.util.logging.config.file=...`) rather than XML:

```java
import java.util.logging.Logger;

Logger logger = Logger.getLogger(OrderService.class.getName());
logger.info("Placing order " + order.id());   // no {} placeholders — build the string yourself
```

Its levels don't match SLF4J's names (`SEVERE`, `WARNING`, `INFO`, `CONFIG`, `FINE`, `FINER`, `FINEST`), it has no MDC equivalent, and its default `ConsoleHandler` format is verbose and hard to reconfigure compared to a one-line Logback pattern. It survives mainly as the thing frameworks bridge *from* (via `jul-to-slf4j`), and as a zero-dependency option for small tools where pulling in SLF4J + Logback is genuinely more than the job needs.

### Log4Shell: why this matters beyond style

CVE-2021-44228 ("Log4Shell") was a remote-code-execution vulnerability in Log4j 2's JNDI lookup feature: a crafted string reaching `logger.error(userInput)` could make the JVM fetch and execute attacker-controlled code, with no exploit beyond getting that string into a log line. Log4j 2.15.0 mitigated it; the fix was incomplete (CVE-2021-45046), and 2.16.0 removed the JNDI lookup mechanism entirely. The lesson that outlasted the incident: log messages are still an unstructured Java string being fed a wide variety of untrusted input (headers, usernames, URLs), so **which backend and which version** is a real security-relevant decision, not an implementation detail hidden behind SLF4J's facade.

## Trade-offs

- **The facade doesn't make the backend irrelevant.** SLF4J insulates your *call sites* from a backend swap, but the backend's own bugs, performance characteristics, and CVEs are still yours to track — Log4Shell lived entirely in Log4j 2's implementation, not in any code that called SLF4J.
- **Placeholders only pay off if you use them consistently.** One `log.debug("x=" + expensive())` in a hot, usually-disabled path re-introduces the cost `{}` placeholders exist to avoid — the guard has to be habitual, not applied only where it's convenient.
- **MDC is thread-local, which is exactly the problem in async/reactive code.** A value set with `MDC.put` on the request thread is invisible on a different thread continuing the same logical request (an executor callback, a reactive `Mono` operator) unless it's explicitly propagated — Logback and Reactor both have mechanisms for this, but neither is automatic.
- **`java.util.logging` costs nothing to start with and nothing to maintain expertise in**, at the price of a real ergonomics gap (`FINE`/`FINER`/`FINEST`, string-concatenation logging, no MDC) once a project grows past a handful of classes — most teams migrate to SLF4J + Logback specifically to close that gap, not for a feature JUL lacks in principle.
- **Multiple bindings is a build problem, not a code problem**, and it gets easier to hit, not harder, as a dependency tree grows — a transitive dependency pulling in `slf4j-simple` alongside your own `logback-classic` produces the exact same startup warning as choosing two backends yourself.

## Documentation Links

- [SLF4J user manual](https://www.slf4j.org/manual.html) — doc
- [SLF4J error codes (multiple bindings, no providers, etc.)](https://www.slf4j.org/codes.html) — doc
- [Logback manual — configuration](https://logback.qos.ch/manual/configuration.html) — doc
- [Logback manual — Mapped Diagnostic Context (MDC)](https://logback.qos.ch/manual/mdc.html) — doc
- [java.util.logging.Logger — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.logging/java/util/logging/Logger.html) — doc
- [CVE-2021-44228 (Log4Shell) — NVD](https://nvd.nist.gov/vuln/detail/CVE-2021-44228) — doc
- [Logging — Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/reference/features/logging.html) — doc
