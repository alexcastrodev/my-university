---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Endpoint-level authorization answers "may this HTTP request proceed?" — but a
Spring bean method can be reached from many places that aren't an HTTP request:
a scheduled job, a message listener, another service, a repository call. Method
security moves the authorization decision onto the *method call itself*. Spring
Security registers an AOP interceptor around annotated methods and evaluates a
SpEL rule either before the call (**preauthorization** — the method never runs)
or after it (**postauthorization** — the method runs, but the caller may not
receive the result). The authority/role model is unchanged; only the place where
the rule is attached moves, from a filter-chain DSL to an annotation sitting next
to the code it protects.

## Use Cases

- Enforcing a permission on a service or repository method that is called from
  more than one entry point, so the rule can't live on a single controller
  mapping — the check travels with the method, not with the URL.
- Expressing a rule that depends on a **method argument** rather than on the
  request: `findSecretNames(name)` may only be called when `name` equals the
  authenticated user's own username.
- Expressing a rule that can only be decided **after** the data is loaded —
  "return this employee record only if the loaded record carries the `reader`
  role" — where the deciding fact isn't known until the method returns.
- Object-level ("does *this* user own *that* document") authorization that is
  too complex for a one-line expression, delegated to a `PermissionEvaluator`
  or a custom `AuthorizationManager` in its own class.
- Protecting non-web entry points entirely — a `@Scheduled` task or a message
  handler has no `HttpServletRequest`, so an `authorizeHttpRequests` rule can
  never apply to it.

## Deep Dive

### Call authorization is an aspect, not a filter

Request-level authorization runs inside the servlet filter chain. Method
security instead enables a **Spring AOP aspect**: the caller's reference to the
bean is a proxy, and the interceptor sits between caller and target.

```
DocumentController ──▶ [ security interceptor ] ──▶ DocumentService
                            │
                            └── rule fails → AccessDeniedException, target never called
```

Two things follow directly from that mechanism. First, the rule applies to
*every* caller of the bean, web or not. Second — the classic AOP caveat — a
self-invocation inside the same class bypasses the proxy entirely, so an
internal `this.getDocument(code)` call is **not** intercepted.

The book splits method security into two families: **call authorization**
(this concept — allow or reject the call, or reject its result) and
**filtering** (`@PreFilter`/`@PostFilter`, which let the call through but prune
collections in and out). Filtering is covered separately in
`spring-security-method-security-filtering-and-spring-data`.

### Enabling it, and what "enabled" means

Method security is off by default — Spring Boot's security starter does not
activate it. One annotation on a configuration class turns it on:

```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {
}
```

That single annotation enables `@PreAuthorize`, `@PostAuthorize`, `@PreFilter`
and `@PostFilter` (its `prePostEnabled` attribute defaults to `true`). The two
legacy alternatives stay opt-in: `securedEnabled = true` for Spring's own
`@Secured`, `jsr250Enabled = true` for JSR-250's `@RolesAllowed` /
`@PermitAll` / `@DenyAll`. Both are strictly less expressive than the pre/post
annotations — they take role names, not expressions — and are rarely worth
choosing for new code.

### `@PreAuthorize`: authorities, roles, and method arguments

The simplest form reuses the exact same expression vocabulary as request-level
authorization — `hasAuthority`, `hasAnyAuthority`, `hasRole`, `hasAnyRole`,
`hasAllAuthorities`, `hasAllRoles`, `permitAll`, `denyAll`, including the
`ROLE_` prefix asymmetry documented in
`spring-security-authorization-authorities-and-roles`:

```java
@Service
public class NameService {

    @PreAuthorize("hasAuthority('write')")
    public String getName() {
        return "Fantastico";
    }
}
```

A user holding `write` gets the value; a user holding only `read` gets a `403`
and `getName()` is never entered.

What method security adds over the request-level DSL is access to the
**invocation itself**. A `#name` reference in the expression resolves to the
method parameter of that name, and `authentication` resolves to the current
`Authentication`:

```java
@Service
public class NameService {

    private final Map<String, List<String>> secretNames = Map.of(
        "natalie", List.of("Energico", "Perfecto"),
        "emma", List.of("Fantastico"));

    @PreAuthorize("#name == authentication.principal.username")
    public List<String> getSecretNames(String name) {
        return secretNames.get(name);
    }
}
```

Emma can read `/secret/names/emma` but gets `403` on
`/secret/names/natalie` — a rule that no authority check can express, because
it compares an argument against the principal rather than testing a static
permission.

One modern prerequisite for `#name` to resolve at all: parameter names must
survive compilation. Spring Framework 6.1 removed
`LocalVariableTableParameterNameDiscoverer`, so the code must either be
compiled with `-parameters` or annotate the parameter explicitly with
Spring Security's `@P` (or Spring Data's `@Param`):

