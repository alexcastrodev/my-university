---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A password and a TOTP code are shared secrets: the server knows (or can recompute) what the user types, so a fake site that collects it can replay it. WebAuthn replaces the secret with a key
pair per site: the private key never leaves the authenticator, the server stores only the public key, and the signature covers the origin the browser saw. This lesson measures it with no
browser and no hardware: a software ES256 authenticator, a browser stand-in and a relying-party (RP) server I wrote (323 lines of Node 22, `node:crypto` only, with a 30-line CBOR codec). It
decodes a real `authData` byte by byte, verifies an assertion, logs in without a username, shows an attacker's origin rejected where a TOTP code is accepted, catches a clone by `signCount`,
and compares synced and device-bound passkeys. The ASP.NET implementation is a sibling concept; this one is the protocol.
Versions: Node 22.23.4; WebAuthn Level 2 (W3C Recommendation, 8 April 2021) and Level 3 (Candidate Recommendation Snapshot, 26 May 2026), read at w3.org.

## Use Cases

- Reading a registration failure: which of challenge, origin, rpIdHash, flags or signature broke.
- Choosing `userVerification`, `residentKey` and `attestation` for a product or a regulated environment.
- Explaining to a reviewer why passkeys resist phishing and TOTP does not.

## Deep Dive

### What changes compared with a shared secret

| | Password / TOTP | WebAuthn credential |
|---|---|---|
| Server stores | hash, or the TOTP seed | a public key |
| Server breach leaks | material to attack or replay | nothing that logs anyone in |
| What the user sends | a secret they can type anywhere | a signature made for one `rpId` |
| Fake site collects it | works, replayable | cannot be produced for the real site |

Three parties take part. The **RP** is your server. The **client** (browser and OS) enforces which site may ask for which `rpId` and writes the origin into `clientDataJSON`. The
**authenticator** (phone, laptop TPM, security key, password manager) holds the keys and signs. A **passkey** is the user-facing name for a discoverable WebAuthn credential (passkeys.dev),
in two flavors: synced across devices, or bound to one device.

My stand-in has the same split: `Authenticator` (sees only `rpId` and a hash), `Browser` (writes the real origin, refuses a foreign `rpId`) and an HTTP RP with four routes (`/register/*`,
`/login/*`, `options` and `verify`) exchanging the JSON a real browser sends.

### Registration: the options the RP decides

`navigator.credentials.create({ publicKey })` receives what `/register/options` returned (challenge shortened):

```json
{"challenge":"HFJz7Yu6Ly-e...","rp":{"id":"example.com","name":"Example"},"user":{"id":"RDWejTPJ...","name":"alice","displayName":"alice"},
 "pubKeyCredParams":[{"type":"public-key","alg":-7},{"type":"public-key","alg":-257}],
 "authenticatorSelection":{"residentKey":"required","userVerification":"required"},"attestation":"none","timeout":60000}
```

- `challenge`: 32 random bytes, single use (the spec says at least 16).
- `rp.id`: a registrable domain suffix of the page origin. Credentials are scoped to it for life.
- `user.id`: an opaque handle of at most 64 bytes with no personal data (not the email, not the username).
- `pubKeyCredParams`: accepted algorithms in preference order: `-7` ES256 (P-256), `-257` RS256 (RSA, still needed by some Windows setups; docs only, my authenticator signs only ES256).
- `authenticatorSelection`: `residentKey` and `userVerification`, covered below.

### The response: clientDataJSON and attestationObject

The browser returns two byte strings. `clientDataJSON` is plain JSON, written by the browser and not by the page:

```text
{"type":"webauthn.create","challenge":"HFJz7Yu6Ly-ecvOLq7PkiRpNsyeh8QS9OJaWS4KzGXg",
 "origin":"https://example.com","crossOrigin":false}
```

`attestationObject` is CBOR (RFC 8949), 194 bytes here, a map with three keys: `fmt` (`none`), `attStmt` (empty for `none`) and `authData`. The 164 bytes of `authData`, decoded by my parser
(one real run):

