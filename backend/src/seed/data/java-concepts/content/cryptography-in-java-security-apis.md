---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

The JDK does not hard-wire a single cryptography implementation into `Cipher` or `MessageDigest` — it ships an architecture, the Java Cryptography Architecture (JCA) and its encryption extension (JCE), where every algorithm is requested by name (`"SHA-256"`, `"AES/GCM/NoPadding"`) and resolved at runtime against a list of pluggable providers. Once that indirection is understood, the rest of `java.security`/`javax.crypto` is a small set of well-defined jobs — hash a message, generate randomness safely, encrypt/decrypt, sign/verify, store keys — each with one correct API and several tempting-but-wrong shortcuts (`Random` instead of `SecureRandom`, ECB instead of GCM, a bare hash instead of a password-hashing scheme) that this concept exists to flag explicitly.

## Use Cases

- Verifying file/message integrity or content-addressing data (Git-style) with `MessageDigest` and SHA-256/SHA-3.
- Generating session tokens, nonces, or cryptographic keys, and knowing why `java.util.Random` is the wrong tool for any of them.
- Encrypting data at rest or in transit with `Cipher`, and choosing a mode (GCM) that also detects tampering rather than one (ECB/CBC without a MAC) that does not.
- Signing data (e.g., a license file, a webhook payload) with an asymmetric key pair via `Signature`, so a third party can verify authenticity without holding the private key.
- Loading and querying a `KeyStore` (PKCS12) to retrieve a private key or a trusted certificate at application startup, instead of shipping key material as raw files.
- Inspecting which cryptographic providers are installed and what they support, when diagnosing an `NoSuchAlgorithmException` or auditing what a deployment actually has available.

## Deep Dive

### The provider architecture: JCA/JCE

Every cryptographic engine class in `java.security`/`javax.crypto` (`MessageDigest`, `Cipher`, `Signature`, `KeyStore`, `KeyPairGenerator`, `SecureRandom`, ...) is an *engine class*: calling `MessageDigest.getInstance("SHA-256")` does not run hand-written SHA-256 code inside `MessageDigest` itself — it asks the JCA to find a registered `Provider` that implements a `MessageDigest` SPI for `"SHA-256"` and returns a wrapper around that provider's implementation. This is why the same call can behave differently across JVM vendors or configurations: the algorithm name is a contract, the implementation is swappable.

```java
import java.security.Provider;
import java.security.Security;

for (Provider provider : Security.getProviders()) {
    System.out.println(provider.getName() + " v" + provider.getVersionStr());
}
```

On a stock OpenJDK build this typically lists providers such as `SUN`, `SunRsaSign`, `SunJCE`, and `SunEC` — the JDK's own default providers, registered in `java.security` configuration and consulted in order until one satisfies the request. Asking for an algorithm no installed provider implements throws a checked exception rather than failing silently:

```java
try {
    MessageDigest.getInstance("MD2-BOGUS");
} catch (NoSuchAlgorithmException e) {
    System.out.println("No provider supplies this algorithm: " + e.getMessage());
}
```

A specific provider can also be requested explicitly (`getInstance("AES", "SunJCE")`), but for ordinary application code the default provider search order is almost always the right choice — pinning a provider by name couples the code to whatever providers happen to be installed on a given JVM.

### `MessageDigest`: hashing, and why it is not password storage

`MessageDigest` produces a fixed-size digest from arbitrary input — the same input always produces the same output, and recovering the input from the digest should be computationally infeasible.

```java
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
byte[] digest = sha256.digest("hello world".getBytes(StandardCharsets.UTF_8));
System.out.println(HexFormat.of().formatHex(digest));
// b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde
```

`SHA3-256` is available the same way (`MessageDigest.getInstance("SHA3-256")`) as a structurally different, standardized alternative to the SHA-2 family. `digest()` also has an incremental form via repeated `update(byte[])` calls for streaming large inputs without holding the whole message in memory.

The critical limitation: a bare cryptographic hash is deliberately *fast* and deterministic, which is exactly wrong for storing passwords. Hashing the same password twice with `SHA-256` always yields the same digest, so identical passwords produce identical stored values (revealing which accounts share a password) and the speed that makes SHA-256 good for integrity checks is what lets an attacker with the digest brute-force or rainbow-table it at billions of guesses per second on commodity hardware.

```java
MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
byte[] a = sha256.digest("Password123!".getBytes(StandardCharsets.UTF_8));
byte[] b = sha256.digest("Password123!".getBytes(StandardCharsets.UTF_8));
System.out.println(java.util.Arrays.equals(a, b)); // true — no salt, nothing slows this down
```

