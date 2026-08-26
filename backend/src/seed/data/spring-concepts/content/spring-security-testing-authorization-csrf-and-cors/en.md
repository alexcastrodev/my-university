---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

The companion concept `spring-security-testing-mock-users-and-authentication` covers how to *put a principal in the test's `SecurityContext`* — `@WithMockUser`, `@WithUserDetails`, `@WithSecurityContext`, and testing the login flow itself. This one starts where that ends: given a mock user, how do you actually *assert* that your authorization rules, CSRF protection, and CORS policy behave the way you configured them? Three answers, and they are pleasingly different in shape:

- **Method security** (`@PreAuthorize`/`@PostAuthorize`/`@PreFilter`/`@PostFilter`) — drop `MockMvc` entirely, inject the protected bean from the context, call the method, and assert on the exception type.
- **CSRF** — keep `MockMvc`, and use the `csrf()` request post-processor to attach a valid token. The test that matters most is the one *without* it.
- **CORS** — keep `MockMvc`, hand-roll the browser's preflight (`OPTIONS` + `Origin` + `Access-Control-Request-Method`), and assert on `Access-Control-*` response headers.

The mechanics being tested live in the sibling concepts (`spring-security-csrf-protection`, `spring-security-cors-configuration`, and the method-security concepts). This concept is about writing the test.

## Use Cases

- A non-web application — a batch job, a messaging consumer, a library — that has no endpoints at all, so `MockMvc` isn't available and method security is the only security surface to test.
- Proving that a `@PreAuthorize("hasAuthority('write')")` service method rejects an authenticated-but-wrong-authority caller, not just that it accepts the right one.
- Catching the classic regression where someone adds `.csrf(csrf -> csrf.disable())` to make a failing test pass — a test that asserts `403` for a token-less `POST` fails loudly when that happens.
- Verifying a CORS policy without booting a browser: reproducing the preflight by hand and asserting the exact `Access-Control-Allow-Origin`/`Access-Control-Allow-Methods` values.
- Regression-testing a CORS narrowing (`allowedOrigins("*")` → a specific list) so an accidental revert is caught in CI rather than by a partner integration breaking.
- Auditing an existing test suite for the failure mode where the security filter chain isn't wired into `MockMvc` at all, so every "is this protected?" assertion is vacuously green.

## Deep Dive

### Testing method security: no `MockMvc`, inject the bean

The book's setup (section 20.4, p. 505-507) is a `NameService` whose `getName()` is protected with `@PreAuthorize`:

```java
@Service
public class NameService {

  @PreAuthorize("hasAuthority('write')")
  public String getName() {
    return "Fantastico";
  }
}
```

Three scenarios cover the whole rule — no user, wrong authority, right authority:

```java
@SpringBootTest
class NameServiceTests {

  @Autowired
  private NameService nameService;

  @Test
  void testNameServiceWithNoUser() {
    assertThrows(AuthenticationException.class,
        () -> nameService.getName());
  }

  @Test
  @WithMockUser(authorities = "read")
  void testNameServiceWithUserButWrongAuthority() {
    assertThrows(AccessDeniedException.class,
        () -> nameService.getName());
  }

  @Test
  @WithMockUser(authorities = "write")
  void testNameServiceWithUserAndCorrectAuthority() {
    var result = nameService.getName();

    assertEquals("Fantastico", result);
  }
}
```

Two things are load-bearing here and both are easy to skim past:

**There is no `@AutoConfigureMockMvc` and no `MockMvc` field.** Method security is enforced by an AOP interceptor around the bean, not by a servlet filter, so there is nothing HTTP to simulate. You inject the real bean and call the real method — the proxy does the rest. That is exactly why this approach works for applications with no web layer.

**The two failure modes are distinct exception types, and the distinction is the assertion.** No authenticated principal at all raises an `AuthenticationException` (concretely, `AuthenticationCredentialsNotFoundException`). An authenticated principal lacking the authority raises an `AccessDeniedException`. Collapsing both into a single `assertThrows(RuntimeException.class, ...)` would still pass while telling you nothing about *which* rule fired — and a config bug that accidentally makes an endpoint anonymous-accessible would show up as the wrong one of these two, silently.

