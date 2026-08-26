---
version: 1.0
updatedAt: 2026-08-21
title: "Criptografia em Java: MessageDigest, Cipher e KeyStore"
summary: "Cobre a arquitetura de providers JCA/JCE e o uso correto de MessageDigest, SecureRandom, Cipher, Signature e KeyStore, incluindo por que hashing simples e Random são substitutos inseguros para hashing de senhas e geração de tokens seguros."
---
## Objective

O JDK não embute uma única implementação de criptografia fixa em `Cipher` ou
`MessageDigest` — ele fornece uma arquitetura, a Java Cryptography
Architecture (JCA) e sua extensão de criptografia (JCE), onde todo algoritmo
é pedido pelo nome (`"SHA-256"`, `"AES/GCM/NoPadding"`) e resolvido em
runtime contra uma lista de providers plugáveis. Uma vez entendida essa
indireção, o resto de `java.security`/`javax.crypto` é um pequeno conjunto de
tarefas bem definidas — fazer hash de uma mensagem, gerar aleatoriedade com
segurança, criptografar/descriptografar, assinar/verificar, armazenar chaves
— cada uma com uma API correta e vários atalhos tentadores-mas-errados
(`Random` em vez de `SecureRandom`, ECB em vez de GCM, um hash simples em vez
de um esquema de hashing de senha) que este conceito existe para sinalizar
explicitamente.

## Use Cases

- Verificar integridade de arquivo/mensagem ou fazer content-addressing de
  dados (estilo Git) com `MessageDigest` e SHA-256/SHA-3.
- Gerar tokens de sessão, nonces ou chaves criptográficas, e saber por que
  `java.util.Random` é a ferramenta errada para qualquer um deles.
- Criptografar dados em repouso ou em trânsito com `Cipher`, e escolher um
  modo (GCM) que também detecta adulteração em vez de um (ECB/CBC sem MAC)
  que não detecta.
- Assinar dados (ex.: um arquivo de licença, um payload de webhook) com um
  par de chaves assimétricas via `Signature`, para que um terceiro consiga
  verificar autenticidade sem ter a chave privada.
- Carregar e consultar um `KeyStore` (PKCS12) para recuperar uma chave
  privada ou um certificado confiável na inicialização da aplicação, em vez
  de distribuir material de chave como arquivos brutos.
- Inspecionar quais providers criptográficos estão instalados e o que eles
  suportam, ao diagnosticar um `NoSuchAlgorithmException` ou auditar o que um
  deployment de fato tem disponível.

## Deep Dive

### A arquitetura de providers: JCA/JCE

Toda classe de engine criptográfica em `java.security`/`javax.crypto`
(`MessageDigest`, `Cipher`, `Signature`, `KeyStore`, `KeyPairGenerator`,
`SecureRandom`, ...) é uma *engine class*: chamar
`MessageDigest.getInstance("SHA-256")` não roda código SHA-256 escrito à mão
dentro de `MessageDigest` — ela pede à JCA para encontrar um `Provider`
registrado que implemente uma SPI de `MessageDigest` para `"SHA-256"` e
retorna um wrapper em torno da implementação desse provider. É por isso que
a mesma chamada pode se comportar de forma diferente entre vendors ou
configurações de JVM: o nome do algoritmo é um contrato, a implementação é
trocável.

```java
import java.security.Provider;
import java.security.Security;

for (Provider provider : Security.getProviders()) {
    System.out.println(provider.getName() + " v" + provider.getVersionStr());
}
```

Numa build padrão do OpenJDK, isso tipicamente lista providers como `SUN`,
`SunRsaSign`, `SunJCE` e `SunEC` — os próprios providers padrão do JDK,
registrados na configuração `java.security` e consultados em ordem até que
um satisfaça o pedido. Pedir um algoritmo que nenhum provider instalado
implementa lança uma exceção checked em vez de falhar silenciosamente:

```java
try {
    MessageDigest.getInstance("MD2-BOGUS");
} catch (NoSuchAlgorithmException e) {
    System.out.println("No provider supplies this algorithm: " + e.getMessage());
}
```

