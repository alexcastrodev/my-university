---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

Chapter 7 applied one authorization rule to every request at once, via
`anyRequest()`. Real applications almost never want that — some endpoints need
one role, others need a different one, and plenty need no restriction at all.
Matcher methods are how an authorization configuration says *which* requests a
given rule applies to: by exact path, by a path pattern, by HTTP method, or by
some combination of all three.

## Use Cases

- Requiring a specific role only for a subset of endpoints (an admin path)
  while leaving the rest of the application under different, looser rules.
- Applying different rules to the same path depending on the HTTP method — a
  `GET` on `/a` open to anyone, a `POST` on the same path requiring
  authentication.
- Locking down an entire group of related endpoints sharing a common prefix
  (`/a/b/**`) in one rule instead of enumerating every path individually.
- Restricting a path-variable-driven endpoint to only the value shapes that
  make sense (digits only, for instance), rejecting anything else before it
  ever reaches the controller.

## Deep Dive

### `anyRequest()`: the rule that matches everything

Every example up to this chapter used `anyRequest()` without necessarily
naming it — it means exactly what it says, matching every request regardless
of path or HTTP method. It remains useful as the deliberate catch-all at the
*end* of a chain of more specific rules:

```java
http.authorizeRequests()
     .mvcMatchers("/hello").hasRole("ADMIN")
     .mvcMatchers("/ciao").hasRole("MANAGER")
     .anyRequest().permitAll();
```

Any endpoint not explicitly matched by an earlier, more specific rule — like a
newly added `/hola` — falls through to whatever `anyRequest()` says, here
`permitAll()`. The book calls this out as good practice specifically because it
makes the intent for "everything else" explicit and reviewable, rather than an
accident of what wasn't yet secured.

### Rule order: specific before general, always

Authorization rules are evaluated in the order they're declared, and Spring
Security enforces a hard constraint on that order: a more specific matcher can
never follow a more general one, because `anyRequest()` would already have
claimed every request by the time a later, narrower rule is reached:

```java
// correct: specific rules first, catch-all last
http.authorizeRequests()
     .mvcMatchers("/hello").hasRole("ADMIN")
     .mvcMatchers("/ciao").hasRole("MANAGER")
     .anyRequest().authenticated();
```

Reordering this so `anyRequest()` came first wouldn't just be redundant — it's
a configuration Spring Security actively rejects, since the later,
more-specific matchers could never actually apply once `anyRequest()` has
already matched.

### Unauthenticated vs. failed authentication: two different response codes

`permitAll()` on a path means Spring Security skips authorization entirely —
but authentication (verifying whoever supplied credentials) still runs first,
independently. Calling a `permitAll()` endpoint with no credentials at all
succeeds; calling the same endpoint with *wrong* credentials fails during
authentication and never reaches the authorization stage:

```
curl http://localhost:8080/hola                    → 200 OK, "Hola!"
curl -u bill:wrongpass http://localhost:8080/hola   → 401 Unauthorized
```

The distinction matters operationally: a `401` here means "the credentials you
supplied were rejected," not "you're not allowed to see this" — `permitAll()`
never gets the chance to run for a request that fails authentication first.

### MVC matchers: mvcMatchers(), with or without an HTTP method

`mvcMatchers()` selects requests using the same path-matching syntax Spring
MVC itself uses for `@GetMapping`/`@PostMapping`/etc. Two overloads exist —
one path-only, one that also pins a specific HTTP method:

```java
http.authorizeRequests()
     .mvcMatchers(HttpMethod.GET, "/a")
        .authenticated()
     .mvcMatchers(HttpMethod.POST, "/a")
        .permitAll()
     .anyRequest()
        .denyAll();
```

Here, `GET /a` requires authentication, `POST /a` is open to anyone, and every
other request to any other path is denied outright. Without the `HttpMethod`
argument, `mvcMatchers("/a")` applies the same rule regardless of which HTTP
method is used.

### Path expressions: `**`, `*`, and path-variable regex

A single prefix expression covers a whole family of paths without enumerating
each one:

```java
http.authorizeRequests()
     .mvcMatchers("/a/b/**")
        .authenticated()
     .anyRequest()
        .permitAll();
```

`/a/b/**` matches `/a/b`, `/a/b/c`, and any deeper path under that prefix — new
paths added later under `/a/b` automatically inherit the same rule without a
developer needing to remember to update the security configuration. `*`
matches exactly one path segment (`/a/*` matches `/a/b` but not `/a/b/c`);
`**` matches any number of segments, including zero. A path variable can carry
its own regex constraint, evaluated as part of the match:

```java
http.authorizeRequests()
     .mvcMatchers("/product/{code:^[0-9]*$}")
        .permitAll()
     .anyRequest()
        .denyAll();
```

Only a `code` value consisting entirely of digits satisfies the pattern —
`/product/12345` is permitted, `/product/1234a` is denied before the request
ever reaches `ProductController`.

## Trade-offs

- **Explicit `anyRequest()` catch-alls are a deliberate, reviewable choice —
  relying on an implicit default is not.** The book frames writing out
  `.anyRequest().permitAll()` (or `.authenticated()`, or `.denyAll()`) as good
  practice precisely because it forces a conscious decision about what happens
  to any endpoint not otherwise matched, rather than leaving it to whatever
  Spring Security's default turns out to be.
- **Rule order isn't just a style preference — Spring Security enforces
  specific-before-general as a hard rule.** A matcher chain that puts
  `anyRequest()` before a narrower matcher doesn't silently do the wrong
  thing; the framework rejects it, because a rule after `anyRequest()` could
  never be reached.
- **`permitAll()` only controls authorization, not authentication.** Supplying
  invalid credentials to a `permitAll()` endpoint still fails with `401`
  during authentication, before authorization is ever consulted — a detail
  easy to misread as `permitAll()` "not working" when it's actually working
  exactly as designed.
- **Book vs. today: the book's own reason for preferring MVC matchers over Ant
  matchers is now built into the unified API by default, not something a
  developer has to remember to choose.** The book (this section and the next)
  warns that `antMatchers("/hello")` doesn't automatically also secure
  `/hello/` the way `mvcMatchers("/hello")` does — because Spring MVC treats a
  trailing slash as the same controller action, but Ant's plain path matching
  doesn't know that — and recommends MVC matchers specifically to avoid this
  gap. Since Spring Security 5.8, `mvcMatchers()`/`antMatchers()`/
  `regexMatchers()` are all deprecated (removed in 6.0) in favor of a single
  `requestMatchers()` method, which automatically selects `MvcRequestMatcher`
  when Spring MVC is present on the classpath, or `AntPathRequestMatcher`
  otherwise — confirmed via the current Spring Security reference and 5.8
  migration guide. The book's own security concern is now the automatic
  default rather than a choice a developer has to remember to make correctly:
  ```java
  http.authorizeHttpRequests(authorize -> authorize
      .requestMatchers("/hello").hasRole("ADMIN")
      .requestMatchers("/ciao").hasRole("MANAGER")
      .anyRequest().permitAll()
  );
  ```
  The path-matching syntax itself (`**`, `*`, `{param:regex}`) and the
  `authorizeRequests()`→`authorizeHttpRequests()` DSL migration are otherwise
  unchanged from what's already documented in the sibling "Spring Security
  Authorization: Authorities and Roles" concept.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 8, "Configuring authorization: Applying restrictions", sections 8.1-8.2, p. 172-184 — doc
- [Spring Security Reference — Authorize HttpServletRequests (requestMatchers)](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security API — RequestMatcher](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/web/util/matcher/RequestMatcher.html) — doc
