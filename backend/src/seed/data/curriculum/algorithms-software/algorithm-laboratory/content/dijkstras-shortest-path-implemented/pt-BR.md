---
version: 1.0
updatedAt: 2026-09-06
title: Caminho Mais Curto de Dijkstra Implementado
summary: A teoria já provada de Dijkstra construída de verdade, um heap binário real via heapq com deleção preguiçosa no lugar de decrease-key, rastreada linha a linha contra números calculados independentemente à mão.
---
## Objetivos de Aprendizagem

- Implementar o algoritmo de Dijkstra de ponta a ponta em Python, de um grafo de lista de adjacência ponderado a um resultado `dist`/`parent` terminado, apoiado em um heap binário real.
- Representar um grafo direcionado ponderado como uma lista de adjacência e adaptar a entrada/saída do algoritmo para aquela representação de forma limpa.
- Rastrear a execução da implementação à mão em um grafo pequeno o suficiente para verificar todo estado de heap e relaxamento intermediário.
- Validar a saída da implementação contra uma resposta de caminho mais curto calculada independentemente à mão, e desenhar ao menos um teste de caso extremo (um vértice inalcançável, um self-loop) que uma implementação correta ainda precisa tratar.
- Identificar, em código rodando, exatamente de onde vem o limite O((V + E) log V), quais linhas custam O(log V) e quantas vezes cada uma roda.

## Contexto e Motivação

O algoritmo de Dijkstra, a estratégia gulosa de sempre finalizar o vértice ainda-não-resolvido com a menor distância tentativa, e por que um heap binário é exatamente a ferramenta certa para responder "qual vértice é esse" em O(log V), já foi demonstrado correto e analisado por completo em [O Algoritmo de Dijkstra](../../../algorithms/content/dijkstras-algorithm/pt-BR.md). Este laboratório não re-deriva nada daquela teoria. Ele pega o algoritmo como já entendido e o constrói: um grafo real representado em código, uma fila de prioridade real, e um rastro real checado linha por linha contra números calculados independentemente à mão. A lacuna que este laboratório fecha é a que todo curso de algoritmos deixa aberta depois de uma prova de quadro-branco, pseudocódigo compila para nada, e a forma específica como um grafo é representado, um heap é consultado, e uma "distância até agora" é atualizada envolvem todas pequenas decisões que uma prova nunca precisa tomar.

## Teoria Central

Os dois fatos nos quais este laboratório se apoia sem redemonstrar: (1) a ordem de extração gulosa só é correta porque todo peso de aresta é não negativo, e (2) um heap binário transforma "encontre o vértice ainda-não-finalizado com a menor distância tentativa" de uma varredura O(V) em um `heappop` O(log V), o que é o que dá ao algoritmo inteiro seu tempo de execução O((V + E) log V). O módulo `heapq` do Python é usado aqui como o heap, é um heap binário genuíno, de qualidade de produção (a mesma estrutura apoiada em array, sift-up/sift-down já coberta em [Inserção e Extração em Heap](../../../../data-structures-ii/content/heap-insert-and-extract/pt-BR.md)), não um substituto de brinquedo, então nada sobre a análise de tempo de execução muda por usá-lo em vez de uma classe de heap escrita à mão.

Uma decisão de representação importa o suficiente para enunciar explicitamente antes do código: esta implementação usa **deleção preguiçosa** em vez de uma operação decrease-key. Quando um caminho mais curto para um vértice já enfileirado é encontrado, um par `(distance, vertex)` inteiramente novo é empurrado em vez de atualizar a entrada antiga no lugar, `heapq` não tem decrease-key embutido, e implementar um corretamente exige rastrear o índice de array de cada vértice, contabilidade extra que não compra nada assintoticamente. O custo é que entradas obsoletas, substituídas, se acumulam no heap; a correção é uma única checagem `if u in finalized: continue` quando uma entrada é retirada, descartando extrações obsoletas em O(1). Isso não muda o limite O((V + E) log V): cada vértice dispara no máximo um empurrão por relaxamento de aresta, então o heap nunca mantém mais que O(E) entradas no total.

