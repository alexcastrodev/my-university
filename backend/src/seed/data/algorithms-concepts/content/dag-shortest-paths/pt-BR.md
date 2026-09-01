---
version: 1.0
updatedAt: 2026-08-13
title: "Caminhos Mais Curtos em um DAG: Ordem Topológica Supera Priority Queue"
description: "Em um directed acyclic graph, relaxar as arestas de saída de cada vértice uma única vez em ordem topológica encontra os caminhos mais curtos em O(V + E) — mais rápido que a priority queue de Dijkstra e correto mesmo com pesos de aresta negativos, já que um DAG nunca pode conter o ciclo negativo que tornaria os caminhos mais curtos mal definidos."
---
## Objetivo

Entenda o atalho específico para DAG do problema de shortest paths que o concept irmão de Dijkstra deixa em aberto. Relaxamento (veja aquele concept) ainda é a única operação que faz trabalho de verdade aqui, mas a propriedade que define um directed acyclic graph — nunca ter ciclos — permite descartar totalmente a priority queue do Dijkstra. Processe cada vértice exatamente uma vez, em ordem topológica (veja o concept irmão de topological-sort para como essa ordem é produzida), relaxando as arestas de saída de cada vértice conforme avança, e pronto: sem escolha greedy de "sempre expandir o vértice não finalizado mais próximo", sem operação de heap O(log V) por aresta — e, como essa escolha greedy era a *única* razão de o Dijkstra precisar de pesos não negativos, também sem restrição alguma sobre o sinal dos pesos.

## Casos de Uso

- Método do caminho crítico (CPM) / agendamento de projeto com gráfico PERT — o tempo mínimo possível de conclusão de um projeto é o comprimento do caminho *mais longo* de um marco inicial a um marco final em um DAG de dependências de tarefa. É o mesmo algoritmo coberto aqui com a desigualdade de relaxamento invertida para maximizar (veja Trade-offs).
- Sistemas de build e agendadores de tarefa (um DAG de dependências no estilo Makefile) computando o quanto antes cada target pode começar depois que todo pré-requisito terminou — um peso de aresta de "atraso" ou "adiantamento" pode ser negativo sem quebrar nada.
- Qualquer DAG ponderado que já tenha sido ordenado topologicamente por outro motivo (por exemplo, depois de rodar o concept irmão de topological-sort para ordenar dependências ou detectar um ciclo) — essa passada de shortest path é essencialmente grátis de adicionar em cima, já que a parte cara (a ordenação) já foi paga.
- Agendamento de instrução/fluxo de dados dentro do bloco básico de um compilador, onde dependências de operação formam um DAG e pesos de aresta podem representar folga de agendamento negativa sem precisar de um algoritmo diferente.

## Aprofundamento

### Por que processar em ordem topológica sozinho garante corretude

Para qualquer aresta `u -> v` em um DAG, a ordem topológica coloca `u` antes de `v` — essa é a garantia que define uma ordem topológica (veja o concept irmão de topological-sort para como ela é computada via DFS reverso por tempo de término). Percorra o que essa garantia compra para uma única passada linear que relaxa as arestas de saída de cada vértice conforme o alcança:

No momento em que a passada alcança o vértice `v` e está prestes a relaxar as próprias arestas de saída de `v`, **toda** aresta que aponta *para dentro* de `v` — toda aresta `w -> v` para algum `w` — já foi relaxada, porque todo `w` desse tipo foi necessariamente processado antes na passada (a ordem topológica garante que `w` precede `v` sempre que a aresta `w -> v` existe). Relaxamento é a única operação, em toda essa família de algoritmos, que pode reduzir um valor de `distTo[]`, e toda aresta que poderia possivelmente reduzir `distTo[v]` já disparou quando você chega em `v`. Então `distTo[v]` não pode mudar de novo depois desse ponto: já é igual ao verdadeiro peso de caminho mais curto antes mesmo de você tocar em `v` para relaxar suas próprias arestas de saída.

O Teorema 22.5 do CLRS afirma isso como a propriedade de relaxamento de caminho aplicada ao longo de uma ordem topológica: tome qualquer caminho mais curto `p = v0(=s), v1, ..., vk(=v)`. Como a ordem topológica processa `v0` antes de `v1` antes de `v2` ... antes de `vk` (cada par consecutivo em `p` é, ele mesmo, uma aresta, logo ordenado pela ordenação topológica), o algoritmo relaxa a aresta `(v0,v1)` antes de `(v1,v2)` antes de ... antes de `(vk-1,vk)` — relaxar as arestas de um caminho exatamente na ordem do próprio caminho é precisamente o que a propriedade de relaxamento de caminho precisa para concluir `vk.d = δ(s, vk)` no término.

Contraste isso com a prova de corretude do Dijkstra (veja o concept irmão): Dijkstra precisa argumentar indutivamente que finalizar greedily o vértice de distância mínima da fronteira é *seguro*, e esse argumento só funciona porque os pesos são não negativos — um vértice ainda não processado nunca consegue superar uma distância já finalizada só porque arestas não podem ser negativas. A prova de corretude do algoritmo de DAG acima nunca menciona o sinal dos pesos em nenhum momento; ela se apoia unicamente na garantia da ordenação topológica. Esse é o motivo inteiro pelo qual ele tolera pesos negativos: nada no argumento de corretude jamais precisou que fossem não negativos.

