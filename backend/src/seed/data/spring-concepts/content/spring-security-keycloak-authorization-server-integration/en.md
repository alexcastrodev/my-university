---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Chapter 13 built an authorization server *in code*; chapters 14 and 15 built a
resource server that trusts the JWTs it mints. This chapter changes exactly one
variable: the issuer is now **Keycloak**, a real, downloadable, production-grade
identity provider, instead of a Spring class you wrote. Nothing about the resource
server's job changes — it still receives `Authorization: Bearer <jwt>`, still
validates the signature against a JWK set endpoint, still turns claims into
`GrantedAuthority` objects. What changes is *where the configuration lives*: users,
clients, scopes, roles and even the shape of the token's claims move out of Java and
into an admin console. This concept is the hands-on end of the OAuth 2 arc — the
answer to "so do I actually write an authorization server?" is usually "no, you run
one," and this is what that looks like.

## Use Cases

- Standing up a local OAuth 2 / OIDC provider for development without writing a line
  of authorization-server code — realm, client, users and roles configured in a UI.
- Pointing an existing Spring Boot resource server at a corporate identity provider
  (Keycloak, Okta, Auth0, Entra ID) — the `issuer-uri` is the only thing that
  meaningfully differs between them.
- Mapping an identity provider's *own* role model (Keycloak realm roles and client
  roles) onto Spring's `GrantedAuthority` model, so `hasAuthority(...)` and
  `@PreAuthorize` keep working unchanged.
- Enforcing "a user only touches their own data" at three different layers —
  endpoint, service method, repository query — on top of a token the application
  didn't issue.
- Migrating an application off `keycloak-spring-boot-starter`, which Keycloak
  removed.

## Deep Dive

### The scenario: one fitness backend, three rules, two roles

The book's example is a workout-history backend with three use cases, each carrying
its own authorization restriction (sections 18.1, p. 434-436):

| Endpoint | Rule | Enforced at |
| --- | --- | --- |
| `POST /workout/` | a user can add a record only **for themselves** | service layer (`@PreAuthorize`) |
| `GET /workout/` | a user gets back **only their own** records | repository layer (SpEL in the query) |
| `DELETE /workout/{id}` | only an **admin** may delete | endpoint layer (`hasAuthority`) |

