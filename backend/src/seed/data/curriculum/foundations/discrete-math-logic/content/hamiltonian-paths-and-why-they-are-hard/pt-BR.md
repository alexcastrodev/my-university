---
version: 1.0
updatedAt: 2026-11-05
title: "Caminhos Hamiltonianos e Por Que São Difíceis"
summary: "Caminhos e ciclos hamiltonianos, por que não existe um teste simples de grau como o de Euler, condições suficientes como o teorema de Dirac, e a ligação com NP-completude e o problema do caixeiro-viajante."
---
## Objetivos de Aprendizagem

- Definir caminhos e ciclos hamiltonianos e contrastá-los com as trilhas e circuitos de Euler de `euler-paths-and-circuits`.
- Explicar, com dois grafos 3-regulares de 10 vértices, por que nenhum teste de grau decide se um grafo é hamiltoniano, e o que a NP-completude acrescenta.
- Enunciar e provar o teorema de Ore, deduzir dele o teorema de Dirac e mostrar o que dá errado quando falta uma hipótese.
- Reconhecer as condições de Dirac e de Ore como suficientes, mas não necessárias, com grafos hamiltonianos que violam as duas.
- Ligar ciclos hamiltonianos ao problema do caixeiro-viajante e contar o trabalho da força bruta contra a programação dinâmica de Held-Karp.

## Contexto e Motivação

William Rowan Hamilton descreveu o seu jogo icosiano em cartas a John T. Graves no fim de 1856, apresentou-o na reunião de 1857 da British Association em Dublin, e o fabricante de brinquedos Jaques and Son o vendeu a partir de 1859. O objetivo era um percurso fechado pelas arestas de um dodecaedro que passasse uma única vez por cada um dos 20 vértices. Hamilton não foi o primeiro: os passeios do cavalo no xadrez são séculos mais antigos, e Thomas Kirkman estudava ciclos em poliedros na mesma época.

É a pergunta de Euler com vértices no lugar de arestas. A de Euler tem resposta completa: uma passada pelos graus e uma checagem de conectividade. A versão com vértices não tem, e não por falta de procura: em 1972 Richard Karp a colocou na sua lista de problemas NP-completos, então um teste rápido de qualquer tipo resolveria P contra NP. A teoria oferece, no lugar, condições suficientes, que certificam alguns grafos e nada dizem sobre os demais, e algoritmos exatos exponenciais, mas muito melhores que testar todas as ordens.

## Teoria Central

### Definições e o contraste com Euler

Num grafo com $n$ vértices, um **caminho hamiltoniano** é um caminho (sem vértice repetido) que visita todos os vértices. Um **ciclo hamiltoniano** é um ciclo por todos os vértices, o que exige $n\ge3$. Um grafo com ciclo hamiltoniano é **hamiltoniano**. Os grafos aqui são simples, pois um ciclo com 3 ou mais vértices nunca usa laço nem aresta paralela.

As duas propriedades são independentes. O multigrafo de Königsberg de `euler-paths-and-circuits` não tem trilha euleriana, mas o seu grafo simples subjacente tem o ciclo hamiltoniano $A,B,D,C,A$ (um ciclo usa no máximo uma aresta de cada par paralelo). A **borboleta**, dois triângulos com um vértice em comum, tem todos os graus pares (2, 2, 2, 2, 4) e portanto tem circuito euleriano, mas não tem ciclo hamiltoniano: o vértice comum separa os dois triângulos, e um ciclo que cubra os dois lados teria de passar por ele duas vezes.

É por isso que a prova de Euler não se transfere: um circuito euleriano visita um vértice quantas vezes quiser, a restrição local é só de paridade, e Hierholzer cola trilhas fechadas em vértices comuns. Um ciclo hamiltoniano usa exatamente duas arestas por vértice, a escolha num vértice restringe todos os outros, e colar num vértice comum é justamente o proibido.

### Por que não existe teste de grau

