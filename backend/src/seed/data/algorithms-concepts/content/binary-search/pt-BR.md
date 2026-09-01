---
version: 1.0
updatedAt: 2026-08-13
title: "Busca Binária: Lookup O(log n) em Array Ordenado"
description: "Como reduzir repetidamente pela metade o intervalo de busca de um array ordenado encontra um alvo em O(log n) comparações, a fórmula de ponto médio à prova de overflow de Sedgewick, e o argumento de corretude por invariante de laço do CLRS."
---
## Objetivo

Entenda a busca binária: como reduzir repetidamente pela metade o intervalo de busca de um array ordenado encontra um alvo em O(log n) comparações em vez do O(n) que uma varredura linear precisa, e por que o algoritmo só funciona porque o array está ordenado.

## Casos de Uso

- Buscar um valor num array ou lista ordenada grande sem varrer todo elemento.
- O bloco de construção canônico para qualquer consulta de "correspondência mais próxima" ou "ponto de inserção" (`Collections.binarySearch()`, `Arrays.binarySearch()`) — a maioria das APIs de busca ordenada do JDK são busca binária por baixo dos panos.
- Uma pergunta padrão de primeira entrevista/design de algoritmo — espere ser cobrado nas formas recursiva e iterativa, e a explicar o limite O(log n) com precisão, não só recitá-lo.

## Aprofundamento

### A ideia central: reduzir o intervalo de busca pela metade a cada comparação

O método `rank()` de Sedgewick e Wayne (da classe `BinarySearch` deles) é a implementação Java canônica. Dado um array ordenado e uma chave, ele rastreia uma janela `[lo, hi]` que encolhe e compara contra o ponto médio a cada vez:

```java
public static int rank(int key, int[] a) {
    int lo = 0;
    int hi = a.length - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (key < a[mid]) hi = mid - 1;
        else if (key > a[mid]) lo = mid + 1;
        else return mid;
    }
    return -1;
}
```

Cada iteração elimina *metade* do que resta, independentemente de quão grande o array começou — é isso que dá O(log n) comparações em vez do O(n) da busca linear. `mid = lo + (hi - lo) / 2` (em vez do mais óbvio `(lo + hi) / 2`) é deliberado: num array grande o suficiente, `lo + hi` pode estourar (overflow) o `int` antes da divisão acontecer, um bug histórico real (inclusive em implementações antigas do `Arrays.binarySearch()` do JDK) que essa formulação evita.

### Veja acontecendo: a janela de busca fechando o cerco

Buscando num array ordenado de 9 elementos um valor que não está nele (`5`) — observe cada `mid` estreitar a faixa ativa até `lo` cruzar `hi`:

```viz
type: moves
mark 4 | mid = 4: a[4] = 8, alvo 5 < 8 -- busca na metade esquerda, hi = 3.
mark 1 | mid = 1: a[1] = 2, alvo 5 > 2 -- busca na metade direita, lo = 2.
mark 2 | mid = 2: a[2] = 4, alvo 5 > 4 -- busca na metade direita, lo = 3.
mark 3 | mid = 3: a[3] = 6, alvo 5 < 6 -- busca na metade esquerda, hi = 2. lo > hi: não encontrado.
---
1
2
4
6
8
11
14
17
20
```

Nove elementos, e só quatro comparações foram necessárias para concluir que o valor não está lá — uma varredura linear teria que checar até os nove.

### O enquadramento do CLRS: corretude por invariante de laço

Cormen et al. apresentam a busca binária como um exemplo canônico (exercício 2.3-6) para provar a corretude de um algoritmo via invariante de laço: no início de toda iteração, se a chave está presente no array, ela precisa estar dentro de `A[lo..hi]` — o passo de reduzir pela metade preserva esse invariante em toda iteração, e o laço termina ou encontrando a chave ou com `lo` cruzando `hi` (provando que o invariante agora implica que a chave não está presente em lugar nenhum).

## Trade-offs

- **Exige que o array já esteja ordenado** — a busca binária em si é O(log n), mas ordenar primeiro (se os dados ainda não estiverem ordenados) custa O(n log n), o que só compensa se a mesma estrutura ordenada for buscada muitas vezes; uma única busca avulsa em dados não ordenados é mais rápida com uma varredura linear simples.
- **O(log n) comparações, mas cada comparação num dataset enorme pode não ser O(1)** — comparar dois objetos grandes (strings longas, registros grandes) não é grátis; a *quantidade* log n de comparações é o que é garantido, não que toda a busca rode em tempo constante por passo independentemente do que está sendo comparado.
- **Funciona bem numa array de acesso aleatório; desajeitado numa estrutura encadeada** — pular direto para o ponto médio é O(1) num array, mas O(n) numa `LinkedList`, o que anula completamente a vantagem da busca binária; é exatamente por isso que estruturas de árvore ordenadas (árvores binárias de busca, cobertas separadamente) existem como o equivalente dessa ideia para estruturas encadeadas.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 1.1 "Basic Programming Model", pp. 8-9 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 2 "Getting Started", Exercício 2.3-6, p. 45 — book
- [Arrays.binarySearch — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#binarySearch(int%5B%5D,int)) — doc
