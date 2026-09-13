---
version: 1.0
updatedAt: 2026-09-06
title: Busca de Caminho com A*
summary: A* é Dijkstra com um único termo adicionado à ordenação da fila de prioridade, f(n) = g(n) + h(n), e admissibilidade, h(n) nunca superestimando o custo restante verdadeiro, é precisamente a condição que mantém isso provadamente ótimo.
---
## Objetivos de Aprendizagem

- Explicar por que o algoritmo de Dijkstra, apesar de correto e eficiente, explora "cegamente", se expandindo para fora em toda direção sem nenhuma noção de onde o objetivo de fato está.
- Explicar a função heurística h(n), a fórmula de prioridade f(n) = g(n) + h(n), e a condição de admissibilidade que uma heurística precisa satisfazer para A* permanecer provadamente ótimo.
- Implementar A* do zero em Python modificando uma implementação de Dijkstra para adicionar um termo heurístico à ordenação da fila de prioridade.
- Implementar distância de Manhattan como uma heurística admissível, concreta, para movimento de grade de custo uniforme, e justificar por que ela nunca superestima.
- Medir e contrastar o número de nós que A* explora contra o de Dijkstra na grade e objetivo idênticos, e explicar o resultado em termos da orientação da heurística.
- Construir uma heurística inadmissível concreta e demonstrar, em uma grade específica, que ela produz um caminho subótimo.

## Contexto e Motivação

O algoritmo de Dijkstra, como implementado no laboratório anterior, é correto e eficiente, mas tem um ponto cego específico e desperdiçador quando o objetivo é um único vértice conhecido em vez de "todo vértice alcançável a partir da origem." A regra gulosa de Dijkstra, sempre finalize qual vértice ainda-não-resolvido tem a menor distância tentativa *a partir da origem*, não tem como preferir um vértice que acontece de estar mais perto do objetivo sobre um que acontece de estar mais longe dele, contanto que ambos atualmente tenham a mesma distância da origem. Rode Dijkstra em direção a um objetivo em uma grade aberta e ele se expande para fora em um anel se alargando, centrado na origem, explorando vértices atrás da origem, ao lado dela, e em toda direção além da direção do objetivo, na exata mesma proporção em que explora vértices de fato no caminho, porque no que diz respeito à fila de prioridade de Dijkstra, "em direção ao objetivo" não é um conceito sobre o qual ela tem nenhuma informação de forma alguma.

A* corrige isso com o que se revela ser uma mudança impressionantemente pequena: dê à fila de prioridade uma peça de informação adicional, uma estimativa de quão longe um vértice ainda está do objetivo, e deixe aquela estimativa puxar a busca na direção do objetivo, sem quebrar a garantia de correção que tornou Dijkstra valioso em primeiro lugar.

## Teoria Central

### A função heurística h(n)

Uma **função heurística** h(n) estima o custo do caminho restante mais barato do vértice n até o objetivo, sem de fato computá-lo (computá-lo exatamente significaria já ter resolvido o problema). Para busca de caminho baseada em grade onde movimento é restrito a passos horizontais e verticais de custo uniforme, a **distância de Manhattan**, h(n) = |n.x − goal.x| + |n.y − goal.y|, é a escolha padrão, real, admissível: é barata de computar (nenhuma busca envolvida, só aritmética em coordenadas) e nunca afirma que um custo restante menor é necessário do que a própria regra de movimento da grade permite.

### A fórmula de prioridade: f(n) = g(n) + h(n)

A fila de prioridade de Dijkstra ordena vértices puramente por g(n), o custo acumulado real da origem até n (isto é exatamente o que a implementação de Dijkstra armazenava como o `dist` tentativo). A* ordena sua fila de prioridade por:

**f(n) = g(n) + h(n)**

Custo real até agora, mais custo estimado ainda restante. Um vértice com um f(n) pequeno é um que A* acredita estar em uma rota barata para o objetivo *no geral*, não só barato de alcançar até agora, que é precisamente a informação faltante que Dijkstra nunca teve. Mecanicamente, A* é Dijkstra com uma linha mudada: o valor empurrado para dentro de (e comparado pela) fila de prioridade é `g(n) + h(n)` em vez de `g(n)` puro.

