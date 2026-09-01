---
version: 1.0
updatedAt: 2026-08-17
title: "Maximum Bipartite Matching e o Algoritmo Húngaro"
description: "Como caminhos M-aumentantes e diferença simétrica resolvem maximum bipartite matching diretamente — sem redução a max-flow — com Hopcroft-Karp alcançando O(√V·E), e como adicionar pesos de aresta transforma isso no assignment problem, que o algoritmo húngaro resolve reetiquetando repetidamente vértices até que algum matching perfeito apareça dentro de um equality subgraph."
---
## Objetivo

Entenda como encontrar um **matching máximo** num grafo bipartido não direcionado `G = (V, E)` com `V = L ∪ R` *sem* passar por uma rede de fluxo — a formulação por caminhos aumentantes que Cormen, Leiserson, Rivest e Stein dão na Seção 25.1, culminando no **algoritmo de Hopcroft-Karp** em `O(√V · E)` — e depois como estendê-la para arestas ponderadas: o **assignment problem**, onde toda aresta `(l, r)` carrega um peso `w(l, r)` e o objetivo é um matching *perfeito* de peso total máximo, resolvido pelo **algoritmo húngaro** em `O(n⁴)` (refinável para `O(n³)`).

A Seção 25.1 se chama "Maximum bipartite matching (**revisited**)" porque o CLRS já resolveu esse problema uma vez, na Seção 24.3, por redução a max-flow — o assunto do conceito "Max-Flow Min-Cut: Augmenting Paths and Ford-Fulkerson" desta coleção. A revisita descarta a redução completamente: sem capacidades, sem source e sink, sem residual graph. Ela trabalha diretamente no grafo bipartido não direcionado usando *caminhos M-aumentantes* e diferença simétrica de conjuntos, e é estritamente mais rápida que rotear o problema através de Ford-Fulkerson.

## Casos de Uso

- Qualquer problema de "parear dois grupos disjuntos, um parceiro cada" onde todo pareamento permitido é igualmente bom e você só quer o máximo de pares possível — maximum bipartite matching em sua forma simples.
- O **assignment problem**: os mesmos dois grupos, mas agora a aresta `(l, r)` tem um peso `w(l, r)` representando "a utilidade ganha ao parear `l` com `r`", e a resposta precisa ser um matching perfeito maximizando a utilidade total. O CLRS posiciona isso como um irmão do problema do casamento estável (o conceito "O Problema do Casamento Estável e o Algoritmo de Gale-Shapley" desta coleção): o mesmo grafo bipartido completo, mas cada vértice ranqueando o outro lado é substituído por pesos numéricos de aresta, então "bom" significa *valor total máximo* em vez de *estável*.
- Problemas que não parecem literalmente com assignment mas se reduzem a ele reformatando o grafo de entrada: o Problema 25-3 do CLRS pede maximum-weight matching num grafo bipartido que **não** é completo, o mesmo com pesos zero ou negativos permitidos, e **maximum-weight cycle cover** num grafo direcionado arbitrário (um conjunto de ciclos direcionados aresta-disjuntos cobrindo cada vértice no máximo uma vez) — tudo modificando a entrada, rodando o algoritmo húngaro, e depois possivelmente modificando a saída.
- Minimização de custo em vez de maximização de utilidade, e lados desbalanceados: os Exercícios 25.3-6 e 25.3-7 propõem exatamente essas duas adaptações (minimizar a soma dos pesos das arestas pareadas; lidar com `|L| ≠ |R|`), então o algoritmo é o caso base de uma família de variantes de assignment em vez de um procedimento único e rígido.
- Perguntas estruturais de existência sobre matchings perfeitos: o Exercício 25.1-5 enuncia o **teorema de Hall** — um grafo bipartido com `|L| = |R|` tem um matching perfeito se e somente se `|A| ≤ |N(A)|` para todo subconjunto `A ⊆ L`, onde `N(A)` é o conjunto de vértices adjacentes a algum membro de `A` — e o Exercício 25.1-6 o usa para mostrar que todo grafo bipartido `d`-regular contém `d` matchings perfeitos disjuntos.

## Aprofundamento

### Matched, maximal, maximum — três palavras que não são sinônimos

Um vértice com uma aresta incidente no matching `M` está **matched** sob `M`; caso contrário está **não matched**. Um matching **maximal** é aquele ao qual nenhuma outra aresta pode ser adicionada: para toda aresta `e ∈ E - M`, o conjunto `M ∪ {e}` deixa de ser um matching. Um matching **máximo** é o de maior cardinalidade.

> Um matching máximo é sempre maximal, mas o inverso nem sempre vale.

Essa assimetria é a razão inteira pela qual caminhos aumentantes existem. Uma passada gulosa produz um matching maximal barato, e um matching maximal pode ser estritamente menor que um máximo — então os algoritmos abaixo precisam de um jeito de *melhorar* um matching existente, não apenas de continuar adicionando arestas a ele.

### Caminhos alternantes, caminhos aumentantes e diferença simétrica

Dado um matching `M` num grafo não direcionado `G = (V, E)`:

- Um **caminho M-alternante** é um caminho simples cujas arestas alternam entre estar em `M` e estar em `E - M`.
- Um **caminho M-aumentante** (um "caminho aumentante em relação a `M`") é um caminho M-alternante cuja *primeira e última* arestas pertencem a `E - M`.

Como um caminho M-aumentante contém uma aresta a mais de `E - M` do que de `M`, ele precisa ter um número **ímpar** de arestas, e ambos os seus extremos não estão matched sob `M`.

A operação de melhoria é a **diferença simétrica** de conjuntos: `X ⊕ Y = (X - Y) ∪ (Y - X)`, os elementos em `X` ou `Y` mas não em ambos — equivalentemente `(X ∪ Y) - (X ∩ Y)`. O operador é comutativo e associativo, `X ⊕ X = ∅`, e `X ⊕ ∅ = ∅ ⊕ X = X`, então o conjunto vazio é seu elemento identidade.

**Lema 25.1.** Seja `M` um matching num grafo não direcionado qualquer `G = (V, E)` e `P` um caminho M-aumentante. Então `M' = M ⊕ P` também é um matching em `G`, com `|M'| = |M| + 1`.

