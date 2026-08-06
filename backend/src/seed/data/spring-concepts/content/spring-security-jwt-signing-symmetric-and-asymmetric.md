---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Chapter 14 lists three ways a resource server can validate a token; this chapter builds
the third one — **local validation of a cryptographically signed JWT** — and shows that
the whole design hinges on a single question: *who holds the key that produces a valid
signature?* With a **symmetric** key (HMAC, `HS256`) the answer is "both the
authorization server and every resource server", which is simple and fast but makes each
resource server capable of *minting* tokens, not just checking them. With an
**asymmetric key pair** (`RS256`) the authorization server signs with a private key and
resource servers verify with a public key that is useless for forging anything — so a
public key can be handed out, published, and rotated freely. That last step, "publish the
public key at an endpoint," is what the book improvises in section 15.2.4 and what the
ecosystem has since standardized as the **JWK Set endpoint**. The chapter closes with
custom claims: putting your own fields into the token body and reading them back on the
resource server.

## Use Cases

- Choosing signing keys for an internal system where one team owns both the
  authorization server and the resource servers (symmetric is defensible) versus a system
  where they are owned by different organizations (symmetric is not).
- Making the "local JWT validation" option from
  `spring-security-oauth2-resource-server-approaches` concrete — this concept *is* that
  option, expanded into an implementation.
- Rotating signing keys without redeploying every resource server, by moving both keys to
  the authorization server and letting resource servers fetch the public one.
- Carrying authorization-relevant data the standard claims don't cover — a user's review
  count, connection count, tenant, or originating time zone — inside the token, where the
  signature protects it from tampering.
- Migrating an `@EnableAuthorizationServer`-era `JwtTokenStore`/`JwtAccessTokenConverter`
  codebase to `JwtEncoder`/`JwtDecoder` plus a JWK set.

## Deep Dive

### A signed JWT is three Base64 parts, and signing is not encryption

A JWT has a header, a body (the claims), and a signature, each Base64URL-encoded and
joined with dots:

```
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFProg7s_KvFxvnYGiZF-Mj4rr-0nJA1tVGZNn8U
   ^ header                ^ body                        ^ signature
```

The header names the algorithm, and it is the first thing you should look at when
debugging — `eyJhbGciOiJIUzI1NiIs…` decodes to `{"alg":"HS256",…}` (symmetric) and
`eyJhbGciOiJSUzI1NiIs…` decodes to `{"alg":"RS256",…}` (asymmetric). The book's own
sample responses differ in exactly that prefix between section 15.1 and section 15.2.

The signature is computed over the header and body with a key. For it to be valid it must
both be generated with the correct key **and** match the content that was signed — so an
attacker who intercepts a token and edits `"authorities": ["read"]` into
`["admin"]` invalidates the signature and the resource server rejects the call.

Critically, a signed token is **not** a secret. Anyone can Base64-decode the body and read
every claim without any key at all. Signing gives integrity and authenticity, not
confidentiality. A signed token is a **JWS**; if you also need the contents hidden you
need a **JWE** (encrypted), which this chapter does not use. Never put a password, a card
number, or anything else you wouldn't print on a postcard into a JWT body.

### Symmetric signing: one shared secret, and everyone who has it can sign

The book's first example configures a `JwtTokenStore` on the authorization server and
gives its `JwtAccessTokenConverter` a signing key read from properties:

```java
@Configuration
@EnableAuthorizationServer
public class AuthServerConfig
    extends AuthorizationServerConfigurerAdapter {

    @Value("${jwt.key}")
    private String jwtKey;

    @Autowired
    private AuthenticationManager authenticationManager;

    @Override
    public void configure(
        AuthorizationServerEndpointsConfigurer endpoints) {
        endpoints
            .authenticationManager(authenticationManager)
            .tokenStore(tokenStore())
            .accessTokenConverter(jwtAccessTokenConverter());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwtTokenStore(jwtAccessTokenConverter());
    }

    @Bean
    public JwtAccessTokenConverter jwtAccessTokenConverter() {
        var converter = new JwtAccessTokenConverter();
        converter.setSigningKey(jwtKey);       // symmetric
        return converter;
    }
}
```