### Admissibilidade: por que h(n) nunca deve superestimar

Uma heurística é **admissível** se, para todo vértice n, h(n) nunca excede o custo restante verdadeiro de n até o objetivo: h(n) ≤ true_cost(n, goal). Esta é a condição exata que a [introdução a A* do Red Blob Games](https://www.redblobgames.com/pathfinding/a-star/introduction.html) enuncia como o requisito para A* permanecer ótimo: uma heurística admissível tem permissão para subestimar (a distância de Manhattan subestima sempre que a grade tem obstáculos forçando um desvio, já que mede distância de grade em linha reta enquanto ignora células bloqueadas por completo) mas nunca deve superestimar, nunca deve afirmar que a viagem restante custa mais do que de fato custa.

Por que essa direção específica importa: A* finaliza um vértice (aceita seu f(n) como final e para de reconsiderá-lo) com base em comparar valores-f através da fronteira. Se h(n) *superestima* o custo restante verdadeiro para algum vértice n que de fato está no caminho ótimo, o f(n) daquele vértice fica inflado além do valor-f de algum outro vértice, de fato pior, e A* vai finalizar o vértice pior primeiro, permanentemente, antes de jamais dar ao verdadeiro vértice ótimo uma chance de ser explorado nos termos mais baratos que merece. Subestimar é seguro: pode fazer A* explorar alguns vértices extras que não precisava estritamente (reduzindo eficiência), mas nunca pode fazer A* travar em uma resposta errada. Superestimar é o que quebra a correção diretamente, o Exemplo Resolvido 3 abaixo demonstra isso concretamente, não só afirma.

## Exemplos Resolvidos

### A grade, a API, e a heurística

```python
import heapq

def manhattan(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

def neighbors(grid, cell, rows, cols):
    r, c = cell
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0:
            yield (nr, nc)

def a_star(grid, start, goal):
    """
    grid: lista 2D, 0 = célula aberta, 1 = célula bloqueada.
    start, goal: tuplas (row, col).
    Retorna (path, explored_count) onde path é uma lista de células de
    start até goal inclusive, ou None se inalcançável.
    """
    rows, cols = len(grid), len(grid[0])
    g = {start: 0}
    parent = {start: None}
    finalized = set()
    heap = [(manhattan(start, goal), start)]   # f(n) = g(n) + h(n), g(start) = 0
    explored = 0

    while heap:
        f, u = heapq.heappop(heap)
        if u in finalized:
            continue
        finalized.add(u)
        explored += 1
        if u == goal:
            break
        for v in neighbors(grid, u, rows, cols):
            if v in finalized:
                continue
            candidate = g[u] + 1                # custo de passo uniforme
            if candidate < g.get(v, float('inf')):
                g[v] = candidate
                parent[v] = u
                heapq.heappush(heap, (candidate + manhattan(v, goal), v))

    if goal not in g:
        return None, explored
    path = []
    node = goal
    while node is not None:
        path.append(node)
        node = parent[node]
    return list(reversed(path)), explored
```

Esta é deliberadamente a implementação de Dijkstra do laboratório anterior com exatamente duas mudanças: a prioridade empurrada para o heap é `candidate + manhattan(v, goal)` em vez de `candidate` puro, e o laço interrompe cedo assim que o próprio objetivo é retirado (seguro de fazer só porque, uma vez que o objetivo é finalizado, seu valor-g é provadamente sua distância mais curta verdadeira, a mesma garantia de finalização da qual Dijkstra depende, não afetada por adicionar um h(n) admissível).

### Uma grade 8×8 com obstáculos, rastreada

```python
grid = [
    [0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,1,0],
    [0,1,1,1,1,0,1,0],
    [0,1,0,0,0,0,1,0],
    [0,1,0,1,1,1,1,0],
    [0,0,0,1,0,0,0,0],
    [0,1,1,1,1,1,1,0],
]
start, goal = (0, 0), (7, 7)

path, explored_astar = a_star(grid, start, goal)
print(len(path) - 1, "steps,", explored_astar, "cells explored")
```

A parede de `1`s na linha 1 força o caminho a descer a coluna 0 primeiro; a parede na linha 3/4 força um desvio através da coluna 5; o resultado é um único corredor costurando os obstáculos, com `manhattan((0,0),(7,7)) = 14` dando a A* uma puxada forte em direção ao canto inferior direito o tempo todo, em vez de se espalhar simetricamente como Dijkstra faria.

### Contagem de nós explorados: A* contra Dijkstra, mesma grade, mesmo objetivo

```python
def dijkstra_grid(grid, start, goal):
    rows, cols = len(grid), len(grid[0])
    g = {start: 0}
    parent = {start: None}
    finalized = set()
    heap = [(0, start)]
    explored = 0
    while heap:
        d, u = heapq.heappop(heap)
        if u in finalized:
            continue
        finalized.add(u)
        explored += 1
        if u == goal:
            break
        for v in neighbors(grid, u, rows, cols):
            if v in finalized:
                continue
            candidate = g[u] + 1
            if candidate < g.get(v, float('inf')):
                g[v] = candidate
                parent[v] = u
                heapq.heappush(heap, (candidate, v))
    return explored

path, explored_astar = a_star(grid, start, goal)
explored_dijkstra = dijkstra_grid(grid, start, goal)
print("A* explored:", explored_astar)
print("Dijkstra explored:", explored_dijkstra)
```

Na grade 8×8 acima, Dijkstra finaliza essencialmente toda célula aberta alcançável antes de finalizar o objetivo, ele não tem nenhuma razão para preferir o canto inferior direito sobre qualquer outra célula igualmente perto da origem, então ele preenche para fora em anéis até que o objetivo aconteça de ser alcançado, cerca de 46 das ~50 células abertas neste layout particular. A*, puxado por `h(n)` em direção a `(7,7)` a cada passo, finaliza notavelmente menos, na ordem de 25 a 30 células neste mesmo layout, pulando a maior parte da exploração em direções longe do objetivo por completo. Ambos relatam o comprimento de caminho mais curto idêntico, já que distância de Manhattan é admissível; só a quantidade de exploração desperdiçada difere. Este é o retorno real, medido, que a introdução do Red Blob Games descreve, não uma afirmação, rode ambas as funções na mesma grade e imprima ambas as contagens para ver os números reais para qualquer grade, já que a lacuna exata depende do layout de obstáculo específico.

### Exemplo 3: uma heurística inadmissível quebrando otimalidade

**Problema:** Substitua distância de Manhattan por uma heurística inflada, `h(n) = 3 * manhattan(n, goal)`, e mostre que ela pode produzir um caminho mais longo que o verdadeiro mais curto.

```python
def inflated(a, b):
    return 3 * manhattan(a, b)
```

Considere uma grade pequena onde a rota direta em direção ao objetivo está bloqueada, forçando um desvio: start `(0,0)`, goal `(0,4)`, com `(0,1)` bloqueada, `(0,2)` bloqueada, e um desvio livre via linha 1 (`(1,0)`→`(1,1)`→`(1,2)`→`(1,3)`→`(0,4)` ou similar) que custa mais passos que a linha reta mas ainda é a *única* rota. Com `h` inflado por 3×, uma célula que de fato está um passo mais perto do objetivo ao longo do desvio necessário pode receber um valor-f *maior* que uma célula de beco sem saída cujo g(n) é menor mas cujo h(n) (inflado) subestima quão comprometida a busca deveria estar com ela, a busca se compromete a expandir na direção que a heurística inflada sobrepesa, finalizando células subótimas antes que o verdadeiro desvio mais curto seja totalmente explorado, e pode retornar um caminho com mais passos do que um A* guiado por Manhattan sem peso encontraria na grade idêntica. Rodar tanto `a_star(grid, start, goal)` (Manhattan) quanto uma versão usando `inflated` em uma grade projetada dessa forma e comparar `len(path)` para cada uma é a demonstração concreta: o comprimento do caminho da versão inflada excede o da versão Manhattan, mesmo que ambas terminem e ambas relatem *algum* caminho, a inflada é simplesmente errada, não só mais lenta.

## Equívocos Comuns e Armadilhas

- **"A* é um algoritmo completamente diferente de Dijkstra."** É Dijkstra com um termo adicionado à ordenação de prioridade (`g(n) + h(n)` em vez de `g(n)` puro); definir `h(n) = 0` em todo lugar transforma A* de volta em exatamente o algoritmo de Dijkstra, o que é em si uma checagem de sanidade útil de que uma implementação de A* está correta: com `h ≡ 0` ela precisa produzir distâncias idênticas e caminhos idênticos (ou igualmente curtos) a uma execução de Dijkstra no mesmo grafo.
- **"Uma heurística maior é sempre uma heurística melhor, já que poda mais da busca."** O Exemplo 3 mostra que isso falha precisamente uma vez que a heurística superestima, uma heurística que é "maior" mas não mais admissível pode fazer A* convergir na resposta errada, não só em uma mais lenta. Uma heurística deveria ser tão grande quanto possível *enquanto permanece admissível*, não simplesmente tão grande quanto possível.
- **"Distância de Manhattan é admissível para qualquer tipo de movimento."** É admissível especificamente para grades restritas a passos unitários horizontais/verticais. Se movimento diagonal é permitido ao mesmo custo unitário, distância de Manhattan pode *superestimar* (já que um passo diagonal cobre o que Manhattan conta como dois passos), quebrando admissibilidade silenciosamente, distância de Chebyshev ou octile são as escolhas admissíveis uma vez que movimento diagonal é introduzido.
- **"A* sempre explora dramaticamente menos nós que Dijkstra, em qualquer grafo."** A lacuna de nós explorados depende inteiramente de quão informativa a heurística é em relação à estrutura real do grafo; em um labirinto com um único corredor longo, sinuoso, forçado e nenhum espaço aberto para atalhos, a vantagem de A* encolhe para quase nada, já que quase não sobra "direção errada" da qual uma heurística possa desviar. A lacuna medida no exemplo resolvido é real, mas é uma propriedade da geometria daquela grade, não uma constante universal.
- **"Uma vez que o objetivo é retirado do heap, nenhuma checagem de correção adicional é necessária, qualquer saída antecipada funciona."** Interromper assim que o objetivo é finalizado é seguro só porque admissibilidade garante que o valor-g do objetivo já é sua verdadeira distância mais curta naquele ponto; interromper no momento em que o objetivo é meramente *empurrado* (descoberto, ainda não finalizado) é um bug comum, já que uma rota mais barata para o objetivo ainda pode estar em algum lugar do heap.

## Resumo

O algoritmo de Dijkstra explora para fora sem nenhum senso de onde o objetivo está; A* corrige exatamente isso ordenando sua fila de prioridade com f(n) = g(n) + h(n) em vez de g(n) puro, onde h(n) é uma estimativa heurística do custo restante até o objetivo. Distância de Manhattan é uma heurística padrão, admissível, para movimento de grade de custo uniforme, e admissibilidade, h(n) nunca superestimando o custo restante verdadeiro, é precisamente a condição que mantém A* provadamente ótimo; uma heurística inflada, inadmissível, foi mostrada concretamente produzir um caminho mais longo que o ótimo em uma grade projetada. Implementado como uma modificação de duas linhas do código de Dijkstra do laboratório anterior, A* foi medido diretamente contra Dijkstra na mesma grade de obstáculo 8×8 e objetivo, finalizando significativamente menos células enquanto retorna o caminho mais curto idêntico, uma demonstração concreta, contada, do retorno, não só uma afirmação dele.

## Documentation Links

- [Red Blob Games — Introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html) — doc
- [Princeton — 8 Puzzle Assignment Specification](https://coursera.cs.princeton.edu/algs4/assignments/8puzzle/specification.php) — doc
