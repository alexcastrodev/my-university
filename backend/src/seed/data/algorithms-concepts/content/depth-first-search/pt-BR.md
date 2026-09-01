---
version: 1.0
updatedAt: 2026-08-13
title: "Depth-First Search: Travessia Recursiva, Componentes e Classificação de Arestas"
description: "Entenda depth-first search (DFS): uma travessia de grafo que avança o mais fundo possível por um ramo antes de retroceder, tipicamente usando a própria pilha de chamadas recursivas em vez da fila explícita do BFS. Cobre a formulação recursiva, a busca de componentes conectados via DFS repetido, a marcação de tempos de descoberta/término e a estrutura de parênteses, e a classificação de arestas (tree, back, forward, cross) — incluindo como back edges revelam ciclos e como a ordem reversa de tempo de término fundamenta o topological sort."
---
## Objetivo

Entenda depth-first search (DFS): uma travessia de grafo que avança o mais fundo possível por um ramo antes de retroceder, usando uma pilha — quase sempre a própria pilha de chamadas recursivas, sem precisar de nenhuma estrutura de pilha explícita. Onde a ordem guiada por fila do breadth-first search o torna a ferramenta certa para caminhos mais curtos, a estrutura recursiva e de retrocesso do DFS o torna a ferramenta natural para perguntas sobre a *composição* de um grafo: de quantas peças ele é feito, se contém um ciclo, e em que ordem suas dependências se resolvem.

## Casos de Uso

- Encontrar os componentes conectados de um grafo em uma única passada linear — uma única chamada de DFS por vértice não visitado marca exatamente um componente (flood-fill em processamento de imagem, análise de alcançabilidade em uma rede, clusterização em um grafo social).
- Detectar se um grafo contém um ciclo — um DFS que reencontra um ancestral ainda na pilha de chamadas encontrou uma back edge, o que é prova de um ciclo (detecção de deadlock em um grafo de alocação de recursos, validar que um grafo de dependências não tem requisito circular).
- Produzir a ordem de vértices a partir da qual topological sort é construído — rodar DFS em um directed acyclic graph e ler os vértices na ordem reversa de seu tempo de término dá uma ordem topológica válida (agendamento de tarefas, ordenação de pré-requisitos de curso, resolução de dependências de build).

## Aprofundamento

### A formulação recursiva: a pilha de chamadas substitui a fila explícita do BFS

O `DepthFirstSearch` de aquecimento de Sedgewick e Wayne é o algoritmo inteiro em poucas linhas: marque o vértice atual, depois recorra em todo vizinho não marcado. Não há fila, não há pilha explícita — a sequência de "vértices ainda não totalmente explorados" pendentes vive inteiramente nos parâmetros e endereços de retorno das chamadas recursivas atualmente suspensas:

```java
public class DepthFirstSearch {
    private final boolean[] marked;
    private int count;

    public DepthFirstSearch(Graph g, int s) {
        marked = new boolean[g.vertexCount()];
        dfs(g, s);
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        count++;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) {
                dfs(g, w);   // a pilha de chamadas É a pilha de "a explorar"
            }
        }
    }

    public boolean isMarked(int w) { return marked[w]; }
    public int count() { return count; }
}
```

Compare isso com o loop `bfs()` do concept irmão de BFS: BFS retira da fila explícita o vértice descoberto *menos* recentemente, então termina um anel de distância inteiro antes de começar o próximo. DFS, por outro lado, sempre continua pela aresta ainda não explorada descoberta *mais* recentemente — que é exatamente o que acontece automaticamente quando `dfs(g, w)` é chamado antes de o `for` da invocação atual seguir adiante. Troque a recursão por um `Deque` explícito usado como pilha LIFO e você obtém o mesmo comportamento de visitação sem depender da própria pilha de chamadas da JVM; a forma recursiva é simplesmente o caso comum porque não precisa de nenhuma contabilidade extra.

### Componentes conectados via DFS repetido

Um único DFS a partir de um vértice não visitado marca todo vértice alcançável a partir dele — nem mais, nem menos (Proposição A de Sedgewick e Wayne). Essa é precisamente a definição de um componente conectado. Repetir "comece um DFS a partir de qualquer vértice ainda não marcado" até que todo vértice esteja marcado, portanto, encontra *todos* os componentes de um grafo, uma chamada de DFS por componente, com um id de componente sendo atribuído ao longo do caminho:

```java
public class ConnectedComponents {
    private final boolean[] marked;
    private final int[] id;   // id[v] = índice do componente contendo v
    private int count;

    public ConnectedComponents(Graph g) {
        marked = new boolean[g.vertexCount()];
        id = new int[g.vertexCount()];
        for (int s = 0; s < g.vertexCount(); s++) {
            if (!marked[s]) {
                dfs(g, s);
                count++;
            }
        }
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        id[v] = count;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
    }

    public boolean connected(int v, int w) { return id[v] == id[w]; }
    public int count() { return count; }
}
```

Exemplo resolvido — um grafo de 7 vértices com arestas `0-1`, `1-2`, `0-2` (um triângulo), `3-4` e `5-6`, listas de adjacência ordenadas ascendentemente:

```text
s=0  não marcado -> dfs(0): marca 0 (id=0)
       -> dfs(1): marca 1 (id=0)   [primeiro vizinho não marcado de 0]
            -> dfs(2): marca 2 (id=0)   [vizinho não marcado de 1]
                 vizinhos 0,1 de 2 já marcados -> retorna
            vizinho restante de 1 (2) já marcado -> retorna
       vizinho restante de 0 (2) já marcado -> retorna
     componente 0 pronto: {0, 1, 2} -- count vira 1

s=1  marcado, pula
s=2  marcado, pula

s=3  não marcado -> dfs(3): marca 3 (id=1)
       -> dfs(4): marca 4 (id=1)
            vizinho 3 de 4 já marcado -> retorna
     componente 1 pronto: {3, 4} -- count vira 2

s=4  marcado, pula

s=5  não marcado -> dfs(5): marca 5 (id=2)
       -> dfs(6): marca 6 (id=2)
            vizinho 5 de 6 já marcado -> retorna
     componente 2 pronto: {5, 6} -- count vira 3

Resultado: 3 componentes -- {0,1,2}, {3,4}, {5,6}
```

Nada nesse loop é específico do DFS em princípio — qualquer travessia que marque totalmente tudo alcançável a partir de uma fonte antes de seguir em frente funcionaria — mas o `dfs()` recursivo torna o idioma "marque tudo alcançável, depois vá para o próximo vértice não marcado" um acréscimo de duas linhas ao aquecimento. O loop baseado em fila do BFS pode ser adaptado para fazer o mesmo loop externo, mas é a aplicação de componentes conectados do DFS que Sedgewick e Wayne apresentam primeiro, precisamente porque a estrutura recursiva torna o raciocínio ("todo vértice marcado está conectado à fonte, e nenhum vértice não marcado pode estar") tão direto.

### Tempos de descoberta e término: a estrutura de parênteses

O `DFS-VISIT` do CLRS marca cada vértice duas vezes com timestamp: `v.d` (tempo de descoberta) quando o vértice é alcançado pela primeira vez e pintado de cinza, e `v.f` (tempo de término) quando toda a sua lista de adjacência foi examinada e ele é pintado de preto. Um relógio global incrementa a cada descoberta e a cada término, então com `V` vértices os timestamps vão de `1` a `2V`:

```java
public class DepthFirstTimes {
    private final boolean[] marked;
    private final int[] discovery;
    private final int[] finish;
    private int clock;

    public DepthFirstTimes(Graph g) {
        int n = g.vertexCount();
        marked = new boolean[n];
        discovery = new int[n];
        finish = new int[n];
        for (int v = 0; v < n; v++) {
            if (!marked[v]) dfs(g, v);
        }
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        discovery[v] = ++clock;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
        finish[v] = ++clock;   // todo descendente já foi totalmente explorado
    }
}
```

Rodando isso no mesmo grafo de 6 vértices usado no trace de viz abaixo (arestas `0-2`, `0-1`, `0-5`, `1-2`, `2-3`, `2-4`, `3-5`, `3-4`, listas de adjacência na ordem de declaração das arestas), traçando a recursão à mão exatamente como o próprio trace do livro de Sedgewick e Wayne faz para esse grafo:

| vértice | descoberta | término |
|---|---|---|
| 0 | 1 | 12 |
| 2 | 2 | 11 |
| 1 | 3 | 4 |
| 3 | 5 | 10 |
| 5 | 6 | 7 |
| 4 | 8 | 9 |

