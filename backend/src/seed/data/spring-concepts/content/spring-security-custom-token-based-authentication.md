---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Build, by hand, a complete token-based authentication system split across two
applications — an *authentication server* that owns user credentials and issues
one-time passwords, and a *business logic server* that exposes the endpoints a
client actually wants and trusts tokens on every request without keeping any
server-side session. The point is not the specific classes: it's understanding
what a bearer-token flow has to *do* — send credentials exactly once, hand back a
self-describing credential, then re-derive an authenticated identity from that
credential on every subsequent request — expressed entirely in Spring Security's
own contracts (`Authentication`, `AuthenticationProvider`, `OncePerRequestFilter`,
`SecurityContextHolder`). This is deliberately pre-OAuth2 pedagogy: everything
hand-rolled here is what OAuth 2 / OIDC standardizes, and what the
authorization-server and resource-server concepts replace with framework support.

## Use Cases

- Securing an API consumed by a mobile app or a JavaScript frontend, where a
  server-side session (and therefore form login) is a poor fit but sending
  credentials on every request (HTTP Basic) is worse.
- Implementing multi-factor authentication: username/password proves *what the
  user knows*, an SMS one-time password proves *what device the user holds*, and
  only the combination yields a token.
- Splitting "who authenticates users" from "who serves business data" so the two
  can scale, deploy, and be owned independently — the same separation of
  responsibilities that later becomes the OAuth 2 authorization-server /
  resource-server split.
- Understanding what a JWT actually is structurally (header, payload, signature)
  before reaching for a library that hides it, so that "the token is invalid"
  becomes a debuggable statement rather than a mystery.
- Writing a custom bearer-token filter for a token format the framework doesn't
  know about — a legacy in-house token, an API key, a signed header.

## Deep Dive

### Why a token at all: what it buys over sending credentials every time

A token is an access card. You identify yourself once at reception
(authentication) and receive a card (token) that opens some doors but not
necessarily all of them. At the implementation level a token can be *anything the
server can recognize later* — even a plain UUID stored in a database or in memory,
associated with the user it was issued to.

The book lists five concrete advantages over the HTTP Basic style used in earlier
chapters, where credentials ride along on every single request:

- **Credentials are sent once.** The more often a password crosses the network,
  the more chances someone intercepts it. With tokens, credentials appear only in
  the initial login call.
- **Tokens can have a short lifetime.** A stolen token expires; a stolen password
  does not.
- **Tokens can be invalidated without invalidating credentials.** Repudiating a
  leaked token doesn't force a password reset.
- **Tokens can carry details** — authorities, roles — which replaces a
  *server-side* session with a *client-side* one, and that is what makes
  horizontal scaling straightforward.
- **Tokens let you delegate authentication to another component**, whether that's
  your own separate service or GitHub/Twitter.

### What a JWT is, structurally

A JSON Web Token is three Base64-encoded parts joined with dots:

```
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFProg7s_KvFxvnYGiZF-Mj4rr-0nJA1tVGZNn8U
```

Decoded, the first two parts are ordinary JSON. The header holds metadata about
the token — here, the algorithm used to produce the signature; the payload (body)
holds the claims the application will need later for authorization:

```json
{ "alg": "HS256" }
```

```json
{ "username": "danielle" }
```

The third part is a digital signature over the first two, and it is *optional* —
but without it you cannot know that nobody altered the token in transit. A signed
JWT is properly called a **JWS** (JSON Web Token Signed); one whose content is
encrypted is a **JWE**. That naming is not trivia: it explains why the parsing
method in the book's code is named `parseClaimsJws()` rather than `parseClaims()`.

Keep the payload small. There is no hard limit, but a longer token slows every
request that carries it, and signing a longer token costs more CPU.

### The architecture: three components, three authentication steps

Three actors: the **client** (a mobile app or SPA, stood in for by cURL), the
**authentication server** (owns the `user` and `otp` tables, generates OTPs), and
the **business logic server** (exposes the endpoint worth protecting, and is the
application actually configured with Spring Security). The client never talks to
the authentication server directly — the business logic server proxies to it.

