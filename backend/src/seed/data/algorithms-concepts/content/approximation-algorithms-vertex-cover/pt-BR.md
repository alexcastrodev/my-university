---
version: 1.0
updatedAt: 2026-08-14
title: "Algoritmos de Aproximação: Vertex Cover e TSP"
description: "Cobre APPROX-VERTEX-COVER, uma 2-aproximação em tempo polinomial para o problema NP-completo de vertex cover, e APPROX-TSP-TOUR, uma 2-aproximação para o problema do caixeiro-viajante sob a desigualdade triangular, além de por que não existe aproximação de razão constante sem ela."
---
## Objetivo

O conceito de P vs NP e reducibilidade termina numa conclusão prática: a maioria dos problemas de otimização que aparecem em escalonamento, roteamento e alocação de recursos é NP-hard, então quase certamente não existe algoritmo em tempo polinomial que encontre o ótimo *exato*. Algoritmos de aproximação são a resposta disciplinada a essa conclusão — em vez de desistir da eficiência ou recorrer a uma heurística sem limite, eles trocam otimalidade por uma **razão provada e limitada** entre o valor da solução retornada e o valor do ótimo verdadeiro, ainda rodando em tempo polinomial. Este conceito cobre os dois exemplos principais que Cormen et al. usam para introduzir essa ideia no Capítulo 35: `APPROX-VERTEX-COVER`, uma 2-aproximação limpa em tempo polinomial para o problema NP-completo de vertex cover, e `APPROX-TSP-TOUR`, uma 2-aproximação para o problema do caixeiro-viajante que só funciona quando os custos das arestas obedecem a desigualdade triangular — e o teorema que explica por que essa restrição não é opcional.

## Casos de Uso

- Recorrer a `APPROX-VERTEX-COVER` sempre que você precisar de *um* vertex cover com garantia de qualidade comprovada em tempo polinomial, em vez de buscar um cover ótimo exato — o que é NP-completo, conforme estabelecido no conceito irmão de P vs NP e reducibilidade.
- Reconhecer a metodologia geral de prova — encontrar um limite inferior para o ótimo usando uma estrutura relaxada mais barata (um matching maximal para vertex cover, uma árvore geradora mínima para TSP), depois limitar a saída do algoritmo contra esse limite inferior — já que a fonte observa explicitamente que "usaremos essa metodologia em seções posteriores também".
- Verificar se sua função de custo de aresta satisfaz a desigualdade triangular (como a distância euclidiana comum entre pontos no plano satisfaz) antes de recorrer a `APPROX-TSP-TOUR`: a garantia de 2-aproximação só vale sob essa suposição.
- Reconhecer quando parar de procurar por *qualquer* aproximação de razão limitada em tempo polinomial: para o problema geral do caixeiro-viajante sem a desigualdade triangular, o Teorema 35.3 prova que nenhum algoritmo assim existe para nenhuma razão constante, a menos que P = NP.

## Aprofundamento

### APPROX-VERTEX-COVER: escolha uma aresta, cubra ambos os extremos, repita

```java
// Tradução fiel de APPROX-VERTEX-COVER(G) (CLRS, Seção 35.1).
// remaining modela E' como conjuntos de adjacência, então uma aresta e tudo
// incidente a seus extremos pode ser removido em O(1) amortizado por aresta
// removida, dando o tempo de execução O(V + E) que a fonte afirma.
Set<Integer> approxVertexCover(Map<Integer, Set<Integer>> adjacency) {
    Map<Integer, Set<Integer>> remaining = deepCopy(adjacency); // linha 2: E' = G.E
    Set<Integer> cover = new HashSet<>();                       // linha 1: C = {}

    while (hasAnyEdge(remaining)) {                             // linha 3
        int u = anyVertexWithEdge(remaining);                   // linha 4
        int v = remaining.get(u).iterator().next();

        cover.add(u);                                           // linha 5
        cover.add(v);

        removeAllIncidentEdges(remaining, u);                   // linha 6
        removeAllIncidentEdges(remaining, v);
    }
    return cover;                                                // linha 7
}
```

