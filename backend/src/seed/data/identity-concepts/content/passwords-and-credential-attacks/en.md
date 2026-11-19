---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Passwords are still the first factor almost everywhere, and the way a server stores and checks them decides whether one leaked table or one botnet turns into mass account takeover. This lesson is the server side of password security, measured on this machine: the cost per hash of SHA-256, PBKDF2, bcrypt, scrypt and Argon2id at the current OWASP parameters, and what each costs an attacker who holds the leaked table (an estimate, labeled as such); why a unique salt kills precomputed tables and is not a secret, and what a pepper adds; the PHC string format and a rehash-on-login migration; the attack classes (online and offline guessing, dictionary, credential stuffing, password spraying) explained against a toy login endpoint of my own on 127.0.0.1, with the defenses that actually move the numbers (rate limits, progressive delay against hard lockout, equal answers and equal time for unknown users, detection); the NIST SP 800-63B-4 policy; breached-password screening with the k-anonymity range protocol; and the reset flow. No real service was attacked or queried: the "population", the "other site" dump and the breach corpus are synthetic files I generated. Code is Node 22 plus the `argon2` and `bcryptjs` packages in a scratch folder (Node has PBKDF2 and scrypt built in, not Argon2id or bcrypt).
Versions: Node 22.23.4, `argon2` 0.45.2, `bcryptjs` 3.0.3, OpenSSL 4.0.3, Apple M4 Max (14 cores), NIST SP 800-63B-4 and the OWASP cheat sheets (read 2026-11-19).

## Use Cases

- Choosing the password hash and its parameters for a new system, or defending the choice in a review or audit.
- Migrating an old table (MD5, SHA-1, unsalted or low-cost) without forcing every user to reset.
- Triaging "we are seeing a flood of failed logins": telling brute force, stuffing and spraying apart and choosing the control that works against each.
- Writing a password policy that matches NIST SP 800-63B-4 instead of 2005-era rules.

## Deep Dive

### Why passwords survive, and where they fail

A password is free to issue, needs no hardware and works on every client, so it is the base layer of every login. It fails in four known ways: people reuse it across sites (so one breach opens others), choose guessable ones (a few thousand strings cover a large share of accounts), type it into look-alike pages (phishing), and servers store it badly (a leaked table is cracked offline at full speed). NIST states it plainly: "Passwords are not phishing-resistant." Everything below reduces the first, second and fourth failure on the server. The third needs a factor that is bound to the origin (the MFA lesson and the passkeys lesson of this track). The market answer today is the same everywhere: the password stays as the base, MFA and passkeys sit on top, and the server hardens the password path anyway because it is also the fallback.

### Storage: a fast hash is the wrong tool (measured)

SHA-256 is built to be fast, and fast is what an attacker with the table wants. KDFs (key derivation functions) are slow on purpose, and the memory-hard ones (scrypt, Argon2id) also need RAM per guess, which limits GPUs and ASICs. One Node thread, 20 to 500k runs each, parameters from the OWASP Password Storage Cheat Sheet (read 2026-11-19). The attacker columns are an estimate: I assume a rig that does 10^10 SHA-256/s, scale every algorithm by the same measured cost ratio, and then compute the time to try a 10^9-entry list and the whole space of 8 characters in `a-z0-9` (2.8 x 10^12).

```text
algorithm                  login ms  est guesses/s   memory   1e9 list   8 chars a-z0-9
SHA-256, 1 round           0.43 us       1.0e+10        0       100 ms        5 min
PBKDF2-SHA256 600k           44.5        9.6e+4        0       2.9 h       339 days
PBKDF2-SHA512 220k           38.2        1.1e+5        0       2.5 h       291 days
bcrypt cost 10 (bcryptjs)    52.2        8.2e+4     4 KiB      3.4 h       397 days
bcrypt cost 12 (bcryptjs)   194.3        2.2e+4     4 KiB     12.6 h         4 years
scrypt N=2^17 r=8 p=1       150.5        2.8e+4   128 MiB      9.7 h         3 years
scrypt N=2^15 r=8 p=3       104.5        4.1e+4    32 MiB      6.8 h         2 years
Argon2id m=19 MiB t=2 p=1    10.4        4.1e+5    19 MiB       40 min        79 days
Argon2id m=46 MiB t=1 p=1    12.9        3.3e+5    46 MiB       50 min        98 days
Argon2id m=64 MiB t=3 p=1    59.9        7.2e+4    64 MiB       3.9 h       456 days
```