Um provider específico também pode ser pedido explicitamente
(`getInstance("AES", "SunJCE")`), mas para código de aplicação comum a ordem
de busca padrão de providers é quase sempre a escolha certa — fixar um
provider pelo nome acopla o código a quaisquer providers que estejam
instalados numa dada JVM.

### `MessageDigest`: hashing, e por que não é armazenamento de senha

`MessageDigest` produz um digest de tamanho fixo a partir de uma entrada
arbitrária — a mesma entrada sempre produz a mesma saída, e recuperar a
entrada a partir do digest deve ser computacionalmente inviável.

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

`SHA3-256` está disponível da mesma forma
(`MessageDigest.getInstance("SHA3-256")`) como uma alternativa
estruturalmente diferente e padronizada à família SHA-2. `digest()` também
tem uma forma incremental via chamadas repetidas a `update(byte[])` para
processar entradas grandes em stream sem manter a mensagem inteira em
memória.

A limitação crítica: um hash criptográfico simples é deliberadamente
*rápido* e determinístico, o que é exatamente errado para armazenar senhas.
Fazer hash da mesma senha duas vezes com `SHA-256` sempre produz o mesmo
digest, então senhas idênticas produzem valores armazenados idênticos
(revelando quais contas compartilham uma senha), e a velocidade que torna o
SHA-256 bom para checagens de integridade é o que permite que um atacante de
posse do digest faça brute-force ou use rainbow table nele a bilhões de
tentativas por segundo em hardware comum.

```java
MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
byte[] a = sha256.digest("Password123!".getBytes(StandardCharsets.UTF_8));
byte[] b = sha256.digest("Password123!".getBytes(StandardCharsets.UTF_8));
System.out.println(java.util.Arrays.equals(a, b)); // true — no salt, nothing slows this down
```

O armazenamento correto de senha precisa de um algoritmo salgado,
deliberadamente *lento*, memory-hard e adaptativo (as famílias conhecidas
são bcrypt, scrypt e Argon2, e o JDK também fornece PBKDF2 via
`javax.crypto.SecretKeyFactory` como uma opção nativa da JCA com contagem de
iterações ajustável). `java.security.MessageDigest` sozinho não fornece nada
disso — nenhum salting embutido, nenhum fator de trabalho configurável —
então recorrer a `SHA-256` num campo de senha é um mau uso comum e sério de
uma API que, de resto, está correta.

### `SecureRandom` vs `java.util.Random`

`java.util.Random` é um PRNG congruencial linear: rápido, bem distribuído
para simulações e jogos, e *completamente previsível* uma vez que um
atacante recupera saídas consecutivas suficientes, porque a seed interna
pode ser reconstruída a partir delas. `SecureRandom`, em vez disso, extrai
de uma fonte criptograficamente forte (apoiada no pool de entropia do SO ou
num algoritmo DRBG certificado) especificamente projetada para que observar
saídas passadas não revele nada sobre saídas futuras.

```java
import java.security.SecureRandom;

SecureRandom secureRandom = new SecureRandom();
byte[] tokenBytes = new byte[16];
secureRandom.nextBytes(tokenBytes);
String sessionToken = HexFormat.of().formatHex(tokenBytes);
```

O modo de falha concreto: usar como seed do `java.util.Random` o horário
atual (um padrão comum, mas falho, para geração "rápida" de tokens) faz o
espaço de saída colapsar para o que quer que a faixa da seed cubra.

```java
Random weak = new Random(System.currentTimeMillis());
long guess1 = weak.nextLong(); // an attacker who brackets the request time
long guess2 = weak.nextLong(); // can enumerate every possible seed and reproduce this sequence
```

Como `System.currentTimeMillis()` no momento de uma requisição é uma faixa
estreita e adivinhável (precisão de milissegundo, aproximável dentro de
segundos), um atacante que suspeite desse padrão consegue fazer brute-force
da seed e regenerar o token de sessão "aleatório" exato — é precisamente por
isso que identificadores de sessão, tokens de reset de senha e chaves
criptográficas precisam vir de `SecureRandom`, nunca de `Random`.