Um vertex cover de um grafo não direcionado `G = (V, E)` é um subconjunto `V' ⊆ V` tal que toda aresta `(u, v) ∈ E` tem pelo menos um extremo em `V'`. O problema do vertex cover pede o menor subconjunto assim; esse problema de decisão é NP-completo, e ninguém conhece um algoritmo em tempo polinomial que encontre um cover *ótimo*. `APPROX-VERTEX-COVER` contorna isso retornando um cover que tem garantia de ser **no máximo o dobro** do tamanho de um cover ótimo, em tempo `O(V + E)` usando listas de adjacência.

O grafo de exemplo abaixo traça o algoritmo num caminho de 6 vértices `a-b-c-d-e-f` (arestas `a-b, b-c, c-d, d-e, e-f`). Como as arestas do motor são fixas uma vez desenhadas (não podem ser deletadas visualmente), a legenda de cada passo narra quais arestas a linha 6 remove de `E'` — as marcas `visit` persistentes rastreiam a pertença a `C`, e `traverse` destaca a aresta escolhida na linha 4:

```viz
type: graph
node a a 0 0
node b b 1 0
node c c 2 0
node d d 3 0
node e e 4 0
node f f 5 0
edge a b
edge b c
edge c d
edge d e
edge e f
---
traverse a b | Linha 4: escolhe a aresta arbitrária (a, b) de E'.
visit a | Linha 5: C = C ∪ {a}.
visit b | Linha 5: C = C ∪ {b}. A linha 6 agora remove (a,b) e (b,c) de E' -- ambas incidentes a a ou b.
traverse c d | E' agora contém apenas {(c,d), (d,e), (e,f)}. Linha 4: escolhe a aresta (c, d).
visit c | Linha 5: C = C ∪ {c}.
visit d | Linha 5: C = C ∪ {d}. A linha 6 remove (c,d) e (d,e) de E'.
traverse e f | Só resta (e,f) em E'. Linha 4: escolhe ela.
visit e | Linha 5: C = C ∪ {e}.
visit f | Linha 5: C = C ∪ {f}. A linha 6 remove (e,f); E' fica vazio, então o laço enquanto (linha 3) termina.
```

`APPROX-VERTEX-COVER` retorna `C = {a, b, c, d, e, f}` — os seis vértices — enquanto um cover ótimo para esse caminho é `{b, d, f}`, tamanho 3. Então aqui o algoritmo retorna exatamente o dobro do ótimo, que é o pior caso que o Teorema 35.1 permite. A própria Figura 35.1 da fonte roda o mesmo algoritmo num grafo diferente de 7 vértices e 8 arestas e reporta o mesmo formato de resultado: o algoritmo escolhe as arestas `(b,c)`, `(e,f)` e `(d,g)` em sequência, retornando `C = {b, c, d, e, f, g}` (tamanho 6), contra um cover ótimo `{b, d, e}` (tamanho 3) — de novo, exatamente um fator de 2.

### Por que a razão é exatamente 2: o limite inferior do matching maximal

O Teorema 35.1 afirma que `APPROX-VERTEX-COVER` é um algoritmo de 2-aproximação em tempo polinomial. A prova não precisa saber o tamanho de um cover ótimo `C*` — ela só precisa de um *limite inferior* para ele, obtido de forma barata:

- Seja `A` o conjunto de arestas escolhidas pela linha 4 ao longo de todas as iterações. Nenhuma duas arestas em `A` compartilham um extremo: uma vez que uma aresta é escolhida, a linha 6 deleta toda outra aresta incidente em seus extremos de `E'`, então `A` é um matching — na verdade um matching *maximal* em `G` (Exercício 35.1-2).
- Todo vertex cover — em particular um ótimo, `C*` — precisa incluir pelo menos um extremo de toda aresta em `A`, e como nenhuma duas arestas em `A` compartilham um extremo, nenhum vértice único de `C*` pode cobrir duas delas. Isso dá o limite inferior `|C*| ≥ |A|`.
- Cada iteração do laço adiciona exatamente 2 vértices novos a `C` (ambos os extremos da aresta escolhida, nenhum dos quais já estava em `C`), então `|C| = 2|A|` exatamente.
- Combinando: `|C| = 2|A| ≤ 2|C*|`.

Esse último passo é a prova inteira: a saída do algoritmo fica presa ao dobro de um *limite inferior* do ótimo, e o limite inferior vem de graça do fato de que as arestas escolhidas nunca se sobrepõem. A fonte destaca exatamente esse padrão — limitar o algoritmo contra uma estrutura de limite inferior barata em vez do ótimo exato (desconhecido) — como uma metodologia reutilizada no resto do capítulo.

### APPROX-TSP-TOUR: construa uma MST, depois percorra ela

```java
// Tradução fiel de APPROX-TSP-TOUR(G, c) (CLRS, Seção 35.2.1).
// Só válido quando c satisfaz a desigualdade triangular: c(u,w) <= c(u,v) + c(v,w).
List<Integer> approxTspTour(Graph g, CostFunction c, int root) {
    Tree mst = mstPrim(g, c, root);          // linha 2: árvore geradora mínima a partir da raiz r

    List<Integer> tour = new ArrayList<>();
    preorderWalk(mst, root, tour::add);       // linha 3: lista cada vértice quando visitado pela primeira vez

    return tour;                              // linha 4: o ciclo hamiltoniano H
}
```

A entrada é um grafo não direcionado completo `G = (V, E)` com um custo inteiro não negativo `c(u, v)` em toda aresta, e o objetivo é o ciclo hamiltoniano (tour) de custo mínimo. `APPROX-TSP-TOUR` seleciona uma raiz `r`, calcula uma árvore geradora mínima `T` de `G` a partir de `r` via `MST-PRIM`, depois retorna o tour dado por uma **caminhada em pré-ordem** de `T` (cada vértice listado na primeira vez em que é encontrado). Com uma implementação simples de `MST-PRIM`, o tempo de execução é `Θ(V²)`.

Teorema 35.2: quando a função de custo satisfaz a desigualdade triangular, `APPROX-TSP-TOUR` é uma 2-aproximação em tempo polinomial. A prova reutiliza a mesma metodologia de "limite inferior barato" do vertex cover:

- Deletar qualquer aresta de um tour ótimo `H*` produz uma árvore geradora, e os custos são não negativos, então o peso da MST limita inferiormente o tour ótimo: `c(T) ≤ c(H*)`.
- Uma **caminhada completa** `W` de `T` (visitando um vértice de novo toda vez que a caminhada retorna a ele depois de uma subárvore) percorre toda aresta da árvore exatamente duas vezes, então `c(W) = 2·c(T) ≤ 2·c(H*)`.
- `W` não é um tour em si (ela revisita vértices), mas a desigualdade triangular garante que deletar uma visita repetida a um vértice — indo diretamente de seu predecessor para seu sucessor na caminhada — nunca aumenta o custo. Remover toda visita repetida de `W` deixa exatamente a ordenação da caminhada em pré-ordem, ou seja, o tour `H` que o algoritmo retorna, então `c(H) ≤ c(W)`.
- Combinando: `c(H) ≤ c(W) ≤ 2·c(H*)`.

O próprio exemplo resolvido da fonte (Figura 35.2) cresce uma MST a partir de uma raiz `a` sobre 8 pontos numa grade, cuja caminhada completa é `a, b, c, b, h, b, a, d, e, f, e, g, e, d, a`; colapsando visitas repetidas dá o tour em pré-ordem `a, b, c, h, d, e, f, g`, com custo de aproximadamente 19,074, contra um tour ótimo de custo aproximadamente 14,715 — bem dentro do limite de fator 2.