Two roles: `fitnessuser` (add/see own workouts) and `fitnessadmin` (delete anyone's).
The point of spreading the three rules across three layers is deliberate — the book
notes it chose to configure the delete rule at the endpoint level "to cover more ways
for configuring authorization," not because that's the only correct place.

The actors are the standard OAuth 2 four, with Keycloak in the authorization-server
slot:

```mermaid
flowchart LR
    User(["User<br/>(Bill, Rachel, Mary)"])
    Client["Client app<br/>(registered in Keycloak<br/>as 'fitnessapp')"]
    KC["Keycloak realm<br/>· users + credentials<br/>· realm/client roles<br/>· protocol mappers<br/>· /protocol/openid-connect/token<br/>· /protocol/openid-connect/certs (JWKS)"]
    RS["Spring Boot resource server<br/>:9090<br/>· validates signature via JWKS<br/>· maps claims to authorities<br/>· enforces the three rules"]

    User -->|"credentials"| Client
    Client -->|"token request"| KC
    KC -->|"signed JWT access token"| Client
    Client -->|"Authorization: Bearer JWT"| RS
    RS -.->|"fetches public keys once,<br/>then validates offline"| KC
```

The dotted line matters: the resource server never calls Keycloak per request. It
fetches the key set, caches it, and validates signatures locally — the cryptographic
approach from `spring-security-jwt-signing-symmetric-and-asymmetric`, with an
asymmetric key pair Keycloak generated for the realm.

### Configuring Keycloak: five things, all in the admin console

Keycloak is downloaded, unzipped and started; on first access you create an admin
account, then log in to the Administration Console (section 18.2, p. 436-440). The
configuration is five conceptual steps — the specific screens have been redesigned
several times since the book, so what matters is *what* each step creates:

1. **A realm.** A realm is an isolated tenant: its own users, roles, clients, and its
   own signing keys. Everything below lives inside one.
2. **A client registration** (`fitnessapp`). Any OAuth 2 system needs at least one
   client the authorization server recognizes; the client is what makes
   authentication requests on behalf of users. The book's minimal registration is
   just a unique client ID.
3. **A client scope** (`fitnessapp`), defined for the `openid-connect` protocol and
   assigned to the client as a default scope. The scope identifies the client's
   purpose — and, crucially, is the hook the book uses in step 5 to customize tokens.
4. **Users** (`bill`, `rachel`, `mary`) with non-temporary passwords. Two practical
   traps the book calls out: a user with pending *required actions* cannot
   authenticate at all, and a password marked **Temporary** implicitly adds the
   "update password" required action — so tokens can't be issued for that user until
   a human logs in and changes it.
5. **Roles** (`fitnessuser`, `fitnessadmin`) created in the realm and assigned to
   users via Role Mappings — Mary gets `fitnessadmin`, Bill and Rachel get
   `fitnessuser`.

Keycloak publishes its OAuth 2 / OIDC endpoints through a standard discovery
document. The book reads them from the OpenID Endpoint Configuration link on the
realm settings page:

```json
{
  "issuer": "http://localhost:8080/auth/realms/master",
  "authorization_endpoint": ".../protocol/openid-connect/auth",
  "token_endpoint": ".../protocol/openid-connect/token",
  "jwks_uri": ".../protocol/openid-connect/certs",
  "grant_types_supported": [
    "authorization_code", "implicit", "refresh_token",
    "password", "client_credentials"
  ]
}
```

That `grant_types_supported` list is worth pausing on: enabling a grant type is a
client-registration decision here exactly as it was in
`spring-security-oauth2-authorization-server` — the same idea, expressed as a
checkbox instead of `authorizedGrantTypes("password")`.

### Obtaining a token, and finding it half-empty

With users configured, a token comes from a plain form-encoded POST to the token
endpoint. The book uses the password grant to keep the example short (p. 446):

```bash
curl -XPOST "http://localhost:8080/auth/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "username=rachel" \
  --data-urlencode "password=12345" \
  --data-urlencode "scope=fitnessapp" \
  --data-urlencode "client_id=fitnessapp"
```

```json
{
  "access_token": "eyJhbGciOiJIUzI…",
  "expires_in": 6000,
  "refresh_token": "eyJhbGciOiJIUz…",
  "token_type": "bearer",
  "scope": "fitnessapp"
}
```

Decode the access token and the interesting part is what's *missing* — no roles, no
username:

```json
{
  "exp": 1585392296,
  "iss": "http://localhost:8080/auth/realms/master",
  "sub": "c42b534f-7f08-4505-8958-59ea65fb3b47",
  "typ": "Bearer",
  "azp": "fitnessapp",
  "scope": "fitnessapp"
}
```

The `sub` is an opaque UUID, not `rachel`. The roles assigned in step 5 aren't there
at all. A resource server handed this token knows *someone* authenticated, and
nothing else useful for the three rules.

### Protocol mappers: bending the token to the resource server's expectations

Keycloak's answer is **protocol mappers**, attached to the client scope (section
18.2.4, p. 448-452). Each mapper copies one piece of information into the token under
a claim name you choose. The book adds three:

- a **roles** mapper writing to the claim `authorities`,
- a **username** mapper writing to the claim `user_name`,
- an **audience** mapper writing `aud: fitnessapp`.

The token then carries what the resource server needs:

```json
{
  "iss": "http://localhost:8080/auth/realms/master",
  "aud": "fitnessapp",
  "sub": "c42b534f-7f08-4505-8958-59ea65fb3b47",
  "azp": "fitnessapp",
  "scope": "fitnessapp",
  "user_name": "rachel",
  "authorities": ["fitnessuser"]
}
```

Why *those* claim names? Because Spring Security OAuth's token converter reads
exactly `authorities` and `user_name`. The book is reshaping the identity provider to
match a client library's expectations. That direction of adaptation is the single
most dated decision in the chapter — see the book-vs-today section below, where the
modern approach adapts the *client library* to Keycloak's native claims instead.

The `aud` (audience) claim is different in kind: it names the intended recipient of
the token. The resource server is configured with the same value and rejects tokens
issued for anyone else, which is what stops a token minted for a different service
from being replayed against this one.

### The resource server, book edition

Dependencies are `spring-boot-starter-security`, `spring-boot-starter-web`,
`spring-cloud-starter-oauth2`, `spring-boot-starter-data-jpa`, `spring-security-data`
and a JDBC driver. Configuration is two properties plus the datasource (p. 457-458):

