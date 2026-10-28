---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Most security bugs in application code are not broken algorithms but the right algorithm used for the wrong job: SHA-256 to store passwords, a plain hash to "sign" a webhook, AES without authentication, `==` to compare a token, `System.Random` for a reset code. .NET ships a primitive for each job in `System.Security.Cryptography`: one-shot hashes (`SHA256.HashData`), keyed hashes (`HMACSHA256.HashData`), authenticated encryption (`AesGcm`), password-based key derivation (`Rfc2898DeriveBytes.Pbkdf2`), signatures (`ECDsa`, `RSA`), a CSPRNG (`RandomNumberGenerator`) and a constant-time comparison (`CryptographicOperations.FixedTimeEquals`). This concept picks the primitive by the job, measures why the wrong one fails (hashes per second, PBKDF2 cost per call, what a flipped bit does to AES-GCM), decodes the hash that ASP.NET Core Identity's `PasswordHasher<TUser>` produces, lists the build diagnostics that flag the old APIs and checks what the .NET 10 post-quantum types do on this machine. Versions used: SDK 10.0.100, runtime `Microsoft.NETCore.App` 10.0.0, `Microsoft.Extensions.Identity.Core` 10.0.14 (for `PasswordHasher<TUser>`), on macOS 27.0.1, Apple M4 Max.

## Use Cases

- Storing user passwords (or API secrets you only need to verify) so that a leaked table does not hand out the passwords.
- Verifying that a webhook or a callback really came from the partner that shares a secret with you, and that the body was not changed.
- Encrypting a field, a file or a token payload so that it can be neither read nor modified without the key.
- Generating reset codes, API keys and salts that an attacker cannot predict.

## Deep Dive

### Pick the primitive by the job

- Integrity against accidents (a download checksum, a cache key, deduplication): a hash, `SHA256.HashData`. Anyone can recompute it, so it proves nothing about who wrote the data.
- Authenticity between two parties that share a secret (webhooks, signed cookies you check yourself): an HMAC, `HMACSHA256.HashData(key, data)`.
- Confidentiality: authenticated encryption, `AesGcm` (or `ChaCha20Poly1305`). Encryption alone without a tag does not detect changes.
- Passwords: a deliberately slow, salted password hash: PBKDF2 via `Rfc2898DeriveBytes.Pbkdf2`, or `PasswordHasher<TUser>` if you use Identity.
- Proving origin to a third party that must not be able to sign: a signature (`ECDsa`, `RSA`): the private key signs, the public key only verifies.

The cryptography model docs give the same map ("Data privacy: Aes", "Data integrity: HMACSHA256, HMACSHA512", "Generating a key from a password: Rfc2898DeriveBytes.Pbkdf2"). For protecting your own app's cookies and tokens with key rotation, prefer ASP.NET Core Data Protection, covered in its own concept; tokens and Identity endpoints are covered in the JWT and Identity concept.

### One-shot hashing

Since .NET 5 the algorithm classes have static one-shot methods, no instance and no `Dispose`:

```csharp
byte[] digest = SHA256.HashData("hello"u8);
using var stream = File.OpenRead(path);
byte[] fileDigest = SHA256.HashData(stream);
```

```text
SHA256(hello) = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
SHA256.HashSizeInBytes = 32, SHA512 = 64
stream hash equal: True
SHA3_256.IsSupported = False
```

`SHA3_256.IsSupported` was false on macOS, as the cross-platform table says (SHA-3 needs Windows 11 build 25324+ or OpenSSL 1.1.1+). Check `IsSupported` before you pick SHA-3 for anything that must run on a Mac.

### Why a fast hash is wrong for passwords

A hash is designed to be fast, and fast is exactly what an attacker with a leaked table wants. I measured one thread on this machine, hashing a 21-byte password repeatedly:

```text
SHA-256 single pass: 5,587,842 hashes/s
PBKDF2-HMAC-SHA256     1,000 iterations:     0.15 ms per call,    6,460.8 guesses/s per core
PBKDF2-HMAC-SHA256   100,000 iterations:    15.44 ms per call,       64.8 guesses/s per core
PBKDF2-HMAC-SHA256   210,000 iterations:    33.51 ms per call,       29.8 guesses/s per core
PBKDF2-HMAC-SHA256   600,000 iterations:    96.76 ms per call,       10.3 guesses/s per core
PBKDF2-HMAC-SHA256 1,000,000 iterations:   157.32 ms per call,        6.4 guesses/s per core
```

