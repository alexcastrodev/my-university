---
version: 1.0
updatedAt: 2026-08-13
title: "Componentes Fortemente Conexos: Duas Passadas de DFS com o Algoritmo de Kosaraju"
description: "Entenda componentes fortemente conexos (SCCs) -- a generalização para grafos direcionados do concept irmão de DFS sobre componentes conexos em uma única passada em grafos não direcionados, necessária porque a alcançabilidade direcionada é assimétrica. Cobre a transposta do grafo e por que ela preserva os SCCs, o algoritmo de Kosaraju (DFS no grafo reverso para obter a pós-ordem reversa, depois DFS no grafo original nessa ordem, com cada árvore de DFS resultante sendo exatamente um SCC), um exemplo de dois ciclos verificado à mão e traçado com o motor de visualização de grafos, por que o algoritmo é correto, e seu tempo de execução O(V+E)."
---
## Objetivo

Entenda componentes fortemente conexos (SCCs): a generalização, para grafos direcionados, dos componentes conexos do concept irmão de DFS. Aquele concept irmão cobre conectividade *não direcionada*, onde uma única passada de DFS por componente basta, porque uma aresta não direcionada `{u, v}` permite andar de `u` até `v` e de `v` até `u` usando a mesma aresta. Um grafo direcionado não oferece essa garantia — uma aresta `u -> v` não diz nada sobre se `v` consegue voltar até `u` — então "tudo que o DFS marca a partir de `s`" é apenas o conjunto alcançável *a partir de* `s`, não o conjunto que é *mutuamente* alcançável com `s`. Calcular essa partição de alcançabilidade mútua é o que componentes fortemente conexos faz, e como a alcançabilidade em um grafo direcionado é assimétrica, isso exige duas passadas de DFS em vez de uma.

## Casos de Uso

- **Pré-processamento antes de rodar outros algoritmos de grafo direcionado.** Muitos algoritmos que operam sobre digrafos começam decompondo em SCCs, rodam separadamente em cada componente, depois combinam os resultados usando a estrutura do grafo de componentes (sempre acíclico) que os conecta — um padrão que Cormen, Leiserson, Rivest e Stein apontam explicitamente como a razão de existir dessa seção.
- **Análise de grafos web e de teias alimentares.** O próprio exemplo de Sedgewick e Wayne é um digrafo de teia alimentar ("mosquito come grama", "alga alimenta minhoca", e assim por diante); um SCC com mais de um vértice ali significa um loop de retroalimentação ecológica real, não apenas uma dependência de mão única — o mesmo formato de pergunta que um algoritmo de análise de links faz sobre um grafo web.
- **Detecção de dependência circular de software.** Modele uma relação "depende-de" como uma aresta direcionada; o concept irmão de ordenação topológica já exige que o grafo seja um DAG para produzir qualquer ordenação. Rodar a detecção de SCC primeiro encontra todo componente não trivial (mais de um vértice) — cada um é uma dependência circular genuína que precisa ser quebrada antes que uma ordem topológica possa existir.

## Aprofundamento

### O que é um SCC, e por que um grafo direcionado precisa de duas passadas de DFS

Um componente fortemente conexo de um grafo direcionado `G = (V, E)` é um conjunto maximal de vértices `C ⊆ V` tal que para todo par `u, v ∈ C`, tanto `u` consegue alcançar `v` *quanto* `v` consegue alcançar `u` via caminhos direcionados. Compare um ciclo de 3 vértices com um caminho de 3 vértices, ambos sobre os vértices `{0, 1, 2}`:

```text
Ciclo:  0 -> 1 -> 2 -> 0        Caminho:   0 -> 1 -> 2

A alcançabilidade para frente a partir de 0 é idêntica em ambos os grafos: {0, 1, 2}.
Mas a alcançabilidade mútua difere completamente:
  ciclo -> um SCC: {0, 1, 2}   (2 alcança 0, via 2->0)
  caminho  -> três SCCs: {0}, {1}, {2}   (2 não alcança 0 -- nenhuma aresta vai para trás)
```