```properties
server.port=9090
claim.aud=fitnessapp
jwkSetUri=http://localhost:8080/auth/realms/master/protocol/openid-connect/certs
```

```java
@Configuration
@EnableResourceServer
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {

    @Value("${claim.aud}") private String claimAud;
    @Value("${jwkSetUri}") private String urlJwk;

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.tokenStore(tokenStore());
        resources.resourceId(claimAud);          // expected aud claim
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwkTokenStore(urlJwk);        // multi-key, keyed by kid
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .mvcMatchers(HttpMethod.DELETE, "/**").hasAuthority("fitnessadmin")
            .anyRequest().authenticated();
    }

    @Bean
    public SecurityEvaluationContextExtension securityEvaluationContextExtension() {
        return new SecurityEvaluationContextExtension();
    }
}
```

`JwkTokenStore` is the piece specific to a *key set* rather than a single key. The
JWKS endpoint returns several keys, each with a `kid`:

```json
{ "keys": [ { "kid": "LHOsOEQJbnNbUn8PmZXA9TUoP56hYOtc3VOk0kUvj5U",
              "kty": "RSA", "alg": "RS256", "use": "sig" } ] }
```

and every token Keycloak signs names the key it used in its header:

```json
{ "alg": "RS256", "typ": "JWT",
  "kid": "LHOsOEQJbnNbUn8PmZXA9TUoP56hYOtc3VOk0kUvj5U" }
```

So the resource server reads `kid` from the header, picks the matching public key
from the set, and verifies. That indirection is what makes **key rotation** possible
without redeploying resource servers — the thing a hand-rolled single-key setup
can't do, and a concrete argument for a real identity provider over the chapter-13
server.

### The three rules, at three layers

The repository pushes the ownership filter into the query itself rather than
post-filtering results — the `SecurityEvaluationContextExtension` bean above is what
makes `authentication.name` resolvable inside SpEL there:

```java
public interface WorkoutRepository extends JpaRepository<Workout, Integer> {

    @Query("SELECT w FROM Workout w WHERE w.user = ?#{authentication.name}")
    List<Workout> findAllByUser();
}
```

The service enforces "only for yourself" on the write path:

```java
@Service
public class WorkoutService {

    @Autowired
    private WorkoutRepository workoutRepository;

    @PreAuthorize("#workout.user == authentication.name")
    public void saveWorkout(Workout workout) {
        workoutRepository.save(workout);
    }

    public List<Workout> findWorkouts() {
        return workoutRepository.findAllByUser();   // filtered in the query
    }

    public void deleteWorkout(Integer id) {         // guarded at the endpoint
        workoutRepository.deleteById(id);
    }
}
```

Both of these depend on `authentication.name` being `rachel` — which is only true
because a protocol mapper put the username into the token under a claim the token
converter reads. Get the mapper wrong and `authentication.name` becomes the `sub`
UUID, every ownership check silently fails closed, and the endpoints look broken
rather than insecure. Worth knowing which failure mode you're in.

The controller is plain MVC with no security annotations at all:

```java
@RestController
@RequestMapping("/workout")
public class WorkoutController {

    @Autowired
    private WorkoutService workoutService;

    @PostMapping("/")
    public void add(@RequestBody Workout workout) { workoutService.saveWorkout(workout); }

    @GetMapping("/")
    public List<Workout> findAll() { return workoutService.findWorkouts(); }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { workoutService.deleteWorkout(id); }
}
```

### Testing: three curls, three outcomes

Section 18.4 (p. 462-466) proves each rule against the running pair of servers
(Keycloak on 8080, resource server on 9090). With a token issued for Bill, posting a
workout for Bill succeeds:

```bash
curl -v -XPOST 'localhost:9090/workout/' \
  -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOi...' \
  -H 'Content-Type: application/json' \
  --data-raw '{"user":"bill","start":"2020-06-10T15:05:05","end":"2020-06-10T16:05:05","difficulty":2}'
# 200 OK
```

The same token, same endpoint, `"user":"rachel"` — `@PreAuthorize` rejects it:

```json
{ "error": "access_denied", "error_description": "Access is denied" }
```

