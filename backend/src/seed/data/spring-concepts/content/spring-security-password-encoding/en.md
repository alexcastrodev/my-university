---
version: 1.0
updatedAt: 2026-07-31
---
## Objective

A `UserDetailsManager` can find a user, but something still has to decide whether
the password they typed matches the one on file — without ever storing or
comparing raw passwords. `PasswordEncoder` is the contract Spring Security uses for
that decision, and `DelegatingPasswordEncoder` is what lets an application support
several encoding algorithms at once instead of being locked into one forever.

## Use Cases

- Storing passwords as a one-way hash instead of cleartext, so a database leak
  doesn't hand out usable credentials.
- Migrating an application from a weaker algorithm to a stronger one without a
  disruptive mass password reset — existing hashes keep validating under the old
  algorithm while new signups get the new one.
- Tuning the cost of a hashing algorithm (iterations, memory, parallelism) to
  balance brute-force resistance against acceptable login latency for your
  hardware.

## Deep Dive

### The `PasswordEncoder` contract

```java
public interface PasswordEncoder {
    String encode(CharSequence rawPassword);
    boolean matches(CharSequence rawPassword, String encodedPassword);
    default boolean upgradeEncoding(String encodedPassword) {
        return false;
    }
}
```

`encode()` produces the stored form of a password; `matches()` checks a submitted
raw password against that stored form — for a proper hash, `matches()` re-hashes
the input and compares hashes, it never reverses the encoding. `upgradeEncoding()`
defaults to `false`; overriding it to `true` re-encodes a password with the current
(presumably stronger) settings the next time it's successfully validated.

### Built-in implementations, from weakest to strongest

- `NoOpPasswordEncoder` — stores passwords in cleartext. Only ever appropriate for
  throwaway examples; never for anything real.
- `StandardPasswordEncoder` — SHA-256-based, **deprecated**; kept only so legacy
  applications using it still compile and validate existing hashes.
- `Pbkdf2PasswordEncoder` — PBKDF2, a slow key-derivation function; a solid choice
  when FIPS certification is a requirement.
- `BCryptPasswordEncoder` — bcrypt, tunable via a strength/log-rounds parameter
  (iteration count = 2^logRounds); the long-standing default.
- `SCryptPasswordEncoder` — scrypt, a memory-hard function (tunable CPU cost,
  memory cost, parallelization, key length, salt length) that resists
  custom-hardware (GPU/ASIC) cracking attempts better than bcrypt or PBKDF2.

```java
PasswordEncoder p1 = new BCryptPasswordEncoder();            // default strength
PasswordEncoder p2 = new BCryptPasswordEncoder(12);           // stronger, slower
PasswordEncoder p3 = new SCryptPasswordEncoder(16384, 8, 1, 32, 64);
// cpuCost, memoryCost, parallelization, keyLength, saltLength
```

### `DelegatingPasswordEncoder`: one encoder, many algorithms

Rather than committing every password in the system to a single algorithm forever,
`DelegatingPasswordEncoder` prefixes each stored hash with `{id}` and routes
`matches()` to whichever encoder that id maps to — so different rows in the same
table can be hashed with different algorithms:

```java
@Bean
public PasswordEncoder passwordEncoder() {
    Map<String, PasswordEncoder> encoders = new HashMap<>();
    encoders.put("noop", NoOpPasswordEncoder.getInstance());
    encoders.put("bcrypt", new BCryptPasswordEncoder());
    encoders.put("scrypt", new SCryptPasswordEncoder());
    return new DelegatingPasswordEncoder("bcrypt", encoders); // "bcrypt" = default for encode()
}
```

A hash like `{bcrypt}$2a$10$xn3LI/...` is validated by the `bcrypt`-registered
encoder; a hash with no recognized prefix falls back to the `DelegatingPasswordEncoder`'s
configured default. In practice, nobody hand-builds this map — Spring Security ships
a factory that pre-registers all standard implementations with bcrypt as the default:

```java
PasswordEncoder passwordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
```

This is the mechanism that makes an algorithm migration non-disruptive: point new
encodes at a new default id, and existing rows keep matching against whichever
encoder their own prefix names — no bulk rehash required at the moment of the
change (only as each user's password is next touched, if `upgradeEncoding` is wired
up).

## Trade-offs

- **`NoOpPasswordEncoder` and `StandardPasswordEncoder` exist purely for backward
  compatibility with old code/data** — Spring Security's own docs are explicit that
  neither should appear in a new implementation; `StandardPasswordEncoder`'s SHA-256
  is no longer considered strong enough on its own (it lacks the built-in salt and
  tunable cost of bcrypt/scrypt/PBKDF2).
- **bcrypt vs. scrypt vs. PBKDF2 is a hardware-resistance trade-off, not a "pick the
  newest" choice.** scrypt's memory-hardness raises the cost of GPU/ASIC cracking
  more than bcrypt does, at the cost of being more complex to tune correctly (five
  parameters vs. bcrypt's one); PBKDF2 remains the pragmatic choice specifically
  when FIPS compliance is a hard requirement, independent of which algorithm is
  "best."
- **Every adaptive algorithm should be tuned to cost roughly one second per
  verification on your own hardware** — too cheap and brute-forcing becomes
  practical; too expensive and login latency (and server load under login bursts)
  suffers.
- **Book vs. today:** the book (2020) presents bcrypt/scrypt/PBKDF2 as Spring
  Security's three modern options and doesn't emphasize `Argon2PasswordEncoder` —
  it existed already (added in Spring Security 5.3) but wasn't the headline choice
  at the time of writing. Current Spring Security documentation now recommends
  Argon2 more prominently, as it's the Password Hashing Competition's winning
  algorithm; Spring Security 7.0 additionally introduced a parallel family of
  Password4j-backed encoders (`Argon2Password4jPasswordEncoder`,
  `BcryptPassword4jPasswordEncoder`, and others) as an alternative implementation
  of the same algorithms.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 4, "Dealing with passwords", section 4.1, "Understanding the PasswordEncoder contract", p. 86-96 — doc
- [Spring Security Reference — Password Storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html) — doc
- [Spring Security API — DelegatingPasswordEncoder](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/password/DelegatingPasswordEncoder.html) — doc
- [Spring Security API — PasswordEncoderFactories](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/factory/PasswordEncoderFactories.html) — doc