Measured: SHA-256 runs about 2.3 million hashes per second on one thread (2,298,565 and 2,331,118 in two runs, including the Node call overhead). The rest is arithmetic, so read it as orders of magnitude. Three caveats. The ratio model favors the attacker on memory-hard functions: GPUs have little fast memory per core, so the real gap is larger for scrypt and Argon2id than the table says. `bcryptjs` is pure JavaScript. And a weak password changes everything: a common password falls in the first guesses of any list, whatever the KDF. The KDF buys time for strong passwords and makes mass cracking expensive. The same cost is paid by you on every login (10 to 150 ms of CPU here), so it is also a capacity number and a denial-of-service surface: OWASP says hashing should usually take under a second and warns that a high factor lets an attacker exhaust CPU with many logins.

OWASP's current minimums (read 2026-11-19): Argon2id with 19 MiB, 2 iterations, parallelism 1 (equivalent options: 46 MiB/1, 12 MiB/3, 9 MiB/4, 7 MiB/5); if Argon2id is not available, scrypt with N=2^17, r=8, p=1 (equivalents down to N=2^13, p=10); bcrypt (legacy only) cost 10 or more with a 72-byte password limit; PBKDF2 (when FIPS-140 is required) 600,000 iterations with HMAC-SHA-256, 220,000 with HMAC-SHA-512, 1,400,000 for SHA-1 (legacy only). The Argon2 spec is RFC 9106, PBKDF2 is RFC 8018 and scrypt is RFC 7914. The Cryptography concept linked below measures PBKDF2 in .NET and decodes the Identity hasher: link to it instead of repeating it.

The bcrypt 72-byte limit is real, measured with a 75-byte password that differs from another only after byte 72:

```text
bcrypt 72-byte: hash(a) verifies b? true | length a 75
argon2 same pair: false
```

Enforce the limit (or pre-hash the way OWASP describes, with an HMAC and a pepper, not bare SHA), because silently truncating means two different passwords are the same password.

### Salt, rainbow tables and pepper (measured)

A rainbow table is a precomputed `hash -> password` index (real rainbow tables compress chains of hashes to save space; my demo is a plain lookup table, the idea is the same). Against unsalted SHA-256, one table built once breaks every account whose password is in it. Synthetic population of 4 users, a table of 1,000,000 candidates built in 0.69 s:

```text
--- unsalted SHA-256 dump ---
alice  968ebd645ad900b8... summer2026!
bob    f00a8b634f1ec597... dragon77!
carol  968ebd645ad900b8... summer2026!        <- same password, same hash: visible to anyone
dave   c914a382df9b3d84... (not in table)
lookups: 264 us, cracked 3/4
--- per-user random salt + scrypt (N=2^15) ---
alice  2d64bea87647cc62... salt 3dcd2d95
carol  0cd46755c63776aa... salt f2662566       <- same password, different hashes
table hits against salted hashes: 0
```

A unique random salt per password (NIST: at least 32 bits, 16 bytes is the common choice) means a table would have to be rebuilt per user, and equal passwords stop being visible. The salt is not a secret: it is stored beside the hash (see the format below), the attacker has it, and its only job is to make each guess unique to one account. Salting does not slow one targeted guess at one account: that is the work factor's job.

A pepper is a secret shared by all passwords and kept outside the database (a KMS, HSM or secrets vault), so a stolen table alone cannot be cracked. OWASP describes pre-hash and post-hash variants; NIST says verifiers SHOULD apply one more keyed hash or encryption with a key stored apart, ideally in a hardware-protected area. The post-hash variant, measured:

```text
verify with the pepper: true | with only the DB (wrong key): false
```

Costs: the pepper cannot be rotated without the passwords (rotation means forcing resets, or keeping a pepper version per row), and if the pepper sits on the same host with the same permissions as the database, it adds almost nothing. Use it when you have a real place to keep it.

### Formats and migrating a legacy hash

