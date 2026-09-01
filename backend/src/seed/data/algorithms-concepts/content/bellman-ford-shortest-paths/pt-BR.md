---
version: 1.0
updatedAt: 2026-08-13
title: "Bellman-Ford: Caminhos Mínimos com Arestas Negativas e Detecção de Ciclos"
description: "Bellman-Ford resolve o problema de caminho mínimo de origem única no caso totalmente geral — qualquer grafo, qualquer mistura de pesos de aresta positivos e negativos — relaxando todas as arestas V-1 vezes em vez de depender da ordenação por fila de prioridade do Dijkstra, e ganha detecção de ciclo negativo de graça com uma passada extra de relaxamento."
---
## Objetivo

Entenda Bellman-Ford como a resposta de caso geral para a restrição que o concept irmão de Dijkstra estabelece: a estratégia gulosa de Dijkstra, de finalizar sempre o vértice mais próximo, só é correta quando todo peso de aresta é não negativo. Bellman-Ford abandona essa exigência por completo — funciona em qualquer grafo, com qualquer mistura de pesos positivos e negativos, desde que nenhum ciclo alcançável a partir da origem tenha peso total negativo. Ele compra essa generalidade abrindo mão da ordenação inteligente do Dijkstra: em vez de uma fila de prioridade escolhendo o próximo vértice a finalizar, Bellman-Ford simplesmente relaxa *todas* as arestas do grafo, `V - 1` vezes, e prova que força bruta é suficiente.

## Casos de Uso

- Qualquer grafo ponderado em que pesos negativos são possíveis e você não pode descartá-los de antemão — a suposição de não-negatividade do Dijkstra não é um pequeno inconveniente aqui, é desqualificante.
- Protocolos de roteamento por vetor de distância (ex: RIP), que propagam atualizações de custo salto a salto sem nenhuma garantia de ordenação global — a estrutura "relaxe tudo, repita" do algoritmo é exatamente o que um protocolo distribuído sem visão topológica da rede consegue implementar.
- Detecção de arbitragem em mercados de câmbio: substituindo cada taxa de conversão `x` pelo peso de aresta `-ln(x)`, a pergunta "existe uma sequência de trocas que devolve mais moeda do que você começou" vira "existe um ciclo negativo alcançável a partir da origem" — uma aplicação direta da detecção de ciclo negativo de Bellman-Ford, não apenas da sua saída de caminho mínimo.
- Grafos de restrição com ciclos (então o algoritmo de caminho mínimo em DAG de tempo linear não se aplica) onde os pesos de aresta representam folga ou defasagem que pode legitimamente ser negativa, como em certos sistemas de escalonamento e restrições de diferença.

## Aprofundamento

### O problema geral, e por que um ciclo negativo quebra o "caminho mínimo"

Os três algoritmos de caminho mínimo deste módulo formam uma escada de restrição decrescente: o algoritmo de DAG precisa de uma ordem topológica (nenhum ciclo, mas os pesos podem ser quaisquer); Dijkstra precisa de pesos não negativos (ciclos são permitidos); Bellman-Ford não precisa de nenhum dos dois — qualquer grafo, qualquer peso — com exatamente uma ressalva: nenhum **ciclo negativo** alcançável a partir da origem.

Um ciclo negativo é um ciclo cuja soma dos pesos das arestas é menor que zero. Veja um exemplo mínimo:

```
X -> Y (1)
Y -> X (-3)
```

O ciclo `X -> Y -> X` custa `1 + (-3) = -2`. Percorrê-lo uma vez, de `X` de volta a `X`, custa `-2`; percorrê-lo duas vezes custa `-4`; percorrê-lo `k` vezes custa `-2k`. Assim que um caminho consegue alcançar `X`, ele pode dar voltas nesse ciclo quantas vezes quiser antes de continuar — então o "caminho mínimo" para qualquer coisa alcançável através do ciclo não é apenas difícil de calcular, é indefinido, porque não existe mínimo: para qualquer distância mínima proposta, mais uma volta no ciclo supera ela.