### Por que nenhuma aproximação existe sem a desigualdade triangular

Teorema 35.3: se `P ≠ NP`, então para **qualquer** razão constante `ρ ≥ 1` não existe algoritmo de `ρ`-aproximação em tempo polinomial para o problema geral do caixeiro-viajante (sem suposição de desigualdade triangular). A prova é uma redução do problema NP-completo do ciclo hamiltoniano, e é o modelo geral que o capítulo usa para provar que *nenhuma* boa aproximação existe:

- Dado um grafo `G = (V, E)` (uma instância de ciclo hamiltoniano), construa o grafo completo `G' = (V, E')` com função de custo `c(u, v) = 1` se `(u, v) ∈ E`, e `c(u, v) = ρ|V| + 1` caso contrário.
- Se `G` tem um ciclo hamiltoniano, `(G', c)` tem um tour de custo exatamente `|V|`. Se `G` não tem ciclo hamiltoniano, todo tour de `G'` precisa usar pelo menos uma não-aresta, custando pelo menos `(ρ|V| + 1) + (|V| - 1) = ρ|V| + |V| > ρ|V|`.
- Essa lacuna — `|V|` versus mais que `ρ|V|` — é maior que a razão `ρ` que um hipotético algoritmo de `ρ`-aproximação `A` tem permissão de errar. Então `A` rodado em `(G', c)` precisa retornar o tour de custo `|V|` sempre que um existir, e nunca pode retornar um quando não existe — o que significa que `A` decide ciclo hamiltoniano em tempo polinomial, contradizendo sua NP-completude a menos que `P = NP`.

Como o problema do caixeiro-viajante continua NP-completo mesmo *com* a desigualdade triangular (Exercício 35.2-2), a leitura prática é: verifique se sua função de custo satisfaz a desigualdade triangular antes de investir numa aproximação para TSP. Se satisfaz, `APPROX-TSP-TOUR` dá um fator genuíno e provado de 2. Se não satisfaz, nenhuma aproximação de razão constante em tempo polinomial existe, a menos que P = NP.

## Trade-offs

- **Escolha arbitrária de aresta, não gulosa por grau** — o poder de `APPROX-VERTEX-COVER` vem de escolher *qualquer* aresta não coberta e pegar ambos os extremos, o que é o que faz o argumento do matching funcionar. O próprio Exercício 35.1-3 da fonte aponta que a heurística aparentemente mais esperta de remover repetidamente o vértice de maior grau **não** garante uma razão de 2 — o algoritmo simples vence o intuitivamente-guloso.
- **O limite do vertex cover é justo, não apenas uma estimativa superior** — a prova mostra `|C| = 2|A|` exatamente, não apenas `≤`, então em entradas como o exemplo do caminho acima (ou a própria Figura 35.1 da fonte) o algoritmo realmente retorna o dobro do ótimo, não apenas "até" o dobro.
- **A garantia de APPROX-TSP-TOUR é condicionada à desigualdade triangular** — sem ela, o Teorema 35.3 descarta *qualquer* aproximação de razão constante em tempo polinomial a menos que P = NP, então a 2-aproximação só se aplica a uma classe restrita de instâncias (ainda que comum, por exemplo distância euclidiana).
- **Uma razão provada não é o mesmo que o melhor algoritmo prático** — a fonte observa explicitamente que, apesar de sua razão limpa de 2-aproximação, `APPROX-TSP-TOUR` "geralmente não é a melhor escolha prática para esse problema", e que outros algoritmos de aproximação tipicamente performam muito melhor na prática, sem abrir mão da garantia de tempo polinomial.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 35 "Approximation Algorithms", Sections 35.1-35.2, pp. 1106-1114](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