**Os graus não determinam a resposta.** O grafo de Petersen e o prisma pentagonal (dois ciclos de 5 vértices ligados por um emparelhamento perfeito, a escada circular de 10 vértices) têm os dois 10 vértices e 15 arestas, são conexos, e todo vértice tem grau 3. O Exemplo 1 conta os ciclos hamiltonianos de cada um por busca exaustiva: o prisma tem 5, o grafo de Petersen não tem nenhum. Um teste que olhe só os graus dá a mesma resposta aos dois e erra em um deles. O argumento é incondicional, mas só descarta testes que leem graus.

**Nenhum teste rápido de tipo algum, a menos que P = NP.** Decidir se um grafo tem ciclo hamiltoniano está em NP: o certificado é a ordem dos vértices, e conferi-lo é verificar que cada vértice aparece uma vez e que os $n$ pares consecutivos são arestas. No artigo de 1972 *Reducibility Among Combinatorial Problems*, Karp provou 21 problemas NP-completos por reduções que partem da satisfatibilidade; dois deles são Directed Hamilton Circuit (reduzido a partir de vertex cover) e Undirected Hamilton Circuit (reduzido a partir do dirigido). Caminho hamiltoniano também é NP-completo, por reduções simples entre as versões de caminho e de ciclo. A condição de Euler se confere em tempo $O(n+m)$. Um teste polinomial para hamiltonicidade, lendo graus ou qualquer outra coisa, poria um problema NP-completo em P e daria P = NP. Logo, a menos que P = NP, nenhuma caracterização é tão fácil de conferir quanto a de Euler.

### O teorema de Ore e o teorema de Dirac

**Teorema (Ore, 1960).** Seja $G$ um grafo simples com $n\ge3$ vértices tal que $\deg(u)+\deg(v)\ge n$ para todo par de vértices distintos e não adjacentes $u,v$. Então $G$ é hamiltoniano.

*Prova.* Suponha que $G$ satisfaz a condição, mas não é hamiltoniano. Acrescente arestas uma a uma enquanto o grafo continuar não hamiltoniano, até não caber mais nenhuma; chame o resultado de $H$. Acrescentar arestas só aumenta graus, e $H$ ainda satisfaz a condição. $H$ não é completo, porque $K_n$ é hamiltoniano para $n\ge3$. Escolha $x,y$ não adjacentes em $H$. Acrescentar $xy$ cria um ciclo hamiltoniano, que precisa usar $xy$, então $H$ tem um caminho hamiltoniano $x=v_1,v_2,\dots,v_n=y$.

Sejam $S=\{i: xv_{i+1}\in E(H)\}$ e $T=\{i: v_iy\in E(H)\}$. Os dois são subconjuntos de $\{1,\dots,n-1\}$, com $\lvert S\rvert=\deg(x)$ e $\lvert T\rvert=\deg(y)$. Como $\deg(x)+\deg(y)\ge n>n-1$, algum índice $i$ está nos dois. Então

$$v_1,v_2,\dots,v_i,\ v_n,v_{n-1},\dots,v_{i+1},\ v_1$$

é um ciclo hamiltoniano em $H$: usa as arestas $v_iv_n$ e $v_{i+1}v_1$ e, no resto, segue o caminho. Isso contradiz a escolha de $H$. ∎

**Teorema (Dirac, 1952).** Todo grafo simples com $n\ge3$ vértices e grau mínimo $\delta(G)\ge n/2$ é hamiltoniano.

*Prova.* Quaisquer dois vértices têm soma de graus de pelo menos $n/2+n/2=n$, então a condição de Ore vale. ∎ Diestel prova o resultado diretamente a partir de um caminho mais longo.

**Quando falta uma hipótese, a conclusão pode falhar.**

