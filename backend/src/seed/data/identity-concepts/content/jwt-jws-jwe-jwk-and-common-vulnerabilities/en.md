---
version: 1.0
updatedAt: 2026-11-21
---
## Objective

A JWT is a signed (sometimes encrypted) JSON document that an API verifies without calling the issuer. The format is small and the verifier is where things go wrong: the classic JWT bugs are all a verifier that lets the token choose the algorithm, the key or the rules. This lesson is written for the developer who validates tokens (RFC 8725 and the OWASP JWT cheat sheet are the scope): the anatomy of a compact JWS decoded on screen, the signature algorithms, JWE in one short section, JWK and JWKS, and then each classic pitfall as the same three steps against a small verifier of my own that runs on localhost with throwaway keys: the naive verifier, the forged token it accepts, and the fix (algorithm list and key chosen by the server) refusing the same input. It then shows what `JsonWebTokenHandler` (.NET) and `NimbusJwtDecoder` (Spring) do by default, measured, and why a JWT is a poor browser session.
Versions: Node 22.23.4 (`node:crypto`, no packages), .NET SDK 10.0.100 (`net10.0`) with `Microsoft.IdentityModel.JsonWebTokens` 8.23.0, Java 25.0.3 with `spring-security-oauth2-jose` 7.1.1 and Nimbus JOSE+JWT 10.9.1, jq 1.7.1, on an Apple M4 Max.

## Use Cases

- Reviewing a resource server and checking, line by line, that the token does not pick its own algorithm or key.
- Reading `IDX10511`, `Unsupported algorithm of none` or `Another algorithm expected` and knowing which defense fired.

## Deep Dive

Everything runs against my own code: `naive.mjs` (26 lines) and `fixed.mjs` (20 lines), fresh RSA keys per run, and three listeners on 7180 to 7182 (a JWKS, a foreign JWKS host, an internal-only service). No third-party service and no secret guessing. Numbers are from this run and machine; "docs only" marks what I read and did not run.

### A compact JWS, decoded (measured)

Three base64url parts joined by dots (RFC 7515 section 7.1). A token minted by the lab, decoded with `cut`, `base64` and `jq`:

```text
eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6ImsxIn0.eyJpc3MiOiJodHRwczovL2lkcC5sb2NhbCIsImF1ZCI6Im9yZGVycy1hcGki...
$ ... | cut -d. -f1 | b64d | jq -c .   {"alg":"RS256","typ":"at+jwt","kid":"k1"}
$ ... | cut -d. -f2 | b64d | jq -c .   {"iss":"https://idp.local","aud":"orders-api","sub":"alice","scope":"orders.read","iat":1795221831,"exp":1795222131,"jti":"a1"}
$ ... | cut -d. -f3 | b64d | wc -c     256     (an RSA-2048 signature)
```

The three parts are 55, 170 and 342 characters. The signature covers the ASCII bytes of `header.payload`; the payload is only encoded, so anyone reads it: signed is not encrypted. The header carries `alg` (what to verify with), `kid` (which key), `typ` (what kind of token) and, dangerously, `jku`, `jwk`, `x5u` and `x5c` (where a key might come from). RFC 7515 section 5.2 says the algorithm is an application decision, so the header is input, not configuration.

Registered claims (RFC 7519 section 4.1, IANA registry) and the verifier rule for each: `iss` exact match with the issuer you trust; `sub` key users by (`iss`, `sub`); `aud` your API identifier must be in it; `exp`, `nbf`, `iat` enforce `exp` and `nbf` with a small skew; `jti` a unique id, the key of a deny list.

### Signature algorithms: what each one asks for (measured)

Measured with `node:crypto` on this machine, one core, same claims, 3000 iterations (300 for RSA signing). Numbers belong to this hardware; the ratios are the point:

```text
alg    key                  sig bytes  token chars  sign/s   verify/s
HS256  32 B secret, shared        32          203  691198     788799
RS256  RSA 2048                  256          502    2983      95484
ES256  P-256                      64          246   75612      30242
EdDSA  Ed25519                    64          246   69069      28895
```