The same shape covers the rest of the family. `@PostAuthorize` fails *after* the method body has run, so the assertion is identical but the method's side effects have already happened:

```java
@Test
@WithMockUser(username = "bill")
void findDocumentForOtherOwnerThenAccessDenied() {
  // @PostAuthorize("returnObject.owner == authentication.name")
  assertThrows(AccessDeniedException.class,
      () -> documentService.findDocument("abc123"));
}
```

`@PreFilter`/`@PostFilter` don't throw at all when the rule bites — they *shrink a collection*. So the assertion is on contents, not exceptions:

```java
@Test
@WithMockUser(username = "bill")
void findDocumentsReturnsOnlyOwnDocuments() {
  List<Document> result = documentService.findDocuments();

  assertThat(result).extracting(Document::getOwner).containsOnly("bill");
}
```

That difference matters when writing the test: a filtering rule that is silently not applied produces a *larger* list, never an exception, so a test that only checks "no exception thrown" proves nothing about `@PostFilter`.

### Testing CSRF: `.with(csrf())`, and the test without it

Section 20.6 (p. 510) is short because the API is one method. `spring-security-test` ships `SecurityMockMvcRequestPostProcessors.csrf()`, a `RequestPostProcessor` that populates a valid `CsrfToken` into the request:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CsrfTests {

  @Autowired
  private MockMvc mvc;

  @Test
  void helloPostWithoutCsrfTokenIsForbidden() throws Exception {
    mvc.perform(post("/hello"))
        .andExpect(status().isForbidden());
  }

  @Test
  void helloPostWithCsrfTokenIsOk() throws Exception {
    mvc.perform(post("/hello").with(csrf()))
        .andExpect(status().isOk());
  }
}
```

The second test is the one people write; the first is the one that has value. `.with(csrf())` makes CSRF stop being a problem for every *other* test you write, which means CSRF protection could be entirely switched off and your suite would never notice — unless one test asserts that a token-less mutating request is rejected. Treat the `isForbidden()` case as the actual regression guard and the `isOk()` case as scaffolding.

Two variants exist beyond the bare call, both confirmed in the current reference:

```java
mvc.perform(post("/hello").with(csrf().asHeader()));        // token as X-CSRF-TOKEN header, not _csrf parameter
mvc.perform(post("/hello").with(csrf().useInvalidToken())); // valid shape, wrong value → still 403
```

`asHeader()` is the right choice when the production client is JavaScript reading the token from a cookie, because that is how the token actually arrives — testing the parameter form there tests a path no real client uses. `useInvalidToken()` distinguishes "the filter rejects a *wrong* token" from "the filter rejects a *missing* one"; the bare no-token test alone can't tell you whether the token value is being compared at all.

Note what `csrf()` deliberately does *not* do: it doesn't go fetch a token the way a browser would by first `GET`ting a page. It writes a valid token straight into the request and the repository, skipping the delivery mechanism entirely. So these tests validate `CsrfFilter`'s enforcement, not whether your Thymeleaf form actually renders the hidden input or your cookie repository actually reaches the frontend. That end of the story needs a `GET` that asserts the rendered token is present, or a real browser test.

### Testing CORS: reproducing the preflight by hand

Section 20.7 (p. 511-512) makes an observation that generalizes well: CORS is nothing but response headers, so testing it is nothing but asserting response headers. `MockMvc` has no browser in it, so you perform the preflight yourself — an `OPTIONS` request carrying `Origin` and `Access-Control-Request-Method`, exactly what the browser sends:

```java
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CorsTests {

  @Autowired
  private MockMvc mvc;

  @Test
  void preflightForTestEndpointReturnsCorsHeaders() throws Exception {
    mvc.perform(options("/test")
            .header("Access-Control-Request-Method", "POST")
            .header("Origin", "http://www.example.com"))
        .andExpect(status().isOk())
        .andExpect(header().exists("Access-Control-Allow-Origin"))
        .andExpect(header().string("Access-Control-Allow-Origin", "*"))
        .andExpect(header().exists("Access-Control-Allow-Methods"))
        .andExpect(header().string("Access-Control-Allow-Methods", "POST"));
  }
}
```

Both header names are required for the request to be treated as a preflight — `Origin` alone makes it a plain `OPTIONS` request and no CORS processing happens, which produces a confusing "the header just isn't there" failure that looks like a broken CORS config rather than a broken test.

The `status().isOk()` assertion earns its place for a specific reason discussed in `spring-security-cors-configuration`: preflight requests carry **no credentials**. If CORS handling isn't wired into the security chain (`http.cors(...)` missing, or only `@CrossOrigin` on the controller), Spring Security rejects the preflight with `401` before any CORS logic runs. So a preflight test that fails on status rather than on headers is telling you about *ordering*, not about your `CorsConfiguration` values.

The negative case is worth writing too — a disallowed origin should be refused, and Spring's `CorsFilter` answers it with `403`:

```java
@Test
void preflightFromDisallowedOriginIsRejected() throws Exception {
  mvc.perform(options("/test")
          .header("Access-Control-Request-Method", "POST")
          .header("Origin", "http://evil.example.org"))
      .andExpect(status().isForbidden());
}
```

Without it, a config that accidentally allows every origin passes the positive test perfectly.

### The setup that makes all of this real: the filter chain has to be there

Every test above assumes `MockMvc` is running requests through Spring Security's `FilterChainProxy`. If it isn't, the CSRF and CORS tests assert nothing — a token-less `POST` returns `200` because no `CsrfFilter` ever ran, and the "wrong" answer is indistinguishable from a passing test only in the CSRF case, which is precisely the case where a false green is dangerous.

With Spring Boot, `@AutoConfigureMockMvc` wires the filters in for you. Without Boot, apply the configurer explicitly:

```java
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