`GET /workout/` with Bill's token returns only Bill's rows and with Rachel's token
only Rachel's — no request parameter is involved, the filter comes from the token.
And `DELETE /workout/2` returns 403 with Rachel's token (`fitnessuser`) but 200 with
Mary's (`fitnessadmin`), which is the endpoint-level `hasAuthority("fitnessadmin")`
doing its job.

### OAuth 2-specific SpEL expressions

Ordinary SpEL reaches authorities, roles and username, but not OAuth 2 concepts like
scope or client roles. Spring Security OAuth exposed those through a dedicated
expression handler:

```java
@Override
public void configure(ResourceServerSecurityConfigurer resources) {
    resources.tokenStore(tokenStore());
    resources.resourceId(claimAud);
    resources.expressionHandler(handler());
}

@Bean
public SecurityExpressionHandler<FilterInvocation> handler() {
    return new OAuth2WebSecurityExpressionHandler();
}
```

which unlocks `#oauth2.hasScope(...)` and `#oauth2.clientHasRole(...)` inside
authorization expressions:

```java
@PreAuthorize("#workout.user == authentication.name and #oauth2.hasScope('fitnessapp')")
public void saveWorkout(Workout workout) {
    workoutRepository.save(workout);
}
```

Note the distinction being drawn: `authentication.name` is about the *user*,
`hasScope` is about what the *client* was authorized to do, and `clientHasRole` only
makes sense with the client credentials grant where there is no user at all.

### Book vs. today: Keycloak moved, and so did every Spring class in this chapter

Keycloak itself is the healthy part of this story — it is very much alive (**26.7.1**
on the official downloads page at the time of writing, still open source, still the
default answer for a self-hosted identity provider). But essentially every *line* of
the chapter needs changing.

**On the Keycloak side.**

- **Runtime replaced: WildFly to Quarkus.** Keycloak 17 (Feb 2022) made the Quarkus
  distribution the default and the legacy WildFly distribution was removed by June
  2022. The book's `bin/standalone.sh` no longer exists — you run
  `bin/kc.sh start-dev`. Configuration moved from WildFly XML to a single
  `keycloak.conf` plus CLI options and environment variables, custom providers moved
  from `standalone/deployments` to `providers/`, `add-user-keycloak.sh` was replaced
  by the `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD` bootstrap
  variables, and there is now a build/augmentation step.
- **`/auth` is gone from every URL.** This is the change most likely to break a
  copy-pasted book example: the Quarkus distribution removes `/auth` from the context
  path. The issuer is `http://localhost:8080/realms/master`, not
  `.../auth/realms/master`. (`--http-relative-path /auth` restores the old shape for
  migrations.)
- **Don't use the `master` realm.** The book issues tokens from `master` for
  convenience; Keycloak's own admin guide is explicit — "Use the *master* realm only
  to create and manage the realms in your system." Applications belong in a dedicated
  realm.
- **The password grant is on its way out.** Keycloak still supports Direct Access
  Grants, but OAuth 2.0 Security Best Current Practice says it MUST NOT be used and
  OAuth 2.1 drops it; accordingly Keycloak 26.2 changed the admin console to
  **disable Direct Access Grant by default when creating a new client**. The book's
  `grant_type=password` curl commands still work if you tick the box, but they are a
  testing shortcut now, not a design.

**On the Spring side.** Two independent removals stack up here.

- **The Keycloak Spring adapters were removed.** Keycloak deprecated its Java
  adapters in February 2022 and confirmed the wind-down in March 2023; the
  `keycloak-spring-boot-starter` / `keycloak-spring-security-adapter` line is gone,
  with Keycloak's own guidance pointing at Spring Security's native OAuth 2 / OIDC
  support instead. **The book dodged this bullet** — Spilcă deliberately never used
  the adapter, treating Keycloak as a plain OIDC provider behind standard endpoints.
  That choice aged far better than the alternative, and it's why the *architecture*
  of the chapter is still correct even though the code isn't.
- **Everything the resource server actually used is EOL anyway.**
  `spring-cloud-starter-oauth2`, `@EnableResourceServer`,
  `ResourceServerConfigurerAdapter`, `TokenStore`, `JwkTokenStore` and
  `OAuth2WebSecurityExpressionHandler` all come from Spring Security OAuth, which
  reached end of life on 1 June 2022. `@EnableGlobalMethodSecurity` became
  `@EnableMethodSecurity`. `SecurityEvaluationContextExtension` is the one class in
  the listing that survives untouched — it's still documented in the current Spring
  Security reference, still from `spring-security-data`, still declared as a bean the
  same way.

