---
version: 1.0
updatedAt: 2026-08-13
title: "Floyd-Warshall: Caminhos Mínimos Entre Todos os Pares como Programação Dinâmica"
description: "Aprenda o problema de caminhos mínimos entre todos os pares e o algoritmo de programação dinâmica de Floyd-Warshall que o resolve em tempo Θ(V³) restringindo os vértices intermediários de cada caminho mínimo a um conjunto crescente {1, ..., k}, em vez de repetir um algoritmo de origem única uma vez por vértice."
---
## Objetivo

Aprenda o problema de caminhos mínimos entre todos os pares — encontrar o caminho mínimo entre *todo* par de vértices em um grafo direcionado ponderado, simultaneamente, em vez de a partir de uma única origem fixa — e o algoritmo de Floyd-Warshall que o resolve em tempo Θ(V³). Floyd-Warshall é um algoritmo de programação dinâmica antes de ser um algoritmo de grafos: ele nunca percorre o grafo no sentido usual de visitar-um-nó / seguir-uma-aresta; ele preenche iterativamente uma matriz de distâncias V×V, exatamente a receita "caracterize uma solução ótima, defina-a recursivamente, calcule-a de baixo para cima" que o concept de Fundamentos de Programação Dinâmica apresenta. Este concept assume que você já tem esse vocabulário de PD (memoização vs. tabulação, subestrutura ótima, subproblemas sobrepostos) daquele concept e não o rederiva — a única ideia nova aqui é a recorrência específica de Floyd-Warshall, que restringe os *vértices intermediários* de um caminho mínimo a um prefixo crescente `{1, ..., k}` do conjunto de vértices, em vez de restringir a contagem de arestas ou qualquer coisa no formato de percurso de grafo.

## Casos de Uso

- Pré-computar uma tabela de distância/roteamento completa uma única vez (ex: para uma rede rodoviária, service mesh ou grafo de conexões de voo), de modo que qualquer consulta futura de "caminho mínimo de A até B" seja um lookup O(1) em tabela, em vez de uma busca nova.
- Grafos densos, onde a contagem de arestas E está próxima de V² — o custo fixo Θ(V³) de Floyd-Warshall, que não depende de E de forma alguma, supera executar um algoritmo de origem única uma vez por vértice.
- Detectar se um grafo tem algum ciclo de peso negativo, como subproduto de uma única passada Θ(V³), sem precisar saber de antemão qual vértice o ciclo toca.
- Calcular o *fecho transitivo* de um grafo direcionado (existe algum caminho de `i` até `j`, ignorando pesos) — CLRS apresenta isso como a mesma recorrência com OU/E lógicos no lugar de min/+, logo após Floyd-Warshall, na mesma seção do capítulo.

## Aprofundamento

### Entre-todos-os-pares vs. origem única repetida: por que isso não é só "Bellman-Ford num laço"

O algoritmo de Dijkstra, Bellman-Ford e o algoritmo de caminho mínimo em DAG resolvem todos o problema de caminhos mínimos de **origem única**: dado um vértice inicial `s`, encontrar o caminho mínimo de `s` até todo outro vértice. Uma forma perfeitamente válida de obter caminhos mínimos **entre todos os pares** a partir de qualquer um deles é simplesmente executá-lo V vezes, uma vez com cada vértice como origem. Como Floyd-Warshall tolera pesos de aresta negativos (desde que não haja ciclo negativo), o algoritmo de origem única justo para comparar é Bellman-Ford, não Dijkstra (que exige pesos não negativos). Bellman-Ford roda em tempo O(VE) por origem, então chamá-lo uma vez por vértice custa O(V · VE) = O(V²E) no total. Floyd-Warshall custa O(V³), um limite que não menciona E de forma alguma.

Colocando os dois limites um contra o outro fica claro onde cada um vence:

- **Grafos esparsos** (`E` próximo de `V`, ex: `E = O(V)`): `V²E = O(V³)` — a mesma ordem de Floyd-Warshall. Bellman-Ford repetido é competitivo aqui, e ambos podem ser razoáveis; Floyd-Warshall costuma ainda vencer nos fatores constantes, já que seu corpo é três laços aninhados limpos com trabalho O(1) por iteração, contra a contabilidade de relaxamento por origem de Bellman-Ford repetida V vezes.
- **Grafos densos** (`E` próximo de `V²`, ou seja, `E = Θ(V²)`): `V²E = O(V⁴)`, o que é assintoticamente *pior* do que o `O(V³)` de Floyd-Warshall. Esse é o regime em que a ignorância de `E` por parte de Floyd-Warshall deixa de ser um custo escondido e vira uma vantagem genuína — quanto mais denso o grafo, mais à frente ele fica.

