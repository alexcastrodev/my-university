---
version: 1.0
updatedAt: 2026-10-16
question: Como obter os bytes de uma String?
---
## Question

# Como obter os bytes de uma String?

## Short Answer

Existe um método para isso: `getBytes()`. Mas ele pode não fazer exatamente o que você imagina.

## Less Short Answer

Uma `String` encapsula um array de bytes, num campo privado chamado `value`. Antes era um array de `char`, mas desde o Java 9 (Compact Strings, JEP 254) é um array de `byte`. A string também tem um campo `coder`, que assume um de dois valores: `LATIN1` (um byte por caractere) ou `UTF16` (dois bytes por caractere).

Então você poderia esperar que `getBytes()` te devolvesse esse array interno. Não devolve. Quando você chama `getBytes()`, os caracteres da string são **codificados** com o charset padrão, e o que você recebe é um array novo com essa codificação.

```java
String s = "Olá";

byte[] utf8   = s.getBytes(StandardCharsets.UTF_8);      // [79, 108, -61, -95]: 4 bytes, "á" ocupa dois
byte[] latin1 = s.getBytes(StandardCharsets.ISO_8859_1); // [79, 108, -31]: 3 bytes
byte[] utf16  = s.getBytes(StandardCharsets.UTF_16);     // 8 bytes: um BOM (FE FF) + 2 bytes por char
```

Mesma string, três arrays de bytes diferentes. Nenhum deles é "os bytes da string": são os bytes da string *numa determinada codificação*.

## Use um Charset Explícito

O `getBytes()` sem argumentos usa `Charset.defaultCharset()`. Se você quer um resultado previsível, passe o charset você mesmo.

```java
byte[] imprevisivel = s.getBytes();                       // depende do charset padrão
byte[] previsivel   = s.getBytes(StandardCharsets.UTF_8); // sempre UTF-8
```

A sobrecarga que recebe um `Charset` também é mais agradável que a que recebe o nome do charset: `getBytes("UTF-8")` lança a exceção checada `UnsupportedEncodingException`, a versão com `Charset` não.

## CharsetEncoder: Quando Você Precisa de Controle

Em vez de `getBytes()`, você também pode usar `charset.newEncoder().encode(...)`. A diferença aparece com caracteres que o charset não consegue representar: `getBytes()` os substitui silenciosamente (por `?` no Latin-1), enquanto um `CharsetEncoder` reporta um erro por padrão.

```java
String s = "€uro";

byte[] comPerda = s.getBytes(StandardCharsets.ISO_8859_1);
System.out.println(new String(comPerda, StandardCharsets.ISO_8859_1)); // ?uro: o € sumiu, sem erro

CharsetEncoder encoder = StandardCharsets.ISO_8859_1.newEncoder();
ByteBuffer buffer = encoder.encode(CharBuffer.wrap(s));
// lança UnmappableCharacterException: você fica sabendo que os dados não cabem
```

Você pode configurar esse comportamento com `onMalformedInput()` e `onUnmappableCharacter()` (`REPORT`, `REPLACE` ou `IGNORE`), e o encoder trabalha com buffers, o que é útil quando você processa grandes volumes de texto em fluxo.

## De Onde Vem o Charset Padrão

Uma última palavra. Se você não definiu o charset padrão, ele é lido do ambiente: historicamente a JVM o obtinha do sistema operacional (o locale e a codificação da plataforma). Então você podia escrever e testar sua aplicação num país, fazer o deploy num ambiente de nuvem em outro país, e obter em produção um charset diferente daquele com que desenvolveu.

Desde o Java 18 (JEP 400), o charset padrão é UTF-8 em todas as plataformas, o que elimina boa parte dessa surpresa. A codificação do sistema operacional continua disponível, exposta na propriedade de sistema `native.encoding`, e você pode recuperar o comportamento antigo com `-Dfile.encoding=COMPAT`.

```java
System.out.println(Charset.defaultCharset());              // UTF-8 no Java 18+
System.out.println(System.getProperty("native.encoding")); // ex.: Cp1252 numa máquina Windows
```

Então o conselho vale para qualquer versão: se os bytes importam (arquivos, rede, hashing, assinaturas), sempre nomeie o charset.

## One Last Word

Algo de que você precisa estar ciente!

## References

- [Java Coding Tip #404: How Can You Get the Bytes of a String?](https://www.youtube.com/shorts/eHcph5zC-SQ) (video)
- [String.getBytes(Charset) (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#getBytes(java.nio.charset.Charset)) (doc)
- [CharsetEncoder (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/CharsetEncoder.html) (doc)
- [JEP 254: Compact Strings](https://openjdk.org/jeps/254) (doc)
- [JEP 400: UTF-8 by Default](https://openjdk.org/jeps/400) (doc)