```properties
jwt.key=MjWP5L7CiD
```

The resource server's configuration is *the same configuration again* — same
`JwtTokenStore`, same `JwtAccessTokenConverter`, same key value:

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {

    @Value("${jwt.key}")
    private String jwtKey;

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.tokenStore(tokenStore());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwtTokenStore(jwtAccessTokenConverter());
    }

    @Bean
    public JwtAccessTokenConverter jwtAccessTokenConverter() {
        var converter = new JwtAccessTokenConverter();
        converter.setSigningKey(jwtKey);
        return converter;
    }
}
```

That symmetry is the whole point *and* the whole problem: the API doesn't distinguish
"the key I sign with" from "the key I verify with," because with HMAC they are one key.
There is no configuration you can write that lets the resource server verify but not
sign.

Two practical notes the book attaches. First, the key is a random byte string, not a
passphrase — `"abcde"` works for a demo, but a real key should be generated randomly and
be long (the book suggests preferring more than 258 bytes; for `HS256`, RFC 7518 sets the
hard floor at 256 bits / 32 bytes). Second, `jwt.key=MjWP5L7CiD` sitting in
`application.properties` is a demo shortcut — a signing key belongs in a secrets vault.
The book's consultant anecdote is worth repeating verbatim in spirit: if you ever find
yourself emailing the key to another team, that key should not have been symmetric.

Getting a token and using it is unchanged from any other OAuth 2 setup:

```bash
curl -v -XPOST -u client:secret "http://localhost:8080/oauth/token?grant_type=password&username=john&password=12345&scope=read"
```

```json
{
    "access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXV…",
    "token_type":"bearer",
    "refresh_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp…",
    "expires_in":43199,
    "scope":"read",
    "jti":"7774532f-b74b-4e6b-ab16-208c46a19560"
}
```

```bash
curl -H "Authorization:Bearer eyJhbGciOiJIUzI1NiIs…" http://localhost:9090/hello
```

The book also shows the non-Spring-Security-OAuth form in a sidebar, and this is the one
that survives — a `JwtDecoder` bean wired through `oauth2ResourceServer()`:

```java
@Bean
public JwtDecoder jwtDecoder() {
    byte[] key = jwtKey.getBytes();
    SecretKey originalKey = new SecretKeySpec(key, 0, key.length, "AES");
    return NimbusJwtDecoder.withSecretKey(originalKey).build();
}
```

```java
http.authorizeRequests()
        .anyRequest().authenticated()
    .and()
    .oauth2ResourceServer(
        c -> c.jwt(j -> j.decoder(jwtDecoder())));
```

(The `"AES"` algorithm name in that `SecretKeySpec` is a quirk of the book's snippet —
the key material is what matters, but the current docs name the MAC algorithm explicitly
instead; see the book-vs-today section.)

### Asymmetric signing: one signer, many verifiers

An asymmetric key pair splits the single key in two. The **private key** signs; only its
holder can produce a valid signature. The **public key** verifies; it cannot sign
anything. A stolen public key is worthless to an attacker — which is exactly the property
that lets you distribute it.

```mermaid
flowchart TB
    subgraph SYM["Symmetric — HS256"]
        direction TB
        AS1["Authorization server<br/>secret: MjWP5L7CiD<br/>signs"]
        RS1a["Resource server A<br/>secret: MjWP5L7CiD<br/>verifies ... and can sign"]
        RS1b["Resource server B<br/>secret: MjWP5L7CiD<br/>verifies ... and can sign"]
        H1["Hacker who reads any<br/>one config file can<br/>forge any token"]
        AS1 -->|"copy of the same secret"| RS1a
        AS1 -->|"copy of the same secret"| RS1b
        RS1a -.->|"leak"| H1
    end

    subgraph ASYM["Asymmetric — RS256"]
        direction TB
        AS2["Authorization server<br/>PRIVATE key: signs<br/>PUBLIC key: published"]
        RS2a["Resource server A<br/>public key: verifies only"]
        RS2b["Resource server B<br/>public key: verifies only"]
        H2["Hacker who steals the<br/>public key can forge<br/>nothing"]
        AS2 -->|"public key<br/>over an open endpoint"| RS2a
        AS2 -->|"public key<br/>over an open endpoint"| RS2b
        RS2a -.->|"leak"| H2
    end
