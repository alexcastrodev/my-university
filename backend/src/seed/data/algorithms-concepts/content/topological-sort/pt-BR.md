---
version: 1.0
updatedAt: 2026-08-13
title: "Topological Sort: Ordenando um DAG via Tempos de Término do DFS"
description: "Ordene os vértices de um directed acyclic graph (DAG) de forma que toda aresta aponte para frente, executando DFS e lendo os vértices na ordem reversa do tempo de término — a mesma travessia O(V+E) que o concept irmão de DFS já constrói, com um push por vértice adicionado."
---
## Objetivo

Entenda topological sort: dado um directed acyclic graph (DAG), produza uma ordenação linear de seus vértices tal que toda aresta direcionada aponte de um vértice mais cedo na ordenação para um mais tarde nela. Isso não é "ordenação" no sentido de comparação — não há chave sendo comparada — é uma *linearização* de uma relação de precedência: se a aresta `u -> v` significa "u precisa acontecer antes de v", uma ordem topológica é qualquer sequência que respeita todas essas restrições simultaneamente. Como o concept irmão de depth-first search cobre, DFS já nos dá tempos de descoberta/término e uma forma de detectar ciclos via back edges; topological sort acaba não sendo nada mais do que tempos de término do DFS lidos ao contrário.

## Casos de Uso

- **Sistemas de build e gerenciadores de pacote** — um target/pacote que depende de outro precisa ser construído/instalado depois dele; ordem topológica no grafo de dependências é exatamente uma ordem de build válida (ordem de build do reactor do Maven, ordem de build de workspace do `npm`/`pnpm`, grafo de targets do `make`).
- **Agendamento de curso** — o próprio exemplo condutor de Sedgewick e Wayne: uma aresta `pré-requisito -> curso` significa que o pré-requisito precisa ser cursado primeiro, e uma ordem topológica é um plano semestre-a-semestre que nunca agenda um curso antes de seu pré-requisito.
- **Recálculo de células de planilha** — uma célula de fórmula que referencia outra célula precisa ser recomputada depois da célula que ela lê; ordem topológica no grafo "lê-de" dá uma ordem de recálculo que nunca usa um valor obsoleto.

## Aprofundamento

### O problema, e por que exige um DAG

O Cormen et al. afirmam o requisito claramente: topological sort só é definido em grafos direcionados que são acíclicos — nenhuma ordenação linear é possível quando um grafo direcionado contém um ciclo. O motivo é uma contradição direta: se `A` precisa vir antes de `B`, `B` antes de `C`, e `C` antes de `A`, nenhuma posição dos três em uma linha consegue satisfazer as três restrições ao mesmo tempo. A Proposição E de Sedgewick e Wayne afirma também a recíproca: um digrafo tem uma ordem topológica **se e somente se** for um DAG.

Esse "se e somente se" é o motivo pelo qual detecção de ciclo é o primeiro passo obrigatório antes de sequer tentar um topological sort. Como o concept irmão de DFS cobre, um DFS *não direcionado* classifica a aresta `(u, v)` como uma **back edge** exatamente quando `v` é cinza — um ancestral de `u` ainda na pilha de chamadas — e uma back edge é prova de um ciclo. O caso direcionado funciona de forma idêntica, só com `onStack[]` substituindo a checagem de "não é meu pai" que a classe `Cycle` não direcionada usava, já que um digrafo não tem aresta de pai simétrica para excluir:

```java
public class DirectedCycle {
    private final boolean[] marked;
    private final boolean[] onStack;   // vértices na pilha de chamadas recursivas atual
    private boolean hasCycle;

    public DirectedCycle(Digraph g) {
        marked = new boolean[g.vertexCount()];
        onStack = new boolean[g.vertexCount()];
        for (int v = 0; v < g.vertexCount(); v++) {
            if (!marked[v]) dfs(g, v);
        }
    }

    private void dfs(Digraph g, int v) {
        marked[v] = true;
        onStack[v] = true;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) {
                dfs(g, w);
            } else if (onStack[w]) {
                hasCycle = true;   // w é um ancestral ainda na pilha -- uma back edge
            }
        }
        onStack[v] = false;   // terminou com v -- ele sai do caminho atual
    }

    public boolean hasCycle() { return hasCycle; }
}
```

Isso é o Lema 20.11 do CLRS em código: um grafo direcionado é acíclico se e somente se um DFS dele não produz back edges. Na prática, detecção de ciclo e topological sort andam juntos — Sedgewick e Wayne descrevem um processo de três passos para aplicações de agendamento: especifique as tarefas e restrições, rode `DirectedCycle` para encontrar e remover qualquer ciclo (um ciclo real geralmente significa um erro de modelagem), e só então rode topological sort no grafo agora acíclico.

### O algoritmo de reverse-postorder: DFS mais contabilidade O(1)

