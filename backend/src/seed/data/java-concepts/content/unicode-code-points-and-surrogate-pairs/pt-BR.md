---
version: 1.0
updatedAt: 2026-08-21
title: Pontos de Código Unicode e Pares Substitutos em String
summary: String armazena texto como unidades de código UTF-16 de 16 bits, então caracteres fora do Plano Multilíngue Básico, como a maioria dos emojis, precisam de um par substituto (surrogate pair) de dois caracteres para representar um único ponto de código Unicode.
---
## Objective

Uma `String` é internamente uma sequência de `char`, e cada `char` é uma **unidade de código UTF-16** de 16 bits — não um "caractere" no sentido do dia a dia. A maioria dos caracteres que as pessoas digitam todos os dias (letras latinas, dígitos, a maior parte da pontuação, a maioria dos ideogramas CJK) vive no **Plano Multilíngue Básico (BMP)**, os primeiros 65.536 pontos de código Unicode, e cada um deles cabe em exatamente um `char`. Mas o Unicode tem muito mais que 65.536 pontos de código atribuídos — a maioria dos emojis modernos, alguns ideogramas CJK das extensões B+ e vários símbolos matemáticos/musicais vivem nos **planos suplementares**, acima de `U+FFFF`. Um `char` não consegue conter um desses sozinho, então o Java o representa como um **par substituto** (*surrogate pair*): dois `char`s consecutivos — um *high surrogate* em `U+D800`–`U+DBFF` seguido de um *low surrogate* em `U+DC00`–`U+DFFF` — que juntos codificam um único **ponto de código** (*code point*) Unicode. Toda API de `String` que opera "por índice" (`length()`, `charAt()`, `substring()`) está contando e fatiando unidades de código, não pontos de código, e essa incompatibilidade é a origem de uma categoria inteira de bugs assim que caracteres suplementares entram em cena.

## Use Cases

- Contar quantos "caracteres" um usuário realmente digitou (ex.: um campo de bio com limite de tamanho) quando a entrada pode conter emojis — contar `char`s superestima cada caractere suplementar como 2.
- Truncar uma string para um tamanho fixo, para exibição ou armazenamento, sem nunca cortar um par substituto ao meio, o que deixaria um surrogate isolado e sem par na borda.
- Escrever processamento de string correto e ciente de grafemas (busca, inversão, capitalizar a primeira letra) que não trate metade de um par substituto como se fosse um caractere independente.
- Depurar por que uma string que "parece ter 3 caracteres" reporta `length() == 5`, ou por que renderizar uma string caractere a caractere corrompe emojis em glifos de caractere de substituição (`�`).
- Construir ou fazer parsing de formatos de texto onde um `char[]` é serializado — um surrogate sem par numa borda de truncamento é UTF-16 inválido e pode quebrar decodificadores downstream.

## Deep Dive

### Unidades de código vs. pontos de código: um `char` geralmente é suficiente, mas nem sempre

```java
String bmp = "A";                       // U+0041 — fits in one char, one code unit
System.out.println(bmp.length());       // 1
System.out.println(bmp.codePointAt(0)); // 65 (0x41)

String emoji = "😀";                    // U+1F600 GRINNING FACE — outside the BMP
System.out.println(emoji.length());        // 2 — two chars (a surrogate pair)
System.out.println(emoji.codePointAt(0));   // 128512 (0x1F600) — one code point
System.out.println(emoji.codePointCount(0, emoji.length())); // 1 — one visible character
```

`"😀"` é armazenado como exatamente dois `char`s no array subjacente, mas é um ponto de código Unicode e um glifo visível. `length()` reporta o número de `char`s (2), enquanto `codePointCount()` reporta o número de pontos de código Unicode reais (1) — esses dois números só coincidem enquanto todo caractere na string estiver no BMP.

### `length()` conta unidades de código, não o que você vê na tela

```java
String s = "Hi😀!";
System.out.println(s.length());              // 5 — 'H','i', high-surrogate, low-surrogate, '!'
System.out.println(s.codePointCount(0, s.length())); // 4 — H, i, 😀, !
```

Qualquer código que trate `String.length()` como "número de caracteres" superestima silenciosamente em um para cada caractere suplementar presente. Isso costuma ser invisível durante os testes (a maioria das strings de teste é ASCII) e só aparece quando emojis de verdade ou entradas CJK estendidas chegam ao código — um caso clássico de código que "funciona" até encontrar dados fora do BMP.

### `charAt(int)` pode devolver metade de um caractere

```java
String s = "Hi😀!";
char c2 = s.charAt(2);   // the high surrogate of 😀 — not a printable character on its own
char c3 = s.charAt(3);   // the low surrogate of 😀

System.out.println(Character.isHighSurrogate(c2)); // true
System.out.println(Character.isLowSurrogate(c3));   // true
System.out.println(c2);                              // prints a lone surrogate — garbled/invalid on its own
```

