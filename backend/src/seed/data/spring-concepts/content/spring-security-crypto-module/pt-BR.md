---
version: 1.0
updatedAt: 2026-08-01
title: Módulo Crypto do Spring Security: Geradores de Chave e Encryptors
---
## Objective

Criptografia, descriptografia e geração de chaves não são oferecidas de forma
conveniente pela linguagem Java diretamente. O Spring Security Crypto Module
(SSCM) — o mesmo módulo sobre o qual as implementações de `PasswordEncoder`
são construídas — também expõe dois utilitários independentes para qualquer
código que precise de criptografia: geradores de chave para produzir
salts/chaves, e encryptors para criptografar e descriptografar dados, tudo
sem adicionar uma dependência de criptografia separada ao projeto.

## Use Cases

- Gerar um valor de salt aleatório para alimentar um algoritmo de hash ou
  criptografia.
- Criptografar um valor antes de persisti-lo (um segredo de API, um token) e
  descriptografá-lo de volta quando for lido.
- Criptografar um valor que também precisa ser buscado depois pela sua forma
  criptografada — por exemplo, procurar uma linha por uma API key
  criptografada — algo que um encryptor normal (randomizado) não consegue
  suportar.

## Deep Dive

### Geradores de chave: `StringKeyGenerator` e `BytesKeyGenerator`

Dois contratos cobrem os dois formatos que uma chave gerada pode assumir,
ambos construídos via a factory `KeyGenerators`:

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

`KeyGenerators.shared(int length)` é o caso fora da curva: diferente de
`secureRandom()`, ele retorna o *mesmo* valor de chave a cada chamada de
`generateKey()` — útil quando uma chave/IV fixa precisa ser reutilizada em
vez de randomizada a cada vez.

### Encryptors: `BytesEncryptor` e `TextEncryptor`

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

`TextEncryptor` trabalha com strings na entrada e na saída; `BytesEncryptor`
trabalha com `byte[]` cru. Ambos precisam de uma senha e um salt para serem
construídos:

```java
String salt = KeyGenerators.string().generateKey();
String password = "secret";

BytesEncryptor e = Encryptors.standard(password, salt);
byte[] encrypted = e.encrypt("HELLO".getBytes());
byte[] decrypted = e.decrypt(encrypted);
```

### Standard vs. stronger: a mesma chave AES de 256 bits, um modo diferente

```java
BytesEncryptor standard = Encryptors.standard(password, salt);  // AES/CBC
BytesEncryptor stronger = Encryptors.stronger(password, salt);  // AES/GCM
```

Ambos derivam uma chave AES de 256 bits a partir da senha/salt via PBKDF2; a
diferença é o modo de cifra de bloco — `standard()` usa CBC, `stronger()` usa
GCM (um modo autenticado, considerado a escolha mais forte).
`Encryptors.text(...)` é o `TextEncryptor` construído sobre `standard()`;
`Encryptors.delux(...)` é o `TextEncryptor` construído sobre `stronger()`.

### Texto pesquisável: trocando aleatoriedade por buscas

```java
String salt = KeyGenerators.string().generateKey();
String password = "secret";
String value = "HELLO";

TextEncryptor e = Encryptors.queryableText(password, salt);
String encrypted1 = e.encrypt(value);
String encrypted2 = e.encrypt(value);
// encrypted1 == encrypted2
```

`Encryptors.text()`/`.delux()` randomizam o vetor de inicialização a cada
chamada, então criptografar o mesmo texto puro duas vezes produz dois
ciphertexts diferentes — normalmente desejável, mas impossibilita um `WHERE
encrypted_column = ?`. `queryableText()` fixa o IV em vez de randomizá-lo,
então a mesma entrada sempre criptografa para a mesma saída — o único caso
onde um encryptor *menos* aleatório é a escolha correta.
`Encryptors.noOpText()` completa a factory com um `TextEncryptor` pass-through
(`encrypt()` retorna a entrada sem alteração) para demos/testes onde a
criptografia só acrescentaria ruído.

## Trade-offs

- **`queryableText()` é uma exceção deliberada e específica, não uma
  recomendação geral.** Fixar o IV torna as buscas possíveis, mas vaza se
  dois valores criptografados são iguais — recorra a ele só quando um valor
  genuinamente precisar ser buscado pela sua forma criptografada (um client
  secret OAuth usado como chave de busca é o próprio exemplo do livro); use
  `text()`/`delux()` como padrão nos outros casos.
- **`stronger()`/`delux()` custam um pouco mais que `standard()`/`text()` por
  um ganho real de segurança** — GCM é um modo de criptografia autenticada
  (também detecta adulteração), não é só "a mesma criptografia feita mais
  forte." Prefira as variantes baseadas em GCM em código novo, a menos que
  haja um motivo específico de compatibilidade para não fazer isso.
- **Book vs. today:** a API desta seção e seu enquadramento AES-256/CBC-vs-GCM
  seguem inalterados no Spring Security atual — `Encryptors.standard()`/
  `stronger()` ainda descrevem a mesma divisão CBC/GCM, confirmado pela
  referência oficial atual. Nada aqui envelheceu; é uma das raras seções "ainda
  exatamente precisas" de um livro de Spring Security de 2020.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 4, "Dealing with passwords", section 4.2, "More about the Spring Security Crypto module", p. 97-101 — doc
- [Spring Security Reference — Spring Security Crypto Module](https://docs.spring.io/spring-security/reference/features/integrations/cryptography.html) — doc
- [Spring Security API — KeyGenerators](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/keygen/KeyGenerators.html) — doc
- [Spring Security API — Encryptors](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/encrypt/Encryptors.html) — doc
