---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A password proves one thing: you know a secret that can be phished, guessed, reused or leaked. Multi-factor authentication (MFA) asks for a second
proof of a different kind, so one stolen secret is no longer enough. This lesson covers the factors and what each is really worth, builds HOTP (RFC
4226) and TOTP (RFC 6238) from scratch in 10 lines and checks them against the official test vectors, generates the `otpauth://` URI behind the QR
code, then measures what a verifier must get right: the clock window, replay, brute force, the secret at rest and single-use recovery codes. It ends
with SMS, push fatigue, real-time phishing (why TOTP does not resist it and a passkey does) and a comparison table. Code is Node 22 with no packages,
because the point is the algorithm, not a library.
Versions: Node 22.23.4, OpenSSL 4.0.3, curl 8.7.1, jq 1.7.1, RFC 4226, RFC 6238, NIST SP 800-63B-4 (read 2026-11-19).

## Use Cases

- Adding an authenticator-app second factor and knowing what the server stores and checks (secret, last step, failure count).
- Debugging "my code is always wrong": clock drift, wrong digits or algorithm in the URI, base32 versus raw bytes, reuse.
- Choosing which factors to offer or retire after a phishing or SIM swap incident, or for an audit that asks for phishing-resistant MFA.

## Deep Dive

### Three factors, and why a second one helps

Three categories: knowledge (password, PIN: phished, guessed, reused, leaked), possession (phone app, hardware key, recovery-code sheet: stolen, cloned, relayed) and inherence (fingerprint, face: cannot be rotated, and usually unlocks a local key instead of being sent). MFA needs two different categories: a password plus a security question is one factor twice. The gain is statistical: an attacker with a leaked password still has to defeat a second channel that is not in the same database or on the same page. It is not magic: the rest of this lesson is about which second factors can themselves be phished, relayed or reset.

### HOTP and TOTP in 10 lines (measured)

HOTP: HMAC the 8-byte big-endian counter with the shared secret, pick 4 bytes at the offset given by the low nibble of the last byte (dynamic
truncation), drop the sign bit, keep the last N decimal digits. TOTP is HOTP with counter `floor(unix_time / 30)`.

```js
import { createHmac } from 'node:crypto';
export function hotp(key, counter, digits = 6, alg = 'sha1') {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(alg, key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;                  // dynamic truncation offset
  const bin = h.readUInt32BE(o) & 0x7fffffff;        // 31 bits
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const step = (t, period = 30) => Math.floor(t / period);
export const totp = (key, t, digits = 6, alg = 'sha1', period = 30) => hotp(key, step(t, period), digits, alg);
```

First RFC 4226 vector by hand with `openssl` (secret: the ASCII string `12345678901234567890`, counter 0):

```text
$ printf '\0\0\0\0\0\0\0\0' | openssl mac -macopt hexkey:$KEY -macopt digest:SHA1 -binary HMAC | xxd -p
cc93cf18508d94934c64b65d8ba7667fb7cde4b0
offset = last nibble = 0, bytes 0..3 = cc93cf18; & 0x7fffffff = 1284755224; mod 10^6 = 755224
```

That is row 0 of the RFC 4226 Appendix D table. The whole run: Appendix D (10 HOTP values) and Appendix B of RFC 6238 (18 TOTP values), the latter
parsed out of the RFC text instead of retyped. The seeds are the RFC's: 20 bytes `12345678901234567890` for SHA1, 32 bytes for SHA256, 64 bytes for
SHA512; 8 digits.

```text
HOTP 0..9 : 755224 287082 359152 969429 338314 254676 287922 162583 399871 520489  -> all 10 match
RFC 6238 TOTP, 8 digits (RFC value = my value in all 18 rows):
 Time (s)     SHA1      SHA256    SHA512
 59           94287082  46119246  90693936
 1111111109   07081804  68084774  25091201
 1111111111   14050471  67062674  99943326
 1234567890   89005924  91819424  93441116
 2000000000   69279037  90698825  38618901
 20000000000  65353130  77737706  47863826      -> 18/18 match
```

With 6 digits the same 31-bit number is taken modulo 10^6 instead of 10^8 (T=59, SHA1: `94287082` becomes `287082`). The counter is a `BigInt`, so the last row (year 2603) works; a
32-bit time field fails it. Everything an authenticator app does is in this function: the app only keeps the secret and a clock. What is not in the
RFC math, and matters in production: the window, replay protection and attempt limits.

### The `otpauth://` URI and the QR code

