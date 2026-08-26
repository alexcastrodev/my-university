---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Understand the last component of the OAuth 2 puzzle: the **resource server**, the
application that holds the user's data and must decide whether to honor an access
token it *did not issue and cannot inspect on its own*. That single constraint —
"someone handed me an opaque string, is it real, and who does it belong to?" —
generates exactly three answers, and the book walks two of them: ask the
authorization server on every request (**remote token check**), or share a datastore
with the authorization server (**blackboarding**). The third, validating a
cryptographic signature locally with no round-trip at all, is chapter 15's job (see
`spring-security-jwt-signing-symmetric-and-asymmetric`). Today the first approach is
standardized as **OAuth 2.0 Token Introspection (RFC 7662)** and configured with
`.opaqueToken(...)`; the third is `.jwt(...)`; and blackboarding survives only as a
custom `OpaqueTokenIntrospector`, never as the book's `TokenStore`.

## Use Cases

- Protecting a REST API with `Authorization: Bearer ...` when tokens come from an
  authorization server you run (`spring-security-oauth2-authorization-server`) or a
  third-party IdP (Keycloak, Auth0, Okta, Entra ID).
- Choosing a validation strategy under a real constraint: "we must be able to revoke
  a token within seconds" pushes you to introspection; "the API must survive the IdP
  being down" pushes you to signature validation.
- Migrating an existing `@EnableResourceServer` / `ResourceServerConfigurerAdapter`
  service off the end-of-life Spring Security OAuth project.
- Deciding whether the shared token table your team inherited (the blackboarding
  pattern) should be kept, replaced by introspection, or replaced by JWTs.
- Reading the token's identity and scopes inside a controller — `JwtAuthenticationToken`
  / `BearerTokenAuthentication`, `SCOPE_` authorities — instead of re-parsing headers.

## Deep Dive

### The resource server's one hard problem

The resource server manages and protects the user's resources. It never sees the
user's credentials, never runs a grant flow, and (with opaque tokens) cannot read
anything out of the token itself — the book's authorization server issues a bare
UUID like `4f2b7a6d-ced2-43dc-86d7-cbe844d3e16b`. So every design here is about how
the resource server acquires the two facts it needs: **is this token valid**, and
**what authorities does it carry**.

```mermaid
flowchart TB
    Client["Client<br/>Authorization: Bearer f124abc…"]
    RS["Resource server<br/>/hello"]
    AS["Authorization server"]
    DB[("Shared database<br/>oauth_access_token")]
    JWK["JWK set / public key<br/>(fetched once, cached)"]

    Client -->|"1. request + token"| RS

    RS -->|"A. remote check: 1 call per request<br/>POST /oauth/check_token (RFC 7662 /oauth2/introspect)"| AS
    AS -.->|"active, sub, scope, exp"| RS

    RS -->|"B. blackboarding: read the token row"| DB
    AS -.->|"writes the token on issue"| DB

    RS -->|"C. local validation: verify signature offline"| JWK
    AS -.->|"publishes keys once"| JWK
```

Path A costs a network hop per request and couples availability. Path B removes the
direct call but adds a shared component both servers depend on. Path C costs nothing
per request but gives up instant revocation. There is no free option.

### The book's resource server: one annotation, no validation

```xml
<dependency>
   <groupId>org.springframework.boot</groupId>
   <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
<dependency>
   <groupId>org.springframework.cloud</groupId>
   <artifactId>spring-cloud-starter-oauth2</artifactId>
</dependency>
```

```java
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello() {
        return "Hello!";
    }
}
```

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig {
}
```

That is a running resource server — and a useless one. It rejects every request,
including requests carrying perfectly valid tokens, because no validation strategy
has been configured. The book is explicit that `@EnableResourceServer` (Spring
Security OAuth) was already marked deprecated when it was written, and points at the
OAuth 2.0 Migration Guide.

### Approach 1 — checking the token remotely

The mechanism is two steps: the authorization server exposes an endpoint that, given
a token, returns whether it is active plus the details behind it; the resource server
calls that endpoint on every request with an unknown token.

Spring Security OAuth's authorization server already implements `/oauth/check_token`,
but denies all access to it by default. You open it by overriding one more `configure`
method:

```java
@Configuration
@EnableAuthorizationServer
public class AuthServerConfig
    extends AuthorizationServerConfigurerAdapter {

    public void configure(
        AuthorizationServerSecurityConfigurer security) {
        security.checkTokenAccess("isAuthenticated()");
    }
}
```

`permitAll()` also works and is exactly as bad an idea as it sounds. With
`isAuthenticated()`, the resource server becomes *a client of the authorization
server* and needs its own registration — no grant types, no scopes, just credentials
for HTTP Basic on the introspection call:

```java
clients.inMemory()
       .withClient("client")
       .secret("secret")
       .authorizedGrantTypes("password", "refresh_token")
       .scopes("read")
       .and()
       .withClient("resourceserver")
       .secret("resourceserversecret");
