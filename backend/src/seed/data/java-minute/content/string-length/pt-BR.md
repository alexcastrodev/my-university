---
version: 1.0
updatedAt: 2026-07-21
question: Como obter o número de caracteres de uma String?
---
## Question

# Como obter o número de caracteres de uma String?

## Short Answer

É mais difícil do que parece. A resposta depende do que você chama de "caractere" — o método `length()` retorna o número de **unidades de código Unicode**, o que nem sempre é o mesmo que o número de caracteres que você realmente vê na tela.

## What It Is

O método `length()` de `String` retorna o número de unidades de código Unicode na string. Uma unidade de código é um valor de 16 bits — o tipo usado internamente para armazenar valores `char` em Java.

Para a maior parte do texto do dia a dia, uma unidade de código corresponde a exatamente um caractere visível, então `length()` se comporta como você esperaria.

## The Surrogate Pair Problem

Alguns caracteres Unicode — como muitos emojis e caracteres de determinadas escritas históricas ou simbólicas — não cabem em uma única unidade de código de 16 bits. Eles precisam de **duas ou mais unidades de código** para serem representados, um par conhecido como **par substituto (surrogate pair)**.

Quando isso acontece, `length()` deixa de corresponder ao número de caracteres exibidos visualmente na tela: ele conta unidades de código, não "caracteres" no sentido do dia a dia.

## Code Unit vs Code Point

Dois conceitos são essenciais aqui:

- **Unidade de código (code unit)**: corresponde ao tipo `char` em Java. É um pedaço de 16 bits da codificação de um caractere, e é o que `length()` de fato conta.
- **Ponto de código (code point)**: corresponde ao tipo `int` em Java. Representa o caractere real e completo — embora nem todo valor `int` seja um ponto de código válido.

Um ponto de código pode ser composto por uma ou duas unidades de código, dependendo do caractere.

## Practical Example

```java
String text = "a😀b"; // "a" + 😀 (emoji de rosto sorridente) + "b"

System.out.println(text.length());        // 4 — conta unidades de código
System.out.println(text.codePointCount(0, text.length())); // 3 — conta pontos de código
```

O emoji 😀 é codificado como um par substituto, então consome duas unidades de código — mas ainda é apenas um caractere visível.

## Solution and Conclusion

Se você precisa do número real de caracteres percebidos por um usuário, não confie apenas em `length()`. Use `codePointCount()` para contar pontos de código Unicode, e prefira iteração consciente de pontos de código (como `codePoints()`) ao processar strings que possam conter caracteres fora do intervalo básico de 16 bits.

## References

- [Java Coding Tip #378: String Length](https://www.youtube.com/shorts/7al_ZQn99CY) — video
- [String.length() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#length()) — doc
- [Character — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html) — doc