```

Read the diagram as a count of *trusted parties*. Symmetric signing means every resource
server is as privileged as the authorization server; the number of places a
system-compromising secret lives grows linearly with the number of services. Asymmetric
signing means exactly one component is privileged, and the rest hold something that is
safe to publish. This is why local JWT validation scales: adding a resource server costs
one public key and zero network calls per request, and the authorization server never has
to trust the new service with anything.

**Generating the pair.** The book uses `keytool` (ships with the JDK) and OpenSSL:

```bash
keytool -genkeypair -alias ssia -keyalg RSA -keypass ssia123 \
        -keystore ssia.jks -storepass ssia123

keytool -list -rfc --keystore ssia.jks | openssl x509 -inform pem -pubkey
```

The second command prints the PEM-armored public key:

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAijLqDcBHwtnsBw+WFSzG
…
-----END PUBLIC KEY-----
```

This is a different job from `spring-security-crypto-module`: that module's
`KeyGenerators`/`Encryptors` produce symmetric material for encrypting your own data,
whereas here you need an RSA key *pair* in a keystore for token signing, which is a
platform-level artifact generated outside the application.

**Authorization server with the private key.** Only the converter bean changes; the
`JwtTokenStore` wiring is identical to the symmetric case:

```java
@Value("${password}")  private String password;
@Value("${privateKey}") private String privateKey;   // ssia.jks
@Value("${alias}")      private String alias;        // ssia

@Bean
public JwtAccessTokenConverter jwtAccessTokenConverter() {
    var converter = new JwtAccessTokenConverter();

    KeyStoreKeyFactory keyStoreKeyFactory =
        new KeyStoreKeyFactory(
            new ClassPathResource(privateKey),
            password.toCharArray());

    converter.setKeyPair(keyStoreKeyFactory.getKeyPair(alias));
    return converter;
}
```

**Resource server with the public key.** Note `setVerifierKey` rather than
`setSigningKey` — the API finally has two distinct method names because there are now two
distinct capabilities:

```java
@Value("${publicKey}")
private String publicKey;   // -----BEGIN PUBLIC KEY----- … -----END PUBLIC KEY-----

@Bean
public JwtAccessTokenConverter jwtAccessTokenConverter() {
    var converter = new JwtAccessTokenConverter();
    converter.setVerifierKey(publicKey);
    return converter;
}
```

And again the migration form, which is the same `oauth2ResourceServer()` wiring with a
different decoder:

```java
@Bean
public JwtDecoder jwtDecoder() {
    try {
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        var key = Base64.getDecoder().decode(publicKey);

        var x509 = new X509EncodedKeySpec(key);
        var rsaKey = (RSAPublicKey) keyFactory.generatePublic(x509);
        return NimbusJwtDecoder.withPublicKey(rsaKey).build();
    } catch (Exception e) {
        throw new RuntimeException("Wrong public key");
    }
}
```

The token now arrives with `"alg":"RS256"`, and nothing else about the request changes.

### Publishing the public key so keys can actually be rotated

Keys should be rotated — a key that never changes is a key that eventually leaks and then
stays useful forever. But with the public key pasted into each resource server's
`application.properties`, rotating means a coordinated config change and redeploy across
every service, which in practice means nobody rotates.

