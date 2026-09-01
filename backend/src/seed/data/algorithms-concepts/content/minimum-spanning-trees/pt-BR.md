---
version: 1.0
updatedAt: 2026-08-13
title: "Minimum Spanning Trees: A Propriedade do Corte, Prim e Kruskal"
description: "Como os algoritmos de Prim e Kruskal exploram a propriedade do corte para construir greedily uma minimum spanning tree — Prim crescendo uma única árvore via priority queue, Kruskal ordenando todas as arestas e usando union-find para pular as que fechariam ciclo — traçado em um exemplo de 6 vértices verificado à mão e contrastado para grafos densos vs. esparsos."
---
## Objetivo

Entenda o problema da minimum spanning tree (MST) — dado um grafo conectado, não direcionado e ponderado por aresta, encontre o subconjunto de arestas que conecta todo vértice com o menor peso total possível, formando uma árvore (exatamente V-1 arestas, sem ciclos) em vez de um subgrafo conectado qualquer — e a única ideia, a propriedade do corte, na qual os dois algoritmos clássicos de MST (Prim e Kruskal) se apoiam para provar que estão corretos.

## Casos de Uso

- Projeto de rede: cabear um prédio, instalar fibra ou rotear linhas de energia/água para conectar todo ponto com o menor custo de material.
- Clusterização: rodar o Kruskal parcialmente e parar K-1 arestas antes divide o grafo em K clusters naturais (clusterização single-linkage) — os componentes de union-find que o algoritmo já estava rastreando *são* os clusters.
- Um bloco de construção para algoritmos de aproximação em problemas mais difíceis — a clássica 2-aproximação para o TSP métrico, e aproximações de Steiner tree, ambas começam computando uma MST.

## Aprofundamento

### O problema da MST e a propriedade do corte

Uma spanning tree de um grafo conectado é um subgrafo conectado e acíclico que toca todo vértice — o que a força a ter exatamente V-1 arestas (uma aresta a mais fecharia um ciclo, uma a menos desconectaria). Uma **minimum spanning tree** é uma spanning tree cujo peso total de arestas não é maior que o de nenhuma outra spanning tree.

Um **corte** é uma partição dos vértices do grafo em dois conjuntos não vazios. Uma **aresta cruzando o corte** conecta um vértice em um conjunto a um vértice no outro. Tome este pequeno grafo de 6 vértices e 9 arestas:

```
A-B 4   A-C 2   B-C 1
B-D 5   C-D 8   C-E 9
D-E 3   D-F 6   E-F 7
```

O corte `{A, B, C}` vs. `{D, E, F}` tem três arestas cruzando: `B-D` (5), `C-D` (8), `C-E` (9). A de menor peso é `B-D` (5).

**Propriedade do corte.** Para qualquer corte de um grafo ponderado por aresta, a aresta cruzando de menor peso está em *alguma* minimum spanning tree do grafo (Proposição J de Sedgewick & Wayne; Teorema 21.1 de Cormen et al., formulado ali como: uma aresta *leve* cruzando um corte que respeita uma MST-em-construção parcial `A` é sempre segura de adicionar a `A`). A prova é um argumento de troca do tipo cut-and-paste: suponha que uma MST `T` *não* contenha a aresta cruzando mínima `e`. Adicionar `e` a `T` cria um ciclo, e esse ciclo precisa conter pelo menos mais uma aresta `f` que também cruza o mesmo corte (já que o ciclo tem que cruzar de volta). Como `e` é a aresta cruzando de menor peso, `weight(e) <= weight(f)`. Trocar `f` por `e` produz outra spanning tree com peso total não maior que o de `T` — então uma árvore que omite a aresta cruzando mínima nunca foi estritamente melhor, e sempre pode ser substituída por uma que a inclua.

Esse único fato é o que os dois algoritmos abaixo exploram, apenas escolhendo *qual* corte olhar de forma diferente: Prim sempre usa o corte entre "vértices na árvore até agora" e "vértices ainda fora da árvore"; Kruskal usa, implicitamente, o corte entre os dois componentes atuais dos extremos de cada aresta.

### Algoritmo de Prim

Prim cresce uma única árvore a partir de um vértice inicial arbitrário. A cada passo, adiciona a aresta de menor peso conectando um vértice já na árvore a um vértice que não está — reaplicando repetidamente a propriedade do corte ao corte `(vértices da árvore, vértices fora da árvore)`. A implementação "lazy" (`LazyPrimMST` de Sedgewick & Wayne) mantém toda aresta saindo da árvore em uma priority queue e deixa arestas obsoletas, com ambos os extremos já na árvore, ficarem lá até serem removidas e descartadas:

```java
final class Edge implements Comparable<Edge> {
    private final int v, w;
    private final double weight;

    Edge(int v, int w, double weight) {
        this.v = v;
        this.w = w;
        this.weight = weight;
    }

    double weight() { return weight; }
    int either() { return v; }

    int other(int vertex) {
        if (vertex == v) return w;
        if (vertex == w) return v;
        throw new IllegalArgumentException("not an endpoint of this edge");
    }

    public int compareTo(Edge that) { return Double.compare(this.weight, that.weight); }
}

final class LazyPrimMST {
    private final boolean[] marked;
    private final PriorityQueue<Edge> pq = new PriorityQueue<>();
    private final List<Edge> mstEdges = new ArrayList<>();

    LazyPrimMST(Map<Integer, List<Edge>> adj, int source, int vertexCount) {
        marked = new boolean[vertexCount];
        visit(adj, source);
        while (!pq.isEmpty()) {
            Edge e = pq.poll();
            int v = e.either(), w = e.other(v);
            if (marked[v] && marked[w]) continue;   // ambos os extremos já na árvore -- obsoleta, descarta
            mstEdges.add(e);
            if (!marked[v]) visit(adj, v);
            if (!marked[w]) visit(adj, w);
        }
    }

    private void visit(Map<Integer, List<Edge>> adj, int v) {
        marked[v] = true;
        for (Edge e : adj.get(v))
            if (!marked[e.other(v)]) pq.offer(e);   // enfileira toda aresta saindo do novo vértice da árvore
    }
}
```

`PriorityQueue<Edge>` aqui é a priority queue comum do Java, baseada em binary heap — a mecânica de como `offer`/`poll` mantêm o mínimo no topo é exatamente o que o concept de binary heaps deste módulo cobre; a parte interessante do Prim não é o heap, é *o quê* entra na fila e *quando*.

Traçando o `LazyPrimMST` começando em `A` no grafo acima (cada passo remove a verdadeira aresta cruzando mínima, já que com apenas 6 vértices nenhuma entrada obsoleta chega à frente primeiro por acaso):

```viz
type: graph
node A A 1 0
node B B 0 1
node C C 1 1
node D D 2 1
node E E 1 2
node F F 2 2
edge A B
edge A C
edge B C
edge B D
edge C D
edge C E
edge D E
edge D F
edge E F
---
visit A | Começa a árvore em "A" (raiz arbitrária) -- marca.
traverse A C | Aresta mais barata saindo da árvore: A-C, peso 2 -- remove da PQ.
visit C | "C" entra na árvore; suas arestas incidentes (C-D 8, C-E 9) entram na PQ.
traverse C B | Aresta cruzando mais barata agora: B-C, peso 1.
visit B | "B" entra na árvore; B-D (5) entra na PQ. A-B agora está obsoleta (ambos os extremos na árvore).
traverse B D | Aresta cruzando mais barata agora: B-D, peso 5.
visit D | "D" entra na árvore; D-E (3), D-F (6) entram na PQ. C-D agora está obsoleta.
traverse D E | Aresta cruzando mais barata agora: D-E, peso 3.
visit E | "E" entra na árvore; E-F (7) entra na PQ. C-E agora está obsoleta.
traverse D F | Aresta cruzando restante mais barata: D-F, peso 6.
visit F | "F" entra na árvore. 5 arestas adicionadas, peso total 2+1+5+3+6 = 17. MST completa.
```

### Algoritmo de Kruskal

Kruskal ignora a estrutura de árvore inteiramente: ordena *todas* as arestas por peso ascendente, depois percorre a lista ordenada, adicionando greedily cada aresta a uma floresta crescente a menos que seus dois extremos já estejam conectados dentro dessa floresta (o que fecharia um ciclo). "Esses dois extremos já estão conectados?" é exatamente a consulta que uma estrutura disjoint-set (union-find) responde em tempo quase constante — o concept irmão de Union-Find / Disjoint Sets deste módulo constrói essa estrutura desde quick-find até weighted quick-union com path compression; o Kruskal é o motivo canônico para ela existir.

```java
final class KruskalMST {
    private final List<Edge> mstEdges = new ArrayList<>();

    KruskalMST(List<Edge> edges, int vertexCount) {
        List<Edge> sorted = new ArrayList<>(edges);
        sorted.sort(Comparator.naturalOrder());   // O(E log E) -- o gargalo do algoritmo

        UF uf = new UF(vertexCount);               // union-find ponderado com path compression
        for (Edge e : sorted) {
            if (mstEdges.size() == vertexCount - 1) break;   // V-1 arestas encontradas, MST completa
            int v = e.either(), w = e.other(v);
            if (uf.connected(v, w)) continue;                 // fecharia um ciclo -- pula
            uf.union(v, w);
            mstEdges.add(e);
        }
    }

    List<Edge> edges() { return mstEdges; }
}
```

Traçando o `KruskalMST` no mesmo grafo (`UF` começa com os 6 vértices em seus próprios componentes singleton):