- *$n\ge3$:* $K_2$ tem $\delta=1=n/2$ e nenhum ciclo.
- *A cota $n/2$:* para $n$ ímpar, tome duas cópias de $K_{(n+1)/2}$ com um vértice em comum. Então $\delta=(n-1)/2$, logo abaixo de $n/2$, e o vértice comum separa o grafo, então não há ciclo hamiltoniano. Para $n=5$ isso é a borboleta, cujos pares não adjacentes têm soma de graus $4=n-1$; para $n=7$ são dois $K_4$ com um vértice em comum, com $\delta=3$. $K_{2,3}$, com $\delta=2$ e soma de graus 4 nos pares não adjacentes de vértices de grau 2, também não é hamiltoniano.

**Suficientes, não necessárias.** O ciclo $C_n$ com $n\ge5$ é hamiltoniano, mas $\delta=2<n/2$ e os seus pares não adjacentes têm soma de graus $4<n$. O próprio dodecaedro de Hamilton viola as duas condições com folga (grau 3 em todo vértice, $n=20$) e tem 30 ciclos hamiltonianos, contagem feita no Exemplo 2. Os dois teoremas certificam grafos densos; os hamiltonianos esparsos passam por fora.

### Ciclos hamiltonianos e o problema do caixeiro-viajante

O **problema do caixeiro-viajante** (TSP) recebe um grafo completo com pesos nas arestas e pede um ciclo hamiltoniano de peso total mínimo. Ciclo hamiltoniano se reduz a ele: dê peso 1 às arestas de $G$ e 2 aos pares que faltam, e $G$ é hamiltoniano exatamente quando o tour ótimo custa $n$. `the-traveling-salesman-problem-a-case-study-in-np-hardness` faz essa redução por inteiro.

**Força bruta.** Fixe o vértice 0 como início. Cada uma das $(n-1)!$ ordens dos outros vértices dá um tour, e cada tour aparece duas vezes (uma por sentido), então há $(n-1)!/2$ tours. Somar os $n$ pesos de um tour custa $n-1$ adições.

**Held-Karp.** Proposto de forma independente em 1962 por Bellman e por Held e Karp, resolve subproblemas em vez de tours. Para um conjunto $S$ de vértices sem o 0 e um $e\in S$, seja $g(S,e)$ o caminho mais barato que sai de 0, visita exatamente os vértices de $S$ e termina em $e$. Então

$$g(\{e\},e)=d(0,e),\qquad g(S,e)=\min_{p\in S\setminus\{e\}}\big(g(S\setminus\{e\},p)+d(p,e)\big),$$

e o ótimo é $\min_{e\neq0}\big(g(V\setminus\{0\},e)+d(e,0)\big)$. Só importa onde o caminho termina, não a ordem dentro de $S$, e a economia está toda aí. Há $(n-1)2^{n-2}$ valores $g(S,e)$; um conjunto de tamanho $s$ custa $s-1$ adições por vértice final, e somar $\binom{n-1}{s}s(s-1)$ sobre $s$ dá $(n-1)(n-2)2^{n-3}$, mais $n-1$ no passo final. São tempo $\Theta(n^22^n)$ e memória $\Theta(n2^n)$. Trocar "mínimo de somas" por "OU de Es lógicos" decide hamiltonicidade no mesmo tempo $O(n^22^n)$.

## Exemplos Resolvidos

### Exemplo 1: mesmos graus, respostas opostas

```python
import itertools, networkx as nx

def hamiltonian_cycles(G):
    first, *rest = sorted(G)
    count = 0
    for order in itertools.permutations(rest):
        if order[0] > order[-1]:          # cada ciclo aparece duas vezes, uma por sentido
            continue
        cycle = (first, *order, first)
        count += all(G.has_edge(a, b) for a, b in zip(cycle, cycle[1:]))
    return count

for name, G in [("prism", nx.circular_ladder_graph(5)), ("Petersen", nx.petersen_graph())]:
    degrees = sorted({d for _, d in G.degree()})
    print(name, G.number_of_nodes(), G.number_of_edges(), degrees, hamiltonian_cycles(G))
# prism 10 15 [3] 5
# Petersen 10 15 [3] 0
```

### Exemplo 2: testando Ore e Dirac