```java
@PreAuthorize("hasPermission(#c, 'write')")
public void updateContact(@P("c") Contact contact);
```

### `@PostAuthorize`: rules over `returnObject`

Sometimes the fact the decision hinges on doesn't exist until the method has
run — you can't know an employee record carries the `reader` role before
loading it. `@PostAuthorize` runs the method, then evaluates its expression
against the special `returnObject` variable:

```java
@Service
public class BookService {

    @PostAuthorize("returnObject.roles.contains('reader')")
    public Employee getBookDetails(String name) {
        return records.get(name);
    }
}
```

If the expression is false, the interceptor discards the result and throws
instead of returning it. The current reference documents the same idiom for the
ownership case: `@PostAuthorize("returnObject.owner == authentication.name")`.

Both annotations may sit on the same method when a call needs a pre-check *and*
a result-check.

The sharp edge is that "the method already ran" is literally true. Anything the
method mutated stays mutated. The book notes that even `@Transactional` does not
save you — the postauthorization exception is thrown *after* the transaction
manager commits, so there is nothing left to roll back. The current reference
states the same rule as advice: `@PostAuthorize` is not recommended on classes
that perform database writes; read first with `@PostAuthorize` on the read, then
write only if that read was authorized.

### Beyond one-line SpEL: `hasPermission()` and `PermissionEvaluator`

Long SpEL strings are unreadable and untestable. When the rule needs real logic
— "an admin, *or* the owner of this document" — `hasPermission()` hands off to a
`PermissionEvaluator` bean:

```java
public interface PermissionEvaluator {

    boolean hasPermission(Authentication a, Object subject, Object permission);

    boolean hasPermission(Authentication a, Serializable id, String type, Object permission);
}
```

Two shapes, matching two moments. The **object** form suits `@PostAuthorize`,
where the subject is the loaded result:

```java
@PostAuthorize("hasPermission(returnObject, 'ROLE_admin')")
public Document getDocument(String code) {
    return documentRepository.findDocument(code);
}
```

```java
@Component
public class DocumentsPermissionEvaluator implements PermissionEvaluator {

    @Override
    public boolean hasPermission(Authentication authentication,
                                 Object target, Object permission) {
        Document document = (Document) target;
        String requiredRole = (String) permission;

        boolean admin = authentication.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals(requiredRole));

        return admin || document.getOwner().equals(authentication.getName());
    }

    @Override
    public boolean hasPermission(Authentication authentication, Serializable targetId,
                                 String targetType, Object permission) {
        return false;
    }
}
```

The **id + type** form suits `@PreAuthorize`, where the object doesn't exist yet
and only its identifier is in hand — the evaluator loads it itself:

```java
@PreAuthorize("hasPermission(#code, 'document', 'ROLE_admin')")
public Document getDocument(String code) {
    return documentRepository.findDocument(code);
}
```

Note what is *not* in the expression: the `Authentication`. Spring Security
supplies it from the `SecurityContext` when it calls the evaluator; the
expression only passes the subject and the permission token.

Registering the evaluator is the one place where the modern configuration
genuinely differs from the book, and it is easy to get wrong — see below.

### Book vs. today: `@EnableGlobalMethodSecurity` → `@EnableMethodSecurity`

The book enables method security with:

```java
@Configuration
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class ProjectConfig {
}
```

`@EnableGlobalMethodSecurity` is **deprecated**; the current reference says it
is superseded by `@EnableMethodSecurity` (introduced in 5.6) and that users are
encouraged to migrate. The differences the docs actually call out:

- **Pre/post annotations are on by default.** `@EnableMethodSecurity` alone is
  equivalent to `@EnableGlobalMethodSecurity(prePostEnabled = true)`, and it
  enables `@PreFilter`/`@PostFilter` too. Conversely, if you only wanted
  `@Secured`, the old `@EnableGlobalMethodSecurity(securedEnabled = true)`
  becomes `@EnableMethodSecurity(securedEnabled = true, prePostEnabled = false)`
  — the old implicit "off" is now an explicit opt-out.
- **`AuthorizationManager` replaces the voter/decision-manager stack.** Each
  annotation now has its own dedicated interceptor
  (`AuthorizationManagerBeforeMethodInterceptor#preAuthorize` with
  `PreAuthorizeAuthorizationManager`, `AuthorizationManagerAfterMethodInterceptor#postAuthorize`
  with `PostAuthorizeAuthorizationManager`) built on native Spring AOP, instead
  of metadata sources, config attributes, decision managers and voters. It also
  checks for conflicting annotations and complies fully with JSR-250.
- **The `Authentication` lookup is deferred.** The expression handler now takes
  a `Supplier<Authentication>`, so the lookup happens only if the expression
  needs it — applied automatically under `@EnableMethodSecurity`.