The fix is to keep **both** keys at the authorization server and let it serve the public
one. Spring Security OAuth already has such an endpoint (`/oauth/token_key`); it is just
denied to everyone by default, so you open it up:

```java
@Override
public void configure(
    ClientDetailsServiceConfigurer clients) throws Exception {

    clients.inMemory()
           .withClient("client")
           .secret("secret")
           .authorizedGrantTypes("password", "refresh_token")
           .scopes("read")
             .and()
           .withClient("resourceserver")          // the resource server is itself a client
           .secret("resourceserversecret");
}

@Override
public void configure(
    AuthorizationServerSecurityConfigurer security) {
    security.tokenKeyAccess("isAuthenticated()");
}
```

```bash
curl -u resourceserver:resourceserversecret http://localhost:8080/oauth/token_key
```

```json
{
    "alg":"SHA256withRSA",
    "value":"-----BEGIN PUBLIC KEY----- nMIIBIjANBgkq... -----END PUBLIC KEY-----"
}
```

The resource server then holds no key at all — just a URI and credentials:

```properties
server.port=9090
security.oauth2.resource.jwt.key-uri=http://localhost:8080/oauth/token_key
security.oauth2.client.client-id=resourceserver
security.oauth2.client.client-secret=resourceserversecret
```

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {
}
```

An empty configuration class is the payoff: key management now happens in exactly one
place. Note this is still local validation — the public key is fetched and cached, not
consulted per request; the network call happens on startup and on key refresh, not on the
hot path.

### Custom claims: writing them on the authorization server

By default the token body carries what Spring Security needs for basic authorization:

```json
{
    "exp": 1582581543,
    "user_name": "john",
    "authorities": ["read"],
    "jti": "8e208653-79cf-45dd-a702-f6b694b417e7",
    "client_id": "client",
    "scope": ["read"]
}
```

When authorization depends on something else — a reviewer's review count, a user's number
of social connections, the time zone the client connected from — you add a claim. In the
book's API that means a `TokenEnhancer`:

```java
public class CustomTokenEnhancer implements TokenEnhancer {

    @Override
    public OAuth2AccessToken enhance(
        OAuth2AccessToken oAuth2AccessToken,
        OAuth2Authentication oAuth2Authentication) {

        var token = new DefaultOAuth2AccessToken(oAuth2AccessToken);

        Map<String, Object> info =
            Map.of("generatedInZone",
                   ZoneId.systemDefault().toString());

        token.setAdditionalInformation(info);
        return token;
    }
}
```

Registering it has one non-obvious trap. `JwtAccessTokenConverter` is *itself* a
`TokenEnhancer`, so setting yours as *the* enhancer would silently replace the thing that
signs the token. You must chain them:

```java
@Override
public void configure(
    AuthorizationServerEndpointsConfigurer endpoints) {

    TokenEnhancerChain tokenEnhancerChain = new TokenEnhancerChain();

    var tokenEnhancers =
        List.of(new CustomTokenEnhancer(),
                jwtAccessTokenConverter());

    tokenEnhancerChain.setTokenEnhancers(tokenEnhancers);

    endpoints
        .authenticationManager(authenticationManager)
        .tokenStore(tokenStore())
        .tokenEnhancer(tokenEnhancerChain);
}
```

The claim now appears both in the token body and, as a convenience, in the token
endpoint's JSON response:

```json
{
    "access_token":"eyJhbGciOiJSUzI…",
    "token_type":"bearer",
    "refresh_token":"eyJhbGciOiJSUzI1…",
    "expires_in":43199,
    "scope":"read",
    "generatedInZone":"Europe/Bucharest",
    "jti":"0c39ace4-4991-40a2-80ad-e9fdeb14f9ec"
}
```

Take the value from the **token**, never from the surrounding response. Only the token is
signed; the JSON envelope around it carries no integrity guarantee whatsoever. That
distinction is the entire reason the chapter bothers with signatures.

### Custom claims: reading them on the resource server

The object that turns a token into an `Authentication` is the access token converter, so
that is what you extend — overriding `extractAuthentication` to stash the raw claim map on
the authentication's details:

```java
public class AdditionalClaimsAccessTokenConverter
    extends JwtAccessTokenConverter {

    @Override
    public OAuth2Authentication extractAuthentication(Map<String, ?> map) {
        var authentication = super.extractAuthentication(map);
        authentication.setDetails(map);
        return authentication;
    }
}
```

```java
@Bean
public JwtAccessTokenConverter jwtAccessTokenConverter() {
    var converter = new AdditionalClaimsAccessTokenConverter();
    converter.setVerifierKey(publicKey);
    return converter;
}
```

```java
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello(OAuth2Authentication authentication) {
        OAuth2AuthenticationDetails details =
            (OAuth2AuthenticationDetails) authentication.getDetails();

        return "Hello! " + details.getDecodedDetails();
    }
}
```

```
Hello! {user_name=john, scope=[read], generatedInZone=Europe/Bucharest,
        exp=1582595692, authorities=[read], jti=982b02be-…, client_id=client}