Aqui $\sigma$ é a menor soma de graus entre pares não adjacentes, então a condição de Ore é $\sigma\ge n$ e a de Dirac é $\delta\ge n/2$. Os ciclos vêm de busca exaustiva e, no dodecaedro, de uma programação dinâmica sobre subconjuntos que conta caminhos com a recorrência de Held-Karp.

| Grafo | $n$ | $\delta$ | $\sigma$ | Dirac | Ore | Ciclos hamiltonianos |
|---|---|---|---|---|---|---|
| $K_4$ em $1,2,3,4$ mais o vértice 5 ligado a 3 e 4 | 5 | 2 | 5 | não | sim | 2 |
| borboleta | 5 | 2 | 4 | não | não | 0 |
| $K_{2,3}$ | 5 | 2 | 4 | não | não | 0 |
| $C_6$ | 6 | 2 | 4 | não | não | 1 |
| $K_{3,3}$ | 6 | 3 | 6 | sim | sim | 6 |
| dodecaedro | 20 | 3 | 6 | não | não | 30 |

A primeira linha é onde Ore supera Dirac: o vértice 5 tem grau $2<5/2$, mas os seus únicos parceiros não adjacentes, 1 e 2, têm grau 3, então as duas somas dão $3+2=5=n$. Um dos seus dois ciclos é $5,3,1,2,4,5$.

Quanto as condições cobrem? O graph atlas do networkx lista todos os grafos de até 7 vértices, e a mesma busca sobre os conexos dá:

| $n$ | grafos conexos | hamiltonianos | satisfazem Ore | satisfazem Dirac |
|---|---|---|---|---|
| 5 | 21 | 8 | 5 | 3 |
| 6 | 112 | 48 | 21 | 19 |
| 7 | 853 | 383 | 68 | 29 |

Para $n=7$, Ore certifica 68 dos 383 grafos hamiltonianos, e Dirac, 29. Todo grafo que satisfaz uma condição é hamiltoniano, como os teoremas prometem, e para $n=6$ e $n=7$ a maioria dos grafos hamiltonianos não satisfaz nenhuma.

### Exemplo 3: força bruta contra Held-Karp, contadas

```python
from itertools import combinations, permutations

def held_karp(d):
    n = len(d)
    g = {(1 << k, k): d[0][k] for k in range(1, n)}        # caminhos 0 -> k
    for size in range(2, n):
        for S in combinations(range(1, n), size):
            mask = sum(1 << k for k in S)
            for e in S:
                prev = mask ^ (1 << e)
                g[(mask, e)] = min(g[(prev, p)] + d[p][e] for p in S if p != e)
    full = (1 << n) - 2                                     # todos os vértices menos o 0
    return min(g[(full, e)] + d[e][0] for e in range(1, n))

def brute_force(d):
    def length(order):
        tour = (0, *order, 0)
        return sum(d[a][b] for a, b in zip(tour, tour[1:]))
    return min(length(p) for p in permutations(range(1, len(d))) if p[0] < p[-1])
```

Para $n$ de 4 a 10, tome $n$ pontos de `numpy.random.default_rng(n).random((n, 2))` com distâncias euclidianas. As duas funções devolvem o mesmo ótimo nas sete instâncias. Contar as adições com um contador em cada laço (e $n-1$ por tour na força bruta) bate exatamente com as fórmulas:

| $n$ | tours $(n-1)!/2$ | adições da força bruta | valores $g(S,e)$ | adições de Held-Karp |
|---|---|---|---|---|
| 4 | 3 | 9 | 12 | 15 |
| 5 | 12 | 48 | 32 | 52 |
| 6 | 60 | 300 | 80 | 165 |
| 8 | 2520 | 17640 | 448 | 1351 |
| 10 | 181440 | 1632960 | 2304 | 9225 |