`charAt(2)` é uma chamada perfeitamente legal — ela retorna *um* `char` — mas esse `char` não é um caractere autocontido. Qualquer esquema de indexação construído sobre `charAt`/`substring` que não seja ciente de surrogates pode cair exatamente entre as duas metades de um par, produzindo um fragmento que não tem sentido (e, se escrito como UTF-16, é inválido) por si só.

### Iterando corretamente: `codePointAt`, `codePointCount`, `codePoints()`

```java
String s = "a😀b";

// WRONG: char-by-char iteration splits the emoji into two meaningless halves
for (int i = 0; i < s.length(); i++) {
    System.out.print(s.charAt(i) + "|");
}
// prints: a|?|?|b|  (the two surrogate halves, not a single 😀)

// CORRECT: advance by code point, using Character.charCount to know how many
// chars this code point occupied (1 for BMP, 2 for supplementary)
for (int i = 0; i < s.length(); ) {
    int cp = s.codePointAt(i);
    System.out.print(new String(Character.toChars(cp)) + "|");
    i += Character.charCount(cp);
}
// prints: a|😀|b|

// CORRECT (Java 8+): codePoints() stream does the same advancing internally
s.codePoints().forEach(cp -> System.out.print(new String(Character.toChars(cp)) + "|"));
// prints: a|😀|b|
```

`codePointAt(int index)` retorna o ponto de código completo a partir de `index` (combinando transparentemente um par substituto quando presente), e `Character.charCount(int codePoint)` diz se você deve avançar o índice em 1 ou em 2. O stream `codePoints()` (adicionado no Java 8) faz exatamente isso internamente e retorna um `IntStream` de pontos de código — é a forma correta mais simples de processar uma string um *caractere* de cada vez quando caracteres suplementares são possíveis.

### Construindo um caractere suplementar manualmente: `Character.toChars`

```java
int codePoint = 0x1F600; // 😀, verified: U+1F600 GRINNING FACE
char[] chars = Character.toChars(codePoint);

System.out.println(chars.length);                 // 2
System.out.println(Character.isHighSurrogate(chars[0])); // true
System.out.println(Character.isLowSurrogate(chars[1]));  // true
System.out.println(new String(chars));             // 😀

// The reverse: recombining a known surrogate pair back into a code point
int recombined = Character.toCodePoint(chars[0], chars[1]);
System.out.println(recombined == codePoint); // true
```

`Character.toChars(int codePoint)` é a ferramenta de baixo nível para construir o `char[]` de um único ponto de código, produzindo um `char` para um ponto de código do BMP ou dois (um par substituto corretamente formado) para um suplementar — a mesma conversão que `codePoints()` e literais de string fazem implicitamente. `Character.toCodePoint(char high, char low)` é o inverso, combinando um par substituto conhecido de volta em seu ponto de código.

## Trade-offs

- **`length()`/`charAt()`/`substring()` são O(1) ou próximo disso e corretos para texto puramente BMP**, o que cobre a grande maioria das strings do dia a dia — mas ficam silenciosamente errados no momento em que uma string pode conter emojis ou outros caracteres suplementares, e nada no sistema de tipos sinaliza a incompatibilidade.
- **Processamento ciente de pontos de código (`codePoints()`, `codePointAt` + `charCount`) é correto em geral, mas é O(n) para escanear e um pouco mais de código em cada ponto de uso** — vale a pena recorrer a ele especificamente quando a origem da string é entrada de usuário não confiável/internacional (bios, mensagens de chat, campos de texto livre), não como substituição geral de toda operação de `String` no código.
- **Um `substring(0, n)` ingênuo pode partir um par substituto**, deixando um surrogate isolado e sem par na borda — válido de manter em uma `String` Java (que não valida a boa formação do UTF-16), mas UTF-16 inválido uma vez serializado, e provavelmente vai renderizar como `�` downstream.
  ```java
  String s = "😀".substring(0, 1); // legal in Java, but s is now one unpaired high surrogate
  ```
- **`Character.isHighSurrogate`/`isLowSurrogate` precisam ser checados explicitamente** — o compilador e o tipo `char` não dão nenhuma indicação de que um valor `char` é só metade de algo; cabe ao código detectar e tratar isso sempre que estiver trabalhando no nível de `char`.
- **Isso é ortogonal ao pooling/interning de strings** (veja o conceito relacionado sobre o pool de `String`) — a representação em unidades de código vs. pontos de código é sobre como o *conteúdo* é organizado na memória, enquanto interning é sobre se *instâncias com conteúdo igual* compartilham um objeto. Uma string com caractere suplementar faz pool e interning exatamente como qualquer outra `String`.

## Documentation Links

- [Character — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html) — doc
- [String — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html) — doc