*Esboço da prova.* Seja `P` com `q` arestas `(v₁,v₂), (v₂,v₃), …, (v_q, v_{q+1})`, das quais `⌈q/2⌉` estão em `E - M` e `⌊q/2⌋` estão em `M`. Como `P` é M-aumentante, `v₁` e `v_{q+1}` não estão matched e todos os outros vértices de `P` estão. As arestas de índice ímpar `(v₁,v₂), (v₃,v₄), …` estão em `E - M` e as de índice par `(v₂,v₃), (v₄,v₅), …` estão em `M`; a diferença simétrica simplesmente **inverte esses papéis**. Todo vértice de `P` fica matched sob `M'`, nenhum vértice ou aresta fora de `P` é tocado, e `M'` ganha exatamente uma aresta.

**Corolário 25.2.** Para caminhos M-aumentantes **vértice-disjuntos** `P₁, P₂, …, P_k`, o conjunto `M' = M ⊕ (P₁ ∪ P₂ ∪ ⋯ ∪ P_k)` é um matching com `|M'| = |M| + k`. A disjunção de vértices torna a união igual a `P₁ ⊕ P₂ ⊕ ⋯ ⊕ P_k`, e a associatividade de `⊕` permite que uma indução simples aplique o Lema 25.1 uma vez por caminho.

Em Java, "inverta o caminho" é tudo o que o Lema 25.1 pede — e isso cai diretamente do desenrolar de uma recursão, motivo pelo qual o algoritmo simples abaixo é tão curto:

```java
// O algoritmo simples O(VE) que o CLRS descreve antes de introduzir Hopcroft-Karp: comece com M
// vazio, depois de todo vértice não matched em L rode uma busca que percorre caminhos alternantes
// até alcançar outro vértice não matched, e use o caminho M-aumentante resultante para crescer M em 1.
final class BipartiteMatching {
    private final List<List<Integer>> adjOfL;  // para cada l em L, seus vizinhos em R
    private final int[] matchOfR;              // matchOfR[r] = o l pareado com r, ou -1
    private boolean[] seenR;

    BipartiteMatching(List<List<Integer>> adjOfL, int sizeOfR) {
        this.adjOfL = adjOfL;
        this.matchOfR = new int[sizeOfR];
        Arrays.fill(matchOfR, -1);
    }

    int maximumMatching() {
        int size = 0;
        for (int l = 0; l < adjOfL.size(); l++) {
            seenR = new boolean[matchOfR.length];
            if (augmentFrom(l)) size++;  // exatamente um caminho aumentante => |M| cresce exatamente 1
        }
        return size;                     // nenhum caminho aumentante a partir de nenhum l => máximo (Corolário 25.4)
    }

    // True se existe um caminho M-aumentante começando em l. A reatribuição de matchOfR acontece
    // conforme a recursão desenrola, então toda aresta do caminho troca de dentro/fora de M de uma vez: M (+) P.
    private boolean augmentFrom(int l) {
        for (int r : adjOfL.get(l)) {   // aresta (l, r) em E - M -- o salto L -> R do caminho
            if (seenR[r]) continue;
            seenR[r] = true;
            // r não matched => o caminho aumentante termina aqui. Caso contrário recursa pela
            // aresta matched (r, matchOfR[r]) -- o salto R -> L, que precisa pertencer a M.
            if (matchOfR[r] == -1 || augmentFrom(matchOfR[r])) {
                matchOfR[r] = l;
                return true;
            }
        }
        return false;  // nenhum caminho alternante a partir de l alcança um vértice não matched em R
    }
}
```

### Quando parar: nenhum caminho aumentante significa máximo

**Lema 25.3.** Sejam `M` e `M*` matchings em `G = (V, E)` e considere `G' = (V, E')` com `E' = M ⊕ M*`. Então `G'` é uma união disjunta de caminhos simples, ciclos simples e/ou vértices isolados; as arestas de todo caminho ou ciclo assim alternam entre `M` e `M*`. Se `|M*| > |M|`, então `G'` contém pelo menos `|M*| - |M|` caminhos M-aumentantes vértice-disjuntos.

*Por quê.* Todo vértice de `G'` tem grau 0, 1 ou 2, porque no máximo uma aresta de `M` e no máximo uma de `M*` podem ser incidentes nele — então todo componente é um vértice isolado, um ciclo alternante de comprimento par, ou um caminho simples alternante. Cada ciclo contribui com igual número de arestas de `M` e `M*`, então o excedente `|M*| - |M|` de arestas de `M*` precisa viver nos caminhos; todo caminho excedente começa e termina com arestas de `M*`, o que o torna M-aumentante. Grau ≤ 2 força esses caminhos a serem vértice-disjuntos.

**Corolário 25.4** (devido a Berge, e verdadeiro em grafos não bipartidos também). **`M` é um matching máximo se e somente se `G` não contém nenhum caminho M-aumentante.**

Direção direta (por contrapositiva): se um caminho M-aumentante `P` existe, `M ⊕ P` é maior, então `M` não era máximo. Direção reversa (por contrapositiva): se `M` não é máximo, tome `M*` máximo no Lema 25.3; como `|M*| > |M|`, pelo menos um caminho M-aumentante existe.

Esse corolário é a condição de parada para tudo o que vem a seguir — ele desempenha exatamente o papel que "nenhum caminho aumentante resta no residual graph" desempenha para Ford-Fulkerson, mas é provado aqui a partir de diferenças simétricas de matchings em vez do teorema max-flow min-cut.

O Corolário 25.4 também dá o algoritmo simples diretamente, em `O(VE)`:

> Comece com o matching `M` vazio. Depois rode repetidamente uma variante de busca em largura ou busca em profundidade a partir de um vértice não matched que percorra caminhos alternantes até achar outro vértice não matched. Use o caminho M-aumentante resultante para aumentar o tamanho de `M` em 1.

### Traço: o algoritmo simples de caminhos aumentantes num grafo bipartido de seis vértices