O Teorema do Parêntese do CLRS (20.7) diz que, para quaisquer dois vértices, seus intervalos `[d, f]` são completamente aninhados ou completamente disjuntos — nunca parcialmente sobrepostos. Ler a tabela como intervalos confirma isso: `[1,12]` (vértice 0) contém `[2,11]` (vértice 2), que contém tanto `[3,4]` (vértice 1) quanto `[5,10]` (vértice 3); `[5,10]`, por sua vez, contém tanto `[6,7]` (vértice 5) quanto `[8,9]` (vértice 4). Os dois pares de irmãos — `[3,4]` versus `[5,10]`, e `[6,7]` versus `[8,9]` — são disjuntos, exatamente como o teorema prevê para vértices onde nenhum é descendente do outro. Aninhamento significa "descendente na árvore de DFS"; disjunção significa "ramos não relacionados" — e esse único fato é a base formal para classificar toda aresta que o DFS encontra.

### Classificação de arestas: tree, back, forward, cross — e por que back edges significam um ciclo

Quando o DFS explora uma aresta `(u, v)`, a cor de `v` naquele momento diz que tipo de aresta é: **branco** significa que `v` não foi descoberto, então `(u, v)` vira uma **tree edge**; **cinza** significa que `v` é um ancestral de `u` ainda na pilha de chamadas, então `(u, v)` é uma **back edge**; **preto** significa que `v` já terminou, então `(u, v)` é uma **forward edge** ou **cross edge**. No grafo resolvido acima, a classificação é:

- **Tree edges** (5, correspondendo às 5 chamadas recursivas que descobriram um vértice novo): `0-2`, `2-1`, `2-3`, `3-5`, `3-4`.
- **Back edges** (3, as arestas restantes): `1-0` (encontrada enquanto `0` ainda estava cinza, ou seja, um ancestral), `5-0`, `4-2`.

O Teorema 20.10 do CLRS afirma que o DFS de um grafo *não direcionado* só produz tree edges e back edges — forward e cross edges só são possíveis em grafos direcionados, porque em um grafo não direcionado a primeira exploração da aresta `(u, v)` sempre acontece enquanto pelo menos um dos extremos ainda está cinza, forçando a aresta a ser classificada como tree ou back nesse primeiro encontro. É exatamente por isso que cada uma das 8 arestas acima cai em um desses dois grupos, sem sobrar nenhuma.

Back edges são o motivo pelo qual o DFS é a forma padrão de detectar um ciclo: uma back edge `(u, v)` existe precisamente quando `v` é ancestral de `u` no caminho atual do DFS, o que significa que o caminho da árvore de `v` até `u` mais a aresta de volta de `u` para `v` forma um ciclo. A classe `Cycle` de Sedgewick e Wayne checa exatamente isso, rastreando a aresta pela qual acabou de chegar (`u`) para não confundir o trivial "voltar pela mesma aresta não direcionada" com um ciclo:

```java
public class Cycle {
    private final boolean[] marked;
    private boolean hasCycle;

    public Cycle(Graph g) {
        marked = new boolean[g.vertexCount()];
        for (int s = 0; s < g.vertexCount(); s++) {
            if (!marked[s]) dfs(g, s, s);
        }
    }

    private void dfs(Graph g, int v, int parent) {
        marked[v] = true;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) {
                dfs(g, w, v);
            } else if (w != parent) {
                hasCycle = true;   // alcançou um vértice marcado que não é o pai -- uma back edge
            }
        }
    }

    public boolean hasCycle() { return hasCycle; }
}
```

A classificação de arestas também fundamenta o topological sort: para um directed acyclic graph, rodar DFS até o fim e depois ler os vértices na **ordem reversa de tempo de término** produz uma ordem topológica válida — toda aresta `u -> v` tem `u.f > v.f`, então listar os vértices do maior para o menor tempo de término garante que todo vértice apareça antes de tudo que ele aponta. O CLRS prova isso na Seção 20.4; não é implementado aqui já que topological sort é seu próprio concept, mas a contabilidade de tempo de término acima é exatamente o mecanismo em que ele se apoia.

### Veja acontecendo: DFS a partir do vértice 0 (mesmo grafo do trace de BFS)