Plain SHA-256 allows about 5.6 million guesses per second per core; PBKDF2 at 600,000 iterations allows about 10, roughly 540,000 times fewer. The cost grows linearly with iterations, and it is paid on every login too: about 100 ms of CPU per sign-in here, which is a capacity number to plan for. GPUs and dedicated hardware make the attacker's side much faster than one CPU core, so the ratio matters more than the absolute value.

### PBKDF2 with a random salt

```csharp
byte[] salt = RandomNumberGenerator.GetBytes(16);
byte[] hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 600_000, HashAlgorithmName.SHA256, 32);
// store: algorithm id, iterations, salt, hash; verify by recomputing and FixedTimeEquals
```

```text
same password, two random salts, equal output: False
iterations 0: ArgumentOutOfRangeException: iterations ('0') must be a non-negative and non-zero value. (Parameter 'iterations')
MD5 prf: CryptographicException: 'MD5' is not a known hash algorithm.
```

The salt makes equal passwords produce different hashes, so one precomputed table cannot attack every row. Store the iteration count with the hash so you can raise it later. The API docs list SHA1, SHA256, SHA384 and SHA512 as the supported algorithms and convert a `string` password to UTF-8; they give no iteration recommendation. The OWASP Password Storage Cheat Sheet (checked on 2026-10-28) recommends 600,000 iterations for PBKDF2-HMAC-SHA256, 220,000 for PBKDF2-HMAC-SHA512, and prefers Argon2id when available; .NET has no built-in Argon2id or scrypt. The static `Pbkdf2` method replaces the `Rfc2898DeriveBytes` constructors, which are now obsolete (see below).

### What PasswordHasher<TUser> actually stores

`PasswordHasher<TUser>` lives in `Microsoft.Extensions.Identity.Core` and works without the rest of Identity. I hashed a password and decoded the Base64 output:

```csharp
var hasher = new PasswordHasher<object>();
string h = hasher.HashPassword(new object(), "P@ssw0rd!");
byte[] raw = Convert.FromBase64String(h);   // 0x01 | PRF | iterations | salt length | salt | subkey, big-endian
```

```text
hash: AQAAAAIAAYagAAAAELhZEBfUnQ9WnznXlN8IODJ260iRKFUp22bHyFslmB69cd+erd0vyny4w02jiqaEuA==
decoded length: 61 bytes
byte 0 (format marker): 0x01
PRF: 2 (HMACSHA512), iterations: 100,000, salt: 16 bytes, subkey: 32 bytes
PasswordHasherOptions defaults: CompatibilityMode=IdentityV3, IterationCount=100,000
PasswordHasher.HashPassword warm: 32.7 ms per call
verify right: Success
verify wrong: Failed
hash made with 10,000 iterations, verified by default hasher: SuccessRehashNeeded
V2 hash: first byte 0x00, verified by default hasher: SuccessRehashNeeded
```

In .NET 10 the V3 format is PBKDF2-HMAC-SHA512, 100,000 iterations, a 128-bit salt and a 256-bit subkey, all inside the string. That is below the 220,000 OWASP lists for HMAC-SHA512. Because the parameters are stored per hash, raising the count is safe: set `PasswordHasherOptions.IterationCount`, and older hashes verify as `SuccessRehashNeeded`; `UserManager` then rewrites the hash on the next successful login (I read that in the `UserManager` source). A V2 hash (marker `0x00`, the source says HMAC-SHA1 with 1000 iterations) is upgraded the same way. The setting is `builder.Services.Configure<PasswordHasherOptions>(o => o.IterationCount = 220_000)`.

### Comparing secrets in constant time

`==` on two `byte[]` compares references, and `SequenceEqual` stops at the first different byte, so its time depends on how much of the guess was right:

```text
FixedTimeEquals(equal) = True, (diff) = False
byte[] == byte[] with same content: False
4096 B SequenceEqual   differ at byte 0:     1.7 ns, at byte 4095:    82.0 ns
4096 B FixedTimeEquals differ at byte 0:  9089.9 ns, at byte 4095:  8931.8 ns
```

On 4 KB inputs `SequenceEqual` was about 50 times faster when the first byte differed; `FixedTimeEquals` took the same time either way, as the docs promise ("an amount of time that depends on the length of the sequences, but not their values"). It is much slower in absolute terms (on 32-byte values it took about 110 to 140 ns against 2 to 5 ns, and there the vectorized `SequenceEqual` showed no measurable difference by position). Over a network a few nanoseconds are hard to measure, but the fix costs nothing: use `FixedTimeEquals` for MACs, tokens and password hashes.

### HMAC: authenticity with a shared key

```csharp
byte[] mac = HMACSHA256.HashData(key, body);   // key: RandomNumberGenerator.GetBytes(32), kept secret
bool ok = CryptographicOperations.FixedTimeEquals(mac, HMACSHA256.HashData(key, received));
```

```text
HMAC-SHA256: aacea45d84b2ab8f820c1380921a7857344ad4a666c448f180ca442301e1b178 (32 bytes)
verify original: True
verify tampered: False
plain SHA256 of tampered recomputed by attacker matches its own hash: True
```

The last line is the point: an attacker who changes `"amount":100` to `900` can recompute a plain SHA-256 and send a consistent pair. Without the key they cannot produce the HMAC. Both sides hold the key, so either could have produced the message: that is not proof to a third party.

### Signatures: when the verifier must not be able to sign

```text
signature 64 B, verify with public key only: True
verify after changing one byte: False
sign with public-only key: CryptographicException: Object contains only the public half of a key pair. A private key must also be provided.
```

I signed with an `ECDsa` P-256 key, exported the public key with `ExportSubjectPublicKeyInfoPem` and verified with a second instance that had only that PEM. The verifier cannot sign, which is what makes a signature evidence for others (JWTs signed with ES256 or RS256 work this way).

### AesGcm: encryption that detects tampering

```csharp
using var aes = new AesGcm(key, tagSizeInBytes: 16);          // key: 16, 24 or 32 bytes
byte[] nonce = RandomNumberGenerator.GetBytes(12);             // never reuse with the same key
aes.Encrypt(nonce, plaintext, ciphertext, tag, associatedData);
aes.Decrypt(nonce, ciphertext, tag, plaintext, associatedData); // store nonce + ciphertext + tag
```

```text
AesGcm.IsSupported = True
NonceByteSizes = 12..12, TagByteSizes = 16..16
plaintext 21 B -> ciphertext 21 B + tag 16 B + nonce 12 B
roundtrip: card=4111111111111111
20-byte key: CryptographicException: Specified key is not a valid size for this algorithm.
16-byte nonce: ArgumentException: The specified nonce is not a valid size for this algorithm. (Parameter 'nonce')
tagSize 12, 16-byte tag buffer: ArgumentException: The specified tag is not a valid size for this algorithm. (Parameter 'tagSizeInBytes')
```

16, 24 and 32-byte keys were all accepted. The ciphertext has the plaintext's length; the overhead is 28 bytes of nonce and tag. `TagByteSizes` was `16..16`: the docs say Windows and Linux accept 12 to 16-byte tags, but on Apple platforms CryptoKit limits the tag to 16 bytes, and indeed `new AesGcm(key, 12)` threw on this Mac. Use 16 everywhere. The associated data (here `user:42`) is authenticated but not encrypted: it binds a ciphertext to its context so it cannot be pasted into another user's row. Then I flipped one bit in the ciphertext, one in the tag, and changed the associated data:

```text
1 ciphertext bit flipped: System.Security.Cryptography.AuthenticationTagMismatchException: The computed authentication tag did not match the input authentication tag.
   is CryptographicException: True; output all zero: True
1 tag bit flipped: System.Security.Cryptography.AuthenticationTagMismatchException: The computed authentication tag did not match the input authentication tag.
aad user:43: System.Security.Cryptography.AuthenticationTagMismatchException: The computed authentication tag did not match the input authentication tag.
```

