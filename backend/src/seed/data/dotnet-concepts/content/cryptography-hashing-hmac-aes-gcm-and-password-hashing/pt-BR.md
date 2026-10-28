---
version: 1.0
updatedAt: 2026-10-28
title: "Criptografia: hashing, HMAC, AES-GCM e hash de senhas"
summary: Como escolher a primitiva certa do .NET para cada tarefa, com medições: SHA256.HashData, por que um hash rápido não serve para senhas, PBKDF2 com salt aleatório, o formato real do PasswordHasher do Identity, comparação em tempo constante, HMAC, assinaturas, AesGcm e adulteração, nonces, os diagnósticos SYSLIB das APIs antigas, RandomNumberGenerator e os tipos pós-quânticos do .NET 10.
---
## Objective

A maioria dos bugs de segurança em código de aplicação não vem de algoritmos quebrados, e sim do algoritmo certo usado na tarefa errada: SHA-256 para guardar senhas, um hash simples para "assinar" um webhook, AES sem autenticação, `==` para comparar um token, `System.Random` para um código de redefinição de senha. O .NET traz uma primitiva para cada tarefa em `System.Security.Cryptography`: hashes de uma chamada só (`SHA256.HashData`), hashes com chave (`HMACSHA256.HashData`), criptografia autenticada (`AesGcm`), derivação de chave a partir de senha (`Rfc2898DeriveBytes.Pbkdf2`), assinaturas (`ECDsa`, `RSA`), um CSPRNG (`RandomNumberGenerator`) e uma comparação em tempo constante (`CryptographicOperations.FixedTimeEquals`). Este conceito escolhe a primitiva pela tarefa, mede por que a escolha errada falha (hashes por segundo, custo do PBKDF2 por chamada, o que um bit trocado faz com o AES-GCM), decodifica o hash que o `PasswordHasher<TUser>` do ASP.NET Core Identity produz, lista os diagnósticos de build que marcam as APIs antigas e verifica o que os tipos pós-quânticos do .NET 10 fazem nesta máquina. Versões usadas: SDK 10.0.100, runtime `Microsoft.NETCore.App` 10.0.0, `Microsoft.Extensions.Identity.Core` 10.0.14 (para o `PasswordHasher<TUser>`), no macOS 27.0.1, Apple M4 Max.

## Use Cases

- Guardar senhas de usuários (ou segredos de API que você só precisa verificar) de forma que uma tabela vazada não entregue as senhas.
- Verificar que um webhook ou callback veio mesmo do parceiro que compartilha um segredo com você, e que o corpo não foi alterado.
- Criptografar um campo, um arquivo ou o payload de um token para que não possa ser lido nem modificado sem a chave.
- Gerar códigos de redefinição, chaves de API e salts que um atacante não consiga prever.

## Deep Dive

### Escolha a primitiva pela tarefa

- Integridade contra acidentes (checksum de download, chave de cache, deduplicação): um hash, `SHA256.HashData`. Qualquer um consegue recalculá-lo, então ele não prova nada sobre quem escreveu os dados.
- Autenticidade entre duas partes que compartilham um segredo (webhooks, cookies assinados que você mesmo verifica): um HMAC, `HMACSHA256.HashData(key, data)`.
- Confidencialidade: criptografia autenticada, `AesGcm` (ou `ChaCha20Poly1305`). Criptografia sem tag não detecta alterações.
- Senhas: um hash de senha propositalmente lento e com salt: PBKDF2 via `Rfc2898DeriveBytes.Pbkdf2`, ou `PasswordHasher<TUser>` se você usa o Identity.
- Provar a origem para um terceiro que não pode ser capaz de assinar: uma assinatura (`ECDsa`, `RSA`): a chave privada assina, a pública só verifica.

A documentação do modelo de criptografia dá o mesmo mapa ("Data privacy: Aes", "Data integrity: HMACSHA256, HMACSHA512", "Generating a key from a password: Rfc2898DeriveBytes.Pbkdf2"). Para proteger cookies e tokens do próprio app com rotação de chaves, prefira o Data Protection do ASP.NET Core, que tem um conceito próprio; tokens e os endpoints do Identity estão no conceito de JWT e Identity.

