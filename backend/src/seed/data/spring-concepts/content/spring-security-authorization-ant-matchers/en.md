---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

The sibling concept on matcher methods covers `anyRequest()` and `mvcMatchers()`
(book sections 8.1-8.2). This one covers the third family the book walks
through, Ant matchers (`antMatchers()`) — same wildcard syntax, same three
overloads shape as MVC matchers, but a genuinely different matching mechanism
underneath. The book spends this whole section (8.3) building toward one
specific, concrete gotcha: an Ant matcher written for `/hello` does **not**
automatically also secure `/hello/`, while an MVC matcher written for the same
path does. That single trailing-slash difference is the entire reason the book
recommends MVC matchers over Ant matchers whenever both are available.

## Use Cases

- Reading or auditing a legacy Spring Security configuration that still uses
  `antMatchers()` — understanding what it does and doesn't cover before
  trusting it.
- Restricting a whole group of paths under a common prefix (`/orders/**`) with
  one Ant expression instead of enumerating every sub-path.
- Applying different authorization rules to the same path depending on HTTP
  method, using `antMatchers(HttpMethod, String...)`.
- Deciding whether an existing `antMatchers()` rule needs a matching second
  rule for the trailing-slash variant of the same path, or whether migrating
  it to `mvcMatchers()`/`requestMatchers()` closes the gap outright.

## Deep Dive

### The three `antMatchers()` overloads

```java
// path + HTTP method — different rules per verb, same paths
.antMatchers(HttpMethod.POST, "/orders/**").hasRole("ADMIN")

// path only — the rule applies regardless of HTTP method
.antMatchers("/orders/**").authenticated()

// HTTP method only, equivalent to antMatchers(method, "/**")
.antMatchers(HttpMethod.DELETE).hasRole("ADMIN")
```

The shape mirrors `mvcMatchers()` exactly — same three overloads, same
wildcard syntax for the path patterns. `antMatchers(HttpMethod method)` alone
restricts by verb only, since it's shorthand for matching every path with that
method.

### Ant wildcard syntax: identical to MVC matchers

Ant matchers borrow Spring MVC's own path-expression syntax, so `*` and `**`
mean the same thing they do for `mvcMatchers()`: `*` matches exactly one path
segment, `**` matches any number of segments including zero. A path variable
can carry a regex constraint the same way:

```java
.antMatchers("/product/{code:^[0-9]*$}").permitAll()
```

The syntax being identical to MVC matchers is exactly what makes the
difference in this section easy to miss — a developer skimming the code sees
familiar-looking expressions and reasonably assumes they behave the same way.
They don't.

### The trailing-slash gotcha: `/hello` vs `/hello/`

Given this controller:

```java
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello() {
        return "Hello!";
    }
}
```

Spring MVC itself treats `/hello` and `/hello/` as the same action — a request
to either path reaches `hello()`. With an **MVC matcher** securing `/hello`:

```java
http.authorizeRequests()
     .mvcMatchers("/hello")
       .authenticated();
```

both variants are protected identically:

```
curl http://localhost:8080/hello    → 401 Unauthorized
curl http://localhost:8080/hello/   → 401 Unauthorized
curl -u jane:12345 .../hello        → 200 "Hello!"
curl -u jane:12345 .../hello/       → 200 "Hello!"
```

Swap only the matcher method, keeping the same path expression and the same
controller:

```java
http.authorizeRequests()
     .antMatchers("/hello").authenticated();
```

and the result changes for the trailing-slash request:

```
curl http://localhost:8080/hello    → 401 Unauthorized
curl http://localhost:8080/hello/   → 200 "Hello!"   (unauthenticated!)
```

`antMatchers("/hello")` matches the literal Ant expression `/hello` against
the request path and nothing else — it has no awareness that Spring MVC would
route `/hello/` to the same controller method. The rule silently doesn't apply
to `/hello/`, and since nothing else in this minimal config protects it, that
path is reachable with no authentication at all. The book calls this "a major
security breach" precisely because nothing about the configuration *looks*
wrong — the expression matches its own literal path just fine.

