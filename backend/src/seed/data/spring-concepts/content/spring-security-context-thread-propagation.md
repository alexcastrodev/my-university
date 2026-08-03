---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

Once `AuthenticationManager` finishes authenticating a request, that result has to
live somewhere the rest of the request — controllers, services, anything downstream
— can read it back. Spring Security calls that place the *security context*, and
`SecurityContextHolder` is the object responsible for storing and handing it back.
The interesting part isn't the storage itself, it's *which thread* can see it:
the default behavior isolates each request's context to its own thread, which is
exactly right for a normal request/response cycle and exactly wrong the moment a
task is handed off to another thread (`@Async`, a manual `ExecutorService`, a
scheduled job).

## Use Cases

- Reading the currently authenticated user's name/authorities from any component
  reached during a request, without threading the `Authentication` object through
  every method call as a parameter.
- Making an `@Async` method see the same `Authentication` as the request that
  triggered it, instead of hitting a `NullPointerException` on a `null`
  `Authentication`.
- Running background/self-managed threads (a manually created `ExecutorService`,
  a thread pool your own code owns) that still need to know who the original
  caller was.
- Deciding, for a standalone (non-web) application, whether every thread should
  share one global security context instead of per-thread isolation.

## Deep Dive

### The `SecurityContext` contract and its default home: `MODE_THREADLOCAL`

```java
public interface SecurityContext extends Serializable {

    Authentication getAuthentication();
    void setAuthentication(Authentication authentication);
}
```

`SecurityContextHolder` manages instances of this contract via one of three
strategies. The default, `MODE_THREADLOCAL`, backs it with the JDK's own
`ThreadLocal`: each thread sees only its own security context, so in a normal
thread-per-request servlet application, each request's authenticated identity
stays isolated from every other concurrent request automatically, with zero
configuration:

```java
@GetMapping("/hello")
public String hello() {
    SecurityContext context = SecurityContextHolder.getContext();
    Authentication a = context.getAuthentication();
    return "Hello, " + a.getName() + "!";
}
```

Spring can also inject the `Authentication` directly as a method parameter,
skipping the explicit `SecurityContextHolder.getContext()` call entirely:

```java
@GetMapping("/hello")
public String hello(Authentication a) {
    return "Hello, " + a.getName() + "!";
}
```

### Where `MODE_THREADLOCAL` breaks: a new thread has an empty context

`ThreadLocal` isolation is a feature for concurrent requests and a problem the
moment one request spawns a second thread. An `@Async` method runs on a thread the
web container didn't create for this request, so it starts with its own, empty
security context:

```java
@GetMapping("/bye")
@Async
public void goodbye() {
    SecurityContext context = SecurityContextHolder.getContext();
    String username = context.getAuthentication().getName();
    // throws NullPointerException — the async thread's context is empty
}
```

### Fixing `@Async`: `MODE_INHERITABLETHREADLOCAL`

Switching strategy tells Spring Security to copy the context from the parent
thread to any new thread *the framework itself creates* (an `@Async` method,
concretely):

```java
@Configuration
@EnableAsync
public class ProjectConfig {

    @Bean
    public InitializingBean initializingBean() {
        return () -> SecurityContextHolder.setStrategyName(
            SecurityContextHolder.MODE_INHERITABLETHREADLOCAL);
    }
}
```

With this strategy active, the same `@Async` method above sees a populated
`Authentication` instead of `null`. The strategy only helps when Spring Security
itself is the one creating the new thread — it does nothing for threads your own
code spins up, which is a separate problem covered below.

### `MODE_GLOBAL`: one context for every thread (standalone apps only)

A third strategy makes every thread in the application share the exact same
security context instance:

```java
@Bean
public InitializingBean initializingBean() {
    return () -> SecurityContextHolder.setStrategyName(
        SecurityContextHolder.MODE_GLOBAL);
}
```

This fits a standalone (non-web) application where there's no meaningful notion of
"one request, one identity" to isolate in the first place. It's a poor fit for a
backend web server: every concurrent request would see and could mutate the same
shared, non-thread-safe `SecurityContext`, which is a race condition waiting to
happen rather than a convenience.

### Self-managed threads: `DelegatingSecurityContextCallable`/`Runnable`

Neither `MODE_INHERITABLETHREADLOCAL` nor `MODE_GLOBAL` helps when the *application's
own code* creates a thread the framework doesn't know about — a manually built
`ExecutorService`, for instance:

```java
@GetMapping("/ciao")
public String ciao() throws Exception {
    Callable<String> task = () -> {
        SecurityContext context = SecurityContextHolder.getContext();
        return context.getAuthentication().getName();
    };

    ExecutorService e = Executors.newCachedThreadPool();
    try {
        return "Ciao, " + e.submit(task).get() + "!";
    } finally {
        e.shutdown();
    }
}
```

As written, this throws a `NullPointerException` — the pool's thread was never
told about the request's context. Wrapping the task in
`DelegatingSecurityContextCallable` (or `DelegatingSecurityContextRunnable` for a
no-return-value task) copies the calling thread's security context onto the task
itself, so it travels with the task regardless of which thread finally runs it:

```java
ExecutorService e = Executors.newCachedThreadPool();
try {
    var contextTask = new DelegatingSecurityContextCallable<>(task);
    return "Ciao, " + e.submit(contextTask).get() + "!";
} finally {
    e.shutdown();
}
```

### Propagating from the pool instead of the task: `DelegatingSecurityContextExecutorService`

The alternative to decorating every individual task is to decorate the executor
itself once — the task stays a plain `Callable`, and the wrapped executor takes
care of context propagation for every task it runs:

```java
ExecutorService e = Executors.newCachedThreadPool();
e = new DelegatingSecurityContextExecutorService(e);
try {
    return "Hola, " + e.submit(task).get() + "!";
} finally {
    e.shutdown();
}
```

Spring Security ships the same idea at different levels of the `Executor`
hierarchy: `DelegatingSecurityContextExecutor` (wraps the plain `Executor`
interface), `DelegatingSecurityContextExecutorService` (wraps `ExecutorService`),
and `DelegatingSecurityContextScheduledExecutorService` (wraps
`ScheduledExecutorService`, for scheduled tasks) — pick the one matching the
executor type already in use rather than decorating each submitted task by hand.

## Trade-offs

- **`MODE_THREADLOCAL`'s per-thread isolation is exactly what a web server wants,
  and exactly what breaks the moment a second thread enters the picture.** It
  needs no configuration for the common case, but any hand-off to another thread
  — `@Async`, a manual pool, a scheduled job — starts from an empty context unless
  one of the other mechanisms in this concept is used.
- **`MODE_INHERITABLETHREADLOCAL` only covers threads Spring Security itself
  creates.** It solves `@Async` cleanly, but silently does nothing for a thread
  your own code starts — that case needs the `DelegatingSecurityContext*` decorators
  instead, and reaching for the wrong tool produces the same `NullPointerException`
  either way.
- **`MODE_GLOBAL` trades per-request isolation for shared, mutable state.** Every
  thread reading and writing the same `SecurityContext` instance is appropriate
  for a standalone application with no concurrent, independent requests to keep
  separate — in a web server, the same property becomes a race condition, since
  `SecurityContext` itself is documented as not thread-safe.
- **Decorating the task vs. decorating the executor is a "where do you want the
  responsibility to live" choice, not a correctness difference.**
  `DelegatingSecurityContextCallable` couples propagation to each call site;
  `DelegatingSecurityContextExecutorService` centralizes it once, at the pool —
  the latter scales better when many call sites submit to the same pool, since
  none of them need to remember to wrap their task.
- **Book vs. today: setting the strategy via `SecurityContextHolder.setStrategyName()`
  is still valid but is no longer the primary recommended customization path.**
  Since Spring Security 5.8, the reference documentation recommends publishing a
  `SecurityContextHolderStrategy` bean in the application context instead of
  relying on `SecurityContextHolder`'s static, classloader-wide strategy — the
  docs note static access "can create race conditions when there are multiple
  application contexts that want to specify the `SecurityContextHolderStrategy`,"
  since `SecurityContextHolder` holds one strategy per classloader rather than per
  application context. Components can now autowire a `SecurityContextHolderStrategy`
  and call instance methods (`createEmptyContext()`, `setContext()`) on it instead
  of the static `SecurityContextHolder.getContext()`/`setContext()` calls the book
  uses throughout this section — confirmed via the current Spring Security
  reference. This is a "newer recommended path added since," not a removal: every
  `MODE_*` constant and the static API the book demonstrates still works exactly
  as described.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 5, "Implementing authentication", section 5.2, p. 113-124 — doc
- [Spring Security Reference — Servlet Authentication Architecture (SecurityContextHolder)](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html) — doc
- [Spring Security Reference — Authentication Persistence and Session Management (SecurityContextHolderStrategy)](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html) — doc
- [Spring Security API — SecurityContextHolderStrategy](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/core/context/SecurityContextHolderStrategy.html) — doc
