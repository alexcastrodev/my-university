---
version: 1.0
updatedAt: 2026-09-01
title: "Monotonic Stack: Maior/Menor Elemento Próximo em O(n)"
description: "Uma pilha mantida estritamente crescente ou decrescente, removendo elementos que violariam a ordem antes de cada inserção — transforma 'maior/menor elemento próximo' de uma varredura O(n²) por elemento em O(n) total, usando o mesmo argumento de análise agregada que o CLRS prova pra uma pilha com operação MULTIPOP."
---
## Objetivo

Entenda a monotonic stack (pilha monotônica): uma pilha mantida estritamente crescente ou decrescente, removendo (pop) qualquer elemento que violaria essa ordem *antes* de inserir (push) o novo. Ela transforma "para cada elemento, varra o resto do array procurando o maior (ou menor) valor mais próximo" de O(n²) para O(n) — e o limite O(n) não é um argumento novo, é o próprio exemplo de pilha-com-multipop de [Amortized Analysis](amortized-analysis), aplicado a um problema real em vez de um exercício de livro-texto.

## Casos de Uso

- **Daily Temperatures** — pra cada dia, quantos dias até um mais quente.
- **Next Greater Element / Next Smaller Element** — a generalização direta do anterior.
- **Largest Rectangle in Histogram** — o retângulo mais largo que cabe sob um horizonte de barras.
- **Trapping Rain Water** — uma alternativa baseada em pilha à solução com dois ponteiros, rastreando barras que poderiam formar um recipiente.

## Aprofundamento

### O invariante: nunca deixar a pilha parar de estar ordenada

Percorra o array uma vez, da esquerda pra direita, mantendo uma pilha de *índices*. Antes de inserir o índice atual, remova do topo todo índice cujo valor violaria a ordem da pilha (para "próximo maior elemento", remova enquanto o topo for ≤ o valor atual) — cada índice removido acabou de encontrar sua resposta: o elemento atual é exatamente o "próximo maior" que ele esperava. Depois insira o índice atual. O que sobra na pilha em qualquer momento é exatamente o conjunto de elementos ainda esperando sua resposta, em ordem.

```java
public static int[] dailyTemperatures(int[] temps) {
    int[] answer = new int[temps.length];
    Deque<Integer> stack = new ArrayDeque<>();   // índices, temperaturas decrescentes
    for (int i = 0; i < temps.length; i++) {
        while (!stack.isEmpty() && temps[stack.peek()] < temps[i]) {
            int prev = stack.pop();
            answer[prev] = i - prev;
        }
        stack.push(i);
    }
    return answer;   // índices que sobraram na pilha nunca acharam um dia mais quente: resposta fica 0
}
```

### Veja acontecendo: daily temperatures em [73, 74, 75, 71, 69, 72]

| i | temp | pops (índice: distância registrada) | pilha depois |
|---|---|---|---|
| 0 | 73 | — | [0] |
| 1 | 74 | 0: 1−0=1 | [1] |
| 2 | 75 | 1: 2−1=1 | [2] |
| 3 | 71 | — | [2, 3] |
| 4 | 69 | — | [2, 3, 4] |
| 5 | 72 | 4: 5−4=1; 3: 5−3=2 | [2, 5] |

O índice 2 (valor 75) nunca é removido — não há dia mais quente depois, então sua resposta fica 0. É todo o algoritmo; nenhum elemento é reexaminado depois de ser removido.

### Por que isso é O(n): o argumento de pilha-com-multipop do CLRS, transplantado

Cada índice é inserido exatamente uma vez (no loop principal) e removido no máximo uma vez (em toda a execução, por qualquer iteração) — então o número total de inserções mais remoções em toda a execução é no máximo 2n, não importa quão desigual seja a distribuição das remoções entre as iterações (algumas iterações não removem nada, uma poderia remover várias). Essa é literalmente a prova do método agregado que [Amortized Analysis](amortized-analysis) dá para uma pilha que suporta uma operação `MULTIPOP`: um único passo caro tudo bem, contanto que o trabalho *total* ao longo de todos os passos permaneça linear — e aqui, comprovadamente permanece.

### Parentes mais difíceis: mesmo esqueleto, quantidade diferente por remoção

`Largest Rectangle in Histogram` e `Trapping Rain Water` reutilizam o mesmo esqueleto de push/pop-enquanto-viola; o que muda é o que é calculado a cada remoção. No problema do histograma, remover uma barra calcula o maior retângulo que essa barra poderia ancorar, usando o índice *atual* e o *novo* topo da pilha como suas fronteiras esquerda/direita — um retorno direto de armazenar índices em vez de valores, abordado a seguir.

## Trade-offs

- **Uma direção por passada** — uma única varredura da esquerda pra direita encontra o elemento qualificado mais próximo à *direita* de cada posição; "maior mais próximo dos dois lados" precisa de duas passadas (uma de cada direção) ou de contabilidade cuidadosa em uma única passada, não apenas uma pilha sozinha.
- **Comparação estrita vs. não-estrita muda a corretude com duplicatas** — remover em `<` versus `<=` decide se um elemento de valor igual conta como "maior," e escolher errado silenciosamente trata mal os empates; isso precisa ser decidido por problema, do mesmo jeito que as condições de fronteira `<` vs. `<=` do binary search.
- **Armazene índices, não valores** — o valor sozinho não consegue recuperar uma posição, distância, largura ou intervalo depois que outros elementos foram removidos ao redor dele; quase todo uso real dessa técnica precisa do índice justamente porque a resposta é uma distância ou uma área, não o valor em si.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Capítulo 16 "Amortized Analysis," Seção 16.1 (o exemplo da pilha com MULTIPOP do qual o limite O(n) desta técnica é uma aplicação direta) — book
- Robert Sedgewick, Kevin Wayne — Algorithms, 4th Edition (Addison-Wesley, 2011) — Seção 1.3, "Bags, Queues, and Stacks" — book