@BeforeEach
void setup() {
  mvc = MockMvcBuilders
      .webAppContextSetup(context)
      .apply(springSecurity())
      .build();
}
```

`springSecurity()` adds the `FilterChainProxy` plus the `TestSecurityContextHolderPostProcessor` that makes `@WithMockUser` visible to the request. Two ways to accidentally lose this:

- `MockMvcBuilders.standaloneSetup(controller)` — builds a minimal MVC environment with no filter chain at all. Fine for testing a controller's mapping and serialization, useless for testing security.
- `@AutoConfigureMockMvc(addFilters = false)` — a common workaround for "my controller tests all fail with 401" that silently converts every security assertion in the class into a no-op.

Method security is different and doesn't depend on any of this, since it's AOP rather than filters — but it has its own version of the same trap. `@EnableMethodSecurity` lives on a `@Configuration` class, and slice tests like `@WebMvcTest` don't load arbitrary `@Configuration` classes. In a slice, import it explicitly, or use `@SpringBootTest` as the book does:

```java
@WebMvcTest(NameController.class)
@Import(MethodSecurityConfig.class)   // otherwise @PreAuthorize is simply not enforced
class NameControllerTests { }
```

### Book vs. today: the test code is unchanged; only what enables it moved

**Method security: the enabling annotation changed, the tests did not.** The book's chapter-16 projects enable method security with `@EnableGlobalMethodSecurity(prePostEnabled = true)`. That annotation is deprecated and superseded by `@EnableMethodSecurity`, which rebuilt the mechanism on the `AuthorizationManager` API and native Spring AOP instead of the old metadata-source/config-attribute/voter stack, and enables `@PreAuthorize`, `@PostAuthorize`, `@PreFilter`, and `@PostFilter` by default (no `prePostEnabled = true` needed). See the sibling concepts `spring-security-method-security-preauthorization-and-postauthorization` and `spring-security-method-security-filtering-and-spring-data` for that migration in full.

The relevant question for *this* concept is whether the rewrite changed how you test, and the answer is no. The current reference's own method-security examples are structurally identical to listing 20.12 — inject the bean, annotate with `@WithMockUser`, assert `AccessDeniedException`:

```java
@Autowired
BankService bankService;

@WithMockUser(roles = "ADMIN")
@Test
void readAccountWithAdminRoleThenInvokes() {
  Account account = this.bankService.readAccount("12345678");
  // ... assertions
}