```text
off  hex                                           meaning
  0  a379a6f6eeafb9a55e378c118034e2751e682fab...  rpIdHash = SHA-256("example.com") (matches)
 32  45                                            flags 0b01000101: UP=1 UV=1 BE=0 BS=0 AT=1 ED=0
 33  00000000                                      signCount = 0
 37  0123456789abcdef0123456789abcdef              AAGUID (16 bytes, identifies the authenticator model)
 53  0020                                          credentialId length = 32
 55  789762e2464e5684d348308144b6962767748d8f...   credentialId (random, picked by the authenticator)
 87  a501020326200121582051cf60eb491e6b23df94...   credentialPublicKey, COSE_Key CBOR (77 bytes)
```

The flags byte is `0x45`: bit 0 UP (user present, a touch), bit 2 UV (user verified: PIN or biometric), bit 3 BE (backup eligible), bit 4 BS (backup state), bit 6 AT (attested credential
data follows), bit 7 ED (extension data follows). The public key is a COSE_Key (RFC 9052), a CBOR map with integer keys: `1:2` kty EC2, `3:-7` alg ES256, `-1:1` crv P-256, `-2` x and `-3` y
(32 bytes each). The 77 bytes are one map header, three 2-byte pairs and two 35-byte coordinate entries. In an assertion there is no `AT`, so `authData` is only the first 37 bytes.

The server verifies in this order (each step names its error in my code): `type` is `webauthn.create`; `challenge` is one it issued and not yet used; `origin` is the expected one; `rpIdHash`
is SHA-256 of its `rpId`; UP is set; UV is set when required; `alg` is one it offered; `fmt` and `attStmt` check out; BS is not set without BE. Then it stores:

```text
{"username":"alice","publicKey":"COSE_Key (5 entries)","signCount":0,"transports":["internal"],"uv":true,"be":false,"bs":false,"aaguid":"0123...cdef","fmt":"none"}
```

Keep `credentialId` (the lookup key), the public key, `signCount`, `transports` (hints for a later `allowCredentials`) and the UV and BE/BS seen at registration. No secret: a leak of this
table logs nobody in.

### Authentication: what is signed and how it is verified

`credentials.get` returns `clientDataJSON` (`type` now `webauthn.get`), `authenticatorData` (37 bytes) and a DER-encoded ES256 `signature` (72 bytes in this run) over `authData ||
SHA256(clientDataJSON)`, which is 37 + 32 = 69 bytes. That one construction is the trick: `authData` carries the hash of the `rpId`, `clientDataJSON` carries the challenge and the origin.
The core of the server:

```js
const raw = unb64u(authenticatorData), ad = parseAuthData(raw);
checkAuthData(ad, p);   // rpIdHash == sha256(RP_ID), UP, UV if required
if (!verify('sha256', Buffer.concat([raw, sha256(cdBytes)]), publicKey, unb64u(signature))) fail('signature', 'invalid');
if ((ad.signCount || c.signCount) && ad.signCount <= c.signCount) fail('signCount', ...);
c.signCount = ad.signCount;
```

Before that, `takeChallenge` checks `type`, deletes the challenge (single use) and compares `origin`. A real server binds the challenge to the session; mine keys it by value to stay short.
Measured:

```text
login with username      OK  {"user":"alice","signCount":1,"uv":true}
same response again      REJECTED  challenge: unknown or already used
```

### Discoverable credentials: login without a username

With `residentKey: "required"` the authenticator stores the `user.id` next to the key (a discoverable credential, formerly "resident key"). The RP sends an empty `allowCredentials`, the
authenticator offers its credential for that `rpId` and returns the `userHandle`:

```text
allowCredentials sent: []  userHandle returned: RDWejTPJ...
login without username   OK  {"user":"alice","signCount":2,"uv":true}
```

The server finds the credential by `credentialId` and checks the `userHandle` belongs to it. Passkeys are discoverable credentials by definition, which enables the "Sign in with a passkey"
button and browser autofill (conditional UI, docs only). A non-discoverable credential needs the username first so the RP can list `allowCredentials`; answering with a fake list for unknown
usernames avoids revealing which accounts exist (docs only).

### Origin binding: the phishing test (measured)

The attacker runs `https://evil.example`, relays the real challenge and asks the user's authenticator to sign. Four layers say no:

```text
evil page asks for rpId example.com : SecurityError: rpId example.com is not a domain suffix of evil.example
evil page asks for its own rpId    : NotAllowedError: no credential for this rpId
rogue client: origin lie, rpId example.com   REJECTED  origin: expected https://example.com, got https://evil.example
assertion made for rpId evil.example         REJECTED  rpIdHash: does not match SHA-256 of example.com
```

1. The browser refuses an `rpId` that is not a suffix of the page origin.
2. With its own `rpId`, the authenticator has no credential for `evil.example`: nothing to sign.
3. A rogue client (malware, not a browser) can write any `clientDataJSON` and the authenticator signs it, because it never sees the origin. The RP rejects the `origin`.
4. A signature made for another `rpId` fails on `rpIdHash`.

The basic checks fail as expected too: a wrong challenge (`challenge: unknown or already used`) and one flipped bit in the signature (`signature: invalid`). Now the same attack on TOTP: the
victim types six digits into the fake page and the attacker relays them inside the 30 second window:

```text
TOTP typed at evil.example, relayed to the RP within the window: ACCEPTED
```

A TOTP code carries no site identity, so an adversary-in-the-middle page wins (the MFA factors concept covers the algorithm). A passkey assertion is tied to `example.com`, so the same page
gets nothing it can reuse, and the user cannot be tricked into "approving the wrong site" because the choice is not theirs.

### signCount and cloned authenticators

An authenticator SHOULD increment a counter on every assertion and the RP stores the last value. Per the spec, if either value is non-zero and the new one is less than or equal to the stored
one, a clone may exist (or a race, or a malfunction). Measured: I copy the key, the legit key logs in (stored 7), then the clone signs with a counter that is also 7:

```text
legit login (counter moves on)     OK  {"user":"alice","signCount":7,"uv":true}
clone signs with the old counter   REJECTED  signCount: 7 <= stored 7: possible cloned authenticator
```

The next legit login showed 6, not 3, because the authenticator also signed the three requests the RP rejected in the previous section (rogue origin, wrong challenge, flipped bit): it counts
signatures, not logins. Authenticators without a counter send 0 forever, which the rule accepts (both zero). It is a signal, not proof: decide whether a hit blocks the login or raises an
alert.

### Synced passkeys against device-bound

BE (backup eligible) is fixed when the credential is created; BS (backup state) says whether it is backed up now. Valid pairs: BE=0 BS=0 single-device; BE=1 BS=0 multi-device, not backed up;
BE=1 BS=1 multi-device and backed up. BE=0 BS=1 is not allowed (my RP rejects it). My phone stand-in, backup eligible and counterless:

```text
synced: flags=0x5d BE=1 BS=1 {"ok":true,"fmt":"none","flags":93,"be":true,"bs":true,...}
bob login, twice (signCount stays 0)   OK  {"user":"bob","signCount":0,"uv":true}
```

`0x5d` is UP+UV+AT plus BE and BS. Synced passkeys (iCloud Keychain, Google Password Manager, password managers) give recovery and many devices, but the key lives in a cloud account, so the
account that syncs becomes part of your security. Device-bound keys (a security key, a TPM key) are not exportable, which NIST SP 800-63B-4 requires at AAL3: syncable authenticators SHALL
NOT be used there. Store BE/BS and use them in policy (for example, step-up for a risky action when BE=1).

### Attestation and the AAGUID

Attestation lets the authenticator prove what it is. `attestation` in the options is a preference: `none`, `indirect`, `direct` or `enterprise`. Formats: `packed`, `tpm`, `android-key`,
`android-safetynet`, `fido-u2f`, `apple`, `none`. Measured: `none` gave an empty `attStmt`; `packed` self attestation (no `x5c` chain, the credential key signs `authData || clientDataHash`)
gave `attStmt` keys `[alg,sig]` and verified. Certificate-chain validation for `tpm`, `android-key` and `apple` is docs only here. With `none` the client may replace the AAGUID with zeros
for privacy (the spec allows it).

Most RPs should ask for `none`. Direct attestation tells you the model (AAGUID, checked against the FIDO Metadata Service) but costs privacy and can exclude synced providers. Care about it
in regulated environments that must allow only certified keys (government, banking). It proves the model at registration, not the person.