CLRS na verdade apresenta Floyd-Warshall como a *segunda* solução de programação dinâmica para caminhos mínimos entre todos os pares, no Capítulo 23. A Seção 23.1 desenvolve uma primeira, usando um formato de subproblema diferente: `l_ij^(r)` é o caminho mínimo de `i` até `j` usando **no máximo `r` arestas**, calculado por uma "multiplicação de matrizes" repetida que custa Θ(V⁴) de forma ingênua (`SLOW-APSP`) ou Θ(V³ lg V) com quadratura repetida (`FASTER-APSP`). Floyd-Warshall (Seção 23.2) melhora ambas caracterizando o subproblema de outra forma — pelo *conjunto de vértices intermediários* restrito, em vez de pela contagem de arestas — o que traz o expoente para um 3 fixo, sem fator logarítmico.

### A recorrência de PD: caminhos mínimos restritos a um conjunto crescente de vértices intermediários

Numere os vértices `1, 2, ..., n`. Para um caminho simples `p = <v1, v2, ..., vl>`, um **vértice intermediário** é qualquer vértice de `p` além dos extremos `v1` e `vl` — precisamente `{v2, ..., v(l-1)}`. Os extremos nunca são contados como intermediários, mesmo que também apareçam em outro lugar na numeração dos vértices.

Defina `d[i][j]^(k)` como o peso de um caminho mínimo do vértice `i` até o vértice `j` onde todo vértice intermediário desse caminho vem do conjunto `{1, ..., k}`. O caso base, `k = 0`, não permite nenhum vértice intermediário, então os únicos caminhos disponíveis são a aresta direta (ou nenhuma aresta):

```
d[i][j]^(0) = w(i, j)   // o peso da aresta direta, 0 se i == j, ∞ se não existe aresta (i, j)
```

Para `k >= 1`, pegue um caminho mínimo `p` de `i` até `j` cujos intermediários vêm de `{1, ..., k}`, e pergunte se o próprio `k` é um desses intermediários:

- **`k` não é um vértice intermediário de `p`** — então todo intermediário de `p` já vem do conjunto menor `{1, ..., k-1}`, então esse caso não contribui com nada novo: `d[i][j]^(k-1)`.
- **`k` é um vértice intermediário de `p`** — decomponha `p` em um segmento `i -> k` e um segmento `k -> j`. Como subcaminhos de caminhos mínimos são eles mesmos caminhos mínimos (o mesmo argumento de subestrutura ótima usado por todo o Capítulo 22/23), e `k` não pode ser intermediário de nenhum dos segmentos sem fazer `p` revisitar `k`, ambos os segmentos têm seus próprios intermediários vindos do conjunto estritamente menor `{1, ..., k-1}`. Esse par de segmentos é exatamente `d[i][k]^(k-1) + d[k][j]^(k-1)`.

Tomando o melhor dos dois casos, temos a recorrência de Floyd-Warshall:

```
d[i][j]^(k) = min( d[i][j]^(k-1),  d[i][k]^(k-1) + d[k][j]^(k-1) )
```

Quando `k = n`, todo vértice é um intermediário legal, então `d[i][j]^(n)` é o verdadeiro peso de caminho mínimo `δ(i, j)` para todo par — o algoritmo calcula todos eles juntos, uma matriz completa por vez, para `k = 1, 2, ..., n`.

### O algoritmo, a atualização de matriz in-place, e um exemplo resolvido

Como `d^(k)` só depende de `d^(k-1)`, não há necessidade de manter `n` matrizes separadas por perto — um único array 2D pode ser atualizado in-place, derrubando o espaço ingênuo de Θ(n³) para Θ(n²). Isso funciona porque sobrescrever a linha `k` ou a coluna `k` durante a iteração `k` não corrompe nada: `d[i][k]` e `d[k][j]` não são afetados por usar `k` como seu próprio intermediário (`d[k][k] = 0` na ausência de ciclo negativo, então `d[i][k] + d[k][k] = d[i][k]`, sem mudança). CLRS faz disso a base do exercício 23.2-4, que remove os sobrescritos do pseudocódigo por completo e confirma que a versão simplificada, in-place, continua correta — essa é a versão que vale a pena de fato escrever:

```java
static final int INF = Integer.MAX_VALUE / 2; // evita overflow ao somar duas "infinitudes"

static int[][] floydWarshall(int[][] w, int n) {
    int[][] d = new int[n][n];
    for (int i = 0; i < n; i++) {
        d[i] = w[i].clone();
    }
    for (int k = 0; k < n; k++) {
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (d[i][k] + d[k][j] < d[i][j]) {
                    d[i][j] = d[i][k] + d[k][j];
                }
            }
        }
    }
    return d; // d[i][j] agora é o peso do caminho mínimo de i até j
}
```

Três laços aninhados, cada um rodando `n` vezes, trabalho O(1) no corpo mais interno — Θ(V³) no total, exatamente como o formato de laço triplo sugere, sem nenhuma estrutura de dados elaborada envolvida.

Trace num pequeno grafo direcionado de 4 vértices (vértices numerados 1-4, `∞` significando ausência de aresta direta):

```
1 -> 2 (peso 3)      3 -> 2 (peso 4)
1 -> 3 (peso 8)      4 -> 1 (peso 2)
2 -> 4 (peso 1)      4 -> 3 (peso 5)
```

`d^(0)`, a matriz de arestas diretas (linha = `i`, coluna = `j`):