Um único DFS a partir do vértice `0` não consegue distinguir esses dois grafos — `marked[]` acaba `{0, 1, 2}` em ambos os casos, porque o DFS só responde "alcançável a partir da origem", nunca "alcançável a partir de *e* até a origem". Essa é exatamente a lacuna que o `ConnectedComponents` do concept irmão de DFS nunca precisa fechar: o conjunto de alcançabilidade em uma única passada de um grafo não direcionado é automaticamente o conjunto de alcançabilidade mútua, já que toda aresta é bidirecional por construção. Um grafo direcionado força a questão em aberto, e respondê-la exige checar a alcançabilidade em ambas as direções — por isso todo algoritmo de SCC correto, Kosaraju incluso, roda DFS duas vezes.

### A transposta do grafo, e por que ela tem exatamente os mesmos SCCs

A transposta (ou reverso) de `G = (V, E)`, escrita `G^R` (notação de Sedgewick e Wayne) ou `G^T` (a de Cormen et al.), é o mesmo conjunto de vértices com a direção de toda aresta invertida: `E^R = {(v, u) : (u, v) ∈ E}`. Dada uma representação por lista de adjacência de `G`, construir `G^R` custa Θ(V + E) — percorra cada aresta uma vez e adicione-a à lista de adjacência reversa de seu destino:

```java
public Digraph reverse() {
    Digraph reversed = new Digraph(vertexCount());
    for (int v = 0; v < vertexCount(); v++) {
        for (int w : adjacentTo(v)) {
            reversed.addEdge(w, v);   // inverte a direção desta aresta
        }
    }
    return reversed;
}
```

CLRS afirma o fato-chave diretamente: `u` e `v` são alcançáveis um a partir do outro em `G` se e somente se são alcançáveis um a partir do outro em `G^R` — então `G` e `G^R` têm *exatamente* os mesmos componentes fortemente conexos. A razão é que um caminho direcionado é apenas uma sequência de arestas percorridas em ordem; invertendo toda aresta do grafo e depois percorrendo a mesma sequência *de trás para frente*, refaz-se o caminho idêntico na direção oposta. Concretamente, pegue o ciclo `0 -> 1 -> 2 -> 0` de acima. Invertendo toda aresta obtemos `1 -> 0`, `2 -> 1`, `0 -> 2` — ainda um único ciclo, só girando na outra direção (`0 -> 2 -> 1 -> 0`). A alcançabilidade mútua sobrevive intacta: em `G`, o vértice `0` alcança `1` diretamente (`0->1`) e `1` alcança `0` pelo caminho longo (`1->2->0`); em `G^R`, esses papéis se invertem — `0` agora alcança `1` pelo caminho longo (`0->2->1`) e `1` alcança `0` diretamente (`1->0`). Os caminhos específicos para frente e para trás trocaram de lugar, mas o fato de que ambas as direções existem não mudou — o que é precisamente por que a própria partição de SCCs fica intocada pela inversão.

### O algoritmo de Kosaraju

O `KosarajuSCC` de Sedgewick e Wayne precisa de apenas algumas linhas adicionadas em cima do `ConnectedComponents` do concept irmão de DFS, seguindo esta receita de três passos:

1. Construa `G^R`, depois rode um DFS sobre *todo* `G^R` para calcular sua pós-ordem reversa — a mesma mecânica de pós-ordem-reversa-via-pilha que o `TopologicalOrder` do concept irmão de ordenação topológica já constrói (empurra cada vértice assim que ele termina), só que rodado aqui em `G^R` em vez de `G`, e em um grafo que pode conter ciclos.
2. Rode DFS no grafo *original* `G`, mas conduza o laço externo do construtor sobre os vértices não marcados usando essa sequência de pós-ordem reversa, em vez da ordem numérica simples `0, 1, 2, ...`.
3. Toda árvore de DFS distinta produzida por uma única chamada de nível superior de `dfs()` nessa segunda passada é exatamente um componente fortemente conexo.