### Hashing em uma chamada

Desde o .NET 5 as classes de algoritmo têm métodos estáticos de uma chamada só, sem instância e sem `Dispose`:

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

`SHA3_256.IsSupported` deu false no macOS, como diz a tabela de criptografia multiplataforma (SHA-3 exige Windows 11 build 25324+ ou OpenSSL 1.1.1+). Confira `IsSupported` antes de escolher SHA-3 para qualquer coisa que precise rodar num Mac.

### Por que um hash rápido é errado para senhas

Um hash é feito para ser rápido, e rápido é exatamente o que um atacante com uma tabela vazada quer. Medi uma thread nesta máquina, calculando repetidamente o hash de uma senha de 21 bytes:

```text
SHA-256 single pass: 5,587,842 hashes/s
PBKDF2-HMAC-SHA256     1,000 iterations:     0.15 ms per call,    6,460.8 guesses/s per core
PBKDF2-HMAC-SHA256   100,000 iterations:    15.44 ms per call,       64.8 guesses/s per core
PBKDF2-HMAC-SHA256   210,000 iterations:    33.51 ms per call,       29.8 guesses/s per core
PBKDF2-HMAC-SHA256   600,000 iterations:    96.76 ms per call,       10.3 guesses/s per core
PBKDF2-HMAC-SHA256 1,000,000 iterations:   157.32 ms per call,        6.4 guesses/s per core
```

SHA-256 puro permite cerca de 5,6 milhões de tentativas por segundo por núcleo; PBKDF2 com 600.000 iterações permite cerca de 10, umas 540.000 vezes menos. O custo cresce linearmente com as iterações e também é pago em todo login: cerca de 100 ms de CPU por autenticação aqui, um número de capacidade para planejar. GPUs e hardware dedicado deixam o lado do atacante muito mais rápido que um núcleo de CPU, então a razão importa mais que o valor absoluto.

### PBKDF2 com salt aleatório

```csharp
byte[] salt = RandomNumberGenerator.GetBytes(16);
byte[] hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 600_000, HashAlgorithmName.SHA256, 32);
// guarde: id do algoritmo, iterações, salt, hash; verifique recalculando e usando FixedTimeEquals
```

```text
same password, two random salts, equal output: False
iterations 0: ArgumentOutOfRangeException: iterations ('0') must be a non-negative and non-zero value. (Parameter 'iterations')
MD5 prf: CryptographicException: 'MD5' is not a known hash algorithm.
```

O salt faz senhas iguais produzirem hashes diferentes, então uma tabela pré-calculada não ataca todas as linhas de uma vez. Guarde o número de iterações junto com o hash para poder aumentá-lo depois. A documentação da API lista SHA1, SHA256, SHA384 e SHA512 como algoritmos suportados e converte uma senha `string` para UTF-8; ela não recomenda número de iterações. O OWASP Password Storage Cheat Sheet (consultado em 2026-10-28) recomenda 600.000 iterações para PBKDF2-HMAC-SHA256, 220.000 para PBKDF2-HMAC-SHA512, e prefere Argon2id quando disponível; o .NET não tem Argon2id nem scrypt embutidos. O método estático `Pbkdf2` substitui os construtores de `Rfc2898DeriveBytes`, que agora são obsoletos (veja abaixo).

### O que o PasswordHasher<TUser> realmente guarda

O `PasswordHasher<TUser>` fica em `Microsoft.Extensions.Identity.Core` e funciona sem o resto do Identity. Gerei o hash de uma senha e decodifiquei a saída Base64:

```csharp
var hasher = new PasswordHasher<object>();
string h = hasher.HashPassword(new object(), "P@ssw0rd!");
byte[] raw = Convert.FromBase64String(h);   // 0x01 | PRF | iterações | tamanho do salt | salt | subchave, big-endian
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

No .NET 10 o formato V3 é PBKDF2-HMAC-SHA512, 100.000 iterações, salt de 128 bits e subchave de 256 bits, tudo dentro da string. Isso fica abaixo dos 220.000 que o OWASP lista para HMAC-SHA512. Como os parâmetros ficam guardados em cada hash, aumentar o número é seguro: configure `PasswordHasherOptions.IterationCount`, e hashes antigos verificam como `SuccessRehashNeeded`; o `UserManager` então regrava o hash no próximo login bem-sucedido (li isso no código-fonte do `UserManager`). Um hash V2 (marcador `0x00`, o código-fonte diz HMAC-SHA1 com 1000 iterações) é atualizado do mesmo jeito. A configuração é `builder.Services.Configure<PasswordHasherOptions>(o => o.IterationCount = 220_000)`.

### Comparando segredos em tempo constante

`==` entre dois `byte[]` compara referências, e `SequenceEqual` para no primeiro byte diferente, então o tempo depende de quanto do palpite estava certo:

```text
FixedTimeEquals(equal) = True, (diff) = False
byte[] == byte[] with same content: False
4096 B SequenceEqual   differ at byte 0:     1.7 ns, at byte 4095:    82.0 ns
4096 B FixedTimeEquals differ at byte 0:  9089.9 ns, at byte 4095:  8931.8 ns
```

Com entradas de 4 KB, `SequenceEqual` foi cerca de 50 vezes mais rápido quando o primeiro byte diferia; `FixedTimeEquals` levou o mesmo tempo nos dois casos, como a documentação promete ("an amount of time that depends on the length of the sequences, but not their values"). Em termos absolutos ele é bem mais lento (com valores de 32 bytes levou cerca de 110 a 140 ns contra 2 a 5 ns, e ali o `SequenceEqual` vetorizado não mostrou diferença mensurável pela posição). Pela rede, poucos nanossegundos são difíceis de medir, mas a correção não custa nada: use `FixedTimeEquals` para MACs, tokens e hashes de senha.

### HMAC: autenticidade com chave compartilhada

```csharp
byte[] mac = HMACSHA256.HashData(key, body);   // key: RandomNumberGenerator.GetBytes(32), mantida em segredo
bool ok = CryptographicOperations.FixedTimeEquals(mac, HMACSHA256.HashData(key, received));
```

```text
HMAC-SHA256: aacea45d84b2ab8f820c1380921a7857344ad4a666c448f180ca442301e1b178 (32 bytes)
verify original: True
verify tampered: False
plain SHA256 of tampered recomputed by attacker matches its own hash: True
```

A última linha é o ponto: um atacante que troca `"amount":100` por `900` consegue recalcular um SHA-256 puro e enviar um par consistente. Sem a chave, ele não consegue produzir o HMAC. Os dois lados têm a chave, então qualquer um deles poderia ter gerado a mensagem: isso não é prova para um terceiro.

### Assinaturas: quando quem verifica não pode assinar

```text
signature 64 B, verify with public key only: True
verify after changing one byte: False
sign with public-only key: CryptographicException: Object contains only the public half of a key pair. A private key must also be provided.
```

Assinei com uma chave `ECDsa` P-256, exportei a chave pública com `ExportSubjectPublicKeyInfoPem` e verifiquei com uma segunda instância que tinha só esse PEM. Quem verifica não consegue assinar, e é isso que torna uma assinatura uma evidência para outros (JWTs assinados com ES256 ou RS256 funcionam assim).

### AesGcm: criptografia que detecta adulteração

```csharp
using var aes = new AesGcm(key, tagSizeInBytes: 16);          // chave: 16, 24 ou 32 bytes
byte[] nonce = RandomNumberGenerator.GetBytes(12);             // nunca reutilize com a mesma chave
aes.Encrypt(nonce, plaintext, ciphertext, tag, associatedData);
aes.Decrypt(nonce, ciphertext, tag, plaintext, associatedData); // guarde nonce + ciphertext + tag
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