```

Calling it by hand shows exactly what the resource server gets back:

```bash
curl -XPOST -u resourceserver:resourceserversecret \
  "http://localhost:8080/oauth/check_token?token=4f2b7a6d-ced2-43dc-86d7-cbe844d3e16b"
```

```json
{
    "active":true,
    "exp":1581307166,
    "user_name":"john",
    "authorities":["read"],
    "client_id":"client",
    "scope":["read"]
}
```

Four facts: still active and when it expires, who it was issued for, the privileges,
and which client obtained it. On the resource server side the whole configuration is
properties:

```properties
server.port=9090
security.oauth2.resource.token-info-uri=http://localhost:8080/oauth/check_token
security.oauth2.client.client-id=resourceserver
security.oauth2.client.client-secret=resourceserversecret
```

```bash
curl -H "Authorization: bearer 4f2b7a6d-ced2-43dc-86d7-cbe844d3e16b" \
  "http://localhost:9090/hello"
```

The `bearer` prefix is case-insensitive. Without a token you get `401` with
`{"error":"unauthorized"}`.

The advantage is that this works with *any* token format — the resource server never
parses anything. The disadvantages the book stresses: load on the authorization
server, and the fact that the network is not 100% reliable. If the link between the
two servers is down, a client holding a completely valid token is refused access.

### Approach 2 — blackboarding with a `JdbcTokenStore`

Both servers write to and read from the same "blackboard": the authorization server
stores each issued token, the resource server looks it up. No direct call between
them.

The contract on both sides is `TokenStore`. On the authorization server it sits where
`SecurityContext` would sit in a session-based app — authentication finishes, the
token store produces a token. On the resource server the authentication filter uses
the same contract in reverse: look the token up, retrieve the user details, put them
in the security context for authorization. The default is `InMemoryTokenStore`, which
is why every earlier example lost all its tokens on restart.

`JdbcTokenStore` is `JdbcUserDetailsManager` for tokens. It expects two tables with
fixed default names (overridable by replacing the SQL):

```sql
CREATE TABLE IF NOT EXISTS `oauth_access_token` (
    `token_id` varchar(255) NOT NULL,
    `token` blob,
    `authentication_id` varchar(255) DEFAULT NULL,
    `user_name` varchar(255) DEFAULT NULL,
    `client_id` varchar(255) DEFAULT NULL,
    `authentication` blob,
    `refresh_token` varchar(255) DEFAULT NULL,
     PRIMARY KEY (`token_id`));

CREATE TABLE IF NOT EXISTS `oauth_refresh_token` (
    `token_id` varchar(255) NOT NULL,
    `token` blob,
    `authentication` blob,
    PRIMARY KEY (`token_id`));
```

Authorization server — inject the `DataSource`, hand the store to the endpoints
configurer:

```java
@Override
public void configure(
    AuthorizationServerEndpointsConfigurer endpoints) {
    endpoints
        .authenticationManager(authenticationManager)
        .tokenStore(tokenStore());
}

@Bean
public TokenStore tokenStore() {
    return new JdbcTokenStore(dataSource);
}
```

Resource server — the same bean, handed to a different configurer:

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {

    @Autowired
    private DataSource dataSource;

    @Override
    public void configure(
        ResourceServerSecurityConfigurer resources) {
        resources.tokenStore(tokenStore());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JdbcTokenStore(dataSource);
    }
}
```

Issue a token and it appears as a row in `oauth_access_token` (and, if the client has
`refresh_token`, in `oauth_refresh_token`). Because the database persists them, the
resource server keeps validating tokens **even while the authorization server is down
or restarting** — the one capability neither of the other two approaches gives you.

