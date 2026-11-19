---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Login proves who you are once; a session is what keeps the user logged in without a password on every request, and what you must be able to end. This lesson builds a toy session server (Node 22, no framework, 330 lines, every defense a switch) and measures the attacks and fixes with curl: why a session id needs 128 random bits, what each `Set-Cookie` attribute changes, session fixation and its one-line fix, idle against absolute expiry, "remember me", CSRF with four defenses, real logout, "sign out everywhere", revocation on password change and on SCIM `active:false`, JWT as a session cookie against the same tests, a shared Redis store and what happens when it dies. The browser-side behavior (`SameSite`, prefixes) is read from MDN and the cookie drafts and marked docs only, because curl has no notion of "site". The OIDC logout mechanisms, refresh rotation and rate limiting are measured in the lessons this one requires or relates to, and are not repeated.
Versions: Node 22.23.4, curl 8.7.1, jq 1.7.1, `redis:7.4-alpine` (Docker), OWASP Session Management and CSRF Prevention cheat sheets and `draft-ietf-httpbis-rfc6265bis-22` (read 2026-11-19), RFC 10017.

## Use Cases

- Reviewing a login feature and listing what must happen after the password check.
- Deciding between a server-side session and a JWT cookie for a browser app.
- Making logout, password change and account disabling actually end access.
- Explaining why a SPA should not keep tokens in `localStorage`.

## Deep Dive

### The session id: 128 random bits, hashed at rest (measured)

A session is a record on the server (user, `created`, `last`, `authTime`) and an id the browser returns in a cookie. The id is a bearer secret: whoever holds it is the user, so guessing must be hopeless. OWASP asks for at least 64 bits from a CSPRNG and 128 when you generate your own. A counter has almost none:

```text
counter ids   : 1001 1002 1003 -> next one is 1004
randomBytes(16): iBf-9BWaTfXbbqng6DYYjA    MAsBdoFd1wyG5zgDWQqP_g    Nf8RkzbiQ_ESJ_huKJH4Aw
128-bit space 3.40e+38; years to hit one of 1e5 live ids at 1e4 guesses/s: 1.08e+22
64 bits = 11 base64url chars (16 hex); 128 bits = 22 base64url chars (32 hex)
```

The same arithmetic with 64 bits gives OWASP's 585 years. Against the toy running `ID_GEN=counter`, an attacker who is given `sid=1002` just walks to the neighbor while alice logs in:

```text
attacker opens the site            -> Set-Cookie: sid=1002
alice logs in (never seen)         -> Set-Cookie: sid=1003 ; {"user":"alice"}
sid=1000 -> not authenticated   sid=1002 -> not authenticated   sid=1003 -> {"user":"alice"}
```

