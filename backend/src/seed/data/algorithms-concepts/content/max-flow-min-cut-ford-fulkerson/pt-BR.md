---
version: 1.0
updatedAt: 2026-08-13
title: "Fluxo Máximo e Corte Mínimo: Caminhos de Aumento e Ford-Fulkerson"
description: "Como Ford-Fulkerson encontra o fluxo máximo através de uma rede com capacidades, empurrando repetidamente fluxo ao longo de caminhos de aumento em um grafo residual, e por que o teorema do fluxo máximo e corte mínimo garante que o ponto de parada do algoritmo é comprovadamente ótimo."
---
## Objetivo

Entenda o problema do fluxo máximo — dado um grafo direcionado onde toda aresta tem uma capacidade, mais uma origem `s` e um destino `t`, encontre a maior taxa possível de fluxo de `s` até `t` sem exceder a capacidade de nenhuma aresta — e o método de Ford-Fulkerson que o resolve: encontrar repetidamente um *caminho de aumento* em um *grafo residual* e empurrar mais fluxo ao longo dele, até que a condição de parada do teorema do fluxo máximo e corte mínimo (nenhum caminho de aumento restante) certifique que o fluxo encontrado é comprovadamente máximo.

## Casos de Uso

- Reduzir outros problemas combinatórios a um único cálculo de fluxo máximo: emparelhamento bipartido (o assunto da seção seguinte de Cormen et al., 24.3), segmentação de imagem, eliminação no beisebol e escalonamento de tripulação de companhia aérea todos se reduzem a "construa a rede de fluxo certa, depois rode Ford-Fulkerson."
- Planejamento de capacidade literal: encontrar o verdadeiro limite de vazão de um oleoduto, rede rodoviária ou sistema de distribuição onde todo link tem uma capacidade fixa — o cenário motivador original de ambos os livros-fonte.
- Encontrar o gargalo, não só o número: o corte mínimo que sai do mesmo cálculo identifica exatamente quais arestas alargar para aumentar a vazão geral — fluxo máximo e corte mínimo são duas visões de uma mesma resposta, não dois algoritmos separados.

## Aprofundamento

### O modelo de rede de fluxo e o problema do fluxo máximo

Uma **rede de fluxo** é um grafo direcionado no qual toda aresta `(u, v)` tem uma capacidade não negativa `c(u, v)`, mais dois vértices distintos: uma origem `s` e um destino `t`. Um **fluxo st** atribui um fluxo não negativo `f(u, v)` a toda aresta, sujeito a duas regras (Cormen et al., Seção 24.1):

- **Restrição de capacidade** — `0 <= f(u, v) <= c(u, v)` para toda aresta: um fluxo não pode ser negativo nem exceder a capacidade da aresta.
- **Conservação de fluxo** — para todo vértice exceto `s` e `t`, o influxo total é igual ao efluxo total: nada se acumula nem é criado em um vértice intermediário.

O **valor** de um fluxo é o fluxo líquido saindo da origem (equivalentemente, por conservação, o fluxo líquido entrando no destino — a Proposição E de Sedgewick & Wayne e seu corolário provam que os dois são sempre iguais). O **problema do fluxo máximo** é: encontrar um fluxo st com o maior valor possível.

Aqui está uma pequena rede concreta — seis vértices, origem `0`, destino `5` — usada no restante deste concept (é o próprio exemplo `tinyFN.txt` de Sedgewick & Wayne):

```
0->1  capacidade 2       0->2  capacidade 3
1->3  capacidade 3       1->4  capacidade 1
2->3  capacidade 1       2->4  capacidade 1
3->5  capacidade 2       4->5  capacidade 3
```

A capacidade total de saída da origem é `2 + 3 = 5`; a capacidade total de entrada do destino é `2 + 3 = 5`. Esses números só limitam a resposta por cima — como o trace resolvido abaixo mostra, o verdadeiro fluxo máximo aqui é `4`, não `5`, por causa de um gargalo mais estreito, mais profundo na rede.

### Caminhos de aumento e o grafo residual — por que a aresta reversa não é opcional

O método de Ford e Fulkerson (1962) é genuinamente simples de enunciar:

> Comece com fluxo zero em todo lugar. Enquanto existir um **caminho de aumento** — um caminho de `s` até `t` ao longo do qual ainda dá para empurrar mais fluxo — empurre o máximo de fluxo adicional que o gargalo daquele caminho permitir. Pare quando nenhum caminho de aumento restar.