Correct password storage needs a salted, deliberately *slow* and memory-hard, adaptive algorithm (the well-known families are bcrypt, scrypt, and Argon2, and the JDK also ships PBKDF2 via `javax.crypto.SecretKeyFactory` as a JCA-native, iteration-tunable option). `java.security.MessageDigest` alone provides none of this — no built-in salting, no configurable work factor — so reaching for `SHA-256` on a password field is a common and serious misuse of an otherwise correct API.

### `SecureRandom` vs `java.util.Random`

`java.util.Random` is a linear congruential PRNG: fast, well-distributed for simulations and games, and *completely predictable* once an attacker recovers enough consecutive outputs, because the internal seed can be reconstructed from them. `SecureRandom` instead draws from a cryptographically strong source (backed by the OS entropy pool or a certified DRBG algorithm) specifically designed so that observing past output reveals nothing about future output.

```java
import java.security.SecureRandom;

SecureRandom secureRandom = new SecureRandom();
byte[] tokenBytes = new byte[16];
secureRandom.nextBytes(tokenBytes);
String sessionToken = HexFormat.of().formatHex(tokenBytes);
```

The concrete failure mode: seed `java.util.Random` with the current time (a common but flawed pattern for "quick" token generation) and the output space collapses to whatever the seed range covers.

```java
Random weak = new Random(System.currentTimeMillis());
long guess1 = weak.nextLong(); // an attacker who brackets the request time
long guess2 = weak.nextLong(); // can enumerate every possible seed and reproduce this sequence
```

Because `System.currentTimeMillis()` at the moment of a request is a narrow, guessable range (millisecond precision, requestable to within seconds), an attacker who suspects this pattern can brute-force the seed and regenerate the exact "random" session token — this is precisely why session identifiers, password reset tokens, and cryptographic keys must come from `SecureRandom`, never `Random`.

### `Cipher`: symmetric encryption, and why the mode matters

`Cipher` performs the actual encrypt/decrypt work, configured by a transformation string of the form `"algorithm/mode/padding"`. For AES, the mode is not a minor detail — it changes the security properties of the ciphertext.

AES in **GCM** mode is an authenticated encryption mode: it produces ciphertext plus an authentication tag, so tampering with the ciphertext causes decryption to fail loudly instead of silently returning corrupted plaintext.

```java
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

SecretKeySpec key = new SecretKeySpec(keyBytes, "AES"); // keyBytes: 16/24/32-byte key from a KeyGenerator
byte[] iv = new byte[12];
new SecureRandom().nextBytes(iv); // a fresh, random IV per encryption — never reused with the same key

Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
byte[] ciphertext = cipher.doFinal("top secret".getBytes(StandardCharsets.UTF_8));

Cipher decryptCipher = Cipher.getInstance("AES/GCM/NoPadding");
decryptCipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
byte[] plaintext = decryptCipher.doFinal(ciphertext); // throws AEADBadTagException if tampered
```

AES in **ECB** mode, by contrast, encrypts each fixed-size block independently with no chaining and no authentication tag. Identical plaintext blocks always produce identical ciphertext blocks, which leaks structural information about the plaintext — the classic illustration is that encrypting an image in ECB still shows the outline of the original image, because repeated regions of pixels map to repeated ciphertext blocks. This is a widely and long-established fact about block cipher mode design, not a vendor-specific defect, and it is why `"AES/ECB/PKCS5Padding"` should be treated as unsuitable for encrypting any data with repeating structure:

```java
Cipher ecb = Cipher.getInstance("AES/ECB/PKCS5Padding");
ecb.init(Cipher.ENCRYPT_MODE, key);
byte[] blockA = ecb.doFinal("SAME_16_BYTES!!!".getBytes(StandardCharsets.UTF_8));
byte[] blockB = ecb.doFinal("SAME_16_BYTES!!!".getBytes(StandardCharsets.UTF_8));
System.out.println(java.util.Arrays.equals(blockA, blockB)); // true — identical input, identical output, every time
```

Older chained modes like CBC fix the "identical blocks look identical" problem with an IV, but still provide no authentication on their own — a bit flipped in CBC ciphertext produces predictably altered plaintext on decryption rather than a failure, unless a separate MAC is added. GCM's built-in authentication tag is why it is the generally recommended default for new code over ECB or unauthenticated CBC.

### `KeyPairGenerator` and `Signature`: asymmetric signing and verification

Digital signatures let a holder of a private key prove authorship of data, and anyone holding only the corresponding public key verify it, without ever exposing the private key.

```java
import java.security.*;

KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
generator.initialize(2048);
KeyPair keyPair = generator.generateKeyPair();

Signature signer = Signature.getInstance("SHA256withRSA");
signer.initSign(keyPair.getPrivate());
signer.update("release-1.2.3.jar contents".getBytes(StandardCharsets.UTF_8));
byte[] signatureBytes = signer.sign();

Signature verifier = Signature.getInstance("SHA256withRSA");
verifier.initVerify(keyPair.getPublic());
verifier.update("release-1.2.3.jar contents".getBytes(StandardCharsets.UTF_8));
boolean valid = verifier.verify(signatureBytes); // true only if the bytes and the signature both match
```