Chaves de 16, 24 e 32 bytes foram todas aceitas. O ciphertext tem o tamanho do plaintext; o overhead é de 28 bytes de nonce e tag. `TagByteSizes` deu `16..16`: a documentação diz que Windows e Linux aceitam tags de 12 a 16 bytes, mas nas plataformas Apple o CryptoKit limita a tag a 16 bytes, e de fato `new AesGcm(key, 12)` lançou exceção neste Mac. Use 16 em todo lugar. Os dados associados (aqui `user:42`) são autenticados, mas não criptografados: eles amarram um ciphertext ao seu contexto para que não possa ser colado na linha de outro usuário. Depois troquei um bit do ciphertext, um bit da tag, e mudei os dados associados:

```text
1 ciphertext bit flipped: System.Security.Cryptography.AuthenticationTagMismatchException: The computed authentication tag did not match the input authentication tag.
   is CryptographicException: True; output all zero: True
1 tag bit flipped: System.Security.Cryptography.AuthenticationTagMismatchException: The computed authentication tag did not match the input authentication tag.
aad user:43: System.Security.Cryptography.AuthenticationTagMismatchException: The computed authentication tag did not match the input authentication tag.
```

O tipo exato é `AuthenticationTagMismatchException`, que deriva de `CryptographicException` (a documentação diz que ele é lançado a partir do .NET 8; versões anteriores lançavam o tipo base, então `catch (CryptographicException)` cobre os dois). O buffer de saída ficou todo zerado: a documentação diz que o plaintext é limpo quando a tag não pode ser validada, então nenhum dado parcialmente decifrado vaza para quem chamou.

Nonces precisam ser únicos por chave. A documentação de `Encrypt` é direta: "The security guarantees of the AES-GCM algorithm mode require that the same nonce value is never used twice with the same key." GCM é um modo de contador, então chave e nonce determinam o keystream. Verifiquei só o sintoma visível:

```text
same key+nonce+plaintext twice, identical ciphertext: True
```

O mesmo par produziu os mesmos bytes, então um observador descobre que duas mensagens são iguais, e com plaintexts diferentes as garantias documentadas deixam de valer. Use um nonce aleatório novo de 12 bytes por mensagem (ou um contador que você consiga provar que nunca se repete entre reinícios e instâncias) e faça rotação de chaves. Nonce fixo no código ou zerado é o bug clássico.

### Livro vs hoje: os diagnósticos que o compilador mostra

Livros antigos montam criptografia com `new AesManaged()`, `*CryptoServiceProvider` e `new Rfc2898DeriveBytes(...)`. Compilei isso contra `net10.0` (saída do build agrupada por mensagem):

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

O construtor antigo `new Rfc2898DeriveBytes("pw", 16)` ainda rodou com `IterationCount=1000` e `HashAlgorithm=SHA1`: padrões fracos escondidos atrás de um warning. MD5 e SHA-1 não são obsoletos como API (são necessários para interoperabilidade e checksums), então o compilador não impede que você os use para segurança; esse julgamento é seu. No .NET moderno as classes `*Managed` e `*CryptoServiceProvider` são, de qualquer forma, wrappers sobre os algoritmos do sistema operacional, como diz a documentação do modelo de criptografia.

### Aleatoriedade: RandomNumberGenerator, nunca Random

```text
RandomNumberGenerator.GetBytes(16): c60d032768798df7144efe5b0bbbebb1
RandomNumberGenerator.GetInt32(0, 1000000): 393199
GetHexString(32): cfae8efa4fc7cd1813ea0cb1fdcda4b8
GetString: GWYD9ZZPBG
new Random(1234) twice: 857019877 1923929452 / 857019877 1923929452
```

`System.Random` é um gerador com semente: mesma semente, mesma sequência, e ele não foi feito para resistir a previsão. Os métodos estáticos de `RandomNumberGenerator` usam o CSPRNG da plataforma, e `GetInt32`, `GetHexString` e `GetString(choices, length)` cobrem códigos de redefinição e chaves de API sem erros de viés de módulo.

### Tipos pós-quânticos no .NET 10

O .NET 10 adiciona `MLKem` (encapsulamento de chave), `MLDsa` e `SlhDsa` (assinaturas) e `CompositeMLDsa` (ML-DSA combinado com um algoritmo clássico). Verifiquei o suporte e compilei sem nenhum `#pragma`:

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