@WithMockUser(roles = "WRONG")
@Test
void readAccountWithWrongRoleThenAccessDenied() {
  assertThatExceptionOfType(AccessDeniedException.class)
      .isThrownBy(() -> this.bankService.readAccount("12345678"));
}
```

One detail worth knowing so an existing assertion doesn't surprise you: since Spring Security 6.3 the interceptors throw `AuthorizationDeniedException`, which **extends** `AccessDeniedException` (package `org.springframework.security.authorization`). Assertions written against `AccessDeniedException` — the book's, and the reference's — keep passing unchanged; only a test using strict type equality rather than `assertThrows`/`isThrownBy` (which accept subtypes) would need updating. There is still no "unit test a `@PreAuthorize` expression in isolation" API: the annotation is enforced by a proxy, so the test needs a context that creates the proxy.

**CSRF: `csrf()` is untouched.** `SecurityMockMvcRequestPostProcessors.csrf()` is current, non-deprecated, and documented with the same `mvc.perform(post("/").with(csrf()))` call the book shows, alongside `csrf().asHeader()` and `csrf().useInvalidToken()`. What changed is underneath the test, not in it: since Spring Security 6.0 the default `CsrfTokenRequestHandler` is `XorCsrfTokenRequestAttributeHandler`, which masks the token per request for BREACH protection, and token loading is deferred. `csrf()` handles both — it produces a request the current handler accepts — which is exactly why the book's listing still compiles and passes verbatim on a modern version.

**CORS: preflight-by-hand is still the standard approach.** There is no `cors()` post-processor and no dedicated CORS test helper in `spring-security-test`; the reference's testing section covers request post-processors and result matchers, and CORS isn't among them, because CORS is plain response-header assertion that needs no security-specific tooling. Listing 20.17 transfers unchanged.

Two caveats on the *expected values* in that listing, though, which are about the config it tests rather than the test API. First, `header().string("Access-Control-Allow-Origin", "*")` only holds for a genuinely wildcard policy. Modern configs frequently use `allowedOriginPatterns` (mandatory when `allowCredentials(true)` is set, since `*` and credentials are illegal together), and those **echo the matched origin** rather than emitting `*` — so the assertion becomes:

```java
.andExpect(header().string("Access-Control-Allow-Origin", "http://www.example.com"))
```

Getting this wrong produces a failing test on a *more secure* config, which is a good way to talk yourself into loosening the policy. Second, `Access-Control-Allow-Methods` reflects whatever the `CorsConfiguration` lists, so the exact-string assertion is brittle if that list is later extended; `header().string(name, containsString("POST"))` is the more durable form when the point is "POST is permitted" rather than "exactly these methods are permitted".

**The wrapper around all of it has a newer option.** Spring Framework 6.2 added `MockMvcTester`, an AssertJ-flavoured front end for the same underlying machinery (`MockMvcTester.from(context)`, or `MockMvcTester.create(mockMvc)` to wrap an existing instance). Its request builder extends `AbstractMockHttpServletRequestBuilder`, so `with(RequestPostProcessor)` is inherited and `spring-security-test`'s post-processors work unchanged:

```java
assertThat(mvcTester.post().uri("/hello").with(csrf()))
    .hasStatus(HttpStatus.OK);