`L = {l1, l2, l3}`, `R = {r1, r2, r3}`, com arestas `(l1,r1)`, `(l1,r2)`, `(l2,r1)`, `(l3,r2)`, `(l3,r3)`. Comece com `M = ∅` e busque a partir de cada vértice não matched em `L` por vez.

```viz
type: graph
node l1 l1 0 0
node l2 l2 0 1
node l3 l3 0 2
node r1 r1 2 0
node r2 r2 2 1
node r3 r3 2 2
edge l1 r1
edge l1 r2
edge l2 r1
edge l3 r2
edge l3 r3
---
visit l1 | M está vazio, então todo vértice não está matched. Busca a partir do vértice não matched "l1".
traverse l1 r1 | A aresta (l1,r1) está em E - M, então pode ser a primeira aresta de um caminho M-aumentante.
visit r1 | "r1" não está matched, então o caminho de aresta única P = <(l1,r1)> já é M-aumentante (comprimento ímpar, ambos os extremos não matched). M (+) P = {(l1,r1)}: |M| = 1.
visit l2 | Próximo vértice não matched em L: "l2". Seu único vizinho é r1.
traverse l2 r1 | A aresta (l2,r1) está em E - M -- o primeiro salto de um novo caminho alternante.
mark r1 | "r1" está matched (com l1), então o caminho não pode parar aqui. Um caminho alternante precisa continuar pela aresta MATCHED de r1.
traverse l1 r1 | A aresta matched (r1,l1) em M -- o salto R para L. O caminho até agora alterna: (l2,r1) fora de M, depois (r1,l1) em M.
visit l1 | De volta em L, em "l1". O próximo salto precisa vir de novo de E - M.
traverse l1 r2 | A aresta (l1,r2) está em E - M.
visit r2 | "r2" não está matched: P = <(l2,r1),(r1,l1),(l1,r2)> é um caminho M-aumentante com 3 arestas. M (+) P remove (l1,r1) e adiciona (l2,r1) e (l1,r2): |M| = 2.
visit l3 | Último vértice não matched em L: "l3", com vizinhos r2 (matched com l1) e r3.
mark r2 | Tenta (l3,r2) primeiro. "r2" está matched com l1, então continua pela aresta matched (r2,l1).
mark l1 | Em "l1" a única outra aresta incidente é (l1,r1), que está em E - M.
mark r1 | "r1" está matched com l2, então o caminho alternante precisa continuar por (r1,l2).
mark l2 | "l2" não tem outra aresta incidente: esse ramo empaca sem alcançar um vértice não matched em R. Volta para l3 e tenta a outra aresta.
traverse l3 r3 | A aresta (l3,r3) está em E - M.
visit r3 | "r3" não está matched: P = <(l3,r3)> é M-aumentante. M (+) P = {(l2,r1),(l1,r2),(l3,r3)} -- |M| = 3, um matching perfeito.
mark l3 | Todo vértice em L agora está matched, então nenhuma busca sequer pode começar: G não contém caminho M-aumentante, e pelo Corolário 25.4 esse matching é máximo.
```

Duas coisas que o motor não consegue expressar, então leia-as das legendas em vez disso. Primeiro, **arestas destacadas se acumulam e nunca são desdestacadas**: a aresta `(l1,r1)` é percorrida no passo 2 e entra em `M`, mas o caminho aumentante nos passos 5-10 a inverte de volta *para fora* de `M` — o matching final é `{(l2,r1), (l1,r2), (l3,r3)}`, não as quatro arestas destacadas. Segundo, o ramo que falha a partir de `l3` (por `r2`, `l1`, `r1`, `l2`) é mostrado com `mark` em vez de `traverse` precisamente porque não contribui em nada para o matching final.

Note o que os passos 5-10 realizam: o único vizinho `r1` de `l2` já estava ocupado, e um algoritmo guloso simplesmente teria deixado `l2` não matched em tamanho 2. O caminho aumentante *reatribui* `r1` de `l1` para `l2` e reacomoda `l1` em `r2` numa única inversão. Essa reatribuição é o análogo de matching de empurrar fluxo por uma aresta reversa residual em Ford-Fulkerson — a mesma ideia de "mude de ideia sobre um compromisso anterior", expressa sem nenhum residual graph.

### O algoritmo de Hopcroft-Karp

Hopcroft-Karp melhora o limite de `O(VE)` para `O(√V · E)` aumentando ao longo de *muitos* caminhos vértice-disjuntos por iteração em vez de um só:

```
HOPCROFT-KARP(G)
1  M = ∅
2  repita
3      seja P = {P₁, P₂, …, P_k} um conjunto maximal de caminhos M-aumentantes
           mais curtos vértice-disjuntos
4      M = M ⊕ (P₁ ∪ P₂ ∪ ⋯ ∪ P_k)
5  até P == ∅
6  retorne M
```

A corretude é imediata: a linha 4 é o Corolário 25.2, e terminar quando nenhum caminho M-aumentante existir é o Corolário 25.4. O trabalho está no tempo de execução — a linha 3 em tempo `O(E)`, e `O(√V)` iterações do laço `repita`.

**Linha 3 em tempo `O(E)`, em três fases.**

1. **Direcione o grafo.** Construa `G_M = (V, E_M)` a partir do `G` não direcionado orientando cada aresta conforme como um caminho aumentante teria que usá-la — um caminho M-aumentante começa num vértice não matched em `L`, dá um número ímpar de arestas, e termina num vértice não matched em `R`, com saltos `L → R` tirados de `E - M` e saltos `R → L` tirados de `M`:

   ```
   E_M = { (l, r) : l ∈ L, r ∈ R, (l, r) ∈ E - M }   (arestas de L para R)
       ∪ { (r, l) : r ∈ R, l ∈ L, (l, r) ∈ M }       (arestas de R para L)
   ```

   Isso é uma pura reorientação: `|V_M| = |V|` e `|E_M| = |E|`.

