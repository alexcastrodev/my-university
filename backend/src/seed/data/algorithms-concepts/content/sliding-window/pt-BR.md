---
version: 1.0
updatedAt: 2026-09-01
title: "Sliding Window: Intervalos Contíguos em O(n) Amortizado"
description: "Manter uma janela contígua sobre um array ou string com dois ponteiros que só avançam — expandindo pra absorver novos elementos, contraindo pra descartar os inválidos — transforma uma varredura que recalcula toda janela em uma única passada O(n) amortizada, pelo mesmo argumento de análise agregada que torna ArrayList.add O(1) amortizado."
---
## Objetivo

Entenda a técnica de sliding window (janela deslizante): manter um intervalo contíguo sobre um array ou string com dois ponteiros que só avançam — nunca retrocedem — expandindo pra absorver novos elementos e contraindo pra descartar os inválidos. Isso transforma "recalcular cada janela do zero" (O(n·k) ou O(n²)) em uma única passada O(n) amortizada, porque nenhum elemento é examinado mais que um número constante de vezes em toda a execução.

Ao contrário de binary search ou DFS, esse não é um nome de capítulo de livro-texto numerado — o termo se cristalizou na cultura de programação competitiva e entrevistas técnicas pra descrever uma forma recorrente. A garantia de O(n) por trás dela, porém, é exatamente o método agregado de [Amortized Analysis](amortized-analysis), transplantado de um array que cresce para um par de índices de array.

## Casos de Uso

- **Longest Substring Without Repeating Characters** — janela de tamanho variável, contrai quando um duplicado entra.
- **Minimum Window Substring** — janela de tamanho variável buscando o *menor* intervalo válido em vez do maior.
- **Maximum Sum Subarray of Size K** — janela de tamanho fixo, o caso mais simples.
- **Longest Substring with At Most K Distinct Characters** — janela de tamanho variável com uma checagem de validade via mapa de frequência.

## Aprofundamento

### Janela de tamanho fixo: um entra, um sai

O caso mais simples nunca redimensiona a janela, só desliza ela. Mantenha uma soma (ou contagem, ou o que for a métrica) corrente de forma incremental: somar o novo elemento à direita e remover o que acabou de sair pela esquerda é O(1) por deslize, contra O(k) pra ressomar uma janela nova de k elementos a cada passo.

```java
public static int maxSumFixedWindow(int[] a, int k) {
    int windowSum = 0;
    for (int i = 0; i < k; i++) windowSum += a[i];
    int best = windowSum;
    for (int i = k; i < a.length; i++) {
        windowSum += a[i] - a[i - k];   // um entra, um sai — nunca ressomado
        best = Math.max(best, windowSum);
    }
    return best;
}
```

### Janela de tamanho variável: expandir, depois contrair

A forma geral tem um ponteiro `right` que só cresce a janela, e um ponteiro `left` que só a encolhe, com uma checagem de validade entre os dois:

1. Avance `right`, absorvendo mais um elemento no estado corrente da janela.
2. Enquanto a janela estiver inválida (ou, para um problema de minimização, enquanto ainda estiver válida e puder encolher mais), avance `left`, removendo a contribuição do seu elemento e descartando-o da janela.
3. Registre a resposta quando a janela estiver no estado que o problema pede.

```java
public static int lengthOfLongestSubstring(String s) {
    int[] lastSeen = new int[128];
    Arrays.fill(lastSeen, -1);
    int left = 0, best = 0;
    for (int right = 0; right < s.length(); right++) {
        char c = s.charAt(right);
        if (lastSeen[c] >= left) left = lastSeen[c] + 1;   // contrai passando o duplicado
        lastSeen[c] = right;
        best = Math.max(best, right - left + 1);
    }
    return best;
}
```

### Veja acontecendo: maior substring sem repetição, em "abcabcbb"

| right | char | left antes | duplicado? | left depois | tamanho da janela |
|---|---|---|---|---|---|
| 0 | a | 0 | não | 0 | 1 |
| 1 | b | 0 | não | 0 | 2 |
| 2 | c | 0 | não | 0 | 3 |
| 3 | a | 0 | sim (a em 0) | 1 | 3 |
| 4 | b | 1 | sim (b em 1) | 2 | 3 |
| 5 | c | 2 | sim (c em 2) | 3 | 3 |
| 6 | b | 3 | sim (b em 4) | 5 | 2 |
| 7 | b | 5 | sim (b em 6) | 7 | 1 |

`left` só avança — ao longo dos oito passos ele avança um total de 7 posições, nunca mais que o tamanho da string, e é exatamente por isso que isso é O(n) e não O(n) *por passo*.

### Por que isso é O(n): o mesmo argumento de um ArrayList que cresce

`left` nunca retrocede, então ao longo de toda a varredura ele pode avançar no máximo n vezes no total, não importa como os avanços se distribuam entre as iterações — alguns passos o movem zero vezes, um passo perto do fim poderia movê-lo muitas vezes, mas a *soma* fica limitada a n. Esse é exatamente o argumento do método agregado que [Amortized Analysis](amortized-analysis) usa pra mostrar que `ArrayList.add` é O(1) amortizado apesar de redimensionamentos ocasionalmente caros: cobre o custo do orçamento total, não do pior passo isolado.

O bug mais comum é derrubar essa garantia sem querer: recalcular a soma da janela, o mapa de frequência de caracteres, ou a checagem de validade do zero dentro do loop transforma uma atualização incremental O(1) de volta em uma O(k), degradando silenciosamente o algoritmo inteiro de volta pra O(n·k).

## Trade-offs

- **Só é correto quando a validade é monotônica no conteúdo da janela** — encolher pela esquerda nunca pode precisar reconsiderar um elemento já descartado. Se a condição de "válido" de um problema não tem essa propriedade, sliding window silenciosamente produz uma resposta errada em vez de um erro; é preciso uma formulação diferente (ou nova varredura explícita).
- **Lida só com intervalos contíguos** — uma restrição de *subsequência* (elementos não precisam ser adjacentes) é um problema fundamentalmente diferente; veja [Longest Common Subsequence](longest-common-subsequence) pra ferramenta de DP indicada nesse caso.
- **Exige um estado corrente reversível em O(1)** — uma soma ou uma contagem de frequência pode ser "desfeita" em O(1) quando a janela encolhe; uma métrica que não pode ser desfeita barato (por exemplo, uma mediana corrente) perde a garantia O(n) e precisa de outra estrutura auxiliar.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Capítulo 16 "Amortized Analysis," Seção 16.1 (o método agregado do qual o limite O(n) desta técnica depende) — book
- Jon Bentley, *Programming Pearls*, 2ª Edição (Addison-Wesley, 2000) — Coluna 8, "Algorithm Design Techniques" — a evolução do problema do subarray de soma máxima de uma força bruta cúbica pra uma única varredura linear, o ancestral intelectual direto da forma do sliding window — book