Two footnotes the book adds and that are easy to miss. First, `JdbcTokenStore` is
useful even *without* blackboarding: persist tokens on the authorization server only
and keep using `/oauth/check_token`, so a restart doesn't invalidate every outstanding
token. Second — and this is the pivotal sentence for the modern reader — "writing the
configuration of the resource server without Spring Security OAuth makes it impossible
to use the blackboarding approach." Blackboarding was a `TokenStore` feature, and
`TokenStore` did not survive.

There is also a degenerate case worth naming: authorization server and resource server
are two *responsibilities*, not necessarily two *applications*. Put both in one app and
they share the same beans — same token store, no network call, no shared database.

### The book's comparison, plus the option it defers

| Approach | Advantages | Disadvantages |
| --- | --- | --- |
| Directly calling the authorization server | Easy to implement; works with any token implementation | Direct dependency between the two servers; unnecessary stress on the authorization server |
| Shared database (blackboarding) | No direct communication between servers; works with any token implementation; authorization keeps working after an authorization server restart or outage | Harder to implement; one more component in the system; the shared database can become a bottleneck |

The summary of chapter 14 is blunter than the table: of remote checking, "I generally
avoid using this approach." And chapter 15 opens by naming all three options together —
direct calls (14.2), shared database (14.3), and cryptographic signatures — noting
that signatures let the resource server validate "without needing to call the
authorization server directly and without needing a shared database," and that this is
what systems implementing OAuth 2 commonly use.

### Book vs. today: `.opaqueToken()` is 14.2, and `.jwt()` won

The DSL the book shows in a sidebar as the not-yet-mature alternative is now *the*
API, and both branches of it are first-class, documented, Boot-auto-configured options
in current Spring Security.

**What survived, verbatim in spirit.** The book's sidebar already contains
`oauth2ResourceServer(c -> c.opaqueToken(o -> { o.introspectionUri("…");
o.introspectionClientCredentials("client", "secret"); }))`. That is still the shape of
the API. What changed is the container: `WebSecurityConfigurerAdapter` was deprecated
in Spring Security 5.7 and removed in 6.0, so it is now a `SecurityFilterChain` bean —
and the extra manual dependencies the book had to list (a hard-pinned
`spring-security-oauth2-resource-server:5.2.1.RELEASE`, plus `com.nimbusds:oauth2-oidc-sdk`)
are gone: `spring-boot-starter-oauth2-resource-server` is a real Boot starter that
brings what each mode needs.

**Remote token check, today.** The book's `/oauth/check_token` was Spring Security
OAuth's own endpoint, though its response already had the RFC-7662 shape (note the
`active` field). Today it is standardized: **OAuth 2.0 Token Introspection, RFC 7662**.
Spring Authorization Server exposes it at `/oauth2/introspect` by default, configurable
via `OAuth2TokenIntrospectionEndpointConfigurer` and served by
`OAuth2TokenIntrospectionEndpointFilter`. On the resource server, the entire feature is
three properties:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        opaquetoken:
          introspection-uri: https://idp.example.com/introspect
          client-id: client
          client-secret: secret
```

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests((authorize) -> authorize
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer((oauth2) -> oauth2
            .opaqueToken(Customizer.withDefaults())
        );
    return http.build();
}
```

Behind that: `OpaqueTokenAuthenticationProvider` delegates to an
`OpaqueTokenIntrospector` (default `SpringOpaqueTokenIntrospector` — its
`(introspectionUri, clientId, clientSecret)` constructor is deprecated since 6.5 in
favor of `SpringOpaqueTokenIntrospector.withIntrospectionUri(...)...build()`;
`RestClientOpaqueTokenIntrospector` is the variant to use when you need custom
timeouts or a preconfigured `RestClient`). Success yields a
`BearerTokenAuthentication` whose principal is an `OAuth2AuthenticatedPrincipal`
carrying the introspection response as attributes, `getName()` mapped from `sub`, and
each scope exposed as a `SCOPE_`-prefixed `GrantedAuthority`. The book's per-request
network call is unchanged — that is inherent to the approach, not a legacy artifact.