2. **Organize em camadas num dag `H`.** Rode busca em largura em `G_M` começando de **todos** os vértices não matched em `L` de uma vez (no procedimento `BFS` padrão, substitua a raiz única `s` por esse conjunto inteiro). O atributo `d` de todo vértice é sua distância de BFS até o vértice não matched em `L` mais próximo; a camada em que um vértice está é essa distância. Vértices de `L` caem em camadas pares, vértices de `R` em camadas ímpares. Seja `q` a menor distância de qualquer vértice *não matched* em `R`; a última camada de `H` contém os vértices de `R` à distância `q`, e todo vértice cuja distância excede `q` é **excluído** de `H`. As arestas mantidas são as entre camadas consecutivas:

   ```
   E_H = { (l, r) ∈ E_M : r.d ≤ q e r.d = l.d + 1 } ∪ { (r, l) ∈ E_M : l.d ≤ q }
   ```

   Os atributos de predecessor `π` do BFS não são necessários aqui, já que `H` é um dag em vez de uma árvore. Todo caminho em `H` da camada 0 até um vértice não matched na camada `q` corresponde a um caminho M-aumentante mais curto em `G` (basta ler as arestas direcionadas como não direcionadas), e todo caminho M-aumentante mais curto em `G` está presente em `H`.

3. **Extraia um conjunto vértice-disjunto maximal, a partir da transposta.** Construa `Hᵀ` (inverta toda aresta; `H` é acíclico, então `Hᵀ` também é). Para cada vértice não matched `r` na camada `q`, rode busca em profundidade a partir de `r` até que ela alcance um vértice na camada 0 ou esgote todos os caminhos. A DFS não precisa de tempos de descoberta/finalização — só de atributos de predecessor `π`; ao alcançar a camada 0, traçar de volta ao longo de `π` produz um caminho M-aumentante. **Todo vértice só é buscado a partir dele quando é descoberto pela primeira vez em qualquer uma dessas buscas**, o que é o que torna o conjunto resultante de caminhos vértice-disjunto. Se uma busca a partir de algum `r` não consegue alcançar um vértice de camada 0 não descoberto por vértices não descobertos, nenhum caminho aumentante por `r` entra no conjunto.

Total: a fase 1 é `O(E)`; a fase 2 é `O(V_M + E_M) = O(E)` (assumindo que todo vértice tem pelo menos uma aresta incidente, então `|V| = O(E)`), e pode parar assim que a primeira distância na fila do BFS exceder `q`; a fase 3 é `O(V_H + E_H) = O(E)` pela análise padrão de DFS, já que nenhum vértice é buscado duas vezes. A linha 4 também é `O(E)` — só adicionando e removendo as arestas do caminho. Então cada iteração do `repita` custa `O(E)`.

**Maximal, não máximo, é deliberado.** No próprio exemplo resolvido do CLRS, as três buscas DFS produzem apenas dois caminhos aumentantes mais curtos vértice-disjuntos mesmo que o grafo contenha três. Isso é aceitável: a linha 3 exige que o conjunto seja *maximal* (nenhum outro caminho aumentante mais curto disjunto pode ser adicionado), nunca *máximo*. Exigir um conjunto máximo seria um problema mais difícil e não traz ganho algum.

**Por que `O(√V)` iterações.**

- **Lema 25.5** — se `q` é o comprimento de um caminho M-aumentante mais curto e `P` é um conjunto *maximal* de caminhos M-aumentantes vértice-disjuntos de comprimento `q`, então depois de `M' = M ⊕ (P₁ ∪ ⋯ ∪ P_k)`, qualquer caminho `M'`-aumentante mais curto tem **mais de `q`** arestas. A prova se divide conforme o novo caminho `P` é vértice-disjunto de `P` ou não: se é, `P` também é um caminho M-aumentante, então a maximalidade de `P` o força a ser mais longo que `q`. Se não é, então com `A = M ⊕ M' ⊕ P`, a associatividade colapsa `A` para `(P₁ ∪ ⋯ ∪ P_k) ⊕ P`; o Lema 25.3 dá `|A| ≥ (k+1)q`, enquanto compartilhar pelo menos uma aresta com algum `P_i` dá `|A| < kq + |P|` — logo `q < |P|`.
- **Lema 25.6** — se um caminho M-aumentante mais curto tem `q` arestas, o matching máximo tem tamanho no máximo `|M| + |V|/(q+1)`. (O Lema 25.3 fornece pelo menos `|M*| - |M|` caminhos aumentantes vértice-disjuntos, cada um com pelo menos `q` arestas, logo pelo menos `q+1` vértices; a disjunção dá `(|M*| - |M|)(q+1) ≤ |V|`.)
- **Lema 25.7** — combinando-os: `q` aumenta estritamente a cada iteração, então depois de `⌈√|V|⌉` iterações `q ≥ ⌈√|V|⌉`, e a partir daí o Lema 25.6 limita as iterações restantes a `⌈√|V|⌉/(⌈√|V|⌉+1) · |V| < √|V|`. Total abaixo de `2√|V|`.

**Teorema 25.8.** `HOPCROFT-KARP` roda em tempo `O(√V · E)` num grafo bipartido não direcionado.

### O assignment problem

Agora adicione pesos em vez de rankings. Pegue um grafo bipartido **completo** `G = (V, E)`, `V = L ∪ R`, com `|L| = |R| = n` (então `n²` arestas), onde toda aresta `(l, r)` tem peso `w(l, r)` representando a utilidade de parear `l` com `r`. Com `w(M) = Σ_{(l,r) ∈ M} w(l, r)`, o **assignment problem** é encontrar um matching perfeito `M*` com

```
w(M*) = max { w(M) : M é um matching perfeito }
```

Enumerar todos os `n!` matchings perfeitos funciona e é inviável. O algoritmo húngaro faz isso em `O(n⁴)` (o Problema 25-2 refina para `O(n³)`).

### O equality subgraph, e por que encontrar *qualquer* matching perfeito nele basta

O algoritmo húngaro nunca trabalha em `G` diretamente. Ele trabalha num subgrafo chamado **equality subgraph**, que muda com o tempo e tem a propriedade chave de que qualquer matching perfeito dentro dele já é uma solução ótima.

Dê a todo vértice um atributo `h`, seu **rótulo**. `h` é uma **rotulagem de vértices viável** de `G` se

```
l.h + r.h ≥ w(l, r)   para todo l ∈ L e r ∈ R
```

