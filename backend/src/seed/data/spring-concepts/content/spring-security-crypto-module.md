---
version: 1.0
updatedAt: 2026-08-01
---
## Objective

Encryption, decryption, and key generation aren't offered out of the box by the Java
language in a way that's convenient to use directly. The Spring Security Crypto
Module (SSCM) — the same module `PasswordEncoder` implementations are built on —
also exposes two standalone utilities for any code that needs cryptography: key
generators for producing salts/keys, and encryptors for encrypting and decrypting
data, both without adding a separate crypto dependency to the project.

## Use Cases

- Generating a random salt value to feed into a hashing or encryption algorithm.
- Encrypting a value before persisting it (an API secret, a token) and decrypting it
  back when it's read.
- Encrypting a value that also needs to be looked up later by its encrypted form —
  e.g., searching for a row by an encrypted API key — which a normal (randomized)
  encryptor can't support.

## Deep Dive

### Key generators: `StringKeyGenerator` and `BytesKeyGenerator`

Two contracts cover the two shapes a generated key can take, both built via the
`KeyGenerators` factory:

```java
public interface StringKeyGenerator {
    String generateKey();
}

public interface BytesKeyGenerator {
    int getKeyLength();
    byte[] generateKey();
}
```

```java
// String key (hex-encoded), typically used as a salt — 8 bytes by default
StringKeyGenerator keyGenerator = KeyGenerators.string();
String salt = keyGenerator.generateKey();

// Byte[] key, 8 bytes by default, a new random value on every call
BytesKeyGenerator keyGenerator = KeyGenerators.secureRandom();
byte[] key = keyGenerator.generateKey();

// Same, but a custom key length
BytesKeyGenerator keyGenerator = KeyGenerators.secureRandom(16);
```

`KeyGenerators.shared(int length)` is the odd one out: unlike `secureRandom()`, it
returns the *same* key value on every call to `generateKey()` — useful when a fixed
key/IV needs to be reused rather than freshly randomized each time.

### Encryptors: `BytesEncryptor` and `TextEncryptor`

```java
public interface TextEncryptor {
    String encrypt(String text);
    String decrypt(String encryptedText);
}

public interface BytesEncryptor {
    byte[] encrypt(byte[] byteArray);
    byte[] decrypt(byte[] encryptedByteArray);
}
```

`TextEncryptor` works with strings in and out; `BytesEncryptor` works with raw
`byte[]`. Both need a password and a salt to construct:

```java
String salt = KeyGenerators.string().generateKey();
String password = "secret";

BytesEncryptor e = Encryptors.standard(password, salt);
byte[] encrypted = e.encrypt("HELLO".getBytes());
byte[] decrypted = e.decrypt(encrypted);
```

### Standard vs. stronger: the same 256-bit AES key, a different mode

```java
BytesEncryptor standard = Encryptors.standard(password, salt);  // AES/CBC
BytesEncryptor stronger = Encryptors.stronger(password, salt);  // AES/GCM
```

Both derive a 256-bit AES key from the password/salt via PBKDF2; the difference is
the block cipher mode — `standard()` uses CBC, `stronger()` uses GCM (an
authenticated mode, considered the stronger choice). `Encryptors.text(...)` is the
`TextEncryptor` built on `standard()`; `Encryptors.delux(...)` is the `TextEncryptor`
built on `stronger()`.

### Queryable text: trading randomness for lookups

```java
String salt = KeyGenerators.string().generateKey();
String password = "secret";
String value = "HELLO";

TextEncryptor e = Encryptors.queryableText(password, salt);
String encrypted1 = e.encrypt(value);
String encrypted2 = e.encrypt(value);
// encrypted1 == encrypted2
```

`Encryptors.text()`/`.delux()` randomize the initialization vector on every call, so
encrypting the same plaintext twice produces two different ciphertexts — normally
desirable, but it makes `WHERE encrypted_column = ?` impossible. `queryableText()`
fixes the IV instead of randomizing it, so the same input always encrypts to the
same output — the one case where a *less* random encryptor is the correct choice.
`Encryptors.noOpText()` rounds out the factory with a pass-through `TextEncryptor`
(`encrypt()` returns the input unchanged) for demos/tests where encryption would
just add noise.

## Trade-offs

- **`queryableText()` is a deliberate, narrow exception, not a general recommendation.**
  Fixing the IV makes lookups possible but leaks whether two encrypted values are
  equal — only reach for it when a value genuinely needs to be searched by its
  encrypted form (an OAuth client secret used as a lookup key is the book's own
  example); default to `text()`/`delux()` otherwise.
- **`stronger()`/`delux()` cost a little more than `standard()`/`text()` for a real
  security upgrade** — GCM is an authenticated encryption mode (it also detects
  tampering), not just "the same encryption done harder." Prefer the GCM-based
  variants for new code unless there's a specific compatibility reason not to.
- **Book vs. today:** this section's API and its AES-256/CBC-vs-GCM framing are
  unchanged in current Spring Security — `Encryptors.standard()`/`stronger()`
  still describe the same CBC/GCM split, confirmed via the current official
  reference. Nothing here aged; it's one of the rare "still exactly accurate"
  sections in a Spring Security book from 2020.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 4, "Dealing with passwords", section 4.2, "More about the Spring Security Crypto module", p. 97-101 — doc
- [Spring Security Reference — Spring Security Crypto Module](https://docs.spring.io/spring-security/reference/features/integrations/cryptography.html) — doc
- [Spring Security API — KeyGenerators](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/keygen/KeyGenerators.html) — doc
- [Spring Security API — Encryptors](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/encrypt/Encryptors.html) — doc
