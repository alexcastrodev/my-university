---
version: 1.0
updatedAt: 2026-07-24
question: Como buscar um elemento em uma lista?
---
## Question

# Como buscar um elemento em uma lista?

## Short Answer

Existe um padrão muito bom pra isso: `Collections.binarySearch`, que busca em uma lista ordenada em tempo logarítmico em vez de percorrê-la linearmente.

## What It Is

Claro, você pode chamar `list.contains(...)`, que diz se o objeto que você passou está presente, ou `list.indexOf(...)`, que te dá o primeiro índice desse objeto. Os dois métodos são lentos porque percorrem cada elemento da lista um por um — com muitos elementos, isso pode demorar.

Se sua lista já está ordenada, você pode chamar `Collections.binarySearch` em vez disso. Funciona se seus objetos são `Comparable`, ou pode receber um `Comparator` como argumento. A implementação usa um algoritmo de busca binária, que tem complexidade O(log n).

## Two Caveats

Primeiro, se sua lista não estiver ordenada, `binarySearch` não vai lançar nenhuma exceção — ainda vai retornar alguma coisa, mas esse resultado não tem sentido, e a busca ainda pode levar algum tempo.

Segundo, se o objeto que você procura aparece várias vezes na lista, você vai receber um dos índices válidos, não necessariamente a primeira ou a última ocorrência.

## Handling the Not-Found Case

Se o objeto não estiver na lista, você recebe `-(insertionPoint) - 1`, onde `insertionPoint` é o índice em que o objeto teria sido inserido sem quebrar a ordenação. O número é negativo justamente para sinalizar que o objeto não foi encontrado, ainda codificando onde ele pertenceria.

## Practical Example

```java
List<Integer> sorted = new ArrayList<>(List.of(1, 3, 5, 7, 9));

int found = Collections.binarySearch(sorted, 5);   // 2
int notFound = Collections.binarySearch(sorted, 4); // -(2) - 1 = -3
```

## Solution and Conclusion

Só use esse padrão em uma `ArrayList` — a complexidade O(log n) só é alcançada se você conseguir acessar qualquer elemento em tempo constante. Rodar `binarySearch` em uma `LinkedList` perde essa garantia, já que cada acesso a elemento passa a ser O(n) por si só.

## References

- [Java Coding Tip #380: Searching in a List](https://www.youtube.com/watch?v=hrLJTsM9c4M) — video
- [Collections.binarySearch — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#binarySearch(java.util.List,java.lang.Object)) — doc