Uma sempre existe — a **rotulagem de vértices padrão**:

```
l.h = max { w(l, r) : r ∈ R }   para todo l ∈ L      (25.1)
r.h = 0                          para todo r ∈ R      (25.2)
```

Dada uma rotulagem viável `h`, o **equality subgraph** `G_h = (V, E_h)` mantém todos os vértices e as arestas cujos rótulos são exatamente justos:

```
E_h = { (l, r) ∈ E : l.h + r.h = w(l, r) }
```

**Teorema 25.14.** Se o equality subgraph `G_h` de uma rotulagem viável `h` contém um matching perfeito `M*`, então `M*` é uma solução ótima para o assignment problem em `G`.

*Prova.* Como toda aresta de `M*` é justa, `w(M*) = Σ_{(l,r) ∈ M*} (l.h + r.h)`, e como `M*` é perfeito isso telescopa para `Σ_{l ∈ L} l.h + Σ_{r ∈ R} r.h`. Para *qualquer* matching perfeito `M`, a viabilidade dá `w(M) ≤ Σ_{(l,r) ∈ M} (l.h + r.h)`, o que telescopa para a mesma soma. Logo

```
w(M) ≤ Σ_{l ∈ L} l.h + Σ_{r ∈ R} r.h = w(M*)      (25.3)
```

então `M*` é um matching perfeito de peso máximo. ∎

Duas consequências conduzem o algoritmo inteiro. Primeiro, **qual** equality subgraph não importa — você tem liberdade total para escolher um e para *mudar* qual está usando conforme avança; você só precisa encontrar algum matching perfeito em algum equality subgraph. Segundo, rodar a segunda metade da prova com `M` sendo qualquer matching (não necessariamente perfeito) mantém a desigualdade (25.3) válida: **o peso de qualquer matching é sempre no máximo a soma dos rótulos dos vértices.** Se os rótulos são os "certos", esse limite é justo, e um matching de cardinalidade máxima no equality subgraph é um matching perfeito de peso máximo. O algoritmo húngaro modifica repetidamente tanto o matching quanto os rótulos para chegar a esse estado.

### O algoritmo húngaro: quatro perguntas

O algoritmo começa com qualquer rotulagem viável `h` e qualquer matching `M` em `G_h`, depois repetidamente encontra um caminho M-aumentante `P` em `G_h` e define `M = M ⊕ P` (Lema 25.1, inalterado da Seção 25.1) até que `M` seja perfeito. Quatro perguntas surgem, e as respostas são o algoritmo:

1. **Qual rotulagem inicial?** A rotulagem padrão das equações (25.1) e (25.2).
2. **Qual matching inicial?** Qualquer matching em `G_h`, até o vazio — mas um matching maximal guloso funciona bem:

   ```
   GREEDY-BIPARTITE-MATCHING(G)
   1  M = ∅
   2  para cada vértice l ∈ L
   3      se l tem um vizinho não matched em R
   4          escolha qualquer vizinho não matched assim r ∈ R
   5          M = M ∪ {(l, r)}
   6  retorne M
   ```

   O Exercício 25.3-2 pede para você mostrar que isso retorna um matching com pelo menos metade do tamanho de um matching máximo.
3. **Como encontrar um caminho M-aumentante em `G_h`?** Exatamente como na segunda fase de Hopcroft-Karp: construa o **equality subgraph direcionado** `G_{M,h} = (V, E_{M,h})` com `E_{M,h} = { (l,r) : (l,r) ∈ E_h - M }` de `L` para `R`, mais `{ (r,l) : (l,r) ∈ M }` de `R` para `L`, depois rode busca em largura a partir de todos os vértices não matched em `L` de uma vez — parando no instante em que descobrir um vértice não matched em `R`. Qualquer busca exaustiva de grafo funcionaria; BFS é a que o CLRS usa. Diferente do dag `H` de Hopcroft-Karp, cada vértice aqui só precisa de *um* predecessor, então a busca constrói uma **floresta** de busca em largura `F = (V_F, E_F)` cujas raízes são os vértices não matched em `L`.
4. **E se a busca falhar?** Atualize a rotulagem para trazer pelo menos uma nova aresta ao equality subgraph — o assunto da próxima subseção.

Note onde a falha pode acontecer: sempre que a fila esvazia sem encontrar um caminho aumentante, **os vértices descobertos mais recentemente precisam pertencer a `L`**. Por quê? Descobrir um vértice não matched em `R` termina a busca com sucesso, e descobrir um vértice matched em `R` sempre deixa um vizinho não visitado em `L` para descobrir a seguir.

### Reetiquetando quando a busca falha

Você é livre para trabalhar com qualquer equality subgraph, então mude-o "em tempo real" — mas sem desfazer o trabalho já feito. A reetiquetagem do algoritmo húngaro atende a três critérios:

1. Nenhuma aresta na floresta de busca em largura `F` sai do equality subgraph direcionado.
2. Nenhuma aresta no matching `M` sai do equality subgraph direcionado.
3. Pelo menos uma aresta `(l, r)` com `l ∈ L ∩ V_F` e `r ∈ R - V_F` **entra** em `E_h`, logo em `E_{M,h}` — então pelo menos um vértice em `R` se torna recém-descobrível.

Escreva `F_L = L ∩ V_F` e `F_R = R ∩ V_F`. Calcule

```
δ = min { l.h + r.h - w(l, r) : l ∈ F_L e r ∈ R - F_R }        (25.4)
```

— a menor quantidade pela qual uma aresta saindo de `F_L` *deixou de estar* no equality subgraph atual — depois reetiquete:

```
         ⎧ v.h - δ   se v ∈ F_L
v.h' =   ⎨ v.h + δ   se v ∈ F_R                                   (25.5)
         ⎩ v.h       caso contrário (v ∈ V - V_F)
```

O **Lema 25.15** prova que `h'` continua viável e satisfaz os três critérios.

