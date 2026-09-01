---
version: 1.0
updatedAt: 2026-08-13
title: "Algoritmo de Dijkstra: BFS Generalizado para Grafos Ponderados"
description: "O algoritmo de Dijkstra encontra os caminhos mais curtos em um grafo ponderado com arestas não negativas substituindo a fila FIFO do BFS por uma priority queue ordenada pela distância acumulada, finalizando repetidamente o vértice não processado mais próximo via relaxamento de arestas."
---
## Objetivo

Entenda o algoritmo de Dijkstra como a resposta direta à pergunta que os próprios Trade-offs do concept de breadth-first search deixam em aberto: BFS encontra um caminho mais curto apenas contando saltos, porque uma fila FIFO comum trata toda aresta como custando o mesmo "1 salto". O algoritmo de Dijkstra mantém a forma geral do BFS — crescer para fora a partir da fonte, um vértice de cada vez, nunca revisitando um vértice já finalizado — mas substitui a fila FIFO por uma priority queue ordenada pela distância acumulada, porque agora as arestas carregam pesos diferentes e "explorar na ordem de descoberta" deixa de significar "explorar na ordem de distância". Essa única substituição é toda a generalização.

## Casos de Uso

- Roteamento em redes viárias e GPS, onde estradas têm tempos ou distâncias de viagem diferentes — o *caminho* mais curto raramente é o com menos curvas.
- Protocolos de roteamento de rede (roteamento por estado de link, por exemplo OSPF) computando caminhos de menor custo onde "custo" é um peso de link configurado, não contagem de saltos.
- Qualquer problema de "caminho mais barato de A a B" em grafo ponderado: precificação de itinerário de voo, grafos de custo mais curto livres de arbitragem de moeda, pathfinding de IA de jogo com custo de terreno variável.
- O irmão estrutural do algoritmo de minimum spanning tree de Prim: ambos crescem uma estrutura um vértice de cada vez usando uma priority queue, mas Dijkstra otimiza a distância-a-partir-da-fonte enquanto Prim otimiza o peso total da árvore, e suas regras de relaxamento diferem de acordo.

## Aprofundamento

### Relaxamento: a única operação que todo algoritmo de caminho mais curto compartilha

Antes da estratégia específica do Dijkstra, existe uma única operação primitiva que Dijkstra, Bellman-Ford e DAG shortest paths todos chamam, sem mudança nenhuma, para progredir. Para uma aresta `u -> v` com peso `w`, relaxamento pergunta: "passar por `u` supera o melhor caminho até `v` encontrado até agora?"

```java
void relax(int u, int v, double weight,
            double[] distTo, int[] edgeTo, IndexMinPQ<Double> pq) {
    if (distTo[v] > distTo[u] + weight) {
        distTo[v] = distTo[u] + weight;
        edgeTo[v] = u;
        if (pq.contains(v)) pq.decreaseKey(v, distTo[v]);
        else                pq.insert(v, distTo[v]);
    }
}
```

O pseudocódigo `RELAX(u, v, w)` do CLRS são as mesmas três linhas com `v.d` no lugar de `distTo[v]` e `v.π` no lugar de `edgeTo[v]`: se `v.d > u.d + w(u, v)`, define `v.d = u.d + w(u, v)` e `v.π = u`. Todo algoritmo de caminho mais curto dessa família — Dijkstra, Bellman-Ford e o algoritmo linear para DAG — não faz nada além de chamar esse mesmo procedimento, inicializar `distTo[fonte] = 0` e tudo o mais como infinito, e depois diferem apenas em **quantas vezes** e **em que ordem** relaxam arestas: Dijkstra relaxa cada aresta exatamente uma vez, em uma ordem escolhida por uma priority queue; Bellman-Ford relaxa toda aresta `V - 1` vezes, em qualquer ordem, o que é o que permite tolerar pesos negativos; o algoritmo de DAG relaxa cada aresta uma vez, em ordem topológica. Este concept cobre apenas a ordenação de Dijkstra.

### A estratégia greedy de Dijkstra: sempre finalize o vértice não finalizado mais próximo

O algoritmo de Dijkstra mantém uma priority queue de vértices chaveados pela sua distância tentativa atual (`distTo[]`), e repete um passo: extrai o vértice de distância mínima ainda não finalizado, relaxa todas as suas arestas de saída, e o marca como finalizado. Uma vez finalizado, a distância de um vértice está garantidamente correta e nunca mais é tocada.

```java
distTo[source] = 0.0;
pq.insert(source, 0.0);
while (!pq.isEmpty()) {
    int u = pq.delMin();          // o vértice não finalizado mais próximo
    for (Edge e : adjacent(u)) {
        relax(e.from(), e.to(), e.weight(), distTo, edgeTo, pq);
    }
    // o valor de distTo[] de u agora é final -- nenhum relaxamento futuro pode melhorá-lo
}
```