## Trade-offs

- **Ant matchers match the literal expression, nothing more — they don't know
  how Spring MVC actually routes requests.** The gotcha above is the direct
  consequence: `/hello` as an Ant expression never matches the string
  `/hello/`, regardless of what the dispatcher would do with that request.
  ```
  curl http://localhost:8080/hello/   # antMatchers("/hello") → 200, unprotected
  ```
- **`antMatchers(HttpMethod)` alone is a full wildcard on the path.** It's
  sugar for `antMatchers(method, "/**")`, so a rule like
  `antMatchers(HttpMethod.DELETE).denyAll()` blocks every `DELETE` request
  application-wide, not just ones matching some implied narrower pattern.
  ```java
  .antMatchers(HttpMethod.DELETE).denyAll() // == antMatchers(DELETE, "/**").denyAll()
  ```
- **Ant matchers are legacy but still common — the book flags this
  deliberately.** Spilcă notes he'd "seen Ant matchers used a lot in
  applications" and wanted readers able to recognize and reason about them
  even while recommending against writing new ones. There's no snippet to
  demo here; it's a statement about what you'll encounter in the wild, not a
  behavior to reproduce.
- **Book vs today: the exact mechanism that closed this gap has itself moved
  on, twice.** Since Spring Security 5.8, `antMatchers()`/`mvcMatchers()`/
  `regexMatchers()` are deprecated (removed in 6.0) in favor of one
  `requestMatchers()` method that — in that generation of the API — picked
  `MvcRequestMatcher` automatically when Spring MVC was on the classpath,
  reproducing the trailing-slash-safe behavior the book recommends MVC
  matchers for, without a developer having to choose it. But as of the
  current Spring Security reference (7.1.0), `MvcRequestMatcher` and
  `AntPathRequestMatcher` are gone entirely — `requestMatchers()` now builds
  exclusively on `PathPatternRequestMatcher`, confirmed via the Spring
  Security 7 web migration guide. More importantly, the underlying behavior
  it inherits changed too: Spring Framework 6.0 flipped `PathPattern`'s
  trailing-slash matching default from `true` to `false` (tracked in
  [spring-framework#28552](https://github.com/spring-projects/spring-framework/issues/28552)),
  specifically because implicit trailing-slash equivalence was judged a
  security liability, not just a routing convenience. Practically, a request
  to `/hello/` today no longer silently reaches the `/hello` mapping at
  all — under the current default it's a `404` before authorization is even
  a question, which closes the book's specific vulnerability by a different
  route: not by making the security rule cover both paths, but by Spring MVC
  no longer treating them as the same request in the first place. The book's
  closing advice — "make sure your expressions indeed match everything for
  which you need to apply authorization rules" — is the part that hasn't
  aged at all; only the specific mechanism you have to be careful about has
  moved, from Ant-vs-MVC matcher choice to trailing-slash matching being off
  by default across the board.
  ```java
  http.authorizeHttpRequests(authorize -> authorize
      .requestMatchers("/hello").authenticated()
      .anyRequest().permitAll()
  );
  // today: PathPatternRequestMatcher, trailing-slash match off by default —
  // GET /hello/ no longer resolves to the same mapping as GET /hello
  ```

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 8, "Configuring authorization: Applying restrictions", section 8.3, "Selecting requests for authorization using Ant matchers", p. 185-189 — doc
- [Spring Security Reference — Authorize HttpServletRequests (requestMatchers)](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security Reference — Web Migrations for 7.0 (AntPathRequestMatcher/MvcRequestMatcher removed, PathPatternRequestMatcher)](https://docs.spring.io/spring-security/reference/6.5/migration-7/web.html) — doc
- [Spring Framework Issue #28552 — Deprecate trailing slash match and change default value from true to false](https://github.com/spring-projects/spring-framework/issues/28552) — doc
