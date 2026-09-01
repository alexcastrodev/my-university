---
version: 1.0
updatedAt: 2026-09-01
title: "Dois Ponteiros: Varreduras Convergentes e Fast/Slow"
description: "Dois índices percorrendo uma estrutura em vez de um só — convergindo a partir das extremidades opostas em dados ordenados, ou se movendo em velocidades diferentes para detectar ciclos e encontrar pontos médios — transformando uma varredura aninhada O(n²) em uma única passada O(n), provada correta por um argumento de troca específico para cada problema."
---
## Objetivo

Entenda a técnica de dois ponteiros: percorrer uma estrutura com dois índices em vez de um — convergindo a partir das extremidades opostas ou se movendo na mesma direção em velocidades diferentes — para substituir uma varredura aninhada O(n²) por uma única passada O(n). O truque só funciona por causa de uma garantia estrutural específica (geralmente ordenação, ou um link "next"); não é um botão mágico de O(n) para qualquer loop aninhado.

## Casos de Uso

- **Two Sum em array ordenado** — encontrar o par que soma um valor alvo sem checar todo par.
- **Container With Most Water / trapping rain water** — a menor das duas paredes de fronteira é sempre a que deve se mover.
- **3Sum** — fixe um elemento, aplique dois ponteiros no restante (já ordenado).
- **Merge de dois arrays ordenados** — isso não é um truque separado; é exatamente o mecanismo que o `merge()` do [Mergesort](mergesort) já usa.
- **Ponteiros fast e slow** — detecção de ciclo e localização do ponto médio de uma lista encadeada em uma única passada, sem memória extra.

## Aprofundamento

### Ponteiros nas extremidades opostas: o argumento de troca

`Two Sum II` (entrada ordenada): `lo` começa no índice 0, `hi` no último índice. Se `a[lo] + a[hi]` é pequeno demais, `lo` precisa se mover pra direita — `a[lo]` combinado com *qualquer* índice que ele poderia alcançar agora é comprovadamente pequeno demais, porque todo outro candidato a `hi` é ≤ o `hi` atual. Simetricamente, se a soma é grande demais, `hi` precisa se mover pra esquerda. Cada comparação elimina um índice da consideração por completo, então os ponteiros podem se mover no máximo n passos combinados antes de se encontrarem — O(n) total, não O(n) por passo.

```java
public static int[] twoSumSorted(int[] a, int target) {
    int lo = 0, hi = a.length - 1;
    while (lo < hi) {
        int sum = a[lo] + a[hi];
        if (sum == target) return new int[] { lo, hi };
        if (sum < target) lo++;
        else hi--;
    }
    return new int[] { -1, -1 };
}
```

`Container With Most Water` usa a mesma estrutura com um argumento de troca mais afiado: a área entre `lo` e `hi` é limitada por `min(a[lo], a[hi]) * (hi - lo)`. Mover a parede *mais alta* só pode diminuir a largura enquanto a altura continua limitada pela mesma parede mais baixa (ou piora) — toda configuração que ela poderia alcançar já é dominada por uma já verificada. Mover a parede *mais baixa* é o único movimento que pode possivelmente encontrar algo mais alto. É por isso que o ponteiro a mover nunca é uma escolha — é forçado.

### Ponteiros na mesma direção: fast e slow

Uma estrutura bem diferente: os dois ponteiros começam no mesmo lugar e avançam, um no dobro da velocidade do outro. Em uma lista encadeada, se existe um ciclo, o ponteiro rápido eventualmente dá a volta e colide com o lento dentro do laço. Se não existe ciclo, o ponteiro rápido chega em `null` primeiro. Esse é o algoritmo de detecção de ciclo de Floyd, e a mesma relação fast/slow encontra o ponto médio de uma lista em uma única passada: quando `fast` chega ao final, `slow` está exatamente no meio.

```java
public static boolean hasCycle(ListNode head) {
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) return true;
    }
    return false;
}
```

### Veja acontecendo: convergindo no Two Sum II

Buscando em `[2, 7, 11, 15]` um par que some `18`:

| Passo | lo | hi | a[lo] + a[hi] | Movimento |
|---|---|---|---|---|
| 1 | 0 (2) | 3 (15) | 17 | pequeno demais — lo++ |
| 2 | 1 (7) | 3 (15) | 22 | grande demais — hi-- |
| 3 | 1 (7) | 2 (11) | 18 | encontrado |

Três comparações para um array de 4 elementos; o loop aninhado de força bruta teria checado até seis pares, e a diferença só aumenta conforme `n` cresce.

## Trade-offs

- **A variante de extremidades opostas precisa de entrada ordenada** — se os dados ainda não estão ordenados, você paga O(n log n) pra ordenar primeiro, o que só compensa se a varredura de dois ponteiros que vem depois for barata em comparação (e é, O(n), mas a ordenação domina o custo assintótico de qualquer forma).
- **A corretude é provada por problema, não uma vez para a técnica inteira** — "mover a parede mais baixa é seguro" e "o ponteiro da soma pequena demais precisa avançar" são dois argumentos de troca diferentes; a *forma* do código se transfere entre problemas, mas a prova de que um determinado movimento de ponteiro nunca perde a resposta não se transfere.
- **Ponteiros fast/slow precisam de acesso "next" em O(1)** — o valor inteiro da técnica em uma lista encadeada é fazer detecção de ciclo sem um conjunto hash auxiliar O(n); em um array de acesso aleatório, um conjunto de visitados costuma ser mais simples e nem precisa do truque.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Seção 2.2 "Mergesort," o método `merge()` — a técnica de dois ponteiros totalmente explicada como o núcleo da fusão de dois arrays ordenados — book
- Donald E. Knuth, *The Art of Computer Programming, Volume 2: Seminumerical Algorithms*, 3ª Edição (Addison-Wesley, 1997) — Seção 3.1, Exercício 6 credita o algoritmo de detecção de ciclo popularizado como "tortoise and hare" — book