O `TOPOLOGICAL-SORT` do CLRS tem três linhas: rode DFS para computar tempos de término, e conforme cada vértice termina, insira-o na *frente* de uma lista encadeada. Esse "inserir na frente ao terminar" é precisamente o que empilhar em uma pilha faz, então a versão Java é um wrapper fino em torno do mesmo `dfs()` que o concept irmão já estabeleceu — o único acréscimo é uma chamada de `push` depois do loop recursivo:

```java
public class TopologicalOrder {
    private final boolean[] marked;
    private final Deque<Integer> reversePostorder;   // construída diretamente em ordem topológica

    // assume que g é um DAG -- verificado separadamente, por exemplo via DirectedCycle.hasCycle()
    public TopologicalOrder(Digraph g) {
        marked = new boolean[g.vertexCount()];
        reversePostorder = new ArrayDeque<>();
        for (int v = 0; v < g.vertexCount(); v++) {
            if (!marked[v]) dfs(g, v);
        }
    }

    private void dfs(Digraph g, int v) {
        marked[v] = true;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
        reversePostorder.push(v);   // v acabou de terminar -- empilha na frente, ao estilo CLRS
    }

    public Iterable<Integer> order() { return reversePostorder; }
}
```

Nada aqui é maquinário novo: é exatamente o `DepthFirstTimes.dfs()` do concept irmão, menos o relógio de descoberta/término, mais um único `push(v)` onde esse relógio teria registrado `finish[v]`. A própria classe `DepthFirstOrder` de Sedgewick e Wayne faz o mesmo ponto construindo as três ordenações de DFS — preorder, postorder e reverse postorder — lado a lado a partir de uma única travessia, diferindo apenas em *quando* cada vértice é registrado (antes das chamadas recursivas, depois delas em uma fila, ou depois delas em uma pilha) e *qual* estrutura de dados o guarda.

### Por que a ordem reversa de tempo de término é sempre uma ordem topológica válida

Este é o único fato em que o algoritmo inteiro se apoia, e o Teorema 20.12 do CLRS prova isso com precisão. Considere qualquer aresta `u -> v` em um DAG, no momento em que o DFS a explora durante `dfs(u)`. Como a classificação de arestas do concept irmão de DFS cobre, a cor de `v` naquele instante determina o tipo da aresta — e `v` **não pode ser cinza**: cinza significaria que `v` é ancestral de `u` ainda na pilha de chamadas, tornando `u -> v` uma back edge, o que o Lema 20.11 descarta em um DAG. Isso deixa exatamente duas possibilidades:

- **`v` é branco** (não descoberto). A aresta `u -> v` faz o DFS recorrer em `v`, tornando-o descendente de `u`. `dfs(v)` — e tudo alcançável a partir de `v` — precisa terminar antes que `dfs(u)` possa retornar, então `v.finish < u.finish`.
- **`v` é preto** (já terminado). Seu tempo de término foi definido antes de `dfs(u)` sequer examinar a aresta, então trivialmente `v.finish < u.finish`.

De qualquer forma, para **toda** aresta `u -> v` no DAG, `v` termina antes de `u`. Ordenar os vértices por tempo de término *decrescente* — ou seja, reverse postorder — portanto sempre coloca `u` antes de `v` para toda aresta, que é exatamente a definição de uma ordem topológica. A Proposição F de Sedgewick e Wayne afirma o mesmo resultado a partir do outro lado (em termos de pré/pós-ordem em vez de timestamps brutos), e ambos os livros observam que a prova só funciona porque um DAG nunca pode produzir o caso "cinza" — um grafo cíclico deixaria alguma aresta violá-la.

Observar isso acontecer em um pequeno DAG de pré-requisitos de curso torna a contabilidade de tempo de término concreta. Sete cursos, sete arestas de pré-requisito, DFS iniciado no vértice 0 com o loop externo visitando vértices não marcados em ordem de id e a lista de adjacência de cada vértice na ordem de declaração das arestas:

```viz
type: graph
node 0 Calc 1 0
node 3 DataSt 4 0
node 1 LinAlg 0 1
node 2 Discr 2 1
node 4 Algo 3 2
node 5 DB 2 2
node 6 ML 0 3
edge 0 1 directed
edge 0 2 directed
edge 1 6 directed
edge 2 4 directed
edge 2 5 directed
edge 3 4 directed
edge 4 6 directed
---
traverse 0 1 | dfs(0) começa (primeiro vértice não marcado do loop externo); seu primeiro vizinho "LinAlg" (1) não está marcado -- tree edge 0->1.
traverse 1 6 | dfs(1) examina seu único vizinho "ML" (6) -- não marcado -- tree edge 1->6.
visit 6 | dfs(6) não tem arestas de saída, então termina imediatamente. "ML" é o PRIMEIRO vértice a terminar.
visit 1 | De volta em dfs(1): nenhum vizinho resta, então termina agora que dfs(6) retornou. "LinAlg" termina em segundo.
traverse 0 2 | De volta em dfs(0): seu segundo vizinho "Discr" (2) ainda não está marcado -- tree edge 0->2.
traverse 2 4 | dfs(2) examina seu primeiro vizinho "Algo" (4) -- não marcado -- tree edge 2->4.
mark 6 | dfs(4) examina seu único vizinho "ML" (6) -- já preto (terminado) -- não é tree edge, só uma checagem.
visit 4 | dfs(4) não tem mais vizinhos, então termina. "Algo" termina em terceiro.
traverse 2 5 | De volta em dfs(2): seu segundo vizinho "DB" (5) não está marcado -- tree edge 2->5.
visit 5 | dfs(5) não tem arestas de saída, então termina imediatamente. "DB" termina em quarto.
visit 2 | De volta em dfs(2): nenhum vizinho resta, então termina. "Discr" termina em quinto.
visit 0 | De volta em dfs(0): nenhum vizinho resta, então termina, completando a primeira árvore de DFS. "Calc" termina em sexto.
mark 3 | O loop externo avança para o próximo vértice não marcado: "DataSt" (3) não tem arestas de entrada, então inicia uma segunda chamada de DFS independente.
mark 4 | dfs(3) examina seu único vizinho "Algo" (4) -- já preto (terminado) -- não é tree edge, só uma checagem.
visit 3 | dfs(3) não tem mais vizinhos, então termina imediatamente. "DataSt" termina em sétimo, completando a varredura.
```