The exact type is `AuthenticationTagMismatchException`, which derives from `CryptographicException` (the docs say it is thrown from .NET 8; earlier versions threw the base type, so `catch (CryptographicException)` covers both). The output buffer was all zeros: the docs say the plaintext is cleared when the tag cannot be validated, so no partially decrypted data leaks to the caller.

Nonces must be unique per key. The `Encrypt` docs are blunt: "The security guarantees of the AES-GCM algorithm mode require that the same nonce value is never used twice with the same key." GCM is a counter mode, so key and nonce determine the keystream. I only checked the visible symptom:

```text
same key+nonce+plaintext twice, identical ciphertext: True
```

The same pair produced the same bytes, so an observer learns that two messages are equal, and with different plaintexts the documented guarantees no longer hold. Use a fresh random 12-byte nonce per message (or a counter you can prove never repeats across restarts and instances) and rotate keys. A hardcoded or zero nonce is the classic bug.

### Book vs today: the diagnostics the compiler shows

Older books build crypto from `new AesManaged()`, `*CryptoServiceProvider` and `new Rfc2898DeriveBytes(...)`. I compiled them against `net10.0` (build output grouped by message):

```text
AesManaged, AesCryptoServiceProvider, SHA256Managed, SHA1CryptoServiceProvider, MD5CryptoServiceProvider:
  warning SYSLIB0021: 'Derived cryptographic types are obsolete. Use the Create method on the base type instead.'
RijndaelManaged, Rijndael: warning SYSLIB0022: 'The Rijndael and RijndaelManaged types are obsolete. Use Aes instead.'
RNGCryptoServiceProvider: warning SYSLIB0023: '... use one of the RandomNumberGenerator static methods instead.'
new Rfc2898DeriveBytes(...): warning SYSLIB0060: 'The constructors on Rfc2898DeriveBytes are obsolete. Use the static Pbkdf2 method instead.'
new AesGcm(key): warning SYSLIB0053: 'AesGcm should indicate the required tag size for encryption and decryption. ...'
HashAlgorithm.Create("SHA256"): warning SYSLIB0045: '... Use the parameterless Create factory method on the algorithm type instead.'
MD5.HashData, SHA1.HashData, RSACryptoServiceProvider, SHA256.Create(), RandomNumberGenerator.Create(): no diagnostic
```

The old constructor `new Rfc2898DeriveBytes("pw", 16)` still ran with `IterationCount=1000` and `HashAlgorithm=SHA1`: weak defaults hidden behind a warning. MD5 and SHA-1 are not obsolete as APIs (they are needed for interop and checksums), so the compiler will not stop you from using them for security; that judgment is yours. In modern .NET the `*Managed` and `*CryptoServiceProvider` classes are wrappers over the OS algorithms anyway, as the cryptography model docs say.

### Randomness: RandomNumberGenerator, never Random

```text
RandomNumberGenerator.GetBytes(16): c60d032768798df7144efe5b0bbbebb1
RandomNumberGenerator.GetInt32(0, 1000000): 393199
GetHexString(32): cfae8efa4fc7cd1813ea0cb1fdcda4b8
GetString: GWYD9ZZPBG
new Random(1234) twice: 857019877 1923929452 / 857019877 1923929452
```

`System.Random` is a seeded generator: same seed, same sequence, and it is not designed to resist prediction. The static `RandomNumberGenerator` methods use the platform CSPRNG, and `GetInt32`, `GetHexString` and `GetString(choices, length)` cover reset codes and API keys without modulo-bias mistakes.

### Post-quantum types in .NET 10

.NET 10 adds `MLKem` (key encapsulation), `MLDsa` and `SlhDsa` (signatures) and `CompositeMLDsa` (ML-DSA paired with a classical algorithm). I checked support and compiled without any `#pragma`:

```text
MLKem.IsSupported = False
MLDsa.IsSupported = False
SlhDsa.IsSupported = False
CompositeMLDsa.IsAlgorithmSupported(MLDsa65WithECDsaP256) = False
MLKem.GenerateKey: System.PlatformNotSupportedException: Algorithm 'MLKem' is not supported on this platform.
error SYSLIB5006: 'System.Security.Cryptography.SlhDsa' is for evaluation purposes only and is subject to change or removal in future updates. Suppress this diagnostic to proceed.
error SYSLIB5006: 'System.Security.Cryptography.CompositeMLDsa' is for evaluation purposes only ...
error SYSLIB5006: 'System.Security.Cryptography.MLKem.ExportSubjectPublicKeyInfo()' is for evaluation purposes only ...
error SYSLIB5006: 'System.Security.Cryptography.MLDsa.SignPreHash(byte[], string, byte[]?)' is for evaluation purposes only ...
```

Two corrections to what I expected. First, `MLDsa` is not experimental as a class: `IsSupported`, `GenerateKey` and `SignData` compiled without a diagnostic; only some members are (`SignPreHash` and the PKCS#8/SPKI/PEM import and export, since those formats came from drafts), and the same holds for `MLKem`. `SlhDsa` and `CompositeMLDsa` are experimental as whole classes, which matches the .NET Blog post. Second, SYSLIB5006 is an error, not a warning, so the build fails until you add `#pragma warning disable SYSLIB5006` or `<NoWarn>`. Nothing is supported on macOS: the cross-platform docs list Linux with OpenSSL 3.5.0+ and recent Windows 11 only, Apple with no support. Call `IsSupported` and keep a classical fallback.

### Which library did the work on this machine

The cross-platform docs say .NET calls the operating system's crypto library (CNG on Windows, OpenSSL on Linux, Apple's libraries on macOS) rather than shipping its own, so support and FIPS status follow the OS. I ran the program with `DYLD_PRINT_LIBRARIES=1` and filtered the loaded images:

```text
libSystem.Security.Cryptography.Native.Apple.dylib
CryptoKit
libcommonCrypto.dylib
libcorecrypto.dylib
```

The Apple shim and CryptoKit were loaded, and the OpenSSL shim (`libSystem.Security.Cryptography.Native.OpenSsl`) was not. That explains the differences above: 16-byte tags only, no SHA-3, no post-quantum. The same code on a Linux container uses the distro's OpenSSL, so test there before you rely on an algorithm.

## Trade-offs

- **PBKDF2 is the portable choice, not the strongest one.** It is built in and FIPS-friendly, but it is not memory-hard; OWASP prefers Argon2id, which needs a third-party package in .NET.
- **Iterations are a latency and CPU budget.** 600,000 iterations cost about 100 ms of one core per login here; a login burst becomes a CPU burst, so pair it with rate limiting.
- **Identity's default is conservative but upgradable.** 100,000 iterations of HMAC-SHA512 in .NET 10; raise `IterationCount` and old hashes migrate on the next login through `SuccessRehashNeeded`.
- **HMAC vs signature.** HMAC is fast and short but both sides can forge; a signature needs key pairs and is larger, but the verifier cannot sign.
- **AES-GCM is only as safe as the nonce handling.** One repeated nonce under a key breaks the documented guarantees; random 96-bit nonces plus key rotation are the simple path, and the 16-byte tag is the only size that works everywhere.
- **Raw primitives are easy to misuse.** For protecting your own cookies, tokens and temporary payloads, Data Protection handles keys, rotation and authenticated encryption for you; reach for `AesGcm` when you need a format you control.
- **Platform differences are real.** SHA-3, tag sizes and the post-quantum types depend on the OS library (none of the latter run on macOS, and `SlhDsa` and `CompositeMLDsa` fail the build without suppression); check `IsSupported` and test on the OS you deploy to.

## Documentation Links

- [Cross-platform cryptography in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/security/cross-platform-cryptography) (doc)
- [.NET cryptography model, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/security/cryptography-model) (doc)
- [Rfc2898DeriveBytes.Pbkdf2 Method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.rfc2898derivebytes.pbkdf2?view=net-10.0) (doc)
- [AesGcm Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.aesgcm?view=net-10.0) (doc)
- [Post-Quantum Cryptography in .NET, .NET Blog](https://devblogs.microsoft.com/dotnet/post-quantum-cryptography-in-dotnet/) (doc)
- [Password Storage Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (doc)
