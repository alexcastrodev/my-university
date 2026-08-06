---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Every Spring Security integration test has to answer one question before it can
assert anything: *who is calling?* The `spring-security-test` module gives three
escalating ways to answer it without going through a real login —
`@WithMockUser` fabricates a principal out of thin air, `@WithUserDetails` loads
a real one through your actual `UserDetailsService`, and a custom annotation
backed by `@WithSecurityContext` + `WithSecurityContextFactory` builds the
`SecurityContext` yourself when the first two don't fit. All three deliberately
**skip authentication**, which is why the fourth technique here — driving
`MockMvc` through an actual login with `httpBasic()` or `formLogin()` — exists as
a separate thing you test separately.

This concept is about *establishing a principal for the test*. The sibling
concept `spring-security-testing-authorization-csrf-and-cors` covers what you
then assert with that principal in place (method security, CSRF tokens, CORS
headers).

## Use Cases

- Asserting that `/hello` returns `401` with no user and `200` with one, without
  standing up a real user store — the smallest possible authorization test.
- Testing a controller whose response body depends on the authenticated
  username, by pinning the mock user's name (`@WithMockUser(username = "mary")`).
- Verifying that the roles and authorities in your database actually produce the
  authorization outcome you expect, by loading the user through the real
  `UserDetailsService` with `@WithUserDetails` instead of a fabricated one.
- Testing code that downcasts `SecurityContextHolder.getContext().getAuthentication()`
  to a custom `Authentication` type (a JWT-backed token, a tenant-aware token) —
  the case where only a `WithSecurityContextFactory` can produce the right object.
- Proving that a custom `AuthenticationProvider` actually accepts the credentials
  it should and rejects the ones it shouldn't — which none of the `@With*`
  annotations can do, because they bypass the provider entirely.
- Asserting that an `AuthenticationSuccessHandler` redirects different users to
  different pages after form login.

## Deep Dive

### Setup: one test dependency, and who applies `springSecurity()`

The whole chapter rests on two artifacts on the test classpath:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
```

For `MockMvc` to see Spring Security at all, two things must be wired in:
Spring Security's `FilterChainProxy` as a servlet `Filter`, and its
`TestSecurityContextHolderPostProcessor`, which is what lets the `@With*`
annotations affect the request. In plain Spring (no Boot) you apply both
explicitly with `SecurityMockMvcConfigurers.springSecurity()`:

```java
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = SecurityConfig.class)
@WebAppConfiguration
class SecurityMockMvcTests {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mvc;

    @BeforeEach
    void setup() {
        this.mvc = MockMvcBuilders
                .webAppContextSetup(this.context)
                .apply(springSecurity())
                .build();
    }
}
```

In a Spring Boot application you almost never write that. `@AutoConfigureMockMvc`
(or the `@WebMvcTest` slice) applies `springSecurity()` for you when
`spring-security-test` is on the classpath, so the Boot-flavoured test class is
just:

```java
@SpringBootTest
@AutoConfigureMockMvc
class MainTests {