The QR code on the enrollment page is only this URI (the Google Authenticator "Key URI Format", a de facto standard):

```text
otpauth://totp/Example%20Corp:alice@example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example%20Corp&algorithm=SHA1&digits=6&period=30
```

- `totp` or `hotp` (HOTP also needs `counter=`), then the label `issuer:account`.
- `secret`: the key in base32 (RFC 4648) without padding. Not hex, not base64: wrong encoding is the most common cause of "all codes wrong". The
  20-byte test secret above encodes to those 32 characters and round-trips back.
- `issuer`: strongly recommended as parameter and label prefix; older Google Authenticator versions use only the prefix.
- `algorithm`, `digits`, `period`: defaults SHA1, 6, 30. The Key URI wiki says Google Authenticator ignores `algorithm` and `period` (and `digits` on
  some platforms), so a server using SHA256 or `period=60` gets codes that never match for those users (docs only, not tested here). Keep the
  defaults.

Generate the secret with `crypto.randomBytes(20)`: 160 bits, the length RFC 4226 recommends. The URI contains the secret: show it once over TLS and
never log it.

### Clock drift and the window (measured)

Phone and server clocks disagree, so verifiers also accept the steps around the current one. Simulated phone offsets against a server 15 s into a step, accepted with window 0, ±1, ±2 steps:

```text
phone offset -> window 0 / +-1 / +-2
  0 s yes/yes/yes | 10 s yes/yes/yes | 20 s no/yes/yes | 40 s no/yes/yes | -20 s no/yes/yes | -50 s no/no/yes | 80 s no/no/no
```

With window 0 a phone 20 s ahead already fails; ±1 tolerates -45 s to +44 s at this moment, enough for real drift and a slow typist. The price: a random 6-digit guess is accepted with probability `(2w+1) / 10^6`. Monte Carlo, 20M random guesses per window (Poisson noise around the exact value):

```text
window +-0: 20 hits = 1.00 per million (exact 1) | +-1: 53 = 2.65 (exact 3) | +-2: 105 = 5.25 (exact 5)
```

So ±1 triples the odds and ±2 quintuples them. Fix the clock (NTP) instead of widening. HOTP has the mirror problem: the token counter advances on every button press, so the server accepts a look-ahead window and resynchronizes (RFC 4226, section 7.4).

### Brute force: the arithmetic and the lockout (measured)

Exact odds of at least one hit in `n` attempts against one valid window, and tries for a 50% chance:

```text
n=10: 0.0010% (window 0) 0.0030% (+-1) | n=100: 0.0100% 0.0300% | n=1000: 0.1000% 0.2996% | n=10000: 0.9950% 2.9555%
tries for 50%: window 0 693147, +-1 231049; at 10 guesses/s with no limit, +-1 reaches 50% in 6.4 hours
```

Without a limit, an attacker who has the password wins in hours. NIST SP 800-63B-4 requires limiting consecutive failures on an authenticator to no more than 100 (an upper bound the text ties to "100 attempts against a six-digit decimal OTP"; lower limits are allowed): at 100 tries the ±1 chance is 0.03%. Count per account, not only per IP (botnets rotate IPs). Lockout turns brute force into denial of service, so prefer increasing delays to a permanent lock.

### A verifier that gets these right (measured)

About 45 lines of `node:http` and `node:crypto` (`server.mjs`, port 6300): enroll creates the secret, verify applies the window, the replay rule and
the lockout. The core:

```js
for (let s = cur - WINDOW; s <= cur + WINDOW; s++) {
  if (!eq(hotp(key, s), code)) continue;               // eq = timingSafeEqual
  if (s <= u.lastStep) return [401, 'replay'];         // that step, or an older one, was already used
  u.lastStep = s; u.fails = 0; return [200, `ok step ${s}`];
}
u.fails++; return [401, `invalid (${u.fails}/${MAX_FAILS})`];   // MAX_FAILS = 5 in the demo
```

Driven with curl (a client script computes the code; status of each call):

```text
first use -> 200 | same code again -> 401 (log: replay) | previous-step code -> 401 (replay)
wrong guesses 000000 .. 444444 -> 401 x5 (invalid 1/5 ... 5/5) | the RIGHT code now -> 429 (log: locked)
```