- *Viabilidade.* Os únicos pares cuja soma de rótulos diminui são `l ∈ F_L`, `r ∈ R - F_R`, e eles caem por exatamente `δ`; por (25.4), `l.h - δ + r.h ≥ w(l, r)` para todo par assim. Todos os outros pares mantêm `l.h' + r.h' ≥ l.h + r.h ≥ w(l, r)`.
- *Critério 1.* Para `l ∈ F_L` e `r ∈ F_R`, `δ` é subtraído de um rótulo e somado ao outro, então `l.h' + r.h' = l.h + r.h` — arestas de floresta continuam justas.
- *Critério 2.* Para toda aresta matched `(l, r) ∈ M`, `l ∈ F_L` **se e somente se** `r ∈ F_R` no momento da reetiquetagem. (Se `r ∈ F_R`, desenfileirar `r` descobre `l`. Se `r ∉ F_R`, então a única aresta de `G_{M,h}` entrando em `l` é `(r, l)`, não tomada — e `l` também não pode ser raiz, já que só vértices *não matched* em `L` são raízes.) Tanto ambos-dentro quanto ambos-fora deixam `l.h' + r.h'` inalterado, então arestas matched continuam justas.
- *Critério 3.* Pegue uma aresta `(l, r) ∉ E_h` alcançando o mínimo em (25.4). Então `l.h' + r.h' = l.h - δ + r.h = l.h - (l.h + r.h - w(l,r)) + r.h = w(l, r)`, então `(l, r) ∈ E_{h'}`; estando fora de `E_h` ela não está em `M`, então em `E_{M,h'}` ela é direcionada `L → R`.

Algumas arestas podem *sair* de `E_{M,h}` sob `h'` — mas pelo Lema 25.15 qualquer aresta assim não pertencia nem a `M` nem a `F` no momento (o Exercício 25.3-3 as identifica como `l ∈ L - F_L`, `r ∈ F_R`), então nada já feito é perdido. Vértices de `R` recém-descobertos são enfileirados, embora suas distâncias não sejam necessariamente uma a mais que as dos vértices de `L` descobertos mais recentemente — o que é precisamente o motivo de essa busca manter uma floresta com predecessores únicos e descartar o atributo `d` em vez de reutilizar o dag em camadas de Hopcroft-Karp.

```
HUNGARIAN(G)
 1  para cada vértice l ∈ L
 2      l.h = max { w(l, r) : r ∈ R }   // da equação (25.1)
 3  para cada vértice r ∈ R
 4      r.h = 0                          // da equação (25.2)
 5  seja M qualquer matching em G_h (como o matching retornado por
        GREEDY-BIPARTITE-MATCHING)
 6  a partir de G, M e h, forme o equality subgraph G_h
        e o equality subgraph direcionado G_{M,h}
 7  enquanto M não for um matching perfeito em G_h
 8      P = FIND-AUGMENTING-PATH(G_{M,h})
 9      M = M ⊕ P
10      atualize o equality subgraph G_h
            e o equality subgraph direcionado G_{M,h}
11  retorne M
```

```
FIND-AUGMENTING-PATH(G_{M,h})
 1  Q = ∅
 2  F_L = ∅
 3  F_R = ∅
 4  para cada vértice não matched l ∈ L
 5      l.π = NIL
 6      ENQUEUE(Q, l)
 7      F_L = F_L ∪ {l}      // a floresta F começa com os vértices não matched em L
 8  repita
 9      se Q está vazia        // esgotaram-se os vértices para buscar a partir deles?
10          δ = min { l.h + r.h - w(l, r) : l ∈ F_L e r ∈ R - F_R }
11          para cada vértice l ∈ F_L
12              l.h = l.h - δ         // reetiqueta conforme a equação (25.5)
13          para cada vértice r ∈ F_R
14              r.h = r.h + δ         // reetiqueta conforme a equação (25.5)
15          a partir de G, M e h, forme um novo grafo de equality direcionado G_{M,h}
16          para cada nova aresta (l, r) em G_{M,h}   // continua a busca com as novas arestas
17              se r ∉ F_R
18                  r.π = l                       // descobre r, adiciona a F
19                  se r não está matched
20                      um caminho M-aumentante foi encontrado (sai do laço repita)
21                  senão ENQUEUE(Q, r)            // pode buscar a partir de r depois
22                       F_R = F_R ∪ {r}
23      u = DEQUEUE(Q)                            // busca a partir de u
24      para cada vizinho v de u em G_{M,h}
25          se v ∈ L
26              v.π = u
27              F_L = F_L ∪ {v}                   // descobre v, adiciona a F
28              ENQUEUE(Q, v)                     // pode buscar a partir de v depois
29          senão-se v ∉ F_R                        // v ∈ R, faz o mesmo das linhas 18-22
30              v.π = u
31              se v não está matched
32                  um caminho M-aumentante foi encontrado (sai do laço repita)
33              senão ENQUEUE(Q, v)
34                   F_R = F_R ∪ {v}
35  até que um caminho M-aumentante tenha sido encontrado
36  usando os atributos de predecessor π, construa um caminho M-aumentante P
        traçando de volta a partir do vértice não matched em R
37  retorne P
```

O Critério 3 do Lema 25.15 é o que garante que a fila `Q` esteja não vazia na linha 23 — toda reetiquetagem traz pelo menos uma nova aresta e portanto descobre pelo menos um novo vértice em `R`, então o laço não pode girar em vazio.

### Traço resolvido do algoritmo húngaro

Os pesos, com `L = {l1, …, l7}`, `R = {r1, …, r7}`, e a rotulagem de vértices padrão `l.h = max_r w(l, r)`, `r.h = 0`. As entradas em **negrito** são as justas (`l.h + r.h = w`) — as arestas do equality subgraph inicial `G_h`:

| `l.h` | | `r1` | `r2` | `r3` | `r4` | `r5` | `r6` | `r7` |
|---|---|---|---|---|---|---|---|---|
| | `r.h` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 10 | `l1` | 4 | **10** | **10** | **10** | 2 | 9 | 3 |
| 12 | `l2` | 6 | 8 | 5 | **12** | 9 | 7 | 2 |
| 15 | `l3` | 11 | 9 | 6 | 7 | 9 | 5 | **15** |
| 9 | `l4` | 3 | **9** | 6 | 7 | 5 | 6 | 3 |
| 6 | `l5` | 2 | **6** | 5 | 3 | 2 | 4 | 2 |
| 11 | `l6` | 10 | 8 | **11** | 4 | **11** | 2 | **11** |
| 8 | `l7` | 3 | 4 | 5 | 4 | 3 | 6 | **8** |