### `Cipher`: criptografia simétrica, e por que o modo importa

`Cipher` faz o trabalho real de criptografar/descriptografar, configurado por
uma string de transformação no formato `"algoritmo/modo/padding"`. Para AES,
o modo não é um detalhe menor — ele muda as propriedades de segurança do
ciphertext.

O AES em modo **GCM** é um modo de criptografia autenticada: produz
ciphertext mais uma tag de autenticação, então adulterar o ciphertext faz a
descriptografia falhar ruidosamente em vez de retornar plaintext corrompido
silenciosamente.

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

O AES em modo **ECB**, em contraste, criptografa cada bloco de tamanho fixo
independentemente, sem encadeamento e sem tag de autenticação. Blocos de
plaintext idênticos sempre produzem blocos de ciphertext idênticos, o que
vaza informação estrutural sobre o plaintext — a ilustração clássica é que
criptografar uma imagem em ECB ainda mostra o contorno da imagem original,
porque regiões repetidas de pixels mapeiam para blocos de ciphertext
repetidos. Esse é um fato amplamente e há muito estabelecido sobre o design
de modos de cifra de bloco, não um defeito específico de vendor, e é por
isso que `"AES/ECB/PKCS5Padding"` deve ser tratado como inadequado para
criptografar qualquer dado com estrutura repetitiva:

```java
Cipher ecb = Cipher.getInstance("AES/ECB/PKCS5Padding");
ecb.init(Cipher.ENCRYPT_MODE, key);
byte[] blockA = ecb.doFinal("SAME_16_BYTES!!!".getBytes(StandardCharsets.UTF_8));
byte[] blockB = ecb.doFinal("SAME_16_BYTES!!!".getBytes(StandardCharsets.UTF_8));
System.out.println(java.util.Arrays.equals(blockA, blockB)); // true — identical input, identical output, every time
```

Modos encadeados mais antigos como CBC corrigem o problema de "blocos
idênticos parecem idênticos" com um IV, mas ainda assim não fornecem
autenticação por conta própria — um bit invertido em ciphertext CBC produz
um plaintext alterado de forma previsível na descriptografia em vez de uma
falha, a menos que um MAC separado seja adicionado. A tag de autenticação
embutida do GCM é por isso que ele é o padrão geralmente recomendado para
código novo em vez de ECB ou CBC não autenticado.

### `KeyPairGenerator` e `Signature`: assinatura e verificação assimétricas

Assinaturas digitais permitem que quem possui uma chave privada prove
autoria de dados, e que qualquer um que possua apenas a chave pública
correspondente a verifique, sem nunca expor a chave privada.

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

A mesma forma de `Signature` funciona para chaves de curva elíptica,
tipicamente com um tamanho de chave menor para força equivalente:

```java
KeyPairGenerator ecGenerator = KeyPairGenerator.getInstance("EC");
ecGenerator.initialize(256); // NIST P-256 curve, roughly comparable strength to 3072-bit RSA
KeyPair ecKeyPair = ecGenerator.generateKeyPair();

Signature ecSigner = Signature.getInstance("SHA256withECDSA");
ecSigner.initSign(ecKeyPair.getPrivate());
```

Se até um único byte dos dados assinados mudar entre a assinatura e a
verificação, `verify()` retorna `false` em vez de lançar exceção — quem
chama precisa checar o booleano, não assumir que a ausência de exceção
significa que a assinatura se manteve válida.

### `KeyStore`: armazenando chaves e certificados

Distribuir uma chave privada como um arquivo solto ao lado do código da
aplicação é frágil e difícil de proteger; `KeyStore` fornece um único
container protegido por senha para chaves privadas e certificados, mais
comumente no formato PKCS12 (`.p12`/`.pfx`), que é o tipo de keystore padrão
desde o JDK 9.

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