- **HS256**: one secret signs and verifies, so every verifier can also forge. Fine inside one service, wrong between teams. RFC 7518 section 3.2: the key MUST be at least 256 bits.
- **RS256**: private key signs, public key verifies and can be published. Large tokens, slow signing, very fast verifying (RFC 7518 requires 2048 bits or more). The default of most IdPs.
- **ES256**: same model with 64-byte signatures and a smaller token; verification is slower than RSA here. Use the ieee-p1363 encoding (`r || s`) that JOSE needs, not the DER that OpenSSL emits by default.
- **EdDSA**: Ed25519 (RFC 8037). Book versus today: RFC 9864 (October 2025) deprecates the polymorphic `EdDSA` identifier and registers fully specified `Ed25519` and `Ed448`; I did not check library support for the new names, so check yours before switching.

### JWE in one section: five parts, and why most "JWT" are only JWS

A JWE (RFC 7516) is `header.encrypted_key.iv.ciphertext.tag`. `alg` says how the content key is obtained (`dir` uses a shared key directly, `RSA-OAEP` wraps it) and `enc` how the payload is encrypted (`A256GCM`). Built by hand with `dir` and `A256GCM`:

```text
JWE parts (chars): [ 39, 0, 16, 58, 22 ]     (encrypted_key empty with dir)
JWE header : {"alg":"dir","enc":"A256GCM"}
payload readable without the key?  false
decrypt with the key  -> {"sub":"alice","email":"alice@example.org"}
one bit flipped       -> Unsupported state or unable to authenticate data
header edited         -> Unsupported state or unable to authenticate data
JWS parts: 3 | payload without any key -> {"sub":"alice","email":"alice@example.org"}
```

The header is the AES-GCM associated data, so editing it fails authentication. Access tokens and ID tokens are almost always JWS: the receiver is an API that must read the claims, and TLS already hides them in transit. Use a JWE when a token crosses an untrusted party and carries data that party must not read, or sign then encrypt (a nested JWT, `cty: JWT`).

### JWK, JWKS and the thumbprint (measured)

A JWK (RFC 7517) is a key as JSON: `kty` (`RSA`, `EC`, `OKP`), the key members, optional `use` (`sig` or `enc`), `alg` and `kid`. A JWKS is `{"keys":[...]}`, the URL an IdP publishes (OIDC `jwks_uri`; [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) measured it). `kid` is only a label for lookup. The RFC 7638 thumbprint is a name derived from the key itself: keep the required members, sort them, no whitespace, SHA-256, base64url. It reproduces the RFC's own vector, ignores `kid` and `use`, and is what DPoP puts in `cnf.jkt` ([concept 12](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators)):

```text
RFC 7638 section 3.1 vector : NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs (matches the RFC)
thumbprint (kid candidate)  : LkUc-itoiQX9icOE1fLllyZYOxhons9yUixMmmDZPsk | same with kid/use changed: true
```

### The naive verifier and the fixed one

The naive one trusts the header three times: algorithm (the lookup by `header.alg`), key (`loadKey(header)`) and the claims (it checks none). Every real bug below is a variation of one of these lines:

```js
export async function naiveVerify(token, loadKey) {
  const [h, p, s] = token.split('.');  const header = dec(h), claims = dec(p);
  const data = Buffer.from(`${h}.${p}`), sig = Buffer.from(s, 'base64url');
  const key = await loadKey(header);                       // key chosen from the header
  const ok = { none: () => true,                           // algorithm chosen by the token
    HS256: () => timingSafeEqual(createHmac('sha256', key).update(data).digest(), sig),
    RS256: () => verify('sha256', data, key, sig) }[header.alg]?.();
  if (!ok) throw new Error('bad signature');
  return claims;                                           // no iss, aud, exp, nbf, typ checks
}
// loaders applications really write: one configured PEM for every alg, a file named by kid,
// SQL built from kid, a key fetched from header.jku, a key taken from header.jwk
```

The fixed one takes its rules from configuration, never from the token:

```js
export function makeVerifier({ algs, keys, iss, aud, typ, skew = 60 }) {   // keys: Map<kid, KeyObject> built by the server
  return (token, t = now()) => {
    const [h, p, s, extra] = token.split('.');  if (s === undefined || extra) throw new Error('not a compact JWS');
    const header = dec(h), c = dec(p);
    if (!algs.includes(header.alg)) throw new Error(`alg ${header.alg} not in allowlist`);
    if (typ && String(header.typ).toLowerCase().replace('application/', '') !== typ) throw new Error(`typ ${header.typ} is not ${typ}`);
    const key = keys.get(header.kid);                      // kid is only a Map key; jku, jwk, x5u are ignored
    if (!key) throw new Error('unknown kid');
    if (!verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) throw new Error('bad signature');
    if (c.iss !== iss) throw new Error(`iss ${c.iss}`);
    if (![].concat(c.aud).includes(aud)) throw new Error(`aud ${JSON.stringify(c.aud)}`);
    if (typeof c.exp !== 'number' || t > c.exp + skew) throw new Error(`expired ${t - c.exp} s ago`);
    if (c.nbf !== undefined && t < c.nbf - skew) throw new Error(`not before, ${c.nbf - t} s ahead`);
    return c;
  };
}
```

### Pitfall by pitfall: same input, two verifiers (measured)

The attacker holds only the public JWKS, the claims format and a guess of the server layout. Each row is one forged token (the claims say `sub: mallory`, `scope: orders.admin`) sent to both verifiers:

| # | Forged input | Naive verifier | Fixed verifier |
|---|---|---|---|
| 0 | legit RS256 token | ACCEPTED alice | ACCEPTED alice |
| 1 | header `{"alg":"none"}`, empty signature | ACCEPTED mallory | REFUSED `alg none not in allowlist` |
| 2 | `alg: HS256`, MAC keyed with the RSA public key PEM | ACCEPTED mallory | REFUSED `alg HS256 not in allowlist` |
| 3a | `kid: ../public/robots.txt`, HS256 keyed with that file's content | ACCEPTED mallory | REFUSED `alg HS256 not in allowlist` |
| 3b | `kid: x' UNION SELECT 'attacker-secret' --`, HS256 keyed with it | ACCEPTED mallory | REFUSED `alg HS256 not in allowlist` |
| 4a | attacker's public key in header `jwk`, signed with his private key | ACCEPTED mallory | REFUSED `bad signature` |
| 4b | header `jku` pointing at the attacker's JWKS (127.0.0.1:7181) | ACCEPTED mallory | REFUSED `bad signature` |
| 4c | header `jku` pointing at an internal service (127.0.0.1:7182) | the verifier made the request | no request made |

What each one exploits:

1. **`alg: none`** (RFC 7515 appendix A.5 unsecured JWS): a verifier with a `none` branch is accepting "no signature needed". The fix is not "reject none" alone but an allowlist: anything not in it dies, `none` included (RFC 8725 section 3.1).
2. **RS256 to HS256** (algorithm confusion): the application holds one "verification key" and the library uses it for whatever `alg` says. For HS256 that key is read as an HMAC secret, and the public key is public. Here it works because the attacker's bytes equal the server's PEM; with a real library the PEM or JWK conversion must reproduce the same bytes, so exposure depends on that handling. The fix is the allowlist plus one algorithm per key; Node also refuses to use a public `KeyObject` as an HMAC key (`ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE`, measured).
3. **`kid` is an input**: `kid` selected a file (`readFileSync(`${dir}/${kid}`)`, path traversal to a file whose content the attacker knows) or went into SQL (`UNION SELECT` returned the secret the attacker chose). RFC 8725 section 3.10 names the SQL and LDAP injection. The fix is a lookup in a map the server built at start (or a parameterized query plus a strict pattern), where an unknown `kid` is an error.
4. **`jku`, `jwk`, `x5u` from the token** are the attacker supplying the verification key. `jku` also makes your server fetch an attacker-chosen URL: the internal listener on 7182 got exactly one request from the naive verifier and none from the fixed one (SSRF, RFC 8725 section 3.10). Keys come only from configuration or from the issuer's `jwks_uri`, which you discovered from `iss`. RFC 7515 section 4.1.2 requires TLS and server validation if you do follow a `jku`; an exact-URL allowlist is the minimum.

Rows 5 to 7 are valid, correctly signed tokens used in the wrong place (they are accepted by the naive verifier and refused by the fixed one):

