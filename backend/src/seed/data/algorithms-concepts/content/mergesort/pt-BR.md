---
version: 1.0
updatedAt: 2026-08-13
title: "Mergesort: O(n log n) Garantido via Divisão e Fusão"
description: "Como o mergesort divide e funde recursivamente para garantir O(n log n) em todos os casos (diferente do pior caso O(n²) do quicksort), a fusão baseada em array auxiliar de Sedgewick vs. a fusão baseada em sentinela de Cormen, e por que o TimSort do Java é o descendente real do mergesort."
---
## Objetivo

Entenda o mergesort: uma ordenação dividir-para-conquistar que divide recursivamente um array ao meio, ordena cada metade, e funde as duas metades ordenadas de volta — O(n log n) garantido em todo caso, diferente do pior caso O(n²) do quicksort, ao custo de precisar de memória extra.

## Casos de Uso

- Ordenar quando um limite O(n log n) *garantido* importa mais do que velocidade no caso médio — nenhuma entrada adversarial consegue degradá-lo para O(n²) como pode acontecer com o quicksort.
- Ordenar listas encadeadas, onde o padrão de acesso sequencial do mergesort funciona bem e o particionamento de acesso aleatório do quicksort não.
- A ordenação estável canônica — quando preservar a ordem relativa de elementos iguais importa, o mergesort (implementado corretamente) garante isso e o esquema de particionamento do quicksort não.

## Aprofundamento

### Dividir, conquistar, combinar

Os dois livros expressam a mesma estrutura de três passos. Divida o array ao meio, ordene recursivamente cada metade, depois funda as duas metades ordenadas numa só:

```java
void sort(Comparable[] a, int lo, int hi) {
    if (hi <= lo) return;
    int mid = lo + (hi - lo) / 2;
    sort(a, lo, mid);        // ordena metade esquerda
    sort(a, mid + 1, hi);    // ordena metade direita
    merge(a, lo, mid, hi);   // funde os resultados
}
```

O `MERGE-SORT` do CLRS tem a mesma forma em pseudocódigo: `if p ≥ r return; q = ⌊(p+r)/2⌋; MERGE-SORT(A,p,q); MERGE-SORT(A,q+1,r); MERGE(A,p,q,r)`. A recursão termina em subarrays de tamanho 0 ou 1, que já estão trivialmente ordenados.

### O passo de fusão: combinando duas metades ordenadas em tempo linear

O trabalho de verdade acontece no `merge()`. A versão de Sedgewick copia o subintervalo para um array auxiliar primeiro, depois lê de volta dessa cópia enquanto escreve o resultado fundido no array original — uma escolha deliberada, já que fundir *diretamente* in-place sem um segundo array sobrescreveria valores ainda necessários para comparação:

```java
public static void merge(Comparable[] a, int lo, int mid, int hi) {
    int i = lo, j = mid + 1;
    for (int k = lo; k <= hi; k++) aux[k] = a[k];  // copia para o espaço auxiliar primeiro
    for (int k = lo; k <= hi; k++) {
        if      (i > mid)              a[k] = aux[j++];  // esquerda esgotada
        else if (j > hi)               a[k] = aux[i++];  // direita esgotada
        else if (less(aux[j], aux[i])) a[k] = aux[j++];  // a cabeça da direita é menor
        else                           a[k] = aux[i++];  // a cabeça da esquerda é menor (ou igual — estabilidade)
    }
}
```

Cada um dos quatro ramos trata um caso: um lado acabou, ou compare as duas cabeças atuais e pegue a menor — com empates resolvidos a favor da metade *esquerda*, que é exatamente o que torna essa fusão estável. O `MERGE` do CLRS tem a mesma ideia com um truque mecânico diferente: copia as duas metades para arrays temporários separados `L` e `R`, cada um com um valor sentinela (`∞`) anexado no final, de forma que o laço de fusão nunca precise de uma checagem explícita de "qual lado acabou" — comparar contra `∞` já resolve isso automaticamente.

### Veja acontecendo: fundindo duas metades já ordenadas

As duas metades de um array de 8 elementos já estão individualmente ordenadas — `[1,3,5,7]` à esquerda, `[2,4,6,8]` à direita. Observe o `merge()` intercalá-las num único array totalmente ordenado:

```viz
type: moves
mark 0 | A metade esquerda a[0..3] = [1,3,5,7] e a metade direita a[4..7] = [2,4,6,8] já estão cada uma ordenada — merge() as combina num único array ordenado.
swap 1 2 | "3" e "5" trocam de lugar — o primeiro passo rumo a cada valor alcançar sua posição na ordem fundida.
swap 1 4 | "5" e "2" trocam de lugar — "2" (da metade direita) se estabelece no índice 1, "5" se estabelece no índice 4: ambos agora em suas posições finais fundidas.
swap 3 6 | "7" e "6" trocam de lugar — o mesmo reposicionamento, agora para o par que termina em torno dos índices 3 e 6.
swap 3 5 | "6" e "4" trocam de lugar — "4" se estabelece no índice 3, "6" se estabelece no índice 5: o array agora está totalmente fundido e ordenado.
---
1
3
5
7
2
4
6
8
```

### Por que O(n log n) é garantido, não só caso médio

Proposição F de Sedgewick: o mergesort top-down usa entre ½N lg N e N lg N comparações para ordenar qualquer array de comprimento N — a recorrência `C(N) = C(⌊N/2⌋) + C(⌈N/2⌉) + N` decorre diretamente da própria estrutura do algoritmo (ordena a metade esquerda, ordena a metade direita, depois N comparações para fundir). Diferente da recorrência do quicksort, esta não depende de quão sortuda foi a escolha do pivô — a divisão é sempre exatamente ao meio, todas as vezes, independentemente da ordem da entrada.

## Trade-offs

- **O(n log n) garantido, mas não in-place** — o array auxiliar custa O(n) de memória extra, diferente do O(log n) do quicksort (só a pilha de recursão). Para arrays enormes onde memória é a restrição limitante, essa diferença importa.
- **Estável por construção, se os empates da fusão favorecem a metade esquerda** — essa é uma vantagem real sobre o esquema de particionamento do quicksort, que não oferece nenhuma garantia de estabilidade.
- **Em Java em produção, isso é mais próximo do que realmente roda do que o quicksort** — `Arrays.sort()` num array `Object[]`/genérico (não num array primitivo) usa **TimSort**, um híbrido fundamentalmente baseado em fusão: ele encontra sequências já ordenadas na entrada, estende sequências curtas com insertion sort, e funde sequências usando o mesmo mecanismo central de `merge()` mostrado acima — escolhido especificamente porque ordenações de objetos precisam da estabilidade que o mergesort fornece e ordenações de primitivos não:

  ```java
  Integer[] boxed = {5, 3, 1, 4, 2};
  Arrays.sort(boxed);           // TimSort — baseado em fusão, estável

  int[] nums = {5, 3, 1, 4, 2};
  Arrays.sort(nums);            // quicksort de pivô duplo — não baseado em fusão, não estável (não precisa ser)
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 2.2 "Mergesort", pp. 270-287 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 2 "Getting Started", Seção 2.3, pp. 34-40 — book
- [Princeton Algorithms, 4th Ed. — Mergesort (companion site)](https://algs4.cs.princeton.edu/22mergesort/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