```mermaid
sequenceDiagram
    participant C as Client (cURL)
    participant B as Business logic server<br/>(:9090, Spring Security)
    participant A as Auth server<br/>(:8080, users + OTPs)

    Note over C,A: Step 1 — prove what you know
    C->>B: POST /login<br/>headers: username, password
    B->>A: POST /user/auth {username, password}
    A->>A: match bcrypt hash, generate 4-digit OTP,<br/>store it in the otp table
    A-->>C: OTP via SMS (out of band)

    Note over C,A: Step 2 — prove what you hold
    C->>B: POST /login<br/>headers: username, code
    B->>A: POST /otp/check {username, code}
    A-->>B: 200 OK (valid) / 403 Forbidden
    B->>B: sign a JWT with the username claim
    B-->>C: Authorization: eyJhbGciOi...

    Note over C,A: Step 3 — every subsequent request
    C->>B: GET /test<br/>Authorization: <jwt>
    B->>B: verify signature locally,<br/>build Authentication, set SecurityContext
    B-->>C: 200 OK "Test"
```

Note what step 3 does *not* contain: any call to the authentication server, and
any session lookup. The token itself carries the identity, and the signature
proves it wasn't tampered with. That is the entire payoff of the design.

The book is candid that the architecture is simplified for teaching: strictly, a
client should share its password only with the authentication server, never with
the business logic server. And in the real world you would reach for a managed
provider rather than hand-writing MFA. The point of writing it by hand is to
learn custom filters and providers.

### The authentication server: OTP issuance, and nothing about Spring Security

The authentication server is deliberately dull — three endpoints
(`/user/add`, `/user/auth`, `/otp/check`), two JPA entities, two repositories.
Spring Security appears in it for exactly one reason: to get a
`BCryptPasswordEncoder` for hashing stored passwords. Its security config is
otherwise wide open:

```java
@Configuration
public class ProjectConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.csrf().disable();
        http.authorizeRequests().anyRequest().permitAll();
    }
}
```