Lendo os passos `visit` acima em ordem, obtém-se a sequência de término `ML, LinAlg, Algo, DB, Discr, Calc, DataSt`. Invertendo-a, obtém-se `DataSt, Calc, Discr, DB, Algo, LinAlg, ML` — e checar cada uma das 7 arestas do grafo (`Calc->LinAlg`, `Calc->Discr`, `LinAlg->ML`, `Discr->Algo`, `Discr->DB`, `DataSt->Algo`, `Algo->ML`) confirma que cada origem aparece antes de seu destino nessa ordem invertida, exatamente como o Teorema 20.12 garante.

### Tempo de execução e onde isso aparece na prática

`TOPOLOGICAL-SORT` roda em tempo Θ(V + E) — o mesmo limite do próprio DFS, já que o único acréscimo ao DFS puro é um único `push` O(1) por vértice quando ele termina. Sedgewick e Wayne enunciam o mesmo fato de forma ligeiramente diferente: seu cliente `Topological` roda uma passada de `DirectedCycle` baseada em DFS para confirmar que o grafo é acíclico e uma segunda passada de `DepthFirstOrder` para computar a ordenação, então o limite declarado por eles é "tempo proporcional a `V + E`" para duas travessias em vez de uma — ainda linear, só com uma diferença de fator constante dependendo de se a checagem de ciclo é contada separadamente.

Esse limite linear é exatamente o motivo pelo qual topological sort escala para grafos de dependência reais sem nenhum caso especial: o grafo de targets de um sistema de build, o grafo de dependências de um gerenciador de pacotes, ou o grafo de referências de células de uma planilha podem todos ter milhares de vértices e arestas, e uma única passada linear de DFS já basta para produzir uma ordem de build, uma ordem de instalação, ou uma ordem de recálculo que nunca usa algo antes de estar pronto.

## Trade-offs

- **Tempo Θ(V + E), idêntico ao DFS** — topological sort não adiciona custo assintótico algum sobre a travessia em que é construído; o algoritmo inteiro é DFS com um `push` extra por vértice ao terminar, segundo a prova do CLRS.
- **Só faz sentido em um DAG, e o algoritmo acima não checa isso sozinho** — `TopologicalOrder` como escrito vai rodar tranquilamente em um grafo cíclico e produzir *alguma* sequência de reverse postorder, mas ela não será uma ordem topológica válida (alguma aresta garantidamente a viola, já que o argumento do Teorema 20.12 depende do caso "nenhum `v` cinza" que só um DAG garante). Detecção de ciclo via `DirectedCycle` — ou o próprio `Topological.isDAG()` de Sedgewick e Wayne, que retorna `false` quando sua checagem interna de ciclo falha — precisa rodar primeiro.
- **Reverse postorder baseado em DFS não é o único algoritmo, nem a única ordenação válida.** Sedgewick e Wayne mencionam uma alternativa, mais intuitiva: encontrar e remover repetidamente um vértice com grau de entrada 0 (algoritmo de Kahn, Exercício 20.4-5 do CLRS), que troca a recursão do DFS por um array explícito de grau de entrada e uma fila de vértices "prontos" — e detecta ciclos como efeito colateral (se a fila esvaziar antes de todo vértice ser removido, resta um ciclo). Nenhum dos dois algoritmos produz *a* ordem topológica — um DAG geralmente tem muitas linearizações válidas, e reverse postorder do DFS é simplesmente uma delas, determinada pela ordem de travessia e pela ordem da lista de adjacência.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 4.2 "Directed Graphs", topological sort ("Depth-first orders and topological sort"), pp. 575-584 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Seção 20.4 "Topological sort", pp. 573-576 — book
- [Princeton Algorithms, 4th Ed. — Topological.java (companion site)](https://algs4.cs.princeton.edu/42digraph/Topological.java.html) — doc