**Local validation, today** — the chapter-15 option, for completeness of the comparison
only:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com/issuer
```

```java
.oauth2ResourceServer((oauth2) -> oauth2.jwt(Customizer.withDefaults()))
```

`NimbusJwtDecoder` discovers the JWK set from the issuer's metadata endpoint, caches
the keys, validates signature plus `exp`/`nbf`/`iss` locally, and produces a
`JwtAuthenticationToken` with `SCOPE_` authorities. One detail that directly answers
14.2's complaint about network fragility: that discovery happens **on the first request
carrying a JWT, not at startup**, so resource server startup is not coupled to
authorization server availability.

**Is blackboarding still a thing? Honest verdict: as an architecture, no; as an
extension point, yes — and it is not the same thing.**

- `TokenStore`, `JdbcTokenStore`, `InMemoryTokenStore`, `@EnableResourceServer` and
  `ResourceServerConfigurerAdapter` all belong to Spring Security OAuth, which reached
  end-of-life on 1 June 2022 and was archived. `JdbcTokenStore` was **never ported**;
  the request to bring it into Spring Security (issue #9381, filed by someone wanting
  exactly the book's stateless multi-instance token cache) was closed as a duplicate,
  not implemented. The OAuth 2.0 Migration Guide covers `@EnableResourceServer` →
  `oauth2ResourceServer` and the SpEL change from `#oauth2.hasScope('x')` to
  `hasAuthority("SCOPE_x")`, but offers no `TokenStore` replacement at all.
- Spring Authorization Server *does* have a persistent token store —
  `OAuth2AuthorizationService`, with `InMemoryOAuth2AuthorizationService` (development
  and testing only) and `JdbcOAuth2AuthorizationService`. But it is documented purely
  as internal authorization-server state used for client authentication, grant
  processing, introspection and revocation. Nothing in the reference docs suggests
  pointing a resource server at it, and doing so would mean a second application
  reading another application's private schema — which is what "distributed monolith"
  means.
- What *is* sanctioned is the seam. `OpaqueTokenIntrospector`'s javadoc says it
  outright: "A typical implementation of this interface will make a request to an
  OAuth 2.0 Introspection Endpoint… **Another sensible implementation of this interface
  would be to query a backing store of tokens, for example a distributed cache.**" So
  the blackboard idea has an official hook — a one-method bean
  (`OAuth2AuthenticatedPrincipal introspect(String token)`) that reads Redis, a
  database, or anything else instead of calling the network.

The realistic reading: the *shape* survives, the *motivation* mostly evaporated. The
book invented blackboarding because the tooling of the day gave it a `TokenStore` on
both sides and an awkward proprietary `check_token` call, and because opaque UUID
tokens were the default. Today the default token is a signed JWT, so the per-request
lookup that blackboarding existed to avoid usually isn't there in the first place. The
most common real use of a custom `OpaqueTokenIntrospector` backed by a store is not
replacing introspection — it is **caching** introspection responses so a hot API
doesn't hammer the IdP, which addresses 14.2's real complaint without inviting 14.3's
shared-schema coupling. Blackboarding as "let both servers own the same token table"
is a pattern you should recognize in legacy code and migrate off, not one to start.

**The three approaches, compared on what actually decides it:**

| | Remote introspection (14.2 / `.opaqueToken()`) | Blackboarding (14.3, shared DB) | Local JWT validation (ch. 15 / `.jwt()`) |
| --- | --- | --- | --- |
| Per-request cost | 1 network round-trip to the IdP | 1 database query | none (signature check in-process) |
| Coupling | runtime coupling to IdP availability | both servers coupled to one schema | build-time trust only; keys fetched lazily and cached |
| Survives IdP outage | no — valid tokens are refused | yes, tokens live in the DB | yes, until the JWK set must be refreshed |
| Revocation | immediate — `active:false` on the next call | immediate — delete the row | not until expiry (needs short TTLs, denylists, or introspection alongside) |
| Token format | any, including opaque UUIDs | any | must be a signed JWT |
| Scales by | scaling the IdP | scaling the shared DB | scaling the resource servers freely |
| Modern support | first-class, RFC 7662, Boot-auto-configured | no supported API; only a custom `OpaqueTokenIntrospector` | first-class, the default today |

## Trade-offs