| # | Token | Naive | Fixed |
|---|---|---|---|
| 5a | signed by the real key, `iss` `https://other-idp.example`, `aud` `billing-api` | ACCEPTED | REFUSED `iss https://other-idp.example` |
| 5b | `exp` 10 minutes ago | ACCEPTED | REFUSED `expired 600 s ago` |
| 5c | `nbf` 5 minutes ahead | ACCEPTED | REFUSED `not before, 300 s ahead` |
| 6 | ID token (`typ: JWT`, same issuer, key and `aud`) as an access token | ACCEPTED if iss, aud, exp are checked | REFUSED `typ JWT is not at+jwt` |

A signature proves who made the token, not that it was meant for you. `aud` stops a token for another API, `iss` another issuer, and `typ` another kind of token from the same issuer: RFC 9068 section 4 says a resource server MUST check `typ` is `at+jwt`, and RFC 8725 sections 3.11 and 3.12 ask for mutually exclusive validation rules per token kind ([concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) already shows `aud` and `nonce` for ID tokens). Clock skew, the same verifier with `exp` and `nbf` moved:

```text
exp 30 s ago     skew 0: REFUSED expired 30 s ago        | skew 60: ACCEPTED
exp 120 s ago    skew 0: REFUSED expired 120 s ago       | skew 60: REFUSED expired 120 s ago
nbf 120 s ahead  skew 0: REFUSED not before, 120 s ahead | skew 60: REFUSED not before, 120 s ahead
```

### JWKS cache and rotation: the new measurements (measured)

Concept 10 measured rotation with Keycloak. What it did not count is the cost of an unknown `kid` an attacker controls, and an IdP outage, against a local JWKS server:

```text
refetch on every unknown kid   JWKS requests: warm-up 1, after 50 unknown kids +50
cooldown 2 s                   JWKS requests: warm-up 1, after 50 unknown kids +0
rotation, k2 asked at once      -> unknown kid (inside cooldown)
rotation, k2 asked after 2.1 s  -> found (one refetch)
IdP down, known kid k1          -> verifies from the cache
IdP down, unknown kid           -> refused, no crash
```

Refetch on every unknown `kid` turns 50 junk tokens into 50 requests to your IdP; a cooldown makes it 0, at the price that a legitimately new key is refused until the cooldown ends (so publish the new key before signing with it). Keep the last good key set when the fetch fails, and keep the old key published until the longest token life has passed.

### Weak HS256 secrets: the arithmetic, not an attack

An HS256 token is a message and its HMAC, so anyone who sees one token can test a candidate secret offline: no server, no rate limit, no lockout. The defense is entropy, and RFC 7518 section 3.2 sets the floor (a key at least as large as the hash output, 256 bits for HS256). One guess is one HMAC; the cost of trying every key of a given kind, at the rate measured here (about 1.1 million HMAC-SHA256 per second on one core):

```text
secret                             bits   time to try every key (1 core, this machine)
8 chars, a-z                        37.6   52.8 h
8 chars, a-zA-Z0-9                  47.6   6.30e+0 years
16 chars, a-zA-Z0-9                 95.3   1.38e+15 years
32 random bytes (RFC 7518 minimum) 256.0   3.34e+63 years
```

A human-made short secret is in the first rows, and dedicated hardware is many orders of magnitude faster than one core, so only the last row is a safe design. Generate 32 random bytes from a CSPRNG, store them in a secret store, and prefer RS256 or ES256 when the verifier is not the issuer. No wordlist was used or tested here.

### What the libraries do by default (measured on this machine)

.NET, `JsonWebTokenHandler.ValidateTokenAsync` with `TokenValidationParameters` (`Microsoft.IdentityModel.JsonWebTokens` 8.23.0, key is an `RsaSecurityKey`):