```

`getDecodedDetails()` returns the claim `Map`; in real code you pull one key out of it
rather than printing the lot.

### Book vs. today: the mechanics are timeless, the classes are not

The cryptography in this chapter has not moved at all. The classes implementing it have
almost entirely been replaced.

**The algorithm names are unchanged.** `HS256` (HMAC with SHA-256) and `RS256` (RSASSA-PKCS1-v1_5
with SHA-256) are still the registered JWA names, still spelled exactly that way in the
`alg` header, and Spring Security models them as `MacAlgorithm.HS256`/`HS384`/`HS512` and
`SignatureAlgorithm.RS256`/`RS384`/`RS512`/`ES256`/`ES384`/`ES512`/`PS256`/`PS384`/`PS512`.
What *has* shifted is the default advice for new systems: `RS256` remains the
interoperability-safe choice and is what most identity providers still issue, but `ES256`
(ECDSA on P-256) has gained real ground — same signer/verifier split, dramatically smaller
keys and signatures, faster verification — and `EdDSA`/Ed25519 is the modern-cryptography
preference where your whole stack supports it. Spring Security supports all three on the
decode side (`.jwsAlgorithm(...)`, and you may list several), and since 7.0
`NimbusJwtEncoder.withKeyPair(...)` has an EC overload alongside the RSA one. Treat the
book's `RS256`-everywhere as "the safe default," not "the only option."

**The library changed underneath.** The book's `JwtAccessTokenConverter` is backed by
`spring-security-jwt` (`JwtHelper`, `MacSigner`, `RsaSigner`, `RsaVerifier`), a small
library that lived inside the `spring-security-oauth` repository. That repository is
archived and the project reached end-of-life on 1 June 2022 — see
`spring-security-oauth2-authorization-server` for the full timeline, which applies
verbatim here. Current Spring Security uses **Nimbus JOSE+JWT** instead, wrapped in its
own `JwtDecoder`/`JwtEncoder` abstractions. The book's sidebars already point at the
landing spot (`NimbusJwtDecoder`), which is why those sidebars are the parts of the
chapter you can still copy.

The mapping:

| Book (Spring Security OAuth, EOL) | Today (Spring Security / Spring Authorization Server) |
| --- | --- |
| `JwtTokenStore` + `JwtAccessTokenConverter` | `JwtEncoder` (issuing side), `JwtDecoder` (validating side) |
| `converter.setSigningKey(key)` | `NimbusJwtEncoder.withSecretKey(secretKey)` / `NimbusJwtDecoder.withSecretKey(secretKey)` |
| `converter.setKeyPair(pair)` | `NimbusJwtEncoder.withKeyPair(pub, priv)`, or a `JWKSource<SecurityContext>` bean |
| `converter.setVerifierKey(pem)` | `NimbusJwtDecoder.withPublicKey(rsaPublicKey)` |
| `/oauth/token_key` + `security.oauth2.resource.jwt.key-uri` | `/oauth2/jwks` + `spring.security.oauth2.resourceserver.jwt.jwk-set-uri` |
| (nothing) | `spring.security.oauth2.resourceserver.jwt.issuer-uri` — discovers the JWK set automatically |
| `TokenEnhancer` + `TokenEnhancerChain` | `OAuth2TokenCustomizer<JwtEncodingContext>` bean |
| custom `JwtAccessTokenConverter.extractAuthentication` | inject `Jwt` / `JwtAuthenticationToken` and call `getClaim(...)` |
| `ResourceServerConfigurerAdapter`, `@EnableResourceServer` | `SecurityFilterChain` bean with `oauth2ResourceServer(...)` |

**Symmetric, today.** Decoding names the MAC algorithm explicitly rather than relying on a
`SecretKeySpec` algorithm string:

```java
@Bean
JwtDecoder jwtDecoder() {
    SecretKey key = new SecretKeySpec(
        jwtKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    return NimbusJwtDecoder.withSecretKey(key)
                           .macAlgorithm(MacAlgorithm.HS256)
                           .build();
}
```

Issuing an `HS256` token yourself — the piece the book had no first-class API for, because
`JwtEncoder` did not exist in Spring Security until 5.6:

```java
@Bean
JwtEncoder jwtEncoder(SecretKey key) {
    return new NimbusJwtEncoder(new ImmutableSecret<>(key));
}

public String issue(String subject) {
    JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
    JwtClaimsSet claims = JwtClaimsSet.builder()
        .issuer("https://auth.example.com")
        .subject(subject)
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plus(30, ChronoUnit.MINUTES))
        .claim("scope", "read")
        .build();

    return jwtEncoder.encode(JwtEncoderParameters.from(header, claims))
                     .getTokenValue();
}
```

**Asymmetric, today.** The private key never becomes a bean of its own; it goes into a
`JWKSource`, which both signs tokens and backs the published key set:

```java
@Bean
public JWKSource<SecurityContext> jwkSource(KeyPair keyPair) {
    RSAKey rsaKey = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
        .privateKey((RSAPrivateKey) keyPair.getPrivate())
        .keyID(UUID.randomUUID().toString())
        .build();
    return new ImmutableJWKSet<>(new JWKSet(rsaKey));
}