A parte fácil de errar é o que conta como "um caminho ao longo do qual ainda dá para empurrar mais fluxo". Não são *apenas* caminhos com capacidade sobrando para frente. Dado um fluxo `f`, o **grafo residual** `Gf` tem, para toda aresta original `u -> v` com capacidade `c` e fluxo atual `f`:

- uma **aresta residual para frente** `u -> v` com capacidade residual `c - f`, presente sempre que `f < c` (capacidade não usada — empurrar fluxo aqui aumenta `f(u, v)`);
- uma **aresta residual para trás** `v -> u` com capacidade residual `f`, presente sempre que `f > 0` (fluxo já comprometido — empurrar fluxo aqui *subtrai* de `f(u, v)`, ou seja, "muda de ideia" sobre uma unidade de fluxo já atribuída).

Um caminho de aumento é simplesmente qualquer caminho `s -> t` nesse grafo residual. CLRS chama de *cancelamento* empurrar fluxo por uma aresta residual para trás: se 5 unidades fluem atualmente `u -> v` e um caminho de aumento posterior roteia 2 unidades de volta por `v -> u`, o efeito líquido é o mesmo que se apenas 3 unidades tivessem sido enviadas `u -> v` desde o início — a aresta para trás permite que o algoritmo desfaça parte de um compromisso anterior, agora subótimo, em vez de ficar preso a ele.

**Por que isso não é opcional — um exemplo resolvido.** Rode uma versão *só-para-frente* (sem arestas para trás) do algoritmo na rede de seis vértices acima, origem `0`, destino `5`:

1. Caminho `0 -> 1 -> 3 -> 5`: gargalo = `min(2, 3, 2) = 2`. Empurra 2. Valor do fluxo: `2`.
2. Caminho `0 -> 2 -> 4 -> 5`: gargalo = `min(3, 1, 3) = 1`. Empurra 1. Valor do fluxo: `3`.

Nesse ponto, a aresta `0->1` está cheia (`2/2`) e a aresta `3->5` está cheia (`2/2`). Checando toda aresta *para frente* restante a partir de `0`: `0->2` ainda tem 2 unidades de capacidade sobrando, levando a `2 -> 3` (1 unidade sobrando) — mas a única aresta de saída de `3`, `3->5`, já está cheia. Toda outra rota para frente a partir de `0` está bloqueada da mesma forma. Uma busca só-para-frente não encontra **mais nenhum caminho de aumento** e reporta incorretamente um fluxo máximo de `3`.

Mas `1->3` atualmente carrega fluxo (`2` unidades) — então o grafo *residual* tem uma aresta para trás `3 -> 1` com capacidade residual `2`, que uma busca só-para-frente nunca considera. Usando-a:

3. Caminho `0 -> 2 -> 3 -> (residual) 1 -> 4 -> 5`: para frente `0->2` (2 sobrando) e `2->3` (1 sobrando), depois para trás `3->1` (desfaz 1 das 2 unidades em `1->3`, liberando capacidade para `1` enviar fluxo a outro lugar), depois para frente `1->4` (1 sobrando) e `4->5` (2 sobrando). Gargalo = `min(2, 1, 2, 1, 2) = 1`. Empurra 1. Valor do fluxo: `4`.

Esse é o verdadeiro fluxo máximo, e só foi alcançável empurrando fluxo para trás, contra um compromisso anterior. A aresta para trás é o que torna a ideia de caminho de aumento correta em geral, não apenas um ajuste de desempenho.

### O teorema do fluxo máximo e corte mínimo, traçado até a convergência

Um **corte** em uma rede de fluxo é uma partição dos vértices em dois conjuntos, `S` contendo `s` e `T` contendo `t`. Sua **capacidade** é a soma das capacidades das arestas cruzando *de* `S` *para* `T` (arestas cruzando na direção oposta não contam para a capacidade — só para o fluxo, o que é o que faz o teorema funcionar; Cormen et al., Seção 24.2). Um **corte mínimo** é uma partição `S`/`T` da menor capacidade possível.

**Teorema do fluxo máximo e corte mínimo** (Proposição F de Sedgewick & Wayne; Teorema 24.6 de CLRS). Para qualquer fluxo `f`, estas três afirmações são equivalentes:

1. Existe um corte cuja capacidade é igual ao valor de `f`.
2. `f` é um fluxo máximo.
3. Não existe caminho de aumento em relação a `f` no grafo residual.

