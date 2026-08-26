---
version: 1.0
updatedAt: 2026-07-29
question: Como comparar arrays por igualdade?
---
## Question

# Como comparar arrays por igualdade?

## Short Answer

Existe um padrão para isso: `Arrays.equals`. Mas pode ser um pouco mais complexo do que parece à primeira vista.

## What It Is

Um array é, em si, um objeto em Java, então ele herda `Object.equals`, que compara as duas **referências**. Nesse sentido, um array só é igual a ele mesmo — dois arrays distintos com exatamente os mesmos elementos ainda são considerados objetos diferentes.

Na maioria das vezes, o que você realmente quer é comparar o **conteúdo** dos seus arrays: dois arrays são iguais se contêm os mesmos elementos, na mesma ordem. É isso que `Arrays.equals` te dá. Ele recebe dois arrays e retorna se o conteúdo deles é igual — existem também sobrecargas que recebem intervalos de índices, permitindo comparar apenas uma parte do primeiro array com uma parte do segundo.

## The Multi-Dimensional Case

Você pode achar que já terminou, mas não terminou — um array pode conter subarrays. Se você comparar um array bidimensional com `Arrays.equals`, cada subarray é comparado com `Object.equals`, ou seja, por referência, que quase nunca é o que você quer.

Para esse caso, você precisa de `Arrays.deepEquals`, que percorre recursivamente os subarrays e compara o conteúdo deles também.

## Practical Example

```java
int[] a1 = {1, 2, 3};
int[] a2 = {1, 2, 3};

a1.equals(a2);          // false — comparação por referência
Arrays.equals(a1, a2);  // true  — comparação de conteúdo

int[][] m1 = {{1, 2}, {3, 4}};
int[][] m2 = {{1, 2}, {3, 4}};

Arrays.equals(m1, m2);      // false — subarrays comparados por referência
Arrays.deepEquals(m1, m2);  // true  — subarrays comparados por conteúdo
```

## Solution and Conclusion

Regra prática: use `Arrays.equals` para arrays simples, de uma dimensão, e `Arrays.deepEquals` para arrays multidimensionais (ou de alguma forma aninhados).

Um último detalhe: os dois métodos suportam elementos `null`. A convenção é que dois valores `null` são considerados iguais, então eles não vão falhar se o seu array contiver nulls. Dito isso — evite colocar valores null nos seus arrays sempre que possível.

## References

- [Java Coding Tip #381: Array Equality](https://www.youtube.com/shorts/4f2MDQg15J8) — video
- [Arrays.equals — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#equals(java.lang.Object%5B%5D,java.lang.Object%5B%5D)) — doc
- [Arrays.deepEquals — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#deepEquals(java.lang.Object%5B%5D,java.lang.Object%5B%5D)) — doc
