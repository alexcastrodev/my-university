---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

Authentication answers "who is this?" — authorization answers a different
question entirely: "is this specific, already-identified caller allowed to do
this specific thing?" Spring Security keeps the two concerns cleanly separated:
once the authentication filter populates the security context, a second,
independent filter decides whether the request proceeds, based on rules
expressed against the caller's granted authorities or roles rather than against
their identity directly.

## Use Cases

- Restricting an entire application (or, once request-matching is added in a
  later chapter, specific endpoints) to only users holding a particular
  permission — "only users who can `WRITE` may call this."
- Grouping several related permissions under one coarser label — an `ADMIN`
  role that implies read, write, update, and delete — instead of checking each
  underlying permission individually everywhere it matters.
- Building an authorization rule that genuinely doesn't fit "does the user have
  authority X" — a time-of-day restriction, a rule that combines multiple
  conditions — where the named `hasAuthority()`/`hasRole()`-style methods run
  out of expressiveness.
- Deliberately blocking a whole category of request outright (an internal-only
  path, a gateway that should only ever serve one specific route) with a rule
  that always denies, rather than one that conditionally allows.

## Deep Dive

### The `GrantedAuthority` contract: one permission, one string

```java
public interface GrantedAuthority extends Serializable {
  String getAuthority();
}
```

`UserDetails.getAuthorities()` returns a collection of these — the permissions
granted to a user, discovered during authentication and available to the
authorization filter afterward. An authority is just a name (`"READ"`,
`"write"`, `"delete"`) that an authorization rule later checks for; naming
convention (all-caps vs. lowercase) is a project's own choice, not something
Spring Security enforces.

### Restricting by authority: `hasAuthority()` and `hasAnyAuthority()`

```java
@Configuration
public class ProjectConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public UserDetailsService userDetailsService() {
        var manager = new InMemoryUserDetailsManager();

        var user1 = User.withUsername("john")
                        .password("12345")
                        .authorities("READ")
                        .build();

        var user2 = User.withUsername("jane")
                        .password("12345")
                        .authorities("WRITE")
                        .build();

        manager.createUser(user1);
        manager.createUser(user2);
        return manager;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return NoOpPasswordEncoder.getInstance();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.httpBasic();

        http.authorizeRequests()
             .anyRequest()
             .hasAuthority("WRITE");
    }
}
```

Only Jane (who holds `WRITE`) gets a `200 OK` from a protected endpoint; John
(who only holds `READ`) gets `403 Forbidden` — the request is authenticated
successfully in both cases, but only one of the two is authorized.
`hasAnyAuthority(String...)` relaxes this to "at least one of the given
authorities": `hasAnyAuthority("WRITE", "READ")` lets both John and Jane
through, since each holds one of the two named authorities.

### Roles: authorities with a `ROLE_` prefix and coarser intent

Roles use the exact same `GrantedAuthority` contract underneath — the only
distinguishing marker is a `ROLE_` prefix on the name. Where authorities are
meant to be fine-grained (`READ`, `WRITE`, `DELETE`), a role groups several of
those together under one coarser label (`ADMIN` implying all four):

```java
var user1 = User.withUsername("john")
                .password("12345")
                .authorities("ROLE_ADMIN")   // GrantedAuthority, ROLE_ prefix
                .build();
```

```java
http.authorizeRequests()
     .anyRequest().hasRole("ADMIN");   // no ROLE_ prefix when checking
```

The asymmetry is deliberate and easy to get backwards: `authorities("ROLE_ADMIN")`
declares the role with the prefix, but `hasRole("ADMIN")` checks it *without*
the prefix — `hasRole()` adds `ROLE_` internally before comparing. The
`User` builder also offers a dedicated `roles()` method that adds the prefix
automatically on the way in:

```java
var user1 = User.withUsername("john")
                .password("12345")
                .roles("ADMIN")   // ROLE_ prefix added automatically
                .build();
```

Passing an already-prefixed value to `roles()` (`roles("ROLE_ADMIN")`) throws
an exception at startup — the two methods, `authorities()` and `roles()`,
expect the prefix in exactly opposite ways, and mixing them up is a startup
failure rather than a silent misconfiguration. `hasAnyRole(String...)` mirrors
`hasAnyAuthority()` for the multi-role case.

### The escape hatch: `access()` with a raw SpEL expression

For anything the named methods can't express, `access()` takes a Spring
Expression Language (SpEL) string evaluated at request time:

```java
String expression = "hasAuthority('read') and !hasAuthority('delete')";

http.authorizeRequests()
     .anyRequest()
     .access(expression);
```