The same `Signature` shape works for elliptic-curve keys, typically with a smaller key size for equivalent strength:

```java
KeyPairGenerator ecGenerator = KeyPairGenerator.getInstance("EC");
ecGenerator.initialize(256); // NIST P-256 curve, roughly comparable strength to 3072-bit RSA
KeyPair ecKeyPair = ecGenerator.generateKeyPair();

Signature ecSigner = Signature.getInstance("SHA256withECDSA");
ecSigner.initSign(ecKeyPair.getPrivate());
```

If even a single byte of the signed data changes between signing and verification, `verify()` returns `false` rather than throwing — callers must check the boolean, not assume a lack of exception means the signature held.

### `KeyStore`: storing keys and certificates

Shipping a private key as a loose file next to application code is fragile and hard to protect; `KeyStore` provides a single, password-protected container for private keys and certificates, most commonly in the PKCS12 format (`.p12`/`.pfx`) that has been the default keystore type since JDK 9.

```java
import java.security.KeyStore;
import java.io.FileInputStream;

char[] storePassword = "changeit".toCharArray();

KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (FileInputStream in = new FileInputStream("app-keystore.p12")) {
    keyStore.load(in, storePassword);
}

PrivateKey privateKey = (PrivateKey) keyStore.getKey("my-alias", storePassword);
java.security.cert.Certificate certificate = keyStore.getCertificate("my-alias");
```

Creating an entry programmatically and saving the store back out follows the same object:

```java
KeyStore newStore = KeyStore.getInstance("PKCS12");
newStore.load(null, null); // start empty, no existing file to load
newStore.setKeyEntry("my-alias", keyPair.getPrivate(), storePassword,
        new java.security.cert.Certificate[] { selfSignedCertificate });

try (var out = new java.io.FileOutputStream("app-keystore.p12")) {
    newStore.store(out, storePassword);
}
```

A password-wrong or corrupted keystore fails at `load()` with an `IOException` (frequently wrapping an integrity-check failure), which is the point at which most keystore-handling bugs surface in practice.

Framework-level credential and secrets management (for example, Spring Security's authentication and password-encoding abstractions) builds on these primitives but is out of scope here — this concept covers only the JDK-native `java.security`/`javax.crypto` layer underneath.

## Trade-offs

- **The provider architecture is flexible but makes algorithm availability an environment fact, not a language guarantee** — `getInstance("SHA3-256")` works wherever a provider registers it (the JDK's default providers do), but code that assumes a specific algorithm is always present should still catch `NoSuchAlgorithmException` rather than treat it as unreachable.
- **`MessageDigest` is correct for integrity/content-addressing and wrong for password storage**, and the JDK does not ship a batteries-included adaptive password-hashing algorithm (bcrypt/scrypt/Argon2) — `SecretKeyFactory` with PBKDF2 is the JCA-native option with a tunable iteration count, but reaching for a plain `MessageDigest.getInstance("SHA-256")` on a password field silently drops salting and adaptive cost entirely.
- **`SecureRandom` is slower and more resource-intensive than `java.util.Random`**, because it draws from a genuine entropy source instead of a cheap arithmetic recurrence — that cost is the price of unpredictability and is non-negotiable for tokens, keys, and nonces.
- **GCM requires strict IV discipline that ECB and CBC do not** — reusing the same key/IV pair for two different GCM encryptions catastrophically breaks its confidentiality guarantees, so callers must generate a fresh random IV (typically via `SecureRandom`) every single time, never a fixed or counter-reused value shared carelessly across calls.
- **Larger RSA keys and PKCS12 keystore operations carry real CPU cost**, so key generation and signing are usually done once and cached/persisted rather than repeated per request — generating a 2048-bit `KeyPair` inside a hot request path is a common, avoidable performance mistake.
- **`KeyStore` password handling means the password itself must live somewhere** (environment variable, secrets manager, HSM) — a `KeyStore` file only protects the keys inside it as well as its password is protected, so hardcoding that password next to the `.p12` file defeats the point of using a keystore at all.

## Documentation Links

- [MessageDigest — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html) — doc
- [Cipher — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/crypto/Cipher.html) — doc
- [SecureRandom — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/SecureRandom.html) — doc
- [Signature — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/Signature.html) — doc
- [KeyStore — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/KeyStore.html) — doc
- [KeyPairGenerator — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/KeyPairGenerator.html) — doc
- [Java Cryptography Architecture (JCA) Reference Guide — Oracle](https://docs.oracle.com/en/java/javase/25/security/java-cryptography-architecture-jca-reference-guide.html) — doc