`Math.random()` is no better: MDN says it does not provide cryptographically secure numbers. Use `crypto.randomBytes(16)` (or the framework's generator), not a timestamp, a hash of the user name or anything with a fixed part: OWASP notes that a fixed half of an id halves the bits. The toy keys the store by `sha256(id)`, so a dump of Redis or a log line does not hand out working cookies (OWASP: store a one-way verifier when read-only disclosure of the store is in your threat model).

### Server session against JWT as the session (measured)

The toy can also put a signed JWT (HS256, `node:crypto`) in the cookie. Same attacker, same tests (a stolen copy of the cookie, kept by someone who sniffed it before logout):

```text
JWT, no revocation check   logout -> victim browser: malformed   stolen copy: {"sub":"alice"}   (valid until exp)
JWT + deny list by jti     logout -> stolen copy: {"error":"denied jti"}
JWT + users.alice.ver      admin bumps ver -> victim and stolen copy: {"error":"stale ver"}
rotate the HS256 key       same token: {"error":"bad signature"}   (every user logged out at once)
cookie size  0 extra claims: 243 B   20: 896 B   60: 2229 B   server session id: 22 B
```

Logout only cleared the victim's cookie: the token still worked for anyone who copied it, until `exp`. The two fixes are the instructive part: a deny list keyed by `jti` and a per-user version are both a server lookup on every request, which is a session store with extra steps. A cookie also has a ceiling: the cookie draft says a user agent ignores a `Set-Cookie` whose name plus value exceed 4096 octets, so claims-heavy tokens silently stop working (the .NET BFF lesson measured the same split at 4 KB). Server-side ids win for browser sessions because deleting a row is revocation. JWTs fit API calls between services, with short lifetimes (the IAM lesson compares them), and refresh rotation and logout tokens are in the OAuth and OIDC lessons.

### Set-Cookie, attribute by attribute (curl measured, browser docs only)

`/set?c=...` makes the toy emit exactly the header asked for, over HTTPS (self-signed, `curl -k`) and plain HTTP, host `foo.test` mapped to 127.0.0.1 with `--resolve`. What curl's cookie engine stores and sends:

```text
HttpOnly                    jar line "#HttpOnly_foo.test ..." ; curl still sends it
Secure                      https: sid=a | plain http: none      (no Secure: sent on both)
Path=/echo                  /cookies: none | /echo/x: sid=a | /echo2: none
no Domain                   foo.test: sid=a | a.foo.test: none   (host-only)
Domain=foo.test             foo.test: sid=a | a.foo.test: sid=a  (subdomains included)
Domain=example.com          (set by foo.test) cookies stored: 0
Max-Age=3600                jar expiry minus now = 3600 s
Set-Cookie: sid=; Max-Age=0 -> cookie sent: none, stored: 0
Max-Age=3600 + Expires=1970 -> stored: 1 (Max-Age wins)
__Host-sid=a; Secure; Path=/                       stored 1
__Host-sid=a; Secure; Path=/; Domain=foo.test      stored 0
__Host-sid=a; Secure; Path=/x                      stored 0
__Host-sid=a; Path=/ (no Secure)                   stored 0
__Secure-sid=a; Secure -> stored 1        __Secure-sid=a (no Secure) -> stored 0
```

A cookie is sent to a request when host, path and scheme match; `HttpOnly` only hides it from `document.cookie` (MDN: it is still sent by `fetch`, so it stops XSS from reading the id, not XSS from using the session). `Domain` is the dangerous knob: it widens the cookie to every subdomain, and OWASP says to leave it off. The prefixes make the browser enforce the rules: `__Host-` requires `Secure`, no `Domain`, `Path=/`, which also stops a sibling subdomain from overwriting the cookie (curl 8.7.1 enforced them, as the table shows). `Max-Age` beats `Expires`, a clock-independent lifetime; the draft recommends browsers cap lifetimes at 400 days.

`SameSite` is the one attribute curl cannot show (it has no "site"), so it is docs only. MDN and the CSRF cheat sheet: `Strict` withholds the cookie from every cross-site request, including a click on a link to your site; `Lax` sends it on top-level navigations with safe methods (GET); `None` always sends it and requires `Secure`. A cookie with no `SameSite` is Lax in Chromium, not in Firefox or Safari, and "Lax by default" browsers send it on cross-site top-level POSTs for about two minutes after it is set, so always set it explicitly. The session cookie to ship:

```text
Set-Cookie: __Host-sid=<22 chars>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
```

Strict is stronger, but a user who follows an e-mail link arrives without the cookie and looks logged out until the next click. RFC 10017 (BFF) asks for `SameSite=Strict` and the `__Host-Http-` prefix (MDN: like `__Host-`, and the cookie must be `HttpOnly`, proving it came from a header).

### Session fixation (measured)

In fixation the attacker does not steal the id: he picks it. He plants a known id in the victim's browser (a link with the id in the URL, a cookie set from a sibling subdomain, a header injection), waits for the victim to log in, and the session he already knows is now authenticated. The naive toy (`STRICT=0 REGEN=0`: accepts any id, keeps it at login):

```text
attacker plants sid=attacker-chosen-id-123
victim logs in sending that cookie:   Set-Cookie: sid=attacker-chosen-id-123  {"user":"alice","regenerated":false}
attacker, holding only that id:       {"user":"alice","via":"login"}
```

Two independent fixes, and the table shows why both matter:

| Server | Planted id | Result |
|---|---|---|
| accepts any id, no regeneration | made up | attacker is alice |
| accepts any id, regenerates at login | made up | `Set-Cookie: sid=nLHKhV...`, attacker 401 |
| strict (only ids it issued), no regeneration | made up | new id issued, attacker 401 |
| strict, no regeneration | a real anonymous id the attacker got from the site | `regenerated:false`, attacker is alice |
| strict and regenerating (default) | real anonymous id | new id, `{"error":"not authenticated"}` |

Strict mode alone fails against an attacker who first obtains a real anonymous session, which every site hands out. The cure is what OWASP states: renew the id at login and on any privilege change, and destroy the old one. The log shows it: `session.create user:null`, then `session.destroy why:"regenerate at login"`, then `session.create user:"alice"`. Also accept ids only from cookies (never a URL parameter), and keep the cookie `__Host-` so a subdomain cannot plant one.

### Expiry: idle against absolute (measured)

The toy has `IDLE_MS` (reset by each request) and `ABS_MS` (from creation), scaled to 2 s and 6 s from the usual 15 minutes and 8 hours. OWASP gives 2 to 5 minutes idle for high-value apps, 15 to 30 for low risk, and 4 to 8 hours absolute for a workday.

```text
A) a request every second:   t=1..5 s ok;  t=6 s, 7, 8: {"error":"not authenticated"}   -> session.destroy why:"absolute"
B) fresh login, 3 s of silence:                                                         -> session.destroy why:"idle"
```

Idle expiry limits the window for a forgotten laptop but not for a hijacker who keeps the session warm (the A run is exactly a script pinging every second); absolute expiry bounds the hijack no matter what. Keep both, enforce both on the server (browser close is not a reliable signal: session restore keeps session cookies, per MDN), and in Redis the TTL is `min(idle, remaining absolute)`, so the store forgets for you. Re-authentication for sensitive actions is a third clock: after `authTime` older than `REAUTH_S` a 600 transfer returned `{"error":"reauth_required","max_age":2}`; `POST /reauth` with the password issued a new id, the old id returned 401, and the transfer then went through. That is step-up, and the id changes there too (elevation counts as a privilege change).

### Remember me: a second credential (measured)

"Stay signed in for 30 days" must not be a 30-day session id: that id would be one stolen cookie away from a month of access, and it is stored the same way as a short one. The common design is a separate persistent cookie `rm=<selector>.<validator>`: the selector (72 random bits) finds a row, the validator (192 bits) is compared against `sha256(validator)` stored in the row, with `timingSafeEqual`, so a database leak yields no usable cookie. It is exchanged for a fresh normal session, and rotated on every use:

```text
session idle-expired, /me with sid only:        {"error":"not authenticated"}
/me with the rm cookie (browser reopened):      {"user":"alice","via":"remember"}      (new sid and new rm issued)
real selector, guessed validator:               {"error":"remember token reuse: all sessions revoked"}
login again, rotate, then replay the OLD rm:    {"error":"remember token reuse: all sessions revoked"}
log: session.revokeAll why:"remember-me theft signal" and why:"remember-me reuse"
```

The row of a used token stays as a tombstone, so a replay is recognized instead of looking like an unknown selector, and a theft signal kills everything for that user. This is the same reuse detection as refresh-token rotation (OAuth lesson), with the same cost: a flaky client that replays a token logs the user out. Treat a remember-me login as lower trust: sensitive actions still ask for the password (the step-up above).

### CSRF: the browser attaches the cookie for you (measured)

A cookie is sent on every request to its host, whoever caused the request. A page on `evil.test` that auto-submits a form to `/transfer` makes the browser add alice's cookie. The toy's `/transfer` with the cross-site headers a browser would add:

```text
no defense:        POST /transfer (Origin: http://evil.test, Sec-Fetch-Site: cross-site) -> alice 900, mallory 100
synchronizer token (random token inside the session, header X-CSRF-Token):
   no token / wrong token  -> 403 {"error":"csrf","why":"csrf token missing or wrong"}
   token from /csrf-token  -> 200 transfer
naive double submit (cookie csrf must equal header):
   attacker plants csrf=x and sends X-CSRF-Token: x       -> 200, mallory 100   (defeated)
signed double submit (token = HMAC(secret, session id), cookie and header must both match):
   attacker plants csrf=x                                 -> 403 signed double submit mismatch
   server-issued pair                                     -> 200
   a valid-looking pair that is not bound to this id      -> 403
Fetch Metadata / Origin, no token at all:
   Sec-Fetch-Site: cross-site  -> 403 ; only Origin: http://evil.test -> 403 ; same-origin -> 200
   neither header (curl)       -> 200   (not a browser: nobody is riding the victim's cookie)
```

Each defense answers a different question. The synchronizer token needs session state but is hard to forge (OWASP's first choice for stateful apps). Naive double submit is stateless and breaks when the attacker can write a cookie (a sibling subdomain, plain-HTTP injection, no `__Host-`), which is why OWASP now recommends the signed variant bound to the session id. Fetch Metadata (`Sec-Fetch-Site`, sent by all major browsers since March 2023 per OWASP) needs no client change, but needs the `Origin` fallback and breaks when a proxy strips the headers; add `Vary: Sec-Fetch-Site, Origin` on responses that depend on them. `SameSite` helps but OWASP is explicit that it is defense in depth: the toy's `GET /transfer?to=mallory&amount=50` is sent by a Lax cookie on a top-level navigation and moved 50, so a state change on GET is CSRF whatever the cookie says, and "same site" covers every subdomain of the registrable domain. A custom header such as `X-CSRF: 1` (the .NET BFF lesson) also works for fetch-only APIs, because a cross-origin request with it needs a CORS preflight.

### Real logout, sign out everywhere, leavers (measured)

Deleting the cookie is not logging out. The toy with `LOGOUT_SERVER=0` clears the cookie in the response and leaves the record; the same request against the default:

```text
cookie-only logout:  victim browser: not authenticated | stolen copy of the cookie: {"user":"alice"}
server-side logout:  victim browser: not authenticated | stolen copy:                not authenticated
```

OWASP: deleting a cookie does not invalidate a stolen copy, and after logout none of the ids may be accepted. The rest is the same primitive, "delete rows" (`u:<user>` indexes the user's session hashes):

```text
GET /sessions                  -> [{"id":"ee1a0843","current":true,"ua":"Mozilla/5.0 (Macinto"},
                                   {"id":"a3ab7c86","current":false,"ua":"Mozilla/5.0 (iPhone)"}, {"id":"5cd9225f",...,"ua":"curl/8.7.1"}]
DELETE /sessions/a3ab7c86      -> phone now: not authenticated
POST /logout-all               -> {"revoked":2}   laptop and work: not authenticated
POST /password (from laptop)   -> {"revokedOthers":1}; phone dead, laptop's old id dead, new id works
SCIM PATCH active:false (bearer scim-secret) -> {"active":false,"revoked":2}; bob's session dead, login: bad credentials
POST /backchannel-logout sid=IDP-77 -> {"deleted":2}   (toy of the OIDC logout token: sessions indexed by the IdP `sid`)
```

The list is a feature OWASP recommends (IP, user agent, created, last seen, and a way to kill one). Password change must end the other sessions and rotate the caller's own id, because the password is what an attacker may have used. The leaver case ties to the lifecycle lessons: when the IdP disables the account (the SCIM lesson's `active:false`), the app must drop sessions at that moment, and the toy also re-checks `active` on every lookup, which covers a missed call. Without both, a disabled employee keeps a working session until the idle timeout.

### SSO, chained sessions and the BFF

With SSO there are two session layers: the IdP's cookie and one per app. Logging out of one app does nothing to the others unless the IdP tells them, which is what front-channel (iframe, browser-dependent) and back-channel (server POST with a `sid`) logout do; the OIDC lesson measured both. The toy's `idp_sid` index is the minimum an app needs: map the IdP session id to local session hashes, and delete them on the notification. Remember that logging out of the app alone leaves the IdP session, so the next challenge signs the user straight back in.

A single-page app has a worse problem: any token JavaScript can read is exposed to XSS, and OWASP says plainly not to store tokens or session ids in `localStorage` or `sessionStorage`. RFC 10017 (the browser-apps BCP, formerly an Internet-Draft) describes "persistent token theft": a script reading the token every 10 seconds defeats short lifetimes and refresh rotation, because the attacker always holds the latest one. Its recommended architecture is the BFF: the browser holds only an `HttpOnly` session cookie, the BFF is the confidential OAuth client, keeps access and refresh tokens in the session record and adds the bearer when it forwards calls. The toy's `/bff/*` (the OAuth exchange replaced by a stand-in login, covered in the OAuth lesson) measured the shape:

```text
cookies the browser holds:      sid (HttpOnly) only, no token anywhere in a body or header (0 matches for "at-")
/bff/orders, cookie, no header: 400 {"error":"missing X-CSRF header"}
/bff/orders, cookie + X-CSRF:   200 {"orders":[1,2,3],"saw":"Bearer at-1-yJR..."}   (the resource server saw the bearer)
resource server with the cookie only: 401 no bearer
```

XSS can still send requests as the user through the BFF while the page is open, but it cannot carry a token away, and logout or revocation kills the record. The ASP.NET Core implementation (OIDC handlers, `__Host-` cookie, `SaveTokens`, YARP) is in the OIDC, Entra ID and BFF lesson of the .NET track.

### Sessions at scale: a shared store, affinity and what happens when it dies (measured)

Two toy instances with their own memory behave like two apps behind a round-robin balancer:

```text
in-memory:  login on A -> request to A ok | the same cookie to B: not authenticated | restart A: not authenticated
Redis (STORE=redis, SET key PX ttl):  login on A -> request to B ok | restart A: ok | logout on B -> request on A: not authenticated
keys: sess:db3f2923883b... (sha256 of the id), u:alice   PTTL 899876 ms = idle timeout, not the 8 h absolute
```

Options: sticky sessions (affinity by cookie, so one instance owns the user: simple but a restart or scale-in loses the session; the MCP hosting lesson measured cookie affinity at 20 of 20 and a 404 after `docker restart`), a shared store (Redis or a database: any instance serves any request and logout is global, at the price of a network hop per request), or the cookie holding the state (encrypted and signed, no store, but revocation and size return). Serialize the record in a versioned format, because a deploy that changes the shape must still read old sessions.

The store becomes a dependency of every request. Stopping Redis made the authenticated request return `503 {"error":"session store unavailable"}`, and so did the anonymous `/` that must create a record, while `/health` kept answering: fail closed. Failing open (treating a missing store as "valid") would turn an outage into an authentication bypass, so don't. After `docker start` the cookie worked again (a graceful stop, and `appendonly` was `no`); a hard crash with no persistence can lose sessions (not measured), which for sessions is often acceptable: users log in again.

### Signals to re-evaluate a session

A session can be questioned after login. Cheap signals: a user-agent change (the toy's `BIND=ua` kills the session on the first mismatch, and an attacker who copies the header defeats it, so it is a tripwire, not a control), IP or country change, impossible travel, a new device, a request for a sensitive action (the step-up above, `max_age` and `acr` in the OIDC lesson). Binding to the IP breaks on mobile networks. The stronger idea is to let the IdP push events: Microsoft's Continuous Access Evaluation (docs only, not measured, needs a tenant) lets services such as Exchange Online and SharePoint subscribe to critical events (user disabled or deleted, password change or reset, MFA enabled, an admin revoking all refresh tokens, high user risk) and location policies and enforce them in near real time; their docs say latency can reach 15 minutes, and CAE sessions get access tokens of up to 28 hours because revocation, not a short expiry, ends them. It is the pattern of this lesson (a revocation channel) applied to bearer tokens.

### Threat, mechanism, defense, what to measure

| Threat | Mechanism | Defense | What to measure |
|---|---|---|---|
| Id guessing | predictable or short id | 128-bit CSPRNG id, hashed at rest | ids from `randomBytes`, no counter, unknown-id rate |
| Fixation | accept or keep a planted id | regenerate at login and elevation, cookie-only, `__Host-` | log: destroy before create at login |
| Id theft (network) | plain HTTP, no `Secure` | `Secure`, HSTS, `__Host-` | cookie never sent over http |
| Id theft (XSS) | script reads the cookie or token | `HttpOnly`, no tokens in web storage, BFF | no token in any body or storage |
| CSRF | browser attaches cookie | `SameSite`, token (synchronizer or signed double submit), `Sec-Fetch-Site`, no GET mutations | forged POST gets 403, GET is safe |
| Long hijack | session kept warm | absolute timeout, step-up, signals | session age at destroy, reasons |
| Logout that is not | only the cookie is cleared | delete on the server, back-channel for SSO | stolen copy returns 401 |
| Leaver or reset | session outlives the account | revoke on `active:false`, password change, logout-all | live sessions per disabled user = 0 |
| JWT cannot be revoked | stateless validation | server session, or deny list, `ver`, short TTL | revoked token returns 401 |
| Store outage | shared state dependency | fail closed, replicas, short TTLs | 503 rate, store latency |

Next in this track: identity threats (I19) covers what attackers do to accounts and sessions (token and cookie theft, adversary-in-the-middle, account recovery abuse), and authorization models (I15) covers what an authenticated session may do, which a session does not answer.

## Trade-offs

- **Server session against signed cookie or JWT.** The server session is revocable and tiny, and costs a store lookup and an operational dependency; a stateless token scales without a store and cannot be revoked before `exp` (measured: the stolen copy still worked), so adding a deny list or `ver` brings the lookup back.
- **Strict against Lax.** Strict closes more CSRF and breaks the first request from an external link (the user looks logged out); Lax keeps links working and allows cross-site GET, so no GET may change state.
- **Idle timeout length.** Short is safer and costs re-logins; long keeps users happy and widens the window. OWASP suggests 2 to 5 minutes for high-value apps and 15 to 30 for low risk, always with an absolute cap.
- **Remember me.** Convenience for a month against a persistent credential: keep it separate, hashed, rotated, and never enough for a sensitive action.
- **Sticky sessions against a shared store.** Affinity is a config flag but loses sessions on restart and scale-in; a store adds a hop and a failure mode (fail closed, plan capacity), and gives global logout.
- **Id renewal during a session.** Rotating the id mid-session (OWASP's renewal timeout) shrinks the theft window and can race with parallel requests; keep the old id for a short grace period.

## Documentation Links

- [Session Management Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) (doc)
- [Cross-Site Request Forgery Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) (doc)
- [RFC 6265, HTTP State Management Mechanism (Cookies), IETF](https://datatracker.ietf.org/doc/html/rfc6265) (doc)
- [Cookies: HTTP State Management Mechanism, draft-ietf-httpbis-rfc6265bis, IETF](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) (doc)
- [Set-Cookie header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) (doc)
- [Sec-Fetch-Site header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) (doc)
- [RFC 10017, OAuth 2.0 for Browser-Based Applications, IETF](https://datatracker.ietf.org/doc/html/rfc10017) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [OpenID Connect Back-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-backchannel-1_0.html) (doc)
- [Continuous access evaluation, Microsoft Entra, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation) (doc)
