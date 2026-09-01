---
version: 1.0
updatedAt: 2026-08-13
title: "Quicksort: Particionamento, Pivôs e Dois Esquemas Clássicos"
description: "Como o quicksort ordena in-place particionando em torno de um pivô, por que o caso médio é O(n log n) mas o pior caso é O(n²), e como o particionamento de dois ponteiros de Sedgewick difere do esquema Lomuto de Cormen."
---
## Objetivo

Entenda o quicksort: uma ordenação in-place, dividir-para-conquistar, que escolhe um *pivô*, particiona o array em torno dele, e ordena recursivamente as duas partes resultantes — caso médio O(n log n) com constantes pequenas, ao custo de um pior caso O(n²) se o pivô for mal escolhido.

## Casos de Uso

- A ordenação genérica padrão quando velocidade no caso médio e baixo overhead de memória (in-place, sem array auxiliar) importam mais do que uma garantia de pior caso.
- Um exemplo canônico de dividir-para-conquistar: entender a recursão do quicksort torna mergesort, busca binária e a maioria dos algoritmos de árvore mais fáceis de raciocinar.
- Um exercício padrão de quadro-branco/entrevista — espere ser cobrado a implementar o particionamento, explicar o pior caso, ou traçá-lo manualmente.

## Aprofundamento

### O algoritmo: particiona, depois recursa

Os dois livros expressam os mesmos três passos. Escolha um pivô do subarray, particione de forma que tudo ≤ pivô fique à sua esquerda e tudo ≥ pivô fique à sua direita, depois ordene recursivamente cada lado:

```java
void quicksort(int[] a, int lo, int hi) {
    if (hi <= lo) return;
    int pivotIndex = partition(a, lo, hi);
    quicksort(a, lo, pivotIndex - 1);
    quicksort(a, pivotIndex + 1, hi);
}
```

Os dois livros divergem completamente em como o `partition` funciona — e essa diferença vale a pena conhecer, já que é uma fonte comum de bugs de off-by-one ao implementar quicksort de memória.

### O particionamento Lomuto de Cormen: uma varredura para frente, pivô no final

O CLRS escolhe o *último* elemento como pivô e percorre o subarray uma vez com dois índices, `i` rastreando a fronteira da região "≤ pivô":

```java
int partition(int[] a, int lo, int hi) {
    int pivot = a[hi];       // CLRS escolhe o último elemento
    int i = lo - 1;          // fronteira da região "≤ pivô"
    for (int j = lo; j < hi; j++) {
        if (a[j] <= pivot) {
            i++;
            swap(a, i, j);
        }
    }
    swap(a, i + 1, hi);      // pivô cai logo à direita da região "≤"
    return i + 1;
}
```

### O particionamento estilo Hoare de Sedgewick: dois ponteiros varrendo para dentro

O Algorithms, 4ª Ed., em vez disso escolhe o *primeiro* elemento como pivô e varre de ambas as extremidades em direção ao meio, trocando pares fora de posição conforme avança:

```java
int partition(int[] a, int lo, int hi) {
    int pivot = a[lo];               // Sedgewick escolhe o primeiro elemento
    int i = lo, j = hi + 1;
    while (true) {
        while (a[++i] < pivot) if (i == hi) break;
        while (a[--j] > pivot) if (j == lo) break;
        if (i >= j) break;
        swap(a, i, j);
    }
    swap(a, lo, j);                  // pivô cai no ponto de encontro
    return j;
}
```

Ambos são corretos, in-place, e O(n) por chamada de particionamento — a diferença é a direção da varredura e qual extremidade guarda o pivô, não o comportamento assintótico.

### Veja acontecendo: o particionamento e as trocas de verdade

O próprio exemplo de Sedgewick embaralha as letras de "QUICKSORT" e as ordena. Isto executa o particionamento real estilo Hoare mostrado acima, passo a passo — cada escolha de pivô e cada troca, não só onde cada letra termina:

