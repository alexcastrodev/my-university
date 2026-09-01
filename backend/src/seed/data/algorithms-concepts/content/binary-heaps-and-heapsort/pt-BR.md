---
version: 1.0
updatedAt: 2026-08-13
title: "Binary Heaps e Heapsort: Ordem de Prioridade Baseada em Array"
description: "Como um binary heap empacota uma árvore binária completa em um array simples, sem ponteiros, usando swim/sink para manter a ordem de heap em O(log n), e como esse mesmo heap baseado em array move o heapsort — uma ordenação in-place com pior caso garantido de O(n log n)."
---
## Objetivo

Entenda o binary heap: uma árvore binária completa armazenada implicitamente em um array simples (sem ponteiros), mantida em ordem de heap (pai ≥ ambos os filhos) em vez de totalmente ordenada — a implementação padrão do TAD priority queue (insert, remove-o-máximo), e o motor por trás do heapsort, uma ordenação in-place com pior caso garantido de O(n log n).

## Casos de Uso

- O próprio TAD priority queue — inserir um item, remover repetidamente o de maior (ou menor) prioridade — para agendamento de tarefas/jobs, simulação orientada a eventos (processar eventos em ordem de tempo), e como estrutura de dados central dentro dos algoritmos de Dijkstra e Prim, onde o próximo nó a processar é sempre o de menor custo atual.
- Heapsort, quando um pior caso *garantido* de O(n log n) e espaço extra O(1) importam — sistemas embarcados, ambientes de pouca memória, ou qualquer lugar onde uma entrada adversarial poderia disparar o O(n²) do quicksort.
- Qualquer problema de "encontre os top/bottom k de um stream enorme", onde ordenar tudo é desperdício — um heap dá insert e remove-do-extremo em O(log n) sem nunca ordenar totalmente o resto dos dados.

## Aprofundamento

### A árvore binária completa escondida em um array simples

Um binary heap é uma árvore binária **completa** — todo nível cheio exceto possivelmente o último, que se preenche da esquerda para a direita — sem lacunas. Essa completude é o que torna possível uma representação em array sem nenhum ponteiro explícito de filho/pai. O exemplo da Figura 6.1 do CLRS, usando `A[1..n]` indexado a partir de 1, do jeito que os dois livros apresentam a aritmética de índices:

```
i     1    2    3   4   5   6   7   8   9  10
A[i]  16   14   10  8   7   9   3   2   4   1

              1
             16
       2              3
      14              10
   4      5       6       7
   8      7       9       3
 8   9  10
 2   4   1
```

Para um nó na posição `k` (indexado a partir de 1): seus filhos estão em `2k` e `2k + 1`, e seu pai está em `⌊k/2⌋`. Subir ou descer a árvore é só aritmética sobre um índice — sem campos `left`/`right`/`parent`, sem alocação por nó. Sedgewick & Wayne apresentam as mesmas fórmulas para o array `pq[1..N]` deles (`pq[0]` deliberadamente não usado).

Código Java real quase sempre usa um array simples indexado a partir de 0 (é isso que `java.util.PriorityQueue` faz internamente). As fórmulas deslocam em um:

```java
int parent(int i) { return (i - 1) / 2; }
int left(int i)   { return 2 * i + 1; }
int right(int i)  { return 2 * i + 2; }
```

Qualquer uma das duas convenções dá altura O(log n) para n elementos, já que a altura de uma árvore completa é `⌊lg n⌋` — esse limite é o que faz toda operação de heap abaixo ser O(log n).

**Ordem de heap não é ordem de ordenação.** Um max-heap só garante pai ≥ ambos os filhos — não diz nada sobre como irmãos ou primos se comparam. `A[2]=14` e `A[3]=10` no array acima não têm relação pela ordem de heap mesmo estando adjacentes; `A[4]=8` poderia perfeitamente ser menor que `A[7]=3`. Essa é a diferença chave em relação a uma binary search tree: um heap troca totalmente a propriedade de ordem ordenada por acesso O(1) ao *único* maior (ou menor) elemento e rebalanceamento barato.

### swim (sift-up) e sink (sift-down)

As duas operações restauram a ordem de heap depois de uma violação em um único ponto, percorrendo um caminho desse ponto em direção à raiz ou a uma folha — nunca varrendo o array inteiro. Usando as fórmulas indexadas a partir de 0 acima, para um max-heap de `n` elementos vivos:

```java
// A chave de um nó acabou de aumentar (ou um nó novo foi anexado no fim) —
// suba-o (swim) até que seu pai não seja mais menor.
private void swim(int[] heap, int k) {
    while (k > 0 && heap[(k - 1) / 2] < heap[k]) {
        swap(heap, (k - 1) / 2, k);
        k = (k - 1) / 2;
    }
}

// A chave de um nó acabou de diminuir (tipicamente: a raiz foi substituída) —
// desça-o (sink), sempre trocando de lugar com o filho MAIOR.
private void sink(int[] heap, int k, int n) {
    while (2 * k + 1 < n) {
        int j = 2 * k + 1;                              // filho esquerdo
        if (j + 1 < n && heap[j] < heap[j + 1]) j++;     // escolhe o filho maior
        if (heap[k] >= heap[j]) break;                   // ordem de heap restaurada
        swap(heap, k, j);
        k = j;
    }
}
```

`insert` anexa a nova chave no final e chama `swim`; `removeMax` troca a raiz com o último elemento vivo, encolhe a região viva em um e chama `sink` na nova raiz. Ambas são O(log n), já que cada loop dá no máximo um passo por nível da árvore.

Um pequeno exemplo traçado à mão. Partindo do max-heap válido `[9, 5, 7, 3, 1]` e inserindo `8`:

```
insert 8       → anexa no final:              [9, 5, 7, 3, 1, 8]
swim(5)        → pai do índice 5 é o índice 2 ("7"); 8 > 7, troca
               → [9, 5, 8, 3, 1, 7]
               → pai do índice 2 é o índice 0 ("9"); 8 < 9, para
```

Agora `removeMax` nesse mesmo heap `[9, 5, 8, 3, 1, 7]`:

```
remove raiz 9  → move o último elemento ("7") para a raiz, encolhe para tamanho 5:
               → [7, 5, 8, 3, 1]
sink(0, 5)     → filhos do índice 0 são "5" e "8"; o maior é "8" (índice 2), e 7 < 8, troca
               → [8, 5, 7, 3, 1]
               → índice 2 não tem filhos vivos (2*2+1 = 5 está fora do range), para
```

Ambos os traces restauram a ordem de heap em exatamente uma troca porque a violação começou bem perto de onde a correção precisava acontecer — o caso geral só repete a mesma checagem-e-troca até não precisar mais.

### Construindo um heap bottom-up em O(n) — não O(n log n)

Inserir `n` itens um de cada vez (`n` chamadas a `swim`) constrói um heap em O(n log n). O `BUILD-MAX-HEAP` do CLRS faz melhor indo na direção oposta — chamando `sink` em todo nó *interno*, do último até a raiz:

```java
// Indexado a partir de 0: nós internos são 0 .. n/2 - 1; tudo a partir de n/2 é folha.
void buildMaxHeap(int[] heap) {
    int n = heap.length;
    for (int k = n / 2 - 1; k >= 0; k--) {
        sink(heap, k, n);
    }
}
```

É aqui que o limite ingênuo engana. `sink` custa O(altura do nó em que é chamado), não O(log n) fixo — e em uma árvore completa, a *maioria* dos nós está perto da base, onde a altura é pequena. Metade dos nós são folhas (altura 0, grátis). Um quarto está na altura 1. Só um único nó — a raiz — está na altura máxima, `⌊lg n⌋`.

Somar `altura × (número de nós naquela altura)` ao longo de todos os níveis dá, segundo o CLRS:

```
Σ (h=0 até lg n)  n / 2^(h+1) · h   =   O(n) · Σ (h=0 até lg n) h / 2^h   =   O(n)
```

A soma interna `Σ h/2^h` converge para uma constante (2, pela identidade padrão para `Σ h·x^h`) independentemente de quão grande `n` fique — ela não cresce com a árvore. Então o trabalho total é uma constante vezes `n`, ou seja, **O(n)**, não `O(n log n)`. A intuição em uma frase: a construção do heap gasta trabalho `O(log n)` só no punhado minúsculo de nós de fato tão altos, e trabalho `O(1)`-ish na vasta maioria dos nós perto das folhas — a soma ponderada é linear, porque os casos "caros" são exponencialmente raros.

### Heapsort: construir uma vez, depois extrair o máximo repetidamente

Heapsort tem exatamente duas fases, ambas movidas por `sink` e nada mais:

```java
public static void heapSort(int[] a) {
    int n = a.length;
    for (int k = n / 2 - 1; k >= 0; k--) sink(a, k, n);   // fase 1: constrói o heap, O(n)
    for (int end = n - 1; end > 0; end--) {                // fase 2: sortdown, O(n log n)
        swap(a, 0, end);          // move o máximo atual para sua posição final ordenada
        sink(a, 0, end);          // restaura a ordem de heap na região viva encolhida
    }
}
```

A fase 1 transforma o array desordenado em um max-heap in-place, em O(n) (subtópico anterior). A fase 2 repete "troca a raiz com o último elemento vivo, encolhe, sink" exatamente `n − 1` vezes, cada `sink` custando O(log n) em um heap que encolhe — O(n log n) no total, e como a posição do "último elemento vivo" é exatamente onde o máximo extraído pertence na ordem final ordenada, o array termina totalmente ordenado com **nenhum array auxiliar**.

