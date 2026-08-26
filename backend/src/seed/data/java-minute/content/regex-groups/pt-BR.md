---
version: 1.0
updatedAt: 2026-08-12
question: O que é um grupo em uma expressão regular?
---
## Question

# O que é um grupo em uma expressão regular?

## Short Answer

Algo bem útil pra analisar strings de caracteres.

## What It Is

Grupos são, na verdade, um recurso das expressões regulares especificado fora do JDK. Um grupo é apenas uma parte da sua expressão regular entre parênteses. Com uma expressão regular assim, você pode analisar uma string de caracteres, casá-la para obter um `Matcher` e, se houver correspondência, pegar os diferentes elementos que você precisa dela.

```java
Pattern pattern = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})");
Matcher matcher = pattern.matcher("Published on 2026-08-12");

if (matcher.find()) {
    String year = matcher.group(1);
    String month = matcher.group(2);
    String day = matcher.group(3);
}
```

## Named Groups

O legal é que você pode dar nomes aos grupos pra deixar seu código mais expressivo. Você especifica o nome de um grupo diretamente na sua expressão regular e, se houver correspondência, pode pegar os valores dos diferentes grupos pelos nomes deles — o que deixa seu código bem mais legível.

```java
Pattern pattern = Pattern.compile(
    "(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})"
);
Matcher matcher = pattern.matcher("Published on 2026-08-12");

if (matcher.find()) {
    String year = matcher.group("year");
    String month = matcher.group("month");
    String day = matcher.group("day");
}
```

## Practical Example

Se o que você procura é a primeira ocorrência de algo em um texto longo, lembre-se que `Matcher` também expõe um stream preguiçoso de correspondências através de `results()`, retornando um `Stream<MatchResult>`.

```java
Pattern pattern = Pattern.compile("(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})");
Matcher matcher = pattern.matcher(longText);

Optional<MatchResult> firstMatch = matcher.results().findFirst();
firstMatch.ifPresent(match -> System.out.println(match.group("year")));
```

## Solution and Conclusion

Grupos permitem recortar uma expressão regular nas partes com as quais você realmente se importa, e grupos nomeados permitem se referir a essas partes pela intenção em vez da posição. Quando você só precisa da primeira correspondência em um texto longo, `Matcher.results()` te dá um `Stream<MatchResult>` preguiçoso, então você pode parar assim que encontrar, em vez de varrer o texto inteiro de antemão.

## References

- [Java Coding Tip #385: What Is a Group in a Regular Expression?](https://www.youtube.com/watch?v=iTRIbbiZBVs) — video
- [Pattern — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
- [Matcher — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Matcher.html) — doc