The first authentication step is a password match followed by OTP renewal — plain
service code, no framework machinery, and it throws
`BadCredentialsException` on either a missing user or a wrong password (the same
message in both branches, so the endpoint doesn't leak which usernames exist):

```java
public void auth(User user) {
    Optional<User> o = userRepository.findUserByUsername(user.getUsername());

    if (o.isPresent()) {
        User u = o.get();
        if (passwordEncoder.matches(user.getPassword(), u.getPassword())) {
            renewOtp(u);
        } else {
            throw new BadCredentialsException("Bad credentials.");
        }
    } else {
        throw new BadCredentialsException("Bad credentials.");
    }
}
```

The OTP itself comes from `SecureRandom.getInstanceStrong()` — not
`Math.random()`, not `new Random()` — because it is a credential:

```java
public static String generateCode() {
    try {
        SecureRandom random = SecureRandom.getInstanceStrong();
        int c = random.nextInt(9000) + 1000;   // 1000..9999
        return String.valueOf(c);
    } catch (NoSuchAlgorithmException e) {
        throw new RuntimeException("Problem when generating the random code.");
    }
}
```

`/otp/check` answers with a *status code*, not a body — `200 OK` when the stored
code matches, `403 Forbidden` otherwise. That choice is what makes the proxy on
the other side trivial.

### The proxy: how the business server asks the authentication server

Before any `AuthenticationProvider` can be written, the business logic server
needs a way to reach the other application. That's a `RestTemplate` bean plus a
thin component, with the base URL injected from properties:

```java
@Component
public class AuthenticationServerProxy {

    @Autowired
    private RestTemplate rest;

    @Value("${auth.server.base.url}")
    private String baseUrl;

    public void sendAuth(String username, String password) {
        String url = baseUrl + "/user/auth";

        var body = new User();
        body.setUsername(username);
        body.setPassword(password);

        var request = new HttpEntity<>(body);
        rest.postForEntity(url, request, Void.class);
    }

    public boolean sendOTP(String username, String code) {
        String url = baseUrl + "/otp/check";

        var body = new User();
        body.setUsername(username);
        body.setCode(code);

        var request = new HttpEntity<>(body);
        var response = rest.postForEntity(url, request, Void.class);

        return response.getStatusCode().equals(HttpStatus.OK);
    }
}
```

```properties
server.port=9090
auth.server.base.url=http://localhost:8080
jwt.signing.key=ymLTU8rq83...
```

### Two `Authentication` types, two providers — and why the two-arg constructor matters

The business logic server needs two distinct kinds of authentication request, so
it gets two `Authentication` implementations. Both simply extend
`UsernamePasswordAuthenticationToken` (the OTP is treated as a password), which
means neither has to re-implement the `Authentication` contract:

```java
public class UsernamePasswordAuthentication
    extends UsernamePasswordAuthenticationToken {

    public UsernamePasswordAuthentication(
            Object principal, Object credentials) {
        super(principal, credentials);
    }

    public UsernamePasswordAuthentication(
            Object principal, Object credentials,
            Collection<? extends GrantedAuthority> authorities) {
        super(principal, credentials, authorities);
    }
}
```

`OtpAuthentication` is byte-for-byte the same shape. Declaring *both*
constructors is the load-bearing detail: the **two-argument** constructor leaves
the instance *unauthenticated* (the `AuthenticationManager` will go looking for a
provider), while the **three-argument** one — authorities included — marks it
*authenticated*, meaning the process is over.

Each `Authentication` type gets a provider, and `supports()` is what routes
between them. The username/password provider does not finish authentication — it
only triggers the OTP, so it returns an unauthenticated token:

```java
@Component
public class UsernamePasswordAuthenticationProvider
    implements AuthenticationProvider {

    @Autowired
    private AuthenticationServerProxy proxy;

    @Override
    public Authentication authenticate(Authentication authentication)
            throws AuthenticationException {

        String username = authentication.getName();
        String password = String.valueOf(authentication.getCredentials());

        proxy.sendAuth(username, password);

        return new UsernamePasswordAuthenticationToken(username, password);
    }

    @Override
    public boolean supports(Class<?> aClass) {
        return UsernamePasswordAuthentication.class.isAssignableFrom(aClass);
    }
}
```

The OTP provider is the one that actually decides — proxy the check, and either
return an `Authentication` or throw:

```java
@Component
public class OtpAuthenticationProvider implements AuthenticationProvider {

    @Autowired
    private AuthenticationServerProxy proxy;

    @Override
    public Authentication authenticate(Authentication authentication)
            throws AuthenticationException {

        String username = authentication.getName();
        String code = String.valueOf(authentication.getCredentials());

        boolean result = proxy.sendOTP(username, code);

        if (result) {
            return new OtpAuthentication(username, code);
        } else {
            throw new BadCredentialsException("Bad credentials.");
        }
    }

    @Override
    public boolean supports(Class<?> aClass) {
        return OtpAuthentication.class.isAssignableFrom(aClass);
    }
}
```

The `authenticate()`/`supports()` split, the `null`-versus-throw rules, and how
`ProviderManager` tries providers in turn are the subject of
`spring-security-authentication-provider-contract` — worth reading first if any of
the above looks arbitrary. Note also what is *absent* here: no `UserDetailsService`,
no `PasswordEncoder`. The business logic server doesn't manage users at all, so
the standard building blocks from `spring-security-user-management` live entirely
in the other application.

### The `/login` filter: dispatching both steps and minting the JWT

The book considers two designs — three `Authentication` types plus three
providers behind one filter, or two of each plus a *second* filter dedicated to
token validation — and picks the second, because it exercises multiple custom
filters and `OncePerRequestFilter.shouldNotFilter()`.

`InitialAuthenticationFilter` runs only on `/login`, and decides which step it's
in by whether a `code` header is present:

```java
@Component
public class InitialAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private AuthenticationManager manager;

    @Value("${jwt.signing.key}")
    private String signingKey;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain)
                throws ServletException, IOException {

        String username = request.getHeader("username");
        String password = request.getHeader("password");
        String code = request.getHeader("code");

        if (code == null) {
            Authentication a =
                new UsernamePasswordAuthentication(username, password);
            manager.authenticate(a);
        } else {
            Authentication a = new OtpAuthentication(username, code);
            a = manager.authenticate(a);

            SecretKey key = Keys.hmacShaKeyFor(
                signingKey.getBytes(StandardCharsets.UTF_8));

            String jwt = Jwts.builder()
                .setClaims(Map.of("username", username))
                .signWith(key)
                .compact();

            response.setHeader("Authorization", jwt);
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getServletPath().equals("/login");
    }
}
```

Two things to notice. First, neither branch calls
`filterChain.doFilter(...)` — `/login` is terminal, handled entirely by the
filter, with no controller behind it. Second, the JWT is only ever built on the
line *after* `manager.authenticate(a)` returns; since `OtpAuthenticationProvider`
throws on a bad code, an invalid OTP can never reach the token-minting code.

The signing key is symmetric and known only to the business logic server — the
same key signs and later verifies. The book flags, as an exercise, that a
real system would use a *per-user* key, because then invalidating every token
for one user is a single key rotation.

### The bearer-token filter: validating without asking anyone

`JwtAuthenticationFilter` is the inverse, and runs on everything *except*
`/login`. It reads the token from the `Authorization` header, verifies the
signature, rebuilds an `Authentication`, and puts it in the `SecurityContext`:

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Value("${jwt.signing.key}")
    private String signingKey;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain)
                throws ServletException, IOException {

        String jwt = request.getHeader("Authorization");

        SecretKey key = Keys.hmacShaKeyFor(
            signingKey.getBytes(StandardCharsets.UTF_8));

        Claims claims = Jwts.parserBuilder()
            .setSigningKey(key)
            .build()
            .parseClaimsJws(jwt)
            .getBody();

        String username = String.valueOf(claims.get("username"));

        GrantedAuthority a = new SimpleGrantedAuthority("user");
        var auth = new UsernamePasswordAuthentication(username, null, List.of(a));

        SecurityContextHolder.getContext().setAuthentication(auth);

        filterChain.doFilter(request, response);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getServletPath().equals("/login");
    }
}
```

`parseClaimsJws()` both parses and *verifies*: a tampered token throws rather
than returning bad claims. The three-argument `UsernamePasswordAuthentication`
constructor is used here on purpose — this instance is finished, authenticated,
and carries authorities, so no provider is consulted at all. Contrast this with
HTTP Basic and form login (`spring-security-http-basic-and-form-login`): same
`SecurityContext` destination, completely different mechanism getting there — no
`AuthenticationManager`, no credential comparison, no session.

### Wiring both filters into the configuration

Five things have to line up: both filters in the chain, CSRF off, both providers
registered with the `AuthenticationManager`, every request authenticated, and the
`AuthenticationManager` published as a bean so the filter can inject it.

```java
@Configuration
public class SecurityConfig extends WebSecurityConfigurerAdapter {