```viz
type: moves
mark 0 | Pivô para a[0..8] é "Q" — o particionamento de Sedgewick sempre escolhe o elemento mais à esquerda.
swap 1 6 | "U" (pos 1) é ≥ "Q", "O" (pos 6) é ≤ "Q" — estão do lado errado, troque-as.
swap 0 4 | As varreduras se encontram na posição 4: troca o pivô "Q" para o lugar — à esquerda dele agora é ≤ "Q", à direita é ≥ "Q".
mark 0 | Recursa à esquerda, a[0..3]: o pivô é "K".
swap 1 3 | "O" (pos 1) é ≥ "K", "C" (pos 3) é ≤ "K" — troque-as.
swap 0 2 | As varreduras se encontram na posição 2: troca o pivô "K" para o lugar.
mark 0 | Recursa à esquerda de novo, a[0..1]: o pivô é "I".
swap 0 1 | Só uma comparação restando — troca o pivô "I" para sua posição final.
mark 5 | Recursa à direita do primeiro particionamento, a[5..8]: o pivô é "S".
swap 6 7 | "U" (pos 6) é ≥ "S", "R" (pos 7) é ≤ "S" — troque-as.
swap 5 6 | As varreduras se encontram na posição 6: troca o pivô "S" para o lugar.
mark 7 | Recursa à direita, a[7..8]: o pivô é "U".
swap 7 8 | Última comparação — troca o pivô "U" para sua posição final.
---
Q
U
I
C
K
S
O
R
T
```

### Caso médio vs. pior caso

Um pivô que divide o subarray aproximadamente ao meio a cada vez dá a mesma recorrência do mergesort, `T(n) = 2T(n/2) + O(n)`, que resolve para **O(n log n)**. Um pivô que é sempre o menor ou o maior elemento (entrada já ordenada com uma escolha ingênua de pivô no primeiro/último elemento) degrada cada particionamento para uma divisão de tamanho 1/tamanho (n−1), dando `T(n) = T(n-1) + O(n)`, que resolve para **O(n²)** — o pior caso que ambos os livros derivam em detalhe.

## Trade-offs

- **Pior caso O(n²) em entrada adversarial ou já ordenada, ao contrário do O(n log n) garantido do mergesort** — a mitigação padrão que ambos os livros cobrem é aleatorizar a escolha do pivô (embaralhar o array primeiro, ou escolher um elemento aleatório como pivô) para que o pior caso se torne extremamente improvável em vez de disparado por entradas comuns como dados ordenados ou ordenados ao contrário.
- **Não é estável** — elementos iguais podem ser reordenados entre si durante o particionamento, diferente de mergesort ou insertion sort. Se preservar a ordem relativa original de chaves iguais importa (por exemplo, ordenar transações já ordenadas por data pelo valor), uma ordenação estável é o padrão mais seguro.
- **Em Java em produção, você não está chamando nenhuma das implementações do livro-texto** — `Arrays.sort()` num array primitivo (`int[]`, `long[]`, etc.) usa um **quicksort de pivô duplo (dual-pivot)**, não o esquema de pivô único que ambos os livros ensinam, e `Arrays.sort()` num array `Object[]`/genérico usa **TimSort** (um híbrido estável de merge/insertion sort), não quicksort de forma alguma — porque estabilidade importa para objetos com lógica customizada de `compareTo()`/`Comparator`, mas não para primitivos crus:

  ```java
  int[] nums = {5, 3, 1, 4, 2};
  Arrays.sort(nums);                 // quicksort de pivô duplo, instável, tudo bem para primitivos

  Integer[] boxed = {5, 3, 1, 4, 2};
  Arrays.sort(boxed);                // TimSort, estável, usado porque a ordem de chaves iguais pode importar para objetos
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 2.3 "Quicksort", pp. 288-307 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 7 "Quicksort", pp. 182-204 — book
- [Princeton Algorithms, 4th Ed. — Quicksort (companion site)](https://algs4.cs.princeton.edu/23quicksort/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