| d⁽⁰⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | ∞ |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | ∞ |
| **4** | 2 | ∞ | 5 | 0 |

Depois de `k = 1` (caminhos agora podem rotear através do vértice 1 — ex: `4 -> 1 -> 2` supera a aresta direta ausente `4 -> 2`):

| d⁽¹⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | ∞ |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | ∞ |
| **4** | 2 | 5 | 5 | 0 |

Depois de `k = 2` (roteando através do vértice 2 — ex: `1 -> 2 -> 4` supera a aresta direta ausente `1 -> 4`):

| d⁽²⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | 4 |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | 5 |
| **4** | 2 | 5 | 5 | 0 |

Depois de `k = 3` (roteando através do vértice 3 não ajuda nenhum par aqui — `3` tem apenas uma aresta de saída, para `2`, e toda rota que passa por ele já é superada, então a matriz fica inalterada):

| d⁽³⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | 4 |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | 5 |
| **4** | 2 | 5 | 5 | 0 |

Depois de `k = 4` (matriz final — roteando através do vértice 4 finalmente conecta `2` e `3` de volta a `1`, ex: `2 -> 4 -> 1` e `3 -> 2 -> 4 -> 1`):

| d⁽⁴⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | 4 |
| **2** | 3 | 0 | 6 | 1 |
| **3** | 7 | 4 | 0 | 5 |
| **4** | 2 | 5 | 5 | 0 |

`d[3][1] = 7` corresponde ao caminho `3 -> 2 -> 4 -> 1` (`4 + 1 + 2 = 7`) — mais barato do que qualquer caminho que evite o vértice 4, já que `3` não tem outra forma de voltar até `1`. `d[2][3] = 6` corresponde a `2 -> 4 -> 3` (`1 + 5 = 6`), encontrado apenas quando o vértice 4 se torna um intermediário disponível em `k = 4`.

### Ciclos negativos e reconstrução do caminho real

Assim como Bellman-Ford, Floyd-Warshall trata corretamente *arestas* de peso negativo, mas quebra — produz um resultado sem sentido — se o grafo tem um **ciclo** de peso negativo: com um ciclo negativo alcançável entre algum par, não existe um caminho simples mínimo bem definido (você pode continuar dando voltas para levar o peso arbitrariamente para baixo), o que contradiz a suposição de caminho finito na qual toda a recorrência `d[i][j]^(k)` se apoia.

Detectar um ciclo negativo a partir da matriz finalizada é barato e não precisa de nenhuma passada extra: toda `d[i][i]` começa em `0` (o caminho vazio de `i` até ele mesmo), então se qualquer entrada diagonal `d[i][i]` sai **negativa** depois de o algoritmo rodar, significa que existe um caminho de `i` de volta a `i` com peso total negativo — um ciclo negativo passando por `i`.

Recuperar os caminhos mínimos reais, não apenas seus pesos, precisa de mais uma peça de contabilidade: uma matriz de predecessores `Π`, atualizada pelo mesmo laço triplo junto com `D`, onde `π[i][j]` registra o predecessor de `j` no melhor caminho `i -> j` atual; percorrer `π` de trás para frente, de `j` até `i`, depois que o algoritmo termina, imprime o próprio caminho (CLRS Seção 23.2, "Constructing a shortest path").

## Trade-offs

- **O(V³) fixo vs. O(V²E) dependente da densidade** — o custo de Floyd-Warshall nunca olha para `E`, o que é um passivo em grafos esparsos (você paga por todos os `V²` pares mesmo que a maioria seja inalcançável), mas se torna uma vantagem decisiva conforme o grafo se aproxima da densidade máxima (`E → V²`), onde o `O(V²E)` de Bellman-Ford-V-vezes degrada rumo a `O(V⁴)`.
- **Θ(V²) de espaço não importa quão esparso o grafo seja** — porque o algoritmo opera sobre uma matriz de distâncias densa em vez de uma lista de adjacência, ele sempre paga `V²` de memória, mesmo para um grafo com apenas `O(V)` arestas; um algoritmo de origem única rodando sobre uma lista de adjacência usaria bem menos espaço por execução em um grafo esparso.
- **Arestas negativas tudo bem, ciclos negativos não — e o algoritmo não avisa sozinho** — ele silenciosamente produz uma matriz que parece uma resposta mesmo quando um ciclo negativo torna o conceito de "caminho mínimo" indefinido; checar a diagonal em busca de uma entrada negativa depois é um passo necessário e separado, não algo que o laço triplo faz por você.
- **Só pesos vs. pesos e caminhos** — o código acima retorna apenas valores `d[i][j]`; recuperar as rotas reais custa outra matriz de predecessores `Π` de Θ(V²) mantida em paralelo, o mesmo trade-off "quanto vs. como" que o concept de Fundamentos de Programação Dinâmica sinaliza para o array `s[]` do corte de barras — fácil de acrescentar, fácil de esquecer se o requisito silenciosamente precisar do caminho em si.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 23.1 "Shortest paths and matrix multiplication", pp. 648-654 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 23.2 "The Floyd-Warshall algorithm", pp. 655-662 — book
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