    @Autowired private InitialAuthenticationFilter initialAuthenticationFilter;
    @Autowired private JwtAuthenticationFilter jwtAuthenticationFilter;
    @Autowired private OtpAuthenticationProvider otpAuthenticationProvider;
    @Autowired private UsernamePasswordAuthenticationProvider
        usernamePasswordAuthenticationProvider;

    @Override
    protected void configure(AuthenticationManagerBuilder auth) {
        auth.authenticationProvider(otpAuthenticationProvider)
            .authenticationProvider(usernamePasswordAuthenticationProvider);
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.csrf().disable();

        http.addFilterAt(
                initialAuthenticationFilter, BasicAuthenticationFilter.class)
            .addFilterAfter(
                jwtAuthenticationFilter, BasicAuthenticationFilter.class);

        http.authorizeRequests().anyRequest().authenticated();
    }

    @Override
    @Bean
    protected AuthenticationManager authenticationManager() throws Exception {
        return super.authenticationManager();
    }
}
```

CSRF protection is disabled deliberately, not lazily: CSRF defenses exist to stop
a browser from silently attaching *ambient* credentials (a session cookie) to a
cross-origin request. A token that the client must read and explicitly attach to
a header is not ambient — the JWT here plays the role the CSRF token otherwise
would.

### Testing the whole system

Both applications running (auth server on 8080, business server on 9090), three
cURL calls reproduce the three steps:

```bash
# 0. seed a user on the authentication server
curl -XPOST -H "content-type: application/json" \
  -d '{"username":"danielle","password":"12345"}' \
  http://localhost:8080/user/add