Um trace completo e verificado à mão em sete elementos — `[4, 10, 3, 5, 1, 8, 7]` — primeiro heapificado, depois ordenado por sortdown. O `mark` no índice 5 mostra o momento em que a fase de construção termina e o sortdown começa:

```viz
type: moves
mark 0 | Fase de construção começa no último nó interno (índice 2, valor "3") e faz sink nele — folhas não precisam de trabalho.
swap 2 5 | sink(2): filhos são "8" (índice 5) e "7" (índice 6); "8" é o maior, e vence "3" — troca.
swap 0 1 | sink(0): filhos são "10" (índice 1) e "8" (índice 2, depois da troca anterior); "10" vence "4" — troca.
swap 1 3 | A antiga raiz "4" caiu no índice 1, que agora perde para seu filho "5" (índice 3) — sink continua, troca de novo. Heap construído: [10,5,8,4,1,3,7].
mark 0 | Heap construído em O(n). Sortdown: troca a raiz (o máximo) com o último slot vivo, encolhe o heap, faz sink na nova raiz — repete.
swap 0 6 | Extrai o máximo: "10" troca com "7" (último índice vivo) — "10" agora está em sua posição final ordenada.
swap 0 2 | sink(0) sobre o heap encolhido: "8" (índice 2) vence a nova raiz "7" — troca.
swap 0 5 | Extrai o máximo: "8" troca com "3" (novo último índice vivo) — "8" está ordenado.
swap 0 2 | sink(0): "7" (índice 2) vence a nova raiz "3" — troca.
swap 0 4 | Extrai o máximo: "7" troca com "1" (último índice vivo) — "7" está ordenado.
swap 0 1 | sink(0): "5" (índice 1) vence a nova raiz "1" — troca.
swap 1 3 | O "1" rebaixado ainda perde para seu filho "4" (índice 3) — sink continua, troca de novo.
swap 0 3 | Extrai o máximo: "5" troca com "1" (último índice vivo) — "5" está ordenado.
swap 0 1 | sink(0): "4" (índice 1) vence a nova raiz "1" — troca.
swap 0 2 | Extrai o máximo: "4" troca com "3" (último índice vivo) — "4" está ordenado. O heap de 2 elementos [3,1] já está em ordem de heap, sem sink necessário.
swap 0 1 | Extração final: "3" e "1" trocam de lugar. Sobra um elemento — heapsort terminou: [1,3,4,5,7,8,10].
---
4
10
3
5
1
8
7
```

## Trade-offs

- **In-place, espaço extra O(1), diferente do mergesort** — heapsort ordena dentro do array original, sem precisar de um buffer auxiliar como o passo `merge()` do mergesort exige.
- **Pior caso garantido de O(n log n), diferente do O(n²) do quicksort** — nenhuma entrada, adversarial ou não, consegue degradar o heapsort abaixo de `~2n lg n` comparações (Proposição S de Sedgewick & Wayne); não há escolha de pivô para dar azar.
- **Não é estável** — extrair o máximo repetidamente reordena chaves iguais arbitrariamente conforme elas são trocadas pelo heap; se preservar a ordem relativa original de empates importa, isso descarta o heapsort (o mergesort é a alternativa estável).
- **Raramente é a escolha padrão na prática, apesar do bom limite de pior caso** — Sedgewick & Wayne observam isso explicitamente: heapsort tem comportamento de cache ruim, já que entradas do array são comparadas e trocadas com outras distantes no array (saltos pai/filho de `~n/2`), não com entradas vizinhas como os loops internos do quicksort ou do insertion sort fazem. Um quicksort bem ajustado (com seleção de pivô randomizada/mediana-de-três para evitar seu pior caso) tipicamente vence em hardware real apesar do limite teoricamente pior — e é exatamente por isso que `Arrays.sort()` usa quicksort de pivô duplo para primitivos em vez de heapsort.
- **Ainda a ferramenta certa quando só o *máximo/mínimo* é necessário repetidamente, não uma ordenação completa** — uma priority queue baseada em heap faz `insert`/`removeMax` em O(log n) cada, contra O(n) para um array não ordenado ou O(n) de insert para um array mantido ordenado; essa é a razão inteira pela qual `java.util.PriorityQueue` e algoritmos como Dijkstra se apoiam em um heap em vez de simplesmente ordenar tudo de antemão.

## Documentation Links

- [Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 2.4 "Priority Queues", pp. 308-327](https://algs4.cs.princeton.edu/24pq/) — book
- [Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 6 "Heapsort", pp. 161-181](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — book
- [PriorityQueue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html) — doc
