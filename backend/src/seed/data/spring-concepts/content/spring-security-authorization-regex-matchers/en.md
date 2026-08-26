---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

The two sibling concepts on matcher methods cover `mvcMatchers()`/`requestMatchers()`
(8.1-8.2) and `antMatchers()` (8.3) — both of those match paths using Ant-style
wildcard syntax (`*`, `**`, and a limited `{var:regex}` constraint on a single path
variable). Section 8.4 covers the escape hatch for when even that isn't expressive
enough: `regexMatchers()`, which matches the *entire* request path against a full
regular expression instead of a wildcard pattern. The book's own framing is blunt —
regexes are the most powerful option and the last one you should reach for, because
what they gain in expressiveness they lose in readability.

## Use Cases

- A rule that depends on *multiple* path variables at once (the book's example:
  `/video/{country}/{language}`, where the allowed set is "US, Canada, or UK, OR
  English" — a condition that spans two path segments together, not just one).
- Matching paths by content shape rather than by segment structure — "any path
  containing something that looks like a phone number or email address" — where
  there's no clean way to express the rule as a sequence of literal segments and
  wildcards.
- Rejecting paths containing specific symbols or characters across the whole
  path, not just within one path variable's value.
- As a deliberate last resort after confirming an MVC or Ant matcher (including a
  single path variable's own `{var:regex}` constraint) genuinely can't express the
  rule — the book frames this ordering as the correct default, not a style choice.

## Deep Dive

### The two `regexMatchers()` overloads

```java
regexMatchers(HttpMethod method, String regex) // regex + a specific HTTP method
regexMatchers(String regex)                     // regex, any HTTP method
```

Same shape as `mvcMatchers()`/`antMatchers()`: pin an HTTP method when different
verbs on the same paths need different rules, or drop it when the rule applies
regardless of method.

### A single path variable: regex still fits inside an MVC matcher

Before reaching for a standalone regex matcher, it's worth noting the book
already showed (8.3) that a *single* path variable's shape can be constrained
without leaving MVC/Ant syntax at all — the regex lives inside the `{var:regex}`
segment:

```java
http.authorizeRequests()
    .mvcMatchers("/email/{email:.*(.+@.+\\.com)}")
       .permitAll()
    .anyRequest()
       .denyAll();
```

```
curl http://localhost:8080/email/jane@example.com   → "Allowed for email jane@example.com"
curl http://localhost:8080/email/jane@example.net   → 401 Unauthorized
```

This only works because the condition concerns one path variable in isolation.
The moment a rule needs to reason about *more than one* path variable together,
this trick runs out.

### The endpoint that needs a real regex matcher

```java
@RestController
public class VideoController {

    @GetMapping("/video/{country}/{language}")
    public String video(@PathVariable String country,
                         @PathVariable String language) {
        return "Video allowed for " + country + " " + language;
    }
}
```

The requirement: any authenticated user can watch if the request comes from the
US, Canada, or the UK, *or* if the language is English — a condition spanning
both `{country}` and `{language}` together. Neither an MVC nor an Ant matcher
(nor a single `{var:regex}` constraint) can express "this segment OR that
segment" across two different path variables; a regex matched against the whole
path can:

```java
@Configuration
public class ProjectConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public UserDetailsService userDetailsService() {
        var uds = new InMemoryUserDetailsManager();
        uds.createUser(User.withUsername("john")
                .password("12345").authorities("read").build());
        uds.createUser(User.withUsername("jane")
                .password("12345").authorities("read", "premium").build());
        return uds;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return NoOpPasswordEncoder.getInstance();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.httpBasic();

        http.authorizeRequests()
            .regexMatchers(".*/(us|uk|ca)+/(en|fr).*")
                .authenticated()
            .anyRequest()
                .hasAuthority("premium");
    }
}
```

The regex matches any path containing `us`, `uk`, or `ca` followed later by
`en` or `fr` — deliberately looser than the plain-English requirement (it would
also match, say, `/video/us/fr`), but close enough for the book's worked
example. Requests that match need only be authenticated; everything else falls
through to the `anyRequest()` rule and needs the `"premium"` authority instead:

```
curl -u john:12345 http://localhost:8080/video/us/en   → "Video allowed for us en"
curl -u john:12345 http://localhost:8080/video/fr/fr    → 403 Forbidden  (john lacks "premium")
curl -u jane:12345 http://localhost:8080/video/fr/fr    → "Video allowed for fr fr"  (jane has "premium")
```

John (only `"read"`) can reach the US/English path because it's just
authentication-gated, but is denied the FR/French path since that falls to the
`hasAuthority("premium")` catch-all. Jane (`"read"` + `"premium"`) can reach
both.

## Trade-offs

- **Regexes can express any path condition MVC/Ant syntax can't — at a real
  readability cost.** The book's own closing example is a full email-validation
  regex, offered specifically to make the point that "easy to read" is not a
  property regexes reliably have, even for a well-understood format:
  ```
  (?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"...)@(?:...)
  ```
  Compare that to the single-variable MVC constraint above
  (`{email:.*(.+@.+\\.com)}`) — still a regex, but scoped to one variable and
  read in context of the path it belongs to, which is why the book treats that
  form as acceptable and a bare `regexMatchers()` call as the fallback of last
  resort.
- **A regex matcher is opaque to the endpoint's own path-variable structure.**
  `.regexMatchers(".*/(us|uk|ca)+/(en|fr).*")` has no idea `{country}` and
  `{language}` exist as named segments — it just matches the raw path string.
  An MVC or Ant matcher, by contrast, mirrors the controller's own mapping,
  so a reader can compare `/video/{country}/{language}` against
  `mvcMatchers("/video/**")` directly; there's no equivalent direct comparison
  for a regex written against the whole URL.
- **Loose regexes can accept more than intended.** The book's own example
  matches `us` or `uk` or `ca` *and* `en` or `fr` in any combination, including
  `/video/us/fr` — a broader match than the plain-English rule ("US/Canada/UK,
  or English") technically asked for. Getting a regex to match *exactly* the
  intended set, and nothing more, is harder than writing the equivalent
  wildcard rule would have been if wildcards could express the condition at
  all.
- **Book vs. today: the chain method is gone, but the mechanism it exposed is
  still there and still current.** `regexMatchers()` was deprecated alongside
  `mvcMatchers()`/`antMatchers()` in Spring Security 5.8 and removed in 6.0 in
  favor of a single `requestMatchers()` method. Unlike Ant/MVC matching, whose
  replacement (`PathPatternRequestMatcher`) is now the automatic default for
  every plain string pattern (see the sibling Ant-matchers concept), regex
  matching is not something `requestMatchers(String)` does implicitly — it
  stays an explicit, separate matcher you pass in: `RegexRequestMatcher`, via
  its `regexMatcher(...)` static factory, confirmed current and undeprecated
  in the Spring Security 7.1 reference:
  ```java
  http.authorizeHttpRequests(authorize -> authorize
      .requestMatchers(RegexRequestMatcher.regexMatcher(".*/(us|uk|ca)+/(en|fr).*"))
          .authenticated()
      .anyRequest()
          .hasAuthority("premium")
  );
  ```
  The book's own advice — prefer MVC/Ant syntax, fall back to regex only when
  nothing else expresses the rule — is unchanged; only the call site moved,
  from a dedicated `regexMatchers()` chain method to an explicit `RequestMatcher`
  instance passed into the unified `requestMatchers()` entry point.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 8, "Configuring authorization: Applying restrictions", section 8.4, "Selecting requests for authorization using regex matchers", p. 190-194 — doc
- [Spring Security Reference — Authorize HttpServletRequests (Matching Using Regular Expressions)](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html#match-by-regex) — doc
- [Spring Security API — RegexRequestMatcher](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/web/util/matcher/RegexRequestMatcher.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security Reference — Web Migrations for 7.0 (AntPathRequestMatcher/MvcRequestMatcher removed, PathPatternRequestMatcher)](https://docs.spring.io/spring-security/reference/6.5/migration-7/web.html) — doc