# 1. username + password -> OTP lands in the otp table (stand-in for SMS)
curl -H "username:danielle" -H "password:12345" \
  http://localhost:9090/login

# 2. username + OTP -> JWT comes back in the Authorization *response* header
curl -v -H "username:danielle" -H "code:6271" \
  http://localhost:9090/login
# < HTTP/1.1 200
# < Authorization: eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFP...

# 3. the token opens the protected endpoint
curl -H "Authorization:eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFP..." \
  http://localhost:9090/test
# Test
```

Step 1 verifiably wrote a four-digit code into the `otp` table, and the stored
password is a bcrypt hash (`$2a$10$...`), different on every run because bcrypt
salts.

### Book vs. today: the jjwt API this chapter uses has been rewritten

The book pins `io.jsonwebtoken:jjwt-api` / `jjwt-impl` / `jjwt-jackson` at
**0.11.1**. jjwt's **0.12.0** release reworked the API broadly, and essentially
every call in the two filters above has a modern replacement (confirmed against
jjwt's current changelog and README; latest release is **0.13.0**, documented as
the final Java 7-compatible line — 0.14.0 and later require Java 8+):

| Book (0.11.x) | Current (0.12+) |
| --- | --- |
| `Jwts.builder().setClaims(map)` | `.claims().add(map).and()`, or `.claim("username", username)` |
| `Jwts.parserBuilder()` | `Jwts.parser()` (now returns a `JwtParserBuilder`; `parserBuilder()` is gone as redundant) |
| `.setSigningKey(key)` | `.verifyWith(key)` |
| `.parseClaimsJws(jwt)` | `.parseSignedClaims(jwt)` |
| `.getBody()` | `.getPayload()` |
| `setSubject`/`setExpiration`/`setIssuedAt` | `subject()`/`expiration()`/`issuedAt()` |

So the same two operations, written against the current library:

```java
String jwt = Jwts.builder()
    .claim("username", username)
    .issuedAt(Date.from(now))
    .expiration(Date.from(now.plus(Duration.ofMinutes(15))))
    .signWith(key)
    .compact();

Claims claims = Jwts.parser()
    .verifyWith(key)
    .build()
    .parseSignedClaims(jwt)
    .getPayload();