Essa é uma falha diferente e mais profunda do que a demonstrada pelo contraexemplo do concept irmão de Dijkstra. Aquele contraexemplo (`S -> A (3)`, `S -> B (2)`, `A -> B (-2)`) tem uma única aresta negativa e nenhum ciclo — o caminho mínimo de `S` até `B` continua perfeitamente bem definido (é `1`, via `S -> A -> B`); a estratégia gulosa de Dijkstra simplesmente erra por finalizar `B` cedo demais. Um ciclo negativo é pior: não é que a estratégia de algum algoritmo específico precise de conserto, é que a própria grandeza "caminho mínimo" deixa de existir. A tarefa de Bellman-Ford é, portanto, dupla: calcular distâncias corretas quando nenhum ciclo negativo é alcançável a partir da origem, e reportar de forma confiável quando existe um.

### O algoritmo central: relaxe toda aresta, V - 1 vezes

Bellman-Ford reaproveita a mesma primitiva `relax()` que o concept irmão de Dijkstra introduz — "passar por `u` supera o melhor caminho até `v` encontrado até agora?" — mas descarta a fila de prioridade por completo, já que não há ordenação alguma a manter:

```java
void relax(int u, int v, double weight, double[] distTo, int[] edgeTo) {
    if (distTo[v] > distTo[u] + weight) {
        distTo[v] = distTo[u] + weight;
        edgeTo[v] = u;
    }
}
```

O algoritmo em si é apenas: inicialize, depois relaxe toda aresta do grafo, em qualquer ordem, `V - 1` vezes seguidas.

```java
double[] distTo = new double[V];
int[] edgeTo = new int[V];
Arrays.fill(distTo, Double.POSITIVE_INFINITY);
distTo[source] = 0.0;

for (int pass = 0; pass < V - 1; pass++) {
    for (Edge e : allEdges) {
        relax(e.from(), e.to(), e.weight(), distTo, edgeTo);
    }
}
```

O `BELLMAN-FORD(G, w, s)` de CLRS é o mesmo par de laços aninhados (`for i = 1 to |V| - 1`, `for each edge (u, v)`, `RELAX(u, v, w)`), seguido de mais uma passada usada para detecção de ciclo negativo, coberta adiante.

**Por que `V - 1` rodadas são garantidamente suficientes.** Em um grafo sem ciclo negativo, todo caminho mínimo é simples — nunca revisita um vértice, já que revisitar um significaria dar a volta por algum ciclo, e um ciclo não negativo só pode ser removido do caminho sem aumentar seu custo. Um caminho simples sobre `V` vértices tem no máximo `V - 1` arestas. A Proposição X de Sedgewick e Wayne prova o resto por indução no número da passada `i`: depois da `i`-ésima passada, `distTo[]` está correto para `v_i`, o vértice alcançado após `i` arestas ao longo de um determinado caminho mínimo `v_0 -> v_1 -> ... -> v_k` (`v_0` sendo a origem) — porque aquela passada obrigatoriamente relaxa a aresta `(v_{i-1}, v_i)` entre tudo o mais que relaxa, e `distTo[v_{i-1}]` já está correto pela hipótese indutiva. O Lema 22.2 de CLRS afirma o mesmo fato via sua "propriedade de relaxamento de caminho": como um caminho mínimo tem no máximo `V - 1` arestas, e cada uma das `V - 1` passadas relaxa todas as arestas, ao final das `V - 1` passadas toda aresta de todo caminho mínimo já foi relaxada na ordem correta da esquerda para a direita pelo menos uma vez — mesmo que o algoritmo nunca soubesse de antemão qual era essa ordem. Esse é todo o truque: Dijkstra e o algoritmo de DAG calculam cada um uma ordenação antecipadamente (por fila de prioridade ou ordenação topológica) e relaxam cada aresta exatamente uma vez, nessa ordem; Bellman-Ford nem se preocupa em calcular uma ordem, e em vez disso apenas relaxa tudo vezes suficientes para que a ordem correta esteja garantidamente embutida em algum lugar da repetição. Cada passada só pode melhorar ou manter inalterado qualquer valor de `distTo[]` — relaxamento nunca piora uma estimativa — então nada calculado em uma passada anterior é invalidado por uma posterior.

### Trace resolvido: reaproveitando e estendendo a armadilha de aresta negativa do irmão

Estenda o grafo do contraexemplo do concept irmão de Dijkstra — `S -> A (3)`, `S -> B (2)`, `A -> B (-2)` — com mais dois vértices continuando o mesmo caminho, criando um grafo genuíno de 5 vértices para traçar:

```
S -> A (3)      B -> C (4)
S -> B (2)      C -> D (-1)
A -> B (-2)
```

`V = 5`, então `V - 1 = 4` passadas são garantidamente suficientes. Distâncias mínimas reais a partir de `S`: `A = 3`, `B = min(2, 3 - 2) = 1` (a mesma armadilha do concept irmão — a aresta direta `S -> B` parece mais barata do que realmente é), `C = 1 + 4 = 5`, `D = 5 - 1 = 4`.

**Por que isso é uma tabela, e não um viz `type: graph`.** Uma tentativa genuína de usar os comandos `visit`/`traverse`/`mark` do motor de grafo foi feita primeiro, mas a estrutura definidora de Bellman-Ford — relaxar *toda* aresta em *toda* passada, independente de a passada anterior tê-la tocado ou não — não se encaixa de forma limpa nesses três comandos. Diferente de Dijkstra ou BFS, onde todo passo `traverse` corresponde a uma aresta de árvore real e permanente descoberta exatamente uma vez, a maioria das tentativas de relaxamento de Bellman-Ford num trace pequeno são no-ops que não mudam nenhuma distância (relaxar `C -> D` enquanto `distTo[C]` ainda é infinito, por exemplo). Representar toda tentativa de relaxamento como um passo `traverse` faria mau uso da semântica do motor (que documenta `traverseEdge` como marcação de uma aresta de árvore) em chamadas que não são arestas de árvore de forma alguma, e pular as tentativas no-op distorceria o comportamento real de "relaxar tudo, sempre" do algoritmo — exatamente o detalhe que este trace precisa mostrar. Uma tabela de distâncias após cada passada, no estilo da própria Figura de Sedgewick e da Figura 22.4 de CLRS, expõe a verdade de forma direta.

Para tornar visível — e não acidental — a necessidade de múltiplas passadas, relaxe as arestas em uma ordem que corre *contra* a direção do caminho mínimo: `C -> D`, `B -> C`, `A -> B`, `S -> B`, `S -> A`.

| Passada | distTo(S) | distTo(A) | distTo(B) | distTo(C) | distTo(D) |
|------|-----------|-----------|-----------|-----------|-----------|
| 0 (init) | 0 | ∞ | ∞ | ∞ | ∞ |
| 1 | 0 | 3 | 2 | ∞ | ∞ |
| 2 | 0 | 3 | 1 | 6 | ∞ |
| 3 | 0 | 3 | 1 | 5 | 5 |
| 4 | 0 | 3 | 1 | 5 | 4 |

Observe como cada passada finaliza mais um vértice ao longo do caminho mínimo `S -> A -> B -> C -> D`, exatamente como a Proposição X e o Lema 22.2 preveem: a passada 1 acerta `A` (1 aresta de distância); a passada 2 corrige `B`, de seu prematuro `2` para o verdadeiro `1`, assim que o peso negativo de `A -> B` é relaxado (2 arestas de distância); a passada 3 acerta `C` (3 arestas de distância); a passada 4 acerta `D` (4 arestas de distância). Essa ordem de arestas adversarial — relaxando deliberadamente `C -> D` antes mesmo de a distância até `C` ser conhecida — está perto do pior caso em número de passadas necessárias; uma ordem mais amigável (por exemplo, `S -> A`, `S -> B`, `A -> B`, `B -> C`, `C -> D`) teria produzido todas as distâncias corretas em uma única passada aqui, mas Bellman-Ford não pode assumir que receberá uma ordem amigável, e é exatamente por isso que se compromete com `V - 1` passadas independentemente disso.

### Bônus: detectando um ciclo negativo com mais uma passada, e a otimização baseada em fila

Como um caminho mínimo legítimo nunca precisa de mais de `V - 1` arestas quando nenhum ciclo negativo é alcançável a partir da origem, executar mais uma — a `V`-ésima — rodada de relaxamento após as `V - 1` normais dá uma checagem de corretude de graça: se algum valor de `distTo[]` ainda melhora nessa rodada extra, a única explicação possível é um ciclo que continua compensando toda vez que é percorrido, ou seja, um ciclo negativo. O pseudocódigo `BELLMAN-FORD` de CLRS implementa exatamente isso: depois das `V - 1` passadas, ele percorre toda aresta `(u, v)` mais uma vez e retorna `FALSE` no momento em que encontra `v.d > u.d + w(u, v)` ainda verdadeiro; se completar esse laço final sem encontrar tal aresta, retorna `TRUE`, tendo também produzido distâncias de caminho mínimo corretas para tudo o que é alcançável a partir da origem.