`GREEDY-BIPARTITE-MATCHING` nesse `G_h` dá `M = {(l1,r2), (l2,r4), (l3,r7), (l6,r3)}` — tamanho 4, maximal mas longe de perfeito. Não matched: `l4, l5, l7` em `L`; `r1, r5, r6` em `R`. A execução então prossegue:

| Passo | Raízes do BFS (não matched em `L`) | O que a busca faz | Resultado |
|---|---|---|---|
| 1 | `l4, l5, l7` | Descobre `r2, r7`; depois `l1, l3` via arestas matched; depois `r3, r4`; depois `l6, l2`; depois o **não matched** `r5` | Caminho aumentante `⟨(l4,r2),(r2,l1),(l1,r3),(r3,l6),(l6,r5)⟩`. `M ⊕ P` dá `{(l4,r2),(l1,r3),(l6,r5),(l2,r4),(l3,r7)}`, tamanho 5 |
| 2 | `l5, l7` | Descobre `r2, r7`, depois `l4, l3` — ambos sem arestas de equality saindo. **A fila esvazia** | `F_L = {l5,l7,l4,l3}`, `F_R = {r2,r7}`. `δ = 1`, alcançado por `(l5,r3)`: `l5.h + r3.h - w(l5,r3) = 6 + 0 - 5 = 1` |
| 3 | (reetiqueta) | Subtrai 1 de `l3, l4, l5, l7`; soma 1 a `r2, r7` | `(l1,r2)` e `(l6,r7)` **saem** de `G_{M,h}`; `(l5,r3)` **entra**. Rótulos agora `l = 10,12,14,8,5,11,7`, `r = 0,1,0,0,0,0,1` |
| 4 | (busca retoma) | `(l5,r3)` entra em `F`, `r3` enfileirado; a busca continua por `l1`, depois `r4`, depois `l2`, que não tem aresta de saída. **A fila esvazia de novo** | `δ = 1` de novo, dessa vez alcançado por **três** arestas: `(l1,r6)`, `(l5,r6)`, `(l7,r6)` |
| 5 | (reetiqueta) | Subtrai 1 de `l1, l2, l3, l4, l5, l7`; soma 1 a `r2, r3, r4, r7` | `(l6,r3)` sai; `(l1,r6)`, `(l5,r6)`, `(l7,r6)` entram. Rótulos agora `l = 9,11,13,7,4,11,6`, `r = 0,2,1,1,0,0,2` |
| 6 | (busca retoma) | `(l1,r6)` entra em `F`; `r6` está **não matched**, então a busca termina | Caminho aumentante `⟨(l5,r3),(r3,l1),(l1,r6)⟩`. `M` se torna `{(l4,r2),(l5,r3),(l1,r6),(l2,r4),(l6,r5),(l3,r7)}`, tamanho 6 |
| 7 | `l7` | A busca roda até a fila esvaziar depois de remover `l4` | `δ = 2`, alcançado por cinco arestas: `(l2,r5)`, `(l3,r1)`, `(l4,r5)`, `(l5,r1)`, `(l5,r5)` |
| 8 | (reetiqueta) | Subtrai 2 de `l1, l2, l3, l4, l5, l7`; soma 2 a `r2, r3, r4, r6, r7`. As cinco arestas acima entram em `G_{M,h}` | Rótulos finais `l = 7,9,11,5,2,11,4`, `r = 0,4,3,3,0,2,4` |
| 9 | (busca retoma) | `(l3,r1)` entra em `F`; `r1` está **não matched**, terminando a busca | Caminho aumentante `⟨(l7,r7),(r7,l3),(l3,r1)⟩`. `M` se torna perfeito — pronto |

O matching perfeito final é `(l1,r6), (l2,r4), (l3,r1), (l4,r2), (l5,r3), (l6,r5), (l7,r7)`, de peso `9 + 12 + 11 + 9 + 5 + 11 + 8 = 65`, e pelo Teorema 25.14 ele é ótimo. Note a verificação que cai dos rótulos: os rótulos finais somam `(7+9+11+5+2+11+4) + (0+4+3+3+0+2+4) = 49 + 16 = 65` — exatamente o peso do matching, como a desigualdade (25.3) exige na otimalidade.

Essa igualdade não é coincidência. Maximizar o peso de um matching e minimizar a soma dos rótulos de vértice viáveis são **duais** um do outro, na mesma linha do valor de um fluxo máximo igualar a capacidade de um corte mínimo. (O CLRS explora duality propriamente na Seção 29.3; o algoritmo húngaro é um exemplo antecipado de algoritmo primal-dual.) Uma pequena nota lateral do último passo: se `r1` estivesse *matched*, a busca teria continuado a adicionar `r5` à floresta, com qualquer um de `l2`, `l4` ou `l5` como seu pai.

### Tempo de execução: `O(n⁴)`, e como chegar a `O(n³)`

Com `|V| = 2n` e `|E| = n²` no grafo completo original `G`:

- As linhas 1-6 e 11 de `HUNGARIAN` levam `O(n²)`.
- O laço `enquanto` das linhas 7-10 itera no máximo `n` vezes, já que cada iteração cresce `M` em exatamente 1. A linha 7 é `O(1)` testando `|M| < n`, a linha 9 é `O(n)`, a linha 10 é `O(n²)`.
- Cada chamada de `FIND-AUGMENTING-PATH` é `O(n³)`. Ignorando os *passos de crescimento* (cada execução das linhas 10-22), o procedimento é uma busca em largura custando `O(V + E) = O(n²)` com `F_L` e `F_R` representados adequadamente. No máximo `n` passos de crescimento podem ocorrer por chamada, já que cada um tem garantia de descobrir pelo menos um vértice em `R`, e com no máximo `n²` arestas em `G_{M,h}`, o laço `para` das linhas 16-22 itera no máximo `n²` vezes por chamada. O gargalo são as linhas 10 e 15, cada uma `O(n²)`.