@Bean
public JwtEncoder jwtEncoder(JWKSource<SecurityContext> jwkSource) {
    return new NimbusJwtEncoder(jwkSource);
}
```

That `keyID` is the thing the book's design is missing, and it is what makes rotation
work: each key gets a `kid`, the header of every issued token names its `kid`, and a
verifier holding a *set* of keys picks the right one. During a rotation the JWK set
briefly contains both the old and the new key, in-flight tokens signed with the old one
keep validating, and no resource server is redeployed. With a single PEM string in
`application.properties` there is no such window.

**Section 15.2.4 is JWKS, formalized.** The book's `/oauth/token_key` returning
`{"alg": …, "value": "-----BEGIN PUBLIC KEY-----…"}` is a bespoke, single-key, PEM-shaped,
Basic-auth-protected version of what RFC 7517 standardizes as a **JWK Set**: a JSON object
with a `keys` array of JSON Web Keys, served under media type `application/jwk-set+json`.
The endpoint's location is not in RFC 7517 itself — it comes from the discovery specs.
RFC 8414 (OAuth 2.0 Authorization Server Metadata) defines the `jwks_uri` metadata
parameter as "URL of the authorization server's JWK Set document" and the well-known path
`/.well-known/oauth-authorization-server`; OpenID Connect Discovery defines the parallel
`/.well-known/openid-configuration`. The commonly seen `/.well-known/jwks.json` is a
convention many providers adopt for the document that `jwks_uri` points to, not a required
path.

Concretely, Spring Authorization Server serves `/oauth2/jwks` by default (from
`AuthorizationServerSettings`, and only if a `JWKSource<SecurityContext>` bean exists),
and a resource server consumes it with one property:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: https://idp.example.com/oauth2/jwks
```