A implementação de Sedgewick e Wayne, `BellmanFordSP`, chega à mesma garantia por um mecanismo diferente, adequado à variante baseada em fila deles (a seguir): em vez de uma passada extra limpa sobre todas as arestas, ela inspeciona periodicamente o array de predecessores `edgeTo[]` em busca de um ciclo — se o array de "última aresta no caminho mínimo até `v`" chega a conter um ciclo, esse ciclo obrigatoriamente é negativo, porque um vértice só pode ser revisitado em `edgeTo[]` se o caminho de volta até ele ficou estritamente mais curto a cada vez.

**A otimização baseada em fila (estilo SPFA).** A versão ingênua acima relaxa todas as `E` arestas em cada uma das `V - 1` passadas, mesmo quando a maioria desses relaxamentos é garantidamente um no-op (como a tabela do trace resolvido mostra diretamente — várias células simplesmente não mudam entre passadas). O `BellmanFordSP` baseado em fila de Sedgewick e Wayne observa que uma aresta `u -> v` só pode possivelmente melhorar `distTo[v]` se `distTo[u]` mudou na passada anterior, então ele mantém uma fila FIFO de "vértices cuja distância acabou de mudar" e só relaxa novamente as arestas que saem desses vértices, pulando todo o resto. Essa é a mesma ideia amplamente conhecida fora do livro de Sedgewick como SPFA (Shortest Path Faster Algorithm). É uma aceleração prática substancial — Sedgewick e Wayne reportam seu exemplo de 250 vértices convergindo em 14 passadas em vez do `V` completo, com menos comparações de distância do que Dijkstra precisou no mesmo grafo — mas o limite de pior caso permanece inalterado: um grafo adversarial ainda pode forçá-lo a passar por quase `V` rodadas completas, então continua sendo `O(VE)` no pior caso, mesmo sendo frequentemente muito mais rápido na prática.

## Trade-offs

- **Tempo de execução O(VE)** — `V - 1` passadas (ou, com a rodada bônus, `V`), cada uma relaxando todas as `E` arestas: Sedgewick e Wayne afirmam diretamente tempo proporcional a `EV`; CLRS deriva `O(V^2 + VE)` a partir de inicialização `Θ(V)` mais `Θ(V + E)` por passada, o que colapsa para o familiar `O(VE)` sempre que `E = Ω(V)`, o caso comum. Isso é marcadamente mais lento do que o `O(E log V)` de Dijkstra ou o `O(V + E)` do algoritmo de DAG — o preço pago por não exigir pesos não negativos nem aciclicidade.
- **O(V) de espaço extra** — um `distTo[]` e um `edgeTo[]` por vértice, a mesma pegada de Dijkstra e do algoritmo de DAG; nenhuma fila de prioridade é necessária.
- **Detecção de ciclo negativo é um recurso de primeira classe, embutido, não um adendo** — a passada bônus `V`-ésima (ou a checagem de ciclo em `edgeTo[]` de Sedgewick e Wayne) faz de Bellman-Ford o único dos três algoritmos de caminho mínimo deste módulo que pode ser executado com segurança sem primeiro saber se o grafo se qualifica. Dijkstra, em contraste, não checa nada — dado uma aresta negativa, ele silenciosamente produz um valor de `distTo[]` errado, como mostra o contraexemplo do concept irmão.
- **A variante baseada em fila (estilo SPFA) costuma ser muito mais rápida, mas seu pior caso é idêntico ao da versão ingênua** — `O(VE)` no pior caso de qualquer forma, então é uma otimização prática, não uma classe de complexidade diferente; não conte com ela para uma garantia de pior caso da forma como se pode contar com o limite do heap binário de Dijkstra.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.4 "Shortest Paths", the Bellman-Ford algorithm (Proposition X through negative-cycle detection), pp. 671-679 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 22.1 "The Bellman-Ford Algorithm", pp. 612-616 — book
- [Princeton Algorithms, 4th Ed. — Shortest Paths (companion site)](https://algs4.cs.princeton.edu/44sp/) — doc
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