### O algoritmo: topological sort, depois uma passada linear de relaxamento

```java
public class AcyclicSP {
    private DirectedEdge[] edgeTo;
    private double[] distTo;

    public AcyclicSP(EdgeWeightedDigraph G, int s) {
        edgeTo = new DirectedEdge[G.V()];
        distTo = new double[G.V()];
        for (int v = 0; v < G.V(); v++) {
            distTo[v] = Double.POSITIVE_INFINITY;
        }
        distTo[s] = 0.0;

        // O concept irmão de topological-sort produz essa ordem via tempo de
        // término reverso do DFS; este algoritmo só a consome.
        Topological topological = new Topological(G);
        for (int v : topological.order()) {
            relax(G, v);
        }
    }

    private void relax(EdgeWeightedDigraph G, int v) {
        for (DirectedEdge e : G.adj(v)) {
            int w = e.to();
            if (distTo[w] > distTo[v] + e.weight()) {
                distTo[w] = distTo[v] + e.weight();
                edgeTo[w] = e;
            }
        }
    }

    public double distTo(int v) { return distTo[v]; }
}
```

Compare isso com o loop condutor do Dijkstra no concept irmão: não há campo de priority queue em lugar nenhum nessa classe, nenhum `delMin()`, nenhum `decreaseKey()` — `relax` é chamado exatamente uma vez por vértice, na ordem fixa que `topological.order()` entrega, e toda aresta do grafo é relaxada exatamente uma vez, no total, em toda a execução.

### Trace: um pequeno DAG ponderado com uma aresta negativa

Seis vértices, nove arestas direcionadas, uma delas negativa (`A -> B`, peso `-4`):

```
S -> A (5)      A -> B (-4)     B -> D (7)      C -> T (2)
S -> B (2)      A -> C (3)      C -> D (1)      D -> T (4)
                B -> C (6)
```

`S, A, B, C, D, T` é a (única) ordem topológica válida para esse grafo — toda aresta acima aponta de um vértice mais cedo nessa lista para um mais tarde. Verificando à mão as distâncias mais curtas primeiro: o caminho mais barato até `B` não é a aresta direta `S -> B` (peso 2), mas `S -> A -> B` (`5 + (-4) = 1`), e o caminho mais barato até `T` é `S -> A -> B -> C -> T` (`5 - 4 + 6 + 2 = 9`), superando toda outra rota `S`-a-`T` (`S -> A -> C -> T = 10`, `S -> B -> C -> T = 10`, `S -> A -> B -> D -> T = 12`). Note que essa é exatamente a forma de problema que o contraexemplo de peso negativo do concept irmão de Dijkstra alerta — `A -> B` torna um caminho por `A` mais barato que a aresta direta até `B` — só que aqui não causa problema algum, porque nada é "finalizado" fora de ordem em primeiro lugar; a passada apenas relaxa arestas em uma sequência fixa independentemente de como qualquer distância parece naquele momento.

```viz
type: graph
node S S 0 1
node A A 1 0
node B B 1 2
node C C 2 1
node D D 3 0
node T T 4 1
edge S A directed
edge S B directed
edge A B directed
edge A C directed
edge B C directed
edge B D directed
edge C D directed
edge C T directed
edge D T directed
---
visit S | A ordem topológica começa aqui: distTo[S] = 0, tudo o mais infinito.
traverse S A | Relaxa S→A: distTo[A] = 0 + 5 = 5.
traverse S B | Relaxa S→B: distTo[B] = 0 + 2 = 2.
visit A | distTo[A] = 5 já é final -- nenhum vértice anterior tem aresta para A.
traverse A B | Relaxa A→B: 5 + (-4) = 1 < 2 -- a aresta negativa reduz distTo[B] para 1, sem priority queue envolvida.
traverse A C | Relaxa A→C: 5 + 3 = 8, então distTo[C] = 8.
visit B | distTo[B] = 1 é final -- as duas arestas para B (S→B, A→B) já foram relaxadas acima.
traverse B C | Relaxa B→C: 1 + 6 = 7 < 8 -- distTo[C] melhora para 7.
traverse B D | Relaxa B→D: 1 + 7 = 8, então distTo[D] = 8.
visit C | distTo[C] = 7 é final -- as duas arestas para C (A→C, B→C) já foram relaxadas.
traverse C D | Relaxa C→D: 7 + 1 = 8 -- empata com o 8 existente, sem melhora.
traverse C T | Relaxa C→T: 7 + 2 = 9, então distTo[T] = 9.
visit D | distTo[D] = 8 é final -- as duas arestas para D (B→D, C→D) já foram relaxadas.
traverse D T | Relaxa D→T: 8 + 4 = 12 -- pior que o 9 existente, sem melhora.
visit T | distTo[T] = 9 é final. T não tem arestas de saída -- uma passada linear, e toda distância está pronta.
```