A code is valid for the whole window (up to 90 s with ±1), and anyone who sees it (shoulder surfing, a phishing page, a proxy log) can use it in that
time unless the server remembers the last accepted step. NIST says the same for out-of-band codes: a secret is accepted only once in its validity
period. Side effect, seen in an earlier run: accepting a code from step `n+1` (phone ahead) moves `lastStep` forward, so the code of the current step
`n` is then refused as a replay. Correct, and another reason to keep the window small.

### The secret at rest: encrypt, do not hash

A password verifier stores a slow hash because it only compares. A TOTP verifier needs the secret itself to compute the expected code, so hashing
cannot work. Options: encrypt at rest (AES-256-GCM, key in a KMS or HSM, not next to the data) or have an HSM compute the HMAC. The demo record after
enrollment:

```text
{"secret":{"iv":"a81af2bc0f1c183ce2fdb550","ct":"f8f3104483183bdd917b7abfc2b198400cdb7015","tag":"b7b2e0b3..."},
 "lastStep":-1,"fails":0,"recovery":[{"hash":"8a001d4a...0790","used":false}]}
```

`ct` is the 20 encrypted bytes; no plaintext secret in the record. A leak of the database plus the key lets an attacker generate every user's codes:
keep the key elsewhere. The Cryptography concept (linked below) covers AES-GCM and password hashing.

### Recovery codes: generate, hash, burn

Users lose phones. A recovery code is a look-up secret: random, single use, shown once. Generate with a CSPRNG, store only the hash, mark used on
success. The demo makes 10 codes of 80 bits (`XXXX-XXXX-XXXX-XXXX`):

```text
code CI4B-K77R-XZBX-7XI5 | use 1 -> 200 (server: ok recovery code burned) | use 2 -> 401
```

Why 80 bits with a plain SHA-256: speed does not matter at that size. Measured on one Node thread, 2.39 million SHA-256/s, so a 50-bit space takes
about 5,400 days there; a GPU is thousands of times faster (assuming 10^10 hashes/s, 50 bits falls in about 1.3 days). At 80 bits it is out of reach.
For short codes (8 to 10 characters) use scrypt or Argon2 and a lockout. NIST calls them look-up secrets: usable, not phishing-resistant, and
delivering or resetting them is itself an authentication event. Regenerate the set after suspicious use, and never let support reset a factor over
e-mail or chat alone.

### SMS and e-mail as a factor

SMS sends a code through the telephone network. Real attacks: SIM swap (the carrier is talked into moving the number), SS7 interception, malware
reading the message, and the user typing the code into a phishing page. What NIST SP 800-63B-4 says (read 2026-11-19): out-of-band delivery over the
PSTN (SMS or voice) is "restricted"; the verifier must offer every user an alternative type, should check risk indicators (SIM change, number porting)
before sending, and treats changing the registered number as binding a new authenticator. Codes expire within 10 minutes, have at least six digits,
work once. E-mail "SHALL NOT be used for out-of-band authentication" (interception, rerouting), though an e-mail link can still verify an address.
CISA's phishing-resistant MFA fact sheet ranks SMS and voice last, "a last resort".

Book versus today: SMS is still everywhere (banks, carriers, consumer apps) because every phone receives it and nothing needs installing. The market
is moving to authenticator apps, push with number matching and passkeys, keeping SMS as a fallback with risk checks. Do not build SMS as the only
option in a new system.

### Push approvals and MFA fatigue

Push asks "Is this you? Approve / Deny" in an app. It is convenient and shows context, but a blind Approve is the weakness: an attacker with the
password triggers prompts again and again until a tired user taps Approve (push bombing, MFA fatigue; NIST lists "Authentication Fatigue"). Defenses:
number matching (the login page shows a number the user must type into the app, so Approve cannot be blind), context in the prompt, a cap on prompts
(NIST: verifiers "SHOULD implement a reasonable limit on the rate or total number of push notifications"; OWASP agrees) and alerts on bursts. Number
matching is a CISA, OWASP and vendor recommendation, not a clause in NIST's text, and it does not stop a relay proxy (next section).

### Real-time phishing (AiTM) and origin binding

An adversary-in-the-middle phishing site is a reverse proxy: the victim opens a look-alike domain, the proxy forwards every request to the real site
and every answer back, so the page looks genuine. The victim types the password and then the TOTP code (or approves the push); the proxy replays both
in real time and keeps the session cookie the real site returns. Nothing is broken: the second factor was valid and used inside its window.

TOTP cannot resist this, and the verifier shows why: the code is a function of secret and time only, with no trace of the page where it was typed. In
the demo, a code sent with `Origin: https://login-examp1e.test` is accepted exactly like one from the real site (no proxy tool is built here; the
point is that the verifier has nothing to tell them apart):