A prova de (3) => (1) é construtiva, e é exatamente o que identifica o corte mínimo assim que Ford-Fulkerson para: seja `S` todo vértice ainda alcançável a partir de `s` no grafo residual quando nenhum caminho de aumento resta, e `T` o restante. `t` precisa estar em `T` (senão haveria um caminho de aumento). Toda aresta cruzando `S -> T` precisa estar **saturada** (cheia — senão ainda teria capacidade residual para frente, colocando seu vértice do lado `T` em `S`), e toda aresta cruzando `T -> S` precisa estar **vazia** (senão sua aresta residual para trás estenderia `S`). Então o fluxo através desse corte é igual à sua capacidade, e como o valor do fluxo máximo é igual ao fluxo através de *qualquer* corte (Proposição E / Lema 24.4), essa capacidade é tanto um valor de fluxo válido quanto um limite superior para todo fluxo possível — o que a força a ser o máximo.

**Trace completo na rede de seis vértices**, usando busca em largura para escolher o caminho de aumento *mais curto* a cada vez (a regra de Edmonds-Karp, discutida a seguir):

```viz
type: graph
node 0 0 0 1
node 1 1 1 0
node 2 2 1 2
node 3 3 2 0
node 4 4 2 2
node 5 5 3 1
edge 0 1 directed
edge 0 2 directed
edge 1 3 directed
edge 1 4 directed
edge 2 3 directed
edge 2 4 directed
edge 3 5 directed
edge 4 5 directed
---
visit 0 | Inicia Ford-Fulkerson na origem "0": fluxo 0 em toda aresta.
traverse 0 1 | Caminho 1: aresta para frente 0->1, capacidade residual 2.
visit 1 | BFS alcança "1".
traverse 1 3 | Aresta para frente 1->3, capacidade residual 3.
visit 3 | BFS alcança "3".
traverse 3 5 | Aresta para frente 3->5, capacidade residual 2 -- destino alcançado.
visit 5 | Gargalo = min(2, 3, 2) = 2. Empurra 2 ao longo de 0->1->3->5. Valor do fluxo: 2.
traverse 0 2 | Caminho 2: aresta para frente 0->2, capacidade residual 3.
visit 2 | BFS alcança "2".
traverse 2 4 | Aresta para frente 2->4, capacidade residual 1.
visit 4 | BFS alcança "4".
traverse 4 5 | Aresta para frente 4->5, capacidade residual 3 -- destino alcançado.
visit 5 | Gargalo = min(3, 1, 3) = 1. Empurra 1 ao longo de 0->2->4->5. Valor do fluxo: 3.
visit 2 | Caminho 3 começa de novo em "0" através de 0->2 (2 unidades de capacidade residual restantes).
traverse 2 3 | Aresta para frente 2->3, capacidade residual 1.
mark 3 | Em "3", ambas as arestas para frente estão cheias -- o único movimento restante é a aresta residual PARA TRÁS 3->1, desfazendo 1 das 2 unidades já em 1->3. Este motor só desenha arestas para frente declaradas, então o salto reverso é sinalizado aqui em vez de traçado como uma linha.
mark 1 | O salto para trás retorna a "1" com 1 unidade de capacidade de devolução usada (capacidade residual de 3->1 é igual às 2 unidades atualmente fluindo em 1->3).
traverse 1 4 | De "1", aresta para frente 1->4, capacidade residual 1.
traverse 4 5 | Aresta para frente 4->5, capacidade residual 2 -- destino alcançado de novo.
visit 5 | Gargalo = min(2, 1, 2, 1, 2) = 1. Empurra 1 ao longo de 0->2->3->(residual)1->4->5. Valor do fluxo: 4.
mark 0 | Nenhum caminho de aumento resta. A alcançabilidade no grafo residual a partir de "0" agora para em apenas {0, 2}.
mark 2 | "2" é o último vértice alcançável -- ambas as suas arestas para frente (2->3, 2->4) estão saturadas e não tem outra saída residual. S = {0, 2}, T = {1, 3, 4, 5} é um corte mínimo.
```

O viz mostra *quais* vértices e arestas cada busca de caminho de aumento toca — ele não tem noção de um valor de fluxo numérico se atualizando, então aqui está a contabilidade real, aresta por aresta, do mesmo trace:

| Aresta | Capacidade | Após caminho 1 (`0→1→3→5`, +2) | Após caminho 2 (`0→2→4→5`, +1) | Após caminho 3 (`0→2→3→₍res₎1→4→5`, +1) |
|---|---|---|---|---|
| `0→1` | 2 | 2 | 2 | **2 (saturada)** |
| `0→2` | 3 | 0 | 1 | 2 |
| `1→3` | 3 | 2 | 2 | 1 |
| `1→4` | 1 | 0 | 0 | **1 (saturada)** |
| `2→3` | 1 | 0 | 0 | **1 (saturada)** |
| `2→4` | 1 | 0 | 1 | **1 (saturada)** |
| `3→5` | 2 | 2 | 2 | **2 (saturada)** |
| `4→5` | 3 | 0 | 1 | 2 |
| **Valor do fluxo** | | **2** | **3** | **4** |