Store the algorithm, its parameters, the salt and the hash in one string so you can change parameters later. The PHC string format does this (`$id$params$salt$hash`, salt and hash in unpadded Base64). Real output of my run:

```text
$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$69I7qCjDTsQwhQqFvpQJiqEI0lGQvxC84fXE0Ktxca4
$2b$10$ydE1v8YnTHfq1EfJyB64m.qpgt1gwEqc9A98Wudh8T6X7zrPuvU7G     (bcrypt: version, cost, 22-char salt + 31-char hash)
```

`argon2id` is the variant, `v=19` the Argon2 version 0x13, `m` memory in KiB, `t` passes, `p` lanes. The salt decodes to the 16 bytes `0123456789abcdef` (I fixed it for the check) and the hash to 32 bytes. To check that the package computes real Argon2id and not something that only verifies itself, I derived the same output with OpenSSL 4.0.3 (`openssl kdf -keylen 32 ... ARGON2ID` with the same salt, `iter:2`, `memcost:19456`, `lanes:1`): the 32 raw bytes are identical (`ebd23ba8...71ae`). Spring prefixes the algorithm (`{bcrypt}...`) and ASP.NET Core Identity encodes a version byte; both are the same idea, see the linked concepts.

Migration on login is the standard path, because only then do you hold the plaintext. The server's `verify` returns "ok" and "needs rehash", and the login upgrades the row. Core of the toy (MD5 hex, bcrypt and Argon2id rows coexist):

```js
async function verify(stored, pw) {                       // returns [ok, needsRehash]
  if (stored.startsWith('$argon2id$')) return [await argon2.verify(stored, pw), argon2.needsRehash(stored, P)];
  if (stored.startsWith('$2'))         return [await bcrypt.compare(pw, stored), true];
  const a = Buffer.from(md5(pw)), b = Buffer.from(stored);   // legacy: unsalted md5 hex
  return [a.length === b.length && timingSafeEqual(a, b), true];
}
// in login(): if (ok && rehash) user.hash = await argon2.hash(pw, P);
```

Run with one MD5 user and one bcrypt user, wrong password then right password:

```text
old-md5    wrong -> 401 | right -> 200     server log: rehash old-md5: $argon2id$v=19$m=1...
old-bcrypt wrong -> 401 | right -> 200     server log: rehash old-bcrypt: $argon2id$v=19$m=1...
(second login of each: no rehash line, already Argon2id)
```

Users who never log in keep the old hash. OWASP offers two options: expire and delete hashes of long-inactive users (they must reset next time), or wrap the old hash in the new one (`argon2id(md5(pw))`) right now, and replace it by a direct hash at the next login. The wrapping option protects the table at once without knowing any password. Never rehash on a failed login, and raise the cost the same way as years go by.

### Attack classes, measured against a toy endpoint

The toy is `server.mjs`, bound to 127.0.0.1 port 6440: `/login`, `/register`, `/reset/*`, Argon2id at the OWASP minimum (about 11 ms per check). A script generated 1,000 accounts: 8% with `Summer2026!`, 5% with `Password123!`, 3% with `Welcome1!`, and the rest random (185 common-password accounts), plus a made-up "other site" dump in which 149 accounts reuse their password. Nothing here touches a real service; the shares are my choice, not a real-world rate.