This lets John (who only holds `read`) through while blocking Jane (who holds
`read`, `write`, *and* `delete`) — a rule that "has one permission but not
another" has no direct equivalent in `hasAuthority()`/`hasAnyAuthority()`
alone. SpEL isn't limited to authority checks either — a genuinely arbitrary
condition like a time-of-day restriction is equally expressible:

```java
T(java.time.LocalTime).now().isAfter(T(java.time.LocalTime).of(12, 0))
```

### Blocking everything: `denyAll()`

The mirror image of `permitAll()` — every request to a matched rule is
rejected outright, authenticated or not:

```java
http.authorizeRequests()
     .anyRequest().denyAll();
```

Concretely useful for the inverse of an allow-list: a gateway service that
should only ever serve one specific path can `denyAll()` everything else,
rather than trying to enumerate every path it should *not* serve.

## Trade-offs

- **`hasAuthority()`/`hasRole()` read clearly and stay debuggable; `access()`
  trades that readability for raw expressive power.** The book's own
  recommendation is explicit: reach for the named methods first, and drop to
  `access()`'s SpEL only when a rule genuinely can't be expressed with them —
  not as a default habit, since a SpEL string is opaque to compile-time
  checking and harder to read at a glance than a named method call.
- **The `ROLE_` prefix asymmetry is a real, easy mistake, not a documentation
  quirk.** `authorities("ROLE_ADMIN")` (prefix included) paired with
  `hasRole("ADMIN")` (prefix omitted) is correct; swapping either side breaks
  silently for `authorities()`/`hasAuthority()`, or loudly (an exception) for
  `roles()` if the prefix is included where it shouldn't be:
  ```java
  // roles() rejects an already-prefixed value — throws at startup
  User.withUsername("john").roles("ROLE_ADMIN").build();
  ```
- **Roles are authorities in disguise, not a separate mechanism.** Treating
  them as unrelated concepts (rather than "an authority whose name happens to
  start with `ROLE_`") makes the prefix rule feel arbitrary instead of
  explaining itself — the same `GrantedAuthority` contract backs both.
- **`denyAll()` is a rare tool for a reason.** Most authorization needs
  "allow under these conditions," which `hasAuthority()`/`hasRole()`/
  `permitAll()` already cover; reaching for `denyAll()` only makes sense for
  the inverse shape — actively blocking a whole category of request — which
  is uncommon enough that the book flags it as a minority case, not a
  first-choice tool.
- **Book vs. today: `authorizeRequests()` and string-based `access()` are both
  gone, replaced by `authorizeHttpRequests()` and a typed `AuthorizationManager`.**
  The book's `http.authorizeRequests().anyRequest().hasAuthority(...)` style is
  built on `WebSecurityConfigurerAdapter`/`FilterSecurityInterceptor`, both
  removed since Spring Security 6.0 in favor of a `SecurityFilterChain` bean
  and `AuthorizationFilter` (the same migration already documented for other
  Spring Security concepts in this workflow). The named methods themselves —
  `hasAuthority()`, `hasAnyAuthority()`, `hasRole()`, `hasAnyRole()`,
  `permitAll()`, `denyAll()` — carry over with the same names and behavior,
  now inside `authorizeHttpRequests()`:
  ```java
  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
      http.authorizeHttpRequests(authorize -> authorize
          .anyRequest().hasRole("ADMIN")
      );
      return http.build();
  }
  ```
  The book's raw-string `access("hasAuthority('read') and !hasAuthority('delete')")`
  has no direct equivalent, though — `access()` today takes an
  `AuthorizationManager`, not a `String`. The officially documented migration
  path for exactly this case is `WebExpressionAuthorizationManager`, which
  wraps a legacy SpEL string behind the new typed interface:
  ```java
  .anyRequest().access(
      new WebExpressionAuthorizationManager("hasAuthority('read') and !hasAuthority('delete')")
  )
  ```
  Confirmed via the current Spring Security reference and the 5.8 migration
  guide — this is a real API break for anyone copying the book's `access()`
  examples verbatim, not a cosmetic rename.
- **Book vs. today (new capability, not a correction): `hasAllAuthorities()`
  and `hasAllRoles()` are new methods that didn't exist in the book's
  version.** They express "the user needs *every* one of these," the AND
  counterpart to `hasAnyAuthority()`/`hasAnyRole()`'s OR — a case the book
  could only reach via the `access()` SpEL escape hatch
  (`hasAuthority('read') and hasAuthority('write')`), now available as a
  named, type-safe method:
  ```java
  .requestMatchers("/db/**").hasAllAuthorities("db", "ROLE_ADMIN")
  ```

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 7, "Configuring authorization: Restricting access", section 7.1, p. 153-171 — doc
- [Spring Security Reference — Authorize HttpServletRequests](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html) — doc
- [Spring Security API — WebExpressionAuthorizationManager](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/web/access/expression/WebExpressionAuthorizationManager.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