```java
public class KosarajuSCC {
    private final boolean[] marked;
    private final int[] id;      // id[v] = índice do SCC que contém v
    private int count;

    public KosarajuSCC(Digraph g) {
        marked = new boolean[g.vertexCount()];
        id = new int[g.vertexCount()];
        DepthFirstOrder order = new DepthFirstOrder(g.reverse());   // DFS em G^R
        for (int s : order.reversePostorder()) {
            if (!marked[s]) {
                dfs(g, s);   // DFS em G, na pós-ordem reversa de G^R
                count++;
            }
        }
    }

    private void dfs(Digraph g, int v) {
        marked[v] = true;
        id[v] = count;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
    }

    public boolean stronglyConnected(int v, int w) { return id[v] == id[w]; }
    public int id(int v) { return id[v]; }
    public int count() { return count; }
}
```

Aparte: CLRS apresenta essencialmente a mesma ideia de duas passadas, mas na ordem oposta em relação a qual grafo cada passada percorre. O `STRONGLY-CONNECTED-COMPONENTS` deles roda o DFS de *ordenação* no próprio `G` para calcular tempos de término, depois roda o DFS *principal* em `G^T`, visitando vértices em ordem decrescente de tempo de término. Sedgewick e Wayne, em vez disso, rodam o DFS de ordenação em `G^R` e o DFS principal em `G`. Troque qual grafo é "o que está sendo reordenado" versus "o que está finalmente sendo buscado" e as duas receitas descrevem o mesmo algoritmo — as provas de ambos os livros se apoiam no mesmo fato subjacente, de que a ordem de término de um grafo indica uma ordem de processamento segura para o outro.

Trace num pequeno digrafo verificado à mão com dois ciclos reais: `0 -> 1 -> 2 -> 0` (um SCC) alimentando `3 -> 4 -> 3` (um segundo SCC), que alimenta um sumidouro `5` (seu próprio SCC unitário):

**Passada 1 — DFS em `G^R` (a transposta) para calcular a pós-ordem reversa.** Invertendo `0->1, 1->2, 2->0, 2->3, 3->4, 4->3, 4->5` obtemos as arestas de `G^R`: `0->2, 1->0, 2->1, 3->2, 3->4, 4->3, 5->4`. O laço externo visita vértices não marcados na ordem numérica simples `0..5`; `visit` abaixo marca o *término* de cada vértice, já que a ordem de término é o que essa passada existe para produzir:

```viz
type: graph
node 0 0 0 0
node 1 1 1 0
node 2 2 2 0
node 3 3 0 1
node 4 4 1 1
node 5 5 2 1
edge 0 2 directed
edge 1 0 directed
edge 2 1 directed
edge 3 2 directed
edge 3 4 directed
edge 4 3 directed
edge 5 4 directed
---
traverse 0 2 | dfs(0) começa (primeiro vértice não marcado do laço externo); "2" está desmarcado -- aresta de árvore 0->2.
traverse 2 1 | O vizinho "1" de dfs(2) está desmarcado -- aresta de árvore 2->1.
mark 0 | O vizinho "0" de dfs(1) já está marcado (ancestral, ainda na pilha de chamadas) -- aresta de retorno, apenas uma checagem.
visit 1 | dfs(1) não tem mais vizinhos, então termina. "1" é o PRIMEIRO vértice a terminar.
visit 2 | De volta em dfs(2): nenhum vizinho resta, então termina agora que dfs(1) retornou. "2" termina em segundo.
visit 0 | De volta em dfs(0): nenhum vizinho resta, então termina, completando a primeira árvore. "0" termina em terceiro.
mark 2 | O próximo vértice não marcado do laço externo é "3" -- dfs(3) começa; o vizinho "2" já está preto (terminado) -- não é aresta de árvore, apenas uma checagem.
traverse 3 4 | O próximo vizinho de dfs(3), "4", está desmarcado -- aresta de árvore 3->4.
mark 3 | O vizinho "3" de dfs(4) já está marcado (ancestral, ainda na pilha) -- aresta de retorno, apenas uma checagem.
visit 4 | dfs(4) não tem mais vizinhos, então termina. "4" termina em quarto.
visit 3 | De volta em dfs(3): nenhum vizinho resta, então termina. "3" termina em quinto.
mark 4 | O último vértice não marcado do laço externo é "5" -- dfs(5) começa; seu único vizinho "4" já está preto (terminado) -- não é aresta de árvore, apenas uma checagem.
visit 5 | dfs(5) não tem mais vizinhos, então termina imediatamente. "5" termina em sexto, completando a varredura.
```

