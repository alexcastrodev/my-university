---
version: 1.0
updatedAt: 2026-07-31
question: Como pegar o máximo de uma coleção?
---
## Question

# Como pegar o máximo de uma coleção?

## Short Answer

Existem vários padrões pra isso, cada um com trade-offs diferentes. Se você só precisa extrair o máximo sem transformar ou filtrar sua coleção, `Collections.max` é uma boa escolha.

## Collections.max

`Collections.max` é um método de fábrica: você passa sua coleção e, opcionalmente, um `Comparator`, caso seus elementos não sejam naturalmente `Comparable` ou você queira uma ordenação diferente.

```java
List<Integer> numbers = List.of(3, 7, 2, 9, 4);

int max = Collections.max(numbers); // 9
```

Duas coisas pra ficar de olho:

- Se a coleção contiver um elemento `null`, você recebe um `NullPointerException`.
- Se a coleção estiver vazia, você recebe um `NoSuchElementException`.

## Stream.max

O segundo padrão é baseado em streams: chame `.stream()`, depois `.max(...)`, passando um `Comparator`.

```java
List<Integer> numbers = List.of(3, 7, 2, 9, 4);

Optional<Integer> max = numbers.stream().max(Comparator.naturalOrder()); // Optional[9]
```

Assim como `Collections.max`, você recebe um `NullPointerException` se houver um valor `null` no stream. Mas se o stream estiver vazio, você recebe um `Optional` vazio em vez de uma exceção — algo arguivelmente melhor para tratamento de erros, já que quem chama pode decidir como lidar com a ausência de um valor em vez de capturar uma exceção.

## Solution and Conclusion

Cuidado com o padrão de stream: você ainda paga o preço de criar o stream, que é um overhead extra que talvez você queira evitar. A menos que você precise especificamente de recursos de stream (encadear com `filter`, `map`, etc.), o simples `Collections.max` é provavelmente a sua melhor escolha.

## References

- [Java Coding Tip #382: Max of a Collection](https://www.youtube.com/shorts/1XLa9QEMMyI) — video
- [Collections.max — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#max(java.util.Collection,java.util.Comparator)) — doc
- [Stream.max — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#max(java.util.Comparator)) — doc