O corte mínimo encontrado é `S = {0, 2}`, `T = {1, 3, 4, 5}`. Suas arestas de cruzamento são `0->1` (capacidade 2), `2->3` (capacidade 1) e `2->4` (capacidade 1) — todas já mostradas saturadas na tabela acima, exatamente como a prova do teorema exige. A capacidade total do corte, `2 + 1 + 1 = 4`, bate com o valor do fluxo máximo encontrado: essa igualdade *é* o certificado de que `4` é verdadeiramente ótimo, não só o melhor que essa sequência específica de caminhos encontrou.

Uma reconstrução em Java (adaptada de `FlowEdge`/`FordFulkerson` de Sedgewick & Wayne, Algorithm 6.14), usando a estrutura `residualCapacity`/BFS de CLRS. Toda `FlowEdge` precisa ser adicionada às listas de adjacência de *ambos* os seus extremos, para que a busca possa percorrê-la para frente ou para trás:

```java
final class FlowEdge {
    private final int from, to;
    private final double capacity;
    private double flow;

    FlowEdge(int from, int to, double capacity) {
        this.from = from;
        this.to = to;
        this.capacity = capacity;
    }

    int from() { return from; }
    int to() { return to; }

    int other(int vertex) {
        if (vertex == from) return to;
        if (vertex == to) return from;
        throw new IllegalArgumentException("not an endpoint of this edge");
    }

    // Para frente (rumo a `to`): capacidade não usada, c - f. Para trás (rumo a `from`): fluxo já comprometido, f.
    double residualCapacityTo(int vertex) {
        if (vertex == to) return capacity - flow;
        if (vertex == from) return flow;
        throw new IllegalArgumentException("not an endpoint of this edge");
    }

    void addResidualFlowTo(int vertex, double delta) {
        if (vertex == to) flow += delta;        // salto para frente: comprometer mais fluxo
        else if (vertex == from) flow -= delta;  // salto para trás: cancelar fluxo comprometido
        else throw new IllegalArgumentException("not an endpoint of this edge");
    }
}

final class FordFulkerson {
    private final boolean[] marked;   // alcançável a partir de s no grafo residual -- o lado S do corte mínimo
    private final FlowEdge[] edgeTo;  // última aresta no caminho de aumento atual
    private double value;

    FordFulkerson(Map<Integer, List<FlowEdge>> adj, int s, int t, int vertexCount) {
        marked = new boolean[vertexCount];
        edgeTo = new FlowEdge[vertexCount];
        while (hasAugmentingPath(adj, s, t, vertexCount)) {
            double bottleneck = Double.POSITIVE_INFINITY;
            for (int v = t; v != s; v = edgeTo[v].other(v))
                bottleneck = Math.min(bottleneck, edgeTo[v].residualCapacityTo(v));
            for (int v = t; v != s; v = edgeTo[v].other(v))
                edgeTo[v].addResidualFlowTo(v, bottleneck);
            value += bottleneck;
        }
    }

    // BFS no grafo residual, caminho mais curto em número de arestas -- a regra de Edmonds-Karp.
    private boolean hasAugmentingPath(Map<Integer, List<FlowEdge>> adj, int s, int t, int vertexCount) {
        Arrays.fill(marked, false);
        Queue<Integer> queue = new ArrayDeque<>();
        marked[s] = true;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.poll();
            for (FlowEdge e : adj.get(v)) {
                int w = e.other(v);
                if (e.residualCapacityTo(w) > 0 && !marked[w]) {
                    edgeTo[w] = e;
                    marked[w] = true;
                    queue.add(w);
                }
            }
        }
        return marked[t];
    }

    double value() { return value; }
    boolean inCut(int v) { return marked[v]; }  // true para exatamente o lado S do corte mínimo, após a chamada final
}
```

`inCut(v)` reaproveita o mesmo array `marked[]` que a checagem de término acabou de calcular — o corte mínimo não é um cálculo separado feito depois; é um subproduto da mesma checagem de alcançabilidade no grafo residual que decidiu parar.

### Tempo de execução: O(VE²) de Edmonds-Karp contra uma armadilha adversarial