Lendo a ordem de término desses passos `visit`, obtemos `1, 2, 0, 4, 3, 5`. Invertida, essa é a sequência em que a passada 2 deve checar os vértices não marcados: `5, 3, 4, 0, 2, 1`.

**Passada 2 — DFS no `G` original, laço externo conduzido por essa sequência de pós-ordem reversa.** Arestas de `G`: `0->1, 1->2, 2->0, 2->3, 3->4, 4->3, 4->5`. Aqui `visit` marca a *descoberta* (como no trace do concept irmão de DFS), e um `mark` final nos vértices de cada árvore sinaliza o SCC que acabou de completar:

```viz
type: graph
node 0 0 0 0
node 1 1 1 0
node 2 2 2 0
node 3 3 0 1
node 4 4 1 1
node 5 5 2 1
edge 0 1 directed
edge 1 2 directed
edge 2 0 directed
edge 2 3 directed
edge 3 4 directed
edge 4 3 directed
edge 4 5 directed
---
visit 5 | O primeiro vértice da pós-ordem reversa é "5" -- dfs(5) começa. Não tem arestas de saída, então retorna imediatamente.
mark 5 | dfs(5) não alcançou mais nada -- o componente {5} está completo: SCC #0.
visit 3 | O próximo vértice não marcado da ordem é "3" -- dfs(3) começa.
traverse 3 4 | O único vizinho de 3, "4", está desmarcado -- aresta de árvore 3->4.
visit 4 | dfs(4) começa.
mark 3 | O vizinho "3" de 4 já está marcado (dfs(3) ainda está na pilha) -- aresta de retorno, confirma que 3 e 4 se alcançam mutuamente.
mark 5 | O outro vizinho de 4, "5", também já está marcado, mas de uma árvore anterior já terminada -- NÃO é puxado para esta árvore.
mark 4 | dfs(4) e depois dfs(3) retornam -- o componente {3, 4} está completo: SCC #1.
visit 0 | O próximo vértice não marcado da ordem é "0" -- dfs(0) começa.
traverse 0 1 | O vizinho "1" de 0 está desmarcado -- aresta de árvore 0->1.
visit 1 | dfs(1) começa.
traverse 1 2 | O vizinho "2" de 1 está desmarcado -- aresta de árvore 1->2.
visit 2 | dfs(2) começa.
mark 0 | O vizinho "0" de 2 já está marcado (ancestral, ainda na pilha) -- aresta de retorno, confirma que 0 e 2 se alcançam mutuamente.
mark 3 | O outro vizinho de 2, "3", também já está marcado, mas de uma árvore anterior já terminada -- confirma que é um componente diferente.
mark 2 | dfs(2), dfs(1) e dfs(0) retornam em sequência -- o componente {0, 1, 2} está completo: SCC #2. O laço externo não tem mais vértices não marcados; concluído.
```

Três árvores de DFS, três SCCs: `{5}`, `{3, 4}`, `{0, 1, 2}` — combinando exatamente com os dois ciclos desenhados à mão do grafo mais o sumidouro unitário.

### Por que o algoritmo é correto, e seu tempo de execução