```text
HTTP/1.1 200 OK
{"result":"ok step 59835553"}
```

NIST agrees: factors with "manual entry of an authenticator output (e.g., out-of-band and OTP authenticators)" are not phishing-resistant, because the output is not bound to the session.

WebAuthn (FIDO2, passkeys) is different by construction (docs only, W3C WebAuthn): the authenticator signs a challenge together with data that
includes the RP ID hash and, through the browser, the page's real origin, and only uses a key created for that RP ID. On a look-alike domain the
origin is wrong or no credential exists, so the signature a proxy relays does not verify. The user cannot be talked into anything because there is no
secret to type or approve. Origin binding turns phishing resistance from user vigilance into protocol.

### Strength scale and summary table

NIST ties assurance to this: AAL2 needs two factors and a phishing-resistant option on offer; AAL3 needs a phishing-resistant, non-exportable key;
federal agencies must require phishing-resistant authentication for staff. Roughly in order of strength:

| Factor | Resists phishing or relay | Typical attack | Where still used |
|---|---|---|---|
| Password only | no | phishing, stuffing, leak | first factor everywhere |
| SMS or voice code | no | SIM swap, SS7, phishing relay | banks, consumer apps, fallbacks |
| E-mail code or link | no | mailbox takeover, interception | sign-up, account recovery |
| Recovery codes | no | stolen sheet, support social engineering | last resort for every factor |
| TOTP app (RFC 6238) | no | AiTM relay, phishing, secret leak | default for SaaS and admin panels |
| Push, no number matching | no | push bombing | legacy MFA products |
| Push with number matching | no (still relayed) | AiTM relay, social pressure | corporate SSO |
| Security key or passkey (WebAuthn) | yes (origin bound) | device theft (PIN or biometric still needed), downgrade to a weak fallback | admins, FIDO2 programs, modern logins |

A weak fallback defeats a strong factor: if a passkey user can still reset by SMS or a help-desk call, the attacker takes that road (MFA downgrade).
Phishing resistance holds only when the recovery path is as strong.

### Where to go next

Passkeys and WebAuthn are measured in the next lesson of this track. To tell a relying party that MFA happened, OIDC carries `acr` (assurance reached) and `amr` (methods used, such as `pwd`, `otp`, `hwk`) in the ID token, which the OIDC lesson in this track shows how to request and verify.

## Trade-offs

- **TOTP versus passkey.** TOTP works on any phone, offline, with no browser support, but it does not resist phishing relays and the server keeps a recoverable secret. A passkey resists phishing and the server stores only a public key, but needs WebAuthn support and a recovery plan for lost devices.
- **Window width.** A wider window forgives clock skew and multiplies the odds of a lucky guess (3 per million at ±1, 5 at ±2). Fix time sync first, and always pair a window with a failure limit.
- **Lockout versus denial of service.** Locking after 5 failures stops brute force and lets anyone with the password lock the victim out. Increasing delays and per-account counters are kinder; NIST's cap is 100.
- **Recovery strength.** A strong factor with an easy reset is only as strong as the reset: a support agent who can disable MFA after a chat message is the real second factor. Example: 10 codes of 80 bits, single use, shown once.
- **Encrypting the TOTP secret.** A database dump alone becomes useless, at the cost of a key to operate and rotate. With the key on the same host the gain is small: use a KMS or HSM and log decrypt calls.
- **SMS as fallback.** It reaches almost everyone and inherits SIM swap and relay. If kept, make it the last choice, check recent SIM or number changes, and never let it reset a stronger factor.

## Documentation Links

- [RFC 4226, HOTP: An HMAC-Based One-Time Password Algorithm, IETF](https://datatracker.ietf.org/doc/html/rfc4226) (doc)
- [RFC 6238, TOTP: Time-Based One-Time Password Algorithm, IETF](https://datatracker.ietf.org/doc/html/rfc6238) (doc)
- [RFC 4648, The Base16, Base32, and Base64 Data Encodings, IETF](https://www.rfc-editor.org/rfc/rfc4648) (doc)
- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Key Uri Format, Google Authenticator wiki](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) (doc)
- [Multifactor Authentication Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) (doc)
- [Implementing Phishing-Resistant MFA, CISA](https://www.cisa.gov/sites/default/files/publications/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf) (doc)
- [Web Authentication Level 3, W3C](https://www.w3.org/TR/webauthn-3/) (doc)
