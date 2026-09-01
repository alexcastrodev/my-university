---
version: 1.0
updatedAt: 2026-08-13
title: "Algoritmo de Johnson: Caminhos Mínimos Entre Todos os Pares para Grafos Esparsos"
description: "Resolve caminhos mínimos entre todos os pares em tempo O(V² lg V + VE), reponderando cada aresta para ficar não negativa com uma única execução auxiliar de Bellman-Ford e depois rodando Dijkstra uma vez a partir de cada vértice — uma composição que supera o O(V³) de Floyd-Warshall em grafos esparsos."
---
## Objetivo

Aprenda o algoritmo de Johnson, o terceiro e último algoritmo de caminhos mínimos entre todos os pares deste módulo. Ele resolve exatamente o mesmo problema que o concept irmão de Floyd-Warshall resolve — caminhos mínimos entre *todo* par de vértices em um grafo direcionado e ponderado — mas chega lá por um caminho completamente diferente: em vez de uma nova recorrência de programação dinâmica, o algoritmo de Johnson compõe os próprios algoritmos dos concepts irmãos de Bellman-Ford e Dijkstra como sub-rotinas literais, com uma transformação numérica, chamada reponderação, costurada entre os dois. Reponderar substitui cada peso de aresta por um novo peso, comprovadamente não negativo, calculado uma única vez a partir de uma execução auxiliar de Bellman-Ford, escolhido de forma que os caminhos mínimos sob os novos pesos sejam exatamente os caminhos mínimos sob os pesos antigos — só o comprimento numérico muda, por uma constante que depende apenas dos dois extremos. Essa garantia é o que torna legal rodar Dijkstra, que o concept irmão de Dijkstra mostra que exige estritamente pesos não negativos, uma vez a partir de cada vértice, mesmo que o grafo original pudesse ter arestas negativas. Para grafos esparsos o resultado supera o O(V³) fixo de Floyd-Warshall; exatamente quando isso deixa de compensar é o outro fio condutor deste concept.

## Casos de Uso

- Pré-computação de caminhos mínimos entre todos os pares em redes genuinamente esparsas — mapas rodoviários restritos à adjacência real, topologias de service mesh, grafos esparsos de rotas aéreas — onde V é grande o suficiente para que a passada de matriz O(V³) do Floyd-Warshall seja um desperdício, já que o custo do algoritmo de Johnson escala com a quantidade real de arestas E, não com todo o espaço de pares V².
- Uma versão "todos os pares" do caso de uso de detecção de arbitragem que o concept irmão de Bellman-Ford introduz para uma única origem: converter cada taxa de câmbio de par de moedas para `-ln(taxa)` pode produzir arestas negativas, e o algoritmo de Johnson dá o caminho de conversão mais curto (mais lucrativo) entre *todo* par de moedas de uma vez, com a passada de Bellman-Ford fazendo dupla função como um detector gratuito de ciclo negativo (oportunidade de arbitragem) em todo o grafo do mercado, não só a partir de uma moeda inicial.
- Grafos ponderados esparsos onde os pesos das arestas podem legitimamente ser negativos (arestas de desconto, arestas de reembolso, valores de folga) mas o grafo é conhecidamente livre de ciclo negativo, e uma aplicação precisa de uma tabela de distâncias completa em vez de consultas repetidas de origem única — a mesma motivação de "pré-computar uma vez, consultar em O(1) para sempre" que os Casos de Uso do concept irmão de Floyd-Warshall dão, só que para o regime esparso onde o O(V³) fixo daquele algoritmo deixa de ser competitivo.
- Como o exemplo canônico de reponderação com potenciais de vértice: deslocar cada peso de aresta por `h(u) - h(v)` para forçar não negatividade preservando a estrutura dos caminhos mínimos é o mesmo truque que reaparece, sob o nome "potenciais," em algumas implementações de fluxo de custo mínimo — o algoritmo de Johnson é onde ele é aprendido pela primeira vez em sua forma mais limpa.