### UV and UP: what the RP decides

UP is a touch; UV is a PIN or biometric checked by the authenticator. When the passkey is the only step of the login, UV is what makes it multi-factor (possession plus PIN or biometric), so
require it. My RP rejects an authenticator that did no UV:

```text
register, no UV done (RP requires it)  REJECTED  flags: user verification (UV) required but not set
```

Asking for `userVerification: "required"` is not enough: check the flag, because only the signed `authData` is evidence. If a password still comes first, `preferred` or `discouraged` is
faster and acceptable.

### Account recovery: the weak link

A passkey you can lose needs a way back. Recovery by email link or SMS turns the strongest factor into the weakest: the attacker takes the recovery path. Prefer several passkeys per account
(a second device or a security key), the sync provider's recovery, and a recovery as strong as the login (verified identity, a delay, a notification). This is the lifecycle problem of the
track: recovery, reset and the leaver switch are where phishing resistance usually ends.

### Parameters the RP decides

| Parameter | Values | When to use |
|---|---|---|
| `rp.id` | a registrable domain | the parent domain to share passkeys across subdomains; changing it orphans credentials |
| `challenge` | 16+ random bytes | always, single use, bound to the session |
| `residentKey` | `discouraged`, `preferred`, `required` | `required` for passkeys and usernameless login |
| `userVerification` | `required`, `preferred`, `discouraged` | `required` when the passkey is the sole factor |
| `authenticatorAttachment` | `platform`, `cross-platform` | `cross-platform` to force security keys |
| `attestation` | `none`, `indirect`, `direct`, `enterprise` | `none` unless you must restrict models |
| `pubKeyCredParams` | `-7` ES256, `-257` RS256, `-8` EdDSA | ES256 first, RS256 for compatibility |
| `allowCredentials` | list or empty | empty for discoverable login |

### Market and bridges

Passkeys are the phishing-resistant MFA path the market is adopting: browsers, operating systems and large providers support them. Shared-secret factors (TOTP, SMS, push) remain the majority
in older products, so plan for both. Book versus today: older material (WebAuthn Level 1, U2F) is about security keys; the default story today is the synced passkey, and Level 3 is still a
Candidate Recommendation snapshot.

Bridges: the previous concept in this factor group is the MFA factors lesson (HOTP, TOTP, SMS, push and recovery codes), the shared-secret side of this one. For a full ASP.NET Core
implementation of passkeys, see the .NET concept linked below. Recovery continues in the lifecycle concepts of this track.

## Trade-offs

- **Synced against device-bound.** Synced passkeys fix lost devices and are what users adopt, but the sync account becomes a target. Device-bound keys are stronger and required at AAL3, at
  the cost of a recovery plan per user.
- **Attestation against privacy.** `direct` lets you accept only certified models, but narrows who can sign up and exposes the model. `none` accepts everyone, including a software key like
  the one in this lesson.
- **`required` UV against friction.** Requiring UV makes the passkey a real multi-factor step. It blocks authenticators without UV and adds a prompt to low-risk logins.
- **Rolling your own verifier.** This server skips x5c chains, RS256, metadata, extensions and `topOrigin`. Use a maintained library in production and read this code as a map of what it
  does.
- **Recovery path.** Any weaker fallback (SMS, email) caps the account's security at that fallback.

## Documentation Links

- [Web Authentication: An API for accessing Public Key Credentials, Level 3, W3C](https://www.w3.org/TR/webauthn-3/) (doc)
- [Web Authentication: Level 2, W3C Recommendation](https://www.w3.org/TR/webauthn-2/) (doc)
- [Web Authentication API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) (doc)
- [passkeys.dev, community guide to passkeys](https://passkeys.dev) (doc)
- [FIDO Alliance specifications](https://fidoalliance.org/specs/) (doc)
- [RFC 9052, CBOR Object Signing and Encryption (COSE): Structures, IETF](https://www.rfc-editor.org/rfc/rfc9052) (doc)
- [RFC 8949, Concise Binary Object Representation (CBOR), IETF](https://www.rfc-editor.org/rfc/rfc8949) (doc)
- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Enable Web Authentication API (WebAuthn) passkeys, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/) (doc)
