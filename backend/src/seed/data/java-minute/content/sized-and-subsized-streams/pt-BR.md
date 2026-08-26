---
version: 1.0
updatedAt: 2026-07-23
question: O que é um stream subsized?
---
## Question

# O que é um stream subsized?

## Short Answer

Um stream subsized é um bom candidato para execução paralela. Ser **sized** significa que o stream já sabe quantos elementos vai processar; ser **subsized** significa que, se você dividir o stream em substreams, cada substream também sabe sua própria contagem de elementos.

## What It Is

Um stream é **sized** quando seu tamanho é conhecido de antemão, sem consumi-lo — por exemplo, um stream aberto sobre qualquer coleção é sized, já que você pode simplesmente chamar `size()` na coleção.

Um stream é **subsized** quando dividi-lo produz substreams que são, eles mesmos, sized. Nem todo stream sized é subsized: isso depende inteiramente de como a estrutura de dados subjacente se divide.

## Lists vs. Sets

`List` te dá streams subsized: se você dividir uma lista em duas sublistas, você sabe exatamente quantos elementos caíram em cada uma.

`Set` não. Dividir um set significa dividir seu array interno, e não há garantia de como os elementos vão cair entre as duas metades. No pior caso, uma metade pode acabar com zero elementos e a outra com todos eles — uma divisão completamente desbalanceada.

## Why It Matters

Dividir uma fonte de dados é exatamente o que streams paralelos fazem internamente: eles dividem a fonte em pedaços e processam cada pedaço em uma thread diferente. Se uma fonte não pode ser dividida de forma equilibrada — como um `Set` — um stream paralelo sobre ela pode acabar com um trabalho muito desbalanceado, onde uma thread faz quase tudo enquanto as outras ficam ociosas.

## Practical Example

```java
List<Integer> list = List.of(1, 2, 3, 4, 5, 6);
Set<Integer> set = Set.of(1, 2, 3, 4, 5, 6);

list.stream().spliterator().hasCharacteristics(Spliterator.SUBSIZED); // true
set.stream().spliterator().hasCharacteristics(Spliterator.SUBSIZED);  // false
```

O spliterator de uma `List` reporta `SUBSIZED`; o de um `Set` não, já que seu array interno não pode ser dividido de forma previsível.

## Solution and Conclusion

Não recorra a um stream paralelo sobre uma fonte que não é facilmente divisível — um `HashSet`, por exemplo, é um candidato ruim. E mesmo quando uma fonte é subsized, como uma `List`, pense duas vezes antes de paralelizar: o overhead de dividir e coordenar threads pode facilmente superar o benefício, e um stream paralelo pode acabar prejudicando a performance em vez de melhorá-la.

## References

- [Java Coding Tip #377: Sized and Subsized Streams](https://www.youtube.com/shorts/WLsaE5eC9k8) — video
- [Spliterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html) — doc
- [Spliterator.SUBSIZED — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html#SUBSIZED) — doc