- **Online guessing** goes through your login endpoint, so you can throttle, log and lock it. It is limited by rate.
- **Offline cracking** happens after the table leaks, at the attacker's speed, with no limit you control. Only the storage choices above defend it. This is why the storage and the online controls are separate jobs.
- **Dictionary and brute force** try many passwords against one account (online) or one hash (offline). Defenses: a blocklist at registration, throttling, a slow hash.
- **Credential stuffing** replays `user:password` pairs leaked from another site. One attempt per account, from a list where the pair is probably right. Measured: 1,000 pairs, **149 logins succeeded** (14.9%, by construction of my dump). Nothing was wrong with the target: the secret was already public. Defenses: MFA (OWASP quotes Microsoft's analysis that it would have stopped 99.9% of compromises), breached-password screening, anomaly detection, bot controls.
- **Password spraying** tries a few very common passwords across many accounts, one or two attempts per account, so a per-account counter never trips. Measured with a 5-failure hard lock: 3 passwords x 1,000 accounts = 3,000 requests, **185 accounts cracked, zero locked** (each account saw at most 3 failures). Defenses: a blocklist so the common passwords cannot be chosen, detection across accounts, per-IP and global limits, MFA.
- **Rainbow tables** are an offline class, killed by the salt (above).

### Online defenses and what they cost (measured)

**Rate limit per account, with progressive delay.** After 3 free failures the toy refuses further attempts for 1, 2, 4, 8 s and so on, capped at 900 s, and it refuses before hashing, so rejected attempts are almost free. A client hammering one account for 20 s:

```text
20 s of guessing: 231195 requests sent, outcomes {"401":7,"429":231188}
owner during the delay -> 429 | retry in 12s
```

Only 7 guesses reached the hash in 20 s. By arithmetic (not run for a day): with the 900 s cap, about 110 guesses per account per day, so a random 12-character password is out of reach online, and a top-100 common password is not: this is why the blocklist matters. NIST's wording is an upper bound of 100 consecutive failures on an authenticator, lower allowed, and it lists increasing waits (for example 30 seconds up to an hour) and risk-based checks as ways to keep the real user from being locked out.

**Hard lockout is a denial-of-service tool.** With "lock after 5 failures":

```text
attacker, 6 wrong guesses -> 401 401 401 401 401 423
owner, CORRECT password    -> 423 | account locked
```

Anyone who knows a username can lock that user out. Delays also lock the owner out for a while (the 12 s above), but recover on their own. OWASP also says to key the counter to the account and not the IP, and to allow the reset flow even when locked. Pair any counter with a reset path that does not depend on the locked password.

**Per-IP limits** stop one noisy address and fail against a botnet that spreads the load, so they complement the account counter and do not replace it. Measured with 20 failures per minute per address: one address spraying `Summer2026!` got 20 `401` then `429` from request 21. A distributed spray from many addresses was not simulated here (docs only): that case is why detection must look at the whole system, not only at one IP.

**Detection across accounts.** The toy keeps a keyed hash of each failed password and counts distinct accounts that received it, and counts distinct accounts failing per address. Server log of the spray above:

```text
ALERT spray at request #10: one password tried on 10 distinct accounts
ALERT at request #20: 127.0.0.1 failed on 20 distinct accounts in 60 s
```

The signals worth a dashboard: failures per minute overall, distinct accounts with failures per source, one password across accounts, success rate of logins from new devices, a burst of successful logins from one ASN. CAPTCHA and device fingerprinting only get a mention here: OWASP lists them as extra layers that attackers can outsource or evade, to use after a few failures and never as the only control.

### Same answer, same time for unknown users (measured)

If `/login` says "no such user" for an unknown name, it is a free username oracle. The generic message is the first step, and the second is time: if a known user costs one Argon2id check and an unknown user returns at once, the clock gives it away. 300 known and 300 unknown logins per variant:

```text
variant        known median   unknown median   guess "exists?" from time alone
leaky (404)       10.89 ms        0.30 ms       100.0% of 600 requests (and the body says it)
fast  (401 both)  10.94 ms        0.29 ms       100.0% of 600 requests (same text, still leaks)
constant          11.02 ms       11.02 ms        50.2% of 600 requests (a coin flip)
```

The fix is a dummy hash: for an unknown name, verify the submitted password against a precomputed Argon2id hash of random data (`const DUMMY = await argon2.hash(random, P)`), so the same work happens, then answer the same text. Registration and reset must also answer the same way (below). Real systems add noise, queues and network jitter, so a remote attacker needs more samples, not magic: do not rely on the noise.

### Policy: NIST SP 800-63B-4

NIST SP 800-63B-4 (text at pages.nist.gov, stamped 26 Aug 2025, which states that it supersedes the previous 800-63B; read 2026-11-19) turns decades of folklore around. The password rules:

- Length over composition: a password used as the only factor needs at least 15 characters; one used only inside MFA at least 8. Verifiers SHOULD permit at least 64 characters, and accept all printable ASCII, space and Unicode (each code point counts as one character; apply NFC normalization before hashing).
- SHALL NOT impose composition rules (mixed character types) and SHALL NOT force periodic changes; SHALL force a change when there is evidence of compromise.
- SHALL compare a new password against a blocklist of common, expected or compromised values (breach corpora, dictionary words, the service name and the username), reject on a match with the reason given, and guide the user. NIST adds that very large blocklists give little extra, because online guessing is already throttled.
- SHALL NOT allow hints visible to unauthenticated users, and SHALL NOT use knowledge-based authentication or security questions.
- SHALL allow password managers and autofill; SHOULD allow paste; SHOULD offer a "show password" option.
- Store salted and hashed with an approved scheme and a cost as high as practical; throttle failed attempts (at most 100 consecutive, see above).

Book versus today: rules like "one uppercase, one digit, one symbol, change every 90 days" are still in many internal policies and audits, but they are exactly what NIST now forbids, because they produce `Summer2026!` and `Summer2027!`. Check the version your auditor cites: some regulations still quote the older text.

### Breached passwords with k-anonymity (measured locally, API docs only)

Checking a candidate against a corpus without handing the corpus the password is the job of the Pwned Passwords range protocol. The client computes SHA-1 of the password, sends only the first 5 hex characters, receives every suffix in that bucket with a count, and looks for its own suffix locally. The service never sees the password or the full hash. Per the HIBP API documentation (docs only, I did not call it): `GET https://api.pwnedpasswords.com/range/{first 5 SHA-1 chars}`, answer `SUFFIX:COUNT` lines, around 800 per bucket, always HTTP 200 over 1,048,576 possible prefixes; the `Add-Padding: true` header pads responses to 800 to 1,000 rows (padded rows have count 0) so size does not reveal the bucket; `?mode=ntlm` exists; and checking on every keystroke is discouraged because the stream of prefixes can leak the password, so check once on submit.

My local version: a 1,001,004-line synthetic file (1,000,000 random SHA-1 values with counts, 4 invented passwords, and the passwords of my invented dump), the same line format, served by the toy as the range endpoint. Because the corpus is 1M and not hundreds of millions, a bucket holds about 1 suffix, not 800. Registration uses it:

```text
sha1("Summer2026!") = F1DF7 1A9D60CD46A2E09691E504C4E09A4DA9A7A     only "F1DF7" leaves the function
Summer2026!                422 | this password appears in a breach corpus, choose another
letmein-test-pw            422 | this password appears in a breach corpus, choose another
zebra-lantern-quietly-42   201 | created
server log: range query: F1DF7 (1 suffixes back) / 310D2 (2 back) / B095D (0 back)
```

Rule for any experiment with the real API: use an invented test password only, never a real user's password or hash. For stricter privacy, keep a downloaded copy of the corpus (HIBP offers a downloader) and query it offline: a breach list is a registration-time and password-change-time check, and NIST also wants a check at those events, not a nightly scan of stored hashes you cannot reverse anyway.

### Managers, passkeys and the reset flow

Password managers fix reuse and weak choice at the root, so allow paste and autofill (NIST makes that a SHALL for managers) and do not block them with scripts. Passkeys remove the shared secret: the server stores a public key and nothing is phishable or stuffable (next lessons of this track). While passwords exist, the reset path is the weakest link: it is a second way in, as strong as its channel. The toy's flow, measured:

```text
existing    -> 202 if the account exists, an e-mail was sent
nonexistent -> 202 if the account exists, an e-mail was sent      (same status, same text)
token length 43 chars (32 random bytes, base64url); server stores only sha256(token)
use 1       -> 200 password changed
use 2       -> 400 invalid or expired token                         (single use)
after TTL   -> 400 invalid or expired token                         (TTL was 1 s in this run; 15 min default)
```

Per the OWASP Forgot Password Cheat Sheet: token from a CSPRNG, long enough, tied to one user, invalidated after use and stored hashed, with a short lifetime; do not change the account until a valid token arrives (so a stranger cannot lock you out by requesting resets); respond identically for existing and missing accounts. After a reset, end other sessions and tell the owner. A reset by e-mail makes the mailbox a credential, and a help-desk reset makes a person a credential: account recovery as the attack path (and its MFA downgrade) is the subject of the identity-threats lesson planned later in this track.

### Attack, defense, metric

| Attack class | What it exploits | Server defense | What to measure or monitor |
|---|---|---|---|
| Online brute force | one account, many guesses | per-account delay or cap, blocklist, MFA | failures per account, requests refused before hashing |
| Offline cracking | leaked table, no limit on the attacker | Argon2id (or scrypt, bcrypt, PBKDF2), unique salt, pepper in a KMS | ms per hash, hash parameters per row, share of legacy rows |
| Dictionary | common passwords | blocklist at registration, length over rules | share of accounts rejected, top passwords seen in failures |
| Credential stuffing | reuse across sites | MFA, breached-password check, bot and device signals | success rate of logins from new devices, ASN bursts |
| Password spraying | few passwords x many accounts, below per-account limits | blocklist, cross-account detection, per-IP and global limits, MFA | one password across many accounts, distinct accounts per source |
| Rainbow tables | precomputed hashes | unique salt, slow KDF | rows without a salt (must be zero) |
| User enumeration | different text or time per case | one message, dummy hash, same reset answer | status and latency by user-exists in tests |
| Hard-lockout DoS | counter that locks the owner | progressive delay, reset path that still works | owners locked per day, support tickets |

### Where to go next

The next lesson in this track adds the second factor that makes stuffing and spraying nearly moot, and the passkeys lesson removes the shared secret. How the reset path becomes the real target is covered by the identity-threats lesson planned for this track. For the .NET and Spring implementations of the hashing in this lesson, use the linked concepts.

## Trade-offs

- **Argon2id versus PBKDF2.** Argon2id is memory-hard and OWASP's first choice, but needs a package in .NET and Node, and OWASP points to PBKDF2 when FIPS-140 compliance is required. PBKDF2 is built in and FIPS-friendly, and needs 600,000 iterations because it is easy to parallelize on a GPU. Example: 44.5 ms of CPU for PBKDF2 and 10.4 ms for Argon2id on this machine, at "equivalent" settings.
- **Cost factor versus login capacity.** Doubling the cost doubles your CPU per login and the attacker's cost per guess. Measure on production-like hardware, keep under about a second, and put hash work behind the cheap refusals (rate limit first), or the hash becomes the DoS.
- **Pepper.** It protects a table stolen alone (SQL injection, a backup) and costs a secret to store, version and rotate. Without a KMS or HSM it is theater.
- **Hard lockout versus delay.** A hard lock stops guessing and lets anyone lock any victim (the 423 above). Delays and risk checks cost the owner a few seconds. Choose delays, and keep a recovery path.
- **Blocklist size.** A huge list annoys users and adds little, since online guessing is throttled; a short list of common and breached values catches the spray. NIST agrees.
- **No forced rotation.** Fewer predictable `Summer2027!` changes, and you must be able to detect compromise and force a change when evidence appears.
- **Rehash on login.** No forced resets, and rows of users who never come back stay weak. Expire the inactive ones or wrap their old hash.
- **Breach-check API versus a local copy.** The API is free, current and k-anonymous (5 characters leave), and adds a network dependency and trust in a third party. A local copy is private and needs storage and refresh.

## Documentation Links

- [SP 800-63B-4, Authentication and Authenticator Management, NIST](https://pages.nist.gov/800-63-4/sp800-63b.html) (doc)
- [Password Storage Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (doc)
- [Authentication Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) (doc)
- [Credential Stuffing Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html) (doc)
- [Forgot Password Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) (doc)
- [RFC 9106, Argon2 Memory-Hard Function for Password Hashing, IETF](https://www.rfc-editor.org/rfc/rfc9106) (doc)
- [RFC 8018, PKCS #5: Password-Based Cryptography Specification v2.1, IETF](https://www.rfc-editor.org/rfc/rfc8018) (doc)
- [RFC 7914, The scrypt Password-Based Key Derivation Function, IETF](https://www.rfc-editor.org/rfc/rfc7914) (doc)
- [PHC String Format, Password Hashing Competition](https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md) (doc)
- [Have I Been Pwned API v3, Pwned Passwords, Troy Hunt](https://haveibeenpwned.com/API/v3#PwnedPasswords) (doc)