## Exemplos Resolvidos

### O grafo e a API

```python
import heapq

# Grafo direcionado ponderado, lista de adjacência: adj[u] = [(v, weight), ...]
adj = {
    'A': [('B', 4), ('C', 1)],
    'B': [('D', 1), ('E', 7)],
    'C': [('B', 2), ('D', 5)],
    'D': [('E', 3)],
    'E': [],
    'F': [('A', 1)],   # F tem uma aresta de saída mas nada alcança F -- checa inalcançabilidade
}

def dijkstra(adj, source):
    """
    Retorna (dist, parent):
      dist[v]   = distância mais curta de source até v (ausente se v inalcançável)
      parent[v] = predecessor de v em um caminho mais curto (None para source)
    Pré-condição: todo peso de aresta em adj é >= 0.
    """
    dist = {source: 0}
    parent = {source: None}
    finalized = set()
    heap = [(0, source)]

    while heap:
        d, u = heapq.heappop(heap)
        if u in finalized:
            continue                       # entrada obsoleta, descarte em O(1)
        finalized.add(u)

        for v, weight in adj.get(u, []):
            if weight < 0:
                raise ValueError(f"negative edge weight on ({u}, {v})")
            if v in finalized:
                continue
            candidate = dist[u] + weight
            if candidate < dist.get(v, float('inf')):
                dist[v] = candidate
                parent[v] = u
                heapq.heappush(heap, (candidate, v))

    return dist, parent
```

A API deliberadamente espelha o que um chamador de fato precisa: `dist` para os números, `parent` para reconstruir o caminho real (não só seu comprimento), e um vértice simplesmente ausente de `dist` se a origem não conseguir alcançá-lo, nenhum sentinela `float('inf')` vazando na estrutura retornada, já que um chamador real quase sempre quer "é alcançável de forma alguma" como uma simples checagem `in`.

```python
def reconstruct_path(parent, target):
    if target not in parent:
        return None                        # inalcançável
    path = []
    while target is not None:
        path.append(target)
        target = parent[target]
    return list(reversed(path))
```

### Rastro contra uma resposta calculada à mão

Rodando `dijkstra(adj, 'A')`: pela mesma sequência de relaxamento já rastreada em [O Algoritmo de Dijkstra](../../../algorithms/content/dijkstras-algorithm/pt-BR.md), extraia A (0), relaxe para B (4) e C (1); extraia C (1), relaxe B para baixo para 3, D para 6; extraia B (3), relaxe D para baixo para 4, E para 10; extraia D (4), relaxe E para baixo para 7; extraia E (7), a implementação acima precisa produzir exatamente:

```python
dist, parent = dijkstra(adj, 'A')
assert dist == {'A': 0, 'C': 1, 'B': 3, 'D': 4, 'E': 7}
assert reconstruct_path(parent, 'E') == ['A', 'C', 'B', 'D', 'E']
```

Checando o caminho de `E` à mão independentemente: A→C (1) + C→B (2) + B→D (1) + D→E (3) = 7, correspondendo exatamente a `dist['E']` e confirmando que a reconstrução do caminho, não só a distância, está correta.

### Casos de teste que uma implementação correta precisa passar

```python
# 1. Origem sem arestas de saída alcança só a si mesma.
d, p = dijkstra({'X': []}, 'X')
assert d == {'X': 0}

# 2. Um vértice inalcançável está simplesmente ausente de dist.
d, p = dijkstra(adj, 'A')
assert 'F' not in d          # nada neste grafo alcança F

# 3. Um grafo com uma rota indireta mais barata vence uma aresta direta mais cara.
adj2 = {'A': [('B', 10), ('C', 1)], 'C': [('B', 1)], 'B': []}
d, p = dijkstra(adj2, 'A')
assert d['B'] == 2            # A->C->B (1+1), não o A->B direto (10)

# 4. Peso negativo é rejeitado em vez de tratado silenciosamente de forma errada.
try:
    dijkstra({'A': [('B', -1)], 'B': []}, 'A')
    assert False, "should have raised"
except ValueError:
    pass
```