O método genérico de Ford-Fulkerson (o `FORD-FULKERSON-METHOD` de CLRS) nunca especifica *como* escolher o caminho de aumento — e essa escolha controla o tempo de execução, às vezes drasticamente:

- **Edmonds-Karp (1972): sempre escolha o caminho de aumento mais curto**, medido em número de arestas, encontrado via BFS no grafo residual — exatamente o método `hasAugmentingPath` acima. Isso garante O(VE) aumentos, cada um custando O(E) para encontrar via BFS, para um limite total de **O(VE²)** — polinomial, e independente dos valores de capacidade por completo.
- **Caminhos arbitrários ou escolhidos por DFS podem ser bem mais lentos, dependendo das capacidades reais.** Uma rede adversarial clássica torna isso concreto: vértices `s, a, b, t`, com arestas `s->a` (capacidade 1000), `s->b` (capacidade 1000), `a->b` (capacidade 1), `a->t` (capacidade 1000), `b->t` (capacidade 1000). O fluxo máximo verdadeiro é `2000`, alcançável em exatamente 2 caminhos de aumento (`s->a->t` e `s->b->t`, evitando `a->b` por completo). Mas um DFS que alterna entre `s->a->b->t` e `s->b->a->t` (o segundo usando a aresta residual para trás de `a->b`, `b->a`) só consegue empurrar **1 unidade por caminho**, porque `a->b` — capacidade 1 — está em toda caminho que ele escolhe. Isso leva **2000 caminhos de aumento** para chegar à mesma resposta que 2 iterações teriam encontrado.

Para capacidades inteiras, Ford-Fulkerson sempre termina e encontra o verdadeiro fluxo máximo não importa qual caminho seja escolhido (todo aumento incrementa estritamente o fluxo de valor inteiro em pelo menos 1 — o corolário de integralidade de CLRS) — mas "sempre termina" não diz nada sobre *quão rápido*. O exemplo adversarial acima é a ilustração padrão de que a contagem de iterações de um algoritmo correto pode depender da magnitude da entrada, não só do tamanho da entrada, quando a regra de seleção de caminho fica sem restrição; a regra de caminho mais curto de Edmonds-Karp é precisamente o ajuste que remove essa dependência.

## Trade-offs

- **As arestas para trás do grafo residual são exigidas para a corretude, não uma otimização** — uma versão só-para-frente do algoritmo pode travar em um fluxo estritamente subótimo (o exemplo resolvido acima trava em `3` em vez do verdadeiro `4`), porque não tem como reconsiderar fluxo já comprometido a uma aresta.
- **Escolha arbitrária/por DFS de caminho de aumento pode fazer o tempo de execução depender dos valores de capacidade, não só do tamanho do grafo** — a rede adversarial `s,a,b,t` acima precisa de 2000 iterações sob uma escolha ruim contra 2 sob uma boa; prefira BFS (Edmonds-Karp, O(VE²)) como padrão, a menos que haja uma razão específica para escolher caminhos de outra forma.
- **O corte mínimo é um subproduto de graça, não um algoritmo separado** — a mesma checagem `marked[]`/alcançabilidade residual que decide que Ford-Fulkerson deve parar é exatamente a partição que o teorema do fluxo máximo e corte mínimo promete ser um corte mínimo; exponha-a (`inCut(v)`) em vez de recalculá-la.
- **Com capacidades irracionais, uma escolha irrestrita de caminhos de aumento nem sequer tem convergência garantida** (Sedgewick & Wayne apontam isso explicitamente) — mais uma razão para a regra do caminho de aumento mais curto ser o padrão sensato, em vez de "qualquer caminho serve" ao pé da letra.
- **Os valores por aresta de um fluxo máximo não precisam ser únicos, mesmo que o valor total seja** — ordens diferentes de caminhos de aumento podem comprometer fluxo a arestas diferentes ao chegar no mesmo total (o próprio trace deste concept teria aparência diferente começando por `0->2->4->5` primeiro), então não assuma que uma atribuição de fluxo por aresta específica é "a" resposta, a menos que o problema peça um fluxo específico, não só o valor.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — "Network-Flow Algorithms" (Ford-Fulkerson algorithm, residual networks, maxflow-mincut theorem), pp. 888-899 — doc
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 24 "Maximum Flow," Section 24.2 "The Ford-Fulkerson method," pp. 676-696 — doc
- [Princeton Algorithms, 4th Ed. — Maximum Flow (companion site)](https://algs4.cs.princeton.edu/64maxflow/) — doc