| Input | Result |
|---|---|
| `alg: none`, defaults | INVALID `IDX10504: Unable to validate signature, token does not have a signature` |
| `alg: none`, `RequireSignedTokens = false` | VALID (sub mallory): never set it |
| HS256 keyed with the RSA public key PEM | INVALID `IDX10511` (same with `ValidAlgorithms = [RS256]`) |
| `jwk` or `jku` of the attacker in the header | INVALID `IDX10511`, the headers are not followed |
| legit key, `RS384` instead of `RS256` | VALID by default, INVALID with `ValidAlgorithms = [RS256]` |
| `kid` that matches no key | VALID with one `IssuerSigningKey` or with `IssuerSigningKeys` (`TryAllIssuerSigningKeys` is `true` by default); INVALID `IDX10500` when `false` |
| expired 2 min ago / 10 min ago; `nbf` 2 min ahead | VALID / INVALID; VALID (`ClockSkew` default 5 minutes) |
| ID token (`typ: JWT`) | VALID by default; INVALID `IDX10257` with `ValidTypes = ["at+jwt"]` |

So the handler already refuses `none` and the key-type confusion (the `RsaSecurityKey` cannot verify an HMAC), and ignores `jku` and `jwk`. What it leaves to you: `ValidAlgorithms` (the key limits the algorithm, not the other way around), `ValidTypes`, a smaller `ClockSkew`, and `TryAllIssuerSigningKeys = false` so that `kid` means something. Details of the ASP.NET Core middleware and claim mapping are in the [JWT Bearer concept](/dotnet-concepts/jwt-bearer-and-aspnet-core-identity).

Spring, `NimbusJwtDecoder.withPublicKey(...)` (Spring Security 7.1.1, Nimbus 10.9.1), same attacks:

| Input | Result |
|---|---|
| `alg: none` (a `PlainJWT`) | `BadJwtException: Unsupported algorithm of none` |
| HS256 keyed with the public key bytes | `Signed JWT rejected: Another algorithm expected, or no matching key(s) found` |
| `RS384` with the legit key, default decoder | rejected (the decoder expects RS256); VALID with `signatureAlgorithm(RS384)` |
| wrong `iss` and `aud`, default validators | VALID: only timestamps are checked by default; `createDefaultWithIssuer` rejects the `iss`, `aud` is yours to add |
| `exp` 30 s ago / 120 s ago | VALID / `Jwt expired` (default skew 60 s) |
| `typ: at+jwt`, default decoder | rejected: `the given typ value needs to be one of [JWT]` |
| `typ: at+jwt` with `validateType(false)` and `createAtJwtValidator().issuer().audience()` | VALID; the ID token (`typ: JWT`), wrong `aud` and wrong `iss` are each rejected |

The Spring default is strict on algorithm and key, lenient on `iss` and `aud` when you build the decoder from a bare public key (the builders from an issuer location or JWKS URI are docs only here). The Spring reference page shows `validateTypes(false)` while the 7.1.1 jar I measured exposes `validateType(boolean)`: check the name for your version. The signing and JWKS side is in the [Spring JWT signing concept](/spring-concepts/spring-security-jwt-signing-symmetric-and-asymmetric).

### Revocation: a JWT is valid until it expires

A verifier that checks signature and claims alone has no way to learn that a token was revoked. Options, each paid for in the same currency (state or latency):

| Option | Cost | Measured elsewhere |
|---|---|---|
| short `exp` (minutes) plus refresh | more refreshes; a stolen token lives up to `exp` | [concept 9](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles): 5-minute tokens |
| introspection (RFC 7662) | a call per request or a cache | [concept 9](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles): about 100 times slower than local, sees `active:false` after revoke |
| deny list by `jti` or a per-user version | a lookup per request: a session store again | [concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation): stolen copy refused only with the lookup |
| sender-constrained tokens (DPoP, mTLS) | client key handling | [concept 12](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators): stolen token refused without the key |
| issuer events (CAE, back-channel logout) | IdP and RP support | [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) and [18](/identity-concepts/session-management-cookies-fixation-and-revocation) |

### JWT as a browser session, and where to keep a token

Putting a JWT in a cookie in place of a session id keeps the cookie and loses what made it a session: [concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation) measured that logout only cleared the victim's copy, that a deny list or `ver` brings the store back, and that a claims-heavy token grew the cookie to 2229 bytes against 22 for a session id (past the 4096-byte cookie limit it is silently dropped). Use a server-side session for browser apps and a JWT for calls between services. A token in front-end JavaScript is readable by any XSS: the OWASP HTML5 cheat sheet says not to keep session identifiers in local storage, and [concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation) (BFF, `HttpOnly` cookie) shows where it should live instead.