O teste 3 é o que vale a pena levar a sério: é fácil escrever uma implementação que acontece de produzir saída correta em um grafo onde o caminho mais curto também é o caminho de menos arestas, enquanto está silenciosamente errada sobre pesos. Um teste onde o caminho mais curto leva *mais* saltos que uma aresta direta é o que de fato exercita relaxamento.

## Equívocos Comuns e Armadilhas

- **"Já que o `heapq` do Python não tem decrease-key, esta implementação está quebrada."** Não está, deleção preguiçosa (empurrar uma entrada nova, melhor, e descartar a antiga como obsoleta quando é eventualmente retirada) é uma técnica padrão, correta, não um workaround para um recurso faltando. A checagem `if u in finalized: continue` é a correção inteira, e custa no máximo uma retirada O(log V) extra por entrada obsoleta, o que não muda o limite assintótico.
- **"`heapq.heappush` precisa de um comparador customizado para ordenar por distância."** Tuplas comparam elemento por elemento em Python, então pares `(distance, vertex)` já ordenam por distância primeiro, nenhum comparador necessário, contanto que a distância seja sempre o primeiro elemento da tupla. Uma armadilha sutil: se duas entradas têm distância igual, Python recorre a comparar o segundo elemento (`vertex`), o que falha se vértices não são nativamente comparáveis (ex., objetos customizados), usar um contador de desempate ou uma chave comparável evita um `TypeError` nesse caso.
- **"Marcar um vértice finalizado quando é *empurrado* para o heap, não quando é *retirado*."** Isto é um bug real, fácil de escrever: descarta a garantia de que finalização acontece em ordem crescente de distância verdadeira, e produz distâncias erradas em qualquer grafo onde um vértice é descoberto mais de uma vez antes de seu valor final, mais curto, ser conhecido (exatamente o vértice B no exemplo rastreado, descoberto primeiro na distância 4, corrigido para 3 antes de jamais ser finalizado).
- **"Esquecer de checar `finalized` antes de relaxar arestas de saída de uma retirada obsoleta."** Sem a proteção `if u in finalized: continue` imediatamente depois de retirar, uma entrada obsoleta re-finaliza um vértice já resolvido e relaxa suas arestas de novo, geralmente inofensivo em termos de correção final (relaxamento só sempre melhora ou deixa distâncias inalteradas) mas desperdiça trabalho e pode contar entradas duas vezes em `finalized`, quebrando o invariante de "todo vértice finalizado exatamente uma vez" do qual a análise de tempo de execução depende.
- **"Testar só em grafos onde BFS (menos arestas) e Dijkstra (menor peso) acontecem de concordar."** O caso de teste 3 acima existe precisamente porque uma implementação com um bug sutil, ex., acidentalmente relaxando por contagem de aresta em vez de peso acumulado, pode passar todo teste em um grafo de aparência não ponderada e ainda estar errada.

## Resumo

Este laboratório implementou o algoritmo de Dijkstra exatamente como já demonstrado correto e analisado no conceito teórico referenciado, usando o `heapq` do Python como um min-heap binário real com deleção preguiçosa para tratar a ausência de decrease-key, e validou o resultado de duas formas: rastreando a saída da implementação contra uma resposta de caminho mais curto calculada à mão no mesmo grafo usado no conceito teórico, e uma pequena suíte de testes de caso extremo (vértices inalcançáveis, uma rota indireta vencendo uma aresta direta, pesos negativos rejeitados) escolhidos especificamente para capturar bugs que um grafo de teste só-de-menos-arestas deixaria passar.

## Documentation Links

- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