```

The runtime-scoped `jjwt-impl` and a JSON provider (`jjwt-jackson` or
`jjwt-gson`) are still required alongside `jjwt-api`. `Keys.hmacShaKeyFor(byte[])`
still exists and still throws `WeakKeyException` for anything under 256 bits, per
RFC 7518 §3.2 — so the book's truncated `jwt.signing.key=ymLTU8rq83…` must in
practice be at least 32 bytes of real entropy, and RFC 8725 §3.5 is explicit that
a human-memorizable password must never be used directly as an HMAC key. The
`jakarta.xml.bind` / `jaxb-runtime` dependencies the book adds "if you use Java 10
or above" are no longer needed for current jjwt on a modern JDK.

### Book vs. today: the Spring Security scaffolding around it

Independent of jjwt, both applications' configuration is written in a style that
no longer compiles on Spring Security 6+:

- `WebSecurityConfigurerAdapter` was deprecated in 5.7 and removed in 6.0 — a
  `SecurityFilterChain` `@Bean` taking `HttpSecurity` replaces both `configure()`
  overrides.
- `authorizeRequests()` gives way to `authorizeHttpRequests()`, and the Lambda
  DSL becomes mandatory in Spring Security 7 (no-arg configurer calls and `.and()`
  chaining are both going away), per the current migration guide. `csrf().disable()`
  becomes `csrf(AbstractHttpConfigurer::disable)`.
- Overriding `authenticationManager()` is replaced by either building a
  `ProviderManager` from your providers directly, or injecting
  `AuthenticationConfiguration` and returning `config.getAuthenticationManager()`.
- `javax.servlet.*` became `jakarta.servlet.*`. `OncePerRequestFilter`,
  `doFilterInternal()`, and `shouldNotFilter()` are otherwise unchanged — verified
  against the current Spring Framework javadoc — as are `addFilterAt()` /
  `addFilterAfter()` with `BasicAuthenticationFilter.class` as the anchor.
- `SecurityContextHolder.getContext().setAuthentication(auth)` — used by
  `JwtAuthenticationFilter` — is now explicitly discouraged in the reference docs
  in favor of `SecurityContextHolder.createEmptyContext()`, setting the
  authentication on that fresh context, then `SecurityContextHolder.setContext(...)`,
  to avoid races against other threads sharing the context.

### Book vs. today: this is the problem OAuth 2 standardizes

The most important framing is architectural, not syntactic. Nothing about the
wire format here is standard: the credentials travel in ad-hoc `username` /
`password` / `code` request headers, the issued token comes back in an
`Authorization` *response* header, and the client sends it back as a bare token
with no `Bearer ` prefix. Two teams building this pattern independently would
produce two incompatible systems.

OAuth 2 and OIDC are precisely the standardization of this shape, and Spring
Security ships the machinery:

- The hand-written authentication server becomes an **authorization server** —
  today, Spring Authorization Server, which provides the token, JWK set,
  introspection, revocation, and metadata endpoints, and issues either
  self-contained JWTs or opaque reference tokens.
- The hand-written `JwtAuthenticationFilter` becomes Spring Security's
  **resource server** support: `oauth2ResourceServer(oauth2 -> oauth2.jwt(...))`
  installs a `BearerTokenAuthenticationFilter` that reads
  `Authorization: Bearer <token>`, produces a `BearerTokenAuthenticationToken`,
  and hands it to `JwtAuthenticationProvider`, which decodes via a `JwtDecoder`
  (`NimbusJwtDecoder.withSecretKey(...)` for a symmetric key,
  `withJwkSetUri(...)` / `withIssuerLocation(...)` for asymmetric), maps claims to
  authorities through `JwtAuthenticationConverter`, and yields a
  `JwtAuthenticationToken`. Configuration collapses to
  `spring.security.oauth2.resourceserver.jwt.issuer-uri` (plus optional
  `jwk-set-uri`, `audiences`, `jws-algorithms`).
- The per-request validation call this chapter's proxy makes is standardized as
  token introspection (RFC 7662) for opaque tokens — and eliminated entirely for
  signed JWTs, which the resource server verifies locally against rotating keys
  fetched from the JWK set.

Read this chapter, then, as the mechanism lesson that makes the next four
chapters legible: OAuth 2 fundamentals and grant types, the OAuth 2 client and
SSO, the authorization server, the resource server, and JWT signing all describe
the *standard* version of what was just built by hand. Do not ship these classes.

## Trade-offs

- **A signed JWT with no `exp` claim never expires.** The book's payload is
  `{"username": "danielle"}` and nothing else, so a leaked token is valid
  forever — which quietly forfeits two of the five advantages the chapter itself
  lists for tokens (short lifetime, invalidation). Any real implementation needs
  at least `exp`, and a parser that enforces it. RFC 8725 additionally pushes for
  validating `alg` and `aud`; a self-signed, single-audience token skips both.
- **One symmetric signing key for all users is the simplest thing and the least
  revocable.** The book says so outright and leaves per-user keys as an exercise:
  with a shared key, revoking one user's tokens means rotating the key for
  everyone. With a symmetric key, "can verify" and "can mint" are also the same
  capability, so the key cannot be shared with any other service — an asymmetric
  key pair (private to the issuer, public to verifiers) is what makes multi-service
  verification possible, which is exactly why OAuth 2 setups publish a JWK set.
- **Statelessness is the feature and the constraint.** Because step 3 consults
  neither the authentication server nor a session store, the business logic server
  scales horizontally with no shared state — and by the same token there is
  nowhere to record "this token is revoked." Regaining revocation means
  reintroducing state (a denylist, opaque tokens plus introspection) and giving up
  part of what the token bought.
- **A hand-rolled wire format is an interoperability dead end.** Ad-hoc
  `username`/`code` headers, a token in an `Authorization` *response* header, and a
  bearer credential with no `Bearer ` scheme mean no off-the-shelf client, gateway,
  or proxy understands this system. The mechanism is durable; the format is not.
- **`shouldNotFilter()` is negative-space configuration, and the two filters must
  agree exactly.** `InitialAuthenticationFilter` runs when the path *is* `/login`,
  `JwtAuthenticationFilter` when it *isn't* — one typo and either `/login` demands a
  token that doesn't exist yet, or a protected endpoint runs with no
  authentication filter at all. The condition is also exact string equality on
  `getServletPath()`, so `/login/` or a differently-mapped context slips through.
- **The filters skip everything a production filter needs.** The book flags this
  itself: no exception handling, no logging, no auditing of failed attempts, no
  null-check on a missing `Authorization` header (which raises an exception from
  deep inside jjwt rather than returning a clean `401`).
- **The simplification of proxying passwords through the business logic server is
  a real anti-pattern, acknowledged as such.** Credentials should be known to as
  few components as possible; here they pass through a second service, and the two
  servers don't authenticate *each other* at all (the book leaves securing that hop
  with a symmetric or asymmetric key as an exercise). OAuth 2's redirect-based
  grants exist precisely so the client's password never touches the resource
  server.
- **Pedagogically this chapter is essential and operationally it is obsolete.**
  Hand-building the flow is what makes `BearerTokenAuthenticationFilter`,
  `JwtDecoder`, and a JWK set endpoint feel like named solutions rather than
  magic — but production systems use Spring Security's resource-server support and
  Spring Authorization Server (or a managed IdP), not these classes.

## Documentation Links

- [Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 11, "Hands-on: A separation of responsibilities", sections 11.1-11.4.6, p. 245-283](https://www.manning.com/books/spring-security-in-action) — doc
- [jjwt — README / current API (Jwts.builder, Jwts.parser, parseSignedClaims)](https://github.com/jwtk/jjwt) — doc
- [jjwt — CHANGELOG (0.12.0 API rework, 0.13.0 release)](https://github.com/jwtk/jjwt/blob/main/CHANGELOG.md) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server JWT (BearerTokenAuthenticationFilter, JwtDecoder, NimbusJwtDecoder)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security Reference — Authentication Architecture (ProviderManager, SecurityContextHolder.createEmptyContext)](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html) — doc
- [Spring Security Reference — Configuration Migrations to Spring Security 7 (Lambda DSL, .and() removal)](https://docs.spring.io/spring-security/reference/6.5/migration-7/configuration.html) — doc
- [Spring Authorization Server Reference — Overview](https://docs.spring.io/spring-authorization-server/reference/overview.html) — doc
- [Spring Framework API — OncePerRequestFilter (doFilterInternal, shouldNotFilter)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/filter/OncePerRequestFilter.html) — doc
- [RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725) — doc
- [RFC 7518 — JSON Web Algorithms (§3.2, minimum HMAC key size)](https://datatracker.ietf.org/doc/html/rfc7518#section-3.2) — doc