    @Autowired
    private MockMvc mvc;
}
```

Both forms end up in the same place; the Boot one is what every listing in the
book uses.

### `@WithMockUser`: a fabricated principal, no lookup

`@WithMockUser` populates the `SecurityContext` with a `UserDetails` instance
that the framework invents. No `UserDetailsService` is consulted, no
`AuthenticationProvider` runs, no `PasswordEncoder` is touched. It is by far the
fastest option and the one you'll use for the overwhelming majority of
authorization tests.

Start with the negative case, which needs no annotation at all:

```java
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class MainTests {

    @Autowired
    private MockMvc mvc;

    @Test
    void helloUnauthenticated() throws Exception {
        mvc.perform(get("/hello"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser
    void helloAuthenticated() throws Exception {
        mvc.perform(get("/hello"))
           .andExpect(content().string("Hello!"))
           .andExpect(status().isOk());
    }
}
```

Bare `@WithMockUser` gives you username `user`, password `password`, and the
single role `ROLE_USER`. When the assertion depends on those details, set them:

```java
@Test
@WithMockUser(username = "mary")
void helloAuthenticatedAsMary() throws Exception {
    mvc.perform(get("/hello"))
       .andExpect(content().string("Hello, mary!"))
       .andExpect(status().isOk());
}

// roles are prefixed with ROLE_ automatically; authorities are not
@Test
@WithMockUser(username = "admin", roles = { "USER", "ADMIN" })
void adminEndpoint() throws Exception { /* ... */ }

@Test
@WithMockUser(username = "admin", authorities = { "read", "write" })
void writeEndpoint() throws Exception { /* ... */ }
```

That `roles` / `authorities` split mirrors the framework-wide convention covered
in `spring-security-authorization-authorities-and-roles`: `roles = "ADMIN"`
produces the authority `ROLE_ADMIN`, while `authorities = "ADMIN"` produces
exactly `ADMIN`.

The annotation also works at class level (every test method in the class runs as
that user, including `@Nested` classes), and a single method can opt out with
`@WithAnonymousUser`:

```java
@SpringBootTest
@AutoConfigureMockMvc
@WithMockUser(username = "admin", roles = { "USER", "ADMIN" })
class AdminAreaTests {

    @Test
    void adminCanReachDashboard() throws Exception { /* runs as admin */ }

    @Test
    @WithAnonymousUser
    void anonymousCannot() throws Exception { /* overrides the class-level user */ }
}
```

You can also fold a frequently repeated configuration into your own
meta-annotation — no factory needed, just stack `@WithMockUser` on it:

```java
@Retention(RetentionPolicy.RUNTIME)
@WithMockUser(value = "rob", roles = { "USER", "ADMIN" })
public @interface WithMockAdmin { }
```

### `@WithUserDetails`: a real user through your real `UserDetailsService`

`@WithMockUser` never touches your user store, which is exactly what you want
until the thing you're testing *is* your user store. `@WithUserDetails` takes the
username you give it and calls `loadUserByUsername()` on a `UserDetailsService`
bean from the context, then puts the resulting `UserDetails` in the
`SecurityContext`:

```java
@SpringBootTest
@AutoConfigureMockMvc
class MainTests {

    @Autowired
    private MockMvc mvc;

    @Test
    @WithUserDetails("john")
    void helloAuthenticated() throws Exception {
        mvc.perform(get("/hello"))
           .andExpect(status().isOk());
    }
}
```

The precondition is hard: a `UserDetailsService` bean **must** exist in the test
context, and it must know the username. If several are registered, name the one
you want:

```java
@Test
@WithUserDetails(value = "customUsername", userDetailsServiceBeanName = "myUserDetailsService")
void loadsFromASpecificService() throws Exception {
    Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    assertThat(principal).isInstanceOf(CustomUserDetails.class);
}
```

That last assertion is the real payoff: because the user came from your own
service, the principal is your own `UserDetails` implementation (see
`spring-security-user-management`), authorities and account-status flags
included, exactly as production would build it. `@WithMockUser` can never give
you that.

One timing detail the book doesn't cover but which bites in practice: by default
the annotation runs at `TestExecutionEvent.BEFORE_TEST_METHOD`, i.e. *before*
JUnit's `@BeforeEach`. If your fixture inserts the user in `@BeforeEach`, the
lookup fails. Push the setup later:

```java
@Test
@WithUserDetails(value = "john", setupBefore = TestExecutionEvent.TEST_EXECUTION)
void userCreatedInBeforeEach() throws Exception { /* ... */ }
```

`@WithMockUser`, `@WithAnonymousUser` and `@WithSecurityContext` accept the same
`setupBefore` attribute.

### `@WithSecurityContext` + `WithSecurityContextFactory`: build the context yourself

Sometimes the code under test cares about the *type* of the `Authentication`
object — it downcasts it, or reads a custom field off the principal. Neither of
the previous annotations lets you choose that type. The escape hatch is to build
the `SecurityContext` yourself, in three steps.

**Step 1 — declare your own annotation.** `RetentionPolicy.RUNTIME` is
mandatory; Spring reads it reflectively at runtime.

```java
@Retention(RetentionPolicy.RUNTIME)
public @interface WithCustomUser {
    String username();
}
```

**Step 2 — implement the factory.** `WithSecurityContextFactory<A>` is
parameterised by your annotation, and its single method receives the annotation
instance, so every attribute you declared is available:

```java
public class CustomSecurityContextFactory
        implements WithSecurityContextFactory<WithCustomUser> {

    @Override
    public SecurityContext createSecurityContext(WithCustomUser withCustomUser) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();

        Authentication authentication = UsernamePasswordAuthenticationToken
                .authenticated(withCustomUser.username(), null, List.of());

        context.setAuthentication(authentication);
        return context;
    }
}
```

**Step 3 — link the two** with `@WithSecurityContext(factory = ...)`:

```java
@Retention(RetentionPolicy.RUNTIME)
@WithSecurityContext(factory = CustomSecurityContextFactory.class)
public @interface WithCustomUser {
    String username();
}
```

The annotation is now usable like the built-in ones:

```java
@Test
@WithCustomUser(username = "mary")
void helloAuthenticated() throws Exception {
    mvc.perform(get("/hello"))
       .andExpect(status().isOk());
}
```

The factory is an ordinary Spring bean candidate, so it can take dependencies
through constructor injection — which is precisely how the framework implements
`@WithUserDetails` itself: its factory has a `UserDetailsService` injected and
calls `loadUserByUsername()` in `createSecurityContext()`. Reading that class is
the best available worked example of the pattern.

There's a lesson buried in the book's version of this test worth pulling out.
Spilcă runs it against a project whose custom `AuthenticationProvider` accepts
*only* the user "john" — and the test passes with `username = "mary"`. That's not
a bug: like the other two annotations, this one skips authentication entirely.
Whatever your `AuthenticationProvider` believes about valid users is simply not
consulted.

### Testing authentication itself with `MockMvc`

Because all three annotations bypass authentication, none of them covers a custom
`AuthenticationProvider`, a `PasswordEncoder`, an `AuthenticationSuccessHandler`,
or an `AuthenticationFailureHandler`. To exercise those, the test has to act like
a real client and go through the whole filter chain. For HTTP Basic
(`spring-security-http-basic-and-form-login`), that's the `httpBasic()` request
post-processor:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;

@SpringBootTest
@AutoConfigureMockMvc
class AuthenticationTests {

    @Autowired
    private MockMvc mvc;

    @Test
    void authenticatingWithValidUser() throws Exception {
        mvc.perform(get("/hello").with(httpBasic("john", "12345")))
           .andExpect(status().isOk());
    }

    @Test
    void authenticatingWithInvalidUser() throws Exception {
        mvc.perform(get("/hello").with(httpBasic("mary", "12345")))
           .andExpect(status().isUnauthorized());
    }
}
```

For form login, `formLogin()` is a request *builder* rather than a
post-processor — it replaces `get(...)` in the `perform()` call and produces a
`POST /login` with username `user`, password `password`, and a valid CSRF token
already attached. Pair it with the `authenticated()` / `unauthenticated()` result
matchers, which assert on the resulting `SecurityContext` rather than on the
response:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.unauthenticated;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;

@Test
void loggingInWithWrongUser() throws Exception {
    mvc.perform(formLogin().user("joey").password("12345"))
       .andExpect(header().exists("failed"))     // set by a custom AuthenticationFailureHandler
       .andExpect(unauthenticated());
}

@Test
void loggingInWithWrongAuthority() throws Exception {
    mvc.perform(formLogin().user("mary").password("12345"))
       .andExpect(redirectedUrl("/error"))
       .andExpect(status().isFound())
       .andExpect(authenticated());
}

@Test
void loggingInWithCorrectAuthority() throws Exception {
    mvc.perform(formLogin().user("bill").password("12345"))
       .andExpect(redirectedUrl("/home"))
       .andExpect(status().isFound())
       .andExpect(authenticated());
}
```

The last two are the interesting shape: both users authenticate successfully
(`authenticated()` passes for both), but the `AuthenticationSuccessHandler` sends
them to different places based on their authorities, and the assertion is the
`302` plus the redirect target. Everything is customizable —
`formLogin("/auth")` changes the processing URL, `formLogin().user("u", "admin")`
changes the *parameter name* as well as the value:

```java
mvc.perform(formLogin("/auth").user("u", "admin").password("p", "pass"));
```

The book's structural advice here is worth internalising: test authentication
with a handful of tests, once, and then test authorization per endpoint with mock
users. An app usually has one way to authenticate but dozens of endpoints with
different rules, so re-running authentication for every endpoint test buys
nothing but wall-clock time.

### Annotations vs. `RequestPostProcessor`: *when* the context is built

`@WithMockUser` has a post-processor twin, `SecurityMockMvcRequestPostProcessors.user()`:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;

@Test
void helloAuthenticatedWithUser() throws Exception {
    mvc.perform(get("/hello").with(user("mary")))
       .andExpect(status().isOk());
}

// richer variants
mvc.perform(get("/admin").with(user("admin").password("pass").roles("USER", "ADMIN")));
mvc.perform(get("/").with(user(someUserDetails)));
mvc.perform(get("/").with(authentication(someAuthentication)));
mvc.perform(get("/").with(securityContext(someSecurityContext)));
```

They are not interchangeable in ordering. An annotation is processed by a
`TestExecutionListener` *before* the test method body runs, so the request is
built inside an already-configured security environment. A
`RequestPostProcessor` runs the other way round: the test method builds the
request first, and the post-processor mutates it afterwards. That matters when
something in the test method itself reads `SecurityContextHolder` while
constructing the request — with the annotation it's populated, with `.with(user(...))`
it isn't yet. The post-processor's advantage is scope: it's per-request, so a
single test method can issue calls as several different users, which an
annotation can't express. `.defaultRequest(get("/").with(user("user").roles("ADMIN")))`
on the builder applies one to every request in the class.

### Book vs. today: JUnit 5, `authenticated()` factories, and `MockMvcTester`

This is one of the most stable corners of Spring Security. Verified against the
current reference documentation (7.1.x), `@WithMockUser`, `@WithAnonymousUser`,
`@WithUserDetails`, `@WithSecurityContext`, `WithSecurityContextFactory`,
`SecurityMockMvcConfigurers.springSecurity()`,
`SecurityMockMvcRequestPostProcessors`, `SecurityMockMvcRequestBuilders.formLogin()`
and `SecurityMockMvcResultMatchers.authenticated()` all exist under the same
names, in the same packages, with the same semantics the book describes. Nothing
in sections 20.1-20.3 or 20.5 has been deprecated or renamed. Four things have
moved around it:

1. **JUnit 5 is now the only assumption.** The book already writes JUnit 5 and
   tells you to exclude `junit-vintage-engine`, but the surrounding Spring test
   idiom has settled: the current docs use `@ExtendWith(SpringExtension.class)`
   with `@ContextConfiguration` (or the composed `@SpringJUnitConfig` /
   `@SpringJUnitWebConfig`) where older material used
   `@RunWith(SpringRunner.class)`. Under Spring Boot, `@SpringBootTest` and
   `@WebMvcTest` are already meta-annotated with `@ExtendWith(SpringExtension.class)`,
   so you write neither.

2. **`new UsernamePasswordAuthenticationToken(...)` gave way to static
   factories.** Spring Security 5.7 added
   `UsernamePasswordAuthenticationToken.authenticated(principal, credentials,
   authorities)` and `.unauthenticated(principal, credentials)`. The
   three-argument constructor still exists but its javadoc now reserves it for
   `AuthenticationManager` / `AuthenticationProvider` implementations producing a
   trusted token; everything else — including test factories — is meant to use
   the static methods, which make the authenticated/unauthenticated distinction
   explicit instead of hiding it in which constructor overload you picked. The
   book's listing 20.9 uses the constructor; the current docs' equivalent factory
   example uses `authenticated(...)`, which is what the snippet above reflects.

3. **Boot applies `springSecurity()` for you.** The book never shows
   `SecurityMockMvcConfigurers.springSecurity()` because `@AutoConfigureMockMvc`
   handles it — that's still true, and the current Spring Boot "Testing With
   Spring Security" how-to shows a `@WebMvcTest` + `@WithMockUser` test with no
   manual configurer at all. The explicit `.apply(springSecurity())` form remains
   the documented setup for non-Boot `MockMvcBuilders.webAppContextSetup(...)`.

4. **`MockMvcTester` is the new front end.** Spring Framework 6.2 / Spring Boot
   3.4 added an AssertJ-based alternative to `MockMvc`, auto-configured by the
   same `@AutoConfigureMockMvc` / `@WebMvcTest` annotations. The security
   annotations are entirely orthogonal to it — `@WithMockUser` works exactly the
   same, only the assertion style changes:
   ```java
   @WebMvcTest(UserController.class)
   class MySecurityTests {

       @Autowired
       private MockMvcTester mvc;

       @Test
       @WithMockUser(roles = "ADMIN")
       void requestProtectedUrlWithUser() {
           assertThat(this.mvc.get().uri("/")).doesNotHaveFailed();
       }
   }
   ```
   The book's `mvc.perform(...).andExpect(...)` chain still works and is still
   documented; `MockMvcTester` is an addition, not a replacement.

## Trade-offs

- **All three `@With*` annotations skip authentication — that is the feature and
  the trap.** They write straight into the `SecurityContextHolder`, so no
  `AuthenticationFilter`, `AuthenticationManager`, `AuthenticationProvider`,
  `UserDetailsService` (except for `@WithUserDetails`) or `PasswordEncoder` ever
  runs. A test that "passes with a custom `AuthenticationProvider` in place" has
  not covered that provider at all. Spilcă flags this explicitly as a mistake he
  sees repeatedly.
  ```java
  @Test
  @WithCustomUser(username = "mary")   // passes even though the provider only accepts "john"
  void helloAuthenticated() throws Exception { /* ... */ }
  ```
- **`@WithMockUser` is fast and self-contained; `@WithUserDetails` is faithful
  and coupled.** The mock costs nothing and needs no beans, but it can never
  catch a mismatch between the authorities your data source produces and the ones
  your rules expect. `@WithUserDetails` catches exactly that, at the price of
  requiring a `UserDetailsService` bean plus seeded data — and of failing
  outright when the username is missing rather than falling back.
- **`@WithSecurityContext` buys you type control at the cost of a class and an
  annotation per scenario shape.** Reach for it only when the code under test
  genuinely depends on the concrete `Authentication` or principal type. If all
  you need is a different username or role set, that's an attribute on
  `@WithMockUser`, or a meta-annotation stacking it — no factory required.
- **The annotations populate the *test thread's* `SecurityContextHolder`, so they
  do nothing for real over-the-wire tests.** A `@SpringBootTest(webEnvironment =
  RANDOM_PORT)` test driving `TestRestTemplate` against a live server is handled
  by a different thread in the servlet container; `@WithMockUser` has no effect
  there. Those tests have to authenticate the request itself (HTTP Basic header,
  bearer token, real form post) — which is the section 20.5 technique, applied
  out of necessity rather than choice.
- **Annotation vs. `RequestPostProcessor` is an ordering decision, not a style
  one.** The annotation configures security before the test body builds the
  request; `.with(user(...))` mutates the request after it's built. Use the
  post-processor when one test method needs to call as more than one user, or
  when you're already composing request-level concerns (`httpBasic()`, `csrf()`).
  ```java
  mvc.perform(get("/hello").with(user("mary")));   // per-request, applied after the builder
  ```
- **Test authentication once, authorization many times.** Authentication is one
  flow; authorization is one rule per endpoint. Re-driving a real login for every
  endpoint test multiplies execution time without adding coverage, so keep a
  handful of `httpBasic()`/`formLogin()` tests for the flow and use mock users
  everywhere else.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 20, "Spring Security testing", sections 20.1 "Using mock users for tests" (p. 493-500), 20.2 "Testing with users from a UserDetailsService" (p. 500-501), 20.3 "Using custom Authentication objects for testing" (p. 501-505), and 20.5 "Testing authentication" (p. 507-510) — doc
- [Spring Security Reference — Testing Method Security (@WithMockUser, @WithUserDetails, @WithSecurityContext, WithSecurityContextFactory)](https://docs.spring.io/spring-security/reference/servlet/test/method.html) — doc
- [Spring Security Reference — Setting Up MockMvc and Spring Security (springSecurity())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/setup.html) — doc
- [Spring Security Reference — Testing Authentication (SecurityMockMvcRequestPostProcessors)](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/authentication.html) — doc
- [Spring Security Reference — Testing Form Based Authentication (formLogin())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/form-login.html) — doc
- [Spring Boot How-to — Testing With Spring Security (@WithMockUser with MockMvcTester)](https://docs.spring.io/spring-boot/how-to/testing.html) — doc
- [Spring Boot Reference — Testing Spring Boot Applications (auto-configured MVC tests and security)](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html) — doc
- [Spring Security API — UsernamePasswordAuthenticationToken.authenticated() / .unauthenticated()](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/authentication/UsernamePasswordAuthenticationToken.html) — doc