Duas correções em relação ao que eu esperava. Primeiro, `MLDsa` não é experimental como classe: `IsSupported`, `GenerateKey` e `SignData` compilaram sem diagnóstico; só alguns membros são (`SignPreHash` e a importação e exportação PKCS#8/SPKI/PEM, porque esses formatos vieram de rascunhos), e o mesmo vale para `MLKem`. `SlhDsa` e `CompositeMLDsa` são experimentais como classes inteiras, o que bate com o post do .NET Blog. Segundo, SYSLIB5006 é um erro, não um warning, então o build falha até você adicionar `#pragma warning disable SYSLIB5006` ou `<NoWarn>`. Nada é suportado no macOS: a documentação multiplataforma lista apenas Linux com OpenSSL 3.5.0+ e Windows 11 recente, e Apple sem suporte. Chame `IsSupported` e mantenha um fallback clássico.

### Qual biblioteca fez o trabalho nesta máquina

A documentação multiplataforma diz que o .NET chama a biblioteca de criptografia do sistema operacional (CNG no Windows, OpenSSL no Linux, as bibliotecas da Apple no macOS) em vez de trazer a sua própria, então o suporte e o status FIPS seguem o sistema. Rodei o programa com `DYLD_PRINT_LIBRARIES=1` e filtrei as imagens carregadas:

```text
libSystem.Security.Cryptography.Native.Apple.dylib
CryptoKit
libcommonCrypto.dylib
libcorecrypto.dylib
```

O shim da Apple e o CryptoKit foram carregados, e o shim do OpenSSL (`libSystem.Security.Cryptography.Native.OpenSsl`) não. Isso explica as diferenças acima: só tags de 16 bytes, sem SHA-3, sem pós-quântico. O mesmo código num container Linux usa o OpenSSL da distribuição, então teste lá antes de depender de um algoritmo.

## Trade-offs

- **PBKDF2 é a escolha portátil, não a mais forte.** É embutido e compatível com FIPS, mas não é memory-hard; o OWASP prefere Argon2id, que no .NET exige um pacote de terceiros.
- **Iterações são um orçamento de latência e CPU.** 600.000 iterações custaram cerca de 100 ms de um núcleo por login aqui; um pico de logins vira um pico de CPU, então combine com rate limiting.
- **O padrão do Identity é conservador, mas atualizável.** 100.000 iterações de HMAC-SHA512 no .NET 10; aumente `IterationCount` e os hashes antigos migram no próximo login via `SuccessRehashNeeded`.
- **HMAC vs assinatura.** HMAC é rápido e curto, mas os dois lados podem forjar; uma assinatura exige par de chaves e é maior, mas quem verifica não consegue assinar.
- **AES-GCM é tão seguro quanto o tratamento do nonce.** Um nonce repetido sob a mesma chave quebra as garantias documentadas; nonces aleatórios de 96 bits com rotação de chaves são o caminho simples, e a tag de 16 bytes é o único tamanho que funciona em todo lugar.
- **Primitivas cruas são fáceis de usar errado.** Para proteger seus próprios cookies, tokens e payloads temporários, o Data Protection cuida de chaves, rotação e criptografia autenticada por você; use `AesGcm` quando precisar de um formato que você controla.
- **As diferenças entre plataformas são reais.** SHA-3, tamanhos de tag e os tipos pós-quânticos dependem da biblioteca do sistema (nenhum dos pós-quânticos roda no macOS, e `SlhDsa` e `CompositeMLDsa` quebram o build sem supressão); confira `IsSupported` e teste no sistema em que você faz deploy.

## Documentation Links

- [Cross-platform cryptography in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/security/cross-platform-cryptography) (doc)
- [.NET cryptography model, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/security/cryptography-model) (doc)
- [Rfc2898DeriveBytes.Pbkdf2 Method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.rfc2898derivebytes.pbkdf2?view=net-10.0) (doc)
- [AesGcm Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.aesgcm?view=net-10.0) (doc)
- [Post-Quantum Cryptography in .NET, .NET Blog](https://devblogs.microsoft.com/dotnet/post-quantum-cryptography-in-dotnet/) (doc)
- [Password Storage Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (doc)