- **A custom `PermissionEvaluator` bean is no longer auto-detected.** This is
  the trap for anyone porting section 16.4 verbatim. The book extends
  `GlobalMethodSecurityConfiguration` and overrides
  `createExpressionHandler()`. The migration guide is explicit that
  `@EnableMethodSecurity` *does not pick up* a `PermissionEvaluator`, to keep
  its API simple — you must publish a `MethodSecurityExpressionHandler` bean
  that wires it in, and it must be `static` so it initializes early enough:
  ```java
  @Bean
  static MethodSecurityExpressionHandler methodSecurityExpressionHandler(
          DocumentsPermissionEvaluator evaluator) {
      var handler = new DefaultMethodSecurityExpressionHandler();
      handler.setPermissionEvaluator(evaluator);
      return handler;
  }
  ```
  Silently, a missing registration leaves the default `DenyAllPermissionEvaluator`
  in place — every `hasPermission()` returns false.
- **Subclassing hook moved.** Code that extended
  `DefaultMethodSecurityExpressionHandler` and overrode
  `createSecurityExpressionRoot(Authentication, MethodInvocation)` no longer
  works; the new arrangement calls
  `createEvaluationContext(Supplier<Authentication>, MethodInvocation)`.

What did **not** change: the SpEL itself. `hasAuthority`, `hasRole`,
`#parameterName`, `authentication`, `returnObject` and `hasPermission` all read
exactly as in the book, and `PermissionEvaluator` is still the documented hook
for object-level authorization — it was not replaced. What was *added* is a more
general extension point: you can publish your own
`AuthorizationManager<MethodInvocation>` behind a custom pointcut when even a
`PermissionEvaluator` is the wrong shape, and `@HandleAuthorizationDenied` with
a `MethodAuthorizationDeniedHandler` lets a denial return a masked or `null`
value instead of throwing — useful when the denied field is part of a JSON
response.

## Trade-offs

- **The rule lives next to the code it protects — that is both the selling
  point and the cost.** An annotation on the service method is impossible to
  miss when reading that method, and it covers every caller. But the
  application's authorization policy is now scattered across the codebase
  instead of readable in one configuration class, and the current reference
  frames exactly this as the core trade-off: request-level is coarse-grained
  and centralized in a DSL, method-level is fine-grained and local, in
  annotations and SpEL.
- **Unannotated methods are simply not secured.** Method security has no
  `anyRequest()` equivalent — there is no catch-all. The docs are explicit that
  you should still declare a catch-all rule in `HttpSecurity` so a forgotten
  annotation isn't an open door. Method security complements request-level
  authorization; it does not replace it.
- **It is AOP, so it inherits AOP's blind spot.** A call from inside the same
  bean doesn't go through the proxy and isn't checked. This surprises people far
  more often at the method level than at the filter level, because the code
  *looks* protected.
- **`@PostAuthorize` protects the result, never the side effects.** The method
  has already run and, with `@Transactional`, already committed by the time the
  check fails — the book flags this and the current docs turn it into a
  recommendation not to combine `@PostAuthorize` with database writes. Prefer
  `@PreAuthorize` whenever the deciding fact is available before the call; reach
  for `@PostAuthorize` only when it genuinely isn't.
- **SpEL is powerful and unchecked.** `#name == authentication.principal.username`
  compiles to nothing — a renamed parameter, or a build without `-parameters`,
  breaks the rule at runtime rather than at compile time. `@P("name")` pins the
  name explicitly and is worth the noise on anything security-critical.
- **Push non-trivial logic out of the expression, but pick the right hook.**
  `PermissionEvaluator` is the well-trodden path for "this user vs. that
  object" and is still current; a custom `AuthorizationManager` is the more
  general (and more modern) escape hatch. Either way, logic in a class is
  unit-testable — a three-clause SpEL string is not.
- **`@Secured` and `@RolesAllowed` exist, and are almost never the right
  choice.** They accept role names only: no arguments, no `returnObject`, no
  expressions. The book's own verdict is that you're unlikely to meet them in
  real-world code; their main use today is interoperability with existing
  JSR-250 annotations.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 16, "Global method security: Pre- and postauthorizations", sections 16.1-16.4, p. 388-412 — doc
- [Spring Security Reference — Method Security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — doc
- [Spring Security API — EnableMethodSecurity](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/config/annotation/method/configuration/EnableMethodSecurity.html) — doc
- [Spring Security API — EnableGlobalMethodSecurity (deprecated)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/config/annotation/method/configuration/EnableGlobalMethodSecurity.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security 6.5 Migration Guide — Compile With -parameters](https://docs.spring.io/spring-security/reference/6.5/migration/servlet/authorization.html) — doc
