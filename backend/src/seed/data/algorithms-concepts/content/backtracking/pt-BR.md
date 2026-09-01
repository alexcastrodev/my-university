---
version: 1.0
updatedAt: 2026-09-01
title: "Backtracking: Escolher, Recursar, Desfazer"
description: "Uma técnica geral de busca recursiva para enumerar toda solução válida de um problema combinatório — escolha uma opção, recurse, desfaça a escolha — com poda que abandona um ramo no instante em que ele se prova inválido, em vez de construí-lo até o fim e checar depois."
---
## Objetivo

Entenda backtracking: uma técnica geral de busca recursiva para enumerar toda solução (ou toda configuração válida) de um problema combinatório, construída a partir de exatamente três passos repetidos em cada ponto de decisão — escolha uma opção, recurse no problema restante menor, e desfaça a escolha antes de tentar a próxima opção. O passo de desfazer é a ideia inteira: é o que permite que o mesmo estado mutável (um array, um tabuleiro parcial, um conjunto corrente) seja reutilizado em cada ramo, em vez de ser copiado. O que separa backtracking de enumeração por força bruta é a poda — abandonar um ramo no instante em que ele se prova inválido, em vez de construí-lo até o fim e só então checar.

## Casos de Uso

- **Subsets / Power Set** — incluir ou excluir cada elemento.
- **Permutations** — escolher qual elemento não usado vem a seguir, em toda ordem possível.
- **N-Queens** — o problema canônico de satisfação de restrições: posicionar N rainhas de forma que nenhuma ataque outra.
- **Combination Sum** — escolher números (com repetição) que somem um valor alvo.
- **Sudoku solver** — preencher cada célula vazia com um dígito que não conflite com sua linha, coluna ou quadrante.

## Aprofundamento

### O esqueleto: escolher, recursar, desfazer

Toda solução de backtracking tem a mesma forma, independentemente do problema:

```java
static void backtrack(List<Integer> nums, int start, List<Integer> current, List<List<Integer>> result) {
    result.add(new ArrayList<>(current));   // registra: 'current' é um subconjunto válido agora
    for (int i = start; i < nums.size(); i++) {
        current.add(nums.get(i));                       // escolhe
        backtrack(nums, i + 1, current, result);         // recursa
        current.remove(current.size() - 1);              // desfaz
    }
}
```

Para `Subsets`, "registrar" acontece em toda chamada, porque toda seleção parcial já é, por si só, um subconjunto válido. Outros problemas só registram nas folhas (uma permutação completa, um tabuleiro totalmente preenchido) e usam o loop puramente pra explorar.

### Poda: a diferença entre backtracking e força bruta

Uma solução de força bruta pro N-Queens geraria todo arranjo possível de N rainhas no tabuleiro, e só depois filtraria os que têm conflitos — a maior parte desse trabalho é desperdiçada no momento em que as duas primeiras rainhas já conflitam. Backtracking checa a restrição *antes* de recursar mais fundo: posicione uma rainha na linha atual só em uma coluna que não conflite com nenhuma rainha já posicionada, e pule toda coluna que conflita sem nunca explorar o que está abaixo dela.

```java
static boolean isSafe(int[] cols, int row, int col) {
    for (int r = 0; r < row; r++) {
        if (cols[r] == col) return false;                          // mesma coluna
        if (Math.abs(cols[r] - col) == row - r) return false;       // mesma diagonal
    }
    return true;
}
```

Essa única checagem, aplicada antes de cada chamada recursiva em vez de depois do tabuleiro completo, é o que faz o 4-Queens explorar um punhado de ramos em vez de todos os 4⁴ = 256 posicionamentos brutos.

### Veja acontecendo: 4-Queens, linha por linha

| Linha | Coluna tentada | Segura? | Ação |
|---|---|---|---|
| 0 | 0 | sim | posiciona, recursa pra linha 1 |
| 1 | 0, 1 | não (conflito de coluna/diagonal) | pula ambas |
| 1 | 2 | sim | posiciona, recursa pra linha 2 |
| 2 | 0, 1, 2, 3 | não (todas conflitam com as linhas 0–1) | **beco sem saída — volta pra linha 1** |
| 1 | 3 | sim | posiciona, recursa pra linha 2 |
| 2 | 0, 1, 2, 3 | não (todas conflitam) | **beco sem saída — volta pra linha 0** |
| 0 | 1 | sim | posiciona, recursa... (eventualmente encontra uma solução completa) |

As linhas de "beco sem saída" são onde a poda compensa: a busca abandona uma subárvore inteira de posicionamentos das linhas 2/3 no momento em que a linha 2 fica sem coluna segura, em vez de enumerá-los.

### Backtracking vs. Branch and Bound

[Branch and Bound](branch-and-bound) é backtracking com uma adição: uma função de limite (bound) que estima o melhor resultado ainda alcançável a partir da solução parcial corrente, e poda um ramo no instante em que esse limite não consegue superar a melhor solução completa encontrada até agora. Backtracking puro (como usado em Subsets, Permutations, N-Queens) não tem essa noção — ele é construído pra enumerar configurações válidas, não pra compará-las e escolher uma vencedora. Recorra a Branch and Bound especificamente quando o problema é "encontre a *melhor*," não "encontre *todas*" ou "encontre *uma*."

### Backtracking vs. dynamic programming

Quando os subproblemas de uma busca por backtracking se sobrepõem — o mesmo estado parcial é explorado a partir de múltiplos ramos — o backtracking puro refaz esse trabalho toda vez, exatamente a lacuna que [Dynamic Programming](dynamic-programming-fundamentals) fecha ao guardar em cache o resultado de cada subproblema distinto. Se o espaço de estados de uma solução de backtracking acaba tendo muita sobreposição (muitas chamadas recursivas com argumentos idênticos), memoizar essas chamadas é o que transforma backtracking exponencial em DP polinomial — mesmo esqueleto recursivo, uma linha de cache adicionada.

## Trade-offs

- **O tempo de execução no pior caso é inerentemente exponencial** — a poda reduz drasticamente o espaço de busca *prático* na maioria das entradas reais (esse é todo o objetivo), mas não muda o limite de pior caso, que continua exponencial para instâncias genuinamente difíceis; isso é esperado, não um sinal de que a implementação está errada.
- **A poda só ajuda se a checagem de restrição acontece o mais cedo possível** — validar só numa folha completa (um tabuleiro cheio, uma permutação completa) degenera de volta pra gerar-e-testar, sem nenhum dos benefícios reais do backtracking; a restrição precisa ser checada na primeira chamada recursiva onde ela pode possivelmente falhar.
- **Sem noção embutida de "melhor"** — backtracking encontra *uma* configuração válida ou *todas* elas, mas nada na técnica pura compara candidatos entre si; otimizar entre soluções válidas precisa da contabilidade extra de limite-e-comparação do Branch and Bound.

## Documentation Links

- Steven S. Skiena, *The Algorithm Design Manual*, 3ª Edição (Springer, 2020) — Capítulo 9, "Combinatorial Search," Seção 9.1 "Backtracking" — book
- Donald E. Knuth, "Dancing Links" (2000) — arXiv:cs/0011047 — Algorithm X para o problema de cobertura exata, uma busca eficiente por backtracking aplicada a N-Queens e Sudoku — doc