## Aprofundamento

### O problema, e quando o O(V² lg V + VE) de Johnson realmente vence

O problema é idêntico ao do concept irmão de Floyd-Warshall: dado um grafo direcionado e ponderado, encontrar `δ(u, v)` para todo par de vértices `u, v`, tolerando arestas negativas desde que não exista ciclo de peso negativo. Floyd-Warshall resolve isso com um triplo loop fixo de `Θ(V³)` que nunca olha para `E`. O algoritmo de Johnson toma uma abordagem totalmente diferente: reponderar cada aresta para ficar não negativa (abaixo), depois rodar Dijkstra uma vez a partir de cada vértice no grafo reponderado. Com uma fila de prioridade baseada em heap de Fibonacci, uma única execução de Dijkstra custa `O(E + V lg V)`; rodá-la `V` vezes custa `O(VE + V² lg V)`. Somar o custo `O(VE)` da única execução auxiliar de Bellman-Ford que a reponderação exige não muda a ordem — `VE` já está presente — então o algoritmo inteiro roda em:

```
O(V² lg V + VE)
```

Confrontando isso com o `O(V³)` de Floyd-Warshall mostra exatamente onde cada um vence, a mesma análise de crossover que o concept irmão de Floyd-Warshall faz para Bellman-Ford repetido:

- **Grafos esparsos** (`E` próximo de `V`, ex.: `E = O(V)`): `V² lg V + VE = V² lg V + V² = O(V² lg V)`. Como `lg V` é assintoticamente menor que `V`, `V² lg V` é `o(V³)` — estritamente menor que o limite de Floyd-Warshall para `V` grande. O algoritmo de Johnson vence de forma clara aqui, e a diferença aumenta conforme `V` cresce.
- **Grafos densos** (`E` próximo de `V²`, ou seja, `E = Θ(V²)`): `V² lg V + VE = V² lg V + V³ = O(V³)` — agora `V³` domina o termo `V² lg V`, então o limite do algoritmo de Johnson colapsa para a *mesma* ordem de Floyd-Warshall. A vantagem some, não se inverte; nesse ponto os três loops aninhados e limpos de Floyd-Warshall, com trabalho O(1) por iteração, tipicamente vencem em fatores constantes — exatamente o mesmo raciocínio que o concept irmão de Floyd-Warshall dá para explicar por que ele supera Bellman-Ford-V-vezes quando os grafos se aproximam de densos.

Esse limite de destaque assume um heap de Fibonacci, que o próprio concept de Dijkstra deste módulo não implementa — ele usa uma fila de prioridade indexada baseada em heap binário, com seu próprio limite de `O((V + E) lg V)` por execução. Trocar essa implementação muda o total para `O(VE lg V)` (o CLRS declara esse limite diretamente para o caso de heap binário), que ainda é assintoticamente mais rápido que Floyd-Warshall em grafos esparsos (`E = O(V)` dá `O(V² lg V)`, mesma conclusão de acima) mas *perde de forma clara*, não só empata, em grafos densos: `E = Θ(V²)` dá `O(V³ lg V)`, estritamente pior que o `O(V³)` de Floyd-Warshall pelo fator extra `lg V`. A versão prática, com heap binário, do algoritmo de Johnson é, portanto, uma ferramenta genuinamente restrita a grafos esparsos; só a versão teórica com heap de Fibonacci apenas empata com Floyd-Warshall quando o grafo é denso.

### Por que você não pode rodar Dijkstra diretamente, e a técnica de reponderação

O contraexemplo mínimo do próprio concept irmão de Dijkstra — `S -> A (3)`, `S -> B (2)`, `A -> B (-2)` — é exatamente a falha que o algoritmo de Johnson tem que eliminar antes que Dijkstra possa rodar. Dijkstra finaliza `B` em `2` antes mesmo de descobrir que o caminho `S -> A -> B` custa apenas `1`, porque uma aresta negativa permitiu que um relaxamento posterior batesse uma distância já finalizada. Rodar Dijkstra `V` vezes diretamente em um grafo que talvez contenha essa aresta simplesmente reproduziria essa resposta errada `V` vezes — arestas negativas precisam ser tratadas *antes* de Dijkstra rodar, não contornadas rodando-o com mais frequência.