| Aresta | Peso | `uf.connected(v, w)`? | Ação | Total acumulado |
|---|---|---|---|---|
| B-C | 1 | não | adiciona, union(B, C) | 1 |
| A-C | 2 | não | adiciona, union(A, C) | 3 |
| D-E | 3 | não | adiciona, union(D, E) | 6 |
| A-B | 4 | **sim** — A e B já estão em `{A, B, C}` | pula, fecharia um ciclo | 6 |
| B-D | 5 | não | adiciona, union(B, D) — mescla `{A,B,C}` e `{D,E}` | 11 |
| D-F | 6 | não | adiciona, union(D, F) | 17 |

O loop para aqui — `mstEdges.size() == vertexCount - 1 == 5` — sem nunca olhar para `E-F` (7), `C-D` (8) ou `C-E` (9). As cinco arestas aceitas são exatamente o mesmo conjunto que o Prim encontrou (`B-C`, `A-C`, `D-E`, `B-D`, `D-F`), mesmo peso total 17, como a propriedade do corte garante para um grafo com todos os pesos de aresta distintos.

### Quando preferir cada um

A própria tabela de desempenho de Sedgewick & Wayne (Seção 4.3) resume os limites assintóticos diretamente, para um grafo com V vértices e E arestas:

| Algoritmo | Espaço extra | Tempo no pior caso |
|---|---|---|
| Prim lazy | O(E) | O(E log E) |
| Prim eager (index priority queue) | O(V) | O(E log V) |
| Kruskal | O(E) | O(E log E) |

Como `E <= V^2` sempre, `log E = O(log V)` independentemente da densidade do grafo, então nenhum dos dois algoritmos tem um expoente *assintótico* estritamente melhor que o outro em geral — a diferença real está em quanto trabalho cada um é forçado a fazer de antemão e quanto espaço precisa:

- **Grafos densos (E próximo de V^2) favorecem o Prim.** O Kruskal precisa ordenar a lista de arestas *inteira* antes de sequer tocar o union-find, e para um grafo denso isso é um custo inicial grande mesmo que apenas V-1 dessas E arestas acabem na MST. O Prim eager nunca precisa da lista de arestas completa ordenada — descobre cada próxima aresta mais barata incrementalmente a partir de uma priority queue guiada por lista de adjacência, indexada por vértices (apenas O(V) entradas), então faz menos trabalho total e usa menos memória quando E é quadrático em V.
- **Grafos esparsos (E próximo de V) — ou arestas que já chegam ordenadas ou como um stream — favorecem o Kruskal.** Com E proporcional a V, a ordenação O(E log E) já é barata de início, e se a entrada já está ordenada (ou as arestas chegam incrementalmente em ordem, por exemplo de uma fusão externa), o Kruskal pula totalmente o passo de ordenação e seu custo colapsa em direção ao custo quase linear das operações de union-find sozinhas.
- **O Kruskal produz um subproduto reutilizável.** A estrutura union-find que ele constrói ao longo do caminho é diretamente útil para outros propósitos (por exemplo, clusterização single-linkage); a index priority queue do Prim sobre vértices não tem uso secundário comparável.

## Trade-offs

- **Os dois algoritmos funcionam corretamente com pesos de aresta zero ou negativos** — diferente do algoritmo de caminho mais curto de Dijkstra, nada na prova da propriedade do corte assume pesos positivos; algoritmos de MST só comparam arestas entre si, nunca contra um total de distância acumulado.
- **Uma MST única só é garantida quando todos os pesos de aresta são distintos** — com pesos empatados, o passo-chave da prova da propriedade do corte (a aresta trocada é *estritamente* mais leve) deixa de forçar uma resposta única, e múltiplas minimum spanning trees podem existir; os dois algoritmos ainda retornam *uma* MST correta sem nenhuma modificação.
- **O Kruskal precisa de uma checagem eficiente de "esses dois vértices já estão conectados?" em toda aresta que considera; o Prim não** — o Prim só pergunta "esse único vértice já está marcado", uma simples consulta a array booleano, enquanto a checagem de conectividade do Kruskal por toda a floresta crescente é exatamente para o que o union-find (veja o concept irmão de Union-Find / Disjoint Sets) foi construído.
- **O Kruskal é geralmente mais lento que o Prim na prática, apesar de bater em big-O** — tanto Cormen quanto Sedgewick & Wayne observam que ele precisa fazer uma checagem `connected()` para essencialmente toda aresta, além do mesmo trabalho no estilo priority-queue que o Prim faz, então os fatores constantes do mundo real tendem a favorecer o Prim mesmo em grafos onde os limites assintóticos empatam.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 4.3 "Minimum Spanning Trees," pp. 604-629 — doc
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 21 "Minimum Spanning Trees," pp. 585-601 — doc