**The whole resource-server configuration collapses into one property.** Because
Keycloak exposes standard OIDC discovery, no Keycloak-specific library is needed —
this is exactly the `issuer-uri` setup from
`spring-security-oauth2-resource-server-approaches`, pointed at a product:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
```

```yaml
server:
  port: 9090
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8080/realms/fitness
          audiences: fitnessapp
```

`issuer-uri` alone replaces the book's `jwkSetUri` property *and* the
`JwkTokenStore` bean: Spring Security fetches
`{issuer}/.well-known/openid-configuration`, reads `jwks_uri` from it, and validates
the `iss` claim against the configured issuer. The `audiences` property replaces
`resources.resourceId(claimAud)`. Rotation still works the same way, via `kid`.

**Map Keycloak's claims, don't reshape Keycloak.** Keycloak natively puts realm roles
in `realm_access.roles` and client roles in `resource_access.<clientId>.roles`, and
the username in `preferred_username`. Rather than adding mappers that duplicate them
into `authorities` and `user_name` for a dead library's benefit, adapt on the Spring
side — this is the `GrantedAuthority` mapping problem from
`spring-security-authorization-authorities-and-roles`, solved with a
`JwtAuthenticationConverter`:

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class ResourceServerConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.DELETE, "/**").hasAuthority("fitnessadmin")
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(keycloakConverter())));
        return http.build();
    }

    private JwtAuthenticationConverter keycloakConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();

        // authentication.name must be the username, not the "sub" UUID —
        // the @PreAuthorize and @Query rules above depend on it
        converter.setPrincipalClaimName("preferred_username");

        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Map<String, Object> realmAccess = jwt.getClaim("realm_access");
            if (realmAccess == null || realmAccess.get("roles") == null) {
                return List.of();
            }
            @SuppressWarnings("unchecked")
            Collection<String> roles = (Collection<String>) realmAccess.get("roles");
            return roles.stream()
                        .map(SimpleGrantedAuthority::new)   // no prefix: "fitnessadmin"
                        .collect(Collectors.toList());
        });

        return converter;
    }

    @Bean
    SecurityEvaluationContextExtension securityEvaluationContextExtension() {
        return new SecurityEvaluationContextExtension();
    }
}
```

`setPrincipalClaimName` defaults to `JwtClaimNames.SUB`, which is why it must be set
explicitly for the book's ownership rules to keep working. If you'd rather write
`hasRole("fitnessadmin")` than `hasAuthority(...)`, map to `ROLE_fitnessadmin`
instead — or use the stock `JwtGrantedAuthoritiesConverter` with
`setAuthoritiesClaimName(...)` and `setAuthorityPrefix(...)` when the claim is a flat
list rather than Keycloak's nested object. The `aud` claim still needs a Keycloak
audience mapper (Keycloak does not put your resource server in `aud` by default),
so that one mapper from section 18.2.4 survives; the roles and username mappers do
not.

**And `#oauth2.hasScope(...)` has a successor.** Current Spring Security ships an
authorization-manager factory bean that exposes the same idea to method security
without a custom expression handler:

```java
@Bean
OAuth2AuthorizationManagerFactory<?> oauth2() {
    return new DefaultOAuth2AuthorizationManagerFactory<>();
}

@PreAuthorize("#workout.user == authentication.name and @oauth2.hasScope('fitnessapp')")
public void saveWorkout(Workout workout) {
    workoutRepository.save(workout);
}
```

Note `@oauth2` (a bean reference) rather than the book's `#oauth2` (a root-object
property) — same capability, different plumbing.

## Trade-offs

- **Running an identity provider vs. writing one.** Keycloak gives you user
  federation (LDAP, Active Directory), brokering to social/enterprise identity
  providers, MFA, consent, admin UI, key rotation and token customization on day one
  — none of which the chapter-13 server had. The cost is a service to deploy,
  upgrade, back up, and whose major versions occasionally rewrite your deployment
  story, as the WildFly-to-Quarkus move did. The book's own summary lands here: you
  don't necessarily need a custom authorization server, but you should be ready for
  stakeholders who won't accept a third-party one.