A reponderação trata delas construindo um grafo auxiliar `G' = (V', E')`, adicionando um novo vértice `s` conectado a cada vértice original por uma aresta de peso zero, e então rodando Bellman-Ford uma vez a partir de `s`:

```java
// G' = G mais uma nova origem s com uma aresta de peso zero para cada vértice.
// Retorna h[v] = delta(s, v) para cada v, ou null se G tiver um ciclo de peso negativo.
double[] computeReweighting(int V, List<Edge> edges) {
    double[] h = new double[V + 1];           // h[V] representa a origem adicionada s
    Arrays.fill(h, Double.POSITIVE_INFINITY);
    h[V] = 0.0;                               // distTo[s] = 0

    List<Edge> augmented = new ArrayList<>(edges);
    for (int v = 0; v < V; v++) {
        augmented.add(new Edge(V, v, 0.0));   // s -> v, peso 0, para cada v
    }

    for (int pass = 0; pass < V; pass++) {    // |V'| - 1 = (V + 1) - 1 = V rodadas
        for (Edge e : augmented) {
            if (h[e.to()] > h[e.from()] + e.weight()) {
                h[e.to()] = h[e.from()] + e.weight();
            }
        }
    }
    for (Edge e : augmented) {                // rodada bônus -- do próprio concept irmão de Bellman-Ford
        if (h[e.to()] > h[e.from()] + e.weight()) {
            return null;                      // ciclo de peso negativo: algoritmo de Johnson reporta falha
        }
    }
    return h;                                  // h[v] = delta(s, v) para v em 0..V-1
}
```

Essa única execução de Bellman-Ford faz dupla função. Primeiro, ela calcula `h(v) = δ(s, v)`, a distância de caminho mínimo da origem adicionada até cada vértice — a quantidade que a reponderação precisa. Segundo, sua passada final bônus é exatamente o mecanismo de detecção de ciclo negativo do próprio concept irmão de Bellman-Ford: como nenhuma aresta entra em `s`, `G'` tem um ciclo negativo se e somente se `G` tiver, então essa única checagem cobre todo o grafo original. Se ela disparar, o algoritmo de Johnson para e reporta falha imediatamente — caminhos mínimos entre todos os pares não são definidos quando existe um ciclo negativo, a mesma razão pela qual a checagem de diagonal do concept irmão de Floyd-Warshall existe, exceto que o algoritmo de Johnson se recusa até a começar em vez de silenciosamente retornar uma matriz que parece uma resposta.

Com `h(v)` em mãos, cada aresta ganha um novo peso:

```java
double reweight(Edge e, double[] h) {
    return e.weight() + h[e.from()] - h[e.to()];   // w'(u, v) = w(u, v) + h(u) - h(v)
}
```

### Por que a reponderação está correta: pesos não negativos e caminhos mínimos preservados

Dois fatos precisam valer para que `w'(u, v) = w(u, v) + h(u) - h(v)` seja uma entrada legal para Dijkstra e ainda responda à pergunta original. Ambos decorrem de `h(v) = δ(s, v)` serem distâncias de caminho mínimo genuínas.

**Fato 1 — todo novo peso é não negativo.** A passada bônus de `computeReweighting` acima é exatamente uma checagem de que nenhuma aresta `(u, v)` ainda consegue relaxar `h`, ou seja, `h(v) <= h(u) + w(u, v)` vale para toda aresta uma vez que Bellman-Ford convergiu — esse é o mesmo invariante de relaxamento que as rotinas `relax()` dos concepts irmãos de Dijkstra e Bellman-Ford existem para impor, só examinado no final em vez de durante uma chamada. Rearranjando essa desigualdade:

```
h(v) <= h(u) + w(u, v)
0    <= w(u, v) + h(u) - h(v)
0    <= w'(u, v)
```

Então `w'(u, v) >= 0` para toda aresta, com igualdade exatamente nas arestas que estão em algum caminho mínimo a partir de `s` (as arestas que o relaxamento de Bellman-Ford deixou "justas").

**Fato 2 — caminhos mínimos são preservados; só seu comprimento numérico muda por uma constante.** Para qualquer caminho `p = <v0, v1, ..., vk>`, some os novos pesos ao longo dele:

```
w'(p) = sum_{i=1..k} w'(v_{i-1}, v_i)
      = sum_{i=1..k} ( w(v_{i-1}, v_i) + h(v_{i-1}) - h(v_i) )
      = sum_{i=1..k} w(v_{i-1}, v_i)  +  h(v0) - h(vk)      <- telescopa: cada h(v_i) interno cancela
      = w(p) + h(v0) - h(vk)
```

Cada `h(v_i)` intermediário para `1 <= i <= k-1` aparece uma vez com sinal `+` (como `h(v_{i-1})` do próximo termo) e uma vez com sinal `-` (como `h(v_i)` do termo atual), então a cadeia inteira colapsa para só os extremos. Isso significa que **todo** caminho de `v0` a `vk` — não só o mínimo — tem seu peso deslocado pela mesma constante `h(v0) - h(vk)`, que depende só dos dois extremos, nunca de qual caminho foi tomado. Somar a mesma constante a todo candidato não pode mudar qual deles é o menor, então o caminho que minimiza `w(p)` é exatamente o mesmo caminho que minimiza `w'(p)`; só o número associado a ele difere, por exatamente `h(v0) - h(vk)`.

**Exemplo verificado manualmente.** Considere um pequeno grafo esparso com uma aresta negativa e nenhum ciclo (trivialmente sem ciclo negativo):

```
A -> B (3)      B -> D (7)
A -> C (8)      D -> C (2)
A -> D (-4)     B -> C (1)
```

Rodando `computeReweighting` (Bellman-Ford a partir da origem adicionada `s`, com `s -> A`, `s -> B`, `s -> C`, `s -> D` todas de peso 0):

| v | h(v) = δ(s, v) | aresta de entrada justa |
|---|---|---|
| A | 0 | `s -> A` (0) |
| B | 0 | `s -> B` (0) |
| D | -4 | `A -> D`: `h(A) + (-4) = -4` |
| C | -2 | `D -> C`: `h(D) + 2 = -4 + 2 = -2` |

Toda outra aresta de entrada é checada e confirmada como não melhorável — ex.: `h(C) <= h(B) + 1 = 1` e `h(C) <= h(A) + 8 = 8`, ambas mais frouxas que o valor justo `-2` — então esses quatro valores são genuinamente as distâncias mínimas a partir de `s`, não apenas um palpite viável.

Reponderando cada aresta original com `w'(u, v) = w(u, v) + h(u) - h(v)`:

| Aresta | w(u,v) | h(u) | h(v) | w'(u,v) |
|---|---|---|---|---|
| A -> B | 3 | 0 | 0 | 3 |
| A -> C | 8 | 0 | -2 | 10 |
| A -> D | -4 | 0 | -4 | 0 |
| B -> C | 1 | 0 | -2 | 3 |
| B -> D | 7 | 0 | -4 | 11 |
| D -> C | 2 | -4 | -2 | 0 |

Todo `w'` é não negativo, como o Fato 1 garante, e os dois zeros caem exatamente nas arestas (`A -> D`, `D -> C`) que eram justas na tabela `h` acima — a árvore de caminho mínimo a partir de `s`.

Checando o Fato 2 em dois pares confirma que o mesmo caminho continua mínimo, só o número muda por `h(u) - h(v)`:

- **A até C:** o mínimo original é `A -> D -> C`, peso `-4 + 2 = -2` (vence a aresta direta de `8` e `A -> B -> C` de `3 + 1 = 4`). Reponderado, esse mesmo caminho custa `0 + 0 = 0`, e nenhuma outra rota vence (`A -> C` direto é `10`, `A -> B -> C` é `3 + 3 = 6`). Deslocamento: `h(A) - h(C) = 0 - (-2) = 2`, e de fato `-2 + 2 = 0`. ✓
- **B até C:** o mínimo original é a aresta direta `B -> C`, peso `1` (vence `B -> D -> C`'s `7 + 2 = 9`). Reponderada, a aresta direta custa `3`, e `B -> D -> C` custa `11 + 0 = 11` — a direta ainda vence. Deslocamento: `h(B) - h(C) = 0 - (-2) = 2`, e `1 + 2 = 3`. ✓

### Rodando Dijkstra V vezes, recuperando as distâncias originais, e o tempo total de execução

Com todo peso não negativo, Dijkstra — sem modificação, a própria rotina do concept irmão de Dijkstra — pode rodar uma vez a partir de cada vértice. Aqui está essa execução a partir de `A` no grafo reponderado acima, traçada com o motor `viz`: este passo, diferente da aritmética de reponderação em si, é uma travessia real de nós/arestas, então se encaixa diretamente no modelo `visit`/`traverse` do motor em vez de precisar de uma tabela.

```viz
type: graph
node A A 0 1
node B B 1 0
node D D 1 2
node C C 2 1
edge A B directed
edge A C directed
edge A D directed
edge B C directed
edge B D directed
edge D C directed
---
visit A | Origem: distTo'(A) = 0.
traverse A B | Relaxa A→B: 0 + 3 = 3 -- distTo'(B) provisório = 3.
traverse A C | Relaxa A→C: 0 + 10 = 10 -- distTo'(C) provisório = 10.
traverse A D | Relaxa A→D: 0 + 0 = 0 -- distTo'(D) provisório = 0.
visit D | O mínimo da fila de prioridade é D em 0 (menor que 3 de B e 10 de C) -- extrai e finaliza: distTo'(D) = 0.
traverse D C | Relaxa D→C: 0 + 0 = 0 < 10 -- distTo'(C) melhora para 0, superando de vez a aresta direta A→C.
visit C | O mínimo da fila de prioridade agora é C em 0 -- extrai e finaliza: distTo'(C) = 0. C não tem arestas de saída, nada mais a relaxar.
visit B | O mínimo da fila de prioridade é B em 3, seu único valor -- extrai e finaliza: distTo'(B) = 3.
traverse B C | Relaxa B→C: 3 + 3 = 6 -- sem melhoria, C já finalizado em 0.
traverse B D | Relaxa B→D: 3 + 11 = 14 -- sem melhoria, D já finalizado em 0.
```

Recuperar as distâncias *originais* a partir dessa execução reverte o deslocamento do Fato 2: `δ(u, v) = δ'(u, v) - h(u) + h(v)`, onde `δ'` é o que Dijkstra acabou de calcular no grafo reponderado.

```java
// dist[u][v] = delta(u, v) para cada par, ou null se G tiver um ciclo de peso negativo.
double[][] johnson(int V, List<Edge> edges) {
    double[] h = computeReweighting(V, edges);
    if (h == null) return null;                       // ciclo de peso negativo

    List<Edge> reweighted = new ArrayList<>();
    for (Edge e : edges) {
        reweighted.add(new Edge(e.from(), e.to(), reweight(e, h)));
    }

    double[][] dist = new double[V][V];
    for (int u = 0; u < V; u++) {
        double[] distPrime = dijkstra(V, reweighted, u);   // rotina do concept irmão de Dijkstra, sem modificação
        for (int v = 0; v < V; v++) {
            dist[u][v] = distPrime[v] - h[u] + h[v];        // reverte o deslocamento
        }
    }
    return dist;
}
```

Para o traço acima, origem `A`: `δ(A, v) = δ'(A, v) + h(v)` (já que `h(A) = 0`). `δ(A, A) = 0 + 0 = 0`; `δ(A, B) = 3 + 0 = 3`; `δ(A, C) = 0 + (-2) = -2`; `δ(A, D) = 0 + (-4) = -4` — batendo exatamente com os pesos originais (`A -> D` direto é `-4`, `A -> D -> C` dá `-2`, `A -> B` direto é `3` e imbatível). Uma execução completa do algoritmo de Johnson repete esse traço de Dijkstra mais três vezes, a partir de `B`, `C` e `D`.

**Tempo total de execução.** O passo de reponderação (`computeReweighting`) é uma execução de Bellman-Ford sobre `V + 1` vértices e `E + V` arestas — ainda `O(VE)`, o mesmo limite que o concept irmão de Bellman-Ford dá. As `V` execuções de Dijkstra dominam: com um heap de Fibonacci, cada execução é `O(E + V lg V)` (um limite que o próprio concept de Dijkstra deste módulo não implementa, já que usa um heap binário), então `V` execuções custam `O(VE + V² lg V)`; combinado com o custo `O(VE)` do passo de reponderação, o total é `O(V² lg V + VE)`, o limite de destaque. Substituindo pela implementação real, com heap binário, do concept irmão de Dijkstra, cada execução custa `O((V + E) lg V)`, então `V` execuções custam `O(V² lg V + VE lg V)` — para qualquer grafo conexo (`E = Ω(V)`, a suposição padrão da qual o próprio limite do concept irmão de Bellman-Ford também depende), o termo `VE lg V` domina, dando `O(VE lg V)` no total, batendo com o limite prático e o crossover esparso-vs-denso discutido acima.

## Trade-offs

- **Uma vitória genuína em grafo esparso, não universal** — `O(V² lg V + VE)` (heap de Fibonacci) supera o `O(V³)` de Floyd-Warshall em grafos esparsos mas só empata em grafos densos; a versão prática com heap binário, `O(VE lg V)`, perde de forma clara em grafos densos (`O(V³ lg V)`, estritamente pior que `O(V³)`). Recorra ao algoritmo de Johnson especificamente porque um grafo é esparso, não por padrão.
- **Um passo de pré-processamento O(VE) que Floyd-Warshall nunca paga** — o passo de reponderação com Bellman-Ford roda incondicionalmente, mesmo no caso em que o grafo acaba sendo denso o suficiente para que o algoritmo de Johnson não vá vencer no final; esse custo é overhead puro no caso perdedor.
- **Tratamento de ciclo negativo mais honesto que o de Floyd-Warshall** — os Trade-offs do concept irmão de Floyd-Warshall sinalizam que ele "silenciosamente produz uma matriz que parece uma resposta" diante de um ciclo negativo, exigindo uma checagem de diagonal separada depois. O algoritmo de Johnson nem consegue passar do seu primeiro passo sem essa checagem (a passada bônus de Bellman-Ford): ele retorna uma matriz genuinamente correta ou se recusa a rodar de vez.
- **Reconstrução de caminho vem de graça, diferente da matriz Π anexada de Floyd-Warshall** — cada uma das `V` execuções de Dijkstra já constrói sua própria árvore de caminho mínimo `edgeTo[]` como efeito colateral (veja o concept irmão de Dijkstra), então recuperar uma rota real, não só seu peso, não custa nada extra. Floyd-Warshall precisa de uma segunda matriz de predecessores `Θ(V²)` inteira, mantida em conjunto, para ter a mesma informação.
- **Só pesos, e só depois que dois outros algoritmos já estão corretos** — o algoritmo de Johnson não é um bom lugar para depurar Bellman-Ford ou Dijkstra pela primeira vez; é uma composição dos dois, então um bug em qualquer uma das sub-rotinas aparece aqui como uma resposta errada de todos-os-pares, com uma camada extra de aritmética (o deslocamento de reponderação/reversão) para desvendar antes de encontrá-lo.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 23, Seção 23.3 "Johnson's algorithm for sparse graphs", pp. 662-667 — book
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