A versão resumida da Proposição H de Sedgewick e Wayne: o laço externo da segunda passada sempre inicia uma nova árvore de DFS a partir do vértice não marcado com o tempo de término *mais recente* restante, segundo a ordenação calculada na passada sobre `G^R`. Todo vértice mutuamente alcançável com essa raiz é puxado para sua árvore (um argumento de existência de caminho por contradição — se algum `v` fortemente conexo com a raiz `s` fosse deixado de fora, `v` teria que ter terminado antes de `s` começar na passada de ordenação, o que só é possível se `s` também for alcançável a partir de `v` nessa mesma passada, o que significaria que `s` já estaria marcado, contradizendo o fato de que `dfs(G, s)` rodou de fato). Igualmente importante, nada *fora* do SCC atual é puxado por engano: qualquer vértice `v` que `s` apenas consegue alcançar — sem que `v` consiga voltar até `s` — é garantido, pela ordenação da pós-ordem reversa, já ter terminado (e portanto já ter sido marcado, em uma árvore anterior) antes de a segunda passada sequer começar a explorar a partir de `s`. Essa é a mesma contabilidade de tempo de término em que o concept irmão de ordenação topológica se apoia, só que aplicada a um grafo que não precisa ser acíclico: ela garante uma *ordem de processamento segura*, não uma ordem topológica válida, já que um digrafo geral pode ter ciclos que um DAG não pode.

O tempo de execução é O(V + E): construir `G^R` custa Θ(V + E), o DFS de ordenação sobre `G^R` custa Θ(V + E), e o DFS principal sobre `G` custa Θ(V + E) — três passos de tempo linear encadeados, ainda linear no total. Sedgewick e Wayne afirmam isso diretamente como Proposição I: tempo e espaço de pré-processamento proporcionais a `V + E` sustentam consultas de conectividade forte em tempo constante depois, via `id[v] == id[w]`.

## Trade-offs

- **Tempo O(V + E), mas com overhead real de fator constante que uma única passada de DFS nunca paga.** Diferente do `ConnectedComponents` do concept irmão de DFS (uma passada, sem estrutura extra), o algoritmo de Kosaraju precisa de um grafo transposto completo, construído e mantido em memória junto com o original, mais duas travessias de DFS separadas — três passadas lineares em vez de uma.
- **Simples de codificar, mas o argumento de corretude é genuinamente sutil.** Sedgewick e Wayne chamam o algoritmo de Kosaraju de "um exemplo extremo de um método fácil de codificar mas difícil de entender" — a implementação difere de componentes conexos simples por apenas algumas linhas, mas a razão de essas poucas linhas funcionarem depende do argumento de tempo de término acima, não de nada visível no código em si.
- **Não é a única opção de tempo linear.** O algoritmo de Tarjan (creditado nas notas do capítulo de CLRS como o algoritmo original de tempo linear para SCC, anterior a essa abordagem de duas passadas) calcula a mesma decomposição em uma *única* passada de DFS usando valores de low-link e uma pilha explícita, trocando a simplicidade de Kosaraju por uma contabilidade por vértice mais intrincada e sem nunca precisar materializar o grafo transposto.
- **A saída alimenta diretamente o concept irmão de ordenação topológica.** Contrair todo SCC até um único vértice sempre produz um grafo de componentes acíclico (o `G_SCC` de CLRS) — então, uma vez conhecidos os SCCs de um digrafo, a ordenação topológica pode ordenar os próprios componentes, exatamente o padrão "decomponha, depois processe cada componente e combine pela estrutura" que os Casos de Uso desta seção descrevem.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.2 "Directed Graphs", "Strong components" (Kosaraju's algorithm), pp. 586-591 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 20.5 "Strongly connected components", pp. 577-580 — book
- [Princeton Algorithms, 4th Ed. — KosarajuSCC.java (companion site)](https://algs4.cs.princeton.edu/42digraph/KosarajuSCC.java.html) — doc