- **Configuration in a console is faster to change and harder to review.** Realms,
  clients, mappers and role assignments are not in your Git history. A protocol
  mapper deleted by hand in production silently strips a claim, and the failure shows
  up as authorization rules quietly denying (or, worse, permitting) — which is why
  realistic setups export realm configuration as JSON, or drive it with the admin
  REST API or Terraform, rather than clicking.
- **Adapting the identity provider to the client library vs. the reverse.** The book
  renames Keycloak's claims to `authorities`/`user_name` to please Spring Security
  OAuth. That works, but it makes the realm library-specific: another consumer of the
  same realm now sees duplicated, non-standard claims. Mapping on the Spring side
  with a `JwtAuthenticationConverter` keeps the realm standard and pushes the quirk
  into one bean in one application — better isolation, at the cost of a few more
  lines per service.
  ```java
  converter.setPrincipalClaimName("preferred_username");
  ```
- **Realm roles vs. client roles is an architecture decision, not a naming one.**
  Realm roles (`realm_access.roles`) are global to the tenant and land in every
  token; client roles (`resource_access.<clientId>.roles`) are scoped to one
  application. Realm roles are simpler and what the book uses; client roles keep one
  service's role vocabulary from leaking into everyone else's tokens, which matters
  once you have more than a handful of services.
- **Long-lived tokens are a testing convenience that becomes a production hole.** The
  book raises the token lifespan so tokens don't expire mid-experiment and says so
  explicitly — production tokens should live minutes. Since a JWT is validated
  offline against the JWK set, there is no per-request revocation check; lifetime
  *is* the revocation window.
- **Three enforcement layers is pedagogically useful and operationally debatable.**
  Endpoint, service and repository rules in one app demonstrates the range, but it
  also means an auditor must read three files to know who can delete a workout. The
  book concedes the delete rule "would be the same" at the service layer. Pick a
  layer per concern and be consistent; scattering is a teaching device.
- **Standard OIDC beats a vendor adapter, and the last decade proved it.** The chapter
  treats Keycloak as "a thing that exposes a token endpoint and a JWKS endpoint," so
  swapping in Okta, Auth0 or Entra ID is a change of `issuer-uri` and a claim-mapping
  tweak. Applications that reached for `keycloak-spring-boot-starter` instead got a
  tighter integration and then a removal to migrate off.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 18, "Hands-on: An OAuth 2 application", sections 18.1-18.4, p. 434-466](https://www.manning.com/books/spring-security-in-action) — doc
- [Keycloak — Downloads (current version)](https://www.keycloak.org/downloads) — doc
- [Keycloak — Migrating to the Quarkus distribution (/auth context path removed, kc.sh, providers directory)](https://www.keycloak.org/migration/migrating-to-quarkus) — doc
- [Keycloak Blog — Deprecation of Keycloak adapters (Feb 2022)](https://www.keycloak.org/2022/02/adapter-deprecation) — doc
- [Keycloak Blog — Update on deprecation of Keycloak adapters (Mar 2023)](https://www.keycloak.org/2023/03/adapter-deprecation-update) — doc
- [Keycloak — Securing applications: OpenID Connect endpoints and discovery document](https://www.keycloak.org/securing-apps/oidc-layers) — doc
- [Keycloak — Server Administration Guide (realms, the master realm, clients, roles, protocol mappers)](https://www.keycloak.org/docs/latest/server_admin/index.html) — doc
- [Keycloak Blog — Keycloak 26.2.0 released (Direct Access Grant disabled by default for new clients)](https://www.keycloak.org/2025/04/keycloak-2620-released) — doc
- [Keycloak Issue #30226 — Admin UI: disable Direct Access Grant by default when creating a new client](https://github.com/keycloak/keycloak/issues/30226) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server JWT (issuer-uri, audiences, JwtAuthenticationConverter, JwtGrantedAuthoritiesConverter)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security API — JwtAuthenticationConverter (setPrincipalClaimName defaults to "sub")](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/oauth2/server/resource/authentication/JwtAuthenticationConverter.html) — doc
- [Spring Security Reference — Spring Data integration (SecurityEvaluationContextExtension)](https://docs.spring.io/spring-security/reference/servlet/integrations/data.html) — doc
- [Spring Blog — Spring Security OAuth reaches End-of-Life (1 Jun 2022)](https://spring.io/blog/2022/06/01/spring-security-oauth-reaches-end-of-life/) — doc
