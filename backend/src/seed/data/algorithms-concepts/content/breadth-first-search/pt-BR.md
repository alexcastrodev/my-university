---
version: 1.0
updatedAt: 2026-08-13
title: "Busca em Largura (BFS)"
description: "Como a BFS visita vértices em ordem de distância a partir de uma origem usando uma fila em vez da pilha da DFS, garantindo caminhos mais curtos num grafo não ponderado, traçada contra o próprio grafo de exemplo de Sedgewick."
---
## Objetivo

Entenda a busca em largura (BFS): uma travessia de grafo que visita vértices em ordem de distância a partir de uma origem — um salto de distância, depois dois saltos, depois três — o que a torna a forma padrão de encontrar um caminho mais curto (menos arestas) num grafo não ponderado, algo que a busca em profundidade não consegue garantir de jeito nenhum.

## Casos de Uso

- Encontrar o caminho mais curto (menos saltos) entre dois vértices num grafo não ponderado — os "graus de separação" de uma rede social, um quebra-cabeça de escada de palavras, a rota de saída mais curta de um labirinto.
- O bloco de construção de travessia que outros algoritmos reaproveitam diretamente: o algoritmo de árvore geradora mínima de Prim e o algoritmo de caminho mais curto de Dijkstra generalizam a ideia central da BFS (explorar em seguida o item não explorado mais próximo).
- Processamento em ordem de nível de qualquer grafo ou estrutura em formato de árvore — em qualquer lugar onde "tudo à distância k antes de qualquer coisa à distância k+1" importe.

## Aprofundamento

### Uma fila em vez de uma pilha é a diferença inteira em relação à DFS

A busca em profundidade explora o mais fundo possível antes de retroceder, usando uma pilha (explícita ou a pilha de chamadas via recursão) — dentre as passagens ainda não exploradas, ela sempre continua pela *mais recentemente* encontrada. A BFS faz a pergunta oposta: dentre as passagens ainda não exploradas, continue pela *menos recentemente* encontrada — o que só significa trocar a pilha por uma fila FIFO. Essa única mudança é o que força a ordem de exploração a ser "tudo à distância 1, depois tudo à distância 2, ..." em vez da ordem imprevisível-em-relação-à-distância da DFS.

### O laço central

O `bfs()` de Sedgewick e Wayne mantém uma fila de vértices descobertos-mas-ainda-não-expandidos:

```
coloque o vértice de origem na fila, marque-o
enquanto a fila não estiver vazia:
    remova o próximo vértice v da fila
    para cada vértice w adjacente a v ainda não marcado:
        marque w, defina edgeTo[w] = v, coloque w na fila
```

O pseudocódigo `BFS` do CLRS expressa o mesmo laço com um esquema de três cores em vez de um array booleano `marked[]`: todo vértice começa **branco** (não descoberto); no momento em que é alcançado pela primeira vez ele fica **cinza** (na fronteira, sentado na fila) e recebe um `d` (distância) e `π` (pai) registrados; assim que todos os seus vizinhos foram examinados ele fica **preto** (totalmente processado, atrás da fronteira). Vocabulário diferente, algoritmo idêntico — `marked[]`/`edgeTo[]` e branco-cinza-preto/`d`/`π` são a mesma contabilidade sob dois nomes.

### Veja acontecendo: BFS a partir do vértice 0

O próprio grafo de exemplo de Sedgewick (`tinyG.txt`, vértices 0-5) — observe a travessia guiada pela fila descobrir todo vértice em ordem de distância a partir de 0, construindo a árvore de caminhos mais curtos (arestas azuis) conforme avança:

```viz
type: graph
node 0 0 2 0
node 1 1 3 1
node 2 2 1 1
node 5 5 2 1
node 3 3 1 2
node 4 4 2 2
edge 0 2
edge 0 1
edge 0 5
edge 1 2
edge 2 3
edge 2 4
edge 3 5
edge 3 4
---
visit 0 | Desenfileira "0" (a origem) -- marca como visitado.
traverse 0 2 | Descobre "2" via "0" -- enfileira, aresta de árvore definida.
traverse 0 1 | Descobre "1" via "0" -- enfileira.
traverse 0 5 | Descobre "5" via "0" -- enfileira.
visit 2 | Desenfileira "2" -- "0" e "1" já marcados; "3" e "4" são novos.
traverse 2 3 | Descobre "3" via "2".
traverse 2 4 | Descobre "4" via "2".
visit 1 | Desenfileira "1" -- ambos os vizinhos ("0", "2") já marcados, nada novo.
visit 5 | Desenfileira "5" -- ambos os vizinhos ("3", "0") já marcados, nada novo.
visit 3 | Desenfileira "3" -- todos os vizinhos já marcados.
visit 4 | Desenfileira "4" -- todos os vizinhos já marcados. BFS completa.
```

A ordem de visita — 0, 2, 1, 5, 3, 4 — é exatamente a ordem que o próprio traçado do livro produz, e as arestas azuis da árvore (0-2, 0-1, 0-5, 2-3, 2-4) são a árvore de caminhos mais curtos: o caminho único de 0 até qualquer vértice seguindo só arestas azuis é um caminho mais curto até ele no grafo original.

## Trade-offs

- **O(V + E) de tempo — linear no tamanho do grafo, não um custo escondido** — o CLRS prova isso diretamente a partir da estrutura do algoritmo: a inicialização é O(V), e como cada vértice é enfileirado (e sua lista de adjacência varrida) exatamente uma vez, o trabalho total ao longo de toda a execução é O(V + E), não O(V²) ou pior.
- **A BFS encontra *um* caminho mais curto só quando toda aresta tem o mesmo peso** — ela conta arestas, não distâncias ponderadas; um caminho com mais saltos mas peso total menor seria completamente ignorado. O algoritmo de Dijkstra é o que generaliza essa ideia para grafos ponderados.
- **O custo de memória é proporcional à fronteira mais larga, não ao caminho mais profundo** — a fila da BFS pode guardar todo vértice na distância atual simultaneamente, o que para um grafo largo e raso (uma rede social densamente conectada, por exemplo) pode usar significativamente mais memória no pico do que a pilha da DFS, que só guarda um caminho raiz-até-nó-atual de cada vez.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 4.1 "Undirected Graphs", "Breadth-first search", pp. 538-541 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 20 "Elementary Graph Algorithms", Seção 20.2, pp. 554-561 — book
- [Princeton Algorithms, 4th Ed. — Undirected Graphs (companion site)](https://algs4.cs.princeton.edu/41graph/) — doc