Mesmo grafo, mesma fonte, mesma ordem de adjacência do trace do concept irmão de BFS — então a ordem de visita abaixo pode ser comparada diretamente com o `0, 2, 1, 5, 3, 4` do BFS:

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
visit 0 | Chama dfs(0) -- marca "0" visitado, a raiz da árvore de DFS.
traverse 0 2 | "2" é o primeiro na lista de adjacência de 0 e não marcado -- recorre em dfs(2): tree edge.
visit 2 | dfs(2) marca "2" visitado.
traverse 2 1 | "0" na lista de 2 já está marcado (pula); "1" é o próximo e não marcado -- recorre em dfs(1): tree edge.
visit 1 | dfs(1) marca "1" visitado -- ambos os seus vizinhos ("0","2") já estão marcados, então retorna imediatamente (back edges).
traverse 2 3 | Retrocede para o loop de dfs(2); "3" é o próximo vizinho não marcado -- recorre em dfs(3): tree edge.
visit 3 | dfs(3) marca "3" visitado.
traverse 3 5 | "5" é o primeiro na lista de adjacência de 3 e não marcado -- recorre em dfs(5): tree edge.
visit 5 | dfs(5) marca "5" visitado -- ambos os seus vizinhos ("3","0") já estão marcados, então retorna imediatamente (back edges).
traverse 3 4 | Retrocede para o loop de dfs(3); "4" é o próximo vizinho não marcado -- recorre em dfs(4): tree edge.
visit 4 | dfs(4) marca "4" visitado -- ambos os seus vizinhos ("3","2") já estão marcados. O retrocesso agora desenrola tudo até dfs(0); nada resta não marcado. DFS completo.
```

A ordem de visita — 0, 2, 1, 3, 5, 4 — bate com o próprio trace manual desse grafo exato feito por Sedgewick e Wayne, e difere do `0, 2, 1, 5, 3, 4` do BFS exatamente no ponto que se esperaria: DFS se compromete com toda a subárvore do vértice 3 (descobrindo 3, depois 5, depois 4) antes de sequer voltar para qualquer coisa que o BFS teria enfileirado antes, enquanto BFS termina todo o anel de distância 1 (2, 1, 5) antes de tocar na distância 2.

## Trade-offs

- **O(V + E) de tempo — o mesmo limite do BFS, pelo mesmo motivo subjacente.** A análise agregada do CLRS se aplica aqui como se aplicou ao BFS: `DFS-VISIT` é chamado exatamente uma vez por vértice (já que a primeira coisa que faz é pintar o vértice de cinza, garantindo que nunca rode duas vezes no mesmo vértice), e a lista de adjacência de cada vértice é varrida exatamente uma vez durante toda a execução, então o trabalho total é Θ(V + E).
- **DFS recursivo arrisca um stack overflow que a fila explícita do BFS nunca arrisca.** A profundidade da pilha de chamadas cresce com a profundidade do caminho, não com o número de vértices explorados até agora — um grafo longo e fino (um caminho em forma de lista encadeada de 200.000 vértices, digamos) pode estourar a pilha padrão de uma thread da JVM antes mesmo de o DFS retroceder. Uma reescrita do DFS com pilha explícita, não recursiva, evita isso ao custo de gerenciar manualmente a posição de "qual vizinho eu estava prestes a checar" que a recursão rastreia de graça.
- **DFS não dá garantia alguma de caminho mais curto.** Como Sedgewick e Wayne colocam, os caminhos do DFS "tendem a ser longos e sinuosos" — um caminho que o DFS por acaso encontra da fonte até o destino pode ser muito mais longo do que o necessário, porque o DFS se compromete com qualquer aresta não explorada que viu mais recentemente, em vez da mais próxima da fonte. Se caminho mais curto é o objetivo real, BFS (não ponderado) ou o algoritmo de Dijkstra (ponderado) é a travessia certa, não DFS.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 4.1 "Undirected Graphs", "Depth-first search" e "Connected components", pp. 530-537, 543-547 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 20 "Elementary Graph Algorithms", Seção 20.3 "Depth-first search", pp. 563-572 — book
- [Princeton Algorithms, 4th Ed. — Undirected Graphs (companion site)](https://algs4.cs.princeton.edu/41graph/) — doc