or, better, points at the issuer and lets discovery find the key set:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com
```

The equivalent beans are `NimbusJwtDecoder.withJwkSetUri(uri).build()` and
`NimbusJwtDecoder.withIssuerLocation(issuer).build()` (or
`JwtDecoders.fromIssuerLocation(issuer)`). Unlike the book's endpoint, the JWK set is
public — it holds only public keys, so it needs no client credentials, which removes the
`resourceserver`/`resourceserversecret` client registration the book had to invent.
`public-key-location: classpath:my-key.pub` remains available for the book's
static-public-key arrangement when you genuinely want it.

**Custom claims, today.** Writing is a single bean, and it replaces the whole
`TokenEnhancerChain` dance — including the "don't accidentally unregister the signer"
trap, which no longer exists because customization and signing are separate concerns:

```java
@Bean
public OAuth2TokenCustomizer<JwtEncodingContext> tokenCustomizer() {
    return (context) -> {
        if (OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType())) {
            context.getClaims().claims((claims) -> {
                claims.put("generatedInZone", ZoneId.systemDefault().toString());
            });
        }
    };
}
```

(Only one such bean may be defined, and the `getTokenType()` guard matters — without it
you would also be editing the ID token.)

Reading is a one-liner, with no converter subclass at all:

```java
@GetMapping("/hello")
public String hello(@AuthenticationPrincipal Jwt jwt) {
    String zone = jwt.getClaimAsString("generatedInZone");
    return "Hello! " + zone;
}
```

`Jwt` also exposes `getSubject()`, `getAudience()`, `getClaims()`, and typed accessors
(`getClaimAsString`, `getClaimAsStringList`, `getClaimAsInstant`), so the raw-`Map`
handling in listing 15.12 is obsolete. If a custom claim should become granted
authorities, that is a `JwtAuthenticationConverter`
(`setJwtGrantedAuthoritiesConverter`) rather than an override of
`extractAuthentication`.

**Also gone independently of OAuth.** `WebSecurityConfigurerAdapter`, used in every
configuration class in this chapter, was deprecated in Spring Security 5.7 and removed in
6.0; the `http.authorizeRequests()` DSL gave way to `authorizeHttpRequests()`; and
`spring-cloud-starter-oauth2` no longer carries any of this. The resource-server
dependency the book already lists —
`spring-boot-starter-oauth2-resource-server` — is the one that is still correct.

## Trade-offs

- **Symmetric vs. asymmetric is a trust decision, not a performance one.** HMAC is
  simpler and faster, and if one team owns the authorization server and all resource
  servers and the key is distributed by the same mechanism that distributes database
  passwords, `HS256` is defensible. The moment a resource server is operated by someone
  you would not let issue tokens — another team, another company, a third-party
  integrator — symmetric is disqualified regardless of how convenient it is, because
  "verify" and "sign" are the same capability. The book's rule of thumb is the right one:
  if the key has to leave your system, it should not be symmetric.
- **A signed JWT trades revocation for independence.** No network call per request, no
  shared database, resource servers that keep working while the authorization server is
  down — but also no way to invalidate a token before `exp`. Short lifetimes plus refresh
  tokens are the standard mitigation; when genuine immediate revocation is a requirement,
  introspection (see `spring-security-oauth2-resource-server-approaches`) is the honest
  answer, and Spring Security lets you introspect JWT-format tokens if you want the format
  without the offline validation.
- **Everything in the token body is public.** Signing protects integrity only. Claims are
  Base64, not ciphertext — putting anything sensitive in a custom claim leaks it to the
  client, the browser's devtools, and every log that records an `Authorization` header.
  If you truly need confidentiality you need JWE, which is a different and heavier design.
- **Custom claims make the token an API you now have to version.** They are the right tool
  when the resource server would otherwise need a round-trip to the authorization server
  for a value it uses on every request. They are the wrong tool for data that changes
  faster than the token lives (a claim is a snapshot taken at issue time and cannot be
  updated), for large payloads (every request carries them, and headers have size limits),
  and for anything a downstream service could just look up. Adding a claim is easy;
  removing one after three services started reading it is not.
- **Config-time public keys make rotation theoretical.** A public key pasted into each
  resource server's properties is the simplest thing that works and the reason many
  systems have never rotated a signing key. Publishing a JWK set costs one endpoint and
  buys `kid`-based rotation with overlapping validity windows — the single highest-value
  upgrade over what the book's section 15.2.3 shows.
- **`RS256` is the safe default; `ES256`/`EdDSA` are the better default if you control
  both ends.** RSA wins on universal library support and is what most identity providers
  emit. EC gives the same trust model with much smaller keys and signatures and faster
  verification, which matters at high request rates and on constrained clients. Choosing
  EC only pays off if every verifier in the system supports it — check before switching, and
  note that a decoder can accept several algorithms during a migration.
- **The book's cryptographic reasoning aged perfectly; its code aged badly.** Every
  conceptual claim in chapter 15 — the trust asymmetry, the key-theft argument, the case
  for rotation, the case for publishing the public key, the observation that response
  bodies aren't signed — is still exactly right, and the two migration sidebars are the
  only parts you can compile. Read the chapter for the reasoning and the book-vs-today
  mapping above for the API.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 15, "OAuth 2: Using JWT and cryptographic signatures", sections 15.1-15.3, p. 361-386 — doc
- [Spring Security Reference — OAuth 2.0 Resource Server JWT (NimbusJwtDecoder, jwk-set-uri, issuer-uri, jwsAlgorithm)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server Opaque Token (introspection, revocation trade-off)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html) — doc
- [Spring Security API — NimbusJwtEncoder (withSecretKey, withKeyPair RSA/EC, encode)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/oauth2/jwt/NimbusJwtEncoder.html) — doc
- [Spring Security API — MacAlgorithm (HS256/HS384/HS512)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/oauth2/jose/jws/MacAlgorithm.html) — doc
- [Spring Authorization Server Reference — Configuration Model (default endpoints, jwkSetEndpoint "/oauth2/jwks")](https://docs.spring.io/spring-authorization-server/reference/configuration-model.html) — doc
- [Spring Authorization Server Reference — How-to: Customize the OpenID Connect 1.0 UserInfo response (shows the OAuth2TokenCustomizer bean for JwtEncodingContext)](https://docs.spring.io/spring-authorization-server/reference/guides/how-to-userinfo.html) — doc
- [Spring Authorization Server Reference — How-to: Add authorities as custom claims in JWT access tokens](https://docs.spring.io/spring-authorization-server/reference/guides/how-to-custom-claims-authorities.html) — doc
- [RFC 7515 — JSON Web Signature (JWS)](https://www.rfc-editor.org/rfc/rfc7515) — doc
- [RFC 7517 — JSON Web Key (JWK) and JWK Set](https://www.rfc-editor.org/rfc/rfc7517) — doc
- [RFC 7518 — JSON Web Algorithms (HS256, RS256, ES256 registrations and key-size requirements)](https://www.rfc-editor.org/rfc/rfc7518) — doc
- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519) — doc
- [RFC 8414 — OAuth 2.0 Authorization Server Metadata (jwks_uri, /.well-known/oauth-authorization-server)](https://www.rfc-editor.org/rfc/rfc8414) — doc
- [GitHub — spring-attic/spring-security-oauth (archived; contains spring-security-jwt, JwtHelper/MacSigner/RsaSigner)](https://github.com/spring-attic/spring-security-oauth) — doc