```

Optional, not a migration you owe anyone — the `mvc.perform(...).andExpect(...)` style in the book remains fully supported. Its practical draw is that an unresolved exception surfaces on the result object instead of being thrown out of `perform`, which makes "assert the request failed this specific way" read better.

## Trade-offs

- **Method-security tests need a real application context, which makes them slow.** `@SpringBootTest` boots the whole thing to get one AOP proxy. There is no lighter-weight substitute — the `@PreAuthorize` expression is only evaluated by the interceptor, so mocking or direct instantiation bypasses security entirely and produces a test that always passes.
  ```java
  var service = new NameService();   // no proxy → @PreAuthorize never evaluated
  assertEquals("Fantastico", service.getName());  // green, and proves nothing
  ```
- **`.with(csrf())` sprinkled everywhere quietly retires your CSRF protection as a tested property.** It is the right call for the 95% of tests that are about something else, and it means the *only* thing standing between you and an untested `csrf.disable()` is the one test asserting `403` for a token-less `POST`. Write it once, deliberately, and don't delete it when it becomes inconvenient.
- **`@AutoConfigureMockMvc(addFilters = false)` fixes failing tests by removing what they were testing.** Perfectly legitimate on a class that only exercises request mapping and JSON serialization; catastrophic on a class named `SecurityTests`, where every assertion becomes vacuous while staying green.
- **Exact-string header assertions on CORS are precise and brittle in opposite directions.** `header().string("Access-Control-Allow-Methods", "POST")` catches a policy widening immediately — which is the point — but also fails the moment someone legitimately adds `PUT`. Pick per-header: exact strings for `Access-Control-Allow-Origin` (widening there is the actual risk) and `containsString` for the method list when the test's intent is "POST is permitted".
- **Preflight tests validate headers, not enforcement.** CORS is enforced by the *browser*; a passing preflight test says your server advertises the right policy, not that anything is prevented. As the CORS concept notes, a cross-origin call the browser refuses to show to JavaScript may already have executed server-side — so CORS tests are never a substitute for authorization tests on the same endpoint.
- **`csrf()` skips token delivery, so it can't catch a broken delivery mechanism.** The post-processor injects a valid token directly. A Thymeleaf form missing its hidden input, or a `CookieCsrfTokenRepository` whose cookie never reaches the frontend, passes every one of these tests and fails in production. Cover delivery separately by asserting the token appears in the `GET` response.
  ```java
  mvc.perform(get("/main"))
      .andExpect(content().string(containsString("_csrf")));
  ```
- **Testing method security via `MockMvc` instead of by direct injection conflates two rule sets.** Calling an endpoint that happens to invoke a `@PreAuthorize` method means a failure could come from either the endpoint's `authorizeHttpRequests` rules or the method annotation, and a `403` doesn't say which. Direct injection isolates the method rule — which is why the book drops `MockMvc` for this section rather than merely omitting it.
- **The book's `assertThrows(AuthenticationException.class, ...)` case only holds when there is genuinely no principal.** Under an anonymous-authentication setup, an unauthenticated call may arrive with an `AnonymousAuthenticationToken` rather than nothing, turning the expected `AuthenticationException` into an `AccessDeniedException`. Worth knowing before assuming the test is broken — `@WithAnonymousUser` makes which case you're testing explicit.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 20, "Spring Security testing", section 20.4 "Testing method security" (p. 505-507), section 20.6 "Testing CSRF configurations" (p. 510), section 20.7 "Testing CORS configurations" (p. 511-512)](https://www.manning.com/books/spring-security-in-action) — doc
- [Spring Security Reference — Testing Method Security (@WithMockUser, @WithUserDetails, @WithSecurityContext, setupBefore)](https://docs.spring.io/spring-security/reference/servlet/test/method.html) — doc
- [Spring Security Reference — Testing with CSRF Protection (csrf(), csrf().asHeader(), csrf().useInvalidToken())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/csrf.html) — doc
- [Spring Security Reference — Setting Up MockMvc and Spring Security (SecurityMockMvcConfigurers.springSecurity())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/setup.html) — doc
- [Spring Security Reference — Method Security (@EnableMethodSecurity supersedes @EnableGlobalMethodSecurity; AccessDeniedException on denial; test examples)](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — doc
- [Spring Security API — SecurityMockMvcRequestPostProcessors (csrf, httpBasic, user, authentication, jwt, oauth2Login)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/test/web/servlet/request/SecurityMockMvcRequestPostProcessors.html) — doc
- [Spring Security API — AuthorizationDeniedException (extends AccessDeniedException, since 6.3)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/authorization/AuthorizationDeniedException.html) — doc
- [Spring Security Reference — CORS (preflight requests carry no credentials; http.cors ordering)](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html) — doc
- [Spring Framework Reference — MockMvc AssertJ Integration (MockMvcTester, since 6.2)](https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj.html) — doc
- [Spring Framework API — MockMvcTester.MockMvcRequestBuilder (inherits with(RequestPostProcessor))](https://docs.spring.io/spring-framework/docs/7.0.x/javadoc-api/org/springframework/test/web/servlet/assertj/MockMvcTester.MockMvcRequestBuilder.html) — doc