### Book vs today, and where JWT is used now

Book: older tutorials put a JWT in `localStorage` as "stateless sessions", signed with a short HS256 secret and verified with whatever `alg` said. Today: JWT is the format of OAuth access tokens where the API checks locally (RFC 9068, `typ: at+jwt`, with the claims of [concept 9](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles)) and the mandatory format of OIDC ID tokens ([concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout)), while the session of a browser is an opaque id in a `__Host-` cookie ([concept 18](/identity-concepts/session-management-cookies-fixation-and-revocation)). RFC 8725 (2020) is the checklist and RFC 9068 (2021) the profile. PASETO (versioned, no algorithm field, so no `alg` to confuse; spec on GitHub) is an alternative format, but OIDC mandates JWT for ID tokens and RFC 9068 profiles JWT access tokens, so for tokens that cross vendors you will validate JWTs; opaque tokens plus introspection are the alternative where revocation matters more than local validation. I did not measure PASETO.

The checklist above is what [concept 10](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout)'s validation map assumes. Next in the track, OAuth token exchange ([concept 13](/identity-concepts/oauth-token-exchange-delegation-and-on-behalf-of)) issues JWTs with `act` and audience restriction and consumes them with the JWT bearer grant, and the [OAuth Security concept (12)](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators) adds DPoP and mTLS binding for the stolen-token problem raised in the revocation table.

## Trade-offs

- **JWT versus opaque access token.** A JWT verifies in microseconds and cannot be recalled; an opaque token costs a call and revokes at once. Short JWTs (5 minutes) plus revocable refresh tokens is the usual middle.
- **HS256 versus RS256 or ES256.** HS256 is fast and one secret, and every verifier can forge; asymmetric keys cost size (502 against 203 characters here) and key management and let the verifier be a different party.
- **Strict validation versus compatibility.** One algorithm, exact `iss`, `aud` and `typ` break the day the IdP changes them: roll out with both accepted for a while. A JWKS refetch cooldown shields the IdP and makes a new key wait (measured: `k2` refused at once, found after 2.1 s), so publish a key before signing with it.
- **Clock skew.** 60 seconds hides drift; .NET's default of 5 minutes extends every token by that long (measured: a token expired 2 minutes ago was VALID).

## Documentation Links

- [RFC 7515, JSON Web Signature (JWS), IETF](https://datatracker.ietf.org/doc/html/rfc7515) (doc)
- [RFC 7516, JSON Web Encryption (JWE), IETF](https://datatracker.ietf.org/doc/html/rfc7516) (doc)
- [RFC 7517, JSON Web Key (JWK), IETF](https://datatracker.ietf.org/doc/html/rfc7517) (doc)
- [RFC 7518, JSON Web Algorithms (JWA), IETF](https://datatracker.ietf.org/doc/html/rfc7518) (doc)
- [RFC 7519, JSON Web Token (JWT), IETF](https://datatracker.ietf.org/doc/html/rfc7519) (doc)
- [RFC 7638, JSON Web Key (JWK) Thumbprint, IETF](https://datatracker.ietf.org/doc/html/rfc7638) (doc)
- [RFC 8725, JSON Web Token Best Current Practices, IETF](https://datatracker.ietf.org/doc/html/rfc8725) (doc)
- [RFC 9068, JWT Profile for OAuth 2.0 Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc9068) (doc)
- [RFC 9864, Fully-Specified Algorithms for JOSE and COSE, IETF](https://datatracker.ietf.org/doc/html/rfc9864) (doc)
- [JSON Object Signing and Encryption (JOSE) registry, IANA](https://www.iana.org/assignments/jose/jose.xhtml) (doc)
- [JSON Web Token Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) (doc)
- [HTML5 Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) (doc)
- [TokenValidationParameters.ValidAlgorithms, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.identitymodel.tokens.tokenvalidationparameters.validalgorithms) (doc)
- [OAuth 2.0 Resource Server JWT, Spring Security Reference](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) (doc)
- [PASETO specification, paseto-standard on GitHub](https://github.com/paseto-standard/paseto-spec) (doc)