- **The trade is per-request cost against revocation latency, and everything else is
  detail.** Introspection asks the authority every time, so a revoked token dies
  instantly and the API dies with the IdP. A signed JWT asks nobody, so it is fast and
  outage-proof and stays valid until `exp` no matter what the IdP thinks. Short token
  lifetimes are the usual compromise; "JWT plus a denylist" is the usual admission that
  you needed introspection semantics after all.
- **"Any token implementation" is a real advantage of the two book approaches.** Both
  work with opaque UUIDs; local validation requires the authorization server to issue
  signed, self-contained tokens. If you don't control the IdP and it hands out opaque
  strings, `.opaqueToken()` is not a fallback, it's the only option.
- **Blackboarding trades a network dependency for a data dependency, which is usually
  a worse trade.** The book already names the bottleneck; the sharper cost is schema
  coupling — the resource server now breaks when the authorization server changes how
  it stores tokens. The book's own carve-out is the honest one: if your services
  already share a database, adding tokens to it changes nothing architecturally.
- **Persisting tokens and blackboarding are separable, and the book says so.** Using a
  `JdbcTokenStore` on the authorization server alone, still validating via
  `check_token`, buys survival across restarts without any shared-schema coupling.
  That decomposition is still the right instinct today: "should tokens be durable?" and
  "who reads them?" are two questions.
- **The introspection endpoint needs protecting, and the resource server becomes a
  client.** `checkTokenAccess("isAuthenticated()")` plus its own registration is not
  ceremony — an open introspection endpoint is a free oracle for testing stolen tokens.
  Modern equivalents keep the same posture: `introspection-uri` comes with `client-id`
  and `client-secret`.
- **A shared cache read through a custom `OpaqueTokenIntrospector` is the legitimate
  descendant of blackboarding, and it is best used as a cache, not as the source of
  truth.** Caching introspection responses for a few seconds removes most of the load
  the book worries about while keeping the IdP authoritative; making the cache
  authoritative reintroduces every coupling problem 14.3 had.
- **Same responsibility, one application, no problem.** If the authorization server and
  resource server live in the same app they share beans — no call, no shared database,
  no comparison table. Splitting them is a deployment decision that *creates* this
  chapter's problem; make it deliberately.
- **Everything structural in this chapter's code is gone, but nothing conceptual is.**
  `@EnableResourceServer`, `ResourceServerConfigurerAdapter`, `TokenStore` and
  `WebSecurityConfigurerAdapter` are all removed or EOL. The three validation
  strategies, their costs, and the reason a resource server must pick one are exactly
  as the book describes them.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 14, "OAuth 2: Implementing the resource server", sections 14.1-14.4, p. 341-359](https://www.manning.com/books/spring-security-in-action) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server (overview: JWT vs Opaque Tokens)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server: Opaque Token (RFC 7662 introspection)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server: JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security API — OpaqueTokenIntrospector ("query a backing store of tokens, for example a distributed cache")](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/oauth2/server/resource/introspection/OpaqueTokenIntrospector.html) — doc
- [Spring Security API — SpringOpaqueTokenIntrospector](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/oauth2/server/resource/introspection/SpringOpaqueTokenIntrospector.html) — doc
- [Spring Authorization Server Reference — Protocol Endpoints (OAuth2 Token Introspection Endpoint, default paths)](https://docs.spring.io/spring-authorization-server/reference/protocol-endpoints.html) — doc
- [Spring Authorization Server Reference — Core Model / Components (OAuth2AuthorizationService, JdbcOAuth2AuthorizationService)](https://docs.spring.io/spring-authorization-server/reference/core-model-components.html) — doc
- [GitHub Wiki — OAuth 2.0 Migration Guide (@EnableResourceServer to oauth2ResourceServer)](https://github.com/spring-projects/spring-security/wiki/OAuth-2.0-Migration-Guide) — doc
- [GitHub — spring-security issue #9381, "Introduce JdbcTokenStore" (closed as duplicate; never ported)](https://github.com/spring-projects/spring-security/issues/9381) — doc
- [Spring Boot Reference — Spring Security (spring-boot-starter-oauth2-resource-server auto-configuration)](https://docs.spring.io/spring-boot/reference/web/spring-security.html) — doc
- [RFC 7662 — OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662) — doc