Distâncias finais a partir de `S`: `A=5, B=1, C=7, D=8, T=9` — batendo com os valores verificados à mão acima, computados com zero comparações contra um mínimo de priority queue, apenas uma passada em linha reta pela ordem topológica.

### Tempo de execução: O(V + E), estritamente melhor que o O(E log V) do Dijkstra

Três peças, cada uma linear: topological sort leva tempo `Θ(V + E)` (o próprio limite do concept irmão, via um DFS que visita todo vértice e varre toda lista de adjacência uma vez); inicializar `distTo[]`/`edgeTo[]` é `Θ(V)`; e o loop principal faz uma iteração por vértice, e em todas as iterações o loop interno relaxa cada aresta exatamente uma vez, então — pelo mesmo argumento de análise agregada que o CLRS usa para a afirmação de tempo de execução do Teorema 22.5 — a passada inteira custa `Θ(E)`. Total: `Θ(V + E)`.

Compare isso com o `O((V + E) log V)` do Dijkstra com uma priority queue baseada em binary heap (veja os Trade-offs do concept irmão): Dijkstra paga `O(log V)` por todo `delMin()` e todo `decreaseKey()`/`insert()`, porque um heap é o preço de deixar o algoritmo escolher dinamicamente "qual vértice está mais perto agora" em um grafo arbitrário. Um DAG não precisa que essa pergunta seja respondida de jeito nenhum — a ordem topológica fixa toda a sequência de processamento de antemão, em tempo linear no tamanho do grafo, então não sobra overhead de heap por aresta para pagar. Sedgewick e Wayne fazem a comparação diretamente: o método baseado em topological sort é mais rápido que o algoritmo de Dijkstra "por um fator proporcional ao custo das operações de priority queue no algoritmo de Dijkstra" — ou seja, por aproximadamente o fator `log V`.

Essa mesma remoção da priority queue é exatamente o motivo pelo qual pesos negativos deixam de ser um problema. A prova de corretude do Dijkstra precisa de "nenhum vértice não processado jamais consegue superar uma distância já finalizada", e essa afirmação só é verdadeira quando os pesos não podem ser negativos (o contraexemplo do concept irmão mostra precisamente como isso quebra). A prova de corretude do algoritmo de DAG, acima, nunca invoca o sinal dos pesos em lugar nenhum — só usa "toda aresta para `v` foi relaxada antes de `v` ser alcançado", um fato que a ordem topológica garante independentemente de quais sejam os pesos. Essa rede de segurança existe só porque um DAG não tem ciclo algum: um *ciclo* de peso negativo tornaria "caminho mais curto" mal definido (você poderia dar voltas nele para sempre, reduzindo o total a cada vez), mas um DAG não pode conter um por definição, então a questão nunca aparece. Digrafos gerais com pesos negativos e possíveis ciclos precisam de um algoritmo diferente — Bellman-Ford — especificamente para detectar esse caso mal-posto.

## Trade-offs

- **Exige que o grafo seja genuinamente acíclico — não é uma restrição relaxável, é um pré-requisito rígido.** Um único ciclo em qualquer lugar e todo o argumento do Aprofundamento desmorona, porque "toda aresta para `v` já foi relaxada antes de `v` ser alcançado" deixa de ser verdade. Grafos que podem conter ciclos (com ou sem pesos negativos) precisam do Bellman-Ford em vez disso, que é um algoritmo diferente, não uma variante deste.
- **Topological sort é pré-processamento obrigatório, não uma otimização opcional.** Se já está sendo computado por outro motivo — detecção de ciclo, resolução de ordem de build, veja o concept irmão de topological-sort — essa passada de shortest path é quase grátis de adicionar depois. Se não está, a ordenação ainda custa apenas `Θ(V + E)`, então o pipeline combinado continua linear no total.
- **Caminhos mais longos (análise de caminho crítico / PERT) é um corolário direto, não um algoritmo separado.** Copie `AcyclicSP`, inicialize `distTo[]` com `Double.NEGATIVE_INFINITY` em vez de infinito positivo, e inverta a desigualdade de relaxamento de `>` para `<`. O próprio `AcyclicLP` de Sedgewick e Wayne é exatamente essa mudança de duas linhas, e é o que o método do caminho crítico usa diretamente para análise de agendamento de projeto: o comprimento do caminho mais longo do início ao fim de um projeto é o tempo mínimo viável de conclusão.
- **O espaço é O(V)** — o mesmo par `distTo[]`/`edgeTo[]` que Dijkstra e Bellman-Ford usam, mas sem priority queue alguma para dimensionar, já que nada é inserido ou extraído de uma em nenhum momento.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 4.4 "Shortest Paths", "Shortest paths in edge-weighted DAGs" (Algoritmo 4.10) e "Longest paths" (Proposição T), pp. 658-663 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Seção 22.2 "Single-source shortest paths in directed acyclic graphs", pp. 616-619 — book
- [Princeton Algorithms, 4th Ed. — Shortest Paths (companion site)](https://algs4.cs.princeton.edu/44sp/) — doc
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