Total: `O(n⁴)`. Os dois caminhos para `O(n³)`:

- **A linha 15 é desnecessária.** O Exercício 25.3-5 pede para você mostrar que `G_{M,h}` nunca precisa ser explicitamente construído — a pertença de uma aresta a `E_{M,h}` pode ser determinada diretamente — eliminando a linha 6 de `HUNGARIAN` e a linha 15 aqui.
- **A linha 10 cai para `O(n)`.** O Problema 25-2 introduz, para cada `r ∈ R - F_R`, um atributo `r.σ = min { l.h + r.h - w(l, r) : l ∈ F_L }` — o quão perto `r` está de ser adjacente a algum vértice em `F_L` — inicializado em `∞` para todo `r ∈ R` antes de qualquer vértice entrar em `F_L`. Com `σ` mantido, `δ` é computável em `O(n)`, os valores de `σ` se atualizam em `O(n)` uma vez que `δ` é conhecido, e atualizá-los todos conforme `F_L` cresce custa `O(n²)` por chamada.

Com ambas as mudanças, cada chamada de `FIND-AUGMENTING-PATH` é `O(n²)` e o algoritmo húngaro roda em `O(n³)`.

## Trade-offs

- **Reduzir a max-flow funciona mas é mais lento que resolver matching nativamente.** A redução a max-flow da Seção 24.3 (o conceito "Max-Flow Min-Cut" desta coleção) é a resposta pedagogicamente natural inicial; a Seção 25.1 existe para dar "um método mais eficiente". Trabalhar diretamente com caminhos M-aumentantes no grafo não direcionado dispensa a construção de uma rede de fluxo, e o `O(√V · E)` de Hopcroft-Karp supera o que a redução compra. As duas compartilham a *ideia* de caminhos aumentantes, e o Exercício 25.1-2 pergunta explicitamente como caminhos M-aumentantes e caminhos aumentantes de rede de fluxo se parecem e como diferem — mas a maquinaria (capacidades residuais, source/sink, cancelamento) não se transfere.
- **Maximal é barato, máximo é o objetivo, e a lacuna é real.** `GREEDY-BIPARTITE-MATCHING` dá um matching maximal numa passada, mas só tem garantia de ser pelo menos metade do tamanho de um matching máximo (Exercício 25.3-2). Todo algoritmo aqui, portanto, paga por caminhos aumentantes em cima de um início guloso — você não consegue crescer gulosamente até o máximo.
- **Hopcroft-Karp pede um conjunto *maximal* de caminhos aumentantes mais curtos, deliberadamente não um máximo.** O próprio exemplo do CLRS encontra 2 caminhos disjuntos mais curtos onde 3 existem, e o limite `O(√V · E)` ainda vale. Exigir conjuntos máximos seria trabalho estritamente mais difícil sem ganho assintótico algum — um bom exemplo de especificar a propriedade mais fraca que a prova de fato exige.
- **`O(√V · E)` não é a última palavra para grafos esparsos.** O CLRS observa o algoritmo `Õ(E^(10/7))` de Madry, que é assintoticamente mais rápido que Hopcroft-Karp quando o grafo é esparso. Hopcroft-Karp é o padrão prático e provado aqui, não um limite inferior.
- **A bipartição é o que mantém a busca por caminhos aumentantes simples.** O Corolário 25.4 (Berge) vale em grafos *não* bipartidos também, mas encontrar os caminhos aumentantes é muito mais envolvido lá; o CLRS aponta para o algoritmo `O(V⁴)` de Edmonds como o primeiro algoritmo de matching em tempo polinomial para grafo geral. Recorra a esses procedimentos só depois de confirmar que seu grafo é de fato bipartido.
- **O algoritmo húngaro compra otimalidade abrindo mão de um grafo fixo.** Seu truque central é que o equality subgraph *não* é uma entrada — ele é reescolhido sempre que a busca empaca. Essa liberdade é o que torna usável o "qualquer matching perfeito em qualquer equality subgraph é ótimo" do Teorema 25.14, mas também significa que o algoritmo intercala uma busca em grafo com aritmética de rótulos, e a corretude se apoia nos três critérios do Lema 25.15 (arestas de floresta e arestas matched precisam sobreviver à reetiquetagem). Uma reetiquetagem ingênua que quebre qualquer critério perde o trabalho já feito.
- **`O(n⁴)` na implementação direta é, em grande parte, contabilidade evitável.** Os dois gargalos `O(n²)` por passo de crescimento — reconstruir `G_{M,h}` e recalcular `δ` do zero — são exatamente o que o Exercício 25.3-5 e o Problema 25-2 removem, para `O(n³)`. Se você implementar o pseudocódigo literalmente, você obtém o limite mais lento; o mais rápido é o mesmo algoritmo com atributos `σ` e sem `G_{M,h}` explícito.
- **O problema declarado é mais estreito que a maioria das instâncias reais, mas adaptável.** `HUNGARIAN` assume um grafo bipartido *completo* com `|L| = |R|` e maximização. O Exercício 25.3-6 (minimizar em vez disso), o Exercício 25.3-7 (`|L| ≠ |R|`), e o Problema 25-3 (grafos incompletos; pesos zero ou negativos; cycle cover) lidam com as lacunas transformando a entrada e a saída em vez de mudar o algoritmo — então trate essas transformações, não uma reescrita, como o caminho de extensão.
- **Mesmo grafo, definição diferente de "bom".** O assignment problem e o problema do casamento estável (o conceito "O Problema do Casamento Estável e o Algoritmo de Gale-Shapley" desta coleção) rodam ambos num grafo bipartido completo com informação extra por par, mas um matching de peso máximo e um matching estável otimizam objetivos não relacionados — valor total versus ausência de par bloqueador. A garantia de nenhum dos algoritmos diz nada sobre o critério do outro; escolha o objetivo antes de escolher o algoritmo.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 25.1 "Maximum bipartite matching (revisited)" and Section 25.3 "The Hungarian algorithm for the assignment problem", pp. 705-716, 723-739](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