Criar uma entrada programaticamente e salvar o store de volta segue o mesmo
objeto:

```java
KeyStore newStore = KeyStore.getInstance("PKCS12");
newStore.load(null, null); // start empty, no existing file to load
newStore.setKeyEntry("my-alias", keyPair.getPrivate(), storePassword,
        new java.security.cert.Certificate[] { selfSignedCertificate });

try (var out = new java.io.FileOutputStream("app-keystore.p12")) {
    newStore.store(out, storePassword);
}
```

Um keystore com senha errada ou corrompido falha em `load()` com uma
`IOException` (frequentemente envolvendo uma falha de checagem de
integridade), que é o ponto em que a maioria dos bugs de manipulação de
keystore aparece na prática.

Gerenciamento de credenciais e segredos em nível de framework (por exemplo,
as abstrações de autenticação e codificação de senha do Spring Security)
constrói sobre essas primitivas, mas está fora de escopo aqui — este
conceito cobre apenas a camada `java.security`/`javax.crypto` nativa do JDK
por baixo.

## Trade-offs

- **A arquitetura de providers é flexível mas torna a disponibilidade de
  algoritmo um fato do ambiente, não uma garantia da linguagem** —
  `getInstance("SHA3-256")` funciona onde quer que um provider o registre
  (os providers padrão do JDK registram), mas código que assume que um
  algoritmo específico está sempre presente ainda deveria capturar
  `NoSuchAlgorithmException` em vez de tratá-la como inalcançável.
- **`MessageDigest` está correto para integridade/content-addressing e
  errado para armazenamento de senha**, e o JDK não vem com um algoritmo
  adaptativo de hashing de senha pronto para uso (bcrypt/scrypt/Argon2) —
  `SecretKeyFactory` com PBKDF2 é a opção nativa da JCA com uma contagem de
  iterações ajustável, mas recorrer a um `MessageDigest.getInstance("SHA-256")`
  simples num campo de senha descarta silenciosamente salting e custo
  adaptativo por completo.
- **`SecureRandom` é mais lento e consome mais recursos que
  `java.util.Random`**, porque extrai de uma fonte de entropia genuína em
  vez de uma recorrência aritmética barata — esse custo é o preço da
  imprevisibilidade e é inegociável para tokens, chaves e nonces.
- **GCM exige disciplina estrita de IV que ECB e CBC não exigem** — reusar o
  mesmo par chave/IV para duas criptografias GCM diferentes quebra
  catastroficamente suas garantias de confidencialidade, então quem chama
  precisa gerar um IV aleatório novo (tipicamente via `SecureRandom`) toda
  vez, nunca um valor fixo ou reutilizado por contador de forma descuidada
  entre chamadas.
- **Chaves RSA maiores e operações de keystore PKCS12 têm custo real de
  CPU**, então geração de chave e assinatura geralmente são feitas uma vez e
  cacheadas/persistidas em vez de repetidas por requisição — gerar um
  `KeyPair` de 2048 bits dentro de um caminho de requisição quente é um erro
  de performance comum e evitável.
- **O tratamento de senha do `KeyStore` significa que a própria senha
  precisa viver em algum lugar** (variável de ambiente, secrets manager,
  HSM) — um arquivo `KeyStore` só protege as chaves dentro dele tão bem
  quanto sua senha estiver protegida, então hardcodar essa senha ao lado do
  arquivo `.p12` anula o propósito de usar um keystore.

## Documentation Links

- [MessageDigest — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html) — doc
- [Cipher — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/crypto/Cipher.html) — doc
- [SecureRandom — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/SecureRandom.html) — doc
- [Signature — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/Signature.html) — doc
- [KeyStore — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/KeyStore.html) — doc
- [KeyPairGenerator — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/KeyPairGenerator.html) — doc
- [Java Cryptography Architecture (JCA) Reference Guide — Oracle](https://docs.oracle.com/en/java/javase/25/security/java-cryptography-architecture-jca-reference-guide.html) — doc