**Por que extrair o mínimo garante corretude.** Quando `u` sai da fila com a menor distância tentativa, todo outro vértice ainda na fila tem distância tentativa `>= distTo[u]`. Como todos os pesos são não negativos, qualquer caminho da fonte até `u` que passe por um vértice `x` ainda não processado já precisaria cobrir pelo menos `distTo[x] >= distTo[u]` só para alcançar `x` — e então precisaria viajar ainda mais para chegar a `u`, já que pesos não podem ser negativos para encolher essa distância restante. Então nenhum caminho por um vértice não processado pode jamais superar `distTo[u]`. O Teorema 22.6 do CLRS prova isso formalmente por indução no conjunto finalizado `S`; a versão de uma frase acima é o mesmo argumento.

**Trace resolvido.** Fonte `A`, arestas direcionadas ponderadas:

```
A -> B (4)      C -> B (2)      B -> D (1)
A -> C (1)      C -> D (5)      B -> E (7)
                                D -> E (3)
```

| Passo | Vértice extraído (finalizado) | dist(A) | dist(B) | dist(C) | dist(D) | dist(E) |
|------|-------------------------------|---------|---------|---------|---------|---------|
| 0    | — (init)                      | 0       | ∞       | ∞       | ∞       | ∞       |
| 1    | A                             | 0       | 4       | 1       | ∞       | ∞       |
| 2    | C                             | 0       | 3       | 1       | 6       | ∞       |
| 3    | B                             | 0       | 3       | 1       | 4       | 10      |
| 4    | D                             | 0       | 3       | 1       | 4       | 7       |
| 5    | E                             | 0       | 3       | 1       | 4       | 7       |

Trace isso à mão para ver o relaxamento e a escolha greedy interagindo: extrair `A` relaxa `A->B` (4) e `A->C` (1). O mínimo da fila agora é `C` (1), não `B` — então `C` é finalizado em seguida, e relaxar `C->B` encontra `1 + 2 = 3 < 4`, reduzindo a distância tentativa de `B` antes de `B` ser finalizado. Essa reordenação é exatamente o que uma fila FIFO *não conseguiria* fazer: BFS teria finalizado `B` logo depois de `A` (ordem de descoberta), travando o valor errado.

### Veja acontecendo: o mesmo trace, como uma árvore de caminho mais curto

Cada `traverse` abaixo dispara só quando o `edgeTo[]` de um vértice se torna *final* — a aresta registrada no momento em que aquele vértice é retirado da fila e finalizado, não a cada tentativa de relaxamento pelo caminho. `B` recebe um `mark` duas vezes antes de ser `traverse`d: primeiro tentativamente via `A->B` (4), depois de novo via `C->B` (3) — só a segunda, melhor aresta se torna parte da árvore, que é exatamente a reordenação que o trace acima descreve em palavras.

```viz
type: graph
node A A 0 1
node C C 1 0
node B B 1 2
node D D 2 1
node E E 3 1
edge A B directed
edge A C directed
edge C B directed
edge C D directed
edge B D directed
edge B E directed
edge D E directed
---
visit A | Retira "A" da fila (dist 0, a fonte) -- finalizado.
mark B | Relaxa A→B: dist(B) tentativamente 4.
mark C | Relaxa A→C: dist(C) tentativamente 1.
visit C | Retira "C" da fila (dist 1) -- mais perto que B, então finaliza primeiro.
traverse A C | Tree edge: A→C é a aresta final de caminho mais curto de C.
mark B | Relaxa C→B: 1 + 2 = 3 < 4 -- a distância tentativa de B melhora antes de B ser finalizado.
mark D | Relaxa C→D: 1 + 5 = 6 tentativamente.
visit B | Retira "B" da fila (dist 3) -- finalizado.
traverse C B | Tree edge: C→B, não A→B -- o relaxamento anterior nunca se tornou final.
mark D | Relaxa B→D: 3 + 1 = 4 < 6 -- melhora de novo.
mark E | Relaxa B→E: 3 + 7 = 10 tentativamente.
visit D | Retira "D" da fila (dist 4) -- finalizado.
traverse B D | Tree edge: B→D é a aresta final de caminho mais curto de D.
mark E | Relaxa D→E: 4 + 3 = 7 < 10 -- melhora.
visit E | Retira "E" da fila (dist 7) -- finalizado. Dijkstra completo.
traverse D E | Tree edge: D→E é a aresta final de caminho mais curto de E.
```

### Por que pesos não negativos são inegociáveis

O argumento de corretude do Dijkstra acima depende inteiramente de "nenhum caminho por um vértice não processado pode superar a distância recém-finalizada", e esse passo depende dos pesos nunca serem negativos — uma aresta negativa pode fazer um caminho que parecia mais longo se tornar mais curto depois, quando o algoritmo já se comprometeu com a distância de um vértice menor. Aqui está um contraexemplo mínimo e verificado à mão:

```
S -> A (3)
S -> B (2)
A -> B (-2)
```

A distância mais curta real de `S` até `B` é `min(2, 3 + (-2)) = 1`, via `S -> A -> B`. Rodando Dijkstra:

1. Extrai `S` (0). Relaxa `S->A`: `distTo[A] = 3`. Relaxa `S->B`: `distTo[B] = 2`. Fila: `{A: 3, B: 2}`.
2. Extrai o mínimo, `B` (2) — parece mais perto que `A`, então é **finalizado** em `distTo[B] = 2`.
3. Extrai `A` (3), finalizado em `distTo[A] = 3`. Relaxa `A->B`: `3 + (-2) = 1 < 2` — mas `B` já está finalizado e fora da fila, então o Dijkstra padrão nunca o revisita. `distTo[B]` permanece `2`.

Dijkstra reporta `distTo[B] = 2`; a distância mais curta real é `1`. O algoritmo está errado porque finalizou `B` antes de descobrir que um caminho por `A` — que só *parecia* mais distante — na verdade era mais curto uma vez contabilizada sua aresta negativa. Este é precisamente o cenário que Sedgewick e Wayne assinalam ao observar que o algoritmo de Dijkstra "exige que os pesos sejam positivos (ou zero)": pesos negativos precisam do Bellman-Ford em vez disso, que continua relaxando toda aresta por `V - 1` rounds especificamente para que uma aresta negativa descoberta tardiamente ainda tenha a chance de reduzir uma distância anterior.

### A conexão de volta ao BFS

Defina todo peso de aresta como `1` e o comportamento do Dijkstra colapsa exatamente no do BFS. Depois que a fonte é finalizada com distância `0`, todo vizinho recebe distância tentativa `1`; o mínimo da priority queue é `1`, e todo vértice naquela distância sai da fila antes que qualquer vértice na distância `2` possa ser alcançado (já que alcançar a distância `2` exige primeiro relaxar através de um vértice de distância `1`). Uma priority queue que só contém dois, depois três, valores inteiros consecutivos, extraídos em ordem não decrescente, produz exatamente o mesmo cronograma de "tudo na distância k antes de qualquer coisa na distância k+1" que uma fila FIFO dá de graça — só está aplicando esse cronograma via prioridades explícitas em vez de ordem de inserção. O CLRS faz o mesmo ponto diretamente: "você pode pensar no algoritmo de Dijkstra como uma generalização do breadth-first search para grafos ponderados" — uma onda ainda emana da fonte, mas o tempo para a onda atravessar uma aresta é o peso da aresta, não uma unidade fixa.

## Trade-offs

- **Tempo O((V + E) log V) com uma indexed priority queue baseada em binary heap** — o mesmo limite, pelo mesmo motivo estrutural, do algoritmo de minimum spanning tree de Prim: ambos chamam `delMin()` uma vez por vértice e `decreaseKey()`/`insert()` no máximo uma vez por aresta, e ambos pagam `O(log V)` por operação de priority queue por causa do binary heap subjacente (veja o concept irmão de binary-heaps-and-heapsort para o motivo desse limite).
- **A corretude exige estritamente pesos de aresta não negativos** — não existe uma versão parcial dessa restrição; uma única aresta negativa pode tornar uma distância já finalizada errada, como mostrado acima. Grafos com pesos negativos precisam do Bellman-Ford (ou de Dijkstra depois de uma passada de repesagem no estilo do algoritmo de Johnson).
- **Implementação eager vs. lazy é uma escolha de design real** — a versão acima é "eager": usa uma priority queue com index que suporta `decreaseKey()`, então cada vértice ocupa no máximo um slot de priority queue por vez. Uma versão "lazy" simplesmente reinsere um vértice com sua nova chave, mais baixa, a cada relaxamento que melhora, e deixa entradas obsoletas, com chave maior, para o mesmo vértice ficarem na fila para serem ignoradas depois — mais simples de implementar, mas a fila pode crescer para `O(E)` entradas em vez de `O(V)`.
- **O espaço extra é O(V)** (versão eager) — uma entrada de `distTo[]` e uma de `edgeTo[]` por vértice, mais uma priority queue que nunca contém mais que `V` vértices ao mesmo tempo.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 4.4 "Shortest Paths", "Dijkstra's algorithm", pp. 652-657 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 22 "Single-Source Shortest Paths" (Relaxation, pp. 609-611) e Seção 22.3 "Dijkstra's Algorithm", pp. 620-624 — book
- [Princeton Algorithms, 4th Ed. — Shortest Paths (companion site)](https://algs4.cs.princeton.edu/44sp/) — doc
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