As duas colunas contam a mesma operação, somar o peso de uma aresta a uma soma parcial; comparações e enumeração de subconjuntos ficam fora. A força bruta faz menos adições até $n=5$, e Held-Karp ganha a partir de $n=6$. Pelas fórmulas, com $n=20$ a força bruta precisa de $1{,}16\times10^{18}$ adições e Held-Karp de $4{,}48\times10^{7}$; com $n=30$, os números são $1{,}28\times10^{32}$ e $1{,}09\times10^{11}$. Com $n=30$, Held-Karp também guarda $7{,}8\times10^{9}$ valores, uns 62 GB a 8 bytes cada: a memória acaba antes do tempo.

## Equívocos Comuns e Armadilhas

- **"O grafo falha em Dirac e em Ore, então não é hamiltoniano."** As duas são certificados de mão única. $C_6$ e o dodecaedro falham nas duas e são hamiltonianos.
- **"Conexo e com grau mínimo 2 basta."** A borboleta e o grafo de Petersen são conexos, têm grau mínimo pelo menos 2 e não têm ciclo hamiltoniano.
- **"NP-completo quer dizer insolúvel."** Quer dizer que não se conhece algoritmo polinomial. Held-Karp resolve exatamente 20 vértices com $4{,}48\times10^{7}$ adições.
- **"Held-Karp é polinomial."** $n^22^n$ é exponencial; supera $(n-1)!$, não $n^3$.
- **"Caminho hamiltoniano dá ciclo hamiltoniano."** Um grafo caminho tem caminho hamiltoniano e nenhum ciclo.

## Resumo

Ciclo hamiltoniano e circuito euleriano são propriedades independentes, e só o segundo é regido por uma paridade local. Não existe teste de grau: o prisma e o grafo de Petersen têm os mesmos graus e respostas diferentes, e, como Karp (1972) pôs Hamilton circuit entre os problemas NP-completos, um teste de tempo polinomial implicaria P = NP. O teorema de Ore (somas de graus de pares não adjacentes de pelo menos $n$, com $n\ge3$) e o seu corolário, o teorema de Dirac (grau mínimo de pelo menos $n/2$), garantem ciclo hamiltoniano, e duas cliques com um vértice em comum mostram a garantia falhando logo abaixo da cota. São suficientes, não necessárias: para $n=7$ certificam 68 e 29 dos 383 grafos hamiltonianos. Para o TSP, Held-Karp troca os $(n-1)!/2$ tours da força bruta por $(n-1)(n-2)2^{n-3}+(n-1)$ adições: melhor a partir de $n=6$, ainda exponencial.

## Documentation Links

- [Diestel, Graph Theory (6th ed.), Chapter 10 free preview](https://www.math.uni-hamburg.de/home/diestel/books/graph.theory/preview/Ch10.pdf): o teorema de Dirac com prova, o exemplo que mostra que a cota é justa e notas sobre NP-dificuldade.
- [Wikipedia, Hamiltonian path](https://en.wikipedia.org/wiki/Hamiltonian_path): definições e os teoremas de Dirac, Ore e Bondy-Chvátal.
- [Wikipedia, Ore's theorem](https://en.wikipedia.org/wiki/Ore%27s_theorem): o enunciado, uma prova e a fonte de 1960.
- [Wikipedia, Icosian game](https://en.wikipedia.org/wiki/Icosian_game): o jogo de Hamilton e as suas datas.
- [Wikipedia, Karp's 21 NP-complete problems](https://en.wikipedia.org/wiki/Karp%27s_21_NP-complete_problems): a lista de Karp de 1972, incluindo Hamilton circuit.
- [Erickson, Algorithms, Chapter 12: NP-Hardness](https://jeffe.cs.illinois.edu/teaching/algorithms/book/12-nphard.pdf): reduções que provam que ciclo hamiltoniano é NP-difícil, e a passagem para o problema do caixeiro-viajante.
- [Wikipedia, Held-Karp algorithm](https://en.wikipedia.org/wiki/Held%E2%80%93Karp_algorithm): a recorrência, as origens em 1962 e as cotas de tempo e memória.
- [Levin, Discrete Mathematics: An Open Introduction, Euler Paths and Circuits](https://discrete.openmathbooks.org/dmoi3/sec_paths.html): caminhos de Hamilton e a falta de um teste simples.
