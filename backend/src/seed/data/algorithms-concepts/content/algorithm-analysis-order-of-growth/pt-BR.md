---
version: 1.0
updatedAt: 2026-08-13
title: "Análise de Algoritmos: Ordem de Crescimento e Notação Assintótica"
description: "Como descrever o tempo de execução de um algoritmo independentemente do hardware e do tamanho da entrada, usando a notação til/ordem-de-crescimento de Sedgewick e os limites formais O/Ω/Θ de Cormen."
---
## Objetivo

Entenda como descrever o tempo de execução de um algoritmo em função do tamanho da entrada `N`, independentemente da máquina em que roda ou do quão cuidadosa foi a implementação — o vocabulário ("ordem de crescimento", "Big-O", "notação assintótica") que toda discussão sobre algoritmos, todo livro-texto e toda entrevista técnica assume que você já conhece.

## Casos de Uso

- Comparar dois algoritmos para o mesmo problema *antes* de implementar qualquer um dos dois, evitando construir a abordagem mais lenta.
- Prever se um algoritmo que funciona bem num dataset de teste de 1.000 linhas ainda vai terminar em tempo razoável numa tabela de produção com 10.000.000 de linhas.
- Explicar, numa entrevista técnica ou num code review, *por que* uma solução é melhor que outra — "é O(n log n) em vez de O(n²)" é uma afirmação precisa e verificável; "parece mais rápido" não é.

## Aprofundamento

### Os limites formais de Cormen: O, Ω e Θ

O CLRS define três notações assintóticas, cada uma limitando a taxa de crescimento de uma função por um lado diferente:

- **O(g(n))** — um limite *superior*: a função cresce no máximo tão rápido quanto `g(n)`.
- **Ω(g(n))** — um limite *inferior*: a função cresce no mínimo tão rápido quanto `g(n)`.
- **Θ(g(n))** — um limite *justo* (tight): a função cresce exatamente nessa taxa (é tanto O(g(n)) quanto Ω(g(n))).

Pegue `7n³ + 100n² − 20n + 6`. Seu termo de maior ordem é `7n³`, então:

```
7n³ + 100n² − 20n + 6  é  O(n³)   — cresce no máximo tão rápido quanto n³ (também vale para O(n⁴), O(n⁵), ...)
7n³ + 100n² − 20n + 6  é  Ω(n³)   — cresce no mínimo tão rápido quanto n³ (também vale para Ω(n²), Ω(n), ...)
7n³ + 100n² − 20n + 6  é  Θ(n³)   — ambos valem, então o limite é justo
```

Só o termo de maior ordem importa — constantes e termos de ordem menor são assintoticamente irrelevantes, o que é exatamente o que torna a notação útil para comparar algoritmos independentemente dos detalhes de implementação.

### O atalho de Sedgewick: aproximações til e ordem de crescimento

Sedgewick e Wayne chegam na mesma ideia por uma via mais computacional. Contar quantas vezes o `if` interno dispara num loop triplamente aninhado sobre um array de tamanho `N` dá uma fórmula exata, mas incômoda:

```
N(N−1)(N−2)/6  =  N³/6 − N²/2 + N/3
```

Para `N = 1.000`, o termo dominante `N³/6 ≈ 166.666.667` ofusca completamente o resto (`−N²/2 + N/3 ≈ −499.667`) — então eles definem a **notação til** (`~`): `g(N) ~ f(N)` significa `g(N)/f(N) → 1` conforme `N` cresce. Isso permite escrever `N³/6 − N²/2 + N/3 ~ N³/6` e descartar tudo exceto o termo dominante. A **ordem de crescimento** é então só o formato desse termo dominante, `f(N) = N^b (log N)^c`.

### O vocabulário de taxas de crescimento que os dois livros usam

```java
// Uma noção aproximada de como essas classes escalam, para a MESMA medida abstrata de custo:
constant:      1                 // indexação de array, lookup em hash
logarithmic:   log N             // busca binária
linear:        N                 // varrer um array uma vez
linearithmic:  N log N           // mergesort, quicksort (caso médio), heapsort
quadratic:     N²                // insertion sort, selection sort, loops aninhados sobre a mesma entrada
cubic:         N³                // multiplicação de matrizes ingênua
exponential:   2^N                // enumeração de subconjuntos por força bruta
```

## Trade-offs

- **Θ é mais rigoroso que `~`, mas custa mais para estabelecer** — provar formalmente um limite Θ justo exige mostrar que tanto um limite O quanto um Ω valem; a aproximação til chega numa resposta praticamente útil mais rápido, só descartando termos de ordem menor, ao custo de não ser uma prova formal.
- **"Big-O" na conversa cotidiana (incluindo na maioria das entrevistas) quase sempre significa o limite Θ, não um limite superior literal** — dizer que um algoritmo "é O(n²)" quando na verdade é Θ(n) é tecnicamente verdadeiro (n cresce no máximo tão rápido quanto n²), mas enganoso; saiba que o atalho falado da área é mais frouxo que a definição do livro-texto, e por padrão declare o limite justo quando você o conhece.
- **A notação assintótica não diz nada sobre o fator constante** — um algoritmo O(n) com uma constante oculta grande pode rodar mais devagar na prática do que um algoritmo O(n log n) para todo tamanho de entrada que realmente aparece em produção, já que a notação só descreve o comportamento quando `n → ∞`:

  ```java
  // Ambos são O(n), mas o segundo faz ~50x mais trabalho por elemento.
  int sumFast(int[] a) { int s = 0; for (int x : a) s += x; return s; }
  int sumSlow(int[] a) { int s = 0; for (int x : a) for (int i = 0; i < 50; i++) s += x / 50; return s; }
  ```

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 1.4 "Analysis of Algorithms", pp. 172-215 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 3 "Characterizing Running Times", Seção 3.1, pp. 49-63 — book
- [Princeton Algorithms, 4th Ed. — Analysis of Algorithms (companion site)](https://algs4.cs.princeton.edu/14analysis/) — doc
